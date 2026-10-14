/**
 * Uji pendeteksi jawaban karangan. `npm run test:palsu`
 *
 * Masukannya kegagalan NYATA yang terekam dari qwen2.5:7b, bukan karangan
 * saya. Yang paling penting bagian "jangan sampai salah tuduh": jawaban benar
 * tidak boleh ikut diblokir.
 */
import { jawabanPalsu } from "../lib/jawaban-palsu.ts";

let lolos = 0, gagal = 0;
const cek = (n: string, ok: boolean, k = "") => {
  if (ok) { lolos++; console.log(`  LOLOS  ${n}`); }
  else { gagal++; console.log(`  GAGAL  ${n}${k ? " — " + k : ""}`); }
};

// --- kegagalan nyata yang harus TERTANGKAP ---
const template = `Berikut adalah 10 karyawan yang paling tua berdasarkan tanggal lahir:
1. Karyawan dengan nama [Nama Karyawan], lahir pada [Tanggal Lahir]
2. Karyawan dengan nama [Nama Karyawan], lahir pada [Tanggal Lahir]
3. Karyawan dengan nama [Nama Karyawan], lahir pada [Tanggal Lahir]
Tabel data karyawan yang Anda miliki berisi 223 karyawan aktif.`;
const v1 = jawabanPalsu(template, false);
cek("template [Nama Karyawan] -> palsu", v1.palsu && v1.sebab === "placeholder", JSON.stringify(v1));

const sqlTeks = `sql
SELECT karyawan.id, karyawan.nik, karyawan.nama, karyawan.tanggal_lahir
FROM karyawan
WHERE karyawan.status_kerja = 'AKTIF'
ORDER BY karyawan.tanggal_lahir ASC
LIMIT 1;

Hasil query ini akan menampilkan data karyawan tertua yang masih aktif kerja.`;
const v2 = jawabanPalsu(sqlTeks, false);
cek("SQL ditulis sebagai teks -> palsu", v2.palsu && v2.sebab === "sql-sebagai-teks", JSON.stringify(v2));

// --- yang TIDAK boleh dituduh ---
cek(
  "jawaban benar dari query -> BUKAN palsu",
  jawabanPalsu("Jumlah karyawan aktif saat ini ada *223 orang* ✅", true).palsu === false,
);
cek(
  "jawaban berisi SQL TAPI query memang jalan -> BUKAN palsu",
  jawabanPalsu("Aku pakai SELECT nama FROM karyawan. Hasilnya 223 orang.", true).palsu === false,
  "kalau query jalan, datanya nyata -- jangan diutak-atik",
);
cek(
  "sapaan biasa -> BUKAN palsu",
  jawabanPalsu("Halo! Ada yang bisa aku bantu soal data HR?", false).palsu === false,
);
cek(
  "penolakan yang benar -> BUKAN palsu",
  jawabanPalsu("Maaf, aku cuma punya akses data HR, bukan data marketing.", false).palsu === false,
);
cek(
  "SATU placeholder saja -> BUKAN palsu",
  jawabanPalsu("Silakan isi [nama lengkap] kamu dulu ya.", false).palsu === false,
  "satu bisa kebetulan; tiga baru pola",
);
cek(
  "menyebut kata SELECT tanpa FROM -> BUKAN palsu",
  jawabanPalsu("Kamu bisa select periode mana saja yang mau dilihat.", false).palsu === false,
);

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
