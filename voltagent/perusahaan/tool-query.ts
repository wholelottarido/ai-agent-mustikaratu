/**
 * Tool baca database perusahaan (PostgreSQL).
 *
 * ⚠️ MASALAH INTINYA: view `v_asisten_*` TIDAK punya WHERE.
 *
 * `v_asisten_karyawan` menampilkan seluruh 1.954 karyawan, `v_asisten_tiket`
 * seluruh 10.082 tiket, `v_asisten_pengajuan` semua pengajuan cuti beserta
 * alasannya. Kalau
 * model boleh menulis SELECT bebas ke view itu, setiap user melihat data
 * semua orang.
 *
 * ⚠️ CARA MENYARINGNYA: CTE YANG MENUTUPI NAMA VIEW.
 *
 * Di PostgreSQL, nama di klausa `WITH` MENUTUPI tabel/view bernama sama di
 * query itu. Jadi query model disisipi lebih dulu:
 *
 *     WITH v_asisten_karyawan AS (SELECT * FROM public.v_asisten_karyawan
 *                                  WHERE id_employee = $1),
 *          ...
 *     <query model>
 *
 * Model menulis `FROM v_asisten_karyawan` seperti biasa dan tidak perlu tahu soal
 * penyaringnya — yang dia baca sudah versi tersaring. Penyaringnya tidak bisa
 * dihapus model karena ditambahkan SESUDAH query-nya divalidasi.
 *
 * ⚠️ SATU CELAH YANG HARUS DITUTUP: `public.v_asisten_karyawan`.
 *
 * Nama berkualifikasi skema MELEWATI penutupan CTE. Karena itu query yang
 * menyebut skema ditolak mentah-mentah di `validasiTambahan()`.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { validasiSql } from "../sql-guard";
import { viewBoleh, viewDiri, viewLintasOrang } from "./view-perusahaan";
import type { Pengguna } from "../tools-entri";

const MAX_ROWS = 200;

/**
 * ⚠️ DAFTAR VIEW-NYA TIDAK ADA DI SINI LAGI.
 *
 * Dulu daftarnya ditulis di berkas ini DAN di `kamus-data.ts`, lalu dua-duanya
 * berbeda tanpa ada yang tahu -- model dijanjikan view yang tool ini tolak.
 * Sekarang keduanya membaca `view-perusahaan.ts`. Baca sebabnya di sana.
 *
 * Yang masih jadi urusan berkas ini cuma dua: menolak nama yang tidak boleh,
 * dan memasang CTE penyaring untuk `VIEW_DIRI`.
 */

type HasilPeriksa = { tolak: string } | { tolak: null; dipakai: string[] };

function validasiTambahan(sql: string, boleh: string[]): HasilPeriksa {
  // Nama berkualifikasi skema melewati penutupan CTE -> celah penyaring.
  if (/\b(public|pg_catalog|information_schema)\s*\./i.test(sql)) {
    return {
      tolak:
        "Jangan menulis nama skema (public., pg_catalog., information_schema.). " +
        "Sebut nama view-nya saja, mis. FROM v_asisten_karyawan.",
    };
  }

  // ⚠️ DAFTAR YANG BOLEH, BUKAN DAFTAR YANG DILARANG.
  //
  // Versi pertama menyaring berdasarkan AWALAN nama (`v_`, `ai_`, `trx_`).
  // Itu BOCOR: `SELECT COUNT(*) FROM employee` lolos begitu saja, dan karena
  // tidak ada CTE bernama `employee`, query itu membaca tabel aslinya —
  // SELURUH 1.954 baris tanpa penyaring. Ditemukan `npm run test:tool-pg`.
  //
  // Sekarang SEMUA nama di FROM/JOIN harus ada di daftar boleh. Tabel yang
  // belum dikenal otomatis DITOLAK, bukan otomatis lolos.
  const cteSendiri = new Set(
    [...sql.matchAll(/(?:\bwith\s+|,\s*)([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );

  const disebut = [...sql.matchAll(/\b(?:from|join)\s+([a-z_"][a-z0-9_."]*)/gi)]
    .map((m) => m[1].toLowerCase().replace(/"/g, ""))
    .filter((n) => n !== "");

  // ⚠️ Daftar bolehnya BEDA PER DEPARTEMEN.
  //
  // Pengguna non-marketing tidak cuma "tidak diberi tahu" soal view marketing
  // di kamus -- kalau dia menyebutnya (misal karena menebak), di sini ditolak.
  // Kamus yang diam saja bukan penjaga; ini penjaganya.
  const bolehSet = new Set(boleh);
  const asing = disebut.filter((n) => !bolehSet.has(n) && !cteSendiri.has(n));
  if (asing.length > 0) {
    return {
      tolak:
        `"${asing[0]}" tidak bisa dibaca. Yang tersedia cuma: ${boleh.join(", ")}. ` +
        "Tabel mentah tidak bisa dibaca langsung.",
    };
  }
  return { tolak: null, dipakai: disebut.filter((n) => bolehSet.has(n)) };
}

/** Sisipkan CTE penyaring di depan query model. */
function bungkusPenyaring(
  sql: string,
  idEmployee: string,
  departemen: string,
): { sql: string; nilai: unknown[] } {
  // ⚠️ Daftarnya BERGANTUNG DEPARTEMEN. Untuk IT, `v_asisten_tiket` tidak
  // ikut di sini -- kalau ikut, orang helpdesk cuma melihat tiket yang dia
  // laporkan sendiri, bukan yang dia kerjakan.
  const cte = viewDiri(departemen).map(
    (v) => `${v} AS (SELECT * FROM public.${v} WHERE id_employee::text = $1)`,
  ).join(",\n     ");

  // Query model sendiri boleh diawali WITH. Kalau iya, CTE-nya digabung —
  // bukan ditumpuk jadi dua klausa WITH, yang tidak sah di SQL.
  const diawaliWith = /^\s*WITH\s+/i.test(sql);
  const sisa = diawaliWith ? sql.replace(/^\s*WITH\s+/i, "") : sql;

  return {
    sql: `WITH ${cte}${diawaliWith ? ",\n     " + sisa : `\n${sisa}`}`,
    nilai: [idEmployee],
  };
}

function formatHasil(baris: Record<string, unknown>[]): string {
  if (baris.length === 0) return "(tidak ada baris)";
  const kolom = Object.keys(baris[0]);
  const garis = [kolom.join(" | ")];
  for (const b of baris.slice(0, MAX_ROWS)) {
    garis.push(kolom.map((k) => (b[k] === null ? "" : String(b[k]))).join(" | "));
  }
  return garis.join("\n");
}

export function buatToolPerusahaan(
  pengguna: Pengguna & { idEmployee: string | null; departemen: string },
) {
  const boleh = viewBoleh(pengguna.departemen);

  return createTool({
    name: "query_perusahaan",
    description:
      "Jalankan satu query SELECT ke database perusahaan (PostgreSQL) dan kembalikan hasilnya. " +
      "HANYA SELECT — database ini read-only. " +
      "⚠️ Dialeknya PostgreSQL, BUKAN MySQL: pakai TO_CHAR bukan DATE_FORMAT, " +
      "CURRENT_DATE bukan CURDATE(), ILIKE bukan LIKE untuk pencarian teks. " +
      `Kalau query belum punya LIMIT, LIMIT ${MAX_ROWS} ditambahkan otomatis. ` +
      // ⚠️ Kalimat ini dulu bilang SEMUA hasil disaring ke data penanya.
      // Begitu view lingkup departemen masuk, itu jadi JANJI PALSU -- model
      // akan menyebut angka seluruh perusahaan sebagai "punyamu".
      `View yang tersedia untukmu: ${boleh.join(", ")}. ` +
      `Yang disaring otomatis ke data milikmu cuma: ${viewDiri(pengguna.departemen).join(", ")} ` +
      "— jangan menambahkan penyaring id_employee sendiri untuk view itu. " +
      "View lain berisi data seluruh perusahaan, bukan data milikmu.",
    parameters: z.object({
      sql: z.string().describe("Query SELECT PostgreSQL. Satu statement saja."),
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

      const periksa = validasiTambahan(cek.sql, boleh);
      if (periksa.tolak !== null) return `QUERY DITOLAK: ${periksa.tolak}`;

      const adaLintas = periksa.dipakai.some((x) => viewLintasOrang(pengguna.departemen, x));
      const adaDiri = periksa.dipakai.some((x) => !viewLintasOrang(pengguna.departemen, x));

      // ⚠️ Pemetaan akun cuma WAJIB untuk view yang disaring per orang.
      //
      // Dulu belum dipetakan berarti tidak bisa membaca apa pun. Untuk view
      // lingkup departemen itu berlebihan: penyaringnya memang bukan
      // `id_employee`, jadi pemetaan tidak menentukan apa-apa di sana. Staf
      // marketing yang belum dipetakan tetap bisa bertanya soal klaim.
      if (adaDiri && !pengguna.idEmployee) {
        return (
          "AKUN INI BELUM DIPETAKAN ke karyawan di database perusahaan, jadi " +
          "data pribadi (karyawan, pengajuan, tiket, aset, kunjungan) tidak " +
          "bisa dibaca.\n\n" +
          "Sampaikan ke user: mintakan admin menjalankan pemetaan akun " +
          "(npm run petakan:karyawan). Tanpa itu sistem tidak tahu data siapa " +
          "yang boleh ditampilkan. JANGAN mencoba cara lain."
        );
      }

      // ⚠️ Tetap dibungkus SELAMA idEmployee ada, walau query-nya kelihatan
      // cuma menyentuh view lintas-orang. `periksa.dipakai` berasal dari regex;
      // kalau regex itu meleset, pembungkus ini lapis kedua yang menahan. Tanpa
      // idEmployee, penjagaan `adaDiri` di atas sudah menjamin tidak ada view
      // pribadi yang ikut terbaca.
      const { sql: akhir, nilai } = pengguna.idEmployee
        ? bungkusPenyaring(cek.sql, pengguna.idEmployee, pengguna.departemen)
        : { sql: cek.sql, nilai: [] as unknown[] };

      try {
        const hasil = await poolPerusahaan().query(akhir, nilai);
        const baris = hasil.rows as Record<string, unknown>[];

        const bagian = [`SQL dijalankan:\n${cek.sql}`];
        if (cek.catatan.length > 0) bagian.push(`Catatan: ${cek.catatan.join(" ")}`);
        bagian.push(
          adaLintas && adaDiri
            ? "⚠️ CAMPURAN: view pribadi sudah disaring ke data user yang bertanya, " +
                "tapi view marketing berisi data SELURUH perusahaan. Jangan menyebut " +
                "angka marketing itu sebagai milik user."
            : adaLintas
              ? "⚠️ Ini data marketing SELURUH perusahaan, bukan milik user yang " +
                "bertanya. Sampaikan apa adanya sebagai angka perusahaan."
              : "Hasil sudah disaring ke data milik user yang bertanya.",
        );
        bagian.push(`${baris.length} baris:\n\n${formatHasil(baris)}`);
        if (baris.length === MAX_ROWS) {
          bagian.push(
            `Hasil terpotong di ${MAX_ROWS} baris. Kalau butuh angka total, ` +
              "pakai agregasi (SUM/COUNT/GROUP BY) daripada menarik semua baris.",
          );
        }
        return bagian.join("\n\n");
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        return (
          `QUERY ERROR dari PostgreSQL: ${pesan}\n\n` +
          "Kalau errornya soal fungsi yang tidak ada, kemungkinan kamu memakai " +
          "fungsi MySQL. Di sini pakai TO_CHAR, CURRENT_DATE, COALESCE, ILIKE. " +
          "Kalau errornya soal izin, berarti data itu memang di luar jangkauan — " +
          "sampaikan begitu ke user, jangan dicoba dengan cara lain."
        );
      }
    },
  });
}
