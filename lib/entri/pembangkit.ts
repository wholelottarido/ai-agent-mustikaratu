/**
 * Pembangkit nilai kolom — nilai yang dihitung SAAT MENYIMPAN, bukan diisi
 * model maupun ditulis di setelan.
 *
 * ============================================================
 * ⚠️ KENAPA BERKAS INI ADA, DAN KENAPA DAFTARNYA DI KODE
 * ============================================================
 * Operasi `tambah` lewat penjalan umum tertahan satu hal saja: nomor tiket
 * harus dibangkitkan, dan aturannya tidak boleh datang dari setelan.
 *
 * `ai_tool.kolom_otomatis` bisa ditulis role `ai_konfig` dari layar Kelola AI.
 * Kalau format nomor ikut disimpan di situ, satu baris setelan jadi tempat
 * menaruh kode — dan "format string yang dieksekusi" adalah kode, apa pun
 * namanya. Lebih buruk lagi, setelan itu dibagi dengan tim lain.
 *
 * Jadi pembagiannya tegas:
 *
 *   di sini (kode)  : BAGAIMANA sebuah nilai dibangkitkan
 *   di setelan      : pembangkit mana yang dipakai, DISEBUT NAMANYA saja
 *
 * Nama yang tidak terdaftar di sini bukan galat diam-diam — `bacaKonfigTulis()`
 * menolak barisnya, dan tool-nya dilewati dengan alasan tercetak.
 *
 * Pola yang sama dengan `TABEL_BOLEH` dan `KOLOM_KETERANGAN` di
 * `tulis-umum.ts`: daftar yang menentukan kuasa ditulis di kode, dan setelan
 * cuma boleh memilih dari daftar itu.
 */
import type { Pool } from "pg";

/** Penghitung nomor tiket: 4 digit, melingkar. */
const URUT_MIN = 1000;
const URUT_MAKS = 9999;

/**
 * Nomor tiket berikutnya: `T` + tanggal hari ini + penghitung 4 digit.
 *
 * ⚠️ PENGHITUNGNYA MELINGKAR, DAN SAYA PERNAH SALAH MEMBACANYA.
 *
 * Tebakan pertama: penghitung global yang naik terus, jadi `max()` seluruh
 * tabel + 1. Itu menghasilkan `T2026100810000` — LIMA digit, satu-satunya
 * nomor sepanjang 14 huruf di antara 10.089 nomor sepanjang 13.
 *
 * Yang sebenarnya, dibaca dari sebarannya per tahun:
 *
 *     2024: 7242 .. 8655      2025: 8656 .. 9522
 *     2026: 1000 .. 9999      <- menyentuh 9999 lalu BALIK ke 1000
 *
 * Jadi yang dipakai bukan nilai terbesar di seluruh tabel, melainkan
 * penghitung milik tiket TERBARU, ditambah satu, dan melingkar di 9999.
 *
 * ⚠️ Balik ke 1000 (bukan 1) adalah pembacaan dari data, bukan aturan yang
 * pernah diberi tahu tim pemiliknya. Kalau ternyata keliru, akibatnya
 * tabrakan nomor — dan itu GAGAL KERAS karena `no_ticket` bertipe `UNIQUE`,
 * bukan diam-diam menggandakan.
 *
 * `lewati` dipakai saat mencoba ulang: tanpa itu, percobaan kedua menghitung
 * nomor yang sama persis dan bertabrakan lagi.
 */
export async function nomorBerikutnya(db: Pool, lewati = 0): Promise<string> {
  const { rows } = await db.query<{ urut: number | null }>(
    `SELECT substring(no_ticket from 10)::int AS urut
       FROM portal_ticket
      WHERE no_ticket ~ '^T[0-9]{12}$'
      ORDER BY created_at DESC
      LIMIT 1`,
  );
  const sekarang = rows[0]?.urut ?? URUT_MIN - 1;
  const jangkauan = URUT_MAKS - URUT_MIN + 1;
  const urut = URUT_MIN + ((sekarang - URUT_MIN + 1 + lewati) % jangkauan + jangkauan) % jangkauan;

  const t = new Date();
  const tanggal =
    `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`;
  return `T${tanggal}${String(urut).padStart(4, "0")}`;
}

/**
 * Satu pembangkit.
 *
 * `lewati` naik tiap percobaan ulang; pembangkit yang nilainya tidak bisa
 * bentrok boleh mengabaikannya.
 */
export type Pembangkit = {
  /** Keterangan untuk layar pengaturan — administrator memilih dari daftar ini. */
  nama: string;
  /** Tabel yang pembangkit ini memang untuknya. Dipakai menolak pasangan yang keliru. */
  tabel: string;
  buat: (db: Pool, lewati: number) => Promise<string>;
};

/**
 * Daftar pembangkit yang dikenal.
 *
 * ⚠️ `tabel` ikut dicocokkan, bukan sekadar keterangan. Tanpa itu, satu baris
 * setelan bisa memasang `nomor_tiket` pada tabel lain dan menulis nomor
 * berbentuk tiket ke kolom yang bukan nomor tiket — nilai yang terlihat masuk
 * akal, di tempat yang salah, tanpa galat apa pun.
 */
export const PEMBANGKIT: Record<string, Pembangkit> = {
  nomor_tiket: {
    nama: "Nomor tiket (T + tanggal + 4 digit)",
    tabel: "portal_ticket",
    buat: (db, lewati) => nomorBerikutnya(db, lewati),
  },
};

/** Nama pembangkit yang cocok untuk sebuah tabel, untuk ditawarkan borang. */
export function pembangkitUntuk(tabel: string): { kode: string; nama: string }[] {
  return Object.entries(PEMBANGKIT)
    .filter(([, p]) => p.tabel === tabel)
    .map(([kode, p]) => ({ kode, nama: p.nama }));
}

/**
 * Memeriksa sebuah rujukan pembangkit dari setelan.
 *
 * Dipisah dari pemakaiannya supaya `bacaKonfigTulis()` bisa menolak baris yang
 * keliru SEBELUM tool-nya dirakit — bukan gagal nanti waktu seseorang menekan
 * Simpan.
 */
export function periksaPembangkit(
  kode: unknown,
  tabel: string,
): { ok: true; pembangkit: Pembangkit } | { ok: false; sebab: string } {
  if (typeof kode !== "string" || !kode) {
    return { ok: false, sebab: `sumber "bangkit" tanpa nama pembangkit` };
  }
  const p = PEMBANGKIT[kode];
  if (!p) {
    return {
      ok: false,
      sebab: `pembangkit "${kode}" tidak dikenal; yang ada: ${Object.keys(PEMBANGKIT).join(", ") || "(belum ada)"}`,
    };
  }
  if (p.tabel !== tabel) {
    return { ok: false, sebab: `pembangkit "${kode}" untuk tabel ${p.tabel}, bukan ${tabel}` };
  }
  return { ok: true, pembangkit: p };
}
