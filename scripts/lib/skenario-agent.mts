/**
 * Skenario benchmark agent Q1–Q8 → jenis evaluator v2. Satu tempat, dipakai bersama oleh
 * scripts/profil-alur-agent.mts (uji) dan scripts/evaluasi-ulang-v2.mts (penilaian ulang data lama).
 * Ini SKENARIO UJI, bukan logika aplikasi: aplikasi tidak pernah membaca berkas ini.
 */
import type { Jenis } from "./evaluator-agent.mts";

export type Harapan = { q1_angka: number; q1_periode: string };

export function jenisSkenario(kode: string, h: Harapan): Jenis | null {
  switch (kode) {
    case "Q1": return { jenis: "data-angka", alat: /^total_penjualan$/, angka: h.q1_angka, periode: h.q1_periode };
    case "Q2": return { jenis: "data-alat", alat: /^pergerakan_penjualan$/ };
    case "Q3": return { jenis: "data-alat", alat: /^stok_kosong$/ };
    case "Q4": return { jenis: "sop", alat: /^cari_sop$/ };
    case "Q5": return { jenis: "rancangan", alatRancangan: /^(siapkan_|buat_)/ };
    case "Q6": return { jenis: "data-alat", alat: /karyawan/ };
    case "Q7": return { jenis: "tolak", larangan: /Rp\s?\d/ };
    case "Q8": return { jenis: "sapaan" };
    default: return null;
  }
}
