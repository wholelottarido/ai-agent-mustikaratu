/**
 * Pengajuan akun baru.
 *
 * Memakai user MySQL `portal_daftar` yang izinnya sesempit mungkin: INSERT ke
 * `pendaftaran`, plus SELECT tiga kolom (`id`, `ip`, `dibuat`) untuk pembatas
 * per IP. Dia TIDAK bisa membaca `password_hash` pendaftar lain, dan tidak
 * bisa menyentuh tabel `pengguna` sama sekali.
 *
 * ⚠️ TIDAK ADA PEMERIKSAAN "username sudah dipakai" di sini.
 *
 * Bukan kelalaian. Login sengaja dibuat tidak membocorkan username mana yang
 * terdaftar -- pesan errornya seragam, dan kasus "user tidak ada" tetap
 * menjalankan perbandingan hash palsu supaya lama responsnya sama. Kalau
 * halaman pendaftaran menjawab "username sudah dipakai", usaha itu jadi
 * sia-sia: siapa pun bisa menebak daftar akun lewat form pendaftaran.
 *
 * Bentrokan username ditampilkan di HALAMAN ADMIN saat meninjau, tempat yang
 * memang sudah dipercaya.
 */
import mysql from "mysql2/promise";
import { hashPassword } from "@/lib/password";
import { ambilDepartemen } from "@/voltagent/departemen";

/** Pengajuan per IP dalam sejam. Halaman daftar terbuka tanpa login. */
const MAKS_PER_IP_PER_JAM = 3;

/** Panjang password minimum. */
const MIN_PASSWORD = 6;

export type Pengajuan = {
  username: string;
  password: string;
  nama: string;
  nomorWa?: string;
  departemen: string;
  alasan?: string;
};

export type HasilAjuan =
  | { ok: true }
  | { ok: false; pesan: string; status: 400 | 429 };

let kolam: mysql.Pool | undefined;

function pool(): mysql.Pool {
  if (!kolam) {
    const user = process.env.PORTAL_DAFTAR_DB_USER;
    if (!user) {
      throw new Error(
        "PORTAL_DAFTAR_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/portal/09_pendaftaran.sql sebagai root.",
      );
    }
    kolam = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_DAFTAR_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: 2,
      multipleStatements: false,
    });
  }
  return kolam;
}

/**
 * Normalkan nomor WhatsApp ke bentuk internasional tanpa `+`.
 *
 *   08xxxxxxxxxx  ->  628xxxxxxxxxx
 *
 * Disimpan seragam supaya admin bisa mencocokkannya dengan `wa_tautan`
 * belakangan. Ini cuma LABEL -- pencocokan WhatsApp sendiri memakai `wa_id`
 * (LID), lihat `db/portal/05_wa_tautan.sql`.
 */
export function normalkanNomor(nomor: string): string | null {
  const angka = nomor.replace(/\D/g, "");
  if (angka.length < 9) return null;
  if (angka.startsWith("62")) return angka;
  if (angka.startsWith("0")) return "62" + angka.slice(1);
  return angka;
}

/** Periksa bentuk masukan. Pesan errornya untuk ditampilkan apa adanya. */
function periksa(a: Pengajuan): string | null {
  const u = a.username.trim();
  if (!/^[a-z0-9_.]{3,64}$/i.test(u)) {
    return "Username hanya boleh huruf, angka, titik, dan garis bawah (3-64 karakter).";
  }
  if (a.password.length < MIN_PASSWORD) {
    return `Password minimal ${MIN_PASSWORD} karakter.`;
  }
  if (a.nama.trim().length < 2) {
    return "Nama wajib diisi.";
  }
  // Departemen dicek ke registry KODE, bukan sekadar string bebas. Kalau tidak,
  // orang bisa mengajukan departemen yang tidak ada dan admin menyetujuinya
  // tanpa sadar -- akunnya jadi tidak bisa dipakai sama sekali.
  const dep = ambilDepartemen(a.departemen);
  if (!dep) {
    return "Departemen yang dipilih tidak dikenal.";
  }
  // ⚠️ Diperiksa DI SINI JUGA, bukan cuma disembunyikan dari daftar.
  //
  // `/api/daftar` GET tidak menawarkan departemen tanpa database dummy, tapi
  // menyembunyikan pilihan bukan penjagaan -- permintaannya bisa dikirim
  // langsung. Departemen seperti IT cuma bisa lewat login akun perusahaan.
  if (!dep.db) {
    return (
      `Departemen ${dep.label} tidak memakai akun portal. ` +
      "Masuk lewat tombol \"Akun perusahaan\" di halaman login."
    );
  }
  if (a.nomorWa && !normalkanNomor(a.nomorWa)) {
    return "Nomor WhatsApp tidak valid.";
  }
  return null;
}

/** Sudah berapa pengajuan dari IP ini dalam sejam terakhir? */
async function terlaluSering(ip: string): Promise<boolean> {
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    "SELECT COUNT(id) AS n FROM pendaftaran WHERE ip = ? AND dibuat >= NOW() - INTERVAL 1 HOUR",
    [ip],
  );
  return Number(baris[0]?.n ?? 0) >= MAKS_PER_IP_PER_JAM;
}

export async function ajukan(a: Pengajuan, ip: string): Promise<HasilAjuan> {
  const salah = periksa(a);
  if (salah) return { ok: false, pesan: salah, status: 400 };

  if (await terlaluSering(ip)) {
    return {
      ok: false,
      status: 429,
      pesan: `Terlalu banyak pengajuan dari jaringan ini. Coba lagi satu jam lagi.`,
    };
  }

  await pool().query(
    `INSERT INTO pendaftaran
       (username, password_hash, nama, nomor_wa, departemen_diminta, alasan, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      a.username.trim().toLowerCase(),
      await hashPassword(a.password),
      a.nama.trim(),
      a.nomorWa ? normalkanNomor(a.nomorWa) : null,
      a.departemen,
      a.alasan?.trim() || null,
      ip,
    ],
  );

  return { ok: true };
}
