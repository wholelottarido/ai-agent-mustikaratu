/**
 * Rapor ketepatan ramalan: membaca hasil `scripts/buat-rapor-ramalan.mts` dan meringkasnya.
 *
 * Rapornya dihitung di luar portal karena satu putaran makan puluhan menit (AutoARIMA per
 * produk). Halaman hanya membaca berkasnya. Kalau berkasnya belum ada, halaman mengatakan itu,
 * bukan menampilkan angka kosong.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export type JenisRapor = "sekarang" | "dekat";

export type ProdukRapor = {
  sku: string;
  nama: string;
  merek: string | null;
  volume: "laris" | "sedang" | "kecil" | string;
  model: string;
  polaBulanan: boolean;
  unit: { ramalan: number[]; bawah: number[]; atas: number[]; aktual: number[]; ulangBulanTerakhir: number };
  rupiah: { ramalan: number[]; aktual: number[] } | null;
};

export type BerkasRapor = {
  jenis: JenisRapor;
  dataSampai: string;
  seolahSekarang: string;
  bulanDiuji: string[];
  jarak: [number, number];
  dibuat: string;
  jumlah: { diramal: number; berhenti: number; gagal: number };
  produk: ProdukRapor[];
};

export async function bacaRapor(jenis: JenisRapor): Promise<BerkasRapor | null> {
  try {
    const teks = await readFile(path.join(process.cwd(), "data", `rapor-ramalan-${jenis}.json`), "utf8");
    return JSON.parse(teks) as BerkasRapor;
  } catch {
    return null;
  }
}

const jumlah = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** Besar meleset, persen dari penjualan sebenarnya. `null` kalau penjualannya 0 semua. */
export function meleset(ramalan: number[], aktual: number[]): number | null {
  const dasar = jumlah(aktual.map(Math.abs));
  if (dasar === 0) return null;
  return (jumlah(ramalan.map((r, i) => Math.abs(r - aktual[i]))) / dasar) * 100;
}

/** Berapa bulan penjualan sebenarnya ada di dalam rentang. `null` kalau rentangnya tidak ada. */
export function masukRentang(p: ProdukRapor["unit"]): { masuk: number; dari: number } | null {
  if (p.bawah.length !== p.aktual.length || p.atas.length !== p.aktual.length) return null;
  const masuk = p.aktual.filter((a, i) => a >= p.bawah[i] && a <= p.atas[i]).length;
  return { masuk, dari: p.aktual.length };
}

export type Ringkasan = {
  produk: number;
  /** Meleset gabungan: selisih semua produk dibagi penjualan semua produk. */
  meleset: number | null;
  /** Meleset gabungan kalau angka bulan terakhir diulang saja. Pembanding. */
  melesetUlang: number | null;
  /** Persen bulan-produk yang penjualannya masuk rentang. */
  masukRentang: number | null;
  /** Total ramalan dibanding total sebenarnya, persen. Positif berarti ramalannya kebesaran. */
  selisihTotal: number | null;
  totalRamalan: number;
  totalAktual: number;
  /** Produk yang melesetnya di bawah 25%. */
  cukupTepat: number;
};

export function ringkas(daftar: ProdukRapor[]): Ringkasan {
  const r = daftar.flatMap((p) => p.unit.ramalan);
  const a = daftar.flatMap((p) => p.unit.aktual);
  const u = daftar.flatMap((p) => p.unit.aktual.map(() => p.unit.ulangBulanTerakhir));
  let masuk = 0, dari = 0;
  for (const p of daftar) {
    const m = masukRentang(p.unit);
    if (m) { masuk += m.masuk; dari += m.dari; }
  }
  const totalRamalan = jumlah(r), totalAktual = jumlah(a);
  return {
    produk: daftar.length,
    meleset: meleset(r, a),
    melesetUlang: meleset(u, a),
    masukRentang: dari > 0 ? (masuk / dari) * 100 : null,
    selisihTotal: totalAktual > 0 ? ((totalRamalan - totalAktual) / totalAktual) * 100 : null,
    totalRamalan,
    totalAktual,
    cukupTepat: daftar.filter((p) => { const m = meleset(p.unit.ramalan, p.unit.aktual); return m !== null && m < 25; }).length,
  };
}

export const URUTAN_VOLUME = ["laris", "sedang", "kecil"] as const;
