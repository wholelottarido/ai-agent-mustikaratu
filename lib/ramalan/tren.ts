/**
 * Arah ramalan dibanding penjualan yang baru terjadi (§22 spesifikasi tim sebelah).
 *
 * Dihitung di sini, bukan oleh model bahasa: persentase yang dihitung model
 * adalah angka yang tidak pernah diuji siapa pun.
 */

/** Di luar +-5% baru disebut naik atau turun. Persis 5% masih stabil. */
export const BATAS_TREN = 5;

/** Berapa bulan aktual terakhir yang jadi pembanding. */
export const BULAN_PEMBANDING = 3;

export type Tren = {
  arah: "naik" | "turun" | "stabil" | "tidak-dinilai";
  perubahan_persen: number | null;
  dibanding: string;
  /** Tersedia di sini supaya model bahasa tidak menghitung rata-ratanya sendiri. */
  rata_rata_pembanding: number | null;
  sebab_tidak_dinilai?: string;
};

function rataRata(x: number[]): number {
  return x.reduce((a, b) => a + b, 0) / x.length;
}

/**
 * `bukanModel` untuk angka pengganti "rata-rata 3 bulan terakhir".
 *
 * ⚠️ Di situ ramalan dibandingkan dengan dirinya sendiri, jadi hasilnya selalu
 * "stabil 0,0%", tepat pada produk yang penjualannya justru tidak stabil.
 * Spesifikasi tim sebelah menampilkannya begitu; di sini tidak dinilai.
 */
export function ringkasTren(
  aktual: number[],
  bulan: string[],
  ramalan: number[],
  bukanModel = false,
): Tren {
  const pembanding = aktual.slice(-BULAN_PEMBANDING);
  const bulanDasar = bulan.slice(-BULAN_PEMBANDING);
  const dasar = pembanding.length > 0 ? rataRata(pembanding) : 0;
  const rata_rata_pembanding = pembanding.length > 0 ? Math.round(dasar) : null;
  const dibanding = bulanDasar.length > 0
    ? `rata-rata ${bulanDasar.length} bulan aktual terakhir (${bulanDasar[0]} sampai ${bulanDasar[bulanDasar.length - 1]})`
    : "tidak ada data aktual";
  const tidakDinilai = (sebab: string): Tren =>
    ({ arah: "tidak-dinilai", perubahan_persen: null, dibanding, rata_rata_pembanding, sebab_tidak_dinilai: sebab });

  if (bukanModel) return tidakDinilai("angkanya sendiri rata-rata bulan terakhir, jadi tidak ada yang dibandingkan");
  if (pembanding.length === 0 || ramalan.length === 0) return tidakDinilai("data tidak cukup");

  if (!(dasar > 0)) return tidakDinilai("tidak ada penjualan pada bulan pembanding");

  // Dibulatkan DULU baru dinilai: 105/100 terhitung 5,000000000000004%, dan label
  // "naik" di samping angka 5,0% berlawanan dengan aturan yang ditampilkan.
  const persen = Math.round((rataRata(ramalan) / dasar - 1) * 1000) / 10;
  const arah = persen > BATAS_TREN ? "naik" : persen < -BATAS_TREN ? "turun" : "stabil";
  return { arah, perubahan_persen: persen, dibanding, rata_rata_pembanding };
}
