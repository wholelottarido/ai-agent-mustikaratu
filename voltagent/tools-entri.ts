/**
 * Tool entri data untuk agent.
 *
 * ⚠️ TOOL INI TIDAK MENULIS APA PUN. Dia menyusun DRAF.
 *
 * Penyimpanan dipicu user — tombol di web, balasan "YA" di WhatsApp — lewat
 * jalur terpisah yang tidak melibatkan model sama sekali. Jadi walaupun model
 * salah tafsir, yang keluar cuma draf salah yang user tolak.
 *
 * Di Tahap 1a jalur penyimpanan itu BELUM ADA, dan tidak ada user MySQL yang
 * bisa menulis. Tool ini memakai pool read-only yang sudah ada.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { susunDraf, drafJadiTeks, masalahJadiTeks } from "@/lib/entri/penjualan";
import { susunDrafBatal, batalJadiTeks } from "@/lib/entri/batal";
import { sidikDraf } from "@/lib/entri/simpan";
import type { KonfigDepartemen } from "./departemen";

export function buatToolEntri(dep: KonfigDepartemen, peran: string) {
  return createTool({
    name: "siapkan_penjualan",
    description:
      "Siapkan DRAF pencatatan penjualan dari permintaan user. " +
      "TOOL INI TIDAK MENYIMPAN APA PUN — user yang mengonfirmasi setelah melihat drafnya. " +
      "Sebut nama pelanggan dan produk APA ADANYA seperti yang diketik user; " +
      "jangan menebak, melengkapi, atau membetulkan namanya sendiri — pencocokan " +
      "dilakukan tool ini ke database. " +
      "Kalau hasilnya ambigu atau tidak ketemu, sampaikan pilihannya ke user dan " +
      "TUNGGU jawabannya; jangan memilih sendiri. " +
      "Harga TIDAK perlu kamu sebut — selalu diambil dari database, walaupun user menyebut harga.",
    parameters: z.object({
      pelanggan: z
        .string()
        .describe("Nama pelanggan seperti yang diketik user, mis. 'UD Sentosa Bekasi'."),
      barang: z
        .array(
          z.object({
            produk: z.string().describe("Nama produk seperti yang diketik user."),
            qty: z.number().int().positive().describe("Jumlah unit."),
          }),
        )
        .min(1)
        .describe("Daftar barang yang dijual."),
      tanggal: z
        .string()
        .optional()
        .describe("Tanggal penjualan YYYY-MM-DD. Kosongkan kalau user tidak menyebut — berarti hari ini."),
    }),
    execute: async ({ pelanggan, barang, tanggal }) => {
      const hasil = await susunDraf(dep.id, peran, { pelanggan, barang, tanggal });

      if (!hasil.ok) {
        // Dikembalikan sebagai hasil biasa, bukan dilempar sebagai error:
        // ini BUKAN kegagalan sistem, tapi sesuatu yang harus diperjelas user.
        return {
          status: "perlu-diperjelas" as const,
          pesan: [
            "DRAF BELUM BISA DIBUAT.",
            "",
            masalahJadiTeks(hasil.masalah),
            "",
            "Sampaikan ini ke user apa adanya dan tunggu jawabannya. Jangan memilih sendiri.",
          ].join("\n"),
        };
      }

      // `draf`, `sidik`, dan `permintaan` DIPAKAI KLIEN, bukan model: kartu
      // konfirmasi di web dan balasan YA di WhatsApp membacanya dari hasil
      // tool ini. Model cukup membaca `pesan`.
      //
      // `sidik` yang membuat konfirmasi tidak bisa dipalsukan — server
      // menyusun ulang drafnya sendiri lalu membandingkan sidik ini.
      return {
        status: "siap" as const,
        pesan: [
          "DRAF SIAP — BELUM TERSIMPAN.",
          "",
          drafJadiTeks(hasil.draf),
          "",
          "Tampilkan draf ini ke user, lalu minta dia mengonfirmasi. " +
            "Kamu TIDAK bisa menyimpannya sendiri.",
        ].join("\n"),
        draf: hasil.draf,
        sidik: sidikDraf(hasil.draf),
        permintaan: { pelanggan, barang, tanggal },
      };
    },
  });
}

/** Siapa yang sedang login -- menentukan order mana yang boleh dia batalkan. */
export type Pengguna = { id: number; username: string };

/**
 * Tool pembatalan. SAMA SEPERTI `siapkan_penjualan`: cuma menyusun, tidak
 * mengubah apa pun.
 *
 * ⚠️ `alasan` SENGAJA BUKAN PARAMETER TOOL.
 *
 * Kalau alasan jadi parameter, model pasti mengisinya sendiri dari kalimat
 * user -- dan yang tercatat di jejak audit jadi tafsiran model, bukan alasan
 * yang user tulis sadar. Alasannya diketik user di kartu konfirmasi, lalu
 * dikirim langsung ke `/api/entri/batal` tanpa lewat model.
 *
 * Tool ini dibuat ULANG tiap request karena terikat pada pengguna yang login.
 * Jangan menaruhnya di agent yang di-cache per departemen.
 */
export function buatToolBatal(pengguna: Pengguna) {
  return createTool({
    name: "siapkan_pembatalan",
    description:
      "Tampilkan isi sebuah penjualan yang akan DIBATALKAN, berdasarkan nomor ordernya. " +
      "TOOL INI TIDAK MEMBATALKAN APA PUN -- user yang mengonfirmasi setelah melihat isinya. " +
      "Pakai HANYA kalau user menyebut nomor order (mis. SO-2609-01929) dan minta dibatalkan. " +
      "Kalau user minta membatalkan tanpa menyebut nomor order, TANYAKAN nomornya -- " +
      "jangan menebak dan jangan mencarikan sendiri. " +
      "Kalau tool menolak, sampaikan alasan penolakannya apa adanya ke user.",
    parameters: z.object({
      no_order: z
        .string()
        .describe("Nomor order seperti yang diketik user, mis. 'SO-2609-01929'."),
    }),
    execute: async ({ no_order }) => {
      const hasil = await susunDrafBatal(no_order, { penggunaId: pengguna.id });

      if (!hasil.ok) {
        // Penolakan dikembalikan sebagai hasil biasa, bukan dilempar sebagai
        // error: ini bukan kegagalan sistem, tapi jawaban yang harus user tahu.
        return {
          status: "ditolak" as const,
          sebab: hasil.sebab,
          pesan: [
            "PEMBATALAN TIDAK BISA DILAKUKAN.",
            "",
            hasil.pesan,
            "",
            "Sampaikan ini ke user apa adanya.",
          ].join("\n"),
        };
      }

      // `order` dipakai KLIEN (kartu konfirmasi & balasan WhatsApp), bukan
      // model. Model cukup membaca `pesan`.
      return {
        status: "siap-batal" as const,
        pesan: [
          "ORDER INI AKAN DIBATALKAN -- BELUM DIBATALKAN.",
          "",
          batalJadiTeks(hasil.order),
          "",
          "Tampilkan isinya ke user, lalu minta dia mengonfirmasi DAN mengisi alasan. " +
            "Kamu TIDAK bisa membatalkannya sendiri, dan JANGAN mengarang alasannya.",
        ].join("\n"),
        order: hasil.order,
        permintaan: { noOrder: hasil.order.noOrder },
      };
    },
  });
}
