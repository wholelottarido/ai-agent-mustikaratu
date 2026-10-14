/**
 * Pool PostgreSQL untuk database perusahaan.
 *
 * ⚠️ READ-ONLY. Kredensial bawaan `DEMO_PG_*` sejak 29 Sep 2026 adalah
 * `ai_readonly`, bukan superuser. Terbukti lewat `npm run uji:pg`: SELECT
 * bisa, INSERT/UPDATE/DELETE/CREATE/DROP ditolak `42501`, dan kolom
 * kredensial (`users.password`, token) tertutup.
 *
 * ⚠️ Superuser ada di `DEMO_PG_ADMIN_*` dan TIDAK boleh dipakai dari sini.
 * Yang boleh memakainya cuma dua skrip administrasi di `scripts/`.
 *
 * Ditaruh di `globalThis` supaya hot-reload Next.js tidak menumpuk pool baru
 * tiap berkas berubah — pola yang sama dengan pool departemen di
 * `lib/db-portal.ts`.
 */
import { Pool, types } from "pg";

// ⚠️ TANGGAL DIAMBIL APA ADANYA, JANGAN DIJADIKAN OBJEK Date.
//
// Bawaan `pg` mengubah kolom date/timestamp jadi objek Date zona lokal. Waktu
// hasilnya dirangkai jadi teks untuk model, satu sel tanggal berbunyi:
//
//     "Thu Feb 09 2023 00:00:00 GMT+0700 (Western Indonesia Time)"
//
// 57 karakter, berbahasa Inggris, dan zona waktunya harus ditafsir model
// sendiri. Untuk hasil 200 baris itu pemborosan besar, dan mengundang salah
// hari: `date` PostgreSQL tidak punya jam, tapi Date lokal membuatnya tergeser
// 7 jam sehingga tanggalnya bisa terbaca mundur sehari kalau dirender UTC.
// Kekeliruan itu sempat terjadi waktu angka harapan view penjualan disusun.
//
// Dengan parser di bawah, nilainya tetap seperti di database: "2023-02-09".
//
// 1082 = date, 1114 = timestamp without time zone, 1083 = time.
// `timestamptz` (1184) SENGAJA tidak disentuh -- yang itu memang butuh zona.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1083, (v) => v);

const KUNCI = Symbol.for("portal.db.perusahaan");
type Global = typeof globalThis & { [KUNCI]?: Pool };

export function poolPerusahaan(): Pool {
  const g = globalThis as Global;
  if (!g[KUNCI]) {
    const host = process.env.DEMO_PG_HOST;
    if (!host) {
      throw new Error(
        "DEMO_PG_HOST belum diisi di .env.local. " +
          "Sumber data perusahaan tidak bisa dipakai tanpa itu.",
      );
    }
    g[KUNCI] = new Pool({
      host,
      port: Number(process.env.DEMO_PG_PORT ?? 5432),
      database: process.env.DEMO_PG_DATABASE,
      user: process.env.DEMO_PG_USER,
      password: process.env.DEMO_PG_PASSWORD,
      max: 4,
      connectionTimeoutMillis: 10_000,
      // Server perusahaan dipakai orang lain. Tabel terbesar di sana 4,2 juta
      // baris; satu query ceroboh tanpa batas waktu bisa membebani mereka.
      // Role `ai_readonly` sudah punya `statement_timeout = 30s` sendiri, ini
      // lapis kedua dari sisi klien.
      statement_timeout: 25_000,
      // Koneksi menganggur ditutup: ini database REMOTE, bukan localhost.
      idleTimeoutMillis: 30_000,
    });

    // Tanpa ini, galat koneksi di latar (mis. jaringan putus) membuat proses
    // Node berhenti — bukan cuma query yang gagal.
    g[KUNCI].on("error", (e) => {
      console.error("[db-perusahaan] galat pool:", e.message);
    });
  }
  return g[KUNCI];
}
