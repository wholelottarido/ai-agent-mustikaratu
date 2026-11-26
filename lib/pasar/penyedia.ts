/**
 * Antarmuka penyedia pencarian — dan bentuk hasil yang sudah dinormalkan.
 *
 * ============================================================
 * KENAPA ADA ANTARMUKA, BUKAN LANGSUNG TAVILY
 * ============================================================
 * Dokumen Phase 2 §4 memintanya supaya penyedia lain bisa menyusul (Brave,
 * Google Trends) tanpa menyentuh tool. Tapi alasan yang lebih mendesak hari
 * ini: antarmuka ini membuat SELURUH jalur bisa diuji tanpa kunci API dan
 * tanpa menyentuh internet. Penyedia palsu di uji memakai tipe yang sama
 * persis dengan Tavily, jadi yang diuji memang jalur yang dipakai produksi.
 *
 * ⚠️ Tipe di sini sengaja TIDAK memuat apa pun dari basis data perusahaan.
 * Yang masuk cuma teks kueri yang sudah lewat `kueri.ts`; yang keluar cuma
 * apa yang memang ada di internet.
 */

/** Satu permintaan ke penyedia. `kueri` sudah bersih dan sudah diperiksa. */
export type PermintaanCari = {
  kueri: string;
  /** Berapa hasil paling banyak. Dibatasi pemanggil, dihormati penyedia. */
  maksHasil: number;
  /** Hanya ambil yang terbit dalam sekian hari terakhir. 0 = tanpa batas. */
  hariKeBelakang: number;
};

/** Satu hasil mentah dari penyedia, sudah diseragamkan bentuknya. */
export type HasilMentah = {
  judul: string;
  url: string;
  cuplikan: string;
  /**
   * Tanggal terbit menurut penyedia, `YYYY-MM-DD`.
   *
   * ⚠️ `null` KALAU TIDAK ADA, tidak pernah ditebak. §8 dokumennya menulisnya
   * eksplisit: "Never invent publication dates. If the date is missing,
   * return `null` and mark the result as undated." Tanggal karangan membuat
   * sumber lama terlihat mutakhir, dan itu jenis kesalahan yang dipakai orang
   * untuk mengambil keputusan.
   */
  terbit: string | null;
  /** Skor relevansi milik penyedia, kalau ada. Bukan ukuran kebenaran. */
  skor: number | null;
};

export type HasilCari =
  | { ok: true; hasil: HasilMentah[]; diambilPada: string }
  | { ok: false; sebab: string; bisaDiulang: boolean };

export interface PenyediaCari {
  /** Nama penyedia, untuk pencatatan dan pesan galat. */
  readonly nama: string;
  cari(p: PermintaanCari): Promise<HasilCari>;
}

/** Waktu sekarang dalam `YYYY-MM-DD`, zona waktu lokal. */
export function hariIni(d = new Date()): string {
  const b = String(d.getMonth() + 1).padStart(2, "0");
  const t = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${b}-${t}`;
}
