-- ============================================================
-- Tandai percakapan itu datang dari mana: web atau WhatsApp
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p -e "source db/portal/06_asal_percakapan.sql"
--
-- Sejak bot WhatsApp ada, percakapan dari dua saluran bercampur di daftar
-- yang sama di web. Tanpa penanda, user melihat percakapan yang tidak dia
-- ingat pernah dibuka di browser dan mengira itu kebocoran -- padahal itu
-- chat WhatsApp-nya sendiri.
--
-- Catatan: MySQL TIDAK punya `ADD COLUMN IF NOT EXISTS` (itu MariaDB),
-- jadi keberadaan kolom diperiksa dulu lewat information_schema supaya
-- script ini aman dijalankan berulang.
-- ============================================================

USE portal;

-- Default 'web' supaya semua baris lama tetap benar tanpa perlu di-update.
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA='portal' AND TABLE_NAME='percakapan' AND COLUMN_NAME='asal');
SET @sql := IF(@ada = 0,
  'ALTER TABLE percakapan ADD COLUMN asal ENUM(''web'',''wa'') NOT NULL DEFAULT ''web'' AFTER departemen',
  'SELECT ''kolom asal sudah ada'' AS catatan');
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'percakapan'
 ORDER BY ORDINAL_POSITION;

SELECT asal, COUNT(*) AS jumlah FROM percakapan GROUP BY asal;
