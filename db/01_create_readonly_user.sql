-- ============================================================
-- Langkah 1: User MySQL read-only untuk AI Assistant Marketing
-- ============================================================
-- Jalankan sebagai root:
--   mysql -u root < db/01_create_readonly_user.sql
--
-- Database 'marketing' sudah ada, jadi tidak dibuat ulang.
-- GANTI password di bawah kalau mau.
-- ============================================================

-- 1. User khusus agent. Dibatasi ke 'localhost' saja,
--    jadi tidak bisa diakses dari jaringan luar.
DROP USER IF EXISTS 'mkt_readonly'@'localhost';
CREATE USER 'mkt_readonly'@'localhost'
  IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_ANDA';

-- 2. HANYA izin SELECT, dan HANYA ke database marketing.
--    Tidak ada INSERT/UPDATE/DELETE/DROP/CREATE.
--    Tidak pakai *.* -- database lain (sim_rs, billing_rsijs, dst)
--    tetap tidak terlihat oleh agent.
GRANT SELECT ON marketing.* TO 'mkt_readonly'@'localhost';

-- 3. Batasi beban: pengaman kalau agent nyangkut di loop.
ALTER USER 'mkt_readonly'@'localhost'
  WITH MAX_QUERIES_PER_HOUR 1000
       MAX_USER_CONNECTIONS 5;

FLUSH PRIVILEGES;

-- 4. Cek hasilnya
SHOW GRANTS FOR 'mkt_readonly'@'localhost';
