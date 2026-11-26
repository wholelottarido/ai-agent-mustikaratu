/** Membuktikan tool kode sekarang melaporkan tabel sumbernya. */
import { buatToolKode } from "@/voltagent/registry-kode";
import type { Jejak } from "@/voltagent/tool-konfigurasi";

const jejak: Jejak[] = [];
const sesi = { departemen: "marketing" } as never;

const baris = (kode: string, penangan: string) =>
  ({ kode, penangan, jenis: "kode", nama: kode, deskripsi: "" }) as never;

const alat = buatToolKode(baris("ramal_penjualan", "ramal_penjualan"), sesi, (j) => jejak.push(j)) as unknown as {
  execute: (a: unknown) => Promise<unknown>;
};
await alat.execute({ produk: "SHAMPO BAYAM 175 ML RJ", bulan: 3 });

console.log("jejak yang tercatat:");
for (const j of jejak) console.log(`  alat=${j.alat}  view=${j.view ?? "(null)"}`);
const v = jejak[0]?.view;
console.log(`\nlabel di layar: ${v ? `Sumber: ${v}` : "tidak mengambil data dari database"}`);
process.exit(0);
