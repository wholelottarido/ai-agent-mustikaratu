/**
 * Seberapa layak rupiah diturunkan dari unit?
 * Diukur: kalau unitnya SUDAH BENAR, seberapa meleset rupiah = unit x harga.
 * Itu batas BAWAH kesalahan cara ini - tidak mungkin lebih baik dari ini.
 */
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";

const SKU = ["1005998", "1006000", "1006003", "1005997", "1004682"];
const akhir = await bulanTerakhirData();

for (const sku of SKU) {
  const d = await deretSku(sku);
  if (!d.ok) continue;
  const { qty, value, bulan, nama } = d.deret;

  const harga: number[] = [];
  for (let i = 0; i < qty.length; i++) harga.push(qty[i] > 0 ? value[i] / qty[i] : NaN);
  const sah = harga.filter((h) => Number.isFinite(h));
  const ratax = sah.reduce((a, b) => a + b, 0) / sah.length;
  const sd = Math.sqrt(sah.reduce((a, b) => a + (b - ratax) ** 2, 0) / sah.length);

  // 12 bulan terakhir: pakai harga rata-rata 12 bulan SEBELUMNYA.
  let sg = 0, sa = 0;
  for (let i = qty.length - 12; i < qty.length; i++) {
    const jendela = harga.slice(Math.max(0, i - 12), i).filter((h) => Number.isFinite(h));
    if (jendela.length === 0 || qty[i] === 0) continue;
    const hRata = jendela.reduce((a, b) => a + b, 0) / jendela.length;
    const tebak = qty[i] * hRata;
    sg += Math.abs(tebak - value[i]);
    sa += Math.abs(value[i]);
  }
  const wape = sa === 0 ? NaN : (sg / sa) * 100;

  console.log(`\n${nama}  (${bulan.length} bulan, sampai ${akhir})`);
  console.log(`  harga/unit rata-rata : Rp ${Math.round(ratax).toLocaleString("id-ID")}`);
  console.log(`  naik-turunnya        : ${((sd / ratax) * 100).toFixed(1)}% dari rata-rata`);
  console.log(`  12 bulan terakhir    : Rp ${sah.slice(-12).map((h) => Math.round(h / 1000)).join("k, ")}k`);
  console.log(`  >> kalau unit SUDAH BENAR, rupiah meleset ${wape.toFixed(1)}%`);
}
process.exit(0);
