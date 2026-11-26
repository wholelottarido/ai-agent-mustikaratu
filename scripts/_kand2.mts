/** Melihat kandidat rupiah langsung dari ramalkan(), termasuk yang kalah. */
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { ramalkan } from "@/lib/ramalan/pilih";

for (const sku of ["1006036", "1006003", "1005998"]) {
  const d = await deretSku(sku);
  if (!d.ok) continue;
  const akhir = await bulanTerakhirData();
  const r = ramalkan(d.deret, 3, undefined, akhir ?? undefined);
  console.log(`\n=== ${d.deret.nama} (${sku}) ===`);
  if (r.qty.ok) console.log(`  unit   : ${r.qty.terpilih.kode} wape=${r.qty.terpilih.wape?.toFixed(1)}`);
  if (r.value.ok) console.log(`  rupiah : ${r.value.terpilih.kode} wape=${r.value.terpilih.wape?.toFixed(1)}`);
  console.log(`  kandidat rupiah:`);
  for (const k of r.value.kandidat) {
    console.log(`    ${k.kode.padEnd(16)} wape=${k.wape === null ? "   -  " : k.wape.toFixed(1).padStart(6)}  ${k.ditolak ? "DITOLAK" : ""}`);
  }
}
process.exit(0);
