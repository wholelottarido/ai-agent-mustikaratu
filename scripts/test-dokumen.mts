/**
 * Uji pembaca dokumen (Tahap 12A) — dari terminal, tanpa UI.
 *
 *   npm run test:dokumen                    # uji bawaan
 *   npm run test:dokumen -- "C:\\...\\x.pdf"  # uji berkas sendiri
 *
 * Tidak butuh server. Bagian OCR butuh Ollama jalan; kalau tidak, tes itu
 * DILEWATI dengan keterangan — bukan dianggap gagal, karena Ollama mati itu
 * keadaan mesin, bukan bug kode.
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bacaDokumen, JENIS_DITERIMA, UKURAN_MAKS, pakaiCloud } from "../lib/dokumen/baca.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const lewat: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

console.log("--- penolakan ---");
{
  const h = await bacaDokumen(new Uint8Array(10), "application/msword");
  cek(!h.ok && h.pesan.includes("belum didukung"), "jenis berkas asing ditolak");
}
{
  const h = await bacaDokumen(new Uint8Array(UKURAN_MAKS + 1), "application/pdf");
  cek(!h.ok && h.pesan.includes("terlalu besar"), "berkas kelewat besar ditolak");
}
{
  const h = await bacaDokumen(new Uint8Array([1, 2, 3, 4]), "application/pdf");
  cek(!h.ok, "PDF rusak ditolak dengan pesan, bukan error mentah",
    h.ok ? "MALAH LOLOS" : h.pesan.slice(0, 60));
}
{
  cek(JENIS_DITERIMA.includes("application/pdf" as never)
    && JENIS_DITERIMA.includes("image/png" as never), "PDF & PNG termasuk yang diterima");
}

console.log("--- PDF berteks tertanam ---");
const berkas = process.argv[2] ?? "C:/Users/ridho/Downloads/Detail Guideline _ Supertools.pdf";
let isi: Uint8Array | null = null;
try {
  isi = new Uint8Array(await readFile(berkas));
  console.log(`  berkas: ${berkas} (${Math.round(isi.byteLength / 1024)} KB)`);
} catch {
  lewat.push(`PDF contoh tidak ketemu di ${berkas} — bagian ini dilewati`);
}

if (isi) {
  const h = await bacaDokumen(isi, "application/pdf");
  cek(h.ok, "PDF terbaca", h.ok ? "" : h.pesan);
  if (h.ok) {
    cek(h.cara === "teks-tertanam", `pakai teks tertanam, BUKAN OCR (${h.cara})`);
    cek(h.teks.length > 500, `dapat ${h.teks.length} karakter`);
    cek((h.halaman ?? 0) > 0, `${h.halaman} halaman`);

    // ⚠️ Inti dari urutan "teks dulu, OCR belakangan": ini harus milidetik,
    // bukan menit. Kalau suatu saat jatuh ke OCR tanpa sengaja, angka ini
    // yang berteriak duluan.
    cek(h.detik < 5, `selesai ${h.detik.toFixed(2)} detik (OCR butuh ~63 dtk/halaman)`);

    // Isi yang benar-benar ada di dokumen itu.
    const t = h.teks.toLowerCase();
    cek(t.includes("supertools") && t.includes("tanggapan"),
      "isinya sesuai dokumen (menyebut Supertools & tanggapan)");
  }
}

console.log(`--- OCR gambar (${pakaiCloud() ? "lewat cloud" : "lokal/Ollama"}) ---`);
{
  // Jalur lokal butuh Ollama hidup; jalur cloud butuh kunci API.
  const siap = pakaiCloud()
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : await fetch(`${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      }).then((r) => r.ok).catch(() => false);

  if (!siap) {
    lewat.push(pakaiCloud() ? "ANTHROPIC_API_KEY kosong — uji OCR dilewati"
                            : "Ollama tidak jalan — uji OCR dilewati");
  } else {
    // PNG 1x1 piksel sah, dibuat di sini supaya tes tidak bergantung berkas
    // luar. Tidak ada teks di dalamnya, jadi hasil yang BENAR adalah kosong.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const tmp = join(tmpdir(), `uji-${Date.now()}.png`);
    await writeFile(tmp, png);
    const h = await bacaDokumen(new Uint8Array(png), "image/png");
    await unlink(tmp).catch(() => {});

    if (!h.ok && /memori/i.test(h.pesan)) {
      lewat.push(`RAM tidak cukup untuk granite — uji OCR dilewati (${h.pesan.slice(0, 60)}…)`);
    } else {
      cek(h.ok, "gambar terbaca tanpa error", h.ok ? `${h.detik.toFixed(1)} dtk` : h.pesan);
      if (h.ok) {
        cek(h.cara.startsWith("ocr"), `ditandai hasil OCR (${h.cara})`);
        // ⚠️ Yang dijaga: model TIDAK mengarang teks pada gambar kosong.
        cek(h.teks === "", "gambar tanpa teks -> kosong, bukan karangan", JSON.stringify(h.teks).slice(0, 60));
      }
    }
  }
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of lewat) console.log(`  LEWAT  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal, ${lewat.length} dilewati`);
// ⚠️ `process.exitCode`, BUKAN `process.exit()`.
//
// `process.exit()` memutus proses saat koneksi HTTP ke Anthropic masih
// ditutup, dan libuv di Windows crash:
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
// Akibatnya tes MELAPORKAN semuanya lolos tapi keluar dengan kode 127 --
// hijau di layar, merah untuk gerbang mana pun yang memeriksa kode keluar.
process.exitCode = gagal.length === 0 ? 0 : 1;
