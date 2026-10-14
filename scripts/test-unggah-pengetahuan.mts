/**
 * Uji jalur unggah dari ujung ke ujung: gambar/PDF -> OCR -> embed -> dicari.
 *
 *   npm run test:unggah
 *
 * ⚠️ MENULIS SEMENTARA KE SCHEMA MILIK TIM LAIN, lalu MENGHAPUSNYA di
 * `finally` -- termasuk kalau ujinya gagal di tengah. Jumlah baris mereka
 * diperiksa ulang di akhir untuk membuktikan tidak ada sisa.
 *
 * ============================================================
 * KENAPA UJI INI ADA
 * ============================================================
 * Fitur unggah pernah MATI TOTAL tanpa ada yang tahu. Role `ai_ingest` tidak
 * punya hak atas `processing_logs_id_log_seq`, jadi tiap unggahan gagal di
 * INSERT terakhir dan seluruh transaksinya di-rollback. Tidak ada dokumen
 * tersimpan, dan tidak ada jejak galat di `processing_logs` -- justru karena
 * tabel ITU yang gagal.
 *
 * Yang bikin bahaya: typecheck lolos, lint lolos, semua uji lain lolos. Satu-
 * satunya cara menemukannya adalah benar-benar menjalankan jalurnya sampai
 * baris masuk ke database.
 *
 * Yang diperiksa di sini BUKAN cuma "tidak error", tapi nilai yang ditulis:
 * label model, status log, dan tanda departemen. Ketiganya tipe teks bebas --
 * database menerima nilai apa pun, dan yang salah baru ketahuan berbulan-bulan
 * kemudian lewat laporan yang angkanya tidak cocok.
 */
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { lokasiBerkas, unggahPengetahuan } from "../lib/kb/unggah.ts";
import { cariSop } from "../lib/kb/cari.ts";
import { LABEL_MODEL_EMBEDDING, DIMENSI } from "../voltagent/embedding.ts";

const JUDUL = "UJI-SEMENTARA Unggah Pengetahuan";
const DEP = "marketing";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const adm = new pg.Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
});
await adm.connect();

/** Jumlah baris SEBELUM uji -- pembandingnya di akhir. */
const sebelum = (await adm.query<{ d: number; c: number; l: number }>(
  `SELECT (SELECT count(*)::int FROM ai_knowledge.documents) d,
          (SELECT count(*)::int FROM ai_knowledge.chunks) c,
          (SELECT count(*)::int FROM ai_knowledge.processing_logs) l`,
)).rows[0];
console.log(`sebelum: ${sebelum.d} dokumen / ${sebelum.c} potongan / ${sebelum.l} log\n`);

const berkas = process.argv[2] ?? join(process.cwd(), "data", "laporan-penjualan-2025.pdf");
const isi = new Uint8Array(await readFile(berkas));
const jenis = berkas.endsWith(".pdf") ? "application/pdf"
  : berkas.endsWith(".png") ? "image/png"
  : berkas.endsWith(".webp") ? "image/webp" : "image/jpeg";
console.log(`berkas uji: ${berkas} (${jenis})\n`);

let id: string | undefined;
try {
  // ============================================================
  console.log("=== 1. Penyerapan sampai ke database ===");
  // ============================================================
  const h = await unggahPengetahuan({
    judul: JUDUL, nama: "uji-unggah", jenis, isi, departemen: DEP, pembuat: "uji-unggah",
  });
  id = h.id;
  cek("dokumen terserap", h.jumlahPotongan > 0, `${h.jumlahPotongan} potongan, cara=${h.cara}`);

  const d = (await adm.query<{ embed_model: string; status: string; kind: string; access_menus: string | null; chunk_count: number }>(
    "SELECT embed_model, status, kind, access_menus, chunk_count FROM ai_knowledge.documents WHERE id_document=$1",
    [id],
  )).rows[0];
  cek("baris documents benar-benar ada", Boolean(d));

  // ============================================================
  console.log("\n=== 2. Nilai kolom mengikuti konvensi tim lain ===");
  // ============================================================
  // Semuanya teks bebas. Database tidak akan menolak nilai yang salah --
  // yang menolak nanti adalah laporan mereka, diam-diam.
  cek("embed_model memakai pola mereka", d?.embed_model === LABEL_MODEL_EMBEDDING, `"${d?.embed_model}"`);
  cek("status = embedded", d?.status === "embedded", `"${d?.status}"`);
  cek("kind = upload", d?.kind === "upload", `"${d?.kind}"`);
  cek("chunk_count cocok", d?.chunk_count === h.jumlahPotongan, `${d?.chunk_count}`);

  const c = (await adm.query<{ embed_model: string; dim: number; n: number }>(
    `SELECT embed_model, vector_dims(embedding) dim, (SELECT count(*)::int FROM ai_knowledge.chunks WHERE id_document=$1) n
       FROM ai_knowledge.chunks WHERE id_document=$1 LIMIT 1`, [id],
  )).rows[0];
  cek("potongan tersimpan lengkap", c?.n === h.jumlahPotongan, `${c?.n} baris`);
  cek("vektor berdimensi benar", c?.dim === DIMENSI, `${c?.dim} dimensi`);
  cek("embed_model potongan sama", c?.embed_model === LABEL_MODEL_EMBEDDING);

  // Log inilah yang dulu bikin seluruh transaksi gagal.
  const l = (await adm.query<{ kind: string; status: string }>(
    "SELECT kind, status FROM ai_knowledge.processing_logs WHERE id_document=$1", [id],
  )).rows[0];
  cek("log penyerapan tertulis", Boolean(l));
  cek("status log = success (BUKAN done)", l?.status === "success", `"${l?.status}"`);

  // ============================================================
  console.log("\n=== 3. Tanda departemen langsung berlaku ===");
  // ============================================================
  // Ini syarat yang disepakati: data penjualan yang diunggah marketing TIDAK
  // boleh terbaca departemen lain, tanpa perlu langkah tambahan.
  cek("access_menus = departemen pengunggah", d?.access_menus === DEP, `"${d?.access_menus}"`);

  const TANYA = "laporan penjualan triwulan";
  const punya = (x: { judul: string }[]) => x.some((y) => y.judul === JUDUL);
  cek("marketing menemukannya", punya(await cariSop(TANYA, { batas: 8, departemen: DEP })));
  for (const lain of ["it", "hrd"]) {
    cek(`${lain} TIDAK menemukannya`, !punya(await cariSop(TANYA, { batas: 8, departemen: lain })));
  }

  // ============================================================
  console.log("\n=== 4. Role ai_ingest tetap seminimal mungkin ===");
  // ============================================================
  // Diperiksa di sini, bukan cuma waktu role dibuat: hak bisa berubah kapan
  // saja oleh siapa pun yang punya akses admin ke database itu.
  const hak = (await adm.query<{ tablename: string; upd: boolean; del: boolean }>(`
    SELECT t.tablename,
      has_table_privilege('ai_ingest','ai_knowledge.'||quote_ident(t.tablename),'UPDATE') upd,
      has_table_privilege('ai_ingest','ai_knowledge.'||quote_ident(t.tablename),'DELETE') del
    FROM pg_tables t WHERE t.schemaname='ai_knowledge'`)).rows;
  cek("tidak ada hak UPDATE", hak.every((x) => !x.upd), hak.filter((x) => x.upd).map((x) => x.tablename).join(", ") || "bersih");
  cek("tidak ada hak DELETE", hak.every((x) => !x.del), hak.filter((x) => x.del).map((x) => x.tablename).join(", ") || "bersih");

  const seq = (await adm.query<{ sequencename: string; usage: boolean }>(
    `SELECT sequencename, has_sequence_privilege('ai_ingest','ai_knowledge.'||quote_ident(sequencename),'USAGE') usage
       FROM pg_sequences WHERE schemaname='ai_knowledge'`)).rows;
  cek("semua sequence bisa dipakai", seq.every((x) => x.usage), seq.filter((x) => !x.usage).map((x) => x.sequencename).join(", ") || `${seq.length} sequence`);
} finally {
  // ⚠️ SELALU dibersihkan, apa pun yang terjadi di atas.
  if (id) {
    for (const t of ["processing_logs", "chunks", "documents"]) {
      await adm.query(`DELETE FROM ai_knowledge.${t} WHERE id_document=$1`, [id]).catch(() => {});
    }
  }
  // Berkas di disk ikut dihapus. Baris database yang hilang tanpa berkasnya
  // ikut hilang berarti folder `data/knowledge-files/` pelan-pelan penuh
  // dokumen yang tidak dirujuk siapa pun -- dan isinya data perusahaan.
  if (id) await rm(lokasiBerkas(id, jenis), { force: true }).catch(() => {});
  if (id) {
    const berkasSisa = existsSync(lokasiBerkas(id, jenis));
    cek("berkas uji tidak tertinggal di data/knowledge-files/", !berkasSisa);
  }
  const sesudah = (await adm.query<{ d: number; c: number; l: number }>(
    `SELECT (SELECT count(*)::int FROM ai_knowledge.documents) d,
            (SELECT count(*)::int FROM ai_knowledge.chunks) c,
            (SELECT count(*)::int FROM ai_knowledge.processing_logs) l`,
  )).rows[0];
  console.log(`\nsesudah: ${sesudah.d} dokumen / ${sesudah.c} potongan / ${sesudah.l} log`);
  cek(
    "tidak ada baris uji yang tertinggal di schema mereka",
    sesudah.d === sebelum.d && sesudah.c === sebelum.c && sesudah.l === sebelum.l,
  );
  await adm.end();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exitCode = gagal === 0 ? 0 : 1;
