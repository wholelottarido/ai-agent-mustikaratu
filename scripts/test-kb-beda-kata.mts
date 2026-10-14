/**
 * Apakah pencarian makna bekerja waktu kata user BERBEDA dari dokumennya.
 *
 *   npm run test:kb-beda
 *
 * ⚠️ DITULIS ULANG 2 OKT 2026 untuk korpus `ai_knowledge`.
 *
 * Versi sebelumnya menguji korpus `ai_kb_*` berisi 24 SOP yang ditulis
 * sendiri untuk pengujian. Korpus itu DIHAPUS pihak lain, dan digantikan
 * panduan aplikasi perusahaan yang sungguhan (MAPS, Supertools, CWOD,
 * budget). Ground truth lamanya -- kode seperti `SOP-IT-005` -- tidak ada
 * lagi, jadi ujinya ditulis ulang, bukan ditambal.
 *
 * ⚠️ KENAPA UJI INI ADA.
 *
 * Pertanyaan di bawah SENGAJA memakai kata yang tidak ada di judul maupun
 * isi dokumennya: "pesan barang tiap minggu" untuk dokumen yang menulis
 * "Confirm Weekly Order", "pindahkan dana" untuk "Transfer Budget". Kalau
 * pencariannya cuma mencocokkan huruf, semua ini meleset.
 *
 * ⚠️ PERTANYAAN UJI DIPILIH SETELAH DIUKUR, BUKAN SEBELUM.
 *
 * Satu kandidat dibuang: "atur jadwal keliling toko" diharapkan menemukan
 * "Panduan Menggunakan Menu Call Plan", tapi yang keluar "Cara Melakukan
 * Kunjungan ke Toko" -- dan jawaban itu sebenarnya masuk akal. Menyimpan
 * harapan yang keliru membuat uji ini menyesatkan, bukan ketat.
 */
import { cariSop } from "../lib/kb/cari.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

type Uji = { tanya: string; harap: string; beda: string };

const UJI: Uji[] = [
  { tanya: "distributor mau pesan barang tiap minggu", harap: "CWOD",
    beda: "dokumen menulis 'Confirm Weekly Order'" },
  { tanya: "mau pindahkan dana antar program", harap: "Transfer Budget",
    beda: "dokumen menulis 'budget', bukan 'dana'" },
  { tanya: "aplikasi tidak jalan karena sinyal hilang", harap: "Sinyal Lemah",
    beda: "dokumen menulis 'Tanpa Jaringan'" },
  { tanya: "mau lihat barang dagangan apa saja", harap: "Daftar Barang",
    beda: "dokumen menulis 'Barang', bukan 'dagangan'" },
  { tanya: "mengembalikan barang rusak", harap: "Retur Barang",
    beda: "dokumen menulis 'Retur'" },
  { tanya: "pasang aplikasi di hp android", harap: "Mobile",
    beda: "dokumen menulis 'Unduh dan Pasang'" },
  { tanya: "menyetujui pengajuan dokumen", harap: "Approval",
    beda: "dokumen menulis 'Menyetujui / Menolak Dokumen'" },
  // Dua di bawah MELESET pada pengukuran 2 Okt 2026. Sengaja dipertahankan:
  // uji yang cuma berisi kasus yang lolos berhenti memberi tahu apa pun.
  { tanya: "cara mencatat kedatangan di outlet", harap: "Absen Datang",
    beda: "dokumen menulis 'Check-in di Toko'" },
  { tanya: "batas pemakaian AI tiap karyawan", harap: "Kuota",
    beda: "dokumen menulis 'Mengatur Kuota Ratu AI Karyawan'" },
];

const p = poolPerusahaan();

/** Pembanding: pencocokan huruf murni, tanpa pemahaman makna. */
async function trigram(tanya: string): Promise<string> {
  const r = await p.query(
    `SELECT d.title FROM ai_knowledge.chunks c
       JOIN ai_knowledge.documents d USING (id_document)
      GROUP BY d.title
      ORDER BY MAX(word_similarity($1, LOWER(c.content))) DESC LIMIT 1`,
    [tanya.toLowerCase()],
  );
  return String((r.rows[0] as { title: string } | undefined)?.title ?? "-");
}

const n = await p.query(
  "SELECT COUNT(*)::int x FROM ai_knowledge.chunks WHERE embedding IS NOT NULL",
);
console.log(`korpus: ${(n.rows[0] as { x: number }).x} potongan ber-vektor\n`);

let v1 = 0;
let v3 = 0;
let t1 = 0;

for (const u of UJI) {
  const h = await cariSop(u.tanya, { batas: 3 });
  const tg = await trigram(u.tanya);
  const cocok = (s: string) => s.toLowerCase().includes(u.harap.toLowerCase());

  const kena1 = cocok(h[0]?.judul ?? "");
  const kena3 = h.some((x) => cocok(x.judul));
  if (kena1) v1++;
  if (kena3) v3++;
  if (cocok(tg)) t1++;

  console.log(`${kena1 ? "TEPAT  " : kena3 ? "di-3   " : "MELESET"} "${u.tanya}"`);
  console.log(`         harap mengandung "${u.harap}" · ${u.beda}`);
  console.log(`         vektor  ${h.map((x) => x.judul.slice(0, 34)).join(" | ")}`);
  console.log(`         trigram ${tg.slice(0, 44)}${cocok(tg) ? "  TEPAT" : "  meleset"}\n`);
}

console.log("=".repeat(58));
console.log(`  VEKTOR   peringkat-1 ${v1}/${UJI.length}   dalam-3 ${v3}/${UJI.length}`);
console.log(`  TRIGRAM  peringkat-1 ${t1}/${UJI.length}   <- pembanding`);
console.log("=".repeat(58));
process.exitCode = 0;
