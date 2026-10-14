-- ============================================================
-- Saklar sumber data: database mana yang dibaca agent
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/13_sumber_db.sql"
--
-- Administrator memilih SATU sumber. Kalau `perusahaan` dipilih, agent
-- membaca dari PostgreSQL perusahaan dan TIDAK lagi menyentuh database dummy
-- -- begitu pula sebaliknya. Tidak pernah dua-duanya sekaligus.
--
-- ⚠️ KENAPA PILIH-SATU, BUKAN NYALA-BERSAMA.
--
-- Dua sumber aktif berarti dua dialek SQL dalam satu system prompt
-- (`DATE_FORMAT` vs `TO_CHAR`, backtick vs tanda kutip ganda). Model yang
-- tidak yakin akan MENEBAK -- dan proyek ini sudah berkali-kali membuktikan
-- bahwa menebak adalah sumber masalah utamanya. Dengan pilih-satu, cuma ada
-- satu tool query yang terpasang, jadi tidak ada yang bisa tertukar.
--
-- Bonusnya: kamus data tetap ramping. Dua kamus sekaligus membengkakkan
-- prompt dan menurunkan mutu jawaban.
--
-- ⚠️ NAMANYA `sumber_db`, BUKAN `sumber_data`.
--
-- `sumber_data` sudah dipakai di proyek ini untuk hal lain: kolom
-- `pesan.sumber`, yang mencatat TABEL apa saja yang dipakai tiap jawaban
-- (lihat `04_sumber_data.sql`). Dan di database perusahaan, `ai_sumber_data`
-- artinya lain lagi: daftar view yang boleh dibaca agent. Tiga arti untuk satu
-- istilah adalah resep kebingungan.
-- ============================================================

USE portal;

CREATE TABLE IF NOT EXISTS sumber_db (
  kode        VARCHAR(20)  NOT NULL COMMENT 'dipakai di kode, jangan diubah',
  nama        VARCHAR(80)  NOT NULL COMMENT 'yang dibaca manusia di halaman admin',
  jenis       ENUM('mysql','postgres') NOT NULL,
  keterangan  VARCHAR(255) NULL,

  -- ⚠️ `tersedia` DAN `aktif` sengaja DIPISAH.
  --
  -- `tersedia` = tool & kamus datanya sudah ada di kode.
  -- `aktif`    = yang sedang dipilih administrator.
  --
  -- Tanpa `tersedia`, admin bisa memilih sumber yang belum punya tool sama
  -- sekali -- dan agent-nya kehilangan SELURUH kemampuan membaca data tanpa
  -- pesan galat apa pun. Gejalanya: agent tiba-tiba menjawab "saya tidak
  -- punya akses ke data" untuk semua pertanyaan.
  tersedia    TINYINT(1)   NOT NULL DEFAULT 0,
  aktif       TINYINT(1)   NOT NULL DEFAULT 0,

  urutan      TINYINT      NOT NULL DEFAULT 0,
  diubah_oleh VARCHAR(64)  NULL,
  diubah      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Saklar sumber data agent. Tepat SATU baris boleh aktif.';

-- Isi awal. `INSERT IGNORE` supaya aman dijalankan ulang tanpa menimpa
-- pilihan administrator yang sudah berjalan.
INSERT IGNORE INTO sumber_db (kode, nama, jenis, keterangan, tersedia, aktif, urutan) VALUES
  ('dummy', 'Database dummy (MySQL)', 'mysql',
   'Data contoh di komputer ini. Marketing 23 tabel, HR 21 tabel. Mendukung entri data.',
   1, 1, 1),
  ('perusahaan', 'Database perusahaan (PostgreSQL)', 'postgres',
   'mustika_ratu_dev, 220 tabel. Baca saja -- entri data tidak tersedia.',
   0, 0, 2);

-- ============================================================
-- Izin
-- ============================================================
-- `portal_app` cuma MEMBACA: setiap permintaan chat perlu tahu sumber mana
-- yang aktif. Dia tidak boleh mengubahnya -- kalau bisa, jalur chat jadi
-- punya kuasa mengganti sumber data seluruh sistem.
GRANT SELECT ON portal.sumber_db TO 'portal_app'@'localhost';

-- `portal_admin` boleh mengubah, karena halaman admin yang memakainya.
-- Tanpa INSERT dan DELETE: baris sumber ditambah lewat berkas SQL, bukan
-- lewat halaman. Sumber baru selalu butuh kode pendampingnya, jadi tidak ada
-- gunanya bisa ditambah dari antarmuka.
GRANT SELECT, UPDATE ON portal.sumber_db TO 'portal_admin'@'localhost';

FLUSH PRIVILEGES;

SELECT kode, nama, jenis, tersedia, aktif FROM sumber_db ORDER BY urutan;
SHOW GRANTS FOR 'portal_app'@'localhost';
