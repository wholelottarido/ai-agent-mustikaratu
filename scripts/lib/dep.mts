/**
 * Helper bersama untuk script CLI: tentukan departemen dan buka koneksinya.
 *
 * Semua script menerima nama departemen sebagai argumen:
 *   npm run test:db -- marketing
 *   npm run index:teks -- hr
 *
 * Kalau tidak disebut, dipakai departemen default. Kredensialnya diambil
 * per departemen (MARKETING_DB_USER, HR_DB_USER, ...) -- jadi script pun
 * tunduk pada pemisahan yang sama dengan aplikasi.
 */
import mysql from "mysql2/promise";
import {
  SEMUA_DEPARTEMEN,
  ambilDepartemen,
  DEPARTEMEN_DEFAULT,
  type KonfigDepartemen,
} from "../../voltagent/departemen/index.ts";

export type { KonfigDepartemen };

/** Baca nama departemen dari argumen CLI, hentikan kalau tidak dikenal. */
export function departemenDariArgv(): KonfigDepartemen {
  // process.argv: [node, script, ...argumen]
  const diminta = process.argv[2] ?? DEPARTEMEN_DEFAULT;
  const dep = ambilDepartemen(diminta);

  if (!dep) {
    const pilihan = SEMUA_DEPARTEMEN.map((d) => d.id).join(", ");
    console.error(`Departemen "${diminta}" tidak dikenal. Pilihan: ${pilihan}`);
    process.exit(1);
  }
  return dep;
}

/** Koneksi tunggal (bukan pool) untuk script sekali jalan. */
export async function sambungkan(dep: KonfigDepartemen) {
  // Departemen tanpa database dummy (mis. IT) memang tidak bisa disambung --
  // datanya cuma ada di PostgreSQL perusahaan.
  if (!dep.db) {
    console.error(
      `Departemen "${dep.id}" tidak punya database MySQL dummy, ` +
        "jadi script ini tidak berlaku untuknya.",
    );
    process.exit(1);
  }
  const p = dep.db.awalanEnv;
  const user = process.env[`${p}_DB_USER`];

  if (!user) {
    console.error(
      `Kredensial departemen "${dep.id}" belum diisi.\n` +
        `Tambahkan ${p}_DB_USER dan ${p}_DB_PASSWORD di .env.local ` +
        `(contohnya ada di .env.example).`,
    );
    process.exit(1);
  }

  return mysql.createConnection({
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user,
    password: process.env[`${p}_DB_PASSWORD`],
    database: process.env[`${p}_DB_NAME`] ?? dep.db.nama!,
    decimalNumbers: false,
  });
}

/** Nama database yang benar-benar dipakai departemen ini. */
export function namaDb(dep: KonfigDepartemen): string {
  if (!dep.db) return "(tidak ada database dummy)";
  return process.env[`${dep.db.awalanEnv}_DB_NAME`] ?? dep.db.nama;
}
