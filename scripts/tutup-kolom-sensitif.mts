/**
 * Menutup kolom kredensial dari `ai_readonly`.
 *
 * ⚠️ PostgreSQL tidak bisa MENCABUT satu kolom saja kalau izinnya diberikan
 * di tingkat TABEL. Jadi caranya: cabut SELECT tabelnya, lalu berikan lagi
 * per kolom KECUALI yang sensitif -- sama persis dengan pola
 * `GRANT SELECT (kolom)` yang sudah dipakai di MySQL untuk menutup gaji.
 */
import { Client } from "pg";

const SENSITIF: Record<string, string[]> = {
  users: ["password"],
  users_tokens: ["token", "refresh_token"],
  approver_history: ["token"],
};

const RO = process.env.DEMO_PG_USER ?? "ai_readonly";
const c = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000, statement_timeout: 60_000,
});
await c.connect();

for (const [tabel, rahasia] of Object.entries(SENSITIF)) {
  const kolom = (await c.query(
    `SELECT a.attname AS k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid
     WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped
     ORDER BY a.attnum`, [tabel])).rows.map((x) => String(x.k));
  const aman = kolom.filter((k) => !rahasia.includes(k));

  await c.query(`REVOKE SELECT ON public.${tabel} FROM ${RO}`);
  await c.query(`GRANT SELECT (${aman.map((k) => `"${k}"`).join(", ")}) ON public.${tabel} TO ${RO}`);
  console.log(`${tabel}: ${aman.length} kolom dibuka, ditutup -> ${rahasia.join(", ")}`);
}

// ALTER DEFAULT PRIVILEGES tidak berlaku surut, tapi tabel BARU tetap akan
// dapat SELECT penuh. Itu disengaja: lebih baik terlihat lalu ditutup daripada
// tidak terlihat sama sekali dan gejalanya muncul sebagai galat membingungkan.
console.log("\nverifikasi:");
for (const x of (await c.query(
  `SELECT c.relname AS tabel, a.attname AS kolom,
          has_column_privilege($1, c.oid, a.attname, 'SELECT') AS terbaca
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname ~* '^(password|passwd|token|secret|api_key|refresh_token|pin|otp)$'
    ORDER BY c.relname, a.attname`, [RO])).rows) {
  console.log(`  ${x.terbaca ? "MASIH TERBACA" : "tertutup     "} ${String(x.tabel).padEnd(20)} ${x.kolom}`);
}
await c.end();
process.exit(0);
