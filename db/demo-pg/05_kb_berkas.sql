-- ============================================================
-- Berkas SOP + rujukan halaman & baris (Tahap 16)
-- ============================================================
-- Jalankan lewat: npm run pasang:kb-pdf
--
-- ⚠️ MENGUBAH ARTI ISI `ai_kb_potongan`.
--
-- Sebelum ini, potongan dibuat dari kolom `ai_kb_dokumen.isi` (teks biasa).
-- Sesudah ini, potongan dibuat dari teks yang DIBACA BALIK dari PDF yang
-- tersimpan di `ai_kb_berkas`. Itu syarat dari pemilik proyek (1 Okt 2026):
-- "pastikan data yang di store di database merupakan hasil pdf yang sudah di
-- vector".
--
-- Alasannya bukan formalitas. Nomor baris yang disimpan harus cocok dengan
-- yang DILIHAT user waktu membuka PDF-nya. Kalau potongan dihitung dari teks
-- asli sementara user membaca PDF, dua-duanya bisa bergeser -- dan rujukan
-- yang meleset lebih berbahaya daripada tidak ada rujukan sama sekali, karena
-- user percaya begitu saja.
--
-- `ai_kb_dokumen.isi` TETAP ADA, tapi statusnya berubah: dia sumber untuk
-- MENGGAMBAR PDF, bukan lagi sumber untuk pencarian.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_kb_berkas (
    id_dokumen  uuid PRIMARY KEY REFERENCES ai_kb_dokumen(id_dokumen) ON DELETE CASCADE,
    nama_berkas varchar(255) NOT NULL,
    jenis       varchar(64)  NOT NULL DEFAULT 'application/pdf',
    -- Berkasnya sendiri. Kecil (2-4 KB per dokumen), jadi disimpan di baris
    -- supaya tidak ada berkas yatim waktu dokumennya dihapus.
    bita        bytea        NOT NULL,
    -- Sidik isi berkas. Dipakai uji keterlacakan: potongan yang tersimpan
    -- harus berasal dari BERKAS INI, bukan dari berkas versi lain.
    sha256      char(64)     NOT NULL,
    halaman     int          NOT NULL,
    dibuat      timestamp    NOT NULL DEFAULT now()
);

-- ⚠️ `ADD COLUMN IF NOT EXISTS` ADA di PostgreSQL (berbeda dengan MySQL 8.0.30
-- yang tidak punya, lihat catatan di db/portal/). Jadi aman dijalankan ulang.
ALTER TABLE ai_kb_potongan ADD COLUMN IF NOT EXISTS halaman    int;
ALTER TABLE ai_kb_potongan ADD COLUMN IF NOT EXISTS baris_awal int;
ALTER TABLE ai_kb_potongan ADD COLUMN IF NOT EXISTS baris_akhir int;

COMMENT ON COLUMN ai_kb_potongan.halaman IS
  'Halaman di PDF (1-based). NULL = potongan lama, dibuat sebelum ada berkas.';
COMMENT ON COLUMN ai_kb_potongan.baris_awal IS
  'Baris VISUAL di halaman itu (1-based) -- yang dihitung orang waktu membaca PDF, bukan nomor paragraf.';

CREATE INDEX IF NOT EXISTS ai_kb_potongan_halaman_idx
    ON ai_kb_potongan (id_dokumen, halaman, baris_awal);

-- Agent membaca lewat role read-only yang sudah ada.
-- ⚠️ Kolom baru TIDAK otomatis ikut kalau grant-nya per kolom; di sini
-- grant-nya setingkat tabel, jadi kolom tambahan ikut sendiri.
GRANT SELECT ON ai_kb_berkas TO ai_readonly;

SELECT 'ai_kb_berkas' AS tabel, COUNT(*) AS baris FROM ai_kb_berkas
UNION ALL
SELECT 'potongan punya halaman', COUNT(*) FROM ai_kb_potongan WHERE halaman IS NOT NULL;
