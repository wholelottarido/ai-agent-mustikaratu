/**
 * Mendaftarkan tiga tool riset pasar (Phase 2) ke `ai_tool`.
 *
 *   npm run daftar:pasar            -- lihat dulu, tidak menulis
 *   npm run daftar:pasar -- --tulis
 *
 * ============================================================
 * ⚠️ LEWAT SKRIP, SEBAB YANG SAMA DENGAN `ramal_penjualan`
 * ============================================================
 * Borang di layar Kelola AI hanya membuat tool `jenis = "konfigurasi"`, dan
 * itu dijamin role database: `ai_konfig` TIDAK punya hak menulis kolom
 * `jenis` maupun `penangan`. Penjagaan itu sengaja dan tidak dilonggarkan.
 *
 * Ketiga tool ini berjenis `kode` — hasilnya panggilan HTTP ke penyedia
 * pencarian lalu penyaringan sumber, bukan `SELECT ... WHERE`.
 *
 * ⚠️ `deskripsi` di baris `ai_tool` untuk tool `kode` berlaku sebagai CATATAN
 * administrator, BUKAN instruksi untuk model — yang dipakai model adalah
 * deskripsi di `voltagent/tools-pasar.ts`. Lihat catatan di `registry-kode.ts`.
 */
import { Client } from "pg";

const TULIS = process.argv.includes("--tulis");
const AGENT = "agent-marketing";

const TOOL = [
  {
    kode: "cari_tren_pasar",
    nama: "Riset tren pasar",
    deskripsi:
      "Mencari tren pasar dan berita industri dari internet untuk sebuah produk. Tidak meramal " +
      "penjualan. Yang dikirim ke penyedia pencarian hanya nama dan kategori produk yang sudah " +
      "publik — angka penjualan, kode SKU, dan hasil ramalan tidak pernah ikut.",
    contoh: "Bagaimana tren pasar untuk minyak zaitun saat ini?",
  },
  {
    kode: "riset_pesaing",
    nama: "Riset kegiatan pesaing",
    deskripsi:
      "Meneliti kegiatan pesaing yang terbuka ke publik untuk sebuah kategori produk. Hanya " +
      "informasi publik; tidak punya data penjualan pesaing maupun data internal perusahaan.",
    contoh: "Apa yang sedang dilakukan merek lain di kategori body lotion?",
  },
  {
    kode: "analisis_pasar_penjualan",
    nama: "Ramalan + konteks pasar",
    deskripsi:
      "Menggabungkan ramalan penjualan internal dengan riset pasar dari internet, lalu " +
      "memulangkan keduanya bersebelahan. Angka ramalan tetap dari model statistik dan TIDAK " +
      "boleh disesuaikan berdasarkan berita.",
    contoh: "Prediksi penjualan minyak zaitun 3 bulan ke depan beserta kondisi pasarnya",
  },
];

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
    `SELECT id_apps, nama FROM ai_agent WHERE kode = $1`,
    [AGENT],
  );
  if (agen.length === 0) throw new Error(`agent "${AGENT}" tidak ada`);
  console.log(`agent sasaran : ${agen[0].nama} (${AGENT})`);
  console.log(`id_apps       : ${agen[0].id_apps}\n`);

  for (const t of TOOL) {
    const { rows: ada } = await c.query(`SELECT kode FROM ai_tool WHERE kode = $1`, [t.kode]);
    if (ada.length > 0) {
      console.log(`${t.kode.padEnd(26)} sudah terdaftar — dilewati`);
      continue;
    }
    if (!TULIS) {
      console.log(`${t.kode.padEnd(26)} BELUM terdaftar (jalankan dengan -- --tulis)`);
      continue;
    }
    await c.query(
      `INSERT INTO ai_tool
         (kode, nama, deskripsi, jenis, penangan, operasi, cakupan_bawaan,
          kolom, filter, is_active, updated_by, id_apps, contoh_pertanyaan)
       VALUES ($1, $2, $3, 'kode', $1, 'baca', 'semua',
               '{}', '[]'::jsonb, false, 'magang', $4, $5)`,
      [t.kode, t.nama, t.deskripsi, agen[0].id_apps, t.contoh],
    );
    console.log(`${t.kode.padEnd(26)} TERDAFTAR`);
  }

  // ⚠️ Diperiksa ULANG dari database, bukan diasumsikan dari apa yang baru
  // saja ditulis. Pola yang sama dengan `daftar-tool-ramalan.mts`.
  const { rows: cek } = await c.query<Record<string, unknown>>(
    `SELECT kode, jenis, penangan, operasi, is_active, updated_by
       FROM ai_tool WHERE kode = ANY($1) ORDER BY kode`,
    [TOOL.map((t) => t.kode)],
  );
  console.log(`\nbaris yang ada sekarang (${cek.length} dari ${TOOL.length}):`);
  for (const r of cek) {
    console.log(`  ${String(r.kode).padEnd(26)} jenis=${r.jenis} penangan=${r.penangan} aktif=${r.is_active}`);
  }
  if (cek.length < TOOL.length && TULIS) {
    console.log("\n⚠️ Ada yang belum masuk. Periksa pesan di atas.");
    process.exitCode = 1;
  }
  if (!TULIS) {
    console.log("\n(mode lihat saja — tidak ada yang ditulis)");
  }
} finally {
  await c.end();
}
