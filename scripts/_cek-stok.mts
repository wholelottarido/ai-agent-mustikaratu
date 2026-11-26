import { buatToolStokKosong } from "@/voltagent/tools-stok";
const alat = buatToolStokKosong(() => "2026-11") as unknown as { execute: (a: object) => Promise<Record<string, unknown>> };
for (const a of [{ bulan: "2026-09" }, { bulan: "2026-09", menurut: "outlet" }, { produk: "PEELING MUNDISARI 60 GR RJ", bulan: "2026-09" }, {}]) {
  const t = Date.now(); const h = await alat.execute(a);
  console.log("\n", JSON.stringify(a), Date.now() - t, "ms", h.status, h.periode, h.outlet_pelapor, JSON.stringify(h.ringkasan));
  for (const d of ((h.daftar as object[]) ?? []).slice(0, 4)) console.log("  ", JSON.stringify(d));
}
process.stdout.write("", () => process.exit());
