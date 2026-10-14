import { sesiAtau401 } from "@/lib/sesi-server";
import { ambilDepartemen, bolehEntri } from "@/voltagent";
import { simpanPenjualan } from "@/lib/entri/simpan";

/**
 * Simpan penjualan yang sudah dikonfirmasi user.
 *
 * ⚠️ SATU-SATUNYA jalur yang bisa menulis ke database `marketing`, dan model
 * TIDAK punya akses ke sini. Yang memicunya tombol yang ditekan user.
 *
 * ⚠️ Yang diterima cuma permintaan ASLI + sidik draf — bukan drafnya.
 * `simpanPenjualan()` menyusun ulang drafnya di server lalu membandingkan
 * sidiknya. Kalau draf jadi diterima mentah dari klien, siapa pun bisa
 * mengirim harga karangan lewat curl.
 */
export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const dep = ambilDepartemen(sesi.departemen);
  if (!dep) {
    return Response.json({ error: "Departemen akun ini belum terdaftar." }, { status: 403 });
  }

  // Departemen menyatakan sendiri apakah entri didukung -- jangan memeriksa
  // `sesi.departemen === "marketing"` di sini, pemeriksaan seperti itu
  // tersebar dan pasti ada yang terlewat waktu departemen baru ditambah.
  if (!bolehEntri(dep, sesi.peran, "penjualan")) {
    return Response.json(
      { error: `Departemen ${dep.label} belum bisa memasukkan data.` },
      { status: 403 },
    );
  }

  try {
    const { pelanggan, barang, tanggal, sidik, permintaan } = await req.json();

    if (typeof pelanggan !== "string" || !Array.isArray(barang) || typeof sidik !== "string") {
      return Response.json({ error: "Data konfirmasi tidak lengkap." }, { status: 400 });
    }

    const hasil = await simpanPenjualan(
      { pelanggan, barang, tanggal: typeof tanggal === "string" ? tanggal : undefined },
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
      // 409 untuk draf yang sudah basi: bukan kesalahan user, tapi datanya
      // berubah sejak draf ditampilkan. Klien perlu menyusun draf baru.
      return Response.json(
        { error: hasil.pesan, masalah: hasil.masalah },
        { status: hasil.sebab === "draf-berubah" ? 409 : 400 },
      );
    }

    return Response.json({ ok: true, noOrder: hasil.noOrder, orderId: hasil.orderId });
  } catch (error) {
    console.error("[/api/entri/penjualan]", error);
    return Response.json({ error: "Gagal menyimpan penjualan." }, { status: 500 });
  }
}
