/**
 * Penjaga pintu: jalan sebelum tiap request sampai ke halaman atau route.
 *
 * ⚠️ Namanya `proxy.ts`, BUKAN `middleware.ts`. Di Next.js 16 konvensi
 * `middleware` sudah deprecated dan diganti `proxy` (fungsinya sama persis,
 * cuma nama berkas & nama export yang berubah). Lihat
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 *
 * Tugasnya cuma satu: pastikan ada sesi yang sah. Penentuan departemen dan
 * pengambilan data tetap di route -- proxy tidak menyentuh database.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { bacaToken, NAMA_COOKIE } from "@/lib/sesi";

/**
 * Halaman & route yang boleh diakses tanpa login.
 *
 * `/daftar` HARUS terbuka -- orang yang belum punya akun tidak bisa login
 * dulu. Konsekuensinya siapa pun yang punya URL bisa mengirim pengajuan,
 * jadi ada pembatas per IP di `lib/pendaftaran.ts`. Yang masuk lewat situ
 * tidak menjadi akun sampai admin menyetujuinya.
 */
// ⚠️ `/api/auth/login-perusahaan` harus disebut TERSENDIRI.
//
// Pencocokannya `pathname === p || pathname.startsWith(p + "/")`, jadi
// `/api/auth/login` TIDAK mencakup `/api/auth/login-perusahaan` -- beda
// satu tanda hubung. Tanpa baris ini, proxy menolak tiap permintaan login
// perusahaan dengan "Belum login atau sesi sudah habis", dan pesan itu
// menyesatkan: kelihatan seperti masalah kredensial, padahal permintaannya
// tidak pernah sampai ke route-nya. Ketahuan `npm run test:login-http`.
const TERBUKA = [
  "/login",
  "/daftar",
  "/api/auth/login",
  "/api/auth/login-perusahaan",
  "/api/auth/logout",
  "/api/daftar",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const sesi = await bacaToken(request.cookies.get(NAMA_COOKIE)?.value);
  const terbuka = TERBUKA.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Sudah login tapi membuka halaman login -- langsung ke beranda.
  if (sesi && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Halaman & API admin: sudah login saja tidak cukup.
  //
  // ⚠️ Ini saringan CEPAT dari token, BUKAN penentu. Token memuat `admin` yang
  // baru berubah setelah kedaluwarsa (8 jam), jadi route admin tetap
  // memeriksa ulang ke database lewat `benarAdmin()`. Yang di sana yang
  // menentukan; yang di sini supaya user biasa tidak melihat halamannya.
  // Saklar sumber data: ADMIN SAJA, kepala TIDAK.
  //
  // Lebih ketat daripada `/admin` di bawah, dan itu disengaja: mengganti
  // sumber data mengubah apa yang dibaca SELURUH departemen. Kepala marketing
  // tidak boleh menentukan dari mana agent HR mengambil datanya.
  //
  // Penentunya tetap `/api/admin/sumber` yang memeriksa ke database; saringan
  // di sini supaya kepala tidak melihat halaman yang memang bukan untuk dia.
  if (sesi && pathname === "/dbadmin") {
    if (!sesi.admin) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Pengaturan tool AI: DEPARTEMEN IT saja.
  //
  // Bukan `sesi.admin` — admin portal mengurus akun dan pengajuan, bukan
  // setelan agent. Dua hak yang berbeda tidak perlu dijadikan satu.
  //
  // Penentunya tetap `/api/admin/ai-tool` yang memeriksa departemen ke
  // DATABASE tiap permintaan; yang di sini cuma supaya orang lain tidak
  // melihat halaman yang memang bukan untuk dia. Token memuat `departemen`
  // yang baru berubah setelah 8 jam, jadi saringan ini saja tidak cukup.
  if (sesi && pathname === "/kelola-ai") {
    if (sesi.departemen !== "it") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (sesi && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    // Admin (semua departemen) ATAU kepala (departemennya sendiri saja).
    // Cakupannya ditentukan di route, dari database -- di sini cuma
    // menyaring siapa yang boleh melihat halamannya.
    if (!sesi.admin && sesi.peran !== "kepala") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (terbuka || sesi) return NextResponse.next();

  // Belum login. Untuk API kembalikan 401, JANGAN redirect: fetch() dari
  // browser akan mengikuti redirect dan menerima HTML halaman login sebagai
  // "jawaban", yang bikin error-nya membingungkan.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Belum login atau sesi sudah habis. Silakan masuk lagi." },
      { status: 401 },
    );
  }

  // Simpan tujuan awal supaya setelah login bisa dikembalikan ke sana.
  const tujuan = new URL("/login", request.url);
  if (pathname !== "/") tujuan.searchParams.set("lanjut", pathname);
  return NextResponse.redirect(tujuan);
}

export const config = {
  /**
   * Tanpa matcher, proxy jalan di SEMUA request termasuk berkas statis --
   * CSS dan gambar ikut diblokir kalau belum login.
   *
   * Pola ini mengecualikan:
   *   _next/static  aset hasil build
   *   _next/image   optimasi gambar
   *   favicon.ico   ikon tab
   *   berkas ber-ekstensi (svg, png, dll) di public/
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[^/]+$).*)"],
};
