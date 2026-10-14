/**
 * Kode verifikasi untuk menautkan WhatsApp sendiri.
 *
 * Dipakai dua sisi:
 *   - web  : `buatKode()` saat user menekan "Hubungkan WhatsApp"
 *   - bot  : `tukarKode()` saat pesan 6 digit masuk
 *
 * ⚠️ KODENYA DISIMPAN APA ADANYA, TIDAK DI-HASH.
 *
 * Bukan kelalaian — dan bukan tanpa risiko, jadi ini alasannya. Hash tidak
 * menolong banyak untuk 6 digit: ruangnya cuma 1 juta. Yang menahannya di sini
 * hal lain: umur 10 menit, sekali pakai lalu dihapus, satu kode aktif per
 * orang, dan pembatas percobaan di sisi bot.
 *
 * Risiko yang tersisa: siapa pun yang bisa membaca tabel ini sebagai
 * `portal_app` bisa memakai kode yang sedang aktif. Tapi orang yang sudah
 * sejauh itu juga sudah bisa membaca seluruh isi percakapan — menautkan
 * WhatsApp bukan peningkatan hak yang berarti di atas itu.
 */
import { randomInt } from "node:crypto";
import mysql from "mysql2/promise";
import { poolPortalApp } from "@/lib/db-portal";

const pool = poolPortalApp;

/** Umur kode. Cukup untuk pindah ke HP dan mengetik, tidak lebih. */
export const MENIT_BERLAKU = 10;

export type StatusTaut =
  | { tertaut: true; nomor: string | null; sejak: string }
  | { tertaut: false };

/** Sudah punya WhatsApp tertaut? */
export async function statusTaut(penggunaId: number): Promise<StatusTaut> {
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    "SELECT nomor_wa, ditautkan FROM wa_tautan WHERE pengguna_id = ? LIMIT 1",
    [penggunaId],
  );
  const t = baris[0];
  return t
    ? { tertaut: true, nomor: (t.nomor_wa as string) ?? null, sejak: String(t.ditautkan) }
    : { tertaut: false };
}

/**
 * Buat kode baru. Menimpa kode lama orang ini kalau ada.
 *
 * `randomInt` dari `node:crypto`, bukan `Math.random()`: yang terakhir bisa
 * ditebak kalau seseorang melihat cukup banyak keluarannya.
 */
export async function buatKode(penggunaId: number): Promise<string> {
  const kode = String(randomInt(0, 1_000_000)).padStart(6, "0");

  // Dua langkah, bukan satu `ON DUPLICATE KEY`: kuncinya ADA DUA (kode dan
  // pengguna_id), jadi baris lama orang ini harus dibuang dulu.
  await pool().query("DELETE FROM wa_kode WHERE pengguna_id = ?", [penggunaId]);
  await pool().query(
    `INSERT INTO wa_kode (kode, pengguna_id, kedaluwarsa)
     VALUES (?, ?, NOW() + INTERVAL ? MINUTE)`,
    [kode, penggunaId, MENIT_BERLAKU],
  );

  return kode;
}

export type HasilTukar =
  | { ok: true; penggunaId: number }
  | { ok: false; sebab: "tidak-cocok" | "sudah-tertaut" | "wa-dipakai" };

/**
 * Tukar kode dengan tautan. Dipanggil bot saat menerima 6 digit.
 *
 * Dibungkus transaksi: kalau tautan tersimpan tapi kodenya gagal dihapus,
 * kode yang sama bisa dipakai lagi dari WhatsApp lain.
 */
export async function tukarKode(kode: string, waId: string): Promise<HasilTukar> {
  const c = await pool().getConnection();
  try {
    await c.beginTransaction();

    const [baris] = await c.query<mysql.RowDataPacket[]>(
      "SELECT pengguna_id FROM wa_kode WHERE kode = ? AND kedaluwarsa > NOW() FOR UPDATE",
      [kode],
    );
    const k = baris[0];
    if (!k) {
      await c.rollback();
      return { ok: false, sebab: "tidak-cocok" };
    }
    const penggunaId = k.pengguna_id as number;

    try {
      await c.query(
        "INSERT INTO wa_tautan (wa_id, pengguna_id, nomor_wa) VALUES (?, ?, NULL)",
        [waId, penggunaId],
      );
    } catch (e) {
      await c.rollback();
      // Dua sumber bentrokan, dan bedanya penting untuk pesan ke user:
      //   PRIMARY KEY  -> WhatsApp ini sudah dipakai akun lain
      //   uq_pengguna  -> akun ini sudah punya WhatsApp lain
      const kodeGalat = (e as { code?: string }).code;
      if (kodeGalat === "ER_DUP_ENTRY") {
        const pesan = String((e as { sqlMessage?: string }).sqlMessage ?? "");
        return { ok: false, sebab: pesan.includes("uq_pengguna") ? "sudah-tertaut" : "wa-dipakai" };
      }
      throw e;
    }

    await c.query("DELETE FROM wa_kode WHERE kode = ?", [kode]);
    await c.commit();
    return { ok: true, penggunaId };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
