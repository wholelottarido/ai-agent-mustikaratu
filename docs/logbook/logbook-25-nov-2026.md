# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Rabu, 25 November 2026
**Proyek:** Membuat ulang dashboard evaluasi Ratu AI (kecepatan, akurasi, biaya), menambahkan perbandingan biaya server sendiri vs API Anthropic, dan menyiapkan permintaan uji ke Ratu AI OpenClaw
**Lokasi kerja:** folder `marketing/`

> Hari ini tidak ada uji baru ke model. Semua pekerjaan memakai data uji yang sudah ada (13–24 November).
> Pagi sampai siang, hasil pengujian yang tadinya tersebar di beberapa halaman disusun ulang menjadi satu
> dashboard baru yang menjawab tiga pertanyaan: seberapa cepat, seberapa benar, dan berapa biayanya.
> Siang sampai sore, dashboard itu ditambah kalkulator perbandingan biaya server sendiri (AWS EC2) dengan
> API Anthropic. Catatan pemakaian Claude di database portal dan database perusahaan dicek untuk melihat
> apakah fitur cache pernah dipakai.

> **Temuan terbesar hari ini:**
> - **Biaya API Anthropic jauh lebih mahal kalau pemakaiannya ramai.** Dengan pola uji (20 pengguna
>   bertanya terus, jam kerja 08.00–17.00, 20 hari kerja), Claude Sonnet 5.5 ±**Rp 134 juta/bulan**,
>   sedangkan server EC2 ±**Rp 25,6 juta/bulan**. API baru lebih murah kalau pertanyaannya di bawah
>   ±1.840 per hari.
> - **Yang mahal bukan pertanyaan dan jawaban pengguna.** Pertanyaan pengguna ±10 token, padahal satu
>   pertanyaan mengirim ±13.662 token ke model. Sisanya instruksi agent, daftar alat, dan hasil alat yang
>   dikirim ulang di setiap panggilan model.
> - **Portal kita tidak pernah memakai cache Anthropic** (0 token cache), sedangkan Ratu AI OpenClaw
>   memakainya (±77% token masuk dari cache), sehingga biaya API-nya ±57–60% lebih hemat.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Dashboard evaluasi baru (7 halaman, satu berkas) | Selesai, sudah diuji |
| Cadangan dashboard lama | Selesai (7 berkas) |
| Dokumentasi dashboard (sumber angka, rumus, istilah, hasil uji) | Selesai |
| Simulasi biaya API Anthropic (hitungan saja) | Selesai |
| Kalkulator EC2 vs API Anthropic di dashboard | Selesai, sudah diuji |
| Cek pemakaian cache di database portal dan database perusahaan | Selesai (hanya membaca) |
| Kolom porsi tulis cache di kalkulator | Selesai |
| Jam kerja 08.00–17.00 × 20 hari kerja sebagai bawaan | Selesai |
| Halaman Biaya dirapikan | Selesai |
| Dokumen permintaan uji ke Ratu AI OpenClaw (untuk mentor) | Selesai, **belum dikirim / belum dijalankan** |

---

## Entri 1 — Dashboard evaluasi baru

Sebelumnya hasil pengujian tersebar di beberapa halaman yang digabung lewat bingkai (iframe). Sekarang
semuanya ada di satu berkas: `docs/benchmark/grafik/ratu-ai-performance-evaluation.html`. Berkas ini
bisa dibuka dengan klik dua kali, tanpa internet dan tanpa server.

| # | Halaman | Isi |
|---|---|---|
| 1 | Ringkasan Eksekutif | Angka utama kecepatan, akurasi, dan biaya; tabel sebelum vs sesudah perbaikan; kesimpulan |
| 2 | Kecepatan Respons | Kecepatan model dipisah dari kecepatan jawaban Ratu AI; grafik 1–20 pengguna; penjelasan kenapa jenis pertanyaan tertentu lebih lambat |
| 3 | Akurasi dan Keandalan | Lulus / sebagian / gagal; daftar kegagalan lengkap dengan pertanyaan, jawaban, penyebab, dan status perbaikannya |
| 4 | Biaya Operasional | Kalkulator server, biaya per tahap uji, perbandingan dengan API Anthropic, simulasi volume |
| 5 | Perbandingan Model | Qwen3-14B vs Qwen3.8-27B: kecepatan, akurasi, biaya, dan rekomendasinya |
| 6 | Detail Teknis | GPU, memori, antrean, panggilan model, token, penjaga alur, kamus istilah, metodologi |
| 7 | Riwayat Pengujian | Semua pengujian sejak 13 November, dikelompokkan menurut tujuannya |

Angka utama di dashboard (uji 24 November, sesudah perbaikan software):

| | Sebelum | Sesudah |
|---|---|---|
| Akurasi | 89,6% | **94,4%** |
| Jawaban gagal | 19 | **2** |
| Jawaban paling lambat (1%) di 20 pengguna | 167 detik | **100 detik** |
| Biaya per jawaban benar | USD 0,0205 | **USD 0,0146** |

Pengujian tampilan yang sudah dilakukan:
- **Ketujuh halaman** sudah dibuka di Edge (Chromium) dan diuji otomatis: tidak ada error, dan tidak ada angka rusak seperti "NaN".
- **Kalkulator** dicocokkan dengan hitungan manual.
- **Filter, pencarian, unduh CSV, mode gelap, dan lebar layar HP** berfungsi.
- **Cetak ke PDF** menghasilkan 21 lembar.

Masalah yang ketemu dan sudah diperbaiki selama pengujian:
- Tampilan HP terpotong di kanan.
- Sumbu grafik akurasi sampai 110%.
- Satu kesimpulan di halaman Perbandingan Model salah. Tertulis model 27B kena batas waktu mulai 3–5 pengguna, padahal datanya baru menunjukkan itu di 8 pengguna. Sekarang kalimatnya dihitung langsung dari data.

Yang **belum** diuji: HP sungguhan, Firefox/Safari, dan pembaca layar.

Dashboard lama tidak diubah. Cadangannya ada di `.cadangan/dashboard-redesign-2026-11-25/`.

---

## Entri 2 — Data yang tidak konsisten

Sepuluh hal dicatat di dokumentasi, di antaranya:
- **Batas waktu 95% (P95) berbeda dari laporan lama**, karena cara menghitung persentil sekarang disamakan untuk semua uji. Contoh: P95 di 12 pengguna sebelum optimasi 99,7 detik di dashboard, 122,4 detik di laporan lama.
- **Memori kerja GPU (KV cache) untuk uji 24 November belum tercatat**, karena catatan server tidak sempat diambil sebelum server dimatikan. Di dashboard ditulis "Belum tercatat", bukan 0.
- **Hanya uji kapasitas (T7) yang selesai.** Uji T1–T6 ditampilkan apa adanya: dihentikan atau belum diuji.
- **Tarif server g5.2xlarge tidak tercatat**, jadi uji 13–17 November tidak diberi angka biaya.

---

## Entri 3 — Simulasi biaya API Anthropic

Pertanyaannya: berapa biaya API Anthropic kalau 20 pengguna bertanya bersamaan dan layanan menyala sesuai
jam kerja? Ini **hitungan saja**; tidak ada panggilan ke API.

Dasar hitungan dari uji 24 November (tahap 20 pengguna):
- per pertanyaan: ±13.662 token masuk dan ±1.151 token keluar (610 di antaranya token "berpikir");
- 17,86 pertanyaan selesai per menit;
- dengan jam kerja 9 jam, ±9.644 pertanyaan per hari.

| Model | Per pertanyaan | Per bulan (20 hari kerja) |
|---|---|---|
| Claude Opus 5.5 | USD 0,078 | ±Rp 268 juta |
| Claude Sonnet 5.5 | USD 0,039 | ±Rp 134 juta |
| Claude Haiku 4.5 | USD 0,019 | ±Rp 67 juta |
| Claude Haiku 5.5 | USD 0,002 | ±Rp 7 juta |
| **Server EC2 g5.12xlarge (9 jam/hari)** | — | **±Rp 25,6 juta** |

Batasan:
- Jumlah token diukur pada model Qwen, bukan Claude.
- Akurasi Claude untuk 8 jenis pertanyaan ini belum diuji.

---

## Entri 4 — Kalkulator EC2 vs API Anthropic di dashboard

Kalkulator ditambahkan di halaman Biaya Operasional supaya mentor bisa membandingkan sendiri. Kolom yang bisa diatur:
- model Anthropic dan jenis pertanyaan (campuran atau Q1–Q8 satu per satu);
- jumlah pertanyaan per hari;
- harga per token;
- porsi cache;
- pengali jumlah token, untuk menguji selisih cara Claude menghitung token.

Hasil yang ditampilkan:
- biaya API per pertanyaan, per hari, dan per bulan;
- biaya EC2 per bulan, termasuk jumlah server kalau volumenya melebihi kapasitas satu server;
- mana yang lebih murah, dan titik impasnya;
- grafik biaya semua model;
- grafik biaya menurut jumlah pertanyaan per hari.

Kalkulator juga menampilkan **rincian yang ditagih Anthropic untuk satu pertanyaan**:

| Bagian | Token | Porsi biaya |
|---|---|---|
| Pertanyaan pengguna | ±10 | <1% |
| Instruksi agent, daftar alat, hasil alat (dikirim ulang di setiap panggilan) | ±13.652 | 70% |
| Model berpikir | ±610 | 16% |
| Jawaban yang dikirim ke pengguna | ±200 | 5% |
| Panggilan alat dan pesan antar-agent | ±341 | 9% |

Setiap kolom kalkulator diberi penjelasan singkat. Penjelasan lengkap dan rumusnya ada di bagian yang bisa dibuka.

---

## Entri 5 — Apakah fitur cache Anthropic pernah dipakai?

Dua sumber dicek. Keduanya **hanya dibaca**; isi percakapan dan data orang tidak dibuka.

| Sistem | Sumber | Hasil |
|---|---|---|
| Portal VoltAgent (punya kita) | Tabel `pemakaian` di MySQL portal: 242 permintaan Haiku 4.5 dan 61 Sonnet 5, 25 Sep – 11 Nov | **0 token cache.** Kode portal memang tidak pernah menyalakan cache |
| Ratu AI OpenClaw (tim lain) | Tabel `ai_pemakaian_model` di database perusahaan, 599 panggilan, 28 Sep – 2 Nov | **±77% token masuk dari cache**, ±22–24% tulis cache |

Akibatnya ke biaya: dengan cache, OpenClaw membayar ±57% (Haiku 4.5) sampai ±60% (Sonnet 5) lebih murah
daripada kalau tanpa cache.

Tarif cache yang tercatat di database perusahaan (`ai_harga_model`) sama dengan yang dipakai kalkulator.

---

## Entri 6 — Penyempurnaan kalkulator

- **Kolom porsi tulis cache ditambahkan.** Tulis cache ditagih 1,25× harga normal, jadi kalau hanya porsi baca yang diisi, hasilnya terlalu murah. Ada tombol isi cepat "Tanpa cache (portal)" dan "Seperti OpenClaw (77% baca, 22% tulis)".
- **Jam kerja 08.00–17.00 (9 jam) × 20 hari kerja** sekarang jadi bawaan. Jumlah pertanyaan per hari pada pola uji ikut menyesuaikan kalau jam diubah.
- **Halaman Biaya dirapikan.**
  - Ada tombol lompat ke 4 bagian: server EC2, biaya hasil uji, EC2 vs API Anthropic, dan simulasi volume.
  - Penjelasan kolom dipendekkan, dan grafiknya dibuat selebar halaman supaya terbaca.

---

## Entri 7 — Permintaan uji ke Ratu AI OpenClaw

Untuk mendapatkan angka token dan biaya API yang sungguhan (bukan perkiraan dari model Qwen), disiapkan
dokumen untuk mentor: `docs/benchmark/permintaan-uji-openclaw-8-pengguna.md`.

- **Skenario:** 8 pengguna bertanya bersamaan × 3 pertanyaan = 24 pertanyaan, Q1–Q8 bergiliran.
- **Pengukuran:** hanya membaca catatan token yang sudah dibuat OpenClaw di database perusahaan. Tidak ada perubahan di sistem OpenClaw.
- **Perkiraan biaya API Anthropic untuk uji:** ±USD 1,5 (Sonnet 5) atau ±USD 0,5 (Haiku 4.5).
- **Yang diminta dari mentor:** izin, cara akses otomatis, model yang dipakai, waktu pelaksanaan, dan keputusan soal Q5. Q5 berisiko membuat tiket sungguhan di database produksi.

Uji ini **belum dijalankan** dan menunggu jawaban mentor.

---

## Keputusan hari ini

| Keputusan | Alasan |
|---|---|
| Satu dashboard baru, dashboard lama dijadikan arsip | Pembaca (mentor dan tim IT) cukup membuka satu berkas |
| Akurasi utama memakai penilai jawaban versi 2 | Lebih ketat: ikut menilai perilaku agent, bukan hanya isi jawaban |
| Data yang tidak ada ditulis "Belum tercatat", bukan 0 | Angka 0 bisa disangka hasil ukur |
| Biaya disebut "perkiraan biaya komputasi", bukan tagihan | Tagihan AWS dihitung dari jam server menyala, bukan dari jumlah pertanyaan |
| Jam kerja 08.00–17.00 × 20 hari sebagai bawaan biaya | Sesuai jam kerja yang dipakai perusahaan |
| Uji ke OpenClaw lewat persetujuan mentor dulu | Sistem dan API key-nya milik tim lain, dan uji memakai saldo API mereka |

---

## Belum dikerjakan

- Mengirim dokumen permintaan uji ke mentor, lalu menjalankan uji OpenClaw setelah ada izin dan cara akses.
- Uji live T2–T6 (multi-giliran, pertanyaan variasi, uji ulang, A/B, pembatalan).
- Uji akurasi Claude dengan 8 pertanyaan yang sama.
- Mengecek apakah masih ada proses benchmark lama yang tertinggal di laptop dari uji T7 yang dihentikan.

---

## Berkas hari ini

| Berkas | Isi |
|---|---|
| `docs/benchmark/grafik/ratu-ai-performance-evaluation.html` | Dashboard evaluasi baru |
| `scripts/buat-dashboard-evaluasi.py` | Pembuat dashboard dari data uji |
| `scripts/dashboard-evaluasi.template.html` | Tampilan dashboard |
| `docs/benchmark/dokumentasi-dashboard-evaluasi.md` | Dokumentasi: struktur, sumber angka, rumus, istilah, hasil uji, data tidak konsisten |
| `docs/benchmark/permintaan-uji-openclaw-8-pengguna.md` | Permintaan uji untuk mentor |
| `.cadangan/dashboard-redesign-2026-11-25/` | Cadangan 7 dashboard lama |
