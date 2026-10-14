/**
 * Ambil nama tabel dari SQL yang BENAR-BENAR dijalankan agent.
 *
 * Kenapa diurai dari SQL, bukan minta agent menyebutkan sendiri di jawabannya:
 * agent bisa salah sebut -- menulis "dari sales_order" padahal yang dia query
 * tabel lain. SQL yang sudah lewat validator dan dieksekusi tidak bisa bohong.
 *
 * Dipakai di klien (mengurai dari tool call) dan di server (tidak ada
 * dependensi Node/DB, jadi aman di dua-duanya).
 */

/**
 * Kata setelah FROM/JOIN yang BUKAN nama tabel. Tanpa daftar ini,
 * `FROM (SELECT ...) t` dan sejenisnya ikut terbaca sebagai tabel.
 */
const BUKAN_TABEL = new Set([
  "select",
  "lateral",
  "unnest",
  "dual",
]);

/**
 * Nama tabel muncul setelah FROM atau JOIN. Backtick opsional, dan nama
 * boleh berkualifikasi database (`hr.karyawan`).
 */
const POLA = /\b(?:FROM|JOIN)\s+(`?)([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\1/gi;

/**
 * Daftar tabel unik dari satu atau beberapa query, urut sesuai kemunculan.
 *
 * `information_schema` sengaja dibuang: itu metadata skema, bukan data yang
 * menjawab pertanyaan user -- menyebutkannya cuma bikin bingung.
 */
export function tabelDariSql(sql: string | string[]): string[] {
  const semua = Array.isArray(sql) ? sql : [sql];
  const hasil: string[] = [];

  for (const s of semua) {
    if (!s) continue;
    for (const m of s.matchAll(POLA)) {
      let nama = m[2];

      // Buang kualifikasi database: `marketing.produk` -> `produk`.
      const titik = nama.indexOf(".");
      if (titik !== -1) {
        if (nama.slice(0, titik).toLowerCase() === "information_schema") continue;
        nama = nama.slice(titik + 1);
      }

      const kecil = nama.toLowerCase();
      if (BUKAN_TABEL.has(kecil)) continue;
      if (kecil.startsWith("information_schema")) continue;
      if (!hasil.includes(nama)) hasil.push(nama);
    }
  }
  return hasil;
}
