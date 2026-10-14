/**
 * Bikin indeks vektor dari kolom teks di MySQL.
 *
 * Yang di-index adalah KALIMAT UNIK, bukan tiap baris. Dari 1.575 baris
 * cuma ada ~649 kalimat berbeda -- meng-embed yang sama berulang kali itu
 * buang waktu, dan hasil pencariannya pun bakal penuh duplikat.
 *
 * Hasilnya disimpan ke data/indeks-<departemen>-<model>.json supaya aplikasi
 * tidak perlu menghitung ulang tiap nyala.
 *
 * Jalankan: npm run index:teks -- marketing
 * Ulangi setiap kali isi kolom teks berubah.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { departemenDariArgv, sambungkan } from "./lib/dep.mts";
import {
  embed, awalanPassage, MODEL_EMBEDDING, DIMENSI, berkasIndeks,
} from "../voltagent/embedding.ts";

const dep = departemenDariArgv();

// Kolom teks datang dari konfigurasi departemen, bukan ditulis di sini.
const SUMBER = dep.kolomTeks;
if (SUMBER.length === 0) {
  console.error(`Departemen "${dep.id}" tidak punya kolom teks. Tidak ada yang di-index.`);
  process.exit(1);
}
const conn = await sambungkan(dep);

// --- Kumpulkan kalimat unik per kolom ---
type Entri = { teks: string; tabel: string; kolom: string; jumlah: number };
const entri: Entri[] = [];

for (const s of SUMBER) {
  const [rows] = await conn.query<any[]>(
    `SELECT \`${s.kolom}\` AS teks, COUNT(*) AS jumlah
       FROM \`${s.tabel}\`
      WHERE \`${s.kolom}\` IS NOT NULL AND \`${s.kolom}\` <> ''
      GROUP BY \`${s.kolom}\``,
  );
  for (const r of rows) {
    entri.push({ teks: r.teks, tabel: s.tabel, kolom: s.kolom, jumlah: Number(r.jumlah) });
  }
  console.log(`${s.tabel}.${s.kolom}: ${rows.length} kalimat unik`);
}
await conn.end();

console.log(`\nTotal ${entri.length} kalimat unik. Memuat model ${MODEL_EMBEDDING}...`);
console.log("(unduhan pertama ~112 MB, selanjutnya dari cache)\n");

// --- Embed bertahap supaya RAM tidak melonjak ---
const UKURAN_BATCH = 32;
const vektor: number[][] = [];
const mulai = Date.now();

for (let i = 0; i < entri.length; i += UKURAN_BATCH) {
  const potong = entri.slice(i, i + UKURAN_BATCH);
  const hasil = await embed(potong.map((e) => awalanPassage(e.teks)));
  vektor.push(...hasil);
  const selesai = Math.min(i + UKURAN_BATCH, entri.length);
  const detik = ((Date.now() - mulai) / 1000).toFixed(0);
  process.stdout.write(`\r  ${selesai}/${entri.length} kalimat (${detik} detik)`);
}
console.log();

if (vektor[0].length !== DIMENSI) {
  throw new Error(`Dimensi tidak cocok: dapat ${vektor[0].length}, diharapkan ${DIMENSI}`);
}

// --- Simpan ---
mkdirSync("data", { recursive: true });
const indeks = {
  model: MODEL_EMBEDDING,
  dimensi: DIMENSI,
  dibuat: new Date().toISOString(),
  entri: entri.map((e, i) => ({
    teks: e.teks,
    tabel: e.tabel,
    kolom: e.kolom,
    jumlah: e.jumlah,
    // Dibulatkan 5 desimal -- memangkas ukuran file ~40% tanpa
    // mengubah hasil pencarian secara berarti.
    vektor: vektor[i].map((v) => Number(v.toFixed(5))),
  })),
};
const berkas = berkasIndeks(dep.id);
writeFileSync(`data/${berkas}`, JSON.stringify(indeks), "utf8");

const totalDetik = ((Date.now() - mulai) / 1000).toFixed(0);
console.log(`
OK -> data/${berkas}  (departemen ${dep.id}, model ${MODEL_EMBEDDING})`);
console.log(`     ${entri.length} kalimat, ${DIMENSI} dimensi, ${totalDetik} detik`);
