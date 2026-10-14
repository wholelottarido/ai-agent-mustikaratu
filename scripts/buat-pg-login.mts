/**
 * Fondasi login akun perusahaan di PostgreSQL (Tahap 10A).
 *
 * ⚠️ MENGUBAH SERVER PERUSAHAAN. Jalankan sadar, dan beri tahu pemegang server.
 *
 *   npm run buat:pg-login
 *
 * Membuat tiga hal:
 *   1. role  `portal_login`          -- khusus login, TERPISAH dari ai_readonly
 *   2. fungsi `cek_login_perusahaan` -- verifikasi password DI DALAM database
 *   3. view  `v_login_profil`        -- daftar profil milik satu akun
 *
 * ============================================================
 * ⚠️ KENAPA ROLE-NYA TERPISAH DARI `ai_readonly`
 * ============================================================
 * Kalau hak menjalankan `cek_login_perusahaan` diberikan ke `ai_readonly`,
 * agent bisa menulis:
 *
 *     SELECT cek_login_perusahaan('budi@mustika-ratu.co.id', 'tebakan1')
 *
 * Penjaga SQL kita memeriksa nama tabel di `FROM`/`JOIN`. Query di atas TIDAK
 * punya `FROM`, jadi akan **lolos** -- dan tool baca-data berubah jadi alat
 * menebak password, dengan model yang bisa mencoba ribuan kali.
 *
 * Dua role terpisah menutup itu sepenuhnya: `ai_readonly` tidak pernah diberi
 * EXECUTE, `portal_login` tidak pernah dipakai agent.
 *
 * ============================================================
 * ⚠️ KENAPA PASSWORD DIVERIFIKASI DI DALAM DATABASE
 * ============================================================
 * Cara biasa (`bcrypt.compare` di Node) mengharuskan aplikasi MEMBACA hash-nya
 * dulu. Artinya portal ini -- yang jalan di laptop -- memegang kemampuan
 * menarik 1.640 hash password karyawan sungguhan. Kalau laptopnya hilang atau
 * portalnya ditembus, semua hash itu bisa dibongkar offline; bcrypt memang
 * lambat, tapi password lemah tetap jebol dalam hitungan jam.
 *
 * Dengan `SECURITY DEFINER` + `pgcrypto`, hash-nya TIDAK PERNAH keluar dari
 * database. Yang kembali cuma satu uuid, atau kosong.
 *
 * `pgcrypto` sudah terpasang di database ini (diperiksa 30 Sep 2026).
 *
 * ============================================================
 * ⚠️ USERNAME KEMBAR DITOLAK, BUKAN DITEBAK
 * ============================================================
 * Ada 3 username yang dipakai dua baris `users` berbeda: `puji.lestari@`,
 * `bilqis.shyalimar@`, dan `magangIT@`. Fungsi SQL biasa akan diam-diam
 * mengembalikan baris pertama -- memilih identitas orang secara acak.
 *
 * Fungsi di bawah mengembalikan uuid HANYA kalau yang cocok tepat satu.
 * Lebih dari satu -> kosong, sama seperti password salah.
 *
 * Membatalkan:
 *   DROP VIEW v_login_profil;
 *   DROP FUNCTION cek_login_perusahaan(text, text);
 *   DROP OWNED BY portal_login; DROP ROLE portal_login;
 */
import { Client } from "pg";

const ROLE = process.env.DEMO_PG_LOGIN_USER ?? "portal_login";

// Nama role ikut disisipkan ke teks SQL (CREATE ROLE tidak menerima parameter
// biasa untuk pengenal), jadi bentuknya dibatasi ketat -- bukan diloloskan
// begitu saja dari env.
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ROLE)) {
  console.log(`⛔ DEMO_PG_LOGIN_USER tidak sah: "${ROLE}". Pakai huruf kecil, angka, garis bawah.`);
  process.exit(1);
}
const PW = process.env.DEMO_PG_LOGIN_PASSWORD;

if (!PW) {
  console.log(
    "⛔ DEMO_PG_LOGIN_PASSWORD belum diisi di .env.local.\n" +
      "   Isi dulu dengan password baru (bebas, panjang), lalu jalankan lagi.\n" +
      "   Passwordnya TIDAK akan ditulis ke berkas mana pun.",
  );
  process.exit(1);
}

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
});
await c.connect();

const [{ current_user: aku, current_database: db }] = (
  await c.query("SELECT current_user, current_database()")
).rows;
console.log(`tersambung: ${aku} @ ${db}\n`);

const langkah = async (nama: string, sql: string, nilai: unknown[] = []) => {
  try {
    await c.query(sql, nilai);
    console.log(`  ok    ${nama}`);
  } catch (e) {
    console.log(`  GAGAL ${nama}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
};

try {
  console.log("--- 1. role khusus login ---");

  // Password dilewatkan lewat set_config lalu disisipkan dengan format('%L'):
  // `CREATE ROLE ... PASSWORD` tidak menerima parameter biasa. Cara ini aman
  // dari penyuntikan DAN tidak memunculkan passwordnya di pg_stat_activity
  // sebagai bagian dari teks perintah. Pola yang sama dipakai
  // `buat-pg-readonly.mts`.
  await c.query("SELECT set_config('portal.loginpw', $1, false)", [PW]);

  const ada = await c.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE]);
  if (ada.rows.length > 0) {
    await langkah(
      `role ${ROLE} sudah ada -> password diperbarui`,
      `DO $do$ BEGIN EXECUTE format(
         'ALTER ROLE ${ROLE} LOGIN PASSWORD %L CONNECTION LIMIT 5',
         current_setting('portal.loginpw')); END $do$`,
    );
  } else {
    await langkah(
      `role ${ROLE} dibuat`,
      `DO $do$ BEGIN EXECUTE format(
         'CREATE ROLE ${ROLE} LOGIN PASSWORD %L CONNECTION LIMIT 5',
         current_setting('portal.loginpw')); END $do$`,
    );
  }

  await langkah(`${ROLE} boleh menyambung`, `GRANT CONNECT ON DATABASE ${quoteIdent(db)} TO ${quoteIdent(ROLE)}`);
  await langkah(`${ROLE} boleh memakai schema public`, `GRANT USAGE ON SCHEMA public TO ${quoteIdent(ROLE)}`);

  console.log("\n--- 2. fungsi verifikasi password ---");
  await langkah(
    "cek_login_perusahaan()",
    `CREATE OR REPLACE FUNCTION cek_login_perusahaan(p_username text, p_password text)
     RETURNS uuid
     LANGUAGE sql
     SECURITY DEFINER
     -- search_path dikunci: tanpa ini, pemanggil bisa membuat tabel "users"
     -- palsu di schema lain dan membajak fungsi yang jalan dengan hak pemilik.
     SET search_path = public, pg_temp
     AS $fn$
       WITH cocok AS (
         SELECT u.id_users
           FROM users u
          WHERE u.username = p_username
            AND u.is_active
            AND u.password = crypt(p_password, u.password)
       )
       -- Tepat satu, atau tidak sama sekali. Username kembar -> kosong.
       SELECT CASE WHEN (SELECT COUNT(*) FROM cocok) = 1
                   THEN (SELECT id_users FROM cocok)
              END
     $fn$`,
  );
  await langkah(
    "cabut hak dari PUBLIC",
    "REVOKE ALL ON FUNCTION cek_login_perusahaan(text, text) FROM PUBLIC",
  );
  await langkah(
    `beri EXECUTE ke ${ROLE} saja`,
    `GRANT EXECUTE ON FUNCTION cek_login_perusahaan(text, text) TO ${quoteIdent(ROLE)}`,
  );

  console.log("\n--- 3. view profil ---");
  // ⚠️ Namanya SENGAJA tidak berawalan `v_asisten_`. Daftar boleh milik agent
  // (`VIEW_BOLEH`) cuma berisi view `v_asisten_*`, jadi view ini otomatis di
  // luar jangkauan agent -- tanpa perlu aturan tambahan.
  await langkah(
    "v_login_profil",
    `CREATE OR REPLACE VIEW v_login_profil AS
       SELECT u.id_users,
              e.id_employee,
              e.fullname                AS nama,
              COALESCE(p.positions, '') AS jabatan,
              COALESCE(d.name, '')      AS departemen
         FROM users u
         JOIN employee e   ON e.id_users = u.id_users
         LEFT JOIN positions  p ON p.id_positions   = e.id_positions
         LEFT JOIN department d ON d.id_department  = e.id_department
        WHERE u.is_active
          AND (e.end_of_work IS NULL OR e.end_of_work > CURRENT_DATE)`,
  );
  await langkah(
    `beri SELECT ke ${ROLE}`,
    `GRANT SELECT ON v_login_profil TO ${quoteIdent(ROLE)}`,
  );

  // ⚠️ CABUT dari role agent -- "tidak diberi" TIDAK CUKUP.
  //
  // `01_readonly.sql` memasang ALTER DEFAULT PRIVILEGES ... ON TABLES untuk
  // ai_readonly. Di PostgreSQL, TABLES di situ berarti RELASI, dan view
  // termasuk relasi -- jadi view ini langsung terbaca ai_readonly begitu
  // dibuat, tanpa GRANT apa pun.
  //
  // Ketahuan `npm run uji:pg-login` (30 Sep 2026); catatan lama di
  // `02_view_asisten.sql` menyatakan sebaliknya dan itu keliru.
  //
  // Isinya bukan kredensial (tidak ada password), dan daftar boleh milik agent
  // tetap menolak nama view ini. Tapi izin tingkat database yang salah tidak
  // dibiarkan cuma karena ada lapis lain yang menahannya.
  await langkah(
    "cabut SELECT dari role agent",
    `REVOKE ALL ON v_login_profil FROM ${quoteIdent(process.env.DEMO_PG_USER ?? "ai_readonly")}`,
  );

  console.log("\n--- 4. bukti ---");
  const p = await c.query("SELECT COUNT(*) n FROM v_login_profil");
  console.log(`  v_login_profil berisi ${p.rows[0].n} profil`);
  const f = await c.query(
    "SELECT cek_login_perusahaan('tidak-ada-akun-ini@contoh.test','salah') IS NULL AS tolak",
  );
  console.log(`  akun karangan ditolak: ${f.rows[0].tolak}`);

  console.log(
    `\n✅ selesai. Isi DEMO_PG_LOGIN_USER=${ROLE} di .env.local kalau belum.` +
      "\n   Uji dengan: npm run uji:pg-login",
  );
} catch {
  console.log("\n⛔ berhenti. Tidak ada yang setengah jadi yang berbahaya:");
  console.log("   role tanpa hak tidak bisa membaca apa pun.");
  process.exitCode = 1;
} finally {
  await c.end();
}

/** Kutip pengenal SQL (nama role/database) dengan aman. */
function quoteIdent(nama: string): string {
  return '"' + String(nama).replace(/"/g, '""') + '"';
}
