-- ============================================================
-- Database portal: daftar akun & departemennya
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p -e "source db/portal/01_create_portal.sql"
--
-- Database ini TERPISAH dari marketing & hr, dengan user MySQL sendiri.
-- Alasannya: daftar akun bukan data yang boleh ditanyakan lewat chat.
-- User departemen (mkt_readonly, hr_readonly) tidak punya akses ke sini,
-- dan portal_readonly tidak punya akses ke data departemen mana pun.
-- ============================================================

CREATE DATABASE IF NOT EXISTS portal
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE portal;

CREATE TABLE IF NOT EXISTS pengguna (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  -- Format: scrypt:<salt hex>:<hash hex>. JANGAN simpan password polos.
  password_hash VARCHAR(255) NOT NULL,
  nama          VARCHAR(128) NOT NULL,
  -- Harus cocok dengan id departemen di voltagent/departemen/
  departemen    VARCHAR(32)  NOT NULL,
  -- 'staf' | 'kepala'. Menentukan user MySQL mana yang dipakai agent-nya,
  -- mis. hr staf tidak bisa membaca kolom gaji, hr kepala bisa.
  peran         VARCHAR(16)  NOT NULL DEFAULT 'staf',
  aktif         TINYINT(1)   NOT NULL DEFAULT 1,
  dibuat        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_departemen (departemen)
) COMMENT 'Akun portal AI assistant';

-- ------------------------------------------------------------
-- User MySQL untuk aplikasi. SELECT saja, dan HANYA ke database portal.
-- Bikin/ubah akun dilakukan admin lewat SQL, bukan lewat aplikasi --
-- jadi aplikasi tidak perlu izin tulis sama sekali.
-- ------------------------------------------------------------
DROP USER IF EXISTS 'portal_readonly'@'localhost';
CREATE USER 'portal_readonly'@'localhost'
  IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA';

GRANT SELECT ON portal.pengguna TO 'portal_readonly'@'localhost';

ALTER USER 'portal_readonly'@'localhost'
  WITH MAX_QUERIES_PER_HOUR 2000
       MAX_USER_CONNECTIONS 5;

FLUSH PRIVILEGES;

SHOW GRANTS FOR 'portal_readonly'@'localhost';
