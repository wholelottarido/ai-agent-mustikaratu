import { validasiSql } from '../voltagent/sql-guard';

type Kasus = { nama: string; sql: string; harus: 'lolos' | 'ditolak'; cek?: (sql: string) => boolean };

const kasus: Kasus[] = [
  // --- harus LOLOS ---
  { nama: 'SELECT biasa', sql: 'SELECT * FROM produk', harus: 'lolos',
    cek: (s) => /LIMIT 200$/.test(s) },
  { nama: 'SELECT dengan LIMIT sendiri', sql: 'SELECT nama FROM produk LIMIT 10', harus: 'lolos',
    cek: (s) => /LIMIT 10$/.test(s) },
  { nama: 'CTE (WITH)', sql: 'WITH x AS (SELECT 1 AS a) SELECT a FROM x', harus: 'lolos' },
  { nama: 'titik koma di akhir', sql: 'SELECT 1;', harus: 'lolos' },
  { nama: 'JOIN kompleks', sql:
      "SELECT p.nama, SUM(sol.subtotal) FROM sales_order_line sol JOIN sales_order so ON so.id=sol.order_id JOIN produk p ON p.id=sol.produk_id WHERE so.status='COMPLETED' GROUP BY p.id",
    harus: 'lolos' },
  // KASUS PENTING: kata terlarang di dalam string literal harus tetap lolos
  { nama: "LIKE '%update%' (kata terlarang di dalam string)",
    sql: "SELECT komentar FROM customer_feedback WHERE komentar LIKE '%update%'", harus: 'lolos' },
  { nama: "LIKE '%drop%' di komentar",
    sql: "SELECT komentar FROM customer_feedback WHERE komentar LIKE '%drop%' LIMIT 5", harus: 'lolos' },
  { nama: 'subquery punya LIMIT, top-level belum',
    sql: 'SELECT * FROM (SELECT id FROM produk LIMIT 5) t', harus: 'lolos',
    cek: (s) => /\) t LIMIT 200$/.test(s) },
  { nama: 'LIMIT kebesaran diturunkan', sql: 'SELECT * FROM produk LIMIT 99999', harus: 'lolos',
    cek: (s) => /LIMIT 200$/.test(s) },

  // --- harus DITOLAK ---
  { nama: 'DROP TABLE', sql: 'DROP TABLE produk', harus: 'ditolak' },
  { nama: 'DELETE', sql: 'DELETE FROM produk', harus: 'ditolak' },
  { nama: 'UPDATE', sql: "UPDATE produk SET harga=0", harus: 'ditolak' },
  { nama: 'multi-statement', sql: 'SELECT 1; DROP TABLE produk', harus: 'ditolak' },
  { nama: 'komentar -- menyembunyikan perintah', sql: 'SELECT 1 -- lalu DROP TABLE produk', harus: 'ditolak' },
  { nama: 'komentar blok', sql: 'SELECT /* apa saja */ 1', harus: 'ditolak' },
  { nama: 'SELECT INTO OUTFILE', sql: "SELECT * FROM produk INTO OUTFILE '/tmp/x'", harus: 'ditolak' },
  { nama: 'SLEEP (bikin nyangkut)', sql: 'SELECT SLEEP(30)', harus: 'ditolak' },
  { nama: 'BENCHMARK', sql: 'SELECT BENCHMARK(1000000, MD5(1))', harus: 'ditolak' },
  { nama: 'query kosong', sql: '   ', harus: 'ditolak' },
  { nama: 'SHOW (bukan SELECT)', sql: 'SHOW DATABASES', harus: 'ditolak' },
];

let lolos = 0, gagal = 0;
for (const k of kasus) {
  const hasil = validasiSql(k.sql, 200);
  const sesuai = k.harus === 'lolos' ? hasil.ok : !hasil.ok;
  const cekOk = !(sesuai && hasil.ok && k.cek) || (hasil.ok && k.cek!(hasil.sql));

  if (sesuai && cekOk) {
    lolos++;
    console.log(`  OK   ${k.nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${k.nama}`);
    console.log(`        harap=${k.harus} hasil=${hasil.ok ? 'lolos' : 'ditolak: ' + hasil.alasan}`);
    if (hasil.ok) console.log(`        sql  =${hasil.sql}`);
  }
}
console.log(`\n${lolos} lolos, ${gagal} gagal dari ${kasus.length} kasus`);
process.exit(gagal === 0 ? 0 : 1);
