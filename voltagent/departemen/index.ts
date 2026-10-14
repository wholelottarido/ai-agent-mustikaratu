/**
 * Daftar departemen yang dikenal sistem.
 *
 * Menambah departemen baru = tambah satu folder di sini + daftarkan di DAFTAR.
 * Tidak perlu menyentuh tool, agent, atau route.
 */
import type { KonfigDepartemen } from "./tipe";
import { MARKETING } from "./marketing";
import { HR } from "./hr";
import { IT } from "./it";

export type { KonfigDepartemen, KolomTeks } from "./tipe";

const DAFTAR: KonfigDepartemen[] = [MARKETING, HR, IT];

export const SEMUA_DEPARTEMEN = DAFTAR;

/** Departemen yang dipakai kalau tidak ada sesi (mis. server debug VoltOps). */
export const DEPARTEMEN_DEFAULT = MARKETING.id;

/**
 * Ambil konfigurasi departemen. Mengembalikan `undefined` kalau tidak dikenal.
 *
 * KEAMANAN: id departemen datang dari sesi login, tapi tetap dilewatkan sini
 * supaya nilai asing tidak pernah menjadi nama database atau nama berkas.
 * Sama prinsipnya dengan `validasiModel()` untuk pilihan model.
 */
export function ambilDepartemen(id: unknown): KonfigDepartemen | undefined {
  return DAFTAR.find((d) => d.id === id);
}

/** Seperti `ambilDepartemen`, tapi jatuh ke default kalau tidak dikenal. */
export function ambilDepartemenAtauDefault(id: unknown): KonfigDepartemen {
  return ambilDepartemen(id) ?? MARKETING;
}
