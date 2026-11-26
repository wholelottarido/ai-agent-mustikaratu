# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Senin, 9 November 2026  
**Proyek:** Memperbaiki jawaban agent, menguji RAG SOP, dan merapikan pengalaman penggunaan portal  
**Lokasi kerja:** folder `marketing/`

> Pekerjaan hari ini berfokus pada dua hal. Pertama, memastikan jawaban penjualan, stok kosong,
> data karyawan, tiket, dan SOP memakai sumber yang tepat. Kedua, membuat proses kerja banyak agent
> lebih mudah dipahami pengguna melalui status proses, identitas agent, navigasi, tabel, dan sumber
> jawaban yang lebih jelas.

> **Temuan terbesar hari ini:** hasil RAG SOP sebelumnya bisa menjawab dari dokumen, tetapi bagian
> sumber di bawah jawaban masih terlalu umum. Sistem lama juga mencari kode berformat `SOP-...`,
> sedangkan korpus baru memakai judul dan bagian dokumen. Rujukan SOP sekarang dibawa sebagai data
> terstruktur agar pengguna bisa melihat dokumen yang benar-benar ditemukan.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Pengukuran ramalan memakai PostgreSQL perusahaan | Selesai |
| Penjelasan produk yang tidak dapat diramal | Selesai |
| Ramalan total per merek MRPC ditahan berdasarkan hasil backtest | Selesai |
| Ramalan per produk/SKU MRPC | Aktif di portal |
| Penjelasan pengaruh jumlah outlet terhadap ramalan | Selesai dan diterapkan ke pertanyaan serupa |
| Status agent dan tahapan proses di chat | Selesai |
| Ikon serta status agent pada rail kiri | Selesai |
| Alur persetujuan tindakan lanjutan dari jawaban agent | Selesai untuk kasus yang didukung |
| Pengujian pertanyaan memakai Gemma | Dilakukan melalui portal |
| Pemeriksaan dan perbaikan sumber RAG SOP | Selesai |
| Perbaikan UI/UX C01–C08 | Selesai bertahap |
| Perbaikan UI/UX C09 | Belum dikerjakan |
| Pemeriksaan visual seluruh ukuran layar | Belum lengkap |
| Penyimpanan perubahan ke Git | Belum |

---

## Entri 1 — Pengukuran ramalan dengan PostgreSQL perusahaan

Koneksi ke PostgreSQL perusahaan dipakai kembali untuk menjalankan pengukuran ramalan. Produk yang
sebelumnya disebut “gagal” diperiksa penyebabnya. Sembilan SKU tersebut hanya memiliki satu bulan
data pada titik pemotongan rapor, sehingga belum mempunyai riwayat yang cukup untuk membentuk pola
ramalan.

Kondisi itu bukan berarti produknya buruk atau datanya salah. Artinya hanya bahwa sistem belum punya
cukup titik waktu untuk melakukan evaluasi ramalan secara wajar.

Ramalan total per merek MRPC juga tidak langsung ditampilkan. Backtest menunjukkan ramalan gabungan
per merek belum konsisten lebih baik daripada mengulang angka penjualan bulan terakhir. Portal kini
menjelaskan keterbatasan tersebut dan menawarkan ramalan per produk/SKU.

Contoh produk yang berhasil diramal:

| Produk | Kode | Model |
|---|---:|---|
| BILASAN SANTAN TUBE 175 ML RJ NF | 1006737 | SES |

Ramalan produk menampilkan nilai per bulan, rentang unit dan rupiah, pembanding tahun sebelumnya,
WAPE, tren, data terakhir, asumsi harga, dan catatan kalender.

---

## Entri 2 — Pengaruh jumlah outlet terhadap ramalan

Model ramalan saat ini tidak memakai jumlah outlet sebagai variabel langsung. Riwayat penjualan
memang mencerminkan jangkauan outlet pada masa lalu, tetapi perubahan outlet setelah bulan data
terakhir tidak diketahui model.

Hasil backtest yang disampaikan di portal:

- produk dengan outlet bertambah cenderung diramal terlalu rendah;
- produk dengan outlet berkurang cenderung diramal terlalu tinggi;
- penyesuaian sederhana berdasarkan jumlah outlet belum konsisten membantu;
- perubahan outlet yang besar tetap perlu diperlakukan sebagai konteks bisnis di luar model.

Penjelasan metodologi ini diterapkan ke pertanyaan serupa agar agent tidak lagi menyatakan bahwa
seluruh kondisi jaringan outlet otomatis sudah tercermin untuk masa depan.

---

## Entri 3 — Status agent dan proses kerja

Sebelumnya pengguna hanya melihat animasi titik tiga ketika pertanyaan sedang diproses. Sekarang
portal menjelaskan agent dan tahap yang sedang berjalan, misalnya:

- mengarahkan pertanyaan ke agent yang sesuai;
- memahami pertanyaan;
- menjalankan query database;
- mencari dokumen pada basis pengetahuan;
- menghitung ramalan penjualan;
- menganalisis stok kosong;
- mengolah hasil agent menjadi jawaban.

Rail agent di sisi kiri juga menunjukkan agent yang sedang menjawab dengan animasi dan label status.
Ikon disesuaikan dengan aplikasi masing-masing. Detail agent dapat dibuka dengan klik atau keyboard
untuk melihat nama, status akses, deskripsi, dan jumlah kemampuan yang tersedia.

Identitas agent tetap tampil setelah jawaban selesai, sehingga pengguna tidak perlu menebak siapa
yang menghasilkan jawaban tersebut.

---

## Entri 4 — Pengujian fungsi lintas agent

Beberapa fungsi portal diperiksa langsung melalui percakapan, antara lain:

- aset pengguna;
- tiket helpdesk yang belum selesai;
- pembuatan rancangan tiket;
- daftar SOP;
- data karyawan baru;
- jumlah karyawan per departemen;
- progres induction;
- status pengajuan cuti;
- hari libur perusahaan;
- tren pasar;
- klaim MAPS berdasarkan status dan departemen.

Pengujian kemudian dialihkan ke Gemma karena kuota Haiku mencapai batas. Salah satu masalah yang
ditemukan adalah respons persetujuan singkat seperti “ya setuju” atau “ya boleh” sempat kehilangan
konteks tindakan sebelumnya. Alur konfirmasi diperbaiki agar persetujuan tersebut meneruskan tindakan
yang sudah ditawarkan, misalnya menyiapkan tiket helpdesk.

Masalah lain ditemukan pada pengajuan lembur. Agent Super Tools menjelaskan bahwa kemampuan yang
terpasang saat itu hanya dapat melihat rencana kunjungan, tugas lapangan, dan status persetujuan.
Kasus ini membedakan kemampuan yang memang tersedia dari kemampuan yang belum dipasang pada agent.

---

## Entri 5 — Pemeriksaan RAG SOP

RAG SOP dibuktikan dari alur teknisnya:

1. pertanyaan diubah menjadi embedding;
2. PostgreSQL mencari potongan terdekat pada `ai_knowledge.chunks`;
3. dokumen disaring berdasarkan status aktif dan akses departemen;
4. potongan membawa judul, bagian, jenis, isi, tautan, serta posisi jika tersedia;
5. agent diminta menilai isi dokumen, bukan hanya mempercayai angka kemiripan.

Pengujian “Komputer saya mengeluarkan asap” menunjukkan masalah penting. Pencarian vektor selalu
mengembalikan dokumen terdekat walaupun tidak ada dokumen yang benar-benar menjawab. Jawaban awal
terlalu yakin bahwa panduan khusus tersedia. Setelah diperbaiki, agent menyatakan bahwa panduan
khusus belum ditemukan dan menawarkan pembuatan tiket helpdesk.

Persetujuan pengguna kemudian berhasil menghasilkan rancangan tiket yang dapat diperiksa dan
disimpan melalui kartu konfirmasi.

---

## Entri 6 — Rujukan sumber SOP diperjelas

Footer jawaban sebelumnya hanya menampilkan label umum “dokumen SOP”. Selain itu, pembaca rujukan
lama mencari kode seperti `SOP-IT-001`, padahal korpus baru menggunakan judul dan bagian dokumen.
Akibatnya, jawaban dapat memakai RAG dengan benar tetapi pengguna tetap tidak melihat dokumen mana
yang menjadi sumbernya.

Perbaikannya:

- judul dokumen dibawa sebagai metadata terstruktur;
- nama bagian dokumen ikut dicatat jika tersedia;
- tautan asli ditampilkan jika memang dikembalikan pencarian;
- rujukan tetap sampai ke browser ketika pekerjaan didelegasikan ke agent bawahan;
- rujukan disimpan bersama percakapan agar tidak hilang setelah halaman dimuat ulang;
- footer menampilkan “Sumber SOP yang ditemukan”, bukan hanya label umum.

Tautan sumber dibuka pada tab baru agar percakapan tetap tersedia saat pengguna memeriksa dokumen.

---

## Entri 7 — Perbaikan UI/UX C01–C08

Perbaikan dilakukan bertahap agar setiap perubahan dapat dilihat langsung di web.

| Kode | Masalah | Perbaikan |
|---|---|---|
| C01 | Metadata jawaban terlalu padat | Ringkasan sumber dibuat singkat; model, token, biaya, alat, dan SQL dipindah ke “Detail proses” |
| C02 | Rail agent kurang jelas dan sulit diakses | Ikon menjadi tombol, mendukung keyboard, dan membuka panel kemampuan agent |
| C03 | Identitas agent hilang setelah selesai | Nama dan peran agent dipertahankan di atas setiap jawaban |
| C04 | Tabel panjang sulit dipindai | Header dan kolom pertama dibuat tetap, area tabel dapat digulir, petunjuk muncul saat diperlukan |
| C05 | Dua navigasi kiri saling bersaing | Riwayat desktop dibuat ringkas dan dapat dibuka saat dibutuhkan |
| C06 | Jawaban panjang memenuhi layar | Jawaban panjang diringkas dengan tombol tampilkan lengkap dan ringkas kembali |
| C07 | Sapaan dan istilah tidak konsisten | Sapaan menjadi “Anda”, peran menjadi “agen AI”, dan “tool” di UI menjadi “kemampuan” |
| C08 | Sumber SOP terlalu umum | Judul, bagian, dan tautan sumber RAG ditampilkan dari hasil pencarian sebenarnya |

Gaya visual menggunakan liquid glass secara terbatas pada panel yang memang perlu berada di atas
konten, seperti detail proses, detail agent, dan tombol pengungkapan jawaban panjang. Kontras teks
tetap memakai token warna tema portal.

---

## Hasil pemeriksaan terakhir

| Pemeriksaan | Hasil |
|---|---|
| Kompilasi hot reload Next.js setelah C01–C08 | Berhasil |
| Akses halaman utama | HTTP 200 |
| Pembukaan detail agent dengan klik dan keyboard | Diimplementasikan |
| Tabel panjang dan horizontal scroll | Diimplementasikan |
| Jawaban panjang buka/ringkas | Diimplementasikan |
| Metadata sumber SOP pada jalur agent bawahan | Diimplementasikan |
| Pengujian visual seluruh resolusi layar | Belum lengkap |
| Pengujian otomatis tambahan hari ini | Tidak dijalankan |

---

## Kesalahan dan temuan kerja hari ini

- Istilah “gagal diramal” sempat terdengar seperti hasil negatif terhadap produk. Penyebab sebenarnya
  adalah riwayat pada titik pemotongan belum cukup.
- Ramalan merek sempat diminta langsung, tetapi hasil backtest belum mendukung penayangan angka
  gabungan yang dapat dipercaya. Portal sekarang menahan angka tersebut dan menawarkan per SKU.
- Jawaban SOP sempat menganggap hasil vektor terdekat sebagai bukti bahwa panduan yang cocok tersedia.
  Kedekatan vektor hanya dipakai untuk mengurutkan kandidat, bukan menjamin relevansi.
- Persetujuan singkat pengguna sempat kehilangan konteks tindakan yang ditawarkan sebelumnya.
- Footer SOP lama bergantung pada kode dokumen yang tidak dipakai korpus baru, sehingga sumber yang
  sebenarnya ditemukan tidak terlihat.
- Daftar karyawan per departemen pernah memicu `Maximum update depth exceeded`; pola pembaruan state
  komponen perlu tetap diawasi ketika isi jawaban berubah selama streaming.

---

## Masalah yang masih terbuka

- **C09 belum dikerjakan:** informasi agent pada tampilan mobile masih perlu disempurnakan.
- **Validasi visual responsif belum lengkap:** perubahan sudah berhasil dikompilasi, tetapi seluruh
  state belum diperiksa pada beberapa ukuran layar dan tema.
- **Kualitas ramalan merek:** belum layak ditampilkan sampai ada metode yang mengalahkan pembanding
  sederhana secara konsisten.
- **Produk dengan riwayat sangat pendek:** belum dapat dievaluasi atau diramal secara wajar.
- **Kemampuan lembur:** perlu dipastikan apakah alat pengajuan lembur akan dipasang pada Agent Super
  Tools atau tetap hanya tersedia sebagai pembacaan status.
- **Perubahan belum disimpan ke Git**, sehingga belum ada titik cadangan untuk pekerjaan hari ini.

---

## Rencana berikutnya

1. Mengerjakan C09: menampilkan informasi agent yang cukup pada layar mobile.
2. Menguji kembali pertanyaan SOP dan memastikan judul serta bagian sumber tampil di footer.
3. Memeriksa tampilan tema terang, gelap, dan sistem pada ukuran desktop serta mobile.
4. Menguji alur konfirmasi untuk tiket, lembur, pelamar, dan tindakan tulis lain dengan kalimat
   persetujuan yang berbeda.
5. Meninjau kembali kemampuan pengajuan lembur pada Agent Super Tools.
6. Menyimpan perubahan ke Git setelah pemeriksaan akhir.
