/** Utilitas baca singkat untuk memeriksa rentang data penjualan di PostgreSQL. */
import { Client } from "pg";

const client = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER,
  password: process.env.DEMO_PG_PASSWORD,
});

await client.connect();
const hasil = await client.query(`
  SELECT COUNT(*)::bigint AS baris, COUNT(DISTINCT kode_produk)::bigint AS produk,
         ROUND(SUM(nilai), 2) AS omzet
    FROM v_asisten_penjualan
   WHERE tanggal >= DATE '2025-01-01' AND tanggal < DATE '2026-01-01'`);
console.log(hasil.rows[0]);
await client.end();
