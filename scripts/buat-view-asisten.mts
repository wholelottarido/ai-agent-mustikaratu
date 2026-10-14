/**
 * Menjalankan `db/demo-pg/02_view_asisten.sql` di database perusahaan.
 *
 * ⚠️ MENULIS ke server perusahaan. Memakai `DEMO_PG_ADMIN_*` (superuser) --
 * satu dari tiga skrip yang boleh, dan hanya untuk membuat view.
 *
 * Membatalkan: DROP VIEW IF EXISTS v_asisten_karyawan, v_asisten_pengajuan,
 *   v_asisten_aset, v_asisten_kunjungan, v_asisten_tiket, v_asisten_klaim;
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";

const c = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000, statement_timeout: 60_000,
});
await c.connect();
const [{ current_user: aku }] = (await c.query("SELECT current_user")).rows;
console.log(`tersambung sebagai: ${aku}`);

const sql = readFileSync("db/demo-pg/02_view_asisten.sql", "utf8");
try {
  await c.query(sql);
  console.log("SQL dijalankan tanpa galat.\n");
} catch (e: any) {
  console.log(`GAGAL: ${e.code} ${e.message}`);
  if (e.position) console.log(`  posisi ${e.position}`);
  await c.end();
  process.exit(1);
}

const v = (await c.query(
  `SELECT c.relname AS view,
          has_table_privilege('ai_readonly', c.oid, 'SELECT') AS boleh
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'v\_asisten\_%'
    ORDER BY 1`)).rows;
console.log(`view terbentuk: ${v.length}`);
for (const x of v) console.log(`  ${String(x.view).padEnd(24)} ai_readonly boleh baca: ${x.boleh}`);
await c.end();
process.exit(0);
