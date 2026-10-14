/**
 * Memetakan database perusahaan (PostgreSQL).
 *
 * Menyambung dengan kredensial BAWAAN, yang sejak 29 Sep 2026 adalah
 * `ai_readonly` — bukan superuser. Kalau sebuah query di sini ditolak dengan
 * `42501`, itu BUKAN bug: artinya kolom/tabel itu memang sengaja ditutup.
 *
 * Skrip administrasi yang butuh superuser memakai `DEMO_PG_ADMIN_*`, dan cuma
 * ada dua: `buat-pg-readonly.mts` dan `tutup-kolom-sensitif.mts`.
 */
import { Client } from "pg";

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER,
  password: process.env.DEMO_PG_PASSWORD,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
});
await c.connect();
const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;

const [info] = await q(
  `SELECT current_user AS pengguna, current_database() AS db,
          pg_size_pretty(pg_database_size(current_database())) AS ukuran`);
console.log(`${info.db} (${info.ukuran}) sebagai ${info.pengguna}\n`);

const t = await q(
  `SELECT c.relname AS nama, GREATEST(c.reltuples,0)::bigint AS kira,
          pg_total_relation_size(c.oid) AS ukuran
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname='public' ORDER BY c.relname`);

// Hitungan pasti hanya untuk tabel kecil — `reltuples` menyesatkan (115 dari
// 220 tabel belum pernah dianalisis, nilainya 0), tapi COUNT(*) pada tabel
// 4,2 juta baris membebani server yang dipakai orang lain.
const kecil = t.filter((x) => Number(x.ukuran) < 20 * 1048576).map((x) => String(x.nama));
const pasti = new Map<string, number>();
for (let i = 0; i < kecil.length; i += 30) {
  const blok = kecil.slice(i, i + 30);
  for (const r of await q(blok.map((n) => `SELECT '${n}' AS t, COUNT(*)::bigint AS n FROM "${n}"`).join(" UNION ALL ")))
    pasti.set(String(r.t), Number(r.n));
}
const baris = (n: string, kira: number) => pasti.get(n) ?? kira;
const rp = (n: number) => n.toLocaleString("id-ID");

const grup = new Map<string, { n: number; baris: number }>();
for (const x of t) {
  const k = String(x.nama).split("_")[0];
  const g = grup.get(k) ?? { n: 0, baris: 0 };
  g.n++; g.baris += baris(String(x.nama), Number(x.kira));
  grup.set(k, g);
}

console.log("MODUL".padEnd(16) + "TABEL".padStart(6) + "BARIS".padStart(16));
for (const [k, g] of [...grup].sort((a, b) => b[1].n - a[1].n))
  if (g.n >= 2) console.log(k.padEnd(16) + String(g.n).padStart(6) + rp(g.baris).padStart(16));

const [j] = await q(
  `SELECT COUNT(*) FILTER (WHERE relkind='r')::int tabel,
          COUNT(*) FILTER (WHERE relkind='v')::int view
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`);
console.log(`\ntotal: ${j.tabel} tabel, ${j.view} view`);

console.log("\n=== permukaan data agent (view v_ai_*) ===");
for (const v of await q(
  `SELECT c.relname AS view,
          (SELECT COUNT(*) FROM pg_attribute a
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS kolom
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'v\\_ai\\_%'
    ORDER BY c.relname`)) console.log(`  ${String(v.view).padEnd(24)} ${v.kolom} kolom`);

console.log("\n=== agent -> aplikasi -> peran ===");
for (const x of await q(
  `SELECT g.kode AS agent, COALESCE(a.apps_name::text,'(tanpa apps)') AS apl,
          COALESCE(string_agg(DISTINCT r.roles, ', '),'-') AS peran
     FROM ai_agent g LEFT JOIN apps a ON a.id_apps=g.id_apps
     LEFT JOIN roles r ON r.id_apps=g.id_apps AND r.is_active
    GROUP BY g.kode, a.apps_name ORDER BY g.kode`).catch(() => [])) {
  console.log(`  ${String(x.agent).padEnd(18)} ${String(x.apl).padEnd(34)} ${x.peran}`);
}

await c.end();
process.exit(0);
