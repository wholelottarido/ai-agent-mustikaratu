/**
 * Siapa pengirim pesan WhatsApp ini?
 *
 * Nomor telepon TIDAK dipakai untuk mencocokkan -- WhatsApp tidak
 * mengirimkannya. Yang dicocokkan `wa_id` (LID), lihat
 * `db/portal/05_wa_tautan.sql` untuk alasan lengkapnya.
 *
 * Memakai `portal_readonly`: sama seperti halaman login, dan user itu tidak
 * bisa menyentuh database departemen mana pun.
 */
import mysql from "mysql2/promise";

export type Identitas = {
  id: number;
  username: string;
  nama: string;
  departemen: string;
  peran: string;
  /**
   * uuid karyawan di database perusahaan. `null` kalau belum dipetakan.
   *
   * Dipakai menyaring baris waktu sumber data = perusahaan. Tanpa ini, tool
   * `query_perusahaan` menolak permintaan -- lebih baik ditolak daripada
   * menampilkan data 1.954 orang lain.
   */
  idEmployee: string | null;
};

let kolam: mysql.Pool | undefined;

function pool(): mysql.Pool {
  if (!kolam) {
    const user = process.env.PORTAL_DB_USER;
    if (!user) {
      throw new Error(
        "PORTAL_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/portal/01_create_portal.sql sebagai root.",
      );
    }
    kolam = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: 2,
      multipleStatements: false,
    });
  }
  return kolam;
}

/**
 * Cari pengguna dari `wa_id` pengirim.
 *
 * `aktif = 1` ikut diperiksa: menonaktifkan akun di web harus langsung
 * memutus aksesnya lewat WhatsApp juga. Kalau tidak, orang yang sudah keluar
 * dari perusahaan tetap bisa bertanya lewat WA.
 */
export async function cariIdentitas(waId: string): Promise<Identitas | null> {
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT p.id, p.username, p.nama, p.departemen, p.peran, p.id_employee
       FROM wa_tautan t
       JOIN pengguna p ON p.id = t.pengguna_id
      WHERE t.wa_id = ? AND p.aktif = 1
      LIMIT 1`,
    [waId],
  );

  const p = baris[0];
  if (!p) return null;

  return {
    id: p.id as number,
    username: p.username as string,
    nama: p.nama as string,
    departemen: p.departemen as string,
    peran: p.peran as string,
    idEmployee: (p.id_employee as string | null) ?? null,
  };
}

export async function tutupPool(): Promise<void> {
  if (kolam) {
    await kolam.end();
    kolam = undefined;
  }
}
