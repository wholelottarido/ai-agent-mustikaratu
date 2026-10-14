-- ============================================================
-- Preferensi pengguna untuk bot WhatsApp
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/08_wa_preferensi.sql"
--
-- ⚠️ KENAPA TABEL SENDIRI, BUKAN KOLOM DI `wa_tautan`
--
-- Bukan soal kerapian. `wa_tautan` menentukan IDENTITAS -- nomor WhatsApp ini
-- milik akun yang mana, dan karena itu peran & user MySQL mana yang dipakai.
-- Tabel itu hanya boleh diubah admin lewat root.
--
-- Preferensi model boleh diubah user sendiri lewat `/model`, jadi bot butuh
-- izin tulis. Kalau digabung, bot terpaksa diberi izin tulis ke tabel yang
-- menentukan siapa boleh melihat gaji.
--
-- ⚠️ NILAINYA TIDAK DIPERCAYA MENTAH
--
-- Kolom ini cuma menyimpan apa yang pernah dipilih. Saat dipakai, id-nya tetap
-- lewat `ambilModel()` yang memvalidasi ke whitelist -- sama seperti dropdown
-- di web. Jadi model yang dihapus dari whitelist otomatis jatuh ke default,
-- tanpa perlu membersihkan tabel ini.
-- ============================================================

USE portal;

-- ⚠️ COLLATION DISAMAKAN dengan tabel lama (`pengguna`, `percakapan`, `pesan`)
-- yang memakai utf8mb4_unicode_ci. Bawaan MySQL 8 adalah utf8mb4_0900_ai_ci,
-- dan membandingkan kolom teks antar dua collation itu GAGAL saat dijalankan:
--   Illegal mix of collations ... for operation '='
-- Lolos typecheck, lolos CREATE TABLE, baru meledak waktu ada JOIN/EXISTS.
CREATE TABLE IF NOT EXISTS wa_preferensi (
  pengguna_id INT          NOT NULL,
  model       VARCHAR(64)  NOT NULL,
  diperbarui  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (pengguna_id),
  CONSTRAINT fk_pref_pengguna FOREIGN KEY (pengguna_id)
    REFERENCES pengguna(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bot menulis lewat `portal_app` -- user yang sama dengan percakapan &
-- pemakaian. Izinnya tetap tidak menyentuh `pengguna` maupun `wa_tautan`.
GRANT SELECT, INSERT, UPDATE ON portal.wa_preferensi TO 'portal_app'@'localhost';

-- `portal_readonly` cukup baca, untuk laporan/tampilan.
GRANT SELECT ON portal.wa_preferensi TO 'portal_readonly'@'localhost';
FLUSH PRIVILEGES;

SELECT 'tabel wa_preferensi siap' AS status;
