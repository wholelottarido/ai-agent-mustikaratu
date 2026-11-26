import { deretSku } from "@/lib/ramalan/deret";
const d = await deretSku("1005998");
if (!d.ok) throw new Error("gagal");
const { qty, value, bulan } = d.deret;
const i = qty.length - 1;
const hTerakhir = value[i] / qty[i];
console.log(`bulan terakhir data : ${bulan[i]}`);
console.log(`harga/unit terakhir : Rp ${Math.round(hTerakhir).toLocaleString("id-ID")}`);
console.log(`\nkalau rupiah diturunkan dari unit:`);
for (const [b, u] of [["Des 2026", 4066], ["Jan 2027", 4171], ["Feb 2027", 3967]] as [string, number][]) {
  console.log(`  ${b}  ${u} unit  ->  Rp ${Math.round(u * hTerakhir).toLocaleString("id-ID")}`);
}
console.log(`\nsekarang (IMAPA, rata semua bulan): Rp 149.951.090`);
process.exit(0);
