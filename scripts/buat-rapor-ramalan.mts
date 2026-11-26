/**
 * Rapor ketepatan ramalan: ramalan dibuat seolah data hanya sampai bulan tertentu, lalu
 * dicocokkan dengan penjualan yang sebenarnya terjadi. HANYA MEMBACA database perusahaan.
 *
 *   npx tsx --env-file=.env.local scripts/buat-rapor-ramalan.mts dekat
 *   npx tsx --env-file=.env.local scripts/buat-rapor-ramalan.mts sekarang
 *
 *   dekat    -> data sampai 3 bulan sebelum bulan penuh terakhir, diramal 3 bulan berikutnya
 *               (jarak 1-3 bulan)
 *   sekarang -> data berhenti 2 bulan lebih awal lagi, bulan yang diramal sama (jarak 3-5
 *               bulan). Jarak ini sama dengan ramalan yang dilihat pemakai di portal sekarang.
 *
 * Yang dipakai SAMA dengan portal: `ramalkan()` lengkap dengan pemilihan model, pola bulanan,
 * dan pelebaran rentang. Pola bulanan dihitung ULANG hanya dari data sampai titik potong,
 * supaya rapornya tidak "mengintip" bulan yang sedang diuji.
 *
 * Hasilnya ditulis ke `data/rapor-ramalan-<jenis>.json` (diabaikan git: isinya angka penjualan
 * asli) dan dibaca halaman `/rapor-ramalan`.
 */
import { writeFileSync } from "node:fs";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData, batasSambung, type DeretSku } from "@/lib/ramalan/deret";
import { ramalkan } from "@/lib/ramalan/pilih";
import { hitungPola } from "@/lib/ramalan/pola";
import { volumePenjualan } from "@/lib/ramalan/jarak";

const JENIS = process.argv[2] === "sekarang" ? "sekarang" : "dekat";
const BULAN_DIUJI = 3;

const keAngka = (b: string) => { const [y, m] = b.split("-").map(Number); return y * 12 + m - 1; };
const keBulan = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;

const db = poolPerusahaan();
const akhirPenuh = (await bulanTerakhirData())!;
const awalUji = keAngka(akhirPenuh) - BULAN_DIUJI + 1;
const bulanUji = Array.from({ length: BULAN_DIUJI }, (_, i) => keBulan(awalUji + i));
// "sekarang" di portal = 2 bulan sesudah data terakhir, dan yang ditampilkan mulai bulan berikutnya.
const jeda = JENIS === "sekarang" ? 2 : 0;
const potong = keBulan(awalUji - 1 - jeda);
const pura = keBulan(awalUji - 1);
console.log(`rapor ${JENIS}: data sampai ${potong}, seolah sekarang ${pura}, diuji ${bulanUji.join(", ")}`);

// Pola bulanan hanya dari data sampai titik potong. Kuerinya sama dengan `polaBulanan()`.
const sambung = await batasSambung();
const { rows: total } = await db.query<{ b: string; q: string }>(
  sambung
    ? `SELECT to_char(period, 'YYYY-MM') b, sum(qty)::text q FROM ai_forecast_sales_monthly WHERE source = 'ba_sales' GROUP BY 1
       UNION ALL
       SELECT to_char(trx_date, 'YYYY-MM') b, sum(qty)::text q FROM trx_ba_sales
        WHERE item_code IS NOT NULL AND trx_date >= $1::date AND trx_date < $2::date GROUP BY 1`
    : `SELECT to_char(period, 'YYYY-MM') b, sum(qty)::text q FROM ai_forecast_sales_monthly WHERE source = 'ba_sales' GROUP BY 1`,
  sambung ? [sambung.dari, sambung.sebelum] : [],
);
const pola = hitungPola(new Map(total.filter((r) => r.b <= potong).map((r) => [r.b, Number(r.q)])));

/** Deret dipotong di `potong`. `null` kalau produknya belum ada saat itu. */
function potongDeret(d: DeretSku): DeretSku | null {
  const n = d.bulan.filter((b) => b <= potong).length;
  if (n === 0) return null;
  return { ...d, bulan: d.bulan.slice(0, n), qty: d.qty.slice(0, n), value: d.value.slice(0, n), bulanTerakhir: d.bulan[n - 1] };
}

/** Penjualan sebenarnya pada bulan uji; bulan tanpa baris berarti 0. */
function aktual(d: DeretSku, kolom: "qty" | "value") {
  return bulanUji.map((b) => { const i = d.bulan.indexOf(b); return i < 0 ? 0 : d[kolom][i]; });
}

// Hanya produk yang masih terjual dalam 3 bulan sampai titik potong: yang lain dianggap berhenti
// oleh `ramalkan()` (lihat `BULAN_BERHENTI`), dan membaca deret 1.700-an produk makan 2 jam.
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly
    WHERE source = 'ba_sales' AND period > $1::date AND period <= $2::date AND qty > 0 GROUP BY 1`,
  [`${keBulan(keAngka(potong) - 3)}-01`, `${potong}-01`],
);

type Baris = {
  sku: string; nama: string; merek: string | null; volume: string;
  model: string; polaBulanan: boolean;
  unit: { ramalan: number[]; bawah: number[]; atas: number[]; aktual: number[]; ulangBulanTerakhir: number };
  rupiah: { ramalan: number[]; aktual: number[] } | null;
};
const hasil: Baris[] = [];
let berhenti = 0, gagal = 0, selesai = 0;
const mulai = Date.now();
for (const { sku_code } of rows) {
  if (++selesai % 50 === 0) console.log(`  ${selesai}/${rows.length} (${Math.round((Date.now() - mulai) / 1000)} dtk)`);
  const h = await deretSku(sku_code);
  if (!h.ok) { gagal++; continue; }
  const latih = potongDeret(h.deret);
  if (!latih) continue;
  const r = ramalkan(latih, BULAN_DIUJI, pura, potong, undefined, pola);
  if (r.berhenti) { berhenti++; continue; }
  if (!r.qty.ok || r.bulanRamalan.join() !== bulanUji.join()) { gagal++; continue; }
  const q = r.qty.terpilih;
  hasil.push({
    sku: r.sku, nama: r.nama, merek: r.merek, volume: volumePenjualan(latih.qty),
    model: q.nama, polaBulanan: Boolean(q.polaBulanan),
    unit: {
      ramalan: q.ramalan, bawah: q.lo, atas: q.hi, aktual: aktual(h.deret, "qty"),
      ulangBulanTerakhir: latih.qty[latih.qty.length - 1],
    },
    rupiah: r.value.ok ? { ramalan: r.value.terpilih.ramalan, aktual: aktual(h.deret, "value") } : null,
  });
}

const keluar = {
  jenis: JENIS,
  dataSampai: potong,
  seolahSekarang: pura,
  bulanDiuji: bulanUji,
  jarak: [jeda + 1, jeda + BULAN_DIUJI],
  dibuat: new Date().toISOString(),
  jumlah: { diramal: hasil.length, berhenti, gagal },
  produk: hasil,
};
writeFileSync(`data/rapor-ramalan-${JENIS}.json`, JSON.stringify(keluar));
console.log(`selesai ${Math.round((Date.now() - mulai) / 1000)} dtk: ${hasil.length} diramal, ${berhenti} berhenti, ${gagal} gagal`);
await db.end();
process.stdout.write("", () => process.exit());
