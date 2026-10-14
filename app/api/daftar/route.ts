import { ajukan } from "@/lib/pendaftaran";
import { ambilIp } from "@/lib/batas-login";
import { SEMUA_DEPARTEMEN } from "@/voltagent";

/**
 * Ajukan akun baru.
 *
 * ⚠️ TERBUKA TANPA LOGIN — memang harus, orang yang belum punya akun tidak
 * bisa login dulu. Konsekuensinya siapa pun yang punya URL bisa mengirim
 * pengajuan, jadi ada pembatas per IP di `lib/pendaftaran.ts`.
 *
 * Yang masuk ke sini TIDAK menjadi akun. Dia cuma antre di tabel
 * `pendaftaran` sampai admin menyetujui dan menetapkan perannya.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password, nama, nomorWa, departemen, alasan } = body ?? {};

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      typeof nama !== "string" ||
      typeof departemen !== "string"
    ) {
      return Response.json({ error: "Data pendaftaran tidak lengkap." }, { status: 400 });
    }

    const hasil = await ajukan(
      {
        username,
        password,
        nama,
        departemen,
        nomorWa: typeof nomorWa === "string" ? nomorWa : undefined,
        alasan: typeof alasan === "string" ? alasan : undefined,
      },
      ambilIp(req),
    );

    if (!hasil.ok) {
      return Response.json({ error: hasil.pesan }, { status: hasil.status });
    }

    return Response.json({
      ok: true,
      pesan: "Pengajuan terkirim. Tunggu admin menyetujui sebelum bisa masuk.",
    });
  } catch (error) {
    console.error("[/api/daftar]", error);
    return Response.json({ error: "Gagal mengirim pengajuan." }, { status: 500 });
  }
}

/**
 * Daftar departemen untuk mengisi pilihan di form.
 *
 * ⚠️ Departemen TANPA database dummy sengaja TIDAK ditawarkan.
 *
 * Akun portal (username + password sendiri) memakai database dummy. Departemen
 * IT tidak punya itu -- datanya cuma di PostgreSQL perusahaan, dan membacanya
 * menuntut `id_employee` yang cuma didapat lewat login akun perusahaan.
 *
 * Kalau tetap ditawarkan, orang IT bisa mendaftar, disetujui admin, lalu
 * masuk ke agent yang cuma bisa bilang "datanya tidak ada di sumber ini".
 * Kegagalan seperti itu baru ketahuan SETELAH akunnya jadi.
 *
 * Jalur yang benar untuk mereka: tombol "Akun perusahaan" di /login.
 */
export async function GET() {
  return Response.json({
    departemen: SEMUA_DEPARTEMEN.filter((d) => d.db).map((d) => ({
      id: d.id,
      label: d.label,
    })),
  });
}
