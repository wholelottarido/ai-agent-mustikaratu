/**
 * Menyimpan tiket helpdesk. Dipicu TOMBOL, bukan model.
 *
 * ⚠️ SATU-SATUNYA pintu HTTP yang menulis ke `portal_ticket`. Tidak ada tool
 * agent yang mengarah ke sini — model cuma menyusun rancangan lewat
 * `siapkan_tiket`.
 *
 * ⚠️ RANCANGAN DARI KLIEN TIDAK DIPERCAYA. Yang diterima cuma permintaan
 * aslinya (kategori, judul, deskripsi) plus `sidik` rancangan yang DILIHAT
 * user. Server menyusun ulang rancangannya sendiri lalu membandingkan
 * sidiknya. Kalau rancangan jadi yang dipercaya, siapa pun bisa mengirim
 * `id_category` karangan lewat curl — dan `portal_ticket` tidak punya satu pun
 * foreign key yang akan menolaknya.
 *
 * `id_employee` diambil dari SESI, tidak pernah dari badan permintaan. Tanpa
 * itu, siapa pun yang sudah login bisa melaporkan tiket atas nama orang lain.
 */
import { sesiAtau401 } from "@/lib/sesi-server";
import { simpanTiket, simpanUbahTiket } from "@/lib/entri/simpan-tiket";
import { masalahJadiTeks } from "@/lib/entri/tiket";
import { masalahUbahJadiTeks } from "@/lib/entri/tiket-ubah";

export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (!sesi) return balas;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Badan permintaan bukan JSON." }, { status: 400 });
  }

  const teks = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  const sidik = teks("sidik");
  if (!sidik) return Response.json({ error: "Sidik rancangan tidak disertakan." }, { status: 400 });

  try {
    const hasil = await simpanTiket(
      sesi.idEmployee ?? null,
      {
        kategori: teks("kategori"),
        subKategori: teks("subKategori"),
        judul: teks("judul"),
        deskripsi: teks("deskripsi"),
        prioritas: teks("prioritas"),
      },
      sidik,
    );

    if (!hasil.ok) {
      // 409 untuk rancangan yang sudah basi: bukan salah pengirim, dan bukan
      // kegagalan server -- keadaannya berubah, dan user perlu melihat
      // rancangan yang baru.
      const status = hasil.sebab === "draf-berubah" ? 409 : hasil.sebab === "tidak-sah" ? 400 : 500;
      return Response.json(
        {
          error: hasil.masalah ? masalahJadiTeks(hasil.masalah) : hasil.pesan,
          sebab: hasil.sebab,
        },
        { status },
      );
    }

    return Response.json({
      ok: true,
      noTicket: hasil.noTicket,
      idTicket: hasil.idTicket,
      kategori: `${hasil.draf.kategori.nama} / ${hasil.draf.subKategori.nama}`,
    });
  } catch (e) {
    // Role penulis yang belum dibuat sampai di sini. Pesannya disampaikan apa
    // adanya ke administrator -- menyamarkannya jadi "gagal menyimpan" membuat
    // penyebabnya harus ditebak.
    const pesan = (e as Error).message;
    console.error("simpan tiket gagal:", pesan);
    return Response.json({ error: pesan }, { status: 500 });
  }
}

/**
 * Menyunting tiket. Dipicu TOMBOL, bukan model.
 *
 * ⚠️ Rancangan dari klien tidak dipercaya — sama seperti POST. Yang diterima
 * nomor tiket, permintaan aslinya, dan sidik; server membaca ulang tiketnya,
 * menyusun ulang rancangannya, lalu membandingkan sidiknya.
 *
 * Sidik di sini ikut memuat NILAI LAMA, jadi tiket yang berubah di antara
 * "lihat rancangan" dan "tekan Simpan" tertangkap — penyuntingan tidak menimpa
 * perubahan orang lain diam-diam.
 */
export async function PATCH(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (!sesi) return balas;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Badan permintaan bukan JSON." }, { status: 400 });
  }

  const teks = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  const sidik = teks("sidik");
  if (!sidik) return Response.json({ error: "Sidik rancangan tidak disertakan." }, { status: 400 });

  try {
    const hasil = await simpanUbahTiket(
      sesi.idEmployee ?? null,
      {
        noTiket: teks("noTiket"),
        judul: teks("judul"),
        deskripsi: teks("deskripsi"),
        prioritas: teks("prioritas"),
      },
      sidik,
    );

    if (!hasil.ok) {
      const status = hasil.sebab === "draf-berubah" ? 409 : hasil.sebab === "tidak-sah" ? 400 : 500;
      return Response.json(
        { error: hasil.masalah ? masalahUbahJadiTeks(hasil.masalah) : hasil.pesan, sebab: hasil.sebab },
        { status },
      );
    }

    return Response.json({ ok: true, noTicket: hasil.noTicket, perubahan: hasil.perubahan });
  } catch (e) {
    const pesan = (e as Error).message;
    console.error("ubah tiket gagal:", pesan);
    return Response.json({ error: pesan }, { status: 500 });
  }
}
