/**
 * Pool `hr_entry` — SATU-SATUNYA koneksi yang bisa menulis ke database `hr`.
 *
 * ⚠️ Dipakai bersama oleh semua penulis HR (`lembur.ts`, nanti `pelamar.ts`).
 * Jangan bikin pool kedua untuk user ini: `hr_entry` dibatasi
 * `MAX_USER_CONNECTIONS 6`, dan bot WhatsApp adalah proses TERPISAH yang
 * memegang salinan pool-nya sendiri. Dua pool × 3 koneksi × 2 proses = 12,
 * lewat batas. Gejalanya `ER_USER_LIMIT_REACHED` yang muncul belakangan dan
 * tidak menunjuk ke penyebabnya — sudah pernah terjadi pada `portal_app`.
 *
 * ⚠️ Jangan berikan ke agent. Model tidak punya tool apa pun yang menyentuh
 * berkas ini; penyimpanan dipicu user lewat tombol/balasan.
 */
import mysql from "mysql2/promise";

let kolam: mysql.Pool | undefined;

export function poolEntriHr(): mysql.Pool {
  if (!kolam) {
    const user = process.env.HR_ENTRY_DB_USER;
    if (!user) {
      throw new Error(
        "HR_ENTRY_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/hr/02_entri.sql sebagai root.",
      );
    }
    kolam = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.HR_ENTRY_DB_PASSWORD,
      database: process.env.HR_DB_NAME ?? "hr",
      connectionLimit: 3,
      multipleStatements: false,
      // DECIMAL tetap string. `gaji_pokok` sampai belasan juta dan
      // `nilai_rp` ikut turunannya — dibiarkan float, pembulatannya bisa
      // meleset di digit terakhir tanpa ada yang sadar.
      decimalNumbers: false,
    });
  }
  return kolam;
}
