-- ============================================================
-- Rujukan sumber jawaban ikut disimpan (Tahap 16D)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/18_pesan_rujukan.sql"
--
-- ⚠️ MASALAH YANG DIPERBAIKI.
--
-- Baris sumber di bawah tiap jawaban dihitung di browser dari hasil tool yang
-- benar-benar dijalankan. Yang tidak pernah disimpan: berapa dokumen dibaca,
-- berapa kali basis pengetahuan dipakai, dan dokumen SOP mana saja.
--
-- Akibatnya begitu percakapan dimuat ulang (refresh, atau pindah room),
-- semuanya kembali ke nol: label berubah jadi "tidak mengambil data dari
-- database" dan tombol PDF-nya hilang — padahal jawabannya memang bersumber.
-- Dilaporkan 1 Okt 2026.
--
-- ⚠️ `ADD COLUMN IF NOT EXISTS` TIDAK ADA di MySQL 8.0.30 (berbeda dengan
-- PostgreSQL). Karena itu dijaga lewat information_schema supaya berkas ini
-- aman dijalankan dua kali.
--
-- ⚠️ Grant `portal_app` untuk tabel ini setingkat TABEL
-- (`GRANT SELECT, INSERT, DELETE ON portal.pesan`), bukan per kolom — jadi
-- kolom baru ikut dengan sendirinya. Beda dengan `portal.pengguna`, yang
-- grant-nya per kolom dan pernah membuat `sumber_akun` gagal diam-diam.
-- ============================================================

USE portal;

SET @sudah := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'portal'
     AND TABLE_NAME   = 'pesan'
     AND COLUMN_NAME  = 'sop_dipakai'
);

SET @perintah := IF(
  @sudah = 0,
  'ALTER TABLE pesan
     ADD COLUMN jumlah_dokumen INT          NULL AFTER jumlah_query,
     ADD COLUMN jumlah_kb      INT          NULL AFTER jumlah_dokumen,
     ADD COLUMN jumlah_tiket   INT          NULL AFTER jumlah_kb,
     ADD COLUMN sop_dipakai    VARCHAR(500) NULL AFTER sumber',
  'SELECT ''kolom rujukan sudah ada, tidak diubah'' AS catatan'
);

PREPARE jalan FROM @perintah;
EXECUTE jalan;
DEALLOCATE PREPARE jalan;

-- NULL berarti "tidak tercatat" (pesan lama), berbeda dari 0 yang berarti
-- "dicatat, dan memang nol". Bedanya penting: pesan lama tidak boleh dilabeli
-- "tidak mengambil data dari database" hanya karena kolomnya belum ada
-- waktu itu.
ALTER TABLE pesan
  MODIFY COLUMN jumlah_dokumen INT NULL
    COMMENT 'Berapa dokumen unggahan dibaca. NULL = pesan lama, tidak tercatat.',
  MODIFY COLUMN jumlah_kb INT NULL
    COMMENT 'Berapa kali cari_sop/daftar_sop dipanggil. NULL = tidak tercatat.',
  MODIFY COLUMN jumlah_tiket INT NULL
    COMMENT 'Berapa kali cari_tiket_serupa dipanggil. NULL = tidak tercatat.',
  MODIFY COLUMN sop_dipakai VARCHAR(500) NULL
    COMMENT 'Kode dokumen SOP dari hasil cari_sop, dipisah koma. Untuk tombol buka PDF.';

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pesan'
   AND COLUMN_NAME IN ('jumlah_dokumen', 'jumlah_kb', 'jumlah_tiket', 'sop_dipakai')
 ORDER BY ORDINAL_POSITION;
