/**
 * Tool entri untuk departemen HR.
 *
 * ⚠️ TIDAK MENULIS APA PUN. Menyusun DRAF.
 *
 * Penyimpanan dipicu user — tombol di web, balasan YA di WhatsApp — lewat
 * jalur terpisah yang tidak melibatkan model sama sekali.
 *
 * Dipisah dari `tools-entri.ts` yang isinya entri marketing: dua departemen
 * tidak boleh saling mengimpor berkas entri, supaya tidak ada jalan tak sengaja
 * dari tool HR ke database marketing atau sebaliknya.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import {
  susunDrafLembur,
  sidikDrafLembur,
  drafLemburJadiTeks,
  masalahLemburJadiTeks,
  JAM_MIN,
  JAM_MAKS,
} from "@/lib/entri/lembur";
import {
  susunDrafPelamar,
  sidikDrafPelamar,
  drafPelamarJadiTeks,
  masalahPelamarJadiTeks,
  PENDIDIKAN,
  SUMBER,
} from "@/lib/entri/pelamar";
import {
  lemburMenunggu,
  susunDrafSetuju,
  lemburJadiTeks,
  daftarJadiTeks,
} from "@/lib/entri/persetujuan";

export function buatToolLembur() {
  return createTool({
    name: "siapkan_lembur",
    description:
      "Siapkan DRAF pencatatan lembur karyawan. " +
      "TOOL INI TIDAK MENYIMPAN APA PUN — user yang mengonfirmasi setelah melihat drafnya. " +
      "Sebut nama karyawan APA ADANYA seperti yang diketik user; jangan menebak, " +
      "melengkapi, atau membetulkan namanya sendiri — pencocokan dilakukan tool ini ke database. " +
      "Kalau hasilnya ambigu, sampaikan pilihannya ke user dan TUNGGU jawabannya; jangan memilih sendiri. " +
      "Nilai rupiah TIDAK perlu kamu hitung atau sebut — selalu dihitung dari data gaji.",
    parameters: z.object({
      karyawan: z
        .string()
        .describe("Nama karyawan seperti yang diketik user, atau NIK-nya kalau user menyebut NIK."),
      jam: z
        .number()
        .describe(`Lama lembur dalam jam, ${JAM_MIN} sampai ${JAM_MAKS}, kelipatan 0,5.`),
      alasan: z
        .string()
        .describe("Alasan lembur seperti yang disebut user, mis. 'closing bulanan'. Wajib."),
      tanggal: z
        .string()
        .optional()
        .describe("Tanggal lembur YYYY-MM-DD. Kosongkan kalau user tidak menyebut — berarti hari ini."),
    }),
    execute: async ({ karyawan, jam, alasan, tanggal }) => {
      const hasil = await susunDrafLembur({ karyawan, jam, alasan, tanggal });

      if (!hasil.ok) {
        // Dikembalikan sebagai hasil biasa, bukan dilempar sebagai error: ini
        // BUKAN kegagalan sistem, tapi sesuatu yang harus diperjelas user.
        return {
          status: "perlu-diperjelas" as const,
          pesan: [
            "DRAF LEMBUR BELUM BISA DIBUAT.",
            "",
            masalahLemburJadiTeks(hasil.masalah),
            "",
            "Sampaikan ini ke user apa adanya dan tunggu jawabannya. Jangan memilih sendiri.",
          ].join("\n"),
        };
      }

      // `draf`, `sidik`, dan `permintaan` DIPAKAI KLIEN, bukan model: kartu
      // konfirmasi di web dan balasan YA di WhatsApp membacanya dari sini.
      // Model cukup membaca `pesan`.
      return {
        status: "siap" as const,
        pesan: [
          "DRAF LEMBUR SIAP — BELUM TERSIMPAN.",
          "",
          drafLemburJadiTeks(hasil.draf),
          "",
          "Tampilkan draf ini ke user, lalu minta dia mengonfirmasi. " +
            "Kamu TIDAK bisa menyimpannya sendiri.",
        ].join("\n"),
        draf: hasil.draf,
        sidik: sidikDrafLembur(hasil.draf),
        permintaan: { karyawan, jam, alasan, tanggal },
      };
    },
  });
}

/**
 * Tool entri pelamar — untuk STAF HR.
 *
 * ⚠️ Tidak menyentuh gaji sama sekali, dan itu disengaja: entitas ini dipilih
 * justru untuk peran yang memang tidak boleh melihat gaji.
 */
export function buatToolPelamar() {
  return createTool({
    name: "siapkan_pelamar",
    description:
      "Siapkan DRAF data pelamar baru untuk sebuah lowongan. " +
      "TOOL INI TIDAK MENYIMPAN APA PUN — user yang mengonfirmasi setelah melihat drafnya. " +
      "Pelamar adalah orang BARU: tulis namanya apa adanya, jangan dicocokkan ke data karyawan. " +
      "JANGAN mengarang isian yang tidak disebut user — kalau ada yang kurang, tanyakan dulu. " +
      "Kalau tool menolak, sampaikan alasan dan pilihan yang sah APA ADANYA.",
    parameters: z.object({
      lowongan: z.string().describe("Kode lowongan, mis. 'LOW-2026-014'."),
      nama: z.string().describe("Nama lengkap pelamar seperti yang diketik user."),
      email: z.string().describe("Alamat email pelamar."),
      pendidikan: z.string().describe(`Salah satu dari: ${PENDIDIKAN.join(", ")}.`),
      pengalaman: z.number().int().describe("Lama pengalaman kerja dalam tahun. 0 kalau fresh graduate."),
      sumber: z.string().describe(`Dari mana lamarannya datang. Salah satu dari: ${SUMBER.join(", ")}.`),
      telepon: z.string().optional().describe("Nomor telepon. Boleh kosong."),
      tanggal: z
        .string()
        .optional()
        .describe("Tanggal lamaran YYYY-MM-DD. Kosongkan kalau user tidak menyebut — berarti hari ini."),
    }),
    execute: async ({ lowongan, nama, email, pendidikan, pengalaman, sumber, telepon, tanggal }) => {
      const permintaan = { lowongan, nama, email, pendidikan, pengalaman, sumber, telepon, tanggal };
      const hasil = await susunDrafPelamar(permintaan);

      if (!hasil.ok) {
        return {
          status: "perlu-diperjelas" as const,
          pesan: [
            "DRAF PELAMAR BELUM BISA DIBUAT.",
            "",
            masalahPelamarJadiTeks(hasil.masalah),
            "",
            "Sampaikan ini ke user apa adanya dan tunggu jawabannya. Jangan menebak sendiri.",
          ].join("\n"),
        };
      }

      return {
        status: "siap" as const,
        pesan: [
          "DRAF PELAMAR SIAP — BELUM TERSIMPAN.",
          "",
          drafPelamarJadiTeks(hasil.draf),
          "",
          "Tampilkan draf ini ke user, lalu minta dia mengonfirmasi. " +
            "Kamu TIDAK bisa menyimpannya sendiri.",
        ].join("\n"),
        draf: hasil.draf,
        sidik: sidikDrafPelamar(hasil.draf),
        permintaan,
      };
    },
  });
}

/**
 * Tool persetujuan lembur — untuk KEPALA HR.
 *
 * ⚠️ SATU tool untuk dua kebutuhan, bukan dua tool.
 *
 * Tanpa `id` dia menampilkan DAFTAR yang menunggu; dengan `id` dia menyiapkan
 * SATU keputusan. Dipisah jadi dua tool, kepala HR akan punya 4 tool sekaligus
 * — dan sudah terukur di proyek ini bahwa makin banyak tool makin sering model
 * berhenti memanggilnya sama sekali (lihat catatan `pilihTools`).
 *
 * ⚠️ TIDAK MEMUTUSKAN APA PUN. Keputusan dipicu user lewat tombol/balasan.
 */
export function buatToolKeputusanLembur() {
  return createTool({
    name: "siapkan_keputusan_lembur",
    description:
      "Lihat lembur yang menunggu persetujuan, atau siapkan keputusan untuk SATU lembur. " +
      "Tanpa `id`: menampilkan daftar yang menunggu. Dengan `id`: menyiapkan keputusannya. " +
      "TOOL INI TIDAK MENYETUJUI APA PUN — user yang memutuskan lewat tombol. " +
      "Kalau user minta menyetujui tanpa menyebut nomor, panggil tanpa `id` dulu lalu " +
      "tampilkan daftarnya dan TUNGGU dia memilih. Jangan memilihkan.",
    parameters: z.object({
      id: z
        .number()
        .int()
        .optional()
        .describe("Nomor lembur yang akan diputuskan. Kosongkan untuk melihat daftar yang menunggu."),
    }),
    execute: async ({ id }) => {
      if (id === undefined) {
        const daftar = await lemburMenunggu();
        return {
          status: "daftar" as const,
          pesan: [
            "LEMBUR YANG MENUNGGU PERSETUJUAN:",
            "",
            daftarJadiTeks(daftar),
            "",
            "Tampilkan daftar ini ke user dan minta dia menyebut nomornya. " +
              "Jangan memilihkan, dan jangan menyetujui apa pun sendiri.",
          ].join("\n"),
          jumlah: daftar.length,
        };
      }

      const hasil = await susunDrafSetuju(id);
      if (!hasil.ok) {
        return {
          status: "ditolak" as const,
          sebab: hasil.sebab,
          pesan: ["KEPUTUSAN TIDAK BISA DISIAPKAN.", "", hasil.pesan, "", "Sampaikan ini apa adanya."].join("\n"),
        };
      }

      // `lembur` dipakai KLIEN (kartu & balasan WhatsApp), bukan model.
      return {
        status: "siap" as const,
        pesan: [
          "LEMBUR INI MENUNGGU KEPUTUSAN — BELUM DIPUTUSKAN.",
          "",
          lemburJadiTeks(hasil.lembur),
          "",
          "Tampilkan ke user, lalu minta dia menyetujui atau menolak. " +
            "Kalau menolak, alasannya WAJIB diisi user — jangan kamu karang. " +
            "Kamu TIDAK bisa memutuskan sendiri.",
        ].join("\n"),
        lembur: hasil.lembur,
      };
    },
  });
}
