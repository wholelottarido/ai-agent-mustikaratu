/**
 * Tool database, dibuat PER DEPARTEMEN.
 *
 * Isinya sama untuk semua departemen; yang membedakan cuma konfigurasi yang
 * dipasang saat pembuatan: pool mana yang dipakai, indeks teks mana yang dibaca.
 * Agent marketing tidak pernah memegang tool yang menunjuk ke database hr.
 *
 * Pengaman berlapis tiga:
 *   1. User MySQL per departemen, cuma GRANT SELECT ke database-nya sendiri
 *   2. validasiSql() menolak apa pun selain satu SELECT/WITH tanpa komentar
 *   3. LIMIT dipaksa supaya hasil tidak membanjiri context model
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { validasiSql } from "./sql-guard";
import { ambilPool, formatHasil, namaDb, MAX_ROWS } from "./db";
import { cariTeks, indeksSiap } from "./cari-teks";
import type { KonfigDepartemen } from "./departemen";
import { buatToolEntri, buatToolBatal, type Pengguna } from "./tools-entri";
import { bolehEntri, bolehSetujui } from "./departemen/tipe";
import { buatToolLembur, buatToolPelamar, buatToolKeputusanLembur } from "./tools-hr";

/**
 * Tool 1 — detail kolom sebuah tabel.
 *
 * Daftar tabel & aturan query sudah ditempel di instructions agent, jadi tool
 * ini TIDAK wajib dipanggil tiap pertanyaan. Cukup saat agent butuh nama kolom
 * yang persis. Itu menghemat satu putaran model dibanding versi OpenClaw.
 */
function buatToolSkema(dep: KonfigDepartemen, peran: string) {
  return createTool({
    name: "jelaskan_skema",
    description:
      `Lihat kolom, tipe data, dan relasi dari satu atau beberapa tabel di database ${dep.db?.nama ?? "-"}. ` +
      "Daftar tabel dan aturan query yang penting sudah ada di instruksi kamu — panggil tool ini " +
      "HANYA kalau kamu butuh nama kolom yang persis dan belum yakin.",
    parameters: z.object({
      tabel: z
        .array(z.string())
        .min(1)
        .describe("Nama tabel yang ingin dilihat kolomnya."),
    }),
    execute: async ({ tabel }) => {
      const db = ambilPool(dep, peran);
      const nama = namaDb(dep);

      const [kolomRows] = await db.query(
        `SELECT TABLE_NAME AS tabel, COLUMN_NAME AS kolom, COLUMN_TYPE AS tipe,
                IS_NULLABLE AS bolehNull, COLUMN_KEY AS kunci, COLUMN_COMMENT AS keterangan
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [nama, tabel],
      );
      const kolom = kolomRows as Record<string, unknown>[];

      if (kolom.length === 0) {
        return `Tabel tidak ditemukan: ${tabel.join(", ")}. Cek lagi daftar tabel di instruksi kamu.`;
      }

      const [fkRows] = await db.query(
        `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME, ' -> ',
                       REFERENCED_TABLE_NAME, '.', REFERENCED_COLUMN_NAME) AS relasi
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)
            AND REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY TABLE_NAME, COLUMN_NAME`,
        [nama, tabel],
      );
      const fk = fkRows as Record<string, unknown>[];

      let teks = `Kolom untuk: ${tabel.join(", ")}\n\n${formatHasil(kolom)}`;
      if (fk.length > 0) {
        teks += `\n\nRelasi (foreign key):\n${fk.map((r) => `  ${r.relasi}`).join("\n")}`;
      }
      return teks;
    },
  });
}

/** Tool 2 — jalankan query SELECT. */
function buatToolQuery(dep: KonfigDepartemen, peran: string) {
  return createTool({
    name: "query_db",
    description:
      `Jalankan satu query SELECT ke database ${dep.db?.nama ?? "-"} dan kembalikan hasilnya. ` +
      "HANYA SELECT (atau WITH ... SELECT) — database ini read-only. " +
      `Kalau query belum punya LIMIT, LIMIT ${MAX_ROWS} ditambahkan otomatis. ` +
      "Pakai agregasi (SUM/COUNT/GROUP BY) di SQL, jangan tarik semua baris lalu hitung sendiri.",
    parameters: z.object({
      sql: z.string().describe("Query SELECT yang akan dijalankan. Satu statement saja."),
      alasan: z
        .string()
        .optional()
        .describe("Satu kalimat: query ini menjawab bagian mana dari pertanyaan user."),
    }),
    execute: async ({ sql }) => {
      const cek = validasiSql(sql, MAX_ROWS);

      if (!cek.ok) {
        return `QUERY DITOLAK: ${cek.alasan}\n\nPerbaiki query-nya lalu coba lagi. Database ini hanya bisa dibaca.`;
      }

      try {
        const [rows] = await ambilPool(dep, peran).query(cek.sql);
        const baris = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];

        const bagian = [`SQL dijalankan:\n${cek.sql}`];
        if (cek.catatan.length > 0) bagian.push(`Catatan: ${cek.catatan.join(" ")}`);
        bagian.push(`${baris.length} baris:\n\n${formatHasil(baris)}`);
        if (baris.length === MAX_ROWS) {
          bagian.push(
            `Hasil terpotong di ${MAX_ROWS} baris. Kalau butuh angka total, ` +
              `pakai agregasi (SUM/COUNT/GROUP BY) daripada menarik semua baris.`,
          );
        }
        return bagian.join("\n\n");
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        return (
          `QUERY ERROR dari MySQL: ${pesan}\n\n` +
          `Kalau errornya soal nama tabel/kolom, panggil jelaskan_skema dulu. ` +
          `Kalau errornya soal izin (command denied), berarti data itu memang di luar ` +
          `jangkauan departemen ini — sampaikan begitu ke user, jangan dicoba dengan cara lain.`
        );
      }
    },
  });
}

/**
 * Tool 3 — cari kalimat berdasarkan MAKNA, bukan kata kunci.
 *
 * PENTING — tool ini TIDAK menghitung. Presisinya ~66%, jadi 1 dari 3 kalimat
 * yang dikembalikan bisa tidak relevan. Hasilnya adalah KANDIDAT yang harus
 * disaring dan dihitung lewat query_db. Angka pengukurannya ada di CLAUDE.md.
 */
function buatToolCariTeks(dep: KonfigDepartemen) {
  const daftarTabel = [...new Set(dep.kolomTeks.map((k) => k.tabel))].join(", ");

  return createTool({
    name: "cari_teks",
    description:
      `Cari kalimat di kolom teks (${daftarTabel}) berdasarkan kemiripan MAKNA, ` +
      "bukan kecocokan kata. Pakai ini untuk pertanyaan tentang ISI tulisan: " +
      "keluhan, alasan, pendapat, masukan. " +
      "JANGAN pakai untuk menghitung — tool ini mengembalikan KANDIDAT, bukan jawaban. " +
      "Setelah dapat kalimatnya, hitung lewat query_db. " +
      "Tulis pertanyaan yang KONKRET berisi sinonim, mis. " +
      "'kemasan rusak bocor penyok tutup botol pecah' — bukan 'keluhan kemasan'.",
    parameters: z.object({
      pertanyaan: z
        .string()
        .describe(
          "Kata-kata konkret beserta sinonimnya, bukan pertanyaan abstrak. " +
            "Contoh baik: 'pengiriman telat lama belum sampai ekspedisi'. " +
            "Contoh buruk: 'gimana soal pengiriman'.",
        ),
      tabel: z
        .string()
        .optional()
        .describe(`Batasi ke satu tabel (${daftarTabel}). Kosongkan untuk semua.`),
      batas: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe(
          "Jumlah kalimat yang dikembalikan. Default 15 (titik seimbang hasil pengukuran). " +
            "Naikkan kalau merasa ada yang terlewat — tapi makin tinggi, makin banyak " +
            "kalimat tidak relevan yang ikut.",
        ),
    }),
    execute: async ({ pertanyaan, tabel, batas }) => {
      if (!indeksSiap(dep)) {
        return (
          `Indeks teks departemen ${dep.label} belum dibuat, jadi pencarian makna ` +
          `tidak bisa dipakai. Jalankan \`npm run index:teks -- ${dep.id}\` di terminal. ` +
          "Sementara itu, pakai query_db dengan LIKE — tapi ingat hasilnya akan " +
          "melewatkan kalimat yang maksudnya sama tapi katanya beda."
        );
      }

      const hasil = await cariTeks(dep, pertanyaan, { batas: batas ?? 15, tabel });

      if (hasil.length === 0) {
        return (
          `Tidak ada kalimat yang cukup mirip dengan "${pertanyaan}". ` +
          `Coba kata lain atau tambahkan sinonim.`
        );
      }

      const kolom = [...new Set(hasil.map((h) => `${h.tabel}.${h.kolom}`))].join(", ");
      const totalBaris = hasil.reduce((s, h) => s + h.jumlah, 0);

      const daftar = hasil
        .map((h, i) => `${String(i + 1).padStart(2)}. [${h.skor.toFixed(3)}] (${h.jumlah} baris) ${h.teks}`)
        .join("\n");

      return [
        `${hasil.length} kalimat kandidat dari ${kolom} (total ${totalBaris} baris):`,
        "",
        daftar,
        "",
        "CATATAN PENTING:",
        "- Ini KANDIDAT hasil kemiripan makna, presisinya sekitar 66% —",
        "  periksa sendiri mana yang benar-benar menjawab pertanyaan user, buang yang tidak.",
        "- Angka di atas BELUM jawaban. Untuk jumlah yang benar, jalankan query_db.",
        "- Pencarian makna TIDAK bisa membedakan pujian dari keluhan — 'kondisi sempurna'",
        "  dan 'kondisi rusak' dianggap mirip. Saring dengan kolom yang menyatakan",
        "  positif/negatif secara eksplisit.",
        "- Tampilkan kalimat yang kamu hitung ke user, jangan cuma angkanya.",
      ].join("\n");
    },
  });
}

/**
 * Rakit semua tool untuk satu departemen.
 *
 * Departemen tanpa kolom teks tidak mendapat tool pencarian makna sama sekali --
 * lebih baik tool-nya tidak ada daripada ada tapi selalu error.
 */
export function buatTools(dep: KonfigDepartemen, peran: string, pengguna?: Pengguna) {
  // Dirakit sekali, bukan dengan `push`: TypeScript menyimpulkan tipe array
  // dari isi awalnya, jadi menambahkan tool berbentuk lain belakangan ditolak.
  return [
    buatToolQuery(dep, peran),
    ...(dep.kolomTeks.length > 0 ? [buatToolCariTeks(dep)] : []),
    buatToolSkema(dep, peran),
    // Entri data cuma untuk departemen yang menyatakannya. Tool-nya pun CUMA
    // MENYUSUN DRAF -- tidak ada tool yang bisa menulis ke database.
    ...(bolehEntri(dep, peran, "penjualan") ? [buatToolEntri(dep, peran)] : []),
    // Pembatalan terikat pada SIAPA yang login -- yang boleh membatalkan cuma
    // orang yang mengentri. Tanpa `pengguna` (mis. server debug VoltOps yang
    // tidak punya sesi), tool-nya tidak dipasang sama sekali: lebih baik tidak
    // ada daripada ada tapi tidak tahu siapa pemakainya.
    ...(bolehEntri(dep, peran, "penjualan") && pengguna ? [buatToolBatal(pengguna)] : []),
    // Entri HR. Terpasang cuma untuk peran yang disebut di konfigurasi --
    // untuk lembur itu KEPALA saja, karena menghitung nilai rupiahnya
    // menuntut baca gaji.
    ...(bolehEntri(dep, peran, "lembur") ? [buatToolLembur()] : []),
    ...(bolehEntri(dep, peran, "pelamar") ? [buatToolPelamar()] : []),
    // Persetujuan: izinnya TERPISAH dari izin entri.
    ...(bolehSetujui(dep, peran, "lembur") ? [buatToolKeputusanLembur()] : []),
  ];
}
