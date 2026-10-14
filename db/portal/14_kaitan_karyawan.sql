-- ============================================================
-- Kaitan pengguna portal -> karyawan di database perusahaan
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/14_kaitan_karyawan.sql"
--
-- ⚠️ KENAPA INI DIBUTUHKAN SEBELUM SUMBER PERUSAHAAN DINYALAKAN.
--
-- View `v_ai_*` di database perusahaan TIDAK punya WHERE -- semuanya
-- menampilkan SELURUH baris. Penyaring per-orang (`diri` / `bawahan`)
-- diterapkan aplikasi, dan untuk itu aplikasi harus tahu: pengguna yang
-- sedang bertanya ini karyawan yang mana.
--
-- Tanpa kolom ini, menyalakan sumber perusahaan berarti:
--   * setiap user melihat SELURUH 1.954 karyawan (nama, NIK, atasan)
--   * setiap user melihat pengajuan cuti SEMUA orang, beserta alasannya
--   * setiap user melihat tiket helpdesk SEMUA orang
--
-- Itu bukan data gaji, tapi tetap data pribadi orang sungguhan.
--
-- ⚠️ CHAR(36), BUKAN INT.
--
-- `employee.id_employee` di PostgreSQL bertipe `uuid`. Disimpan sebagai teks
-- 36 karakter. TIDAK ada foreign key -- tabelnya ada di server dan mesin
-- database yang BERBEDA, jadi MySQL memang tidak bisa menjaganya. Yang
-- menjaga kecocokannya adalah pemetaan di bawah, dan itu harus diperiksa
-- ulang kalau data karyawan berubah.
-- ============================================================

USE portal;

-- MySQL TIDAK punya `ADD COLUMN IF NOT EXISTS` (itu MariaDB), jadi
-- keberadaan kolom diperiksa dulu supaya berkas ini aman dijalankan ulang.
SET @ada := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pengguna'
                AND COLUMN_NAME = 'id_employee');
SET @sql := IF(@ada = 0,
  "ALTER TABLE pengguna
     ADD COLUMN id_employee CHAR(36) NULL
       COMMENT 'uuid employee di database perusahaan. NULL = belum dipetakan'
       AFTER peran",
  "SELECT 'kolom id_employee sudah ada, dilewati' AS info");
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- Satu karyawan tidak boleh dipetakan ke dua akun portal: kalau itu terjadi,
-- penyaring `diri` jadi ambigu dan dua orang bisa saling melihat data.
-- NULL boleh berulang -- di MySQL, UNIQUE mengizinkan banyak NULL.
SET @ada := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = 'portal' AND TABLE_NAME = 'pengguna'
                AND INDEX_NAME = 'uq_pengguna_employee');
SET @sql := IF(@ada = 0,
  "ALTER TABLE pengguna ADD UNIQUE KEY uq_pengguna_employee (id_employee)",
  "SELECT 'indeks uq_pengguna_employee sudah ada, dilewati' AS info");
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- ============================================================
-- Izin
-- ============================================================
-- `portal_readonly` dipakai `lib/pengguna.ts` saat login, dan di situlah
-- `id_employee` dibaca untuk dimasukkan ke sesi. Izinnya per kolom, mengikuti
-- pola yang sudah dipakai di seluruh proyek.
GRANT SELECT (id, username, password_hash, nama, departemen, peran, is_admin, aktif, id_employee)
  ON portal.pengguna TO 'portal_readonly'@'localhost';

-- `portal_admin` sudah punya SELECT, INSERT, UPDATE pada seluruh tabel
-- `pengguna` (lihat 10_admin.sql), jadi pemetaan bisa diubah lewat halaman
-- admin nanti tanpa GRANT tambahan.

FLUSH PRIVILEGES;

-- ============================================================
-- Pemetaan akun uji
-- ============================================================
-- ⚠️ SENGAJA DIKOSONGKAN DI BERKAS INI.
--
-- uuid karyawan berbeda di tiap salinan database, jadi menuliskannya di sini
-- membuat berkas ini cuma benar untuk satu server. Pemetaannya dikerjakan
-- `npm run petakan:karyawan`, yang MEMBACA database perusahaan lalu
-- mencocokkan berdasarkan nama/NIK -- dan menolak kalau cocoknya lebih dari
-- satu, karena nama karyawan terbukti tidak unik.

SELECT id, username, departemen, peran, id_employee FROM pengguna ORDER BY id;
SHOW COLUMNS FROM pengguna LIKE 'id_employee';
