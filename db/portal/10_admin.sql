-- ============================================================
-- Admin: penanda + user MySQL untuk route persetujuan
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/10_admin.sql"
--
-- ⚠️ FITUR INI MELANGGAR ATURAN YANG DIPEGANG SEJAK AWAL
--
-- Sampai sebelum ini, TIDAK ADA user MySQL milik aplikasi yang bisa menulis
-- ke tabel `pengguna`. Itu yang membuat celah di kode chat atau bot WhatsApp
-- tidak bisa menyentuh daftar akun.
--
-- Persetujuan admin lewat web menuntut izin itu. Yang bisa dilakukan cuma
-- membatasinya seketat mungkin:
--   * user terpisah (`portal_admin`), dipakai HANYA oleh route admin
--   * TANPA DELETE -- akun bisa dinonaktifkan (`aktif = 0`), tidak bisa
--     dihapus jejaknya
--   * login & chat tetap memakai user read-only seperti sebelumnya
--
-- ⚠️ KENAPA KOLOM SENDIRI, BUKAN peran = 'admin'
--
-- `peran` melekat pada departemen (staf/kepala) dan menentukan user MySQL
-- mana yang dipakai agent. Admin bukan jabatan departemen. Menjejalkannya ke
-- `peran` berarti mengacaukan logika yang sudah diuji 17/17.
-- ============================================================

USE portal;

SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA='portal' AND TABLE_NAME='pengguna' AND COLUMN_NAME='is_admin');
SET @sql := IF(@ada = 0,
  'ALTER TABLE pengguna ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER peran',
  'SELECT ''kolom is_admin sudah ada'' AS catatan');
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- ============================================================
-- User MySQL untuk route admin
-- ============================================================
CREATE USER IF NOT EXISTS 'portal_admin'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA';

-- Tanpa DELETE. Menolak/menonaktifkan cukup lewat UPDATE.
GRANT SELECT, INSERT, UPDATE ON portal.pengguna TO 'portal_admin'@'localhost';
-- Meninjau pengajuan: baca semuanya, lalu tandai sudah diputuskan.
GRANT SELECT, UPDATE ON portal.pendaftaran TO 'portal_admin'@'localhost';

FLUSH PRIVILEGES;

-- ============================================================
-- Admin pertama
-- ============================================================
-- ⚠️ WAJIB lewat root. Kalau admin pertama bisa dibuat dari aplikasi, siapa
-- pun yang menjangkau aplikasi bisa mengangkat dirinya sendiri.
--
-- Ganti 'hr2' kalau mau akun lain yang jadi admin.
UPDATE pengguna SET is_admin = 1 WHERE username = 'hr2';

SELECT username, nama, departemen, peran, is_admin FROM pengguna ORDER BY id;
SHOW GRANTS FOR 'portal_admin'@'localhost';
