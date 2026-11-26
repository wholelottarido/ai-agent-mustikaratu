/**
 * Apakah efek promo masa lalu tiap produk membuat ramalan lebih tepat? HANYA MEMBACA.
 *
 *   npx tsx --env-file=.env.local scripts/ukur-efek-promo.mts
 *
 * Program dihubungkan lewat `maps_actual_sales` (kodenya sama dengan kode penjualan).
 * Efek tiap produk dihitung hanya dari bulan sebelum titik potong, lalu dipakai pada:
 *   - "tahu-promo": bulan yang kenyataannya ada program. Ini batas atas, karena di dunia
 *     nyata perlu rencana promo. Menunjukkan seberapa berharga rencana itu kalau ada.
 *   - "ulang-promo": bulan yang tahun lalu ada program, tanpa tahu tahun ini ada atau tidak.
 *
 * ⚠️ Hubungan, bukan sebab: bulan berprogram bisa saja memang bulan ramai.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { ses } from "@/lib/ramalan/model";
import { volumePenjualan } from "@/lib/ramalan/jarak";

const POTONG = [12, 15, 18, 21, 24];
const JARAK = 7;
const EMBER: [string, number, number][] = [["1-3", 1, 3], ["3-5", 3, 5]];
const CARA = ["ses", "tahu-promo", "ulang-promo"] as const;
const SUSUT = 0.5;
const MIN_BULAN = 3;

const keAngka = (b: string) => { const [y, m] = b.split("-").map(Number); return y * 12 + m - 1; };
const rata = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

const db = poolPerusahaan();
const akhir = keAngka((await bulanTerakhirData())!);
const { rows: pr } = await db.query<{ s: string; b: string; n: number }>(
  `SELECT a.product_sku s, to_char(g, 'YYYY-MM') b, count(DISTINCT m.id_program)::int n
     FROM maps_actual_sales a JOIN maps_program m USING (id_program)
     CROSS JOIN LATERAL generate_series(date_trunc('month', m.period_start), date_trunc('month', m.period_end), '1 month') g
    WHERE m.status = 4 AND m.period_start >= '2021-01-01' AND m.period_end <= '2026-12-31'
      AND m.period_end >= m.period_start AND m.period_end - m.period_start <= 93
    GROUP BY 1, 2`);
const promo = new Map<string, Set<number>>();
for (const r of pr) {
  if (!promo.has(r.s)) promo.set(r.s, new Set());
  promo.get(r.s)!.add(keAngka(r.b));
}
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales' GROUP BY 1 HAVING count(*) >= 24`);

type U = { g: number; a: number; r: number; per: Map<string, [number, number]> };
const tabel = new Map<string, U>();
const tambah = (k: string, sku: string, f: number, a: number) => {
  const u = tabel.get(k) ?? { g: 0, a: 0, r: 0, per: new Map() };
  u.g += Math.abs(f - a); u.a += a; u.r += f;
  const s = u.per.get(sku) ?? [0, 0];
  s[0] += Math.abs(f - a); s[1] += a;
  u.per.set(sku, s);
  tabel.set(k, u);
};
let adaPromoBulan = 0, totalBulan = 0, ulangBenar = 0, ulangSemua = 0;
const efekSemua: number[] = [];
const contoh: string[] = [];

for (const { sku_code: sku } of rows) {
  const h = await deretSku(sku);
  if (!h.ok) continue;
  const awal = keAngka(h.deret.bulan[0]);
  const qty = h.deret.qty;
  const p = promo.get(sku) ?? new Set<number>();

  for (const potong of POTONG) {
    const titik = akhir - potong;
    const i = titik - awal;
    if (i < 11 || i >= qty.length) continue;
    const latih = qty.slice(0, i + 1);
    if (latih.slice(-3).every((v) => v === 0)) continue;

    // Efek: bulan berprogram lawan bulan tanpa program, 36 bulan sebelum titik potong.
    const dari = Math.max(0, latih.length - 36);
    const dengan: number[] = [], tanpa: number[] = [];
    for (let j = dari; j < latih.length; j++) (p.has(awal + j) ? dengan : tanpa).push(latih[j]);
    let efek = 1;
    if (dengan.length >= MIN_BULAN && tanpa.length >= MIN_BULAN && rata(tanpa) > 0) {
      efek = Math.min(1.5, Math.max(0.7, 1 + SUSUT * (rata(dengan) / rata(tanpa) - 1)));
      if (potong === POTONG[0]) efekSemua.push(efek);
    }
    if (potong === POTONG[0] && (sku === "1006000" || sku === "1005997")) {
      contoh.push(`${sku}: ${dengan.length} bulan berprogram, ${tanpa.length} tanpa, rata ${Math.round(rata(dengan))} lawan ${Math.round(rata(tanpa))}, efek dipakai ${efek.toFixed(2)}`);
    }

    const f = (n: number, ada: (x: number) => boolean) => (ada(n) ? efek : 1);
    const tahu = (n: number) => p.has(n);
    const ulang = (n: number) => p.has(n - 12);
    const dasar = ses.ramal(latih, JARAK);
    const bersih = ses.ramal(latih.map((v, j) => v / f(awal + j, tahu)), 1);
    if (!dasar.ok || !bersih.ok) continue;
    const tingkat = bersih.nilai[0];

    const vol = volumePenjualan(latih);
    for (let k = 1; k <= JARAK; k++) {
      const n = titik + k;
      const nyata = qty[n - awal] ?? 0;
      totalBulan++;
      if (tahu(n)) adaPromoBulan++;
      if (ulang(n)) { ulangSemua++; if (tahu(n)) ulangBenar++; }
      const hasil = { ses: dasar.nilai[k - 1], "tahu-promo": tingkat * f(n, tahu), "ulang-promo": tingkat * f(n, ulang) };
      for (const [e, a, b] of EMBER) {
        if (k < a || k > b) continue;
        for (const c of CARA) {
          tambah(`semua|${c}|${e}`, sku, hasil[c], nyata);
          tambah(`${vol}|${c}|${e}`, sku, hasil[c], nyata);
          if (tahu(n)) tambah(`bulan-promo|${c}|${e}`, sku, hasil[c], nyata);
        }
      }
    }
  }
}
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const baris = (k: string) => {
  const u = tabel.get(k);
  if (!u || !u.a) return "(kosong)";
  const m = median([...u.per.values()].filter(([, a]) => a > 0).map(([g, a]) => (g / a) * 100));
  return `meleset ${((u.g / u.a) * 100).toFixed(1).padStart(5)}%  median ${m.toFixed(1).padStart(5)}%  arah ${(((u.r - u.a) / u.a) * 100).toFixed(1).padStart(6)}%  produk=${u.per.size}`;
};
console.log(`bulan target berprogram: ${adaPromoBulan} dari ${totalBulan} (${((adaPromoBulan / totalBulan) * 100).toFixed(0)}%)`);
console.log(`bulan yang tahun lalu berprogram, tahun ini juga: ${ulangBenar} dari ${ulangSemua} (${((ulangBenar / ulangSemua) * 100).toFixed(0)}%)`);
console.log(`efek per produk: median ${median(efekSemua).toFixed(2)}, naik ${efekSemua.filter((x) => x > 1).length}, turun ${efekSemua.filter((x) => x < 1).length}, dari ${efekSemua.length}`);
contoh.forEach((x) => console.log(x));
for (const g of ["semua", "laris", "sedang", "kecil", "bulan-promo"]) {
  console.log(`\n${g}`);
  for (const [e] of EMBER) {
    console.log(` jarak ${e}`);
    for (const c of CARA) console.log(`  ${c.padEnd(12)} ${baris(`${g}|${c}|${e}`)}`);
  }
}
for (const c of ["tahu-promo", "ulang-promo"]) {
  const a = tabel.get(`semua|${c}|3-5`)!, b = tabel.get("semua|ses|3-5")!;
  let l = 0, m = 0;
  for (const [s, [g]] of a.per) { const x = b.per.get(s); if (x && x[1] > 0) { if (g < x[0]) l++; else if (g > x[0]) m++; } }
  console.log(`per produk ${c} lawan ses, jarak 3-5: lebih tepat ${l}, lebih meleset ${m}`);
}
await db.end();
process.stdout.write("", () => process.exit());
