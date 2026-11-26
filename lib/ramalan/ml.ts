/**
 * Membaca ramalan LightGBM tim sebelah dari `ai_forecast_ml`.
 *
 * ============================================================
 * MODEL MACHINE LEARNING TANPA MENJALANKAN MACHINE LEARNING
 * ============================================================
 * Tabel `ai_forecast_ml` diisi batch training milik tim sebelah
 * (`forecast/train_lgbm.py`, lihat dokumen spesifikasi subsistem forecast
 * mereka §12). Kita tidak melatih apa pun dan tidak menjalankan Python —
 * cukup SELECT. Ditemukan 27 Okt 2026: 770 SKU, ramalan sampai Jul 2027.
 *
 * ============================================================
 * ⚠️ KETEPATANNYA DIHITUNG ULANG, TIDAK DIPERCAYA BEGITU SAJA
 * ============================================================
 * Baris `kind = 'cv'` memuat nilai AKTUAL (`y`) dan PREDIKSI (`yhat`) pada
 * bulan yang sudah terjadi. Jadi ketepatannya bisa kita ukur sendiri — dan
 * itu yang dilakukan di sini, bukan memakai angka WAPE yang mereka laporkan.
 *
 * ⚠️ DIUKUR PADA JENDELA UJI YANG SAMA DENGAN MODEL KITA. Ini bukan detail.
 * Terukur 27 Okt 2026 pada 60 produk terlaris:
 *
 *   memakai WAPE 9 bulan milik mereka  -> LightGBM menang  7 dari 56
 *   diukur ulang pada 3 bulan kita     -> LightGBM menang 16 dari 56
 *
 * Jendela yang lebih panjang lebih sulit, jadi membandingkan WAPE 9 bulan
 * dengan WAPE 3 bulan lalu memilih yang terkecil akan menghukum model yang
 * diuji lebih keras. Angkanya lebih dari dua kali lipat berbeda — cukup untuk
 * mengubah kesimpulan.
 *
 * ⚠️ BULAN UJINYA DATANG DARI PEMANGGIL, dan itu disengaja. Sejak backtest
 * kita memakai beberapa jendela (27 Okt 2026, sore), `tools-ramalan.ts`
 * mengirim SELURUH bulan dari jendela-jendela itu — sembilan bulan, bukan
 * tiga. Berkas ini sengaja tidak menentukan sendiri bulan ujinya supaya
 * tidak ada dua tempat yang bisa berbeda diam-diam.
 *
 * Kebetulan yang membantu: cross-validation mereka memuat TEPAT 9 bulan
 * (2025-11..2026-07) untuk 734 dari 770 SKU — pas tiga jendela. Itu juga yang
 * membatasi `MAKS_JENDELA` kita di 3.
 *
 * ⚠️ Yang TIDAK sama persis: titik potong latihnya. Jendela kita melatih
 * ulang model kita di tiap titik; baris cv mereka memakai titik potong milik
 * mereka sendiri. Jadi ini pendekatan, bukan replikasi — tapi jauh lebih
 * dekat daripada membandingkan jumlah bulan yang berbeda.
 *
 * ============================================================
 * ⚠️ HANYA UNTUK JUMLAH UNIT
 * ============================================================
 * LightGBM mereka dilatih hanya untuk qty (§12.1 dokumen mereka). Memakainya
 * untuk rupiah berarti memakai model untuk sesuatu yang tidak pernah
 * dilatihnya.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";

const SUMBER = "ba_sales";
const MODEL = "LightGBM";

/**
 * Seberapa mirip deret aktual MEREKA dengan deret aktual KITA pada bulan uji.
 *
 * ⚠️ Kalau aktualnya berbeda, WAPE-nya mengukur produk yang berbeda — dan
 * perbandingannya jadi tidak berarti. Mengikuti `ML_MIN_COVERAGE = 0.95`
 * dokumen mereka (§4).
 *
 * Terukur 27 Okt 2026: dari 56 produk yang bisa dibandingkan, cakupannya
 * 100% untuk SEMUANYA — jadi penjagaan ini memang jarang menyala. Tetap
 * dipasang: tabelnya diisi proses milik orang lain yang bisa berubah tanpa
 * pemberitahuan, persis seperti katalog `ai_tool` yang 263 dari 280 barisnya
 * pernah lahir dalam satu malam.
 */
export const MIN_CAKUPAN = 0.95;

export type KandidatMl = {
  /** Ramalan untuk `bulanRamalan`, berurutan. */
  ramalan: number[];
  /** Diukur ulang pada jendela uji kita, memakai aktual KITA. */
  wape: number;
  /** Selisih mutlak per bulan uji — dasar rentang prediksi, sama seperti model kita. */
  galatUji: number[];
  /**
   * Ramalan unit LightGBM untuk tiap bulan uji, berurutan seperti `bulanUji`.
   *
   * ⚠️ BEDA DENGAN `galatUji`, dan keduanya perlu. `galatUji` cuma menyimpan
   * selisih MUTLAK, jadi tandanya hilang: dari situ tidak bisa diketahui
   * LightGBM menebak terlalu tinggi atau terlalu rendah.
   *
   * Dipakai kandidat "unit x harga" di `pilih.ts`: untuk mengukurnya,
   * ramalan unit per bulan uji harus bisa dikalikan harga. Tanpa ruas ini
   * cara itu TIDAK bisa diukur waktu LightGBM yang menang di sisi unit —
   * dan yang tidak terukur tidak boleh dipakai.
   */
  ujiRamal: number[];
  /** Kapan batch training-nya dijalankan. Makin lama, makin perlu disebutkan. */
  dilatih: string | null;
};

export type HasilMl = { ok: true; ml: KandidatMl } | { ok: false; sebab: string };

/**
 * Mengambil kandidat LightGBM untuk satu SKU.
 *
 * `bulanUji` dan `asliUji` adalah jendela backtest KITA beserta nilai aktual
 * KITA. `bulanRamalan` adalah bulan yang akan disajikan ke pemakai.
 *
 * Memulangkan `ok: false` kalau salah satu bulan tidak ada — sebagian data
 * lebih buruk daripada tidak ada, karena ramalan yang bolong akan tampil
 * sebagai tabel yang lengkap.
 */
export async function ambilMl(
  sku: string,
  bulanUji: string[],
  asliUji: number[],
  bulanRamalan: string[],
): Promise<HasilMl> {
  if (bulanUji.length === 0 || bulanRamalan.length === 0) {
    return { ok: false, sebab: "tidak ada bulan uji atau bulan ramalan" };
  }

  const { rows } = await poolPerusahaan().query<{
    kind: string; period: string; y: string | null; yhat: string | null; dibuat: string | null;
  }>(
    `SELECT kind, to_char(period,'YYYY-MM') AS period, y::text, yhat::text,
            to_char(max(created_at) OVER (), 'YYYY-MM-DD') AS dibuat
       FROM ai_forecast_ml
      WHERE model = $1 AND source = $2 AND sku_code = $3`,
    [MODEL, SUMBER, sku],
  );
  if (rows.length === 0) return { ok: false, sebab: "produk ini tidak ada di hasil LightGBM" };

  const cv = new Map<string, { y: number; yhat: number }>();
  const depan = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === "cv" && r.y !== null && r.yhat !== null) {
      cv.set(r.period, { y: Number(r.y), yhat: Number(r.yhat) });
    } else if (r.kind === "forecast" && r.yhat !== null) {
      depan.set(r.period, Number(r.yhat));
    }
  }

  const kurangUji = bulanUji.filter((b) => !cv.has(b));
  if (kurangUji.length > 0) {
    return { ok: false, sebab: `tidak ada hasil uji LightGBM untuk ${kurangUji.join(", ")}` };
  }
  const kurangDepan = bulanRamalan.filter((b) => !depan.has(b));
  if (kurangDepan.length > 0) {
    return { ok: false, sebab: `LightGBM tidak meramal ${kurangDepan.join(", ")}` };
  }

  // Lihat `MIN_CAKUPAN`.
  const totalKita = asliUji.reduce((a, b) => a + Math.abs(b), 0);
  const totalMereka = bulanUji.reduce((t, b) => t + Math.abs(cv.get(b)!.y), 0);
  const besar = Math.max(totalKita, totalMereka);
  const cakupan = besar === 0 ? 1 : Math.min(totalKita, totalMereka) / besar;
  if (cakupan < MIN_CAKUPAN) {
    return {
      ok: false,
      sebab:
        `penjualan nyata yang dipakai LightGBM berbeda ${Math.round((1 - cakupan) * 100)}% dari ` +
        `data kita pada bulan yang sama, jadi ketepatannya tidak bisa dibandingkan`,
    };
  }

  // ⚠️ Dibandingkan dengan aktual KITA, bukan aktual mereka. Kalau memakai
  // aktual mereka, yang terukur adalah seberapa cocok model mereka dengan
  // data mereka sendiri — bukan seberapa benar untuk pertanyaan yang kita
  // jawab.
  const ramalUji = bulanUji.map((b) => cv.get(b)!.yhat);
  const galatUji = asliUji.map((a, i) => Math.abs(ramalUji[i] - a));
  const penyebut = asliUji.reduce((t, a) => t + Math.abs(a), 0);
  if (penyebut === 0) return { ok: false, sebab: "seluruh bulan uji bernilai nol" };
  const wape = (galatUji.reduce((a, b) => a + b, 0) / penyebut) * 100;

  return {
    ok: true,
    ml: {
      ramalan: bulanRamalan.map((b) => Math.max(0, Math.round(depan.get(b)!))),
      wape,
      galatUji,
      ujiRamal: ramalUji,
      dilatih: rows[0]?.dibuat ?? null,
    },
  };
}
