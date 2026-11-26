/**
 * Apakah pola bulanan GABUNGAN semua produk membuat ramalan lebih tepat? HANYA MEMBACA.
 *
 *   npx tsx --env-file=.env.local scripts/ukur-faktor-bulan.mts
 *
 * Pola per produk terlalu acak (ukur-cara-baru.mts), tapi total semua produk punya pola.
 * Tingkat tiap produk dari SES atas penjualan yang pola bulannya sudah dibuang, lalu dikali
 * pola bulan yang diramal. Pola dihitung hanya dari data sebelum titik potong.
 *
 * Tiga pola: bulan kalender, posisi terhadap Lebaran, dan keduanya digabung.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { naive, ses } from "@/lib/ramalan/model";
import { bulanLebaran } from "@/lib/ramalan/kalender";
import { volumePenjualan } from "@/lib/ramalan/jarak";

const POTONG = [12, 15, 18, 21, 24];
const MIN_LATIH = 12;
const BULAN_BERHENTI = 3;
const JARAK = 7;
const EMBER: [string, number, number][] = [["1-3", 1, 3], ["3-5", 3, 5], ["5-7", 5, 7]];
const CARA = ["ses", "kalender", "lebaran", "keduanya", "naive"] as const;
type Cara = (typeof CARA)[number];

const keAngka = (b: string) => { const [y, m] = b.split("-").map(Number); return y * 12 + m - 1; };
const keBulan = (n: number) => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
const rata = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const posisi = (n: number) => {
  const y = Math.floor(n / 12), m = n % 12 + 1, beda = m - bulanLebaran(y);
  return beda >= -2 && beda <= 1 ? beda : 9;
};

const db = poolPerusahaan();
const akhir = keAngka((await bulanTerakhirData())!);
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales' GROUP BY 1 HAVING count(*) >= 24`);

const deret = new Map<string, { awal: number; qty: number[] }>();
for (const r of rows) {
  const h = await deretSku(r.sku_code);
  if (h.ok) deret.set(r.sku_code, { awal: keAngka(h.deret.bulan[0]), qty: h.deret.qty });
}
const nilaiDi = (d: { awal: number; qty: number[] }, n: number) => d.qty[n - d.awal];

/** Rasio tiap kelompok bulan terhadap rata-rata 12 bulan di sekitarnya. Dirapatkan ke 1. */
function pola(titik: number, kunci: (n: number) => number) {
  const total = new Map<number, number>();
  for (const d of deret.values()) {
    for (let i = 0; i < d.qty.length; i++) {
      const n = d.awal + i;
      if (n <= titik) total.set(n, (total.get(n) ?? 0) + d.qty[i]);
    }
  }
  const kumpul = new Map<number, number[]>();
  // Rasio ke rata-rata setahun yang berakhir di bulan itu, jadi tidak melihat sesudah titik potong.
  for (let n = titik; n > titik - 48; n--) {
    const akhirTahun = Array.from({ length: 12 }, (_, i) => total.get(n - i) ?? NaN);
    if (akhirTahun.some(Number.isNaN)) continue;
    const dasar = rata(akhirTahun);
    if (dasar > 0) kumpul.set(kunci(n), [...(kumpul.get(kunci(n)) ?? []), (total.get(n) as number) / dasar]);
  }
  const hasil = new Map<number, number>();
  for (const [k, v] of kumpul) hasil.set(k, v.length >= 2 ? 1 + 0.7 * (rata(v) - 1) : 1);
  return hasil;
}

type U = { g: number; a: number; r: number; arahB: number; arahT: number; per: Map<string, [number, number]> };
const tabel = new Map<string, U>();
const tambah = (k: string, sku: string, f: number, a: number) => {
  const u = tabel.get(k) ?? { g: 0, a: 0, r: 0, arahB: 0, arahT: 0, per: new Map() };
  u.g += Math.abs(f - a); u.a += a; u.r += f;
  const s = u.per.get(sku) ?? [0, 0];
  s[0] += Math.abs(f - a); s[1] += a;
  u.per.set(sku, s);
  tabel.set(k, u);
};
const arah = (k: string, benar: boolean) => {
  const u = tabel.get(k);
  if (u) { u.arahT++; if (benar) u.arahB++; }
};

const contohPola: string[] = [];
for (const potong of POTONG) {
  const titik = akhir - potong;
  const polaBulan = pola(titik, (n) => n % 12);
  const polaLebaran = pola(titik, posisi);
  if (potong === POTONG[0]) contohPola.push(
    `bulan kalender: ${[...polaBulan].sort((a, b) => a[0] - b[0]).map(([m, v]) => `${m + 1}:${v.toFixed(2)}`).join(" ")}`,
    `sekitar Lebaran (9 = biasa): ${[...polaLebaran].sort((a, b) => a[0] - b[0]).map(([m, v]) => `${m}:${v.toFixed(2)}`).join(" ")}`);
  const fk: Record<string, (n: number) => number> = {
    kalender: (n) => polaBulan.get(n % 12) ?? 1,
    lebaran: (n) => polaLebaran.get(posisi(n)) ?? 1,
    keduanya: (n) => Math.sqrt((polaBulan.get(n % 12) ?? 1) * (polaLebaran.get(posisi(n)) ?? 1)),
  };

  for (const [sku, d] of deret) {
    const i = titik - d.awal;
    if (i < MIN_LATIH - 1 || i >= d.qty.length) continue;
    const latih = d.qty.slice(0, i + 1);
    let jual = -1;
    for (let j = i; j >= 0; j--) if (latih[j] > 0) { jual = j; break; }
    if (jual < 0 || i - jual >= BULAN_BERHENTI) continue;

    const dasar = ses.ramal(latih, JARAK);
    const nv = naive.ramal(latih, JARAK);
    if (!dasar.ok || !nv.ok) continue;
    const hasil: Partial<Record<Cara, number[]>> = { ses: dasar.nilai, naive: nv.nilai };
    for (const [nama, f] of Object.entries(fk)) {
      const bersih = latih.map((v, j) => v / f(d.awal + j));
      const t = ses.ramal(bersih, 1);
      if (t.ok) hasil[nama as Cara] = Array.from({ length: JARAK }, (_, k) => Math.round(t.nilai[0] * f(titik + k + 1)));
    }
    if (CARA.some((c) => !hasil[c])) continue;

    const vol = volumePenjualan(latih);
    for (const c of CARA) {
      for (const [e, a, b] of EMBER) {
        for (let k = a; k <= b; k++) {
          const nyata = nilaiDi(d, titik + k) ?? 0;
          const fr = hasil[c]![k - 1];
          tambah(`semua|${c}|${e}`, sku, fr, nyata);
          tambah(`${vol}|${c}|${e}`, sku, fr, nyata);
          tambah(`potong${potong}|${c}|${e}`, sku, fr, nyata);
          if (k > a) {
            const lalu = nilaiDi(d, titik + k - 1) ?? 0;
            const naik = nyata - lalu;
            const naikF = fr - hasil[c]![k - 2];
            if (naik !== 0 && naikF !== 0) {
              arah(`semua|${c}|${e}`, Math.sign(naik) === Math.sign(naikF));
              arah(`${vol}|${c}|${e}`, Math.sign(naik) === Math.sign(naikF));
            }
          }
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
  return `meleset ${((u.g / u.a) * 100).toFixed(1).padStart(5)}%  median ${m.toFixed(1).padStart(5)}%  arah ${(((u.r - u.a) / u.a) * 100).toFixed(1).padStart(5)}%` +
    (u.arahT ? `  naik-turun benar ${((u.arahB / u.arahT) * 100).toFixed(1)}% (${u.arahT})` : "");
};
console.log(`produk ${deret.size}; data sampai ${keBulan(akhir)}`);
contohPola.forEach((x) => console.log(x));
for (const g of ["semua", "laris", "sedang", "kecil", ...POTONG.map((p) => `potong${p}`)]) {
  console.log(`\n${g}`);
  for (const [e] of EMBER) {
    console.log(` jarak ${e}`);
    for (const c of CARA) console.log(`  ${c.padEnd(9)} ${baris(`${g}|${c}|${e}`)}`);
  }
}
for (const c of ["kalender", "lebaran", "keduanya"]) {
  for (const [e] of EMBER) {
    const a = tabel.get(`semua|${c}|${e}`)!, b = tabel.get(`semua|ses|${e}`)!;
    let l = 0, m = 0;
    for (const [s, [g]] of a.per) { const x = b.per.get(s); if (x && x[1] > 0) { if (g < x[0]) l++; else if (g > x[0]) m++; } }
    console.log(`per produk ${c} lawan ses, jarak ${e}: lebih tepat ${l}, lebih meleset ${m}`);
  }
}
await db.end();
process.stdout.write("", () => process.exit());
