/** Cara mana yang paling tepat menebak harga/unit bulan depan? */
import { deretSku } from "@/lib/ramalan/deret";

const SKU = ["1005998", "1006000", "1006003", "1005997", "1004682"];
type Cara = { nama: string; tebak: (h: number[]) => number };

const CARA: Cara[] = [
  { nama: "rata-rata 12 bln", tebak: (h) => h.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, h.length) },
  { nama: "rata-rata 3 bln", tebak: (h) => h.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, h.length) },
  { nama: "harga bulan terakhir", tebak: (h) => h[h.length - 1] },
  {
    nama: "garis lurus 6 bln",
    tebak: (h) => {
      const w = h.slice(-6);
      if (w.length < 2) return h[h.length - 1];
      const n = w.length;
      const mx = (n - 1) / 2;
      const my = w.reduce((a, b) => a + b, 0) / n;
      let atas = 0, bawah = 0;
      for (let i = 0; i < n; i++) { atas += (i - mx) * (w[i] - my); bawah += (i - mx) ** 2; }
      return my + (atas / bawah) * (n - 1 + 1 - mx);
    },
  },
];

const total: Record<string, { g: number; a: number }> = {};
for (const c of CARA) total[c.nama] = { g: 0, a: 0 };

for (const sku of SKU) {
  const d = await deretSku(sku);
  if (!d.ok) continue;
  const { qty, value } = d.deret;
  const harga = qty.map((q, i) => (q > 0 ? value[i] / qty[i] : NaN));

  for (const c of CARA) {
    let sg = 0, sa = 0;
    for (let i = qty.length - 12; i < qty.length; i++) {
      const lalu = harga.slice(0, i).filter((h) => Number.isFinite(h));
      if (lalu.length < 6 || qty[i] === 0) continue;
      const tebak = qty[i] * c.tebak(lalu);
      sg += Math.abs(tebak - value[i]);
      sa += Math.abs(value[i]);
    }
    total[c.nama].g += sg;
    total[c.nama].a += sa;
  }
}

console.log("Kalau jumlah unit SUDAH BENAR, seberapa meleset rupiahnya:\n");
console.log("  cara menebak harga        meleset");
for (const c of CARA) {
  const t = total[c.nama];
  console.log(`  ${c.nama.padEnd(24)} ${((t.g / t.a) * 100).toFixed(1).padStart(6)}%`);
}
process.exit(0);
