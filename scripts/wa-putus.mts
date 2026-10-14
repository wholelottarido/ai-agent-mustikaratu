/**
 * Cetak SQL untuk MEMUTUS tautan WhatsApp sebuah akun.
 *
 *   npm run wa:putus -- <username>
 *
 * Kenapa lewat admin, bukan tombol di halaman user: kalau user bisa memutus
 * sendiri, orang yang sedang memegang HP-nya juga bisa — lalu menautkan
 * perangkatnya sendiri, dan batas "satu akun satu WhatsApp" jadi tidak berarti.
 *
 * ⚠️ KALAU HP HILANG, INI BUKAN JALAN TERCEPAT.
 * Menonaktifkan akunnya (`UPDATE pengguna SET aktif = 0`) LANGSUNG memutus
 * akses WhatsApp juga, karena `cariIdentitas()` memeriksa kolom itu. Perintah
 * di bawah baru dipakai kalau orangnya memang mau menautkan HP baru.
 *
 * Seperti `wa-daftar.mts`, skrip ini TIDAK menulis ke database — dia cuma
 * mencetak SQL. Aplikasi dan skripnya tidak pernah memegang kredensial yang
 * bisa menghapus tautan.
 */
import mysql from "mysql2/promise";

const username = process.argv[2];
if (!username) {
  console.error("Pemakaian: npm run wa:putus -- <username>");
  process.exit(1);
}

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "localhost",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.PORTAL_DB_USER,
  password: process.env.PORTAL_DB_PASSWORD,
  database: process.env.PORTAL_DB_NAME ?? "portal",
});

const [baris] = await c.query<mysql.RowDataPacket[]>(
  `SELECT p.id, p.nama, p.departemen, p.peran, t.wa_id, t.nomor_wa, t.ditautkan
     FROM pengguna p
     LEFT JOIN wa_tautan t ON t.pengguna_id = p.id
    WHERE p.username = ?`,
  [username],
);
await c.end();

const p = baris[0];
if (!p) {
  console.error(`Username "${username}" tidak ada.`);
  process.exit(1);
}
if (!p.wa_id) {
  console.log(`${p.nama} (${username}) belum punya WhatsApp tertaut.`);
  process.exit(0);
}

console.log(`Akun    : ${p.nama} (${username}) — ${p.departemen} ${p.peran}`);
console.log(`WhatsApp: ${p.wa_id}${p.nomor_wa ? `  (${p.nomor_wa})` : ""}`);
console.log(`Tertaut : ${new Date(p.ditautkan as string).toLocaleString("id-ID")}`);
console.log("\nJalankan sebagai root:\n");
console.log("```sql");
console.log(`DELETE FROM wa_tautan WHERE pengguna_id = ${p.id};`);
console.log("```");
console.log("\nmysql -u root -p portal");
console.log("\nSetelah itu dia bisa membuat kode baru sendiri di halaman /whatsapp.");
