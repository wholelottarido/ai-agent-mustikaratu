/** Mengulang kegagalan "Connection terminated due to connection timeout". */
import { buatToolAnalisisPasar } from "@/voltagent/tools-pasar";

const alat = buatToolAnalisisPasar() as unknown as {
  execute: (a: { produk: string; bulan?: number }) => Promise<Record<string, unknown>>;
};

const t0 = Date.now();
const lap = (s: string) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

lap("mulai");
try {
  const h = await alat.execute({ produk: "SHAMPO BAYAM 175 ML RJ", bulan: 3 });
  lap(`selesai — status=${h.status}`);
  const ram = h.ramalan as Record<string, unknown> | undefined;
  lap(`ramalan status=${ram?.status}`);
  const pasar = h.pasar as Record<string, unknown> | undefined;
  lap(`pasar: gagal=${pasar?.pencarian_gagal ?? "tidak"} sumber=${(pasar?.sumber as unknown[])?.length ?? 0}`);
  console.log(`\nukuran jawaban: ${(JSON.stringify(h).length / 1024).toFixed(1)} KB`);
} catch (e) {
  lap(`GAGAL: ${(e as Error).message}`);
}
process.exit(0);
