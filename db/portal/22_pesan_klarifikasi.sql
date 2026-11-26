-- ============================================================
-- Daftar pilihan produk ikut disimpan
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/22_pesan_klarifikasi.sql"
--
-- Tombol "pilih produk" dibaca dari metadata jawaban, yang tidak tersimpan.
-- Begitu pindah percakapan lalu kembali, tombolnya hilang dan tinggal teks.
-- Dilaporkan 3 Nov 2026. Masalah yang sama dengan 18_pesan_rujukan.sql.
--
-- Grant `portal_app` di tabel ini setingkat TABEL, jadi kolom baru ikut.
-- Aman dijalankan dua kali.
-- ============================================================

USE portal;

SET @sudah := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pesan' AND COLUMN_NAME = 'klarifikasi'
);

SET @perintah := IF(
  @sudah = 0,
  'ALTER TABLE pesan ADD COLUMN klarifikasi TEXT NULL
     COMMENT ''Daftar pilihan produk (JSON) untuk tombol. NULL = tidak ada atau pesan lama.''
     AFTER sop_dipakai',
  'SELECT ''kolom klarifikasi sudah ada, tidak diubah'' AS catatan'
);

PREPARE jalan FROM @perintah;
EXECUTE jalan;
DEALLOCATE PREPARE jalan;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pesan' AND COLUMN_NAME = 'klarifikasi';
