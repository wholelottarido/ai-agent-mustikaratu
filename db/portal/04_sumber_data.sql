-- ============================================================
-- Simpan sumber data tiap jawaban
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p -e "source db/portal/04_sumber_data.sql"
--
-- Supaya percakapan lama yang dibuka ulang tetap menampilkan tabel apa
-- saja yang dipakai -- bukan cuma percakapan yang sedang berjalan.
--
-- Catatan: MySQL TIDAK punya `ADD COLUMN IF NOT EXISTS` (itu MariaDB),
-- jadi keberadaan kolom diperiksa dulu lewat information_schema supaya
-- script ini aman dijalankan berulang.
-- ============================================================

USE portal;

-- Nama tabel yang dipakai, dipisah koma. Diurai dari SQL yang benar-benar
-- dijalankan, bukan dari klaim agent di teks jawabannya.
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA='portal' AND TABLE_NAME='pesan' AND COLUMN_NAME='sumber');
SET @sql := IF(@ada = 0,
  'ALTER TABLE pesan ADD COLUMN sumber VARCHAR(500) NULL AFTER jumlah_query',
  'SELECT ''kolom sumber sudah ada'' AS catatan');
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- SQL lengkapnya, supaya user bisa memeriksa sendiri angkanya dari mana.
-- Beberapa query dalam satu jawaban dipisah baris kosong.
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA='portal' AND TABLE_NAME='pesan' AND COLUMN_NAME='sql_dipakai');
SET @sql := IF(@ada = 0,
  'ALTER TABLE pesan ADD COLUMN sql_dipakai MEDIUMTEXT NULL AFTER sumber',
  'SELECT ''kolom sql_dipakai sudah ada'' AS catatan');
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

SELECT COLUMN_NAME, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pesan'
 ORDER BY ORDINAL_POSITION;
