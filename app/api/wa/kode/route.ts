import { sesiAtau401 } from "@/lib/sesi-server";
import { buatKode, statusTaut, MENIT_BERLAKU } from "@/lib/wa-kode";

/** Status tautan WhatsApp milik user yang sedang login. */
export async function GET() {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  return Response.json({
    status: await statusTaut(sesi.id),
    nomorBot: process.env.NOMOR_BOT_WA ?? null,
    menitBerlaku: MENIT_BERLAKU,
  });
}

/**
 * Minta kode baru.
 *
 * Kalau sudah tertaut, TIDAK membuat kode — memutus tautan adalah wewenang
 * admin. Tanpa penjagaan ini, orang yang HP-nya diambil orang lain bisa
 * membuat kode lalu menautkannya ke perangkat baru, dan batas "satu akun satu
 * WhatsApp" jadi tidak berarti.
 */
export async function POST() {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;

  const status = await statusTaut(sesi.id);
  if (status.tertaut) {
    return Response.json(
      { error: "Akun kamu sudah tertaut ke sebuah WhatsApp. Hubungi admin kalau mau menggantinya." },
      { status: 409 },
    );
  }

  return Response.json({ kode: await buatKode(sesi.id), menitBerlaku: MENIT_BERLAKU });
}
