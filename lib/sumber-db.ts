/**
 * Saklar sumber data: database mana yang dibaca agent.
 *
 * Tepat SATU sumber aktif. Kalau `perusahaan` dipilih, agent membaca dari
 * PostgreSQL perusahaan dan TIDAK lagi menyentuh database dummy — begitu pula
 * sebaliknya. Alasannya ada di `db/portal/13_sumber_db.sql`: dua sumber aktif
 * berarti dua dialek SQL dalam satu prompt, dan model yang tidak yakin akan
 * menebak.
 *
 * ⚠️ DUA POOL, BUKAN SATU.
 *
 * Membaca sumber aktif dipakai SETIAP permintaan chat, jadi lewat
 * `portal_app` yang memang sudah dipegang jalur itu — dan `portal_app` cuma
 * punya SELECT. Mengubah sumber lewat `portal_admin`, yang cuma dipegang
 * halaman admin. Kalau keduanya memakai pool yang sama, jalur chat jadi punya
 * kuasa mengganti sumber data seluruh sistem.
 */
import mysql from "mysql2/promise";
import { poolPortalApp } from "./db-portal";

export type JenisDb = "mysql" | "postgres";

export type SumberDb = {
  kode: string;
  nama: string;
  jenis: JenisDb;
  keterangan: string | null;
  /** Tool & kamus datanya sudah ada di kode? */
  tersedia: boolean;
  /** Yang sedang dipilih administrator? */
  aktif: boolean;
  diubahOleh: string | null;
  diubah: string | null;
};

/** Dipakai kalau tabelnya belum ada — sistem tetap jalan dengan dummy. */
const BAWAAN = "dummy";

/**
 * Singgahan pendek.
 *
 * Sumber aktif dibaca tiap permintaan chat. Tanpa singgahan, itu satu query
 * tambahan per pertanyaan untuk nilai yang berubah paling-paling sekali
 * sehari. 10 detik cukup pendek supaya perubahan di halaman admin terasa
 * hampir seketika, dan cukup panjang untuk menghapus beban itu.
 */
const UMUR_SINGGAHAN = 10_000;
let singgahan: { nilai: SumberDb[]; sampai: number } | undefined;

/** Pool admin sendiri — lihat catatan "DUA POOL" di atas. */
let kolamAdmin: mysql.Pool | undefined;

function poolAdmin(): mysql.Pool {
  if (!kolamAdmin) {
    const user = process.env.PORTAL_ADMIN_DB_USER;
    if (!user) {
      throw new Error(
        "PORTAL_ADMIN_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/portal/10_admin.sql sebagai root.",
      );
    }
    kolamAdmin = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_ADMIN_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: 2,
      multipleStatements: false,
    });
  }
  return kolamAdmin;
}

const jadiSumber = (b: mysql.RowDataPacket): SumberDb => ({
  kode: String(b.kode),
  nama: String(b.nama),
  jenis: String(b.jenis) === "postgres" ? "postgres" : "mysql",
  keterangan: b.keterangan === null ? null : String(b.keterangan),
  tersedia: Number(b.tersedia) === 1,
  aktif: Number(b.aktif) === 1,
  diubahOleh: b.diubah_oleh === null ? null : String(b.diubah_oleh),
  diubah: b.diubah ? new Date(b.diubah).toISOString() : null,
});

/** Semua sumber, urut untuk ditampilkan. Dibaca lewat `portal_app`. */
export async function daftarSumber(): Promise<SumberDb[]> {
  if (singgahan && Date.now() < singgahan.sampai) return singgahan.nilai;

  const [baris] = await poolPortalApp().query<mysql.RowDataPacket[]>(
    `SELECT kode, nama, jenis, keterangan, tersedia, aktif, diubah_oleh, diubah
       FROM sumber_db ORDER BY urutan, kode`,
  );
  const nilai = baris.map(jadiSumber);
  singgahan = { nilai, sampai: Date.now() + UMUR_SINGGAHAN };
  return nilai;
}

/**
 * Kode sumber yang sedang aktif.
 *
 * ⚠️ Selalu mengembalikan sesuatu. Kalau tabelnya belum ada, atau tidak ada
 * baris yang aktif, jatuh ke `dummy` — BUKAN melempar error. Jalur chat tidak
 * boleh mati gara-gara saklar yang belum disiapkan; yang benar adalah tetap
 * jalan dengan sumber yang sudah pasti ada.
 */
export async function sumberAktif(): Promise<string> {
  try {
    const semua = await daftarSumber();
    return semua.find((s) => s.aktif && s.tersedia)?.kode ?? BAWAAN;
  } catch {
    return BAWAAN;
  }
}

export type HasilGanti =
  | { ok: true; sumber: SumberDb }
  | { ok: false; sebab: "tidak-dikenal" | "belum-tersedia"; pesan: string };

/**
 * Ganti sumber aktif. Dipakai HANYA halaman admin.
 *
 * Dua baris diubah dalam SATU transaksi: yang lama dimatikan, yang baru
 * dinyalakan. Kalau dipisah, ada jeda di mana NOL sumber aktif — dan
 * permintaan chat yang kebetulan lewat di jeda itu jatuh ke bawaan tanpa ada
 * yang sadar.
 */
export async function gantiSumber(kode: string, oleh: string): Promise<HasilGanti> {
  const c = await poolAdmin().getConnection();
  try {
    const [cek] = await c.query<mysql.RowDataPacket[]>(
      `SELECT kode, nama, jenis, keterangan, tersedia, aktif, diubah_oleh, diubah
         FROM sumber_db WHERE kode = ? LIMIT 1`,
      [kode],
    );
    if (cek.length === 0) {
      return { ok: false, sebab: "tidak-dikenal", pesan: `Sumber "${kode}" tidak ada.` };
    }
    const sumber = jadiSumber(cek[0]);

    // ⚠️ Memilih sumber yang tool-nya belum ada membuat agent kehilangan
    // SELURUH kemampuan membaca data, tanpa pesan galat. Gejalanya: semua
    // pertanyaan dijawab "tidak punya akses", dan penyebabnya tidak kelihatan.
    if (!sumber.tersedia) {
      return {
        ok: false,
        sebab: "belum-tersedia",
        pesan: `${sumber.nama} belum bisa dipakai — tool dan kamus datanya belum ada.`,
      };
    }

    await c.beginTransaction();
    await c.query("UPDATE sumber_db SET aktif = 0 WHERE aktif = 1 AND kode <> ?", [kode]);
    await c.query("UPDATE sumber_db SET aktif = 1, diubah_oleh = ? WHERE kode = ?", [oleh, kode]);
    await c.commit();

    singgahan = undefined; // paksa baca ulang, jangan tunggu singgahan kedaluwarsa
    return { ok: true, sumber: { ...sumber, aktif: true, diubahOleh: oleh } };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

/** Buang singgahan. Dipakai tes; di aplikasi cukup `gantiSumber`. */
export function lupakanSinggahan(): void {
  singgahan = undefined;
}
