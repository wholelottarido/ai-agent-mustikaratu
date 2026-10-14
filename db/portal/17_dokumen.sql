-- ============================================================
-- Dokumen yang diunggah user (Tahap 12B)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/17_dokumen.sql"
--
-- Menyimpan HASIL BACA dokumen, bukan berkas aslinya.
--
-- ⚠️ BERKAS ASLINYA SENGAJA TIDAK DISIMPAN.
--
-- Yang dibutuhkan agent cuma teksnya. Menyimpan PDF/gambar aslinya berarti
-- portal ini menampung dokumen internal perusahaan di laptop, dan itu
-- tanggung jawab yang tidak sepadan dengan manfaatnya. Kalau suatu saat
-- perlu ditampilkan ulang, user tinggal mengunggahnya lagi.
-- ============================================================

USE portal;

CREATE TABLE IF NOT EXISTS dokumen (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  pengguna_id INT          NOT NULL,

  nama        VARCHAR(255) NOT NULL COMMENT 'nama berkas asli, untuk ditampilkan',
  jenis       VARCHAR(64)  NOT NULL COMMENT 'media type: application/pdf, image/png, ...',
  ukuran      INT          NOT NULL COMMENT 'byte',

  -- ⚠️ SHA-256 isi berkas. Inilah yang membuat dokumen yang sama TIDAK
  -- dibaca dua kali. Untuk PDF hematnya kecil (0,2 detik), tapi untuk
  -- gambar yang lewat OCR hematnya ~63 DETIK per berkas.
  hash        CHAR(64)     NOT NULL,

  cara        VARCHAR(16)  NOT NULL COMMENT 'teks-tertanam | ocr',
  halaman     INT          NULL,
  teks        MEDIUMTEXT   NOT NULL COMMENT 'hasil baca; ini yang dipakai agent',
  detik       DECIMAL(7,2) NOT NULL COMMENT 'lama membaca, untuk memantau',

  dibuat      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Satu orang, satu dokumen, satu baris. Unggah ulang berkas yang sama
  -- mengembalikan baris yang sudah ada -- bukan membuat kembar.
  --
  -- Sengaja DIBATASI PER PENGGUNA, bukan global: kalau global, dokumen
  -- milik orang lain bisa terpakai hanya karena isinya kebetulan sama, dan
  -- itu kebocoran yang sulit disadari.
  UNIQUE KEY uq_pengguna_hash (pengguna_id, hash),
  KEY idx_pengguna_waktu (pengguna_id, dibuat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Izin
-- ============================================================
-- ⚠️ `portal_app`, BUKAN `portal_admin`.
--
-- Ini data aplikasi biasa yang ditulis user biasa -- sejenis `percakapan`
-- dan `pesan`, bukan sejenis `pengguna`. `portal_admin` dipakai untuk
-- membuat dan menyunting akun; memakainya di sini berarti jalur unggah
-- dokumen ikut memegang hak mengubah akun, tanpa perlu.
--
-- TANPA UPDATE: dokumen tidak pernah diubah setelah dibaca. Kalau isinya
-- berubah, hash-nya berubah, dan itu dokumen lain.
GRANT SELECT, INSERT, DELETE ON portal.dokumen TO 'portal_app'@'localhost';

-- Jalur baca agent memakai user read-only.
GRANT SELECT ON portal.dokumen TO 'portal_readonly'@'localhost';

FLUSH PRIVILEGES;

-- ============================================================
-- Bukti
-- ============================================================
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'dokumen'
 ORDER BY ORDINAL_POSITION;

SELECT COUNT(*) AS baris_dokumen FROM dokumen;
