/**
 * Unggah dokumen untuk dibaca agent (Tahap 12B).
 *
 *   POST   /api/dokumen        multipart/form-data, field `berkas`
 *   GET    /api/dokumen        daftar dokumen milik sendiri
 *   DELETE /api/dokumen?id=... hapus satu
 *
 * ⚠️ Yang dikembalikan BUKAN seluruh teksnya, cuma cuplikan.
 *
 * Teks lengkapnya tinggal di server dan diambil agent lewat tool
 * `baca_dokumen`. Kalau seluruh teks ikut ke browser lalu dikirim balik di
 * tiap pertanyaan, satu PDF panjang membengkakkan SETIAP permintaan chat
 * sesudahnya -- padahal model cuma butuh sekali.
 */
import { sesiAtau401 } from "@/lib/sesi-server";
import { simpanDokumen, daftarDokumen, hapusDokumen } from "@/lib/dokumen/simpan";
import { JENIS_DITERIMA, UKURAN_MAKS } from "@/lib/dokumen/baca";

/** Panjang cuplikan yang dikirim balik ke browser, sekadar bukti terbaca. */
const CUPLIKAN = 400;

export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  let berkas: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("berkas");
    if (f instanceof File) berkas = f;
  } catch {
    return Response.json({ error: "Isi permintaan bukan form unggahan yang sah." }, { status: 400 });
  }
  if (!berkas) {
    return Response.json({ error: "Tidak ada berkas yang dikirim." }, { status: 400 });
  }

  // ⚠️ Ukuran diperiksa SEBELUM berkasnya dibaca ke memori.
  //
  // `arrayBuffer()` menarik seluruh isi ke RAM. Di mesin dengan RAM 7,3 GB
  // yang sudah sesak, membaca dulu baru menolak itu cara yang salah.
  if (berkas.size > UKURAN_MAKS) {
    return Response.json(
      { error: `Berkas terlalu besar (maksimal ${Math.round(UKURAN_MAKS / 1024 / 1024)} MB).` },
      { status: 413 },
    );
  }

  const jenis = berkas.type || "";
  if (!(JENIS_DITERIMA as readonly string[]).includes(jenis)) {
    return Response.json(
      {
        error:
          `Jenis berkas ${jenis || "(tidak dikenal)"} belum didukung. ` +
          "Kirim PDF, PNG, JPG, atau WebP.",
      },
      { status: 415 },
    );
  }

  try {
    const h = await simpanDokumen({
      penggunaId: sesi.id,
      nama: berkas.name,
      jenis,
      isi: new Uint8Array(await berkas.arrayBuffer()),
    });

    if (!h.ok) {
      // Gagal MEMBACA (PDF hasil scan, Ollama mati, RAM penuh) -- bukan
      // permintaan yang salah bentuk. 422: permintaannya sah, isinya yang
      // tidak bisa diproses.
      return Response.json({ error: h.pesan }, { status: 422 });
    }

    const d = h.dokumen;
    return Response.json({
      id: d.id,
      nama: d.nama,
      jenis: d.jenis,
      ukuran: d.ukuran,
      cara: d.cara,
      halaman: d.halaman,
      panjangTeks: d.teks.length,
      cuplikan: d.teks.slice(0, CUPLIKAN),
      detik: d.detik,
      sudahAda: h.sudahAda,
      kosong: d.teks.length === 0,
    });
  } catch (e) {
    console.error("[/api/dokumen]", e);
    return Response.json({ error: "Gagal memproses dokumen." }, { status: 500 });
  }
}

export async function GET() {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const daftar = await daftarDokumen(sesi.id);
  return Response.json({
    dokumen: daftar.map((d) => ({
      id: d.id,
      nama: d.nama,
      jenis: d.jenis,
      cara: d.cara,
      halaman: d.halaman,
      panjangTeks: d.teks.length,
      dibuat: d.dibuat,
    })),
  });
}

export async function DELETE(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Parameter id wajib." }, { status: 400 });

  // `hapusDokumen` menyertakan pengguna_id di WHERE, jadi id milik orang lain
  // tidak akan terhapus -- dan jawabannya sama (404) supaya keberadaannya
  // tidak ikut terkonfirmasi.
  const ok = await hapusDokumen(sesi.id, id);
  return ok
    ? Response.json({ dihapus: true })
    : Response.json({ error: "Dokumen tidak ketemu." }, { status: 404 });
}
