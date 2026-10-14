import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { awalanPassage, embed, LABEL_MODEL_EMBEDDING } from "@/voltagent/embedding";
import { bacaPdfPerHalaman } from "@/lib/kb/pdf";
import { ocrTesseract } from "@/lib/dokumen/ocr-tesseract";
import { poolKnowledgeIngest } from "@/lib/db-knowledge-ingest";

const DIREKTORI = join(process.cwd(), "data", "knowledge-files");
const UKURAN_MAKS = Number(process.env.DOKUMEN_UKURAN_MAKS ?? 15 * 1024 * 1024);
const UKURAN_POTONGAN = 1400;

/**
 * Berapa huruf dari ekor potongan sebelumnya yang diulang di potongan
 * berikutnya.
 *
 * ⚠️ TANPA INI, FAKTA YANG TERBELAH DI BATAS POTONGAN HILANG DARI DUA-DUANYA.
 *
 * Potongan dipotong di tengah kalimat atau di tengah tabel. Kalimat
 * "Agustus 2025 omzetnya Rp 3.138.274.600" yang separuhnya di potongan 2 dan
 * separuhnya di potongan 3 tidak akan cocok dengan pertanyaan mana pun: vektor
 * potongan 2 tidak memuat angkanya, vektor potongan 3 tidak memuat bulannya.
 * Tidak ada galat -- dokumennya tersimpan lengkap, cuma faktanya tidak bisa
 * ditemukan.
 *
 * Pada laporan penjualan 2025 batas potongan jatuh persis di tengah tabel
 * (baris 22/23, 43/44, 64/65 pada halaman detail), jadi barisan yang kebetulan
 * di perbatasan kehilangan baris header di atasnya.
 *
 * Angka 1.400 + 200 mengikuti pipeline tim lain supaya korpus kita dan korpus
 * mereka berperilaku sama waktu dicari bersamaan (lihat "Angka & pengaturan"
 * di dokumen Alur Ratu AI Multi-Agent). Sebelumnya kita 1.800 tanpa tumpang.
 */
const TUMPANG = 200;

export type HasilUnggah = { id: string; judul: string; jumlahPotongan: number; cara: string };

/**
 * Potong teks satu halaman jadi beberapa bagian yang saling tumpang tindih.
 *
 * Nomor baris ikut mundur sebanyak baris yang diulang, supaya rujukan
 * "halaman 3, baris 21-43" benar-benar menunjuk isi potongan itu -- termasuk
 * bagian yang diulang dari potongan sebelumnya.
 */
function potong(teks: string, halaman: number): Array<Record<string, unknown>> {
  const baris = teks.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const hasil: Array<Record<string, unknown>> = [];
  let isi = "";
  let awal = 1;
  for (let i = 0; i < baris.length; i++) {
    const berikut = isi ? `${isi}\n${baris[i]}` : baris[i];
    if (isi && berikut.length > UKURAN_POTONGAN) {
      hasil.push({ content: isi, page_start: halaman, page_end: halaman, line_start: awal, line_end: i });

      // Ambil baris-baris terakhir dari potongan yang baru ditutup, sebanyak
      // yang muat dalam TUMPANG huruf. Dihitung per BARIS, bukan dipotong di
      // tengah huruf: setengah baris tabel tidak berguna untuk siapa pun.
      const sudah = isi.split("\n");
      const ekor: string[] = [];
      let panjang = 0;
      for (let j = sudah.length - 1; j >= 0; j--) {
        if (panjang + sudah[j].length > TUMPANG) break;
        ekor.unshift(sudah[j]);
        panjang += sudah[j].length + 1;
      }

      isi = [...ekor, baris[i]].join("\n");
      awal = i + 1 - ekor.length;
    } else isi = berikut;
  }
  if (isi) hasil.push({ content: isi, page_start: halaman, page_end: halaman, line_start: awal, line_end: baris.length });
  return hasil;
}

/**
 * Letak berkas asli di disk -- SATU sumber kebenaran untuk penulis dan pembaca.
 *
 * Dulu perhitungan ekstensi ini ditulis dua kali: sekali waktu menyimpan
 * (`unggahPengetahuan`) dan sekali waktu menyajikan (route `/file`). Dua salinan
 * rumus yang sama berarti suatu hari salah satunya berubah sendiri -- lalu
 * berkasnya tersimpan sebagai `.webp` tapi dicari sebagai `.bin`, dan yang
 * muncul ke user cuma 404 tanpa petunjuk apa pun, padahal berkasnya ada.
 *
 * Nama berkas memakai UUID, BUKAN nama asli dari user: nama asli bisa berisi
 * "../" atau karakter yang tidak sah di Windows. Nama aslinya tetap tersimpan
 * di kolom `file_name` untuk ditampilkan.
 */
export function lokasiBerkas(id: string, jenis: string): string {
  const ext = jenis === "application/pdf" ? "pdf" : jenis.split("/")[1] ?? "bin";
  return join(DIREKTORI, `${id}.${ext}`);
}

export async function unggahPengetahuan(input: {
  judul: string; nama: string; jenis: string; isi: Uint8Array; departemen: string; pembuat: string;
}): Promise<HasilUnggah> {
  const judul = input.judul.trim();
  if (!judul || judul.length > 300) throw new Error("Judul dokumen wajib diisi dan maksimal 300 karakter.");
  if (input.isi.byteLength > UKURAN_MAKS) throw new Error("Berkas terlalu besar.");

  let halaman: string[];
  let cara = "teks-tertanam";
  if (input.jenis === "application/pdf") {
    halaman = await bacaPdfPerHalaman(input.isi);
    if (!halaman.some((x) => x.trim().length >= 40)) {
      throw new Error("PDF ini sepertinya hasil scan. Portal belum bisa membacanya; kirim gambar tiap halaman atau minta pengunggah tim lain memprosesnya.");
    }
  } else {
    const teks = await ocrTesseract(input.isi, input.jenis);
    if (!teks) throw new Error("Tidak ada teks yang terbaca dari gambar.");
    halaman = [teks];
    cara = "ocr-tesseract";
  }

  const potongan = halaman.flatMap((x, i) => potong(x, i + 1));
  if (!potongan.length) throw new Error("Dokumen tidak memiliki teks yang bisa disimpan.");
  const vektor = await embed(potongan.map((x) => awalanPassage(String(x.content))));
  const id = randomUUID();
  const hash = createHash("sha256").update(input.isi).digest("hex");
  await mkdir(DIREKTORI, { recursive: true });
  const lokasi = lokasiBerkas(id, input.jenis);
  await writeFile(lokasi, input.isi);

  const pool = poolKnowledgeIngest();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ai_knowledge.documents
       (id_document, title, kind, status, access_menus, file_path, file_name, file_type, file_size, chunk_count, content_hash, embed_model, embedded_at, created_by, updated_by)
       VALUES ($1, $2, 'upload', 'embedded', $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $11)`,
      [id, judul, input.departemen, `/api/knowledge/documents/${id}/file`, input.nama, input.jenis, input.isi.byteLength, potongan.length, hash, LABEL_MODEL_EMBEDDING, input.pembuat],
    );
    for (let i = 0; i < potongan.length; i++) {
      const p = potongan[i];
      await client.query(
        `INSERT INTO ai_knowledge.chunks
         (id_document, position, section_title, content, embedding, page_start, page_end, line_start, line_end, embed_model, embedded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [id, i + 1, judul, p.content, `[${vektor[i].join(",")}]`, p.page_start, p.page_end, p.line_start, p.line_end, LABEL_MODEL_EMBEDDING],
      );
    }
    /**
     * `status` WAJIB "success", bukan "done".
     *
     * Kolom ini cuma teks bebas -- "done" tidak akan ditolak database. Tapi
     * seluruh 320 baris yang sudah ada isinya "success" (311) atau "pending"
     * (9), dan pemantauan di sisi mereka menghitung yang "success". Baris
     * dengan "done" tetap tersimpan, tetap benar isinya, dan tetap TIDAK
     * TERHITUNG -- unggahan kita akan terlihat seperti tidak pernah berhasil.
     */
    await client.query(
      `INSERT INTO ai_knowledge.processing_logs (id_document, kind, status, message, actor, created_at)
       VALUES ($1, 'upload', 'success', $2, $3, now())`,
      [id, `Dokumen diserap dengan ${potongan.length} potongan (${cara}).`, input.pembuat],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    await rm(lokasi, { force: true }).catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { id, judul, jumlahPotongan: potongan.length, cara };
}

