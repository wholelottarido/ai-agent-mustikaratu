/**
 * Cetak SQL untuk menautkan sebuah WhatsApp ke akun portal.
 *
 *   npm run wa:daftar -- <wa_id> <username> [nomor_wa]
 *   npm run wa:daftar -- 11111111111111@lid hr2 08xxxxxxxxxx
 *
 * ⚠️ SKRIP INI TIDAK MENULIS KE DATABASE -- dia cuma mencetak SQL, sama
 * seperti `buat-pengguna.mts`. Sengaja: aplikasi dan skripnya tidak pernah
 * memegang kredensial yang bisa menulis ke tabel akun. Yang menjalankan
 * SQL-nya Anda, pakai root.
 *
 * `wa_id` didapat dari log bot: kirim pesan ke bot, lalu lihat baris
 * `[tidak terdaftar] <wa_id> ...` di terminal.
 */
import mysql from "mysql2/promise";

function keluar(pesan: string): never {
  console.error(pesan);
  process.exit(1);
}

const [waId, username, nomorWa] = process.argv.slice(2);

if (!waId || !username) {
  keluar(
    "Pemakaian: npm run wa:daftar -- <wa_id> <username> [nomor_wa]\n" +
      "Contoh   : npm run wa:daftar -- 11111111111111@lid hr2 08xxxxxxxxxx\n\n" +
      "wa_id diambil dari log bot waktu nomor itu mengirim pesan.",
  );
}

// Bentuknya diperiksa di sini, bukan dibiarkan sampai ke SQL. Salah ketik
// wa_id menghasilkan baris yang tidak pernah cocok dengan siapa pun, dan
// gejalanya membingungkan: bot diam saja tanpa error.
if (!/@(lid|s\.whatsapp\.net)$/.test(waId)) {
  keluar(
    `wa_id "${waId}" tidak berakhiran @lid atau @s.whatsapp.net.\n` +
      "Salin persis seperti yang tercetak di log bot.",
  );
}

const { PORTAL_DB_USER, PORTAL_DB_PASSWORD, PORTAL_DB_NAME, MYSQL_HOST, MYSQL_PORT } = process.env;
if (!PORTAL_DB_USER) keluar("PORTAL_DB_USER belum diisi di .env.local");

const c = await mysql.createConnection({
  host: MYSQL_HOST ?? "localhost",
  port: Number(MYSQL_PORT ?? 3306),
  user: PORTAL_DB_USER,
  password: PORTAL_DB_PASSWORD,
  database: PORTAL_DB_NAME ?? "portal",
});

// Username dicek ke database supaya salah ketik ketahuan SEKARANG, bukan
// setelah SQL-nya dijalankan dan gagal foreign key.
const [baris] = await c.query<mysql.RowDataPacket[]>(
  "SELECT id, nama, departemen, peran, aktif FROM pengguna WHERE username = ?",
  [username],
);
const p = baris[0];

if (!p) {
  const [semua] = await c.query<mysql.RowDataPacket[]>("SELECT username FROM pengguna ORDER BY id");
  await c.end();
  keluar(
    `Username "${username}" tidak ada.\n` +
      `Yang terdaftar: ${semua.map((x) => x.username).join(", ")}`,
  );
}

const [sudah] = await c.query<mysql.RowDataPacket[]>(
  "SELECT wa_id FROM wa_tautan WHERE pengguna_id = ?",
  [p.id],
);
await c.end();

const nomor = nomorWa ? `'${nomorWa.replace(/'/g, "''")}'` : "NULL";

console.log(`Akun   : ${p.nama} (${username}) — ${p.departemen} ${p.peran}${p.aktif ? "" : "  ⚠️ TIDAK AKTIF"}`);
console.log(`WhatsApp: ${waId}${nomorWa ? `  (${nomorWa})` : ""}`);

if (sudah.length) {
  console.log(
    `\n⚠️ Akun ini SUDAH tertaut ke ${sudah[0].wa_id}.\n` +
      "   Satu akun cuma boleh satu WhatsApp, jadi SQL di bawah akan\n" +
      "   MENGGANTI tautan lama. Yang lama langsung kehilangan akses.",
  );
}

console.log("\nJalankan sebagai root:\n");
console.log("```sql");
if (sudah.length) console.log(`DELETE FROM wa_tautan WHERE pengguna_id = ${p.id};`);
console.log(
  `INSERT INTO wa_tautan (wa_id, pengguna_id, nomor_wa)\n` +
    `VALUES ('${waId.replace(/'/g, "''")}', ${p.id}, ${nomor});`,
);
console.log("```");
console.log("\nmysql -u root -p portal");
console.log("\nSetelah itu restart bot (Ctrl+C lalu `npm run wa`).");
