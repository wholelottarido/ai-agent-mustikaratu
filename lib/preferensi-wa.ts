/**
 * Pilihan model per pengguna untuk bot WhatsApp.
 *
 * Di web pilihannya ada di dropdown dan dikirim tiap request. Di WhatsApp
 * tidak ada dropdown, jadi pilihannya harus DIINGAT — dan diingat di
 * database, bukan memori: kalau di memori, tiap bot restart semua orang
 * diam-diam kembali ke model bawaan dan tidak ada yang tahu sampai tagihannya
 * naik.
 *
 * ⚠️ Nilai yang tersimpan TIDAK dipercaya mentah. `ambilModel()` memvalidasi
 * ke whitelist setiap kali dibaca, jadi model yang dihapus dari daftar
 * otomatis jatuh ke bawaan tanpa perlu membersihkan tabel ini.
 */
import mysql from "mysql2/promise";
import { poolPortalApp } from "@/lib/db-portal";
import { ambilModel, MODEL_DEFAULT, MODEL_TERSEDIA, type PilihanModel } from "@/voltagent/models";

// Pool dibagi dengan modul lain yang memakai `portal_app` -- lihat
// `lib/db-portal.ts` untuk alasannya.
const pool = poolPortalApp;

/** Model yang dipakai pengguna ini di WhatsApp. Selalu model yang sah. */
export async function modelPilihan(penggunaId: number): Promise<PilihanModel> {
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    "SELECT model FROM wa_preferensi WHERE pengguna_id = ? LIMIT 1",
    [penggunaId],
  );
  // `ambilModel` mengembalikan default kalau id-nya di luar whitelist,
  // jadi baris lama yang modelnya sudah dihapus tetap aman.
  return ambilModel(baris[0]?.model ?? MODEL_DEFAULT);
}

/** Simpan pilihan. Menimpa kalau sudah ada. */
export async function simpanModelPilihan(penggunaId: number, modelId: string): Promise<void> {
  // Divalidasi lagi di sini, bukan cuma dipercaya dari pemanggil -- kalau
  // suatu saat ada pemanggil baru yang lupa memvalidasi, yang tersimpan tetap
  // id yang sah.
  const sah = ambilModel(modelId).id;
  await pool().query(
    `INSERT INTO wa_preferensi (pengguna_id, model) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE model = VALUES(model)`,
    [penggunaId, sah],
  );
}

/**
 * Cari model dari kata yang diketik user.
 *
 * User mengetik `/model haiku`, bukan `/model claude-haiku-4-5`. Dicocokkan
 * longgar ke id maupun label supaya tidak perlu hafal id lengkapnya.
 *
 * @returns model yang cocok, atau null kalau tidak ada / ambigu.
 */
export function cariModel(kata: string): PilihanModel | null {
  const k = kata.trim().toLowerCase();
  if (!k) return null;

  // Cocok persis dulu -- kalau ada id yang sama, itu yang menang.
  const persis = MODEL_TERSEDIA.find((m) => m.id.toLowerCase() === k);
  if (persis) return persis;

  const cocok = MODEL_TERSEDIA.filter(
    (m) => m.id.toLowerCase().includes(k) || m.label.toLowerCase().includes(k),
  );
  // Ambigu (mis. "claude" cocok ke dua model) dianggap tidak ketemu --
  // lebih baik user memperjelas daripada bot memilihkan yang salah.
  return cocok.length === 1 ? cocok[0] : null;
}
