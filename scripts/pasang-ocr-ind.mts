/**
 * Pasang berkas bahasa Indonesia untuk OCR.
 *
 *   npm run pasang:ocr-ind
 *
 * ============================================================
 * KENAPA SKRIP INI ADA
 * ============================================================
 * Installer Tesseract untuk Windows cuma membawa `eng` dan `osd`. Bahasa
 * Indonesia harus diunduh sendiri -- dan kalau tidak diunduh, OCR TIDAK GAGAL.
 * Dia tetap jalan dengan model Inggris dan tetap mengeluarkan teks. Teks itu
 * lalu di-embed dan disimpan, dan tidak ada satu pun galat yang muncul.
 *
 * Yang kelihatan ke user cuma: dokumen penjualan yang sudah diunggah tidak
 * pernah ketemu waktu dicari. Karena di database isinya "Penjuaian Triwuian",
 * sementara yang dicari "penjualan triwulan".
 *
 * Berkasnya ditaruh di home directory, BUKAN di
 * "C:\Program Files\Tesseract-OCR\tessdata" -- menulis ke situ perlu hak admin
 * yang tidak selalu ada, dan foldernya hilang kalau Tesseract di-uninstall.
 * Polanya sama dengan cache model embedding (`env.cacheDir`).
 *
 * `eng` dan `osd` ikut disalin dari folder installer, karena `--tessdata-dir`
 * MENGGANTI jalur pencarian, bukan menambah. Tanpa disalin, `-l eng` yang tadinya
 * jalan jadi mati.
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Varian `tessdata` biasa, bukan `_fast` atau `_best`. */
const SUMBER = "https://github.com/tesseract-ocr/tessdata/raw/main/ind.traineddata";

/**
 * Ukuran minimal yang masuk akal (8,3 MB waktu ditulis).
 *
 * Yang dijaga bukan ketepatan ukurannya, tapi kasus unduhan yang "berhasil"
 * padahal isinya halaman galat HTML dari proxy kantor -- beberapa KB, tersimpan
 * rapi, lalu tesseract gagal dengan pesan yang tidak nyambung.
 */
const MINIMAL_BITA = 4 * 1024 * 1024;

const TESSDATA = process.env.TESSDATA_DIR ?? join(homedir(), ".cache", "tessdata");

async function ada(berkas: string): Promise<number> {
  try {
    return (await stat(berkas)).size;
  } catch {
    return 0;
  }
}

console.log(`folder bahasa : ${TESSDATA}`);
await mkdir(TESSDATA, { recursive: true });

// ---- 1. salin bahasa yang sudah ada dari folder installer ----
const exe = process.env.TESSERACT_PATH ?? "tesseract";
const folderInstaller = exe.includes("tesseract") && exe !== "tesseract" ? join(dirname(exe), "tessdata") : "";
for (const nama of ["eng.traineddata", "osd.traineddata"]) {
  const tujuan = join(TESSDATA, nama);
  if (await ada(tujuan)) {
    console.log(`  sudah ada   ${nama}`);
    continue;
  }
  if (!folderInstaller) {
    console.log(`  dilewati    ${nama} (TESSERACT_PATH belum diisi, folder installer tidak diketahui)`);
    continue;
  }
  try {
    await copyFile(join(folderInstaller, nama), tujuan);
    console.log(`  disalin     ${nama}`);
  } catch (e) {
    console.log(`  gagal salin ${nama} — ${e instanceof Error ? e.message : e}`);
  }
}

// ---- 2. unduh bahasa Indonesia ----
const indonesia = join(TESSDATA, "ind.traineddata");
const ukuran = await ada(indonesia);
if (ukuran >= MINIMAL_BITA) {
  console.log(`  sudah ada   ind.traineddata (${(ukuran / 1024 / 1024).toFixed(1)} MB)`);
} else {
  if (ukuran) console.log(`  ind.traineddata ada tapi cuma ${ukuran} bita — diunduh ulang`);
  console.log(`  mengunduh   ${SUMBER}`);
  const r = await fetch(SUMBER);
  if (!r.ok) throw new Error(`Unduhan gagal: HTTP ${r.status} ${r.statusText}`);
  const isi = new Uint8Array(await r.arrayBuffer());
  if (isi.byteLength < MINIMAL_BITA) {
    throw new Error(
      `Yang terunduh cuma ${isi.byteLength} bita, bukan berkas bahasa. ` +
        "Kemungkinan jaringan menyisipkan halaman lain. Unduh manual dari " +
        SUMBER,
    );
  }
  await writeFile(indonesia, isi);
  console.log(`  tersimpan   ind.traineddata (${(isi.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

// ---- 3. buktikan tesseract benar-benar melihatnya ----
// Berkas yang ADA di folder belum berarti TERBACA: versi berkas bisa tidak
// cocok dengan versi tesseract, dan itu baru kelihatan waktu dipanggil.
const daftar = await new Promise<string>((resolve, reject) => {
  const p = spawn(exe, ["--tessdata-dir", TESSDATA, "--list-langs"], { windowsHide: true });
  let keluar = "";
  p.stdout.on("data", (b) => (keluar += b));
  p.stderr.on("data", (b) => (keluar += b));
  p.on("error", (e) => reject(new Error(`Tesseract tidak bisa dijalankan (${exe}). ${e.message}`)));
  p.on("close", () => resolve(keluar));
});

const bahasa = daftar
  .split(/\r?\n/)
  .map((x) => x.trim())
  .filter((x) => /^[a-z_]{3,}$/.test(x));
console.log(`\nterbaca tesseract: ${bahasa.join(", ") || "(tidak ada)"}`);

if (!bahasa.includes("ind")) {
  console.error('\n⛔ "ind" belum terbaca. Jangan jalankan unggahan gambar dulu —');
  console.error("   OCR akan diam-diam memakai model Inggris.");
  process.exitCode = 1;
} else {
  console.log("\n✅ Siap. Isi TESSERACT_LANG=ind di .env.local (atau kosongkan — bawaannya sudah ind).");
}
