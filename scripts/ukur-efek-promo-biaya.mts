/**
 * Uji terakhir promo: apakah BESAR biaya program per kanal membuat ramalan lebih tepat?
 * HANYA MEMBACA.
 *
 *   npx tsx --env-file=.env.local scripts/ukur-efek-promo-biaya.mts
 *
 * Biaya tiap program dibagi ke produk menurut nilai klaimnya, dan ke bulan secara merata.
 * Bulan "promo besar" = biayanya di sepertiga teratas bulan berbiaya produk itu, dihitung
 * hanya dari data sebelum titik potong. Efeknya juga hanya dari sebelum titik potong.
 *
 * Yang diuji "tahu-promo-besar": bulan target yang kenyataannya promo besar. Ini batas atas,
 * karena biaya program bulan depan belum tentu diketahui. Kalau batas atas ini pun tidak
 * menang, menunggu rencana promo tidak ada gunanya.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { ses } from "@/lib/ramalan/model";
import { volumePenjualan } from "@/lib/ramalan/jarak";

const POTONG = [12, 15, 18, 21, 24];
const JARAK = 5;
const SUSUT = 0.5;
const MIN_BULAN = 3;
const KELOMPOK: [string, string[] | null][] = [
  ["semua kanal", null], ["MTKA", ["MTKA"]], ["MTI", ["MTI"]], ["GT", ["GT"]], ["E-COMMERCE", ["E-COMMERCE"]], ["MTKA+MTI", ["MTKA", "MTI"]],
];

const keAngka = (b: string) => { const [y, m] = b.split("-").map(Number); return y * 12 + m - 1; };
const rata = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

const db = poolPerusahaan();
const akhir = keAngka((await bulanTerakhirData())!);

const tipe = await db.query(`SELECT ct.name, count(DISTINCT t.id_customer)::int outlet, sum(t.qty * t.price)::bigint nilai
    FROM trx_ba_sales t JOIN customer c ON c.id_customer = t.id_customer LEFT JOIN customer_type ct ON ct.id_customer_type = c.id_customer_type
   WHERE t.trx_date >= '2026-01-01' AND t.trx_date < '2026-10-01' GROUP BY 1 ORDER BY 3 DESC LIMIT 10`).catch((e) => ({ rows: [{ gagal: String(e.message).slice(0, 120) }] }));
console.log("jenis outlet BA 2026:", JSON.stringify(tipe.rows));

const { rows: pr } = await db.query<{ s: string; b: string; kanal: string | null; biaya: string }>(
  `WITH biaya AS (SELECT id_program, sum(amount)::float8 total FROM maps_program_cost GROUP BY 1),
        klaim AS (SELECT id_program, product_sku s, sum(amount_net)::float8 n FROM maps_actual_sales WHERE amount_net > 0 GROUP BY 1, 2),
        porsi AS (SELECT id_program, s, n / sum(n) OVER (PARTITION BY id_program) p FROM klaim)
   SELECT p.s, to_char(g, 'YYYY-MM') b, ch.name kanal,
          sum(b.total * p.p / (date_part('year', age(date_trunc('month', m.period_end), date_trunc('month', m.period_start))) * 12
              + date_part('month', age(date_trunc('month', m.period_end), date_trunc('month', m.period_start))) + 1))::text biaya
     FROM porsi p JOIN maps_program m USING (id_program) JOIN biaya b USING (id_program) LEFT JOIN channel ch USING (id_channel)
     CROSS JOIN LATERAL generate_series(date_trunc('month', m.period_start), date_trunc('month', m.period_end), '1 month') g
    WHERE m.status = 4 AND m.period_start >= '2021-01-01' AND m.period_end <= '2026-12-31'
      AND m.period_end >= m.period_start AND m.period_end - m.period_start <= 93 AND b.total > 0
    GROUP BY 1, 2, 3`);

const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales' GROUP BY 1 HAVING count(*) >= 24`);
const deret = new Map<string, { awal: number; qty: number[] }>();
for (const r of rows) {
  const h = await deretSku(r.sku_code);
  if (h.ok) deret.set(r.sku_code, { awal: keAngka(h.deret.bulan[0]), qty: h.deret.qty });
}

type U = { g: number; a: number; r: number; per: Map<string, [number, number]> };

for (const [judul, kanal] of KELOMPOK) {
  const biaya = new Map<string, Map<number, number>>();
  for (const r of pr) {
    if (kanal && !kanal.includes(r.kanal ?? "")) continue;
    if (!biaya.has(r.s)) biaya.set(r.s, new Map());
    const m = biaya.get(r.s)!;
    m.set(keAngka(r.b), (m.get(keAngka(r.b)) ?? 0) + Number(r.biaya));
  }
  const tabel = new Map<string, U>();
  const tambah = (k: string, sku: string, f: number, a: number) => {
    const u = tabel.get(k) ?? { g: 0, a: 0, r: 0, per: new Map() };
    u.g += Math.abs(f - a); u.a += a; u.r += f;
    const s = u.per.get(sku) ?? [0, 0];
    s[0] += Math.abs(f - a); s[1] += a;
    u.per.set(sku, s);
    tabel.set(k, u);
  };
  const efekSemua: number[] = [];
  let besarBulan = 0, totalBulan = 0;

  for (const [sku, d] of deret) {
    const b = biaya.get(sku) ?? new Map<number, number>();
    for (const potong of POTONG) {
      const titik = akhir - potong;
      const i = titik - d.awal;
      if (i < 11 || i >= d.qty.length) continue;
      const latih = d.qty.slice(0, i + 1);
      if (latih.slice(-3).every((v) => v === 0)) continue;

      const dari = Math.max(0, latih.length - 36);
      const berbiaya = [...b].filter(([n, v]) => n <= titik && n >= d.awal + dari && v > 0).map(([, v]) => v).sort((x, y) => x - y);
      const ambang = berbiaya.length >= MIN_BULAN ? berbiaya[Math.floor(berbiaya.length * (2 / 3))] : Infinity;
      const besar = (n: number) => (b.get(n) ?? 0) >= ambang;

      const dengan: number[] = [], tanpa: number[] = [];
      for (let j = dari; j < latih.length; j++) (besar(d.awal + j) ? dengan : tanpa).push(latih[j]);
      let efek = 1;
      if (dengan.length >= MIN_BULAN && tanpa.length >= MIN_BULAN && rata(tanpa) > 0) {
        efek = Math.min(1.5, Math.max(0.7, 1 + SUSUT * (rata(dengan) / rata(tanpa) - 1)));
        if (potong === POTONG[0]) efekSemua.push(efek);
      }
      const f = (n: number) => (besar(n) ? efek : 1);
      const dasar = ses.ramal(latih, JARAK);
      const bersih = ses.ramal(latih.map((v, j) => v / f(d.awal + j)), 1);
      if (!dasar.ok || !bersih.ok) continue;

      const vol = volumePenjualan(latih);
      for (let k = 3; k <= JARAK; k++) {
        const n = titik + k;
        const nyata = d.qty[n - d.awal] ?? 0;
        totalBulan++;
        if (besar(n)) besarBulan++;
        const hasil = { ses: dasar.nilai[k - 1], "tahu-promo-besar": bersih.nilai[0] * f(n) };
        for (const [c, v] of Object.entries(hasil)) {
          tambah(`semua|${c}`, sku, v, nyata);
          tambah(`${vol}|${c}`, sku, v, nyata);
          if (besar(n)) tambah(`bulan-besar|${c}`, sku, v, nyata);
        }
      }
    }
  }
  const median = (x: number[]) => { const s = [...x].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const baris = (k: string) => {
    const u = tabel.get(k);
    return !u || !u.a ? "(kosong)" : `${((u.g / u.a) * 100).toFixed(1).padStart(5)}%`;
  };
  const a = tabel.get("semua|tahu-promo-besar"), o = tabel.get("semua|ses");
  let l = 0, m = 0;
  if (a && o) for (const [s, [g]] of a.per) { const x = o.per.get(s); if (x && x[1] > 0) { if (g < x[0]) l++; else if (g > x[0]) m++; } }
  console.log(`\n${judul}: bulan besar ${besarBulan}/${totalBulan}; efek median ${median(efekSemua).toFixed(2)} (naik ${efekSemua.filter((x) => x > 1).length}, turun ${efekSemua.filter((x) => x < 1).length})`);
  for (const g of ["semua", "laris", "sedang", "kecil", "bulan-besar"]) {
    console.log(`  ${g.padEnd(12)} ses ${baris(`${g}|ses`)}  tahu-promo-besar ${baris(`${g}|tahu-promo-besar`)}`);
  }
  console.log(`  per produk: lebih tepat ${l}, lebih meleset ${m}`);
}
await db.end();
process.stdout.write("", () => process.exit());
