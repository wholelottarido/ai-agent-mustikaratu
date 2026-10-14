/**
 * Kuota pemakaian model berbayar.
 *
 * MASALAH YANG DISELESAIKAN: `ANTHROPIC_API_KEY` dipegang server, jadi siapa
 * pun yang berhasil login -- atau nomor WhatsApp yang sudah tertaut -- bisa
 * menghabiskan kredit tanpa batas. Sebelum ini tidak ada apa pun yang
 * menahannya selain password.
 *
 * ⚠️ MODEL LOKAL TIDAK DIBATASI. Ollama tidak memakai kredit API, cuma listrik
 * laptop. Pemakaiannya tetap dicatat supaya kelihatan siapa memakai apa, tapi
 * tidak dihitung ke kuota (`berbayar = 0`).
 *
 * ⚠️ DISIMPAN DI DATABASE, bukan memori. Web dan bot WhatsApp jalan sebagai
 * dua proses terpisah -- hitungan di memori berarti jatah ganda, dan hangus
 * tiap restart. Lihat `db/portal/07_pemakaian.sql`.
 */
import mysql from "mysql2/promise";
import { poolPortalApp } from "@/lib/db-portal";
import { ambilModel } from "@/voltagent/models";

/**
 * Batas per pengguna. Bisa diubah lewat `.env.local` tanpa menyentuh kode.
 *
 * Bawaan 20/jam & 80/hari dihitung dari perkiraan ~Rp 280 per pertanyaan
 * (Sonnet 5, input ~6.000 token + output ~500): paling buruk ~Rp 22.000 per
 * orang per hari. Batas jam menahan loop yang kebablasan, batas harian
 * menahan total biayanya.
 */
export const KUOTA_JAM = Number(process.env.KUOTA_PER_JAM ?? 20);
export const KUOTA_HARI = Number(process.env.KUOTA_PER_HARI ?? 80);

export type Asal = "web" | "wa";

export type HasilKuota =
  | { boleh: true }
  | { boleh: false; pesan: string; pulihDetik: number };

// Pool dibagi dengan modul lain yang memakai `portal_app` -- lihat
// `lib/db-portal.ts` untuk alasannya.
const pool = poolPortalApp;

/**
 * Model ini memakai kredit API?
 *
 * ⚠️ Ditentukan dari HARGA, bukan dari daftar penyedia. Waktu penyedia
 * `server` ditambahkan, pemeriksaan lama (`penyedia !== "lokal"`) diam-diam
 * menghitungnya sebagai berbayar -- padahal gratis. Harga `null` = gratis,
 * jadi penyedia baru otomatis benar tanpa menyentuh fungsi ini.
 */
export function berbayar(model: string): boolean {
  return ambilModel(model).harga !== null;
}

/**
 * Boleh jalan?
 *
 * Dipanggil SEBELUM agent dijalankan. Model lokal selalu lolos.
 */
export async function cekKuota(penggunaId: number, model: string): Promise<HasilKuota> {
  if (!berbayar(model)) return { boleh: true };

  // Dua jendela dihitung dalam SATU query -- bolak-balik dua kali ke database
  // di jalur yang dilewati setiap pertanyaan itu mubazir.
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT
       SUM(dibuat >= NOW() - INTERVAL 1 HOUR) AS sejam,
       SUM(dibuat >= NOW() - INTERVAL 1 DAY)  AS sehari
     FROM pemakaian
     WHERE pengguna_id = ? AND berbayar = 1 AND dibuat >= NOW() - INTERVAL 1 DAY`,
    [penggunaId],
  );

  const sejam = Number(baris[0]?.sejam ?? 0);
  const sehari = Number(baris[0]?.sehari ?? 0);

  if (sejam >= KUOTA_JAM) {
    return {
      boleh: false,
      pulihDetik: 3600,
      pesan:
        `Kuota model Claude kamu sudah ${sejam}/${KUOTA_JAM} dalam sejam terakhir. ` +
        "Tunggu sebentar, atau pilih model lokal di dropdown — yang itu tanpa batas.",
    };
  }

  if (sehari >= KUOTA_HARI) {
    return {
      boleh: false,
      pulihDetik: 86400,
      pesan:
        `Kuota model Claude kamu sudah ${sehari}/${KUOTA_HARI} hari ini. ` +
        "Besok pulih lagi. Sementara ini bisa pakai model lokal di dropdown.",
    };
  }

  return { boleh: true };
}

/**
 * Catat satu pemakaian. Kembalikan id-nya untuk diisi token belakangan.
 *
 * DICATAT SEBELUM agent dijalankan, bukan sesudah. Kalau dicatat sesudah,
 * permintaan yang gagal di tengah tidak terhitung -- dan orang bisa memaksa
 * error berulang kali tanpa pernah menyentuh kuota, padahal tiap percobaan
 * tetap menagih token ke Anthropic.
 */
export async function catatPemakaian(
  penggunaId: number,
  asal: Asal,
  model: string,
): Promise<number> {
  const [hasil] = await pool().query<mysql.ResultSetHeader>(
    `INSERT INTO pemakaian (pengguna_id, asal, model, berbayar) VALUES (?, ?, ?, ?)`,
    [penggunaId, asal, model, berbayar(model) ? 1 : 0],
  );
  return hasil.insertId;
}

/**
 * Bentuk objek usage yang BENAR-BENAR dikembalikan, bukan yang dijanjikan tipe.
 *
 * ⚠️ Tipe `UsageInfo` di `@voltagent/core` menyebut `promptTokens` &
 * `completionTokens`. Objek aslinya TIDAK punya keduanya -- isinya
 * `inputTokens` & `outputTokens`. Diverifikasi langsung 25 Sep 2026:
 *
 *   {"inputTokens":5209,"outputTokens":20,"totalTokens":5229,
 *    "cachedInputTokens":0,"raw":{...}}
 *
 * Memakai nama dari tipe saja bikin kolomnya terisi NULL tanpa error apa pun.
 * Dua-duanya diterima di sini supaya tetap jalan kalau salah satu berubah.
 */
type Token = {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedInputTokens?: number;
};

/**
 * Isi jumlah token setelah jawaban selesai.
 *
 * Gagal di sini TIDAK BOLEH menggagalkan jawaban yang sudah jadi -- ini cuma
 * catatan, bukan bagian dari hasil. Karena itu pemanggilnya membungkusnya
 * dengan catch.
 */
export async function catatToken(id: number, token: Token): Promise<void> {
  const masuk = token.inputTokens ?? token.promptTokens ?? null;
  const keluar = token.outputTokens ?? token.completionTokens ?? null;

  await pool().query(
    `UPDATE pemakaian SET token_masuk = ?, token_keluar = ?, token_cache = ? WHERE id = ?`,
    [masuk, keluar, token.cachedInputTokens ?? null, id],
  );
}
