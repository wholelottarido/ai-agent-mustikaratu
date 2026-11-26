/**
 * Menghidupkan tiga tool riset pasar. Sekali pakai, diminta user 2 Nov 2026.
 * Jalur biasanya lewat layar Kelola AI.
 */
import { Client } from "pg";

const KODE = ["cari_tren_pasar", "riset_pesaing", "analisis_pasar_penjualan"];

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000,
});
await c.connect();

try {
  const lihat = async (kapan: string) => {
    const { rows } = await c.query<{ kode: string; is_active: boolean }>(
      `SELECT kode, is_active FROM ai_tool WHERE kode = ANY($1) ORDER BY kode`, [KODE]);
    console.log(`\n${kapan}:`);
    for (const r of rows) console.log(`  ${r.kode.padEnd(26)} aktif=${r.is_active}`);
    return rows;
  };

  await lihat("SEBELUM");

  // ⚠️ Dibatasi ke tiga kode itu saja. Tanpa WHERE ini, satu salah ketik
  // menghidupkan seluruh tool di seluruh agent.
  const r = await c.query(
    `UPDATE ai_tool SET is_active = true, updated_by = 'magang'
      WHERE kode = ANY($1) AND is_active = false`, [KODE]);
  console.log(`\n${r.rowCount} baris diubah`);

  await lihat("SESUDAH");
} finally {
  await c.end();
}
