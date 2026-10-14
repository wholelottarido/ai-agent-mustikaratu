/**
 * Tes saklar sumber data (Tahap B).
 *
 * PRASYARAT: `db/portal/13_sumber_db.sql` sudah dijalankan sebagai root.
 *
 * ⚠️ Mengubah baris `sumber_db` yang sungguhan, lalu MENGEMBALIKANNYA. Kalau
 * tes ini terhenti di tengah, sumber aktif bisa tertinggal di nilai yang salah
 * — karena itu keadaan awal dicatat dulu dan dipulihkan di akhir.
 */
import mysql from "mysql2/promise";
import {
  daftarSumber, sumberAktif, gantiSumber, lupakanSinggahan,
} from "../lib/sumber-db.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.PORTAL_DB_NAME,
});

// Keadaan awal, untuk dipulihkan di akhir.
const [awal]: any = await root.query("SELECT kode, tersedia, aktif FROM sumber_db ORDER BY kode");
const pulihkan = async () => {
  for (const x of awal) {
    await root.query("UPDATE sumber_db SET tersedia=?, aktif=?, diubah_oleh=NULL WHERE kode=?",
      [x.tersedia, x.aktif, x.kode]);
  }
  lupakanSinggahan();
};

console.log("--- membaca ---");
{
  const semua = await daftarSumber();
  cek(semua.length >= 2, `daftar terbaca (${semua.length} sumber)`);
  cek(semua.some((s) => s.kode === "dummy" && s.jenis === "mysql"), "dummy = mysql");
  cek(semua.some((s) => s.kode === "perusahaan" && s.jenis === "postgres"), "perusahaan = postgres");
  cek(semua.filter((s) => s.aktif).length === 1, "tepat SATU yang aktif");
  cek((await sumberAktif()) === "dummy", "sumber aktif = dummy");
}

console.log("--- penolakan ---");
{
  const h = await gantiSumber("tidak-ada-ini", "hr2");
  cek(!h.ok && h.sebab === "tidak-dikenal", "sumber karangan ditolak");
}
{
  // ⚠️ Keadaan `tersedia` DIPAKSA dulu, tidak diandaikan.
  //
  // Awalnya tes ini mengandalkan `perusahaan` masih tersedia=0. Begitu
  // tool-nya jadi dan kolomnya diubah jadi 1, tes ini gagal -- padahal
  // kodenya benar. Tes yang bergantung pada keadaan database yang bisa
  // berubah harus menyiapkan keadaannya sendiri.
  await root.query("UPDATE sumber_db SET tersedia=0 WHERE kode='perusahaan'");
  lupakanSinggahan();

  const h = await gantiSumber("perusahaan", "hr2");
  cek(!h.ok && h.sebab === "belum-tersedia", "sumber belum tersedia ditolak",
    !h.ok ? h.pesan : "MALAH LOLOS");
  cek((await sumberAktif()) === "dummy", "sumber aktif tidak berubah");
}

console.log("--- berganti ---");
{
  // Buat `perusahaan` tersedia lewat root, meniru keadaan setelah tool-nya jadi.
  await root.query("UPDATE sumber_db SET tersedia=1 WHERE kode='perusahaan'");
  lupakanSinggahan();

  const h = await gantiSumber("perusahaan", "hr2");
  cek(h.ok, "berganti ke perusahaan", h.ok ? "" : h.pesan);
  cek((await sumberAktif()) === "perusahaan", "sumber aktif = perusahaan");

  const [b]: any = await root.query("SELECT kode, aktif, diubah_oleh FROM sumber_db ORDER BY kode");
  cek(b.filter((x: any) => Number(x.aktif) === 1).length === 1, "tetap tepat SATU yang aktif");
  cek(b.find((x: any) => x.kode === "perusahaan")?.diubah_oleh === "hr2", "dicatat siapa yang mengubah");
  cek(Number(b.find((x: any) => x.kode === "dummy")?.aktif) === 0, "yang lama otomatis mati");

  const kembali = await gantiSumber("dummy", "hr2");
  cek(kembali.ok && (await sumberAktif()) === "dummy", "bisa kembali ke dummy");
}

console.log("--- singgahan ---");
{
  // Ubah langsung lewat root, tanpa gantiSumber -> singgahan masih memegang
  // nilai lama. Ini perilaku yang DIHARAPKAN, bukan bug.
  await daftarSumber();
  await root.query("UPDATE sumber_db SET nama='DIUBAH DI LUAR' WHERE kode='dummy'");
  const masih = (await daftarSumber()).find((s) => s.kode === "dummy")?.nama;
  cek(masih !== "DIUBAH DI LUAR", "singgahan menahan pembacaan ulang (disengaja)");

  lupakanSinggahan();
  const segar = (await daftarSumber()).find((s) => s.kode === "dummy")?.nama;
  cek(segar === "DIUBAH DI LUAR", "setelah singgahan dibuang, nilainya segar");
  await root.query("UPDATE sumber_db SET nama='Database dummy (MySQL)' WHERE kode='dummy'");

  // gantiSumber HARUS membuang singgahan sendiri.
  lupakanSinggahan();
  await daftarSumber();
  await gantiSumber("dummy", "hr2");
  const setelah = await sumberAktif();
  cek(setelah === "dummy", "gantiSumber membuang singgahannya sendiri");
}

console.log("--- izin: jalur chat TIDAK boleh mengubah ---");
{
  const app = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.PORTAL_APP_DB_USER, password: process.env.PORTAL_APP_DB_PASSWORD,
    database: process.env.PORTAL_DB_NAME,
  });
  try { await app.query("UPDATE sumber_db SET aktif=0 WHERE kode='dummy'"); cek(false, "portal_app UPDATE ditolak", "MALAH BISA"); }
  catch (e: any) { cek(e.code === "ER_TABLEACCESS_DENIED_ERROR", "portal_app UPDATE ditolak", e.code); }
  try { await app.query("SELECT kode FROM sumber_db LIMIT 1"); cek(true, "portal_app SELECT bisa"); }
  catch (e: any) { cek(false, "portal_app SELECT bisa", e.code); }
  await app.end();
}

await pulihkan();
const [akhir]: any = await root.query("SELECT kode, tersedia, aktif FROM sumber_db ORDER BY kode");
cek(JSON.stringify(akhir) === JSON.stringify(awal), "keadaan awal dipulihkan");

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
