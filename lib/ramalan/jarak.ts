/**
 * Seberapa meleset ramalan menurut jaraknya dari data terakhir dan besar penjualannya.
 *
 * Diukur `scripts/ukur-gabungan.mts`, 4 Nov 2026: 445 produk, 3 titik potong. Angka
 * ketepatan per produk hanya diuji pada jarak 3 bulan, padahal data yang tertinggal
 * membuat "3 bulan ke depan" berjarak lebih jauh dari itu.
 *
 * ⚠️ Volume wajib ikut. Pada jarak yang sama, produk kecil meleset beberapa kali lipat
 * produk laris, jadi satu angka untuk semua produk menyesatkan keduanya.
 *
 * ⚠️ Ini angka tetap dari satu pengukuran, bukan hitungan per produk. Ukur ulang kalau
 * model atau datanya berubah banyak. LightGBM tidak ikut diukur.
 */
export type Volume = "laris" | "sedang" | "kecil";
type Jarak = { dari: number; sampai: number; melesetPersen: number };

/** Meleset = median per produk. */
export const UKURAN_JARAK: Record<Volume, Jarak[]> = {
  laris: [
    { dari: 1, sampai: 3, melesetPersen: 25 },
    { dari: 4, sampai: 6, melesetPersen: 30 },
    { dari: 7, sampai: 8, melesetPersen: 48 },
    { dari: 9, sampai: 12, melesetPersen: 48 },
  ],
  sedang: [
    { dari: 1, sampai: 3, melesetPersen: 34 },
    { dari: 4, sampai: 6, melesetPersen: 45 },
    { dari: 7, sampai: 8, melesetPersen: 51 },
    { dari: 9, sampai: 12, melesetPersen: 61 },
  ],
  kecil: [
    { dari: 1, sampai: 3, melesetPersen: 78 },
    { dari: 4, sampai: 6, melesetPersen: 105 },
    { dari: 7, sampai: 8, melesetPersen: 122 },
    { dari: 9, sampai: 12, melesetPersen: 157 },
  ],
};

/**
 * Pengali lebar rentang menurut jarak. Lebar dari uji jarak dekat terlalu sempit untuk bulan yang
 * lebih jauh. Diukur `scripts/ukur-rentang.mts`, 4 Nov 2026: pengali dari periode lama, diuji pada
 * periode baru, menaikkan penjualan yang masuk rentang dari 57-67% menjadi 86-89%.
 *
 * Angka ini dihitung ulang dari semua periode, jadi sedikit lebih rapat daripada yang diuji.
 * Diukur pada jumlah unit; rentang rupiah memakai pengali yang sama.
 */
const PENGALI_RENTANG: Record<Volume, number[]> = {
  laris: [1.36, 1.87, 2.06, 2.18],
  sedang: [1.31, 1.74, 1.98, 2.09],
  kecil: [1.29, 1.75, 1.84, 1.96],
};

/** `jarak` = berapa bulan dari data terakhir. */
export function pengaliRentang(jarak: number, volume: Volume): number {
  const i = jarak <= 3 ? 0 : jarak <= 6 ? 1 : jarak <= 8 ? 2 : 3;
  return PENGALI_RENTANG[volume][i];
}

const NAMA_VOLUME: Record<Volume, string> = {
  laris: "rata-rata 1.000 unit per bulan atau lebih",
  sedang: "rata-rata 100 sampai 999 unit per bulan",
  kecil: "rata-rata di bawah 100 unit per bulan",
};

/** Dari rata-rata 12 bulan terakhir, sama dengan pengukurannya. */
export function volumePenjualan(qty: number[]): Volume {
  const setahun = qty.slice(-12);
  const rata = setahun.length > 0 ? setahun.reduce((a, b) => a + b, 0) / setahun.length : 0;
  return rata >= 1000 ? "laris" : rata >= 100 ? "sedang" : "kecil";
}

const rentangAngka = (x: number[]) => {
  const a = Math.min(...x);
  const b = Math.max(...x);
  return a === b ? `${a}%` : `${a}-${b}%`;
};

/** Ukuran untuk bulan berjarak `dari` sampai `sampai`. `null` kalau di luar ukuran. */
export function ukurJarak(dari: number, sampai: number, volume: Volume) {
  const kena = UKURAN_JARAK[volume].filter((u) => u.dari <= sampai && u.sampai >= dari);
  if (kena.length === 0) return null;
  const meleset = kena.map((u) => u.melesetPersen);
  return {
    jarak_dari_data_terakhir: dari === sampai ? `${dari} bulan` : `${dari} sampai ${sampai} bulan`,
    penjualan_produk: NAMA_VOLUME[volume],
    biasanya_meleset: rentangAngka(meleset),
    penjualan_masuk_rentang: "sekitar 80-90% dari waktu, pada uji data lama",
    dasar: "pengukuran atas 445 produk; angka ketepatan per produk hanya diuji pada jarak 3 bulan",
    ...(Math.max(...meleset) >= 100
      ? { peringatan: "Melesetnya bisa lebih dari angka ramalannya sendiri, jadi pakai sebagai gambaran sangat kasar." }
      : {}),
  };
}
