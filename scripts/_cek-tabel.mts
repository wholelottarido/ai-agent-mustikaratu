import { poolPerusahaan } from "@/lib/db-perusahaan";
const q = async (judul: string, sql: string) => {
  const { rows } = await poolPerusahaan().query(sql);
  console.log(`\n${judul}`);
  for (const r of rows) console.log("  " + JSON.stringify(r));
};
await q("source yang ada:", `SELECT source, count(*)::text n, to_char(min(period),'YYYY-MM') awal, to_char(max(period),'YYYY-MM') akhir FROM ai_forecast_sales_monthly GROUP BY source`);
await q("sebaran panjang data per SKU (source utama):",
  `SELECT bulan, count(*)::text jml_sku FROM (
     SELECT sku_code, count(*) bulan FROM ai_forecast_sales_monthly GROUP BY sku_code
   ) x GROUP BY bulan ORDER BY bulan DESC LIMIT 12`);
await q("SKU dengan data terbanyak:",
  `SELECT sku_code, max(sku_name) nama, count(*)::text bulan, to_char(max(period),'YYYY-MM') akhir, sum(qty)::text total
     FROM ai_forecast_sales_monthly GROUP BY sku_code ORDER BY count(*) DESC, sum(qty) DESC LIMIT 10`);
process.exit(0);
