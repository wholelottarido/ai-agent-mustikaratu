/**
 * Membuat role PostgreSQL read-only `ai_readonly` di database perusahaan.
 *
 * ⚠️ MENGUBAH SERVER PERUSAHAAN. Jalankan sadar, dan beri tahu pemegang server.
 *
 * Password dibaca dari `DEMO_PG_PASSWORD`, TIDAK pernah ditulis ke berkas
 * SQL. `CREATE ROLE ... PASSWORD` tidak bisa memakai parameter biasa, jadi
 * nilainya dilewatkan lewat `set_config` lalu disisipkan dengan `format('%L')`
 * -- aman dari penyuntikan, dan tidak muncul di riwayat perintah.
 *
 * Membatalkan: DROP OWNED BY ai_readonly; DROP ROLE ai_readonly;
 */
import { Client } from "pg";

const RO = process.env.DEMO_PG_USER ?? "ai_readonly";
const PW = process.env.DEMO_PG_PASSWORD;
if (!PW) { console.log("DEMO_PG_PASSWORD belum diisi."); process.exit(1); }

const c = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000, statement_timeout: 60_000,
});
await c.connect();

const [{ current_user: aku }] = (await c.query("SELECT current_user")).rows;
console.log(`tersambung sebagai: ${aku}`);

await c.query("SELECT set_config('ai.ropw', $1, false)", [PW]);
await c.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RO}') THEN
      EXECUTE format('CREATE ROLE ${RO} LOGIN PASSWORD %L', current_setting('ai.ropw'));
      RAISE NOTICE 'role dibuat';
    ELSE
      EXECUTE format('ALTER ROLE ${RO} PASSWORD %L', current_setting('ai.ropw'));
      RAISE NOTICE 'role sudah ada, password diperbarui';
    END IF;
  END
  $$;`);

for (const sql of [
  `ALTER ROLE ${RO} CONNECTION LIMIT 10`,
  `ALTER ROLE ${RO} SET statement_timeout = '30s'`,
  `ALTER ROLE ${RO} SET default_transaction_read_only = on`,
  `GRANT CONNECT ON DATABASE ${process.env.DEMO_PG_DATABASE} TO ${RO}`,
  `GRANT USAGE ON SCHEMA public TO ${RO}`,
  `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${RO}`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO ${RO}`,
]) { await c.query(sql); console.log("  ok: " + sql.slice(0, 72)); }

const [r] = (await c.query(
  `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolconnlimit,
          rolbypassrls, rolreplication
     FROM pg_roles WHERE rolname = $1`, [RO])).rows;
console.log("\nhasil:");
console.log(`  ${r.rolname}: super=${r.rolsuper} createdb=${r.rolcreatedb} createrole=${r.rolcreaterole}`);
console.log(`  login=${r.rolcanlogin} batas_koneksi=${r.rolconnlimit} bypassrls=${r.rolbypassrls} replication=${r.rolreplication}`);
await c.end();
process.exit(0);
