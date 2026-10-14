import { sesiAtau401 } from "@/lib/sesi-server";
import { ambilDepartemen, bolehEntri } from "@/voltagent";
import { simpanLembur } from "@/lib/entri/lembur";

/**
 * Simpan lembur yang sudah dikonfirmasi user.
 *
 * ⚠️ SATU-SATUNYA jalur yang bisa menulis lembur, dan model TIDAK punya akses
 * ke sini. Yang memicunya tombol yang ditekan user.
 *
 * ⚠️ Yang diterima cuma permintaan ASLI + sidik draf — bukan drafnya, dan
 * terutama BUKAN nilai rupiahnya. `simpanLembur()` menyusun ulang drafnya di
 * server (termasuk menghitung ulang nilai dari gaji) lalu membandingkan
 * sidiknya. Kalau nilai rupiah diterima mentah dari klien, siapa pun bisa
 * mengirim angka karangan lewat curl.
 *
 * ⚠️ Peran ikut diperiksa, bukan cuma departemen: yang boleh mencatat lembur
 * CUMA kepala HR. Staf HR tidak boleh melihat gaji, dan nilai lembur adalah
 * turunan langsung darinya.
 */
export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const dep = ambilDepartemen(sesi.departemen);
  if (!dep) {
    return Response.json({ error: "Departemen akun ini belum terdaftar." }, { status: 403 });
  }

  if (!bolehEntri(dep, sesi.peran, "lembur")) {
    return Response.json(
      { error: `Peran ${sesi.peran} di ${dep.label} tidak bisa mencatat lembur.` },
      { status: 403 },
    );
  }

  try {
    const { karyawan, jam, alasan, tanggal, sidik, permintaan } = await req.json();

    if (typeof karyawan !== "string" || typeof alasan !== "string" || typeof sidik !== "string") {
      return Response.json({ error: "Data konfirmasi tidak lengkap." }, { status: 400 });
    }

    const hasil = await simpanLembur(
      {
        karyawan,
        jam: Number(jam),
        alasan,
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
      // 409 untuk draf basi: bukan kesalahan user, tapi datanya berubah sejak
      // draf ditampilkan (mis. gaji diperbarui). Klien perlu draf baru.
      return Response.json(
        { error: hasil.pesan, masalah: hasil.masalah },
        { status: hasil.sebab === "draf-berubah" ? 409 : 400 },
      );
    }

    return Response.json({ ok: true, id: hasil.id, nilaiRp: hasil.draf.nilaiRp });
  } catch (error) {
    console.error("[/api/entri/lembur]", error);
    return Response.json({ error: "Gagal menyimpan lembur." }, { status: 500 });
  }
}
