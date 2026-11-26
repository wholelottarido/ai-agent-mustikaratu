import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { ramalkan, jumlahJendela, minimalTerbesar, JENDELA_DENGAN_ML, BULAN_UJI } from "@/lib/ramalan/pilih";
import { ambilMl } from "@/lib/ramalan/ml";
import { bulanIni, bulanSetelah, selisihBulan } from "@/lib/ramalan/pilih";

const sku = "1006732";
const d = await deretSku(sku);
if (!d.ok) throw new Error("gagal");
const akhir = (await bulanTerakhirData()) ?? d.deret.bulanTerakhir;
const sekarang = bulanIni();
const jeda = Math.max(0, selisihBulan(d.deret.bulanTerakhir, sekarang));
const horizonInternal = Math.min(jeda + 3, 18);
const bulanRamalan = bulanSetelah(d.deret.bulanTerakhir, horizonInternal).slice(jeda);
const kJ = jumlahJendela(d.deret.qty.length, minimalTerbesar(d.deret.qty.length), JENDELA_DENGAN_ML);
const bd = kJ * BULAN_UJI;
const hMl = await ambilMl(sku, d.deret.bulan.slice(-bd), d.deret.qty.slice(-bd), bulanRamalan);
const r = ramalkan(d.deret, 3, sekarang, akhir, hMl.ok ? hMl.ml : undefined);

console.log(`${d.deret.nama} (${sku})\n`);
if (r.qty.ok) console.log(`unit   : ${r.qty.terpilih.kode} wape=${r.qty.terpilih.wape?.toFixed(1)} ${JSON.stringify(r.qty.terpilih.ramalan)}`);
if (r.value.ok) console.log(`rupiah : ${r.value.terpilih.kode} wape=${r.value.terpilih.wape?.toFixed(1)}`);
if (r.value.ok) console.log(`         ${r.value.terpilih.ramalan.map((v) => "Rp " + v.toLocaleString("id-ID")).join("  ")}`);
console.log(`\nkandidat rupiah:`);
for (const k of r.value.kandidat) console.log(`  ${k.kode.padEnd(16)} wape=${k.wape === null ? "  -  " : k.wape.toFixed(1).padStart(6)} ${k.ditolak ? "DITOLAK" : ""}`);
console.log(`\nperingatan:`);
for (const p of r.peringatan) console.log(`  - ${p}`);
process.exit(0);
