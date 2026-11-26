# Kamus Data — Database `marketing`

Ditulis manual. Berisi hal-hal yang **tidak bisa ditebak dari struktur tabel**:
arti istilah bisnis, rumus perhitungan, dan jebakan yang bikin query salah.

Struktur teknis lengkap (kolom, tipe, relasi) ada di [schema-auto.md](schema-auto.md).

## Konteks bisnis

Perusahaan produk kecantikan & jamu (Body Care, Face Care, Hair Care, Jamu, Make Up).
Jualan lewat dua jalur:

| Jalur | Siapa | Tabelnya |
|---|---|---|
| **B2B** | distributor, reseller, modern trade | `leads`, `lead_activity`, `sales_person`, `target_sales` |
| **B2C** | konsumen akhir (marketplace/sosmed) | `loyalty_point`, `customer_feedback`, `survey_response` |

**Rentang data: 1 Januari – 20 September 2026.** Kalau user tanya "bulan ini"
atau "tahun lalu", cek dulu apakah datanya ada; jangan asumsikan tanggal hari ini.

## ⚠️ Aturan wajib saat bikin query

Lima hal ini paling sering bikin angka salah:

**1. Omzet TIDAK ada di `sales_order`.**
Tabel `sales_order` cuma header — gak punya kolom total. Nilai penjualan ada di
`sales_order_line.subtotal` (sudah = `qty * harga - diskon`). Jadi omzet selalu
lewat JOIN ke `sales_order_line` lalu `SUM(subtotal)`.

**2. Selalu filter `sales_order.status = 'COMPLETED'`.**
Dari 1.928 order, 106 statusnya `CANCELLED`. Kalau tidak difilter, omzet
kelihatan lebih besar dari kenyataan. Status lain: `PROCESSING`, `SHIPPED`
(belum tuntas), `COMPLETED` (sah dihitung).

**3. `leads` itu jamak, tabel lain tunggal.**
`produk`, `customer`, `campaign`, `promo` — semua tunggal. Tapi `leads` pakai `s`.
Gampang salah ketik jadi `lead`.

**4. Budget ≠ biaya aktual.**
`campaign.budget` = rencana. `campaign_spend.biaya` = realisasi harian.
Untuk hitung ROI/ROAS pakai **`campaign_spend`**, bukan `budget`.

**5. `promo.nilai` artinya tergantung `promo.jenis`.**
`PERSEN` → angkanya persen (20 = diskon 20%). `NOMINAL` → rupiah.
`BUNDLING` → bukan potongan langsung. Jangan dijumlahkan campur.
Diskon yang benar-benar terpakai ada di `promo_usage.nilai_diskon`.

## Rumus istilah marketing

| Istilah | Rumus | Sumber |
|---|---|---|
| **Omzet / revenue / penjualan** | `SUM(sol.subtotal)` where order `COMPLETED` | `sales_order_line` |
| **AOV** (rata-rata nilai order) | omzet ÷ jumlah order | `sales_order` + line |
| **CTR** | `clicks / impressions` | sudah jadi di `campaign_performance.ctr` |
| **ROAS** | omzet teratribusi ÷ total `campaign_spend.biaya` | butuh 2 query / subquery |
| **CPL** (cost per lead) | total spend ÷ jumlah leads campaign itu | `campaign_spend` + `leads` |
| **Conversion rate leads** | leads `WON` ÷ total leads | `leads.status` |
| **Engagement rate** sosmed | `(likes + comments + shares) / reach` | `social_media_post` |
| **Open rate** email | `dibuka / terkirim` | `email_blast` |
| **Click rate** email | `diklik / terkirim` | `email_blast` |
| **Pencapaian target** | omzet sales ÷ `target_sales.target_rp` | per `periode` (YYYY-MM) |
| **Conversion rate web** | `transaksi / sessions` | `website_traffic` |

## Nilai enum yang dipakai

| Kolom | Isinya |
|---|---|
| `sales_order.status` | PROCESSING, SHIPPED, COMPLETED, CANCELLED |
| `campaign.status` | PLANNED, RUNNING, FINISHED |
| `campaign.tujuan` | Awareness, Leads, Sales, Launching |
| `leads.status` | NEW → CONTACTED → QUALIFIED → WON / LOST |
| `lead_activity.aktivitas` | CALL, WHATSAPP, EMAIL, MEETING, VISIT |
| `customer.tipe` | B2B (60 orang), B2C (260 orang) |
| `customer.segmen` | Distributor, Modern Trade, Reseller (B2B); Retail (B2C) |
| `produk.kategori` | Body Care, Face Care, Hair Care, Jamu, Make Up |
| `promo.jenis` | PERSEN, NOMINAL, BUNDLING |
| `channel.tipe` | Digital (IG, TikTok, Google Ads, Email, Website), Marketplace (Shopee, Tokopedia), Offline (Distributor, Modern Trade, Event/Pameran) |
| `loyalty_point.tier` | BRONZE, SILVER, GOLD, PLATINUM |
| `website_traffic.sumber` | Organic, Paid Search, Social, Direct, Email, Referral |
| `wilayah.region` | Jabodetabek, Jawa, Sumatera, Kalimantan, Sulawesi, Bali-NT |
| `survey_question.tipe` | SKALA (jawaban di `jawaban_skala` 1-5), TEKS (di `jawaban_teks`) |

## Peta tabel per topik

Kalau user tanya soal ini, lihat tabel ini:

| Pertanyaan tentang | Tabel utama |
|---|---|
| Penjualan, produk terlaris, omzet | `sales_order` + `sales_order_line` + `produk` |
| Performa iklan/kampanye | `campaign` + `campaign_performance` + `campaign_spend` |
| Sosial media, engagement | `social_media_post` |
| Email marketing | `email_blast` |
| Trafik website | `website_traffic` |
| Pipeline B2B, follow up sales | `leads` + `lead_activity` + `sales_person` |
| Target vs realisasi sales | `target_sales` + `sales_order` |
| Promo/voucher | `promo` + `promo_usage` |
| Kepuasan, keluhan customer | `customer_feedback`, `survey_response` |
| Wilayah/region | `wilayah` (join dari `customer` atau `sales_person`) |

## Kolom teks (cocok untuk vector search)

Sisanya angka semua. Yang berupa teks bebas cuma tiga:

- `customer_feedback.komentar` — ulasan & keluhan customer
- `lead_activity.catatan` — catatan hasil follow up sales
- `survey_response.jawaban_teks` — jawaban survei terbuka

Untuk pertanyaan macam "apa keluhan customer soal produk X",
pakai pencarian teks di kolom ini, bukan agregasi angka.

## Catatan kecil

- `loyalty_point` hanya untuk B2C; `leads` hanya untuk B2B.
- `sales_order.campaign_id` boleh NULL (order organik, tanpa atribusi kampanye).
- `target_sales` punya periode sampai `2026-12`, tapi data order baru sampai
  September. Bandingkan target vs realisasi hanya untuk bulan yang sudah jalan.
- `customer.jenis_kelamin` hanya terisi untuk B2C.
