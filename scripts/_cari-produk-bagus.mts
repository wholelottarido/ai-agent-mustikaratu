/**
 * Mencari produk yang paling layak dipakai mencoba ramalan + riset pasar.
 * Sekali pakai, diminta user 2 Nov 2026.
 *
 * ⚠️ 8,3 detik per produk (ARIMA diuji di 4 periode), jadi dibatasi 30 produk
 * bervolume terbesar. Memindai seluruh katalog butuh belasan menit.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { ramalkan } from "@/lib/ramalan/pilih";

const akhir = await bulanTerakhirData();
console.log(`bulan terakhir tabel: ${akhir}`);

const { rows } = await poolPerusahaan().query<{ sku_code: string; n: string; total: string }>(
  `SELECT sku_code, count(*)::text AS n, sum(qty)::text AS total
     FROM ai_forecast_sales_monthly
    WHERE source = 'ba_sales'
    GROUP BY sku_code
   HAVING count(*) >= 36 AND to_char(max(period), 'YYYY-MM') = $1
    ORDER BY sum(qty) DESC
    LIMIT 30`,
  [akhir],
);
console.log(`kandidat: ${rows.length}\n`);

type Baik = { sku: string; nama: string; bulan: number; wape: number; model: string; total: number; ramalan: number[] };
const baik: Baik[] = [];

let i = 0;
for (const r of rows) {
  i += 1;
  const d = await deretSku(r.sku_code);
  if (!d.ok) { console.log(`${i}/${rows.length} ${r.sku_code} dilewati (deret tidak terbaca)`); continue; }
  const h = ramalkan(d.deret, 3, undefined, akhir ?? undefined);
  const nama = d.deret.nama;
  if (h.berhenti) { console.log(`${i}/${rows.length} ${nama} — BERHENTI terjual`); continue; }
  if (!h.qty.ok) { console.log(`${i}/${rows.length} ${nama} — tidak bisa diramal`); continue; }
  const w = h.qty.terpilih.wape;
  if (w === null) { console.log(`${i}/${rows.length} ${nama} — ketepatan tidak terukur`); continue; }
  console.log(`${i}/${rows.length} ${nama} — ${w.toFixed(1)}% (${h.qty.terpilih.kode})`);
  baik.push({
    sku: r.sku_code, nama, bulan: d.deret.bulan.length,
    wape: w, model: h.qty.terpilih.kode, total: Number(r.total),
    ramalan: h.qty.terpilih.ramalan,
  });
}

baik.sort((a, b) => a.wape - b.wape);
console.log(`\n=== HASIL: ${baik.length} produk ketepatannya terukur ===\n`);
console.log("  WAPE%  bln  model      total unit   ramalan 3 bln         nama");
for (const b of baik) {
  console.log(`  ${b.wape.toFixed(1).padStart(5)}  ${String(b.bulan).padStart(3)}  ${b.model.padEnd(9)} ${String(b.total).padStart(10)}   ${JSON.stringify(b.ramalan).padEnd(20)}  ${b.nama}`);
}
process.exit(0);
