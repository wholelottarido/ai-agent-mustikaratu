/**
 * Uji penentu cara gabungan, sekaligus angka untuk `lib/ramalan/jarak.ts`. HANYA MEMBACA.
 *
 *   npx tsx --env-file=.env.local scripts/ukur-gabungan.mts [batas-produk]
 *
 * Cara gabungan: pola Lebaran untuk riwayat minimal 24 bulan, SES untuk yang lebih pendek.
 * Dibandingkan dengan pemilihan model sekarang pada produk dan titik potong yang SAMA.
 *
 * Keputusan hanya memakai kelompok `ketiga`: produk yang tidak dipakai `ukur-horizon.mts`
 * maupun `ukur-cara-baru.mts`, jadi tidak ikut membentuk ide cara gabungan ini.
 * LightGBM tidak ikut, karena tabelnya hanya memuat uji 3 bulan.
 */
import { readFileSync } from "node:fs";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { modelYangMungkin, naive, type Model } from "@/lib/ramalan/model";
import {
  BATAS_TIDAK_STABIL, BULAN_BERHENTI, TINGKAT_RENTANG, WAPE_TAK_BERGUNA, selisihBulan,
} from "@/lib/ramalan/pilih";
import { buatLebaran, rata3, ses } from "@/lib/ramalan/model-coba";

const BATAS = Number(process.argv[2] ?? Infinity);
// Keluaran `forecast-service/banding.py`. Tanpa berkas ini, dua cara Python dilewati.
const PYTHON: Record<string, { autoets: number[]; autotheta: number[] }> =
  process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : {};
const POTONG = [12, 18, 24];
const MIN_LATIH = 12;
const MAKS_JENDELA = 4;
const LANGKAH = 3;
const BULAN_UJI = 3;
const JARAK = 12;
const EMBER: [string, number, number][] = [
  ["1-3", 1, 3], ["4-6", 4, 6], ["5-7", 5, 7], ["7-8", 7, 8], ["9-12", 9, 12],
];
const CARA = ["sekarang", "gabungan", "ses", "naive", "autoets", "autotheta"] as const;
type Cara = (typeof CARA)[number];

type Ukur = { galat: number; aktual: number; ramal: number; n: number; dalam: number; ber: number; skor: Map<string, [number, number]> };
const tabel = new Map<string, Ukur>();
function tambah(k: string, sku: string, f: number, a: number, lo?: number, hi?: number) {
  const u = tabel.get(k) ?? { galat: 0, aktual: 0, ramal: 0, n: 0, dalam: 0, ber: 0, skor: new Map() };
  u.galat += Math.abs(f - a); u.aktual += a; u.ramal += f; u.n++;
  if (lo !== undefined && hi !== undefined) { u.ber++; if (a >= lo && a <= hi) u.dalam++; }
  const s = u.skor.get(sku) ?? [0, 0];
  s[0] += Math.abs(f - a); s[1] += a;
  u.skor.set(sku, s);
  tabel.set(k, u);
}
const rataHasil = new Map<string, [number, number]>();

function mundur(bulan: string, n: number): string {
  const [y, m] = bulan.split("-").map(Number);
  const t = y * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const lebar = (g: number[]) => {
  if (g.length === 0) return null;
  const u = [...g].sort((a, b) => a - b);
  return u[Math.max(0, Math.min(u.length - 1, Math.ceil((TINGKAT_RENTANG / 100) * u.length) - 1))];
};

/** Meniru `pilihModel` + cadangan rata-rata di `ramalkan`, hanya untuk unit. */
function pilihSekarang(deret: number[], h: number) {
  const n = deret.length;
  let k = 0;
  while (k < MAKS_JENDELA && n - BULAN_UJI - k * LANGKAH >= MIN_LATIH) k++;
  let terbaik: { m: Model; wape: number; galat: number[] } | null = null;
  if (k > 0) {
    const batasLatih = n - BULAN_UJI - (k - 1) * LANGKAH;
    for (const m of modelYangMungkin(n)) {
      if (m.minimal > batasLatih) continue;
      let t = 0;
      const galat: number[] = [];
      let lengkap = true;
      for (let j = 0; j < k; j++) {
        const akhir = n - BULAN_UJI - j * LANGKAH;
        const f = m.ramal(deret.slice(0, akhir), BULAN_UJI);
        if (!f.ok) { lengkap = false; break; }
        for (let d = 0; d < BULAN_UJI; d++) {
          galat.push(Math.abs(f.nilai[d] - deret[akhir + d]));
          t += Math.abs(deret[akhir + d]);
        }
      }
      if (!lengkap || t === 0) continue;
      const wape = (galat.reduce((a, b) => a + b, 0) / t) * 100;
      if (wape >= WAPE_TAK_BERGUNA) continue;
      if (!terbaik || wape < terbaik.wape) terbaik = { m, wape, galat };
    }
  }
  if (terbaik && terbaik.wape <= BATAS_TIDAK_STABIL) {
    const f = terbaik.m.ramal(deret, h);
    if (f.ok) {
      const w = lebar(terbaik.galat)!;
      return { nilai: f.nilai, lo: f.nilai.map((v) => Math.max(0, v - w)), hi: f.nilai.map((v) => v + w) };
    }
  }
  const f = rata3.ramal(deret, h);
  if (!f.ok) return null;
  const enam = deret.slice(-6);
  return { nilai: f.nilai, lo: f.nilai.map(() => Math.min(...enam)), hi: f.nilai.map(() => Math.max(...enam)) };
}

const db = poolPerusahaan();
const akhirData = (await bulanTerakhirData())!;
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales'
    GROUP BY sku_code HAVING count(*) >= $1 ORDER BY sum(qty) DESC`, [MIN_LATIH + POTONG[0]]);

// Dua pemilihan ini harus sama dengan `ukur-horizon.mts` dan `ukur-cara-baru.mts`.
const langkahLama = Math.floor((rows.length - 60) / 40);
const dipakaiLama = (i: number) => i < 60 || ((i - 60) % langkahLama === 0 && (i - 60) / langkahLama < 40);
const sisa = rows.filter((_, i) => !dipakaiLama(i));
const ekor = sisa.slice(60);
const langkahBaru = Math.max(1, Math.floor(ekor.length / 40));
const baru = new Set([
  ...sisa.slice(0, 60).map((r) => r.sku_code),
  ...ekor.filter((_, i) => i % langkahBaru === 0).slice(0, 40).map((r) => r.sku_code),
]);
const kelompokDari = (i: number, sku: string) => (dipakaiLama(i) ? "lama" : baru.has(sku) ? "baru" : "ketiga");

let kurangPython = 0;
const mulai = Date.now();
const contoh = rows.slice(0, BATAS);
const jumlah: Record<string, number> = {};
let selesai = 0;

for (let i = 0; i < contoh.length; i++) {
  const sku = contoh[i].sku_code;
  const kel = kelompokDari(i, sku);
  jumlah[kel] = (jumlah[kel] ?? 0) + 1;
  if (++selesai % 25 === 0) console.log(`  ${selesai}/${contoh.length} (${Math.round((Date.now() - mulai) / 1000)} dtk)`);
  const h = await deretSku(sku);
  if (!h.ok) continue;
  const { bulan, qty } = h.deret;

  for (const potong of POTONG) {
    const titik = mundur(akhirData, potong);
    const idx = bulan.indexOf(titik);
    if (idx < MIN_LATIH - 1) continue;
    let jual = -1;
    for (let j = idx; j >= 0; j--) if (qty[j] > 0) { jual = j; break; }
    if (jual < 0 || selisihBulan(bulan[jual], titik) >= BULAN_BERHENTI) continue;

    const latih = qty.slice(0, idx + 1);
    // Dari data sebelum titik potong saja, sama seperti yang diketahui alat saat meramal.
    const setahun = latih.slice(-12);
    const volume = setahun.reduce((a, b) => a + b, 0) / setahun.length;
    const tingkat = volume >= 1000 ? "laris" : volume >= 100 ? "sedang" : "kecil";
    const sekarang = pilihSekarang(latih, JARAK);
    const fSes = ses.ramal(latih, JARAK);
    const fNaive = naive.ramal(latih, JARAK);
    const fLebaran = latih.length >= 24 ? buatLebaran(titik).ramal(latih, JARAK) : null;
    const nilaiGabungan = fLebaran?.ok ? fLebaran.nilai : fSes.ok ? fSes.nilai : fNaive.ok ? fNaive.nilai : null;
    // Hanya titik yang semua caranya punya hasil, supaya yang dibandingkan produk yang sama.
    if (!sekarang || !nilaiGabungan || !fSes.ok || !fNaive.ok) continue;

    const py = PYTHON[`${sku}|${titik}`];
    if (process.argv[3] && !py) { kurangPython++; continue; }
    const hasil = {
      sekarang: sekarang.nilai, gabungan: nilaiGabungan, ses: fSes.nilai, naive: fNaive.nilai,
      ...(py ? { autoets: py.autoets, autotheta: py.autotheta } : {}),
    } as Record<Cara, number[]>;
    for (const c of CARA.filter((x) => hasil[x])) {
      for (const [e, a, b] of EMBER) {
        const bagian = hasil[c].slice(a - 1, b);
        const r = rataHasil.get(`${kel}|${c}|${e}`) ?? [0, 0];
        r[0] += new Set(bagian).size === 1 ? 1 : 0; r[1]++;
        rataHasil.set(`${kel}|${c}|${e}`, r);
        for (let d = a; d <= b; d++) {
          const nyata = qty[idx + d] ?? 0;
          const f = hasil[c][d - 1];
          const lo = c === "sekarang" ? sekarang.lo[d - 1] : undefined;
          const hi = c === "sekarang" ? sekarang.hi[d - 1] : undefined;
          tambah(`${kel}|${c}|${e}`, sku, f, nyata, lo, hi);
          tambah(`semua|${c}|${e}`, sku, f, nyata, lo, hi);
          tambah(`volume-${tingkat}|${c}|${e}`, sku, f, nyata, lo, hi);
          tambah(`${kel}|${c}|${e}|potong${potong}`, sku, f, nyata);
        }
      }
    }
  }
}

const pct = (x: number) => `${x.toFixed(1)}%`.padStart(7);
const median = (x: number[]) => {
  const s = [...x].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const baris = (k: string) => {
  const u = tabel.get(k);
  if (!u || u.aktual === 0) return "(kosong)";
  const per = [...u.skor.values()].filter(([, a]) => a > 0).map(([g, a]) => (g / a) * 100);
  const r = rataHasil.get(k);
  return `meleset ${pct((u.galat / u.aktual) * 100)}  median ${pct(median(per))}  arah ${pct(((u.ramal - u.aktual) / u.aktual) * 100)}` +
    (u.ber ? `  rentang ${pct((u.dalam / u.ber) * 100)}` : "") +
    (r ? `  rata ${String(Math.round((r[0] / r[1]) * 100)).padStart(3)}%` : "") + `  n=${u.n}`;
};

console.log(`\nproduk: ${JSON.stringify(jumlah)}; data sampai ${akhirData}`);
for (const kel of ["ketiga", "baru", "lama"]) {
  console.log(`\nKELOMPOK ${kel}`);
  for (const [e] of EMBER.filter(([x]) => x === "1-3" || x === "5-7")) {
    console.log(` jarak ${e}`);
    for (const c of CARA) console.log(`  ${c.padEnd(9)} ${baris(`${kel}|${c}|${e}`)}`);
    if (kel === "ketiga") {
      for (const p of POTONG) {
        console.log(`  potong ${p}: sekarang ${baris(`ketiga|sekarang|${e}|potong${p}`)}`);
        console.log(`             gabungan ${baris(`ketiga|gabungan|${e}|potong${p}`)}`);
      }
    }
    const a = tabel.get(`${kel}|sekarang|${e}`);
    for (const c of CARA.filter((x) => x !== "sekarang")) {
      const g = tabel.get(`${kel}|${c}|${e}`);
      if (!a || !g) continue;
      let lebih = 0, kurang = 0;
      for (const [sku, [gg, ag]] of g.skor) {
        const s = a.skor.get(sku);
        if (!s || ag === 0) continue;
        if (gg < s[0]) lebih++; else if (gg > s[0]) kurang++;
      }
      console.log(`  per produk: ${c} lebih tepat ${lebih}, lebih meleset ${kurang}`);
    }
  }
}
console.log("\nANGKA UNTUK lib/ramalan/jarak.ts (cara sekarang, semua produk)");
for (const [e] of EMBER) console.log(`  jarak ${e.padEnd(5)} ${baris(`semua|sekarang|${e}`)}`);
for (const t of ["laris", "sedang", "kecil"]) {
  console.log(`
VOLUME ${t} (rata-rata unit per bulan: laris 1000+, sedang 100-999, kecil di bawah 100)`);
  for (const [e] of EMBER) console.log(`  jarak ${e.padEnd(5)} ${baris(`volume-${t}|sekarang|${e}`)}`);
  for (const c of CARA.filter((x) => x !== "sekarang")) {
    for (const [e] of EMBER.filter(([x]) => x === "1-3" || x === "5-7")) {
      console.log(`  ${c.padEnd(9)} ${e} ${baris(`volume-${t}|${c}|${e}`)}`);
    }
  }
}
if (process.argv[3]) console.log(`titik yang dilewati karena tidak ada hasil Python: ${kurangPython}`);
console.log(`selesai ${Math.round((Date.now() - mulai) / 1000)} dtk`);
await db.end();
process.stdout.write("", () => process.exit());
