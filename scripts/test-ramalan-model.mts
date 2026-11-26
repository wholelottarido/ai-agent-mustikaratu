/**
 * Uji tiga model peramalan.
 *
 *   npm run test:ramalan-model
 *
 * TIDAK menyentuh database sama sekali — deretnya ditulis di sini. Jadi uji
 * ini tetap hijau walau PostgreSQL mati, dan yang merah berarti modelnya yang
 * rusak, bukan datanya yang berubah.
 *
 * ============================================================
 * YANG DIJAGA
 * ============================================================
 * Tiga penjagaan yang kalau lepas TIDAK menimbulkan galat:
 *
 *   1. Kebisingan WASM. `arima` menulis ratusan huruf peringatan langsung ke
 *      stdout tiap dipanggil, dan `verbose: false` tidak membungkamnya.
 *      Lepas = log server tenggelam.
 *   2. Hasil tidak sah. `NaN` atau negatif yang lolos akan jadi "ramalan"
 *      yang ditampilkan ke pemakai sebagai angka.
 *   3. Gagal diam. Model yang gagal lalu memulangkan angka pengganti adalah
 *      bentuk kegagalan paling berbahaya di proyek ini.
 */
import { naive, musiman, arima, modelYangMungkin, SEMUA_MODEL } from "../lib/ramalan/model.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

/** 36 bulan: tren turun + puncak tiap Desember. Meniru bentuk data nyata. */
const DERET = Array.from({ length: 36 }, (_, i) =>
  Math.round(1400 - i * 8 + [0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 160, 300][i % 12]));

// ============================================================
console.log("=== 1. Naive ===");
// ============================================================
{
  const h = naive.ramal([100, 200, 300], 3);
  cek("mengulang nilai terakhir", h.ok && h.nilai.join(",") === "300,300,300", h.ok ? h.nilai.join(",") : h.sebab);
  cek("deret 1 titik ditolak", !naive.ramal([100], 3).ok);
  const panjang = naive.ramal([10, 20], 6);
  cek("horizon dituruti", panjang.ok && panjang.nilai.length === 6);
}

// ============================================================
console.log("\n=== 2. Musiman ===");
// ============================================================
{
  // 24 bulan: tahun kedua = tahun pertama + 100, supaya yang disalin jelas.
  const d = [...Array(12).keys()].map((i) => 100 + i * 10);
  const dd = [...d, ...d.map((x) => x + 100)];
  const h = musiman.ramal(dd, 3);
  // Titik ke-24,25,26 (0-indeks) menyalin titik ke-12,13,14 = 200, 210, 220.
  cek("menyalin bulan yang sama tahun lalu",
    h.ok && h.nilai.join(",") === "200,210,220", h.ok ? h.nilai.join(",") : h.sebab);
  cek("deret <12 bulan ditolak", !musiman.ramal([1, 2, 3], 3).ok,
    (musiman.ramal([1, 2, 3], 3) as { sebab: string }).sebab);

  // ⚠️ HORIZON LEBIH PANJANG DARI SATU SIKLUS.
  //
  // Versi pertama kode ini membaca `deret[panjang + i - 12]` begitu saja.
  // Pada titik ke-13 indeksnya melewati ujung deret dan menghasilkan
  // `undefined`, yang baru ketahuan di `sahkan()` sebagai "bukan angka" —
  // pesan yang tidak menunjuk sebabnya sama sekali.
  //
  // ⚠️ DAN VERSI PERTAMA UJI INI JUGA SALAH: ia menuntut titik ke-13 BERBEDA
  // dari titik ke-1. Untuk musiman berperiode 12 keduanya memang HARUS sama —
  // itu arti "musiman". Yang perlu dijaga bukan perbedaannya, melainkan bahwa
  // horizon panjang tidak menghasilkan nilai kosong.
  const jauh = musiman.ramal(dd, 14);
  cek("horizon 14 tetap menghasilkan 14 angka sah",
    jauh.ok && jauh.nilai.length === 14 && jauh.nilai.every(Number.isFinite),
    jauh.ok ? jauh.nilai.slice(0, 3).join(", ") + ", …" : jauh.sebab);
  cek("12 titik pertama menyalin tahun terakhir",
    jauh.ok && jauh.nilai.slice(0, 12).join(",") === dd.slice(12).join(","));
  // Siklus berulang: titik ke-13 = titik ke-1. Itu sifat yang benar.
  cek("siklusnya berulang tiap 12 bulan",
    jauh.ok && jauh.nilai[12] === jauh.nilai[0] && jauh.nilai[13] === jauh.nilai[1],
    jauh.ok ? `${jauh.nilai[12]} = ${jauh.nilai[0]}` : "-");
}

// ============================================================
console.log("\n=== 3. AutoARIMA ===");
// ============================================================
{
  // ⚠️ KEBISINGAN WASM. Kalau pembungkamnya lepas, ratusan huruf
  // "Warning : The Matrix system..." akan tertulis di sini dan terhitung.
  let bising = 0;
  const asli = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c: unknown, ...a: unknown[]) => {
    bising += String(c).length;
    return asli(c as string, ...(a as []));
  };
  const mulai = Date.now();
  const h = arima.ramal(DERET, 3);
  process.stdout.write = asli;
  const detik = ((Date.now() - mulai) / 1000).toFixed(2);

  cek("meramal dari 36 bulan", h.ok,
    h.ok ? `${h.nilai.join(", ")} (${detik} dtk, ${h.dipangkas} dipangkas)` : h.sebab);
  cek("kebisingan WASM dibungkam", bising === 0, `${bising} huruf bocor ke stdout`);
  cek("hasilnya bilangan bulat", h.ok && h.nilai.every(Number.isInteger));
  // ⚠️ Yang keluar TIDAK PERNAH negatif, tapi pemangkasannya DILAPORKAN.
  // Hasil 0,0,0 dari model yang meramal -400 tidak sama dengan 0,0,0 dari
  // model yang memang melihat penjualan berhenti.
  cek("keluaran tidak pernah negatif", h.ok && h.nilai.every((v) => v >= 0));
  cek("pemangkasan dilaporkan, bukan disembunyikan",
    h.ok && typeof h.dipangkas === "number", h.ok ? `${h.dipangkas} dipangkas` : "-");

  // Batas 26 itu KERAS — diukur, bukan diduga.
  const pendek = arima.ramal(DERET.slice(0, 25), 3);
  cek("deret 25 bulan ditolak", !pendek.ok, (pendek as { sebab: string }).sebab.slice(0, 48));
  cek("penolakannya memakai kalimat kita, bukan pesan paket",
    !pendek.ok && /minimal 26 bulan/.test(pendek.sebab), (pendek as { sebab: string }).sebab.slice(0, 40));
}

// ============================================================
console.log("\n=== 4. Deret sulit: gagal harus MENGAKU ===");
// ============================================================
// ⚠️ Yang diperiksa bukan "berhasil", tapi "kalau gagal, mengaku". Model yang
// memulangkan angka pengganti waktu gagal adalah kegagalan paling berbahaya:
// hasilnya terlihat sah dan tidak ada yang bisa membedakannya.
for (const [nama, deret] of [
  ["semua nol", Array(36).fill(0)],
  ["datar", Array(36).fill(50)],
  ["lonjakan ekstrem", [...Array(35).fill(10), 999999]],
  ["banyak nol di tengah", Array.from({ length: 36 }, (_, i) => (i % 3 === 0 ? 120 : 0))],
] as const) {
  for (const m of SEMUA_MODEL) {
    const h = m.ramal([...deret], 3);
    const aman = h.ok
      ? h.nilai.every((v) => Number.isFinite(v) && v >= 0 && Number.isInteger(v))
        && h.dipangkas >= 0 && h.dipangkas <= h.nilai.length
      : typeof h.sebab === "string" && h.sebab.length > 0;
    cek(`${nama.padEnd(20)} ${m.kode.padEnd(8)} ${h.ok ? "berhasil" : "mengaku gagal"}`, aman,
      h.ok ? h.nilai.join(", ") : h.sebab.slice(0, 44));
  }
}

// ============================================================
console.log("\n=== 5. Penyaring model menurut panjang deret ===");
// ============================================================
// ⚠️ Daftarnya tumbuh waktu lima model permintaan terputus masuk (27 Okt
// 2026), jadi asersinya ditulis ulang. Yang dijaga TETAP sama: penyaring ini
// menyaring MENURUT PANJANG DERET dan tidak pernah meloloskan model yang
// datanya kurang. Menuliskan daftar lengkapnya di sini akan membuat uji ini
// merah tiap kali ada model baru, tanpa ada yang rusak.
cek("2 bulan -> ses saja", modelYangMungkin(2).map((m) => m.kode).join(",") === "ses");
cek("naive tidak lagi bisa terpilih, hanya pembanding", !modelYangMungkin(100).some((m) => m.kode === "naive"));
cek("1 bulan -> tidak ada model", modelYangMungkin(1).length === 0);
cek("6 bulan -> model permintaan terputus masuk",
  modelYangMungkin(6).map((m) => m.kode).join(",") === "ses,croston,sba,tsb,adida,imapa",
  modelYangMungkin(6).map((m) => m.kode).join(","));
cek("12 bulan -> musiman menyusul", modelYangMungkin(12).some((m) => m.kode === "musiman"));
cek("25 bulan -> arima BELUM masuk", !modelYangMungkin(25).some((m) => m.kode === "arima"));
cek("26 bulan -> semuanya", modelYangMungkin(26).length === SEMUA_MODEL.length,
  `${modelYangMungkin(26).length} dari ${SEMUA_MODEL.length}`);
cek("tidak ada model yang lolos di bawah minimalnya",
  SEMUA_MODEL.every((m) => !modelYangMungkin(m.minimal - 1).includes(m)));

console.log(`\n${lolos} lolos, ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
