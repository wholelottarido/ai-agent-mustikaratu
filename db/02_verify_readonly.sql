-- ============================================================
-- Verifikasi user read-only benar-benar terkunci
-- Jalankan SEBAGAI user read-only:
--   mysql -u mkt_readonly -p marketing < db/02_verify_readonly.sql
-- ============================================================

-- HARUS BERHASIL
SELECT 'TEST 1: SELECT (harus jalan)' AS test;
SELECT NOW() AS waktu_sekarang;

-- HARUS GAGAL dengan error "command denied to user"
SELECT 'TEST 2: CREATE TABLE (harus DITOLAK)' AS test;
CREATE TABLE uji_tulis (id INT);

-- Kalau baris di atas error => pengaman bekerja. 
-- Kalau tabel malah kebuat => grant-nya kelebaran, ulangi langkah 1.
