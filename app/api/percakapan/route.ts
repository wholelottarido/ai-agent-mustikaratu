import { sesiAtau401 } from "@/lib/sesi-server";
import { daftarPercakapan, buatPercakapan, buatJudul } from "@/lib/percakapan";

export async function GET() {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  try {
    // Difilter pengguna_id DAN departemen dari sesi -- bukan dari parameter.
    return Response.json(await daftarPercakapan(sesi.id, sesi.departemen));
  } catch (error) {
    console.error("[/api/percakapan]", error);
    return Response.json({ error: "Gagal memuat daftar percakapan." }, { status: 500 });
  }
}

/** Bikin percakapan baru. Dipanggil klien saat pesan pertama dikirim. */
export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  try {
    const { pertanyaan } = await req.json();
    if (typeof pertanyaan !== "string" || !pertanyaan.trim()) {
      return Response.json({ error: "Pertanyaan kosong." }, { status: 400 });
    }

    const judul = buatJudul(pertanyaan);
    const id = await buatPercakapan(sesi.id, sesi.departemen, judul);
    return Response.json({ id, judul });
  } catch (error) {
    console.error("[/api/percakapan POST]", error);
    return Response.json({ error: "Gagal membuat percakapan." }, { status: 500 });
  }
}
