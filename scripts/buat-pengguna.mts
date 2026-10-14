/**
 * Bikin pernyataan SQL untuk menambah akun portal.
 *
 * Password di-hash di sini, jadi yang masuk ke berkas SQL cuma hash-nya --
 * password polos tidak pernah tersimpan di mana pun.
 *
 * Satu akun:
 *   npm run buat:pengguna -- marketing1 marketing1 "Budi Marketing" marketing staf
 *
 * Akun contoh (tulis db/portal/02_seed_pengguna.sql):
 *   npm run buat:pengguna -- --seed
 */
import { writeFileSync } from "node:fs";
import { hashPassword } from "../lib/password.ts";

type Akun = {
  username: string;
  password: string;
  nama: string;
  departemen: string;
  peran: string;
};

/** Akun contoh untuk mencoba portal. Password sengaja sama dengan username. */
const CONTOH: Akun[] = [
  { username: "marketing1", password: "marketing1", nama: "Budi Santoso", departemen: "marketing", peran: "staf" },
  { username: "marketing2", password: "marketing2", nama: "Sari Dewi", departemen: "marketing", peran: "kepala" },
  { username: "hr1", password: "hr1", nama: "Rina Kusuma", departemen: "hr", peran: "staf" },
  { username: "hr2", password: "hr2", nama: "Agus Wijaya", departemen: "hr", peran: "kepala" },
];

const q = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";

async function baris(a: Akun): Promise<string> {
  const hash = await hashPassword(a.password);
  return (
    `INSERT INTO pengguna (username, password_hash, nama, departemen, peran)\n` +
    `  VALUES (${q(a.username)}, ${q(hash)}, ${q(a.nama)}, ${q(a.departemen)}, ${q(a.peran)})\n` +
    `  ON DUPLICATE KEY UPDATE\n` +
    `    password_hash = VALUES(password_hash), nama = VALUES(nama),\n` +
    `    departemen = VALUES(departemen), peran = VALUES(peran), aktif = 1;`
  );
}

const arg = process.argv.slice(2);

if (arg[0] === "--seed") {
  const isi = [
    "-- ============================================================",
    "-- Akun contoh untuk mencoba portal.",
    "-- ============================================================",
    "-- DI-GENERATE oleh scripts/buat-pengguna.mts -- jangan edit manual.",
    "--",
    "-- Jalankan sebagai root:",
    '--   mysql -u root -p portal -e "source db/portal/02_seed_pengguna.sql"',
    "--",
    "-- Password sama dengan username (marketing1 / marketing1). Ini AKUN COBA-COBA;",
    "-- kalau nanti dipakai sungguhan, ganti dulu lewat:",
    "--   npm run buat:pengguna -- <username> <password> <nama> <departemen> <peran>",
    "-- ============================================================",
    "",
    "USE portal;",
    "",
  ];

  for (const a of CONTOH) {
    isi.push(`-- ${a.username} / ${a.password}  (${a.departemen}, ${a.peran})`);
    isi.push(await baris(a));
    isi.push("");
  }
  isi.push("SELECT id, username, nama, departemen, peran, aktif FROM pengguna ORDER BY id;");
  isi.push("");

  writeFileSync("db/portal/02_seed_pengguna.sql", isi.join("\n"), "utf8");
  console.log("OK -> db/portal/02_seed_pengguna.sql");
  console.log(`     ${CONTOH.length} akun: ${CONTOH.map((a) => a.username).join(", ")}`);
} else if (arg.length >= 4) {
  const [username, password, nama, departemen, peran = "staf"] = arg;
  console.log(await baris({ username, password, nama, departemen, peran }));
} else {
  console.error(
    "Cara pakai:\n" +
      "  npm run buat:pengguna -- <username> <password> <nama> <departemen> [peran]\n" +
      "  npm run buat:pengguna -- --seed\n\n" +
      "Contoh:\n" +
      '  npm run buat:pengguna -- hr3 rahasia123 "Dewi Lestari" hr staf',
  );
  process.exit(1);
}
