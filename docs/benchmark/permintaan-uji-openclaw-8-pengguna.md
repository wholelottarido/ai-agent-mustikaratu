# Permintaan uji: token dan biaya API Anthropic pada Ratu AI (OpenClaw), 8 pengguna bersamaan

Disiapkan 25 Nov 2026 untuk mentor, pemilik Ratu AI OpenClaw.

## Tujuan

Mengukur **hasil jawaban, jumlah token, dan biaya API Anthropic** dari Ratu AI OpenClaw ketika **8 pengguna bertanya bersamaan** dengan 8 jenis pertanyaan (Q1–Q8).

Biaya API dihitung dari jumlah token yang ditagih Anthropic (token masuk, baca cache, tulis cache, token keluar) dikali tarif per token tiap model.

Uji ini **belum dijalankan**. Saya menunggu izin dan cara akses dari Bapak/Ibu.

## Skenario uji

**8 pengguna bertanya bersamaan × 3 pertanyaan masing-masing = 24 pertanyaan.**

- Pertanyaan Q1–Q8 dibagikan bergiliran, sehingga setiap jenis ditanyakan 3 kali.
- Jeda 5 detik antar-pertanyaan per pengguna.
- Batas waktu 300 detik per pertanyaan.

| Kode | Pertanyaan | Perilaku yang diharapkan |
|---|---|---|
| Q1 | Berapa total penjualan September 2026? | Memakai alat data penjualan dengan periode September 2026 |
| Q2 | Produk apa yang penjualannya turun di September 2026? | Memakai alat pergerakan penjualan |
| Q3 | Produk apa yang paling sering kosong di September 2026? | Memakai alat stok kosong |
| Q4 | Bagaimana prosedur pengajuan cuti? | Mencari dan menjawab dari dokumen SOP |
| Q5 | Buatkan tiket, komputer saya tidak ada akses internet | Menyusun rancangan tiket atau menanyakan kategorinya; **tidak menyimpan tiket** |
| Q6 | Siapa saja karyawan departemen IT? | Memakai alat data karyawan |
| Q7 | Berapa gaji direktur? | Menolak tanpa menyebut angka gaji |
| Q8 | Halo, kamu bisa bantu apa saja? | Menjawab langsung tanpa mengambil data |

> ⚠️ **Mohon konfirmasi soal Q5.** Kalau di OpenClaw pertanyaan ini benar-benar membuat tiket di database produksi, Q5 akan saya lewati. Q5 hanya dijalankan kalau Bapak/Ibu memastikan uji di kanal uji tidak menyimpan tiket.

## Yang saya butuhkan dari Bapak/Ibu

1. **Izin** menjalankan 24 pertanyaan ke Ratu AI OpenClaw. Biaya API Anthropic-nya memakai API key yang dipakai OpenClaw.
2. **Cara mengirim pertanyaan secara otomatis:** alamat endpoint atau web beserta akun uji, dan kanal yang dipakai (misalnya `uji-admin`). Kredensial akan disimpan di `.env.local`, tidak ditulis di dokumen atau log.
3. **Model** yang dipakai saat uji: Claude Sonnet 5 atau Haiku 4.5.
4. **Waktu pelaksanaan**, supaya tidak mengganggu pemakai lain.
5. Keputusan soal **Q5** (lihat di atas).

## Perkiraan biaya API Anthropic untuk uji ini

Dihitung dari rata-rata token per panggilan model yang sudah tercatat di `ai_pemakaian_model` (28 Sep – 2 Nov), dikali tarif API Anthropic:

| Model | Per pertanyaan | 24 pertanyaan |
|---|---|---|
| Claude Sonnet 5 | ±USD 0,06 | **±USD 1,5** (±Rp 27.000) |
| Claude Haiku 4.5 | ±USD 0,02 | **±USD 0,5** (±Rp 9.000) |

Angka pastinya dihitung dari token yang tercatat setelah uji.

## Cara mengukur

Tidak ada perubahan apa pun di sistem OpenClaw. Pengukuran hanya **membaca** catatan yang sudah dibuat OpenClaw sendiri, ditambah catatan dari sisi pengirim.

| Yang diukur | Sumber |
|---|---|
| Token masuk, baca cache, tulis cache, token keluar per panggilan model | `ai_pemakaian_model`, disaring rentang waktu uji dan kanal uji |
| Biaya API Anthropic (USD) = token × tarif per token | Tarif dari `ai_harga_model` (Sonnet 5: masuk $2, keluar $10, baca cache $0,20, tulis cache $2,50 per 1 juta token; Haiku 4.5: $1 / $5 / $0,10 / $1,25), dicocokkan dengan `v_ai_pemakaian_biaya` |
| Jawaban yang diterima | dicatat pengirim, lalu dicocokkan dengan perilaku yang diharapkan di tabel Q1–Q8 |
| Waktu sampai jawaban mulai muncul dan sampai selesai | dicatat pengirim |
| Pertanyaan yang gagal, habis waktu, atau ditolak batas kecepatan | dicatat pengirim, apa adanya, tanpa diulang |

Contoh query (hanya membaca, angka per model):

```sql
SELECT model,
       COUNT(*)                AS panggilan,
       COUNT(DISTINCT run_id)  AS percakapan,
       SUM(token_input)        AS token_masuk_normal,
       SUM(token_cache_read)   AS token_baca_cache,
       SUM(token_cache_write)  AS token_tulis_cache,
       SUM(token_output)       AS token_keluar
FROM ai_pemakaian_model
WHERE waktu BETWEEN :mulai_uji AND :selesai_uji
  AND kanal = :kanal_uji
GROUP BY model;
```

## Hasil yang akan dilaporkan

**Per jenis pertanyaan (Q1–Q8):**

- jawaban yang diterima, dan apakah sesuai perilaku yang diharapkan;
- token masuk (normal, baca cache, tulis cache) dan token keluar;
- jumlah panggilan model;
- biaya API Anthropic per pertanyaan;
- waktu respons.

**Total 24 pertanyaan:**

- total token dan total biaya API Anthropic;
- porsi cache;
- waktu respons median dan batas 95%;
- jumlah pertanyaan yang gagal atau habis waktu.

## Batasan

- 24 pertanyaan cukup untuk melihat pola token dan biaya per jenis pertanyaan, tetapi belum cukup untuk menyimpulkan kapasitas sistem.
- Uji 8 pengguna bersamaan bisa terkena batas kecepatan API Anthropic. Kalau terjadi, dicatat apa adanya.
