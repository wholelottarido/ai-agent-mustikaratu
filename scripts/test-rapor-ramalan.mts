/**
 * Uji hitungan rapor ketepatan ramalan, tanpa database.
 *
 *   npm run test:rapor-ramalan
 */
import { masukRentang, meleset, ringkas, type ProdukRapor } from "@/lib/ramalan/rapor";

let lolos = 0, gagal = 0;
function cek(nama: string, ok: boolean, info = "") {
  if (ok) lolos++; else gagal++;
  console.log(`  ${ok ? "LOLOS" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
}

const produk = (ramalan: number[], aktual: number[], bawah: number[], atas: number[], ulang: number, volume = "laris"): ProdukRapor => ({
  sku: "X", nama: "X", merek: null, volume, model: "SES", polaBulanan: false,
  unit: { ramalan, aktual, bawah, atas, ulangBulanTerakhir: ulang }, rupiah: null,
});

cek("meleset dihitung dari penjualan sebenarnya", meleset([110, 90], [100, 100]) === 10, String(meleset([110, 90], [100, 100])));
cek("penjualan nol semua tidak dibagi nol", meleset([5, 5], [0, 0]) === null);
cek("rentang termasuk batasnya", masukRentang(produk([100], [80], [80], [120], 0).unit)?.masuk === 1);
cek("rentang kosong tidak dihitung", masukRentang(produk([100], [80], [], [], 0).unit) === null);

const a = produk([100, 100, 100], [100, 200, 100], [50, 50, 50], [150, 150, 150], 100);
const b = produk([10, 10, 10], [0, 0, 0], [0, 0, 0], [20, 20, 20], 0, "kecil");
const r = ringkas([a, b]);
cek("meleset gabungan, bukan rata-rata per produk", Math.abs(r.meleset! - (130 / 400) * 100) < 1e-9, String(r.meleset));
cek("pembanding ulang bulan terakhir", Math.abs(r.melesetUlang! - (100 / 400) * 100) < 1e-9, String(r.melesetUlang));
cek("masuk rentang per bulan-produk", Math.abs(r.masukRentang! - (5 / 6) * 100) < 1e-9, String(r.masukRentang));
cek("selisih total bertanda", Math.abs(r.selisihTotal! - ((330 - 400) / 400) * 100) < 1e-9, String(r.selisihTotal));
cek("produk tanpa penjualan tidak dihitung tepat", r.cukupTepat === 0, String(r.cukupTepat));
cek("daftar kosong tidak melempar", ringkas([]).meleset === null);

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
