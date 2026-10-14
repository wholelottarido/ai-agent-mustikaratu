-- ============================================================
-- v_asisten_penjualan — penjualan BA (Beauty Advisor)
-- ============================================================
-- Jalankan SEBAGAI ADMIN PostgreSQL (DEMO_PG_ADMIN_USER), bukan ai_readonly:
--   psql -h <host> -U <admin> -d mustika_ratu_dev -f db/demo-pg/03_view_penjualan.sql
--
-- Sumbernya `trx_ba_sales`: 4,2 juta baris, 2010–2026. Satu baris = satu
-- produk terjual oleh satu BA di satu outlet pada satu tanggal.
--
-- ============================================================
-- KENAPA VIEW INI TIDAK DISARING PER ORANG
-- ============================================================
-- Lima view `v_asisten_*` yang lebih dulu ada disaring per karyawan lewat CTE
-- `WHERE id_employee = <yang login>`. View ini TIDAK BISA begitu.
--
-- `trx_ba_sales.id_employee` ADA, tapi praktis kosong — diperiksa pada data
-- setahun terakhir:
--
--     289.836 baris  ->  id_employee terisi:      11  (0,004%)
--                        nilai unik:               2
--                        ba_code terisi:     289.836  (100%)
--
-- Jadi penanda BA yang sebenarnya `ba_code` (139 unik), bukan `id_employee`.
-- Kalau view ini dipaksa disaring pakai `id_employee`, hasilnya KOSONG untuk
-- hampir semua orang.
--
-- ⚠️ Itu sebabnya `id_employee` SENGAJA TIDAK IKUT di bawah. Kolom yang
-- terisi 0,004% cuma mengundang model menyaring dengannya lalu bingung kenapa
-- hasilnya nol — persis seperti `asset.id_type` yang cocok 0 dari 585 dan
-- karena itu dibuang dari `v_asisten_aset`.
--
-- Penjaganya gerbang DEPARTEMEN di `voltagent/perusahaan/view-perusahaan.ts`:
-- cuma pengguna marketing yang diberi view ini. Artinya satu pengguna
-- marketing melihat penjualan SELURUH 139 BA, bukan miliknya sendiri.
--
-- ============================================================
-- KECOCOKAN KAITAN — SUDAH DIUKUR, BUKAN DIANDAIKAN
-- ============================================================
-- Diperiksa pada 289.836 baris setahun terakhir:
--
--     customer  (outlet)   289.836   100%
--     area      (wilayah)  289.828   100%
--     product   (produk)   285.958   98,7%
--     kategori             265.907   91,7%
--
-- Semua LEFT JOIN, jadi baris yang rujukannya tidak ketemu tetap muncul
-- dengan kolom itu NULL — bukan hilang dari hasil.
--
-- ============================================================
-- ⚠️ BARIS "TIDAK JUALAN" DIKELUARKAN
-- ============================================================
-- 3.873 baris setahun terakhir punya `qty <= 0` DAN `price <= 0`. Baris itu
-- bukan penjualan: itu catatan kehadiran, dan `reason_code`-nya terisi persis
-- di baris-baris itu saja (0 di baris penjualan):
--
--     1 Tidak Ada Penjualan   2 Off Regular   3 Sakit   4 Izin
--     5 Cuti                  6 Meeting       7 Toko Tutup
--
-- `qty`-nya TEPAT 0, tidak ada yang negatif (diperiksa: min 0, maks 0). Jadi
-- mengeluarkannya TIDAK mengubah SUM(nilai) sama sekali — yang dibetulkan
-- cuma COUNT dan rata-rata, yang kalau baris itu ikut jadi terlalu rendah.
-- Jadi `WHERE s.qty > 0`.
--
-- Konsekuensinya: pertanyaan "kenapa BA X tidak jualan" TIDAK bisa dijawab
-- dari view ini. Itu disebut di kamus data supaya model bilang datanya tidak
-- ada di sini, bukan mengarang.
-- ============================================================

CREATE OR REPLACE VIEW v_asisten_penjualan AS
SELECT
    s.trx_date                      AS tanggal,
    s.ba_code                       AS kode_ba,
    s.ba_name                       AS nama_ba,
    cu.customer_name                AS outlet,
    s.customer_code                 AS kode_outlet,
    a.area                          AS wilayah,
    p.name                          AS produk,
    s.item_code                     AS kode_produk,
    pc.name                         AS kategori,
    s.qty                           AS qty,
    s.price                         AS harga,
    (s.qty * s.price)               AS nilai
FROM trx_ba_sales s
LEFT JOIN customer         cu ON cu.id_customer         = s.id_customer
LEFT JOIN area             a  ON a.id                   = s.id_area
LEFT JOIN product          p  ON p.id_product           = s.id_product
LEFT JOIN product_category pc ON pc.id_product_category = p.id_product_category
WHERE s.qty > 0;

-- GRANT eksplisit, walau sebenarnya MUBAZIR.
--
-- ⚠️ KOREKSI (30 Sep 2026): baris ini dulu dijelaskan sebagai keharusan,
-- karena `ALTER DEFAULT PRIVILEGES` dikira cuma mencakup TABLES. Itu keliru --
-- di PostgreSQL, TABLES berarti RELASI dan view termasuk. ai_readonly
-- sebenarnya sudah otomatis bisa membaca view ini.
--
-- Barisnya tetap dipertahankan karena izin yang tertulis jelas lebih mudah
-- diperiksa daripada izin yang diwarisi diam-diam.
GRANT SELECT ON v_asisten_penjualan TO ai_readonly;

-- Bukti bahwa isinya masuk akal, dicetak begitu skrip ini selesai.
--
-- Badan view-nya sudah dijalankan sebagai SELECT biasa sebelum berkas ini
-- dibuat, jadi angka di bawah ini yang HARUS keluar. Kalau beda jauh, jangan
-- diteruskan — berarti ada yang berubah di tabel sumbernya:
--
--     baris          4.143.122
--     jumlah_ba          1.934
--     jumlah_outlet      1.819
--     paling_awal   2010-10-20
--     paling_akhir  2026-09-20
--     total_nilai  412.053.102.411
--
-- ⚠️ Angka 1.934 BA itu SEPANJANG SEJARAH. Setahun terakhir cuma 139 BA yang
-- aktif dan 397 outlet — beda jauh, dan itu yang relevan untuk pertanyaan
-- sehari-hari.
SELECT
    COUNT(*)                          AS baris,
    COUNT(DISTINCT kode_ba)           AS jumlah_ba,
    COUNT(DISTINCT kode_outlet)       AS jumlah_outlet,
    MIN(tanggal)                      AS paling_awal,
    MAX(tanggal)                      AS paling_akhir,
    SUM(nilai)::numeric(18,0)         AS total_nilai
FROM v_asisten_penjualan;
