/**
 * Kunci jawaban: jalankan query referensi dari docs/contoh-query.md
 * langsung ke MySQL, supaya ada angka pembanding untuk menilai jawaban agent.
 *
 * Jalankan: npm run kunci
 */
import { departemenDariArgv, sambungkan } from "./lib/dep.mts";

const dep = departemenDariArgv();
const conn = await sambungkan(dep);

const q = async (label: string, sql: string) => {
  const [rows] = await conn.query(sql);
  console.log(`\n=== ${label} ===`);
  console.table(rows);
};

await q("Produk terlaris Agustus 2026 (top 5 omzet)", `
  SELECT p.nama, SUM(sol.qty) AS qty, SUM(sol.subtotal) AS omzet
    FROM sales_order_line sol
    JOIN sales_order so ON so.id = sol.order_id
    JOIN produk p       ON p.id = sol.produk_id
   WHERE so.status = 'COMPLETED'
     AND DATE_FORMAT(so.tanggal, '%Y-%m') = '2026-08'
   GROUP BY p.id, p.nama
   ORDER BY omzet DESC
   LIMIT 5`);

await q("Omzet per bulan", `
  SELECT DATE_FORMAT(so.tanggal, '%Y-%m') AS bulan,
         COUNT(DISTINCT so.id)            AS jml_order,
         SUM(sol.subtotal)                AS omzet
    FROM sales_order so
    JOIN sales_order_line sol ON sol.order_id = so.id
   WHERE so.status = 'COMPLETED'
   GROUP BY bulan
   ORDER BY bulan`);

await conn.end();
