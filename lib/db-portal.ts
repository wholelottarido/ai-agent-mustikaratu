/**
 * Pool bersama untuk user MySQL `portal_app`.
 *
 * ⚠️ KENAPA HARUS DIBAGI, BUKAN POOL SENDIRI-SENDIRI
 *
 * Tiga modul memakai user yang sama: `percakapan.ts`, `pemakaian.ts`, dan
 * `preferensi-wa.ts`. Waktu masing-masing membuat pool sendiri, jatah
 * koneksinya dijumlahkan — dan `portal_app` dibatasi `MAX_USER_CONNECTIONS`.
 *
 * Gejalanya muncul belakangan dan membingungkan:
 *   Error: User 'portal_app' has exceeded the 'max_user_connections' resource
 *
 * Bukan saat modul ketiga ditulis, tapi saat ketiganya kebetulan dipakai
 * bersamaan — jadi lolos semua tes yang menjalankan satu modul saja.
 *
 * Ditaruh di `globalThis` supaya hot-reload Next.js tidak menumpuk pool baru
 * tiap berkas berubah — pola yang sama dengan pool departemen di
 * `voltagent/db.ts`.
 */
import mysql from "mysql2/promise";

const KUNCI = Symbol.for("portal.db.app");
type Global = typeof globalThis & { [KUNCI]?: mysql.Pool };

/**
 * Sengaja kecil. Dua proses (web + bot WhatsApp) memakai user yang sama, jadi
 * angka ini terpakai DUA KALI terhadap batas MySQL-nya.
 */
const BATAS_KONEKSI = 4;

export function poolPortalApp(): mysql.Pool {
  const g = globalThis as Global;
  if (!g[KUNCI]) {
    const user = process.env.PORTAL_APP_DB_USER;
    if (!user) {
      throw new Error(
        "PORTAL_APP_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/portal/03_percakapan.sql sebagai root.",
      );
    }
    g[KUNCI] = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_APP_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: BATAS_KONEKSI,
      multipleStatements: false,
    });
  }
  return g[KUNCI];
}

/**
 * Pool user admin portal — yang BOLEH MENULIS di database portal kita.
 *
 * ⚠️ TERPISAH DARI `poolPortalApp` DENGAN SENGAJA. `portal_app` cuma punya
 * SELECT pada tabel setelan tool, dan itu yang dipakai jalur chat. Jalur chat
 * tidak boleh punya kuasa mengubah tool apa pun yang dipegang agent -- kalau
 * satu-satunya pemisah adalah kode yang memanggilnya, satu impor yang keliru
 * cukup untuk menghapusnya.
 *
 * Pola yang sama dengan `sumber-db.ts`. Dulu ada di `sambung-tool.ts`;
 * dipindahkan ke sini 13 Okt 2026 waktu modul kedua (`tulis-disetujui.ts`)
 * membutuhkannya -- dua pool untuk satu user berarti jatah koneksinya
 * dijumlahkan, dan itu persis kekeliruan yang dijelaskan di atas.
 */
const KUNCI_ADMIN = Symbol.for("portal.db.admin");
type GlobalAdmin = typeof globalThis & { [KUNCI_ADMIN]?: mysql.Pool };

export function poolPortalAdmin(): mysql.Pool {
  const g = globalThis as GlobalAdmin;
  if (!g[KUNCI_ADMIN]) {
    const user = process.env.PORTAL_ADMIN_DB_USER;
    if (!user) {
      throw new Error("PORTAL_ADMIN_DB_USER belum diisi di .env.local.");
    }
    g[KUNCI_ADMIN] = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.PORTAL_ADMIN_DB_PASSWORD,
      database: process.env.PORTAL_DB_NAME ?? "portal",
      connectionLimit: 2,
      multipleStatements: false,
    });
  }
  return g[KUNCI_ADMIN];
}
