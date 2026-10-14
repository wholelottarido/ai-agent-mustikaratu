# Contoh Pertanyaan → SQL

Contekan untuk agent. Semua query di bawah **sudah dites** di database `marketing`
dan menghasilkan angka yang benar. Pola JOIN-nya bisa ditiru untuk pertanyaan sejenis.

Baca dulu [kamus-data.md](kamus-data.md) — terutama bagian "Aturan wajib".

---

### 1. "Produk apa yang paling laris?"

```sql
SELECT p.nama, SUM(sol.qty) AS qty, SUM(sol.subtotal) AS omzet
FROM sales_order_line sol
JOIN sales_order so ON so.id = sol.order_id
JOIN produk p       ON p.id = sol.produk_id
WHERE so.status = 'COMPLETED'
GROUP BY p.id, p.nama
ORDER BY omzet DESC
LIMIT 10;
```

Catatan: "terlaris" bisa berarti qty terbanyak atau omzet terbesar — beda hasilnya.
Kalau user tidak menyebut, tampilkan dua-duanya seperti di atas.

### 2. "Berapa omzet per bulan?"

```sql
SELECT DATE_FORMAT(so.tanggal, '%Y-%m') AS bulan,
       COUNT(DISTINCT so.id)            AS jml_order,
       SUM(sol.subtotal)                AS omzet,
       ROUND(SUM(sol.subtotal) / COUNT(DISTINCT so.id)) AS aov
FROM sales_order so
JOIN sales_order_line sol ON sol.order_id = so.id
WHERE so.status = 'COMPLETED'
GROUP BY bulan
ORDER BY bulan
LIMIT 24;
```

`COUNT(DISTINCT so.id)` — bukan `COUNT(*)`. Karena sudah di-JOIN ke baris detail,
satu order muncul berkali-kali.

### 3. "Channel mana yang omzetnya paling besar?"

```sql
SELECT ch.nama, ch.tipe,
       COUNT(DISTINCT so.id) AS jml_order,
       SUM(sol.subtotal)     AS omzet
FROM sales_order so
JOIN sales_order_line sol ON sol.order_id = so.id
JOIN channel ch           ON ch.id = so.channel_id
WHERE so.status = 'COMPLETED'
GROUP BY ch.id, ch.nama, ch.tipe
ORDER BY omzet DESC
LIMIT 10;
```

### 4. "Kampanye mana yang ROAS-nya paling bagus?"

```sql
SELECT c.nama, s.spend, o.omzet, ROUND(o.omzet / s.spend, 2) AS roas
FROM campaign c
JOIN (SELECT campaign_id, SUM(biaya) AS spend
        FROM campaign_spend GROUP BY campaign_id) s ON s.campaign_id = c.id
JOIN (SELECT so.campaign_id, SUM(sol.subtotal) AS omzet
        FROM sales_order so
        JOIN sales_order_line sol ON sol.order_id = so.id
       WHERE so.status = 'COMPLETED' AND so.campaign_id IS NOT NULL
       GROUP BY so.campaign_id) o ON o.campaign_id = c.id
ORDER BY roas DESC
LIMIT 10;
```

⚠️ **Wajib disampaikan ke user:** cuma 136 dari 1.781 order (7,6%) yang punya
`campaign_id`. Sisanya organik/tanpa atribusi. Jadi ROAS di sini
**bukan ROAS sebenarnya** — angkanya terlihat rendah karena banyak penjualan
tidak terhubung ke kampanye. Sampaikan ini sebagai catatan, jangan cuma kasih angka.

### 5. "Sales mana yang capai target bulan Agustus?"

```sql
SELECT sp.nama, t.periode, t.target_rp,
       COALESCE(r.omzet, 0) AS realisasi,
       ROUND(COALESCE(r.omzet, 0) / t.target_rp * 100, 1) AS pencapaian_persen
FROM target_sales t
JOIN sales_person sp ON sp.id = t.sales_person_id
LEFT JOIN (SELECT so.sales_person_id AS sid,
                  DATE_FORMAT(so.tanggal, '%Y-%m') AS per,
                  SUM(sol.subtotal) AS omzet
             FROM sales_order so
             JOIN sales_order_line sol ON sol.order_id = so.id
            WHERE so.status = 'COMPLETED'
            GROUP BY sid, per) r
  ON r.sid = t.sales_person_id AND r.per = t.periode
WHERE t.periode = '2026-08'
ORDER BY pencapaian_persen DESC
LIMIT 20;
```

`LEFT JOIN` penting: sales yang nol penjualan tetap harus muncul.

### 6. "Platform sosmed mana yang engagement-nya tertinggi?"

```sql
SELECT platform, COUNT(*) AS jml_post, SUM(reach) AS reach,
       ROUND(SUM(likes + comments + shares) / SUM(reach) * 100, 2) AS engagement_rate
FROM social_media_post
GROUP BY platform
ORDER BY engagement_rate DESC
LIMIT 10;
```

Bagi total-dengan-total (`SUM/SUM`), bukan rata-rata dari rasio per post —
kalau dirata-rata, post kecil yang viral bikin angkanya bias.

### 7. "Email mana yang open rate-nya paling tinggi?"

```sql
SELECT subjek, tanggal_kirim, terkirim,
       ROUND(dibuka / terkirim * 100, 2) AS open_rate,
       ROUND(diklik / terkirim * 100, 2) AS click_rate
FROM email_blast
WHERE terkirim > 0
ORDER BY open_rate DESC
LIMIT 10;
```

`WHERE terkirim > 0` untuk hindari pembagian nol.

### 8. "Gimana funnel leads kita?"

```sql
SELECT status, COUNT(*) AS jml,
       ROUND(COUNT(*) / (SELECT COUNT(*) FROM leads) * 100, 1) AS persen
FROM leads
GROUP BY status
ORDER BY FIELD(status, 'NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST');
```

`FIELD()` untuk urutan tahapan funnel, bukan alfabetis.

### 9. "Produk mana yang rating-nya paling jelek?"

```sql
SELECT p.nama, COUNT(*) AS jml_ulasan, ROUND(AVG(f.rating), 2) AS rata_rating
FROM customer_feedback f
JOIN produk p ON p.id = f.produk_id
GROUP BY p.id, p.nama
HAVING COUNT(*) >= 5
ORDER BY rata_rating ASC
LIMIT 10;
```

`HAVING COUNT(*) >= 5` supaya produk yang cuma punya 1 ulasan jelek
tidak langsung nongol di puncak.

### 10. "Sumber trafik website mana yang paling efektif?"

```sql
SELECT sumber, SUM(sessions) AS sessions, SUM(users) AS users,
       ROUND(AVG(bounce_rate), 2) AS bounce_rate,
       ROUND(SUM(transaksi) / SUM(sessions) * 100, 2) AS conv_rate
FROM website_traffic
GROUP BY sumber
ORDER BY sessions DESC
LIMIT 10;
```

"Paling efektif" ≠ "paling ramai". Trafik terbesar belum tentu konversi terbaik —
tampilkan dua kolomnya.

### 11. "Apa keluhan customer soal produk X?"

```sql
SELECT p.nama, f.tanggal, f.rating, f.komentar
FROM customer_feedback f
JOIN produk p ON p.id = f.produk_id
WHERE f.rating <= 2
  AND f.komentar IS NOT NULL
  AND p.nama LIKE '%scrub%'
ORDER BY f.tanggal DESC
LIMIT 20;
```

Pertanyaan begini butuh **membaca teks**, bukan menghitung angka.
Rangkum isi komentarnya, jangan cuma bilang "ada 25 keluhan".

### 12. Cek atribusi (untuk konteks sebelum jawab soal kampanye)

```sql
SELECT IF(campaign_id IS NULL, 'tanpa campaign', 'ada campaign') AS atribusi,
       COUNT(*) AS n
FROM sales_order
WHERE status = 'COMPLETED'
GROUP BY atribusi;
```

---

## Pola yang sering dipakai

| Kebutuhan | Caranya |
|---|---|
| Hitung omzet | JOIN `sales_order` → `sales_order_line`, `SUM(subtotal)`, filter `COMPLETED` |
| Hitung jumlah order setelah JOIN detail | `COUNT(DISTINCT so.id)` |
| Kelompokkan per bulan | `DATE_FORMAT(tanggal, '%Y-%m')` |
| Gabung dua agregat beda tabel | subquery di `JOIN`, bukan JOIN langsung (hindari double-count) |
| Rasio dari data agregat | `SUM(a)/SUM(b)`, bukan `AVG(a/b)` |
| Entitas tanpa transaksi tetap muncul | `LEFT JOIN` + `COALESCE(x, 0)` |
| Urutan tahapan/kategori | `ORDER BY FIELD(kolom, 'A', 'B', 'C')` |
| Hindari bagi nol | `WHERE penyebut > 0` atau `NULLIF(penyebut, 0)` |
