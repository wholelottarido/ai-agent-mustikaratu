/**
 * Uji batas privasi riset pasar — pintu keluar ke internet.
 *
 *   npm run test:pasar-kueri
 *
 * TIDAK menyentuh database, TIDAK menyentuh internet, TIDAK butuh kunci API.
 *
 * ============================================================
 * YANG DIJAGA
 * ============================================================
 * Satu hal, dan kalau lepas tidak akan ada galat apa pun: **data perusahaan
 * ikut keluar ke penyedia pencarian**. Tidak ada pesan error, tidak ada yang
 * merah di layar, dan yang terjadi cuma angka penjualan Mustika Ratu tercatat
 * di log pihak ketiga.
 *
 * Karena itu penjagaannya berlapis dan diuji berlapis:
 *
 *   1. `KonteksPublik` cuma punya tiga ruas — angka penjualan TIDAK BISA
 *      masuk, bukan sekadar tidak disertakan.
 *   2. `susunKueri()` satu-satunya yang merangkai teks yang dikirim.
 *   3. `tolakKueri()` memeriksa sekali lagi tepat sebelum berangkat.
 *
 * Uji ini menyerang lapis 2 dan 3. Lapis 1 dijaga TypeScript.
 */
import {
  susunKueri, tolakKueri, bersihkan, istilahPasar, tebakKategori,
  MAKS_KUERI, MAKS_PANJANG_KUERI, type KonteksPublik,
} from "../lib/pasar/kueri.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const SEKARANG = new Date("2026-10-29T10:00:00");

// ============================================================
console.log("=== 1. Nama internal jadi istilah pasar ===");
// ============================================================
{
  const kasus: [string, string][] = [
    ["MASKER BENGKOANG BT N.PACK 15GR", "masker bengkoang"],
    ["MINYAK ZAITUN 175 ML RJ", "minyak zaitun"],
    ["PEMBERSIH SK GAMBIR (N.PACK)150 ML", "pembersih sk gambir"],
    ["BODY S CRYSANT KB 245 ML", "body s crysant"],
    ["PASTA GIGI SIRIH KB 150 GR", "pasta gigi sirih"],
  ];
  for (const [mentah, harap] of kasus) {
    const hasil = istilahPasar(mentah);
    cek(`"${mentah.slice(0, 28)}"`, hasil === harap, `-> "${hasil}"`);
  }

  // ⚠️ INI INTI BAGIAN INI: tata nama internal TIDAK BOLEH ikut keluar.
  const internal = ["n.pack", "rj", "bt", "kb", "nf", "bcd"];
  for (const kode of internal) {
    const hasil = istilahPasar(`PRODUK CONTOH ${kode.toUpperCase()} 100 ML`);
    cek(`kode internal "${kode}" dibuang`, !hasil.split(" ").includes(kode), `-> "${hasil}"`);
  }
  cek("ukuran kemasan dibuang", !/\d/.test(istilahPasar("MINYAK ZAITUN 175 ML RJ")));
}

// ============================================================
console.log("\n=== 2. Kategori ditebak, atau mengaku tidak tahu ===");
// ============================================================
{
  cek("masker -> perawatan kulit", tebakKategori("MASKER BENGKOANG BT") === "perawatan kulit");
  cek("minyak -> minyak perawatan tubuh", tebakKategori("MINYAK ZAITUN 175 ML") === "minyak perawatan tubuh");
  cek("lip gloss -> kosmetik bibir", tebakKategori("BQ ULTRA PLUM HYDRA LIP GLOSS 01") === "kosmetik bibir");
  cek("pasta gigi -> perawatan gigi", tebakKategori("PASTA GIGI SIRIH KB") === "perawatan gigi");
  // ⚠️ Mengaku tidak tahu lebih baik daripada menebak salah: kategori yang
  // keliru menghasilkan riset tentang produk lain yang tetap terlihat sah.
  cek("tidak dikenali -> null", tebakKategori("BARANG ANEH XYZ 123") === null,
    String(tebakKategori("BARANG ANEH XYZ 123")));
}

// ============================================================
console.log("\n=== 3. ⚠️ Angka perusahaan TIDAK PERNAH sampai ke kueri ===");
// ============================================================
{
  // Konteks ini SUDAH bertipe sempit — ini meniru pemanggil yang mencoba
  // menyelundupkan angka lewat ruas yang memang ada.
  const nakal: KonteksPublik = {
    nama: "MINYAK ZAITUN 175 ML RJ penjualan 22592 unit Rp894149946",
    merek: "SKU 1006000",
    kategori: "ramalan 22592 22594 22596",
  };
  const kueri = susunKueri(nakal, "tren", SEKARANG);
  const semua = kueri.join(" | ");
  cek("tidak ada angka panjang yang lolos", !/\d{5,}/.test(semua), semua.slice(0, 70));
  cek("tidak ada nilai rupiah", !/\brp\s*\d/i.test(semua));
  for (const q of kueri) {
    const t = tolakKueri(q);
    cek(`penjaga meloloskan "${q.slice(0, 34)}"`, t === null, t ?? "aman");
  }
}

// ============================================================
console.log("\n=== 4. Penjaga lapis kedua menangkap yang lolos lapis pertama ===");
// ============================================================
{
  // ⚠️ Meniru keadaan kalau suatu hari ada yang memanggil penyedia TANPA
  // lewat `susunKueri()`. Itu bentuk kebocoran yang paling mungkin terjadi:
  // bukan karena penjaganya rusak, tapi karena dilewati.
  const bahaya: [string, string][] = [
    ["penjualan 22592 unit bulan depan", "angka panjang"],
    ["omzet Rp894149946 minyak zaitun", "nilai rupiah"],
    ["sku 1006000 tren pasar", "kode SKU 7 angka"],
    ["tren minyak zaitun <script>alert(1)</script>", "tanda baca"],
    ["", "kueri kosong"],
    ["a".repeat(MAKS_PANJANG_KUERI + 1), "terlalu panjang"],
  ];
  for (const [q, kenapa] of bahaya) {
    const t = tolakKueri(q);
    cek(`ditolak: ${kenapa}`, t !== null, t ?? "LOLOS — ini masalah");
  }
  cek("kueri wajar diloloskan", tolakKueri("tren minyak zaitun Indonesia 2026") === null);
}

// ============================================================
console.log("\n=== 5. Pembersih teks ===");
// ============================================================
{
  cek("tanda baca dibuang", bersihkan('tren "minyak" <zaitun>') === "tren minyak zaitun",
    bersihkan('tren "minyak" <zaitun>'));
  cek("baris baru dibuang", !/\n/.test(bersihkan("tren\nminyak\nzaitun")));
  cek("dipotong di batas panjang", bersihkan("x".repeat(500)).length === MAKS_PANJANG_KUERI);
  cek("huruf dan angka tetap", bersihkan("tren 2026 minyak") === "tren 2026 minyak");
}

// ============================================================
console.log("\n=== 6. Kueri yang disusun masuk akal dan dibatasi ===");
// ============================================================
{
  const k: KonteksPublik = { nama: "MINYAK ZAITUN 175 ML RJ", merek: "Mustika Ratu", kategori: null };

  const tren = susunKueri(k, "tren", SEKARANG);
  cek(`paling banyak ${MAKS_KUERI} kueri`, tren.length <= MAKS_KUERI, `${tren.length}`);
  cek("tidak ada kueri kembar", new Set(tren).size === tren.length);
  // ⚠️ TAHUNNYA DARI JAM, bukan ditulis mati. Kueri "tren 2026" yang
  // tertinggal di kode akan menua diam-diam.
  cek("tahun ikut dari jam", tren.some((q) => q.includes("2026")), tren[0]);
  const depan = susunKueri(k, "tren", new Date("2027-01-05T00:00:00"));
  cek("tahun berubah kalau jamnya berubah", depan.some((q) => q.includes("2027")), depan[0]);

  const pesaing = susunKueri(k, "pesaing", SEKARANG);
  // ⚠️ Nama merek sendiri TIDAK ikut dalam kueri pesaing — menyandingkan nama
  // kita dengan kata "pesaing" di mesin pencari adalah keterangan yang kita
  // berikan cuma-cuma.
  cek("kueri pesaing tidak menyebut merek sendiri",
    !pesaing.some((q) => /mustika/i.test(q)), pesaing.join(" | ").slice(0, 60));

  const kosong = susunKueri({ nama: "175 ML RJ", merek: null, kategori: null }, "tren", SEKARANG);
  cek("nama yang habis dinormalkan -> tidak ada kueri", kosong.length === 0, `${kosong.length} kueri`);

  for (const jenis of ["tren", "pesaing", "musiman", "industri"] as const) {
    const q = susunKueri(k, jenis, SEKARANG);
    cek(`jenis ${jenis.padEnd(9)} menghasilkan kueri yang aman`,
      q.length > 0 && q.every((x) => tolakKueri(x) === null), `${q.length} kueri`);
  }
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
