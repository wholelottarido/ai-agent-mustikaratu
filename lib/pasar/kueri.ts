/**
 * Penyusun kueri pencarian — DAN SATU-SATUNYA PINTU KELUAR KE INTERNET.
 *
 * ============================================================
 * ⚠️ DAFTAR-BOLEH, BUKAN DAFTAR-LARANG
 * ============================================================
 * Aturan §14 dokumen Phase 2 menyebut sederet hal yang tidak boleh dikirim ke
 * penyedia pencarian: catatan penjualan, laporan internal, token, kredensial.
 * Menyaring dengan cara MELARANG satu per satu berarti setiap kolom baru yang
 * ditambahkan orang lain nanti lolos secara bawaan — dan kebocoran yang lolos
 * secara bawaan tidak akan pernah terlihat di layar.
 *
 * Jadi arahnya dibalik. Berkas ini menerima tipe `KonteksPublik` yang HANYA
 * punya tiga ruas, dan kueri disusun dari ruas itu saja. Tidak ada jalan bagi
 * angka penjualan, kode SKU, atau hasil ramalan untuk sampai ke sini —
 * bukan karena disaring, tapi karena tidak pernah diterima.
 *
 * ⚠️ `susunKueri()` adalah SATU-SATUNYA yang boleh menghasilkan teks yang
 * dikirim ke penyedia. Tidak ada tempat lain yang merangkai kueri.
 *
 * ============================================================
 * ⚠️ NAMA PRODUK INTERNAL BUKAN NAMA PASAR
 * ============================================================
 * Nama di `ai_forecast_sales_monthly` memuat kode kemasan dan singkatan
 * internal:
 *
 *   MASKER BENGKOANG BT N.PACK 15GR
 *   MINYAK ZAITUN 175 ML RJ
 *   PEMBERSIH SK GAMBIR (N.PACK)150 ML
 *
 * Mengirimnya apa adanya merugikan dua kali. Pertama, "BT", "RJ", "N.PACK",
 * "KB" adalah tata nama internal perusahaan — itu keterangan yang tidak perlu
 * diketahui pihak luar. Kedua, tidak ada orang di internet yang menulis
 * artikel tentang "N.PACK 15GR", jadi hasil pencariannya kosong.
 *
 * Dinormalkan jadi istilah pasar: "masker bengkoang", "minyak zaitun".
 * Satu perubahan yang sekaligus menutup kebocoran dan memperbaiki hasil.
 */

/**
 * Keterangan produk yang BOLEH keluar. Tiga ruas, semuanya sudah publik:
 * produknya dijual bebas di pasaran dengan nama dan merek ini.
 *
 * ⚠️ Sengaja TIDAK memuat `sku`. Kode SKU adalah pengenal internal, tidak
 * berguna untuk pencarian, dan §14 butir 5 hanya mengizinkan "product
 * names/categories". Kalau suatu saat ada yang perlu menelusuri hasil
 * pencarian balik ke SKU, itu dilakukan di sisi kita — bukan dengan
 * mengirimkan kodenya keluar.
 */
export type KonteksPublik = {
  /** Nama produk apa adanya dari katalog. Dinormalkan di sini, bukan di pemanggil. */
  nama: string;
  /** Merek, kalau tercatat. */
  merek: string | null;
  /** Kategori pasar, kalau sudah diketahui. Kosong = diturunkan dari nama. */
  kategori: string | null;
};

/**
 * Potongan tata nama internal yang dibuang dari nama produk.
 *
 * ⚠️ Daftar ini dibuat dari nama-nama NYATA di katalog (diperiksa 29 Okt
 * 2026), bukan dikarang. Kalau ada singkatan baru yang belum terdaftar, yang
 * terjadi cuma kuerinya kurang bersih — bukan kebocoran, karena yang keluar
 * tetap hanya nama produk yang memang tercetak di kemasannya.
 */
const POTONGAN_INTERNAL = [
  "n.pack", "npack", "n pack",
  "rj", "bt", "kb", "bcd", "nf", "new",
  "refil", "refill", "testr", "tester",
];

/** Satuan ukuran dan angkanya — tidak berguna untuk mencari tren pasar. */
const POLA_UKURAN = /\b\d+[.,]?\d*\s*(ml|gr|g|kg|lt|l|pcs|gram)\b/gi;

/** Angka lepas, tanda kurung, dan tanda baca sisa pemotongan. */
const POLA_SISA = /[()+\\/]|\b\d+\b/g;

/**
 * Mengubah nama katalog menjadi istilah yang dipakai orang di pasar.
 *
 * Contoh terukur 29 Okt 2026:
 *
 *   MASKER BENGKOANG BT N.PACK 15GR      -> masker bengkoang
 *   MINYAK ZAITUN 175 ML RJ              -> minyak zaitun
 *   PEMBERSIH SK GAMBIR (N.PACK)150 ML   -> pembersih sk gambir
 *   BQ ULTRA PLUM HYDRA LIP GLOSS 01 ... -> bq ultra plum hydra lip gloss
 */
export function istilahPasar(nama: string): string {
  let t = nama.toLowerCase();
  t = t.replace(POLA_UKURAN, " ");
  t = t.replace(POLA_SISA, " ");
  const kata = t
    .split(/\s+/)
    .filter((k) => k.length > 0)
    .filter((k) => !POTONGAN_INTERNAL.includes(k));
  // ⚠️ Dibatasi 5 kata. Nama panjang menghasilkan kueri yang terlalu sempit
  // dan hasilnya nol — diukur pada `BQ ULTRA PLUM HYDRA LIP GLOSS 01
  // BUTTERSCOTH`, yang utuh tidak dikenali mesin pencari mana pun.
  return kata.slice(0, 5).join(" ").trim();
}

/**
 * Kategori pasar yang ditebak dari nama produk.
 *
 * ⚠️ Memulangkan `null` kalau tidak yakin, dan itu disengaja. Kategori yang
 * salah menghasilkan riset pasar tentang produk yang bukan ini — lebih buruk
 * daripada tidak ada kategori sama sekali, karena hasilnya tetap terlihat
 * meyakinkan. Dokumen Phase 2 §5 menyebutnya eksplisit: "restrict research to
 * the confirmed product name and explicitly mark unavailable details".
 */
const PETA_KATEGORI: [RegExp, string][] = [
  [/\b(masker|lulur|scrub|peeling)\b/, "perawatan kulit"],
  [/\b(minyak|oil|essential)\b/, "minyak perawatan tubuh"],
  [/\b(pembersih|penyegar|toner|cleanser|face wash)\b/, "pembersih wajah"],
  [/\b(body\s*s|body lotion|hand body|shower|sabun|soap)\b/, "perawatan tubuh"],
  [/\b(lip|lipstik|lipstick|gloss|matte)\b/, "kosmetik bibir"],
  [/\b(eye liner|eyeliner|mascara|bedak|loose p|compact|foundation)\b/, "kosmetik wajah"],
  [/\b(shampoo|rambut|hair|ramuan p)\b/, "perawatan rambut"],
  [/\b(pasta gigi|sikat gigi)\b/, "perawatan gigi"],
  [/\b(jamu|minuman|beras kencur|kunyit)\b/, "jamu dan minuman herbal"],
];

export function tebakKategori(nama: string): string | null {
  const t = nama.toLowerCase();
  for (const [pola, kategori] of PETA_KATEGORI) {
    if (pola.test(t)) return kategori;
  }
  return null;
}

/** Panjang maksimal satu kueri. §14 butir 7: "Apply query length and request limits." */
export const MAKS_PANJANG_KUERI = 120;

/** Berapa kueri paling banyak per permintaan. Dibatasi di sini, bukan di pemanggil. */
export const MAKS_KUERI = 4;

/**
 * Membuang apa pun yang bukan huruf, angka, atau spasi dari teks yang akan
 * dikirim keluar.
 *
 * ⚠️ Bukan sekadar kerapian. Teks ini masuk ke permintaan HTTP pihak ketiga;
 * tanda kutip, kurung siku, dan tanda baris baru adalah bahan yang dipakai
 * untuk menyisipkan perintah. §14 butir 6: "Sanitize user-generated search
 * terms."
 */
export function bersihkan(teks: string): string {
  return teks
    .normalize("NFKC")
    // ⚠️ NILAI RUPIAH DAN ANGKA PANJANG DIBUANG DI SINI, bukan cuma ditolak
    // di hilir. Ditemukan 29 Okt 2026 oleh ujinya sendiri: pemanggil yang
    // menaruh "penjualan 22592 unit Rp894149946" di ruas nama membuat
    // angkanya ikut tersusun jadi kueri. `tolakKueri()` memang menangkapnya,
    // tapi akibatnya SELURUH pencarian dibatalkan — jadi satu nama yang
    // kotor mematikan fiturnya, bukan sekadar membersihkannya.
    //
    // Tidak ada kueri pasar yang sah memuat angka lima digit atau lebih.
    // Tahun (empat digit) ditambahkan `susunKueri()` SESUDAH pembersihan ini,
    // jadi tidak ikut terbuang.
    .replace(/(rp|idr)\.?\s*[\d.,]+/gi, " ")
    .replace(/\d{5,}/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAKS_PANJANG_KUERI);
}

export type JenisRiset = "tren" | "pesaing" | "musiman" | "industri";

/**
 * Menyusun kueri pencarian dari konteks yang sudah disetujui publik.
 *
 * ⚠️ SATU-SATUNYA tempat teks pencarian dirangkai. Kalau suatu saat ada yang
 * perlu kueri bentuk lain, ia ditambahkan DI SINI — bukan dirangkai di tool,
 * bukan di penyedia, dan tidak pernah dari kalimat user mentah.
 *
 * ⚠️ TAHUN DIAMBIL DARI JAM, bukan ditulis mati. Kueri "tren 2026" yang
 * tertinggal di kode akan menua diam-diam dan mencari tren tahun lalu tanpa
 * ada yang sadar.
 */
export function susunKueri(
  konteks: KonteksPublik,
  jenis: JenisRiset,
  sekarang = new Date(),
): string[] {
  const istilah = bersihkan(istilahPasar(konteks.nama));
  if (istilah.length === 0) return [];
  const kategori = konteks.kategori ? bersihkan(konteks.kategori) : tebakKategori(konteks.nama);
  const tahun = sekarang.getFullYear();
  const merek = konteks.merek ? bersihkan(konteks.merek) : null;

  const kueri: string[] = [];
  const tambah = (q: string) => {
    const bersih = bersihkan(q);
    if (bersih.length > 0 && !kueri.includes(bersih)) kueri.push(bersih);
  };

  if (jenis === "tren") {
    tambah(`tren ${istilah} Indonesia ${tahun}`);
    if (kategori) tambah(`tren ${kategori} Indonesia ${tahun}`);
    tambah(`${istilah} populer Indonesia`);
    // ⚠️ Satu kueri bahasa Inggris: pasar kecantikan Indonesia banyak diliput
    // media berbahasa Inggris, dan kueri Indonesia saja melewatkannya.
    if (kategori) tambah(`${kategori} market trend Indonesia ${tahun}`);
  } else if (jenis === "pesaing") {
    // ⚠️ TIDAK menyebut merek kita sendiri dalam kueri pesaing. Yang dicari
    // adalah gerak pasar, dan menyandingkan nama kita dengan kata "pesaing"
    // di mesin pencari adalah keterangan yang kita berikan cuma-cuma.
    if (kategori) {
      tambah(`merek ${kategori} Indonesia ${tahun}`);
      tambah(`brand ${kategori} Indonesia market share`);
    }
    tambah(`produk ${istilah} merek lain Indonesia`);
  } else if (jenis === "musiman") {
    tambah(`penjualan ${kategori ?? istilah} Indonesia lebaran ${tahun}`);
    tambah(`tren belanja kecantikan Indonesia akhir tahun ${tahun}`);
  } else {
    tambah(`industri kosmetik Indonesia ${tahun}`);
    tambah(`regulasi BPOM kosmetik ${tahun}`);
    if (kategori) tambah(`berita industri ${kategori} Indonesia`);
  }

  // Merek ikut HANYA untuk riset tren, dan hanya kalau ada — untuk melihat
  // pemberitaan publik tentang produk yang memang sudah beredar.
  if (jenis === "tren" && merek) tambah(`${merek} ${istilah}`);

  return kueri.slice(0, MAKS_KUERI);
}

/**
 * Memeriksa bahwa sebuah kueri aman dikirim keluar.
 *
 * ⚠️ PENJAGA LAPIS KEDUA, dan sengaja menduakan `susunKueri()`. Lapis pertama
 * bekerja dengan tidak pernah menerima data rahasia; lapis ini memeriksa
 * hasilnya sekali lagi tepat sebelum dikirim. Kalau suatu hari ada yang
 * memanggil penyedia tanpa lewat `susunKueri()`, penjaga ini yang menangkap.
 *
 * Memulangkan alasan penolakan, atau `null` kalau aman.
 */
export function tolakKueri(kueri: string): string | null {
  if (kueri.length === 0) return "kueri kosong";
  if (kueri.length > MAKS_PANJANG_KUERI) return `kueri lebih dari ${MAKS_PANJANG_KUERI} huruf`;
  // Kode SKU di katalog ini 7 angka berurutan. Angka sepanjang itu tidak
  // pernah muncul di kueri pasar yang sah.
  if (/\d{5,}/.test(kueri)) return "memuat angka panjang yang mirip kode internal atau angka penjualan";
  if (/\b(rp|idr)\s*\d/i.test(kueri)) return "memuat nilai rupiah";
  if (/[^\p{L}\p{N}\s-]/u.test(kueri)) return "memuat tanda baca yang tidak diizinkan";
  return null;
}
