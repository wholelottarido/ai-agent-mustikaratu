/**
 * Sesi login: JWT yang ditandatangani, disimpan di cookie httpOnly.
 *
 * Kenapa JWT, bukan sesi di database: isinya cuma id, nama, departemen, peran --
 * tidak berubah selama sesi. Dengan JWT tidak ada query database di tiap request,
 * dan tabel `pengguna` cukup dibaca sekali saat login.
 *
 * Konsekuensinya: menonaktifkan user tidak langsung memutus sesi yang sedang
 * berjalan -- dia baru terblokir setelah token kedaluwarsa (8 jam).
 *
 * Pakai `jose` daripada bikin HMAC sendiri dari `node:crypto`: menandatangani
 * dan memverifikasi JWT itu gampang salah (lupa cek `alg`, lupa cek `exp`,
 * perbandingan tanda tangan yang bocor lewat waktu). `jose` sudah mengurus itu.
 *
 * Berkas ini sengaja TIDAK meng-import `mysql2` -- `proxy.ts` memuatnya di tiap
 * request, dan proxy tidak boleh menyentuh database.
 *
 * Alasan yang sama kenapa `opsiCookie()` MENERIMA `lewatHttps` sebagai
 * argumen alih-alih membacanya sendiri lewat `next/headers`: berkas ini ikut
 * dimuat proxy, dan `next/headers` tidak tersedia di sana.
 */
import { SignJWT, jwtVerify } from "jose";

export const NAMA_COOKIE = "portal_sesi";

/** Apakah pengunjung datang lewat HTTPS? Lihat `opsiCookie()`. */
export function lewatHttps(req: Request): boolean {
  return req.headers.get("x-forwarded-proto") === "https";
}

/** Umur sesi. Cukup untuk satu hari kerja, tidak perlu login berulang. */
const UMUR_DETIK = 8 * 60 * 60;

export type Sesi = {
  id: number;
  username: string;
  nama: string;
  departemen: string;
  peran: string;
  /**
   * uuid karyawan di database perusahaan. `null` kalau belum dipetakan.
   *
   * ⚠️ Dipakai menyaring BARIS waktu sumber data = perusahaan: view `v_ai_*`
   * di sana tidak punya WHERE, jadi tanpa ini setiap user melihat seluruh
   * 1.954 karyawan, pengajuan cuti semua orang, dan tiket semua orang.
   *
   * Ikut di token, jadi pemetaan yang baru diubah baru berlaku setelah user
   * login lagi (atau tokennya kedaluwarsa, 8 jam).
   */
  idEmployee: string | null;
  /**
   * Boleh membuka halaman admin.
   *
   * ⚠️ Ikut di token, jadi MENCABUT hak admin baru berlaku setelah tokennya
   * kedaluwarsa (8 jam) -- sama seperti menonaktifkan user. Karena itu ini
   * cuma dipakai untuk menyaring di `proxy.ts`; route admin tetap memeriksa
   * ulang ke database, dan itu yang menentukan.
   */
  admin: boolean;
};

function kunci(): Uint8Array {
  const rahasia = process.env.SESSION_SECRET;
  if (!rahasia || rahasia.length < 32) {
    throw new Error(
      "SESSION_SECRET belum diisi atau terlalu pendek (minimal 32 karakter). " +
        "Buat yang acak: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }
  return new TextEncoder().encode(rahasia);
}

export async function buatToken(sesi: Sesi): Promise<string> {
  return new SignJWT({ ...sesi })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${UMUR_DETIK}s`)
    .sign(kunci());
}

/** Kembalikan isi sesi, atau `null` kalau token tidak sah/kedaluwarsa. */
export async function bacaToken(token: string | undefined): Promise<Sesi | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, kunci());
    const { id, username, nama, departemen, peran, admin, idEmployee } =
      payload as Record<string, unknown>;

    if (
      typeof id !== "number" ||
      typeof username !== "string" ||
      typeof nama !== "string" ||
      typeof departemen !== "string" ||
      typeof peran !== "string"
    ) {
      return null;
    }
    // ⚠️ Token LAMA (dibuat sebelum kolom ini ada) tidak memuat `idEmployee`.
    // Diperlakukan sebagai `null`, bukan ditolak -- kalau ditolak, semua user
    // yang sedang login tiba-tiba terlempar ke halaman masuk.
    return {
      id,
      username,
      nama,
      departemen,
      peran,
      idEmployee: typeof idEmployee === "string" && idEmployee !== "" ? idEmployee : null,
      admin: admin === true,
    };
  } catch {
    // Tanda tangan salah, kedaluwarsa, atau bukan JWT sama sekali.
    return null;
  }
}

/**
 * Opsi cookie yang dipakai saat login & logout -- harus sama persis, kalau
 * beda sedikit saja browser menganggapnya cookie lain dan logout tidak jalan.
 *
 * `secure` IKUT PROTOKOL, tidak dipatok:
 *   - Lewat Cloudflare Tunnel, pengunjung memakai HTTPS -> secure: true.
 *   - Lewat LAN (`http://192.168.x.x:3018`) atau localhost -> secure: false.
 *
 * Kalau dipatok `true`, login lewat LAN langsung rusak: browser menolak
 * menyimpan cookie secure di koneksi HTTP, dan user kembali ke halaman login
 * terus-menerus tanpa pesan error apa pun.
 *
 * Protokol aslinya cuma kelihatan dari header `x-forwarded-proto`: aplikasi
 * ini menerima HTTP biasa dari cloudflared yang jalan di localhost, jadi
 * `req.url` selalu bilang http walaupun pengunjungnya lewat HTTPS.
 * Pakai `lewatHttps()` di bawah untuk membacanya.
 */
export function opsiCookie(hapus = false, lewatHttps = false) {
  return {
    httpOnly: true, // tidak bisa dibaca JavaScript di browser
    sameSite: "lax" as const, // cukup untuk aplikasi internal
    path: "/",
    maxAge: hapus ? 0 : UMUR_DETIK,
    secure: lewatHttps,
  };
}
