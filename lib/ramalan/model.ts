/**
 * Tiga model peramalan di balik satu antarmuka.
 *
 * ============================================================
 * ⚠️ AUTOARIMA BUKAN YANG TERBAIK — DIUKUR, BUKAN DIDUGA
 * ============================================================
 * Backtest 26 Okt 2026 pada tiga produk terlaris, tiga bulan terakhir
 * disembunyikan lalu diramal:
 *
 *   MINYAK ZAITUN 175 ML RJ    ARIMA 33,0%   Naive 31,6%   Musiman 44,5%
 *   MINYAK ZAITUN 75 ML RJ     ARIMA 21,7%   Naive 19,8%   Musiman 21,5%
 *   MINYAK ZAITUN N.PACK       ARIMA 100,0%  Naive 169,7%  Musiman 39,9%
 *
 * AutoARIMA tidak menang sekali pun. Di produk ketiga dia meramal 0, 0, 0
 * padahal penjualan nyatanya 3.359 / 2.508 / 1.397 — ramalan yang bentuknya
 * sah tapi isinya tidak berguna.
 *
 * Jadi Naive dan Musiman BUKAN sekadar pembanding. Untuk sebagian besar SKU
 * merekalah modelnya: dari 1.737 SKU, 1.071 (62%) cuma punya <12 bulan data
 * dan tidak punya pilihan lain.
 *
 * Yang memilih model adalah backtest di `pilih.ts`, bukan berkas ini.
 *
 * ============================================================
 * ⚠️ TIGA PENJAGAAN YANG TIDAK BOLEH DILEWAT
 * ============================================================
 * 1. KEBISINGAN WASM DIBUNGKAM. Paket `arima` menulis langsung ke stdout —
 *    "Warning : The Matrix system does not have a unique solution" berulang
 *    puluhan kali per pemanggilan, dan `verbose: false` TIDAK membungkamnya
 *    (diuji). Tanpa pembungkam, satu permintaan menenggelamkan log server.
 *
 * 2. HASIL TIDAK SAH DITOLAK, BUKAN DIPERBAIKI DIAM-DIAM. `NaN`, tak hingga,
 *    dan negatif semuanya berarti modelnya gagal. Penjualan tidak bisa minus.
 *
 * 3. GAGAL MENGAKU GAGAL. Tidak pernah ada angka pengganti. Dokumen
 *    `docs/fitur/sales-forecasting.md` menulisnya eksplisit: "Never fabricate
 *    forecasts when calculation fails." Itu juga aturan yang sudah dipegang
 *    seluruh proyek ini — lihat `lib/jawaban-palsu.ts`.
 */
import { createRequire } from "node:module";
import { MIN_ARIMA, MIN_MUSIMAN } from "./deret";
import { sahkan, type HasilModel } from "./sahkan";
import { MODEL_JARANG } from "./jarang";

// Dipindahkan ke berkasnya sendiri supaya `jarang.ts` bisa memakainya tanpa
// impor berputar; diekspor ulang dari sini supaya pemanggil lama tidak pecah.
export { sahkan };
export type { HasilModel } from "./sahkan";

/**
 * ⚠️ `createRequire`, BUKAN `import`.
 *
 * Paket `arima` dipaketkan CommonJS tanpa `type: module`, dan isinya memuat
 * WASM yang dimuat lewat `fs`. Impor ESM biasa lolos TypeScript tapi bisa
 * mati saat dijalankan — jebakan yang sama persis dengan impor default
 * Baileys (25 Sep 2026). Dimuat MALAS supaya berkas ini bisa diimpor di
 * tempat yang tidak memakai ARIMA sama sekali.
 */
const require = createRequire(import.meta.url);
type KelasArima = new (opsi: Record<string, unknown>) => {
  train(deret: number[]): { predict(n: number): [number[], number[]] };
};
let Arima: KelasArima | undefined;
function muatArima(): KelasArima {
  if (!Arima) {
    const m = require("arima") as KelasArima | { default: KelasArima };
    Arima = typeof m === "function" ? m : m.default;
  }
  return Arima;
}

export type Model = {
  kode: "naive" | "ses" | "musiman" | "arima" | "croston" | "sba" | "tsb" | "adida" | "imapa";
  nama: string;
  /** Berapa titik minimal supaya model ini masuk akal dipakai. */
  minimal: number;
  ramal(deret: number[], horizon: number): HasilModel;
};

/**
 * PEMBANDING, bukan pilihan: sejak 4 Nov 2026 tidak ikut `SEMUA_MODEL`.
 * Mengulang satu bulan bukan prediksi; yang menggantikannya `ses`, dengan ketepatan setara.
 *
 * Model A — bulan depan sama dengan bulan terakhir.
 *
 * Paling sederhana, dan dari backtest 26 Okt 2026 ternyata paling sering
 * menang. Juga satu-satunya yang bisa dipakai untuk 62% SKU.
 */
export const naive: Model = {
  kode: "naive",
  nama: "Naive (sama dengan bulan terakhir)",
  minimal: 2,
  ramal(deret, horizon) {
    if (deret.length < 2) return { ok: false, sebab: "butuh minimal 2 bulan" };
    return sahkan(Array(horizon).fill(deret[deret.length - 1]), horizon);
  },
};

/**
 * SES: tingkat penjualan dari seluruh riwayat, dengan bobot lebih besar ke bulan terbaru.
 *
 * Hasilnya rata seperti Naive, tapi bukan salinan satu bulan: bulan yang kebetulan jatuh
 * tidak langsung menentukan semua angka. Bobotnya dipilih dari kesalahan satu langkah
 * pada riwayat itu sendiri.
 */
const BOBOT_SES = [0.1, 0.2, 0.3, 0.5, 0.7];

export const ses: Model = {
  kode: "ses",
  nama: "SES (rata-rata berbobot ke bulan terbaru)",
  minimal: 2,
  ramal(deret, horizon) {
    if (deret.length < 2) return { ok: false, sebab: "butuh minimal 2 bulan" };
    let terbaik = Infinity;
    let level = deret[0];
    for (const a of BOBOT_SES) {
      let l = deret[0];
      let galat = 0;
      for (let i = 1; i < deret.length; i++) {
        galat += (deret[i] - l) ** 2;
        l = a * deret[i] + (1 - a) * l;
      }
      if (galat < terbaik) {
        terbaik = galat;
        level = l;
      }
    }
    return sahkan(Array(horizon).fill(level), horizon);
  },
};

/**
 * Model B — bulan yang sama tahun lalu.
 *
 * ⚠️ Mengambil dari 12 bulan sebelum TITIK YANG DIRAMAL, bukan 12 bulan
 * sebelum akhir deret. Untuk horizon 1-12 keduanya kebetulan sama; untuk
 * horizon lebih panjang tidak, dan versi yang keliru akan mengulang satu
 * blok yang sama berkali-kali.
 */
export const musiman: Model = {
  kode: "musiman",
  nama: "Musiman (bulan yang sama tahun lalu)",
  minimal: MIN_MUSIMAN,
  ramal(deret, horizon) {
    if (deret.length < MIN_MUSIMAN) {
      return { ok: false, sebab: `butuh minimal ${MIN_MUSIMAN} bulan` };
    }
    // ⚠️ HORIZON LEBIH DARI 12 MENGAMBIL DARI RAMALANNYA SENDIRI.
    //
    // Versi pertama cuma membaca `deret[deret.length + i - 12]`. Untuk
    // horizon <= 12 itu benar; pada horizon ke-13 indeksnya melewati ujung
    // deret dan menghasilkan `undefined` — yang lolos sebagai nilai lalu
    // ditolak `sahkan()` dengan pesan "bukan angka" yang tidak menunjuk
    // sebabnya sama sekali. Ditangkap uji horizon 14 (26 Okt 2026).
    //
    // Yang benar: deret dianggap diteruskan oleh ramalan yang sudah dibuat,
    // jadi tahun kedua ke depan mengulang tahun pertama ke depan — persis
    // arti "musiman".
    const keluar: number[] = [];
    for (let i = 0; i < horizon; i++) {
      const sumber = deret.length + i - 12;
      keluar.push(sumber < deret.length ? deret[sumber] : keluar[sumber - deret.length]);
    }
    return sahkan(keluar, horizon);
  },
};

/**
 * Menjalankan `f` sambil MENAHAN tulisan WASM ke stdout/stderr.
 *
 * ⚠️ Diukur 26 Okt 2026: satu pemanggilan AutoARIMA bisa menumpahkan ratusan
 * huruf "Warning : The Matrix system does not have a unique solution" dan
 * "non-stationary AR part" ke stdout. `verbose: false` tidak mempengaruhinya
 * sama sekali — tulisannya datang dari dalam WASM, bukan dari pembungkus JS.
 *
 * Dikembalikan di `finally` supaya galat sekalipun tidak meninggalkan stdout
 * dalam keadaan tertahan. Kalau itu terjadi, SELURUH log proses mati diam.
 */
function tahanKebisingan<T>(f: () => T): T {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return f();
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

/**
 * Model C — AutoARIMA.
 *
 * ⚠️ BATAS 26 TITIK ITU KERAS, bukan anjuran. Paket `arima` menolak deret
 * lebih pendek dengan "Series too short (24 values). Minimum length for these
 * parameters is 26" — diuji 26 Okt 2026 pada deret 5, 12, 14, dan 24 titik.
 * Diperiksa di sini supaya penolakannya memakai kalimat kita, bukan pesan
 * paket yang menyesatkan (dia menyebut "too short" juga untuk deret datar
 * yang panjangnya cukup).
 */
export const arima: Model = {
  kode: "arima",
  nama: "AutoARIMA",
  minimal: MIN_ARIMA,
  ramal(deret, horizon) {
    if (deret.length < MIN_ARIMA) {
      return { ok: false, sebab: `butuh minimal ${MIN_ARIMA} bulan, ada ${deret.length}` };
    }
    try {
      const nilai = tahanKebisingan(() => {
        const A = muatArima();
        const [ramal] = new A({ auto: true, verbose: false, s: 12 }).train(deret).predict(horizon);
        return ramal;
      });
      return sahkan(nilai, horizon);
    } catch (err) {
      // Galat dari WASM dipulangkan apa adanya, dipendekkan. Menggantinya
      // dengan kalimat umum membuang satu-satunya petunjuk yang berguna.
      return { ok: false, sebab: (err as Error).message.slice(0, 120) };
    }
  },
};

/**
 * Semua model, dari yang paling sederhana.
 *
 * ⚠️ Lima model permintaan terputus ikut di sini, tapi mereka MENOLAK SENDIRI
 * kalau deretnya tidak terputus — lihat `MIN_BULAN_NOL` di `jarang.ts`.
 * Sebabnya pemilihnya menilai dengan backtest tiga bulan saja: makin banyak
 * kandidat yang bersaing di tiga titik, makin besar peluang salah satunya
 * menang karena kebetulan. Jadi yang tidak punya alasan untuk ikut, tidak
 * ikut, dan alasan penolakannya tetap terlihat di daftar kandidat.
 */
export const SEMUA_MODEL: Model[] = [ses, musiman, arima, ...MODEL_JARANG];

/** Model yang panjang deretnya mencukupi. Tidak menjamin hasilnya bagus. */
export function modelYangMungkin(panjang: number): Model[] {
  return SEMUA_MODEL.filter((m) => panjang >= m.minimal);
}
