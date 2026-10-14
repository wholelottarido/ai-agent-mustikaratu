-- ============================================================
-- Pengajuan akun baru (menunggu persetujuan admin)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/09_pendaftaran.sql"
--
-- ⚠️ TABEL TERPISAH, BUKAN BARIS DI `pengguna` DENGAN STATUS "MENUNGGU"
--
-- Kalau pengajuan ditaruh di `pengguna`, halaman pendaftaran butuh izin INSERT
-- ke tabel daftar akun. Di tabel sendiri, izin tulisnya berhenti di sini --
-- celah di halaman pendaftaran tidak bisa menyentuh akun yang sudah sah.
--
-- Perpindahan ke `pengguna` HANYA terjadi lewat route admin, yang memakai user
-- MySQL berbeda lagi (`portal_admin`).
-- ============================================================

USE portal;

-- ⚠️ COLLATION DISAMAKAN dengan tabel lama (`pengguna`, `percakapan`, `pesan`)
-- yang memakai utf8mb4_unicode_ci. Bawaan MySQL 8 adalah utf8mb4_0900_ai_ci,
-- dan membandingkan kolom teks antar dua collation itu GAGAL saat dijalankan:
--   Illegal mix of collations ... for operation '='
-- Lolos typecheck, lolos CREATE TABLE, baru meledak waktu ada JOIN/EXISTS.
CREATE TABLE IF NOT EXISTS pendaftaran (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nama          VARCHAR(128) NOT NULL,
  nomor_wa      VARCHAR(20)  NULL,

  -- DIMINTA, bukan ditetapkan. Admin yang memutuskan departemen & peran
  -- sebenarnya -- peran menentukan user MySQL, dan itu yang memisahkan siapa
  -- boleh melihat gaji.
  departemen_diminta VARCHAR(32) NOT NULL,
  alasan        VARCHAR(255) NULL,

  status        ENUM('menunggu','disetujui','ditolak') NOT NULL DEFAULT 'menunggu',
  -- Catatan admin saat menolak, supaya keputusannya bisa ditelusuri.
  catatan       VARCHAR(255) NULL,

  -- Untuk pembatas per IP. Halaman daftar terbuka tanpa login, jadi tanpa ini
  -- tabelnya bisa dibanjiri skrip sampai penuh.
  ip            VARCHAR(45)  NULL,

  dibuat        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  diputuskan    DATETIME     NULL,
  -- Siapa admin yang memutuskan. NULL selama masih menunggu.
  oleh          INT          NULL,

  PRIMARY KEY (id),
  KEY idx_status (status, dibuat),
  KEY idx_ip (ip, dibuat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- User khusus halaman pendaftaran
-- ============================================================
-- Izinnya sesempit mungkin: cuma boleh MENAMBAH pengajuan.
CREATE USER IF NOT EXISTS 'portal_daftar'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA';

GRANT INSERT ON portal.pendaftaran TO 'portal_daftar'@'localhost';

-- ⚠️ SELECT DIBATASI PER KOLOM, bukan seluruh tabel.
--
-- Pembatas per IP butuh menghitung pengajuan terakhir dari IP yang sama --
-- itu cuma perlu `ip` dan `dibuat`. Kalau diberi SELECT seluruh tabel, user
-- ini bisa membaca `password_hash` semua pendaftar yang sedang menunggu.
GRANT SELECT (id, ip, dibuat) ON portal.pendaftaran TO 'portal_daftar'@'localhost';

FLUSH PRIVILEGES;

SELECT 'tabel pendaftaran siap' AS status;
SHOW GRANTS FOR 'portal_daftar'@'localhost';
