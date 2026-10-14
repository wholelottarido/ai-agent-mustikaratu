/**
 * Bandingkan OCR model Inggris vs model Indonesia pada gambar yang SAMA.
 *
 *   npm run banding:ocr -- <gambar.png> <kunci-jawaban.txt>
 *
 * Kenapa ini diukur, bukan diasumsikan: klaim "model Inggris bikin OCR
 * Indonesia melenceng" terdengar masuk akal, dan itu justru alasan untuk
 * membuktikannya. Kalau selisihnya ternyata nol, berkas bahasa 8 MB dan
 * skrip pemasangannya tidak perlu ada.
 *
 * Yang dihitung Word Error Rate: berapa persen kata yang salah dibanding
 * kunci jawaban. Bukan kemiripan huruf -- yang menentukan dokumen ketemu atau
 * tidak waktu dicari adalah KATA-nya utuh atau tidak.
 */
import { readFile } from "node:fs/promises";
import { ocrTesseract } from "../lib/dokumen/ocr-tesseract.ts";

const [gambar, kunciJalur] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
if (!gambar || !kunciJalur) {
  console.error("Pakai: npm run banding:ocr -- <gambar.png> <kunci.txt>");
  process.exit(1);
}

const isi = new Uint8Array(await readFile(gambar));
const kunci = (await readFile(kunciJalur, "utf8")).trim();

const kata = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Jarak edit per KATA (Levenshtein), bukan per huruf. */
function jarak(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const kataKunci = kata(kunci);
console.log(`gambar : ${gambar}`);
console.log(`kunci  : ${kataKunci.length} kata\n`);

const hasil: Record<string, { wer: number; teks: string }> = {};
for (const bahasa of ["eng", "ind"]) {
  process.env.TESSERACT_LANG = bahasa;
  const mulai = Date.now();
  const teks = await ocrTesseract(isi, "image/png");
  const lama = Date.now() - mulai;
  const kataHasil = kata(teks);
  const wer = (jarak(kataKunci, kataHasil) / kataKunci.length) * 100;
  hasil[bahasa] = { wer, teks };
  console.log(`-l ${bahasa}  WER ${wer.toFixed(1)}%  (${kataHasil.length} kata, ${lama} ms)`);
}

// ---- kata mana yang berbeda ----
const setKunci = new Set(kataKunci);
const salah = (b: string) => kata(hasil[b].teks).filter((k) => !setKunci.has(k));
console.log(`\nkata yang TIDAK ada di kunci:`);
for (const bahasa of ["eng", "ind"]) {
  const s = salah(bahasa);
  console.log(`  ${bahasa}: ${s.length ? s.join(", ") : "(tidak ada)"}`);
}

const selisih = hasil.eng.wer - hasil.ind.wer;
console.log(
  `\nselisih: ${selisih > 0 ? "ind LEBIH BAIK" : selisih < 0 ? "eng lebih baik" : "sama"} ` +
    `${Math.abs(selisih).toFixed(1)} poin WER`,
);
