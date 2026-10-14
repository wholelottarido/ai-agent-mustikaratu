/**
 * Mengalirkan berkas PDF sebuah dokumen SOP.
 *
 *   GET /api/sop/SOP-IT-005/berkas
 *
 * ⚠️ BERKASNYA DIAMBIL DARI DATABASE, BUKAN DARI DISK.
 *
 * `ai_kb_berkas.bita` menyimpan PDF-nya sebagai `bytea` (2 KB per dokumen).
 * Tidak ada berkas di sistem berkas yang bisa salah salin atau tertinggal
 * waktu dipindah mesin — dan tidak ada jalur di mana nama berkas dari user
 * bisa menyentuh path apa pun.
 *
 * ⚠️ SENGAJA TIDAK MENERIMA PATH, HANYA KODE DOKUMEN.
 *
 * Kodenya dicocokkan ke kolom `kode` lewat parameter query, jadi tidak ada
 * perangkaian string sama sekali. Kode yang tidak dikenal -> 404, bukan
 * berkas kosong.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { sesiAtau401 } from "@/lib/sesi-server";

/**
 * Bentuk kode yang sah. Diperiksa SEBELUM menyentuh database supaya kode
 * ngawur tidak jadi query sia-sia, dan supaya tidak ada yang bisa dipakai
 * memancing galat database lewat isi parameter.
 */
const POLA_KODE = /^[A-Z0-9][A-Z0-9-]{2,63}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kode: string }> },
) {
  // ⚠️ Wajib login. Dokumen SOP memang untuk seluruh karyawan, tapi "seluruh
  // karyawan" bukan "siapa saja di internet".
  const { balas } = await sesiAtau401();
  if (balas) return balas;

  const { kode } = await params;
  const bersih = decodeURIComponent(kode ?? "").toUpperCase();
  if (!POLA_KODE.test(bersih)) {
    return Response.json({ error: "Kode dokumen tidak sah." }, { status: 400 });
  }

  const r = await poolPerusahaan().query(
    `SELECT b.nama_berkas, b.jenis, b.bita, d.judul
       FROM ai_kb_berkas b JOIN ai_kb_dokumen d USING (id_dokumen)
      WHERE d.kode = $1`,
    [bersih],
  );
  const baris = r.rows[0] as
    | { nama_berkas: string; jenis: string; bita: Buffer; judul: string }
    | undefined;

  if (!baris) {
    return Response.json(
      { error: `Dokumen "${bersih}" tidak ada, atau belum punya berkas PDF.` },
      { status: 404 },
    );
  }

  // `inline` supaya terbuka di penampil PDF browser, bukan langsung terunduh.
  // Yang ingin menyimpannya tinggal menekan simpan di penampil itu; yang cuma
  // ingin memeriksa satu baris tidak perlu menumpuk berkas di folder unduhan.
  return new Response(new Uint8Array(baris.bita), {
    headers: {
      "Content-Type": baris.jenis || "application/pdf",
      "Content-Length": String(baris.bita.length),
      "Content-Disposition": `inline; filename="${baris.nama_berkas}"`,
      // Isinya berubah tiap kali `pasang:kb-pdf` dijalankan ulang, dan
      // dokumen yang sudah disinggahi browser akan membingungkan waktu
      // rujukan barisnya ikut berubah.
      "Cache-Control": "no-store",
    },
  });
}
