/**
 * Mendaftarkan tool `pergerakan_penjualan` ke `ai_tool`.
 *
 *   npm run daftar:pergerakan          -- lihat dulu, tidak menulis
 *   npm run daftar:pergerakan -- --tulis
 *
 * Lewat skrip dengan sebab yang sama seperti `daftar-tool-ramalan.mts`: tool berjenis
 * `kode` tidak bisa dibuat dari layar Kelola AI. `is_active = false` berarti tidak
 * dibagikan ke sistem AI tim lain, bukan dimatikan.
 */
import { Client } from "pg";

const TULIS = process.argv.includes("--tulis");
const AGENT = "agent-marketing";

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
  const { rows: agen } = await c.query<{ id_apps: string | null; nama: string }>(
    `SELECT id_apps, nama FROM ai_agent WHERE kode = $1`, [AGENT]);
  if (agen.length === 0) throw new Error(`agent "${AGENT}" tidak ada`);
  console.log(`agent sasaran : ${agen[0].nama} (${AGENT})`);
  console.log(`id_apps       : ${agen[0].id_apps}`);

  const { rows: ada } = await c.query(`SELECT kode FROM ai_tool WHERE kode = 'pergerakan_penjualan'`);
  if (ada.length > 0) {
    console.log("\nSudah terdaftar — tidak ada yang dikerjakan.");
  } else if (!TULIS) {
    console.log("\nBelum terdaftar. Jalankan ulang dengan `-- --tulis` untuk mendaftarkannya.");
  } else {
    await c.query(
      `INSERT INTO ai_tool
         (kode, nama, deskripsi, jenis, penangan, operasi, cakupan_bawaan,
          kolom, filter, is_active, updated_by, id_apps, contoh_pertanyaan)
       VALUES ($1, $2, $3, 'kode', $1, 'baca', 'semua',
               '{}', '[]'::jsonb, false, 'magang', $4, $5)`,
      [
        "pergerakan_penjualan",
        "Pergerakan penjualan",
        "Daftar produk yang penjualannya turun atau naik jauh dari biasanya, dibanding rata-rata 3 bulan " +
          "sebelumnya. Angka fakta, bukan ramalan.",
        agen[0].id_apps,
        "Produk apa yang penjualannya turun bulan ini?",
      ],
    );
    console.log("\nTERDAFTAR.");
  }

  const { rows: cek } = await c.query<Record<string, unknown>>(
    `SELECT kode, jenis, penangan, operasi, cakupan_bawaan, is_active, updated_by, id_apps
       FROM ai_tool WHERE kode = 'pergerakan_penjualan'`);
  if (cek.length > 0) {
    console.log("\nbaris yang ada sekarang:");
    for (const [k, v] of Object.entries(cek[0])) console.log(`  ${k.padEnd(16)} ${String(v)}`);
    // ⚠️ Diperiksa ULANG dari database, bukan diasumsikan dari apa yang
    // dikirim. Kolom `jenis` dan `penangan` yang salah membuat tool-nya
    // dilewati pembaca konfigurasi dengan alasan "penangan tidak dikenal" —
    // dan itu baru ketahuan waktu ada yang bertanya.
    const b = cek[0];
    const benar = b.jenis === "kode" && b.penangan === "pergerakan_penjualan" && b.updated_by === "magang";
    console.log(`\n${benar ? "Bentuknya benar." : "⚠️ BENTUKNYA TIDAK SESUAI — periksa kolom di atas."}`);
  }
} finally {
  await c.end();
}
process.exitCode = 0;
