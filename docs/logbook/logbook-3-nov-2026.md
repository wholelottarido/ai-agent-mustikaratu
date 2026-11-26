# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Selasa, 3 November 2026
**Proyek:** Pindah ke server database baru, melengkapi ramalan penjualan sesuai
dokumen spesifikasi, dan memperbaiki pertanyaan data karyawan
**Lokasi kerja:** folder `marketing/`

> Hari ini dimulai dengan server database yang berpindah, lalu dilanjutkan dengan
> menyamakan ramalan penjualan dengan dokumen spesifikasi tim sebelah.

> **Temuan terbesar hari ini:** angka ketepatan yang ditampilkan ke pemakai
> terlihat lebih baik daripada kenyataannya. Rata-rata tertulis meleset 25%, padahal
> pada jarak ramalan sekarang kenyataannya sekitar 40–51%. Jawaban kini menyebut
> perkiraan yang lebih jujur itu.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Portal memakai server database baru | Selesai |
| Pilihan produk bisa langsung diklik, tetap ada setelah pindah chat | Selesai, tampilan di browser belum dicek ulang untuk teks tombol terbaru |
| Pencarian produk lewat kode SKU | Selesai |
| Tren naik/turun dan 3 bulan penjualan terakhir di jawaban ramalan | Selesai |
| Pengukuran ramalan sampai 12 bulan | Selesai, batas tetap 6 bulan |
| Keterangan Ramadan dan Lebaran | Selesai |
| Pertanyaan karyawan per departemen | Selesai |
| Agent Admin di Gemma tidak gagal lagi | Selesai, dengan alat dibatasi |

---

## Entri 1 — Pindah ke server database baru

**Waktu:** pagi

Server database perusahaan berpindah, dan server baru ini akan dipakai seterusnya.
Akun-akun database yang dipakai portal belum ada di sana, jadi dibuat ulang dengan
skrip yang sudah ada, atas persetujuan pemilik proyek.

Akun baca portal juga diberi akses ke dokumen SOP, dan tiga alat riset pasar
didaftarkan di server baru. Data sudah dicocokkan: 1.737 produk, penjualan sampai
Juli 2026, dan 322 potongan dokumen SOP.

---

## Entri 2 — Tombol pilihan produk

**Waktu:** pagi

Saat nama produk cocok ke banyak varian, pemakai kini tinggal mengklik pilihannya
tanpa mengetik ulang. Dari hasil mencoba di layar, ada dua kekurangan yang diperbaiki:

1. Tombol tidak muncul kalau pertanyaan yang sama diajukan lagi.
2. Tombol hilang setelah pindah ke percakapan lain lalu kembali. Daftar pilihan kini
   ikut disimpan bersama pesan.

Pesan dari tombol kini menyebut tujuan dan kode produknya, misalnya
`Ramalan penjualan: MINYAK CEMCEMAN 175 ML RJ (kode 1005998)`. Tujuannya supaya
model tidak lupa pertanyaan awalnya. Pencarian produk juga kini menerima kode SKU dan
tidak terganggu perbedaan spasi pada nama.

Masih ada kekurangan kecil di Gemma: sesekali setelah tombol tren pasar ditekan,
daftar pilihan muncul sekali lagi. Jawabannya tidak salah, pemakai cukup menekan
sekali lagi.

---

## Entri 3 — Menyamakan ramalan dengan dokumen spesifikasi

**Waktu:** siang

Dokumen spesifikasi forecast dari tim sebelah dibaca dan dibandingkan dengan portal.
Kekurangannya dikerjakan berurutan:

- **Tren:** jawaban menyebut naik, turun, atau stabil dengan batas 5%, dibanding
  rata-rata 3 bulan terakhir. Persennya dihitung oleh alat ramalan, bukan oleh model
  bahasa. Tren tidak dinilai kalau angkanya sendiri hanya rata-rata pengganti, karena
  hasilnya akan selalu "stabil".
- **3 bulan penjualan terakhir:** ikut ditampilkan sebagai pembanding.
- **Keterangan Ramadan dan Lebaran:** tiap bulan yang berkaitan diberi keterangan,
  misalnya Januari 2027 "menjelang Ramadan". Tanggalnya dihitung dari kalender Hijriah
  bawaan Node dan dicocokkan dengan 8 tanggal Lebaran di Indonesia, dengan selisih
  paling banyak 1 hari. Karena itu selalu ditulis "sekitar". Model dilarang menyebutnya
  sebagai penyebab naik-turunnya penjualan, sesuai spesifikasi.

---

## Entri 4 — Mengukur ramalan sampai 12 bulan

**Waktu:** siang sampai sore

Spesifikasi meminta ramalan sampai 12 bulan, sedangkan portal membatasi 6 bulan.
Sebelum batasnya dibuka, ketepatannya diukur: pada 100 produk dan 3 titik waktu,
data terakhir disembunyikan, lalu ramalannya dibandingkan dengan penjualan aslinya.

| Jarak dari data terakhir | Meleset (semua digabung) | Meleset (median per produk) | Penjualan asli masuk rentang |
|---|---|---|---|
| 1–3 bulan | 27,5% | 28,1% | 67% |
| 4–6 bulan | 34,8% | 39,8% | 61% |
| 7–8 bulan | 42,5% | 51,0% | 52% |
| 9–12 bulan | 42,0% | 55,9% | 52% |

**Temuan**

1. Angka ketepatan yang ditampilkan rata-rata (median) 25%, padahal hanya diuji pada
   jarak 3 bulan. Data berhenti di Juli 2026, jadi "3 bulan ke depan" hari ini sebenarnya
   berjarak 5–7 bulan. Rentang ramalan juga lebih sempit daripada yang seharusnya.
2. Sistem pemilih model kalah dari cara sederhana, yaitu rata-rata 3 bulan terakhir
   (24,2% lawan 27,5% pada jarak terdekat). Saat rata-rata itu ikut bersaing, hasilnya
   hanya membaik sekitar 1 poin.
3. Total penjualan setahun lebih bisa dipakai (meleset 29,6%) daripada angka per bulan
   pada jarak jauh.

**Keputusan**

- Batas tetap 6 bulan.
- Jawaban kini menyebut perkiraan meleset sesuai jarak, di samping angka ketepatan.
- Model di portal belum diganti. Ide rata-rata 3 bulan muncul dari 100 produk yang
  sama, jadi perlu diuji pada produk lain. LightGBM juga belum ikut diukur.

**Batasan:** titik waktu hanya 3, dan hasilnya cukup berbeda antar titik waktu.

---

## Entri 5 — Pengujian dengan Haiku dan Gemma

**Waktu:** siang sampai sore

Saldo Claude sempat habis lalu terisi lagi, jadi uji bisa diulang dengan Haiku.

- **Produk yang sudah berhenti dijual:** 6 dari 6 jawaban benar, tanpa angka ramalan.
  Masalah kemarin tidak muncul lagi, tetapi penyebab aslinya belum terbukti.
- **Haiku bertanya balik tanpa memanggil alat:** untuk "minyak zaitun", alat hanya
  dipanggil 29 dari 48 kali. Setelah ada aturan "panggil alat dulu", naik jadi 23 dari
  24 kali. Aturan ini berlaku untuk semua agent, dan uji agent lain tetap lolos.
- **Model menghitung sendiri rata-rata pembanding:** hitungannya benar, tetapi angka
  tidak boleh berasal dari model bahasa. Kini angkanya disediakan alat ramalan.

Hasil uji terakhir untuk ramalan (keterangan kalender sudah termasuk):

| Uji | Haiku | Gemma |
|---|---|---|
| Agent | 15/15 dua kali, 14/15 sekali | 14/15 |
| Perute | 12/12 | 12/12 |
| Tombol | 35/35 | 35/35 |

Dua kegagalan yang tersisa: Haiku sekali tidak terbaca menyebut bulan terakhir data
(pemeriksanya sudah dilonggarkan, belum diulang), dan Gemma sekali tidak menyebut
rentang ramalan. Daftar yang wajib disampaikan model makin panjang, jadi ini perlu
diawasi.

---

## Entri 6 — Pertanyaan data karyawan

**Waktu:** sore

Pemilik proyek menemukan pertanyaan seperti "karyawan tertua" dan "siapa saja karyawan
IT" tidak terjawab. Penyebabnya berbeda-beda:

1. **Karyawan per departemen.** Alat Direktori karyawan belum punya penyaring
   departemen. Atas permintaan pemilik proyek, penyaring **Departemen `sama`** dipasang
   di database lewat fungsi yang sama dengan layar Kelola AI. Hasilnya, Haiku dan Gemma
   sama-sama menyebut ke-17 orang IT.
2. **Karyawan umur tertua.** Tetap tidak dijawab. Tanggal lahir sengaja ditutup sebagai
   data pribadi, dan membukanya perlu keputusan HR atau perusahaan.
3. **Agent Admin di Gemma selalu gagal.** Permintaannya melebihi batas 8.192 token
   karena membawa 37 alat. Model di server kantor kini dibatasi 15 alat per agent, jadi
   22 alat Admin tidak tersedia di Gemma. Di Haiku semua alat tetap ada.
4. **Data tanpa tanggal terbawa ke atas saat diurutkan.** Sudah diperbaiki untuk semua
   alat.

Layar Kelola AI juga mendapat pilihan arah urutan untuk alat baru. Pilihan ini belum
dicoba dari layarnya.

**Masalah pada datanya**

- Dari 2.007 karyawan, hanya 15 yang punya tanggal mulai kerja, jadi pertanyaan
  "paling lama bekerja" dan "paling baru bergabung" belum bisa dipercaya.
- 1.104 karyawan tidak punya departemen.
- Ada akun yang terlihat seperti data uji di daftar karyawan, misalnya "UJI PORTAL
  KEPALA - HAPUS". Asal-usulnya belum ditelusuri.

---

## Entri 7 — Mencoba pertanyaan tim Marketing

**Waktu:** sore

Tujuh contoh pertanyaan dicoba lewat portal dengan Haiku, masing-masing sekali.
Ramalan, tombol pilihan, tren pasar, perbandingan ramalan dengan tren, dan daftar
karyawan terjawab. Daftar karyawan hanya menampilkan 20 dari 92 orang.

Yang belum bisa:

- **"Berapa total penjualan bulan lalu?"** Agent Report belum punya alat data penjualan.
- **"Siapa saja pesaing produk kita?"** Alat riset pesaing hanya bisa meneliti merek yang
  sudah disebut.

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- Beberapa program uji tidak menutup diri setelah selesai, sehingga hasilnya tertahan
  hampir dua jam. Skrip uji ramalan sudah diperbaiki. Uji `test:perute` masih punya
  masalah yang sama.
- Pengukuran rata-rata 3 bulan tiga kali tidak sah karena perubahan skripnya tidak
  terpasang atau cara barunya tidak benar-benar ikut bersaing. Kejanggalannya terlihat
  dari angka yang sama persis dengan pengukuran pertama, lalu diulang sampai sah.
- Komputer sempat kehabisan memori karena terlalu banyak proses berjalan bersamaan.
  Tidak ada kerusakan.
- Satu dugaan penyebab masalah Haiku (jumlah alat terlalu banyak) terbukti salah setelah
  diuji.

---

## Rencana berikutnya

1. Membuat alat total penjualan untuk tim Marketing.
2. Menelusuri akun uji di daftar karyawan sebelum memutuskan penghapusannya.
3. Menguji rata-rata 3 bulan pada 100 produk lain, sekaligus mengecek apakah LightGBM bisa
   ikut dinilai.
4. Melanjutkan daftar spesifikasi: gabungan model, skenario jumlah outlet, ramalan semua
   produk atau merek, dan peringkat produk.
5. Memutuskan penyimpanan kode: banyak berkas belum di-commit, dan repositorinya publik.
6. Memberi tahu tim sebelah soal akun database baru di server baru.
