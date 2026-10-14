-- ============================================================
-- Izin tulis untuk entri HR + jejak audit
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p hr -e "source db/hr/02_entri.sql"
--
-- Sejalan dengan `db/06_entri.sql` di marketing, dan alasannya sama:
--   * user terpisah `hr_entry`, dipakai HANYA oleh `lib/entri/*.ts`
--   * cuma tabel yang benar-benar diisi + 1 tabel audit
--   * TANPA UPDATE, TANPA DELETE
--   * agent tidak punya tool apa pun yang memakai user ini
--
-- Siapa mengentri apa (ditentukan di `voltagent/departemen/hr/index.ts`,
-- BUKAN di sini -- MySQL tidak tahu siapa yang login di aplikasi):
--
--   kepala HR -> lembur     (butuh baca gaji untuk menghitung nilai_rp)
--   staf HR   -> pelamar    (tidak menyentuh gaji sama sekali)
--
-- ⚠️ `hr_entry` BISA MEMBACA GAJI, DAN ITU MEMANG PERLU.
--
-- `lembur.nilai_rp` turunan dari `karyawan.gaji_pokok` -- diperiksa pada 585
-- baris yang ada, pengalinya 1.80 untuk SEMUANYA:
--
--     nilai_rp = jam x 1.8 x gaji_pokok / 173
--
-- Angka uang TIDAK BOLEH diketik manusia, jadi servernya yang menghitung,
-- dan untuk itu dia harus membaca gaji. Yang menjaga batas tetap `hr_readonly`
-- (jalur BACA staf) yang tidak punya `gaji_pokok` maupun `lembur.nilai_rp` --
-- dan itu tidak diubah di sini sama sekali.
-- ============================================================

USE hr;

-- ============================================================
-- 1. Jejak audit -- DI DATABASE `hr`, BUKAN `marketing`
-- ============================================================
-- Marketing punya `entri_log` sendiri di databasenya sendiri. Ini SENGAJA
-- tidak dibagi pakai: jejak harus ditulis dalam transaksi yang SAMA dengan
-- datanya, dan penulis tiap departemen harus terkurung di schema-nya sendiri.
-- Satu tabel bersama berarti `hr_entry` butuh izin di `marketing`, dan itu
-- membatalkan pemisahan yang menopang seluruh sistem.
--
-- Bentuknya sengaja sama persis dengan `marketing.entri_log`, termasuk `aksi`
-- dan `alasan` -- di sana dua kolom itu ditambal belakangan lewat ALTER, di
-- sini langsung ikut sejak awal.
CREATE TABLE IF NOT EXISTS entri_log (
  id          BIGINT       NOT NULL AUTO_INCREMENT,

  entitas     VARCHAR(32)  NOT NULL COMMENT 'tabel yang diisi, mis. lembur',
  aksi        ENUM('ENTRI','BATAL','SETUJU','TOLAK') NOT NULL DEFAULT 'ENTRI',
  ref_id      INT          NOT NULL COMMENT 'id baris yang dibuat',
  ref_kode    VARCHAR(32)  NULL     COMMENT 'kode yang dibaca manusia, kalau ada',

  -- Identitas DISALIN, tidak direlasikan: `pengguna` ada di database `portal`,
  -- dan MySQL tidak bisa memasang foreign key antar database. Menyalin
  -- username juga berarti jejaknya tetap terbaca kalau akunnya dihapus --
  -- dan justru saat itulah jejak paling dibutuhkan.
  pengguna_id INT          NOT NULL,
  username    VARCHAR(64)  NOT NULL,
  departemen  VARCHAR(32)  NOT NULL,
  peran       VARCHAR(16)  NOT NULL,
  asal        ENUM('web','wa') NOT NULL,

  permintaan  TEXT         NULL COMMENT 'kalimat asli user',
  alasan      VARCHAR(255) NULL COMMENT 'alasan pembatalan, diisi USER',
  ringkasan   TEXT         NULL COMMENT 'draf yang dikonfirmasi',

  dibuat      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_ref (entitas, ref_id),
  KEY idx_pengguna (pengguna_id, dibuat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `aksi` mungkin sudah terlanjur dibuat dengan dua nilai saja (ENTRI, BATAL).
-- `CREATE TABLE IF NOT EXISTS` di atas TIDAK mengubah tabel yang sudah ada,
-- jadi ENUM-nya diperlebar terpisah. Aman dijalankan berulang.
ALTER TABLE entri_log
  MODIFY COLUMN aksi ENUM('ENTRI','BATAL','SETUJU','TOLAK') NOT NULL DEFAULT 'ENTRI';

-- ============================================================
-- 2. User penulis
-- ============================================================
CREATE USER IF NOT EXISTS 'hr_entry'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA'
  WITH MAX_QUERIES_PER_HOUR 2000 MAX_USER_CONNECTIONS 6;

-- Tabel yang benar-benar diisi. SELECT ikut diberikan karena penyusun draf
-- membaca ulang sebelum menulis; yang membatasi adalah tidak adanya UPDATE
-- dan DELETE, bukan tidak adanya SELECT.
-- UPDATE dibatasi ke SATU KOLOM: `status`, untuk menyetujui/menolak lembur.
--
-- Bukan UPDATE seluruh tabel. Tanpa kurung, izinnya berlaku untuk `jam`,
-- `tanggal`, dan `nilai_rp` juga -- artinya jalur persetujuan bisa dipakai
-- mengubah nilai uangnya. Dengan `(status)`, MySQL menolak seluruh statement
-- yang menyentuh kolom lain, bahkan kalau `status` ikut di dalamnya.
--
-- `lembur` TIDAK punya kolom approver, jadi tidak ada yang lain yang perlu
-- ditulis. Siapa yang menyetujui tercatat di `entri_log`.
GRANT SELECT, INSERT ON hr.lembur    TO 'hr_entry'@'localhost';
GRANT UPDATE (status) ON hr.lembur   TO 'hr_entry'@'localhost';
GRANT SELECT, INSERT ON hr.pelamar   TO 'hr_entry'@'localhost';
GRANT SELECT, INSERT ON hr.entri_log TO 'hr_entry'@'localhost';

-- ------------------------------------------------------------
-- Tabel rujukan -- dibatasi kolom, bukan seluruh tabel
-- ------------------------------------------------------------
-- `gaji_pokok` ADA di daftar ini, dan itu satu-satunya alasan user ini boleh
-- menyentuhnya: menghitung `nilai_rp`. `status_kerja` ikut karena lembur cuma
-- boleh untuk karyawan AKTIF (223 dari 254; sisanya RESIGN/PENSIUN).
-- `nik` ikut karena NAMA KARYAWAN TIDAK UNIK -- ada beberapa yang kembar,
-- jadi harus ada pembeda waktu menawarkan pilihan ke user.
GRANT SELECT (id, nik, nama, departemen_id, jabatan_id, status_kerja, gaji_pokok)
  ON hr.karyawan TO 'hr_entry'@'localhost';

-- `status` dan `tanggal_tutup` dua-duanya dipakai: ada lowongan berstatus OPEN
-- yang tanggal tutupnya SUDAH LEWAT (LOW-2026-013, tutup 22 Sep 2026), jadi
-- status saja tidak cukup untuk memutuskan masih menerima pelamar atau tidak.
GRANT SELECT (id, kode, jabatan_id, departemen_id, status, tanggal_buka, tanggal_tutup)
  ON hr.lowongan TO 'hr_entry'@'localhost';

-- Untuk menampilkan asal karyawan/lowongan di draf, supaya user bisa
-- membedakan dua orang bernama sama.
GRANT SELECT (id, kode, nama) ON hr.departemen TO 'hr_entry'@'localhost';
-- `level` ikut karena lembur DIBATASI per level jabatan: di data yang ada,
-- 16 orang di level Manager/General Manager/Direktur punya NOL baris lembur,
-- sementara Staff/Operator/Supervisor punya 585. Itu bukan kebetulan --
-- golongan jabatan tertentu memang tidak berhak upah lembur.
-- `gaji_min`/`gaji_max` tetap TIDAK diberikan.
GRANT SELECT (id, nama, level) ON hr.jabatan TO 'hr_entry'@'localhost';

-- ⚠️ TIDAK DIBERIKAN, dan itu disengaja:
--   * DELETE apa pun.
--   * UPDATE selain `hr.lembur(status)` -- termasuk UPDATE pada `pelamar`.
--     Memajukan tahap seleksi jadi pekerjaan tersendiri kalau memang perlu.
--   * payroll, cuti, saldo_cuti, penilaian_kinerja, pelanggaran, resignasi.
--   * karyawan.email/telepon/tanggal_lahir dan kolom pribadi lainnya.

FLUSH PRIVILEGES;

-- ============================================================
-- 3. Yang harus terlihat setelah ini
-- ============================================================
SELECT 'hr_entry siap' AS status;
SHOW GRANTS FOR 'hr_entry'@'localhost';

-- Yang HARUS ada:
--   GRANT SELECT, INSERT, UPDATE (`status`) ON `hr`.`lembur` ...
--   GRANT SELECT, INSERT ON `hr`.`pelamar` ...
--   GRANT SELECT, INSERT ON `hr`.`entri_log` ...
--   GRANT SELECT (`departemen_id`, `gaji_pokok`, `id`, ...) ON `hr`.`karyawan` ...
--
-- Yang TIDAK BOLEH ada: UPDATE, DELETE, atau grant tanpa daftar kolom pada
-- `hr`.`karyawan`. Kalau muncul, cabut dan jalankan ulang berkas ini.

SHOW COLUMNS FROM entri_log;
