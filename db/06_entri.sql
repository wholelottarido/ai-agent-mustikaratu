-- ============================================================
-- Izin tulis untuk entri penjualan + jejak audit
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p marketing -e "source db/06_entri.sql"
--
-- ⚠️ INI MEMBALIK PRINSIP YANG MENOPANG SELURUH SISTEM.
--
-- Sampai sekarang TIDAK ADA user MySQL departemen yang bisa menulis: semuanya
-- `SELECT` saja, dan `sql-guard.ts` menolak INSERT/UPDATE/DELETE. Itu yang
-- membuat salah tafsir agent cuma berakibat jawaban keliru, bukan data rusak.
--
-- Entri data menuntut izin tulis. Yang bisa dilakukan cuma mengurungnya:
--   * user terpisah `mkt_entry`, dipakai HANYA oleh `lib/entri/simpan.ts`
--   * cuma 2 tabel data + 1 tabel audit -- tidak menyentuh 20 tabel lainnya
--   * TANPA UPDATE, TANPA DELETE
--   * agent tidak punya tool apa pun yang memakai user ini
--
-- ⚠️ TANPA UPDATE & DELETE ITU DISENGAJA.
--
-- Artinya salah entri TIDAK bisa diperbaiki lewat aplikasi -- harus lewat root.
-- Merepotkan, dan memang begitu maksudnya: memberi aplikasi izin mengubah atau
-- menghapus data penjualan sejak hari pertama jauh lebih berisiko daripada
-- sesekali membetulkan manual. Koreksi jadi tahap tersendiri, dengan caranya
-- sendiri (pembatalan lewat baris baru, bukan menimpa yang lama).
-- ============================================================

USE marketing;

-- ============================================================
-- Jejak audit
-- ============================================================
-- ⚠️ DI DATABASE `marketing`, BUKAN `portal`.
--
-- Supaya baris data dan jejaknya ditulis dalam SATU transaksi. Kalau auditnya
-- di database lain, bisa terjadi penjualan masuk tapi jejaknya gagal tercatat
-- -- dan data tanpa jejak justru yang paling sulit ditelusuri saat bermasalah.
CREATE TABLE IF NOT EXISTS entri_log (
  id          BIGINT       NOT NULL AUTO_INCREMENT,

  entitas     VARCHAR(32)  NOT NULL COMMENT 'tabel yang diisi, mis. sales_order',
  ref_id      INT          NOT NULL COMMENT 'id baris yang dibuat',
  ref_kode    VARCHAR(32)  NULL     COMMENT 'no_order, untuk dicari manusia',

  -- Identitas pengguna DISALIN, tidak direlasikan. `pengguna` ada di database
  -- `portal`, dan MySQL tidak bisa memasang foreign key antar database.
  -- Menyalin username juga berarti jejaknya tetap terbaca kalau akunnya
  -- dihapus -- dan justru saat itulah jejak paling dibutuhkan.
  pengguna_id INT          NOT NULL,
  username    VARCHAR(64)  NOT NULL,
  departemen  VARCHAR(32)  NOT NULL,
  peran       VARCHAR(16)  NOT NULL,
  asal        ENUM('web','wa') NOT NULL,

  permintaan  TEXT         NULL COMMENT 'kalimat asli user',
  ringkasan   TEXT         NULL COMMENT 'draf yang dikonfirmasi',

  dibuat      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_ref (entitas, ref_id),
  KEY idx_pengguna (pengguna_id, dibuat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- User penulis
-- ============================================================
CREATE USER IF NOT EXISTS 'mkt_entry'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA'
  WITH MAX_QUERIES_PER_HOUR 2000 MAX_USER_CONNECTIONS 6;

-- SELECT diperlukan: nomor order berikutnya dihitung dari yang sudah ada, dan
-- transaksinya membaca ulang sebelum menulis. Ini BUKAN pelonggaran -- data
-- yang sama sudah bisa dibaca `mkt_readonly`. Yang membatasi adalah tidak
-- adanya UPDATE dan DELETE.
GRANT SELECT, INSERT ON marketing.sales_order      TO 'mkt_entry'@'localhost';
GRANT SELECT, INSERT ON marketing.sales_order_line TO 'mkt_entry'@'localhost';
GRANT SELECT, INSERT ON marketing.entri_log        TO 'mkt_entry'@'localhost';

-- Menyusun draf butuh baca produk & pelanggan. Dibatasi kolom seperlunya.
GRANT SELECT (id, kode, nama)        ON marketing.customer TO 'mkt_entry'@'localhost';
GRANT SELECT (id, nama, harga)       ON marketing.produk   TO 'mkt_entry'@'localhost';

FLUSH PRIVILEGES;

SELECT 'mkt_entry siap' AS status;
SHOW GRANTS FOR 'mkt_entry'@'localhost';
