import { poolPerusahaan } from "@/lib/db-perusahaan";
const q = poolPerusahaan().query.bind(poolPerusahaan());
const { rows: a } = await q(
  `SELECT count(DISTINCT sku_code)::text AS n FROM ai_forecast_sales_monthly WHERE source='ba_sales'`);
const { rows: b } = await q(
  `SELECT count(DISTINCT sku_code)::text AS n FROM ai_forecast_sales_monthly
    WHERE source='ba_sales' AND sku_name ~ '\s\s'`);
console.log(`SKU seluruhnya        : ${a[0].n}`);
console.log(`SKU bernama spasi ganda: ${b[0].n}`);
const { rows: c } = await q(
  `SELECT sku_name, count(*)::text bulan, sum(qty)::text total
     FROM ai_forecast_sales_monthly WHERE source='ba_sales' AND sku_name ~ '\s\s'
    GROUP BY sku_name ORDER BY sum(qty) DESC LIMIT 8`);
console.log(`\ncontoh yang TIDAK BISA dicari dengan mengetik namanya biasa:`);
for (const r of c) console.log(`  ${JSON.stringify(r.sku_name)}  ${r.bulan} bln  ${Number(r.total).toLocaleString("id-ID")} unit`);
process.exit(0);
