/**
 * Menguji PERSIS apa yang dilakukan tombol Simpan: login -> POST endpoint.
 *
 * Bedanya dengan `test:simpan`: yang itu memanggil `simpanPenjualan()`
 * langsung, jadi pemeriksaan sesi dan `bolehEntri` di route-nya TIDAK ikut
 * teruji. Di sini semuanya lewat HTTP dengan cookie sesi asli.
 *
 * PRASYARAT: server harus hidup di port 3018 (`npm run deploy` atau
 * `npm start`). Tanpa itu tesnya gagal di fetch pertama dengan
 * `ECONNREFUSED`, yang tidak menunjuk ke penyebabnya.
 *
 * Pembersihan butuh akses root MySQL. Kalau root tidak bisa dipakai, skrip
 * MEMBERI TAHU nomor order yang nyangkut -- jangan diabaikan, itu ikut
 * terhitung sebagai omzet karena statusnya COMPLETED.
 */
import mysql from "mysql2/promise";
import { susunDraf } from "../lib/entri/penjualan.ts";
import { sidikDraf } from "../lib/entri/simpan.ts";

const BASE = "http://localhost:3018";
const lolos: string[] = [], gagal: string[] = [];
const cek = (ok: boolean, nama: string) => (ok ? lolos : gagal).push(nama);

const rLogin = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "marketing1", password: "marketing1" }),
  redirect: "manual",
});
const cookie = (rLogin.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
cek(rLogin.ok, `login marketing1 (HTTP ${rLogin.status})`);
cek(cookie !== "", "dapat cookie sesi");
if (!cookie) { console.log("GAGAL login:", await rLogin.text()); process.exit(1); }

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MARKETING_DB_USER, password: process.env.MARKETING_DB_PASSWORD,
  database: process.env.MARKETING_DB_NAME,
});
const jumlah = async () =>
  Number((([rows]: any) => rows[0].c)(await db.query("SELECT COUNT(*) c FROM sales_order")));
const sebelum = await jumlah();

// Draf yang sama seperti punya user
const permintaan = { pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "Masker Beras 100g", qty: 4 }] };
const hasil = await susunDraf("marketing", "staf", permintaan);
if (!hasil.ok) { console.log("draf gagal disusun:", hasil.masalah); process.exit(1); }
const sidik = sidikDraf(hasil.draf);
console.log(`draf: ${hasil.draf.pelanggan.nama} · Rp ${hasil.draf.total.toLocaleString("id-ID")} · sidik ${sidik}`);

const kirim = (body: unknown) =>
  fetch(`${BASE}/api/entri/penjualan`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });

// A. Sidik palsu harus ditolak
const rPalsu = await kirim({ ...permintaan, sidik: "0".repeat(16), permintaan: "uji" });
cek(rPalsu.status === 409 || rPalsu.status === 400, `sidik palsu ditolak (HTTP ${rPalsu.status})`);
cek((await jumlah()) === sebelum, "sidik palsu: tidak ada yang tersimpan");

// B. Tanpa cookie harus ditolak
const rAnon = await fetch(`${BASE}/api/entri/penjualan`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...permintaan, sidik, permintaan: "uji" }),
});
cek(rAnon.status === 401 || rAnon.status === 403, `tanpa login ditolak (HTTP ${rAnon.status})`);

// C. Jalur benar -- inilah yang terjadi saat tombol ditekan
const rOk = await kirim({ ...permintaan, sidik, permintaan: "catat penjualan 4 Masker Beras 100g ke UD Sentosa Bekasi" });
const dOk = await rOk.json();
cek(rOk.ok, `tombol Simpan berhasil (HTTP ${rOk.status})`);
cek(typeof dOk.noOrder === "string" && /^SO-\d{4}-\d{5}$/.test(dOk.noOrder ?? ""), `nomor order: ${dOk.noOrder}`);
cek((await jumlah()) === sebelum + 1, "jumlah order bertambah 1");

if (dOk.orderId) {
  const [baris]: any = await db.query(
    "SELECT qty, harga, subtotal FROM sales_order_line WHERE order_id=?", [dOk.orderId]);
  cek(baris.length === 1 && Number(baris[0].qty) === 4, "baris barang tersimpan (qty 4)");
  cek(baris.length === 1 && Number(baris[0].harga) === 25000, `harga dari database (Rp ${Number(baris[0]?.harga).toLocaleString("id-ID")})`);

  const [audit]: any = await db.query(
    "SELECT username, asal, permintaan FROM entri_log WHERE ref_kode=?", [dOk.noOrder]);
  cek(audit.length === 1 && audit[0].username === "marketing1" && audit[0].asal === "web",
    `audit: ${audit[0]?.username} / ${audit[0]?.asal}`);

  // Bersihkan
  const admin = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: "root", password: "", database: process.env.MARKETING_DB_NAME,
  }).catch(() => null);
  if (admin) {
    await admin.query("DELETE FROM sales_order_line WHERE order_id=?", [dOk.orderId]);
    await admin.query("DELETE FROM sales_order WHERE id=?", [dOk.orderId]);
    await admin.query("DELETE FROM entri_log WHERE ref_kode=?", [dOk.noOrder]);
    await admin.end();
    cek((await jumlah()) === sebelum, "dibersihkan, kembali ke jumlah semula");
  } else {
    console.log(`\n⚠️ TIDAK BISA DIBERSIHKAN -- ${dOk.noOrder} masih ada di database.`);
  }
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await db.end();
// Pool di lib/entri/penjualan.ts tetap terbuka -- tanpa ini prosesnya
// menggantung dan output tidak pernah kelihatan.
process.exit(gagal.length === 0 ? 0 : 1);
