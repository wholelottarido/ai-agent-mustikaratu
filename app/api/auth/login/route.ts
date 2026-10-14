import { cookies } from "next/headers";
import { cariPengguna } from "@/lib/pengguna";
import { cekPassword } from "@/lib/password";
import { buatToken, opsiCookie, lewatHttps, NAMA_COOKIE } from "@/lib/sesi";
import { ambilDepartemen } from "@/voltagent";
import { ambilIp, catatGagal, catatBerhasil, sisaBlokir } from "@/lib/batas-login";

export async function POST(req: Request) {
  try {
    // Diperiksa PALING AWAL: sebelum baca body, sebelum sentuh database.
    // Kalau dicek belakangan, penyerang yang diblokir tetap bisa membebani
    // database dan hash password dengan percobaannya.
    const ip = ambilIp(req);
    const sisa = sisaBlokir(ip);
    if (sisa > 0) {
      const menit = Math.ceil(sisa / 60);
      return Response.json(
        { error: `Terlalu banyak percobaan gagal. Coba lagi ${menit} menit lagi.` },
        { status: 429, headers: { "Retry-After": String(sisa) } },
      );
    }

    const { username, password } = await req.json();

    if (typeof username !== "string" || typeof password !== "string") {
      return Response.json({ error: "Username dan password wajib diisi." }, { status: 400 });
    }

    const pengguna = await cariPengguna(username);

    // Pesan error SENGAJA sama untuk "user tidak ada" dan "password salah".
    // Kalau dibedakan, orang bisa menebak username mana yang terdaftar.
    const gagal = () => {
      catatGagal(ip);
      return Response.json({ error: "Username atau password salah." }, { status: 401 });
    };

    if (!pengguna) {
      // Tetap jalankan perbandingan palsu supaya lama responsnya mirip dengan
      // kasus password salah -- kalau langsung balik, selisih waktunya
      // membocorkan username mana yang ada.
      await cekPassword(password, "scrypt:00:00");
      return gagal();
    }

    if (!(await cekPassword(password, pengguna.password_hash))) return gagal();

    // Departemen di database harus dikenal sistem. Kalau admin salah ketik
    // (mis. 'marketting'), lebih baik login ditolak daripada user masuk lalu
    // mendapat agent yang salah.
    if (!ambilDepartemen(pengguna.departemen)) {
      console.error(
        `[login] pengguna ${pengguna.username} punya departemen "${pengguna.departemen}" yang tidak dikenal`,
      );
      return Response.json(
        { error: "Departemen akun ini belum terdaftar di sistem. Hubungi admin." },
        { status: 403 },
      );
    }

    const token = await buatToken({
      id: pengguna.id,
      username: pengguna.username,
      nama: pengguna.nama,
      departemen: pengguna.departemen,
      peran: pengguna.peran,
      admin: pengguna.is_admin === 1,
      idEmployee: pengguna.id_employee ?? null,
    });

    catatBerhasil(ip);
    (await cookies()).set(NAMA_COOKIE, token, opsiCookie(false, lewatHttps(req)));

    return Response.json({
      nama: pengguna.nama,
      departemen: pengguna.departemen,
      peran: pengguna.peran,
      admin: pengguna.is_admin === 1,
      idEmployee: pengguna.id_employee ?? null,
    });
  } catch (error) {
    console.error("[/api/auth/login]", error);
    const pesan = error instanceof Error ? error.message : "Kesalahan tidak dikenal";
    return Response.json({ error: pesan }, { status: 500 });
  }
}
