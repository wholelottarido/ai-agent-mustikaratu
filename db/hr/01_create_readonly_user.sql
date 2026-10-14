-- ============================================================
-- User MySQL read-only untuk departemen HR
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p -e "source db/hr/01_create_readonly_user.sql"
--
-- DUA user, bukan satu:
--   hr_readonly  -- staf HR. TIDAK bisa melihat data gaji sama sekali.
--   hr_kepala    -- kepala HR. Bisa melihat semuanya termasuk payroll.
--
-- Pemisahnya izin MySQL, BUKAN kalimat di system prompt. Kalau agent staf
-- nekat menulis SELECT gaji_pokok, MySQL yang menolak.
-- ============================================================

-- ------------------------------------------------------------
-- 1. hr_readonly -- staf HR
-- ------------------------------------------------------------
DROP USER IF EXISTS 'hr_readonly'@'localhost';
CREATE USER 'hr_readonly'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA';

-- Tabel yang boleh dibaca seluruhnya (tidak ada kolom kompensasi di dalamnya)
GRANT SELECT ON hr.absensi             TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.cuti                TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.saldo_cuti          TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.departemen          TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.lokasi_kerja        TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.kontrak             TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.pelanggaran         TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.penilaian_kinerja   TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.resignasi           TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.riwayat_jabatan     TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.lowongan            TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.pelamar             TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.tahapan_seleksi     TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.training            TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.training_peserta    TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.survey_engagement   TO 'hr_readonly'@'localhost';
GRANT SELECT ON hr.engagement_response TO 'hr_readonly'@'localhost';

-- Tabel yang dibatasi per KOLOM -- kolom gaji sengaja tidak disebut,
-- jadi tidak bisa dibaca sama sekali.
GRANT SELECT (
  id, nik, nama, jenis_kelamin, tanggal_lahir, status_pernikahan, pendidikan,
  email, telepon, departemen_id, jabatan_id, lokasi_id, atasan_id,
  tanggal_masuk, status_karyawan, status_kerja, tanggal_keluar
) ON hr.karyawan TO 'hr_readonly'@'localhost';   -- tanpa gaji_pokok

GRANT SELECT (id, nama, level, grade) ON hr.jabatan TO 'hr_readonly'@'localhost';
                                                  -- tanpa gaji_min, gaji_max

GRANT SELECT (id, karyawan_id, tanggal, jam, alasan, status)
  ON hr.lembur TO 'hr_readonly'@'localhost';       -- tanpa nilai_rp

-- hr.payroll SENGAJA TIDAK DIBERIKAN sama sekali -- seluruh isinya kompensasi.

ALTER USER 'hr_readonly'@'localhost'
  WITH MAX_QUERIES_PER_HOUR 1000 MAX_USER_CONNECTIONS 5;

-- ------------------------------------------------------------
-- 2. hr_kepala -- kepala HR, termasuk data gaji
-- ------------------------------------------------------------
DROP USER IF EXISTS 'hr_kepala'@'localhost';
CREATE USER 'hr_kepala'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA';

GRANT SELECT ON hr.* TO 'hr_kepala'@'localhost';

ALTER USER 'hr_kepala'@'localhost'
  WITH MAX_QUERIES_PER_HOUR 1000 MAX_USER_CONNECTIONS 5;

FLUSH PRIVILEGES;

SELECT 'hr_readonly' AS user; SHOW GRANTS FOR 'hr_readonly'@'localhost';
SELECT 'hr_kepala' AS user;   SHOW GRANTS FOR 'hr_kepala'@'localhost';
