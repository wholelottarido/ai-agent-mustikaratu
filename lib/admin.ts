/**
 * Persetujuan pengajuan akun.
 *
 * ⚠️ SATU-SATUNYA berkas yang memakai `portal_admin` — user MySQL yang bisa
 * menulis ke tabel `pengguna`. Jangan pakai pool ini dari tempat lain.
 *
 * Sampai sebelum fitur ini ada, tidak ada user milik aplikasi yang bisa
 * menyentuh daftar akun sama sekali. Sekarang izinnya ada, tapi terkurung di
 * sini: login tetap `portal_readonly`, percakapan tetap `portal_app`, agent
 * tetap user read-only per departemen.
 *
 * `portal_admin` sengaja TANPA DELETE — akun bisa dinonaktifkan, tidak bisa
 * dihapus jejaknya.
 */
import mysql from "mysql2/promise";
import { ambilDepartemen } from "@/voltagent/departemen";

/** Peran yang boleh ditetapkan admin. Bukan string bebas. */
export const PERAN_SAH = ["staf", "kepala"] as const;
export type Peran = (typeof PERAN_SAH)[number];

export type Pengajuan = {
  id: number;
  username: string;
  nama: string;
  nomor_wa: string | null;
  departemen_diminta: string;
  alasan: string | null;
  status: "menunggu" | "disetujui" | "ditolak";
  catatan: string | null;
  dibuat: string;
  /** Sudah ada akun dengan username ini? Dihitung saat meninjau. */
  bentrok: boolean;
};

let kolam: mysql.Pool | undefined;

function pool(): mysql.Pool {
  if (!kolam) {
    const user = process.env.PORTAL_ADMIN_DB_USER;
    if (!user) {
      throw new Error(
        "PORTAL_ADMIN_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/portal/10_admin.sql sebagai root.",
      );
    }
    kolam = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_ADMIN_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: 2,
      multipleStatements: false,
    });
  }
  return kolam;
}

/**
 * Sampai mana orang ini boleh menyetujui?
 *
 * `cakupan: null` = semua departemen (admin). `cakupan: "hr"` = HR saja.
 *
 * ⚠️ KEPALA DIBATASI KE DEPARTEMENNYA SENDIRI.
 *
 * Kalau tidak, kepala marketing bisa menyetujui pendaftar mana pun sebagai
 * KEPALA HR — dan orang itu langsung dapat akses payroll & semua kolom gaji.
 * Seluruh pemisahan departemen yang diuji 17/17 jebol lewat satu dropdown.
 *
 * Diperiksa ke DATABASE, bukan percaya token. Token memuat `admin` supaya
 * `proxy.ts` bisa menyaring tanpa menyentuh database, tapi hak yang dicabut
 * baru hilang dari token setelah 8 jam. Yang menentukan adalah ini.
 */
export type Hak = { boleh: false } | { boleh: true; cakupan: string | null };

export async function hakPersetujuan(penggunaId: number): Promise<Hak> {
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    "SELECT is_admin, peran, departemen FROM pengguna WHERE id = ? AND aktif = 1 LIMIT 1",
    [penggunaId],
  );
  const p = baris[0];
  if (!p) return { boleh: false };

  if (p.is_admin === 1) return { boleh: true, cakupan: null };
  if (p.peran === "kepala") return { boleh: true, cakupan: p.departemen as string };

  return { boleh: false };
}

/**
 * Boleh mengatur tool AI?
 *
 * ⚠️ DEPARTEMEN IT, dan diperiksa KE DATABASE tiap permintaan.
 *
 * Token sesi memuat `departemen` yang baru berubah setelah 8 jam. Orang yang
 * dipindah keluar dari IT pagi ini masih memegang token lama sampai sore, dan
 * selama itu dia tetap bisa mengubah cakupan tool seluruh portal. Satu query
 * per permintaan jauh lebih murah daripada celah delapan jam.
 *
 * Penanda `is_admin` SENGAJA tidak ikut: admin portal mengurus akun dan
 * pengajuan, bukan setelan agent. Dua hal yang berbeda tidak perlu dijadikan
 * satu hak.
 */
export async function bolehAturAi(penggunaId: number): Promise<boolean> {
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    "SELECT departemen FROM pengguna WHERE id = ? AND aktif = 1 LIMIT 1",
    [penggunaId],
  );
  return baris[0]?.departemen === "it";
}

/**
 * Pengajuan untuk ditinjau.
 *
 * Bentrokan username dihitung DI SINI, bukan di halaman pendaftaran —
 * halaman itu sengaja tidak membocorkan username mana yang sudah terdaftar.
 */
export async function daftarPengajuan(
  status = "menunggu",
  cakupan: string | null = null,
): Promise<Pengajuan[]> {
  // Pengajuan di luar cakupan TIDAK DIKIRIM sama sekali, bukan sekadar
  // tombolnya dimatikan -- kepala marketing tidak perlu tahu siapa saja yang
  // mendaftar ke HR.
  const [baris] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT d.id, d.username, d.nama, d.nomor_wa, d.departemen_diminta,
            d.alasan, d.status, d.catatan, d.dibuat,
            EXISTS(SELECT 1 FROM pengguna p WHERE p.username = d.username) AS bentrok
       FROM pendaftaran d
      WHERE d.status = ?
        AND (? IS NULL OR d.departemen_diminta = ?)
      ORDER BY d.dibuat DESC
      LIMIT 200`,
    [status, cakupan, cakupan],
  );
  return baris.map((b) => ({ ...b, bentrok: Number(b.bentrok) === 1 })) as Pengajuan[];
}

export type HasilPutusan = { ok: true } | { ok: false; pesan: string };

/**
 * Setujui: pindahkan jadi akun sungguhan.
 *
 * `departemen` dan `peran` datang dari ADMIN, bukan dari pengajuan. Yang
 * diminta pendaftar cuma usulan — peran menentukan user MySQL yang dipakai
 * agent, dan itu yang memisahkan siapa boleh melihat gaji.
 */
export async function setujui(
  id: number,
  olehId: number,
  departemen: string,
  peran: string,
  cakupan: string | null,
): Promise<HasilPutusan> {
  if (!ambilDepartemen(departemen)) {
    return { ok: false, pesan: `Departemen "${departemen}" tidak dikenal sistem.` };
  }
  // ⚠️ Ditegakkan DI SINI, bukan cuma dengan mengunci dropdown di halaman.
  // Tampilan tidak menahan apa pun terhadap curl.
  if (cakupan !== null && departemen !== cakupan) {
    return {
      ok: false,
      pesan: `Kamu cuma bisa menyetujui untuk departemen ${cakupan}.`,
    };
  }
  if (!(PERAN_SAH as readonly string[]).includes(peran)) {
    return { ok: false, pesan: `Peran "${peran}" tidak sah.` };
  }

  const c = await pool().getConnection();
  try {
    // Satu transaksi: kalau INSERT akun berhasil tapi penandaan pengajuan
    // gagal, pengajuan yang sama bisa disetujui dua kali.
    await c.beginTransaction();

    const [baris] = await c.query<mysql.RowDataPacket[]>(
      "SELECT username, password_hash, nama, status FROM pendaftaran WHERE id = ? FOR UPDATE",
      [id],
    );
    const d = baris[0];
    if (!d) {
      await c.rollback();
      return { ok: false, pesan: "Pengajuan tidak ditemukan." };
    }
    if (d.status !== "menunggu") {
      await c.rollback();
      return { ok: false, pesan: `Pengajuan ini sudah ${d.status}.` };
    }

    // Diperiksa DI DALAM transaksi: antara halaman dimuat dan tombol ditekan,
    // username yang sama bisa sudah dipakai lewat pengajuan lain.
    const [sudah] = await c.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM pengguna WHERE username = ? LIMIT 1",
      [d.username],
    );
    if (sudah.length) {
      await c.rollback();
      return {
        ok: false,
        pesan: `Username "${d.username}" sudah dipakai akun lain. Tolak pengajuan ini dan minta pendaftar memakai username berbeda.`,
      };
    }

    await c.query(
      `INSERT INTO pengguna (username, password_hash, nama, departemen, peran, aktif)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [d.username, d.password_hash, d.nama, departemen, peran],
    );
    await c.query(
      "UPDATE pendaftaran SET status='disetujui', diputuskan=NOW(), oleh=? WHERE id = ?",
      [olehId, id],
    );

    await c.commit();
    return { ok: true };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Tolak. Catatan alasannya disimpan supaya keputusan bisa ditelusuri.
 *
 * Cakupan ikut dipasang di WHERE: menolak pengajuan departemen lain sama
 * saja ikut campur, dan lewat curl id-nya gampang ditebak.
 */
export async function tolak(
  id: number,
  olehId: number,
  catatan: string,
  cakupan: string | null,
): Promise<HasilPutusan> {
  const [hasil] = await pool().query<mysql.ResultSetHeader>(
    `UPDATE pendaftaran SET status='ditolak', catatan=?, diputuskan=NOW(), oleh=?
      WHERE id = ? AND status='menunggu'
        AND (? IS NULL OR departemen_diminta = ?)`,
    [catatan.slice(0, 255) || null, olehId, id, cakupan, cakupan],
  );
  return hasil.affectedRows > 0
    ? { ok: true }
    : { ok: false, pesan: "Pengajuan tidak ditemukan atau sudah diputuskan." };
}
