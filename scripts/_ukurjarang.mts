/**
 * Sekali pakai: apakah model permintaan terputus benar-benar menolong?
 *
 * Satu pemanggilan `pilihModel()` per produk, lalu DUA pemilihan dihitung dari
 * tabel kandidat yang SAMA — sebelum (naive/musiman/arima) dan sesudah
 * (ditambah croston/sba/tsb/adida/imapa). Jadi ARIMA cuma dilatih sekali dan
 * perbandingannya benar-benar jendela yang sama.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { pilihModel, selisihBulan, BATAS_TIDAK_STABIL, BULAN_BERHENTI,
  type NilaiModel } from "@/lib/ramalan/pilih";
import { ciriJarang, MODEL_JARANG } from "@/lib/ramalan/jarang";

const BATAS = Number(process.argv[2] ?? 150);
/** "atas" = produk terlaris; "ekor" = SKU volume kecil, tempat permintaan terputus sebenarnya ada. */
const MODE = process.argv[3] ?? "atas";
const KODE_JARANG = new Set<string>(MODEL_JARANG.map((m) => m.kode));

const db = poolPerusahaan();
const { rows } = await db.query<{ sku_code: string }>(
  MODE === "ekor"
    ? `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales'
        GROUP BY sku_code HAVING count(*) >= 12 AND sum(qty) > 0
        ORDER BY sum(qty) ASC LIMIT $1`
    : `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales'
        GROUP BY sku_code HAVING count(*) >= 12 ORDER BY sum(qty) DESC LIMIT $1`,
  [BATAS],
);
console.log(`mode ${MODE}, ${rows.length} SKU`);

// ⚠️ Produk yang sudah berhenti dijual HARUS dibuang dulu. `pilihModel()`
// tidak tahu soal itu — penjagaannya ada di `ramalkan()`, lebih awal. Versi
// pertama pengukuran ini melewatkannya dan melaporkan `RH POLIANTHES
// TUBEROSE` sebagai "diselamatkan", padahal penjualan terakhirnya 2021-11 dan
// tool-nya memang menolak meramalnya. Angka yang terlalu bagus karena menguji
// produk yang tidak pernah sampai ke pemakai.
const akhirGlobal = await bulanTerakhirData();
let dibuangBerhenti = 0;

/** Langkah terakhir `pilihModel()`, diulang pada sebagian kandidat. */
function pilihDari(kandidat: NilaiModel[]): NilaiModel | null {
  const layak = kandidat.filter((k) => !k.ditolak);
  if (layak.length === 0) return null;
  const berWape = layak.filter((k) => k.wape !== null).sort((a, b) => a.wape! - b.wape!);
  return berWape[0] ?? layak[0];
}

let n = 0;
let menang = 0;
let kalah = 0;
let seri = 0;
let diselamatkan = 0;
let jatuhSebelum = 0;
let ikut = 0;
const perModel: Record<string, number> = {};
const golongan: Record<string, number> = {};
const contoh: string[] = [];

for (const r of rows) {
  const h = await deretSku(r.sku_code);
  if (!h.ok) continue;
  const terakhirTerjual = (() => {
    for (let i = h.deret.qty.length - 1; i >= 0; i--) if (h.deret.qty[i] > 0) return h.deret.bulan[i];
    return null;
  })();
  if (
    akhirGlobal === null || terakhirTerjual === null ||
    selisihBulan(terakhirTerjual, akhirGlobal) >= BULAN_BERHENTI
  ) { dibuangBerhenti++; continue; }

  n++;
  const p = pilihModel(h.deret.qty, 3);
  const semua = p.kandidat;
  const lama = pilihDari(semua.filter((k) => !KODE_JARANG.has(k.kode)));
  const baru = pilihDari(semua);
  const c = ciriJarang(h.deret.qty);
  if (c) golongan[c.golongan] = (golongan[c.golongan] ?? 0) + 1;

  const adaJarang = semua.some((k) => KODE_JARANG.has(k.kode) && !k.ditolak);
  if (adaJarang) ikut++;

  const wLama = lama?.wape ?? null;
  const wBaru = baru?.wape ?? null;
  if (baru && KODE_JARANG.has(baru.kode)) {
    perModel[baru.kode] = (perModel[baru.kode] ?? 0) + 1;
  }

  const jatuhLama = wLama === null || wLama > BATAS_TIDAK_STABIL;
  const jatuhBaru = wBaru === null || wBaru > BATAS_TIDAK_STABIL;
  if (jatuhLama) jatuhSebelum++;
  if (jatuhLama && !jatuhBaru) {
    diselamatkan++;
    contoh.push(
      `SELAMAT  ${h.deret.nama.slice(0, 30).padEnd(30)} ${(lama?.kode ?? "-").padEnd(8)} ` +
        `${wLama === null ? "  -  " : wLama.toFixed(1).padStart(6)}% -> ${baru!.kode.padEnd(8)} ` +
        `${wBaru!.toFixed(1).padStart(6)}%  ${c?.golongan ?? "?"} nol=${c ? h.deret.qty.length - c.ukuran.length : "?"}`,
    );
  }

  if (wLama !== null && wBaru !== null) {
    if (wBaru < wLama - 0.05) menang++;
    else if (wBaru > wLama + 0.05) kalah++;
    else seri++;
  }

  // ⚠️ Yang menang pada deret HALUS adalah tanda bahaya, bukan kabar baik:
  // di situ model permintaan terputus seharusnya sudah menolak sendiri.
  if (c && c.golongan === "halus" && baru && KODE_JARANG.has(baru.kode)) {
    contoh.push(`⚠️ MENANG DI DERET HALUS ${h.deret.nama.slice(0, 30)} ${baru.kode}`);
  }
  if (n % 10 === 0) console.log(`  ...${n} produk`);
}

console.log(`\n=== ${n} SKU hidup (mode ${MODE}), satuan unit, uji 3 bulan terakhir ===`);
console.log(`dibuang krn berhenti jual: ${dibuangBerhenti}`);
console.log(`golongan deret           : ${JSON.stringify(golongan)}`);
console.log(`model terputus ikut saing: ${ikut}`);
console.log(`WAPE jadi lebih baik     : ${menang}`);
console.log(`WAPE jadi lebih buruk    : ${kalah}   <- harus 0`);
console.log(`WAPE tidak berubah       : ${seri}`);
console.log(`dulu jatuh ke rata-rata  : ${jatuhSebelum}`);
console.log(`di antaranya diselamatkan: ${diselamatkan}`);
console.log(`yang menang per model    : ${JSON.stringify(perModel)}`);
console.log("");
for (const c of contoh) console.log("  " + c);
await db.end();
