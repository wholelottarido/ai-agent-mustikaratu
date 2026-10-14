/**
 * Pencarian kalimat berdasarkan MAKNA, bukan kata kunci.
 *
 * Masalah yang diselesaikan: "keluhan kemasan" tidak akan menemukan
 * "Tutup botolnya rusak" atau "Jar retak saat diterima" lewat LIKE, karena
 * kalimat itu tidak mengandung kata "kemasan". Terukur: agent cuma menemukan
 * 16 dari 58 keluhan kemasan waktu menebak kata kunci sendiri.
 *
 * Satu indeks per departemen -- isi indeks HR tidak boleh bocor ke agent
 * marketing, sama seperti database-nya.
 *
 * Indeksnya kecil (ratusan kalimat), jadi pencariannya cukup perbandingan
 * satu per satu di memori -- tidak perlu vector database terpisah.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { embed, awalanQuery, kemiripan, berkasIndeks } from "./embedding";
import type { KonfigDepartemen } from "./departemen";

export type EntriIndeks = {
  teks: string;
  tabel: string;
  kolom: string;
  /** Berapa baris di database yang isinya kalimat ini. */
  jumlah: number;
  vektor: number[];
};

type Indeks = {
  model: string;
  dimensi: number;
  dibuat: string;
  entri: EntriIndeks[];
};

export type HasilCari = Omit<EntriIndeks, "vektor"> & { skor: number };

/** Satu indeks per departemen, ditahan di memori setelah dibaca sekali. */
const KUNCI = Symbol.for("portal.indeks.teks");
type Global = typeof globalThis & { [KUNCI]?: Map<string, Indeks> };

function ambilIndeks(dep: KonfigDepartemen): Indeks {
  const g = globalThis as Global;
  g[KUNCI] ??= new Map();

  let idx = g[KUNCI].get(dep.id);
  if (!idx) {
    const berkas = join(process.cwd(), "data", berkasIndeks(dep.id));
    try {
      idx = JSON.parse(readFileSync(berkas, "utf8")) as Indeks;
    } catch {
      throw new Error(
        `Indeks teks departemen "${dep.id}" belum dibuat atau tidak terbaca. ` +
          `Jalankan: npm run index:teks -- ${dep.id}`,
      );
    }
    g[KUNCI].set(dep.id, idx);
  }
  return idx;
}

export function indeksSiap(dep: KonfigDepartemen): boolean {
  if (dep.kolomTeks.length === 0) return false;
  try {
    return ambilIndeks(dep).entri.length > 0;
  } catch {
    return false;
  }
}

/**
 * Cari kalimat yang paling dekat maknanya dengan `pertanyaan`.
 *
 * `ambang` menyaring hasil yang mirip-mirip saja. 0,80 dipilih dari
 * pengukuran: di bawah itu mulai masuk kalimat yang tidak relevan.
 * (Model e5 memberi skor dasar tinggi, jadi ambangnya memang besar.)
 */
export async function cariTeks(
  dep: KonfigDepartemen,
  pertanyaan: string,
  opsi: { batas?: number; ambang?: number; tabel?: string } = {},
): Promise<HasilCari[]> {
  const { batas = 15, ambang = 0.8, tabel } = opsi;
  const idx = ambilIndeks(dep);

  const [vQuery] = await embed([awalanQuery(pertanyaan)]);

  const kandidat = tabel ? idx.entri.filter((e) => e.tabel === tabel) : idx.entri;

  return kandidat
    .map((e) => ({
      teks: e.teks,
      tabel: e.tabel,
      kolom: e.kolom,
      jumlah: e.jumlah,
      skor: kemiripan(vQuery, e.vektor),
    }))
    .filter((h) => h.skor >= ambang)
    .sort((a, b) => b.skor - a.skor)
    .slice(0, batas);
}
