/**
 * Tes persetujuan lembur (HR-5).
 *
 * PRASYARAT: `db/hr/02_entri.sql` sudah dijalankan ULANG sebagai root
 * (menambah `GRANT UPDATE (status) ON hr.lembur` dan memperlebar ENUM `aksi`).
 *
 * ⚠️ Tes ini memakai baris `lembur` yang SUDAH ADA (31 baris PENDING), bukan
 * membuat baris baru — persetujuan memang untuk data yang sudah ada. Karena
 * itu statusnya DIKEMBALIKAN ke PENDING di akhir, dan itu butuh root: aplikasi
 * sendiri sengaja tidak bisa mengembalikan keputusan.
 */
import mysql from "mysql2/promise";
import {
  lemburMenunggu, susunDrafSetuju, putuskanLembur, lemburJadiTeks, daftarJadiTeks,
} from "../lib/entri/persetujuan.ts";
import type { KonteksEntri } from "../lib/entri/simpan.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PENANDA = "uji setujui";
const KEPALA: KonteksEntri = {
  penggunaId: 4, username: "hr2", departemen: "hr",
  peran: "kepala", asal: "web", permintaan: PENANDA,
};

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.HR_DB_NAME,
});

// Kembalikan sisa run yang terputus: status balik PENDING, jejaknya dihapus.
const [sisa]: any = await root.query(
  "SELECT DISTINCT ref_id FROM entri_log WHERE entitas='lembur' AND permintaan=?", [PENANDA]);
for (const { ref_id } of sisa) {
  await root.query("UPDATE lembur SET status='PENDING' WHERE id=?", [ref_id]);
  await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?",
    [ref_id, PENANDA]);
}
if (sisa.length) console.log(`⚠️  ${sisa.length} keputusan sisa run sebelumnya dikembalikan\n`);

const status = async (id: number) => {
  const [r]: any = await root.query("SELECT status FROM lembur WHERE id=?", [id]);
  return r[0]?.status;
};
const disentuh: number[] = [];

console.log("--- daftar yang menunggu ---");
const daftar = await lemburMenunggu(5);
cek(daftar.length > 0, `ada lembur PENDING (${daftar.length} diambil)`);
if (daftar.length < 2) {
  console.log("Butuh minimal 2 lembur PENDING untuk tes ini.");
  process.exit(1);
}
cek(daftar.every((l) => l.status === "PENDING"), "semuanya berstatus PENDING");
cek(daftar.every((l) => l.karyawan.nik !== "" && l.nilaiRp > 0), "tiap baris bawa NIK & nilai");
cek(daftarJadiTeks(daftar).includes("#"), "daftar bisa dijadikan teks");

const A = daftar[0];
const B = daftar[1];
console.log(`pakai #${A.id} (${A.karyawan.nama}) dan #${B.id} (${B.karyawan.nama})\n`);

console.log("--- penolakan ---");
{
  const h = await susunDrafSetuju(999_999);
  cek(!h.ok && h.sebab === "tidak-ketemu", "id karangan ditolak");
}
{
  const h = await putuskanLembur(A.id, "MAYBE" as never, "coba", KEPALA);
  cek(!h.ok && h.sebab === "keputusan-tidak-sah", "keputusan selain APPROVED/REJECTED ditolak");
}
for (const [label, catatan] of [["kosong", ""], ["spasi", "  "], ["pendek", "no"]] as const) {
  const h = await putuskanLembur(A.id, "REJECTED", catatan, KEPALA);
  cek(!h.ok && h.sebab === "catatan-kurang", `tolak dengan alasan ${label} ditolak`);
}
cek((await status(A.id)) === "PENDING", "belum berubah setelah semua penolakan");

console.log("--- menyetujui ---");
{
  const draf = await susunDrafSetuju(A.id);
  cek(draf.ok, "draf keputusan tersusun");
  cek(draf.ok && lemburJadiTeks(draf.lembur).includes(A.karyawan.nik), "teks draf memuat NIK");
  cek((await status(A.id)) === "PENDING", "menyusun draf TIDAK mengubah status");

  // Menyetujui TIDAK butuh catatan.
  const h = await putuskanLembur(A.id, "APPROVED", undefined, KEPALA);
  disentuh.push(A.id);
  cek(h.ok, "disetujui tanpa catatan", h.ok ? "" : h.pesan);
  cek((await status(A.id)) === "APPROVED", "status jadi APPROVED");

  const [log]: any = await root.query(
    "SELECT aksi, alasan, username, peran FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?",
    [A.id, PENANDA]);
  cek(log.length === 1 && log[0].aksi === "SETUJU", `jejak aksi SETUJU (${log[0]?.aksi})`);
  cek(log[0]?.alasan === null, "tanpa catatan -> alasan NULL");
  cek(log[0]?.username === "hr2" && log[0]?.peran === "kepala", `atas nama ${log[0]?.username}/${log[0]?.peran}`);

  const lagi = await putuskanLembur(A.id, "REJECTED", "berubah pikiran", KEPALA);
  cek(!lagi.ok && lagi.sebab === "sudah-diputus", "keputusan kedua ditolak");
  const [log2]: any = await root.query(
    "SELECT COUNT(*) c FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?", [A.id, PENANDA]);
  cek(Number(log2[0].c) === 1, "tidak ada jejak dobel dari percobaan kedua");

  const draf2 = await susunDrafSetuju(A.id);
  cek(!draf2.ok && draf2.sebab === "sudah-diputus", "yang sudah diputus tidak muncul lagi sebagai draf");
}

console.log("--- menolak ---");
{
  const h = await putuskanLembur(B.id, "REJECTED", "jam tidak sesuai absensi", KEPALA);
  disentuh.push(B.id);
  cek(h.ok, "ditolak dengan alasan", h.ok ? "" : h.pesan);
  cek((await status(B.id)) === "REJECTED", "status jadi REJECTED");

  const [log]: any = await root.query(
    "SELECT aksi, alasan FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?", [B.id, PENANDA]);
  cek(log[0]?.aksi === "TOLAK", `jejak aksi TOLAK (${log[0]?.aksi})`);
  cek(log[0]?.alasan === "jam tidak sesuai absensi", "alasan penolakan tersimpan apa adanya");
}

console.log("--- nilai & jam tidak ikut berubah ---");
{
  const [b]: any = await root.query("SELECT jam, nilai_rp, tanggal FROM lembur WHERE id=?", [A.id]);
  cek(Number(b[0].jam) === A.jam && Number(b[0].nilai_rp) === A.nilaiRp,
    "jam & nilai_rp utuh setelah disetujui");
}

console.log("--- bersih-bersih ---");
for (const id of disentuh) {
  await root.query("UPDATE lembur SET status='PENDING' WHERE id=?", [id]);
  await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?", [id, PENANDA]);
}
const balik = await Promise.all(disentuh.map(status));
cek(balik.every((s) => s === "PENDING"), `${disentuh.length} lembur dikembalikan ke PENDING`);
const [sisaLog]: any = await root.query(
  "SELECT COUNT(*) c FROM entri_log WHERE entitas='lembur' AND permintaan=?", [PENANDA]);
cek(Number(sisaLog[0].c) === 0, "jejak uji dihapus");

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
