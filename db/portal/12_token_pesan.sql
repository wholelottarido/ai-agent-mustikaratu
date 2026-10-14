-- ============================================================
-- Jumlah token per jawaban, supaya ikut terlihat saat percakapan dibuka ulang
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/12_token_pesan.sql"
--
-- Token sudah dicatat di tabel `pemakaian` untuk keperluan kuota & biaya.
-- Kolom ini TUJUANNYA BEDA: menampilkannya di bawah tiap jawaban, termasuk
-- percakapan lama. Menggabungkannya lewat `pemakaian` tidak bisa -- tabel itu
-- tidak tahu baris `pesan` yang mana, dan `portal_app` memang tidak boleh
-- menghubungkan keduanya ke `pengguna`.
--
-- Catatan: MySQL TIDAK punya `ADD COLUMN IF NOT EXISTS` (itu MariaDB).
-- ============================================================

USE portal;

SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA='portal' AND TABLE_NAME='pesan' AND COLUMN_NAME='token_masuk');
SET @sql := IF(@ada = 0,
  'ALTER TABLE pesan ADD COLUMN token_masuk INT NULL AFTER jumlah_query',
  'SELECT ''kolom token_masuk sudah ada'' AS catatan');
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA='portal' AND TABLE_NAME='pesan' AND COLUMN_NAME='token_keluar');
SET @sql := IF(@ada = 0,
  'ALTER TABLE pesan ADD COLUMN token_keluar INT NULL AFTER token_masuk',
  'SELECT ''kolom token_keluar sudah ada'' AS catatan');
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

SELECT COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='portal' AND TABLE_NAME='pesan' ORDER BY ORDINAL_POSITION;
