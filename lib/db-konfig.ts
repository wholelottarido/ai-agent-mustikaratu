/**
 * Pool PostgreSQL untuk MENGUBAH setelan tool AI.
 *
 * ⚠️ TERPISAH DARI `db-perusahaan.ts`, DAN ITU SENGAJA.
 *
 * Pool `ai_readonly` dipegang jalur chat — dipakai tiap pertanyaan user. Kalau
 * hak ubah ditempelkan ke pool itu, satu bug di jalur chat jadi punya kuasa
 * mengubah setelan tool seluruh sistem. Pola yang sama dipakai `sumber-db.ts`:
 * `portal_app` untuk membaca, `portal_admin` untuk mengubah.
 *
 * Role `ai_konfig` dibuat `npm run buat:pg-konfig`, dan hak UPDATE-nya
 * diberikan PER KOLOM — baca alasannya di skrip itu.
 */
import { Pool } from "pg";

const KUNCI = Symbol.for("portal.db.konfig");
type Global = typeof globalThis & { [KUNCI]?: Pool };

export function poolKonfig(): Pool {
  const g = globalThis as Global;
  if (!g[KUNCI]) {
    const user = process.env.DEMO_PG_KONFIG_USER;
    const password = process.env.DEMO_PG_KONFIG_PASSWORD;
    if (!user || !password) {
      throw new Error(
        "DEMO_PG_KONFIG_USER / DEMO_PG_KONFIG_PASSWORD belum diisi di .env.local. " +
          "Jalankan dulu: npm run buat:pg-konfig",
      );
    }
    g[KUNCI] = new Pool({
      host: process.env.DEMO_PG_HOST,
      port: Number(process.env.DEMO_PG_PORT ?? 5432),
      database: process.env.DEMO_PG_DATABASE,
      user,
      password,
      // Kecil: layar pengaturan dipakai sesekali oleh beberapa orang, bukan
      // tiap permintaan chat.
      max: 2,
      connectionTimeoutMillis: 10_000,
    });
  }
  return g[KUNCI];
}
