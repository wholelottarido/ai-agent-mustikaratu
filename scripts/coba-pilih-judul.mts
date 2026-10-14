/**
 * PERCOBAAN, bukan uji regresi: apakah RAG masih perlu untuk memilih DOKUMEN?
 *
 *   npm run coba:judul
 *
 * ⚠️ PERTANYAAN YANG DIJAWAB BERKAS INI.
 *
 * Korpus kita cuma 24 dokumen. Seluruh daftarnya -- kode, judul, kategori --
 * cuma 1.379 huruf, sekitar 345 token. Itu MUAT di system prompt.
 *
 * Kalau muat, timbul pertanyaan yang tidak enak: untuk memilih DOKUMEN mana
 * yang relevan, apakah pencarian vektor masih memberi sesuatu yang tidak bisa
 * diberi daftar judul biasa? Model jauh lebih paham bahasa daripada vektor
 * 768 dimensi. Dugaan itu punya bukti: satu-satunya pertanyaan yang masih
 * meleset di `test:kb` adalah "barang belum terdaftar di sistem" -> vektor
 * memilih "Pengelolaan Data Aset Perangkat", padahal yang benar "Permintaan
 * Kode Barang Baru". Model yang membaca dua judul itu kemungkinan besar tidak
 * akan tertukar.
 *
 * Yang dibandingkan: 12 pertanyaan yang SAMA dengan `test:kb`, ground truth
 * yang sama, lawan hasil vektor 11/12.
 *
 * ⚠️ INI TIDAK MENGUJI PEMILIHAN POTONGAN. Nilai RAG yang paling jelas ada di
 * situ (terukur 5/5 potongan tepat di `test:kb-tool`), dan daftar judul tidak
 * bisa menggantikannya. Yang diuji cuma lapisan "dokumen mana".
 *
 * ⚠️ Pertanyaannya DISALIN dari `scripts/test-kb-cari.mts`, dan itu memang
 * duplikasi. Dibiarkan karena berkas ini percobaan sekali jalan; kalau
 * hasilnya dipakai, kumpulan pertanyaan harus dipindah ke satu tempat lebih
 * dulu.
 */
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

const UJI = [
  { tanya: "berapa lama proses pembuatan alamat surel karyawan", harap: "SOP-IT-001" },
  { tanya: "karyawan resign, akunnya diapakan", harap: "SOP-IT-002" },
  { tanya: "mau pinjam proyektor buat presentasi besok", harap: "SOP-IT-004" },
  { tanya: "hasil cetakan bergaris dan warnanya pudar", harap: "SOP-IT-005" },
  { tanya: "wifi satu lantai mati semua", harap: "SOP-IT-006" },
  { tanya: "akun navision terkunci gara-gara salah sandi", harap: "SOP-IT-007" },
  { tanya: "barang belum terdaftar di sistem, bagaimana", harap: "SOP-IT-008" },
  { tanya: "berkas kehapus kemarin masih bisa diambil lagi", harap: "SOP-IT-014" },
  { tanya: "cara menolak pekerjaan tim lapangan di supertools", harap: "SOP-ST-001" },
  { tanya: "pengajuan penggantian biaya promosi ditolak", harap: "SOP-MAPS-001" },
  { tanya: "mau libur minggu depan, ajukan ke siapa", harap: "SOP-HR-001" },
  { tanya: "komputer sama sekali tidak menyala", harap: "SOP-IT-011" },
];

const r = await poolPerusahaan().query(
  "SELECT kode, judul, kategori, aplikasi FROM ai_kb_dokumen ORDER BY kode",
);
const daftar = (r.rows as Record<string, string>[])
  .map((d) => `${d.kode} — ${d.judul} (${d.kategori ?? "-"} / ${d.aplikasi ?? "-"})`)
  .join("\n");

console.log(`daftar ${r.rows.length} dokumen = ${daftar.length} huruf (~${Math.round(daftar.length / 4)} token)\n`);

const KUNCI = process.env.ANTHROPIC_API_KEY;
if (!KUNCI) {
  console.error("ANTHROPIC_API_KEY belum diisi.");
  process.exitCode = 1;
} else {
  const MODEL = process.argv.includes("--sonnet") ? "claude-sonnet-5" : "claude-haiku-4-5";
  console.log(`model: ${MODEL}\n`);

  let kena = 0;
  const salah: string[] = [];
  const mulai = Date.now();

  for (const u of UJI) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KUNCI,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 20,
        system:
          "Kamu memilih satu dokumen SOP yang paling menjawab pertanyaan user.\n" +
          "Jawab HANYA dengan kode dokumennya, tanpa penjelasan apa pun.\n" +
          "Kalau tidak ada yang cocok, jawab TIDAK-ADA.\n\n" +
          `Dokumen yang tersedia:\n${daftar}`,
        messages: [{ role: "user", content: u.tanya }],
      }),
    });
    const j = (await res.json()) as { content?: { text?: string }[]; error?: { message?: string } };
    if (j.error) {
      console.error(`GALAT: ${j.error.message}`);
      process.exitCode = 1;
      break;
    }
    const jawab = (j.content?.[0]?.text ?? "").trim().toUpperCase();
    const benar = jawab.includes(u.harap);
    if (benar) kena++;
    else salah.push(`${u.tanya} -> ${jawab} (harap ${u.harap})`);
    console.log(`  ${benar ? "TEPAT  " : "MELESET"} ${jawab.padEnd(14)} "${u.tanya}"`);
  }

  const detik = ((Date.now() - mulai) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(58)}`);
  console.log(`  DAFTAR JUDUL   ${kena}/${UJI.length} peringkat-1   ${detik} dtk total`);
  console.log(`  VEKTOR (RAG)   11/${UJI.length} peringkat-1   <- pembanding, test:kb`);
  console.log("=".repeat(58));
  if (salah.length) {
    console.log("\nyang meleset:");
    for (const s of salah) console.log(`  - ${s}`);
  }
  process.exitCode = 0;
}
