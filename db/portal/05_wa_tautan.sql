-- Tautan akun portal <-> akun WhatsApp.
--
-- Jalankan sebagai root:
--   mysql -u root -p portal -e "source db/portal/05_wa_tautan.sql"
--
-- ⚠️ KENAPA TABEL TERPISAH, BUKAN KOLOM DI `pengguna`
--
-- Aturan yang dipegang sejak awal: aplikasi TIDAK PERNAH punya izin tulis ke
-- tabel `pengguna`. Nanti bot WA harus bisa menyimpan tautannya sendiri
-- (waktu user mengirim kode verifikasi), dan kalau tautan itu jadi kolom di
-- `pengguna`, bot terpaksa diberi UPDATE ke tabel daftar akun. Di tabel
-- terpisah, izin tulisnya bisa dibatasi cuma ke sini.
--
-- ⚠️ KENAPA `wa_id`, BUKAN NOMOR TELEPON
--
-- WhatsApp modern mengirim identitas pengirim sebagai LID -- misalnya
-- `11111111111111@lid` -- yang SENGAJA tidak memuat nomor telepon. Diverifikasi
-- langsung 25 Sep 2026: pesan dari 08xxxxxxxxxx masuk sebagai
-- `11111111111111@lid`. Baileys 6.17.16 tidak punya API untuk menerjemahkannya
-- balik ke nomor.
--
-- Jadi `wa_id` yang dicocokkan; `nomor_wa` cuma label supaya manusia tahu
-- baris ini milik siapa.

-- ⚠️ COLLATION DISAMAKAN dengan tabel lama (`pengguna`, `percakapan`, `pesan`)
-- yang memakai utf8mb4_unicode_ci. Bawaan MySQL 8 adalah utf8mb4_0900_ai_ci,
-- dan membandingkan kolom teks antar dua collation itu GAGAL saat dijalankan:
--   Illegal mix of collations ... for operation '='
-- Lolos typecheck, lolos CREATE TABLE, baru meledak waktu ada JOIN/EXISTS.
CREATE TABLE IF NOT EXISTS wa_tautan (
  wa_id       VARCHAR(64)  NOT NULL,
  pengguna_id INT          NOT NULL,
  -- Label untuk manusia. Tidak dipakai mencocokkan apa pun -- LID itu buram,
  -- tanpa ini tidak ada yang bisa mengaudit isi tabel enam bulan lagi.
  nomor_wa    VARCHAR(20)  NULL,
  ditautkan   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (wa_id),
  -- Satu akun = satu WhatsApp. Kalau seseorang ganti HP, tautan lama dihapus
  -- dulu. Tanpa batas ini, akun yang sama bisa punya banyak WA aktif dan
  -- mencabut akses jadi tidak pasti.
  UNIQUE KEY uq_pengguna (pengguna_id),

  CONSTRAINT fk_wa_pengguna FOREIGN KEY (pengguna_id)
    REFERENCES pengguna(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bot memakai `portal_readonly` -- sama seperti halaman login. Di Tahap B
-- pendaftaran masih lewat SQL manual (root), jadi bot cukup BACA.
GRANT SELECT ON portal.wa_tautan TO 'portal_readonly'@'localhost';
FLUSH PRIVILEGES;

SELECT 'wa_tautan siap' AS status;
SHOW GRANTS FOR 'portal_readonly'@'localhost';
