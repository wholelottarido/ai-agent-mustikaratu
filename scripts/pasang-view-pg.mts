/**
 * Memasang view `v_asisten_*` ke database perusahaan.
 *
 * ⚠️ MENGUBAH SERVER PERUSAHAAN. Jalankan sadar, dan beri tahu pemegang server.
 *
 *   npm run pasang:view-pg                       -> db/demo-pg/03_view_penjualan.sql
 *   npm run pasang:view-pg -- db/demo-pg/xx.sql  -> berkas lain
 *
 * `psql` tidak terpasang di laptop ini, jadi berkas SQL-nya dijalankan lewat
 * driver `pg` dengan kredensial admin (`DEMO_PG_ADMIN_*`).
 *
 * ⚠️ KENAPA ADA DAFTAR-BOLEH DI SINI.
 *
 * Skrip yang memegang kredensial admin dan menjalankan berkas SQL apa pun
 * adalah alat yang berbahaya untuk ditinggalkan di repo: sekali salah berkas,
 * yang hilang data perusahaan sungguhan. Jadi skrip ini MENOLAK apa pun di
 * luar tiga bentuk perintah yang memang dibutuhkan untuk memasang view.
 *
 * Pola yang sama dengan `VIEW_BOLEH` dan `LEVEL_BERHAK_LEMBUR`: untuk hal
 * yang menjaga sesuatu, gagal-menolak lebih aman daripada gagal-mengizinkan.
 */
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const BERKAS = process.argv[2] ?? "db/demo-pg/03_view_penjualan.sql";

/** Bentuk perintah yang boleh ada di berkas. Selain ini, skrip berhenti. */
const BOLEH: { pola: RegExp; nama: string }[] = [
  { pola: /^CREATE\s+OR\s+REPLACE\s+VIEW\s+v_asisten_\w+\b/i, nama: "buat view v_asisten_*" },
  { pola: /^GRANT\s+SELECT\s+ON\s+v_asisten_\w+\s+TO\s+\w+$/i, nama: "beri hak baca" },
  { pola: /^SELECT\b/i, nama: "periksa hasil" },
];

const teks = await readFile(BERKAS, "utf8");

// Komentar dibuang SEBELUM diperiksa -- kalau tidak, `-- DROP TABLE x`
// terbaca sebagai perintah dan skrip menolak berkas yang sebenarnya aman.
const bersih = teks
  .split("\n")
  .filter((b) => !/^\s*--/.test(b))
  .join("\n");

const perintah = bersih
  .split(";")
  .map((x) => x.trim())
  .filter((x) => x !== "");

console.log(`berkas    : ${BERKAS}`);
console.log(`perintah  : ${perintah.length}\n`);

let tertolak = false;
for (const p of perintah) {
  const satuBaris = p.replace(/\s+/g, " ").slice(0, 70);
  const cocok = BOLEH.find((b) => b.pola.test(p));
  console.log(`  ${cocok ? "boleh " : "TOLAK "} ${cocok?.nama ?? "di luar daftar"} — ${satuBaris}…`);
  if (!cocok) tertolak = true;
}

if (tertolak) {
  console.log(
    "\n⛔ Ada perintah di luar daftar yang boleh. TIDAK ADA yang dijalankan.\n" +
      "   Skrip ini cuma untuk memasang view v_asisten_*. Untuk hal lain,\n" +
      "   pakai skrip tersendiri supaya sengajanya kelihatan.",
  );
  process.exit(1);
}

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 300_000,
});
await c.connect();

const [{ current_user: aku, current_database: db }] = (
  await c.query("SELECT current_user, current_database()")
).rows;
console.log(`\ntersambung: ${aku} @ ${db}\n`);

try {
  const hasil = await c.query(teks);
  const semua = Array.isArray(hasil) ? hasil : [hasil];
  const terakhir = semua[semua.length - 1];
  if (terakhir?.rows?.length) {
    console.log("hasil pemeriksaan:");
    console.table(terakhir.rows);
  }
  console.log("✅ selesai.");
} catch (e) {
  console.log(`⛔ GAGAL: ${e instanceof Error ? e.message : String(e)}`);
  console.log("   Tidak ada yang setengah jadi: view dibuat dengan CREATE OR REPLACE,");
  console.log("   jadi view lama (kalau ada) tetap seperti semula.");
  process.exitCode = 1;
} finally {
  await c.end();
}
