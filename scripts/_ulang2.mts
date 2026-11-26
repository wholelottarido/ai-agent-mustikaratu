/** Memecah alurnya per tahap untuk tahu mana yang menggantung. */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { cariSku, deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";

const t0 = Date.now();
const lap = (s: string) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

try {
  lap("query paling sederhana...");
  await poolPerusahaan().query("SELECT 1");
  lap("SELECT 1 OK");

  lap("bulanTerakhirData...");
  const akhir = await bulanTerakhirData();
  lap(`OK = ${akhir}`);

  lap("cariSku...");
  const c = await cariSku("SHAMPO BAYAM 175 ML RJ");
  lap(`OK = ${c.length} kandidat`);

  lap("deretSku...");
  const d = await deretSku(c[0].sku);
  lap(`OK = ${d.ok ? d.deret.bulan.length + " bulan" : "gagal"}`);
} catch (e) {
  lap(`GAGAL: ${(e as Error).message}`);
}
process.exit(0);
