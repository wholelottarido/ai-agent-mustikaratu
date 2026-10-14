-- ============================================================
-- Tahap 4: View ringkasan untuk pertanyaan yang sering muncul
-- ============================================================
-- Jalankan SEBAGAI ROOT (mkt_readonly sengaja tidak boleh CREATE VIEW):
--   mysql -u root -p marketing < db/03_create_views.sql
--
-- Tidak perlu GRANT tambahan: `GRANT SELECT ON marketing.*` yang sudah
-- diberikan ke mkt_readonly di 01_create_readonly_user.sql otomatis
-- mencakup view baru di database ini.
--
-- SQL SECURITY INVOKER dipakai di SEMUA view, bukan DEFINER (default MySQL).
-- Dengan DEFINER, view jalan dengan hak root -- kalau ada view yang salah
-- tulis, mkt_readonly bisa tembus ke hal yang seharusnya tidak boleh.
-- Dengan INVOKER, view jalan dengan hak pemanggilnya. mkt_readonly sudah
-- punya SELECT ke semua tabel di bawah, jadi tetap jalan tanpa melemahkan
-- pengaman berlapis.
-- ============================================================

USE marketing;

-- ------------------------------------------------------------
-- 1. v_penjualan -- view dasar, dipakai view lain di bawahnya.
--
-- Dua kesalahan paling sering saat nulis query penjualan:
--   (a) lupa filter status = 'COMPLETED'
--   (b) salah kolom JOIN (order_id, bukan sales_order_id)
-- Dua-duanya jadi MELEKAT di struktur view ini, tidak bisa lupa lagi.
-- ------------------------------------------------------------
CREATE OR REPLACE
  SQL SECURITY INVOKER
  VIEW v_penjualan AS
SELECT
  so.id                            AS order_id,
  so.no_order,
  so.tanggal,
  DATE_FORMAT(so.tanggal, '%Y-%m') AS periode,
  sol.qty,
  sol.harga,
  sol.diskon,
  sol.subtotal,
  p.id                             AS produk_id,
  p.nama                           AS produk,
  p.kategori                       AS produk_kategori,
  p.brand                          AS produk_brand,
  c.id                             AS customer_id,
  c.nama                           AS customer,
  c.tipe                           AS customer_tipe,
  c.segmen                         AS customer_segmen,
  ch.id                            AS channel_id,
  ch.nama                          AS channel,
  ch.tipe                          AS channel_tipe,
  sp.id                            AS sales_person_id,
  sp.nama                          AS sales_person,
  so.campaign_id,
  cmp.nama                         AS campaign,
  w.region                         AS region
FROM sales_order so
JOIN      sales_order_line sol ON sol.order_id = so.id
JOIN      produk p             ON p.id  = sol.produk_id
LEFT JOIN customer c           ON c.id  = so.customer_id
LEFT JOIN channel ch           ON ch.id = so.channel_id
LEFT JOIN sales_person sp      ON sp.id = so.sales_person_id
LEFT JOIN campaign cmp         ON cmp.id = so.campaign_id
LEFT JOIN wilayah w            ON w.id  = c.wilayah_id
WHERE so.status = 'COMPLETED';

-- ------------------------------------------------------------
-- 2. v_omzet_bulanan -- omzet, jumlah order, AOV per bulan.
--    COUNT(DISTINCT order_id), bukan COUNT(*): satu order punya
--    banyak baris detail.
-- ------------------------------------------------------------
CREATE OR REPLACE
  SQL SECURITY INVOKER
  VIEW v_omzet_bulanan AS
SELECT
  periode,
  COUNT(DISTINCT order_id)                               AS jml_order,
  SUM(subtotal)                                          AS omzet,
  ROUND(SUM(subtotal) / COUNT(DISTINCT order_id))        AS aov
FROM v_penjualan
GROUP BY periode;

-- ------------------------------------------------------------
-- 3. v_produk_bulanan -- qty & omzet per produk per bulan.
--    "Terlaris" bisa berarti qty atau omzet -- dua-duanya ada.
-- ------------------------------------------------------------
CREATE OR REPLACE
  SQL SECURITY INVOKER
  VIEW v_produk_bulanan AS
SELECT
  periode,
  produk_id,
  produk,
  produk_kategori,
  SUM(qty)                  AS qty,
  SUM(subtotal)             AS omzet,
  COUNT(DISTINCT order_id)  AS jml_order
FROM v_penjualan
GROUP BY periode, produk_id, produk, produk_kategori;

-- ------------------------------------------------------------
-- 4. v_kampanye_roas -- biaya vs omzet teratribusi per kampanye.
--
--    LEFT JOIN dua-duanya: kampanye tanpa spend ATAU tanpa omzet
--    tetap muncul (kalau INNER, kampanye gagal total malah hilang).
--    roas NULL kalau spend 0 -- jangan bagi nol.
--
--    PERINGATAN: cuma ~136 dari 1.781 order COMPLETED punya campaign_id.
--    Angka di view ini UNDER-ESTIMATE. Harus disampaikan ke user.
-- ------------------------------------------------------------
CREATE OR REPLACE
  SQL SECURITY INVOKER
  VIEW v_kampanye_roas AS
SELECT
  c.id                       AS campaign_id,
  c.nama                     AS campaign,
  c.tujuan,
  c.status,
  c.budget,
  COALESCE(s.spend, 0)       AS spend,
  COALESCE(o.omzet, 0)       AS omzet_teratribusi,
  COALESCE(o.jml_order, 0)   AS jml_order,
  CASE WHEN COALESCE(s.spend, 0) > 0
       THEN ROUND(COALESCE(o.omzet, 0) / s.spend, 2)
  END                        AS roas
FROM campaign c
LEFT JOIN (
  SELECT campaign_id, SUM(biaya) AS spend
    FROM campaign_spend
   GROUP BY campaign_id
) s ON s.campaign_id = c.id
LEFT JOIN (
  SELECT campaign_id,
         SUM(subtotal)            AS omzet,
         COUNT(DISTINCT order_id) AS jml_order
    FROM v_penjualan
   WHERE campaign_id IS NOT NULL
   GROUP BY campaign_id
) o ON o.campaign_id = c.id;

-- ------------------------------------------------------------
-- 5. v_target_vs_realisasi -- target vs omzet per sales per periode.
--
--    LEFT JOIN wajib: sales yang nol penjualan tetap harus muncul.
--    target_sales punya periode sampai 2026-12, tapi order baru
--    sampai September -- bulan yang belum jalan akan realisasi 0.
-- ------------------------------------------------------------
CREATE OR REPLACE
  SQL SECURITY INVOKER
  VIEW v_target_vs_realisasi AS
SELECT
  t.periode,
  sp.id                        AS sales_person_id,
  sp.nama                      AS sales_person,
  sp.aktif                     AS sales_aktif,
  t.target_rp,
  COALESCE(r.omzet, 0)         AS realisasi,
  CASE WHEN t.target_rp > 0
       THEN ROUND(COALESCE(r.omzet, 0) / t.target_rp * 100, 1)
  END                          AS pencapaian_persen
FROM target_sales t
JOIN sales_person sp ON sp.id = t.sales_person_id
LEFT JOIN (
  SELECT sales_person_id, periode, SUM(subtotal) AS omzet
    FROM v_penjualan
   GROUP BY sales_person_id, periode
) r ON r.sales_person_id = t.sales_person_id
   AND r.periode         = t.periode;

-- ------------------------------------------------------------
-- Cek hasil
-- ------------------------------------------------------------
SELECT TABLE_NAME AS view_dibuat, VIEW_DEFINITION IS NOT NULL AS ada
  FROM information_schema.VIEWS
 WHERE TABLE_SCHEMA = 'marketing'
 ORDER BY TABLE_NAME;
