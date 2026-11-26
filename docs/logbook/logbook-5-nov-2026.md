# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Kamis, 5 November 2026
**Proyek:** Menyelesaikan rentang dan pola bulanan ramalan, menahan alat baru dari tim lain, dan membuat fitur peringatan dini penjualan
**Lokasi kerja:** folder `marketing/`

> Hari ini ramalan yang kemarin belum selesai dipasang dan diuji. Sesudah itu fokus berpindah ke
> fitur yang tidak bergantung pada ketepatan ramalan: daftar produk yang penjualannya berubah jauh
> dari biasanya, beserta petunjuk hal yang berubah bersamaan.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Rentang ramalan dilebarkan sesuai jarak | Selesai, aktif di portal |
| Angka per bulan berbeda dan pembanding tahun lalu (pilihan C) | Selesai, aktif di portal |
| Alat baru tim lain menunggu persetujuan | Selesai, panelnya belum terlihat di browser |
| Peringatan dini penjualan, ditanya lewat chat | Selesai, aktif di portal |
| Perbandingan dua bulan | Selesai, aktif di portal |
| Tanggal hari ini diberikan ke semua agent | Selesai, aktif di portal |
| Pengiriman otomatis ke WhatsApp | Belum, menunggu kepastian pembaruan data |
| Penyimpanan kode ke Git | Ditunda atas keputusan pemilik proyek |

---

## Entri 1 — Rentang ramalan dan pilihan C

Rentang lama terlalu sempit. Lebarnya kini mengikuti jarak bulan dan ukuran penjualan produk.

| | Sebelum | Sesudah |
|---|---:|---:|
| Penjualan asli masuk rentang, periode uji | 57–67% | 86–89% |

Angka itu dari pengali yang dihitung pada periode lama dan diuji pada periode baru. Yang dipasang
dihitung ulang dari semua periode, jadi sedikit lebih rapat. Pengali diukur pada jumlah unit, dan
rentang rupiah memakai pengali yang sama tanpa pengukuran sendiri.

Pilihan C juga dipasang: untuk produk laris dan sedang yang memakai SES, angka per bulan dikali pola
bulanan gabungan semua produk, dan bulan yang sama tahun lalu ditampilkan di sampingnya. Jawaban
menyebut bahwa ini pola umum. Arah naik-turunnya benar sekitar 52%.

Pengecekan hasil nyata menemukan satu kesalahan: rupiah naik-turun padahal unitnya rata. Sudah
diperbaiki, dan pemilik proyek sudah melihat tampilannya di browser.

---

## Entri 2 — Pemeriksaan sebelum menyimpan kode

Sebelum commit, berkas yang akan ikut diperiksa, karena repositorinya publik.

- Tidak ada kata sandi aktif di berkas yang akan ikut.
- Tiga kata sandi akun database terlalu mudah ditebak, dan perlu diganti bersama kata sandi admin.
- Logbook, komentar kode, dan skrip uji memuat angka penjualan asli, jadi repositori sebaiknya
  dijadikan private sebelum push.
- PDF spesifikasi dan skrip sementara perlu dikecualikan.

Pemilik proyek memutuskan commit ditunda, jadi perubahan belum punya titik cadangan.

---

## Entri 3 — Alat tim lain ikut masuk ke Kelola AI

Pemilik proyek menanyakan kenapa alat buatan tim lain ikut muncul. Penyebabnya, portal dan tim lain
memakai tabel `ai_tool` yang sama: 338 alat milik tim lain, 18 milik portal. Sejak 2 November
bertambah 55 alat tanpa ada yang memutuskan. Alat baca mereka langsung terpakai kalau pemakai punya
izinnya.

**Perbaikan:** alat baru tim lain kini tidak dipakai sampai disetujui di Kelola AI. Keputusannya
disimpan di database portal sendiri (`ai_tool_tinjau`), jadi sistem tim lain tidak terganggu. 338
alat yang sudah ada tetap jalan, termasuk 55 alat yang belum pernah ditinjau.

Uji khusus lolos 16/16. Panelnya baru tampil saat ada alat baru, jadi belum terlihat di browser.

---

## Entri 4 — Peringatan dini penjualan

Alat baru `pergerakan_penjualan` menampilkan produk yang penjualannya berubah minimal 20%, untuk
produk minimal 100 unit per bulan. Pembandingnya rata-rata 3 bulan sebelumnya, atau satu bulan
tertentu. Bulan yang belum selesai dibandingkan pada tanggal yang sama.

Contoh September 2026 dibanding rata-rata Juni–Agustus: dari 123 produk, 20 turun dan 26 naik.

Alat ini sengaja tidak menyebut penyebab, karena datanya tidak bisa memastikannya. Sebagai gantinya
ditampilkan hal yang berubah bersamaan: jumlah outlet, penjualan per outlet, harga rata-rata, dan
laporan stok kosong. Contohnya PEELING MUNDISARI 60 GR RJ turun 73,8%, dan laporan stok kosongnya naik
dari 113 ke 385.

**Masalah yang ditemukan saat diuji**

- Jawaban dua arah di Gemma terpotong. Daftar kini 5 produk per arah, dan 10 untuk satu arah.
- Pertanyaan "dari September dan Agustus" ternyata belum didukung, jadi perbandingan dua bulan ditambah.
- Pertanyaan tanpa tahun dijawab sebagai 2024, karena model tidak tahu tanggal hari ini. Semua agent kini
  diberi tanggal hari ini, dan empat percobaan ulang semuanya memakai 2026.

---

## Hasil uji terakhir

| Uji | Haiku | Gemma |
|---|---|---|
| Ramalan: agent | 15/15 | 15/15 |
| Ramalan: perute | 12/12 | 12/12 |
| Ramalan: tombol | 35/35 | 35/35 |

Uji ramalan di atas dijalankan sebelum alat peringatan dini dan tanggal hari ini ditambahkan. Sesudah
alat itu terdaftar, uji Gemma diulang dan lolos, tetapi sesudah tanggal hari ini ditambahkan hanya uji
agent lain yang diulang (23/23).

Uji alat: peringatan dini 56/56, tinjauan alat 16/16, alat ramalan 94/94.

---

## Masalah yang masih terbuka

- **Saldo Claude habis lagi,** sebagian karena pengujian. Peringatan dini belum pernah diuji dengan Haiku.
- **Data penjualan di server berhenti di 18 Oktober 2026.** Peringatan dini baru benar-benar dini kalau
  datanya diperbarui. Sudah ditanyakan ke tim sebelah.
- **Gemma kadang ikut menyebut agent Report** yang belum punya data, sehingga jawabannya memuat kalimat
  yang tidak perlu.
- **Gemma sekali salah merangkum jumlah produk** yang ditampilkan. Tabel produknya tidak terpengaruh.
- **Kalimat "belum tentu penyebabnya"** belum selalu muncul pada pertanyaan produk yang naik.

---

## Rencana berikutnya

1. Menunggu jawaban soal pembaruan data, lalu memutuskan pengiriman otomatis ke WhatsApp.
2. Membuat rapor ketepatan ramalan.
3. Merapikan daftar di Kelola AI, dan meninjau 55 alat yang masuk sejak 2 November.
4. Menguji cara per outlet.
5. Mengganti kata sandi database, menjadikan repositori private, lalu menyimpan kode ke Git.
