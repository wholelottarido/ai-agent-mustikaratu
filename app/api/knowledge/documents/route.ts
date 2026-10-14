import { sesiAtau401 } from "@/lib/sesi-server";
import { JENIS_DITERIMA, UKURAN_MAKS } from "@/lib/dokumen/baca";
import { unggahPengetahuan } from "@/lib/kb/unggah";

export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;
  try {
    const form = await req.formData();
    const judul = String(form.get("judul") ?? "").trim();
    const berkas = form.get("berkas");
    if (!(berkas instanceof File)) return Response.json({ error: "Berkas wajib diisi." }, { status: 400 });
    if (!judul) return Response.json({ error: "Judul dokumen wajib ditanyakan sebelum berkas dikirim." }, { status: 400 });
    if (berkas.size > UKURAN_MAKS) return Response.json({ error: "Berkas terlalu besar." }, { status: 413 });
    if (!(JENIS_DITERIMA as readonly string[]).includes(berkas.type)) return Response.json({ error: "Kirim PDF, PNG, JPG, atau WebP." }, { status: 415 });
    const h = await unggahPengetahuan({ judul, nama: berkas.name, jenis: berkas.type, isi: new Uint8Array(await berkas.arrayBuffer()), departemen: sesi.departemen, pembuat: String(sesi.id) });
    return Response.json(h, { status: 201 });
  } catch (e) {
    const pesan = e instanceof Error ? e.message : "Gagal menyerap dokumen.";
    console.error("[/api/knowledge/documents]", pesan);
    const bisaDijelaskan = /DEMO_PG_|belum bisa|Tesseract|tidak memiliki teks|tidak ada teks|PDF ini sepertinya hasil scan/i.test(pesan);
    const status = /DEMO_PG_/.test(pesan) ? 503 : bisaDijelaskan ? 422 : 500;
    return Response.json({ error: bisaDijelaskan ? pesan : "Server belum bisa menyimpan dokumen. Coba lagi setelah koneksi database tersedia." }, { status });
  }
}
