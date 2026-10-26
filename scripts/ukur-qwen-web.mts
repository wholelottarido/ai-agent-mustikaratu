/**
 * Langkah 1 — MENGUKUR keadaan Qwen di jalur web, sebelum apa pun diperbaiki.
 *
 *   npm run ukur:qwen           ← bagian struktural saja (tanpa model)
 *   npm run ukur:qwen -- --tanya  ← ikut memanggil Qwen (butuh RAM ~5 GB bebas)
 *
 * HANYA MEMBACA. Tidak menulis ke database mana pun.
 *
 * ============================================================
 * KENAPA DIUKUR DULU, BUKAN LANGSUNG DITAMBAL
 * ============================================================
 * Rencananya memasang penahan jawaban palsu di web. Tapi aturan "model lokal
 * cuma boleh satu tool" (diukur 24 Sep 2026: 10/12 dengan satu tool, 2/6
 * dengan dua) hidup di `pilihTools()` milik JALUR LAMA — dan jalur yang aktif
 * sekarang `JALUR_AGENT=konfigurasi`, yang merakit tool dari setelan database
 * tanpa melihat penyedia modelnya sama sekali.
 *
 * Kalau dugaan itu benar, sebagian halusinasi yang mau ditahan adalah AKIBAT
 * regresi ini, bukan sifat bawaan Qwen. Memasang penahan tanpa mengukurnya
 * dulu sama dengan memasang jaring di bawah lubang yang masih terbuka.
 *
 * Bagian struktural di bawah DETERMINISTIK dan tidak memanggil model —
 * jadi tetap bisa dijalankan di laptop yang RAM-nya tidak cukup untuk Qwen.
 */
import { siapkanAgent } from "../voltagent/jalur-agent.ts";
import { MODEL_TERSEDIA, ambilModel, ollamaHidup, alamatOllama } from "../voltagent/models.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

const ikutTanya = process.argv.includes("--tanya");

function judul(t: string) {
  console.log(`\n${"=".repeat(60)}\n${t}\n${"=".repeat(60)}`);
}

// ============================================================
judul("1. Model lokal yang terdaftar");
// ============================================================
const lokal = MODEL_TERSEDIA.filter((m) => m.penyedia === "lokal");
for (const m of lokal) console.log(`  ${m.id.padEnd(22)} ${m.label}`);
if (lokal.length === 0) console.log("  (tidak ada model lokal di whitelist)");

// ============================================================
judul("2. Berapa tool yang DIPEGANG Qwen di jalur web");
// ============================================================
// Sesi diambil dari akun uji yang sudah ada, bukan dikarang: jumlah tool
// bergantung pada izin orangnya, jadi angka dari identitas palsu tidak
// menjawab apa pun.
//
// ⚠️ Bagian ini butuh MySQL hidup — `muatKonfig()` ikut membaca tabel
// sambungan & persetujuan di database portal. Kalau mati, bagian 3 (yang
// murni membaca kode) TETAP dijalankan: pengukuran yang berhenti total karena
// satu bagian tidak tersedia memberi nol informasi, padahal sebagian
// jawabannya ada.
let rows: { id_employee: string; username: string }[] = [];
try {
  ({ rows } = await poolPerusahaan().query<{ id_employee: string; username: string }>(
    `SELECT e.id_employee, u.username FROM employee e
       JOIN users u ON u.id_users = e.id_users
      WHERE lower(u.username) IN ('dafi@mustika-ratu.co.id', 'ridho@mustika-ratu.co.id')
      ORDER BY u.username`,
  ));
} catch (e) {
  console.log(`  TIDAK BISA DIUKUR — ${(e as Error).message}`);
}

let adaYangTerukur = false;
for (const r of rows) {
  let jalur;
  try {
    jalur = await siapkanAgent(r.id_employee);
  } catch (e) {
    const pesan = (e as { code?: string }).code === "ECONNREFUSED"
      ? "MySQL tidak hidup — nyalakan Laragon dulu (muatKonfig ikut membaca database portal)"
      : (e as Error).message;
    console.log(`\n  ${r.username}\n    TIDAK BISA DIUKUR — ${pesan}`);
    break;
  }
  adaYangTerukur = true;
  if (jalur.jalur === "lama") {
    console.log(`\n  ${r.username}\n    jatuh ke jalur LAMA — ${jalur.sebab}`);
    continue;
  }
  console.log(`\n  ${r.username}`);
  console.log(`    agent perute : 1 (+ delegate_task)`);
  console.log(`    agent aplikasi: ${jalur.bawahan.length}`);
  for (const b of jalur.bawahan) {
    console.log(`      ${b.kode.padEnd(18)} ${b.jumlahTool} tool`);
  }
  if (jalur.dilewati.length > 0) {
    console.log(`    tool dilewati: ${jalur.dilewati.length}`);
  }
  const maks = Math.max(0, ...jalur.bawahan.map((b) => b.jumlahTool));
  console.log(`    tool terbanyak di satu agent: ${maks}`);
  // ⚠️ Angka pembandingnya BUKAN selera. 24 Sep 2026, qwen2.5:7b diukur lewat
  // agent sungguhan: 10/12 benar dengan SATU tool, 2/6 dengan DUA.
  console.log(
    maks > 1
      ? `    ⚠️ LEWAT BATAS UKUR — aturan "model lokal cuma 1 tool" tidak berlaku di jalur ini`
      : `    sesuai batas ukur`,
  );
}
if (rows.length > 0 && !adaYangTerukur) {
  console.log("\n  (bagian ini akan terisi begitu MySQL hidup)");
}

// ============================================================
judul("3. Apakah pembatas jalur lama ikut di jalur konfigurasi?");
// ============================================================
// Dicari di kode, bukan disimpulkan dari jumlah tool di atas — jumlah tool
// bisa kebetulan satu untuk pemakai tertentu, dan itu akan menyembunyikan
// bahwa pembatasnya memang tidak ada.
const { readFileSync } = await import("node:fs");
for (const berkas of ["voltagent/agent-konfig.ts", "voltagent/jalur-agent.ts", "voltagent/tool-konfigurasi.ts"]) {
  const isi = readFileSync(berkas, "utf8");
  const sebut = /penyedia|hanyaQuery|lokal/.test(isi);
  console.log(`  ${berkas.padEnd(34)} ${sebut ? "menyebut penyedia/lokal" : "TIDAK menyebut penyedia sama sekali"}`);
}

// ============================================================
judul("4. Memanggil Qwen sungguhan");
// ============================================================
if (!ikutTanya) {
  console.log("  dilewati — jalankan dengan `-- --tanya` untuk ikut memanggil model.");
  console.log("  ⚠️ Butuh RAM ~5 GB bebas. Di bawah itu Ollama gagal memuat bobotnya,");
  console.log("     dan galatnya menyebut GPU padahal yang habis RAM sistem.");
} else if (!(await ollamaHidup())) {
  console.log(`  Ollama tidak menjawab di ${alamatOllama()} — nyalakan dulu.`);
} else {
  const m = ambilModel(lokal[0]?.id);
  console.log(`  model: ${m.id}`);
  console.log("  (bagian ini diisi setelah langkah 2 selesai — lihat rencana)");
}

// ⚠️ `process.exitCode`, BUKAN `process.exit()`.
//
// `process.exit()` memutus proses saat masih ada handle yang sedang ditutup,
// dan Node membalasnya dengan `Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)` lalu KODE KELUAR 127 — hijau di layar, merah untuk
// gerbang mana pun yang memeriksa kode keluar. Terjadi di sini waktu MySQL
// mati: pool portal meninggalkan koneksi yang gagal setengah jalan.
//
// Jebakan yang sama pernah kena `test:dokumen` (30 Sep 2026).
for (const tutup of [
  () => poolPerusahaan().end(),
  async () => { const { poolPortalApp } = await import("../lib/db-portal.ts"); await poolPortalApp().end(); },
]) {
  try { await tutup(); } catch { /* sudah tertutup atau memang tidak pernah terbuka */ }
}
process.exitCode = 0;
