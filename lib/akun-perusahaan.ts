/**
 * Menautkan akun perusahaan ke baris `portal.pengguna` (Tahap 10B-3).
 *
 * Alurnya: password diverifikasi di PostgreSQL (`lib/login-perusahaan.ts`),
 * lalu orangnya diberi baris di portal supaya riwayat percakapan dan
 * pencatatan pemakaian punya tempat menempel.
 */
import mysql from "mysql2/promise";
import { SignJWT, jwtVerify } from "jose";
import type { ProfilPerusahaan } from "./login-perusahaan";

// ============================================================
// Pool penulis
// ============================================================
// `portal_readonly` cuma bisa SELECT, jadi jalur ini memakai `portal_admin` --
// user yang memang sudah bertugas membuat baris `pengguna` waktu pendaftaran
// disetujui (`lib/admin.ts`). Tidak dibuatkan user MySQL baru: membuat dan
// menyunting akun persis pekerjaannya.
const KUNCI = Symbol.for("portal.db.akun-perusahaan");
type Global = typeof globalThis & { [KUNCI]?: mysql.Pool };

function poolTulis(): mysql.Pool {
  const g = globalThis as Global;
  if (!g[KUNCI]) {
    const user = process.env.PORTAL_ADMIN_DB_USER;
    if (!user) {
      throw new Error(
        "PORTAL_ADMIN_DB_USER belum diisi di .env.local. " +
          "Login akun perusahaan butuh user yang bisa menulis ke tabel pengguna.",
      );
    }
    g[KUNCI] = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_ADMIN_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: 3,
      multipleStatements: false,
    });
  }
  return g[KUNCI];
}

// ============================================================
// Username portal untuk akun perusahaan
// ============================================================
/**
 * ⚠️ BUKAN email-nya, dan itu disengaja.
 *
 * Satu email bisa menempel pada banyak karyawan -- `unregisted@` menempel pada
 * 307 orang. Kalau `username` diisi email, 307 orang berebut satu baris
 * `pengguna` yang sama, padahal departemen dan perannya bisa berbeda.
 *
 * Kenapa tidak `email#<id pendek>` saja? Pernah dipertimbangkan dan ditolak:
 * bentuknya harus TETAP selama-lamanya. Kalau imbuhannya bergantung pada
 * "akun ini dipakai berapa orang", angka itu bisa berubah (orang pindah
 * departemen, karyawan keluar) -- dan begitu berubah, username ikut berubah
 * dan portal membuat baris KEDUA untuk orang yang sama.
 *
 * `mr:<id_employee>` tidak bergantung pada apa pun yang bisa berubah, selalu
 * 39 karakter (muat di VARCHAR(64)), dan langsung kelihatan asalnya. Nama
 * aslinya tetap tampil karena disimpan di kolom `nama`; email-nya tercatat di
 * `login_perusahaan_log`.
 */
export function usernamePortal(idEmployee: string): string {
  return `mr:${idEmployee}`;
}

// ============================================================
// Token antara: "sudah benar passwordnya, tinggal pilih profil"
// ============================================================
/**
 * ⚠️ Token ini BUKAN sesi, dan tidak boleh bisa dipakai sebagai sesi.
 *
 * Dia cuma menyatakan "password untuk id_users ini sudah terbukti benar,
 * barusan". Umurnya pendek, isinya tidak ada departemen/peran, dan ditandai
 * `tahap: "pilih-profil"` -- `bacaSesi()` tidak akan pernah menerimanya
 * karena bentuknya beda.
 *
 * Dikirim di body respons, BUKAN di cookie: cookie akan ikut terkirim ke
 * semua permintaan lain, dan token setengah-jadi tidak punya urusan di sana.
 */
const UMUR_PILIH_DETIK = 5 * 60;
const TAHAP = "pilih-profil";

function kunciToken(): Uint8Array {
  const rahasia = process.env.SESSION_SECRET;
  if (!rahasia || rahasia.length < 32) {
    throw new Error("SESSION_SECRET belum diisi atau terlalu pendek (minimal 32 karakter).");
  }
  return new TextEncoder().encode(rahasia);
}

export async function tokenPilihProfil(idUsers: string, username: string): Promise<string> {
  return new SignJWT({ tahap: TAHAP, idUsers, username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${UMUR_PILIH_DETIK}s`)
    .sign(kunciToken());
}

export async function bacaTokenPilihProfil(
  token: string,
): Promise<{ idUsers: string; username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, kunciToken(), { algorithms: ["HS256"] });
    if (payload.tahap !== TAHAP) return null;
    const { idUsers, username } = payload as { idUsers?: unknown; username?: unknown };
    if (typeof idUsers !== "string" || typeof username !== "string") return null;
    return { idUsers, username };
  } catch {
    // Kedaluwarsa, tanda tangan salah, atau bukan JWT. Semuanya sama:
    // suruh login ulang.
    return null;
  }
}

// ============================================================
// Simpan / perbarui baris pengguna
// ============================================================
export type AkunPortal = { id: number; username: string; admin: boolean };

/**
 * Buat atau perbarui baris `pengguna` untuk satu profil karyawan.
 *
 * ⚠️ Departemen dan peran DIPERBARUI tiap login, bukan cuma saat pertama.
 * Sumber kebenarannya database perusahaan: kalau orangnya pindah departemen
 * atau naik jabatan di sana, portal harus ikut -- bukan memakai nilai basi
 * dari login pertamanya berbulan-bulan lalu.
 *
 * ⚠️ `is_admin` TIDAK pernah disentuh. Hak admin portal diberikan manusia
 * lewat `/admin`, dan tidak boleh bisa didapat cuma dengan punya akun
 * perusahaan -- apa pun jabatan orang itu di sana.
 */
export async function simpanAkunPerusahaan(arg: {
  profil: ProfilPerusahaan;
  departemen: "marketing" | "hr" | "it";
  peran: "staf" | "kepala";
}): Promise<AkunPortal> {
  const { profil, departemen, peran } = arg;
  const username = usernamePortal(profil.idEmployee);
  const nama = profil.nama.trim() || "(tanpa nama)";

  await poolTulis().query(
    `INSERT INTO pengguna
       (username, password_hash, nama, departemen, peran, id_employee, sumber_akun, aktif)
     VALUES (?, NULL, ?, ?, ?, ?, 'perusahaan', 1)
     ON DUPLICATE KEY UPDATE
       nama        = VALUES(nama),
       departemen  = VALUES(departemen),
       peran       = VALUES(peran),
       sumber_akun = 'perusahaan',
       aktif       = 1`,
    [username, nama, departemen, peran, profil.idEmployee],
  );

  const [rows] = await poolTulis().query<mysql.RowDataPacket[]>(
    "SELECT id, username, is_admin FROM pengguna WHERE username = ? LIMIT 1",
    [username],
  );
  const r = rows[0];
  if (!r) throw new Error(`Baris pengguna untuk ${username} tidak ketemu setelah disimpan.`);
  return { id: Number(r.id), username: String(r.username), admin: Number(r.is_admin) === 1 };
}

/**
 * Catat profil mana yang dipilih.
 *
 * ⚠️ Satu-satunya cara tahu siapa mengaku siapa. Akun email dipakai bersama --
 * bawaan sistem perusahaan yang tidak bisa kita ubah -- jadi orang yang tahu
 * satu password bisa memilih profil siapa pun di antara sekian nama.
 *
 * Gagal mencatat TIDAK menggagalkan login: kalau tabel auditnya bermasalah,
 * yang benar adalah orangnya tetap bisa bekerja dan kita dapat teriakan di
 * log server, bukan seluruh portal ikut mati.
 */
export async function catatPilihanProfil(arg: {
  username: string;
  idUsers: string;
  profil: ProfilPerusahaan;
  peran: string;
  jmlProfil: number;
  ip: string | null;
}): Promise<void> {
  try {
    await poolTulis().query(
      `INSERT INTO login_perusahaan_log
         (username, id_users, id_employee, nama, departemen, peran, jml_profil, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        arg.username,
        arg.idUsers,
        arg.profil.idEmployee,
        arg.profil.nama,
        arg.profil.departemen,
        arg.peran,
        arg.jmlProfil,
        arg.ip,
      ],
    );
  } catch (e) {
    console.error("[akun-perusahaan] gagal mencatat audit:", e instanceof Error ? e.message : e);
  }
}
