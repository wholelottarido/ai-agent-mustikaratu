/**
 * Membuktikan fondasi login perusahaan (Tahap 10A) benar-benar terkunci.
 *
 *   npm run uji:pg-login
 *
 * PRASYARAT: `npm run buat:pg-login` sudah dijalankan.
 *
 * Yang dijaga di sini paling mahal kalau bocor:
 *
 *   1. `ai_readonly` TIDAK boleh memanggil `cek_login_perusahaan`.
 *      Kalau bisa, agent punya alat menebak password: penjaga SQL kita cuma
 *      memeriksa nama tabel di FROM/JOIN, dan query tanpa FROM akan lolos.
 *
 *   2. `portal_login` TIDAK boleh membaca apa pun selain `v_login_profil`.
 *      Terutama `users.password` -- seluruh alasan fungsi ini ada adalah agar
 *      hash tidak pernah keluar dari database.
 */
import { Client } from "pg";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const dasar = {
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  connectionTimeoutMillis: 15_000,
};

if (!process.env.DEMO_PG_LOGIN_PASSWORD) {
  console.log("⛔ DEMO_PG_LOGIN_PASSWORD belum diisi di .env.local.");
  process.exit(1);
}

const login = new Client({
  ...dasar,
  user: process.env.DEMO_PG_LOGIN_USER ?? "portal_login",
  password: process.env.DEMO_PG_LOGIN_PASSWORD,
});
const agent = new Client({
  ...dasar,
  user: process.env.DEMO_PG_USER,
  password: process.env.DEMO_PG_PASSWORD,
});

try {
  await login.connect();
  cek(true, "portal_login bisa menyambung");
} catch (e) {
  console.log(`⛔ portal_login tidak bisa menyambung: ${e instanceof Error ? e.message : e}`);
  console.log("   Jalankan `npm run buat:pg-login` dulu.");
  process.exit(1);
}
await agent.connect();

/** Jalankan query, kembalikan hasil atau kode error PostgreSQL. */
async function coba(c: Client, sql: string, nilai: unknown[] = []) {
  try {
    const r = await c.query(sql, nilai);
    return { ok: true as const, baris: r.rows };
  } catch (e) {
    return { ok: false as const, kode: (e as { code?: string }).code ?? "?" };
  }
}

console.log("--- 1. yang BOLEH dilakukan portal_login ---");
{
  const h = await coba(login, "SELECT COUNT(*)::int n FROM v_login_profil");
  cek(h.ok, "baca v_login_profil", h.ok ? `${h.baris[0].n} profil` : h.kode);
  cek(h.ok && Number(h.baris[0].n) > 1000, "profilnya banyak (bukan view kosong)");
}
{
  const h = await coba(login, "SELECT cek_login_perusahaan($1,$2) AS id", [
    "tidak-ada-akun-ini@contoh.test",
    "salah",
  ]);
  cek(h.ok, "panggil cek_login_perusahaan", h.ok ? "" : h.kode);
  cek(h.ok && h.baris[0].id === null, "akun karangan -> kosong");
}

console.log("--- 2. yang TIDAK boleh dilakukan portal_login ---");
for (const [nama, sql] of [
  ["baca users.password", "SELECT password FROM users LIMIT 1"],
  ["baca tabel users langsung", "SELECT username FROM users LIMIT 1"],
  ["baca tabel employee", "SELECT fullname FROM employee LIMIT 1"],
  ["baca view agent", "SELECT * FROM v_asisten_karyawan LIMIT 1"],
  ["baca penjualan", "SELECT * FROM v_asisten_penjualan LIMIT 1"],
  ["mengubah data", "UPDATE users SET is_active = true WHERE false"],
] as const) {
  const h = await coba(login, sql);
  cek(!h.ok, `${nama} DITOLAK`, h.ok ? "MALAH BISA" : h.kode);
}

console.log("--- 3. ⚠️ agent TIDAK boleh menebak password ---");
{
  // Inti dari pemisahan role. Kalau ini lolos, tool baca-data agent berubah
  // jadi alat brute force.
  const h = await coba(agent, "SELECT cek_login_perusahaan($1,$2)", ["a@b.c", "x"]);
  cek(!h.ok, "ai_readonly panggil cek_login_perusahaan DITOLAK", h.ok ? "MALAH BISA" : h.kode);
}
{
  const h = await coba(agent, "SELECT COUNT(*) FROM v_login_profil");
  cek(!h.ok, "ai_readonly baca v_login_profil DITOLAK", h.ok ? "MALAH BISA" : h.kode);
}
{
  const h = await coba(agent, "SELECT password FROM users LIMIT 1");
  cek(!h.ok, "ai_readonly baca users.password DITOLAK", h.ok ? "MALAH BISA" : h.kode);
}

console.log("--- 4. bentuk fungsinya ---");
{
  // ⚠️ Ini pemeriksaan STRUKTUR, bukan perilaku.
  //
  // Menguji "username kembar -> ditolak" dengan sungguhan butuh password asli
  // salah satu dari 3 akun kembar itu, dan kita tidak punya (dan tidak boleh
  // punya). Jadi yang diperiksa: penjaganya memang ada di definisi fungsi.
  const h = await coba(
    login,
    "SELECT pg_get_functiondef('cek_login_perusahaan(text,text)'::regprocedure) AS def",
  );
  const def = h.ok ? String(h.baris[0].def) : "";
  cek(def.includes("COUNT(*)") && def.includes("= 1"),
    "penjaga username kembar ada di fungsi (periksa struktur, bukan perilaku)");
  cek(def.includes("SECURITY DEFINER"), "fungsi memakai SECURITY DEFINER");
  cek(/search_path/i.test(def), "search_path dikunci (cegah pembajakan schema)");
  cek(def.includes("crypt("), "verifikasi pakai crypt() bawaan pgcrypto");
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await login.end();
await agent.end();
process.exit(gagal.length === 0 ? 0 : 1);
