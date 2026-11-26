import { buatToolRamalan } from "@/voltagent/tools-ramalan";
const alat = buatToolRamalan() as unknown as {
  execute: (a: { produk: string; bulan?: number }) => Promise<Record<string, unknown>>;
};
for (const nama of ["MINYAK CEMCEMAN 175 ML RJ", "MINYAK CEMCEMAN    175 ML RJ", "PEELING MUNDISARI 15 GR RJ"]) {
  const h = await alat.execute({ produk: nama, bulan: 3 });
  console.log(`\n=== "${nama}" -> ${h.status}`);
  if (h.status === "perlu-diperjelas") {
    for (const p of (h.pilihan as Record<string, unknown>[]) ?? []) console.log(`   pilihan: ${JSON.stringify(p)}`);
    continue;
  }
  console.log(`   produk : ${JSON.stringify(h.produk)}`);
  const u = h.jumlah_unit as Record<string, unknown>;
  const r = h.nilai_rupiah as Record<string, unknown>;
  console.log(`   unit   : ${u.model} wape=${u.ketepatan_wape_persen} ${JSON.stringify(u.ramalan)}`);
  console.log(`   rupiah : ${r.model} wape=${r.ketepatan_wape_persen} ${JSON.stringify(r.ramalan)}`);
}
process.exit(0);
