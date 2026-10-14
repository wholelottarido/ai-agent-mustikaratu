/** Koneksi penulis yang khusus untuk jalur unggah basis pengetahuan. */
import { Pool } from "pg";

const KUNCI = Symbol.for("portal.db.knowledge-ingest");
type Global = typeof globalThis & { [KUNCI]?: Pool };

export function poolKnowledgeIngest(): Pool {
  const g = globalThis as Global;
  if (!g[KUNCI]) {
    const host = process.env.DEMO_PG_HOST;
    const password = process.env.DEMO_PG_INGEST_PASSWORD;
    if (!host || !password) {
      throw new Error(
        "DEMO_PG_HOST / DEMO_PG_INGEST_PASSWORD belum diisi. Jalankan " +
          "`npm run buat:pg-ingest` setelah kredensial role ingest disiapkan.",
      );
    }
    g[KUNCI] = new Pool({
      host,
      port: Number(process.env.DEMO_PG_PORT ?? 5432),
      database: process.env.DEMO_PG_DATABASE,
      user: process.env.DEMO_PG_INGEST_USER ?? "ai_ingest",
      password,
      max: 3,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 60_000,
    });
    g[KUNCI].on("error", (e) => console.error("[db-knowledge-ingest] pool error:", e.message));
  }
  return g[KUNCI];
}
