/**
 * Entri pelamar (HR-4). Menyusun draf DAN menyimpannya.
 *
 * ⚠️ Yang boleh mengentri pelamar cuma STAF HR — diatur di
 * `voltagent/departemen/hr/index.ts`, bukan di sini.
 *
 * Berbeda dengan `lembur.ts`, berkas ini TIDAK menyentuh gaji sama sekali.
 * Itu alasan utama pelamar dipilih sebagai entri untuk staf: staf HR memang
 * tidak boleh melihat gaji, dan di sini memang tidak ada yang perlu dilihat.
 *
 * ⚠️ Pelamar adalah orang BARU — namanya diketik apa adanya, tidak dicocokkan
 * ke database. Yang diresolusi cuma lowongannya.
 */
import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import { poolEntriHr } from "./db-hr";
import type { KonteksEntri } from "./simpan";

/**
 * Daftar tertutup, diambil dari data yang ada:
 *   pendidikan: S1=191, SMA/SMK=164, D3=84, S2=15
 *   sumber: JobStreet=168, LinkedIn=92, Referral=83, Kampus=60, Walk-in=51
 *
 * Bukan `string` bebas: nilai baru yang cuma beda ejaan ("Jobstreet",
 * "LINKEDIN") membuat laporan per sumber pecah diam-diam, dan tidak ada yang
 * menyadarinya sampai angkanya dipakai.
 */
export const PENDIDIKAN = ["SMA/SMK", "D3", "S1", "S2"];
export const SUMBER = ["JobStreet", "LinkedIn", "Referral", "Kampus", "Walk-in"];

/** Tahap pertama seleksi. Pelamar baru selalu masuk ke sini. */
export const STATUS_AWAL = "SCREENING";

/** Data nyata 0-9 tahun. Batas atas ini cuma penjaga salah ketik. */
export const PENGALAMAN_MAKS = 50;

export const HARI_MUNDUR_MAKS = 90;
const MIN_NAMA = 3;

export type PermintaanPelamar = {
  /** Kode lowongan, mis. "LOW-2026-014". */
  lowongan: string;
  nama: string;
  email: string;
  telepon?: string;
  pendidikan: string;
  pengalaman: number;
  sumber: string;
  /** `YYYY-MM-DD`. Kosong = hari ini. */
  tanggal?: string;
};

export type LowonganDraf = {
  id: number;
  kode: string;
  jabatan: string;
  departemen: string;
  tanggalTutup: string;
};

export type DrafPelamar = {
  lowongan: LowonganDraf;
  nama: string;
  email: string;
  telepon: string | null;
  pendidikan: string;
  pengalaman: number;
  sumber: string;
  tanggalLamar: string;
  status: string;
};

export type MasalahPelamar =
  | { jenis: "lowongan-tidak-ketemu"; kode: string; terbuka: string[] }
  | { jenis: "lowongan-tutup"; kode: string; status: string; tanggalTutup: string }
  | { jenis: "nama-kurang" }
  | { jenis: "email-tidak-sah"; email: string }
  | { jenis: "email-sudah-ada"; email: string; kode: string }
  | { jenis: "pendidikan-tidak-dikenal"; nilai: string }
  | { jenis: "sumber-tidak-dikenal"; nilai: string }
  | { jenis: "pengalaman-tidak-wajar"; nilai: unknown }
  | { jenis: "tanggal-tidak-wajar"; tanggal: string; sebab: string };

export type HasilDrafPelamar =
  | { ok: true; draf: DrafPelamar }
  | { ok: false; masalah: MasalahPelamar[] };

export type HasilSimpanPelamar =
  | { ok: true; id: number; draf: DrafPelamar }
  | { ok: false; sebab: "draf-berubah" | "tidak-sah"; pesan: string; masalah?: MasalahPelamar[] };

function hariIni(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Cukup untuk menangkap salah ketik; bukan validasi RFC. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Cocokkan tanpa peduli besar-kecil huruf, tapi simpan ejaan RESMI dari daftar. */
function samakan(daftar: string[], nilai: unknown): string | null {
  if (typeof nilai !== "string") return null;
  const bersih = nilai.trim().toLowerCase();
  return daftar.find((x) => x.toLowerCase() === bersih) ?? null;
}

async function cariLowongan(
  c: mysql.PoolConnection,
  kode: string,
): Promise<mysql.RowDataPacket | undefined> {
  const [baris] = await c.query<mysql.RowDataPacket[]>(
    `SELECT l.id, l.kode, l.status,
            DATE_FORMAT(l.tanggal_tutup, '%Y-%m-%d') AS tanggal_tutup,
            COALESCE(j.nama, '-') AS jabatan,
            COALESCE(d.nama, '-') AS departemen
       FROM lowongan l
       LEFT JOIN jabatan    j ON j.id = l.jabatan_id
       LEFT JOIN departemen d ON d.id = l.departemen_id
      WHERE l.kode = ?
      LIMIT 1`,
    [kode.trim().toUpperCase()],
  );
  return baris[0];
}

/** Lowongan yang benar-benar masih menerima pelamar hari ini. */
async function lowonganTerbuka(c: mysql.PoolConnection): Promise<string[]> {
  const [baris] = await c.query<mysql.RowDataPacket[]>(
    `SELECT kode FROM lowongan
      WHERE status = 'OPEN' AND tanggal_tutup >= CURDATE()
      ORDER BY kode`,
  );
  return baris.map((b) => String(b.kode));
}

/** Susun draf pelamar. TIDAK MENULIS APA PUN. */
export async function susunDrafPelamar(p: PermintaanPelamar): Promise<HasilDrafPelamar> {
  const masalah: MasalahPelamar[] = [];

  const nama = (p.nama ?? "").trim();
  if (nama.length < MIN_NAMA) masalah.push({ jenis: "nama-kurang" });

  const email = (p.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) masalah.push({ jenis: "email-tidak-sah", email });

  const pendidikan = samakan(PENDIDIKAN, p.pendidikan);
  if (!pendidikan) {
    masalah.push({ jenis: "pendidikan-tidak-dikenal", nilai: String(p.pendidikan ?? "") });
  }

  const sumber = samakan(SUMBER, p.sumber);
  if (!sumber) {
    masalah.push({ jenis: "sumber-tidak-dikenal", nilai: String(p.sumber ?? "") });
  }

  const pengalaman = Number(p.pengalaman);
  if (!Number.isInteger(pengalaman) || pengalaman < 0 || pengalaman > PENGALAMAN_MAKS) {
    masalah.push({ jenis: "pengalaman-tidak-wajar", nilai: p.pengalaman });
  }

  const tanggal = (p.tanggal ?? "").trim() || hariIni();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    masalah.push({ jenis: "tanggal-tidak-wajar", tanggal, sebab: "formatnya harus YYYY-MM-DD" });
  } else {
    const hari = (Date.parse(`${hariIni()}T00:00:00`) - Date.parse(`${tanggal}T00:00:00`)) / 86_400_000;
    if (Number.isNaN(hari)) {
      masalah.push({ jenis: "tanggal-tidak-wajar", tanggal, sebab: "tanggalnya tidak ada" });
    } else if (hari < 0) {
      masalah.push({ jenis: "tanggal-tidak-wajar", tanggal, sebab: "belum terjadi (tanggal ke depan)" });
    } else if (hari > HARI_MUNDUR_MAKS) {
      masalah.push({
        jenis: "tanggal-tidak-wajar",
        tanggal,
        sebab: `lebih dari ${HARI_MUNDUR_MAKS} hari yang lalu — periksa lagi tahunnya`,
      });
    }
  }

  const c = await poolEntriHr().getConnection();
  try {
    const kode = (p.lowongan ?? "").trim().toUpperCase();
    const low = kode === "" ? undefined : await cariLowongan(c, kode);

    if (!low) {
      masalah.push({ jenis: "lowongan-tidak-ketemu", kode, terbuka: await lowonganTerbuka(c) });
      return { ok: false, masalah };
    }

    // ⚠️ Status SAJA tidak cukup: ada lowongan berstatus OPEN yang tanggal
    // tutupnya sudah lewat (LOW-2026-013, tutup 22 Sep 2026).
    const tutup = String(low.tanggal_tutup);
    if (String(low.status) !== "OPEN" || tutup < hariIni()) {
      masalah.push({
        jenis: "lowongan-tutup",
        kode: String(low.kode),
        status: String(low.status),
        tanggalTutup: tutup,
      });
    }

    if (EMAIL.test(email)) {
      const [dobel] = await c.query<mysql.RowDataPacket[]>(
        "SELECT id FROM pelamar WHERE lowongan_id = ? AND LOWER(email) = ? LIMIT 1",
        [low.id, email],
      );
      // Orang yang sama melamar ke lowongan BERBEDA itu wajar dan ada di data,
      // jadi yang diperiksa pasangan (lowongan, email) -- bukan emailnya saja.
      if (dobel.length > 0) {
        masalah.push({ jenis: "email-sudah-ada", email, kode: String(low.kode) });
      }
    }

    if (masalah.length > 0) return { ok: false, masalah };

    const telepon = (p.telepon ?? "").trim();
    return {
      ok: true,
      draf: {
        lowongan: {
          id: Number(low.id),
          kode: String(low.kode),
          jabatan: String(low.jabatan),
          departemen: String(low.departemen),
          tanggalTutup: tutup,
        },
        nama,
        email,
        telepon: telepon === "" ? null : telepon,
        pendidikan: pendidikan!,
        pengalaman,
        sumber: sumber!,
        tanggalLamar: tanggal,
        status: STATUS_AWAL,
      },
    };
  } finally {
    c.release();
  }
}

export function sidikDrafPelamar(d: DrafPelamar): string {
  const inti = JSON.stringify({
    l: d.lowongan.id,
    n: d.nama,
    e: d.email,
    t: d.telepon,
    p: d.pendidikan,
    x: d.pengalaman,
    s: d.sumber,
    tg: d.tanggalLamar,
    st: d.status,
  });
  return createHash("sha256").update(inti).digest("hex").slice(0, 16);
}

/**
 * Simpan pelamar. SATU-SATUNYA jalur tulis untuk entitas ini.
 *
 * Draf dari klien TIDAK dipercaya — disusun ulang di server lalu sidiknya
 * dibandingkan.
 */
export async function simpanPelamar(
  permintaan: PermintaanPelamar,
  sidikHarapan: string,
  ctx: KonteksEntri,
): Promise<HasilSimpanPelamar> {
  const hasil = await susunDrafPelamar(permintaan);
  if (!hasil.ok) {
    return { ok: false, sebab: "tidak-sah", pesan: "Draf tidak bisa disusun.", masalah: hasil.masalah };
  }

  const draf = hasil.draf;
  if (sidikDrafPelamar(draf) !== sidikHarapan) {
    return {
      ok: false,
      sebab: "draf-berubah",
      pesan:
        "Data berubah sejak draf ditampilkan (mis. lowongannya keburu ditutup). " +
        "Lihat drafnya sekali lagi sebelum menyimpan.",
    };
  }

  const c = await poolEntriHr().getConnection();
  try {
    await c.beginTransaction();

    // `karyawan_id` sengaja dibiarkan NULL: itu baru terisi kalau pelamarnya
    // jadi diterima (438 dari 454 baris memang NULL).
    const [baris] = await c.query<mysql.ResultSetHeader>(
      `INSERT INTO pelamar
         (lowongan_id, nama, email, telepon, pendidikan, pengalaman_tahun, sumber, tanggal_lamar, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        draf.lowongan.id,
        draf.nama,
        draf.email,
        draf.telepon,
        draf.pendidikan,
        draf.pengalaman,
        draf.sumber,
        draf.tanggalLamar,
        draf.status,
      ],
    );
    const id = baris.insertId;

    // `ref_kode` diisi kode LOWONGAN, bukan identitas pelamarnya: pelamar
    // tidak punya kode, emailnya bisa lebih panjang dari kolom ini, dan yang
    // paling berguna waktu menelusuri jejak adalah "lamaran untuk posisi apa".
    // Pelamar mana persisnya ditunjuk `ref_id`.
    await c.query(
      `INSERT INTO entri_log
         (entitas, aksi, ref_id, ref_kode, pengguna_id, username, departemen, peran, asal, permintaan, ringkasan)
       VALUES ('pelamar', 'ENTRI', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        draf.lowongan.kode,
        ctx.penggunaId,
        ctx.username,
        ctx.departemen,
        ctx.peran,
        ctx.asal,
        ctx.permintaan?.slice(0, 1000) ?? null,
        JSON.stringify(draf),
      ],
    );

    await c.commit();
    return { ok: true, id, draf };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

export function drafPelamarJadiTeks(d: DrafPelamar): string {
  return [
    `Nama       : ${d.nama}`,
    `Email      : ${d.email}`,
    `Telepon    : ${d.telepon ?? "-"}`,
    `Pendidikan : ${d.pendidikan}`,
    `Pengalaman : ${d.pengalaman} tahun`,
    `Sumber     : ${d.sumber}`,
    "",
    `Lowongan   : ${d.lowongan.kode} — ${d.lowongan.jabatan}`,
    `Bagian     : ${d.lowongan.departemen}`,
    `Tgl lamar  : ${d.tanggalLamar}`,
    `Status     : ${d.status}`,
  ].join("\n");
}

export function masalahPelamarJadiTeks(m: MasalahPelamar[]): string {
  return m
    .map((x) => {
      switch (x.jenis) {
        case "lowongan-tidak-ketemu":
          return x.kode === ""
            ? `Lowongannya belum disebut. Yang masih menerima pelamar: ${x.terbuka.join(", ") || "tidak ada"}.`
            : `Lowongan "${x.kode}" tidak ada. Yang masih menerima pelamar: ${x.terbuka.join(", ") || "tidak ada"}.`;
        case "lowongan-tutup":
          return (
            `Lowongan ${x.kode} sudah tidak menerima pelamar ` +
            `(status ${x.status}, tutup ${x.tanggalTutup}).`
          );
        case "nama-kurang":
          return `Nama pelamar wajib diisi, minimal ${MIN_NAMA} karakter.`;
        case "email-tidak-sah":
          return `Email "${x.email}" tidak berbentuk alamat email.`;
        case "email-sudah-ada":
          return `Email ${x.email} sudah pernah melamar ke ${x.kode}.`;
        case "pendidikan-tidak-dikenal":
          return `Pendidikan "${x.nilai}" tidak dikenal. Pilihannya: ${PENDIDIKAN.join(", ")}.`;
        case "sumber-tidak-dikenal":
          return `Sumber "${x.nilai}" tidak dikenal. Pilihannya: ${SUMBER.join(", ")}.`;
        case "pengalaman-tidak-wajar":
          return `Pengalaman "${x.nilai}" tidak wajar. Isi 0 sampai ${PENGALAMAN_MAKS} tahun, bilangan bulat.`;
        case "tanggal-tidak-wajar":
          return `Tanggal ${x.tanggal} tidak bisa dipakai: ${x.sebab}.`;
      }
    })
    .join("\n");
}
