/**
 * Membaca isi dokumen yang diunggah: PDF, PNG, JPG.
 *
 * ⚠️ URUTANNYA PENTING: teks tertanam DULU, OCR belakangan.
 *
 * Diukur pada dokumen nyata (panduan Supertools, 4 halaman, 30 Sep 2026):
 *
 *     ambil teks tertanam : 320 ms, akurat 100%
 *     OCR granite         : ~63 detik PER HALAMAN, bisa salah baca
 *
 * Selisihnya 700x. PDF yang diekspor dari sistem — invoice, laporan, panduan
 * — hampir selalu punya teks tertanam, jadi OCR untuk berkas seperti itu
 * bukan cuma lambat, tapi MENURUNKAN akurasi.
 *
 * Makanya OCR di sini cuma dipakai untuk yang memang tidak punya teks:
 * gambar, foto, hasil scan.
 */
import { extractText, getDocumentProxy } from "unpdf";
import { ocrGambar, pakaiCloud, type CaraOcr } from "./ocr";
export { pakaiCloud };

/** Jenis berkas yang diterima. Selain ini ditolak sebelum dibaca. */
export const JENIS_DITERIMA = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const UKURAN_MAKS = Number(process.env.DOKUMEN_UKURAN_MAKS ?? 15 * 1024 * 1024);

/**
 * Ambang "PDF ini sebenarnya hasil scan".
 *
 * PDF hasil scan tetap punya lapisan teks kosong atau nyaris kosong. Kalau
 * seluruh dokumen menghasilkan kurang dari sekian karakter per halaman,
 * anggap teksnya tidak ada — bukan dokumen yang memang pendek.
 */
const MIN_KARAKTER_PER_HALAMAN = 40;

export type HasilBaca =
  | {
      ok: true;
      teks: string;
      cara: "teks-tertanam" | CaraOcr;
      halaman?: number;
      detik: number;
      catatan?: string;
    }
  | { ok: false; pesan: string };

/**
 * Baca satu dokumen dan kembalikan teksnya.
 *
 * Tidak pernah melempar. Semua kegagalan yang mungkin terjadi di sini adalah
 * keadaan wajar — berkas rusak, PDF hasil scan, Ollama mati, RAM penuh — dan
 * user berhak dapat kalimat yang bisa dimengerti.
 */
export async function bacaDokumen(
  isi: Uint8Array,
  jenis: string,
): Promise<HasilBaca> {
  if (isi.byteLength > UKURAN_MAKS) {
    return {
      ok: false,
      pesan: `Berkas terlalu besar (maksimal ${Math.round(UKURAN_MAKS / 1024 / 1024)} MB).`,
    };
  }
  if (!(JENIS_DITERIMA as readonly string[]).includes(jenis)) {
    return { ok: false, pesan: `Jenis berkas ${jenis || "(tidak dikenal)"} belum didukung. Kirim PDF, PNG, atau JPG.` };
  }

  if (jenis === "application/pdf") return await bacaPdf(isi);

  const h = await ocrGambar(isi, jenis);
  if (!h.ok) return { ok: false, pesan: h.pesan };
  if (h.teks === "") {
    return {
      ok: true, teks: "", cara: h.cara, detik: h.detik,
      catatan: "Tidak ada teks yang terbaca di gambar ini.",
    };
  }
  return { ok: true, teks: h.teks, cara: h.cara, detik: h.detik };
}

async function bacaPdf(isi: Uint8Array): Promise<HasilBaca> {
  const mulai = Date.now();
  let halaman: number;
  let teks: string;
  try {
    const pdf = await getDocumentProxy(isi);
    try {
      const hasil = await extractText(pdf, { mergePages: true });
      halaman = hasil.totalPages;
      teks = String(hasil.text ?? "").trim();
    } finally {
      // ⚠️ WAJIB. pdfjs meninggalkan handle terbuka kalau dokumennya
      // tidak ditutup, dan proses Node yang keluar dengan handle itu masih
      // hidup crash di Windows:
      //
      //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
      //
      // Akibatnya `npm run test:dokumen` MELAPORKAN 13/13 lolos tapi keluar
      // dengan kode 127 -- tes yang kelihatan hijau padahal menjatuhkan
      // gerbang mana pun yang memeriksa kode keluar.
      // `PDFDocumentProxy` tidak punya `destroy()` -- yang memutus worker
      // adalah `loadingTask.destroy()`. Diperiksa langsung di objeknya,
      // bukan dari tipe: `destroy` undefined, `loadingTask` ada.
      await pdf.loadingTask?.destroy().catch(() => {});
    }
  } catch (e) {
    return {
      ok: false,
      pesan: `PDF tidak bisa dibaca: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const cukup = teks.length >= MIN_KARAKTER_PER_HALAMAN * Math.max(1, halaman);
  if (cukup) {
    return { ok: true, teks, cara: "teks-tertanam", halaman, detik: (Date.now() - mulai) / 1000 };
  }

  // ⚠️ PDF HASIL SCAN BELUM DIDUKUNG, dan itu disebut apa adanya.
  //
  // Untuk meng-OCR-nya, tiap halaman harus dirender jadi gambar dulu — dan
  // itu butuh pustaka canvas tambahan (@napi-rs/canvas atau sejenisnya).
  // Belum dipasang, jadi lebih baik user tahu persis kenapa daripada dapat
  // hasil kosong tanpa penjelasan.
  return {
    ok: false,
    pesan:
      `PDF ini sepertinya hasil scan — tidak ada teks yang bisa diambil ` +
      `(${teks.length} karakter dari ${halaman} halaman). ` +
      "Membaca PDF hasil scan belum didukung. " +
      "Kalau isinya penting, kirim sebagai gambar (PNG/JPG) per halaman.",
  };
}
