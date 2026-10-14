/**
 * Baca data pengguna dari database `portal`.
 *
 * Database terpisah dengan user MySQL sendiri (`portal_readonly`) yang HANYA
 * boleh membaca tabel `pengguna`. Agent departemen mana pun tidak punya akses
 * ke sini -- daftar akun bukan data yang boleh ditanyakan lewat chat.
 *
 * Runtime Node saja (pakai mysql2). Jangan di-import dari middleware.
 */
import mysql from "mysql2/promise";

export type Pengguna = {
  id: number;
  username: string;
  password_hash: string;
  nama: string;
  departemen: string;
  peran: string;
  is_admin: number;
  /** uuid karyawan di database perusahaan. NULL = belum dipetakan. */
  id_employee: string | null;
};

const KUNCI = Symbol.for("portal.db.pengguna");
type Global = typeof globalThis & { [KUNCI]?: mysql.Pool };

function pool(): mysql.Pool {
  const g = globalThis as Global;
  if (!g[KUNCI]) {
    const user = process.env.PORTAL_DB_USER;
    if (!user) {
      throw new Error(
        "PORTAL_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/portal/01_create_portal.sql sebagai root.",
      );
    }
    g[KUNCI] = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: 3,
      multipleStatements: false,
    });
  }
  return g[KUNCI];
}

/** Cari pengguna aktif berdasarkan username. `null` kalau tidak ada. */
export async function cariPengguna(username: string): Promise<Pengguna | null> {
  const [rows] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT id, username, password_hash, nama, departemen, peran, is_admin, id_employee
       FROM pengguna
      WHERE username = ? AND aktif = 1
      LIMIT 1`,
    [username],
  );
  return (rows[0] as Pengguna) ?? null;
}
