/**
 * Seberapa tepat ramalan 12 bulan? Diukur sebelum batas 6 bulan di
 * `voltagent/tools-ramalan.ts` dibuka.
 *
 *   npx tsx --env-file=.env.local scripts/ukur-horizon.mts [terlaris] [lainnya]
 *   RAMALAN_COBA_RATA3=1 sebelum perintah itu: rata-rata 3 bulan ikut bersaing.
 *
 * HANYA MEMBACA, tanpa model bahasa. Data sesudah titik potong disembunyikan,
 * `ramalkan()` dipanggil seperti untuk pemakai, lalu hasilnya dibandingkan dengan
 * penjualan yang benar terjadi. LightGBM tidak ikut: tabel hasilnya hanya memuat
 * uji 3 bulan, jadi tidak bisa dinilai pada jarak ini.
 *
 * Produk yang berhenti SESUDAH titik potong ikut dihitung dengan aktual nol.
 * Memilih produk yang masih laku hari ini berarti memakai pengetahuan yang belum
 * ada saat meramal, dan membuat hasilnya terlihat lebih baik dari kenyataan.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, MIN_ARIMA, MIN_MUSIMAN, bulanTerakhirData } from "@/lib/ramalan/deret";
import { ramalkan, selisihBulan } from "@/lib/ramalan/pilih";
import { arima, musiman, naive } from "@/lib/ramalan/model";

const N_TERLARIS = Number(process.argv[2] ?? 100);
const N_LAINNYA = Number(process.argv[3] ?? 50);
const JARAK = 12;
/** Titik potong, bulan sebelum akhir data. Jarak 6 bulan supaya kena musim berbeda. */
const POTONG = [12, 18, 24];
const MIN_LATIH = 12;
const EMBER: [string, number, number][] = [["1-3", 1, 3], ["4-6", 4, 6], ["7-8", 7, 8], ["9-12", 9, 12]];

type Ukur = { galat: number; aktual: number; ramal: number; dalam: number; adaRentang: number; n: number };
const baru = (): Ukur => ({ galat: 0, aktual: 0, ramal: 0, dalam: 0, adaRentang: 0, n: 0 });
const tabel = new Map<string, Ukur>();
function tambah(kunci: string, ramal: number, aktual: number, lo?: number, hi?: number) {
  const u = tabel.get(kunci) ?? baru();
  u.galat += Math.abs(ramal - aktual);
  u.aktual += aktual;
  u.ramal += ramal;
  u.n++;
  if (lo !== undefined && hi !== undefined) {
    u.adaRentang++;
    if (aktual >= lo && aktual <= hi) u.dalam++;
  }
  tabel.set(kunci, u);
}
const pemenang: Record<string, number> = {};
const lewat: Record<string, number> = {};
const perSku: { janji: number; ember: Record<string, number> }[] = [];

const db = poolPerusahaan();
const akhir = await bulanTerakhirData();
if (!akhir) throw new Error("data kosong");

const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales'
    GROUP BY sku_code HAVING count(*) >= $1 ORDER BY sum(qty) DESC`,
  [MIN_LATIH + POTONG[0]],
);
const langkah = Math.max(1, Math.floor((rows.length - N_TERLARIS) / Math.max(N_LAINNYA, 1)));
const contoh = rows.flatMap((r, i) => {
  if (i < N_TERLARIS) return [{ sku: r.sku_code, grup: "terlaris" }];
  return (i - N_TERLARIS) % langkah === 0 && (i - N_TERLARIS) / langkah < N_LAINNYA
    ? [{ sku: r.sku_code, grup: "lainnya" }] : [];
});
console.log(`data sampai ${akhir}; ${rows.length} produk memenuhi syarat, diukur ${contoh.length}`);

const mulai = Date.now();
let selesai = 0;
for (const { sku, grup } of contoh) {
  selesai++;
  if (selesai % 10 === 0) console.log(`  ${selesai}/${contoh.length} (${Math.round((Date.now() - mulai) / 1000)} dtk)`);
  const h = await deretSku(sku);
  if (!h.ok) { lewat["deret-gagal"] = (lewat["deret-gagal"] ?? 0) + 1; continue; }
  const d = h.deret;

  for (const potong of POTONG) {
    const titik = mundur(akhir, potong);
    const idx = d.bulan.indexOf(titik);
    if (idx < MIN_LATIH - 1) { lewat["belum-ada-riwayat"] = (lewat["belum-ada-riwayat"] ?? 0) + 1; continue; }
    const panjang = idx + 1;
    const r = ramalkan({
      ...d,
      bulan: d.bulan.slice(0, panjang),
      qty: d.qty.slice(0, panjang),
      value: d.value.slice(0, panjang),
      bulanTerakhir: titik,
      kelayakan: panjang >= MIN_ARIMA ? "arima" : panjang >= MIN_MUSIMAN ? "musiman" : "naive",
    }, JARAK, titik, titik);
    if (r.berhenti) { lewat["berhenti-saat-itu"] = (lewat["berhenti-saat-itu"] ?? 0) + 1; continue; }

    // Produk yang sudah tidak tercatat setelah bulan terakhirnya dianggap nol.
    const aktualBulan = (k: number) => {
      const j = idx + k;
      return { qty: d.qty[j] ?? 0, value: d.value[j] ?? 0 };
    };
    if (selisihBulan(titik, akhir) < JARAK) continue;

    for (const m of [naive, musiman, arima]) {
      if (panjang < m.minimal) continue;
      const tetap = m.ramal(d.qty.slice(0, panjang), JARAK);
      if (!tetap.ok) continue;
      for (let k = 1; k <= JARAK; k++) {
        const ember = EMBER.find(([, x, y]) => k >= x && k <= y)![0];
        tambah(`tetap-${m.kode}|${ember}`, tetap.nilai[k - 1], aktualBulan(k).qty);
      }
    }

    if (r.qty.ok) {
      const t = r.qty.terpilih;
      pemenang[t.kode] = (pemenang[t.kode] ?? 0) + 1;
      if (t.ramalan.length !== JARAK) { lewat["panjang-beda"] = (lewat["panjang-beda"] ?? 0) + 1; continue; }
      const basis = d.qty.slice(Math.max(0, panjang - 3), panjang);
      const rata = basis.reduce((a, b) => a + b, 0) / basis.length;
      const catat: Record<string, Ukur> = {};
      let total12r = 0, total12a = 0;
      for (let k = 1; k <= JARAK; k++) {
        const a = aktualBulan(k).qty;
        const f = t.ramalan[k - 1];
        total12r += f; total12a += a;
        const ember = EMBER.find(([, x, y]) => k >= x && k <= y)![0];
        for (const g of ["semua", grup]) {
          tambah(`unit|${g}|${ember}`, f, a, t.lo[k - 1], t.hi[k - 1]);
          tambah(`pembanding|${g}|${ember}`, rata, a);
        }
        tambah(`potong${potong}|${ember}`, f, a);
        tambah(`banding${potong}|${ember}`, rata, a);
        tambah(`bulan|${k}`, f, a, t.lo[k - 1], t.hi[k - 1]);
        const c = catat[ember] ?? (catat[ember] = baru());
        c.galat += Math.abs(f - a); c.aktual += a;
      }
      tambah(`total12|${grup}`, total12r, total12a);
      tambah(`total12|semua`, total12r, total12a);
      if (t.wape !== null) {
        const ember: Record<string, number> = {};
        for (const [e, c] of Object.entries(catat)) if (c.aktual > 0) ember[e] = (c.galat / c.aktual) * 100;
        perSku.push({ janji: t.wape, ember });
      }
    } else lewat["unit-tak-bisa"] = (lewat["unit-tak-bisa"] ?? 0) + 1;

    if (r.value.ok && r.value.terpilih.ramalan.length === JARAK) {
      const t = r.value.terpilih;
      for (let k = 1; k <= JARAK; k++) {
        const ember = EMBER.find(([, x, y]) => k >= x && k <= y)![0];
        tambah(`rupiah|semua|${ember}`, t.ramalan[k - 1], aktualBulan(k).value, t.lo[k - 1], t.hi[k - 1]);
      }
    }
  }
}

function mundur(bulan: string, n: number): string {
  const [y, m] = bulan.split("-").map(Number);
  const t = y * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const pct = (x: number) => `${x.toFixed(1)}%`;
const baris = (k: string) => {
  const u = tabel.get(k);
  if (!u || u.aktual === 0) return "(kosong)";
  return `meleset ${pct((u.galat / u.aktual) * 100).padStart(7)}  arah ${pct(((u.ramal - u.aktual) / u.aktual) * 100).padStart(7)}` +
    (u.adaRentang ? `  dalam rentang ${pct((u.dalam / u.adaRentang) * 100).padStart(6)}` : "") + `  (n=${u.n})`;
};
const median = (x: number[]) => {
  const s = [...x].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const [judul, awalan] of [
  ["UNIT, semua", "unit|semua"], ["UNIT, terlaris", "unit|terlaris"], ["UNIT, lainnya", "unit|lainnya"],
  ["PEMBANDING rata-rata 3 bulan, semua", "pembanding|semua"], ["PEMBANDING, terlaris", "pembanding|terlaris"],
  ["RUPIAH, semua", "rupiah|semua"],
] as const) {
  console.log(`\n${judul}`);
  for (const [e] of EMBER) console.log(`  jarak ${e.padEnd(5)} ${baris(`${awalan}|${e}`)}`);
}
console.log("\nPER TITIK POTONG (unit)");
for (const p of POTONG) for (const [e] of EMBER) console.log(`  potong ${p} jarak ${e.padEnd(5)} ${baris(`potong${p}|${e}`)}`);
console.log("\nPEMBANDING PER TITIK POTONG");
for (const p of POTONG) for (const [e] of EMBER) console.log(`  potong ${p} jarak ${e.padEnd(5)} ${baris(`banding${p}|${e}`)}`);
for (const m of ["naive", "musiman", "arima"]) {
  console.log(`\nMODEL ${m} SELALU DIPAKAI`);
  for (const [e] of EMBER) console.log(`  jarak ${e.padEnd(5)} ${baris(`tetap-${m}|${e}`)}`);
}
console.log("\nPER BULAN (unit)");
for (let k = 1; k <= JARAK; k++) console.log(`  ${String(k).padStart(2)} ${baris(`bulan|${k}`)}`);
console.log("\nTOTAL 12 BULAN per produk");
for (const g of ["semua", "terlaris", "lainnya"]) console.log(`  ${g.padEnd(9)} ${baris(`total12|${g}`)}`);
console.log("\nANGKA KETEPATAN YANG DIJANJIKAN vs KENYATAAN (median per produk)");
console.log(`  dijanjikan ${pct(median(perSku.map((s) => s.janji)))}`);
for (const [e] of EMBER) console.log(`  jarak ${e.padEnd(5)} ${pct(median(perSku.flatMap((s) => s.ember[e] === undefined ? [] : [s.ember[e]])))}`);
console.log("\npemenang", JSON.stringify(pemenang));
console.log("dilewati", JSON.stringify(lewat));
console.log(`selesai ${Math.round((Date.now() - mulai) / 1000)} dtk`);

await db.end();
process.stdout.write("", () => process.exit());
