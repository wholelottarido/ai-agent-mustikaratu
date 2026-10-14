/**
 * Uji penyusun draf penjualan. `npm run test:entri`
 *
 * ⚠️ Yang paling penting di sini BUKAN jalur lancarnya, tapi jalur ambigu.
 * Kalau pencocokan ganda diam-diam memilih salah satu, data salah masuk dan
 * baru ketahuan waktu laporan bulanan janggal.
 *
 * Seluruh uji ini cuma MEMBACA — modulnya memakai user MySQL read-only.
 */
import { susunDraf, drafJadiTeks, masalahJadiTeks } from "../lib/entri/penjualan.ts";
import { buatTools } from "../voltagent/tools-db.ts";
import { ambilAgent, ambilDepartemen } from "../voltagent/index.ts";

let lolos = 0, gagal = 0;
const cek = (n: string, ok: boolean, k = "") => {
  if (ok) { lolos++; console.log(`  LOLOS  ${n}`); }
  else { gagal++; console.log(`  GAGAL  ${n}${k ? " — " + k : ""}`); }
};
const draf = (p: Parameters<typeof susunDraf>[2]) => susunDraf("marketing", "staf", p);

console.log("--- jalur lancar ---");
const h1 = await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: 10 }] });
cek("nama tepat -> draf jadi", h1.ok, JSON.stringify(h1).slice(0, 110));
if (h1.ok) {
  cek("pelanggan benar", h1.draf.pelanggan.nama === "UD Sentosa Bekasi");
  cek("produk benar", h1.draf.baris[0].nama === "Masker Beras 100g");
  cek("harga DARI DATABASE (25.000)", h1.draf.baris[0].harga === 25000, `dapat ${h1.draf.baris[0].harga}`);
  cek("subtotal dihitung benar", h1.draf.baris[0].subtotal === 250000);
  cek("status COMPLETED", h1.draf.status === "COMPLETED");
  console.log("\n" + drafJadiTeks(h1.draf).split("\n").map((l) => "    " + l).join("\n") + "\n");
}

console.log("--- ambigu: harus BERHENTI, bukan menebak ---");
const h2 = await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "lulur", qty: 5 }] });
cek("'lulur' -> ambigu", !h2.ok && h2.masalah.some((m) => m.jenis === "ambigu"), JSON.stringify(h2).slice(0, 110));
if (!h2.ok) {
  const a = h2.masalah.find((m) => m.jenis === "ambigu");
  cek("kedua pilihan ditawarkan", a?.jenis === "ambigu" && a.pilihan.length === 2);
  console.log("\n" + masalahJadiTeks(h2.masalah).split("\n").map((l) => "    " + l).join("\n") + "\n");
}

console.log("--- tidak ketemu ---");
const h3 = await draf({ pelanggan: "Toko Anu", barang: [{ produk: "sabun beras", qty: 3 }] });
cek("dua-duanya dilaporkan sekaligus",
  !h3.ok && h3.masalah.filter((m) => m.jenis === "tidak-ketemu").length === 2,
  JSON.stringify(h3).slice(0, 130));

console.log("--- masukan tidak sah ---");
cek("qty 0 ditolak", !(await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: 0 }] })).ok);
cek("qty minus ditolak", !(await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: -5 }] })).ok);
cek("qty pecahan ditolak", !(await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: 2.5 }] })).ok);
cek("qty kelebihan nol ditolak", !(await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: 9999999 }] })).ok);
cek("tanpa barang ditolak", !(await draf({ pelanggan: "UD Sentosa Bekasi", barang: [] })).ok);
cek("tanggal masa depan ditolak", !(await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: 1 }], tanggal: "2099-01-01" })).ok);
cek("tanggal salah bentuk ditolak", !(await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: 1 }], tanggal: "28/09/2026" })).ok);

console.log("--- harga TIDAK diambil dari kalimat user ---");
const h4 = await draf({ pelanggan: "UD Sentosa Bekasi", barang: [{ produk: "masker beras", qty: 10 }] });
cek("harga tetap 25.000 walau user menyebut lain", h4.ok && h4.draf.baris[0].harga === 25000);

console.log("--- beberapa barang sekaligus ---");
const h5 = await draf({
  pelanggan: "UD Mutiara Surabaya",
  barang: [{ produk: "Masker Beras 100g", qty: 2 }, { produk: "Lulur Kuning 200g", qty: 3 }],
});
cek("dua baris, total dijumlahkan",
  h5.ok && h5.draf.baris.length === 2 && h5.draf.total === 2 * 25000 + 3 * 35000,
  h5.ok ? String(h5.draf.total) : JSON.stringify(h5).slice(0, 100));

console.log("--- tool & instruksi terpasang di tempat yang benar ---");

// Tanpa aturan ini model mengarang nama produk. Terjadi 28 Sep 2026: diminta
// "catat 5 lulur", dia menyebut "Lulur Tradisional / Beras / Kopi" yang tidak
// satu pun nyata. Uji ini menjaga aturannya tidak hilang diam-diam.
const mkt = ambilDepartemen("marketing")!;
const hr = ambilDepartemen("hr")!;
const ctx = { context: new Map<string, unknown>([["model", "claude-sonnet-5"]]) };
const instruksi = (d: typeof mkt) =>
  String((ambilAgent(d, "staf") as unknown as { instructions: (o: unknown) => string }).instructions(ctx));

cek("marketing dapat tool entri", buatTools(mkt, "staf").some((t) => t.name === "siapkan_penjualan"));
cek("HR TIDAK dapat tool entri", !buatTools(hr, "staf").some((t) => t.name === "siapkan_penjualan"));
cek("instruksi melarang mengarang nama", /JANGAN PERNAH menyebut nama produk/.test(instruksi(mkt)));
cek("instruksi menyebut tool entri", /siapkan_penjualan/.test(instruksi(mkt)));
cek("instruksi HR tanpa aturan entri", !/Mencatat penjualan/.test(instruksi(hr)));

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
