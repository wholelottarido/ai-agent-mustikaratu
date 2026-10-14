/**
 * Bikin ulang isi kolom teks supaya mirip tulisan manusia.
 *
 * MASALAHNYA: data dummy sekarang cuma pakai ~19 template dengan nama produk
 * ditukar-tukar. 420 komentar cuma punya 128 kalimat berbeda, 935 catatan sales
 * cuma 26. Itu bikin vector search mustahil diuji dengan jujur -- tidak ada
 * variasi bahasa untuk dicari kemiripannya.
 *
 * Script ini TIDAK menulis ke database. Dia cuma MENGHASILKAN file SQL
 * (db/04_komentar_realistis.sql) yang harus dijalankan root, karena
 * mkt_readonly sengaja tidak punya izin UPDATE.
 *
 * Jalankan: npm run buat:komentar
 */
import { writeFileSync } from "node:fs";
import { departemenDariArgv, sambungkan } from "./lib/dep.mts";
import {
  KELUHAN, NETRAL, PUJIAN, HIASAN, JANGAN_DIAWALI,
} from "./data/komentar-feedback.mts";
import { CATATAN, SURVEI_PERBAIKAN, SURVEI_HARAPAN } from "./data/catatan-survei.mts";

// Acak yang bisa diulang -- jalankan dua kali, hasilnya sama persis.
// Penting supaya file SQL-nya bisa direview dan dibandingkan.
let benih = 20260923;
const acak = () => {
  benih = (benih * 1103515245 + 12345) & 0x7fffffff;
  return benih / 0x7fffffff;
};
// <T,> dengan koma -- di file .mts, <T> saja ditafsirkan sebagai JSX.
const pilih = <T,>(arr: T[]): T => arr[Math.floor(acak() * arr.length)];

/** Escape untuk string literal MySQL. */
const q = (s: string) =>
  "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";

/**
 * Sebagian komentar cuma masuk akal untuk kategori produk tertentu.
 * Tanpa ini muncul "Rambut udah ga rontok lagi setelah sebulan pake Lulur
 * Bengkoang" -- lulur itu perawatan badan, bukan rambut. (Cacat ini juga
 * ada di data dummy aslinya.)
 */
const KHUSUS_KATEGORI: { pola: RegExp; kategori: string[] }[] = [
  { pola: /\brambut\b/i, kategori: ["Hair Care"] },
  { pola: /\bketombe\b/i, kategori: ["Hair Care"] },
  { pola: /\bjerawat|breakout|acne prone\b/i, kategori: ["Face Care"] },
  { pola: /\bflek hitam|bekas jerawat|kulit kusam\b/i, kategori: ["Face Care", "Body Care"] },
  { pola: /\bkulit (jadi |lebih )*(cerah|halus|kenyal|lembab|lembap)\b/i, kategori: ["Face Care", "Body Care"] },
  // "rutin pake/oles" tidak cocok untuk Jamu -- jamu diminum, bukan dioles.
  { pola: /\b(dioles|oleskan|rutin pake|dipakai malam)\b/i, kategori: ["Face Care", "Body Care", "Hair Care", "Make Up"] },
  { pola: /\bditelan\b/i, kategori: ["Jamu"] },
  { pola: /\bcoverage|shade\b/i, kategori: ["Make Up"] },
];

/** Boleh tidak kalimat ini dipakai untuk produk berkategori `kategori`? */
function cocokKategori(teks: string, kategori: string | null): boolean {
  if (!kategori) return true; // komentar umum, tidak menyebut produk
  for (const k of KHUSUS_KATEGORI) {
    if (k.pola.test(teks)) return k.kategori.includes(kategori);
  }
  return true;
}

/**
 * Rakit satu komentar: awalan opsional + isi + akhiran opsional.
 * Kombinasi ini yang bikin ~240 kalimat inti jadi ratusan varian.
 *
 * Awalan & akhiran diambil dari kelompok yang SENADA dengan isinya, supaya
 * tidak muncul "Maaf ya seller, sampai lebih cepat dari estimasi" (minta maaf
 * di komentar pujian) atau "...kualitasnya sepadan. Tolong diperbaiki."
 */
function rakit(
  nada: "keluhan" | "netral" | "pujian",
  produk: string | null,
  kategori: string | null,
): string {
  const semua = nada === "keluhan" ? KELUHAN : nada === "netral" ? NETRAL : PUJIAN;
  // Buang kalimat yang tidak masuk akal untuk kategori produk ini.
  const pool = semua.filter((t) => cocokKategori(t, produk ? kategori : null));
  let teks = pilih(pool.length > 0 ? pool : semua);
  teks = produk
    ? teks.replace(/\{p\}/g, produk)
    : teks.replace(/\{p\}\s*(nya)?/g, "produknya");

  const hiasan = HIASAN[nada];
  const akhir = pilih(hiasan.akhiran);
  let awal = pilih(hiasan.awalan);

  // Jangan pasang awalan kalau kalimatnya sudah mulai dengan kata yang sama --
  // hasilnya "Menurut saya saya alergi..." atau "Jujur aja jujur...".
  const kataPertama = teks.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  if (awal && JANGAN_DIAWALI.includes(kataPertama)) awal = "";

  if (awal) teks = awal + teks.charAt(0).toLowerCase() + teks.slice(1);
  return (teks + akhir).trim();
}

const dep = departemenDariArgv();
const conn = await sambungkan(dep);

const baris: string[] = [];
const P = (s = "") => baris.push(s);

P("-- ============================================================");
P("-- Ganti isi kolom teks dengan kalimat yang lebih mirip tulisan orang.");
P("-- ============================================================");
P("-- DI-GENERATE oleh scripts/buat-komentar-realistis.mts -- jangan edit manual.");
P(`-- Dibuat: ${new Date().toISOString().slice(0, 10)}`);
P("--");
P("-- Jalankan SEBAGAI ROOT (mkt_readonly tidak punya izin UPDATE):");
P("--   mysql -u root -p marketing -e \"source db/04_komentar_realistis.sql\"");
P("--");
P("-- AMAN DIULANG: isi asli dibackup dulu ke tabel _backup_teks_asli.");
P("-- Kalau mau balik ke data semula, jalankan db/05_pulihkan_teks_asli.sql.");
P("-- ============================================================");
P();
P("USE marketing;");
P();
P("-- Backup dulu. CREATE TABLE IF NOT EXISTS supaya backup pertama");
P("-- (yang berisi data ASLI) tidak tertimpa kalau script dijalankan 2x.");
P("CREATE TABLE IF NOT EXISTS _backup_teks_asli (");
P("  tabel  VARCHAR(32)  NOT NULL,");
P("  id     INT          NOT NULL,");
P("  teks   TEXT,");
P("  PRIMARY KEY (tabel, id)");
P(") COMMENT 'Isi kolom teks sebelum diganti oleh 04_komentar_realistis.sql';");
P();
P("INSERT IGNORE INTO _backup_teks_asli (tabel, id, teks)");
P("  SELECT 'customer_feedback', id, komentar FROM customer_feedback;");
P("INSERT IGNORE INTO _backup_teks_asli (tabel, id, teks)");
P("  SELECT 'lead_activity', id, catatan FROM lead_activity;");
P("INSERT IGNORE INTO _backup_teks_asli (tabel, id, teks)");
P("  SELECT 'survey_response', id, jawaban_teks FROM survey_response;");
P();

const dipakai = new Set<string>();

// ---------- customer_feedback ----------
const [fb] = await conn.query<any[]>(
  `SELECT f.id, f.rating, p.nama AS produk, p.kategori
     FROM customer_feedback f
     LEFT JOIN produk p ON p.id = f.produk_id
    ORDER BY f.id`,
);
P(`-- customer_feedback: ${fb.length} baris`);
for (const r of fb) {
  const nada = r.rating <= 2 ? "keluhan" : r.rating === 3 ? "netral" : "pujian";
  // Sebagian komentar tidak menyebut nama produk -- seperti aslinya.
  const produk = acak() < 0.55 ? (r.produk as string | null) : null;
  const teks = rakit(nada, produk, (r.kategori as string | null) ?? null);
  dipakai.add(teks);
  P(`UPDATE customer_feedback SET komentar = ${q(teks)} WHERE id = ${r.id};`);
}
P();

// ---------- lead_activity ----------
const [la] = await conn.query<any[]>(
  `SELECT a.id, a.aktivitas, l.nama, l.perusahaan
     FROM lead_activity a
     LEFT JOIN leads l ON l.id = a.lead_id
    ORDER BY a.id`,
);
P(`-- lead_activity: ${la.length} baris`);
for (const r of la) {
  const pool = CATATAN[r.aktivitas as string] ?? CATATAN.CALL;
  const teks = pilih(pool)
    .replace(/\{n\}/g, (r.nama as string) ?? "lead")
    .replace(/\{c\}/g, (r.perusahaan as string) ?? "perusahaan tsb");
  dipakai.add(teks);
  P(`UPDATE lead_activity SET catatan = ${q(teks)} WHERE id = ${r.id};`);
}
P();

// ---------- survey_response ----------
const [sr] = await conn.query<any[]>(
  `SELECT id, question_id FROM survey_response
    WHERE jawaban_teks IS NOT NULL AND jawaban_teks <> ''
    ORDER BY id`,
);
P(`-- survey_response: ${sr.length} baris (hanya yang tipe TEKS)`);
for (const r of sr) {
  // question_id 4 = "Apa yang perlu kami perbaiki?", 7 = "Produk apa yang ingin dilihat?"
  const pool = r.question_id === 7 ? SURVEI_HARAPAN : SURVEI_PERBAIKAN;
  const teks = pilih(pool);
  dipakai.add(teks);
  P(`UPDATE survey_response SET jawaban_teks = ${q(teks)} WHERE id = ${r.id};`);
}
P();
P("SELECT 'customer_feedback' AS tabel, COUNT(DISTINCT komentar) AS kalimat_berbeda FROM customer_feedback");
P("UNION ALL SELECT 'lead_activity', COUNT(DISTINCT catatan) FROM lead_activity");
P("UNION ALL SELECT 'survey_response', COUNT(DISTINCT jawaban_teks) FROM survey_response;");

writeFileSync("db/04_komentar_realistis.sql", baris.join("\n"), "utf8");

// ---------- script pemulihan ----------
const pulih = [
  "-- ============================================================",
  "-- Kembalikan isi kolom teks ke data ASLI (sebelum 04_komentar_realistis.sql).",
  "-- ============================================================",
  "-- Jalankan sebagai root:",
  '--   mysql -u root -p marketing -e "source db/05_pulihkan_teks_asli.sql"',
  "-- ============================================================",
  "",
  "USE marketing;",
  "",
  "UPDATE customer_feedback f",
  "  JOIN _backup_teks_asli b ON b.tabel = 'customer_feedback' AND b.id = f.id",
  "   SET f.komentar = b.teks;",
  "",
  "UPDATE lead_activity a",
  "  JOIN _backup_teks_asli b ON b.tabel = 'lead_activity' AND b.id = a.id",
  "   SET a.catatan = b.teks;",
  "",
  "UPDATE survey_response r",
  "  JOIN _backup_teks_asli b ON b.tabel = 'survey_response' AND b.id = r.id",
  "   SET r.jawaban_teks = b.teks;",
  "",
  "SELECT 'dipulihkan' AS status, COUNT(*) AS baris FROM _backup_teks_asli;",
  "",
];
writeFileSync("db/05_pulihkan_teks_asli.sql", pulih.join("\n"), "utf8");

const total = fb.length + la.length + sr.length;
console.log(`OK -> db/04_komentar_realistis.sql`);
console.log(`     ${total} baris di-update (${fb.length} feedback, ${la.length} catatan sales, ${sr.length} survei)`);
console.log(`     ${dipakai.size} kalimat BERBEDA dihasilkan`);
console.log(`OK -> db/05_pulihkan_teks_asli.sql (untuk balik ke data asli)`);

await conn.end();
