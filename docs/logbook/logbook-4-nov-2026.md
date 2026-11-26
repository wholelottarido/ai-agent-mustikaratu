# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Rabu, 4 November 2026
**Proyek:** Menambah alat total penjualan, lalu mencari cara membuat ramalan penjualan lebih bisa dipercaya
**Lokasi kerja:** folder `marketing/`

> Pertanyaan utama hari ini datang dari mencoba langsung di layar: kenapa ramalan Desember,
> Januari, dan Februari selalu sama? Untuk menjawabnya, banyak cara dan sumber data diuji pada
> penjualan yang sudah terjadi.

> **Temuan terbesar hari ini:** perbaikan paling berguna bukan model baru, melainkan data yang
> lebih baru. Data penjualan Agustus dan September ternyata sudah ada, dan cocok persis dengan
> tabel lama. Sebaliknya, model yang lebih rumit dan data promosi tidak terbukti membuat
> ramalan lebih tepat.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Alat total penjualan | Selesai, aktif di portal |
| Data penjualan sampai September 2026 | Selesai, aktif di portal |
| Naive diganti SES | Selesai, aktif di portal |
| Penjelasan saat angka ramalan sama tiap bulan | Selesai, aktif di portal |
| Peringatan besar meleset sesuai ukuran produk | Selesai, aktif di portal |
| Label sumber data mengikuti tabel yang dipakai | Selesai, aktif di portal |
| Layanan ramalan Python | Berjalan di laptop, tidak dipakai portal |
| Rentang ramalan mendekati peluang 80% | Sedang diukur |
| Angka per bulan berbeda (pilihan C) | Disetujui, belum dikerjakan |

---

## Entri 1 — Alat total penjualan

**Waktu:** pagi

Pertanyaan "berapa total penjualan bulan lalu?" sebelumnya tidak bisa dijawab. Dibuat alat baru
`total_penjualan` untuk agent Marketing. Jumlahnya dihitung database, bukan model bahasa.

Hasil uji di portal sama dengan data langsung, misalnya Juni 2026: 161.172 unit,
Rp4.811.265.150. Kalau datanya belum ada, alat ini mengatakannya, bukan menjawab nol.

**Catatan:** sumbernya penjualan lewat BA di sekitar 200–300 outlet per kuartal. Kemungkinan
besar bukan seluruh penjualan perusahaan, dan ini perlu dikonfirmasi ke tim sebelah.

---

## Entri 2 — Membandingkan cara meramal

**Waktu:** pagi sampai siang

Dokumen temuan forecasting yang baru diperiksa dan dicocokkan dengan kode serta data. Lalu
beberapa cara diuji dengan menyembunyikan penjualan lama dan membandingkan ramalan dengan
kenyataannya. Keputusan memakai kelompok produk yang belum pernah dipakai, supaya tidak terkecoh.

Besar meleset pada 245 produk yang belum pernah dipakai, jarak 5–7 bulan:

| Cara | Meleset |
|---|---:|
| Sistem saat itu | 77,7% |
| AutoETS (Python) | 89,2% |
| AutoTheta (Python) | 80,4% |
| Naive | 79,3% |
| SES | 77,2% |

**Temuan**

1. Uji pada jarak sebenarnya, yang tadinya diperkirakan sebagai perbaikan terpenting, ternyata
   tidak terbukti lebih tepat.
2. Cara yang angkanya berbeda tiap bulan tidak terbukti lebih tepat daripada angka yang rata.
3. LightGBM milik tim sebelah kalah dari cara sederhana pada jarak dekat (28,6% lawan 24,0%),
   dan arah naik-turunnya benar 52,3%, hampir seperti lempar koin.
4. Besar meleset sangat bergantung pada ukuran penjualan produk. Median per produk pada jarak
   5–7 bulan sekitar 35% untuk produk laris, dan 122% untuk produk kecil.

**Keputusan**

- Naive diganti SES. Naive hanya mengulang satu bulan terakhir, sehingga kurang tepat disebut
  prediksi. SES menghitung dari seluruh riwayat. Ketepatannya kurang lebih setara, dan sedikit
  lebih baik untuk produk laris.
- Naive tetap ada sebagai pembanding, tetapi tidak bisa terpilih lagi.
- Peringatan di jawaban kini menyesuaikan jarak dan ukuran produk.

---

## Entri 3 — Layanan ramalan Python

**Waktu:** siang

Dokumen temuan mengusulkan layanan Python terpisah. Layanan ini dibuat di folder
`forecast-service/`, berjalan di laptop dan hanya bisa diakses dari laptop itu, dengan akun baca
saja. Pemakaian memorinya sekitar 195 MB, dan satu ramalan sekitar 1 detik.

Karena AutoETS dan AutoTheta tidak menang uji, layanan ini **tidak disambungkan ke portal**.
Bisa diuji lagi nanti kalau datanya sudah lebih lengkap.

---

## Entri 4 — Memeriksa seluruh database

**Waktu:** siang

438 tabel yang bisa dibaca diperiksa untuk mencari faktor lain.

| Data | Hasil |
|---|---|
| Penjualan mentah | **Dipakai.** Cocok dengan tabel pada 5.816 dari 5.816 kombinasi produk-bulan (Januari 2025–Juli 2026) |
| Jumlah outlet | Layak diuji lebih lanjut, perbaikannya kecil |
| Promosi | Belum bisa dipakai |
| Stok kosong | Tidak terlihat hubungannya dengan penjualan |
| Stok gudang | Hanya ada satu foto, tanpa riwayat |
| Media sosial | 933 dari 996 unggahan baru dari 2026, dan tidak per produk |

**Keputusan**

Keputusan 26 Oktober untuk tidak melengkapi data diubah. Portal kini menghitung Agustus dan
September dari data mentah saat dibaca, sedangkan tabel bersama tim sebelah tidak disentuh.
Oktober belum ikut karena baru sampai tanggal 18.

Jarak ramalan Desember–Februari turun dari 5–7 bulan menjadi 3–5 bulan.

**Dampak:** LightGBM sementara tidak ikut bersaing, karena hasil ujinya baru sampai Juli. Tim
sebelah perlu melatih ulang dengan data baru.

---

## Entri 5 — Kenapa ramalan selalu sama, dan faktor yang diminta

**Waktu:** sore

Angka sama karena SES hanya memperkirakan satu tingkat penjualan per bulan. Pemilik proyek
meminta bulan-bulan itu dibedakan memakai bulan yang sama tahun lalu, promosi, media sosial, dan
tren internet. Masing-masing diuji.

**Promosi**

| Besar meleset, jarak 3–5 bulan | Tanpa promo | Seolah tahu pasti ada promo | Seolah tahu pasti promo besar |
|---|---:|---:|---:|
| Semua produk | 33,5% | 33,9% | 33,3% |
| Produk laris | 27,6% | 28,0% | 27,3% |

Promo terlalu sering ada (68% bulan-produk), jadi "ada promo" hampir tidak membedakan bulan. Bulan
promo besar cenderung sedikit lebih tinggi (median +6%), tetapi tidak memperbaiki ramalan per
produk. Kanal outlet BA belum berhasil dicocokkan dengan kanal program.

**Bulan yang sama tahun lalu**

Pola bulanan gabungan semua produk (SES × pola) setara dengan angka rata secara total (33,2% lawan
33,5%), tetapi per produk lebih sering kalah (108 lawan 164), dan arah naik-turunnya benar sekitar
52%.

**Media sosial dan tren internet**

Belum bisa masuk hitungan. Riwayatnya terlalu pendek, atau tidak berupa angka per produk.

**Keputusan**

Pemilik proyek menyetujui pilihan C: angka per bulan dibuat berbeda memakai pola bulanan untuk
produk laris dan sedang, dan bulan yang sama tahun lalu ditampilkan di sampingnya. Jawaban harus
menyebut bahwa perbedaan itu pola umum, bukan kepastian. Belum dikerjakan.

---

## Entri 6 — Perbaikan dari mencoba di layar

**Waktu:** sore

Pemilik proyek menemukan jawaban Agustus masih berlabel tabel `ai_forecast_sales_monthly`, padahal
angkanya dari `trx_ba_sales`. Angkanya benar, labelnya salah. Label kini mengikuti tabel yang
benar-benar dipakai, dan pemeriksaannya sudah ditambahkan ke uji otomatis.

---

## Hasil uji terakhir

| Uji | Haiku | Gemma |
|---|---|---|
| Agent | 15/15 | 15/15 |
| Perute | 12/12 | 12/12 |
| Tombol | 35/35 | 34/35 |

Yang gagal di Gemma adalah kasus lama: setelah tombol tren pasar ditekan, daftar pilihan kadang
muncul sekali lagi. Jawabannya tidak salah.

Uji tanpa model bahasa juga lolos: model 55, pemilih 74, label sumber 59, penyimpanan tombol 18.
Uji alat ramalan (79) terakhir dijalankan sebelum SES dipasang permanen, dan perlu diulang.

---

## Sedang berjalan

**Rentang ramalan.** Target jawabannya berbunyi "peluang sekitar 80% penjualan ada di antara X dan
Y". Saat ini penjualan asli hanya masuk rentang sekitar 52–74% dari waktu. Lebar rentang sedang
dihitung dari periode lama, lalu diuji pada periode yang lebih baru.

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- Pengukuran AutoETS dan AutoTheta sempat harus diulang, karena proses paralel Python gagal,
  kemungkinan besar kehabisan memori.
- Perintah `forecast` sempat merusak format `package.json`, sehingga semua perintah `npm` tidak
  bisa jalan sebentar. Sudah diperbaiki.
- Label sumber data salah sesudah data mentah disawmbung, dan baru ketahuan dari layar.
- Ucapan bahwa rencana promo adalah "penentu" terbukti keliru setelah diuji.

---

## Rencana berikutnya

1. Pasang rentang baru kalau hasil ujinya mendekati 80%.
2. Pasang pilihan C.
3. Menyimpan kode ke Git, sesudah memeriksa kata sandi dan dokumen PDF, karena repositorinya publik.
4. Menanyakan ke tim sebelah: apakah `ba_sales` mewakili seluruh penjualan, dan pelatihan ulang
   LightGBM dengan data baru.
5. Menguji cara per outlet.
