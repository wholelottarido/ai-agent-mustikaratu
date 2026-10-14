# Skema Database `marketing` (auto-generated)

> Dibuat otomatis oleh `scripts/generate-schema-doc.mts` pada 2026-09-23. **Jangan edit manual** — jalankan `npm run gen:schema`.
> Penjelasan istilah bisnis ada di [kamus-data.md](kamus-data.md).

## Daftar tabel

| Tabel | Baris | Keterangan |
|---|---:|---|
| `_backup_teks_asli` | 2.125 | Isi kolom teks sebelum diganti oleh 04_komentar_realistis.sql |
| `campaign` | 13 | Kampanye marketing |
| `campaign_performance` | 711 | Performa kampanye harian |
| `campaign_spend` | 711 | Realisasi biaya kampanye per hari |
| `channel` | 10 | Channel marketing & penjualan |
| `customer` | 320 | Master customer |
| `customer_feedback` | 420 | Ulasan & keluhan customer |
| `email_blast` | 20 | Email marketing |
| `lead_activity` | 935 | Riwayat follow up lead |
| `leads` | 450 | Calon customer B2B (reseller/distributor/toko) |
| `loyalty_point` | 260 | Program loyalitas (customer B2C) |
| `produk` | 25 | Master produk |
| `promo` | 11 | Promo / voucher |
| `promo_usage` | 736 | Pemakaian promo per order |
| `sales_order` | 1.928 | Header order penjualan |
| `sales_order_line` | 4.814 | Detail order penjualan |
| `sales_person` | 13 | Tim sales / account |
| `social_media_post` | 260 | Konten media sosial dan performanya |
| `survey` | 2 | Master survei |
| `survey_question` | 7 | — |
| `survey_response` | 770 | Jawaban survei |
| `target_sales` | 144 | Target penjualan bulanan per sales |
| `website_traffic` | 1.578 | Trafik website harian per sumber |
| `wilayah` | 12 | Master wilayah |

## View ringkasan

Dibuat oleh `db/03_create_views.sql` (dijalankan sebagai root). Semua pakai `SQL SECURITY INVOKER`.

| View | Baris |
|---|---:|
| `v_kampanye_roas` | 13 |
| `v_omzet_bulanan` | 9 |
| `v_penjualan` | 4.435 |
| `v_produk_bulanan` | 218 |
| `v_target_vs_realisasi` | 144 |

## Relasi antar tabel

| Dari | Kolom | Ke |
|---|---|---|
| `campaign` | `channel_id` | `channel.id` |
| `campaign_performance` | `campaign_id` | `campaign.id` |
| `campaign_spend` | `campaign_id` | `campaign.id` |
| `customer` | `wilayah_id` | `wilayah.id` |
| `customer_feedback` | `channel_id` | `channel.id` |
| `customer_feedback` | `customer_id` | `customer.id` |
| `customer_feedback` | `produk_id` | `produk.id` |
| `email_blast` | `campaign_id` | `campaign.id` |
| `lead_activity` | `lead_id` | `leads.id` |
| `leads` | `campaign_id` | `campaign.id` |
| `leads` | `channel_id` | `channel.id` |
| `leads` | `customer_id` | `customer.id` |
| `leads` | `sales_person_id` | `sales_person.id` |
| `leads` | `wilayah_id` | `wilayah.id` |
| `loyalty_point` | `customer_id` | `customer.id` |
| `promo` | `campaign_id` | `campaign.id` |
| `promo_usage` | `customer_id` | `customer.id` |
| `promo_usage` | `order_id` | `sales_order.id` |
| `promo_usage` | `promo_id` | `promo.id` |
| `sales_order` | `campaign_id` | `campaign.id` |
| `sales_order` | `channel_id` | `channel.id` |
| `sales_order` | `customer_id` | `customer.id` |
| `sales_order` | `promo_id` | `promo.id` |
| `sales_order` | `sales_person_id` | `sales_person.id` |
| `sales_order_line` | `order_id` | `sales_order.id` |
| `sales_order_line` | `produk_id` | `produk.id` |
| `sales_person` | `wilayah_id` | `wilayah.id` |
| `social_media_post` | `campaign_id` | `campaign.id` |
| `social_media_post` | `produk_id` | `produk.id` |
| `survey_question` | `survey_id` | `survey.id` |
| `survey_response` | `customer_id` | `customer.id` |
| `survey_response` | `question_id` | `survey_question.id` |
| `survey_response` | `survey_id` | `survey.id` |
| `target_sales` | `sales_person_id` | `sales_person.id` |

## Detail kolom

### `_backup_teks_asli`

Isi kolom teks sebelum diganti oleh 04_komentar_realistis.sql. Jumlah baris: 2.125.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `tabel` | varchar(32) | tidak | PK | — |
| `id` | int | tidak | PK | — |
| `teks` | text | ya |  | — |

### `campaign`

Kampanye marketing. Jumlah baris: 13.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `kode` | varchar(20) | ya | unik | — |
| `nama` | varchar(100) | ya |  | — |
| `tujuan` | varchar(30) | ya |  | Awareness, Leads, Sales, Launching |
| `channel_id` | int | ya | FK → `channel` | FK channel.id |
| `tanggal_mulai` | date | ya |  | — |
| `tanggal_selesai` | date | ya |  | — |
| `budget` | decimal(14,2) | ya |  | Budget rencana (Rp) |
| `status` | varchar(15) | ya |  | PLANNED, RUNNING, FINISHED |

### `campaign_performance`

Performa kampanye harian. Jumlah baris: 711.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `campaign_id` | int | ya | FK → `campaign` | — |
| `tanggal` | date | ya |  | — |
| `impressions` | int | ya |  | — |
| `clicks` | int | ya |  | — |
| `ctr` | decimal(6,4) | ya |  | clicks / impressions |
| `leads` | int | ya |  | — |
| `konversi` | int | ya |  | Jumlah order yang teratribusi |

### `campaign_spend`

Realisasi biaya kampanye per hari. Jumlah baris: 711.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `campaign_id` | int | ya | FK → `campaign` | — |
| `tanggal` | date | ya |  | — |
| `biaya` | decimal(14,2) | ya |  | Biaya aktual harian (Rp) |

### `channel`

Channel marketing & penjualan. Jumlah baris: 10.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `nama` | varchar(50) | ya |  | — |
| `tipe` | varchar(20) | ya |  | Digital, Marketplace, Offline |

### `customer`

Master customer. Jumlah baris: 320.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `kode` | varchar(20) | ya | unik | — |
| `nama` | varchar(100) | ya |  | — |
| `email` | varchar(100) | ya |  | — |
| `telepon` | varchar(20) | ya |  | — |
| `wilayah_id` | int | ya | FK → `wilayah` | FK wilayah.id |
| `tipe` | varchar(5) | ya |  | B2B atau B2C |
| `segmen` | varchar(30) | ya |  | B2B: Distributor, Modern Trade, Reseller. B2C: Retail |
| `jenis_kelamin` | char(1) | ya |  | L/P, hanya B2C |
| `tanggal_daftar` | date | ya |  | — |

### `customer_feedback`

Ulasan & keluhan customer. Jumlah baris: 420.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `customer_id` | int | ya | FK → `customer` | — |
| `produk_id` | int | ya | FK → `produk` | — |
| `channel_id` | int | ya | FK → `channel` | Asal ulasan |
| `tanggal` | date | ya |  | — |
| `rating` | tinyint | ya |  | 1-5 |
| `komentar` | text | ya |  | Ulasan bebas customer (cocok untuk vector search) |

### `email_blast`

Email marketing. Jumlah baris: 20.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `subjek` | varchar(150) | ya |  | — |
| `tanggal_kirim` | date | ya |  | — |
| `campaign_id` | int | ya | FK → `campaign` | — |
| `terkirim` | int | ya |  | — |
| `dibuka` | int | ya |  | — |
| `diklik` | int | ya |  | — |
| `unsubscribe` | int | ya |  | — |

### `lead_activity`

Riwayat follow up lead. Jumlah baris: 935.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `lead_id` | int | ya | FK → `leads` | — |
| `tanggal` | date | ya |  | — |
| `aktivitas` | varchar(15) | ya |  | CALL, WHATSAPP, EMAIL, MEETING, VISIT |
| `catatan` | text | ya |  | Catatan bebas hasil follow up |

### `leads`

Calon customer B2B (reseller/distributor/toko). Jumlah baris: 450.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `nama` | varchar(100) | ya |  | — |
| `perusahaan` | varchar(100) | ya |  | — |
| `telepon` | varchar(20) | ya |  | — |
| `email` | varchar(100) | ya |  | — |
| `wilayah_id` | int | ya | FK → `wilayah` | — |
| `campaign_id` | int | ya | FK → `campaign` | Sumber kampanye |
| `channel_id` | int | ya | FK → `channel` | Sumber channel |
| `sales_person_id` | int | ya | FK → `sales_person` | PIC follow up |
| `tanggal` | date | ya |  | Tanggal lead masuk |
| `status` | varchar(15) | ya |  | NEW, CONTACTED, QUALIFIED, WON, LOST |
| `customer_id` | int | ya | FK → `customer` | Terisi jika lead WON menjadi customer |

### `loyalty_point`

Program loyalitas (customer B2C). Jumlah baris: 260.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `customer_id` | int | tidak | PK | — |
| `total_poin` | int | ya |  | — |
| `poin_terpakai` | int | ya |  | — |
| `tier` | varchar(10) | ya |  | BRONZE, SILVER, GOLD, PLATINUM |
| `updated_at` | date | ya |  | — |

### `produk`

Master produk. Jumlah baris: 25.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `kode` | varchar(20) | ya | unik | — |
| `nama` | varchar(100) | ya |  | — |
| `kategori` | varchar(30) | ya |  | Body Care, Face Care, Hair Care, Jamu, Make Up |
| `brand` | varchar(30) | ya |  | — |
| `harga` | decimal(12,2) | ya |  | Harga jual normal per pcs (Rp) |
| `tanggal_launch` | date | ya |  | — |

### `promo`

Promo / voucher. Jumlah baris: 11.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `kode_voucher` | varchar(20) | ya | unik | — |
| `nama` | varchar(100) | ya |  | — |
| `jenis` | varchar(15) | ya |  | PERSEN, NOMINAL, BUNDLING |
| `nilai` | decimal(12,2) | ya |  | Persen (mis. 20) atau nominal Rp |
| `campaign_id` | int | ya | FK → `campaign` | FK campaign.id (opsional) |
| `tanggal_mulai` | date | ya |  | — |
| `tanggal_selesai` | date | ya |  | — |
| `kuota` | int | ya |  | — |

### `promo_usage`

Pemakaian promo per order. Jumlah baris: 736.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `promo_id` | int | ya | FK → `promo` | — |
| `order_id` | int | ya | FK → `sales_order` | — |
| `customer_id` | int | ya | FK → `customer` | — |
| `nilai_diskon` | decimal(12,2) | ya |  | — |

### `sales_order`

Header order penjualan. Jumlah baris: 1.928.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `no_order` | varchar(20) | ya | unik | — |
| `customer_id` | int | ya | FK → `customer` | — |
| `sales_person_id` | int | ya | FK → `sales_person` | — |
| `channel_id` | int | ya | FK → `channel` | — |
| `campaign_id` | int | ya | FK → `campaign` | Atribusi kampanye (jika ada) |
| `promo_id` | int | ya | FK → `promo` | — |
| `tanggal` | date | ya |  | — |
| `status` | varchar(15) | ya |  | PROCESSING, SHIPPED, COMPLETED, CANCELLED |

### `sales_order_line`

Detail order penjualan. Jumlah baris: 4.814.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `order_id` | int | ya | FK → `sales_order` | — |
| `produk_id` | int | ya | FK → `produk` | — |
| `qty` | int | ya |  | — |
| `harga` | decimal(12,2) | ya |  | Harga per pcs sebelum diskon |
| `diskon` | decimal(12,2) | ya |  | Total diskon baris (Rp) |
| `subtotal` | decimal(14,2) | ya |  | qty*harga - diskon |

### `sales_person`

Tim sales / account. Jumlah baris: 13.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `nama` | varchar(100) | ya |  | — |
| `wilayah_id` | int | ya | FK → `wilayah` | FK wilayah.id (area tanggung jawab) |
| `email` | varchar(100) | ya |  | — |
| `aktif` | tinyint(1) | ya |  | — |

### `social_media_post`

Konten media sosial dan performanya. Jumlah baris: 260.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `platform` | varchar(15) | ya |  | Instagram, TikTok, Facebook, YouTube |
| `tanggal` | date | ya |  | — |
| `jenis_konten` | varchar(20) | ya |  | Reels, Carousel, Video, Live, Story |
| `judul` | varchar(150) | ya |  | — |
| `produk_id` | int | ya | FK → `produk` | — |
| `campaign_id` | int | ya | FK → `campaign` | — |
| `reach` | int | ya |  | — |
| `likes` | int | ya |  | — |
| `comments` | int | ya |  | — |
| `shares` | int | ya |  | — |

### `survey`

Master survei. Jumlah baris: 2.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `judul` | varchar(150) | ya |  | — |
| `tanggal_mulai` | date | ya |  | — |
| `tanggal_selesai` | date | ya |  | — |

### `survey_question`

Jumlah baris: 7.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `survey_id` | int | ya | FK → `survey` | — |
| `pertanyaan` | varchar(255) | ya |  | — |
| `tipe` | varchar(10) | ya |  | SKALA (1-5) atau TEKS |

### `survey_response`

Jawaban survei. Jumlah baris: 770.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `survey_id` | int | ya | FK → `survey` | — |
| `question_id` | int | ya | FK → `survey_question` | — |
| `customer_id` | int | ya | FK → `customer` | — |
| `tanggal` | date | ya |  | — |
| `jawaban_skala` | tinyint | ya |  | — |
| `jawaban_teks` | text | ya |  | — |

### `target_sales`

Target penjualan bulanan per sales. Jumlah baris: 144.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `periode` | char(7) | ya |  | YYYY-MM |
| `sales_person_id` | int | ya | FK → `sales_person` | — |
| `target_rp` | decimal(14,2) | ya |  | — |

### `website_traffic`

Trafik website harian per sumber. Jumlah baris: 1.578.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `tanggal` | date | ya |  | — |
| `sumber` | varchar(20) | ya |  | Organic, Paid Search, Social, Direct, Email, Referral |
| `sessions` | int | ya |  | — |
| `users` | int | ya |  | — |
| `bounce_rate` | decimal(5,2) | ya |  | Persen |
| `transaksi` | int | ya |  | — |

### `wilayah`

Master wilayah. Jumlah baris: 12.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `provinsi` | varchar(50) | ya |  | — |
| `kota` | varchar(50) | ya |  | — |
| `region` | varchar(20) | ya |  | Jabodetabek, Jawa, Sumatera, Kalimantan, Sulawesi, Bali-NT |

### `v_kampanye_roas`

Jumlah baris: 13.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `campaign_id` | int | tidak |  | — |
| `campaign` | varchar(100) | ya |  | — |
| `tujuan` | varchar(30) | ya |  | Awareness, Leads, Sales, Launching |
| `status` | varchar(15) | ya |  | PLANNED, RUNNING, FINISHED |
| `budget` | decimal(14,2) | ya |  | Budget rencana (Rp) |
| `spend` | decimal(36,2) | tidak |  | — |
| `omzet_teratribusi` | decimal(36,2) | tidak |  | — |
| `jml_order` | bigint | tidak |  | — |
| `roas` | decimal(39,2) | ya |  | — |

### `v_omzet_bulanan`

Jumlah baris: 9.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `periode` | varchar(7) | ya |  | — |
| `jml_order` | bigint | tidak |  | — |
| `omzet` | decimal(36,2) | ya |  | — |
| `aov` | decimal(35,0) | ya |  | — |

### `v_penjualan`

Jumlah baris: 4.435.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `order_id` | int | tidak |  | — |
| `no_order` | varchar(20) | ya |  | — |
| `tanggal` | date | ya |  | — |
| `periode` | varchar(7) | ya |  | — |
| `qty` | int | ya |  | — |
| `harga` | decimal(12,2) | ya |  | Harga per pcs sebelum diskon |
| `diskon` | decimal(12,2) | ya |  | Total diskon baris (Rp) |
| `subtotal` | decimal(14,2) | ya |  | qty*harga - diskon |
| `produk_id` | int | tidak |  | — |
| `produk` | varchar(100) | ya |  | — |
| `produk_kategori` | varchar(30) | ya |  | Body Care, Face Care, Hair Care, Jamu, Make Up |
| `produk_brand` | varchar(30) | ya |  | — |
| `customer_id` | int | ya |  | — |
| `customer` | varchar(100) | ya |  | — |
| `customer_tipe` | varchar(5) | ya |  | B2B atau B2C |
| `customer_segmen` | varchar(30) | ya |  | B2B: Distributor, Modern Trade, Reseller. B2C: Retail |
| `channel_id` | int | ya |  | — |
| `channel` | varchar(50) | ya |  | — |
| `channel_tipe` | varchar(20) | ya |  | Digital, Marketplace, Offline |
| `sales_person_id` | int | ya |  | — |
| `sales_person` | varchar(100) | ya |  | — |
| `campaign_id` | int | ya |  | Atribusi kampanye (jika ada) |
| `campaign` | varchar(100) | ya |  | — |
| `region` | varchar(20) | ya |  | Jabodetabek, Jawa, Sumatera, Kalimantan, Sulawesi, Bali-NT |

### `v_produk_bulanan`

Jumlah baris: 218.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `periode` | varchar(7) | ya |  | — |
| `produk_id` | int | tidak |  | — |
| `produk` | varchar(100) | ya |  | — |
| `produk_kategori` | varchar(30) | ya |  | Body Care, Face Care, Hair Care, Jamu, Make Up |
| `qty` | decimal(32,0) | ya |  | — |
| `omzet` | decimal(36,2) | ya |  | — |
| `jml_order` | bigint | tidak |  | — |

### `v_target_vs_realisasi`

Jumlah baris: 144.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `periode` | char(7) | ya |  | YYYY-MM |
| `sales_person_id` | int | tidak |  | — |
| `sales_person` | varchar(100) | ya |  | — |
| `sales_aktif` | tinyint(1) | ya |  | — |
| `target_rp` | decimal(14,2) | ya |  | — |
| `realisasi` | decimal(36,2) | tidak |  | — |
| `pencapaian_persen` | decimal(41,1) | ya |  | — |
