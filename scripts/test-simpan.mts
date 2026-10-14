/**
 * Uji jalur TULIS entri penjualan. `npm run test:simpan`
 *
 * ⚠️ Benar-benar menulis ke database `marketing`, lalu MEMBERSIHKANNYA
 * memakai root (mkt_entry sengaja tidak bisa DELETE).
 *
 * Yang paling penting bukan jalur lancarnya, tapi percobaan memalsukan:
 * kalau klien bisa menentukan harga sendiri, seluruh rancangan "AI mengisi
 * formulir" jadi tidak ada artinya.
 */
import { execSync } from "node:child_process";
import mysql from "mysql2/promise";
import { susunDraf } from "../lib/entri/penjualan.ts";
import { simpanPenjualan, sidikDraf } from "../lib/entri/simpan.ts";

let lolos = 0, gagal = 0;
const cek = (n: string, ok: boolean, k = "") => {
  if (ok) { lolos++; console.log(`  LOLOS  ${n}`); }
  else { gagal++; console.log(`  GAGAL  ${n}${k ? " — " + k : ""}`); }
};

const CTX = {
  penggunaId: 1, username: "marketing1", departemen: "marketing",
  peran: "staf", asal: "web" as const, permintaan: "uji otomatis",
};
const MINTA = { pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "Masker Beras 100g", qty: 4 }] };

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MARKETING_DB_USER, password: process.env.MARKETING_DB_PASSWORD,
  database: process.env.MARKETING_DB_NAME ?? "marketing",
});
const hitung = async () => {
  const [r] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM sales_order");
  return Number(r[0].n);
};

const sebelum = await hitung();
const draf = await susunDraf("marketing", "staf", MINTA);
if (!draf.ok) { console.log("  tidak bisa menyusun draf"); process.exit(1); }
const sidik = sidikDraf(draf.draf);

console.log("--- percobaan memalsukan ---");
const palsu = await simpanPenjualan(MINTA, "sidikpalsu123456", CTX);
cek("sidik salah -> DITOLAK", !palsu.ok && palsu.sebab === "draf-berubah", JSON.stringify(palsu).slice(0, 90));
cek("tidak ada yang tersimpan", (await hitung()) === sebelum);

const ubahHarga = { ...draf.draf, baris: [{ ...draf.draf.baris[0], harga: 1 }] };
cek("mengubah harga mengubah sidik", sidikDraf(ubahHarga) !== sidik);
cek("mengubah qty mengubah sidik",
  sidikDraf({ ...draf.draf, baris: [{ ...draf.draf.baris[0], qty: 999 }] }) !== sidik);

console.log("--- masukan tidak sah tetap ditolak di jalur tulis ---");
const nol = await simpanPenjualan({ ...MINTA, barang: [{ produk: "Masker Beras 100g", qty: 0 }] }, sidik, CTX);
cek("qty 0 -> ditolak", !nol.ok && nol.sebab === "tidak-sah");
cek("tetap tidak ada yang tersimpan", (await hitung()) === sebelum);

console.log("--- jalur lancar ---");
const simpan = await simpanPenjualan(MINTA, sidik, CTX);
cek("tersimpan", simpan.ok, JSON.stringify(simpan).slice(0, 110));

if (simpan.ok) {
  cek("jumlah order bertambah 1", (await hitung()) === sebelum + 1);
  cek("nomor order berformat benar", /^SO-\d{4}-\d{5}$/.test(simpan.noOrder), simpan.noOrder);

  const [baris] = await c.query<mysql.RowDataPacket[]>(
    "SELECT qty, harga, subtotal FROM sales_order_line WHERE order_id = ?", [simpan.orderId]);
  cek("baris barang ikut tersimpan", baris.length === 1);
  cek("harga DARI DATABASE, bukan dari klien", Number(baris[0]?.harga) === 25000, String(baris[0]?.harga));
  cek("subtotal benar", Number(baris[0]?.subtotal) === 100000, String(baris[0]?.subtotal));

  const [log] = await c.query<mysql.RowDataPacket[]>(
    "SELECT username, asal, peran, ref_kode FROM entri_log WHERE ref_id = ?", [simpan.orderId]);
  cek("jejak audit tercatat", log.length === 1);
  cek("audit memuat siapa & dari mana",
    log[0]?.username === "marketing1" && log[0]?.asal === "web" && log[0]?.ref_kode === simpan.noOrder);

  execSync(`mysql -u root marketing -e "DELETE FROM sales_order_line WHERE order_id=${simpan.orderId}; DELETE FROM entri_log WHERE ref_id=${simpan.orderId}; DELETE FROM sales_order WHERE id=${simpan.orderId}"`);
  cek("dibersihkan, kembali ke jumlah semula", (await hitung()) === sebelum);
}

await c.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
