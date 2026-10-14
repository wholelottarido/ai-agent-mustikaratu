-- ============================================================
-- Sambungan tool -> agent milik portal ini (7 Okt 2026)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/19_tool_agent.sql"
--
-- ⚠️ KENAPA DI DATABASE KITA, BUKAN DI `ai_agent_tool` MEREKA.
--
-- `ai_agent_tool` di PostgreSQL perusahaan adalah tabel yang menentukan tool
-- mana dipakai agent mana -- dan dibaca juga oleh sistem AI tim lain yang
-- sedang dipakai orang. Menambah baris di sana berarti mengubah tool agent
-- mereka dari sisi kita, tanpa mereka tahu.
--
-- Jadi sambungan tambahan milik portal ini disimpan di sini. Pembaca
-- konfigurasi menggabungkan keduanya; sistem mereka tidak melihat tabel ini
-- sama sekali.
--
-- ⚠️ TIDAK ADA FOREIGN KEY, dan itu bukan kelalaian: `agent_kode` dan
-- `tool_kode` hidup di database LAIN (PostgreSQL). Yang menjaga keduanya
-- benar-benar ada adalah `lib/sambung-tool.ts`, yang memeriksanya ke
-- konfigurasi sebelum menulis -- dan baris yang menunjuk tool/agent yang
-- sudah hilang diabaikan pembaca, bukan membuatnya gagal.
-- ============================================================

USE portal;

CREATE TABLE IF NOT EXISTS ai_tool_agent (
  -- `ai_agent.kode`, mis. "agent-maps".
  agent_kode  VARCHAR(60)  NOT NULL,
  -- `ai_tool.kode`, dan HARUS tool milik portal ini (`updated_by = 'magang'`).
  -- Dijaga di `lib/sambung-tool.ts`, bukan di sini: pemiliknya ada di
  -- database sebelah.
  tool_kode   VARCHAR(60)  NOT NULL,
  dibuat      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- `pengguna.id` yang menyambungkan. Untuk jejak, bukan untuk hak akses.
  oleh        INT          NULL,

  PRIMARY KEY (agent_kode, tool_kode),
  KEY idx_tool (tool_kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Hak akses
-- ============================================================
-- ⚠️ DUA ROLE, BUKAN SATU. `portal_app` dipegang jalur chat dan cuma boleh
-- MEMBACA; menyambung/memutus lewat `portal_admin` yang cuma dipegang layar
-- pengaturan. Kalau keduanya satu role, satu bug di jalur chat jadi punya
-- kuasa mengubah tool agent seluruh sistem.
GRANT SELECT                 ON portal.ai_tool_agent TO 'portal_app'@'localhost';
GRANT SELECT, INSERT, DELETE ON portal.ai_tool_agent TO 'portal_admin'@'localhost';
FLUSH PRIVILEGES;

-- Yang harus terlihat setelah ini: satu tabel kosong.
SELECT COUNT(*) AS baris FROM ai_tool_agent;
