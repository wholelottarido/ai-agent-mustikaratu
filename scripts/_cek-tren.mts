import { buatToolTrenPasar } from "@/voltagent/tools-pasar";
const alat = buatToolTrenPasar() as unknown as {
  execute: (a: { produk: string }) => Promise<Record<string, unknown>>;
};
const t0 = Date.now();
const h = await alat.execute({ produk: "SHAMPO BAYAM 175 ML RJ" });
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} detik — status=${h.status}`);
console.log(`  kueri yang dikirim: ${JSON.stringify(h.kueri ?? h.pencarian ?? "-")}`);
const s = (h.sumber ?? []) as { judul?: string; domain?: string; relevansi?: string; terbit?: string | null }[];
console.log(`  sumber: ${s.length}`);
for (const x of s.slice(0, 6)) console.log(`    [${x.relevansi}] ${x.domain} (${x.terbit ?? "tanpa tanggal"}) ${String(x.judul).slice(0, 55)}`);
console.log(`  ukuran: ${(JSON.stringify(h).length / 1024).toFixed(1)} KB`);
