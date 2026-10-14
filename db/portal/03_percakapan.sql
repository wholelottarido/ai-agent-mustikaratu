-- ============================================================
-- Riwayat percakapan
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p -e "source db/portal/03_percakapan.sql"
--
-- Ini PERTAMA KALINYA aplikasi butuh izin TULIS. Sampai sekarang semua
-- user MySQL read-only. Karena itu dibuat user terpisah `portal_app`:
--   - boleh tulis HANYA ke dua tabel di bawah
--   - TIDAK punya akses ke tabel `pengguna` (login tetap pakai portal_readonly)
--   - TIDAK punya akses ke database departemen mana pun
-- Jadi kalau ada celah di kode percakapan, daftar akun tetap aman.
-- ============================================================

USE portal;

CREATE TABLE IF NOT EXISTS percakapan (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  pengguna_id INT          NOT NULL,
  -- Departemen ikut disimpan: kalau suatu saat departemen seorang user diubah,
  -- percakapan lamanya tidak ikut muncul di departemen yang baru.
  departemen  VARCHAR(32)  NOT NULL,
  judul       VARCHAR(160) NOT NULL,
  dibuat      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  diperbarui  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pemilik (pengguna_id, departemen, diperbarui DESC),
  CONSTRAINT fk_percakapan_pengguna FOREIGN KEY (pengguna_id)
    REFERENCES pengguna(id) ON DELETE CASCADE
) COMMENT 'Satu sesi tanya-jawab dengan agent';

CREATE TABLE IF NOT EXISTS pesan (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  percakapan_id BIGINT      NOT NULL,
  peran         ENUM('user','assistant') NOT NULL,
  -- HANYA teksnya. Hasil mentah tool (bisa 200 baris) sengaja TIDAK disimpan:
  -- ukurannya besar, dan untuk ditampilkan ulang tidak diperlukan.
  teks          MEDIUMTEXT  NOT NULL,
  -- Metadata jawaban, supaya baris info di UI tetap muncul setelah dimuat ulang.
  model         VARCHAR(64)  NULL,
  detik         DECIMAL(6,1) NULL,
  jumlah_query  INT          NULL,
  dibuat        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_percakapan (percakapan_id, id),
  CONSTRAINT fk_pesan_percakapan FOREIGN KEY (percakapan_id)
    REFERENCES percakapan(id) ON DELETE CASCADE
) COMMENT 'Isi percakapan, teks saja';

-- ------------------------------------------------------------
-- User aplikasi untuk percakapan. Satu-satunya user yang boleh MENULIS.
-- ------------------------------------------------------------
DROP USER IF EXISTS 'portal_app'@'localhost';
CREATE USER 'portal_app'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA';

GRANT SELECT, INSERT, UPDATE, DELETE ON portal.percakapan TO 'portal_app'@'localhost';
GRANT SELECT, INSERT, DELETE         ON portal.pesan      TO 'portal_app'@'localhost';
-- portal.pengguna SENGAJA tidak diberikan.

ALTER USER 'portal_app'@'localhost'
  -- 12, bukan 5. `portal_app` dipakai DUA PROSES (web + bot WhatsApp), dan
  -- tiap proses memegang pool sendiri. Batas 5 kehabisan begitu keduanya
  -- aktif -- gejalanya `ER_USER_LIMIT_REACHED`, yang muncul belakangan dan
  -- tidak menunjuk ke penyebabnya. Lihat juga `lib/db-portal.ts`.
  WITH MAX_QUERIES_PER_HOUR 5000 MAX_USER_CONNECTIONS 12;

FLUSH PRIVILEGES;

SHOW GRANTS FOR 'portal_app'@'localhost';
