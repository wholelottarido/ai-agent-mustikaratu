/**
 * Role minimum untuk MENGUBAH setelan tool AI dari layar pengaturan portal.
 *
 *   npm run buat:pg-konfig
 *
 * ⚠️ MENULIS KE SERVER PERUSAHAAN (membuat role). Memakai `DEMO_PG_ADMIN_*`.
 *
 * ============================================================
 * HAK PER KOLOM, BUKAN PER TABEL
 * ============================================================
 * `GRANT UPDATE ON ai_tool` akan memberi layar pengaturan kuasa mengubah
 * SELURUH baris di tabel itu — termasuk `penangan` (nama fungsi yang
 * dijalankan), `id_ai_sumber_data` (view mana yang dibaca), `tabel_target`
 * (tabel mana yang ditulis), dan `jenis`. Empat kolom itu menentukan APA yang
 * dikerjakan tool, bukan sekadar setelannya.
 *
 * PostgreSQL bisa memberi UPDATE per kolom, jadi dipakai: role ini secara
 * harfiah TIDAK BISA menyentuh keempatnya, walau ada bug di route, di
 * validasi, atau di layar. Penjagaan yang ada di database tidak ikut hilang
 * waktu kode kita salah.
 *
 * Yang boleh diubah cuma setelan tampilan, cakupan, & izin:
 *   kolom, filter, urut_kolom, urut_arah, batas, cakupan_bawaan, izin,
 *   contoh_pertanyaan, nama, deskripsi, is_active, updated_at, updated_by
 *
 * ⚠️ `izin` SENGAJA ikut, dan itu tidak melemahkan apa pun. Izin hanya
 * MEMPERSEMPIT siapa yang mendapat sebuah tool, tidak pernah melebarkan: tool
 * tanpa izin terpasang untuk semua pemegang aplikasinya, tool berizin cuma
 * untuk yang punya kodenya. Menahannya di luar jangkauan layar justru membuat
 * administrator tidak punya cara menutup tool bercakupan `semua` yang ia buat
 * sendiri.
 *
 * ⚠️ BARIS MANA yang boleh diubah TIDAK dijaga di sini — PostgreSQL tidak
 * punya "UPDATE hanya baris milik X" tanpa RLS, dan menyalakan RLS di tabel
 * milik tim lain akan mengubah perilaku sistem mereka. Itu dijaga di
 * `lib/ubah-tool.ts` lewat `WHERE updated_by = 'magang'`, dan diperiksa uji.
 */
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

/**
 * Kolom yang boleh DIISI waktu membuat tool baru.
 *
 * ⚠️ YANG TIDAK ADA DI SINI MENGAMBIL NILAI BAWAANNYA, DAN ITU PENJAGAANNYA.
 *
 *   jenis         -> 'konfigurasi'   (bukan 'kode')
 *   operasi       -> 'baca'          (bukan tambah/ubah/hapus)
 *   tabel_target  -> NULL
 *   penangan      -> NULL
 *   kolom_isian / kolom_otomatis / kolom_kunci / syarat -> []
 *
 * Artinya tool yang dibuat lewat layar pengaturan TIDAK BISA jadi tool tulis
 * maupun tool berjenis kode — bukan karena kode kita menolaknya, tapi karena
 * role ini tidak punya cara mengisinya. Satu bug di route atau di validasi
 * tidak mengubah itu.
 */
const KOLOM_BUAT = [
  "kode", "nama", "deskripsi", "id_ai_sumber_data", "id_apps", "kolom", "filter",
  "urut_kolom", "urut_arah", "batas", "cakupan_bawaan", "contoh_pertanyaan",
  "izin", "is_active", "updated_by",
  // ⚠️ ENAM KOLOM DI BAWAH MENGUBAH SATU JAMINAN, dan itu disengaja (9 Okt 2026).
  //
  // Sebelumnya tool buatan layar SELALU beroperasi `baca` -- dijamin DATABASE,
  // karena role ini tidak punya cara mengisi kolom yang menentukan sebaliknya.
  // Jaminan itu kuat, dan sekarang dilepas supaya administrator bisa membuat
  // tool tulis sendiri tanpa menunggu programmer.
  //
  // YANG MENGGANTIKANNYA, dan kenapa ini tidak jadi lubang:
  //
  //   1. `jenis` dan `penangan` TETAP di luar jangkauan. Tool buatan layar
  //      tidak bisa jadi tool berjenis kode -- ia tidak bisa menunjuk fungsi
  //      mana pun untuk dijalankan.
  //   2. `tabel_target` diisi, TAPI penjalannya menolak tabel di luar
  //      daftar-boleh di `lib/entri/tulis-umum.ts`. Baris yang menunjuk
  //      `employee` atau `users` tersimpan, lalu tidak pernah jalan.
  //   3. Kolom yang boleh ditulis dibaca dari HAK ROLE PENULIS saat itu juga.
  //      Konfigurasi tidak bisa memperluas apa yang database sendiri tolak.
  //   4. Penyaring pemilik selalu ikut di `WHERE`, dan tidak datang dari
  //      konfigurasi.
  //   5. Operasi tanpa `kolom_kunci` ditolak -- itu UPDATE tanpa WHERE.
  //
  // Jadi yang hilang jaminan "tidak bisa menulis"; yang tersisa jaminan
  // "tidak bisa menulis SEMBARANGAN". Perbedaannya ditulis di sini supaya
  // tidak ditemukan sebagai kejutan.
  "operasi", "tabel_target", "kolom_isian", "kolom_otomatis", "kolom_kunci", "syarat",
];

/** Kolom yang boleh diubah. Di luar ini ditolak database, bukan cuma kode. */
const KOLOM_BOLEH = [
  "nama", "deskripsi", "kolom", "filter", "urut_kolom", "urut_arah", "batas",
  "cakupan_bawaan", "contoh_pertanyaan", "izin", "is_active", "updated_at", "updated_by",
];

const user = process.env.DEMO_PG_KONFIG_USER ?? "ai_konfig";
const password = wajib("DEMO_PG_KONFIG_PASSWORD");
const role = identitas(user);

const c = new Client({
  host: wajib("DEMO_PG_HOST"),
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: wajib("DEMO_PG_DATABASE"),
  user: wajib("DEMO_PG_ADMIN_USER"),
  password: wajib("DEMO_PG_ADMIN_PASSWORD"),
  connectionTimeoutMillis: 15_000,
});

try {
  await c.connect();
  await c.query("BEGIN");
  await c.query(`DO $$ BEGIN CREATE ROLE ${role} LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await c.query("SELECT set_config('ai.konfig_password', $1, false)", [password]);
  await c.query(
    `DO $$ BEGIN EXECUTE format('ALTER ROLE ${user} PASSWORD %L', current_setting('ai.konfig_password')); END $$`);
  await c.query(`ALTER ROLE ${role} CONNECTION LIMIT 3`);

  await c.query(`GRANT CONNECT ON DATABASE ${identitas(wajib("DEMO_PG_DATABASE"))} TO ${role}`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await c.query(`GRANT SELECT ON ai_tool, ai_sumber_data, ai_agent, ai_agent_tool TO ${role}`);

  // ⚠️ Dicabut lebih dulu, baru diberikan yang boleh. Kalau role ini pernah
  // dibuat dengan hak lebih luas, menjalankan ulang skrip ini menyempitkannya
  // — bukan menumpuk di atas hak lama yang tidak kelihatan.
  await c.query(`REVOKE ALL ON ai_tool FROM ${role}`);
  await c.query(`GRANT SELECT ON ai_tool TO ${role}`);
  await c.query(`GRANT UPDATE (${KOLOM_BOLEH.join(", ")}) ON ai_tool TO ${role}`);

  // ⚠️ INSERT PER KOLOM juga — lihat `KOLOM_BUAT`. Tool buatan layar selalu
  // berjenis `konfigurasi` dan beroperasi `baca`, karena role ini tidak punya
  // cara mengisi kolom yang menentukan sebaliknya.
  await c.query(`GRANT INSERT (${KOLOM_BUAT.join(", ")}) ON ai_tool TO ${role}`);

  // ⚠️ DELETE TIDAK DIBERIKAN, dan itu disengaja.
  //
  // Hak baris tidak bisa dibatasi tanpa RLS, jadi DELETE berarti satu bug di
  // layar pengaturan bisa menghapus tool milik tim lain -- kerugian yang tidak
  // bisa kita pulihkan karena barisnya bukan punya kita. Mencabut tool buatan
  // sendiri dilakukan lewat `npm run daftar:sumber-ai -- --batal`, yang memakai
  // kredensial admin dan punya daftar-boleh sendiri.
  await c.query(`REVOKE DELETE, TRUNCATE ON ai_tool FROM ${role}`);
  await c.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ai_sumber_data, ai_agent, ai_agent_tool FROM ${role}`);

  await c.query("COMMIT");
  console.log(`role ${user} siap.\n`);
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(`GAGAL: ${(e as Error).message}`);
  await c.end();
  process.exit(1);
}

// Pembuktian, bukan harapan: hak dibaca ulang dari database.
const hak = await c.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.column_privileges
    WHERE grantee = $1 AND table_name = 'ai_tool' AND privilege_type = 'UPDATE'
    ORDER BY column_name`, [user]);
const boleh = hak.rows.map((r) => r.column_name);
console.log(`UPDATE diizinkan pada ${boleh.length} kolom: ${boleh.join(", ")}`);

const terlarang = ["penangan", "id_ai_sumber_data", "tabel_target", "jenis", "kode", "id_apps"];
const bocor = terlarang.filter((k) => boleh.includes(k));
console.log(
  bocor.length === 0
    ? `OK  — ${terlarang.join(", ")} tidak bisa diubah role ini.`
    : `⚠️  BOCOR: ${bocor.join(", ")} masih bisa diubah.`,
);

const hakBuat = await c.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.column_privileges
    WHERE grantee = $1 AND table_name = 'ai_tool' AND privilege_type = 'INSERT'
    ORDER BY column_name`, [user]);
const bolehBuat = hakBuat.rows.map((r) => r.column_name);
console.log(`
INSERT diizinkan pada ${bolehBuat.length} kolom: ${bolehBuat.join(", ")}`);
// ⚠️ DAFTARNYA MENYEMPIT, bukan hilang. `jenis` dan `penangan` tetap harus
// mengambil nilai bawaan: tool buatan layar tidak boleh bisa menunjuk fungsi
// mana pun untuk dijalankan. Yang lain sengaja dibuka -- lihat catatan panjang
// di `KOLOM_BUAT`.
const wajibBawaan = ["jenis", "penangan"];
const bocorBuat = wajibBawaan.filter((k) => bolehBuat.includes(k));
console.log(
  bocorBuat.length === 0
    ? `OK  — ${wajibBawaan.join(", ")} selalu mengambil nilai bawaan, jadi tool buatan layar
` +
      `      selalu berjenis 'konfigurasi' dan tidak bisa menunjuk fungsi untuk dijalankan.`
    : `⚠️  BOCOR: ${bocorBuat.join(", ")} bisa diisi — tool berjenis kode bisa dibuat dari layar.`,
);
const tulisBisa = ["operasi", "tabel_target", "kolom_isian", "kolom_kunci"].filter((k) => bolehBuat.includes(k));
console.log(
  tulisBisa.length === 4
    ? `OK  — layar bisa membuat tool TULIS (${tulisBisa.join(", ")}).
` +
      `      Penjagaannya pindah ke lib/entri/tulis-umum.ts: daftar-boleh tabel,
` +
      `      hak kolom role penulis, penyaring pemilik wajib, dan kunci wajib.`
    : `⚠️  Layar BELUM bisa membuat tool tulis — baru ${tulisBisa.length}/4 kolom diizinkan.`,
);

for (const t of ["ai_sumber_data", "ai_agent", "ai_agent_tool"]) {
  const r = await c.query<{ ada: boolean }>(
    `SELECT has_table_privilege($1, $2, 'UPDATE') ada`, [user, t]);
  console.log(`  UPDATE ${t.padEnd(16)}: ${r.rows[0].ada ? "⚠️ BISA" : "tidak bisa"}`);
}

await c.end();
process.exitCode = bocor.length === 0 && bocorBuat.length === 0 ? 0 : 1;
