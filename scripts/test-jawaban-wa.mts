/**
 * Tes penguraian balasan konfirmasi WhatsApp (Tahap 3e).
 *
 * Tidak butuh WhatsApp, bot, database, atau server — yang diuji fungsi murni
 * di `lib/entri/jawaban-wa.ts`, yang dipakai `wa-bot/index.mts` apa adanya.
 *
 * Yang dijaga di sini: kata "BATAL" punya DUA arti waktu yang menunggu adalah
 * draf pembatalan, dan menebaknya berarti mengubah data yang tidak dimaksud.
 */
import {
  bacaJawabanBatal, bacaJawabanEntri, bacaJawabanKeputusan,
} from "../lib/entri/jawaban-wa.ts";

const lolos: string[] = [];
const gagal: string[] = [];

function cekBatal(teks: string, aksi: string, alasan?: string) {
  const h = bacaJawabanBatal(teks);
  const cocokAksi = h.aksi === aksi;
  const cocokAlasan = alasan === undefined || (h.aksi === "batalkan" && h.alasan === alasan);
  const nama = `"${teks}" → ${aksi}${alasan ? ` (${alasan})` : ""}`;
  (cocokAksi && cocokAlasan ? lolos : gagal).push(
    `${nama}${cocokAksi && cocokAlasan ? "" : ` — DAPAT ${h.aksi}${h.aksi === "batalkan" ? ` (${h.alasan})` : ""}`}`,
  );
}

function cekEntri(teks: string, harus: string) {
  const h = bacaJawabanEntri(teks);
  (h === harus ? lolos : gagal).push(`"${teks}" → ${harus}${h === harus ? "" : ` — DAPAT ${h}`}`);
}

console.log("--- draf PEMBATALAN: konfirmasi + alasan ---");
cekBatal("YA salah pelanggan", "batalkan", "salah pelanggan");
cekBatal("ya salah input qty", "batalkan", "salah input qty");
cekBatal("  Oke   dobel entri  ", "batalkan", "dobel entri");
cekBatal("batalkan pesanan dibatalkan pembeli", "batalkan", "pesanan dibatalkan pembeli");
cekBatal("Y salah produk", "batalkan", "salah produk");

console.log("--- draf PEMBATALAN: alasan belum ada ---");
// Draf DIPERTAHANKAN di kasus ini, supaya user tinggal mengulang.
cekBatal("YA", "minta-alasan");
cekBatal("ya", "minta-alasan");
cekBatal("oke", "minta-alasan");
cekBatal("batalkan", "minta-alasan");
cekBatal("ya   ", "minta-alasan");

console.log("--- draf PEMBATALAN: tidak jadi ---");
cekBatal("URUNG", "urung");
cekBatal("tidak", "urung");
cekBatal("jangan", "urung");
cekBatal("engga", "urung");

console.log("--- draf PEMBATALAN: kata yang ambigu ---");
// "BATAL" bisa berarti "ya batalkan ordernya" ATAU "jangan jadi".
// TIDAK boleh ditebak.
cekBatal("BATAL", "ambigu");
cekBatal("batal", "ambigu");
cekBatal("cancel", "ambigu");

console.log("--- draf PEMBATALAN: bukan jawaban ---");
cekBatal("berapa omzet bulan ini?", "bukan-jawaban");
cekBatal("", "bukan-jawaban");
cekBatal("hmm", "bukan-jawaban");

console.log("--- draf ENTRI: di sini BATAL tidak ambigu ---");
cekEntri("YA", "simpan");
cekEntri("simpan", "simpan");
cekEntri("BATAL", "buang");
cekEntri("tidak", "buang");
cekEntri("catat 5 lulur ke UD Sentosa", "bukan-jawaban");

function cekPutus(teks: string, aksi: string, alasan?: string) {
  const h = bacaJawabanKeputusan(teks);
  const cocokAksi = h.aksi === aksi;
  const cocokAlasan = alasan === undefined || (h.aksi === "tolak" && h.alasan === alasan);
  const nama = `"${teks}" → ${aksi}${alasan ? ` (${alasan})` : ""}`;
  (cocokAksi && cocokAlasan ? lolos : gagal).push(
    `${nama}${cocokAksi && cocokAlasan ? "" : ` — DAPAT ${h.aksi}`}`);
}

console.log("--- draf KEPUTUSAN: dua pilihan, 'YA' tidak cukup ---");
cekPutus("SETUJU", "setujui");
cekPutus("acc", "setujui");
cekPutus("TOLAK jam tidak sesuai absensi", "tolak", "jam tidak sesuai absensi");
cekPutus("tolak  lembur tidak dijadwalkan ", "tolak", "lembur tidak dijadwalkan");
cekPutus("TOLAK", "minta-alasan");
cekPutus("NANTI", "urung");
cekPutus("lewati", "urung");
// Inti aturannya: "ya" bisa berarti "ya setujui" ATAU "ya tolak saja".
cekPutus("YA", "ambigu");
cekPutus("oke", "ambigu");
cekPutus("batal", "ambigu");
cekPutus("berapa total lembur bulan ini?", "bukan-jawaban");

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
process.exit(gagal.length === 0 ? 0 : 1);
