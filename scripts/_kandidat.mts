/** Melihat SELURUH kandidat untuk unit dan rupiah, persis seperti portal. */
import { buatToolRamalan } from "@/voltagent/tools-ramalan";

const alat = buatToolRamalan() as unknown as {
  execute: (a: { produk: string; bulan?: number }) => Promise<Record<string, unknown>>;
};
const h = await alat.execute({ produk: "PEELING MUNDISARI 15 GR RJ", bulan: 3 });

const sisi = (nama: string, o: Record<string, unknown> | undefined) => {
  if (!o) return;
  console.log(`\n=== ${nama} ===`);
  console.log(`  terpilih : ${o.model}  wape=${o.ketepatan_wape_persen}`);
  console.log(`  ramalan  : ${JSON.stringify(o.ramalan)}`);
  const k = o.kandidat as { kode?: string; wape?: number | null; ditolak?: string | null }[] | undefined;
  if (k) for (const x of k) {
    console.log(`    ${String(x.kode).padEnd(12)} wape=${x.wape === null || x.wape === undefined ? "-" : Number(x.wape).toFixed(1).padStart(6)}  ${x.ditolak ? "DITOLAK: " + String(x.ditolak).slice(0, 55) : ""}`);
  }
};

console.log(`status: ${h.status}`);
console.log(`produk: ${JSON.stringify(h.produk)}`);
console.log(`riwayat: ${JSON.stringify(h.riwayat)}`);
sisi("JUMLAH UNIT", h.jumlah_unit as Record<string, unknown>);
sisi("NILAI RUPIAH", h.nilai_rupiah as Record<string, unknown>);
const p = h.peringatan as string[] | undefined;
console.log(`\n=== PERINGATAN (${p?.length ?? 0}) ===`);
for (const x of p ?? []) console.log(`  - ${x}`);
console.log(`\nkunci jawaban: ${Object.keys(h).join(", ")}`);
process.exit(0);
