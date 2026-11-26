# Skrip Penjelasan — Uji Beban Ratu AI dengan Model Qwen3 14B

**Untuk:** menjelaskan hasil uji secara lisan, sambil menampilkan `docs/grafik-uji-beban-qwen3-14b.html`
**Lama bicara:** sekitar 6–8 menit
**Cakupan:** hanya jalur langsung ke model. Hasil lewat halaman portal belum dibahas.

> Cara pakai: teks biasa adalah yang diucapkan. Baris yang diawali **[Tampilkan]** adalah petunjuk
> layar, tidak perlu dibacakan.

---

## 1. Pembuka (±30 detik)

Selamat pagi/siang. Saya ingin menyampaikan hasil uji beban Ratu AI.

Pertanyaan yang ingin kami jawab sederhana: **kalau banyak orang bertanya ke Ratu AI pada waktu
yang sama, berapa lama mereka harus menunggu jawaban, dan seberapa berat kerja server modelnya?**

Model yang diuji adalah Qwen3 14B, yang berjalan di server perusahaan dengan satu kartu grafis
NVIDIA A10G.

**[Tampilkan]** bagian atas halaman, enam kotak angka.

Ringkasnya ada di enam kotak ini, dan saya akan jelaskan satu per satu.

---

## 2. Cara mengujinya (±1 menit)

**[Tampilkan]** bagian 1, "Apa yang diuji".

Kami membuat skrip yang berpura-pura menjadi beberapa orang yang bertanya bersamaan. Mulai dari
1 orang, lalu 2, 3, 5, dan terakhir 8 orang sekaligus.

Setiap orang mengirim 3 pertanyaan. Pertanyaannya dipilih dari 8 jenis yang mewakili fitur Ratu AI.
Contohnya: total penjualan, produk yang penjualannya turun, stok kosong, prosedur cuti, membuat
tiket helpdesk, data karyawan, pertanyaan yang harus ditolak seperti gaji direktur, dan sapaan biasa.

Untuk setiap jenis pertanyaan kami tentukan dulu apa artinya "benar". Misalnya, untuk total
penjualan, angkanya harus sama dengan database, yaitu 156.770 unit.

Uji dijalankan **dua kali dengan cara yang sama persis**: pagi hari, lalu siang hari. Uji siang
sekaligus merekam kerja kartu grafisnya. Karena hasil keduanya mirip, kita bisa cukup yakin
angkanya bukan kebetulan.

Hasilnya: **di uji pagi, 57 dari 57 pertanyaan terjawab dan benar.** Di uji ulang ada 3 pertanyaan
yang tidak selesai dalam 5 menit, dan 1 jawaban tentang SOP yang tidak mengambil datanya dari alat
pencarian SOP.

---

## 3. Berapa lama Ratu AI menjawab (±1,5 menit)

**[Tampilkan]** bagian 2, grafik "Makin banyak orang, makin lama menunggu".

Garis tegas di grafik ini adalah **waktu tengah**: separuh pertanyaan selesai lebih cepat dari
angka ini. Garis putus-putus adalah angka di mana **95 dari 100 pertanyaan** sudah selesai.

| Orang bertanya bersamaan | Waktu tengah (uji pagi) | Waktu tengah (uji ulang) |
|---:|---:|---:|
| 1 | 18 detik | 34 detik |
| 2 | 42 detik | 28 detik |
| 3 | 44 detik | 43 detik |
| 5 | 73 detik | 60 detik |
| 8 | 125 detik (sekitar 2 menit) | 129 detik |

Yang perlu diingat:
- **Sampai 3 orang, jawaban datang dalam kurang dari 1 menit.** Ini masih nyaman.
- **Di 5 orang, sekitar 1 menit lebih sedikit.** Target kami untuk 5 orang adalah 90 detik, dan
  target itu tercapai.
- **Di 8 orang, sekitar 2 menit.** Masih terjawab, tetapi orang mulai harus bersabar.

**[Tampilkan]** grafik "Pertanyaan mana yang paling lama".

Tidak semua pertanyaan sama beratnya. Pertanyaan yang perlu mengambil data, seperti penjualan atau
stok, **dua sampai tiga kali lebih lama** daripada sapaan atau pertanyaan yang ditolak. Sebabnya,
Ratu AI perlu beberapa langkah: memahami pertanyaan, memilih alat, mengambil data, lalu menyusun
jawaban.

---

## 4. Kenapa makin lama: antre (±1,5 menit)

**[Tampilkan]** bagian 3, grafik "Seberapa sering model sedang penuh".

Bayangkan sebuah loket dengan **hanya 2 petugas**. Kalau yang datang 2 orang, keduanya langsung
dilayani. Kalau yang datang 8 orang, 6 orang harus antre.

Server model kita bekerja persis seperti itu: **ia hanya mengerjakan 2 permintaan sekaligus.**
Permintaan ketiga dan seterusnya menunggu giliran.

Grafik ini menunjukkan seberapa sering kedua "petugas" itu sedang sibuk. **Mulai 5 orang, model
hampir selalu penuh**, dan di 8 orang penuh hampir 100% waktu.

**[Tampilkan]** grafik "Berapa permintaan yang menunggu".

Di 8 orang, rata-rata **hampir 5 permintaan sedang antre**.

Ada kabar baiknya: memori kerja model baru terpakai **sekitar sepertiga**. Artinya ruangnya masih
ada. Kalau batas "2 permintaan sekaligus" itu dinaikkan, kemungkinan besar antreannya berkurang.
Tetapi itu perubahan setelan server, jadi keputusannya ada di pengelola server dan harus diuji dulu.

---

## 5. Seberapa berat kerja kartu grafis (±1,5 menit)

**[Tampilkan]** bagian 4, grafik "GPU sepanjang uji ulang".

Kartu grafis direkam setiap setengah detik selama uji ulang.

Yang sering membingungkan: angka persen di sini **sudah hampir 100% walau baru 1 orang**. Itu
bukan berarti kartunya sudah kewalahan. Angka persen ini hanya menunjukkan kartu **sedang bekerja
atau tidak**, bukan seberapa keras. Jadi untuk melihat beratnya, kita lihat listriknya.

**[Tampilkan]** grafik "Listrik yang dipakai GPU".

| Orang bertanya bersamaan | Listrik rata-rata |
|---:|---:|
| (tidak ada pertanyaan) | 64 watt |
| 1 | 207 watt |
| 8 | 223 watt |

Batas kartu ini 300 watt. **Dari 1 ke 8 orang, listriknya hanya naik sedikit.** Ini cocok dengan
cerita loket tadi: orang yang bertambah lebih banyak menunggu giliran, bukan membuat kartunya
bekerja lebih keras.

**[Tampilkan]** grafik "Listrik untuk satu jawaban".

Satu jawaban memakai sekitar **1 watt-jam** listrik kartu grafis, kurang lebih sama berapa pun
jumlah orangnya. Suhu kartu tetap aman, paling tinggi 67 °C.

---

## 6. Berapa lama model diam sebelum mulai menulis (±1 menit)

**[Tampilkan]** bagian 5, grafik "Jeda sebelum model mulai menulis".

Saat menjawab satu pertanyaan, Ratu AI biasanya memanggil model **3 sampai 5 kali**. Bagian ini
mengukur setiap panggilan itu: berapa detik sampai model mengeluarkan kata pertamanya. Datanya
diambil dari catatan server, hanya waktunya, tanpa isi percakapan.

- **Kalau tidak ada antrean, model mulai menulis dalam 0,05 detik.** Hampir seketika. Jadi modelnya
  sendiri cepat.
- **Di 8 orang, jedanya naik ke sekitar 17–20 detik**, dan hampir seluruhnya adalah waktu menunggu
  giliran.

Ini bukti kedua bahwa **masalah utamanya antrean, bukan kecepatan model.**

Satu catatan tambahan: setiap panggilan membawa sekitar 3.800 token. Kebanyakan berupa instruksi
untuk Ratu AI dan daftar alatnya, bukan pertanyaan pengguna. Kalau instruksi ini bisa dipersingkat,
setiap panggilan juga ikut lebih ringan.

---

## 7. Kesimpulan (±45 detik)

Ada tiga hal yang ingin saya tekankan:

1. **Ratu AI dengan Qwen3 14B nyaman dipakai sampai sekitar 3 orang bersamaan** (jawaban di bawah
   1 menit), **masih memenuhi target di 5 orang** (sekitar 1 menit), dan **masih terjawab di
   8 orang** walau sekitar 2 menit.
2. **Yang membuat lambat adalah antrean di server model**, karena server hanya mengerjakan
   2 permintaan sekaligus. Modelnya sendiri cepat, dan kartu grafisnya belum bekerja maksimal.
3. **Server stabil:** dari 459 panggilan ke model di kedua uji, tidak ada satu pun yang gagal.
   Suhu kartu juga aman.

---

## 8. Saran langkah berikutnya (±30 detik)

1. **Menaikkan batas permintaan sekaligus** di server model, misalnya dari 2 menjadi 4, lalu
   mengulang uji yang sama untuk membandingkan. Ini keputusan pengelola server.
2. **Mempersingkat instruksi Ratu AI** supaya setiap panggilan lebih ringan.
3. **Menguji jalur lewat halaman portal** setelah portal dijalankan di server, bukan di laptop.

Terima kasih. Silakan kalau ada pertanyaan.

---

## Cadangan: perkiraan pertanyaan dan jawabannya

**"Kenapa uji ulang di 1 orang lebih lambat (34 detik) daripada uji pagi (18 detik)?"**
Di tahap 1 orang hanya ada 3 pertanyaan, dan jenisnya berbeda-beda beratnya. Dengan contoh sekecil
itu, angkanya mudah naik-turun. Di 3, 5, dan 8 orang, yang contohnya lebih banyak, hasil kedua uji
mirip.

**"Kenapa ada pertanyaan yang tidak selesai di uji ulang?"**
Yang tidak selesai adalah pertanyaan membuat tiket dan prosedur cuti, saat 5 dan 8 orang bertanya
bersamaan. Kondisi antrean servernya sama dengan pagi. Bedanya, di uji ulang Ratu AI memanggil model
lebih sering: di 5 orang rata-rata 5,5 kali per pertanyaan, sedangkan pagi 3,7 kali. Jadi dugaannya
Ratu AI mengambil langkah lebih banyak, lalu lebih lama antre dan melewati batas 5 menit. Ini belum
dipastikan, karena langkah-langkahnya tidak direkam.

**"Kalau GPU sudah 100%, berarti sudah penuh?"**
Belum. Angka 100% itu hanya berarti kartu sedang bekerja. Listriknya baru sekitar 220 dari
300 watt, dan memori kerja model baru terpakai sekitar sepertiga.

**"Apakah uji ini sudah mewakili pemakaian sungguhan?"**
Belum sepenuhnya. Semua "orang" di uji ini adalah skrip yang memakai satu akun, dengan pertanyaan
yang sudah ditentukan. Pemakai sungguhan bertanya lebih beragam dan tidak selalu bersamaan.

**"Apakah ada data atau tiket yang ikut terbuat selama uji?"**
Tidak. Ratu AI hanya menyiapkan rancangan tiket, dan jumlah tiket di database diperiksa sebelum dan
sesudah uji: tidak ada yang bertambah.

**"Bagaimana dengan hasil lewat halaman portal?"**
Sudah diuji juga, tetapi sedang tidak dibahas. Saat itu portal berjalan di laptop, dan laptopnya
kehabisan memori, sehingga hasilnya lebih menggambarkan keterbatasan laptop daripada Ratu AI. Uji
ini akan diulang setelah portal berjalan di server.
