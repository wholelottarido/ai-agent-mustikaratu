-- ============================================================
-- Pembatalan entri (Tahap 3a)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p marketing -e "source db/07_batal.sql"
--
-- Lanjutan dari `06_entri.sql`, yang sengaja TIDAK memberi UPDATE maupun
-- DELETE. Akibatnya salah entri cuma bisa dibetulkan lewat root -- dan root
-- tidak lewat `entri_log`, jadi justru penghapusan (hal yang paling perlu
-- ditelusuri) tidak tercatat di mana pun.
--
-- ⚠️ YANG DIBUKA DI SINI SEKECIL MUNGKIN: UPDATE pada SATU KOLOM.
--
-- Bukan DELETE, dan bukan UPDATE seluruh tabel. Alasannya:
--
--   1. `CANCELLED` sudah dikenal skema (106 baris sebelum tahap ini),
--      jadi tidak ada nilai status karangan.
--   2. Semua view laporan menarik dari `v_penjualan`, dan `v_penjualan`
--      memfilter `status = 'COMPLETED'`. Satu flip status membuat order
--      hilang dari SELURUH laporan -- tanpa menyentuh satu view pun.
--   3. Barisnya tetap ada, jadi masih bisa ditelusuri: siapa yang entri,
--      siapa yang membatalkan, kapan, dan kenapa.
--   4. DELETE butuh `GRANT DELETE`, yang berlaku untuk SEMUA baris di tabel
--      itu -- termasuk 1.783 order lama yang bukan urusan aplikasi ini.
--
-- ⚠️ `UPDATE (status)` TIDAK membuat qty, harga, atau pelanggan bisa diubah.
-- Itu disengaja: koreksi dikerjakan sebagai BATAL + ENTRI ULANG, bukan edit.
-- Edit sungguhan menuntut UPDATE ke banyak kolom dan ke `sales_order_line`,
-- yang mengembalikan seluruh risiko yang ditutup di `06_entri.sql`.
--
-- Aturan siapa yang boleh membatalkan TIDAK ada di sini -- MySQL tidak tahu
-- siapa yang login di aplikasi. Yang dijaga di sini cuma SEBERAPA LUAS
-- kerusakan yang mungkin terjadi. Aturannya ada di `lib/entri/batal.ts`:
--
--   * cuma pengguna yang mengentri yang boleh membatalkan
--   * paling lama 2 jam sejak `entri_log.dibuat`
--   * alasan wajib diisi
--   * order yang sudah CANCELLED ditolak
--
-- Efek samping yang menguntungkan: 1.783 order lama tidak punya baris
-- `entri_log`, jadi pemeriksaan kepemilikan membuatnya OTOMATIS tidak bisa
-- dibatalkan lewat aplikasi. Data seed aman tanpa aturan tambahan.
-- ============================================================

USE marketing;

-- ============================================================
-- 1. Kolom baru di jejak audit
-- ============================================================
-- Satu pembatalan = SATU BARIS BARU di `entri_log`, bukan menimpa baris entri
-- aslinya. Jadi jejaknya berpasangan: ENTRI lalu BATAL, dua-duanya utuh.
--
-- ⚠️ MySQL TIDAK punya `ADD COLUMN IF NOT EXISTS` -- itu milik MariaDB.
-- Tanpa penjagaan di bawah, file ini gagal total waktu dijalankan ulang.

SET @ada_aksi := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'marketing' AND TABLE_NAME = 'entri_log'
     AND COLUMN_NAME = 'aksi'
);
SET @sql := IF(@ada_aksi = 0,
  "ALTER TABLE entri_log
     ADD COLUMN aksi ENUM('ENTRI','BATAL') NOT NULL DEFAULT 'ENTRI'
         COMMENT 'ENTRI = baris dibuat, BATAL = baris dibatalkan'
         AFTER entitas",
  "SELECT 'kolom aksi sudah ada, dilewati' AS info");
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- Baris lama otomatis dapat 'ENTRI' lewat DEFAULT -- dan itu memang benar:
-- semua yang tercatat sebelum tahap ini adalah entri.

SET @ada_alasan := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'marketing' AND TABLE_NAME = 'entri_log'
     AND COLUMN_NAME = 'alasan'
);
SET @sql := IF(@ada_alasan = 0,
  "ALTER TABLE entri_log
     ADD COLUMN alasan VARCHAR(255) NULL
         COMMENT 'alasan pembatalan, WAJIB diisi user -- bukan dikarang model'
         AFTER permintaan",
  "SELECT 'kolom alasan sudah ada, dilewati' AS info");
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- ============================================================
-- 2. Izin membatalkan
-- ============================================================
-- Kolomnya disebut eksplisit. `GRANT UPDATE ON marketing.sales_order` tanpa
-- kurung memberi izin ke SEMUA kolom -- termasuk `customer_id` dan `tanggal`.
GRANT UPDATE (status) ON marketing.sales_order TO 'mkt_entry'@'localhost';

FLUSH PRIVILEGES;

-- ============================================================
-- 3. Yang harus terlihat setelah ini
-- ============================================================
SELECT 'mkt_entry bisa membatalkan' AS status;
SHOW GRANTS FOR 'mkt_entry'@'localhost';

-- Harus muncul baris:
--   GRANT SELECT, INSERT, UPDATE (`status`) ON `marketing`.`sales_order` ...
--
-- Kalau yang muncul `UPDATE` tanpa `(status)`, izinnya KELEBARAN -- cabut
-- dengan `REVOKE UPDATE ON marketing.sales_order FROM 'mkt_entry'@'localhost'`
-- lalu jalankan ulang file ini.

SHOW COLUMNS FROM entri_log;
