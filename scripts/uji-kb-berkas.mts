/**
 * Membuktikan bahwa isi basis pengetahuan BENAR-BENAR berasal dari PDF.
 *
 *   npm run uji:kb-berkas
 *
 * ⚠️ KENAPA PERLU DIBUKTIKAN, BUKAN DIPERCAYA.
 *
 * Pipeline-nya (`pasang:kb-pdf`) memang menulis dari hasil baca balik PDF.
 * Tapi "memang begitu waktu ditulis" tidak sama dengan "masih begitu
 * sekarang": potongan bisa tersisa dari versi lama, berkasnya bisa diganti
 * tanpa potongannya ikut dihitung ulang, atau model embedding bisa berganti
 * sehingga vektornya tidak lagi mewakili teksnya.
 *
 * Tiga hal yang diperiksa, dari yang paling lemah ke yang paling kuat:
 *
 *   1. Teks potongan ADA di dalam PDF-nya.
 *   2. Nomor halaman & baris MENUNJUK ke teks itu, bukan ke tempat lain.
 *      -> ini yang dipakai user untuk memeriksa sendiri; kalau meleset,
 *         dia membuka halaman yang salah dan tetap percaya.
 *   3. Vektornya dihitung dari teks ITU. Dibuktikan dengan menghitung ulang
 *      dan membandingkan -- kemiripannya harus ~1,000.
 *
 * Nomor 3 yang paling menentukan. Tanpa itu, potongan bisa saja berasal dari
 * PDF sementara vektornya warisan teks lama, dan pencariannya akan menemukan
 * hal yang tidak sesuai dengan yang ditampilkan.
 */
import { createHash } from "node:crypto";
import { Client } from "pg";
import { bacaPdfPerHalaman } from "../lib/kb/pdf.ts";
import { teksUntukVektor } from "../lib/kb/cari.ts";
import { embed, awalanPassage, kemiripan, MODEL_EMBEDDING } from "../voltagent/embedding.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) {
    lolos++;
    console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`);
  }
}

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER,
  password: process.env.DEMO_PG_PASSWORD,
  statement_timeout: 120_000,
});
await c.connect();

console.log(`model embedding: ${MODEL_EMBEDDING}\n`);

// ============================================================
console.log("=== 1. Tiap dokumen punya berkas ===");
// ============================================================
const ringkas = await c.query(`
  SELECT (SELECT COUNT(*)::int FROM ai_kb_dokumen)                          dokumen,
         (SELECT COUNT(*)::int FROM ai_kb_berkas)                           berkas,
         (SELECT COUNT(*)::int FROM ai_kb_potongan)                         potongan,
         (SELECT COUNT(*)::int FROM ai_kb_potongan WHERE halaman IS NULL)   tanpa_halaman,
         (SELECT COUNT(*)::int FROM ai_kb_potongan WHERE vektor IS NULL)    tanpa_vektor,
         (SELECT COALESCE(SUM(LENGTH(bita)), 0)::int FROM ai_kb_berkas)     total_bita`);
const r0 = ringkas.rows[0] as Record<string, number>;
console.log(
  `  ${r0.dokumen} dokumen · ${r0.berkas} berkas · ${r0.potongan} potongan · ` +
    `${Math.round(r0.total_bita / 1024)} KB total`,
);
cek("tiap dokumen punya berkas PDF", r0.dokumen === r0.berkas, `${r0.berkas}/${r0.dokumen}`);
cek("tidak ada potongan tanpa halaman", r0.tanpa_halaman === 0, `${r0.tanpa_halaman} tanpa halaman`);
cek("tidak ada potongan tanpa vektor", r0.tanpa_vektor === 0, `${r0.tanpa_vektor} tanpa vektor`);

// ============================================================
console.log("\n=== 2. Berkasnya utuh (sha256 cocok) ===");
// ============================================================
const berkas = await c.query(`
  SELECT b.id_dokumen, d.kode, b.bita, b.sha256, b.halaman
    FROM ai_kb_berkas b JOIN ai_kb_dokumen d USING (id_dokumen) ORDER BY d.kode`);
type Berkas = { id_dokumen: string; kode: string; bita: Buffer; sha256: string; halaman: number };
let shaBeda = 0;
for (const b of berkas.rows as Berkas[]) {
  if (createHash("sha256").update(b.bita).digest("hex") !== b.sha256) shaBeda++;
}
cek("sha256 cocok untuk semua berkas", shaBeda === 0, `${shaBeda} tidak cocok`);

// ============================================================
console.log("\n=== 3. Rujukan halaman & baris menunjuk ke teks yang benar ===");
// ============================================================
// Inilah yang dipakai user untuk memeriksa sendiri. Dicocokkan BARIS PER
// BARIS, bukan sekadar "teksnya ada di suatu tempat di dokumen".
const potongan = await c.query(`
  SELECT p.id_dokumen, d.kode, p.urutan, p.teks, p.halaman, p.baris_awal, p.baris_akhir
    FROM ai_kb_potongan p JOIN ai_kb_dokumen d USING (id_dokumen)
   ORDER BY d.kode, p.urutan`);
type Pot = {
  id_dokumen: string; kode: string; urutan: number; teks: string;
  halaman: number; baris_awal: number; baris_akhir: number;
};

const halamanPerDok = new Map<string, string[]>();
for (const b of berkas.rows as Berkas[]) {
  halamanPerDok.set(b.id_dokumen, await bacaPdfPerHalaman(new Uint8Array(b.bita)));
}

let adaDiPdf = 0;
let barisTepat = 0;
const salah: string[] = [];
for (const p of potongan.rows as Pot[]) {
  const halaman = halamanPerDok.get(p.id_dokumen) ?? [];
  const isiHal = halaman[p.halaman - 1] ?? "";
  const barisHal = isiHal.split("\n").filter((x) => x.trim() !== "");

  // (a) teksnya memang ada di halaman itu
  const rapat = (s: string) => s.replace(/\s+/g, " ").trim();
  if (rapat(isiHal).includes(rapat(p.teks))) adaDiPdf++;

  // (b) rentang barisnya persis berisi teks itu
  const potong = barisHal.slice(p.baris_awal - 1, p.baris_akhir).join("\n");
  if (rapat(potong) === rapat(p.teks)) barisTepat++;
  else if (salah.length < 3) {
    salah.push(
      `${p.kode}#${p.urutan} hal ${p.halaman} baris ${p.baris_awal}-${p.baris_akhir}\n` +
        `        tersimpan: ${rapat(p.teks).slice(0, 72)}\n` +
        `        di PDF   : ${rapat(potong).slice(0, 72)}`,
    );
  }
}
const n = potongan.rows.length;
cek("teks potongan ADA di PDF-nya", adaDiPdf === n, `${adaDiPdf}/${n}`);
cek("rentang baris MENUNJUK teks itu persis", barisTepat === n, `${barisTepat}/${n}`);
for (const s of salah) console.log(`         ${s}`);

// ============================================================
console.log("\n=== 4. Vektornya dihitung dari teks yang tersimpan ===");
// ============================================================
// Uji terkuat: hitung ulang vektornya dari teks yang ada di database, lalu
// bandingkan dengan vektor yang tersimpan. Kalau vektornya warisan teks lama,
// kemiripannya akan jauh di bawah 1.
const contoh = await c.query(`
  SELECT d.kode, d.judul, p.urutan, p.teks, p.vektor::text AS vektor
    FROM ai_kb_potongan p JOIN ai_kb_dokumen d USING (id_dokumen)
   ORDER BY random() LIMIT 12`);
type Uji = { kode: string; judul: string; urutan: number; teks: string; vektor: string };
const baris = contoh.rows as Uji[];
// ⚠️ Resep yang SAMA dengan yang dipakai menulis -- diimpor, bukan diketik ulang.
const ulang = await embed(baris.map((x) => awalanPassage(teksUntukVektor(x.judul, x.teks))));

let cocok = 0;
let palingRendah = 1;
for (let i = 0; i < baris.length; i++) {
  const tersimpan = JSON.parse(baris[i].vektor) as number[];
  const skor = kemiripan(tersimpan, ulang[i]);
  if (skor < palingRendah) palingRendah = skor;
  if (skor > 0.999) cocok++;
  else console.log(`         ${baris[i].kode}#${baris[i].urutan} kemiripan ${skor.toFixed(4)}`);
}
cek(
  "vektor tersimpan = vektor teksnya (12 contoh acak)",
  cocok === baris.length,
  `${cocok}/${baris.length}, terendah ${palingRendah.toFixed(4)}`,
);

// ============================================================
console.log("\n=== 5. Rujukan yang akan dilihat user ===");
// ============================================================
const contohRujukan = await c.query(`
  SELECT d.kode, d.judul, p.halaman, p.baris_awal, p.baris_akhir, LEFT(p.teks, 64) cuplik
    FROM ai_kb_potongan p JOIN ai_kb_dokumen d USING (id_dokumen)
   WHERE d.kode IN ('SOP-IT-005','SOP-HR-001') ORDER BY d.kode, p.urutan LIMIT 6`);
for (const x of contohRujukan.rows as Record<string, unknown>[]) {
  console.log(
    `  ${x.kode} hal ${x.halaman} baris ${x.baris_awal}-${x.baris_akhir} · ` +
      `${String(x.cuplik).replace(/\s+/g, " ")}…`,
  );
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exitCode = gagal === 0 ? 0 : 1;
await c.end();
