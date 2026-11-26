import { deretSku } from "@/lib/ramalan/deret";
import { hargaTerakhir } from "@/lib/ramalan/pilih";
const d = await deretSku("1005998");
if (!d.ok) throw new Error("gagal");
const { qty, value, bulan } = d.deret;
console.log("6 bulan terakhir:");
for (let i = qty.length - 6; i < qty.length; i++) {
  console.log(`  ${bulan[i]}  qty=${String(qty[i]).padStart(6)}  value=${String(value[i]).padStart(12)}  harga=${qty[i] > 0 ? Math.round(value[i] / qty[i]) : "-"}`);
}
console.log(`\nhargaTerakhir() = ${hargaTerakhir(qty, value, qty.length)}`);
console.log(`qty.length = ${qty.length}, bulan terakhir = ${bulan[bulan.length - 1]}`);
process.exit(0);
