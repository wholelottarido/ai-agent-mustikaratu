/**
 * Memetakan akun portal -> karyawan di database perusahaan.
 *
 *   npm run petakan:karyawan                    lihat keadaan sekarang
 *   npm run petakan:karyawan -- hr2 MR-BDG1071  petakan hr2 ke NIK itu
 *   npm run petakan:karyawan -- hr2 "Nama Lengkap"
 *   npm run petakan:karyawan -- hr2 --lepas     batalkan pemetaan
 *
 * ⚠️ NAMA AKUN PORTAL TIDAK ADA DI TABEL KARYAWAN.
 *
 * Sudah diperiksa: "Agus Wijaya" (hr2) dan "Rina Kusuma" (hr1) tidak ada satu
 * pun di `employee`. Akun portal memang dibuat untuk pengujian, bukan cerminan
 * karyawan sungguhan. Jadi pemetaannya DIPILIH MANUAL, bukan ditebak otomatis
 * -- menebak di sini berarti satu orang melihat data orang lain.
 *
 * ⚠️ NAMA KARYAWAN TIDAK UNIK. Kalau pencarian menghasilkan lebih dari satu
 * orang, skrip MENOLAK dan menampilkan pilihannya beserta NIK. Sama seperti
 * aturan di `lib/entri/lembur.ts`.
 */
import mysql from "mysql2/promise";
import { Client } from "pg";

const arg = process.argv.slice(2);
const [username, kunci] = arg;

const portal = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.PORTAL_ADMIN_DB_USER, password: process.env.PORTAL_ADMIN_DB_PASSWORD,
  database: process.env.PORTAL_DB_NAME,
});

const pg = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER, password: process.env.DEMO_PG_PASSWORD,
  connectionTimeoutMillis: 15_000, statement_timeout: 30_000,
});
await pg.connect();

/** Tampilkan keadaan sekarang, lengkap dengan nama karyawannya. */
async function tampilkan() {
  const [akun]: any = await portal.query(
    "SELECT id, username, nama, departemen, peran, id_employee FROM pengguna ORDER BY id");

  const uuid = akun.map((a: any) => a.id_employee).filter(Boolean);
  const nama = new Map<string, string>();
  if (uuid.length) {
    const r = await pg.query(
      `SELECT k.id_employee::text AS id, k.fullname, k.nik,
              COALESCE(d.name,'-') AS departemen, COALESCE(p.positions,'-') AS jabatan
         FROM employee k
         LEFT JOIN department d ON d.id_department = k.id_department
         LEFT JOIN positions  p ON p.id_positions  = k.id_positions
        WHERE k.id_employee::text = ANY($1)`, [uuid]);
    for (const x of r.rows)
      nama.set(String(x.id), `${x.fullname} (${x.nik ?? "tanpa NIK"}) — ${x.departemen}, ${x.jabatan}`);
  }

  console.log("AKUN PORTAL".padEnd(14) + "PERAN".padEnd(20) + "KARYAWAN PERUSAHAAN");
  for (const a of akun) {
    const ket = a.id_employee
      ? (nama.get(String(a.id_employee)) ?? `⚠️ uuid ${a.id_employee} TIDAK ADA di database perusahaan`)
      : "(belum dipetakan)";
    console.log(String(a.username).padEnd(14) + `${a.departemen}/${a.peran}`.padEnd(20) + ket);
  }
  const belum = akun.filter((a: any) => !a.id_employee).length;
  if (belum) {
    console.log(`\n${belum} akun belum dipetakan. Selama belum, penyaring baris`);
    console.log("`diri`/`bawahan` TIDAK bisa diterapkan untuk akun itu.");
    console.log('\nContoh: npm run petakan:karyawan -- hr2 20160100');
  }
}

if (!username) {
  await tampilkan();
  await pg.end(); await portal.end(); process.exit(0);
}

const [cekAkun]: any = await portal.query(
  "SELECT id, username, nama FROM pengguna WHERE username = ? LIMIT 1", [username]);
if (!cekAkun.length) {
  console.log(`Akun "${username}" tidak ada di portal.`);
  await pg.end(); await portal.end(); process.exit(1);
}

if (kunci === "--lepas") {
  await portal.query("UPDATE pengguna SET id_employee = NULL WHERE username = ?", [username]);
  console.log(`${username}: pemetaan dilepas.\n`);
  await tampilkan();
  await pg.end(); await portal.end(); process.exit(0);
}

if (!kunci) {
  console.log("Sebutkan NIK atau nama karyawannya.");
  console.log(`  npm run petakan:karyawan -- ${username} <NIK atau nama lengkap>`);
  await pg.end(); await portal.end(); process.exit(1);
}

// Cocok PERSIS menang duluan: NIK, lalu nama yang sama persis, baru
// pencocokan sebagian. Pola yang sama dengan `cariKaryawan` di lembur.ts.
const cari = await pg.query(
  `SELECT k.id_employee::text AS id, k.fullname, k.nik, k.is_active,
          COALESCE(d.name,'-') AS departemen, COALESCE(p.positions,'-') AS jabatan
     FROM employee k
     LEFT JOIN department d ON d.id_department = k.id_department
     LEFT JOIN positions  p ON p.id_positions  = k.id_positions
    WHERE k.nik = $1 OR lower(k.fullname) = lower($1) OR k.fullname ILIKE $2
    ORDER BY (k.nik = $1) DESC, (lower(k.fullname) = lower($1)) DESC, k.fullname
    LIMIT 10`, [kunci, `%${kunci}%`]);

const persis = cari.rows.filter(
  (x) => String(x.nik) === kunci || String(x.fullname).toLowerCase() === kunci.toLowerCase());
const calon = persis.length > 0 ? persis : cari.rows;

if (calon.length === 0) {
  console.log(`Tidak ada karyawan dengan NIK atau nama "${kunci}".`);
  await pg.end(); await portal.end(); process.exit(1);
}
if (calon.length > 1) {
  // ⚠️ Menebak di sini berarti satu orang melihat data orang lain.
  console.log(`Ada ${calon.length} karyawan yang cocok dengan "${kunci}" — sebutkan NIK-nya:`);
  for (const x of calon)
    console.log(`  ${String(x.nik ?? "(tanpa NIK)").padEnd(12)} ${x.fullname} — ${x.departemen}, ${x.jabatan}`);
  await pg.end(); await portal.end(); process.exit(1);
}

const k = calon[0];
try {
  await portal.query("UPDATE pengguna SET id_employee = ? WHERE username = ?", [k.id, username]);
} catch (e: any) {
  if (e.code === "ER_DUP_ENTRY") {
    const [lain]: any = await portal.query(
      "SELECT username FROM pengguna WHERE id_employee = ? LIMIT 1", [k.id]);
    console.log(`${k.fullname} sudah dipetakan ke akun "${lain[0]?.username}".`);
    console.log("Satu karyawan cuma boleh satu akun — lepas dulu yang lama:");
    console.log(`  npm run petakan:karyawan -- ${lain[0]?.username} --lepas`);
    await pg.end(); await portal.end(); process.exit(1);
  }
  throw e;
}

console.log(`${username} -> ${k.fullname} (${k.nik ?? "tanpa NIK"}) — ${k.departemen}, ${k.jabatan}`);
if (!k.is_active) console.log("⚠️ Karyawan ini berstatus TIDAK AKTIF di database perusahaan.");
console.log();
await tampilkan();
await pg.end();
await portal.end();
process.exit(0);
