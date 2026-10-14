-- ============================================================
-- Kode verifikasi untuk menautkan WhatsApp sendiri
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/11_wa_kode.sql"
--
-- Alur: user login di web -> dapat kode 6 digit -> kirim kode itu dari
-- WhatsApp-nya -> bot menautkan LID pengirim ke akunnya.
--
-- Kode itu membuktikan DUA hal sekaligus: dia memegang akunnya (bisa login)
-- dan dia memegang WhatsApp itu (bisa mengirim dari sana). Mencocokkan nomor
-- yang diketik sendiri saat mendaftar tidak membuktikan apa pun -- orang bisa
-- mengetik nomor atasannya.
-- ============================================================

USE portal;

-- ⚠️ COLLATION DISAMAKAN dengan tabel lama. Lihat catatan di 09_pendaftaran.sql.
CREATE TABLE IF NOT EXISTS wa_kode (
  kode        CHAR(6)  NOT NULL,
  pengguna_id INT      NOT NULL,
  kedaluwarsa DATETIME NOT NULL,
  dibuat      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (kode),
  -- Satu orang cuma boleh punya satu kode aktif. Meminta kode baru menimpa
  -- yang lama, jadi kode lama otomatis mati.
  UNIQUE KEY uq_pengguna (pengguna_id),

  CONSTRAINT fk_kode_pengguna FOREIGN KEY (pengguna_id)
    REFERENCES pengguna(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Izin
-- ============================================================
-- Web membuat kode, bot membaca & menghapusnya setelah dipakai. Keduanya
-- memakai `portal_app`.
--
-- DELETE diberikan DI TABEL INI SAJA. Kode sekali pakai memang harus hilang
-- setelah dipakai, dan tabel ini tidak menyimpan apa pun yang perlu diaudit --
-- yang jadi catatan permanen adalah barisnya di `wa_tautan`.
GRANT SELECT, INSERT, UPDATE, DELETE ON portal.wa_kode TO 'portal_app'@'localhost';

-- ⚠️ INI MELONGGARKAN ATURAN DI 05_wa_tautan.sql
--
-- Di sana tertulis `wa_tautan` hanya boleh diubah admin lewat root, karena dia
-- menentukan IDENTITAS. Penautan mandiri menuntut aplikasi bisa menambah baris
-- ke situ.
--
-- Dibatasi seketat mungkin:
--   * INSERT + SELECT saja -- TANPA UPDATE, TANPA DELETE. Tautan yang sudah
--     ada tidak bisa dibelokkan ke akun lain, dan memutus tautan tetap
--     urusan admin.
--     (SELECT dibutuhkan halaman /whatsapp untuk menampilkan status, dan itu
--      bukan peningkatan hak: modul yang sama sudah bisa membaca seluruh isi
--      percakapan.)
--   * `UNIQUE KEY uq_pengguna` di `wa_tautan` berarti akun yang SUDAH tertaut
--     tidak bisa ditautkan ulang -- INSERT-nya akan gagal.
--   * Penambahan cuma terjadi kalau ada kode sah yang belum kedaluwarsa.
GRANT SELECT, INSERT ON portal.wa_tautan TO 'portal_app'@'localhost';

FLUSH PRIVILEGES;

SELECT 'tabel wa_kode siap' AS status;
SHOW GRANTS FOR 'portal_app'@'localhost';
