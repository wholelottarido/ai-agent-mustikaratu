import { sesiAtau401 } from "@/lib/sesi-server";
import { isiPercakapan, hapusPercakapan } from "@/lib/percakapan";

/** Ambil id dari URL, tolak yang bukan angka. */
function bacaId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const id = bacaId((await ctx.params).id);
  if (!id) return Response.json({ error: "Id tidak sah." }, { status: 400 });

  try {
    // isiPercakapan() memfilter pengguna_id, jadi percakapan orang lain
    // mengembalikan null -- bukan isinya.
    const isi = await isiPercakapan(id, sesi.id);
    if (!isi) return Response.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
    return Response.json(isi);
  } catch (error) {
    console.error("[/api/percakapan/:id GET]", error);
    return Response.json({ error: "Gagal memuat percakapan." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const id = bacaId((await ctx.params).id);
  if (!id) return Response.json({ error: "Id tidak sah." }, { status: 400 });

  try {
    const terhapus = await hapusPercakapan(id, sesi.id);
    if (!terhapus) return Response.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[/api/percakapan/:id DELETE]", error);
    return Response.json({ error: "Gagal menghapus percakapan." }, { status: 500 });
  }
}
