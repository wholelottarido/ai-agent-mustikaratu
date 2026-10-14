import { sesiAtau401 } from "@/lib/sesi-server";
import { ambilDepartemen, bolehSetujui } from "@/voltagent";
import { putuskanLembur, type Keputusan } from "@/lib/entri/persetujuan";

/**
 * Setujui atau tolak satu lembur.
 *
 * ⚠️ SATU-SATUNYA jalur yang mengubah status lembur, dan model TIDAK punya
 * akses ke sini. Yang memicunya tombol yang ditekan user.
 *
 * ⚠️ Izinnya diperiksa lewat `bolehSetujui`, BUKAN `bolehEntri`.
 *
 * Menyetujui dan mengentri itu dua kekuasaan berbeda. Kalau dipakai
 * pemeriksaan yang sama, siapa pun yang boleh mencatat otomatis boleh
 * mengesahkan — dan kolom `status` kehilangan artinya.
 */
export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const dep = ambilDepartemen(sesi.departemen);
  if (!dep) {
    return Response.json({ error: "Departemen akun ini belum terdaftar." }, { status: 403 });
  }

  if (!bolehSetujui(dep, sesi.peran, "lembur")) {
    return Response.json(
      { error: `Peran ${sesi.peran} di ${dep.label} tidak bisa menyetujui lembur.` },
      { status: 403 },
    );
  }

  try {
    const { id, keputusan, catatan, permintaan } = await req.json();

    if (!Number.isInteger(id) || id <= 0 || typeof keputusan !== "string") {
      return Response.json({ error: "Data keputusan tidak lengkap." }, { status: 400 });
    }

    const hasil = await putuskanLembur(
      id,
      keputusan as Keputusan,
      typeof catatan === "string" ? catatan : undefined,
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
      // 409 untuk yang sudah diputus: keadaannya berubah sejak user melihat
      // drafnya, bukan permintaan yang salah bentuk.
      return Response.json(
        { error: hasil.pesan, sebab: hasil.sebab },
        { status: hasil.sebab === "sudah-diputus" ? 409 : 400 },
      );
    }

    return Response.json({ ok: true, id: hasil.id, keputusan: hasil.keputusan });
  } catch (error) {
    console.error("[/api/entri/lembur/putuskan]", error);
    return Response.json({ error: "Gagal menyimpan keputusan." }, { status: 500 });
  }
}
