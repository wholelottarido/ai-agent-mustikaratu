import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const BATAS_MS = Number(process.env.OCR_TIMEOUT_MS ?? 120_000);

/**
 * Di mana berkas bahasa tesseract dicari.
 *
 * KENAPA TIDAK PAKAI BAWAANNYA. Installer Windows cuma memasang `eng` dan
 * `osd` -- bahasa Indonesia TIDAK termasuk. Foldernya ada di
 * "C:\Program Files\Tesseract-OCR\tessdata", dan menulis ke situ perlu hak
 * admin yang tidak selalu ada. Jadi berkas bahasanya ditaruh di home
 * directory, seperti cache model embedding (lihat `env.cacheDir` di
 * voltagent/embedding.ts), lalu ditunjuk lewat `--tessdata-dir`.
 *
 * Isi folder itu disiapkan oleh `npm run pasang:ocr-ind`.
 */
const TESSDATA = process.env.TESSDATA_DIR ?? join(homedir(), ".cache", "tessdata");

/** OCR lokal yang tidak mengirim gambar ke layanan luar. */
export async function ocrTesseract(gambar: Uint8Array, jenis: string): Promise<string> {
  const executable = process.env.TESSERACT_PATH ?? "tesseract";
  /**
   * "ind", bukan "eng". INI HASIL PENGUKURAN, dan hasilnya tidak seperti dugaan
   * awal -- lihat `npm run banding:ocr`.
   *
   * Pada teks yang BERSIH (render tajam, 1100px), dua-duanya sempurna:
   *
   *     -l eng   WER 0,0%      -l ind   WER 0,0%
   *
   * Jadi dugaan "model Inggris pasti merusak kata Indonesia" SALAH untuk kasus
   * itu. Tesseract 5 memakai LSTM yang sudah kuat membaca bentuk huruf; model
   * bahasa cuma dipakai waktu bentuknya ambigu.
   *
   * Bedanya baru muncul waktu gambarnya seperti dokumen NYATA -- foto HP,
   * 495px, agak miring, JPEG mutu 32, ada bercak:
   *
   *     -l eng   WER 73,0%     -l ind   WER 41,3%     (selisih 31,7 poin)
   *
   * Dan polanya persis seperti yang diduga: model Inggris menebak ke kata
   * Inggris terdekat -- "penjualan" jadi "peniualan", "triwulan" jadi "riwulan",
   * "Pemasaran" jadi "peatasaran". Kata yang salah tidak akan cocok dengan
   * pertanyaan user yang ejaannya benar, jadi dokumennya tidak pernah ketemu.
   *
   * ⚠️ Catatan yang sama pentingnya: `ind` pun masih 41% salah di gambar seburuk
   * itu. Memilih bahasa yang benar TIDAK menyelamatkan foto yang jelek. Yang
   * paling menentukan tetap mutu gambar yang diunggah.
   */
  const bahasa = process.env.TESSERACT_LANG ?? "ind";
  const ekstensi = jenis === "image/png" ? "png" : jenis === "image/webp" ? "webp" : "jpg";

  return await new Promise((resolve, reject) => {
    const proses = spawn(executable, ["stdin", "stdout", "--tessdata-dir", TESSDATA, "-l", bahasa, "--psm", "6"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let teks = "";
    let galat = "";
    const timer = setTimeout(() => {
      proses.kill();
      reject(new Error("Tesseract terlalu lama membaca gambar."));
    }, BATAS_MS);
    proses.stdout.setEncoding("utf8");
    proses.stderr.setEncoding("utf8");
    proses.stdout.on("data", (bagian: string) => { teks += bagian; });
    proses.stderr.on("data", (bagian: string) => { galat += bagian; });
    proses.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Tesseract belum tersedia (${executable}). Pasang Tesseract atau isi TESSERACT_PATH. ${e.message}`));
    });
    proses.on("close", (kode) => {
      clearTimeout(timer);
      if (kode !== 0) {
        // Penyebab tersering bukan gambarnya, tapi berkas bahasanya belum ada.
        // Pesan asli tesseract ("Failed loading language 'ind'") tidak memberi
        // tahu apa yang harus dilakukan, jadi ditambahi perintahnya.
        if (/Failed loading language|Could not initialize tesseract/i.test(galat)) {
          reject(new Error(`Berkas bahasa "${bahasa}" belum ada di ${TESSDATA}. Jalankan: npm run pasang:ocr-ind`));
          return;
        }
        reject(new Error(`Tesseract gagal membaca gambar (kode ${kode}). ${galat.trim().slice(0, 180)}`));
      } else {
        resolve(teks.replace(/\r\n/g, "\n").trim());
      }
    });
    proses.stdin.end(Buffer.from(gambar), () => void ekstensi);
  });
}
