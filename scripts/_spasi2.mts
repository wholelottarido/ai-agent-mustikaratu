import { poolPerusahaan } from "@/lib/db-perusahaan";
const q = poolPerusahaan().query.bind(poolPerusahaan());
const DUA = "'%  %'";
const { rows: a } = await q(
  `SELECT count(DISTINCT sku_code)::text AS n FROM ai_forecast_sales_monthly WHERE source='ba_sales'`);
const { rows: b } = await q(
  `SELECT count(DISTINCT sku_code)::text AS n FROM ai_forecast_sales_monthly
    WHERE source='ba_sales' AND sku_name LIKE ${DUA}`);
console.log(`SKU seluruhnya          : ${a[0].n}`);
console.log(`SKU bernama spasi ganda : ${b[0].n}`);
const { rows: c } = await q(
  `SELECT sku_name, count(*)::text bulan, sum(qty)::text total
     FROM ai_forecast_sales_monthly WHERE source='ba_sales' AND sku_name LIKE ${DUA}
    GROUP BY sku_name ORDER BY sum(qty) DESC LIMIT 10`);
console.log(`\n10 terbesar yang namanya berspasi ganda:`);
for (const r of c) console.log(`  ${JSON.stringify(r.sku_name).padEnd(40)} ${String(r.bulan).padStart(3)} bln  ${Number(r.total).toLocaleString("id-ID").padStart(11)} unit`);
process.exit(0);
