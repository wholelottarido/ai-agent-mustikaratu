/**
 * Lihat siapa memakai berapa. `npm run pemakaian`
 *
 * Bukan cuma untuk menagih — ini cara melihat apakah batas kuotanya masuk
 * akal. Kalau tidak ada yang pernah mendekati batas, batasnya kekencangan
 * atau kelonggaran, dan angkanya perlu disesuaikan.
 */
import mysql from "mysql2/promise";
import { hitungBiaya, formatRupiah, KURS_USD } from "../voltagent/models.ts";

// Harga diambil dari `voltagent/models.ts`, tidak ditulis ulang di sini.
// Dua daftar harga yang terpisah pasti melenceng cepat atau lambat, dan
// laporan yang salahnya diam-diam lebih buruk daripada tidak ada laporan.

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "localhost",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  // `portal_readonly`, BUKAN `portal_app`: laporan ini menggabungkan dengan
  // tabel `pengguna`, dan `portal_app` sengaja tidak bisa membacanya.
  user: process.env.PORTAL_DB_USER,
  password: process.env.PORTAL_DB_PASSWORD,
  database: process.env.PORTAL_DB_NAME ?? "portal",
});

const [ringkas] = await c.query<mysql.RowDataPacket[]>(
  `SELECT p.username, p.nama, m.model, m.asal, m.berbayar,
          COUNT(*) AS jumlah,
          SUM(COALESCE(m.token_masuk, 0))  AS masuk,
          SUM(COALESCE(m.token_keluar, 0)) AS keluar,
          SUM(m.dibuat >= NOW() - INTERVAL 1 DAY)  AS sehari,
          SUM(m.dibuat >= NOW() - INTERVAL 1 HOUR) AS sejam
     FROM pemakaian m
     JOIN pengguna p ON p.id = m.pengguna_id
    GROUP BY p.username, p.nama, m.model, m.asal, m.berbayar
    ORDER BY jumlah DESC`,
);

if (ringkas.length === 0) {
  console.log("Belum ada pemakaian tercatat.");
} else {
  console.log(
    "\n" +
      "akun".padEnd(12) +
      "model".padEnd(20) +
      "asal".padEnd(6) +
      "total".padStart(6) +
      "sehari".padStart(8) +
      "sejam".padStart(7) +
      "  perkiraan biaya",
  );
  console.log("-".repeat(78));

  let totalRp = 0;
  for (const r of ringkas) {
    const rp = hitungBiaya(r.model as string, Number(r.masuk), Number(r.keluar)) ?? 0;
    totalRp += rp;

    console.log(
      String(r.username).padEnd(12) +
        String(r.model).padEnd(20) +
        String(r.asal).padEnd(6) +
        String(r.jumlah).padStart(6) +
        String(r.sehari).padStart(8) +
        String(r.sejam).padStart(7) +
        "  " +
        (r.berbayar ? formatRupiah(rp) : "gratis (lokal)"),
    );
  }
  console.log("-".repeat(78));
  console.log(`total perkiraan: ${formatRupiah(totalRp)}  (kurs Rp ${KURS_USD.toLocaleString("id-ID")}/USD)`);
  console.log(
    "\n⚠️ Perkiraan, bukan tagihan. Baris yang tokennya NULL (permintaan gagal\n" +
      "   di tengah jalan) terhitung 0 di sini, padahal Anthropic tetap menagih.",
  );
}

console.log(`\nbatas sekarang: ${process.env.KUOTA_PER_JAM ?? 20}/jam, ${process.env.KUOTA_PER_HARI ?? 80}/hari per pengguna`);
await c.end();
