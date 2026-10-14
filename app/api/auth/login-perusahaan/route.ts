/**
 * Login memakai akun database perusahaan (Tahap 10B-3).
 *
 * Dua langkah, satu endpoint:
 *
 *   POST { username, password }
 *     -> { selesai: true, ... }            kalau akunnya cuma punya 1 profil
 *     -> { perluPilih: true, token, profil } kalau lebih dari satu
 *
 *   POST { token, idEmployee }
 *     -> { selesai: true, ... }
 *
 * ⚠️ Akun email dipakai bersama, dan itu bawaan sistem perusahaan yang tidak
 * bisa kita ubah -- `unregisted@mustika-ratu.co.id` menempel pada 307 orang.
 * Portal perusahaan sendiri juga menampilkan pemilih profil seperti ini, jadi
 * kita tidak memperlebar apa pun. Tapi tiap pemilihan DICATAT.
 */
import { cookies } from "next/headers";
import {
  cekPasswordPerusahaan, profilAkun, nilaiProfil, type ProfilPerusahaan,
} from "@/lib/login-perusahaan";
import {
  tokenPilihProfil, bacaTokenPilihProfil, simpanAkunPerusahaan, catatPilihanProfil,
} from "@/lib/akun-perusahaan";
import { buatToken, opsiCookie, lewatHttps, NAMA_COOKIE } from "@/lib/sesi";
import { ambilIp, catatGagal, catatBerhasil, sisaBlokir } from "@/lib/batas-login";

type Layak = {
  profil: ProfilPerusahaan;
  departemen: "marketing" | "hr" | "it";
  peran: "staf" | "kepala";
};

/** Profil yang departemennya masuk lingkup portal. Sisanya dibuang. */
function saring(semua: ProfilPerusahaan[]): Layak[] {
  const hasil: Layak[] = [];
  for (const profil of semua) {
    const n = nilaiProfil(profil);
    if (n.ok) hasil.push({ profil, departemen: n.departemen, peran: n.peran });
  }
  return hasil;
}

/** Selesaikan login: simpan baris pengguna, catat audit, pasang cookie. */
async function selesaikan(
  req: Request,
  arg: { pilih: Layak; username: string; idUsers: string; jmlProfil: number },
) {
  const { pilih, username, idUsers, jmlProfil } = arg;

  const akun = await simpanAkunPerusahaan({
    profil: pilih.profil,
    departemen: pilih.departemen,
    peran: pilih.peran,
  });

  await catatPilihanProfil({
    username,
    idUsers,
    profil: pilih.profil,
    peran: pilih.peran,
    jmlProfil,
    ip: ambilIp(req),
  });

  const token = await buatToken({
    id: akun.id,
    username: akun.username,
    nama: pilih.profil.nama,
    departemen: pilih.departemen,
    peran: pilih.peran,
    // Hak admin TIDAK datang dari akun perusahaan. Dibaca dari baris portal,
    // yang cuma bisa diubah manusia lewat /admin.
    admin: akun.admin,
    // Inilah gunanya seluruh alur ini: penyaring baris data perusahaan.
    idEmployee: pilih.profil.idEmployee,
  });

  catatBerhasil(ambilIp(req));
  (await cookies()).set(NAMA_COOKIE, token, opsiCookie(false, lewatHttps(req)));

  return Response.json({
    selesai: true,
    nama: pilih.profil.nama,
    departemen: pilih.departemen,
    peran: pilih.peran,
    admin: akun.admin,
    idEmployee: pilih.profil.idEmployee,
  });
}

export async function POST(req: Request) {
  try {
    // Diperiksa paling awal, sebelum menyentuh database mana pun. bcrypt
    // sengaja lambat, jadi percobaan beruntun itu beban nyata -- bukan cuma
    // ke portal, tapi ke server perusahaan.
    const ip = ambilIp(req);
    const sisa = sisaBlokir(ip);
    if (sisa > 0) {
      const menit = Math.ceil(sisa / 60);
      return Response.json(
        { error: `Terlalu banyak percobaan gagal. Coba lagi ${menit} menit lagi.` },
        { status: 429, headers: { "Retry-After": String(sisa) } },
      );
    }

    const body = await req.json();

    // ---------- Langkah 2: profil sudah dipilih ----------
    if (typeof body?.token === "string") {
      const isi = await bacaTokenPilihProfil(body.token);
      if (!isi) {
        return Response.json(
          { error: "Sesi pemilihan profil kedaluwarsa. Silakan login lagi." },
          { status: 401 },
        );
      }
      if (typeof body?.idEmployee !== "string") {
        return Response.json({ error: "Profil belum dipilih." }, { status: 400 });
      }

      // ⚠️ Daftar profil DIAMBIL ULANG dari database, bukan dipercaya dari
      // yang dikirim balik klien. Kalau dipercaya, orang bisa mengirim
      // idEmployee siapa pun -- termasuk milik akun lain.
      const layak = saring(await profilAkun(isi.idUsers));
      const pilih = layak.find((x) => x.profil.idEmployee === body.idEmployee);
      if (!pilih) {
        return Response.json(
          { error: "Profil itu bukan milik akun ini." },
          { status: 403 },
        );
      }

      return await selesaikan(req, {
        pilih, username: isi.username, idUsers: isi.idUsers, jmlProfil: layak.length,
      });
    }

    // ---------- Langkah 1: username + password ----------
    const { username, password } = body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      return Response.json({ error: "Username dan password wajib diisi." }, { status: 400 });
    }

    const idUsers = await cekPasswordPerusahaan(username, password);
    if (!idUsers) {
      // Pesan sengaja sama untuk "akun tidak ada", "password salah", dan
      // "username kembar" -- membedakannya membocorkan akun mana yang ada.
      catatGagal(ip);
      return Response.json({ error: "Username atau password salah." }, { status: 401 });
    }

    const semua = await profilAkun(idUsers);
    const layak = saring(semua);

    if (layak.length === 0) {
      // Passwordnya BENAR, tapi departemennya belum didukung portal. Ini
      // bukan kegagalan login, jadi jangan dihitung sebagai percobaan gagal --
      // kalau dihitung, orang yang memang belum kebagian akses malah
      // terblokir setelah beberapa kali mencoba.
      const dep = [...new Set(semua.map((p) => p.departemen.trim()).filter(Boolean))];
      console.warn(
        `[login-perusahaan] ${username}: ${semua.length} profil, tidak ada yang masuk lingkup ` +
          `(departemen: ${dep.join(", ") || "kosong"})`,
      );
      return Response.json(
        {
          error:
            "Akun Anda benar, tapi departemennya belum didukung portal ini. " +
            "Saat ini baru Marketing dan HRD. Hubungi admin kalau perlu akses.",
        },
        { status: 403 },
      );
    }

    if (layak.length === 1) {
      return await selesaikan(req, { pilih: layak[0], username, idUsers, jmlProfil: 1 });
    }

    // Lebih dari satu profil -> user memilih. Token antara dikirim di body,
    // BUKAN cookie: token setengah-jadi tidak punya urusan ikut terkirim ke
    // permintaan lain.
    return Response.json({
      perluPilih: true,
      token: await tokenPilihProfil(idUsers, username),
      profil: layak.map((x) => ({
        idEmployee: x.profil.idEmployee,
        nama: x.profil.nama,
        jabatan: x.profil.jabatan,
        departemen: x.profil.departemen,
        peran: x.peran,
      })),
    });
  } catch (error) {
    console.error("[/api/auth/login-perusahaan]", error);
    return Response.json(
      { error: "Tidak bisa menghubungi database perusahaan. Coba lagi sebentar." },
      { status: 500 },
    );
  }
}
