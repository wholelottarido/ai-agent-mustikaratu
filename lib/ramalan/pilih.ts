/**
 * Memilih model lewat BACKTEST, dan menjaga hasilnya masuk akal.
 *
 * ============================================================
 * KENAPA DIPILIH, BUKAN DIPATOK
 * ============================================================
 * Tidak ada satu model yang selalu menang. Diukur 26 Okt 2026 pada tiga
 * produk Minyak Zaitun, tiga bulan terakhir disembunyikan lalu diramal:
 *
 *   175 ML RJ    naive 23,1%   musiman 31,9%   arima 22,7%   -> ARIMA
 *   75 ML        naive 15,6%   musiman 32,0%   arima 18,5%   -> NAIVE
 *   75 ML RJ     naive 19,8%   musiman 21,5%   arima 16,7%   -> ARIMA
 *
 * Memakai AutoARIMA selalu berarti kalah di produk kedua; memakai Naive
 * selalu berarti kalah di dua lainnya. Dokumen rencananya menulisnya
 * eksplisit: "Choose the model with the best acceptable performance instead
 * of always selecting AutoARIMA."
 *
 * ============================================================
 * ⚠️ WAPE TERENDAH SAJA TIDAK CUKUP
 * ============================================================
 * Ditemukan 26 Okt 2026 waktu menyambungkan Tahap 1 dan 2. Untuk
 * `MINYAK ZAITUN 75 ML`, AutoARIMA meramal:
 *
 *   qty    5.880 unit
 *   value  Rp 0
 *
 * Mustahil: menjual 5.880 botol dengan omzet nol. Sebabnya ARIMA
 * mengekstrapolasi negatif lalu dipangkas ke 0 oleh `sahkan()`. Penjagaan itu
 * bekerja — tidak ada angka minus yang lolos — tapi yang keluar tetap tidak
 * masuk akal.
 *
 * Jadi pemilih di sini memeriksa DUA hal, bukan satu:
 *   1. ketepatan (WAPE), dan
 *   2. kewajaran (berapa nilai yang dipangkas).
 *
 * Kandidat yang sebagian besar hasilnya dipangkas DIBUANG, berapa pun
 * WAPE-nya. Angka yang tepat secara statistik tapi mustahil secara kenyataan
 * lebih berbahaya daripada angka yang jelas-jelas kasar — pembacanya tidak
 * punya cara mengetahuinya.
 */
import type { DeretSku } from "./deret";
import { modelYangMungkin, ses, type Model } from "./model";
import { pengaliRentang, ukurJarak, volumePenjualan } from "./jarak";
import { faktorBulan, type PolaBulanan } from "./pola";

/** Berapa bulan terakhir yang disembunyikan untuk menilai model. */
export const BULAN_UJI = 3;

/**
 * Batas pemangkasan yang masih bisa diterima.
 *
 * ⚠️ Lebih dari separuh hasil dipangkas berarti modelnya meramal angka
 * negatif untuk sebagian besar horizon — itu bukan "ramalan mendekati nol",
 * itu ekstrapolasi yang sudah lepas dari datanya.
 */
const BATAS_DIPANGKAS = 0.5;

/**
 * Selisih WAPE (poin persen) yang masih dianggap seri antara model rupiah dan
 * model unit.
 *
 * ============================================================
 * ⚠️ KENAPA UNIT DAN RUPIAH DISERAGAMKAN KALAU SELISIHNYA TIPIS
 * ============================================================
 * Keduanya deret terpisah dan masing-masing memilih modelnya sendiri. Itu
 * benar secara statistik, tapi menghasilkan tabel yang mustahil dibaca.
 * Terukur 26 Okt 2026 pada `MINYAK ZAITUN 75 ML RJ`: unit dimenangkan
 * AutoARIMA (16,7%) dan rupiah dimenangkan Naive (23,0%, mengalahkan
 * AutoARIMA yang 24,1%). Hasilnya unit naik 24.986 -> 28.233 (+13%)
 * sementara rupiah DIAM di Rp617.244.300 keenam bulannya — yang berarti
 * harga per unit turun dari Rp24.703 ke Rp21.863, sesuatu yang tidak pernah
 * dimaksudkan siapa pun.
 *
 * Selisih yang membeli ketidakwajaran itu 1,1 poin persen — masih di dalam
 * derau untuk backtest 3 bulan. (Angka-angka di atas MAPE; sejak 27 Okt 2026
 * metriknya WAPE, jadi nilainya bergeser. Yang tidak bergeser: dua satuan
 * yang bergerak berlawanan di satu tabel tidak pernah layak dibeli dengan
 * selisih setipis itu.) Jadi di bawah ambang ini rupiah mengikuti
 * model unit. Selisih yang BESAR tetap dihormati: Musiman yang 34,8% di
 * contoh yang sama tidak akan pernah dipaksakan.
 *
 * ⚠️ Yang ditukar BUKAN cuma angka — `terpilih` berubah, dan `kandidat`
 * sengaja dibiarkan utuh supaya pembaca hasil masih bisa melihat model mana
 * yang sebenarnya menang backtest.
 */
export const SERI_WAPE = 2;

/**
 * WAPE yang membuat sebuah model TIDAK PANTAS dipakai sama sekali.
 *
 * ============================================================
 * ⚠️ 100% BUKAN ANGKA YANG DIPILIH ASAL
 * ============================================================
 * Meramal NOL untuk setiap bulan menghasilkan WAPE tepat 100%
 * (SUM|0 - asli| / SUM|asli| = 1). Jadi model yang mencetak 100% atau lebih
 * KALAH dari menebak "tidak ada penjualan sama sekali" — dan menyajikan
 * angkanya sebagai ramalan berarti menyodorkan sesuatu yang lebih buruk
 * daripada tidak menjawab.
 *
 * Ambangnya diturunkan dari definisi WAPE-nya sendiri, bukan disetel sampai
 * hasilnya kelihatan bagus. Itu penting: ambang yang disetel belakangan selalu
 * bisa digeser lagi waktu ada yang tidak suka hasilnya.
 *
 * ⚠️ ANGKA 100% SAMA, ARTINYA BEDA, SEJAK METRIKNYA WAPE (27 Okt 2026).
 * Contoh yang dulu tercatat di sini — `BODY S ROSE MANGO 135 ML` dan
 * `FACE PEELING LEMON MR 60 GR`, dua-duanya "100%" — adalah angka MAPE yang
 * dihitung dari SATU bulan saja, karena MAPE melewati bulan bernilai nol dan
 * produk itu nyaris selalu nol. Angka lamanya tidak lagi berlaku dan sengaja
 * tidak dipindahkan ke sini: memindahkannya berarti menyimpan bukti untuk
 * metrik yang sudah tidak dipakai.
 *
 * Yang tetap berlaku adalah penalarannya, dan di WAPE ia justru lebih kuat:
 * WAPE memakai SELURUH bulan uji, termasuk yang nol, jadi 100% benar-benar
 * berarti "total melesetnya sebesar total penjualannya".
 *
 * ⚠️ RAMALAN NOL DIKECUALIKAN, dan ini bukan kelonggaran — ini akibat
 * langsung dari definisi di atas. Karena meramal nol SELALU mencetak tepat
 * 100%, angka itu adalah LANTAI yang dicapai ramalan nol, bukan bukti bahwa
 * modelnya buruk. Terukur pada deret yang menurun lurus 4.000 -> 100:
 * AutoARIMA meramal nol dan mencetak tepat 100,0% — padahal nol memang
 * jawaban yang benar untuk deret yang bulan berikutnya menyentuh nol.
 * Menolaknya berarti membuang satu-satunya model yang benar.
 *
 * ⚠️ Pengecualian ini TIDAK ikut longgar di WAPE: di MAPE angka 100% bisa
 * muncul dari satu bulan yang kebetulan terpilih, di WAPE ia hanya muncul
 * kalau seluruh ramalan ujinya memang nol.
 *
 * Jadi yang ditolak hanya model yang meleset >= 100% SAMBIL menebak angka
 * bukan nol PADA UJI ITU SENDIRI: ia mengaku tahu berapa penjualannya, dan
 * tetap kalah dari menebak tidak ada penjualan sama sekali.
 *
 * ⚠️ Yang diperiksa ramalan UJI-nya, bukan ramalan akhirnya — keduanya
 * dihitung dari deret yang berbeda (uji dari deret terpotong, ramalan dari
 * deret penuh), jadi keduanya bisa berbeda jauh. Memakai ramalan akhir
 * sebagai syarat akan meloloskan model yang pada bulan yang diuji menebak
 * jauh dari nol dan jauh dari benar.
 *
 * ⚠️ Kalau SEMUA kandidat tertolak di sini, hasilnya `ok: false` dan tool
 * memulangkan "tidak-bisa". Itu memang yang diinginkan: mengaku tidak bisa
 * meramal lebih berguna daripada angka yang tidak ada dasarnya.
 */
export const WAPE_TAK_BERGUNA = 100;

/**
 * Berapa bulan tanpa penjualan sebelum sebuah produk dianggap BERHENTI.
 *
 * ============================================================
 * ⚠️ PRODUK BERHENTI BUKAN PRODUK YANG SULIT DIRAMAL
 * ============================================================
 * Dipakai bersama penyesuaian horizon di bawah, dan keduanya menjawab satu
 * keadaan yang sama dari dua sisi.
 *
 * Data kita tertinggal dari bulan berjalan. Untuk produk yang MASIH terjual,
 * jarak itu cuma jeda pelaporan: ramalannya diperpanjang menembus jeda lalu
 * bulan yang sudah lewat dibuang, sehingga pemakai menerima bulan ke depan
 * yang sungguhan.
 *
 * Untuk produk yang SUDAH BERHENTI terjual, jarak yang sama berarti sesuatu
 * yang lain sama sekali, dan memperpanjang ramalannya berarti mengarang
 * penjualan untuk barang yang tidak dijual lagi. Terlihat 26 Okt 2026 pada
 * `BODY S ROSE MANGO 135 ML RJ`: penjualan terakhirnya Mar 2026, dan sistem
 * tetap menyodorkan "3 bulan ke depan".
 *
 * Bedanya diukur dari penjualan terakhir yang BUKAN NOL terhadap akhir data
 * seluruh tabel — bukan terhadap bulan berjalan, karena jeda pelaporan
 * mengenai semua produk dan bukan salah produknya.
 *
 * Ambang 3 bulan mengikuti spesifikasi subsistem forecast tim sebelah (§7.2),
 * supaya dua sistem di satu perusahaan tidak menyebut produk yang sama
 * "berhenti" dan "masih jalan" di saat yang sama.
 */
export const BULAN_BERHENTI = 3;

/**
 * Batas horizon internal — termasuk bulan yang dipakai menembus jeda data.
 *
 * Pemakai meminta paling banyak 6 bulan ke depan; dengan jeda 3 bulan itu
 * berarti meramal 9 bulan dari ujung data. Dibatasi 12 supaya jeda yang
 * membesar tidak diam-diam mengubah ramalan jadi ekstrapolasi jauh.
 */
export const MAKS_HORIZON_INTERNAL = 12;

/**
 * WAPE yang membuat hasil model dianggap TIDAK STABIL, lalu diganti rata-rata.
 *
 * ============================================================
 * ⚠️ MENOLAK BUKAN SATU-SATUNYA JAWABAN JUJUR
 * ============================================================
 * Sampai 27 Okt 2026 pagi, model yang terlalu meleset membuat seluruh
 * ramalan gagal dan tool memulangkan "tidak-bisa". Itu jujur, tapi bukan
 * yang paling berguna: untuk produk yang MASIH DIJUAL dan penjualannya
 * naik-turun tajam, rata-rata tiga bulan terakhir adalah jawaban yang masuk
 * akal dan bisa dipakai — asalkan disebut apa adanya sebagai rata-rata,
 * bukan disamarkan sebagai hasil model.
 *
 * Mengikuti §15 Kondisi 7 dan §21.5 spesifikasi tim sebelah.
 *
 * ⚠️ Yang TIDAK ikut dapat kelonggaran ini: produk yang sudah berhenti
 * dijual. Di sana tidak ada angka yang pantas keluar sama sekali — lihat
 * `BULAN_BERHENTI`.
 */
export const BATAS_TIDAK_STABIL = 50;

/** Lebar rentang prediksi, persen. 80 berarti kuantil 0,80 dari galat uji. */
export const TINGKAT_RENTANG = 80;


export type NilaiModel = {
  kode: Model["kode"] | "rata-rata" | "lightgbm" | "turunan-harga";
  nama: string;
  /**
   * Selisih mutlak per bulan saat backtest. Dasar rentang prediksi.
   *
   * ⚠️ Rentangnya diturunkan dari kesalahan model INI pada data INI, bukan
   * dari asumsi sebaran. Model yang terbukti meleset lebar akan memulangkan
   * rentang yang lebar — dan itu memang yang perlu dilihat pembacanya.
   */
  galatUji: number[];
  /** Batas bawah rentang, sejajar `ramalan`. Kosong kalau tidak bisa dihitung. */
  lo: number[];
  /** Batas atas rentang, sejajar `ramalan`. */
  hi: number[];
  /** Rata-rata persen selisih saat backtest. `null` kalau tidak bisa dihitung. */
  wape: number | null;
  /** Ramalan ke depan, dari SELURUH deret. */
  ramalan: number[];
  dipangkas: number;
  /** Diisi kalau model ini tidak dipakai, beserta sebabnya. */
  ditolak?: string;
  /** Angkanya sudah dikali pola bulanan gabungan. Jawaban wajib menyebutnya. */
  polaBulanan?: boolean;
};

export type HasilPilih =
  | {
      ok: true;
      terpilih: NilaiModel;
      /** Semua kandidat, termasuk yang kalah dan yang ditolak. Untuk ditampilkan. */
      kandidat: NilaiModel[];
    }
  | { ok: false; sebab: string; kandidat: NilaiModel[] };

/**
 * WAPE satu deret ramalan terhadap satu deret aktual.
 *
 * ⚠️ `pilihModel()` TIDAK memakai fungsi ini lagi sejak backtest-nya memakai
 * beberapa jendela (27 Okt 2026): menjumlahkan WAPE tiap jendela bukan WAPE
 * gabungan, jadi penjumlahannya dilakukan di sana atas galat mentah. Fungsi
 * ini tetap ada karena ia DEFINISI metriknya — dipakai uji untuk memastikan
 * rumusnya tidak bergeser, dan dipakai pembaca untuk tahu apa yang dihitung.
 *
 * Rata-rata persen selisih.
 *
 * ⚠️ Bulan yang nilainya 0 DILEWATI, bukan dihitung. Membaginya menghasilkan
 * tak hingga, dan satu bulan nol akan membuat WAPE seluruh model jadi `NaN` —
 * lalu semuanya terlihat sama buruknya. Kalau SEMUA bulan uji bernilai 0,
 * WAPE memang tidak bisa dihitung dan dipulangkan `null`.
 */
export function hitungWape(ramal: number[], asli: number[]): number | null {
  const penyebut = asli.reduce((t, a) => t + Math.abs(a), 0);
  // Satu-satunya keadaan yang membuat WAPE tak terdefinisi: SELURUH bulan uji
  // bernilai nol. Jauh lebih sempit daripada WAPE, yang tak terdefinisi di
  // SETIAP bulan nol — dan itulah sumber hampir semua tambalan sebelumnya.
  if (penyebut === 0) return null;
  const galat = asli.reduce((t, a, i) => t + Math.abs((ramal[i] ?? 0) - a), 0);
  return (galat / penyebut) * 100;
}

/**
 * Menilai satu deret: backtest tiap model, lalu ramalkan ke depan.
 *
 * `deret` adalah satu satuan saja (qty ATAU value) — pemanggil memanggil dua
 * kali. Dipisah supaya masing-masing bisa memilih modelnya sendiri: dari
 * pengukuran, model terbaik untuk jumlah unit tidak selalu sama dengan untuk
 * rupiah, dan memaksakan satu model untuk keduanya berarti salah satunya
 * memakai model yang kalah.
 */
/**
 * Rentang prediksi dari kuantil galat backtest — cara konformal.
 *
 * ============================================================
 * ⚠️ RENTANG DARI KESALAHAN NYATA, BUKAN DARI ASUMSI SEBARAN
 * ============================================================
 * Tidak memakai rumus selang kepercayaan yang mengandaikan galatnya normal.
 * Yang dipakai: seberapa jauh model INI meleset pada bulan uji yang nyata,
 * lalu kuantilnya dipakai sebagai lebar rentang.
 *
 * Sederhana, dan tidak berbohong tentang asumsi yang tidak kita periksa.
 * Cara yang sama dipakai tim sebelah untuk interval LightGBM (§12.8).
 *
 * ⚠️ Batas bawah DIPANGKAS DI NOL. Penjualan tidak bisa negatif, dan rentang
 * yang menjorok ke bawah nol mengajak pembacanya menganggap angka minus
 * mungkin terjadi.
 *
 * Galat uji kosong -> rentang kosong, BUKAN rentang nol. Rentang selebar nol
 * berarti "kami yakin persis", dan itu kebalikan dari keadaan sebenarnya.
 */
function hitungRentang(ramalan: number[], galatUji: number[]): { lo: number[]; hi: number[] } {
  if (galatUji.length === 0 || ramalan.length === 0) return { lo: [], hi: [] };
  const urut = [...galatUji].sort((a, b) => a - b);
  const posisi = Math.min(urut.length - 1, Math.ceil((TINGKAT_RENTANG / 100) * urut.length) - 1);
  const lebar = urut[Math.max(0, posisi)];
  return {
    lo: ramalan.map((v) => Math.max(0, Math.round(v - lebar))),
    hi: ramalan.map((v) => Math.round(v + lebar)),
  };
}

/**
 * Berapa jendela backtest yang dipakai. Tiap jendela `BULAN_UJI` bulan.
 *
 * ============================================================
 * ⚠️ SATU JENDELA MEMILIH MODEL YANG SALAH — INI TERUKUR
 * ============================================================
 * Ditemukan 27 Okt 2026 waktu user bertanya kenapa ramalannya rata terus.
 * Jendela ujinya digeser 3 bulan — data yang sama persis, cuma titik
 * penilaiannya bergeser — dan pemenangnya TERBALIK di ketiga produk yang
 * diperiksa:
 *
 *   PASTA GIGI SIRIH KB 150   imapa 22,7 menang  ->  digeser: naive 24,2 menang, imapa 70,5
 *   BODY S CRYSANT KB 245     imapa 18,7 menang  ->  digeser: naive 26,8 menang, imapa 82,0
 *   MINYAK CEMCEMAN 75        imapa 22,8 menang  ->  digeser: naive 54,4 menang, imapa 58,8
 *
 * Bukan bergeser sedikit — terbalik sepenuhnya. Artinya modelnya dipilih dari
 * TIGA titik data, dan tiga titik itu memutuskan jawaban yang berbeda lebih
 * dari dua kali lipat.
 *
 * ⚠️ Akibat keduanya lebih halus: WAPE yang kita TAMPILKAN diukur di jendela
 * yang dipakai MEMILIH pemenangnya. Itu skor-pada-data-sendiri, jadi selalu
 * terlalu bagus. Menilai di beberapa jendela tidak menghapus bias itu, tapi
 * jauh mengurangi — pemenangnya harus unggul di 9 bulan, bukan 3.
 *
 * ============================================================
 * ⚠️ BERAPA JENDELA? DIUKUR, DAN JAWABANNYA 4 — TAPI ADA HARGANYA
 * ============================================================
 * Diukur 27 Okt 2026 pada 60 produk terlaris berdurasi >= 44 bulan. Ukurannya:
 * apakah pemenangnya TETAP waktu seluruh penilaian digeser 3 bulan.
 *
 *   K=1 (3 bulan uji)    sama 43%   <- yang dipakai sampai sore ini
 *   K=2 (6 bulan uji)    sama 63%
 *   K=3 (9 bulan uji)    sama 67%
 *   K=4 (12 bulan uji)   sama 88%
 *   K=5 (15 bulan uji)   sama 88%   <- berhenti membaik
 *
 * Satu jendela berarti pilihan modelnya BERBALIK di 57% produk. Itu bukan
 * ketidakpastian yang bisa dituliskan sebagai rentang — itu jawaban yang
 * berbeda untuk pertanyaan yang sama.
 *
 * ⚠️ Yang ikut terlihat dan lebih penting daripada angka stabilitasnya:
 * sebaran pemenangnya bergeser. Di K=1 Musiman menang 11 kali dan model
 * agregasi 4 kali; di K=4 Musiman tinggal 3 dan agregasi 2, sementara Naive
 * dan AutoARIMA naik. Sebagian kemenangan model yang rumit di K=1 memang
 * KEBETULAN JENDELA, bukan ketepatan.
 *
 * ============================================================
 * ⚠️ HARGANYA: LIGHTGBM CUMA PUNYA 9 BULAN
 * ============================================================
 * `ai_forecast_ml` memuat cross-validation 2025-11..2026-07 — tepat 9 bulan,
 * tiga jendela, untuk 734 dari 770 SKU. Memakai 4 jendela berarti LightGBM
 * tidak bisa dinilai di jendela yang sama, dan satu-satunya pilihan jujur
 * adalah mengeluarkannya. Padahal ia menang di 16 dari 56 produk dan
 * menyelamatkan produk yang model kita menyerah di sana.
 *
 * Jadi jendelanya ditentukan PER PRODUK:
 *
 *   LightGBM punya datanya  -> 3 jendela, LightGBM ikut bersaing
 *   tidak punya             -> 4 jendela, pilihan model lebih stabil
 *
 * Tiap keputusan tetap adil DI DALAM DIRINYA — semua kandidat yang
 * dibandingkan dinilai di bulan yang sama persis. Yang tidak sama adalah
 * antara satu produk dan produk lain, dan itu memang tidak pernah
 * dibandingkan.
 *
 * ⚠️ Jalan keluarnya murah dan ada di tangan tim sebelah: kalau
 * cross-validation mereka diperpanjang jadi 12 bulan, seluruh katalog bisa
 * memakai 4 jendela TANPA kehilangan LightGBM. Layak diminta.
 */
export const MAKS_JENDELA = 4;

/** Jendela yang dipakai kalau LightGBM ikut bersaing — dibatasi data mereka. */
export const JENDELA_DENGAN_ML = 3;

/**
 * Jumlah jendela yang bisa dipakai untuk deret sepanjang `panjang`.
 *
 * ⚠️ DITENTUKAN MODEL YANG PALING RAKUS DATA, dan itu disengaja. Semua model
 * harus dinilai di jendela yang SAMA; kalau AutoARIMA cuma muat 1 jendela
 * sementara Naive dinilai di 3, yang dibandingkan bukan lagi ketepatan
 * melainkan panjang ujiannya. Jadi AutoARIMA-lah yang menentukan — dan untuk
 * deret pendek semua model turun ke 1 jendela bersama-sama, bukan AutoARIMA
 * yang dibuang.
 *
 * Diekspor karena `tools-ramalan.ts` harus meminta bulan uji yang SAMA ke
 * LightGBM. Beda satu jendela saja membuat perbandingannya tidak berarti.
 */
export function jumlahJendela(
  panjang: number,
  minimalTerbesar: number,
  maks: number = MAKS_JENDELA,
): number {
  if (panjang <= BULAN_UJI + 1) return 0;
  const muat = Math.floor((panjang - minimalTerbesar) / BULAN_UJI);
  return Math.max(1, Math.min(maks, muat));
}

/**
 * Minimal data terbesar di antara model yang BISA di-backtest untuk deret ini.
 *
 * ⚠️ Model yang tidak muat SATU jendela pun TIDAK ikut menentukan. Terukur 27
 * Okt 2026 pada `MINYAK CEMCEMAN 75 ML RJ NF` (26 bulan): AutoARIMA butuh 26
 * bulan latih, sementara deret latih jendela pertama cuma 23 — jadi ia pasti
 * ditolak. Tapi karena ia tetap dihitung di sini, ia menyeret SELURUH produk
 * itu turun ke satu jendela, dan satu jendela adalah persis keadaan yang
 * sedang kita perbaiki.
 *
 * Model yang sudah pasti ditolak tidak boleh ikut memutuskan seberapa teliti
 * model lain dinilai.
 */
export function minimalTerbesar(panjang: number): number {
  const m = modelYangMungkin(panjang).filter((x) => panjang - BULAN_UJI >= x.minimal);
  return m.length === 0 ? 0 : Math.max(...m.map((x) => x.minimal));
}

export function pilihModel(
  deret: number[],
  horizon: number,
  /** Batas jumlah jendela backtest. Diturunkan ke `JENDELA_DENGAN_ML` kalau LightGBM ikut. */
  maksJendela: number = MAKS_JENDELA,
): HasilPilih {
  const kandidat: NilaiModel[] = [];

  // ⚠️ Backtest dipotong dari deret yang SAMA, bukan deret lain. Model dinilai
  // pada data yang belum pernah dilihatnya — itu satu-satunya cara tahu dia
  // meramal atau sekadar menghafal.
  //
  // ⚠️ BEBERAPA JENDELA, bukan satu — lihat `MAKS_JENDELA`. Jendela ke-j
  // berakhir `j * BULAN_UJI` bulan sebelum ujung data, jadi j=0 adalah tiga
  // bulan terakhir, j=1 tiga bulan sebelumnya, dan seterusnya.
  const calon = modelYangMungkin(deret.length);
  const kJendela = jumlahJendela(deret.length, minimalTerbesar(deret.length), maksJendela);

  for (const m of calon) {
    // Ramalan sungguhan selalu dari SELURUH deret — backtest cuma untuk menilai.
    const depan = m.ramal(deret, horizon);
    if (!depan.ok) {
      kandidat.push({
        kode: m.kode, nama: m.nama, wape: null, ramalan: [], dipangkas: 0,
        galatUji: [], lo: [], hi: [],
        ditolak: depan.sebab,
      });
      continue;
    }

    let wape: number | null = null;
    // ⚠️ Apakah RAMALAN BACKTEST-nya nol — bukan ramalan akhirnya. Keduanya
    // dihitung dari deret yang berbeda (backtest dari deret terpotong,
    // ramalan dari deret penuh), dan WAPE hanya menilai yang pertama.
    // Terukur 27 Okt 2026: `MINYAK ZAITUN SKIN FIRMING` mencetak WAPE 283%
    // tapi ramalan akhirnya 0,0,0 — memakai ramalan akhir sebagai syarat
    // pengecualian akan meloloskan model yang backtest-nya kacau.
    let ujiNol = false;
    let galatUji: number[] = [];

    // ⚠️ GALATNYA DIJUMLAHKAN DULU DARI SELURUH JENDELA, PEMBAGIANNYA SEKALI.
    // Merata-ratakan WAPE tiap jendela akan memberi bobot yang sama kepada
    // jendela bervolume kecil dan besar — kekeliruan yang persis sama dengan
    // MAPE per bulan yang sudah dibuang di Tahap 29. Yang dijawab WAPE
    // gabungan: "dari seluruh unit yang terjual di 9 bulan itu, berapa persen
    // yang kami salah".
    let totalGalat = 0;
    let totalAsli = 0;
    let semuaJendelaNol = true;
    let lengkap = kJendela > 0;
    const galat: number[] = [];

    for (let j = 0; j < kJendela; j++) {
      const akhirLatih = deret.length - (j + 1) * BULAN_UJI;
      const latih = deret.slice(0, akhirLatih);
      const asli = deret.slice(akhirLatih, akhirLatih + BULAN_UJI);
      // ⚠️ SEMUA JENDELA ATAU TIDAK SAMA SEKALI. Model yang hanya bisa dinilai
      // di sebagian jendela TIDAK boleh dibandingkan dengan yang dinilai di
      // seluruhnya — pembilang dan penyebutnya berasal dari bulan yang
      // berbeda. Yang tidak lengkap jatuh ke `wape = null`, lalu ditolak
      // penjaga "tidak terukur" di bawah.
      if (latih.length < m.minimal) { lengkap = false; break; }
      const uji = m.ramal(latih, BULAN_UJI);
      if (!uji.ok) { lengkap = false; break; }
      for (let i = 0; i < asli.length; i++) {
        const g = Math.abs((uji.nilai[i] ?? 0) - asli[i]);
        galat.push(g);
        totalGalat += g;
        totalAsli += Math.abs(asli[i]);
      }
      if (!uji.nilai.every((v) => v === 0)) semuaJendelaNol = false;
    }

    if (lengkap) {
      ujiNol = semuaJendelaNol;
      // ⚠️ Rentang prediksi memakai galat SELURUH jendela. Dengan satu jendela
      // kuantil 80% dihitung dari TIGA angka — praktis selalu yang terbesar,
      // dan rentangnya ditentukan satu bulan sial. Sembilan angka membuatnya
      // berarti. Yang ditukar: galat dari jendela lama ikut, dan untuk produk
      // yang tingkat penjualannya baru patah itu melebarkan rentangnya. Itu
      // memang keadaan sebenarnya — modelnya BARU SAJA meleset sebesar itu.
      galatUji = galat;
      wape = totalAsli === 0 ? null : (totalGalat / totalAsli) * 100;
    }

    const rentang = hitungRentang(depan.nilai, galatUji);
    const nilai: NilaiModel = {
      kode: m.kode, nama: m.nama, wape,
      ramalan: depan.nilai, dipangkas: depan.dipangkas,
      galatUji, lo: rentang.lo, hi: rentang.hi,
    };

    // ⚠️ Penolakan karena pemangkasan berat. Lihat catatan di kepala berkas:
    // "5.880 unit senilai Rp0" lolos pemeriksaan negatif tapi mustahil.
    // Produk yang masih terjual tidak boleh diramal turun sampai nol. Terlihat 6 Nov 2026: PEELING
    // MUNDISARI 60 GR RJ terjual 193 unit di September, AutoARIMA meramal 0 tiap bulan. Angkanya
    // mendekati nol lalu dibulatkan, bukan negatif, jadi memeriksa pemangkasan saja tidak cukup:
    // yang diperiksa angka terakhirnya.
    const masihTerjual = deret.slice(-3).some((v) => v > 0);
    if (masihTerjual && (depan.dipangkas > 0 || depan.nilai[depan.nilai.length - 1] <= 0)) {
      nilai.ditolak =
        "ramalannya turun sampai nol padahal produk ini masih terjual dalam 3 bulan terakhir";
    } else if (depan.dipangkas / horizon > BATAS_DIPANGKAS) {
      nilai.ditolak =
        `${depan.dipangkas} dari ${horizon} nilai hasil ramalannya negatif lalu dipangkas ke 0 — ` +
        `modelnya mengekstrapolasi di luar data yang ada`;
    } else if (wape !== null && wape >= WAPE_TAK_BERGUNA && !ujiNol) {
      // Lihat `WAPE_TAK_BERGUNA`. Model yang kalah dari menebak nol tidak
      // boleh menjadi jawaban, sekalipun ia satu-satunya yang tersisa —
      // KECUALI kalau yang diramalkannya memang nol.
      nilai.ditolak =
        `pada uji ketepatan modelnya meleset ${Math.round(wape)}% — sama saja atau lebih buruk ` +
        `daripada menebak "tidak ada penjualan", padahal angkanya bukan nol`;
    } else if (wape === null && kJendela > 0) {
      // ============================================================
      // ⚠️ TIDAK BISA DIPERIKSA BERARTI TIDAK BOLEH DIPILIH
      // ============================================================
      // Ditemukan 27 Okt 2026 lewat pengukuran, bukan lewat galat.
      // `BQ ULTRA MATTE LIP CR 03 FEARLESS STAR`, 40 bulan:
      //
      //   7, 8, 1, 4, ... , 1, 4, 0, 0, 2
      //
      // Naive, Musiman, dan ARIMA ketiganya DITOLAK (meleset >= 100% pada tiga
      // bulan terakhir yang isinya 0, 0, 2). Kelima model permintaan terputus
      // lolos ke daftar — tapi WAPE-nya `null`, karena deret latihnya (37
      // bulan pertama) TIDAK punya satu pun bulan nol, jadi penjaga
      // keterputusan menolak mereka waktu backtest. Hasilnya: Croston terpilih
      // lewat `layak[0]` — URUTAN ARRAY — lalu menyajikan 2, 2, 2 ke pemakai
      // TANPA SATU PUN ANGKA KETEPATAN. Tidak ada galat, tidak ada peringatan,
      // dan di layar tampilannya persis seperti ramalan yang sudah diuji.
      //
      // Sebabnya kelayakan model permintaan terputus TIDAK monoton terhadap
      // panjang deret: menambah bulan bisa MEMBUAT sebuah model layak, jadi
      // model bisa lulus di deret penuh lalu gagal di deret latih. Panjang
      // deret (`minimal`) tidak begitu — makin panjang makin boleh.
      //
      // Sejak 27 Okt 2026 ada sebab kedua yang lebih sering: model yang tidak
      // muat di SELURUH jendela. Model yang hanya bisa dinilai di sebagian
      // jendela tidak sebanding dengan yang dinilai di semuanya.
      //
      // Aturannya: kalau deretnya PUNYA ruang untuk diuji dan model ini tetap
      // tidak terukur, dia tidak ikut. Yang TIDAK berubah: deret pendek yang
      // memang tidak punya ruang uji sama sekali — di sana `kJendela` nol,
      // tidak ada yang bisa diukur, dan Naive tetap jawaban yang jujur.
      nilai.ditolak =
        "ketepatannya tidak bisa diukur pada bulan uji, padahal deretnya cukup panjang untuk " +
        "diuji — jadi tidak ada dasar untuk memilihnya di atas model yang terukur";
    }
    kandidat.push(nilai);
  }

  const layak = kandidat.filter((k) => !k.ditolak);
  if (layak.length === 0) {
    return { ok: false, sebab: "tidak ada model yang menghasilkan ramalan yang masuk akal", kandidat };
  }

  // ⚠️ Yang WAPE-nya tidak bisa dihitung TIDAK otomatis kalah — tapi hanya
  // pada deret yang memang tidak punya ruang backtest sama sekali. Kalau
  // ruangnya ada, yang tidak terukur sudah ditolak di atas. Deret pendek tidak
  // punya ruang itu, dan di situ Naive adalah satu-satunya pilihan yang jujur.
  // Urutannya: yang punya WAPE dulu (terkecil menang), lalu yang tanpa WAPE
  // mengikuti urutan kesederhanaan model.
  const berMape = layak.filter((k) => k.wape !== null).sort((a, b) => a.wape! - b.wape!);
  const terpilih = berMape[0] ?? layak[0];
  return { ok: true, terpilih, kandidat };
}

export type RamalanSku = {
  sku: string;
  nama: string;
  merek: string | null;
  /** Bulan terakhir yang ADA DATANYA — bukan bulan sekarang. */
  bulanTerakhir: string;
  /** Bulan yang diramal, `YYYY-MM`. */
  bulanRamalan: string[];
  qty: HasilPilih;
  value: HasilPilih;
  /** Berapa bulan dalam deret yang sebenarnya kosong lalu diisi 0. */
  diisi: number;
  panjangDeret: number;
  /** Peringatan yang WAJIB ikut ke pemakai. Kosong berarti tidak ada. */
  peringatan: string[];
  /**
   * Berapa dari `bulanRamalan` yang sebenarnya SUDAH LEWAT.
   *
   * ⚠️ SEHARUSNYA SELALU 0 sejak horizonnya ditembus melewati jeda data
   * (27 Okt 2026). Dipertahankan sebagai PEMERIKSA, bukan sebagai keterangan:
   * kalau suatu saat ia bernilai bukan nol, berarti penembusan jedanya rusak
   * dan pemakai sedang menerima bulan yang sudah lewat sebagai ramalan.
   * Uji di `test:ramalan-pilih` mengandalkan itu.
   */
  bulanLewat: number;
  /** Seberapa meleset biasanya pada jarak bulan yang diramal. */
  jarak?: ReturnType<typeof ukurJarak>;
  /**
   * Terisi hanya kalau produknya dinilai SUDAH BERHENTI dijual. Lihat
   * `BULAN_BERHENTI`. Kalau terisi, `qty` dan `value` pasti `ok: false` dan
   * `bulanRamalan` kosong — tidak ada angka sama sekali yang dipulangkan.
   */
  berhenti?: { bulanTerakhirTerjual: string | null; diamBulan: number | null };
};

export function bulanSetelah(terakhir: string, n: number): string[] {
  let [t, b] = terakhir.split("-").map(Number);
  const keluar: string[] = [];
  for (let i = 0; i < n; i++) {
    b += 1;
    if (b > 12) { b = 1; t += 1; }
    keluar.push(`${t}-${String(b).padStart(2, "0")}`);
  }
  return keluar;
}

/**
 * Menyeragamkan model unit dan rupiah kalau ongkosnya kecil.
 *
 * ============================================================
 * ⚠️ DUA ARAH, BUKAN SATU — INI PERBAIKAN 27 Okt 2026 (sore)
 * ============================================================
 * Versi pertama hanya pernah menimbang MENYALIN MODEL UNIT KE RUPIAH. Kalau
 * ongkosnya di atas ambang, penyeragamannya batal dan tabel yang bertentangan
 * tetap tampil — padahal arah sebaliknya sering jauh lebih murah dan tidak
 * pernah diperiksa.
 *
 * Terukur pada `MINYAK ZAITUN 75 ML RJ`:
 *
 *   unit    musiman 18,1%  (terpilih)   naive 19,4%
 *   rupiah  naive   17,9%  (terpilih)   musiman 22,4%
 *
 *   menyalin model UNIT ke rupiah  -> rupiah rugi 4,5 poin  -> dulu: batal
 *   menyalin model RUPIAH ke unit  -> unit   rugi 1,3 poin  -> tidak pernah dicoba
 *
 * Yang tampil di layar akibat pembatalan itu: unit bergerak 14.761 -> 22.905
 * sementara rupiah DIAM di Rp617.244.300 untuk keenam bulan. Tabel itu
 * menyatakan harga rata-rata per unit turun sepertiga — pernyataan yang tidak
 * punya dasar apa pun di data kita.
 *
 * ⚠️ Kenapa ini lebih penting daripada 1,3 poin ketepatan: dua angka yang
 * saling bertentangan membuat pembacanya tidak bisa mempercayai KEDUANYA.
 * Yang hilang bukan ketepatan satu satuan, tapi kegunaan seluruh tabelnya.
 *
 * Aturannya sekarang: coba kedua arah, pilih yang ongkosnya paling kecil, dan
 * tetap batal kalau dua-duanya mahal — dengan ongkos itu disebutkan.
 */
function seragamkanSatuan(qty: HasilPilih, value: HasilPilih): string | null {
  if (!qty.ok || !value.ok) return null;
  if (qty.terpilih.kode === value.terpilih.kode) return null;

  /**
   * Ongkos memakai model `kode` pada sisi `sisi`, dalam poin persen WAPE.
   * `null` = tidak boleh (tidak ada, ditolak, atau ketepatannya tidak diukur) —
   * menukar dengan yang tidak diuji berarti menukar angka yang diketahui
   * dengan angka yang tidak diketahui.
   */
  const ongkos = (sisi: HasilPilih & { ok: true }, kode: string) => {
    // ⚠️ CADANGAN RATA-RATA TIDAK BOLEH DITIMPA MODEL.
    //
    // Sisi yang sudah jatuh ke rata-rata jatuh ke sana karena model
    // terbaiknya pun meleset di atas `BATAS_TIDAK_STABIL` — keputusan yang
    // sengaja diambil supaya angka yang tidak bisa dipercaya TIDAK disajikan
    // sebagai hasil model. Menggantinya kembali dengan model demi keseragaman
    // berarti membatalkan keputusan itu diam-diam, dan pemakai menerima angka
    // model justru di produk yang modelnya sudah dinyatakan tidak layak.
    //
    // Terlihat 27 Okt 2026 pada `MINYAK ZAITUN RESTFUL NIGHT 55`: unit sudah
    // diganti rata-rata (WAPE 51,4%), lalu penyeragaman menariknya kembali ke
    // Naive dengan ongkos 0 poin — dan peringatan "ini bukan hasil model" ikut
    // hilang karena memang sudah tidak berlaku. Yang hilang bukan cuma label,
    // tapi penjagaannya.
    if (sisi.terpilih.kode === "rata-rata") return null;
    const pengganti = sisi.kandidat.find((k) => k.kode === kode);
    if (!pengganti || pengganti.ditolak || pengganti.wape === null) return null;
    if (sisi.terpilih.wape === null) return null;
    return { pengganti, rugi: pengganti.wape - sisi.terpilih.wape };
  };

  const keRupiah = ongkos(value, qty.terpilih.kode);
  const keUnit = ongkos(qty, value.terpilih.kode);

  // Arah termurah menang. Kalau dua-duanya bisa, yang ruginya lebih kecil.
  const pilihan: { sisi: "rupiah" | "unit"; rugi: number; pengganti: NilaiModel }[] = [];
  if (keRupiah) pilihan.push({ sisi: "rupiah", rugi: keRupiah.rugi, pengganti: keRupiah.pengganti });
  if (keUnit) pilihan.push({ sisi: "unit", rugi: keUnit.rugi, pengganti: keUnit.pengganti });
  if (pilihan.length === 0) return null;
  pilihan.sort((a, b) => a.rugi - b.rugi);
  const pakai = pilihan[0];
  if (pakai.rugi > SERI_WAPE) return null;

  const sisi = pakai.sisi === "rupiah" ? value : qty;
  const namaKalah = sisi.terpilih.nama;
  const wapeKalah = sisi.terpilih.wape!;
  sisi.terpilih = pakai.pengganti;
  return (
    `Ramalan ${pakai.sisi} memakai ${pakai.pengganti.nama} (WAPE ${pakai.pengganti.wape!.toFixed(1)}%) agar ` +
    `sejalan dengan ramalan ${pakai.sisi === "rupiah" ? "unit" : "rupiah"}, walau ${namaKalah} sedikit lebih ` +
    `tepat pada uji (${wapeKalah.toFixed(1)}%). Selisihnya ${pakai.rugi.toFixed(1)} poin — terlalu kecil ` +
    `untuk membenarkan dua satuan yang bergerak berlawanan di satu tabel.`
  );
}

/**
 * Ramalan cadangan: rata-rata tiga bulan terakhir, datar sepanjang horizon.
 *
 * Dipakai waktu model terbaik pun terlalu meleset — lihat `BATAS_TIDAK_STABIL`.
 * Rentangnya minimum dan maksimum enam bulan terakhir, bukan kuantil galat:
 * tidak ada backtest yang bisa dipercaya di sini, jadi yang dipakai adalah
 * rentang yang BENAR-BENAR terjadi belakangan ini.
 *
 * ⚠️ Namanya disebut "Rata-rata 3 bulan terakhir", bukan nama model. Pemakai
 * harus bisa melihat bahwa ini bukan hasil peramalan.
 */
function cadanganRataRata(deret: number[], horizon: number, wapeTerbaik: number | null): NilaiModel {
  const tiga = deret.slice(-3);
  const rata = tiga.length > 0 ? tiga.reduce((a, b) => a + b, 0) / tiga.length : 0;
  const enam = deret.slice(-6);
  const nilai = Math.max(0, Math.round(rata));
  return {
    kode: "rata-rata",
    nama: "Rata-rata 3 bulan terakhir",
    // WAPE model yang DITOLAK tetap dibawa: itu alasan cadangan ini dipakai.
    wape: wapeTerbaik,
    ramalan: Array(horizon).fill(nilai),
    dipangkas: 0,
    galatUji: [],
    lo: Array(horizon).fill(enam.length ? Math.max(0, Math.round(Math.min(...enam))) : nilai),
    hi: Array(horizon).fill(enam.length ? Math.round(Math.max(...enam)) : nilai),
  };
}

/**
 * Menyertakan kandidat dari LUAR (LightGBM tim sebelah) ke dalam pemilihan.
 *
 * ============================================================
 * ⚠️ BERSAING DENGAN ATURAN YANG SAMA, BUKAN DIISTIMEWAKAN
 * ============================================================
 * Dia masuk sebagai kandidat biasa: WAPE-nya sudah diukur ulang pada jendela
 * uji KITA dengan aktual KITA (lihat `lib/ramalan/ml.ts`), lalu diperingkat
 * bersama yang lain. Tidak ada bonus karena "machine learning".
 *
 * Terukur 27 Okt 2026 pada 60 produk terlaris: dia menang di 16 dari 56 yang
 * bisa dibandingkan. Yang paling berarti bukan jumlahnya, melainkan DI MANA
 * dia menang — `MASKER BENGKOANG BT N.PACK` yang model kita sudah menyerah ke
 * rata-rata (56,5%) dia selesaikan di 26,3%.
 *
 * ⚠️ Dipanggil SESUDAH pemangkasan jeda, karena ramalannya memang sudah
 * untuk bulan yang akan disajikan — tidak ada jeda yang perlu dibuang.
 */
// ============================================================
// KANDIDAT "UNIT x HARGA PER UNIT"
// ============================================================
/**
 * Harga per unit pada bulan TERAKHIR yang ada penjualannya, di dalam `sampai`
 * bulan pertama deret.
 *
 * ⚠️ Harga terakhir, BUKAN rata-rata. Terukur 2 Nov 2026 pada lima produk
 * bervolume terbesar, kalau jumlah unitnya dianggap sudah benar:
 *
 *     harga bulan terakhir   1,9%
 *     garis lurus 6 bulan    2,3%
 *     rata-rata 3 bulan      2,8%
 *     rata-rata 12 bulan     6,0%
 *
 * Sebabnya harga naik PELAN DAN TERATUR, bukan acak: MINYAK CEMCEMAN 175 ML
 * RJ bergerak Rp 39rb -> Rp 43rb dalam 12 bulan. Rata-rata selalu tertinggal
 * di belakang kenaikan itu, dan tertinggalnya searah -- bukan saling hapus.
 */
export function hargaTerakhir(qty: number[], value: number[], sampai: number): number | null {
  for (let i = Math.min(sampai, qty.length) - 1; i >= 0; i--) {
    if (qty[i] > 0 && Number.isFinite(value[i] / qty[i])) return value[i] / qty[i];
  }
  return null;
}

/**
 * Kandidat rupiah yang diturunkan dari ramalan unit: `unit x harga terakhir`.
 *
 * ============================================================
 * KENAPA ADA
 * ============================================================
 * Unit dan rupiah dipilih modelnya masing-masing, dan sering menang model
 * yang berbeda. Akibatnya di layar: unit naik-turun tiap bulan sementara
 * rupiah sama untuk semua bulan. Pembaca tabel itu akan mengira harga per
 * unitnya berubah, padahal selisihnya datang dari perbedaan model.
 *
 * ============================================================
 * KENAPA IKUT BERTANDING, BUKAN MENIMPA
 * ============================================================
 * Cara ini mewarisi kesalahan ramalan unit DITAMBAH kesalahan menebak harga.
 * Untuk produk yang harganya stabil itu menguntungkan; untuk yang harganya
 * melompat-lompat, belum tentu. Jadi ia dinilai di JENDELA YANG SAMA dengan
 * model rupiah lainnya, lalu `sertakanLuar()` yang memutuskan -- menang cuma
 * kalau WAPE-nya memang lebih kecil.
 *
 * Memaksakannya tanpa diukur berarti menukar angka yang terukur dengan angka
 * yang kelihatan lebih rapi.
 *
 * ⚠️ Memulangkan `null` kalau tidak bisa diukur penuh. Kandidat yang cuma
 * terukur di sebagian jendela tidak boleh dibandingkan dengan yang terukur
 * di seluruhnya -- pembilang dan penyebutnya dari bulan yang berbeda.
 */
export function kandidatTurunan(
  qty: number[],
  value: number[],
  /** Model pemenang di sisi unit. Yang dipakai meramal unit tiap jendela. */
  modelQty: NilaiModel["kode"],
  /** Ramalan unit yang AKAN DISAJIKAN, sesudah jeda dibuang. */
  ramalanQty: number[],
  kJendela: number,
  /**
   * Ramalan unit LightGBM per bulan uji, berurutan kronologis sepanjang
   * `kJendela * BULAN_UJI`. Wajib kalau `modelQty === "lightgbm"`.
   */
  mlUjiRamal?: number[],
): NilaiModel | null {
  if (kJendela <= 0 || ramalanQty.length === 0) return null;

  const hargaDepan = hargaTerakhir(qty, value, qty.length);
  if (hargaDepan === null) return null;

  const m = modelYangMungkin(qty.length).find((x: Model) => x.kode === modelQty);
  const pakaiMl = modelQty === "lightgbm";
  if (!m && !pakaiMl) return null;
  if (pakaiMl && (!mlUjiRamal || mlUjiRamal.length !== kJendela * BULAN_UJI)) return null;

  const galat: number[] = [];
  let totalGalat = 0;
  let totalAsli = 0;

  for (let j = 0; j < kJendela; j++) {
    const akhirLatih = qty.length - (j + 1) * BULAN_UJI;
    const asliValue = value.slice(akhirLatih, akhirLatih + BULAN_UJI);

    // ⚠️ Harga diambil dari DALAM jendela latih saja. Memakai harga terakhir
    // seluruh deret berarti kandidat ini mengintip bulan yang sedang diujikan
    // kepadanya, lalu terlihat lebih tepat daripada yang sebenarnya.
    const harga = hargaTerakhir(qty, value, akhirLatih);
    if (harga === null) return null;

    let ramalQty: number[];
    if (pakaiMl) {
      // Jendela j=0 adalah yang PALING BARU, sedangkan `mlUjiRamal` tersusun
      // kronologis -- jadi jendela j mulai di (kJendela-1-j) * BULAN_UJI.
      const mulai = (kJendela - 1 - j) * BULAN_UJI;
      ramalQty = mlUjiRamal!.slice(mulai, mulai + BULAN_UJI);
    } else {
      const latih = qty.slice(0, akhirLatih);
      if (latih.length < m!.minimal) return null;
      const uji = m!.ramal(latih, BULAN_UJI);
      if (!uji.ok) return null;
      ramalQty = uji.nilai;
    }

    for (let i = 0; i < asliValue.length; i++) {
      const g = Math.abs((ramalQty[i] ?? 0) * harga - asliValue[i]);
      galat.push(g);
      totalGalat += g;
      totalAsli += Math.abs(asliValue[i]);
    }
  }

  if (totalAsli === 0) return null;
  const ramalan = ramalanQty.map((u) => Math.max(0, Math.round(u * hargaDepan)));
  const rentang = hitungRentang(ramalan, galat);
  return {
    kode: "turunan-harga",
    nama: "jumlah unit x harga per unit terakhir",
    wape: (totalGalat / totalAsli) * 100,
    ramalan,
    dipangkas: 0,
    galatUji: galat,
    lo: rentang.lo,
    hi: rentang.hi,
  };
}

export function sertakanLuar(h: HasilPilih, luar: NilaiModel): HasilPilih {
  const kandidat = [...h.kandidat, luar];
  if (luar.ditolak) return h.ok ? { ...h, kandidat } : { ...h, kandidat };

  // Kandidat luar tidak pernah dipakai kalau ketepatannya tak terukur: yang
  // tidak diuji tidak bisa dibandingkan dengan yang diuji.
  if (luar.wape === null) return h.ok ? { ...h, kandidat } : { ...h, kandidat };
  if (!h.ok) return { ok: true, terpilih: luar, kandidat };
  if (h.terpilih.wape === null || luar.wape < h.terpilih.wape) {
    return { ok: true, terpilih: luar, kandidat };
  }
  return { ...h, kandidat };
}

/** Berapa bulan dari `a` ke `b`, keduanya `YYYY-MM`. Negatif kalau `b` lebih awal. */
export function selisihBulan(a: string, b: string): number {
  const [ta, ba] = a.split("-").map(Number);
  const [tb, bb] = b.split("-").map(Number);
  return (tb - ta) * 12 + (bb - ba);
}

/**
 * Membuang `n` nilai pertama dari ramalan SETIAP kandidat.
 *
 * Dipakai untuk membuang bulan-bulan yang cuma dipakai menembus jeda data —
 * bulan yang sudah lewat waktu pertanyaannya diajukan. Dilakukan pada semua
 * kandidat, bukan cuma yang terpilih, supaya `model_lain` yang ditampilkan
 * ke pemakai menyebut periode yang sama dengan yang terpilih.
 */
function buangJeda(h: HasilPilih, n: number): HasilPilih {
  if (n <= 0) return h;
  const potong = (k: NilaiModel): NilaiModel => ({
    ...k,
    ramalan: k.ramalan.slice(n),
    // Rentangnya ikut dipotong — kalau tidak, `lo[0]` akan menjadi batas
    // bawah untuk bulan yang sudah dibuang, dan tabelnya bergeser satu baris.
    lo: k.lo.slice(n),
    hi: k.hi.slice(n),
  });
  return h.ok
    ? { ok: true, terpilih: potong(h.terpilih), kandidat: h.kandidat.map(potong) }
    : { ok: false, sebab: h.sebab, kandidat: h.kandidat.map(potong) };
}

/** Rentang model diuji pada jarak dekat, jadi dilebarkan menurut jarak bulan yang disajikan. */
function lebarkanRentang(h: HasilPilih, jeda: number, volume: ReturnType<typeof volumePenjualan>): HasilPilih {
  if (!h.ok) return h;
  const lebarkan = (k: NilaiModel): NilaiModel => {
    // Rentang rata-rata pengganti diambil dari penjualan 6 bulan terakhir, bukan dari galat uji.
    if (k.kode === "rata-rata" || k.lo.length !== k.ramalan.length) return k;
    return {
      ...k,
      lo: k.ramalan.map((v, i) => Math.max(0, Math.round(v - (k.hi[i] - v) * pengaliRentang(jeda + i + 1, volume)))),
      hi: k.ramalan.map((v, i) => Math.round(v + (k.hi[i] - v) * pengaliRentang(jeda + i + 1, volume))),
    };
  };
  return { ok: true, terpilih: lebarkan(h.terpilih), kandidat: h.kandidat.map(lebarkan) };
}

/**
 * SES yang rata dikali pola bulanan gabungan. Tingkatnya dihitung ulang dari penjualan yang pola
 * bulannya sudah dibuang, supaya bulan ramai tidak terhitung dua kali.
 * Model lain tidak disentuh: mereka sudah punya bentuk sendiri, dan yang diukur hanya SES.
 */
function kaliPola(
  h: HasilPilih, deret: number[], bulan: string[], bulanRamal: string[], pola: PolaBulanan,
  unitIkutPola = false,
): HasilPilih {
  if (!h.ok || h.terpilih.ramalan.length !== bulanRamal.length) return h;
  const t = h.terpilih;
  let nilai: number[] | null = null;
  if (t.kode === "ses") {
    const r = ses.ramal(deret.map((v, i) => v / faktorBulan(pola, bulan[i])), 1);
    if (r.ok) nilai = bulanRamal.map((b) => Math.max(0, Math.round(r.nilai[0] * faktorBulan(pola, b))));
  } else if (t.kode === "turunan-harga" && unitIkutPola) {
    // Rupiah dari unit x harga harus searah dengan unitnya. Kalau unitnya model lain yang rata,
    // rupiahnya tetap rata, supaya tabelnya tidak menyatakan harga per unit berubah tiap bulan.
    nilai = t.ramalan.map((v, i) => Math.max(0, Math.round(v * faktorBulan(pola, bulanRamal[i]))));
  }
  if (!nilai) return h;
  const baru = nilai;
  const terpilih: NilaiModel = {
    ...t,
    nama: `${t.nama}, dikali pola bulanan semua produk`,
    polaBulanan: true,
    ramalan: baru,
    // Lebar rentang tetap, karena ia datang dari galat uji.
    lo: t.lo.length === baru.length ? baru.map((v, i) => Math.max(0, v - (t.hi[i] - t.ramalan[i]))) : t.lo,
    hi: t.hi.length === baru.length ? baru.map((v, i) => v + (t.hi[i] - t.ramalan[i])) : t.hi,
  };
  return { ok: true, terpilih, kandidat: h.kandidat };
}

/** Bulan terakhir yang penjualannya BUKAN nol. `null` kalau tidak pernah terjual. */
function bulanTerakhirTerjual(deret: DeretSku): string | null {
  for (let i = deret.qty.length - 1; i >= 0; i--) if (deret.qty[i] > 0) return deret.bulan[i];
  return null;
}

/** Bulan berjalan, `YYYY-MM`, waktu lokal. */
export function bulanIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Ramalan lengkap satu SKU: qty dan value, beserta peringatannya.
 *
 * ⚠️ PERINGATANNYA BAGIAN DARI HASIL, bukan hiasan. Angka ramalan tanpa
 * konteks seberapa bisa dipercaya adalah angka yang akan dipakai orang untuk
 * mengambil keputusan tanpa tahu dasarnya.
 */
export function ramalkan(
  deret: DeretSku,
  horizon: number,
  sekarang = bulanIni(),
  /**
   * Bulan terakhir SELURUH tabel, bukan milik produk ini. Dipakai menilai
   * apakah produknya berhenti terjual — lihat `BULAN_BERHENTI`. Kalau tidak
   * diisi, dianggap sama dengan bulan terakhir produk ini, dan penilaian
   * "berhenti" tidak akan pernah menyala.
   */
  akhirData = deret.bulanTerakhir,
  /**
   * Kandidat LightGBM yang sudah diambil pemanggil (lihat `lib/ramalan/ml.ts`).
   *
   * ⚠️ Diterima sebagai PARAMETER, bukan diambil sendiri di sini. `ramalkan()`
   * sengaja tetap sinkron dan tanpa akses database, supaya bisa diuji dengan
   * deret buatan tanpa menyalakan apa pun.
   */
  ml?: {
    ramalan: number[];
    wape: number;
    galatUji: number[];
    /** Ramalan unit per bulan uji. Dipakai kandidat "unit x harga". */
    ujiRamal?: number[];
    dilatih: string | null;
  },
  /** Pola bulanan gabungan, lihat `pola.ts`. Tanpa ini, SES tetap rata. */
  pola?: PolaBulanan,
): RamalanSku {
  const peringatan: string[] = [];
  const dasar = {
    sku: deret.sku, nama: deret.nama, merek: deret.merek,
    bulanTerakhir: deret.bulanTerakhir,
    diisi: deret.diisi, panjangDeret: deret.bulan.length,
  };

  // ============================================================
  // ⚠️ PRODUK BERHENTI DIPERIKSA SEBELUM MODEL DIJALANKAN
  // ============================================================
  // Bukan sesudah. Model yang dijalankan untuk produk yang sudah tidak dijual
  // akan tetap menghasilkan angka — dan angka itu satu-satunya hal yang
  // dilihat pemakai. Lihat `BULAN_BERHENTI`.
  //
  // Lebih cepat juga: AutoARIMA pada riwayat 86 bulan makan belasan detik,
  // dan di sini kita tahu hasilnya tidak akan dipakai.
  const terjual = bulanTerakhirTerjual(deret);
  const diamSelama = terjual === null ? Infinity : selisihBulan(terjual, akhirData);
  if (diamSelama >= BULAN_BERHENTI) {
    const sebab =
      terjual === null
        ? `Produk ini tidak pernah tercatat terjual sama sekali di ${deret.bulan.length} bulan riwayatnya.`
        : `Penjualan terakhir produk ini ${terjual}, sementara data perusahaan sudah sampai ${akhirData} — ` +
          `${diamSelama} bulan tanpa penjualan. Produk ini dianggap SUDAH BERHENTI dijual, jadi ramalannya ` +
          `tidak dibuat: meramalkan penjualan barang yang tidak dijual lagi berarti mengarang angka. ` +
          `Kalau produknya akan dijual kembali, itu keputusan yang perlu dikoordinasikan dengan tim SCM, ` +
          `bukan diramalkan dari riwayat.`;
    return {
      ...dasar,
      bulanRamalan: [],
      qty: { ok: false, sebab, kandidat: [] },
      value: { ok: false, sebab, kandidat: [] },
      peringatan: [sebab],
      bulanLewat: 0,
      berhenti: { bulanTerakhirTerjual: terjual, diamBulan: terjual === null ? null : diamSelama },
    };
  }

  // ============================================================
  // ⚠️ HORIZON DIPERPANJANG MENEMBUS JEDA DATA
  // ============================================================
  // Data berhenti Jul sementara pertanyaannya diajukan Okt. Versi sebelumnya
  // meramal 3 bulan dari Jul — yang keluar Agu/Sep/Okt, bulan yang sudah
  // lewat — lalu memberi peringatan bahwa periodenya sudah lewat.
  //
  // Peringatan itu jujur tapi bukan jawaban: pemakai bertanya "3 bulan ke
  // depan" dan berhak menerima tiga bulan yang benar-benar ke depan. Jadi
  // sekarang jedanya DITEMBUS — diramal sampai melewati bulan berjalan, lalu
  // bulan yang sudah lewat dibuang. Mengikuti §7.4 spesifikasi tim sebelah.
  //
  // Harganya disebutkan apa adanya di peringatan: ramalan Nov dihitung dari
  // data yang berhenti Jul, jadi jaraknya lebih jauh dan melesetnya lebih
  // mungkin besar.
  const jeda = Math.max(0, selisihBulan(deret.bulanTerakhir, sekarang));
  const horizonInternal = Math.min(jeda + horizon, MAKS_HORIZON_INTERNAL);
  const ditampilkan = horizonInternal - jeda;

  // ⚠️ JUMLAH JENDELANYA MENGIKUTI ADA-TIDAKNYA KANDIDAT LIGHTGBM.
  // Lihat `MAKS_JENDELA`: 4 jendela membuat pilihan model jauh lebih stabil
  // (88% vs 67%), tapi cross-validation tim sebelah cuma 9 bulan. Kalau
  // kandidat mereka ikut, semua turun ke 3 jendela bersama-sama — bukan
  // mereka yang dinilai lebih pendek.
  //
  // ⚠️ UNIT DAN RUPIAH MEMAKAI ANGKA YANG SAMA, walau rupiah tidak pernah
  // bersaing dengan LightGBM. Sebabnya `seragamkanSatuan()` di bawah
  // MEMBANDINGKAN WAPE keduanya dengan ambang 2 poin; kalau yang satu diukur
  // 9 bulan dan yang lain 12 bulan, perbandingan itu tidak berarti apa-apa.
  const maksJendela = ml ? JENDELA_DENGAN_ML : MAKS_JENDELA;

  let qty = buangJeda(pilihModel(deret.qty, horizonInternal, maksJendela), jeda);
  let value = buangJeda(pilihModel(deret.value, horizonInternal, maksJendela), jeda);

  // Kandidat dari tim sebelah. Lihat `sertakanLuar()`. Hanya untuk unit:
  // LightGBM mereka tidak dilatih untuk rupiah.
  if (ml && ml.ramalan.length === ditampilkan) {
    const rentang = hitungRentang(ml.ramalan, ml.galatUji);
    qty = sertakanLuar(qty, {
      kode: "lightgbm",
      nama: "LightGBM (model tim Super Tools)",
      wape: ml.wape,
      ramalan: ml.ramalan,
      dipangkas: 0,
      galatUji: ml.galatUji,
      lo: rentang.lo,
      hi: rentang.hi,
    });
    // ⚠️ KALIMAT SOAL RUPIAH TIDAK DITARUH DI SINI, dan itu disengaja.
    // Sampai baris ini sisi rupiah BELUM selesai dipilih — kandidat
    // "unit x harga" baru dipasang di bawah. Versi sebelumnya menyatakan
    // "Ramalan rupiah tetap dari model kita" di titik ini, lalu kalimat itu
    // jadi BOHONG begitu kandidat turunan menang: rupiahnya justru berasal
    // dari ramalan unit LightGBM. Terlihat 2 Nov 2026.
    if (qty.ok && qty.terpilih.kode === "lightgbm") {
      peringatan.push(
        `Ramalan unit memakai model LightGBM milik tim Super Tools (hasil latihan ` +
          `${ml.dilatih ?? "tanggal tidak tercatat"}), karena pada uji yang sama ia lebih tepat ` +
          `daripada model kita.`,
      );
    }
  }

  // ============================================================
  // KANDIDAT RUPIAH YANG DITURUNKAN DARI UNIT
  // ============================================================
  // ⚠️ DIPASANG SESUDAH BLOK LIGHTGBM DI ATAS, dan urutannya menentukan.
  // Kandidat ini memakai model pemenang di sisi UNIT; kalau dipasang sebelum
  // LightGBM ikut bertanding, yang dipakainya model yang belum tentu jadi
  // pemenang -- lalu angka rupiah di layar tidak sesuai dengan angka unit di
  // sebelahnya. Itu persis cacat yang mau diperbaiki.
  if (qty.ok) {
    const turunan = kandidatTurunan(
      deret.qty, deret.value,
      qty.terpilih.kode, qty.terpilih.ramalan,
      jumlahJendela(deret.qty.length, minimalTerbesar(deret.qty.length), maksJendela),
      ml?.ujiRamal,
    );
    if (turunan) {
      value = sertakanLuar(value, turunan);
      if (value.ok && value.terpilih.kode === "turunan-harga") {
        peringatan.push(
          `Nilai rupiah dihitung dari ramalan unit dikalikan harga per unit bulan terakhir ` +
            `(Rp ${Math.round(hargaTerakhir(deret.qty, deret.value, deret.qty.length) ?? 0).toLocaleString("id-ID")}), ` +
            `bukan diramal sendiri — pada uji yang sama cara itu lebih tepat daripada model rupiah mana pun. ` +
            `Akibatnya rupiah bergerak seiring unit. ⚠️ Harga per unit dianggap TETAP di bulan-bulan ` +
            `yang diramal; kalau ada perubahan harga atau diskon besar, rupiahnya akan meleset searah.`,
        );
      }
    }
  }

  // ⚠️ Pasangan dari catatan di blok LightGBM di atas: kalimat soal rupiah
  // baru bisa diucapkan SESUDAH sisi rupiah selesai dipilih.
  if (
    qty.ok && qty.terpilih.kode === "lightgbm" &&
    !(value.ok && value.terpilih.kode === "turunan-harga")
  ) {
    peringatan.push(
      `Ramalan rupiah tetap dari model kita — LightGBM tim Super Tools hanya dilatih untuk ` +
        `jumlah unit, dan cara "unit x harga per unit" ternyata tidak lebih tepat untuk produk ini.`,
    );
  }

  // ============================================================
  // ⚠️ DATA TIDAK STABIL -> RATA-RATA, BUKAN PENOLAKAN
  // ============================================================
  // Lihat `BATAS_TIDAK_STABIL`. Dipasang SESUDAH pemotongan jeda supaya
  // panjang cadangannya sama dengan panjang yang akan disajikan.
  //
  // ⚠️ `kandidat` tidak diganti. Pembaca hasil tetap bisa melihat model apa
  // saja yang dicoba dan seberapa melesetnya — itu yang membuat keputusan
  // memakai cadangan bisa diperiksa, bukan diterima begitu saja.
  const takStabil = (h: HasilPilih): number | null | false =>
    !h.ok ? null : h.terpilih.wape !== null && h.terpilih.wape > BATAS_TIDAK_STABIL ? h.terpilih.wape : false;

  const qtyGoyah = takStabil(qty);
  const valueGoyah = takStabil(value);
  if (qtyGoyah !== false) {
    qty = { ok: true, terpilih: cadanganRataRata(deret.qty, ditampilkan, qty.ok ? qty.terpilih.wape : null), kandidat: qty.kandidat };
  }
  if (valueGoyah !== false) {
    value = { ok: true, terpilih: cadanganRataRata(deret.value, ditampilkan, value.ok ? value.terpilih.wape : null), kandidat: value.kandidat };
  }

  // Lihat `SERI_WAPE`. Dilakukan SEBELUM peringatan disusun supaya pemeriksaan
  // kewajaran di bawah menilai angka yang benar-benar akan disampaikan.
  const seragam = seragamkanSatuan(qty, value);
  if (seragam) peringatan.push(seragam);

  // Sesudah penyeragaman, supaya yang dikali memang yang akan disampaikan.
  const volume = volumePenjualan(deret.qty);
  if (pola && volume !== "kecil") {
    const bulanDisajikan = bulanSetelah(deret.bulanTerakhir, horizonInternal).slice(jeda);
    qty = kaliPola(qty, deret.qty, deret.bulan, bulanDisajikan, pola);
    value = kaliPola(value, deret.value, deret.bulan, bulanDisajikan, pola, qty.ok && qty.terpilih.polaBulanan === true);
  }
  qty = lebarkanRentang(qty, jeda, volume);
  value = lebarkanRentang(value, jeda, volume);

  // ============================================================
  // ⚠️ PERINGATANNYA DISUSUN DI SINI, SESUDAH PENYERAGAMAN
  // ============================================================
  // Dulu peringatan ini ditulis di tempat penggantiannya, di atas, dan
  // kalimatnya menyatakan tanpa syarat "Angka yang disajikan BUKAN hasil
  // model". Dua hal membuat kalimat itu bisa BOHONG:
  //
  //   1. Kalau cuma SATU satuan yang goyah, satuan lainnya tetap hasil model —
  //      dan kalimatnya tidak menyebut yang mana.
  //   2. `seragamkanSatuan()` berjalan SESUDAHNYA dan bisa MENGEMBALIKAN
  //      cadangan itu ke model, supaya unit dan rupiah tidak bergerak
  //      berlawanan.
  //
  // Terukur 27 Okt 2026 pada `BODY S LIME JASMINE 50 ML`: unit memakai Croston
  // (WAPE 50%), rupiah goyah di 68,8% lalu diganti rata-rata, lalu
  // DIKEMBALIKAN ke Croston oleh penyeragaman. Yang tampil di layar dua-duanya
  // hasil model — sementara peringatannya bilang bukan. Peringatan yang
  // menggambarkan angka yang tidak ada di layar lebih buruk daripada tidak ada
  // peringatan: pembacanya kehilangan kepercayaan pada peringatan yang BENAR.
  //
  // Jadi sekarang disusun dari apa yang AKHIRNYA terpilih, dan menyebut
  // satuannya.
  const pakaiRata: string[] = [];
  if (qty.ok && qty.terpilih.kode === "rata-rata") pakaiRata.push("jumlah unit");
  if (value.ok && value.terpilih.kode === "rata-rata") pakaiRata.push("nilai rupiah");
  if (pakaiRata.length > 0) {
    const ukur = [qtyGoyah, valueGoyah].filter((v): v is number => typeof v === "number");
    const terburuk = ukur.length > 0 ? Math.max(...ukur) : 0;
    const alasan =
      terburuk > 0
        ? `model terbaiknya pun meleset ${Math.round(terburuk)}% pada uji`
        : "tidak ada model yang ketepatannya cukup untuk dipakai";
    peringatan.push(
      `⚠️ Penjualan produk ini naik-turun tajam — ${alasan}. Angka ${pakaiRata.join(" dan ")} ` +
        `yang disajikan BUKAN hasil model, melainkan rata-rata 3 bulan terakhir, dengan rentang ` +
        `dari penjualan terendah dan tertinggi 6 bulan terakhir. Pakai sebagai gambaran kasar ` +
        `saja, jangan untuk keputusan stok tanpa cek ke tim SCM.`,
    );
  }

  const bulanRamalan = bulanSetelah(deret.bulanTerakhir, horizonInternal).slice(jeda);

  if (jeda > 0) {
    peringatan.push(
      `Data penjualan terakhir ${deret.bulanTerakhir}, sedangkan sekarang ${sekarang} — tertinggal ` +
        `${jeda} bulan. Ramalan di atas sudah dihitung menembus jeda itu, jadi bulan yang disebut ` +
        `memang bulan ke depan; tapi karena jaraknya ${jeda} bulan lebih jauh dari data terakhir, ` +
        `melesetnya bisa lebih besar daripada yang ditunjukkan angka ketepatan.`,
    );
  } else {
    peringatan.push(`Data terakhir ${deret.bulanTerakhir}; ramalan dimulai dari bulan sesudahnya.`);
  }

  if (ditampilkan < horizon) {
    peringatan.push(
      `Diminta ${horizon} bulan, yang bisa disajikan ${ditampilkan} — batas perhitungan ` +
        `${MAKS_HORIZON_INTERNAL} bulan dari data terakhir sudah tercapai karena jeda datanya ${jeda} bulan.`,
    );
  }

  // ⚠️ Deret yang sebagian besar isinya nol buatan kita sendiri. `RH
  // LEMONGGRASS` punya 27 bulan data di rentang 85 bulan — 68% tebakan.
  if (deret.diisi > 0) {
    const persen = Math.round((deret.diisi / deret.bulan.length) * 100);
    peringatan.push(
      `${deret.diisi} dari ${deret.bulan.length} bulan (${persen}%) tidak ada penjualannya dan diisi 0.` +
        (persen >= 30 ? " Riwayatnya terputus-putus, jadi ramalannya kasar." : ""),
    );
  }

  if (deret.bulan.length < 12) {
    peringatan.push(`Riwayatnya cuma ${deret.bulan.length} bulan — terlalu pendek untuk melihat pola musiman.`);
  }

  // ⚠️ KEWAJARAN qty vs value DIPERIKSA BERSAMA. Inilah yang menangkap
  // "5.880 unit senilai Rp0" — dua ramalan yang masing-masing sah tapi
  // mustahil kalau disandingkan.
  if (qty.ok && value.ok) {
    const adaUnit = qty.terpilih.ramalan.some((v) => v > 0);
    const adaRupiah = value.terpilih.ramalan.some((v) => v > 0);
    if (adaUnit && !adaRupiah) {
      peringatan.push(
        "Ramalan unit di atas nol tapi ramalan rupiahnya nol — keduanya tidak sejalan, " +
          "jadi angka rupiahnya jangan dipakai.",
      );
    }
    if (!adaUnit && adaRupiah) {
      peringatan.push("Ramalan rupiah di atas nol tapi ramalan unitnya nol — keduanya tidak sejalan.");
    }
    // ============================================================
    // ⚠️ SATU SATUAN BERGERAK, SATUNYA RATA — DIBERITAHUKAN
    // ============================================================
    // `seragamkanSatuan()` di atas sudah mencoba menyamakan modelnya dari dua
    // arah, tapi ada satu keadaan yang TIDAK bisa diselesaikan: unit
    // dimenangkan LightGBM, yang memang tidak punya pasangan untuk rupiah
    // (model tim sebelah hanya dilatih untuk unit). Jadi tidak ada model yang
    // bisa disalin ke mana pun.
    //
    // Terukur 29 Okt 2026 pada `MINYAK CEMCEMAN 75 ML RJ NF`: unit 3.680 ->
    // 3.944 (naik 7%) sementara rupiah DIAM di satu angka. Tabel seperti itu
    // menyatakan harga rata-rata per unit turun 7% — dan kita tidak punya
    // dasar apa pun untuk menyatakan itu.
    //
    // Tidak bisa diperbaiki tanpa membuang model yang lebih tepat, jadi yang
    // dilakukan: DIKATAKAN. Pembaca boleh memakai kedua angkanya, asal tidak
    // membandingkannya antar bulan.
    //
    // ⚠️ HANYA KALAU MODELNYA MEMANG BERBEDA. Model yang SAMA bisa
    // menghasilkan bentuk yang berbeda untuk dua satuan — kalau deret
    // rupiahnya memang datar sementara unitnya naik-turun, Naive akan rata di
    // satu sisi dan bergerak di sisi lain. Di situ bedanya datang dari DATA,
    // bukan dari pilihan model, dan kalimat di bawah akan salah menjelaskan
    // sebabnya. Ketahuan waktu menulis ujinya, bukan sesudah tampil di layar.
    const rata = (a: number[]) => a.length > 1 && new Set(a).size === 1;
    if (
      qty.terpilih.kode !== value.terpilih.kode &&
      rata(qty.terpilih.ramalan) !== rata(value.terpilih.ramalan)
    ) {
      const bergerak = rata(qty.terpilih.ramalan) ? "nilai rupiah" : "jumlah unit";
      const diam = bergerak === "jumlah unit" ? "nilai rupiah" : "jumlah unit";
      peringatan.push(
        `${bergerak} berubah tiap bulan sementara ${diam} sama untuk semua bulan, karena ` +
          `keduanya dimenangkan model yang berbeda dan tidak ada model yang bisa dipakai untuk ` +
          `dua-duanya. JANGAN membaca perubahan harga per unit dari tabel ini — selisihnya ` +
          `datang dari perbedaan model, bukan dari data penjualan.`,
      );
    }

  }

  return {
    ...dasar,
    bulanRamalan,
    qty,
    value,
    peringatan,
    // Pemeriksa, bukan keterangan — lihat catatan pada tipenya.
    bulanLewat: bulanRamalan.filter((b) => b <= sekarang).length,
    jarak: ukurJarak(jeda + 1, horizonInternal, volumePenjualan(deret.qty)),
  };
}
