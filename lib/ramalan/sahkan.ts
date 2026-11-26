/**
 * `HasilModel` dan `sahkan()` — satu-satunya tempat hasil model diperiksa.
 *
 * ⚠️ DIPISAH DARI `model.ts` 27 Okt 2026, dan sebabnya bukan kerapian.
 * `jarang.ts` memuat lima model dan `model.ts` menyusun daftarnya; kalau
 * `sahkan()` tetap tinggal di `model.ts`, keduanya saling mengimpor pada saat
 * dijalankan. Impor berputar di ESM tidak selalu meledak — ia kadang cuma
 * memulangkan `undefined` di tempat yang jauh dari sebabnya, dan itu jenis
 * kegagalan yang paling lama dicari.
 *
 * Yang TIDAK boleh terjadi: model yang memeriksa hasilnya sendiri. Satu
 * pemeriksa untuk semua model berarti tidak ada model yang bisa lupa.
 */

export type HasilModel =
  | {
      ok: true;
      nilai: number[];
      /**
       * Berapa nilai yang SEMULA negatif lalu dipangkas ke 0.
       *
       * ⚠️ DILAPORKAN, BUKAN DISEMBUNYIKAN. Ramalan penjualan negatif tidak
       * punya arti, jadi yang keluar memang harus 0 — dokumen rencananya
       * menulis "cannot be negative in the final output". Tapi model yang
       * meramal -400 dan model yang meramal 0 TIDAK sama: yang pertama
       * sedang mengekstrapolasi jauh di luar data yang pernah dilihatnya.
       *
       * Angka ini dipakai tahap pemilihan untuk menilai kepercayaan, dan
       * ikut sampai ke pemakai lewat keterangan ramalan.
       */
      dipangkas: number;
    }
  | { ok: false; sebab: string };

/**
 * Memeriksa hasil sebuah model SEBELUM dipulangkan.
 *
 * ⚠️ Dibulatkan DI SINI, dan hanya di sini. Ramalan penjualan dalam pecahan
 * tidak punya arti — tidak ada yang menjual 1.203,7 botol. Tapi pembulatannya
 * dilakukan setelah pemeriksaan, supaya `NaN` tidak diam-diam jadi angka.
 */
export function sahkan(nilai: number[], horizon: number): HasilModel {
  if (nilai.length !== horizon) {
    return { ok: false, sebab: `model memulangkan ${nilai.length} angka, diminta ${horizon}` };
  }
  // ⚠️ `NaN` dan tak hingga DITOLAK sepenuhnya. Itu bukan ramalan yang buruk,
  // itu perhitungan yang gagal — dan tidak ada nilai pengganti yang jujur.
  for (const v of nilai) {
    if (!Number.isFinite(v)) return { ok: false, sebab: "model memulangkan nilai bukan angka" };
  }

  // ⚠️ NEGATIF DIPANGKAS KE 0, TAPI DIHITUNG — dan bedanya dari menolak itu
  // disengaja. Versi pertama berkas ini menolak seluruh hasilnya; itu membuat
  // AutoARIMA mustahil dipakai untuk produk yang penjualannya menurun tajam,
  // padahal di situlah dia paling mungkin berguna. Ramalan -400 untuk produk
  // yang sekarat berarti "mendekati nol", bukan perhitungan yang rusak.
  //
  // Yang tidak boleh adalah memangkasnya DIAM-DIAM: hasil 0,0,0 dari model
  // yang meramal -400,-420,-450 terlihat persis sama dengan hasil 0,0,0 dari
  // model yang memang melihat penjualan berhenti. `dipangkas` yang
  // membedakannya.
  let dipangkas = 0;
  const keluar = nilai.map((v) => {
    if (v < 0) { dipangkas += 1; return 0; }
    return Math.round(v);
  });
  return { ok: true, nilai: keluar, dipangkas };
}

