/**
 * Berapa RAM yang ditambah model embedding ke proses yang memuatnya.
 *
 *   npm run ukur:ram
 *
 * ⚠️ KENAPA DIUKUR SENDIRI, BUKAN DI DALAM `test:kb-tool`.
 *
 * Di sana model sudah termuat sebelum angkanya dibaca, dan prosesnya juga
 * menampung pool database serta hasil sebelas bagian uji -- angka yang keluar
 * benar untuk proses itu tapi tidak menjawab "berapa tambahan modelnya".
 * Memisahkannya menuntut proses yang bersih, dan itu berkas ini.
 *
 * ⚠️ KENAPA ANGKA INI PENTING.
 *
 * `embedding.ts` menyimpan pipeline di variabel modul (`pipa ??=`), jadi
 * modelnya dimuat sekali lalu TIDAK pernah dilepas. Di produksi, proses yang
 * memuatnya adalah proses Next.js yang juga melayani chat. Laptop ini 7,3 GB
 * dengan sisa 0,0-0,4 GB, dan sudah pernah gagal "bad allocation" waktu
 * mencoba varian fp32. Jadi tambahan ini menentukan apakah pencarian SOP boleh
 * jalan di proses web, atau harus dipindah ke proses sendiri.
 */
import { embed, awalanQuery, MODEL_EMBEDDING, DTYPE, DIMENSI } from "../voltagent/embedding.ts";

const mb = (n: number) => Math.round(n / 1024 / 1024);

function ambil(nama: string) {
  const m = process.memoryUsage();
  return {
    nama,
    rss: mb(m.rss),
    heap: mb(m.heapUsed),
    luarHeap: mb(m.external + m.arrayBuffers),
  };
}

console.log(`model  : ${MODEL_EMBEDDING}`);
console.log(`presisi: ${DTYPE}, ${DIMENSI} dimensi\n`);

const titik = [ambil("sebelum model dimuat")];

// Panggilan pertama: memuat model DAN menghitung satu vektor.
const a = Date.now();
await embed([awalanQuery("uji pemuatan model")]);
const detikMuat = (Date.now() - a) / 1000;
titik.push(ambil("sesudah panggilan pertama"));

// Panggilan berikutnya memakai model yang sama -- yang diukur di sini apakah
// ada kebocoran per pemanggilan, bukan biaya pemuatan.
const b = Date.now();
await embed(Array.from({ length: 20 }, (_, i) => awalanQuery(`kalimat uji nomor ${i}`)));
const detik20 = (Date.now() - b) / 1000;
titik.push(ambil("sesudah 20 kalimat"));

console.log("                            RSS     heap   luar-heap");
for (const t of titik) {
  console.log(
    `  ${t.nama.padEnd(26)} ${String(t.rss).padStart(4)} MB ${String(t.heap).padStart(4)} MB ${String(t.luarHeap).padStart(6)} MB`,
  );
}

const tambahanMuat = titik[1].rss - titik[0].rss;
const tambahan20 = titik[2].rss - titik[1].rss;

console.log(`\n  tambahan karena memuat model : ${tambahanMuat} MB`);
console.log(`  tambahan 20 kalimat sesudahnya: ${tambahan20} MB`);
console.log(`  waktu muat + 1 vektor         : ${detikMuat.toFixed(1)} detik`);
console.log(`  waktu 20 vektor sesudahnya    : ${detik20.toFixed(1)} detik`);

console.log(
  `\n  Artinya: panggilan PERTAMA setelah server hidup menanggung ~${detikMuat.toFixed(0)} detik,` +
    "\n  sesudah itu cepat. Yang perlu diwaspadai bukan kecepatannya, tapi" +
    `\n  ${tambahanMuat} MB yang tidak pernah dilepas.`,
);

process.exitCode = 0;
