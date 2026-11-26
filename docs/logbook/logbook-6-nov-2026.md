# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Jumat, 6 November 2026
**Proyek:** Memperbaiki ramalan yang jatuh ke nol, membuat rapor ketepatan ramalan, membuat alat stok kosong, dan merapikan Kelola AI
**Lokasi kerja:** folder `marketing/`

> Hari ini dimulai dari satu produk yang diramal nol padahal masih laku, lalu berlanjut ke
> pertanyaan yang lebih besar: seberapa tepat sebenarnya ramalan kita? Jawabannya dibuat dalam
> bentuk rapor, dan hasilnya disampaikan apa adanya.

> **Temuan terbesar hari ini:** pada periode yang diuji, ramalan per produk belum lebih baik
> daripada sekadar mengulang penjualan bulan terakhir. Rentang ramalannya, sebaliknya, cukup bisa
> dipercaya: sekitar 80% penjualan sebenarnya masuk rentang.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Ramalan tidak lagi jatuh ke nol untuk produk yang masih terjual | Selesai, aktif di portal |
| Rapor ketepatan ramalan | Selesai, halaman `/rapor-ramalan` |
| Petunjuk stok kosong di peringatan dini diperbaiki | Selesai, aktif di portal |
| Alat chat stok kosong | Selesai, aktif di agent Marketing |
| Error di halaman agent Kelola AI | Selesai |
| Tab Tool di Kelola AI dirapikan | Selesai, sudah dilihat pemilik proyek |
| Uji alat stok kosong dengan model bahasa (Gemma, Haiku) | Belum |
| Penyimpanan kode ke Git | Belum |

---

## Entri 1 — Ramalan yang jatuh ke nol

PEELING MUNDISARI 60 GR RJ diramal 0 untuk Desember, Januari, dan Februari, padahal masih terjual
193 unit di September. Model AutoARIMA meneruskan penurunannya sampai mendekati nol, lalu angkanya
dibulatkan jadi 0. Aturan lama hanya menangkap angka yang di bawah nol, jadi kasus ini lolos.

**Perbaikan:** kalau produk masih terjual dalam 3 bulan terakhir, model yang ramalannya berakhir di
nol tidak dipakai, dan model berikutnya yang dipilih.

| PEELING MUNDISARI 60 GR RJ | Sebelum | Sesudah |
|---|---|---|
| Ramalan Des / Jan / Feb | 0 / 0 / 0 | 272 / 292 / 290 |

Sesudah diperbaiki, dari 336 produk aktif masih ada 9 yang diramal nol. Kesembilannya hanya terjual
0, 0, dan 1 unit dalam 3 bulan terakhir, jadi ramalan 0 masih wajar.

---

## Entri 2 — Rapor ketepatan ramalan

Ramalan dibuat dengan cara yang sama seperti di chat, tetapi seolah-olah datanya berhenti lebih
awal. Lalu angkanya dicocokkan dengan penjualan Juli–September 2026 yang sebenarnya. Pola bulanan
juga dihitung ulang hanya dari data lama, supaya rapor tidak "mengintip" bulan yang diuji.

Ada dua versi:
- **jarak 3–5 bulan**, sama dengan ramalan yang dilihat di chat sekarang (data sampai April);
- **jarak 1–3 bulan** (data sampai Juni).

| | Jarak 3–5 bulan | Jarak 1–3 bulan |
|---|---:|---:|
| Produk yang diuji | 370 | 368 |
| Ramalan meleset | 35,4% | 26,6% |
| Kalau penjualan bulan terakhir diulang saja | 29,7% | 21,9% |
| Penjualan masuk rentang (target 80%) | 77% | 80% |
| Total ramalan dibanding sebenarnya | −22% | −12% |

**Temuan**

1. Pada kedua jarak, ramalan belum lebih baik daripada mengulang penjualan bulan terakhir. Paling
   jelas pada produk laris (31,4% lawan 23,0% pada jarak 3–5 bulan).
2. Ramalan cenderung terlalu rendah, karena penjualan Juli–September naik.
3. Rentangnya cukup bisa dipercaya. Untuk keputusan, rentang lebih berguna daripada angka tunggalnya.
4. Ini satu periode saja, jadi belum bisa disimpulkan untuk selamanya.

Hasilnya bisa dilihat di halaman `/rapor-ramalan`, yang hanya terbuka untuk departemen Marketing dan
admin. Di halaman itu ada empat angka utama, tabel per kelompok produk, dan tabel per produk yang
bisa dicari dan diurutkan. Rapor tidak berubah sendiri: kalau data sudah bertambah, perhitungannya
dijalankan ulang dengan `npm run rapor:ramalan`, sekitar 2,5–3 jam.

---

## Entri 3 — Petunjuk stok kosong yang menyesatkan

Saat memeriksa data stok kosong, ditemukan bahwa jumlah outlet yang melapor melonjak:

| Bulan | Outlet yang melapor stok kosong |
|---|---:|
| Mei–Juli 2026 | 31–35 |
| Agustus 2026 | 169 |
| September 2026 | 179 |

Akibatnya, "laporan stok kosong naik" di fitur peringatan dini sering berarti pelapornya yang
bertambah, bukan barangnya yang makin sering habis.

**Perbaikan:** laporan stok kosong kini hanya dihitung dari outlet yang melapor di setiap bulan
yang dibandingkan, dan jawaban menyebut berapa outlet yang dipakai.

| PEELING MUNDISARI 60 GR, Sep dibanding Jun–Agu | Laporan stok kosong |
|---|---|
| Sebelum diperbaiki | 113 ke 385, disebut sebagai hal yang berubah bersamaan |
| Sesudah, 21 outlet yang melapor tiap bulan | 24 ke 27, tidak menonjol |

Penurunan penjualan PEELING tetap nyata: outlet yang menjualnya berkurang 48%.

---

## Entri 4 — Alat chat stok kosong

Alat baru `stok_kosong` untuk agent Marketing, dari 100.847 laporan stok kosong BA. Pertanyaan yang
bisa dijawab:

- "Produk apa yang paling sering kosong bulan September 2026?"
- "Outlet mana yang paling sering kehabisan barang?"
- "Berapa perkiraan penjualan yang hilang karena stok kosong?"
- "PEELING MUNDISARI 60 GR RJ kosong di outlet mana saja?"

Perkiraan penjualan yang hilang dihitung dari hari kosong dikali rata-rata penjualan harian produk
itu di outlet itu selama 3 bulan sebelumnya. Contoh September 2026: 8.234 hari kosong di 179 outlet
dan 211 produk, dengan perkiraan penjualan hilang sekitar 1.594 unit atau Rp49,8 juta.

**Batasan yang selalu disebut di jawaban**

- Kerugiannya perkiraan kasar dan cenderung lebih kecil dari sebenarnya.
- Separuh pasangan outlet-produk tidak punya riwayat penjualan, jadi tidak bisa diperkirakan.
- Hanya mencakup outlet yang punya BA dan melapor.
- Tidak membandingkan antarbulan, karena jumlah pelapornya berubah jauh.
- Nama BA tidak ditampilkan, karena itu data per orang.

Alat ini didaftarkan ke tabel bersama atas persetujuan pemilik proyek, dalam keadaan tidak dibagikan
ke sistem tim lain. Waktu jawabnya 0,3–0,5 detik.

---

## Entri 5 — Kelola AI

**Error kunci ganda.** Di halaman agent, daftar tool yang bisa disambungkan memuat `cari_sop` lebih
dari sekali, karena tool yang dipakai beberapa agent ikut terhitung berkali-kali. Sekarang setiap tool
hanya muncul sekali.

**Tab Tool dirapikan.** Pemilik proyek kesulitan mencari tool, karena sekitar 350 kartu setelan
terbuka semua.

| Sebelum | Sesudah |
|---|---|
| Semua kartu setelan terbuka | Satu baris ringkas per tool, setelannya terbuka saat diklik |
| Tidak ada pencarian | Kolom cari nama, kode, agent, sumber data, atau contoh pertanyaan |
| Tidak ada saringan | Saringan pemilik (portal atau tim lain), agent, dan jenis |
| Semua tool tampil sekaligus | 8 tool pertama per agent, sisanya lewat tombol |

Isi setelan tiap tool tidak diubah. Pemilik proyek sudah melihat tampilan barunya di browser.

---

## Hasil uji terakhir

Uji tanpa model bahasa:

| Uji | Hasil |
|---|---|
| Pemilih model ramalan | 77/77 |
| Alat ramalan, termasuk kasus PEELING | 95/95 |
| Peringatan dini | 57/57 |
| Alat stok kosong | 25/25 |
| Hitungan rapor ramalan | 10/10 |

Hari ini tidak ada uji dengan Gemma atau Haiku. Alat stok kosong belum pernah dicoba lewat chat
dengan model bahasa.

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- Perbaikan pertama untuk PEELING belum cukup, karena angkanya dibulatkan ke nol, bukan negatif.
  Baru ketahuan setelah diperiksa langsung pada produknya.
- Perhitungan rapor pertama memuat 1.730 produk, termasuk yang sudah lama berhenti dijual, dan
  diperkirakan makan 2 jam. Dihentikan, lalu dibatasi ke produk yang masih terjual.
- Angka "outlet pelapor periode pembanding" sempat ditampilkan sebagai gabungan tiga bulan, sehingga
  lonjakan pelapornya justru tidak terlihat. Diganti menjadi rata-rata per bulan.
- Alat stok kosong sempat mengembalikan angka nol ketika tidak ada laporan sama sekali, padahal
  seharusnya mengatakan "tidak ada laporan". Tertangkap oleh uji.
- Pemilik proyek sempat diminta memasang alat stok kosong lewat Kelola AI, padahal alat itu sudah
  otomatis terpasang di agent Marketing. Instruksi seharusnya diperiksa dulu sebelum diberikan.

---

## Masalah yang masih terbuka

- **Data di server berhenti di 18 Oktober 2026.** Peringatan dini, stok kosong, dan rapor baru
  benar-benar berguna kalau datanya diperbarui. Masih menunggu jawaban tim sebelah.
- **9 produk gagal diramal** di rapor jarak 1–3 bulan. Penyebabnya belum diperiksa.
- **Lonjakan outlet pelapor sejak Agustus** perlu dikonfirmasi ke tim sebelah: apakah memang lebih
  banyak BA yang diwajibkan melapor?
- **Perubahan belum disimpan ke Git**, jadi belum ada titik cadangan.

---

## Rencana berikutnya

1. Mengukur ramalan total per merek dengan cara yang sama seperti rapor, sebelum dipasang di chat.
2. Mencoba alat stok kosong lewat chat dengan Gemma, dan dengan Haiku kalau saldonya sudah ada.
3. Memeriksa 9 produk yang gagal diramal.
4. Mempertimbangkan skenario outlet, karena ramalan cenderung terlalu rendah saat outlet bertambah.
5. Mengganti kata sandi database, menjadikan repositori private, lalu menyimpan kode ke Git.
