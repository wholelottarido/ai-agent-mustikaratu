import type { KonfigDepartemen } from "../tipe";
import { KAMUS_DATA } from "./kamus-data";

export const MARKETING: KonfigDepartemen = {
  id: "marketing",
  label: "Marketing",
  tujuan: "Menjawab pertanyaan departemen marketing dari data perusahaan.",

  db: {
    nama: "marketing",
    awalanEnv: "MARKETING",
  },

  konteks:
    "Kamu asisten data untuk departemen Marketing sebuah perusahaan kosmetik & jamu\n" +
    "(B2B lewat distributor/reseller, B2C lewat marketplace & sosmed).",

  kamusData: KAMUS_DATA,

  contohPertanyaan: [
    "Produk apa yang paling laris bulan Agustus?",
    "Berapa omzet per bulan tahun ini?",
    "Kampanye mana yang ROAS-nya paling bagus?",
    "Customer paling sering mengeluh soal apa?",
  ],

  // Staf DAN kepala dua-duanya boleh mencatat penjualan -- perilaku yang
  // sudah berjalan sejak Tahap 2, tidak diubah di sini.
  entri: [{ entitas: "penjualan", peran: ["staf", "kepala"] }],
  kolomTeks: [
    { tabel: "customer_feedback", kolom: "komentar" },
    { tabel: "lead_activity", kolom: "catatan" },
    { tabel: "survey_response", kolom: "jawaban_teks" },
  ],

  petunjukTeks:
    "Untuk menyaring keluhan customer, filter `rating <= 2` di `customer_feedback` " +
    "(atau `<= 3` kalau mau termasuk yang netral). Kolom `rating` itu yang memberi " +
    "tahu positif/negatif — pencarian makna tidak bisa membedakannya.",
};
