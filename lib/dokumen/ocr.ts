/**
 * OCR gambar — dua jalur, dipilih lewat `OCR_PENYEDIA`.
 *
 * ⚠️ DIPAKAI SEBAGAI PILIHAN TERAKHIR, BUKAN PERTAMA.
 *
 * Untuk PDF yang teksnya sudah tertanam, `baca.ts` mengambilnya dalam ~0,2
 * detik dengan akurasi 100%. OCR di sini selalu lebih lambat dan bisa salah
 * baca, jadi cuma dipakai kalau memang tidak ada teks: foto, scan, screenshot.
 *
 * ============================================================
 * KENAPA CLAUDE JADI BAWAAN, PADAHAL AWALNYA DIPILIH MODEL LOKAL
 * ============================================================
 * Rencana awal: granite3.2-vision di Ollama, supaya dokumen tidak pernah
 * keluar dari laptop. Rencana itu GAGAL di mesin ini, dan sebabnya diukur
 * (30 Sep 2026):
 *
 *     RAM bebas        : 0,0-0,4 GB dari 7,3 GB
 *     granite butuh    : ~2,4 GB
 *     GPU bebas        : 5,4 GB  <- bukan masalahnya
 *
 * `cudaMalloc failed: out of memory` yang muncul itu menyesatkan: GPU-nya
 * lega, yang habis RAM sistem (CUDA butuh memori host untuk menyiapkan
 * transfer). Bahkan `moondream` yang 1,7 GB tidak menolong kalau yang
 * tersedia nol.
 *
 * Diukur berdampingan pada screenshot berbahasa Indonesia:
 *
 *     granite lokal : GAGAL (kehabisan memori); 63 dtk waktu sempat jalan
 *     Claude Haiku  : 2,9 detik, seluruh teks benar, ~Rp 18 per gambar
 *
 * ⚠️ HARGANYA: gambar KELUAR dari laptop ke server Anthropic.
 *
 * Itu keputusan sadar pemilik proyek (30 Sep 2026), bukan bawaan yang
 * kebetulan. Karena itu jalur lokal TIDAK dihapus — begitu ada mesin yang
 * muat, `OCR_PENYEDIA=lokal` mengembalikannya tanpa mengubah kode.
 *
 * ⚠️ TIDAK ADA MODE "coba lokal dulu, kalau gagal baru Claude".
 *
 * Kedengarannya aman, tapi di mesin ini lokal SELALU gagal — jadi hasilnya
 * user mengira dokumennya diproses lokal padahal setiap kali dikirim keluar.
 * Itu lebih buruk daripada memilih cloud secara terbuka.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

/** `claude` (bawaan) atau `lokal`. */
const PENYEDIA = (process.env.OCR_PENYEDIA ?? "claude").toLowerCase();

const ALAMAT_OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL_LOKAL = process.env.OLLAMA_MODEL_VISION ?? "granite3.2-vision";
const MODEL_CLAUDE = process.env.OCR_MODEL_CLAUDE ?? "claude-haiku-4-5";

/**
 * Konteks model lokal.
 *
 * ⚠️ Satu gambar saja sudah ~3.700 token. Bawaan granite 16.384, dan KV
 * cache sebesar itu memperparah masalah memori. 5.120 cukup untuk satu
 * gambar plus jawabannya.
 */
const KONTEKS = Number(process.env.OLLAMA_NUM_CTX ?? 5120);
const BATAS_MS = Number(process.env.OCR_TIMEOUT_MS ?? 240_000);

const PERINTAH =
  "Tuliskan ulang SEMUA teks yang terlihat di gambar ini, apa adanya, " +
  "termasuk angka dan tanggal. Jangan menerjemahkan, jangan merangkum, " +
  "jangan menambahkan apa pun yang tidak terlihat. " +
  "Kalau tidak ada teks sama sekali, jawab persis: TIDAK ADA TEKS.";

/** Dari mana teks itu dibaca. Ikut disimpan supaya user bisa tahu. */
export type CaraOcr = "ocr-claude" | "ocr-lokal";

export type HasilOcr =
  | { ok: true; teks: string; detik: number; cara: CaraOcr }
  | {
      ok: false;
      sebab: "ollama-mati" | "kehabisan-memori" | "kelamaan" | "lain";
      pesan: string;
    };

/** Benar kalau gambar dibaca lewat layanan cloud, bukan di mesin ini. */
export function pakaiCloud(): boolean {
  return PENYEDIA !== "lokal";
}

/**
 * Baca teks dari satu gambar.
 *
 * Tidak pernah melempar: semua kegagalannya adalah keadaan yang wajar
 * (Ollama mati, RAM penuh, API bermasalah), dan user berhak dapat
 * penjelasan, bukan tumpukan error.
 */
export async function ocrGambar(gambar: Uint8Array, jenis: string): Promise<HasilOcr> {
  return pakaiCloud() ? await lewatClaude(gambar, jenis) : await lewatOllama(gambar);
}

// ============================================================
// Jalur cloud
// ============================================================
async function lewatClaude(gambar: Uint8Array, jenis: string): Promise<HasilOcr> {
  const mulai = Date.now();
  try {
    const r = await generateText({
      model: anthropic(MODEL_CLAUDE),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PERINTAH },
            { type: "image", image: gambar, mediaType: jenis },
          ],
        },
      ],
      maxOutputTokens: 4000,
      abortSignal: AbortSignal.timeout(BATAS_MS),
    });
    return { ok: true, teks: bersihkan(r.text), detik: (Date.now() - mulai) / 1000, cara: "ocr-claude" };
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (/timeout|abort/i.test(pesan)) {
      return { ok: false, sebab: "kelamaan", pesan: "Membaca gambar terlalu lama, coba lagi." };
    }
    // Kunci API yang salah/habis adalah penyebab paling mungkin, dan user
    // tidak akan menebaknya dari pesan aslinya.
    return {
      ok: false,
      sebab: "lain",
      pesan:
        "Gagal membaca gambar lewat layanan cloud. " +
        "Periksa ANTHROPIC_API_KEY di .env.local. " +
        `(${pesan.slice(0, 120)})`,
    };
  }
}

// ============================================================
// Jalur lokal (Ollama)
// ============================================================
async function lewatOllama(gambar: Uint8Array): Promise<HasilOcr> {
  const mulai = Date.now();
  const base64 = Buffer.from(gambar).toString("base64");

  let r: Response;
  try {
    r = await fetch(`${ALAMAT_OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(BATAS_MS),
      body: JSON.stringify({
        model: MODEL_LOKAL,
        stream: false,
        options: { num_ctx: KONTEKS, temperature: 0 },
        messages: [{ role: "user", content: PERINTAH, images: [base64] }],
      }),
    });
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (/timeout|abort/i.test(pesan)) {
      return {
        ok: false,
        sebab: "kelamaan",
        pesan: `Membaca gambar lewat ${MODEL_LOKAL} melebihi ${Math.round(BATAS_MS / 1000)} detik.`,
      };
    }
    return {
      ok: false,
      sebab: "ollama-mati",
      pesan:
        `Tidak bisa menghubungi Ollama di ${ALAMAT_OLLAMA}. ` +
        `Pastikan Ollama jalan dan model ${MODEL_LOKAL} sudah diunduh.`,
    };
  }

  const isi = await r.text();
  if (!r.ok) {
    // ⚠️ Pesan asli Ollama ("cudaMalloc failed: out of memory") MENYESATKAN:
    // GPU-nya lega, yang habis RAM sistem. User tidak akan pernah menebak itu.
    if (/out of memory|cudaMalloc|GGML_ASSERT|failed to allocate/i.test(isi)) {
      return {
        ok: false,
        sebab: "kehabisan-memori",
        pesan:
          "Memori komputer tidak cukup untuk menjalankan model pembaca gambar. " +
          "Tutup dulu aplikasi berat (browser, editor) lalu coba lagi. " +
          "Ini keterbatasan mesin, bukan masalah dokumennya.",
      };
    }
    return { ok: false, sebab: "lain", pesan: `Ollama menolak: ${isi.slice(0, 200)}` };
  }

  try {
    const teks = String(JSON.parse(isi)?.message?.content ?? "");
    return { ok: true, teks: bersihkan(teks), detik: (Date.now() - mulai) / 1000, cara: "ocr-lokal" };
  } catch {
    return { ok: false, sebab: "lain", pesan: "Jawaban Ollama tidak bisa dibaca." };
  }
}

/**
 * Gambar tanpa teks menghasilkan string kosong, bukan kalimat penanda.
 *
 * Model diminta menjawab "TIDAK ADA TEKS"; granite kadang menjawab
 * "unanswerable". Dua-duanya berarti hal yang sama dan diperlakukan sebagai
 * hasil SAH — gambar tanpa teks itu wajar, bukan kegagalan.
 */
function bersihkan(teks: string): string {
  const t = teks.trim();
  return /^(TIDAK ADA TEKS|unanswerable)\.?$/i.test(t) ? "" : t;
}
