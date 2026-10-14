/**
 * Tool `baca_dokumen` — memberi agent isi dokumen yang diunggah user.
 *
 * ⚠️ TEKSNYA TIDAK PERNAH LEWAT BROWSER.
 *
 * Dokumen dibaca di server waktu diunggah, hasilnya disimpan, dan tool ini
 * mengambilnya langsung dari database. Kalau teks lengkapnya dikirim ke
 * browser lalu disertakan di tiap pertanyaan, satu PDF panjang akan
 * membengkakkan SETIAP permintaan chat sesudahnya.
 *
 * ⚠️ OCR TIDAK terjadi di sini.
 *
 * Membaca gambar butuh beberapa detik sampai semenit; tool selambat itu
 * membuat model menunggu di tengah percakapan, dan kalau gagal, kegagalannya
 * muncul di saat yang membingungkan. Semua pembacaan sudah selesai sebelum
 * user sempat bertanya.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { ambilDokumen, cariDokumenNama, daftarDokumen } from "@/lib/dokumen/simpan";
import type { Pengguna } from "./tools-entri";

/**
 * Batas teks yang dikirim ke model.
 *
 * ⚠️ Perlu: satu PDF 100 halaman bisa 200.000 karakter, jauh melebihi konteks
 * model mana pun yang kita pakai. Dipotong dengan KETERANGAN, bukan diam-diam
 * -- model harus tahu dia cuma melihat sebagian, supaya tidak menyimpulkan
 * "tidak ada di dokumen" padahal ada di bagian yang terpotong.
 */
const MAKS_KARAKTER = 20_000;

export function buatToolDokumen(pengguna: Pengguna) {
  return createTool({
    name: "baca_dokumen",
    description:
      "Ambil isi dokumen (PDF/gambar) yang diunggah user di percakapan ini. " +
      "⚠️ KALAU USER MELAMPIRKAN LEBIH DARI SATU DOKUMEN, panggil tool ini " +
      "SEKALI UNTUK TIAP DOKUMEN, dan SELALU isi `nama` dengan nama berkas " +
      "persis seperti tertulis di '[Dokumen terlampir: ...]'. " +
      "Tanpa `nama`, yang dikembalikan selalu dokumen yang paling baru — " +
      "jadi memanggil berulang kali tanpa `nama` akan memberi dokumen yang " +
      "SAMA terus. Dokumennya sudah dibaca sebelumnya, jadi tool ini cepat.",
    parameters: z.object({
      nama: z
        .string()
        .optional()
        .describe(
          "Nama berkas persis seperti di '[Dokumen terlampir: ...]'. " +
            "WAJIB diisi kalau dokumen yang dilampirkan lebih dari satu.",
        ),
      id: z.string().optional().describe("id dokumen, kalau kebetulan diketahui."),
    }),
    execute: async ({ nama, id }) => {
      const dok = id
        ? await ambilDokumen(pengguna.id, id)
        : nama
          ? await cariDokumenNama(pengguna.id, nama)
          : (await daftarDokumen(pengguna.id, 1))[0];

      if (!dok) {
        const lain = await daftarDokumen(pengguna.id, 10);
        if (lain.length === 0) {
          return (
            "BELUM ADA DOKUMEN yang diunggah user ini.\n\n" +
            "Sampaikan ke user: klik tombol lampiran di kolom chat untuk " +
            "mengunggah PDF atau gambar lebih dulu. JANGAN mengarang isi dokumen."
          );
        }
        return (
          `Tidak ada dokumen bernama "${nama ?? id}". Yang tersedia:\n` +
          lain.map((d) => `- ${d.nama}`).join("\n") +
          "\n\nPanggil lagi dengan `nama` yang persis seperti salah satu di atas."
        );
      }

      if (dok.teks.length === 0) {
        return (
          `Dokumen "${dok.nama}" terbaca, tapi TIDAK ADA TEKS di dalamnya.\n\n` +
          "Sampaikan itu apa adanya ke user. JANGAN menebak isinya dari nama berkas."
        );
      }

      const potong = dok.teks.length > MAKS_KARAKTER;
      const teks = potong ? dok.teks.slice(0, MAKS_KARAKTER) : dok.teks;

      const cara =
        dok.cara === "ocr-claude"
          ? "pembacaan gambar di layanan cloud"
          : dok.cara === "ocr-lokal"
            ? "pembacaan gambar di komputer ini"
            : "teks tertanam";

      const bagian = [
        `Dokumen: ${dok.nama}` +
          (dok.halaman ? ` (${dok.halaman} halaman)` : "") +
          `, dibaca lewat ${cara}.`,
      ];

      if (dok.cara.startsWith("ocr")) {
        // ⚠️ Model HARUS tahu ini hasil OCR. Angka dan nama dari OCR bisa
        // salah baca, dan jawaban yang menyebutkannya sebagai fakta pasti
        // lebih berbahaya daripada jawaban yang menyebut ketidakpastiannya.
        bagian.push(
          "⚠️ Isi ini hasil pembacaan gambar (OCR), jadi angka dan nama BISA " +
            "salah baca. Kalau user menanyakan angka penting, sarankan dia " +
            "memeriksa ulang ke dokumen aslinya.",
        );
      }

      if (potong) {
        bagian.push(
          `⚠️ DIPOTONG: dokumen ini ${dok.teks.length} karakter, yang ditampilkan ` +
            `${MAKS_KARAKTER} pertama. Kalau yang dicari user tidak ada di bagian ini, ` +
            "bilang mungkin ada di bagian yang belum terbaca — JANGAN bilang tidak ada.",
        );
      }

      bagian.push(`--- isi dokumen ---\n${teks}`);
      return bagian.join("\n\n");
    },
  });
}
