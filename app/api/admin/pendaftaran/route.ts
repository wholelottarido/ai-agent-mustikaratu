import { sesiAtau401 } from "@/lib/sesi-server";
import type { Sesi } from "@/lib/sesi";
import { hakPersetujuan, daftarPengajuan, setujui, tolak } from "@/lib/admin";

/**
 * Tinjau & putuskan pengajuan akun.
 *
 * ⚠️ DUA LAPIS PENJAGA, dan yang kedua yang menentukan:
 *   1. `proxy.ts` menyaring dari token — cepat, tapi token memuat `admin`
 *      yang baru berubah setelah 8 jam.
 *   2. `benarAdmin()` di sini memeriksa ke DATABASE tiap kali.
 *
 * Tanpa lapis kedua, admin yang haknya baru dicabut masih bisa menyetujui
 * akun selama tokennya belum kedaluwarsa.
 */
async function adminAtauTolak(): Promise<
  { sesi: Sesi; cakupan: string | null; balas?: never }
  | { sesi?: never; cakupan?: never; balas: Response }
> {
  const hasil = await sesiAtau401();
  if (hasil.balas) return { balas: hasil.balas };

  const hak = await hakPersetujuan(hasil.sesi.id);
  if (!hak.boleh) {
    // 404, bukan 403: jangan mengonfirmasi bahwa halaman admin memang ada.
    return { balas: Response.json({ error: "Tidak ditemukan." }, { status: 404 }) };
  }
  // `cakupan` null = admin (semua departemen); string = kepala, departemennya
  // sendiri saja.
  return { sesi: hasil.sesi, cakupan: hak.cakupan };
}

export async function GET(req: Request) {
  const { cakupan, balas } = await adminAtauTolak();
  if (balas) return balas;

  const status = new URL(req.url).searchParams.get("status") ?? "menunggu";
  if (!["menunggu", "disetujui", "ditolak"].includes(status)) {
    return Response.json({ error: "Status tidak dikenal." }, { status: 400 });
  }

  return Response.json({
    pengajuan: await daftarPengajuan(status, cakupan),
    // Dipakai halaman untuk mengunci dropdown departemen. Ini cuma tampilan --
    // penegakan sebenarnya ada di `setujui()`/`tolak()`.
    cakupan,
  });
}

export async function POST(req: Request) {
  const { sesi, cakupan, balas } = await adminAtauTolak();
  if (balas) return balas;

  try {
    const { id, aksi, departemen, peran, catatan } = await req.json();

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "Id pengajuan tidak sah." }, { status: 400 });
    }

    if (aksi === "tolak") {
      const h = await tolak(id, sesi.id, typeof catatan === "string" ? catatan : "", cakupan);
      return h.ok ? Response.json({ ok: true }) : Response.json({ error: h.pesan }, { status: 400 });
    }

    if (aksi === "setujui") {
      if (typeof departemen !== "string" || typeof peran !== "string") {
        return Response.json({ error: "Departemen dan peran wajib diisi." }, { status: 400 });
      }
      const h = await setujui(id, sesi.id, departemen, peran, cakupan);
      return h.ok ? Response.json({ ok: true }) : Response.json({ error: h.pesan }, { status: 400 });
    }

    return Response.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (error) {
    console.error("[/api/admin/pendaftaran]", error);
    return Response.json({ error: "Gagal memproses pengajuan." }, { status: 500 });
  }
}
