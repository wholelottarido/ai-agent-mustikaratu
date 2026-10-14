/**
 * Uji perapihan jawaban model.
 *
 *   npm run test:rapikan
 *
 * Tidak menyentuh database — murni teks masuk, teks keluar.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. LaTeX yang NYATA dikeluarkan model berubah jadi Unicode — termasuk
 *      kalimat asli yang dilaporkan user 7 Okt 2026;
 *   2. NOMINAL TIDAK IKUT RUSAK. Ini pemeriksaan terpenting di berkas ini:
 *      `$` adalah delimiter math DAN tanda mata uang, dan jawaban portal ini
 *      penuh angka. Satu kalimat berisi dua nominal tidak boleh jadi rumus;
 *   3. blok kode dan kode sebaris tidak disentuh — nama view dan SQL yang
 *      dikutip jawaban harus utuh;
 *   4. perintah yang tidak dikenal DIBIARKAN BESERTA `$`-nya, bukan disajikan
 *      separuh jadi, dan `latexTakTerurus()` menyebutkannya;
 *   5. hasilnya aman dilewatkan ke jalur WhatsApp.
 */
import { rapikanJawaban, latexTakTerurus } from "../lib/rapikan-jawaban.ts";
import { keWhatsApp } from "../wa-bot/format.mts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}
function sama(nama: string, masuk: string, harus: string) {
  const keluar = rapikanJawaban(masuk);
  cek(nama, keluar === harus, keluar === harus ? "" : `dapat: ${JSON.stringify(keluar)}`);
}

// ============================================================
console.log("=== 1. Kalimat yang dilaporkan user (7 Okt 2026) ===");
// ============================================================
const asli =
  "Pantau Status: Anda dapat memantau perkembangan status klaim melalui tahapan: " +
  "Pengecekan Data $\\rightarrow$ Menunggu/Diproses (approval) $\\rightarrow$ Disetujui / Ditolak.";
const rapi = rapikanJawaban(asli);
console.log(`  masuk : ${asli.slice(70)}`);
console.log(`  keluar: ${rapi.slice(70)}`);
cek("tidak ada $ yang tersisa", !rapi.includes("$"));
cek("tidak ada backslash yang tersisa", !rapi.includes("\\"));
cek("panah jadi →", rapi.split("→").length === 3, `${rapi.split("→").length - 1} panah`);
cek("kata di sekitarnya utuh", rapi.includes("Pengecekan Data → Menunggu/Diproses (approval)"));

// ============================================================
console.log("\n=== 2. Ragam LaTeX lain yang masih masuk akal ===");
// ============================================================
sama("$\\times$", "3 $\\times$ 4", "3 × 4");
sama("$\\leq$ dan $\\geq$", "nilai $\\leq$ 5 dan $\\geq$ 1", "nilai ≤ 5 dan ≥ 1");
sama("\\( ... \\)", "status \\(\\rightarrow\\) selesai", "status → selesai");
sama("\\[ ... \\]", "hasil \\[\\Sigma\\]", "hasil Σ");
sama("$$ ... $$", "alur $$\\rightarrow$$ lanjut", "alur → lanjut");
sama("\\text{} dibuang", "$\\text{Disetujui}$", "Disetujui");
sama("\\textbf bersarang", "$\\textbf{\\text{Final}}$", "Final");
sama("\\frac jadi a/b", "$\\frac{3}{4}$ bagian", "3/4 bagian");
// ⚠️ Tanpa kurung, `a+b/c` punya ARTI LAIN daripada yang ditulis model.
sama("\\frac dengan operator dikurung", "$\\frac{a+b}{c}$", "(a+b)/c");
sama("\\frac tanpa operator tidak dikurung", "$\\frac{\\text{Omzet}}{\\text{Biaya}}$", "Omzet/Biaya");
sama("tanda hubung dalam kata tidak memicu kurung", "$\\frac{\\text{rata-rata}}{2}$", "rata-rata/2");
// ⚠️ `$m^2$` SENGAJA tidak dibuka: tidak ada perintah di dalamnya, dan syarat
// "harus ada backslash" itulah yang melindungi nominal di bagian 3. Pangkat
// tetap diterjemahkan begitu span-nya memang span LaTeX.
sama("$m^2$ murni dibiarkan — harga dari syarat backslash", "$m^2$ luas", "$m^2$ luas");
sama("pangkat ikut jalan di span LaTeX", "$\\text{m}^2$ luas", "m² luas");
sama("indeks angka", "$\\text{H}_2\\text{O}$", "H₂O");
sama("escape persen", "naik $12\\%$", "naik 12%");
sama("perintah telanjang tanpa $", "Draf \\rightarrow Final", "Draf → Final");
sama("\\to tidak mencaplok kata lain", "lihat \\total nanti", "lihat \\total nanti");

// ============================================================
console.log("\n=== 3. ⚠️ NOMINAL TIDAK BOLEH RUSAK ===");
// ============================================================
// Inilah sebabnya remark-math + KaTeX tidak dipakai: penafsir LaTeX sungguhan
// akan menelan kalimat-kalimat di bawah ini jadi rumus.
const uang = [
  "harganya $500 sampai $700 per unit",
  "biaya $1.250.000 dan $2.500.000",
  "anggaran $10 juta, realisasi $8 juta",
  "kurs $1 = Rp 16.200",
  "Rp 3.950.747.690 tanpa dolar sama sekali",
];
for (const u of uang) {
  const k = rapikanJawaban(u);
  cek(`utuh: "${u.slice(0, 34)}"`, k === u, k === u ? "" : `jadi: ${k}`);
}

// ============================================================
console.log("\n=== 4. Kode tidak disentuh ===");
// ============================================================
sama(
  "kode sebaris utuh",
  "lihat `v_ai_mg_klaim` dan `$\\rightarrow$`",
  "lihat `v_ai_mg_klaim` dan `$\\rightarrow$`",
);
const blok = "Begini:\n```sql\nSELECT a \\rightarrow b FROM $t$\n```\nselesai $\\times$ 2";
const hasilBlok = rapikanJawaban(blok);
cek("isi blok kode utuh", hasilBlok.includes("SELECT a \\rightarrow b FROM $t$"));
cek("teks di luar blok tetap dirapikan", hasilBlok.includes("selesai × 2"));

// ============================================================
console.log("\n=== 5. Yang tidak dikenal dibiarkan KELIHATAN ===");
// ============================================================
// Prinsipnya gagal yang terlihat, bukan berhasil yang diam-diam salah:
// setengah rumus yang hilang lebih berbahaya daripada rumus yang tampak mentah,
// karena yang hilang tidak bisa diketahui pembacanya.
const aneh = "sebaran $\\sum_{i=1}^{n} x_i$ begitu";
sama("span dengan perintah tak dikenal dipulangkan utuh", aneh, aneh);
const sisa = latexTakTerurus(aneh);
cek("latexTakTerurus menyebut \\sum", sisa.includes("sum"), sisa.map((s) => `\\${s}`).join(", "));

// ⚠️ Span yang dipulangkan utuh tidak boleh diubah SEPARUH oleh pass perintah
// telanjang sesudahnya. Tanpa penitipan, `\alpha` di sini jadi "α" sementara
// `\ganjil` tetap mentah — setengah rumus, bentuk paling menyesatkan.
const campur = "rumus $\\alpha \\ganjil$ begitu";
sama("span tak dikenal tidak diterjemahkan separuh", campur, campur);
cek("tidak ada sisa pada jawaban yang bersih", latexTakTerurus(asli).length === 0);
cek("tidak melapor dari dalam blok kode", latexTakTerurus(blok).length === 0);

// ============================================================
console.log("\n=== 6. Teks biasa dilewatkan apa adanya ===");
// ============================================================
const biasa = "Klaim Anda sudah disetujui pada 3 Oktober 2026.";
cek("string identik (bukan sekadar sama isinya)", rapikanJawaban(biasa) === biasa);
cek("string kosong aman", rapikanJawaban("") === "");
sama("markdown tetap markdown", "**Tebal** dan | a | b |", "**Tebal** dan | a | b |");

// ============================================================
console.log("\n=== 7. Jalur WhatsApp ===");
// ============================================================
const wa = keWhatsApp(asli);
cek("WhatsApp tidak menerima LaTeX", !wa.includes("\\rightarrow") && !wa.includes("$"));
cek("panahnya sampai ke WhatsApp", wa.includes("→"));

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
