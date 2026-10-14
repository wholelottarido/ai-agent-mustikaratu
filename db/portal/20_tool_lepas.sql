-- ============================================================
-- Melepas tool tim lain dari agent portal ini (9 Okt 2026)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/20_tool_lepas.sql"
--
-- ⚠️ KENAPA PERLU KOLOM BARU, BUKAN SEKADAR MENGHAPUS BARIS.
--
-- `ai_tool_agent` selama ini cuma menjawab satu pertanyaan: "tool kita yang
-- mana yang DITAMBAHKAN ke agent ini". Sekarang ada pertanyaan kedua yang
-- berlawanan: "tool MEREKA yang mana yang TIDAK kita pasang".
--
-- Keduanya perlu, dan tidak bisa diwakili ketiadaan baris. Tidak adanya baris
-- berarti "tidak ditambahkan"; melepas tool mereka perlu dicatat sebagai
-- keputusan yang sadar, lengkap dengan siapa dan kapan.
--
-- ⚠️ TOOL MEREKA TIDAK DIHAPUS DI MANA PUN.
--
-- `ai_tool` dan `ai_agent_tool` di PostgreSQL perusahaan tetap utuh, dan
-- sistem AI tim lain tetap memakainya seperti biasa. Yang berubah cuma apa
-- yang DIPASANG portal ini. Melepas di sini sama sekali tidak terlihat dari
-- sisi mereka -- itu memang syaratnya.
-- ============================================================

USE portal;

-- `pasang` -> tool KITA yang ditambahkan ke agent itu (perilaku lama).
-- `lepas`  -> tool MEREKA yang tidak dipasang portal ini.
--
-- Baris lama tidak punya nilai, jadi bawaannya `pasang` -- sama persis dengan
-- artinya selama ini.
ALTER TABLE ai_tool_agent
  ADD COLUMN mode VARCHAR(10) NOT NULL DEFAULT 'pasang'
  AFTER tool_kode;

-- Yang harus terlihat setelah ini: kolom `mode` ada, dan seluruh baris lama
-- bernilai 'pasang'.
SELECT mode, COUNT(*) AS baris FROM ai_tool_agent GROUP BY mode;
