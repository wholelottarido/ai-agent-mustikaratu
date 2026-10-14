/**
 * Tes koneksi & pengaman database sebuah departemen.
 *
 * Membuktikan tiga hal sebelum agent dipakai:
 *   1. User bisa baca (SELECT jalan)
 *   2. User TIDAK bisa nulis (CREATE/INSERT/DELETE ditolak)
 *   3. Database departemen LAIN tidak kelihatan
 *
 * Jalankan: npm run test:db -- marketing
 */
import { departemenDariArgv, sambungkan, namaDb } from "./lib/dep.mts";

let gagal = 0;
const ok = (msg: string) => console.log(`  OK   ${msg}`);
const bad = (msg: string) => {
  gagal++;
  console.log(`  GAGAL ${msg}`);
};

const dep = departemenDariArgv();
const conn = await sambungkan(dep);
const DB = namaDb(dep);
console.log(`Departemen ${dep.label} — database ${DB}
`);

// --- 1. Baca harus jalan ---
console.log('1. Izin baca');
const [tabel] = await conn.query<any[]>(
  `SELECT COUNT(*) AS n FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
  [DB],
);
const jumlahTabel = Number(tabel[0].n);
jumlahTabel > 0 ? ok(`SELECT jalan — ${jumlahTabel} tabel terbaca`) : bad('SELECT jalan tapi 0 tabel');

// Tabel contoh diambil dari information_schema, bukan dihardcode -- script
// ini dipakai semua departemen, dan tiap departemen punya tabel berbeda.
const [daftar] = await conn.query<any[]>(
  `SELECT TABLE_NAME AS t FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME LIMIT 1`,
  [DB],
);
const contohTabel = daftar[0]?.t as string | undefined;

if (contohTabel) {
  const [c] = await conn.query<any[]>(`SELECT COUNT(*) AS n FROM \`${contohTabel}\``);
  ok(`agregasi jalan — ${contohTabel} berisi ${Number(c[0].n).toLocaleString('id-ID')} baris`);
} else {
  bad('tidak ada tabel yang bisa dibaca');
}

// --- 2. Tulis harus ditolak ---
console.log('\n2. Izin tulis (semua HARUS ditolak)');
const tolak = async (label: string, sql: string) => {
  try {
    await conn.query(sql);
    bad(`${label} MALAH BERHASIL — grant kelebaran, ulangi script pembuatan user`);
  } catch (e: any) {
    const denied = /denied|read-only/i.test(e.message);
    denied ? ok(`${label} ditolak — ${e.code}`) : bad(`${label} error lain: ${e.message}`);
  }
};
await tolak('CREATE TABLE', 'CREATE TABLE uji_tulis (id INT)');
if (contohTabel) {
  await tolak('DELETE     ', `DELETE FROM \`${contohTabel}\` WHERE 1=0`);
  await tolak('UPDATE     ', `UPDATE \`${contohTabel}\` SET id = id WHERE 1=0`);
  await tolak('DROP       ', `DROP TABLE \`${contohTabel}\``);
}

// --- 3. Database lain tidak kelihatan ---
console.log('\n3. Isolasi database');
const [dbs] = await conn.query<any[]>('SHOW DATABASES');
const terlihat = dbs.map((d) => Object.values(d)[0] as string);
// information_schema & performance_schema dibuka MySQL ke SEMUA user secara
// bawaan dan tidak berisi data bisnis -- jadi bukan kebocoran.
const BAWAAN = ['information_schema', 'performance_schema', 'sys'];
const bocor = terlihat.filter((d) => ![...BAWAAN, DB].includes(d));
bocor.length === 0
  ? ok(`hanya ${DB} + schema bawaan MySQL yang terlihat`)
  : bad(`database lain ikut terlihat: ${bocor.join(', ')}`);

await conn.end();
console.log(gagal === 0 ? '\nSemua tes lolos.' : `\n${gagal} tes GAGAL.`);
process.exit(gagal === 0 ? 0 : 1);
