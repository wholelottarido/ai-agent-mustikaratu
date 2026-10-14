/**
 * Menyimpan & mengambil hasil baca dokumen.
 *
 * Yang disimpan cuma TEKSNYA, bukan berkas aslinya — lihat alasannya di
 * `db/portal/17_dokumen.sql`.
 */
import { createHash, randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { poolPortalApp } from "../db-portal";
import { bacaDokumen, type HasilBaca } from "./baca";

export type Dokumen = {
  id: string;
  nama: string;
  jenis: string;
  ukuran: number;
  cara: string;
  halaman: number | null;
  teks: string;
  detik: number;
  dibuat: Date;
};

const sidik = (isi: Uint8Array) => createHash("sha256").update(isi).digest("hex");

export type HasilSimpan =
  | { ok: true; dokumen: Dokumen; sudahAda: boolean }
  | { ok: false; pesan: string };

/**
 * Baca dokumen lalu simpan hasilnya. Kalau orang yang sama pernah mengunggah
 * berkas dengan isi persis sama, baris lamanya dipakai ulang.
 *
 * ⚠️ Pemeriksaan hash dilakukan SEBELUM membaca, bukan sesudah.
 *
 * Untuk PDF hematnya cuma 0,2 detik, tapi untuk gambar yang lewat OCR
 * hematnya ~63 DETIK. Membaca dulu baru sadar sudah pernah ada berarti
 * membuang waktu itu setiap kali.
 */
export async function simpanDokumen(arg: {
  penggunaId: number;
  nama: string;
  jenis: string;
  isi: Uint8Array;
}): Promise<HasilSimpan> {
  const { penggunaId, nama, jenis, isi } = arg;
  const hash = sidik(isi);

  const lama = await cariHash(penggunaId, hash);
  if (lama) return { ok: true, dokumen: lama, sudahAda: true };

  const h: HasilBaca = await bacaDokumen(isi, jenis);
  if (!h.ok) return { ok: false, pesan: h.pesan };

  const dok: Dokumen = {
    id: randomUUID(),
    nama: nama.slice(0, 255) || "(tanpa nama)",
    jenis,
    ukuran: isi.byteLength,
    cara: h.cara,
    halaman: h.halaman ?? null,
    teks: h.teks,
    detik: Number(h.detik.toFixed(2)),
    dibuat: new Date(),
  };

  try {
    await poolPortalApp().query(
      `INSERT INTO dokumen (id, pengguna_id, nama, jenis, ukuran, hash, cara, halaman, teks, detik)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [dok.id, penggunaId, dok.nama, dok.jenis, dok.ukuran, hash, dok.cara, dok.halaman, dok.teks, dok.detik],
    );
  } catch (e) {
    // Dua unggahan bersamaan untuk berkas yang sama bisa menembus pemeriksaan
    // di atas. Yang kalah balapan mengambil baris pemenang, bukan gagal.
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      const ada = await cariHash(penggunaId, hash);
      if (ada) return { ok: true, dokumen: ada, sudahAda: true };
    }
    throw e;
  }

  return { ok: true, dokumen: dok, sudahAda: false };
}

const KOLOM = "id, nama, jenis, ukuran, cara, halaman, teks, detik, dibuat";

function jadiDokumen(r: mysql.RowDataPacket): Dokumen {
  return {
    id: String(r.id),
    nama: String(r.nama),
    jenis: String(r.jenis),
    ukuran: Number(r.ukuran),
    cara: String(r.cara),
    halaman: r.halaman === null ? null : Number(r.halaman),
    teks: String(r.teks),
    detik: Number(r.detik),
    dibuat: r.dibuat as Date,
  };
}

async function cariHash(penggunaId: number, hash: string): Promise<Dokumen | null> {
  const [rows] = await poolPortalApp().query<mysql.RowDataPacket[]>(
    `SELECT ${KOLOM} FROM dokumen WHERE pengguna_id = ? AND hash = ? LIMIT 1`,
    [penggunaId, hash],
  );
  return rows[0] ? jadiDokumen(rows[0]) : null;
}

/**
 * Ambil satu dokumen milik pengguna ini.
 *
 * ⚠️ `pengguna_id` SELALU ikut di WHERE, bukan cuma `id`.
 *
 * Tanpa itu, siapa pun yang menebak (atau mendapat) sebuah id bisa membaca
 * dokumen orang lain. Id-nya uuid dan sulit ditebak, tapi "sulit ditebak"
 * bukan pengganti pemeriksaan kepemilikan.
 */
export async function ambilDokumen(penggunaId: number, id: string): Promise<Dokumen | null> {
  const [rows] = await poolPortalApp().query<mysql.RowDataPacket[]>(
    `SELECT ${KOLOM} FROM dokumen WHERE pengguna_id = ? AND id = ? LIMIT 1`,
    [penggunaId, id],
  );
  return rows[0] ? jadiDokumen(rows[0]) : null;
}

/**
 * Cari dokumen milik pengguna ini berdasarkan NAMA BERKAS.
 *
 * ⚠️ Perlu karena model cuma melihat NAMA, bukan id.
 *
 * Penanda di pesan berbunyi "[Dokumen terlampir: a.png, b.png]" — tanpa id.
 * Kalau tool cuma menerima id, model tidak punya cara menyebut dokumen KEDUA,
 * jadi dia memanggil tanpa argumen berulang kali dan selalu dapat dokumen yang
 * paling baru. Persis itu yang terjadi waktu user melampirkan 2 gambar.
 *
 * Nama tidak dijamin unik, jadi yang diambil yang PALING BARU.
 */
export async function cariDokumenNama(penggunaId: number, nama: string): Promise<Dokumen | null> {
  const [rows] = await poolPortalApp().query<mysql.RowDataPacket[]>(
    `SELECT ${KOLOM} FROM dokumen
      WHERE pengguna_id = ? AND LOWER(TRIM(nama)) = LOWER(TRIM(?))
      ORDER BY dibuat DESC LIMIT 1`,
    [penggunaId, nama],
  );
  return rows[0] ? jadiDokumen(rows[0]) : null;
}

/** Dokumen terakhir yang diunggah pengguna ini. Untuk daftar di UI. */
export async function daftarDokumen(penggunaId: number, batas = 10): Promise<Dokumen[]> {
  const [rows] = await poolPortalApp().query<mysql.RowDataPacket[]>(
    `SELECT ${KOLOM} FROM dokumen WHERE pengguna_id = ? ORDER BY dibuat DESC LIMIT ?`,
    [penggunaId, batas],
  );
  return rows.map(jadiDokumen);
}

/** Hapus satu dokumen milik pengguna ini. */
export async function hapusDokumen(penggunaId: number, id: string): Promise<boolean> {
  const [h] = await poolPortalApp().query<mysql.ResultSetHeader>(
    "DELETE FROM dokumen WHERE pengguna_id = ? AND id = ?",
    [penggunaId, id],
  );
  return h.affectedRows > 0;
}
