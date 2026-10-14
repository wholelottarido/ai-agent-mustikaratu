/**
 * Uji pengubah format WhatsApp. `npm run test:wa`
 *
 * Masukannya ditulis menyerupai jawaban asli agent -- tabel 2 kolom, tabel
 * 4 kolom, judul, tebal ganda, dan kalimat yang kebetulan memuat garis tegak.
 */
import { keWhatsApp, pecah } from "../wa-bot/format.mts";

let lolos = 0;
let gagal = 0;

function cek(nama: string, masuk: string, harus: (h: string) => boolean, kenapa: string) {
  const hasil = keWhatsApp(masuk);
  if (harus(hasil)) {
    lolos++;
    console.log(`  LOLOS  ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama} — ${kenapa}`);
    console.log(`         hasil: ${JSON.stringify(hasil).slice(0, 160)}`);
  }
}

cek(
  "tabel 2 kolom jadi daftar",
  "Omzet per bulan:\n\n| Bulan | Omzet |\n|---|---|\n| Januari | Rp 123 |\n| Februari | Rp 456 |",
  (h) => !h.includes("|---") && h.includes("• Januari: Rp 123") && h.includes("• Februari: Rp 456"),
  "masih ada pemisah tabel atau barisnya tidak terkonversi",
);

cek(
  "tabel 4 kolom jadi blok bertingkat",
  "| Nama | Qty | Omzet | Rank |\n|---|---|---|---|\n| Masker Beras | 1.617 | Rp 121 jt | 1 |",
  (h) => h.includes("*Masker Beras*") && h.includes("Qty: 1.617") && h.includes("Rank: 1") && !h.includes("|"),
  "blok bertingkatnya tidak terbentuk",
);

cek(
  "tebal ganda jadi tunggal",
  "Omzetnya **Rp 457.383.190** bulan ini.",
  (h) => h.includes("*Rp 457.383.190*") && !h.includes("**"),
  "bintang ganda masih ada",
);

cek(
  "judul jadi baris tebal",
  "## Ringkasan\nisi",
  (h) => h.startsWith("*Ringkasan*") && !h.includes("#"),
  "judul tidak dikonversi",
);

cek(
  "penanda daftar jadi bulatan",
  "- satu\n- dua\n* tiga",
  (h) => h.split("\n").every((b) => b.startsWith("• ")),
  "masih ada - atau * di awal baris",
);

cek(
  "kalimat ber-garis-tegak TIDAK dianggap tabel",
  "Kolom status | aktif | nonaktif dipakai di tabel karyawan.",
  (h) => h.includes("status | aktif | nonaktif"),
  "kalimat biasa ikut terpotong sebagai tabel",
);

cek(
  "tautan berlabel",
  "Lihat [dokumen](https://contoh.com/a) ya.",
  (h) => h.includes("dokumen (https://contoh.com/a)") && !h.includes("["),
  "sintaks markdown masih tersisa",
);

// --- pemecahan pesan ---
const panjang = Array.from({ length: 300 }, (_, i) => `baris ke-${i} isinya lumayan panjang`).join("\n");
const bagian = pecah(panjang, 500);
const semuaMuat = bagian.every((b) => b.length <= 500);
const tidakHilang = bagian.join("\n").length === panjang.length;

if (semuaMuat && tidakHilang) {
  lolos++;
  console.log(`  LOLOS  pecah pesan panjang (${bagian.length} bagian, semua <= 500)`);
} else {
  gagal++;
  console.log(`  GAGAL  pecah pesan — muat:${semuaMuat} utuh:${tidakHilang}`);
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
