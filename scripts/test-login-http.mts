/**
 * Tes jalur HTTP login perusahaan — TERMASUK JALUR SUKSES (Tahap 10B-4).
 *
 *   npm run test:login-http
 *
 * PRASYARAT: server hidup di ALAMAT (default 3018).
 *
 * ============================================================
 * ⚠️ KENAPA TES INI ADA, DAN APA YANG TIDAK DIUJINYA
 * ============================================================
 * Seluruh tes sebelumnya memakai password SALAH, jadi jalur suksesnya tidak
 * pernah dijalankan sekali pun. Menguji dengan password sungguhan ternyata
 * tidak mungkin:
 *
 *   - akun yang tersedia (`magangIT@`) adalah username KEMBAR, jadi fungsi
 *     verifikasi menolaknya apa pun passwordnya -- itu memang disengaja;
 *   - departemennya IT, di luar lingkup A;
 *   - dan passwordnya tidak diketahui.
 *
 * Membuat akun uji di database perusahaan BUKAN pilihan: itu server produksi
 * milik orang lain, dan kita cuma menumpang baca.
 *
 * Jalan keluarnya: LANGKAH KEDUA route login bisa dipanggil langsung. Token
 * pemilih profil ditandatangani `SESSION_SECRET`, yang dipegang proses ini,
 * jadi tes bisa membuat token sah untuk `id_users` NYATA -- lalu menjalankan
 * sisa rantainya sungguhan lewat HTTP.
 *
 * ⚠️ YANG TETAP TIDAK TERUJI: perbandingan bcrypt itu sendiri, yaitu
 * `crypt(password, hash)` di dalam `cek_login_perusahaan`. Yang terbukti soal
 * itu cuma bahwa ia MENOLAK dengan benar (password salah, akun karangan,
 * username kembar, suntikan SQL). Membuktikan ia MENERIMA dengan benar butuh
 * satu kredensial karyawan yang sah -- dan itu hanya bisa datang dari pemilik
 * akunnya sendiri, bukan dari kita.
 *
 * ⚠️ Tes ini membuat baris `pengguna` untuk karyawan NYATA, lalu MENGHAPUSNYA
 * lagi. Kalau terhenti di tengah, bersihkan dengan:
 *   DELETE FROM pengguna WHERE sumber_akun='perusahaan' AND id_employee='<uuid>';
 */
import mysql from "mysql2/promise";
import { jwtVerify } from "jose";
import { profilAkun, nilaiProfil, poolLoginPerusahaan } from "../lib/login-perusahaan.ts";
import { tokenPilihProfil, usernamePortal } from "../lib/akun-perusahaan.ts";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const kirim = async (isi: unknown) => {
  try {
    return await fetch(`${BASE}/api/auth/login-perusahaan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isi),
    });
  } catch {
    console.log(`⛔ Tidak ada server di ${BASE}. Jalankan \`npm run deploy\` dulu.`);
    process.exit(1);
  }
};

// ============================================================
// Cari satu karyawan NYATA yang masuk lingkup A
// ============================================================
const pg = poolLoginPerusahaan();
const { rows } = await pg.query<{ id_users: string }>(
  `SELECT id_users FROM v_login_profil
    WHERE TRIM(LOWER(departemen)) IN ('marketing','trade marketing','hrd','hrd & ga')
    ORDER BY id_users LIMIT 1`,
);
if (rows.length === 0) {
  console.log("⛔ Tidak ada karyawan lingkup A di v_login_profil. Tes tidak bisa jalan.");
  process.exit(1);
}
const idUsers = rows[0].id_users;
const semua = await profilAkun(idUsers);
const layak = semua.filter((p) => nilaiProfil(p).ok);
const target = layak[0];
console.log(`akun uji : ${semua.length} profil, ${layak.length} masuk lingkup`);
console.log(`target   : ${target.nama} — ${target.jabatan} — ${target.departemen}\n`);

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.PORTAL_DB_NAME,
});
const bersihkan = async () => {
  await root.query("DELETE FROM pengguna WHERE id_employee = ?", [target.idEmployee]);
  await root.query("DELETE FROM login_perusahaan_log WHERE id_employee = ?", [target.idEmployee]);
};
await bersihkan();

// ============================================================
console.log("--- penolakan langkah 1 ---");
{
  const r = await kirim({ username: "tidak-ada@contoh.test", password: "salah" });
  cek(r.status === 401, `akun karangan -> 401 (HTTP ${r.status})`);
  const d = await r.json();
  cek(d.error === "Username atau password salah.", "pesannya seragam, tidak membocorkan apa pun");
}
{
  const r = await kirim({ username: "magangIT@mustika-ratu.co.id", password: "apa-saja" });
  cek(r.status === 401, `username KEMBAR ditolak (HTTP ${r.status})`);
}
{
  const r = await kirim({ username: 123, password: true });
  cek(r.status === 400, `tipe salah -> 400 (HTTP ${r.status})`);
}

console.log("--- penolakan langkah 2 ---");
{
  const r = await kirim({ token: "bukan.token.apa-apa", idEmployee: target.idEmployee });
  cek(r.status === 401, `token ngawur -> 401 (HTTP ${r.status})`);
}
{
  const t = await tokenPilihProfil(idUsers, "uji@contoh.test");
  const r = await kirim({ token: t });
  cek(r.status === 400, `token tanpa idEmployee -> 400 (HTTP ${r.status})`);
}
{
  // ⚠️ Yang paling penting di sini: token sah, tapi idEmployee milik ORANG
  // LAIN. Kalau ini lolos, siapa pun yang punya satu token bisa masuk sebagai
  // karyawan mana pun.
  const t = await tokenPilihProfil(idUsers, "uji@contoh.test");
  const r = await kirim({ token: t, idEmployee: "11111111-2222-3333-4444-555555555555" });
  cek(r.status === 403, `idEmployee milik akun lain -> 403 (HTTP ${r.status})`);
}

console.log("--- ✅ JALUR SUKSES ---");
{
  const t = await tokenPilihProfil(idUsers, "uji-otomatis@contoh.test");
  const r = await kirim({ token: t, idEmployee: target.idEmployee });
  const d = await r.json();
  cek(r.ok, `login selesai (HTTP ${r.status})`, d.error ?? "");
  cek(d.selesai === true, "respons menandai selesai");
  cek(d.idEmployee === target.idEmployee, "idEmployee sesuai profil yang dipilih");
  cek(["marketing", "hr"].includes(d.departemen), `departemen dipetakan (${d.departemen})`);
  cek(d.admin === false, "TIDAK otomatis jadi admin");

  // Cookie sesi benar-benar dipasang, dan isinya benar.
  const kue = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("portal_sesi="));
  cek(!!kue, "cookie sesi dipasang");
  cek(!!kue && /HttpOnly/i.test(kue), "cookie HttpOnly");

  if (kue) {
    const token = kue.split(";")[0].split("=")[1];
    const kunci = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const { payload } = await jwtVerify(token, kunci, { algorithms: ["HS256"] });
    cek(payload.idEmployee === target.idEmployee, "token sesi membawa idEmployee");
    cek(payload.username === usernamePortal(target.idEmployee),
      "username sesi berbentuk mr:<id_employee>", String(payload.username));
    cek(payload.admin === false, "token sesi tidak memberi admin");
  }

  // Baris pengguna & audit benar-benar tertulis.
  const [p]: any = await root.query(
    "SELECT password_hash, sumber_akun, departemen, peran FROM pengguna WHERE id_employee = ?",
    [target.idEmployee]);
  cek(p.length === 1, "baris pengguna dibuat");
  cek(p[0]?.password_hash === null, "password_hash NULL — portal tidak menyimpan password perusahaan");
  cek(p[0]?.sumber_akun === "perusahaan", "sumber_akun = perusahaan");

  const [log]: any = await root.query(
    "SELECT username, jml_profil FROM login_perusahaan_log WHERE id_employee = ?",
    [target.idEmployee]);
  cek(log.length === 1, "pemilihan profil tercatat di audit");
  cek(log[0]?.username === "uji-otomatis@contoh.test", "audit menyimpan username yang dipakai");
}

console.log("--- login ulang tidak menggandakan ---");
{
  const t = await tokenPilihProfil(idUsers, "uji-otomatis@contoh.test");
  const r = await kirim({ token: t, idEmployee: target.idEmployee });
  cek(r.ok, "login kedua berhasil");
  const [p]: any = await root.query(
    "SELECT COUNT(*) c FROM pengguna WHERE id_employee = ?", [target.idEmployee]);
  cek(Number(p[0].c) === 1, "tetap SATU baris pengguna");
  const [log]: any = await root.query(
    "SELECT COUNT(*) c FROM login_perusahaan_log WHERE id_employee = ?", [target.idEmployee]);
  cek(Number(log[0].c) === 2, "tapi audit mencatat DUA kali masuk");
}

await bersihkan();
{
  const [p]: any = await root.query(
    "SELECT COUNT(*) c FROM pengguna WHERE id_employee = ?", [target.idEmployee]);
  cek(Number(p[0].c) === 0, "data uji dibersihkan");
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
console.log("\n⚠️ Yang TETAP tidak teruji: perbandingan bcrypt saat password BENAR.");
console.log("   Butuh satu kredensial karyawan yang sah, dan itu harus datang");
console.log("   dari pemilik akunnya sendiri.");
await root.end();
await pg.end();
process.exit(gagal.length === 0 ? 0 : 1);
