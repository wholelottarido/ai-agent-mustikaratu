/**
 * Koneksi database, SATU POOL PER DEPARTEMEN.
 *
 * Tiap departemen punya user MySQL sendiri yang cuma boleh membaca database-nya
 * sendiri. Itu batas yang sesungguhnya -- bukan kalimat di system prompt.
 * `sql-guard.ts` menolak INSERT/UPDATE/DELETE, tapi TIDAK menolak
 * `SELECT * FROM hr.payroll`. Yang menolak itu MySQL, karena user marketing
 * memang tidak punya izin ke database hr.
 *
 * Pool disimpan di globalThis, bukan variabel modul biasa: hot-reload Next.js
 * meng-evaluasi ulang modul tiap kali file berubah, dan pool baru tiap reload
 * akan menumpuk sampai MySQL menolak (user dibatasi MAX_USER_CONNECTIONS 5).
 */
import mysql from "mysql2/promise";
import type { KonfigDepartemen } from "./departemen";

/** Batas baris yang boleh dikirim balik ke model. */
export const MAX_ROWS = 200;

const KUNCI = Symbol.for("portal.db.pools");
type Global = typeof globalThis & { [KUNCI]?: Map<string, mysql.Pool> };

function semuaPool(): Map<string, mysql.Pool> {
  const g = globalThis as Global;
  g[KUNCI] ??= new Map();
  return g[KUNCI];
}

/** Awalan env yang dipakai peran ini -- default ke awalan departemen. */
export function awalanEnvUntuk(dep: KonfigDepartemen, peran: string): string {
  if (!dep.db) {
    throw new Error(
      `Departemen "${dep.id}" tidak punya database MySQL. ` +
        "Departemen ini cuma berfungsi waktu sumber data `perusahaan` aktif.",
    );
  }
  return dep.db.awalanEnvPeran?.[peran] ?? dep.db.awalanEnv;
}

/**
 * Kredensial dibaca dari environment dengan awalan milik departemen (dan peran):
 *   MARKETING_DB_USER, MARKETING_DB_PASSWORD, MARKETING_DB_NAME
 * Host & port dipakai bersama -- semua database di server MySQL yang sama.
 */
function kredensial(dep: KonfigDepartemen, peran: string) {
  const p = awalanEnvUntuk(dep, peran);
  const user = process.env[`${p}_DB_USER`];
  const password = process.env[`${p}_DB_PASSWORD`];

  if (!user) {
    throw new Error(
      `Kredensial database departemen "${dep.id}" peran "${peran}" belum diisi. ` +
        `Tambahkan ${p}_DB_USER dan ${p}_DB_PASSWORD di .env.local ` +
        `(contohnya ada di .env.example).`,
    );
  }

  return {
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user,
    password,
    // `awalanEnvUntuk()` di atas sudah melempar kalau `db` tidak ada, jadi
    // di titik ini departemennya pasti punya database.
    database: process.env[`${p}_DB_NAME`] ?? dep.db!.nama,
  };
}

/**
 * Pool per (departemen, peran). Peran ikut jadi kunci karena peran berbeda
 * bisa memakai user MySQL berbeda -- mis. kepala HR boleh baca kolom gaji,
 * staf HR tidak.
 */
export function ambilPool(dep: KonfigDepartemen, peran: string): mysql.Pool {
  const pools = semuaPool();
  const kunci = `${dep.id}:${awalanEnvUntuk(dep, peran)}`;
  let pool = pools.get(kunci);

  if (!pool) {
    pool = mysql.createPool({
      ...kredensial(dep, peran),
      // Di bawah MAX_USER_CONNECTIONS 5 milik user read-only.
      connectionLimit: 3,
      // Satu perintah per query -- pengaman tambahan di atas validator.
      multipleStatements: false,
      // DECIMAL dikembalikan sebagai string supaya rupiah tidak kehilangan presisi.
      decimalNumbers: false,
    });
    pools.set(kunci, pool);
  }

  return pool;
}

/** Nama database yang benar-benar dipakai departemen ini. */
export function namaDb(dep: KonfigDepartemen): string {
  if (!dep.db) return "(tidak ada database dummy)";
  return process.env[`${dep.db.awalanEnv}_DB_NAME`] ?? dep.db.nama;
}

/** Ubah hasil query jadi tabel teks ringkas yang gampang dibaca model. */
export function formatHasil(baris: Record<string, unknown>[]): string {
  if (baris.length === 0) return "(tidak ada baris yang cocok)";

  const kolom = Object.keys(baris[0]);
  const sel = (v: unknown) => (v === null || v === undefined ? "NULL" : String(v));

  const lebar = kolom.map((k) =>
    Math.min(40, Math.max(k.length, ...baris.map((b) => sel(b[k]).length))),
  );
  const potong = (t: string, n: number) =>
    (t.length > n ? t.slice(0, n - 1) + "…" : t).padEnd(n);

  return [
    kolom.map((k, i) => potong(k, lebar[i])).join("  "),
    lebar.map((n) => "-".repeat(n)).join("  "),
    ...baris.map((b) => kolom.map((k, i) => potong(sel(b[k]), lebar[i])).join("  ")),
  ].join("\n");
}
