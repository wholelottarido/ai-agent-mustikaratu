/**
 * Tes jalur HTTP pembatalan (Tahap 3c).
 *
 * Menguji apa yang PERSIS terjadi saat tombol Batalkan ditekan: login, lalu
 * POST ke `/api/entri/batal` dengan cookie sesi asli.
 *
 * Bedanya dengan `test:batal`: yang itu memanggil `batalkanPenjualan()`
 * langsung, jadi pemeriksaan sesi dan `bolehEntri` di route-nya TIDAK teruji.
 * Yang paling penting di sini: identitas diambil dari SESI, bukan dari body --
 * jadi mengaku sebagai orang lain lewat body tidak mengubah apa pun.
 *
 * PRASYARAT: server hidup di ALAMAT (lihat di bawah) dengan kode terbaru.
 * Tanpa itu gagal di fetch pertama dengan `ECONNREFUSED`.
 */
import mysql from "mysql2/promise";

/**
 * 3018, bukan 3000: itu port `npm run deploy` (lihat `start` di package.json).
 * Dev di 3000 cuma dipakai kalau memang sedang dijalankan.
 */
const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PENANDA = "uji batal http";

async function masuk(username: string, password: string) {
  let r: Response;
  try {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    // `fetch failed` mentah cuma menunjukkan tumpukan undici -- tidak
    // memberi tahu bahwa yang kurang cuma servernya belum nyala.
    console.log(
      [
        `⛔ Tidak ada server di ${BASE}.`,
        "   Jalankan `npm run deploy` di terminal lain, tunggu sampai siap,",
        "   baru jalankan tes ini.",
        "",
        "   Port lain? Pakai: UJI_BASE=http://localhost:3000 npm run test:batal-http",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (!r.ok) return null;
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const andi = await masuk("marketing1", "marketing1");
cek(andi !== null, "login marketing1");
if (!andi) { console.log("gagal login marketing1, berhenti"); process.exit(1); }

const budi = await masuk("marketing2", "marketing2");
cek(budi !== null, "login marketing2 (orang lain)");

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.MARKETING_DB_NAME,
});

// Sisa run yang terputus: order uji nyangkut COMPLETED dan ikut jadi omzet.
const [sisa]: any = await root.query(
  "SELECT DISTINCT ref_id FROM entri_log WHERE entitas='sales_order' AND permintaan=?", [PENANDA]);
for (const { ref_id } of sisa) {
  await root.query("DELETE FROM sales_order_line WHERE order_id=?", [ref_id]);
  await root.query("DELETE FROM sales_order WHERE id=?", [ref_id]);
  await root.query("DELETE FROM entri_log WHERE ref_id=?", [ref_id]);
}
if (sisa.length) console.log(`⚠️  ${sisa.length} order sisa run sebelumnya dibersihkan dulu\n`);

const dibuat: number[] = [];

/** Bikin order lewat jalur tombol Simpan, sama seperti user. */
async function buatOrder(cookie: string) {
  const { susunDraf } = await import("../lib/entri/penjualan.ts");
  const { sidikDraf } = await import("../lib/entri/simpan.ts");
  const permintaan = { pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "Masker Beras 100g", qty: 3 }] };
  const draf = await susunDraf("marketing", "staf", permintaan);
  if (!draf.ok) throw new Error("draf gagal disusun");
  const r = await fetch(`${BASE}/api/entri/penjualan`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ ...permintaan, sidik: sidikDraf(draf.draf), permintaan: PENANDA }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`entri gagal: ${JSON.stringify(d)}`);
  dibuat.push(d.orderId);
  return d as { noOrder: string; orderId: number };
}

const batalkan = (cookie: string | null, body: unknown) =>
  fetch(`${BASE}/api/entri/batal`, {
    method: "POST",
    headers: cookie
      ? { "Content-Type": "application/json", cookie }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Baca JSON tanpa ikut mati kalau yang datang HTML.
 *
 * Route yang belum ada di build membalas halaman 404 HTML, dan `r.json()`
 * melemparkan SyntaxError yang menunjuk ke parser -- bukan ke penyebabnya.
 * Pernah terjadi dan menyesatkan: probe tanpa cookie membalas 401 (dari
 * lapisan auth, BUKAN dari route), jadi route-nya terlihat seperti sudah ada.
 */
async function jsonAman(r: Response): Promise<any> {
  const teks = await r.text();
  try { return JSON.parse(teks); } catch { return { __bukanJson: teks.slice(0, 80) }; }
}

const statusOrder = async (id: number) => {
  const [r]: any = await root.query("SELECT status FROM sales_order WHERE id=?", [id]);
  return r[0]?.status;
};

{
  const r = await batalkan(andi, { noOrder: "SO-0000-00000", alasan: "cek route ada" });
  if (r.status === 404) {
    console.log(
      [
        `⛔ /api/entri/batal BELUM ADA di build yang jalan di ${BASE}.`,
        "   Jalankan `npm run deploy` dulu.",
        "",
        "   Catatan: POST tanpa cookie membalas 401 dari lapisan auth, BUKAN",
        "   dari route. Jadi jangan pakai probe itu untuk memastikan route ada.",
      ].join("\n"),
    );
    await root.end();
    process.exit(1);
  }
}

const o = await buatOrder(andi);
console.log(`order uji: ${o.noOrder}\n`);

console.log("--- yang harus ditolak ---");
{
  const r = await batalkan(null, { noOrder: o.noOrder, alasan: "tanpa login" });
  cek(r.status === 401, `tanpa cookie ditolak (HTTP ${r.status})`);
}
{
  const r = await batalkan(andi, { noOrder: o.noOrder, alasan: "a" });
  cek(r.status === 400, `alasan terlalu pendek ditolak (HTTP ${r.status})`);
}
{
  const r = await batalkan(andi, { noOrder: o.noOrder });
  cek(r.status === 400, `alasan hilang ditolak (HTTP ${r.status})`);
}
if (budi) {
  const r = await batalkan(budi, { noOrder: o.noOrder, alasan: "bukan punya saya" });
  const d = await jsonAman(r);
  cek(r.status === 403 && d.sebab === "bukan-milik-anda",
    `orang lain ditolak (HTTP ${r.status})`, d.sebab);
}
{
  // Mengaku sebagai orang lain lewat BODY -- harus tidak berpengaruh, karena
  // identitas diambil dari sesi.
  const r = await batalkan(budi, {
    noOrder: o.noOrder, alasan: "coba mengaku jadi andi",
    penggunaId: 1, username: "marketing1", sesi: { id: 1 },
  });
  cek(r.status === 403, `identitas palsu di body diabaikan (HTTP ${r.status})`);
}
cek((await statusOrder(o.orderId)) === "COMPLETED", "order masih utuh setelah semua penolakan");

console.log("--- jalur lancar ---");
{
  const r = await batalkan(andi, {
    noOrder: o.noOrder, alasan: "salah pelanggan, harusnya CV Makmur", permintaan: PENANDA,
  });
  const d = await jsonAman(r);
  cek(r.ok, `pembatalan berhasil (HTTP ${r.status})`, d.error ?? d.noOrder);
  cek((await statusOrder(o.orderId)) === "CANCELLED", "status jadi CANCELLED");

  const [v]: any = await root.query("SELECT COUNT(*) c FROM v_penjualan WHERE no_order=?", [o.noOrder]);
  cek(Number(v[0].c) === 0, "hilang dari v_penjualan");

  const [log]: any = await root.query(
    "SELECT aksi, alasan, username FROM entri_log WHERE ref_id=? ORDER BY id", [o.orderId]);
  cek(log.length === 2 && log[1].aksi === "BATAL", `jejak ENTRI → BATAL (${log.length} baris)`);
  cek(log[1]?.alasan === "salah pelanggan, harusnya CV Makmur", "alasan tersimpan apa adanya");
  cek(log[1]?.username === "marketing1", `dicatat atas nama sesi (${log[1]?.username})`);

  const r2 = await batalkan(andi, { noOrder: o.noOrder, alasan: "mau batalkan lagi" });
  cek(r2.status === 409, `pembatalan kedua ditolak (HTTP ${r2.status})`);
}

for (const id of dibuat) {
  await root.query("DELETE FROM sales_order_line WHERE order_id=?", [id]);
  await root.query("DELETE FROM sales_order WHERE id=?", [id]);
  await root.query("DELETE FROM entri_log WHERE ref_id=?", [id]);
}
console.log(`\n${dibuat.length} order uji dihapus`);

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);

await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
