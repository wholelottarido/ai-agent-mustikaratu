/** Menguji batas role `ai_readonly`. Yang boleh cuma membaca. */
import { Client } from "pg";
const c = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER, password: process.env.DEMO_PG_PASSWORD,
  connectionTimeoutMillis: 15_000, statement_timeout: 40_000,
});
const lolos: string[] = [], gagal: string[] = [];
try { await c.connect(); lolos.push("koneksi sebagai ai_readonly"); }
catch (e: any) { console.log("koneksi GAGAL:", e.code, e.message); process.exit(1); }

const uji = async (nama: string, sql: string, harus: "BISA" | "DITOLAK") => {
  let nyata: string, kode = "";
  try { await c.query(sql); nyata = "BISA"; }
  catch (e: any) { nyata = "DITOLAK"; kode = ` (${e.code})`; }
  (nyata === harus ? lolos : gagal).push(`${nama.padEnd(40)} ${nyata}${kode}`);
};

await uji("SELECT dari view agent", "SELECT * FROM v_ai_karyawan LIMIT 1", "BISA");
await uji("SELECT dari tabel besar (berbatas)", "SELECT id_employee FROM employee LIMIT 1", "BISA");
await uji("SELECT katalog sistem", "SELECT COUNT(*) FROM pg_class", "BISA");
await uji("INSERT ke ai_percakapan", "INSERT INTO ai_percakapan (id_ai_percakapan) VALUES (gen_random_uuid())", "DITOLAK");
await uji("UPDATE employee", "UPDATE employee SET fullname='x' WHERE false", "DITOLAK");
await uji("DELETE dari lembur perusahaan", "DELETE FROM ai_chat_session WHERE false", "DITOLAK");
await uji("CREATE TABLE", "CREATE TABLE zz_uji_hapus_saya (a int)", "DITOLAK");
await uji("DROP TABLE", "DROP TABLE IF EXISTS ai_tool_log", "DITOLAK");
await uji("TRUNCATE", "TRUNCATE ai_tool_log", "DITOLAK");
await uji("CREATE ROLE", "CREATE ROLE zz_uji LOGIN", "DITOLAK");
// Kolom kredensial HARUS tertutup: agent yang bisa query bebas berarti
// hash password bisa muncul di jawaban.
await uji("baca users.password", "SELECT password FROM users LIMIT 1", "DITOLAK");
await uji("baca users_tokens.token", "SELECT token FROM users_tokens LIMIT 1", "DITOLAK");
await uji("baca approver_history.token", "SELECT token FROM approver_history LIMIT 1", "DITOLAK");
await uji("baca users.username (kolom aman)", "SELECT username FROM users LIMIT 1", "BISA");
await uji("SELECT * FROM users (ikut kolom rahasia)", "SELECT * FROM users LIMIT 1", "DITOLAK");

// Penjaga sebenarnya adalah GRANT, bukan setelan sesi. Dibuktikan dengan
// mematikan setelannya lebih dulu -- tulis harus TETAP ditolak.
await c.query("SET default_transaction_read_only = off");
await uji("UPDATE setelah read-only dimatikan", "UPDATE employee SET fullname=fullname WHERE false", "DITOLAK");
await uji("CREATE TABLE setelah dimatikan", "CREATE TABLE zz_uji_hapus_saya (a int)", "DITOLAK");
await c.query("SET default_transaction_read_only = on");

const [{ ro }] = (await c.query("SELECT current_setting('default_transaction_read_only') AS ro")).rows;
(ro === "on" ? lolos : gagal).push(`transaksi read-only bawaan            ${ro}`);

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await c.end();
process.exit(gagal.length === 0 ? 0 : 1);
