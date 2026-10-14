/**
 * Tes entri lembur (HR-2).
 *
 * PRASYARAT: `db/hr/02_entri.sql` sudah dijalankan sebagai root.
 *
 * Butuh root MySQL untuk membersihkan data uji — `hr_entry` sendiri sengaja
 * tidak punya DELETE.
 */
import mysql from "mysql2/promise";
import {
  susunDrafLembur, simpanLembur, sidikDrafLembur, drafLemburJadiTeks,
  JAM_MAKS, HARI_MUNDUR_MAKS, LEVEL_BERHAK_LEMBUR,
} from "../lib/entri/lembur.ts";
import type { KonteksEntri } from "../lib/entri/simpan.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PENANDA = "uji lembur";
const KEPALA: KonteksEntri = {
  penggunaId: 4, username: "hr2", departemen: "hr",
  peran: "kepala", asal: "web", permintaan: PENANDA,
};

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.HR_DB_NAME,
});

// Sisa run yang terputus.
const [sisa]: any = await root.query(
  "SELECT DISTINCT ref_id FROM entri_log WHERE entitas='lembur' AND permintaan=?", [PENANDA]);
for (const { ref_id } of sisa) {
  await root.query("DELETE FROM lembur WHERE id=?", [ref_id]);
  await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=?", [ref_id]);
}
if (sisa.length) console.log(`⚠️  ${sisa.length} lembur sisa run sebelumnya dibersihkan\n`);

const hitung = async () => {
  const [r]: any = await root.query("SELECT COUNT(*) c FROM lembur");
  return Number(r[0].c);
};
const awal = await hitung();

// Bahan uji diambil dari data nyata, bukan ditebak.
const daftarBerhak = LEVEL_BERHAK_LEMBUR.map(() => "?").join(",");
// Namanya harus UNIK. Percobaan pertama memakai `LIMIT 1` begitu saja dan
// kena "Bayu Maharani" -- dua orang, nama/departemen/jabatan sama persis,
// pembedanya cuma NIK. Aturan ambigu jalan dengan benar, tapi jalur lancarnya
// jadi tidak pernah teruji.
const [aktif]: any = await root.query(
  `SELECT k.nama, k.nik FROM karyawan k JOIN jabatan j ON j.id=k.jabatan_id
    WHERE k.status_kerja='AKTIF' AND j.level IN (${daftarBerhak})
      AND k.nama NOT IN (SELECT nama FROM (
            SELECT nama FROM karyawan GROUP BY nama HAVING COUNT(*) > 1) d)
    LIMIT 1`,
  LEVEL_BERHAK_LEMBUR);
const [takBerhak]: any = await root.query(
  `SELECT k.nama, k.nik, j.nama jabatan, j.level FROM karyawan k
     JOIN jabatan j ON j.id=k.jabatan_id
    WHERE k.status_kerja='AKTIF' AND j.level NOT IN (${daftarBerhak}) LIMIT 1`,
  LEVEL_BERHAK_LEMBUR);
const [tidakAktif]: any = await root.query(
  "SELECT nama, nik, status_kerja FROM karyawan WHERE status_kerja <> 'AKTIF' LIMIT 1");
const [kembar]: any = await root.query(
  "SELECT nama FROM karyawan GROUP BY nama HAVING COUNT(*) > 1 LIMIT 1");
const ORANG = aktif[0].nama as string;
const NIK = aktif[0].nik as string;
console.log(`karyawan uji: ${ORANG} (${NIK})`);
console.log(`tidak aktif : ${tidakAktif[0].nama} (${tidakAktif[0].status_kerja})`);
console.log(`nama kembar : ${kembar[0].nama}\n`);

const dasar = { karyawan: ORANG, jam: 2, alasan: "closing bulanan" };

console.log("--- penolakan ---");
{
  const h = await susunDrafLembur({ ...dasar, karyawan: "Nama Yang Tidak Ada Sama Sekali" });
  cek(!h.ok && h.masalah.some((m) => m.jenis === "karyawan-tidak-ketemu"), "karyawan tidak ada ditolak");
}
{
  const h = await susunDrafLembur({ ...dasar, karyawan: kembar[0].nama });
  const m = !h.ok && h.masalah.find((x) => x.jenis === "karyawan-ambigu");
  cek(!!m, "nama kembar -> ambigu, tidak ditebak",
    m && m.jenis === "karyawan-ambigu" ? `${m.pilihan.length} pilihan, ada NIK` : "");
  if (m && m.jenis === "karyawan-ambigu") {
    cek(m.pilihan.every((p) => p.nik && p.departemen), "tiap pilihan bawa NIK & departemen");
  }
}
{
  const h = await susunDrafLembur({ ...dasar, karyawan: tidakAktif[0].nama });
  cek(!h.ok && h.masalah.some((m) => m.jenis === "karyawan-tidak-aktif"),
    `karyawan ${tidakAktif[0].status_kerja} ditolak`);
}
{
  const h = await susunDrafLembur({ ...dasar, karyawan: takBerhak[0].nama });
  const m = !h.ok && h.masalah.find((x) => x.jenis === "jabatan-tidak-berhak");
  cek(!!m, `level ${takBerhak[0].level} ditolak (tidak berhak lembur)`);
  cek(!!m && "jabatan" in m && m.jabatan === takBerhak[0].jabatan, "pesannya menyebut jabatannya");
}
for (const [label, jam] of [["0 jam", 0], ["negatif", -2], [`lebih dari ${JAM_MAKS}`, 5], ["bukan kelipatan 0,5", 2.3]] as const) {
  const h = await susunDrafLembur({ ...dasar, jam });
  cek(!h.ok && h.masalah.some((m) => m.jenis === "jam-tidak-wajar"), `jam ${label} ditolak`);
}
for (const [label, alasan] of [["kosong", ""], ["spasi", "   "], ["pendek", "a"]] as const) {
  const h = await susunDrafLembur({ ...dasar, alasan });
  cek(!h.ok && h.masalah.some((m) => m.jenis === "alasan-kurang"), `alasan ${label} ditolak`);
}
{
  const besok = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const h = await susunDrafLembur({ ...dasar, tanggal: besok });
  cek(!h.ok && h.masalah.some((m) => m.jenis === "tanggal-tidak-wajar"), "tanggal ke depan ditolak");
}
{
  const lama = new Date(Date.now() - (HARI_MUNDUR_MAKS + 5) * 86_400_000).toISOString().slice(0, 10);
  const h = await susunDrafLembur({ ...dasar, tanggal: lama });
  cek(!h.ok && h.masalah.some((m) => m.jenis === "tanggal-tidak-wajar"),
    `lebih dari ${HARI_MUNDUR_MAKS} hari lalu ditolak (jebakan salah ketik tahun)`);
}
{
  const h = await susunDrafLembur({ karyawan: "Tidak Ada", jam: 99, alasan: "" });
  cek(!h.ok && h.masalah.length >= 2, `beberapa masalah dilaporkan sekaligus (${!h.ok ? h.masalah.length : 0})`);
}
cek((await hitung()) === awal, "tidak ada yang tersimpan dari semua penolakan");

console.log("--- nilai rupiah ---");
let draf: any = null;
{
  const h = await susunDrafLembur(dasar);
  cek(h.ok, "draf tersusun");
  if (h.ok) {
    draf = h.draf;
    const [cocok]: any = await root.query(
      "SELECT ROUND(? * 1.8 * gaji_pokok / 173, -2) v FROM karyawan WHERE id=?", [2, h.draf.karyawan.id]);
    cek(h.draf.nilaiRp === Number(cocok[0].v),
      "nilai_rp = ROUND(jam*1.8*gaji/173, -2)", `${h.draf.nilaiRp} vs ${cocok[0].v}`);
    cek(h.draf.nilaiRp % 100 === 0, "dibulatkan ke ratusan");
    cek(h.draf.status === "PENDING", "status PENDING");
    cek(!drafLemburJadiTeks(h.draf).includes("gaji"), "teks draf tidak menyebut gaji");
  }
}
{
  // NIK juga harus bisa dipakai, supaya nama kembar punya jalan keluar.
  const h = await susunDrafLembur({ ...dasar, karyawan: NIK });
  cek(h.ok && h.draf.karyawan.nik === NIK, "bisa dicari lewat NIK");
}

console.log("--- sidik ---");
if (!draf) {
  // Tanpa penjagaan ini, draf yang gagal bikin tesnya MATI dengan
  // "Cannot read properties of null" -- galat yang menunjuk ke sidikDrafLembur,
  // bukan ke penyebab sebenarnya.
  gagal.push("draf tidak tersusun, bagian sidik & jalur lancar dilewati");
} else {
  const asli = sidikDrafLembur(draf);
  cek(sidikDrafLembur({ ...draf, jam: 3 }) !== asli, "ubah jam -> sidik berubah");
  cek(sidikDrafLembur({ ...draf, nilaiRp: 1 }) !== asli, "ubah nilai_rp -> sidik berubah");
  cek(sidikDrafLembur({ ...draf, alasan: "lain" }) !== asli, "ubah alasan -> sidik berubah");
  cek(draf.karyawan.level !== "" && LEVEL_BERHAK_LEMBUR.includes(draf.karyawan.level),
    `karyawan draf berlevel berhak (${draf.karyawan.level})`);

  const palsu = await simpanLembur(dasar, "sidikpalsu000000", KEPALA);
  cek(!palsu.ok && palsu.sebab === "draf-berubah", "sidik palsu ditolak",
    !palsu.ok ? palsu.sebab : "MALAH LOLOS");
  cek((await hitung()) === awal, "sidik palsu: tidak ada yang tersimpan");

  console.log("--- jalur lancar ---");
  const h = await simpanLembur(dasar, sidikDrafLembur(draf), KEPALA);
  cek(h.ok, "tersimpan", h.ok ? `id ${h.id}` : h.pesan);
  if (h.ok) {
    cek((await hitung()) === awal + 1, "jumlah lembur bertambah 1");
    const [b]: any = await root.query(
      "SELECT karyawan_id, jam, status, nilai_rp, alasan FROM lembur WHERE id=?", [h.id]);
    cek(Number(b[0].nilai_rp) === draf.nilaiRp, "nilai_rp tersimpan sesuai draf");
    cek(String(b[0].status) === "PENDING", "status tersimpan PENDING");
    cek(Number(b[0].jam) === 2, "jam tersimpan benar");

    const [log]: any = await root.query(
      "SELECT entitas, aksi, ref_kode, username, peran, asal FROM entri_log WHERE entitas='lembur' AND ref_id=?", [h.id]);
    cek(log.length === 1, "jejak audit tercatat");
    cek(log[0]?.username === "hr2" && log[0]?.peran === "kepala" && log[0]?.asal === "web",
      `audit: ${log[0]?.username}/${log[0]?.peran}/${log[0]?.asal}`);
    cek(log[0]?.ref_kode === draf.karyawan.nik, "audit menyimpan NIK karyawan");

    await root.query("DELETE FROM lembur WHERE id=?", [h.id]);
    await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=?", [h.id]);
    cek((await hitung()) === awal, "dibersihkan, kembali ke jumlah semula");
  }
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
