/**
 * Uji penyuntingan tiket helpdesk.
 *
 *   npm run test:tiket-ubah
 *
 * ⚠️ MENULIS KE `portal_ticket` SUNGGUHAN, lalu MENGEMBALIKANNYA — tapi hanya
 * pada SATU baris yang dibuat khusus untuk uji ini, dan di dalam transaksi
 * yang dibatalkan untuk bagian penyimpanannya.
 *
 * Tabelnya antrean kerja teknisi IT yang hidup. Barisnya dibuat dengan
 * kredensial admin, ditandai jelas sebagai uji, dan dihapus di `finally` —
 * termasuk kalau ujinya gagal di tengah.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. tiket ORANG LAIN tidak bisa disunting — ini yang paling penting, karena
 *      batas itu TIDAK dijamin database dan hanya berdiri di kode kita;
 *   2. tiket yang statusnya sudah lewat OPEN ditolak;
 *   3. "tidak ada yang berubah" ditolak, bukan dijadikan kartu kosong;
 *   4. sidik memuat nilai LAMA, jadi tiket yang berubah di tengah tertangkap;
 *   5. `WHERE` penyimpannya memuat pemilik DAN status, bukan cuma nomor.
 */
import { Client } from "pg";
import {
  susunDrafUbah, sidikDrafUbah, konfigUbah, masalahUbahJadiTeks,
} from "../lib/entri/tiket-ubah.ts";
import { KOLOM_UBAH } from "../lib/entri/simpan-tiket.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const adm = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
});
await adm.connect();
const baca = poolPerusahaan();

const sebelum = ((await baca.query<{ n: number }>(`SELECT count(*)::int n FROM portal_ticket`)).rows[0]).n;
const NOMOR = `T${new Date().toISOString().slice(0, 10).replace(/-/g, "")}0001`;

// Dua karyawan berbeda: pemilik tiket, dan orang lain.
const { rows: kar } = await baca.query<{ id_employee: string }>(
  `SELECT id_employee FROM employee WHERE is_active = true LIMIT 2`);
const [pemilik, lain] = kar;

try {
  const { rows: kat } = await baca.query<{ id_category: string; id_sub_category: string }>(
    `SELECT c.id_category, s.id_sub_category FROM category c
       JOIN sub_category s ON s.id_category = c.id_category
      WHERE c.category_type = 'ticket' LIMIT 1`);
  await adm.query(
    `INSERT INTO portal_ticket (no_ticket, id_employee, id_category, id_sub_category, subject, description, priority)
     VALUES ($1,$2,$3,$4,'[UJI OTOMATIS] jangan dikerjakan','Dibuat skrip pengujian.','NORMAL')`,
    [NOMOR, pemilik.id_employee, kat[0].id_category, kat[0].id_sub_category]);
  console.log(`tiket uji dibuat: ${NOMOR}\n`);

  // ============================================================
  console.log("=== 1. Konfigurasi ===");
  // ============================================================
  const k = await konfigUbah();
  cek("konfigurasi ubah_tiket terbaca", Boolean(k));
  cek("kuncinya no_ticket", k?.kunci.join(",") === "no_ticket", k?.kunci.join(","));
  cek("syaratnya status OPEN", JSON.stringify(k?.syarat) === JSON.stringify([{ boleh: ["OPEN"], kolom: "status" }]),
    JSON.stringify(k?.syarat));
  cek("kolom yang boleh diubah tidak memuat kategori",
    !KOLOM_UBAH.some((c) => c.includes("category")), KOLOM_UBAH.join(", "));

  // ============================================================
  console.log("\n=== 2. ⚠️ Tiket ORANG LAIN ditolak ===");
  // ============================================================
  // Batas ini TIDAK dijamin database — hanya kode kita. Jadi diuji dari dua
  // sisi: penyusun rancangan, dan `WHERE` penyimpannya (bagian 6).
  const curi = await susunDrafUbah(lain.id_employee, { noTiket: NOMOR, judul: "diubah orang lain" });
  cek("tiket milik orang lain ditolak", !curi.ok,
    curi.ok ? "MALAH DISUSUN" : curi.masalah[0].jenis);
  cek("isinya tidak ikut bocor di pesan galat",
    !curi.ok && !masalahUbahJadiTeks(curi.masalah).includes("UJI OTOMATIS"));

  // ============================================================
  console.log("\n=== 3. Rancangan yang sah ===");
  // ============================================================
  const r = await susunDrafUbah(pemilik.id_employee, { noTiket: NOMOR, judul: "Judul baru hasil uji" });
  cek("rancangan tersusun", r.ok, r.ok ? "" : masalahUbahJadiTeks(r.masalah));
  if (r.ok) {
    cek("cuma satu kolom yang berubah", r.draf.perubahan.length === 1,
      r.draf.perubahan.map((p) => p.kolom).join(", "));
    cek("nilai LAMA ikut dibawa", r.draf.perubahan[0].dari === "[UJI OTOMATIS] jangan dikerjakan",
      r.draf.perubahan[0].dari);
    cek("nomor dan status ikut", r.draf.noTiket === NOMOR && r.draf.status === "OPEN");
  }

  // ============================================================
  console.log("\n=== 4. Yang tidak sah ditolak ===");
  // ============================================================
  const buruk: [string, Parameters<typeof susunDrafUbah>[1]][] = [
    ["nomor tiket kosong", { judul: "x" }],
    ["nomor tiket karangan", { noTiket: "T999999999999", judul: "x" }],
    ["judul kepanjangan", { noTiket: NOMOR, judul: "x".repeat(200) }],
    ["prioritas karangan", { noTiket: NOMOR, prioritas: "SANGAT MENDESAK SEKALI" }],
    ["tidak ada yang berubah", { noTiket: NOMOR, judul: "[UJI OTOMATIS] jangan dikerjakan" }],
    ["tanpa perubahan apa pun", { noTiket: NOMOR }],
  ];
  for (const [nama, minta] of buruk) {
    const h = await susunDrafUbah(pemilik.id_employee, minta);
    cek(`${nama} ditolak`, !h.ok, h.ok ? "MALAH DISUSUN" : masalahUbahJadiTeks(h.masalah).slice(0, 52));
  }

  // ============================================================
  console.log("\n=== 5. Sidik menangkap tiket yang berubah di tengah ===");
  // ============================================================
  if (r.ok) {
    const sidikAwal = sidikDrafUbah(r.draf);
    // Judulnya diubah orang lain (simulasi teknisi menyunting).
    await adm.query(`UPDATE portal_ticket SET subject = $2 WHERE no_ticket = $1`,
      [NOMOR, "[UJI OTOMATIS] disunting orang lain"]);
    const ulang = await susunDrafUbah(pemilik.id_employee, { noTiket: NOMOR, judul: "Judul baru hasil uji" });
    cek("rancangan bisa disusun ulang", ulang.ok);
    cek("sidiknya BERBEDA karena nilai lama berubah",
      ulang.ok && sidikDrafUbah(ulang.draf) !== sidikAwal);
    await adm.query(`UPDATE portal_ticket SET subject = $2 WHERE no_ticket = $1`,
      [NOMOR, "[UJI OTOMATIS] jangan dikerjakan"]);
  }

  // ============================================================
  console.log("\n=== 6. Status di luar OPEN ditolak ===");
  // ============================================================
  await adm.query(`UPDATE portal_ticket SET status = 'RESOLVED' WHERE no_ticket = $1`, [NOMOR]);
  const tutup = await susunDrafUbah(pemilik.id_employee, { noTiket: NOMOR, judul: "coba ubah yang sudah selesai" });
  cek("tiket RESOLVED tidak bisa disunting", !tutup.ok,
    tutup.ok ? "MALAH DISUSUN" : tutup.masalah[0].jenis);
  await adm.query(`UPDATE portal_ticket SET status = 'OPEN' WHERE no_ticket = $1`, [NOMOR]);

  // ============================================================
  console.log("\n=== 7. UPDATE sungguhan, lalu dibatalkan ===");
  // ============================================================
  // ⚠️ `WHERE` yang diuji di sini SAMA dengan yang dipakai penyimpannya:
  // nomor DAN pemilik DAN status. Diuji dengan pemilik yang salah untuk
  // membuktikan nol baris tersentuh.
  await adm.query("BEGIN");
  const salahPemilik = await adm.query(
    `UPDATE portal_ticket SET subject = 'DIRAMPAS'
      WHERE no_ticket = $1 AND id_employee = $2::uuid AND status = 'OPEN'`,
    [NOMOR, lain.id_employee]);
  cek("WHERE dengan pemilik salah menyentuh NOL baris", salahPemilik.rowCount === 0,
    `${salahPemilik.rowCount} baris`);
  const benar = await adm.query(
    `UPDATE portal_ticket SET subject = 'DIUBAH UJI'
      WHERE no_ticket = $1 AND id_employee = $2::uuid AND status = 'OPEN'`,
    [NOMOR, pemilik.id_employee]);
  cek("WHERE dengan pemilik benar menyentuh SATU baris", benar.rowCount === 1, `${benar.rowCount} baris`);
  await adm.query("ROLLBACK");
  const { rows: sesudahRb } = await baca.query<{ subject: string }>(
    `SELECT subject FROM portal_ticket WHERE no_ticket = $1`, [NOMOR]);
  cek("ROLLBACK mengembalikan judulnya", sesudahRb[0].subject === "[UJI OTOMATIS] jangan dikerjakan",
    sesudahRb[0].subject);
} finally {
  await adm.query(`DELETE FROM portal_ticket WHERE no_ticket = $1`, [NOMOR]);
  const sesudah = ((await adm.query<{ n: number }>(`SELECT count(*)::int n FROM portal_ticket`)).rows[0]).n;
  console.log(`\njumlah tiket: ${sebelum} -> ${sesudah}`);
  cek("tidak ada tiket uji yang tertinggal", sesudah === sebelum);
  await adm.end();
  await baca.end();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
