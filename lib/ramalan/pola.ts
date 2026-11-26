/**
 * Pola bulanan gabungan semua produk, supaya ramalan SES berbeda antar bulan.
 *
 * Pola per produk terlalu acak, sedangkan total semua produk punya pola (Maret rata-rata 1,15
 * kali, November 0,89 kali, 2023-2025). Diukur `scripts/ukur-faktor-bulan.mts`, 4 Nov 2026:
 * total melesetnya setara angka rata (33,2% lawan 33,5% pada jarak 3-5), tapi per produk lebih
 * sering kalah (108 lawan 164) dan arah naik-turunnya benar sekitar 52%.
 *
 * ⚠️ JADI INI POLA UMUM, BUKAN KEPASTIAN. Dipasang atas keputusan pemilik proyek supaya tiap
 * bulan punya dasar yang terlihat. Jawaban wajib menyebutnya, lihat `tools-ramalan.ts`.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { batasSambung } from "./deret";

const SUSUT = 0.7;
const BULAN_DILIHAT = 48;
const UMUR_MS = 60 * 60 * 1000;

export type PolaBulanan = number[];

const keAngka = (b: string) => {
  const [y, m] = b.split("-").map(Number);
  return y * 12 + m - 1;
};

/**
 * Rasio tiap bulan kalender terhadap rata-rata 12 bulan yang berakhir di bulan itu, dirapatkan
 * ke 1. Elemen ke-0 berarti Januari. Bulan yang contohnya kurang dari dua bernilai 1.
 */
export function hitungPola(total: Map<string, number>): PolaBulanan {
  const angka = new Map([...total].map(([b, v]) => [keAngka(b), v]));
  const ujung = Math.max(...angka.keys());
  const kumpul: number[][] = Array.from({ length: 12 }, () => []);
  for (let n = ujung; n > ujung - BULAN_DILIHAT; n--) {
    const setahun = Array.from({ length: 12 }, (_, i) => angka.get(n - i));
    if (setahun.some((v) => v === undefined)) continue;
    const dasar = (setahun as number[]).reduce((a, b) => a + b, 0) / 12;
    if (dasar > 0) kumpul[n % 12].push((angka.get(n) as number) / dasar);
  }
  return kumpul.map((v) => (v.length >= 2 ? 1 + SUSUT * (v.reduce((a, b) => a + b, 0) / v.length - 1) : 1));
}

/** Faktor untuk bulan `YYYY-MM`. */
export function faktorBulan(pola: PolaBulanan, bulan: string): number {
  return pola[keAngka(bulan) % 12] ?? 1;
}

let singgahan: { pola: PolaBulanan; dibaca: number } | undefined;

/** `undefined` kalau gagal dibaca: ramalan tetap jalan dengan angka rata, bukan galat. */
export async function polaBulanan(): Promise<PolaBulanan | undefined> {
  if (singgahan && Date.now() - singgahan.dibaca < UMUR_MS) return singgahan.pola;
  try {
    const sambung = await batasSambung();
    const { rows } = await poolPerusahaan().query<{ b: string; q: string }>(
      sambung
        ? `SELECT to_char(period, 'YYYY-MM') b, sum(qty)::text q FROM ai_forecast_sales_monthly WHERE source = 'ba_sales' GROUP BY 1
           UNION ALL
           SELECT to_char(trx_date, 'YYYY-MM') b, sum(qty)::text q FROM trx_ba_sales
            WHERE item_code IS NOT NULL AND trx_date >= $1::date AND trx_date < $2::date GROUP BY 1`
        : `SELECT to_char(period, 'YYYY-MM') b, sum(qty)::text q FROM ai_forecast_sales_monthly WHERE source = 'ba_sales' GROUP BY 1`,
      sambung ? [sambung.dari, sambung.sebelum] : [],
    );
    const pola = hitungPola(new Map(rows.map((r) => [r.b, Number(r.q)])));
    singgahan = { pola, dibaca: Date.now() };
    return pola;
  } catch (e) {
    console.error("[polaBulanan] gagal dibaca:", (e as Error).message);
    return undefined;
  }
}
