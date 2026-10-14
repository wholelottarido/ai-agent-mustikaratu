/**
 * Kenali jawaban yang MENGARANG data.
 *
 * ⚠️ KENAPA PERLU, padahal sudah ada label "tidak mengambil data dari database"
 *
 * Label itu memberi tahu, tapi tidak menahan. Yang sampai ke user tetap
 * jawaban yang BENTUKNYA meyakinkan. Tiga kegagalan nyata qwen2.5:7b yang
 * terekam 25 Sep 2026:
 *
 *   1. SQL ditulis sebagai teks:
 *      "SELECT karyawan.nik ... Hasil query ini akan menampilkan ..."
 *   2. Template kosong:
 *      "1. Karyawan dengan nama [Nama Karyawan], lahir pada [Tanggal Lahir]"
 *      (10 baris identik, ditutup "berisi 223 karyawan aktif" -- angka yang
 *       diambil dari percakapan sebelumnya, bukan query barusan)
 *   3. Jawaban berbahasa Mandarin.
 *
 * Nomor 2 yang paling berbahaya: kalau dibaca cepat, terlihat seperti data.
 *
 * ⚠️ HANYA DIPAKAI KALAU query_db TIDAK DIPANGGIL.
 *
 * Kalau query memang jalan, jawabannya berasal dari data dan tidak boleh
 * diutak-atik -- termasuk kalau kebetulan memuat contoh SQL. Pemanggil yang
 * memastikan syarat itu.
 *
 * ⚠️ TIDAK dipakai untuk model Claude. Pola ini diukur pada qwen2.5:7b;
 * menerapkannya ke model yang tidak punya masalah cuma menambah risiko
 * menolak jawaban yang benar.
 */

/** Placeholder bergaya `[Nama Karyawan]`, `<tanggal>`, `{{nama}}`. */
const POLA_PLACEHOLDER = /\[[A-Z][^\]\n]{2,30}\]|\{\{[^}\n]{2,30}\}\}/g;

/** SQL yang ditulis sebagai teks, bukan dijalankan. */
const POLA_SQL = /\bSELECT\b[\s\S]{0,400}?\bFROM\b/i;

export type Vonis =
  | { palsu: false }
  | { palsu: true; sebab: "placeholder" | "sql-sebagai-teks" };

/**
 * Jawaban ini mengarang?
 *
 * @param teks Jawaban dari model.
 * @param adaQuery Apakah `query_db` benar-benar dipanggil. Kalau ya, fungsi
 *   ini selalu mengembalikan `palsu: false` -- datanya nyata.
 */
export function jawabanPalsu(teks: string, adaQuery: boolean): Vonis {
  if (adaQuery) return { palsu: false };

  // Satu placeholder bisa saja kebetulan (mis. user diminta mengisi sesuatu).
  // Tiga atau lebih = model sedang mengisi kerangka tabel.
  const placeholder = teks.match(POLA_PLACEHOLDER) ?? [];
  if (placeholder.length >= 3) return { palsu: true, sebab: "placeholder" };

  if (POLA_SQL.test(teks)) return { palsu: true, sebab: "sql-sebagai-teks" };

  return { palsu: false };
}

/** Pesan pengganti. Mengaku gagal, bukan menampilkan karangan. */
export function pesanGagal(sebab: "placeholder" | "sql-sebagai-teks"): string {
  const inti =
    sebab === "sql-sebagai-teks"
      ? "Model lokal cuma menuliskan query-nya, tidak menjalankannya."
      : "Model lokal mengarang bentuk jawabannya tanpa mengambil data.";

  return `${inti} Jadi jawabannya tidak aku tampilkan — isinya bukan data asli.`;
}
