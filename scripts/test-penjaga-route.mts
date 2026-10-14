/**
 * Tiap pintu masuk API harus berpenjaga.
 *
 *   npm run test:penjaga
 *
 * Tidak menyentuh database dan tidak perlu server hidup — ini pembacaan
 * berkas, bukan permintaan HTTP.
 *
 * ============================================================
 * KENAPA UJI INI ADA
 * ============================================================
 * Portal ini TIDAK punya `middleware.ts`. Penjagaan sesi ditulis di tiap
 * route, dan itu pilihan sadar: penjagaan yang ditulis di tiap pintu lebih
 * sulit lupa daripada satu daftar pola yang gampang meleset.
 *
 * Tapi "lebih sulit lupa" bukan "tidak mungkin lupa". Audit manual 8 Okt 2026
 * menemukan 20 dari 21 route berpenjaga dan satu sengaja terbuka — hasil yang
 * bersih, TAPI bersandar pada seseorang yang ingat memeriksanya. Satu route
 * baru yang ditambah terburu-buru akan lolos tanpa ada yang menegur.
 *
 * Uji ini mengubah kedisiplinan itu jadi pemeriksaan.
 *
 * ⚠️ MEMBACA BERKAS, BUKAN MENJALANKANNYA. Pembacaan teks bisa keliru kalau
 * penjagaannya ditulis dengan cara yang tidak terduga — tapi arah kelirunya
 * aman: route berpenjaga yang tidak terbaca akan GAGAL di sini dan dilihat
 * manusia, bukan lolos diam-diam.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

/**
 * Cara sebuah route boleh menyatakan penjagaannya.
 *
 * Bukan daftar nama fungsi sembarangan: tiap satunya BENAR-BENAR membaca
 * sesi dan menolak yang tidak punya. Menambah nama ke sini tanpa itu akan
 * membuat uji ini menyetujui route yang terbuka.
 */
const PENJAGA = ["sesiAtau401", "timItAtauTolak", "bacaToken", "NAMA_COOKIE"];

/**
 * Route yang SENGAJA terbuka, beserta alasannya.
 *
 * ⚠️ DIKECUALIKAN SATU PER SATU DENGAN NAMA, bukan dengan melonggarkan
 * syaratnya. "Boleh ada beberapa yang terbuka" akan membuat pintu terbuka
 * BERIKUTNYA lolos tanpa ada yang tahu — pola kekeliruan yang sudah terjadi
 * dua kali di proyek ini.
 */
const TERBUKA: Record<string, string> = {
  "daftar": "pendaftaran akun baru — orang yang belum punya akun tidak bisa login dulu; dibatasi per IP dan tidak langsung membuat akun",
};

const AKAR = join(process.cwd(), "app", "api");

async function semuaRoute(dir: string): Promise<string[]> {
  const isi = await readdir(dir, { withFileTypes: true });
  const hasil: string[] = [];
  for (const x of isi) {
    const p = join(dir, x.name);
    if (x.isDirectory()) hasil.push(...(await semuaRoute(p)));
    else if (x.name === "route.ts") hasil.push(p);
  }
  return hasil;
}

const berkas = await semuaRoute(AKAR);
console.log(`${berkas.length} pintu masuk ditemukan\n`);
cek("ada route yang ditemukan", berkas.length > 0, `${berkas.length} berkas`);

const terbukaTakTerpakai = new Set(Object.keys(TERBUKA));
const tanpaPenjaga: string[] = [];

for (const b of berkas) {
  const nama = b.slice(AKAR.length + 1).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
  const isi = await readFile(b, "utf8");
  const berpenjaga = PENJAGA.some((p) => isi.includes(p));
  const sengaja = nama in TERBUKA;
  terbukaTakTerpakai.delete(nama);

  if (berpenjaga && sengaja) {
    // Keadaan yang membingungkan: terdaftar terbuka TAPI berpenjaga. Salah
    // satunya usang, dan membiarkannya berarti daftar pengecualian perlahan
    // berisi hal yang tidak lagi benar.
    cek(`${nama}`, false, "terdaftar SENGAJA TERBUKA tapi ternyata berpenjaga — hapus dari daftar TERBUKA");
  } else if (berpenjaga) {
    lolos++;
  } else if (sengaja) {
    console.log(`  TERBUKA (sengaja)  ${nama}`);
    console.log(`     ${TERBUKA[nama]}`);
    lolos++;
  } else {
    tanpaPenjaga.push(nama);
  }
}

console.log(`\n${berkas.length - tanpaPenjaga.length - Object.keys(TERBUKA).length} route berpenjaga, ${Object.keys(TERBUKA).length} sengaja terbuka\n`);

cek(
  "tidak ada pintu masuk tanpa penjaga",
  tanpaPenjaga.length === 0,
  tanpaPenjaga.length === 0 ? "bersih" : `TERBUKA TANPA ALASAN: ${tanpaPenjaga.join(", ")}`,
);

// Daftar pengecualian yang menunjuk route yang sudah tidak ada ikut dibersihkan:
// pengecualian basi adalah izin yang menganggur, dan suatu saat nama itu bisa
// dipakai ulang oleh route baru yang justru perlu dijaga.
cek(
  "daftar pengecualian tidak memuat route yang sudah hilang",
  terbukaTakTerpakai.size === 0,
  terbukaTakTerpakai.size === 0 ? "bersih" : `tidak ada lagi: ${[...terbukaTakTerpakai].join(", ")}`,
);

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
