/** Buat role minimum untuk menulis dokumen pengetahuan dari portal. */
import { Client } from "pg";

function wajib(nama: string): string {
  const nilai = process.env[nama];
  if (!nilai) throw new Error(`${nama} belum diisi di .env.local.`);
  return nilai;
}
function identitas(nilai: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(nilai)) throw new Error(`Nama role tidak sah: ${nilai}`);
  return `"${nilai}"`;
}

const adminUser = wajib("DEMO_PG_ADMIN_USER");
const adminPassword = wajib("DEMO_PG_ADMIN_PASSWORD");
const user = process.env.DEMO_PG_INGEST_USER ?? "ai_ingest";
const password = wajib("DEMO_PG_INGEST_PASSWORD");
const role = identitas(user);
const c = new Client({
  host: wajib("DEMO_PG_HOST"), port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: wajib("DEMO_PG_DATABASE"), user: adminUser, password: adminPassword,
});

try {
  await c.connect();
  await c.query("BEGIN");
  await c.query(`DO $$ BEGIN CREATE ROLE ${role} LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await c.query("SELECT set_config('ai.ingest_password', $1, false)", [password]);
  await c.query(`DO $$ BEGIN EXECUTE format('ALTER ROLE ${user} PASSWORD %L', current_setting('ai.ingest_password')); END $$`);
  await c.query(`ALTER ROLE ${role} CONNECTION LIMIT 3`);
  await c.query(`ALTER ROLE ${role} SET statement_timeout = '60s'`);
  await c.query(`GRANT CONNECT ON DATABASE ${identitas(process.env.DEMO_PG_DATABASE!)} TO ${role}`);
  await c.query(`GRANT USAGE ON SCHEMA ai_knowledge TO ${role}`);
  await c.query(`GRANT SELECT, INSERT ON ai_knowledge.documents, ai_knowledge.chunks TO ${role}`);
  await c.query(`GRANT INSERT ON ai_knowledge.processing_logs TO ${role}`);
  /**
   * SEMUA sequence di schema, bukan disebut satu per satu.
   *
   * ⚠️ INI PERNAH BIKIN SELURUH FITUR UNGGAH MATI TANPA KETAHUAN.
   *
   * Sebelumnya cuma `chunks_id_chunk_seq` yang diberi hak. Baris terakhir yang
   * ditulis `unggahPengetahuan` adalah ke `processing_logs` -- yang punya
   * sequence sendiri. Jadi tiap unggahan berjalan mulus sampai langkah
   * terakhir, lalu kena "permission denied for sequence
   * processing_logs_id_log_seq", dan karena semuanya di dalam satu transaksi,
   * SELURUHNYA di-rollback. Dokumen tidak tersimpan, potongan tidak tersimpan,
   * dan tidak ada jejak di processing_logs -- justru karena tabel itu yang
   * gagal. Dari luar kelihatan seperti fitur yang belum pernah dipakai.
   *
   * Menyebut sequence satu per satu berarti bug ini terulang tiap kali tabel
   * baru ditambahkan tim lain.
   */
  await c.query(`
    DO $$
    DECLARE s record;
    BEGIN
      FOR s IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'ai_knowledge' LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE ai_knowledge.%I TO ${role}', s.sequencename);
      END LOOP;
    END $$`);
  /**
   * SELECT + INSERT saja -- TANPA UPDATE, TANPA DELETE.
   *
   * `unggahPengetahuan` cuma menambah baris baru; tidak ada satu pun jalur kode
   * yang perlu mengubah dokumen yang sudah ada. Hak UPDATE di sini berarti satu
   * bug di portal kita (WHERE yang hilang, id yang salah) bisa menimpa 58
   * panduan milik tim lain -- dan itu kerugian yang tidak bisa kita pulihkan,
   * karena isinya bukan data kita.
   *
   * Tabel `ai_kb_*` kita sendiri pernah dihapus pihak lain tanpa pemberitahuan
   * (2 Okt). Hak minimal di sini supaya kita tidak jadi pihak yang melakukan
   * hal setara.
   *
   * Kalau nanti memang perlu "ganti berkas" seperti fitur mereka, hak UPDATE
   * ditambahkan SAAT ITU dan dibatasi per kolom -- bukan disiapkan dari awal
   * untuk kemungkinan yang belum ada.
   */
  await c.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ai_knowledge.documents, ai_knowledge.chunks FROM ${role}`);
  await c.query("COMMIT");
  console.log(`Role ${user} siap. Portal tetap memakai portal_login untuk login.`);
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await c.end();
}
