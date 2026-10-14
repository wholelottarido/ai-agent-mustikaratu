-- ============================================================
-- Catatan pemakaian model + dasar pembatasan kuota
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/07_pemakaian.sql"
--
-- ⚠️ KENAPA DI DATABASE, BUKAN DI MEMORI
--
-- Web (port 3018) dan bot WhatsApp adalah DUA PROSES TERPISAH. Pembatas di
-- memori berarti satu orang dapat jatah sendiri-sendiri di tiap saluran --
-- dan semuanya hangus tiap restart.
--
-- Beda dengan `lib/batas-login.ts` yang memang cukup di memori: di sana yang
-- dijaga serangan tebak password dalam hitungan detik, bukan biaya yang
-- menumpuk sepanjang hari.
--
-- ⚠️ KENAPA ADA KOLOM `berbayar`
--
-- Model lokal (Ollama) tidak memakai kredit API sama sekali, jadi tidak ada
-- alasan membatasinya. Tapi pemakaiannya tetap DICATAT supaya kelihatan siapa
-- memakai apa. Yang dihitung ke kuota hanya baris `berbayar = 1`.
-- ============================================================

USE portal;

-- ⚠️ COLLATION DISAMAKAN dengan tabel lama (`pengguna`, `percakapan`, `pesan`)
-- yang memakai utf8mb4_unicode_ci. Bawaan MySQL 8 adalah utf8mb4_0900_ai_ci,
-- dan membandingkan kolom teks antar dua collation itu GAGAL saat dijalankan:
--   Illegal mix of collations ... for operation '='
-- Lolos typecheck, lolos CREATE TABLE, baru meledak waktu ada JOIN/EXISTS.
CREATE TABLE IF NOT EXISTS pemakaian (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  pengguna_id  INT          NOT NULL,
  asal         ENUM('web','wa') NOT NULL,
  model        VARCHAR(64)  NOT NULL,
  -- 1 = pakai kredit API (Claude), 0 = model lokal (gratis).
  berbayar     TINYINT(1)   NOT NULL DEFAULT 1,

  -- Diisi SETELAH jawaban selesai. NULL berarti permintaannya gagal di
  -- tengah jalan -- itu tetap dihitung ke kuota, supaya orang tidak bisa
  -- memaksa error berulang kali tanpa batas.
  token_masuk  INT          NULL,
  token_keluar INT          NULL,
  token_cache  INT          NULL,

  dibuat       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  -- Indeks mengikuti bentuk query kuota persis: pengguna + berbayar + waktu.
  KEY idx_kuota (pengguna_id, berbayar, dibuat),

  CONSTRAINT fk_pakai_pengguna FOREIGN KEY (pengguna_id)
    REFERENCES pengguna(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `portal_app` sudah jadi satu-satunya user dengan izin tulis di aplikasi ini,
-- dan izinnya tetap tidak menyentuh tabel `pengguna` maupun database
-- departemen mana pun. UPDATE dibutuhkan untuk mengisi jumlah token setelah
-- jawaban selesai.
GRANT SELECT, INSERT, UPDATE ON portal.pemakaian TO 'portal_app'@'localhost';

-- `portal_readonly` cukup BACA. Dia butuh ini karena:
--   1. Laporan `npm run pemakaian` menggabungkan tabel ini dengan `pengguna`,
--      dan `portal_app` sengaja TIDAK bisa membaca `pengguna`.
--   2. Nanti web bisa menampilkan sisa kuota ke user tanpa izin tulis apa pun.
GRANT SELECT ON portal.pemakaian TO 'portal_readonly'@'localhost';
FLUSH PRIVILEGES;

SELECT 'tabel pemakaian siap' AS status;
SHOW GRANTS FOR 'portal_app'@'localhost';
