-- ============================================================
-- Basis pengetahuan dokumen + vektor (Tahap 14)
-- ============================================================
-- Jalankan lewat: npm run pasang:kb
--
-- ⚠️ MENULIS KE DATABASE PERUSAHAAN, di schema `public`, atas permintaan
-- pemilik proyek (1 Okt 2026). Usul semula schema terpisah `portal_ai`
-- ditolak; diminta tabel biasa saja.
--
-- ============================================================
-- KENAPA NAMANYA `ai_kb_*`, BUKAN `ai_dokumen`
-- ============================================================
-- Database ini sudah punya 14 tabel berawalan `ai_` milik sistem lain yang
-- SEDANG AKTIF DIBANGUN (ai_agent, ai_tool, ai_chat_session 14 MB, dan
-- seterusnya; dua di antaranya diedit 30 Sep sore oleh user lain).
--
-- `ai_dokumen` persis nama yang mungkin mereka buat berikutnya, dan tabrakan
-- nama di database bersama tidak ketahuan sampai ada yang rusak. `kb`
-- (knowledge base) menjauhkan itu tanpa keluar dari konvensi mereka.
--
-- ============================================================
-- ⚠️ ISI TABEL INI BUKAN SOP RESMI PERUSAHAAN
-- ============================================================
-- Dokumen contoh ditulis untuk menguji pencarian makna, isinya didasarkan
-- pada tema tiket nyata tapi TIDAK disahkan siapa pun. Karena itu:
--   * kolom `sumber` menandai asalnya ('contoh-uji')
--   * tiap dokumen diberi penanda di baris pertama teksnya
--   * `npm run pasang:kb -- --hapus` membersihkan semuanya
--
-- Jangan mencampur dokumen sungguhan ke sini tanpa mengubah `sumber`.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_kb_dokumen (
    id_dokumen  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode        varchar(64)  NOT NULL UNIQUE,
    judul       varchar(255) NOT NULL,
    kategori    varchar(64),
    aplikasi    varchar(64),
    isi         text         NOT NULL,
    -- 'contoh-uji' = ditulis untuk pengujian. Ganti kalau dokumennya nyata.
    sumber      varchar(32)  NOT NULL DEFAULT 'contoh-uji',
    dibuat      timestamp    NOT NULL DEFAULT now()
);

-- ⚠️ Tabel INI punya foreign key sungguhan, berbeda dengan portal_ticket
-- yang nol FK. Kalau dokumennya dihapus, potongannya ikut -- tanpa itu,
-- vektor yatim tetap muncul di hasil pencarian tanpa induk yang bisa dibaca.
CREATE TABLE IF NOT EXISTS ai_kb_potongan (
    id_potongan uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_dokumen  uuid NOT NULL REFERENCES ai_kb_dokumen(id_dokumen) ON DELETE CASCADE,
    urutan      int  NOT NULL,
    teks        text NOT NULL,

    -- 768 = multilingual-e5-base. Dipilih karena sudah terpasang di proyek
    -- dan sudah terukur pada data ini; bge-m3 (1024) butuh Ollama yang saat
    -- ini rusak. ⚠️ Mengganti model berarti mengganti tipe kolom DAN
    -- menghitung ulang seluruh vektor -- bukan perubahan kecil.
    vektor      vector(768),

    UNIQUE (id_dokumen, urutan)
);

-- Indeks HNSW: pencarian tetangga terdekat tanpa memindai semua baris.
-- Pada ~150 potongan ini belum terasa; dipasang supaya tidak perlu diubah
-- waktu korpusnya tumbuh.
CREATE INDEX IF NOT EXISTS ai_kb_potongan_vektor_idx
    ON ai_kb_potongan USING hnsw (vektor vector_cosine_ops);

CREATE INDEX IF NOT EXISTS ai_kb_potongan_dokumen_idx
    ON ai_kb_potongan (id_dokumen);

-- Agent membaca lewat role read-only yang sudah ada.
GRANT SELECT ON ai_kb_dokumen, ai_kb_potongan TO ai_readonly;

SELECT 'ai_kb_dokumen'  AS tabel, COUNT(*) AS baris FROM ai_kb_dokumen
UNION ALL
SELECT 'ai_kb_potongan', COUNT(*) FROM ai_kb_potongan;
