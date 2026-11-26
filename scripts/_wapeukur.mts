import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku } from "@/lib/ramalan/deret";
import { ramalkan } from "@/lib/ramalan/pilih";
const db = poolPerusahaan();
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales'
    GROUP BY sku_code HAVING count(*) >= 12 ORDER BY sum(qty) DESC LIMIT 150`);
let siap = 0, tidakBisa = 0;
const ember: Record<string, number> = { "0-20": 0, "20-50": 0, "50-100": 0, ">=100": 0, "tanpa-ukur": 0 };
for (const r of rows) {
  const h = await deretSku(r.sku_code);
  if (!h.ok) continue;
  const p = ramalkan(h.deret, 3);
  if (!p.qty.ok) { tidakBisa++; continue; }
  siap++;
  const w = p.qty.terpilih.wape;
  if (w === null) ember["tanpa-ukur"]++;
  else if (w < 20) ember["0-20"]++;
  else if (w < 50) ember["20-50"]++;
  else if (w < 100) ember["50-100"]++;
  else ember[">=100"]++;
}
console.log(`dari ${rows.length} produk terlaris, metrik WAPE:`);
console.log(`  bisa diramal      : ${siap}`);
console.log(`  mengaku tidak bisa: ${tidakBisa}`);
for (const [k, v] of Object.entries(ember)) console.log(`    ${k.padEnd(11)} ${String(v).padStart(4)}`);
process.exitCode = 0;
await db.end();
