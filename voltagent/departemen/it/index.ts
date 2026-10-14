import type { KonfigDepartemen } from "../tipe";
import { KAMUS_DATA } from "./kamus-data";

/**
 * Departemen IT / helpdesk.
 *
 * ⚠️ SATU-SATUNYA DEPARTEMEN TANPA DATABASE MySQL DUMMY.
 *
 * Marketing dan HR punya database dummy berisi data karangan untuk latihan.
 * IT tidak: datanya (10.084 tiket helpdesk) cuma ada di PostgreSQL
 * perusahaan, dan tidak ada gunanya mengarang tiruannya.
 *
 * Akibatnya departemen ini HANYA berfungsi waktu sumber data `perusahaan`
 * yang aktif. Waktu sumbernya `dummy`, agent-nya menjelaskan itu apa adanya
 * -- lihat `KAMUS_DATA`.
 *
 * ⚠️ TANPA `entri` DAN `persetujuan`, dan itu disengaja.
 *
 * Membuat atau menutup tiket berarti MENULIS ke database perusahaan. Sejauh
 * ini kita cuma membaca dari sana, dan menulis butuh izin tersendiri dari
 * pemegang server. Disepakati 30 Sep 2026: ticketing dulu, baca saja.
 */
export const IT: KonfigDepartemen = {
  id: "it",
  label: "IT",
  tujuan: "Menjawab pertanyaan tim helpdesk IT dari data tiket perusahaan.",

  // `db` sengaja tidak diisi -- lihat penjelasan di `tipe.ts`.

  konteks:
    "Kamu asisten data untuk tim helpdesk IT sebuah perusahaan kosmetik &\n" +
    "jamu. Yang kamu bantu adalah orang IT yang menangani tiket, bukan\n" +
    "pengguna yang melaporkan masalah.",

  kamusData: KAMUS_DATA,

  /**
   * SENGAJA KOSONG. Tool `cari_teks` bekerja pada indeks teks database
   * dummy MySQL, dan departemen ini tidak punya database itu.
   */
  kolomTeks: [],

  contohPertanyaan: [
    "Tiket apa saja yang masih OPEN?",
    "Berapa rata-rata waktu penyelesaian tiket bulan ini?",
    "Kategori masalah apa yang paling sering dilaporkan?",
    "Siapa teknisi dengan tiket terbanyak?",
  ],
};
