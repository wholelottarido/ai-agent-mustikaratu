-- ============================================================
-- Kembalikan isi kolom teks ke data ASLI (sebelum 04_komentar_realistis.sql).
-- ============================================================
-- Jalankan sebagai root:
--   mysql -u root -p marketing -e "source db/05_pulihkan_teks_asli.sql"
-- ============================================================

USE marketing;

UPDATE customer_feedback f
  JOIN _backup_teks_asli b ON b.tabel = 'customer_feedback' AND b.id = f.id
   SET f.komentar = b.teks;

UPDATE lead_activity a
  JOIN _backup_teks_asli b ON b.tabel = 'lead_activity' AND b.id = a.id
   SET a.catatan = b.teks;

UPDATE survey_response r
  JOIN _backup_teks_asli b ON b.tabel = 'survey_response' AND b.id = r.id
   SET r.jawaban_teks = b.teks;

SELECT 'dipulihkan' AS status, COUNT(*) AS baris FROM _backup_teks_asli;
