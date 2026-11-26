/**
 * Mencatat tool tim lain yang sudah ada sebagai `dikenal`, sehingga tetap dipakai.
 *
 *   npm run tinjau:isi-awal
 *
 * Sekali pakai. Kalau daftarnya sudah terisi, skrip ini berhenti: menjalankannya lagi berarti
 * meloloskan semua tool yang sedang menunggu keputusan tanpa ada yang memutuskan.
 */
import type mysql from "mysql2/promise";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { poolPortalAdmin } from "../lib/db-portal.ts";

const admin = poolPortalAdmin();
const [ada] = await admin.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM ai_tool_tinjau");
if (Number(ada[0].n) > 0) {
  console.log(`Sudah terisi ${ada[0].n} baris, tidak ada yang dikerjakan.`);
  process.exit(0);
}

const { rows } = await poolPerusahaan().query<{ kode: string }>(
  `SELECT kode FROM ai_tool WHERE coalesce(updated_by, '') <> 'magang' ORDER BY kode`,
);
if (rows.length === 0) throw new Error("ai_tool tidak punya baris tim lain, jadi daftar awal tidak diisi");

for (let i = 0; i < rows.length; i += 200) {
  const bagian = rows.slice(i, i + 200).map((r) => [r.kode, "dikenal"]);
  await admin.query("INSERT INTO ai_tool_tinjau (tool_kode, status) VALUES ?", [bagian]);
}
console.log(`${rows.length} tool tim lain dicatat sebagai dikenal.`);
process.exit(0);
