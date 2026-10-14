import { sesiAtau401 } from "@/lib/sesi-server";
import type { Sesi } from "@/lib/sesi";
import { hakPersetujuan } from "@/lib/admin";
import { daftarSumber, gantiSumber } from "@/lib/sumber-db";

/**
 * Saklar sumber data: database mana yang dibaca agent.
 *
 * ⚠️ ADMIN PENUH SAJA — kepala departemen TIDAK boleh.
 *
 * `hakPersetujuan()` memberi `boleh: true` untuk dua orang berbeda: admin
 * (`cakupan: null`) dan kepala departemen (`cakupan: "marketing"`). Untuk
 * menyetujui pendaftaran itu masuk akal — kepala mengurus departemennya
 * sendiri. Di sini TIDAK: mengganti sumber data mengubah apa yang dibaca
 * SELURUH sistem, lintas departemen. Kepala marketing tidak boleh mengubah
 * dari mana agent HR mengambil datanya.
 *
 * Karena itu `cakupan === null` diperiksa eksplisit, bukan cuma `boleh`.
 *
 * ⚠️ Diperiksa ke DATABASE tiap permintaan, bukan dari token — token memuat
 * `admin` yang baru berubah setelah 8 jam, jadi admin yang haknya dicabut
 * masih bisa mengganti sumber selama tokennya hidup.
 */
async function adminPenuhAtauTolak(): Promise<
  { sesi: Sesi; balas?: never } | { sesi?: never; balas: Response }
> {
  const hasil = await sesiAtau401();
  if (hasil.balas) return { balas: hasil.balas };

  const hak = await hakPersetujuan(hasil.sesi.id);
  if (!hak.boleh || hak.cakupan !== null) {
    // 404, bukan 403 — mengikuti jalur admin yang sudah ada: jangan
    // mengonfirmasi bahwa halaman ini memang ada.
    return { balas: Response.json({ error: "Tidak ditemukan." }, { status: 404 }) };
  }
  return { sesi: hasil.sesi };
}

export async function GET() {
  const { balas } = await adminPenuhAtauTolak();
  if (balas) return balas;

  return Response.json({ sumber: await daftarSumber() });
}

export async function POST(req: Request) {
  const { sesi, balas } = await adminPenuhAtauTolak();
  if (balas) return balas;

  try {
    const { kode } = await req.json();
    if (typeof kode !== "string" || kode.trim() === "") {
      return Response.json({ error: "Kode sumber wajib diisi." }, { status: 400 });
    }

    const hasil = await gantiSumber(kode.trim(), sesi.username);
    if (!hasil.ok) {
      // 404 untuk kode yang tidak ada, 409 untuk yang ada tapi belum siap
      // dipakai -- dua hal berbeda, dan halaman perlu membedakannya.
      return Response.json(
        { error: hasil.pesan, sebab: hasil.sebab },
        { status: hasil.sebab === "tidak-dikenal" ? 404 : 409 },
      );
    }

    return Response.json({ ok: true, sumber: hasil.sumber });
  } catch (error) {
    console.error("[/api/admin/sumber]", error);
    return Response.json({ error: "Gagal mengganti sumber data." }, { status: 500 });
  }
}
