/**
 * Embedding lokal -- mengubah kalimat jadi vektor angka.
 *
 * Kenapa lokal, bukan API: Anthropic TIDAK menyediakan model embedding
 * (`@ai-sdk/anthropic.textEmbeddingModel()` bertipe `never`), jadi
 * ANTHROPIC_API_KEY tidak bisa dipakai di sini. Pilihan lain adalah API
 * berbayar pihak ketiga -- yang berarti komentar customer dikirim keluar.
 * Untuk korpus sekecil ini, model lokal sudah cukup dan datanya tetap di mesin.
 *
 * Model: Xenova/multilingual-e5-base (265 MB q8, 768 dimensi).
 * Jalan di CPU lewat onnxruntime-node -- GPU tidak dipakai.
 * Unduhan pertama otomatis, disimpan di cache lokal (lihat env.cacheDir di bawah).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Simpan model DI LUAR project.
 *
 * Bawaannya `node_modules/@huggingface/transformers/.cache` -- dan isinya bisa
 * 1,9 GB. Turbopack memindai node_modules waktu `next build`, lalu gagal dengan
 * "memory allocation of 1110059084 bytes failed". Dipindah ke home directory,
 * di luar jangkauan bundler.
 */
env.cacheDir = process.env.HF_CACHE_DIR ?? join(homedir(), ".cache", "transformers-js");

/**
 * Dipilih lewat pengukuran, bukan tebakan (lihat Tahap 5 di CLAUDE.md).
 * Bisa ditimpa lewat EMBEDDING_MODEL saat membandingkan dua model.
 * Pada 5 pertanyaan uji dengan batas hasil sama, `base` mengungguli `small`
 * di recall DAN presisi: 70%/48% vs 52%/39%. Bedanya paling jauh pada
 * pertanyaan soal keaslian produk (recall 46% -> 85%).
 */
export const MODEL_EMBEDDING =
  process.env.EMBEDDING_MODEL ?? "Xenova/multilingual-e5-base";

const DIMENSI_PER_MODEL: Record<string, number> = {
  "Xenova/multilingual-e5-small": 384,
  "Xenova/multilingual-e5-base": 768,
  "Xenova/multilingual-e5-large": 1024,
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2": 384,
};

export const DIMENSI = DIMENSI_PER_MODEL[MODEL_EMBEDDING] ?? 768;

/**
 * Nama berkas indeks: satu per DEPARTEMEN dan per MODEL.
 *   data/indeks-marketing-e5-base-q8.json
 *
 * Per departemen karena isi indeks HR tidak boleh terbaca agent marketing.
 * Per model supaya membandingkan dua model tidak saling menimpa.
 */
export function berkasIndeks(departemen: string): string {
  if (process.env.EMBEDDING_INDEX) return process.env.EMBEDDING_INDEX;
  const model = MODEL_EMBEDDING.split("/")[1].replace("multilingual-", "");
  return `indeks-${departemen}-${model}-${process.env.EMBEDDING_DTYPE ?? "q8"}.json`;
}

/**
 * Keluarga e5 DIWAJIBKAN memakai awalan ini. Tanpa awalan, kualitas
 * pencariannya turun jauh -- model dilatih dengan pola ini.
 *   "query: ..."   untuk kalimat yang dicari
 *   "passage: ..." untuk kalimat yang disimpan di indeks
 */
export const awalanQuery = (t: string) => `query: ${t}`;
export const awalanPassage = (t: string) => `passage: ${t}`;

/**
 * Presisi bobot model. "q8" = terkuantisasi 8-bit: ukurannya ~1/4 dari fp32
 * dengan kualitas nyaris sama.
 *
 * INI BUKAN PILIHAN GAYA -- di RAM 8 GB, memuat e5-base versi fp32 (1 GB)
 * gagal dengan "bad allocation" saat aplikasi lain sedang jalan. Versi q8
 * (265 MB) muat dengan lega.
 */
export const DTYPE = (process.env.EMBEDDING_DTYPE ?? "q8") as "fp32" | "fp16" | "q8";

/**
 * Nama model seperti yang DITULIS KE DATABASE PERUSAHAAN -- bukan sama dengan
 * `MODEL_EMBEDDING`.
 *
 * `MODEL_EMBEDDING` adalah alamat unduhan di HuggingFace
 * ("Xenova/multilingual-e5-base"); nama organisasinya tidak berarti apa-apa
 * untuk orang yang membaca kolom `embed_model`. Tim lain sudah memakai pola
 * "<model>@<presisi>" di 58 dokumen mereka, dan nilainya bukan hiasan: kalau
 * suatu hari korpusnya dimigrasi ke model lain, yang menentukan baris mana
 * perlu di-embed ulang adalah kolom ini. Dokumen yang labelnya mengikuti pola
 * kita sendiri akan terlewat dari `WHERE embed_model = ...` mereka, tanpa
 * galat -- cuma jawaban yang pelan-pelan jadi salah karena vektornya basi.
 *
 *   multilingual-e5-base@q8
 */
export const LABEL_MODEL_EMBEDDING = `${MODEL_EMBEDDING.split("/").at(-1)}@${DTYPE}`;

let pipa: Promise<FeatureExtractionPipeline> | undefined;

/** Model dimuat sekali lalu dipakai ulang -- memuat ulang itu mahal. */
function ambilPipa(): Promise<FeatureExtractionPipeline> {
  pipa ??= pipeline("feature-extraction", MODEL_EMBEDDING, { dtype: DTYPE });
  return pipa;
}

/**
 * Ubah sekumpulan teks jadi vektor.
 *
 * `pooling: "mean"` merata-ratakan vektor tiap token jadi satu vektor kalimat.
 * `normalize: true` membuat panjang vektor = 1, sehingga dot product langsung
 * sama dengan cosine similarity (lihat `kemiripan()`).
 *
 * ⚠️ SATU PER SATU, BUKAN SEKALIGUS. INI HASIL PENGUKURAN, BUKAN KEHATI-HATIAN.
 *
 * Dulu seluruh array dikirim dalam satu panggilan. Itu membuat hasilnya
 * BERGANTUNG PADA ISI BATCH: teks yang sama persis menghasilkan vektor
 * berbeda tergantung teks apa yang kebetulan menemaninya.
 *
 *     teks sama, sendirian vs ditemani 1 teks pendek  -> kemiripan 0,9798
 *     teks sama, sendirian vs ditemani pendek+panjang -> kemiripan 0,9882
 *     teks sama, sendirian dua kali                   -> kemiripan 1,000000
 *
 * Sebabnya padding: semua teks dalam satu batch dipanjangkan ke teks
 * terpanjang, dan token padding itu ikut terhitung di rata-ratanya.
 *
 * Akibatnya serius untuk pencarian: potongan dokumen di-embed berkelompok
 * (4-5 sekaligus per dokumen) sementara PERTANYAAN user selalu sendirian --
 * jadi keduanya tidak pernah berada di ruang yang sama persis. Ditemukan
 * 1 Okt 2026 lewat `npm run uji:kb-berkas`, yang menghitung ulang vektor
 * tersimpan dan mendapat 0,97-0,99 padahal seharusnya 1,000.
 *
 * ⚠️ Dan satu per satu TIDAK lebih lambat -- justru lebih cepat, karena tidak
 * ada komputasi yang terbuang untuk padding. Terukur pada 105 potongan:
 * sekaligus 8,1 detik, satu per satu 6,9 detik.
 */
export async function embed(teks: string[]): Promise<number[][]> {
  const p = await ambilPipa();

  const vektor: number[][] = [];
  for (const satu of teks) {
    const hasil = await p([satu], { pooling: "mean", normalize: true });
    vektor.push(Array.from(hasil.data as Float32Array));
  }
  return vektor;
}

/**
 * Cosine similarity. Karena vektornya sudah dinormalisasi di `embed()`,
 * ini cukup dot product -- tidak perlu bagi panjang lagi.
 * Hasil 1 = identik, 0 = tidak berhubungan.
 */
export function kemiripan(a: number[], b: number[]): number {
  let jumlah = 0;
  for (let i = 0; i < a.length; i++) jumlah += a[i] * b[i];
  return jumlah;
}
