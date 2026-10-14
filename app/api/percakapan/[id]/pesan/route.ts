import { sesiAtau401 } from "@/lib/sesi-server";
import { simpanPesan } from "@/lib/percakapan";

/**
 * Simpan satu pesan ke percakapan.
 *
 * Dipakai klien untuk menyimpan JAWABAN agent setelah stream selesai --
 * supaya teks yang tersimpan persis sama dengan yang dilihat user, termasuk
 * metadata (model, lama proses, jumlah query) yang cuma diketahui klien.
 *
 * Pesan USER disimpan di /api/chat, bukan di sini: itu harus tersimpan
 * walaupun browser ditutup sebelum jawabannya selesai.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Id tidak sah." }, { status: 400 });
  }

  try {
    const {
      teks, model, detik, jumlahQuery, tokenMasuk, tokenKeluar, sumber, sqlDipakai,
      jumlahDokumen, jumlahKb, jumlahTiket, sopDipakai,
    } =
      await req.json();
    if (typeof teks !== "string" || !teks.trim()) {
      return Response.json({ error: "Teks kosong." }, { status: 400 });
    }

    // simpanPesan() memeriksa kepemilikan; percakapan orang lain diabaikan.
    await simpanPesan(id, sesi.id, {
      peran: "assistant",
      teks,
      model: typeof model === "string" ? model : null,
      detik: typeof detik === "number" ? detik : null,
      jumlahQuery: typeof jumlahQuery === "number" ? jumlahQuery : null,
      // Datang dari klien, jadi diperiksa bentuknya -- sama seperti kolom lain.
      tokenMasuk: typeof tokenMasuk === "number" ? tokenMasuk : null,
      tokenKeluar: typeof tokenKeluar === "number" ? tokenKeluar : null,
      // Dipotong supaya satu jawaban tidak menyimpan puluhan KB SQL.
      sumber: typeof sumber === "string" ? sumber.slice(0, 500) : null,
      sqlDipakai: typeof sqlDipakai === "string" ? sqlDipakai.slice(0, 20000) : null,
      // Angka dari browser, jadi dibatasi -- bukan karena curiga pada user
      // sendiri, tapi karena nilai aneh di sini akan muncul lagi sebagai
      // label yang salah di jawaban lama tanpa ada yang menyadari.
      jumlahDokumen: typeof jumlahDokumen === "number" ? jumlahDokumen : null,
      jumlahKb: typeof jumlahKb === "number" ? jumlahKb : null,
      jumlahTiket: typeof jumlahTiket === "number" ? jumlahTiket : null,
      sopDipakai: typeof sopDipakai === "string" ? sopDipakai.slice(0, 500) : null,
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[/api/percakapan/:id/pesan]", error);
    return Response.json({ error: "Gagal menyimpan pesan." }, { status: 500 });
  }
}
