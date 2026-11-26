-- ============================================================
-- Tinjauan tool baru milik tim lain (5 Nov 2026)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/23_tool_tinjau.sql"
-- Lalu isi daftar awal:
--   npm run tinjau:isi-awal
--
-- `ai_tool` dibagi dengan tim lain, dan tool baca mereka selama ini langsung dipakai portal
-- begitu terdaftar. Sejak 2 Nov 2026 saja bertambah 55 baris tanpa ada yang memutuskan.
-- Tabel ini menyimpan keputusan itu di database kita; baris mereka tidak diubah.
--
--   dikenal   -> sudah ada saat tabel ini diisi, tetap dipakai
--   disetujui -> tool baru yang disetujui dari layar Kelola AI
--   ditolak   -> tool baru yang ditolak, portal tidak memakainya
--
-- Tool yang tidak punya baris di sini berarti baru, dan menunggu keputusan.
-- ============================================================

USE portal;

CREATE TABLE IF NOT EXISTS ai_tool_tinjau (
  tool_kode VARCHAR(100) NOT NULL,
  status    ENUM('dikenal', 'disetujui', 'ditolak') NOT NULL,
  oleh      INT NULL,
  dibuat    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tool_kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sama dengan `ai_tulis_disetujui`: jalur chat hanya membaca, yang memutuskan hanya jalur admin.
GRANT SELECT ON portal.ai_tool_tinjau TO 'portal_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON portal.ai_tool_tinjau TO 'portal_admin'@'localhost';
FLUSH PRIVILEGES;

SELECT status, COUNT(*) AS jumlah FROM ai_tool_tinjau GROUP BY status;
