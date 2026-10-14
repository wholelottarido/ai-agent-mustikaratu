/**
 * Bandingkan dua model embedding pada pertanyaan yang sama.
 *
 * Diukur pada batas hasil TETAP (k=30) supaya presisi dan recall bisa
 * dibandingkan apple-to-apple. Kalau batasnya beda, recall tinggi bisa
 * datang cuma dari mengembalikan lebih banyak hasil -- bukan dari kualitas.
 *
 * Jalankan: npm run banding
 */
import { departemenDariArgv, sambungkan } from "./lib/dep.mts";
import { readFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";

const K = 30;
const AMBANG = 0.75;

/**
 * Nama berkas indeks ikut departemen (lihat `berkasIndeks()` di embedding.ts).
 * Dua-duanya harus sudah dibuat lebih dulu:
 *   EMBEDDING_MODEL="Xenova/multilingual-e5-small" npm run index:teks -- <dep>
 *   npm run index:teks -- <dep>
 */
const MODEL = [
  { nama: "e5-small (384d)", id: "Xenova/multilingual-e5-small", akhiran: "e5-small-q8" },
  { nama: "e5-base  (768d)", id: "Xenova/multilingual-e5-base", akhiran: "e5-base-q8" },
];

/** Kunci jawaban: kata kunci manual yang disusun seluas mungkin. */
const KASUS = [
  { q: "kemasan rusak bocor penyok tutup botol pecah", label: "kemasan",
    kunci: ["kemasan","packing","dus","bocor","penyok","retak","segel","tutup","pump","jar ","botol","bubble wrap","rembes","tumpah","pecah"] },
  { q: "pengiriman telat lama belum sampai ekspedisi", label: "pengiriman",
    kunci: ["telat","lambat","ekspedisi","resi","estimasi","belum sampe","belum sampai","gudang","terlambat"] },
  { q: "kulit gatal merah iritasi alergi setelah pakai", label: "iritasi",
    kunci: ["gatal","merah","iritasi","alergi","bengkak","perih","mengelupas","breakout"] },
  { q: "produk palsu tidak original ragu keaslian", label: "keaslian",
    kunci: ["palsu","original","barcode","keaslian","ragu","segel"] },
  { q: "harga mahal naik tidak sepadan", label: "harga",
    kunci: ["harga","mahal","naik","worth","ongkir"] },
];

const dep = departemenDariArgv();
const conn = await sambungkan(dep);

/** Tabel yang dipakai untuk membandingkan. Kasus uji di bawah khusus marketing. */
const TABEL = dep.kolomTeks[0]?.tabel ?? "customer_feedback";

/** Cari pakai indeks & model tertentu, tanpa lewat cache modul cari-teks. */
async function cari(berkas: string, modelId: string, q: string) {
  const idx = JSON.parse(readFileSync(berkas, "utf8"));
  const p = await pipeline("feature-extraction", modelId, { dtype: "q8" });
  const out = await p([`query: ${q}`], { pooling: "mean", normalize: true });
  const v = Array.from(out.data as Float32Array);

  return idx.entri
    .filter((e: any) => e.tabel === TABEL)
    .map((e: any) => {
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i] * e.vektor[i];
      return { teks: e.teks as string, skor: s };
    })
    .filter((h: any) => h.skor >= AMBANG)
    .sort((a: any, b: any) => b.skor - a.skor)
    .slice(0, K);
}

const hasil: Record<string, { recall: number; presisi: number }[]> = {};

for (const m of MODEL) {
  hasil[m.nama] = [];
  for (const k of KASUS) {
    const kondisi = k.kunci.map(() => "komentar LIKE ?").join(" OR ");
    const [ref] = await conn.query<any[]>(
      `SELECT id FROM customer_feedback WHERE ${kondisi}`,
      k.kunci.map((w) => `%${w}%`),
    );
    const idKunci = new Set(ref.map((r) => r.id as number));

    const h = await cari(`data/indeks-${dep.id}-${m.akhiran}.json`, m.id, k.q);
    let ids: number[] = [];
    if (h.length > 0) {
      const [b] = await conn.query<any[]>(
        `SELECT id FROM customer_feedback WHERE komentar IN (?)`,
        [h.map((x: any) => x.teks)],
      );
      ids = b.map((r) => r.id as number);
    }
    const benar = ids.filter((id) => idKunci.has(id)).length;
    hasil[m.nama].push({
      recall: idKunci.size ? (benar / idKunci.size) * 100 : 0,
      presisi: ids.length ? (benar / ids.length) * 100 : 0,
    });
  }
}

const p = (s: string, n: number) => s.padEnd(n);
console.log(`\nPerbandingan pada k=${K}, ambang=${AMBANG}\n`);
console.log(p("Kasus", 14) + p("e5-small recall", 17) + p("presisi", 10) + p("e5-base recall", 17) + "presisi");
console.log("-".repeat(70));
KASUS.forEach((k, i) => {
  const a = hasil["e5-small (384d)"][i];
  const b = hasil["e5-base  (768d)"][i];
  console.log(
    p(k.label, 14) +
      p(`${a.recall.toFixed(0)}%`, 17) + p(`${a.presisi.toFixed(0)}%`, 10) +
      p(`${b.recall.toFixed(0)}%`, 17) + `${b.presisi.toFixed(0)}%`,
  );
});
console.log("-".repeat(70));
const rata = (arr: { recall: number; presisi: number }[], f: "recall" | "presisi") =>
  (arr.reduce((s, x) => s + x[f], 0) / arr.length).toFixed(0);
console.log(
  p("RATA-RATA", 14) +
    p(`${rata(hasil["e5-small (384d)"], "recall")}%`, 17) + p(`${rata(hasil["e5-small (384d)"], "presisi")}%`, 10) +
    p(`${rata(hasil["e5-base  (768d)"], "recall")}%`, 17) + `${rata(hasil["e5-base  (768d)"], "presisi")}%`,
);

await conn.end();
