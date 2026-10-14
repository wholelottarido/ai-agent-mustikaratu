/**
 * Uji batas wewenang persetujuan. `npm run test:persetujuan`
 *
 * Pertanyaan yang dijawab: bisakah kepala satu departemen memberi akses ke
 * departemen lain? Kalau bisa, seluruh pemisahan yang diuji di
 * `test:wa-isolasi` jebol lewat satu dropdown -- kepala marketing tinggal
 * mengangkat orang jadi kepala HR, dan orang itu dapat payroll.
 *
 * Memanggil fungsinya LANGSUNG, bukan lewat HTTP: yang diuji penegakan di
 * server, bukan apakah tombolnya disembunyikan di halaman.
 */
import { execSync } from "node:child_process";
import { hakPersetujuan, daftarPengajuan, setujui, tolak } from "../lib/admin.ts";
import mysql from "mysql2/promise";

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.PORTAL_ADMIN_DB_USER, password: process.env.PORTAL_ADMIN_DB_PASSWORD,
  database: process.env.PORTAL_DB_NAME,
});

const sql = (q: string) => execSync(`mysql -u root portal -e "${q}"`);
const bersihkan = () => {
  sql("DELETE FROM pengguna WHERE username LIKE 'uji.%'");
  sql("DELETE FROM pendaftaran WHERE username LIKE 'uji.%'");
};
bersihkan();

let lolos = 0, gagal = 0;
const cek = (n: string, ok: boolean, k = "") => {
  if (ok) { lolos++; console.log(`  LOLOS  ${n}`); }
  else { gagal++; console.log(`  GAGAL  ${n}${k ? " — " + k : ""}`); }
};

const id = async (u: string) => {
  const [r] = await c.query<mysql.RowDataPacket[]>("SELECT id FROM pengguna WHERE username=?", [u]);
  return r[0].id as number;
};
const idAjuan = async (u: string) => {
  const [r] = await c.query<mysql.RowDataPacket[]>("SELECT id FROM pendaftaran WHERE username=?", [u]);
  return r[0]?.id as number;
};

const MKT = await id("marketing2");  // kepala marketing
const HR = await id("hr2");          // kepala HR + admin
const STAF = await id("hr1");        // staf

console.log("\n--- cakupan wewenang ---");
const hMkt = await hakPersetujuan(MKT);
cek("kepala marketing -> cakupan 'marketing'", hMkt.boleh && hMkt.cakupan === "marketing", JSON.stringify(hMkt));
const hHr = await hakPersetujuan(HR);
cek("admin -> cakupan null (semua)", hHr.boleh && hHr.cakupan === null, JSON.stringify(hHr));
const hStaf = await hakPersetujuan(STAF);
cek("staf -> TIDAK boleh sama sekali", hStaf.boleh === false, JSON.stringify(hStaf));

sql("INSERT INTO pendaftaran (username,password_hash,nama,departemen_diminta,ip) VALUES ('uji.mkt','scrypt:a:b','Uji Mkt','marketing','1.1.1.1'),('uji.hr','scrypt:c:d','Uji HR','hr','1.1.1.2')");
const AJU_MKT = await idAjuan("uji.mkt");
const AJU_HR = await idAjuan("uji.hr");

console.log("\n--- apa yang terlihat ---");
const lihatMkt = (await daftarPengajuan("menunggu", "marketing")).map((p) => p.username);
cek("kepala marketing cuma lihat pengajuan marketing",
    lihatMkt.includes("uji.mkt") && !lihatMkt.includes("uji.hr"), lihatMkt.join(","));
const lihatAdmin = (await daftarPengajuan("menunggu", null)).map((p) => p.username);
cek("admin lihat semuanya", lihatAdmin.includes("uji.mkt") && lihatAdmin.includes("uji.hr"));

console.log("\n--- percobaan menembus ---");
const s1 = await setujui(AJU_HR, MKT, "hr", "kepala", "marketing");
cek("kepala marketing angkat KEPALA HR -> DITOLAK", s1.ok === false, JSON.stringify(s1));

const s2 = await setujui(AJU_MKT, MKT, "hr", "staf", "marketing");
cek("pendaftar marketing dipaksa ke HR -> DITOLAK", s2.ok === false, JSON.stringify(s2));

const t1 = await tolak(AJU_HR, MKT, "iseng", "marketing");
cek("kepala marketing tolak pengajuan HR -> DITOLAK", t1.ok === false, JSON.stringify(t1));

console.log("\n--- yang memang boleh ---");
const s3 = await setujui(AJU_MKT, MKT, "marketing", "staf", "marketing");
cek("kepala marketing setujui pendaftar marketing -> BOLEH", s3.ok === true, JSON.stringify(s3));

const s4 = await setujui(AJU_HR, HR, "hr", "kepala", null);
cek("admin setujui lintas departemen -> BOLEH", s4.ok === true, JSON.stringify(s4));

const [hasil] = await c.query<mysql.RowDataPacket[]>(
  "SELECT username, departemen, peran FROM pengguna WHERE username LIKE 'uji.%' ORDER BY username");
cek("akun terbentuk dengan departemen yang benar",
    hasil.length === 2 && hasil[0].departemen === "hr" && hasil[1].departemen === "marketing",
    JSON.stringify(hasil));

await c.end();
bersihkan();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
