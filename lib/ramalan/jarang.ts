/**
 * Model untuk PERMINTAAN TERPUTUS — produk yang beberapa bulan tidak terjual.
 *
 * ============================================================
 * ⚠️ DITULIS DI TYPESCRIPT, BUKAN LEWAT LAYANAN PYTHON
 * ============================================================
 * Rencana Tahap C semula: layanan Python berisi `statsforecast` supaya bisa
 * memakai Croston, ADIDA, IMAPA, AutoETS, AutoTheta. Diputuskan 27 Okt 2026
 * untuk TIDAK melakukannya, dan sebabnya bukan selera:
 *
 * 1. Rumusnya memang sesederhana ini. Croston = dua pemulusan eksponensial
 *    yang dijalankan bergantian. Seluruh berkas ini di bawah 200 baris isi.
 *    Menambahkan satu bahasa, satu proses, satu port, dan satu daftar
 *    kebergantungan untuk aritmetika sebanyak ini adalah biaya tanpa imbalan.
 *
 * 2. Prosesnya harus hidup supaya ramalannya jalan. Layanan yang mati berarti
 *    jawaban yang hilang di layar pemakai — dan pemakai portal ini tidak
 *    menjalankan apa pun selain `npm run dev`.
 *
 * 3. Datanya tidak keluar dari proses Node. Aturan proyek ini tegas: "Jangan
 *    mengirim data sensitif perusahaan" ke luar. Localhost memang bukan
 *    internet, tapi tiap batas proses baru adalah satu tempat baru yang bisa
 *    salah dikonfigurasi.
 *
 * Yang TIDAK bisa dipindahkan ke sini dan karena itu dilepas: Chronos-2
 * (model fondasi, ratusan MB bobot + runtime tensor) dan AutoETS/AutoARIMA
 * versi state-space penuh. AutoARIMA sudah ada lewat paket `arima`.
 *
 * ============================================================
 * ⚠️ KENAPA RATA-RATA 3 BULAN TIDAK CUKUP UNTUK PRODUK INI
 * ============================================================
 * Deret seperti 0, 0, 14, 0, 0, 9, 0, 0, 11 punya rata-rata 3,8/bulan. Naive
 * menjawab "0" kalau bulan terakhir nol, dan "11" kalau tidak — dua jawaban
 * yang dua-duanya salah. Croston memisahkan DUA pertanyaan yang tercampur di
 * situ: kalau terjual, berapa banyak (ukuran), dan seberapa sering terjual
 * (jarak). Ramalannya ukuran dibagi jarak.
 *
 * ============================================================
 * ⚠️ HASILNYA RATA — DAN ITU DISENGAJA
 * ============================================================
 * Semua model di berkas ini memulangkan satu angka yang sama untuk seluruh
 * horizon. Untuk permintaan terputus itu memang jawaban yang jujur: tidak ada
 * keterangan apa pun yang memberi tahu bulan MANA penjualan berikutnya jatuh.
 * Model yang memberi angka naik-turun untuk deret seperti ini sedang
 * mengarang pola dari derau.
 *
 * ⚠️ BATASNYA: lajunya dibulatkan per bulan oleh `sahkan()` di `model.ts`.
 * Produk dengan laju 0,4 unit/bulan keluar sebagai 0 tiap bulan — tiga bulan
 * yang jumlahnya 1,2 unit menjadi 0. Untuk produk sejarang itu memang tidak
 * ada angka bulanan yang berarti, tapi pembaca perlu tahu nolnya berasal dari
 * pembulatan, bukan dari ramalan bahwa penjualannya berhenti.
 */
import type { Model } from "./model";
import { sahkan, type HasilModel } from "./sahkan";

/**
 * Batas penggolongan Syntetos-Boylan-Croston. ADI = rata-rata jarak antar
 * penjualan; CV² = ragam relatif ukuran penjualan.
 *
 *   ADI < 1,32 & CV² < 0,49  halus        -> model biasa
 *   ADI >= 1,32 & CV² < 0,49 terputus     -> Croston / SBA
 *   ADI < 1,32 & CV² >= 0,49 tak teratur  -> model biasa
 *   ADI >= 1,32 & CV² >= 0,49 bergumpal   -> SBA / TSB
 */
export const ADI_TERPUTUS = 1.32;
export const CV2_TAK_TERATUR = 0.49;

/**
 * ⚠️ PENJAGA UNDIAN, bukan penjaga teori.
 *
 * Model di berkas ini hanya ikut bersaing kalau deretnya MEMANG terputus.
 * Sebabnya bukan karena rumusnya rusak pada deret padat — pada deret tanpa
 * bulan nol, Croston menyusut menjadi pemulusan eksponensial biasa dan
 * hasilnya wajar. Sebabnya: pemilihnya menilai kandidat dengan backtest
 * TIGA bulan. Delapan kandidat yang bersaing pada tiga titik berarti makin
 * besar peluang salah satunya menang karena kebetulan, bukan karena lebih
 * benar. Jadi yang tidak punya alasan teoretis untuk ikut, tidak ikut.
 *
 * Ambangnya lebih longgar daripada `ADI_TERPUTUS` (1,32 ≈ 24% bulan nol):
 * dua bulan nol sudah cukup untuk membuat pemisahan ukuran-dan-jarak masuk
 * akal, sementara penggolongan SBC dibuat untuk suku cadang yang deretnya
 * jauh lebih panjang daripada 12-86 bulan yang kita punya.
 */
export const MIN_BULAN_NOL = 2;

/** Butuh beberapa penjualan untuk punya jarak yang bisa diukur sama sekali. */
export const MIN_PENJUALAN = 3;

/** Deret yang lebih pendek tidak cukup untuk melihat keterputusannya. */
export const MIN_JARANG = 6;

/**
 * ⚠️ ALFA DIPILIH PER PRODUK, tidak dipatok.
 *
 * Pustaka biasanya memakai 0,1 tetap. Dengan deret 12-86 bulan dan hanya
 * beberapa penjualan di dalamnya, alfa 0,1 berarti ramalannya hampir
 * seluruhnya ditentukan nilai awal — model yang nyaris tidak belajar dari
 * datanya sendiri.
 *
 * ⚠️ Dipilih dari galat satu-langkah-ke-depan PADA DERET YANG DITERIMA, dan
 * itu bukan kebocoran data: saat backtest, `pilihModel()` memanggil model ini
 * dengan deret yang bulan ujinya SUDAH DIPOTONG. Jadi yang dilihat alfa
 * hanyalah data yang memang boleh dilihat model pada saat itu.
 */
export const ALFA = [0.05, 0.1, 0.15, 0.2, 0.3];

/** Pemulus peluang TSB. Lebih kecil daripada alfa: peluang bergerak lebih lambat. */
export const BETA = [0.01, 0.05, 0.1, 0.2];

/** Terlalu banyak ember membuat ADIDA kehabisan titik untuk dinilai. */
export const MAKS_EMBER = 6;

export type Ciri = {
  /** Rata-rata jarak antar penjualan. 1 berarti terjual tiap bulan. */
  adi: number;
  /** Ragam relatif ukuran penjualan. */
  cv2: number;
  nol: number;
  /** Ukuran tiap penjualan yang bukan nol. */
  ukuran: number[];
  golongan: "halus" | "terputus" | "tak teratur" | "bergumpal";
};

/** Ciri keterputusan sebuah deret. `null` kalau tidak pernah ada penjualan. */
export function ciriJarang(deret: number[]): Ciri | null {
  const ukuran = deret.filter((v) => v > 0);
  if (ukuran.length === 0) return null;
  const adi = deret.length / ukuran.length;
  const rata = ukuran.reduce((a, b) => a + b, 0) / ukuran.length;
  const ragam = ukuran.reduce((t, v) => t + (v - rata) ** 2, 0) / ukuran.length;
  const cv2 = rata === 0 ? 0 : ragam / rata ** 2;
  const terputus = adi >= ADI_TERPUTUS;
  const beragam = cv2 >= CV2_TAK_TERATUR;
  return {
    adi,
    cv2,
    nol: deret.length - ukuran.length,
    ukuran,
    golongan: terputus
      ? beragam
        ? "bergumpal"
        : "terputus"
      : beragam
        ? "tak teratur"
        : "halus",
  };
}

/**
 * Apakah model permintaan terputus pantas ikut bersaing untuk deret ini.
 *
 * Memulangkan alasan penolakan sebagai teks, atau `null` kalau boleh ikut.
 * ⚠️ Alasannya ditulis lengkap karena ikut tampil ke pemakai sebagai kandidat
 * yang ditolak — lihat `kenapa_tiap_model_gagal` di `tools-ramalan.ts`.
 */
export function tolakJarang(deret: number[]): string | null {
  if (deret.length < MIN_JARANG) {
    return `butuh minimal ${MIN_JARANG} bulan, ada ${deret.length}`;
  }
  const c = ciriJarang(deret);
  if (!c) return "tidak pernah ada penjualan tercatat";
  if (c.ukuran.length < MIN_PENJUALAN) {
    return `cuma ${c.ukuran.length} bulan yang ada penjualannya — terlalu sedikit untuk mengukur jaraknya`;
  }
  if (c.nol < MIN_BULAN_NOL) {
    return (
      `cuma ${c.nol} bulan tanpa penjualan, jadi permintaannya tidak terputus — ` +
      `model ini sengaja tidak ikut bersaing supaya tidak menang karena kebetulan`
    );
  }
  return null;
}

/**
 * Penjaga terpisah untuk ADIDA dan IMAPA — LEBIH LONGGAR, dan ada alasannya.
 *
 * ============================================================
 * ⚠️ DIUKUR DULU, BUKAN DIDUGA — DAN DUGAANNYA SALAH
 * ============================================================
 * Tahap C semula diputuskan dengan alasan "ada 36 dari 150 produk terlaris
 * yang cuma dapat rata-rata 3 bulan, dan model permintaan terputus akan
 * menolong mereka". Diukur 27 Okt 2026, dugaan itu keliru:
 *
 *   golongan 150 produk terlaris: halus 72, tak teratur 78
 *   terputus 0, bergumpal 0
 *
 * Produk terlaris memang terjual TIAP BULAN — tentu saja. Yang membuat mereka
 * jatuh ke rata-rata bukan bulan yang kosong, tapi RAGAM yang lebar
 * (CV² >= 0,49, golongan "tak teratur"). Croston, SBA, dan TSB tidak
 * menjawab itu sama sekali: seluruh mekanismenya tentang JARAK antar
 * penjualan, dan pada deret tanpa bulan kosong jaraknya selalu 1.
 *
 * ============================================================
 * TAPI ADIDA DAN IMAPA MENJAWAB HAL YANG BERBEDA
 * ============================================================
 * Keduanya bekerja dengan MENUMPUK beberapa bulan menjadi satu. Menumpuk
 * mengurangi ragam — itu berlaku untuk deret yang berayun lebar, bukan hanya
 * untuk deret yang bolong. Kourentzes & Petropoulos menunjukkan agregasi
 * temporal menolong deret yang tidak terputus juga.
 *
 * Jadi keduanya boleh ikut kalau deretnya terputus ATAU ragamnya lebar,
 * sementara Croston/SBA/TSB tetap hanya untuk yang terputus. Pembedaannya
 * bukan kelonggaran: ia mengikuti apa yang masing-masing rumus kerjakan.
 */
export function tolakAgregasi(deret: number[]): string | null {
  if (deret.length < MIN_JARANG) {
    return `butuh minimal ${MIN_JARANG} bulan, ada ${deret.length}`;
  }
  const c = ciriJarang(deret);
  if (!c) return "tidak pernah ada penjualan tercatat";
  if (c.nol >= MIN_BULAN_NOL) return null;
  if (c.cv2 >= CV2_TAK_TERATUR) return null;
  return (
    `penjualannya terjadi tiap bulan dan ragamnya sempit (CV² ${c.cv2.toFixed(2)} < ` +
    `${CV2_TAK_TERATUR}), jadi menumpuk beberapa bulan tidak menolong apa-apa — ` +
    `model ini sengaja tidak ikut bersaing supaya tidak menang karena kebetulan`
  );
}

type Jalan = {
  /** Ramalan satu-langkah untuk tiap bulan yang bisa dinilai; `null` di bulan yang belum. */
  pas: (number | null)[];
  /** Laju ramalan ke depan, per bulan. */
  laju: number;
};

/** Jumlah selisih mutlak satu-langkah. Dasar pemilihan alfa. */
function galatPas(deret: number[], pas: (number | null)[]): number {
  let t = 0;
  for (let i = 0; i < deret.length; i++) {
    const p = pas[i];
    if (p !== null) t += Math.abs(deret[i] - p);
  }
  return t;
}

/**
 * Croston, dan SBA kalau `sba` benar.
 *
 * ⚠️ SBA = Croston × (1 − alfa/2). Bukan tambalan: Syntetos & Boylan (2001)
 * membuktikan Croston punya bias KE ATAS yang sistematis, karena rata-rata
 * dari ukuran-dibagi-jarak tidak sama dengan rata-rata ukuran dibagi
 * rata-rata jarak. Koreksinya tepat sebesar itu.
 *
 * ⚠️ Nilai awal diambil dari penjualan PERTAMA, bukan dari rata-rata seluruh
 * deret. Rata-rata seluruh deret terlihat lebih stabil, tapi nilai awalnya
 * jadi memuat keterangan dari bulan-bulan yang belum terjadi pada titik itu —
 * dan galat satu-langkah yang dipakai memilih alfa akan terlihat lebih bagus
 * daripada kenyataannya.
 */
function jalanCroston(deret: number[], alfa: number, sba: boolean): Jalan | null {
  const pertama = deret.findIndex((v) => v > 0);
  if (pertama < 0) return null;
  const faktor = sba ? 1 - alfa / 2 : 1;
  let ukuran = deret[pertama];
  let jarak = pertama + 1;
  let sejak = 0;
  const pas: (number | null)[] = deret.map(() => null);
  for (let t = pertama + 1; t < deret.length; t++) {
    // Dari keadaan SEBELUM melihat deret[t] — kalau sesudah, ini bukan
    // ramalan satu langkah ke depan, ini pembacaan jawaban.
    pas[t] = (faktor * ukuran) / jarak;
    sejak += 1;
    if (deret[t] > 0) {
      ukuran += alfa * (deret[t] - ukuran);
      jarak += alfa * (sejak - jarak);
      sejak = 0;
    }
  }
  return { pas, laju: (faktor * ukuran) / jarak };
}

/**
 * TSB (Teunter-Syntetos-Babai, 2011).
 *
 * ⚠️ Bedanya dari Croston ada di satu kata: peluangnya diperbarui SETIAP
 * bulan, termasuk bulan yang tidak ada penjualan. Croston hanya memperbarui
 * keadaannya waktu ada penjualan, jadi untuk produk yang penjualannya baru
 * saja berhenti ia menahan laju lamanya tanpa batas waktu. TSB meluruh.
 *
 * Itu penting di sini karena produk yang sudah lama berhenti dijual sudah
 * dibuang lebih awal oleh `BULAN_BERHENTI`, tapi yang baru diam 1-2 bulan
 * tidak — dan di situlah bedanya terasa.
 */
function jalanTsb(deret: number[], alfa: number, beta: number): Jalan | null {
  const pertama = deret.findIndex((v) => v > 0);
  if (pertama < 0) return null;
  let ukuran = deret[pertama];
  let peluang = 1 / (pertama + 1);
  const pas: (number | null)[] = deret.map(() => null);
  for (let t = pertama + 1; t < deret.length; t++) {
    pas[t] = peluang * ukuran;
    const ada = deret[t] > 0 ? 1 : 0;
    peluang += beta * (ada - peluang);
    if (ada === 1) ukuran += alfa * (deret[t] - ukuran);
  }
  return { pas, laju: peluang * ukuran };
}

/**
 * Menjumlahkan deret ke dalam ember berukuran `k`.
 *
 * ⚠️ DIRATAKAN DARI UJUNG, bukan dari awal. Ember harus berakhir tepat di
 * bulan terakhir yang ada datanya; kalau diratakan dari awal, ember
 * terakhirnya separuh terisi dan nilainya terlihat seperti penurunan
 * penjualan yang tidak pernah terjadi. Bulan paling awal yang tidak cukup
 * untuk satu ember penuh dibuang.
 */
export function emberkan(deret: number[], k: number): number[] {
  // ⚠️ k < 1 akan membuat perulangan di bawah TIDAK PERNAH BERHENTI —
  // `akhir -= 0` selamanya. Pemanggil di berkas ini selalu mengirim k >= 1,
  // tapi fungsinya diekspor, dan permintaan web yang menggantung jauh lebih
  // buruk daripada galat yang terbaca.
  if (!Number.isInteger(k) || k < 1) return [];
  const ember: number[] = [];
  for (let akhir = deret.length; akhir - k >= 0; akhir -= k) {
    ember.unshift(deret.slice(akhir - k, akhir).reduce((a, b) => a + b, 0));
  }
  return ember;
}

/**
 * ADIDA — menumpuk dulu, baru meramal, lalu dibagi rata.
 *
 * Menjumlahkan beberapa bulan menjadi satu ember membuat bulan nol ikut
 * terserap: deret 0,0,14,0,0,9 dengan k=3 menjadi 14,9 — tidak terputus lagi,
 * dan pemulusan eksponensial biasa jadi masuk akal dipakai. Lajunya dibagi
 * kembali ke tiap bulan.
 *
 * Memulangkan `null` kalau embernya kurang dari dua: satu ember tidak bisa
 * dinilai sama sekali.
 */
function jalanAdida(deret: number[], k: number, alfa: number): { galat: number; laju: number } | null {
  const ember = emberkan(deret, k);
  if (ember.length < 2) return null;
  let tingkat = ember[0];
  let galat = 0;
  for (let t = 1; t < ember.length; t++) {
    galat += Math.abs(ember[t] - tingkat);
    tingkat += alfa * (ember[t] - tingkat);
  }
  return { galat, laju: tingkat / k };
}

/** Ukuran ember ADIDA: sepanjang jarak rata-rata antar penjualan. */
function ukuranEmber(deret: number[]): number {
  const c = ciriJarang(deret);
  const k = c ? Math.round(c.adi) : 1;
  return Math.min(MAKS_EMBER, Math.max(2, k));
}

/** Alfa terbaik menurut galat satu-langkah, lalu lajunya. */
function terbaik(
  deret: number[],
  buat: (alfa: number) => Jalan | null,
): number | null {
  let laju: number | null = null;
  let galatTerkecil = Infinity;
  for (const a of ALFA) {
    const j = buat(a);
    if (!j) continue;
    const g = galatPas(deret, j.pas);
    if (g < galatTerkecil) {
      galatTerkecil = g;
      laju = j.laju;
    }
  }
  return laju;
}

/**
 * Membungkus laju rata menjadi hasil model.
 *
 * ⚠️ LEWAT `sahkan()`, tidak merakit hasilnya sendiri. Secara matematika laju
 * di berkas ini tidak bisa negatif — ukuran penjualan selalu >= 0 dan jarak
 * selalu > 0 — jadi pemeriksaannya terlihat mubazir. Justru itu sebabnya:
 * pemeriksaan yang dilewati karena "sudah pasti aman" adalah pemeriksaan yang
 * hilang pada perubahan berikutnya, dan yang lolos bukan galat melainkan
 * angka yang ditampilkan ke pemakai sebagai ramalan.
 */
function rata(laju: number | null, horizon: number): HasilModel {
  if (laju === null) return { ok: false, sebab: "lajunya tidak bisa dihitung dari deret ini" };
  return sahkan(Array(horizon).fill(laju), horizon);
}

export const croston: Model = {
  kode: "croston",
  nama: "Croston (permintaan terputus)",
  minimal: MIN_JARANG,
  ramal(deret, horizon) {
    const tolak = tolakJarang(deret);
    if (tolak) return { ok: false, sebab: tolak };
    return rata(terbaik(deret, (a) => jalanCroston(deret, a, false)), horizon);
  },
};

export const sba: Model = {
  kode: "sba",
  nama: "SBA (Croston tanpa bias)",
  minimal: MIN_JARANG,
  ramal(deret, horizon) {
    const tolak = tolakJarang(deret);
    if (tolak) return { ok: false, sebab: tolak };
    return rata(terbaik(deret, (a) => jalanCroston(deret, a, true)), horizon);
  },
};

export const tsb: Model = {
  kode: "tsb",
  nama: "TSB (peluang terjual meluruh)",
  minimal: MIN_JARANG,
  ramal(deret, horizon) {
    const tolak = tolakJarang(deret);
    if (tolak) return { ok: false, sebab: tolak };
    let laju: number | null = null;
    let galatTerkecil = Infinity;
    for (const a of ALFA) {
      for (const b of BETA) {
        const j = jalanTsb(deret, a, b);
        if (!j) continue;
        const g = galatPas(deret, j.pas);
        if (g < galatTerkecil) {
          galatTerkecil = g;
          laju = j.laju;
        }
      }
    }
    return rata(laju, horizon);
  },
};

export const adida: Model = {
  kode: "adida",
  nama: "ADIDA (beberapa bulan ditumpuk)",
  minimal: MIN_JARANG,
  ramal(deret, horizon) {
    const tolak = tolakAgregasi(deret);
    if (tolak) return { ok: false, sebab: tolak };
    const k = ukuranEmber(deret);
    let laju: number | null = null;
    let galatTerkecil = Infinity;
    for (const a of ALFA) {
      const h = jalanAdida(deret, k, a);
      if (!h) continue;
      if (h.galat < galatTerkecil) {
        galatTerkecil = h.galat;
        laju = h.laju;
      }
    }
    if (laju === null) {
      return { ok: false, sebab: `deretnya cuma cukup untuk satu ember ${k} bulan` };
    }
    return rata(laju, horizon);
  },
};

/**
 * IMAPA — ADIDA pada BANYAK ukuran ember sekaligus, lalu dirata-ratakan.
 *
 * ⚠️ Gunanya justru karena ukuran embernya tidak perlu dipilih. ADIDA
 * memakai satu k dari pembulatan ADI, dan pembulatan itu titik tunggal
 * kegagalan: ADI 2,49 dan 2,51 menghasilkan ember yang berbeda dan hasil yang
 * bisa jauh berbeda. IMAPA menghindari keputusan itu dengan merata-ratakan
 * seluruh k yang masuk akal.
 */
export const imapa: Model = {
  kode: "imapa",
  nama: "IMAPA (rata-rata beberapa tumpukan)",
  minimal: MIN_JARANG,
  ramal(deret, horizon) {
    const tolak = tolakAgregasi(deret);
    if (tolak) return { ok: false, sebab: tolak };
    const maks = ukuranEmber(deret);
    const laju: number[] = [];
    for (let k = 1; k <= maks; k++) {
      let terkecil = Infinity;
      let l: number | null = null;
      for (const a of ALFA) {
        const h = jalanAdida(deret, k, a);
        if (!h) continue;
        if (h.galat < terkecil) {
          terkecil = h.galat;
          l = h.laju;
        }
      }
      if (l !== null) laju.push(l);
    }
    if (laju.length === 0) {
      return { ok: false, sebab: "tidak ada ukuran tumpukan yang cukup untuk deret ini" };
    }
    return rata(laju.reduce((a, b) => a + b, 0) / laju.length, horizon);
  },
};

/** Semua model permintaan terputus. */
export const MODEL_JARANG: Model[] = [croston, sba, tsb, adida, imapa];
