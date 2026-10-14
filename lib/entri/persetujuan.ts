/**
 * Persetujuan lembur (HR-5).
 *
 * ⚠️ YANG BERUBAH CUMA KOLOM `status`. Tidak ada yang lain.
 *
 * `lembur` tidak punya kolom approver, jadi siapa yang menyetujui tercatat di
 * `entri_log` — lewat `username` dan `peran`, bukan di tabel datanya. Itu
 * bukan kekurangan: jejak audit memang tempat yang tepat untuk itu, dan tidak
 * perlu izin tulis tambahan di tabel `lembur`.
 *
 * ⚠️ `cuti` SENGAJA TIDAK ADA DI SINI.
 *
 * Di data, cuti disetujui ATASAN LANGSUNG pemohon (458 dari 465 baris), bukan
 * kepala HR. Dan `cuti.approver_id` menuntut id karyawan, sementara
 * `portal.pengguna` tidak punya kaitan apa pun ke `hr.karyawan` — nama akun
 * pun tidak ada di tabel karyawan. Mengisinya NULL akan menyimpang dari 458
 * baris yang ada; mencocokkan lewat nama tidak bisa dipercaya karena nama
 * karyawan terbukti tidak unik.
 *
 * ⚠️ KEPALA BOLEH MENYETUJUI LEMBUR YANG DIA ENTRI SENDIRI.
 *
 * Itu keputusan sadar, bukan kelalaian: kepala satu-satunya peran yang boleh
 * mengentri lembur, jadi melarang persetujuan-sendiri membuat alurnya tidak
 * bisa dipakai sama sekali. Yang menjaga: `entri_log` mencatat DUA baris
 * (ENTRI lalu SETUJU/TOLAK) dengan nama yang sama, jadi terlihat kalau
 * ditelusuri.
 */
import type mysql from "mysql2/promise";
import { poolEntriHr } from "./db-hr";
import type { KonteksEntri } from "./simpan";

export type Keputusan = "APPROVED" | "REJECTED";

/** Status yang masih bisa diputuskan. Yang sudah diputus tidak diulang. */
const STATUS_MENUNGGU = "PENDING";

const MAKS_CATATAN = 255;

export type LemburMenunggu = {
  id: number;
  karyawan: { nik: string; nama: string; departemen: string; jabatan: string };
  tanggal: string;
  jam: number;
  alasan: string;
  status: string;
  nilaiRp: number;
};

export type SebabTolakSetuju =
  | "tidak-ketemu"
  | "sudah-diputus"
  | "keputusan-tidak-sah"
  | "catatan-kurang";

export type HasilDrafSetuju =
  | { ok: true; lembur: LemburMenunggu }
  | { ok: false; sebab: SebabTolakSetuju; pesan: string };

export type HasilSetuju =
  | { ok: true; id: number; keputusan: Keputusan; lembur: LemburMenunggu }
  | { ok: false; sebab: SebabTolakSetuju; pesan: string };

async function ambilLembur(
  c: mysql.PoolConnection,
  id: number,
): Promise<mysql.RowDataPacket | undefined> {
  const [baris] = await c.query<mysql.RowDataPacket[]>(
    `SELECT l.id, l.status, l.jam, l.alasan, l.nilai_rp,
            DATE_FORMAT(l.tanggal, '%Y-%m-%d') AS tanggal,
            k.nik, k.nama,
            COALESCE(d.nama, '-') AS departemen,
            COALESCE(j.nama, '-') AS jabatan
       FROM lembur l
       JOIN karyawan k ON k.id = l.karyawan_id
       LEFT JOIN departemen d ON d.id = k.departemen_id
       LEFT JOIN jabatan    j ON j.id = k.jabatan_id
      WHERE l.id = ?
      LIMIT 1`,
    [id],
  );
  return baris[0];
}

const jadiLembur = (b: mysql.RowDataPacket): LemburMenunggu => ({
  id: Number(b.id),
  karyawan: {
    nik: String(b.nik),
    nama: String(b.nama),
    departemen: String(b.departemen),
    jabatan: String(b.jabatan),
  },
  tanggal: String(b.tanggal),
  jam: Number(b.jam),
  alasan: String(b.alasan ?? ""),
  status: String(b.status),
  nilaiRp: Number(b.nilai_rp),
});

/**
 * Daftar lembur yang masih menunggu keputusan.
 *
 * Dipakai tool supaya kepala bisa bertanya "lembur mana yang belum saya
 * setujui" tanpa harus tahu id-nya.
 */
export async function lemburMenunggu(batas = 20): Promise<LemburMenunggu[]> {
  const c = await poolEntriHr().getConnection();
  try {
    const [baris] = await c.query<mysql.RowDataPacket[]>(
      `SELECT l.id, l.status, l.jam, l.alasan, l.nilai_rp,
              DATE_FORMAT(l.tanggal, '%Y-%m-%d') AS tanggal,
              k.nik, k.nama,
              COALESCE(d.nama, '-') AS departemen,
              COALESCE(j.nama, '-') AS jabatan
         FROM lembur l
         JOIN karyawan k ON k.id = l.karyawan_id
         LEFT JOIN departemen d ON d.id = k.departemen_id
         LEFT JOIN jabatan    j ON j.id = k.jabatan_id
        WHERE l.status = ?
        ORDER BY l.tanggal DESC, l.id DESC
        LIMIT ?`,
      [STATUS_MENUNGGU, Math.min(Math.max(1, batas), 50)],
    );
    return baris.map(jadiLembur);
  } finally {
    c.release();
  }
}

function periksa(baris: mysql.RowDataPacket | undefined) {
  if (!baris) return { sebab: "tidak-ketemu" as const, pesan: "Lembur dengan id itu tidak ada." };
  if (String(baris.status) !== STATUS_MENUNGGU) {
    return {
      sebab: "sudah-diputus" as const,
      pesan: `Lembur ini sudah ${String(baris.status)}, jadi tidak bisa diputuskan lagi.`,
    };
  }
  return null;
}

/** Tampilkan satu lembur yang akan diputuskan. TIDAK MENGUBAH APA PUN. */
export async function susunDrafSetuju(id: number): Promise<HasilDrafSetuju> {
  const c = await poolEntriHr().getConnection();
  try {
    const baris = await ambilLembur(c, id);
    const tolak = periksa(baris);
    if (tolak) return { ok: false, ...tolak };
    return { ok: true, lembur: jadiLembur(baris!) };
  } finally {
    c.release();
  }
}

/**
 * Putuskan satu lembur. SATU-SATUNYA jalur yang mengubah statusnya.
 *
 * Dipicu tombol/balasan user, bukan model.
 */
export async function putuskanLembur(
  id: number,
  keputusan: Keputusan,
  catatan: string | undefined,
  ctx: KonteksEntri,
): Promise<HasilSetuju> {
  if (keputusan !== "APPROVED" && keputusan !== "REJECTED") {
    return { ok: false, sebab: "keputusan-tidak-sah", pesan: "Keputusan harus APPROVED atau REJECTED." };
  }

  // Menolak tanpa alasan tidak berguna untuk siapa pun yang membacanya nanti.
  // Menyetujui tidak butuh catatan.
  const teks = (catatan ?? "").trim();
  if (keputusan === "REJECTED" && teks.length < 5) {
    return { ok: false, sebab: "catatan-kurang", pesan: "Alasan penolakan wajib diisi, minimal 5 karakter." };
  }

  const c = await poolEntriHr().getConnection();
  try {
    await c.beginTransaction();

    // Diperiksa ULANG di dalam transaksi: keadaannya bisa berubah antara
    // "lihat daftar" dan "tekan tombol".
    const baris = await ambilLembur(c, id);
    const tolak = periksa(baris);
    if (tolak) {
      await c.rollback();
      return { ok: false, ...tolak };
    }
    const lembur = jadiLembur(baris!);

    // `AND status = 'PENDING'` bukan hiasan: dua keputusan serentak untuk
    // baris yang sama membuat yang kedua menyentuh 0 baris dan ditolak di
    // sini -- tanpa itu, jejaknya jadi dobel untuk satu keputusan.
    const [hasil] = await c.query<mysql.ResultSetHeader>(
      "UPDATE lembur SET status = ? WHERE id = ? AND status = ?",
      [keputusan, id, STATUS_MENUNGGU],
    );
    if (hasil.affectedRows !== 1) {
      await c.rollback();
      return { ok: false, sebab: "sudah-diputus", pesan: "Lembur ini baru saja diputuskan." };
    }

    await c.query(
      `INSERT INTO entri_log
         (entitas, aksi, ref_id, ref_kode, pengguna_id, username, departemen, peran, asal, permintaan, alasan, ringkasan)
       VALUES ('lembur', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        keputusan === "APPROVED" ? "SETUJU" : "TOLAK",
        id,
        lembur.karyawan.nik,
        ctx.penggunaId,
        ctx.username,
        ctx.departemen,
        ctx.peran,
        ctx.asal,
        ctx.permintaan?.slice(0, 1000) ?? null,
        teks === "" ? null : teks.slice(0, MAKS_CATATAN),
        JSON.stringify({ ...lembur, status: keputusan }),
      ],
    );

    await c.commit();
    return { ok: true, id, keputusan, lembur: { ...lembur, status: keputusan } };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function lemburJadiTeks(l: LemburMenunggu): string {
  return [
    `#${l.id} — ${l.karyawan.nama} (${l.karyawan.nik})`,
    `Bagian    : ${l.karyawan.departemen} — ${l.karyawan.jabatan}`,
    `Tanggal   : ${l.tanggal}`,
    `Lama      : ${l.jam} jam`,
    `Alasan    : ${l.alasan}`,
    `Nilai     : ${rp(l.nilaiRp)}`,
    `Status    : ${l.status}`,
  ].join("\n");
}

export function daftarJadiTeks(daftar: LemburMenunggu[]): string {
  if (daftar.length === 0) return "Tidak ada lembur yang menunggu persetujuan.";
  return daftar
    .map((l) => `#${l.id}  ${l.tanggal}  ${l.karyawan.nama}  ${l.jam} jam  ${rp(l.nilaiRp)}`)
    .join("\n");
}
