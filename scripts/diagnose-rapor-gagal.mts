/**
 * Mencari SKU yang gagal pada rapor `dekat` tanpa mengulang semua 377 ramalan.
 * Membandingkan daftar kandidat SQL dengan hasil rapor tersimpan, lalu menguji
 * ulang kandidat yang tidak masuk hasil untuk mencatat sebabnya.
 */
import { readFile } from "node:fs/promises";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { bulanTerakhirData, batasSambung, deretSku, type DeretSku } from "@/lib/ramalan/deret";
import { ramalkan } from "@/lib/ramalan/pilih";
import { hitungPola } from "@/lib/ramalan/pola";

type Rapor = { dataSampai: string; seolahSekarang: string; bulanDiuji: string[]; produk: { sku: string }[] };
const rapor = JSON.parse(await readFile("data/rapor-ramalan-dekat.json", "utf8")) as Rapor;
const toNum = (b: string) => { const [y, m] = b.split("-").map(Number); return y * 12 + m - 1; };
const toMonth = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
const db = poolPerusahaan();
const akhirPenuh = await bulanTerakhirData();
if (!akhirPenuh) throw new Error("Bulan data terakhir tidak ditemukan");
const awalUji = toNum(akhirPenuh) - 2;
const jeda = 0;
const potong = toMonth(awalUji - 1 - jeda);
const pura = toMonth(awalUji - 1);
const bulanUji = Array.from({ length: 3 }, (_, i) => toMonth(awalUji + i));
if (rapor.dataSampai !== potong || rapor.bulanDiuji.join() !== bulanUji.join()) {
  throw new Error(`Rapor lokal ${rapor.dataSampai}/${rapor.bulanDiuji} berbeda dari DB ${potong}/${bulanUji}`);
}

const sambung = await batasSambung();
const { rows: total } = await db.query<{ b: string; q: string }>(
  sambung
    ? `SELECT to_char(period, 'YYYY-MM') b, sum(qty)::text q FROM ai_forecast_sales_monthly WHERE source = 'ba_sales' GROUP BY 1
       UNION ALL SELECT to_char(trx_date, 'YYYY-MM') b, sum(qty)::text q FROM trx_ba_sales
       WHERE item_code IS NOT NULL AND trx_date >= $1::date AND trx_date < $2::date GROUP BY 1`
    : `SELECT to_char(period, 'YYYY-MM') b, sum(qty)::text q FROM ai_forecast_sales_monthly WHERE source = 'ba_sales' GROUP BY 1`,
  sambung ? [sambung.dari, sambung.sebelum] : [],
);
const pola = hitungPola(new Map(total.filter((r) => r.b <= potong).map((r) => [r.b, Number(r.q)])));
const { rows: candidates } = await db.query<{ sku_code: string; sku_name: string; brand: string | null }>(
  `SELECT sku_code, max(sku_name) sku_name, max(brand) brand FROM ai_forecast_sales_monthly
    WHERE source = 'ba_sales' AND period > $1::date AND period <= $2::date AND qty > 0 GROUP BY 1`,
  [`${toMonth(toNum(potong) - 3)}-01`, `${potong}-01`],
);
const succeeded = new Set(rapor.produk.map((p) => p.sku));
const missed = candidates.filter((x) => !succeeded.has(x.sku_code));
console.log(`kandidat=${candidates.length} hasil-rapor=${succeeded.size} di luar-hasil=${missed.length}`);

function cut(d: DeretSku): DeretSku | null {
  const n = d.bulan.filter((b) => b <= potong).length;
  return n ? { ...d, bulan: d.bulan.slice(0, n), qty: d.qty.slice(0, n), value: d.value.slice(0, n), bulanTerakhir: d.bulan[n - 1] } : null;
}
for (const item of missed) {
  const sku = item.sku_code;
  const h = await deretSku(sku);
  if (!h.ok) { console.log(JSON.stringify({ sku, nama: item.sku_name, merek: item.brand, sebab: h.sebab, pesan: h.pesan })); continue; }
  const train = cut(h.deret);
  if (!train) { console.log(JSON.stringify({ sku, nama: h.deret.nama, sebab: "tidak-ada-data-sampai-cutoff" })); continue; }
  const r = ramalkan(train, 3, pura, potong, undefined, pola);
  console.log(JSON.stringify({
    sku, nama: h.deret.nama, merek: h.deret.merek,
    berhenti: r.berhenti,
    bulanRamalan: r.bulanRamalan,
    qtyOk: r.qty.ok,
    qtyError: r.qty.ok ? undefined : r.qty.pesan,
    cocokBulan: r.bulanRamalan.join() === bulanUji.join(),
  }));
}
await db.end();
