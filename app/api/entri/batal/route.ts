import { sesiAtau401 } from "@/lib/sesi-server";
import { ambilDepartemen, bolehEntri } from "@/voltagent";
import { batalkanPenjualan } from "@/lib/entri/batal";

/**
 * Batalkan penjualan yang sudah dikonfirmasi user.
 *
 * ⚠️ SATU-SATUNYA jalur yang bisa mengubah status order, dan model TIDAK punya
 * akses ke sini. Yang memicunya tombol yang ditekan user.
 *
 * ⚠️ IDENTITAS DIAMBIL DARI SESI, BUKAN DARI BODY.
 *
 * Yang menentukan boleh-tidaknya adalah `sesi.id` — kalau diambil dari body,
 * siapa pun bisa mengaku sebagai orang lain lewat curl dan membatalkan order
 * yang bukan miliknya. Body cuma boleh membawa nomor order dan alasan.
 *
 * ⚠️ Alasan datang LANGSUNG dari user, tidak lewat model. Kalau alasan
 * disusun model, yang tercatat di jejak audit jadi tafsiran model.
 */
export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const dep = ambilDepartemen(sesi.departemen);
  if (!dep) {
    return Response.json({ error: "Departemen akun ini belum terdaftar." }, { status: 403 });
  }

  // Departemen menyatakan sendiri apakah entri didukung -- pembatalan ikut
  // izin yang sama, karena yang dibatalkan adalah hasil entri.
  if (!bolehEntri(dep, sesi.peran, "penjualan")) {
    return Response.json(
      { error: `Departemen ${dep.label} belum bisa memasukkan data.` },
      { status: 403 },
    );
  }

  try {
    const { noOrder, alasan, permintaan } = await req.json();

    if (typeof noOrder !== "string" || typeof alasan !== "string") {
      return Response.json({ error: "Nomor order dan alasan wajib diisi." }, { status: 400 });
    }

    const hasil = await batalkanPenjualan(noOrder, alasan, {
      penggunaId: sesi.id,
      username: sesi.username,
      departemen: sesi.departemen,
      peran: sesi.peran,
      asal: "web",
      permintaan: typeof permintaan === "string" ? permintaan : undefined,
    });

    if (!hasil.ok) {
      // 403 untuk yang bukan miliknya atau sudah lewat waktu: itu soal
      // WEWENANG, bukan permintaan yang salah bentuk. 409 untuk yang sudah
      // dibatalkan: keadaannya sudah berubah sejak user melihat drafnya.
      const status =
        hasil.sebab === "bukan-milik-anda" ||
        hasil.sebab === "kedaluwarsa" ||
        hasil.sebab === "bukan-lewat-aplikasi"
          ? 403
          : hasil.sebab === "sudah-dibatalkan"
            ? 409
            : 400;
      return Response.json({ error: hasil.pesan, sebab: hasil.sebab }, { status });
    }

    return Response.json({ ok: true, noOrder: hasil.noOrder, orderId: hasil.orderId });
  } catch (error) {
    console.error("[/api/entri/batal]", error);
    return Response.json({ error: "Gagal membatalkan penjualan." }, { status: 500 });
  }
}
