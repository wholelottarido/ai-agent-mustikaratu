import { sesiAtau401 } from "@/lib/sesi-server";
import { ambilDepartemen, bolehEntri } from "@/voltagent";
import { simpanPelamar } from "@/lib/entri/pelamar";

/**
 * Simpan pelamar yang sudah dikonfirmasi user.
 *
 * ⚠️ SATU-SATUNYA jalur yang bisa menulis pelamar, dan model TIDAK punya
 * akses ke sini. Yang memicunya tombol yang ditekan user.
 *
 * ⚠️ Peran ikut diperiksa, bukan cuma departemen: yang boleh memasukkan
 * pelamar CUMA staf HR, sama seperti lembur cuma untuk kepala. Dua entitas di
 * departemen yang sama dengan gerbang peran berbeda.
 */
export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const dep = ambilDepartemen(sesi.departemen);
  if (!dep) {
    return Response.json({ error: "Departemen akun ini belum terdaftar." }, { status: 403 });
  }

  if (!bolehEntri(dep, sesi.peran, "pelamar")) {
    return Response.json(
      { error: `Peran ${sesi.peran} di ${dep.label} tidak bisa memasukkan pelamar.` },
      { status: 403 },
    );
  }

  try {
    const { lowongan, nama, email, telepon, pendidikan, pengalaman, sumber, tanggal, sidik, permintaan } =
      await req.json();

    if (
      typeof lowongan !== "string" ||
      typeof nama !== "string" ||
      typeof email !== "string" ||
      typeof sidik !== "string"
    ) {
      return Response.json({ error: "Data konfirmasi tidak lengkap." }, { status: 400 });
    }

    const hasil = await simpanPelamar(
      {
        lowongan,
        nama,
        email,
        telepon: typeof telepon === "string" ? telepon : undefined,
        pendidikan: String(pendidikan ?? ""),
        pengalaman: Number(pengalaman),
        sumber: String(sumber ?? ""),
        tanggal: typeof tanggal === "string" ? tanggal : undefined,
      },
      sidik,
      {
        penggunaId: sesi.id,
        username: sesi.username,
        departemen: sesi.departemen,
        peran: sesi.peran,
        asal: "web",
        permintaan: typeof permintaan === "string" ? permintaan : undefined,
      },
    );

    if (!hasil.ok) {
      // 409 untuk draf basi: mis. lowongannya keburu ditutup sejak draf
      // ditampilkan. Bukan kesalahan user.
      return Response.json(
        { error: hasil.pesan, masalah: hasil.masalah },
        { status: hasil.sebab === "draf-berubah" ? 409 : 400 },
      );
    }

    return Response.json({ ok: true, id: hasil.id, lowongan: hasil.draf.lowongan.kode });
  } catch (error) {
    console.error("[/api/entri/pelamar]", error);
    return Response.json({ error: "Gagal menyimpan pelamar." }, { status: 500 });
  }
}
