/**
 * Verifikasi view Tahap 4.
 *
 * Tiap view dicocokkan dengan query manual ke tabel aslinya. Kalau angkanya
 * beda, view-nya salah -- dan itu lebih berbahaya daripada tidak punya view
 * sama sekali, karena agent akan percaya begitu saja.
 *
 * Jalankan: npm run test:views   (butuh db/03_create_views.sql sudah dijalankan root)
 */
import { departemenDariArgv, sambungkan, namaDb } from "./lib/dep.mts";

const dep = departemenDariArgv();
const conn = await sambungkan(dep);
const DB = namaDb(dep);

let gagal = 0;
const ok = (m: string) => console.log(`  OK   ${m}`);
const bad = (m: string) => { gagal++; console.log(`  GAGAL ${m}`); };

const satu = async (sql: string): Promise<Record<string, unknown>> => {
  const [r] = await conn.query<any[]>(sql);
  return r[0] ?? {};
};

/** Bandingkan satu angka dari view vs query manual. */
const banding = async (nama: string, sqlView: string, sqlManual: string) => {
  const v = Object.values(await satu(sqlView))[0];
  const m = Object.values(await satu(sqlManual))[0];
  String(v) === String(m)
    ? ok(`${nama} — ${v}`)
    : bad(`${nama} — view=${v} manual=${m}`);
};

// --- 0. Semua view ada? ---
console.log("0. View terpasang");
const DIHARAPKAN = [
  "v_penjualan", "v_omzet_bulanan", "v_produk_bulanan",
  "v_kampanye_roas", "v_target_vs_realisasi",
];
const [vrows] = await conn.query<any[]>(
  `SELECT TABLE_NAME AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`,
  [DB],
);
const ada = vrows.map((r) => r.n as string);
for (const v of DIHARAPKAN) {
  ada.includes(v) ? ok(v) : bad(`${v} TIDAK ADA — sudah jalankan db/03_create_views.sql sebagai root?`);
}
if (gagal > 0) {
  console.log(`\n${gagal} view belum terpasang. Hentikan.`);
  await conn.end();
  process.exit(1);
}

// --- 1. v_penjualan ---
console.log("\n1. v_penjualan (filter COMPLETED melekat)");
await banding("total omzet",
  `SELECT SUM(subtotal) FROM v_penjualan`,
  `SELECT SUM(sol.subtotal) FROM sales_order so
     JOIN sales_order_line sol ON sol.order_id = so.id
    WHERE so.status = 'COMPLETED'`);
await banding("jumlah order",
  `SELECT COUNT(DISTINCT order_id) FROM v_penjualan`,
  `SELECT COUNT(DISTINCT so.id) FROM sales_order so
     JOIN sales_order_line sol ON sol.order_id = so.id
    WHERE so.status = 'COMPLETED'`);
const bocor = await satu(
  `SELECT COUNT(*) AS n FROM v_penjualan vp
     JOIN sales_order so ON so.id = vp.order_id
    WHERE so.status <> 'COMPLETED'`);
Number(bocor.n) === 0
  ? ok("tidak ada order non-COMPLETED yang bocor")
  : bad(`${bocor.n} baris non-COMPLETED bocor ke view`);

// --- 2. v_omzet_bulanan ---
console.log("\n2. v_omzet_bulanan");
await banding("omzet Agustus 2026",
  `SELECT omzet FROM v_omzet_bulanan WHERE periode = '2026-08'`,
  `SELECT SUM(sol.subtotal) FROM sales_order so
     JOIN sales_order_line sol ON sol.order_id = so.id
    WHERE so.status='COMPLETED' AND DATE_FORMAT(so.tanggal,'%Y-%m')='2026-08'`);
await banding("jumlah bulan",
  `SELECT COUNT(*) FROM v_omzet_bulanan`,
  `SELECT COUNT(DISTINCT DATE_FORMAT(so.tanggal,'%Y-%m')) FROM sales_order so
     JOIN sales_order_line sol ON sol.order_id = so.id WHERE so.status='COMPLETED'`);

// --- 3. v_produk_bulanan ---
console.log("\n3. v_produk_bulanan");
await banding("produk teratas Agustus (omzet)",
  `SELECT omzet FROM v_produk_bulanan WHERE periode='2026-08' ORDER BY omzet DESC LIMIT 1`,
  `SELECT SUM(sol.subtotal) AS o FROM sales_order so
     JOIN sales_order_line sol ON sol.order_id = so.id
    WHERE so.status='COMPLETED' AND DATE_FORMAT(so.tanggal,'%Y-%m')='2026-08'
    GROUP BY sol.produk_id ORDER BY o DESC LIMIT 1`);

// --- 4. v_kampanye_roas ---
console.log("\n4. v_kampanye_roas");
await banding("jumlah kampanye (semua muncul, termasuk tanpa spend)",
  `SELECT COUNT(*) FROM v_kampanye_roas`,
  `SELECT COUNT(*) FROM campaign`);
await banding("total spend",
  `SELECT SUM(spend) FROM v_kampanye_roas`,
  `SELECT SUM(biaya) FROM campaign_spend`);
const nol = await satu(`SELECT COUNT(*) AS n FROM v_kampanye_roas WHERE spend = 0 AND roas IS NOT NULL`);
Number(nol.n) === 0 ? ok("roas NULL saat spend 0 (tidak bagi nol)") : bad(`${nol.n} baris roas terisi padahal spend 0`);

// --- 5. v_target_vs_realisasi ---
console.log("\n5. v_target_vs_realisasi");
await banding("jumlah baris target (sales nol penjualan tetap muncul)",
  `SELECT COUNT(*) FROM v_target_vs_realisasi`,
  `SELECT COUNT(*) FROM target_sales`);
await banding("realisasi Agustus total",
  `SELECT SUM(realisasi) FROM v_target_vs_realisasi WHERE periode='2026-08'`,
  `SELECT SUM(sol.subtotal) FROM sales_order so
     JOIN sales_order_line sol ON sol.order_id = so.id
    WHERE so.status='COMPLETED' AND DATE_FORMAT(so.tanggal,'%Y-%m')='2026-08'
      AND so.sales_person_id IS NOT NULL`);

// --- 6. View tetap read-only untuk mkt_readonly ---
console.log("\n6. View tidak bisa ditulis");
try {
  await conn.query(`INSERT INTO v_penjualan (qty) VALUES (1)`);
  bad("INSERT ke view MALAH BERHASIL");
} catch (e: any) {
  /denied|not insertable|read-only/i.test(e.message)
    ? ok(`INSERT ke view ditolak — ${e.code}`)
    : bad(`INSERT ditolak tapi alasan lain: ${e.message}`);
}

await conn.end();
console.log(gagal === 0 ? "\nSemua tes view lolos." : `\n${gagal} tes GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
