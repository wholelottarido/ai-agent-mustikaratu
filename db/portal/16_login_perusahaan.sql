-- ============================================================
-- Login akun perusahaan — perubahan skema portal (Tahap 10B-2)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/16_login_perusahaan.sql"
--
-- Sisi PostgreSQL-nya sudah dibuat `npm run buat:pg-login` (role portal_login,
-- fungsi cek_login_perusahaan, view v_login_profil).
--
-- ⚠️ MySQL tidak punya `ADD COLUMN IF NOT EXISTS` (itu MariaDB). Jadi tiap
-- perubahan dijaga dengan information_schema + PREPARE, sama seperti
-- `14_kaitan_karyawan.sql`. Berkas ini aman dijalankan berkali-kali.
-- ============================================================

USE portal;

-- ============================================================
-- 1. password_hash boleh NULL
-- ============================================================
-- ⚠️ Portal TIDAK menyimpan password akun perusahaan, sama sekali.
--
-- Verifikasinya selalu balik ke `cek_login_perusahaan()` di PostgreSQL, dan
-- hash-nya tidak pernah keluar dari sana. Menyalin hash ke sini berarti
-- portal yang jalan di laptop ikut memegang kredensial karyawan sungguhan —
-- persis yang dihindari seluruh rancangan ini.
--
-- Akibat bagusnya: karyawan ganti password di sistem mereka, portal ikut
-- otomatis. Tidak ada yang perlu disinkronkan.
SET @nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pengguna'
                     AND COLUMN_NAME = 'password_hash');
SET @sql := IF(@nullable = 'NO',
  "ALTER TABLE pengguna MODIFY password_hash VARCHAR(255) NULL
     COMMENT 'NULL = akun perusahaan, passwordnya diverifikasi di PostgreSQL'",
  "SELECT 'password_hash sudah boleh NULL, dilewati' AS info");
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- ============================================================
-- 2. Kolom sumber_akun
-- ============================================================
-- Membedakan akun yang dibuat admin portal dari akun yang datang lewat login
-- perusahaan. Perlu karena keduanya diperlakukan berbeda:
--   'portal'     -> punya password_hash sendiri, diubah lewat /admin
--   'perusahaan' -> password_hash NULL, departemen & peran ikut database
--                   perusahaan dan DIPERBARUI tiap login
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pengguna'
                AND COLUMN_NAME = 'sumber_akun');
SET @sql := IF(@ada = 0,
  "ALTER TABLE pengguna
     ADD COLUMN sumber_akun VARCHAR(16) NOT NULL DEFAULT 'portal'
       COMMENT 'portal = dibuat admin; perusahaan = login SSO perusahaan'
       AFTER id_employee",
  "SELECT 'kolom sumber_akun sudah ada, dilewati' AS info");
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- ============================================================
-- 3. Jejak audit: siapa memilih profil siapa
-- ============================================================
-- ⚠️ INI SATU-SATUNYA CARA TAHU SIAPA MENGAKU SIAPA.
--
-- Akun email dipakai bersama — `unregisted@mustika-ratu.co.id` menempel pada
-- 307 karyawan — dan itu bawaan sistem perusahaan yang tidak bisa kita ubah.
-- Artinya orang yang tahu satu password bersama bisa memilih profil siapa pun
-- di antara 307 nama itu.
--
-- Kita tidak memperlebar lubang itu (orang yang sama bisa melakukan hal
-- persis sama di portal perusahaan sendiri), tapi kita juga tidak boleh diam
-- saja. Tabel ini mencatat tiap pemilihan, supaya kalau ada yang aneh,
-- jejaknya ada.
CREATE TABLE IF NOT EXISTS login_perusahaan_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(190) NOT NULL COMMENT 'username/email akun perusahaan',
  id_users      CHAR(36)     NOT NULL COMMENT 'uuid users di db perusahaan',
  id_employee   CHAR(36)     NOT NULL COMMENT 'profil yang DIPILIH',
  nama          VARCHAR(190) NOT NULL,
  departemen    VARCHAR(64)  NOT NULL COMMENT 'nama asli dari db perusahaan',
  peran         VARCHAR(16)  NOT NULL,
  jml_profil    INT          NOT NULL COMMENT 'berapa profil yang tersedia saat itu',
  ip            VARCHAR(45)  NULL,
  waktu         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_waktu (waktu),
  KEY idx_employee (id_employee),
  KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 4. Izin
-- ============================================================
-- ⚠️ JANGAN DILEWATI: `portal_readonly` punya grant PER KOLOM.
--
-- Lihat `SHOW GRANTS FOR portal_readonly`: izinnya menyebut kolom satu per
-- satu. Kolom BARU tidak otomatis ikut. Tanpa baris di bawah, `sumber_akun`
-- ada di tabel tapi tidak terbaca aplikasi — dan gagalnya diam, bukan error
-- yang jelas: setiap akun akan terbaca seolah bersumber 'portal'.
GRANT SELECT (sumber_akun) ON portal.pengguna TO 'portal_readonly'@'localhost';

-- portal_admin sudah membuat baris `pengguna` waktu pendaftaran disetujui
-- (`lib/admin.ts`). Jalur login perusahaan menumpang user yang sama, bukan
-- membuat user MySQL baru — membuat/menyunting akun memang tugasnya.
GRANT INSERT, UPDATE ON portal.pengguna TO 'portal_admin'@'localhost';
GRANT INSERT, SELECT ON portal.login_perusahaan_log TO 'portal_admin'@'localhost';
GRANT SELECT ON portal.login_perusahaan_log TO 'portal_readonly'@'localhost';

FLUSH PRIVILEGES;

-- ============================================================
-- Bukti
-- ============================================================
SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pengguna'
   AND COLUMN_NAME IN ('password_hash', 'sumber_akun', 'id_employee')
 ORDER BY ORDINAL_POSITION;

SELECT COUNT(*) AS baris_audit FROM login_perusahaan_log;
