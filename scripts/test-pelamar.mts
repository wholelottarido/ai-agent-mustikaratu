/**
 * Tes entri pelamar (HR-4).
 *
 * PRASYARAT: `db/hr/02_entri.sql` sudah dijalankan sebagai root.
 */
import mysql from "mysql2/promise";
import {
  susunDrafPelamar, simpanPelamar, sidikDrafPelamar, drafPelamarJadiTeks,
  STATUS_AWAL, PENGALAMAN_MAKS, HARI_MUNDUR_MAKS,
} from "../lib/entri/pelamar.ts";
import type { KonteksEntri } from "../lib/entri/simpan.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PENANDA = "uji pelamar";
const STAF: KonteksEntri = {
  penggunaId: 3, username: "hr1", departemen: "hr",
  peran: "staf", asal: "web", permintaan: PENANDA,
};

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.HR_DB_NAME,
});

const [sisa]: any = await root.query(
  "SELECT DISTINCT ref_id FROM entri_log WHERE entitas='pelamar' AND permintaan=?", [PENANDA]);
for (const { ref_id } of sisa) {
  await root.query("DELETE FROM pelamar WHERE id=?", [ref_id]);
  await root.query("DELETE FROM entri_log WHERE entitas='pelamar' AND ref_id=?", [ref_id]);
}
if (sisa.length) console.log(`⚠️  ${sisa.length} pelamar sisa run sebelumnya dibersihkan\n`);

const hitung = async () => {
  const [r]: any = await root.query("SELECT COUNT(*) c FROM pelamar");
  return Number(r[0].c);
};
const awal = await hitung();

// Bahan uji dari data nyata.
const [buka]: any = await root.query(
  "SELECT kode FROM lowongan WHERE status='OPEN' AND tanggal_tutup >= CURDATE() LIMIT 1");
const [lewat]: any = await root.query(
  "SELECT kode, status, tanggal_tutup FROM lowongan WHERE status='OPEN' AND tanggal_tutup < CURDATE() LIMIT 1");
const [ditutup]: any = await root.query("SELECT kode FROM lowongan WHERE status <> 'OPEN' LIMIT 1");
if (!buka.length) { console.log("Tidak ada lowongan yang masih menerima pelamar — tes tidak bisa jalan."); process.exit(1); }
const LOW = buka[0].kode as string;
console.log(`lowongan terbuka : ${LOW}`);
console.log(`OPEN tapi lewat  : ${lewat[0]?.kode ?? "(tidak ada)"} (tutup ${lewat[0]?.tanggal_tutup?.toISOString?.().slice(0,10) ?? "-"})`);
console.log(`sudah CLOSED     : ${ditutup[0]?.kode ?? "(tidak ada)"}\n`);

const dasar = {
  lowongan: LOW,
  nama: "Andi Wijaya Uji",
  email: "andi.uji@contoh.test",
  telepon: "08123456789",
  pendidikan: "S1",
  pengalaman: 3,
  sumber: "JobStreet",
};

console.log("--- lowongan ---");
{
  const h = await susunDrafPelamar({ ...dasar, lowongan: "LOW-9999-999" });
  const m = !h.ok && h.masalah.find((x) => x.jenis === "lowongan-tidak-ketemu");
  cek(!!m, "lowongan karangan ditolak");
  cek(!!m && "terbuka" in m && m.terbuka.includes(LOW), "pesannya menyebut lowongan yang masih buka");
}
if (lewat.length) {
  const h = await susunDrafPelamar({ ...dasar, lowongan: lewat[0].kode });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "lowongan-tutup"),
    `OPEN tapi tanggal_tutup lewat ditolak (${lewat[0].kode})`);
}
if (ditutup.length) {
  const h = await susunDrafPelamar({ ...dasar, lowongan: ditutup[0].kode });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "lowongan-tutup"), "lowongan CLOSED ditolak");
}

console.log("--- daftar tertutup ---");
for (const [label, nilai] of [["kosong", ""], ["karangan", "S3 Teknik"], ["salah ketik", "s.1"]] as const) {
  const h = await susunDrafPelamar({ ...dasar, pendidikan: nilai });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "pendidikan-tidak-dikenal"), `pendidikan ${label} ditolak`);
}
for (const [label, nilai] of [["karangan", "Instagram"], ["beda ejaan", "Job Street"]] as const) {
  const h = await susunDrafPelamar({ ...dasar, sumber: nilai });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "sumber-tidak-dikenal"), `sumber ${label} ditolak`);
}
{
  // Beda besar-kecil huruf HARUS diterima, dan disimpan dengan ejaan resmi.
  const h = await susunDrafPelamar({ ...dasar, pendidikan: "s1", sumber: "jobstreet" });
  cek(h.ok && h.draf.pendidikan === "S1" && h.draf.sumber === "JobStreet",
    "beda besar-kecil huruf diterima, disimpan ejaan resmi");
}

console.log("--- isian lain ---");
for (const [label, nama] of [["kosong", ""], ["dua huruf", "Ab"]] as const) {
  const h = await susunDrafPelamar({ ...dasar, nama });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "nama-kurang"), `nama ${label} ditolak`);
}
for (const [label, email] of [["tanpa @", "andi.test"], ["tanpa domain", "andi@"], ["kosong", ""]] as const) {
  const h = await susunDrafPelamar({ ...dasar, email });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "email-tidak-sah"), `email ${label} ditolak`);
}
for (const [label, p] of [["negatif", -1], ["pecahan", 2.5], [`> ${PENGALAMAN_MAKS}`, 99]] as const) {
  const h = await susunDrafPelamar({ ...dasar, pengalaman: p });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "pengalaman-tidak-wajar"), `pengalaman ${label} ditolak`);
}
{
  const besok = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const h = await susunDrafPelamar({ ...dasar, tanggal: besok });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "tanggal-tidak-wajar"), "tanggal ke depan ditolak");
}
{
  const lama = new Date(Date.now() - (HARI_MUNDUR_MAKS + 5) * 86_400_000).toISOString().slice(0, 10);
  const h = await susunDrafPelamar({ ...dasar, tanggal: lama });
  cek(!h.ok && h.masalah.some((x) => x.jenis === "tanggal-tidak-wajar"), `>${HARI_MUNDUR_MAKS} hari lalu ditolak`);
}
{
  const h = await susunDrafPelamar({ ...dasar, nama: "", email: "x", pendidikan: "?", pengalaman: -5 });
  cek(!h.ok && h.masalah.length >= 4, `beberapa masalah sekaligus (${!h.ok ? h.masalah.length : 0})`);
}
cek((await hitung()) === awal, "tidak ada yang tersimpan dari semua penolakan");

console.log("--- jalur lancar ---");
let idBaru = 0;
{
  const h = await susunDrafPelamar(dasar);
  cek(h.ok, "draf tersusun", h.ok ? "" : JSON.stringify(h.masalah).slice(0, 120));
  if (!h.ok) {
    gagal.push("draf gagal, sisa tes dilewati");
  } else {
    cek(h.draf.status === STATUS_AWAL, `status awal ${STATUS_AWAL}`);
    cek(h.draf.lowongan.kode === LOW, "lowongan benar");
    cek(!drafPelamarJadiTeks(h.draf).toLowerCase().includes("gaji"), "teks draf tidak menyebut gaji");

    const asli = sidikDrafPelamar(h.draf);
    cek(sidikDrafPelamar({ ...h.draf, email: "lain@contoh.test" }) !== asli, "ubah email -> sidik berubah");
    cek(sidikDrafPelamar({ ...h.draf, pengalaman: 9 }) !== asli, "ubah pengalaman -> sidik berubah");

    const palsu = await simpanPelamar(dasar, "sidikpalsu000000", STAF);
    cek(!palsu.ok && palsu.sebab === "draf-berubah", "sidik palsu ditolak");
    cek((await hitung()) === awal, "sidik palsu: tidak ada yang tersimpan");

    const s = await simpanPelamar(dasar, asli, STAF);
    cek(s.ok, "tersimpan", s.ok ? `id ${s.id}` : s.pesan);
    if (s.ok) {
      idBaru = s.id;
      cek((await hitung()) === awal + 1, "jumlah pelamar bertambah 1");
      const [b]: any = await root.query(
        "SELECT lowongan_id, nama, email, status, karyawan_id, pendidikan, sumber FROM pelamar WHERE id=?", [s.id]);
      cek(String(b[0].status) === STATUS_AWAL, `status tersimpan ${STATUS_AWAL}`);
      cek(b[0].karyawan_id === null, "karyawan_id dibiarkan NULL");
      cek(String(b[0].pendidikan) === "S1" && String(b[0].sumber) === "JobStreet", "ejaan resmi tersimpan");

      const [log]: any = await root.query(
        "SELECT ref_kode, username, peran, asal FROM entri_log WHERE entitas='pelamar' AND ref_id=?", [s.id]);
      cek(log.length === 1, "jejak audit tercatat");
      cek(log[0]?.username === "hr1" && log[0]?.peran === "staf",
        `audit: ${log[0]?.username}/${log[0]?.peran}`);
      cek(log[0]?.ref_kode === LOW, "audit menyimpan kode lowongan");

      // Email yang sama ke lowongan yang SAMA harus ditolak.
      const ulang = await susunDrafPelamar(dasar);
      cek(!ulang.ok && ulang.masalah.some((x) => x.jenis === "email-sudah-ada"),
        "email sama di lowongan sama ditolak");
    }
  }
}

if (idBaru) {
  await root.query("DELETE FROM pelamar WHERE id=?", [idBaru]);
  await root.query("DELETE FROM entri_log WHERE entitas='pelamar' AND ref_id=?", [idBaru]);
  cek((await hitung()) === awal, "dibersihkan, kembali ke jumlah semula");
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
