-- ============================================================
-- Persetujuan tool TULIS milik tim lain (13 Okt 2026)
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root portal -e "source db/portal/21_tulis_disetujui.sql"
--
-- ⚠️ KENAPA TABEL INI ADA.
--
-- Penjalan tulis umum (`lib/entri/tulis-umum.ts`) merakit tool tulis dari
-- BARIS KONFIGURASI, tanpa kode khusus. Itu memang tujuannya -- tool tulis
-- baru tidak perlu kami tulis lagi. Tapi `ai_tool` juga diisi tim lain, dan
-- akibatnya baris tulis MEREKA ikut terakit begitu tabel sasarannya ada di
-- daftar-boleh.
--
-- Terjadi 13 Okt 2026. Tim lain membangun ulang katalog tool mereka: 140 baris
-- baru dalam sehari, `agent-portal` naik dari 9 jadi 21 tool. Dua di antaranya
-- tool tulis ke `portal_ticket` -- `tutup_tiket` dan `batalkan_tiket` -- dan
-- keduanya langsung hidup di portal ini tanpa seorang pun meninjaunya.
--
-- `batalkan_tiket` bahkan tool yang MINGGU LALU DIHAPUS dari portal ini atas
-- permintaan tim IT. Dia kembali bukan karena ada yang memutuskan, tapi karena
-- katalog sebelah berubah.
--
-- Penjagaan lain tetap bekerja -- daftar-boleh tabel, hak per-kolom role
-- `ai_tulis`, penyaring pemilik yang selalu ikut, rancangan yang cuma bisa
-- disimpan tombol. Yang hilang cuma satu: KEPUTUSAN. Tabel ini yang
-- memulihkannya.
--
-- ⚠️ KENAPA TABEL BARU, BUKAN `mode` DI `ai_tool_agent`.
--
-- `mode` di sana bermakna PER AGENT: tool mereka yang mana yang tidak dipasang
-- di agent tertentu. Persetujuan menulis bukan urusan per agent -- yang
-- disetujui adalah KEMAMPUAN MENGUBAH BARIS di sebuah tabel. Menyetujuinya di
-- satu agent lalu menganggapnya belum disetujui di agent lain adalah pembedaan
-- yang tidak menjaga apa pun, karena yang ditulis tabelnya sama.
--
-- ⚠️ YANG BELUM DISETUJUI TIDAK DIHAPUS DI MANA PUN.
--
-- Baris `ai_tool` mereka tetap utuh dan sistem AI mereka tetap memakainya.
-- Yang berubah cuma: portal ini tidak merakitnya, dan alasannya tercetak di
-- `dilewati` supaya kelihatan -- bukan hilang diam-diam.
-- ============================================================

USE portal;

CREATE TABLE IF NOT EXISTS ai_tulis_disetujui (
  tool_kode   VARCHAR(100) NOT NULL,
  -- Operasi dan tabel YANG DISETUJUI, disalin saat persetujuan diberikan.
  --
  -- ⚠️ BUKAN KETERANGAN, INI BAGIAN DARI PENJAGAANNYA. Baris `ai_tool` milik
  -- tim lain bisa berubah kapan saja tanpa kami tahu: `tutup_tiket` yang
  -- disetujui hari ini sebagai `hapus` pada `portal_ticket` bisa jadi `ubah`
  -- pada tabel lain besok, dengan kode yang sama. Persetujuan yang cuma
  -- menyimpan kode akan ikut berlaku untuk tool yang sudah bukan tool itu.
  --
  -- Pembaca mencocokkan ketiganya. Yang berubah jadi belum-disetujui lagi.
  operasi     VARCHAR(20)  NOT NULL,
  tabel       VARCHAR(100) NOT NULL,
  oleh        INT          NOT NULL,
  dibuat      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tool_kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⚠️ `portal_app` cuma SELECT. Jalur chat membaca persetujuan ini tiap memuat
-- konfigurasi; memberinya INSERT berarti jalur yang menjawab pertanyaan punya
-- kuasa menyetujui tool tulis. Yang menulis cuma `portal_admin`, dan itu cuma
-- dipegang route yang sudah lewat `timItAtauTolak()`.
GRANT SELECT                 ON portal.ai_tulis_disetujui TO 'portal_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON portal.ai_tulis_disetujui TO 'portal_admin'@'localhost';
FLUSH PRIVILEGES;

-- Yang harus terlihat setelah ini: tabelnya ada dan KOSONG. Kosong berarti
-- belum ada satu pun tool tulis tim lain yang dirakit portal ini -- keadaan
-- yang benar sampai tim IT meninjaunya satu per satu.
SELECT COUNT(*) AS sudah_disetujui FROM ai_tulis_disetujui;
