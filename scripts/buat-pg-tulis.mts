/**
 * Role minimum untuk MEMBUAT tiket helpdesk dari portal.
 *
 *   npm run buat:pg-tulis
 *
 * ⚠️ MENULIS KE SERVER PERUSAHAAN (membuat role). Memakai `DEMO_PG_ADMIN_*`.
 *
 * ⚠️ BERI TAHU TIM PEMILIK `portal_ticket` SEBELUM MENJALANKAN INI.
 *
 * Tabelnya bukan milik kita: 10.089 tiket, dan teknisi IT mengerjakan
 * antreannya. Yang diberikan di sini bukan "akses ke database", melainkan
 * kemampuan satu portal menambah pekerjaan ke daftar kerja orang lain. Itu
 * keputusan mereka juga, bukan cuma keputusan teknis.
 *
 * ============================================================
 * HAK PER KOLOM, BUKAN PER TABEL
 * ============================================================
 * `GRANT INSERT ON portal_ticket` akan membuat portal ini bisa melahirkan
 * tiket yang SUDAH berstatus `RESOLVED`, sudah ditugaskan ke teknisi tertentu,
 * atau sudah bertanggal tutup. PostgreSQL bisa memberi INSERT per kolom, jadi
 * dipakai.
 *
 * Yang boleh diisi hanya `KOLOM_BUAT` di bawah. Yang TIDAK ada di situ
 * mengambil nilai bawaannya, dan itulah penjagaannya:
 *
 *   status       -> 'OPEN'    (bukan RESOLVED/REJECTED)
 *   self_closed  -> false
 *   created_at   -> now()
 *   id_technician, assigned_by, assigned_at, closed_at, closed_by -> NULL
 *
 * Artinya tiket buatan portal ini SELALU lahir terbuka dan belum ditugaskan —
 * dijamin database, bukan oleh kode kita. Satu bug di route atau di validasi
 * tidak mengubah itu.
 *
 * ⚠️ `no_ticket` TERMASUK yang boleh diisi, dan itu tidak bisa dihindari:
 * tidak ada trigger maupun nilai bawaan di database, sedangkan tiket tanpa
 * nomor tidak terbaca di aplikasi mereka. Yang menjaganya adalah `UNIQUE` di
 * kolom itu — nomor yang bertabrakan dengan nomor buatan aplikasi mereka
 * GAGAL KERAS, lalu dicoba ulang.
 *
 * ⚠️ UPDATE DAN DELETE TIDAK DIBERIKAN. Mengubah dan membatalkan tiket perlu
 * pembatasan "hanya baris milik penanya", dan PostgreSQL tidak punya itu tanpa
 * RLS. Menyalakan RLS di tabel milik tim lain akan mengubah perilaku aplikasi
 * mereka. Jadi `ubah_tiket` dan `batalkan_tiket` tetap belum dikerjakan, dan
 * tetap dilewati dengan alasan yang tercetak.
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
 * Kolom yang boleh DIISI waktu membuat tiket.
 *
 * ⚠️ Harus sama persis dengan `KOLOM_ISI` di `lib/entri/simpan-tiket.ts`.
 * Kalau yang satu lebih longgar, yang terjadi bukan galat — melainkan
 * kemampuan yang tidak pernah diputuskan siapa pun.
 */
const KOLOM_BUAT = [
  "no_ticket", "id_employee", "id_category", "id_sub_category",
  "subject", "description", "priority",
];

/** Kolom yang kalau bocor berarti tiket bisa lahir dalam keadaan tidak wajar. */
/**
 * Kolom yang boleh DIUBAH waktu menyunting tiket.
 *
 * ⚠️ JAUH LEBIH SEMPIT DARIPADA `KOLOM_BUAT`, dan bukan kebetulan. Mengubah
 * tiket yang sudah masuk antrean bukan membuat pekerjaan baru — ia menyentuh
 * pekerjaan yang mungkin sudah dibaca orang. Yang boleh berubah cuma isi
 * laporannya; kategori dan sub-kategori TIDAK, karena memindahkan tiket antar
 * kategori berarti memindahkannya ke antrean orang lain.
 *
 * ⚠️ BATAS "HANYA TIKET MILIK PENANYA" TIDAK ADA DI SINI, dan itu kelemahan
 * yang harus dibaca apa adanya. PostgreSQL tidak punya "UPDATE hanya baris
 * milik X" tanpa RLS, dan menyalakan RLS di tabel tim lain akan mengubah
 * perilaku aplikasi mereka. Jadi batas baris ditegakkan `WHERE` di
 * `lib/entri/simpan-tiket.ts` — lebih lemah daripada jaminan pembuatan tiket,
 * yang berdiri di database.
 *
 * Yang TETAP dijamin database: kolom mana yang boleh berubah. Bug di `WHERE`
 * kita berarti judul tiket orang lain bisa berubah — tidak bisa jadi tiket
 * orang lain tertutup, ditugaskan ulang, atau terhapus.
 */
const KOLOM_UBAH = ["subject", "description", "priority", "status", "updated_at"];

/**
 * ⚠️ `status` DIBUKA, DAN ITU MENURUNKAN SATU JAMINAN.
 *
 * Sebelumnya `status` mustahil disentuh, dan itulah yang menjamin penyuntingan
 * tiket tidak bisa menutupnya. Sekarang pembatalan tiket (`batalkan_tiket`,
 * yang sebenarnya UPDATE status -> CANCELLED, bukan DELETE) memerlukannya.
 *
 * Yang menggantikan jaminan itu bukan lagi database, melainkan baris
 * konfigurasi: tool pembatalan menulis nilai TETAP `CANCELLED` dari
 * `kolom_otomatis`, dan nilai itu terbaca di layar Kelola AI. Administrator
 * yang mengubahnya jadi `RESOLVED` membuat tool yang menutup tiket — jadi
 * kolom itu harus kelihatan di layar, bukan tersembunyi.
 */

const TERLARANG = [
  "status", "id_technician", "preferred_technician", "assigned_by", "assigned_at",
  "closed_at", "closed_by", "self_closed", "id_ticket", "created_at",
];

const user = process.env.DEMO_PG_TULIS_USER ?? "ai_tulis";
const password = wajib("DEMO_PG_TULIS_PASSWORD");
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
  await c.query("SELECT set_config('ai.tulis_password', $1, false)", [password]);
  await c.query(
    `DO $$ BEGIN EXECUTE format('ALTER ROLE ${user} PASSWORD %L', current_setting('ai.tulis_password')); END $$`);
  await c.query(`ALTER ROLE ${role} CONNECTION LIMIT 3`);

  await c.query(`GRANT CONNECT ON DATABASE ${identitas(wajib("DEMO_PG_DATABASE"))} TO ${role}`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${role}`);

  // ⚠️ Dicabut lebih dulu, baru diberikan yang boleh. Kalau role ini pernah
  // dibuat dengan hak lebih luas, menjalankan ulang skrip ini MENYEMPITKANNYA
  // — bukan menumpuk di atas hak lama yang tidak kelihatan.
  await c.query(`REVOKE ALL ON portal_ticket FROM ${role}`);

  // SELECT diperlukan untuk menghitung nomor berikutnya dan untuk RETURNING.
  await c.query(`GRANT SELECT ON portal_ticket TO ${role}`);
  await c.query(`GRANT INSERT (${KOLOM_BUAT.join(", ")}) ON portal_ticket TO ${role}`);
  await c.query(`GRANT UPDATE (${KOLOM_UBAH.join(", ")}) ON portal_ticket TO ${role}`);
  // ⚠️ DELETE tetap tidak diberikan. Membatalkan tiket nanti dikerjakan dengan
  // mengubah `status`, bukan menghapus baris — dan `status` sengaja TIDAK ada
  // di `KOLOM_UBAH`, jadi pembatalan belum mungkin sampai itu diputuskan.
  await c.query(`REVOKE DELETE, TRUNCATE ON portal_ticket FROM ${role}`);

  // Kategori dibaca untuk memvalidasi pasangan kategori/sub-kategori. Tabel
  // ini tidak boleh ditulis sama sekali.
  await c.query(`GRANT SELECT ON category, sub_category, employee TO ${role}`);
  await c.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON category, sub_category, employee FROM ${role}`);

  await c.query("COMMIT");
  console.log(`role ${user} siap.\n`);
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(`GAGAL: ${(e as Error).message}`);
  await c.end();
  process.exit(1);
}

// Pembuktian, bukan harapan: hak dibaca ULANG dari database.
const { rows: hak } = await c.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.column_privileges
    WHERE grantee = $1 AND table_name = 'portal_ticket' AND privilege_type = 'INSERT'
    ORDER BY column_name`, [user]);
const daftar = hak.map((r) => r.column_name);
console.log(`INSERT diizinkan pada ${daftar.length} kolom: ${daftar.join(", ")}`);

const bocor = TERLARANG.filter((k) => daftar.includes(k));
console.log(
  bocor.length === 0
    ? `OK  — ${TERLARANG.join(", ")} tidak bisa diisi role ini.\n` +
      `      Tiket buatan portal SELALU lahir berstatus OPEN dan belum ditugaskan.`
    : `⚠️  BOCOR: ${bocor.join(", ")} bisa diisi — tiket bisa lahir dalam keadaan tidak wajar.`,
);

// Hak UBAH dibaca terpisah: yang boleh diisi dan yang boleh diubah memang
// daftar yang berbeda, dan menyatukan cetakannya menyembunyikan bedanya.
const { rows: hakUbah } = await c.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.column_privileges
    WHERE grantee = $1 AND table_name = 'portal_ticket' AND privilege_type = 'UPDATE'
    ORDER BY column_name`, [user]);
const bolehUbah = hakUbah.map((r) => r.column_name);
console.log(`
UPDATE diizinkan pada ${bolehUbah.length} kolom: ${bolehUbah.join(", ")}`);
/**
 * Kolom yang tidak boleh DIUBAH.
 *
 * ⚠️ BERBEDA dari `TERLARANG`, dan bedanya bermakna. `status` tidak boleh
 * DIISI waktu tiket lahir — tiket tidak boleh lahir sudah selesai. Tapi ia
 * harus boleh DIUBAH, karena membatalkan tiket berarti menulis `CANCELLED`
 * ke situ. Memakai satu daftar untuk dua pertanyaan membuat salah satunya
 * dijawab keliru.
 */
const TERLARANG_UBAH = [
  "id_ticket", "no_ticket", "id_employee", "id_category", "id_sub_category",
  "id_technician", "preferred_technician", "assigned_by", "assigned_at",
  "closed_at", "closed_by", "self_closed", "created_at",
];
const bocorUbah = TERLARANG_UBAH.filter((k) => bolehUbah.includes(k));
console.log(
  bocorUbah.length === 0
    ? `OK  — ${TERLARANG_UBAH.length} kolom tidak bisa DIUBAH role ini.
` +
      `      Menyunting tiket tidak bisa menugaskannya, memindahkan kategorinya,
` +
      `      menandainya sudah ditutup, atau mengganti pelapornya.`
    : `⚠️  BOCOR: ${bocorUbah.join(", ")} bisa diubah.`,
);
const kurangUbah = KOLOM_UBAH.filter((k) => !bolehUbah.includes(k));
if (kurangUbah.length > 0) console.log(`⚠️  KURANG: ${kurangUbah.join(", ")} belum diizinkan — penyuntingan akan gagal.`);

const kurang = KOLOM_BUAT.filter((k) => !daftar.includes(k));
if (kurang.length > 0) console.log(`⚠️  KURANG: ${kurang.join(", ")} belum diizinkan — penyimpanan akan gagal.`);

// ⚠️ DIBEDAKAN TINGKAT TABEL DAN TINGKAT KOLOM.
//
// `has_table_privilege(...,'UPDATE')` bernilai false walau UPDATE per kolom
// SUDAH diberikan — ia menjawab "boleh mengubah kolom apa pun?", bukan "boleh
// mengubah sesuatu?". Mencetak "UPDATE: tidak" begitu saja akan membuat
// pembacanya mengira tidak ada hak tulis sama sekali, padahal ada.
console.log(`
hak tingkat TABEL (seluruh kolom sekaligus):`);
for (const t of ["portal_ticket", "category", "sub_category", "employee"]) {
  const { rows } = await c.query<{ u: boolean; d: boolean; kol: number }>(
    `SELECT has_table_privilege($1,$2,'UPDATE') u, has_table_privilege($1,$2,'DELETE') d,
            (SELECT count(*)::int FROM information_schema.column_privileges
              WHERE grantee = $1 AND table_name = $2 AND privilege_type = 'UPDATE') kol`,
    [user, t]);
  const perKolom = rows[0].kol > 0 ? ` (tapi ${rows[0].kol} kolom tertentu: boleh)` : "";
  console.log(
    `  ${t.padEnd(16)} UPDATE: ${rows[0].u ? "⚠️ BISA SEMUA KOLOM" : "tidak"}${perKolom}` +
      `   DELETE: ${rows[0].d ? "⚠️ BISA" : "tidak"}`,
  );
}

await c.end();
process.exitCode =
  bocor.length === 0 && kurang.length === 0 && bocorUbah.length === 0 && kurangUbah.length === 0 ? 0 : 1;
