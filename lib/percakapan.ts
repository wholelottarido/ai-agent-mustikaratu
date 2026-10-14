/**
 * Simpan & baca riwayat percakapan.
 *
 * Pakai user MySQL `portal_app`, yang izin tulisnya terbatas pada tabel
 * operasional: `percakapan`, `pesan`, `pemakaian`, `wa_preferensi`.
 * Tabel `pengguna` sengaja di luar jangkauannya (login memakai
 * `portal_readonly`, persetujuan admin memakai `portal_admin`), jadi celah di
 * kode ini tidak bisa menyentuh daftar akun.
 *
 * ⚠️ SETIAP fungsi di sini menerima `penggunaId` dan memasangnya di WHERE.
 * Jangan pernah mengambil percakapan hanya berdasarkan id-nya -- kalau begitu,
 * `/api/percakapan/5` bisa dipakai membaca percakapan orang lain.
 */
import mysql from "mysql2/promise";
import { poolPortalApp } from "@/lib/db-portal";

export type RingkasPercakapan = {
  id: number;
  judul: string;
  diperbarui: string;
  /** Dari mana percakapan ini dimulai. Ditandai di sidebar supaya user tidak
   *  bingung melihat percakapan yang tidak pernah dia buka di browser. */
  asal: "web" | "wa";
};

export type PesanTersimpan = {
  id: number;
  peran: "user" | "assistant";
  teks: string;
  model: string | null;
  detik: number | null;
  jumlah_query: number | null;
  token_masuk: number | null;
  token_keluar: number | null;
  /** Nama tabel yang dipakai, dipisah koma. */
  sumber: string | null;
  /** SQL yang dijalankan, beberapa query dipisah baris kosong. */
  sql_dipakai: string | null;
  /**
   * Rujukan sumber jawaban. `null` = TIDAK TERCATAT (pesan lama atau kolomnya
   * belum ada), berbeda dari 0 yang berarti "dicatat, dan memang nol".
   *
   * Bedanya penting: pesan lama tidak boleh dilabeli "tidak mengambil data
   * dari database" cuma karena kolomnya belum ada waktu itu.
   */
  jumlah_dokumen: number | null;
  jumlah_kb: number | null;
  jumlah_tiket: number | null;
  /** Kode dokumen SOP, dipisah koma. Untuk tombol buka PDF. */
  sop_dipakai: string | null;
};

/**
 * Apakah kolom rujukan (Tahap 16D) sudah ada di tabel `pesan`?
 *
 * ⚠️ ADA KARENA MIGRASI DIJALANKAN MANUAL SEBAGAI ROOT.
 *
 * Tidak satu pun user di `.env.local` punya ALTER, jadi
 * `db/portal/18_pesan_rujukan.sql` dijalankan terpisah. Di antara kode
 * ter-deploy dan SQL dijalankan ada jeda -- dan tanpa penjagaan ini, SELECT
 * ke kolom yang belum ada membuat SELURUH riwayat percakapan gagal dimuat.
 * Lebih baik kehilangan satu label daripada kehilangan seluruh riwayat.
 *
 * Diperiksa SEKALI lalu disimpan. Boleh dihapus kalau suatu saat yakin semua
 * pemasangan sudah dimigrasi.
 */
let adaKolomRujukan: boolean | undefined;
async function punyaKolomRujukan(): Promise<boolean> {
  if (adaKolomRujukan === undefined) {
    try {
      const [r] = await pool().query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pesan'
            AND COLUMN_NAME = 'sop_dipakai'`,
      );
      adaKolomRujukan = Number(r[0]?.n ?? 0) > 0;
      if (!adaKolomRujukan) {
        console.warn(
          "[percakapan] kolom rujukan belum ada — jalankan db/portal/18_pesan_rujukan.sql. " +
            "Sampai itu, label sumber pada percakapan yang dimuat ulang tidak lengkap.",
        );
      }
    } catch {
      adaKolomRujukan = false;
    }
  }
  return adaKolomRujukan;
}

// Pool dibagi dengan modul lain yang memakai `portal_app` (`pemakaian.ts`,
// `preferensi-wa.ts`) -- lihat `lib/db-portal.ts` untuk alasannya.
const pool = poolPortalApp;

/** Judul dari pertanyaan pertama. Tidak memanggil model -- hemat & instan. */
export function buatJudul(teks: string): string {
  const bersih = teks.replace(/\s+/g, " ").trim();
  if (bersih.length <= 60) return bersih || "Percakapan baru";
  return bersih.slice(0, 57).trimEnd() + "...";
}

export async function daftarPercakapan(
  penggunaId: number,
  departemen: string,
): Promise<RingkasPercakapan[]> {
  const [rows] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT id, judul, diperbarui, asal
       FROM percakapan
      WHERE pengguna_id = ? AND departemen = ?
      ORDER BY diperbarui DESC
      LIMIT 100`,
    [penggunaId, departemen],
  );
  return rows as RingkasPercakapan[];
}

/** Isi percakapan. `null` kalau bukan milik pengguna ini. */
export async function isiPercakapan(
  id: number,
  penggunaId: number,
): Promise<{ judul: string; pesan: PesanTersimpan[] } | null> {
  const [head] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT judul FROM percakapan WHERE id = ? AND pengguna_id = ? LIMIT 1`,
    [id, penggunaId],
  );
  if (head.length === 0) return null;

  const lengkap = await punyaKolomRujukan();
  const kolomRujukan = lengkap
    ? ", jumlah_dokumen, jumlah_kb, jumlah_tiket, sop_dipakai"
    : "";
  const [rows] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT id, peran, teks, model, detik, jumlah_query,
            token_masuk, token_keluar, sumber, sql_dipakai${kolomRujukan}
       FROM pesan WHERE percakapan_id = ? ORDER BY id`,
    [id],
  );
  // Kolom yang belum ada dikembalikan sebagai null, bukan 0 -- "tidak
  // tercatat" dan "memang nol" harus tetap bisa dibedakan di sisi UI.
  const pesan = (rows as mysql.RowDataPacket[]).map((r) => ({
    jumlah_dokumen: null,
    jumlah_kb: null,
    jumlah_tiket: null,
    sop_dipakai: null,
    ...r,
  })) as PesanTersimpan[];
  return { judul: head[0].judul as string, pesan };
}

export type Asal = "web" | "wa";

export async function buatPercakapan(
  penggunaId: number,
  departemen: string,
  judul: string,
  asal: Asal = "web",
): Promise<number> {
  const [hasil] = await pool().query<mysql.ResultSetHeader>(
    `INSERT INTO percakapan (pengguna_id, departemen, judul, asal) VALUES (?, ?, ?, ?)`,
    [penggunaId, departemen, judul, asal],
  );
  return hasil.insertId;
}

/**
 * Percakapan WhatsApp yang masih "berjalan" untuk pengguna ini.
 *
 * KENAPA ADA BATAS WAKTU: di WhatsApp tidak ada tombol "percakapan baru".
 * Tanpa batas, satu percakapan tumbuh selamanya -- riwayatnya makin panjang,
 * biayanya makin besar, dan pertanyaan pagi ini tercampur konteks minggu lalu.
 *
 * @param menitDiam Diam selama ini = dianggap percakapan baru.
 * @returns id percakapan yang masih berjalan, atau null kalau harus bikin baru.
 */
export async function percakapanBerjalan(
  penggunaId: number,
  departemen: string,
  menitDiam: number,
): Promise<number | null> {
  const [rows] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT id FROM percakapan
      WHERE pengguna_id = ? AND departemen = ? AND asal = 'wa'
        AND diperbarui >= (NOW() - INTERVAL ? MINUTE)
      ORDER BY diperbarui DESC
      LIMIT 1`,
    [penggunaId, departemen, menitDiam],
  );
  return rows.length ? (rows[0].id as number) : null;
}

/**
 * Beberapa pesan terakhir sebuah percakapan, untuk dikirim ulang ke agent.
 *
 * DIBATASI, tidak mengambil semuanya: riwayat yang terus menumpuk bikin tiap
 * pertanyaan makin mahal, padahal yang dibutuhkan cuma konteks terdekat
 * ("kalau bulan juli berapa?" merujuk pertanyaan tepat sebelumnya).
 *
 * `penggunaId` tetap dipasang di WHERE walau id percakapan sudah spesifik --
 * aturan berkas ini, jangan pernah mengambil percakapan hanya dari id-nya.
 */
export async function riwayatTerakhir(
  percakapanId: number,
  penggunaId: number,
  batas: number,
): Promise<{ peran: "user" | "assistant"; teks: string }[]> {
  const [rows] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT m.peran, m.teks
       FROM pesan m
       JOIN percakapan p ON p.id = m.percakapan_id
      WHERE m.percakapan_id = ? AND p.pengguna_id = ?
      ORDER BY m.id DESC
      LIMIT ?`,
    [percakapanId, penggunaId, batas],
  );
  // Diambil DESC supaya yang terbaru yang kepilih waktu kena LIMIT,
  // lalu dibalik lagi supaya urutannya kembali kronologis.
  return rows.reverse().map((r) => ({
    peran: r.peran as "user" | "assistant",
    teks: r.teks as string,
  }));
}

/** Pastikan percakapan ini memang milik pengguna tsb sebelum ditulisi. */
async function milikDia(id: number, penggunaId: number): Promise<boolean> {
  const [rows] = await pool().query<mysql.RowDataPacket[]>(
    `SELECT 1 FROM percakapan WHERE id = ? AND pengguna_id = ? LIMIT 1`,
    [id, penggunaId],
  );
  return rows.length > 0;
}

export async function simpanPesan(
  percakapanId: number,
  penggunaId: number,
  pesan: {
    peran: "user" | "assistant";
    teks: string;
    model?: string | null;
    detik?: number | null;
    jumlahQuery?: number | null;
    tokenMasuk?: number | null;
    tokenKeluar?: number | null;
    sumber?: string | null;
    sqlDipakai?: string | null;
    jumlahDokumen?: number | null;
    jumlahKb?: number | null;
    jumlahTiket?: number | null;
    /** Kode dokumen SOP, dipisah koma. */
    sopDipakai?: string | null;
  },
): Promise<void> {
  if (!(await milikDia(percakapanId, penggunaId))) return;

  const lengkap = await punyaKolomRujukan();
  const nilai: unknown[] = [
    percakapanId,
    pesan.peran,
    pesan.teks,
    pesan.model ?? null,
    pesan.detik ?? null,
    pesan.jumlahQuery ?? null,
    pesan.tokenMasuk ?? null,
    pesan.tokenKeluar ?? null,
    pesan.sumber ?? null,
    pesan.sqlDipakai ?? null,
  ];
  if (lengkap) {
    nilai.push(
      pesan.jumlahDokumen ?? null,
      pesan.jumlahKb ?? null,
      pesan.jumlahTiket ?? null,
      pesan.sopDipakai ?? null,
    );
  }

  await pool().query(
    `INSERT INTO pesan
       (percakapan_id, peran, teks, model, detik, jumlah_query,
        token_masuk, token_keluar, sumber, sql_dipakai${
          lengkap ? ", jumlah_dokumen, jumlah_kb, jumlah_tiket, sop_dipakai" : ""
        })
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${lengkap ? ", ?, ?, ?, ?" : ""})`,
    nilai,
  );

  // Sentuh `diperbarui` supaya percakapan naik ke atas di daftar.
  await pool().query(
    `UPDATE percakapan SET diperbarui = CURRENT_TIMESTAMP WHERE id = ?`,
    [percakapanId],
  );
}

/** Hapus percakapan beserta pesannya (lewat ON DELETE CASCADE). */
export async function hapusPercakapan(id: number, penggunaId: number): Promise<boolean> {
  const [hasil] = await pool().query<mysql.ResultSetHeader>(
    `DELETE FROM percakapan WHERE id = ? AND pengguna_id = ?`,
    [id, penggunaId],
  );
  return hasil.affectedRows > 0;
}
