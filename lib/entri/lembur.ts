/**
 * Entri lembur (HR-2). Menyusun draf DAN menyimpannya.
 *
 * ⚠️ NILAI RUPIAH TIDAK PERNAH DIKETIK MANUSIA.
 *
 * `nilai_rp` turunan dari `karyawan.gaji_pokok`. Diperiksa pada 585 baris yang
 * sudah ada, dan rumus ini cocok untuk SEMUANYA:
 *
 *     nilai_rp = ROUND(jam * 1.8 * gaji_pokok / 173, -2)
 *
 * ⚠️ PEMBULATANNYA KE RATUSAN, DAN ITU BUKAN DETAIL SEPELE.
 * `ROUND(..., -2)` cocok 585/585. Pembulatan biasa `ROUND(...)` cocok **0/585**
 * — salah di setiap baris. Karena itu perhitungannya diserahkan ke MySQL, bukan
 * ditulis ulang di JavaScript: `Math.round` juga beda perilaku di nilai .5.
 *
 * ⚠️ Yang boleh mengentri lembur cuma KEPALA HR — diatur di
 * `voltagent/departemen/hr/index.ts`, bukan di sini.
 */
import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import { poolEntriHr } from "./db-hr";
import type { KonteksEntri } from "./simpan";

/**
 * Batas jam lembur per hari.
 *
 * 4 jam mengikuti batas yang dipakai data yang ada (nilai yang muncul: 1.0,
 * 1.5, 2.0, 2.5, 3.0, 4.0) dan juga batas lembur harian di aturan
 * ketenagakerjaan. Kelipatan 0,5 karena kolomnya `DECIMAL(4,1)`.
 */
export const JAM_MIN = 0.5;
export const JAM_MAKS = 4;

/**
 * Sejauh apa tanggal boleh mundur.
 *
 * Bukan aturan HR, tapi penjaga salah ketik: "2025-09-27" alih-alih
 * "2026-09-27" lolos begitu saja tanpa batas ini, dan lembur setahun lalu
 * tidak akan pernah disadari siapa pun.
 */
export const HARI_MUNDUR_MAKS = 90;

/**
 * Level jabatan yang BERHAK upah lembur.
 *
 * Sengaja daftar yang BOLEH, bukan daftar yang dilarang. Level baru yang belum
 * dikenal otomatis TIDAK berhak, dan seseorang harus sadar menambahkannya ke
 * sini. Untuk aturan yang menulis angka uang, gagal-menolak lebih aman
 * daripada gagal-mengizinkan.
 *
 * Dasarnya data yang ada, dan pemisahannya sempurna:
 *
 *   Staff       153 orang, 251 baris lembur
 *   Operator     64 orang, 285 baris
 *   Supervisor   21 orang,  49 baris
 *   Manager      12 orang,   0 baris   <- tidak berhak
 *   General Manager 3 orang, 0 baris   <- tidak berhak
 *   Direktur      1 orang,   0 baris   <- tidak berhak
 *
 * Sejalan dengan aturan ketenagakerjaan: golongan jabatan dengan tanggung
 * jawab merencanakan/mengendalikan tidak berhak upah lembur.
 */
export const LEVEL_BERHAK_LEMBUR = ["Staff", "Operator", "Supervisor"];

const MIN_ALASAN = 5;
const MAKS_ALASAN = 255;

export type PermintaanLembur = {
  karyawan: string;
  jam: number;
  /** `YYYY-MM-DD`. Kosong = hari ini. */
  tanggal?: string;
  alasan: string;
};

export type KaryawanDraf = {
  id: number;
  nik: string;
  nama: string;
  departemen: string;
  jabatan: string;
  /** Level jabatan -- yang menentukan berhak lembur atau tidak. */
  level: string;
};

export type DrafLembur = {
  karyawan: KaryawanDraf;
  tanggal: string;
  jam: number;
  alasan: string;
  status: string;
  nilaiRp: number;
};

export type MasalahLembur =
  | { jenis: "karyawan-tidak-ketemu"; nama: string }
  | { jenis: "karyawan-ambigu"; nama: string; pilihan: KaryawanDraf[] }
  | { jenis: "karyawan-tidak-aktif"; nama: string; status: string }
  | { jenis: "jabatan-tidak-berhak"; nama: string; jabatan: string; level: string }
  | { jenis: "jam-tidak-wajar"; jam: unknown }
  | { jenis: "tanggal-tidak-wajar"; tanggal: string; sebab: string }
  | { jenis: "alasan-kurang" };

export type HasilDrafLembur =
  | { ok: true; draf: DrafLembur }
  | { ok: false; masalah: MasalahLembur[] };

export type HasilSimpanLembur =
  | { ok: true; id: number; draf: DrafLembur }
  | { ok: false; sebab: "draf-berubah" | "tidak-sah"; pesan: string; masalah?: MasalahLembur[] };

/** Tanggal hari ini `YYYY-MM-DD`, waktu lokal. */
function hariIni(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Cari karyawan dari nama yang diketik user.
 *
 * ⚠️ NAMA KARYAWAN TIDAK UNIK — ada beberapa yang kembar (mis. "Slamet
 * Wijaya" dua orang). Karena itu kecocokan ganda TIDAK pernah ditebak; yang
 * dikembalikan daftar pilihan beserta NIK dan departemennya, dan user yang
 * memilih.
 *
 * `nilai_rp` ikut dihitung di query ini supaya pembulatannya dikerjakan MySQL
 * dengan semantik yang sama persis dengan data yang sudah ada.
 */
async function cariKaryawan(
  c: mysql.PoolConnection,
  nama: string,
  jam: number,
): Promise<mysql.RowDataPacket[]> {
  const bersih = nama.trim();
  const [baris] = await c.query<mysql.RowDataPacket[]>(
    `SELECT k.id, k.nik, k.nama, k.status_kerja,
            COALESCE(d.nama, '-') AS departemen,
            COALESCE(j.nama, '-') AS jabatan,
            COALESCE(j.level, '-') AS level,
            ROUND(? * 1.8 * k.gaji_pokok / 173, -2) AS nilai_rp
       FROM karyawan k
       LEFT JOIN departemen d ON d.id = k.departemen_id
       LEFT JOIN jabatan    j ON j.id = k.jabatan_id
      WHERE k.nama = ? OR k.nik = ? OR k.nama LIKE ?
      ORDER BY (k.nama = ?) DESC, (k.nik = ?) DESC, k.nama
      LIMIT 10`,
    [jam, bersih, bersih, `%${bersih}%`, bersih, bersih],
  );

  // Cocok PERSIS menang: kalau ada yang namanya tepat sama, kecocokan
  // sebagian tidak ikut membuat hasilnya jadi "ambigu".
  const persis = baris.filter(
    (b) => String(b.nama).toLowerCase() === bersih.toLowerCase() || String(b.nik) === bersih,
  );
  return persis.length > 0 ? persis : baris;
}

const jadiKaryawan = (b: mysql.RowDataPacket): KaryawanDraf => ({
  id: Number(b.id),
  nik: String(b.nik),
  nama: String(b.nama),
  departemen: String(b.departemen),
  jabatan: String(b.jabatan),
  level: String(b.level),
});

/** Pemeriksaan yang tidak butuh database. Dikumpulkan SEMUA, bukan berhenti di yang pertama. */
function periksaDasar(p: PermintaanLembur): MasalahLembur[] {
  const masalah: MasalahLembur[] = [];

  const jam = Number(p.jam);
  if (!Number.isFinite(jam) || jam < JAM_MIN || jam > JAM_MAKS || (jam * 2) % 1 !== 0) {
    masalah.push({ jenis: "jam-tidak-wajar", jam: p.jam });
  }

  if ((p.alasan ?? "").trim().length < MIN_ALASAN) {
    masalah.push({ jenis: "alasan-kurang" });
  }

  const tanggal = (p.tanggal ?? "").trim() || hariIni();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    masalah.push({ jenis: "tanggal-tidak-wajar", tanggal, sebab: "formatnya harus YYYY-MM-DD" });
  } else {
    const hari = (Date.parse(`${hariIni()}T00:00:00`) - Date.parse(`${tanggal}T00:00:00`)) / 86_400_000;
    if (Number.isNaN(hari)) {
      masalah.push({ jenis: "tanggal-tidak-wajar", tanggal, sebab: "tanggalnya tidak ada" });
    } else if (hari < 0) {
      // Lembur dicatat SETELAH terjadi. Tanggal ke depan berarti salah ketik
      // atau penjadwalan -- dua-duanya bukan yang dicatat di tabel ini.
      masalah.push({ jenis: "tanggal-tidak-wajar", tanggal, sebab: "belum terjadi (tanggal ke depan)" });
    } else if (hari > HARI_MUNDUR_MAKS) {
      masalah.push({
        jenis: "tanggal-tidak-wajar",
        tanggal,
        sebab: `lebih dari ${HARI_MUNDUR_MAKS} hari yang lalu — periksa lagi tahunnya`,
      });
    }
  }

  return masalah;
}

/** Susun draf lembur. TIDAK MENULIS APA PUN. */
export async function susunDrafLembur(p: PermintaanLembur): Promise<HasilDrafLembur> {
  const masalah = periksaDasar(p);

  const c = await poolEntriHr().getConnection();
  try {
    const nama = (p.karyawan ?? "").trim();
    if (nama === "") {
      masalah.push({ jenis: "karyawan-tidak-ketemu", nama: "" });
      return { ok: false, masalah };
    }

    // Jam dipakai query untuk menghitung nilai_rp. Kalau jamnya sendiri tidak
    // wajar, angkanya tidak dipakai -- drafnya memang tidak akan jadi.
    const jam = Number(p.jam);
    const baris = await cariKaryawan(c, nama, Number.isFinite(jam) ? jam : 0);

    if (baris.length === 0) {
      masalah.push({ jenis: "karyawan-tidak-ketemu", nama });
      return { ok: false, masalah };
    }
    if (baris.length > 1) {
      masalah.push({ jenis: "karyawan-ambigu", nama, pilihan: baris.map(jadiKaryawan) });
      return { ok: false, masalah };
    }

    const k = baris[0];
    if (String(k.status_kerja) !== "AKTIF") {
      masalah.push({
        jenis: "karyawan-tidak-aktif",
        nama: String(k.nama),
        status: String(k.status_kerja),
      });
    }

    if (!LEVEL_BERHAK_LEMBUR.includes(String(k.level))) {
      masalah.push({
        jenis: "jabatan-tidak-berhak",
        nama: String(k.nama),
        jabatan: String(k.jabatan),
        level: String(k.level),
      });
    }

    if (masalah.length > 0) return { ok: false, masalah };

    return {
      ok: true,
      draf: {
        karyawan: jadiKaryawan(k),
        tanggal: (p.tanggal ?? "").trim() || hariIni(),
        jam,
        alasan: p.alasan.trim().slice(0, MAKS_ALASAN),
        status: "PENDING",
        nilaiRp: Number(k.nilai_rp),
      },
    };
  } finally {
    c.release();
  }
}

/**
 * Sidik draf — memastikan yang disimpan sama dengan yang dilihat user.
 *
 * `nilaiRp` ikut dihitung: kalau gaji karyawan berubah antara "lihat draf" dan
 * "tekan simpan", angkanya ikut berubah dan konfirmasinya jadi tidak berlaku.
 */
export function sidikDrafLembur(d: DrafLembur): string {
  const inti = JSON.stringify({
    k: d.karyawan.id,
    n: d.karyawan.nama,
    t: d.tanggal,
    j: d.jam,
    a: d.alasan,
    s: d.status,
    v: d.nilaiRp,
  });
  return createHash("sha256").update(inti).digest("hex").slice(0, 16);
}

/**
 * Simpan lembur. SATU-SATUNYA jalur tulis untuk entitas ini.
 *
 * ⚠️ Draf dari klien TIDAK dipercaya: yang dikirim cuma permintaan aslinya
 * plus SIDIK draf yang dilihat user. Server menyusun ulang drafnya sendiri
 * lalu membandingkan sidiknya. Kalau draf jadi diterima mentah, siapa pun bisa
 * mengirim nilai rupiah karangan lewat curl.
 */
export async function simpanLembur(
  permintaan: PermintaanLembur,
  sidikHarapan: string,
  ctx: KonteksEntri,
): Promise<HasilSimpanLembur> {
  const hasil = await susunDrafLembur(permintaan);
  if (!hasil.ok) {
    return { ok: false, sebab: "tidak-sah", pesan: "Draf tidak bisa disusun.", masalah: hasil.masalah };
  }

  const draf = hasil.draf;
  if (sidikDrafLembur(draf) !== sidikHarapan) {
    return {
      ok: false,
      sebab: "draf-berubah",
      pesan:
        "Data berubah sejak draf ditampilkan (mis. gaji karyawan diperbarui). " +
        "Lihat drafnya sekali lagi sebelum menyimpan.",
    };
  }

  const c = await poolEntriHr().getConnection();
  try {
    await c.beginTransaction();

    const [baris] = await c.query<mysql.ResultSetHeader>(
      `INSERT INTO lembur (karyawan_id, tanggal, jam, alasan, status, nilai_rp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [draf.karyawan.id, draf.tanggal, draf.jam, draf.alasan, draf.status, draf.nilaiRp],
    );
    const id = baris.insertId;

    // Jejak audit di transaksi yang SAMA. Kalau ini gagal, lemburnya ikut
    // dibatalkan -- data tanpa jejak lebih buruk daripada tidak ada data.
    await c.query(
      `INSERT INTO entri_log
         (entitas, aksi, ref_id, ref_kode, pengguna_id, username, departemen, peran, asal, permintaan, ringkasan)
       VALUES ('lembur', 'ENTRI', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        draf.karyawan.nik,
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

/** Draf sebagai teks — untuk agent dan WhatsApp. */
export function drafLemburJadiTeks(d: DrafLembur): string {
  return [
    `Karyawan  : ${d.karyawan.nama} (${d.karyawan.nik})`,
    `Bagian    : ${d.karyawan.departemen} — ${d.karyawan.jabatan}`,
    `Tanggal   : ${d.tanggal}`,
    `Lama      : ${d.jam} jam`,
    `Alasan    : ${d.alasan}`,
    `Status    : ${d.status}`,
    "",
    `Nilai     : ${rp(d.nilaiRp)}`,
  ].join("\n");
}

/** Masalah sebagai teks yang bisa ditindaklanjuti user. */
export function masalahLemburJadiTeks(m: MasalahLembur[]): string {
  return m
    .map((x) => {
      switch (x.jenis) {
        case "karyawan-tidak-ketemu":
          return x.nama === ""
            ? "Nama karyawannya belum disebut."
            : `Karyawan "${x.nama}" tidak ada di data.`;
        case "karyawan-ambigu":
          return [
            `Ada ${x.pilihan.length} karyawan yang cocok dengan "${x.nama}":`,
            ...x.pilihan.map((p) => `  • ${p.nama} (${p.nik}) — ${p.departemen}, ${p.jabatan}`),
            "Sebutkan NIK-nya supaya tidak salah orang.",
          ].join("\n");
        case "karyawan-tidak-aktif":
          return `${x.nama} sudah tidak aktif (${x.status}), jadi tidak bisa dicatat lembur.`;
        case "jabatan-tidak-berhak":
          return (
            `${x.nama} menjabat sebagai ${x.jabatan} (level ${x.level}), ` +
            `dan level itu tidak berhak upah lembur. ` +
            `Yang berhak: ${LEVEL_BERHAK_LEMBUR.join(", ")}.`
          );
        case "jam-tidak-wajar":
          return `Lama lembur "${x.jam}" tidak wajar. Isi antara ${JAM_MIN} dan ${JAM_MAKS} jam, kelipatan 0,5.`;
        case "tanggal-tidak-wajar":
          return `Tanggal ${x.tanggal} tidak bisa dipakai: ${x.sebab}.`;
        case "alasan-kurang":
          return `Alasan lembur wajib diisi, minimal ${MIN_ALASAN} karakter.`;
      }
    })
    .join("\n");
}
