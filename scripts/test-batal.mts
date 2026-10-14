/**
 * Tes pembatalan penjualan (Tahap 3b).
 *
 * Menguji `lib/entri/batal.ts` langsung, tanpa lewat HTTP. Jalur HTTP-nya diuji
 * terpisah setelah `/api/entri/batal` ada.
 *
 * PRASYARAT: `db/07_batal.sql` sudah dijalankan sebagai root.
 *
 * Butuh akses root MySQL untuk dua hal yang TIDAK boleh bisa dilakukan
 * aplikasi: memundurkan `entri_log.dibuat` (menguji batas 2 jam tanpa menunggu
 * 2 jam) dan membersihkan data uji.
 */
import mysql from "mysql2/promise";
import { simpanPenjualan, sidikDraf, type KonteksEntri } from "../lib/entri/simpan.ts";
import { susunDraf } from "../lib/entri/penjualan.ts";
import { batalkanPenjualan, susunDrafBatal, MENIT_BATAL } from "../lib/entri/batal.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PELANGGAN = "UD Sentosa Bekasi";
const PRODUK = "Masker Beras 100g";

/** Penanda di jejak audit supaya data uji bisa dikenali lagi nanti. */
const PENANDA = "uji pembatalan";

const ANDI: KonteksEntri = {
  penggunaId: 101, username: "marketing1", departemen: "marketing",
  peran: "staf", asal: "web", permintaan: PENANDA,
};
/** Orang lain — id berbeda, itu yang menentukan kepemilikan. */
const BUDI: KonteksEntri = { ...ANDI, penggunaId: 202, username: "marketing2" };

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.MARKETING_DB_NAME,
});

const dibuat: number[] = [];

/**
 * Bersihkan sisa run SEBELUMNYA yang terputus.
 *
 * Tes ini bikin order sungguhan. Kalau prosesnya dimatikan di tengah (Ctrl+C,
 * timeout, kill), pembersihan di akhir tidak pernah jalan dan ordernya nyangkut
 * dengan status COMPLETED -- ikut terhitung omzet, diam-diam. Itu sudah pernah
 * terjadi dua kali dan baru ketahuan belakangan.
 */
async function bersihkanSisa() {
  const [sisa]: any = await root.query(
    `SELECT DISTINCT ref_id FROM entri_log WHERE entitas='sales_order' AND permintaan=?`,
    [PENANDA]);
  if (!sisa.length) return;
  for (const { ref_id } of sisa) {
    await root.query("DELETE FROM sales_order_line WHERE order_id=?", [ref_id]);
    await root.query("DELETE FROM sales_order WHERE id=?", [ref_id]);
    await root.query("DELETE FROM entri_log WHERE ref_id=?", [ref_id]);
  }
  console.log(`⚠️  ${sisa.length} order sisa run sebelumnya dibersihkan dulu
`);
}
await bersihkanSisa();

/** Bikin satu order baru atas nama `ctx`. */
async function buatOrder(ctx: KonteksEntri) {
  const permintaan = { pelanggan: PELANGGAN, barang: [{ produk: PRODUK, qty: 2 }] };
  const draf = await susunDraf("marketing", "staf", permintaan);
  if (!draf.ok) throw new Error("draf gagal disusun");
  const h = await simpanPenjualan(permintaan, sidikDraf(draf.draf), ctx);
  if (!h.ok) throw new Error(`simpan gagal: ${h.pesan}`);
  dibuat.push(h.orderId);
  return h;
}

const statusOrder = async (id: number) => {
  const [r]: any = await root.query("SELECT status FROM sales_order WHERE id=?", [id]);
  return r[0]?.status;
};

console.log("--- alasan wajib ---");
{
  const o = await buatOrder(ANDI);
  for (const [label, alasan] of [["kosong", ""], ["spasi saja", "   "], ["terlalu pendek", "a"]] as const) {
    const h = await batalkanPenjualan(o.noOrder, alasan, ANDI);
    cek(!h.ok && h.sebab === "alasan-kurang", `alasan ${label} ditolak`, !h.ok ? h.sebab : "MALAH LOLOS");
  }
  cek((await statusOrder(o.orderId)) !== "CANCELLED", "order belum berubah setelah alasan ditolak");
}

console.log("--- kepemilikan ---");
{
  const o = await buatOrder(ANDI);
  const h = await batalkanPenjualan(o.noOrder, "salah pelanggan", BUDI);
  cek(!h.ok && h.sebab === "bukan-milik-anda", "orang lain tidak bisa membatalkan", !h.ok ? h.sebab : "MALAH LOLOS");
  cek((await statusOrder(o.orderId)) !== "CANCELLED", "order tetap utuh");

  const d = await susunDrafBatal(o.noOrder, BUDI);
  cek(!d.ok && d.sebab === "bukan-milik-anda", "draf pun ditolak untuk orang lain");
}

console.log("--- order yang tidak ada / bukan lewat aplikasi ---");
{
  const h = await batalkanPenjualan("SO-9999-99999", "coba-coba", ANDI);
  cek(!h.ok && h.sebab === "tidak-ketemu", "nomor order karangan ditolak", !h.ok ? h.sebab : "MALAH LOLOS");

  // Order seed: ada di sales_order tapi tidak punya baris entri_log.
  const [seed]: any = await root.query(
    `SELECT o.no_order FROM sales_order o
      LEFT JOIN entri_log l ON l.entitas='sales_order' AND l.ref_id=o.id
      WHERE l.id IS NULL AND o.status='COMPLETED' LIMIT 1`);
  const noSeed = seed[0]?.no_order;
  const h2 = await batalkanPenjualan(noSeed, "mau hapus data lama", ANDI);
  cek(!h2.ok && h2.sebab === "bukan-lewat-aplikasi",
    `order seed ${noSeed} ditolak`, !h2.ok ? h2.sebab : "MALAH LOLOS");
}

console.log("--- batas 2 jam ---");
{
  const o = await buatOrder(ANDI);
  // Dimundurkan lewat root: aplikasi sendiri TIDAK bisa UPDATE entri_log.
  await root.query(
    "UPDATE entri_log SET dibuat = dibuat - INTERVAL ? MINUTE WHERE ref_id=? AND aksi='ENTRI'",
    [MENIT_BATAL + 5, o.orderId]);
  const h = await batalkanPenjualan(o.noOrder, "telat sadar salah", ANDI);
  cek(!h.ok && h.sebab === "kedaluwarsa", "lewat 2 jam ditolak", !h.ok ? h.sebab : "MALAH LOLOS");
  cek((await statusOrder(o.orderId)) !== "CANCELLED", "order tetap COMPLETED setelah kedaluwarsa");

  // Tepat di batas juga harus ditolak (>=, bukan >).
  const o2 = await buatOrder(ANDI);
  await root.query(
    "UPDATE entri_log SET dibuat = dibuat - INTERVAL ? MINUTE WHERE ref_id=? AND aksi='ENTRI'",
    [MENIT_BATAL, o2.orderId]);
  const h2 = await batalkanPenjualan(o2.noOrder, "pas di batas", ANDI);
  cek(!h2.ok && h2.sebab === "kedaluwarsa", `tepat ${MENIT_BATAL} menit ditolak`);
}

console.log("--- jalur lancar ---");
{
  const o = await buatOrder(ANDI);

  const [seb]: any = await root.query(
    "SELECT COUNT(*) c FROM v_penjualan WHERE no_order=?", [o.noOrder]);
  cek(Number(seb[0].c) > 0, "sebelum dibatalkan: muncul di v_penjualan");

  const d = await susunDrafBatal(o.noOrder, ANDI);
  cek(d.ok, "draf pembatalan tersusun");
  if (d.ok) {
    cek(d.order.noOrder === o.noOrder && d.order.pelanggan === PELANGGAN, "isi draf benar");
    cek(d.order.sisaMenit > 0 && d.order.sisaMenit <= MENIT_BATAL, `sisa waktu wajar (${d.order.sisaMenit} menit)`);
    cek((await statusOrder(o.orderId)) === "COMPLETED", "menyusun draf TIDAK mengubah apa pun");
  }

  const h = await batalkanPenjualan(o.noOrder, "salah pelanggan, harusnya CV Makmur", ANDI);
  cek(h.ok, "pembatalan berhasil", h.ok ? h.noOrder : h.pesan);
  cek((await statusOrder(o.orderId)) === "CANCELLED", "status jadi CANCELLED");

  const [ses]: any = await root.query(
    "SELECT COUNT(*) c FROM v_penjualan WHERE no_order=?", [o.noOrder]);
  cek(Number(ses[0].c) === 0, "sesudah dibatalkan: HILANG dari v_penjualan");

  const [log]: any = await root.query(
    "SELECT aksi, alasan, username FROM entri_log WHERE ref_id=? ORDER BY id", [o.orderId]);
  cek(log.length === 2, `jejak berpasangan (${log.map((x: any) => x.aksi).join(" → ")})`);
  cek(log[0]?.aksi === "ENTRI" && log[1]?.aksi === "BATAL", "urutan ENTRI lalu BATAL");
  cek(log[1]?.alasan === "salah pelanggan, harusnya CV Makmur", "alasan tersimpan apa adanya");

  const [baris]: any = await root.query(
    "SELECT COUNT(*) c FROM sales_order_line WHERE order_id=?", [o.orderId]);
  cek(Number(baris[0].c) === 1, "baris barang TIDAK dihapus, cuma statusnya berubah");

  const h2 = await batalkanPenjualan(o.noOrder, "mau batalkan lagi", ANDI);
  cek(!h2.ok && h2.sebab === "sudah-dibatalkan", "pembatalan kedua ditolak", !h2.ok ? h2.sebab : "MALAH LOLOS");

  const [log2]: any = await root.query("SELECT COUNT(*) c FROM entri_log WHERE ref_id=?", [o.orderId]);
  cek(Number(log2[0].c) === 2, "tidak ada jejak dobel dari percobaan kedua");
}

console.log("--- bersih-bersih ---");
for (const id of dibuat) {
  await root.query("DELETE FROM sales_order_line WHERE order_id=?", [id]);
  await root.query("DELETE FROM sales_order WHERE id=?", [id]);
  await root.query("DELETE FROM entri_log WHERE ref_id=?", [id]);
}
console.log(`${dibuat.length} order uji dihapus`);

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);

await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
