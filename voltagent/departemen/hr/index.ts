import type { KonfigDepartemen } from "../tipe";
import { KAMUS_DATA, KAMUS_DATA_KEPALA } from "./kamus-data";

export const HR: KonfigDepartemen = {
  id: "hr",
  label: "HR",
  tujuan: "Menjawab pertanyaan departemen HR dari data kepegawaian.",

  db: {
    nama: "hr",
    awalanEnv: "HR",
    // Kepala HR memakai user MySQL yang boleh membaca kolom gaji.
    // Pembatasannya ada di GRANT (db/hr/01_create_readonly_user.sql),
    // bukan di prompt -- staf yang nekat query gaji ditolak MySQL.
    awalanEnvPeran: { kepala: "HR_KEPALA" },
  },

  konteks:
    "Kamu asisten data untuk departemen HR sebuah perusahaan kosmetik & jamu\n" +
    "dengan sekitar 223 karyawan aktif di 12 departemen dan 6 lokasi kerja.",

  // Cuma KEPALA yang boleh mencatat lembur: menghitung `nilai_rp` menuntut
  // baca `gaji_pokok`, dan staf HR memang tidak boleh melihatnya. Staf nanti
  // dapat `pelamar`, yang tidak menyentuh gaji sama sekali.
  entri: [
    { entitas: "lembur", peran: ["kepala"] },
    // Staf: pelamar. Tidak menyentuh gaji sama sekali -- itu alasan entitas
    // ini yang dipilih untuk peran yang memang tidak boleh melihat gaji.
    { entitas: "pelamar", peran: ["staf"] },
  ],

  // Cuti SENGAJA tidak masuk sini: di data, cuti disetujui ATASAN LANGSUNG
  // pemohon (458 dari 465 baris), bukan kepala HR -- dan `cuti.approver_id`
  // menuntut id karyawan, sementara `portal.pengguna` tidak punya kaitan apa
  // pun ke `hr.karyawan`. Lihat catatan di CLAUDE.md.
  persetujuan: [{ entitas: "lembur", peran: ["kepala"] }],

  kamusData: KAMUS_DATA,
  kamusDataPeran: { kepala: KAMUS_DATA_KEPALA },

  contohPertanyaan: [
    "Berapa jumlah karyawan aktif per departemen?",
    "Siapa yang paling sering terlambat bulan ini?",
    "Kenapa karyawan resign tahun ini?",
    "Bagaimana sebaran rating penilaian kinerja?",
  ],

  /**
   * SENGAJA KOSONG -- tidak memasang tool `cari_teks` untuk HR.
   *
   * Diukur 24 Sep 2026: 8 kolom teks HR berisi 3.004 baris tapi cuma
   * 104 kalimat berbeda (3% ragam). `lembur.alasan` cuma 9 kalimat dari
   * 585 baris. Untuk data seperti ini `GROUP BY` memberi jawaban LENGKAP
   * dan PERSIS, sedangkan pencarian makna cuma memberi perkiraan top-k
   * dengan presisi ~66% -- jelas lebih buruk.
   *
   * Pembanding: marketing punya 41% ragam setelah datanya diperbaiki.
   *
   * Kalau data teks HR nanti jadi lebih variatif, isi kolom ini lalu
   * jalankan `npm run index:teks -- hr`. Tool-nya otomatis terpasang.
   */
  kolomTeks: [],
};
