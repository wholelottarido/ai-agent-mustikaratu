/**
 * Menyimpan tiket helpdesk. SATU-SATUNYA berkas yang bisa menulis ke
 * `portal_ticket`.
 *
 * ⚠️ JANGAN berikan modul ini kepada agent, dan jangan panggil dari tool mana
 * pun. Model menyusun rancangan; yang memanggil berkas ini adalah tombol yang
 * ditekan manusia.
 *
 * ⚠️ TABELNYA MILIK TIM LAIN DAN HIDUP. 10.089 tiket, 18 berstatus OPEN, dan
 * teknisi IT sungguhan mengerjakan antreannya. Baris yang salah di sini bukan
 * kotoran data — ia jadi pekerjaan orang.
 *
 * ============================================================
 * DUA LAPIS PENJAGAAN, DAN YANG KEDUA ADA DI DATABASE
 * ============================================================
 * Lapis pertama: `tiket.ts` menyusun ulang rancangan di server dan
 * membandingkan sidiknya dengan yang dilihat user.
 *
 * Lapis kedua: role `ai_tulis` cuma punya INSERT pada KOLOM TERTENTU.
 *
 * ⚠️ `no_ticket` TERMASUK yang boleh diisi — harus, karena tidak ada trigger
 * maupun nilai bawaan di database, dan tiket tanpa nomor tidak terbaca di
 * aplikasi mereka. Jadi jangan mengklaim role ini "tidak bisa mencetak
 * nomor". Yang benar-benar tidak bisa ia sentuh: `status`, `id_technician`,
 * `assigned_by`, `assigned_at`, `closed_at`, `closed_by`, `self_closed`.
 * Artinya tiket buatan portal ini SELALU lahir berstatus OPEN dan belum
 * ditugaskan — dijamin nilai bawaan kolomnya, bukan oleh kode kita.
 */
import { Pool } from "pg";
import { sidikDraf, susunDraf, type Draf, type Masalah, type Permintaan } from "./tiket";
import {
  susunDrafUbah, sidikDrafUbah,
  type Perubahan as PerubahanTiket,
  type Masalah as MasalahUbah,
  type Permintaan as PermintaanUbah,
} from "./tiket-ubah";

/** Berapa kali mencoba lagi kalau nomor tiket bentrok dengan entri serentak. */
const MAKS_COBA = 3;

let kolam: Pool | undefined;

/**
 * Pool role penulis. Terpisah dari `poolPerusahaan()` yang `ai_readonly`.
 *
 * Dibuat malas supaya proses yang tidak pernah menyimpan tiket — bot WhatsApp
 * yang cuma menjawab, skrip uji baca — tidak ikut membuka koneksi bertenaga
 * tulis yang tidak pernah dipakai.
 */
export function poolTulis(): Pool {
  if (!kolam) {
    const user = process.env.DEMO_PG_TULIS_USER;
    const password = process.env.DEMO_PG_TULIS_PASSWORD;
    if (!user || !password) {
      throw new Error(
        "DEMO_PG_TULIS_USER/PASSWORD belum diisi di .env.local. " +
          "Jalankan dulu `npm run buat:pg-tulis` dengan kredensial admin.",
      );
    }
    kolam = new Pool({
      host: process.env.DEMO_PG_HOST,
      port: Number(process.env.DEMO_PG_PORT ?? 5432),
      database: process.env.DEMO_PG_DATABASE,
      user,
      password,
      max: 3,
      connectionTimeoutMillis: 15_000,
    });
  }
  return kolam;
}

export type HasilSimpan =
  | { ok: true; idTicket: string; noTicket: string; draf: Draf }
  | { ok: false; sebab: "draf-berubah" | "tidak-sah" | "gagal"; pesan: string; masalah?: Masalah[] };

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
 * Kolom yang diisi, dan SATU-SATUNYA daftar yang dipakai merakit INSERT.
 *
 * Ditulis tetap di sini, bukan dibaca konfigurasi, dan itu disengaja: hak
 * INSERT role database dibentuk dari daftar yang sama. Keduanya harus bergerak
 * bersama, dan menaruhnya di dua tempat yang bisa berbeda justru membuat salah
 * satunya diam-diam lebih longgar.
 */
export const KOLOM_ISI = [
  "no_ticket", "id_employee", "id_category", "id_sub_category",
  "subject", "description", "priority",
] as const;

/**
 * Simpan satu tiket.
 *
 * @param sidikHarapan Sidik rancangan yang DILIHAT user. Rancangannya disusun
 *   ULANG di sini dari permintaan aslinya — yang dikirim klien tidak dipercaya,
 *   karena klien yang mengirim rancangan jadi bisa mengirim apa saja lewat curl.
 */
export async function simpanTiket(
  idEmployee: string | null,
  minta: Permintaan,
  sidikHarapan: string,
): Promise<HasilSimpan> {
  const hasil = await susunDraf(idEmployee, minta);
  if (!hasil.ok) {
    return { ok: false, sebab: "tidak-sah", pesan: "Rancangan tidak bisa disusun.", masalah: hasil.masalah };
  }
  const draf = hasil.draf;
  if (sidikDraf(draf) !== sidikHarapan) {
    return {
      ok: false,
      sebab: "draf-berubah",
      pesan:
        "Data berubah sejak rancangan ditampilkan (mis. nama kategori diperbarui). " +
        "Lihat rancangannya sekali lagi sebelum menyimpan.",
    };
  }

  const db = poolTulis();
  for (let coba = 1; coba <= MAKS_COBA; coba++) {
    const no = await nomorBerikutnya(db, coba - 1);
    try {
      const { rows } = await db.query<{ id_ticket: string; no_ticket: string }>(
        `INSERT INTO portal_ticket (${KOLOM_ISI.join(", ")})
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id_ticket, no_ticket`,
        [no, draf.idEmployee, draf.kategori.id, draf.subKategori.id,
         draf.judul, draf.deskripsi, draf.prioritas.nilai],
      );
      return { ok: true, idTicket: rows[0].id_ticket, noTicket: rows[0].no_ticket, draf };
    } catch (e) {
      // 23505 = unique_violation. Nomornya keduluan entri lain; hitung ulang.
      const kode = (e as { code?: string }).code;
      if (kode === "23505" && coba < MAKS_COBA) continue;
      return {
        ok: false,
        sebab: "gagal",
        pesan:
          kode === "23505"
            ? `Nomor tiket bentrok ${MAKS_COBA} kali berturut-turut. Coba lagi sebentar.`
            : `Gagal menyimpan: ${(e as Error).message}`,
      };
    }
  }
  return { ok: false, sebab: "gagal", pesan: "Gagal menyimpan tiket." };
}

/**
 * Kolom yang boleh DIUBAH. Harus sama persis dengan `KOLOM_UBAH` di
 * `scripts/buat-pg-tulis.mts` — hak role database dibentuk dari daftar itu.
 *
 * ⚠️ `id_category` dan `id_sub_category` SENGAJA TIDAK ADA. Memindahkan tiket
 * antar kategori berarti memindahkannya ke antrean orang lain, dan itu bukan
 * "menyunting laporan saya".
 */
export const KOLOM_UBAH = ["subject", "description", "priority"] as const;

export type HasilUbah =
  | { ok: true; noTicket: string; perubahan: PerubahanTiket[] }
  | { ok: false; sebab: "draf-berubah" | "tidak-sah" | "gagal"; pesan: string; masalah?: MasalahUbah[] };

/**
 * Simpan penyuntingan satu tiket.
 *
 * ⚠️ TIGA SYARAT DI SATU `WHERE`, dan ketiganya harus ada.
 *
 *   no_ticket    -> tiket yang dimaksud
 *   id_employee  -> MILIK PENANYA. Inilah batas yang tidak bisa dijamin
 *                   database (lihat catatan panjang di `tiket-ubah.ts`), jadi
 *                   ia harus berdiri di sini — bukan cuma diperiksa waktu
 *                   menyusun rancangan, karena antara memeriksa dan menyimpan
 *                   ada jeda.
 *   status       -> masih boleh disunting. Teknisi bisa mengambil tiket itu
 *                   tepat di antara rancangan dilihat dan tombol ditekan.
 *
 * Kalau `WHERE` tidak cocok, `rowCount` nol — dan itu dilaporkan sebagai
 * kegagalan, bukan sebagai keberhasilan yang kebetulan tidak mengubah apa pun.
 */
export async function simpanUbahTiket(
  idEmployee: string | null,
  minta: PermintaanUbah,
  sidikHarapan: string,
): Promise<HasilUbah> {
  const hasil = await susunDrafUbah(idEmployee, minta);
  if (!hasil.ok) {
    return { ok: false, sebab: "tidak-sah", pesan: "Rancangan tidak bisa disusun.", masalah: hasil.masalah };
  }
  const draf = hasil.draf;
  if (sidikDrafUbah(draf) !== sidikHarapan) {
    return {
      ok: false,
      sebab: "draf-berubah",
      pesan:
        "Tiketnya berubah sejak rancangan ditampilkan — mungkin sudah disunting " +
        "atau diambil teknisi. Lihat rancangannya sekali lagi sebelum menyimpan.",
    };
  }

  const boleh = new Set<string>(KOLOM_UBAH);
  const set: string[] = [];
  const nilai: unknown[] = [];
  for (const p of draf.perubahan) {
    if (!boleh.has(p.kolom)) {
      // Tidak seharusnya tercapai: penyusun rancangan cuma menghasilkan kolom
      // yang ada di `kolom_isian`. Diperiksa lagi karena kalau lolos, yang
      // dirangkai adalah UPDATE pada kolom yang tidak pernah diputuskan.
      return { ok: false, sebab: "gagal", pesan: `kolom "${p.kolom}" tidak boleh diubah` };
    }
    nilai.push(p.jadi);
    set.push(`"${p.kolom}" = $${nilai.length}`);
  }
  if (set.length === 0) return { ok: false, sebab: "tidak-sah", pesan: "Tidak ada yang diubah." };

  nilai.push(draf.noTiket, idEmployee, draf.status);
  const db = poolTulis();
  try {
    const { rowCount } = await db.query(
      `UPDATE portal_ticket SET ${set.join(", ")}, updated_at = now()
        WHERE no_ticket = $${nilai.length - 2}
          AND id_employee = $${nilai.length - 1}::uuid
          AND status = $${nilai.length}`,
      nilai,
    );
    if (rowCount === 0) {
      return {
        ok: false,
        sebab: "draf-berubah",
        pesan: "Tiketnya berubah tepat sebelum disimpan — statusnya tidak lagi sama. Coba lihat ulang.",
      };
    }
    return { ok: true, noTicket: draf.noTiket, perubahan: draf.perubahan };
  } catch (e) {
    return { ok: false, sebab: "gagal", pesan: `Gagal menyimpan: ${(e as Error).message}` };
  }
}
