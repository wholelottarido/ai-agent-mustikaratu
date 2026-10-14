/**
 * Ukur kualitas pencarian semantik terhadap kunci jawaban dari SQL.
 *
 * Cara ukurnya: untuk tiap pertanyaan uji, hitung berapa BARIS database
 * yang berhasil dijangkau -- bukan berapa kalimat. Satu kalimat bisa muncul
 * di banyak baris, dan yang penting buat user adalah jumlah keluhannya.
 *
 * Pembanding: agent tanpa pencarian semantik cuma menemukan 16 dari 58
 * keluhan kemasan, karena menebak kata kunci sendiri.
 *
 * Jalankan: npm run test:cari
 */
import { departemenDariArgv, sambungkan } from "./lib/dep.mts";
import { cariTeks } from "../voltagent/cari-teks.ts";

const dep = departemenDariArgv();
const conn = await sambungkan(dep);

/** Kunci jawaban: daftar kata kunci yang disusun manual, seluas mungkin. */
const KASUS = [
  {
    pertanyaan: "keluhan soal kemasan",
    kunci: ["kemasan", "packing", "dus", "bocor", "penyok", "retak", "segel",
            "tutup", "pump", "jar ", "botol", "bubble wrap", "rembes", "tumpah", "pecah"],
  },
  {
    pertanyaan: "komplain pengiriman lambat",
    kunci: ["telat", "lama", "lambat", "ekspedisi", "resi", "estimasi",
            "belum sampe", "belum sampai", "dikirim", "gudang"],
  },
  {
    pertanyaan: "produk bikin kulit iritasi",
    kunci: ["gatal", "merah", "iritasi", "alergi", "bengkak", "perih",
            "mengelupas", "jerawat baru", "breakout"],
  },
  {
    pertanyaan: "customer curiga produknya palsu",
    kunci: ["palsu", "asli", "original", "segel", "barcode", "keaslian", "ragu"],
  },
  {
    pertanyaan: "keluhan soal harga",
    kunci: ["harga", "mahal", "naik", "worth", "ongkir"],
  },
];

const lebar = (s: string, n: number) => s.padEnd(n).slice(0, n);
console.log("Pencarian semantik vs kunci jawaban SQL\n");
console.log(lebar("Pertanyaan", 34) + lebar("Kunci", 8) + lebar("Ketemu", 8) + "Recall");
console.log("-".repeat(62));

let totalKunci = 0;
let totalKetemu = 0;

for (const k of KASUS) {
  // Kunci jawaban: baris yang cocok dengan SALAH SATU kata kunci manual.
  const kondisi = k.kunci.map(() => "komentar LIKE ?").join(" OR ");
  const [ref] = await conn.query<any[]>(
    `SELECT id FROM customer_feedback WHERE ${kondisi}`,
    k.kunci.map((w) => `%${w}%`),
  );
  const idKunci = new Set(ref.map((r) => r.id as number));

  // Hasil pencarian semantik -> kalimatnya -> baris mana saja yang isinya itu.
  const hasil = await cariTeks(dep, k.pertanyaan, { batas: 25, tabel: "customer_feedback" });
  let idKetemu = new Set<number>();
  if (hasil.length > 0) {
    const [baris] = await conn.query<any[]>(
      `SELECT id FROM customer_feedback WHERE komentar IN (?)`,
      [hasil.map((h) => h.teks)],
    );
    idKetemu = new Set(baris.map((r) => r.id as number));
  }

  const irisan = [...idKetemu].filter((id) => idKunci.has(id)).length;
  const recall = idKunci.size > 0 ? (irisan / idKunci.size) * 100 : 0;
  totalKunci += idKunci.size;
  totalKetemu += irisan;

  console.log(
    lebar(k.pertanyaan, 34) +
      lebar(String(idKunci.size), 8) +
      lebar(String(irisan), 8) +
      `${recall.toFixed(0)}%`,
  );
}

console.log("-".repeat(62));
console.log(
  lebar("TOTAL", 34) + lebar(String(totalKunci), 8) + lebar(String(totalKetemu), 8) +
    `${((totalKetemu / totalKunci) * 100).toFixed(0)}%`,
);

// Contoh: kalimat apa yang ketemu untuk "keluhan kemasan"?
console.log("\nContoh hasil 'keluhan soal kemasan' (10 teratas):");
const contoh = await cariTeks(dep, "keluhan soal kemasan", { batas: 10, tabel: "customer_feedback" });
for (const h of contoh) {
  console.log(`  ${h.skor.toFixed(3)}  (${h.jumlah}x)  ${h.teks.slice(0, 72)}`);
}

await conn.end();
