/**
 * Kamus data yang ditempel ke instructions agent.
 *
 * Kenapa ditempel, bukan diambil lewat tool: di versi OpenClaw agent harus
 * memanggil tool skema dulu tiap pertanyaan — satu putaran model terbuang.
 * Dengan ditempel, pertanyaan sederhana cukup 1 tool call.
 *
 * Ini RINGKASAN. Sumber lengkapnya:
 *   docs/schema-auto.md   — struktur teknis (di-generate, `npm run gen:schema`)
 *   docs/kamus-data.md    — istilah bisnis & jebakan query
 *   docs/contoh-query.md  — 12 pasang pertanyaan->SQL yang sudah dites
 *
 * Kalau skema database berubah: jalankan `npm run gen:schema`, lalu
 * samakan daftar tabel di bawah dengan hasilnya.
 */

export const KAMUS_DATA = `
## Daftar tabel (database \`marketing\`, 23 tabel)

| Tabel | Baris | Isi |
|---|---|---|
| campaign | 13 | Kampanye marketing |
| campaign_performance | 711 | Performa kampanye harian (impressions, clicks, ctr) |
| campaign_spend | 711 | Realisasi biaya kampanye per hari |
| channel | 10 | Channel marketing & penjualan |
| customer | 320 | Master customer |
| customer_feedback | 420 | Ulasan & keluhan customer |
| email_blast | 20 | Email marketing |
| lead_activity | 935 | Riwayat follow up lead |
| leads | 450 | Calon customer B2B |
| loyalty_point | 260 | Program loyalitas (B2C) |
| produk | 25 | Master produk |
| promo | 11 | Promo / voucher |
| promo_usage | 736 | Pemakaian promo per order |
| sales_order | 1.928 | Header order (TIDAK punya kolom total) |
| sales_order_line | 4.814 | Detail order — nilai penjualan ada di sini |
| sales_person | 13 | Tim sales |
| social_media_post | 260 | Konten sosmed + performanya |
| survey | 2 | Master survei |
| survey_question | 7 | Pertanyaan survei |
| survey_response | 770 | Jawaban survei |
| target_sales | 144 | Target penjualan bulanan per sales |
| website_traffic | 1.578 | Trafik website harian per sumber |
| wilayah | 12 | Master wilayah |

## View ringkasan -- PAKAI INI DULU kalau cocok

Lima view ini sudah menjahitkan JOIN dan filter \`status='COMPLETED'\` di dalamnya.
Kalau pertanyaan user cocok dengan salah satunya, **query ke view, jangan ke tabel mentah** --
lebih pendek, lebih cepat, dan tidak mungkin lupa filter status.

| View | Isi | Pakai untuk |
|---|---|---|
| \`v_penjualan\` | Baris order detail + produk + customer + channel + sales + campaign + region. Sudah COMPLETED-only | Pertanyaan penjualan apa pun yang butuh potong-potong sendiri |
| \`v_omzet_bulanan\` | periode, jml_order, omzet, aov | "omzet per bulan", "bulan terbaik", AOV |
| \`v_produk_bulanan\` | periode, produk, produk_kategori, qty, omzet, jml_order | "produk terlaris", "produk per kategori" |
| \`v_kampanye_roas\` | campaign, tujuan, status, budget, spend, omzet_teratribusi, jml_order, roas | "kampanye mana ROAS terbaik", "biaya vs hasil" |
| \`v_target_vs_realisasi\` | periode, sales_person, target_rp, realisasi, pencapaian_persen | "sales mana capai target" |

Kolom \`v_penjualan\`: order_id, no_order, tanggal, periode, qty, harga, diskon, subtotal,
produk_id, produk, produk_kategori, produk_brand, customer_id, customer, customer_tipe,
customer_segmen, channel_id, channel, channel_tipe, sales_person_id, sales_person,
campaign_id, campaign, region.

\`periode\` sudah berformat 'YYYY-MM' -- tidak perlu DATE_FORMAT lagi.
Contoh: \`SELECT produk, qty, omzet FROM v_produk_bulanan WHERE periode='2026-08' ORDER BY omzet DESC LIMIT 10\`

Catatan \`v_kampanye_roas\`: kolom \`roas\` NULL kalau \`spend\` 0 (bukan dibagi nol).
Tetap sebutkan batas atribusi (136 dari 1.781 order) waktu menjawab.

Untuk pertanyaan di luar kelima view itu (sosmed, email, trafik web, leads,
promo, feedback, survei), query langsung ke tabel di bawah.

## Kolom tiap tabel (nama persis -- JANGAN ditebak)

campaign: id, kode, nama, tujuan, channel_id, tanggal_mulai, tanggal_selesai, budget, status
campaign_performance: id, campaign_id, tanggal, impressions, clicks, ctr, leads, konversi
campaign_spend: id, campaign_id, tanggal, biaya
channel: id, nama, tipe
customer: id, kode, nama, email, telepon, wilayah_id, tipe, segmen, jenis_kelamin, tanggal_daftar
customer_feedback: id, customer_id, produk_id, channel_id, tanggal, rating, komentar
email_blast: id, subjek, tanggal_kirim, campaign_id, terkirim, dibuka, diklik, unsubscribe
lead_activity: id, lead_id, tanggal, aktivitas, catatan
leads: id, nama, perusahaan, telepon, email, wilayah_id, campaign_id, channel_id, sales_person_id, tanggal, status, customer_id
loyalty_point: customer_id, total_poin, poin_terpakai, tier, updated_at
produk: id, kode, nama, kategori, brand, harga, tanggal_launch
promo: id, kode_voucher, nama, jenis, nilai, campaign_id, tanggal_mulai, tanggal_selesai, kuota
promo_usage: id, promo_id, order_id, customer_id, nilai_diskon
sales_order: id, no_order, customer_id, sales_person_id, channel_id, campaign_id, promo_id, tanggal, status
sales_order_line: id, order_id, produk_id, qty, harga, diskon, subtotal
sales_person: id, nama, wilayah_id, email, aktif
social_media_post: id, platform, tanggal, jenis_konten, judul, produk_id, campaign_id, reach, likes, comments, shares
survey: id, judul, tanggal_mulai, tanggal_selesai
survey_question: id, survey_id, pertanyaan, tipe
survey_response: id, survey_id, question_id, customer_id, tanggal, jawaban_skala, jawaban_teks
target_sales: id, periode, sales_person_id, target_rp
website_traffic: id, tanggal, sumber, sessions, users, bounce_rate, transaksi
wilayah: id, provinsi, kota, region

Kolom yang gampang salah tebak:
- \`produk.nama\` (BUKAN nama_produk) -- semua master pakai \`nama\`
- \`sales_order_line.order_id\` (BUKAN sales_order_id)
- \`sales_order.tanggal\` (BUKAN tanggal_order atau tanggal_transaksi)
- \`promo.kode_voucher\` (BUKAN kode)

## Pola JOIN baku untuk pertanyaan penjualan

Hampir semua pertanyaan omzet/produk/channel berangkat dari pola ini:

\`\`\`sql
FROM sales_order so
JOIN sales_order_line sol ON sol.order_id = so.id
JOIN produk p             ON p.id = sol.produk_id
WHERE so.status = 'COMPLETED'
\`\`\`

Filter bulan: \`DATE_FORMAT(so.tanggal, '%Y-%m') = '2026-08'\`
Hitung order: \`COUNT(DISTINCT so.id)\` -- BUKAN \`COUNT(*)\`, karena sudah di-JOIN ke baris detail.

## 5 aturan WAJIB saat bikin query

1. **Omzet TIDAK ada di \`sales_order\`.** Header itu tidak punya kolom total.
   Nilai penjualan ada di \`sales_order_line.subtotal\` (sudah = qty x harga - diskon).
   Omzet selalu lewat JOIN ke \`sales_order_line\` lalu \`SUM(subtotal)\`.
2. **Selalu filter \`sales_order.status = 'COMPLETED'\`.** Dari 1.928 order,
   106 statusnya CANCELLED. Tanpa filter, omzet kelihatan lebih besar dari kenyataan.
3. **\`leads\` itu jamak**, tabel lain tunggal (\`produk\`, \`customer\`, \`campaign\`, \`promo\`).
4. **Budget != biaya aktual.** \`campaign.budget\` = rencana; \`campaign_spend.biaya\` = realisasi.
   ROI/ROAS pakai \`campaign_spend\`.
5. **\`promo.nilai\` tergantung \`promo.jenis\`** (PERSEN / NOMINAL / BUNDLING) — jangan dijumlah campur.
   Diskon yang benar-benar terpakai ada di \`promo_usage.nilai_diskon\`.

## Rumus istilah

| Istilah | Rumus |
|---|---|
| Omzet / revenue / penjualan | SUM(sol.subtotal) where order COMPLETED |
| AOV | omzet / jumlah order |
| CTR | sudah jadi di campaign_performance.ctr |
| ROAS | omzet teratribusi / SUM(campaign_spend.biaya) |
| CPL | total spend / jumlah leads campaign itu |
| Conversion rate leads | leads WON / total leads |
| Engagement rate sosmed | (likes + comments + shares) / reach |
| Open rate email | dibuka / terkirim |
| Pencapaian target | omzet sales / target_sales.target_rp (per periode YYYY-MM) |
| Conversion rate web | transaksi / sessions |

## Nilai enum

- sales_order.status: PROCESSING, SHIPPED, COMPLETED, CANCELLED
- campaign.status: PLANNED, RUNNING, FINISHED — campaign.tujuan: Awareness, Leads, Sales, Launching
- leads.status: NEW -> CONTACTED -> QUALIFIED -> WON / LOST
- lead_activity.aktivitas: CALL, WHATSAPP, EMAIL, MEETING, VISIT
- customer.tipe: B2B (60), B2C (260) — customer.segmen: Distributor, Modern Trade, Reseller, Retail
- produk.kategori: Body Care, Face Care, Hair Care, Jamu, Make Up
- promo.jenis: PERSEN, NOMINAL, BUNDLING
- loyalty_point.tier: BRONZE, SILVER, GOLD, PLATINUM
- website_traffic.sumber: Organic, Paid Search, Social, Direct, Email, Referral
- wilayah.region: Jabodetabek, Jawa, Sumatera, Kalimantan, Sulawesi, Bali-NT
- survey_question.tipe: SKALA (jawaban_skala 1-5), TEKS (jawaban_teks)

## Peta topik -> tabel

| Ditanya soal | Pakai tabel |
|---|---|
| Penjualan, produk terlaris, omzet | sales_order + sales_order_line + produk |
| Performa iklan/kampanye | campaign + campaign_performance + campaign_spend |
| Sosial media, engagement | social_media_post |
| Email marketing | email_blast |
| Trafik website | website_traffic |
| Pipeline B2B, follow up sales | leads + lead_activity + sales_person |
| Target vs realisasi | target_sales + sales_order |
| Promo/voucher | promo + promo_usage |
| Kepuasan/keluhan customer | customer_feedback, survey_response |
| Wilayah/region | wilayah (join dari customer atau sales_person) |

## Jebakan waktu

- **Rentang data: 1 Januari - 20 September 2026.** Kalau user tanya "bulan ini"
  atau "tahun lalu", cek dulu datanya ada atau tidak. Jangan asumsikan tanggal hari ini.
- \`target_sales\` punya periode sampai 2026-12, tapi order baru sampai September.
  Bandingkan target vs realisasi hanya untuk bulan yang sudah jalan.
- Hanya 136 dari 1.781 order COMPLETED yang punya \`campaign_id\`. Kalau menghitung
  ROAS/atribusi kampanye, SEBUTKAN keterbatasan ini di jawaban.
- \`loyalty_point\` hanya B2C; \`leads\` hanya B2B. \`customer.jenis_kelamin\` hanya terisi untuk B2C.
`.trim();
