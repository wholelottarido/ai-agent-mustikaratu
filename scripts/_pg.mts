import { poolPerusahaan } from "@/lib/db-perusahaan";
const { rows } = await poolPerusahaan().query<{ now: string; user: string }>(
  `SELECT now()::text AS now, current_user AS user`);
console.log("PostgreSQL hidup:", rows[0]);
const { rows: k } = await poolPerusahaan().query(
  `SELECT kolom_isian FROM ai_tool WHERE kode = 'buat_tiket'`);
console.log("\nkolom_isian buat_tiket:");
console.log(JSON.stringify(k[0]?.kolom_isian, null, 1));
const { rows: o } = await poolPerusahaan().query(
  `SELECT kolom_otomatis, kolom_kunci, syarat, tabel_target FROM ai_tool WHERE kode = 'buat_tiket'`);
console.log("\notomatis/kunci/syarat:", JSON.stringify(o[0], null, 1));
process.exit(0);
