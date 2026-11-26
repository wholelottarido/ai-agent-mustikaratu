# Hasil Uji Beban Ratu AI — Model Qwen3 14B

**Tanggal uji:** 13 November 2026 (batas 2), 16 November 2026 pagi (batas 3), dan 16 November 2026 siang (batas 4)
**Rencana:** `docs/benchmark/rencana-uji-beban-qwen3-14b.md`
**Grafik:** `docs/grafik-uji-beban-qwen3-14b.html` (tab Cara uji · Batas 2 · Batas 3 · Batas 4 · Bandingkan) dan `.png`
**Data mentah:** folder `data/` (tidak ikut Git), daftar lengkap di bagian 10

> Laporan ini hanya membahas jalur **langsung ke model**. Hasil uji lewat halaman portal tanggal
> 13 November disimpan utuh di `docs/benchmark/hasil-uji-beban-qwen3-14b-13-nov-lengkap.md`, dan akan diuji
> ulang setelah portal berjalan di server.

---

## 1. Ringkasan

Pertanyaan yang ingin dijawab: **kalau banyak orang bertanya ke Ratu AI bersamaan, berapa lama
mereka menunggu, dan seberapa berat kerja server modelnya?**

Server model punya setelan **batas permintaan yang dikerjakan sekaligus** (`max-num-seqs`).
Bayangkan loket: batas 2 berarti 2 petugas, batas 3 berarti 3 petugas, dan seterusnya. Permintaan
selebihnya menunggu giliran. Uji dijalankan dengan batas 2, lalu 3, lalu 4. Model, GPU, dan panjang
konteks (16.384 token) sama di semua uji.

| Ukuran | Batas 2 | Batas 3 | Batas 4 |
|---|---:|---:|---:|
| 5 orang, waktu tengah menjawab | 60–73 dtk | 58 dtk | **37 dtk** |
| 8 orang, waktu tengah menjawab | 125–129 dtk | 84 dtk | **77 dtk** |
| 8 orang, 95% pertanyaan selesai di bawah | 149–155 dtk | **106 dtk** | 113 dtk |
| 8 orang, jeda sebelum model mulai menulis | 17–20 dtk | 10 dtk | **6 dtk** |
| 8 orang, lama satu panggilan ke model | 28 dtk | 18 dtk | **15 dtk** |
| 8 orang, permintaan yang menunggu giliran | 4,6–4,7 | 3,2 | **2,7** |
| Listrik GPU saat 8 orang | 223 W | 221 W | 223 W |
| Pertanyaan terjawab benar | 57 dan 53 dari 57 | 54 dari 57 | **57 dari 57** |
| Panggilan ke model yang gagal di server | 0 | 0 | 0 |

Angka batas 2 berupa rentang karena diuji dua kali (pagi dan siang).

Kesimpulan:
1. **Menaikkan batas dari 2 ke 3 memberi perbaikan terbesar.** Saat 8 orang bertanya bersamaan,
   Ratu AI sekitar sepertiga lebih cepat.
2. **Batas 4 masih lebih cepat lagi, tetapi tambahannya lebih kecil.** Di 5 orang, perbaikannya jelas
   (58 → 37 detik). Di 8 orang, waktu tengah hanya turun sedikit (84 → 77 detik), dan 95% pertanyaan
   justru selesai sedikit lebih lama (106 → 113 detik).
3. **Menaikkan batas tidak menambah listrik atau panas GPU.** Yang naik hanya memori kerja model,
   dari 36% ke 50%, dan itu masih aman.
4. **Penyebab lambat tetap antrean**, bukan kecepatan model. Tanpa antrean, model mulai menulis
   dalam sepersekian detik.
5. **Server stabil.** Dari 888 panggilan ke model di empat uji, tidak ada yang gagal.

---

## 2. Cara uji

| Hal | Isi |
|---|---|
| Model | Qwen3 14B (versi AWQ), lewat gerbang model (LiteLLM), server dengan GPU NVIDIA A10G 24 GB (batas listrik 300 W) |
| Panjang konteks | 16.384 token, sama di semua uji |
| Jalur | Langsung ke Ratu AI, tanpa lewat halaman portal |
| Tahap | 1, 2, 3, 5, lalu 8 orang bertanya bersamaan |
| Pertanyaan | 3 per orang, dari 8 jenis yang sama (lihat bagian 3), masing-masing di percakapan baru |
| Batas waktu | 5 menit per pertanyaan; lebih dari itu dihitung "tidak terjawab" |
| Jeda antar tahap | 2 menit, supaya antrean tahap sebelumnya kosong |
| Akun | Satu akun untuk semua "orang" virtual |
| Tiket | Hanya sampai rancangan. Jumlah tiket di database diperiksa sebelum dan sesudah: 0 bertambah di semua uji |

Empat uji yang dibandingkan:

| Uji | Batas sekaligus | Jam (WIB) | Rekam GPU |
|---|---:|---|---|
| 13 Nov pagi | 2 | 10.46–11.11 | tidak |
| 13 Nov siang | 2 | 13.31–13.59 | ya, setiap 0,5 detik |
| 16 Nov pagi | 3 | 09.23–09.47 | ya, setiap 0,5 detik |
| 16 Nov siang | 4 | 11.10–11.32 | ya, setiap 0,5 detik |

Setelan diubah oleh pengelola server, bukan oleh uji ini. Sebelum uji batas 4, setelan server
diperiksa lebih dulu (hanya dibaca) untuk memastikan batasnya memang 4.

Selain hasil skrip uji, angka di laporan ini diambil dari tiga sumber di server. Semuanya hanya
dibaca:

- **Catatan server model (vLLM):** isi antrean, kira-kira setiap 10 detik.
- **Catatan gerbang model (LiteLLM):** waktu dan jumlah token setiap panggilan ke model. Isi
  percakapan tidak dibaca.
- **`nvidia-smi`:** kerja, listrik, dan suhu GPU.

---

## 3. Pertanyaan uji

| Kode | Jenis | Pertanyaan | Dianggap benar kalau |
|---|---|---|---|
| Q1 | Data penjualan | Berapa total penjualan September 2026? | Memakai alat data penjualan, dan angkanya sama dengan database (156.770 unit) |
| Q2 | Peringatan dini | Produk apa yang penjualannya turun di September 2026? | Memakai alat pergerakan penjualan |
| Q3 | Stok kosong | Produk apa yang paling sering kosong di September 2026? | Memakai alat stok kosong |
| Q4 | SOP | Bagaimana prosedur pengajuan cuti? | Memakai alat pencarian SOP |
| Q5 | Rancangan tiket | Buatkan tiket, komputer saya tidak ada akses internet | Menyiapkan rancangan tiket atau menanyakan detailnya; tiket tidak boleh langsung tersimpan |
| Q6 | Data karyawan | Siapa saja karyawan departemen IT? | Memakai alat data karyawan |
| Q7 | Harus ditolak | Berapa gaji direktur? | Tidak menyebut angka rupiah |
| Q8 | Sapaan | Halo, kamu bisa bantu apa saja? | Menjawab tanpa mengambil data |

Isi jawaban tidak disimpan, jadi "kurang tepat" dinilai dari alat yang dipakai.

---

## 4. Berapa lama Ratu AI menjawab

Waktu dihitung dari pertanyaan dikirim sampai jawaban selesai ditulis. **Waktu tengah** artinya
separuh pertanyaan selesai lebih cepat dari angka itu. **95% di bawah** artinya 95 dari 100
pertanyaan selesai di bawah angka itu. Setiap sel berisi waktu tengah / 95% di bawah.

| Orang bersamaan | Batas 2 pagi | Batas 2 siang | Batas 3 | Batas 4 |
|---:|---:|---:|---:|---:|
| 1 | 18 / 25 dtk | 34 / 35 dtk | 16 / 24 dtk | 20 / 32 dtk |
| 2 | 42 / 77 dtk | 28 / 66 dtk | 44 / 79 dtk | 33 / 69 dtk |
| 3 | 44 / 82 dtk | 43 / 73 dtk | 35 / 77 dtk | 33 / 73 dtk |
| 5 | 73 / 101 dtk | 60 / 95 dtk | 58 / 90 dtk | **37** / 103 dtk |
| 8 | 125 / 155 dtk | 129 / 149 dtk | 84 / **106** dtk | **77** / 113 dtk |

Ratu AI tidak selalu memanggil model sebanyak yang sama untuk pertanyaan yang sama. Perbandingan
waktu baru adil kalau jumlah panggilan per pertanyaannya mirip:

| Orang bersamaan | Batas 2 pagi | Batas 2 siang | Batas 3 | Batas 4 |
|---:|---:|---:|---:|---:|
| 5 | 3,7 | 5,5 | 3,7 | 3,8 |
| 8 | 3,5 | 4,3 | 4,3 | 3,5 |

Yang terbaca:
- **Di 5 orang, batas 4 jelas paling cepat** (37 detik, dari 58 dengan batas 3 dan 73 dengan batas 2
  pagi). Ketiga uji ini memanggil model hampir sama seringnya, jadi perbandingannya adil.
- **Tetapi 95% pertanyaan di 5 orang selesai sedikit lebih lama dengan batas 4** (103 detik). Angka
  ini ditarik oleh satu pertanyaan peringatan dini (Q2) yang butuh 103 detik. Dengan hanya 15
  pertanyaan per tahap, satu pertanyaan lambat sudah menggeser angka 95%.
- **Di 8 orang, batas 3 dan 4 sama-sama jauh lebih cepat daripada batas 2.** Batas 4 vs batas 2 pagi
  adil (keduanya 3,5 panggilan per pertanyaan): 125 → 77 detik. Batas 4 vs batas 3 kurang adil,
  karena di uji batas 4 Ratu AI memanggil model lebih jarang (3,5 vs 4,3 kali). Jadi sebagian dari
  selisih 84 → 77 detik datang dari langkah yang lebih sedikit, bukan dari setelannya.
- **Sampai 3 orang, semua uji mirip.** Selisih di 1 dan 2 orang hanya naik-turun biasa, karena
  contohnya sedikit (3–6 pertanyaan) dan jenisnya berbeda-beda beratnya.
- **Target 5 orang tercapai di semua uji** (waktu tengah ≤ 90 detik, 95% ≤ 180 detik).

**Per jenis pertanyaan, 5 orang bersamaan (waktu tengah, detik):**

| Pertanyaan | Batas 2 pagi | Batas 2 siang | Batas 3 | Batas 4 |
|---|---:|---:|---:|---:|
| Q1 Data penjualan | 78 | 70 | 65 | 33 |
| Q2 Peringatan dini | 96 | 90 | 81 | 89 |
| Q3 Stok kosong | 71 | 81 | 57 | 50 |
| Q4 SOP | 65 | 45 | 45 | 36 |
| Q5 Rancangan tiket | 64 | 77 | 44 | 37 |
| Q6 Data karyawan | 76 | 64 | 72 | 46 |
| Q7 Harus ditolak | 30 | 20 | 27 | 20 |
| Q8 Sapaan | 33 | 38 | 40 | 34 |

Setiap jenis hanya ditanya 1–2 kali per tahap, jadi tabel ini cukup untuk melihat pola, bukan untuk
membandingkan satu angka.

Pertanyaan yang perlu mengambil data (Q1–Q6) lebih lama daripada sapaan dan pertanyaan yang
ditolak, karena Ratu AI perlu beberapa langkah: memahami pertanyaan, memilih alat, mengambil data,
lalu menyusun jawaban. Q2 (peringatan dini) tetap yang paling lama di semua setelan.

---

## 5. Apakah jawabannya tetap benar

| Uji | Terjawab | Benar |
|---|---:|---:|
| Batas 2, 13 Nov pagi | 57 dari 57 | 57 |
| Batas 2, 13 Nov siang | 54 dari 57 | 53 |
| Batas 3, 16 Nov pagi | 56 dari 57 | 54 |
| Batas 4, 16 Nov siang | 57 dari 57 | 57 |

Pertanyaan yang bermasalah:

| Uji | Saat | Pertanyaan | Hasil | Penyebab |
|---|---|---|---|---|
| Batas 2 siang | 5 orang, 13.43 | Q4 SOP | Kurang tepat | Menjawab tanpa memakai alat pencarian SOP |
| Batas 2 siang | 5 orang, 13.43 | Q5 Rancangan tiket | Tidak terjawab | Belum selesai setelah 5 menit |
| Batas 2 siang | 8 orang, 13.51 | Q5 Rancangan tiket | Tidak terjawab | Belum selesai setelah 5 menit |
| Batas 2 siang | 8 orang, 13.53 | Q4 SOP | Tidak terjawab | Belum selesai setelah 5 menit |
| Batas 3 | 8 orang, 09.41 | Q5 Rancangan tiket | Tidak terjawab | Belum selesai setelah 5 menit |
| Batas 3 | 8 orang, 09.44 | Q5 Rancangan tiket | Kurang tepat | Hanya mencari SOP, tidak menyiapkan rancangan tiket |
| Batas 3 | 8 orang, 09.45 | Q4 SOP | Kurang tepat | Menjawab tanpa memakai alat pencarian SOP |

Uji batas 4 tidak punya pertanyaan bermasalah.

Yang terbaca:
- **Masalahnya selalu di pertanyaan tiket dan SOP**, dan hanya muncul saat 5–8 orang bertanya
  bersamaan.
- **Menaikkan batas tidak membuat jawaban kurang tepat.** Batas 4 bahkan benar semua.
- **Tetapi belum bisa disimpulkan masalah tiket dan SOP hilang di batas 4.** Uji batas 2 pagi juga
  benar semua, sementara uji batas 2 siang dengan setelan yang sama punya 4 masalah. Masalah ini
  muncul tidak tentu, dan tiap setelan baru diuji satu atau dua kali.
- Pertanyaan data, pertanyaan yang ditolak, dan sapaan selalu benar di keempat uji.
- Langkah-langkah Ratu AI tidak direkam, jadi penyebab pastinya belum diketahui. Dugaannya, dua
  jenis pertanyaan ini kadang memerlukan lebih banyak langkah, sehingga lebih lama antre dan lebih
  mudah keliru memilih alat.

---

## 6. Kenapa makin lama: antrean di server model

Dibaca dari catatan server model. **Model penuh** artinya model sedang mengerjakan permintaan
sebanyak batasnya (2, 3, atau 4).

**Persen waktu model penuh:**

| Orang bersamaan | Batas 2 pagi | Batas 2 siang | Batas 3 | Batas 4 |
|---:|---:|---:|---:|---:|
| 1 | 0% | 31% | 0% | 0% |
| 2 | 56% | 72% | 0% | 0% |
| 3 | 71% | 80% | 29% | 0% |
| 5 | 94% | 82% | 81% | 48% |
| 8 | 99% | 100% | 78% | 96% |

**Rata-rata permintaan yang menunggu giliran:**

| Orang bersamaan | Batas 2 pagi | Batas 2 siang | Batas 3 | Batas 4 |
|---:|---:|---:|---:|---:|
| 3 | 0,4 | 0,4 | 0 | 0 |
| 5 | 2,0 | 1,4 | 1,0 | **0,3** |
| 8 | 4,7 | 4,6 | 3,2 | **2,7** |

(Di 1 dan 2 orang, tidak ada yang menunggu di semua uji.)

Yang terbaca:
- **Setiap batas dinaikkan, antrean berkurang.** Di 8 orang, yang menunggu turun dari hampir 5
  (batas 2) ke sekitar 3 (batas 3) lalu 2,7 (batas 4).
- **Di 5 orang, batas 4 hampir tidak antre** dan model hanya penuh separuh waktu. Itu sebabnya
  batas 4 paling terasa di 5 orang.
- **Di 8 orang, batas 4 kembali hampir selalu penuh (96%).** Dengan 8 orang dan 4 "petugas", antrean
  tetap terbentuk.
- Di 8 orang, batas 3 "hanya" penuh 78% waktu. Ini karena di akhir tahap tinggal satu pertanyaan
  tiket yang berjalan sendirian sampai batas 5 menit.
- **Memori kerja model masih aman.** Paling tinggi terpakai 31% dengan batas 2, 36% dengan batas 3,
  dan 50% dengan batas 4.
- **Model menulis lebih banyak per detik setiap batas dinaikkan.** Di 5–8 orang sekitar 77–84 token
  per detik dengan batas 2, 104–111 dengan batas 3, dan 119–140 dengan batas 4. Makin banyak
  permintaan yang dikerjakan bersamaan, makin banyak pekerjaan selesai per detik.

---

## 7. Seberapa berat kerja GPU

Direkam setiap setengah detik pada uji 13 Nov siang (batas 2), 16 Nov pagi (batas 3), dan 16 Nov
siang (batas 4). Saat tidak ada pertanyaan, GPU memakai sekitar 61–64 watt.

**Listrik rata-rata dan puncak (watt), rata-rata / puncak:**

| Orang bersamaan | Batas 2 | Batas 3 | Batas 4 |
|---:|---:|---:|---:|
| 1 | 207 / 228 | 179 / 265 | 185 / 261 |
| 2 | 215 / 265 | 215 / 265 | 214 / 264 |
| 3 | 217 / 257 | 218 / 264 | 215 / 259 |
| 5 | 222 / 268 | 217 / 268 | 217 / 266 |
| 8 | 223 / 269 | 221 / 265 | 223 / 266 |

**Suhu puncak dan listrik per jawaban:**

| Orang bersamaan | Suhu puncak (batas 2 / 3 / 4) | Listrik per jawaban (batas 2 / 3 / 4) |
|---:|---:|---:|
| 1 | 63 / 56 / 59 °C | 1,25 / 0,70 / 0,94 Wh |
| 2 | 66 / 63 / 64 °C | 0,87 / 1,28 / 1,00 Wh |
| 3 | 60 / 64 / 63 °C | 0,77 / 0,83 / 0,71 Wh |
| 5 | 66 / 66 / 65 °C | 1,14 / 0,57 / 0,53 Wh |
| 8 | 67 / 66 / 67 °C | 0,96 / 0,69 / **0,48** Wh |

"Listrik per jawaban" adalah listrik di atas kondisi diam selama tahap itu, dibagi jumlah jawaban
yang selesai.

Yang terbaca:
- **Menaikkan batas tidak menambah beban listrik maupun panas.** Listrik rata-rata dan suhu hampir
  sama di ketiga setelan, dan tetap jauh di bawah batas kartu 300 W.
- **Listrik per jawaban di 8 orang terus turun** (sekitar 1,0 → 0,7 → 0,5 Wh), karena GPU
  menyelesaikan lebih banyak jawaban dalam waktu yang sama.
- **Persen "GPU sibuk" kurang berguna untuk melihat beban.** Angkanya sudah 70–100% walau baru
  1 orang, karena angka ini hanya menunjukkan GPU sedang bekerja atau tidak, bukan seberapa keras.
  Listrik lebih tepat dipakai.

---

## 8. Jeda sebelum model mulai menulis

Satu pertanyaan membuat Ratu AI memanggil model 3 sampai 5 kali. Angka ini mengukur setiap
panggilan: berapa detik sampai model mengeluarkan kata pertamanya. Sumbernya catatan gerbang model.

**Jeda, waktu tengah (detik):**

| Orang bersamaan | Batas 2 pagi | Batas 2 siang | Batas 3 | Batas 4 |
|---:|---:|---:|---:|---:|
| 1 | 0,05 | 0,08 | 0,23 | 0,25 |
| 2 | 0,13 | 0,14 | 0,17 | 0,18 |
| 3 | 0,89 | 0,90 | 0,11 | 0,10 |
| 5 | 8,0 | 6,5 | 4,0 | **0,9** |
| 8 | 17,3 | 19,8 | 9,9 | **6,1** |

**Jeda 95% di bawah, dan lama satu panggilan (waktu tengah):**

| Orang bersamaan | Jeda 95% (batas 2 siang / 3 / 4) | Lama satu panggilan (batas 2 siang / 3 / 4) |
|---:|---:|---:|
| 1 | 0,3 / 2,3 / 2,3 dtk | 5,5 / 5,1 / 7,1 dtk |
| 2 | 1,0 / 1,5 / 1,3 dtk | 7,0 / 7,3 / 6,2 dtk |
| 3 | 8,0 / 1,1 / 1,3 dtk | 8,2 / 6,7 / 7,3 dtk |
| 5 | 20,0 / 13,5 / 4,4 dtk | 12,5 / 10,8 / 8,1 dtk |
| 8 | 42,6 / 25,5 / 24,0 dtk | 27,9 / 17,6 / **15,4** dtk |

Yang terbaca:
- **Modelnya sendiri cepat.** Tanpa antrean, model mulai menulis dalam sepersekian detik. Jeda yang
  panjang hampir seluruhnya waktu menunggu giliran.
- **Setiap batas dinaikkan, jeda di 8 orang turun:** sekitar 20 → 10 → 6 detik. Di 5 orang, batas 4
  membuat jedanya kurang dari 1 detik.
- **Lama satu panggilan adalah pembanding yang paling adil**, karena tidak bergantung pada berapa
  kali Ratu AI memanggil model untuk satu pertanyaan. Di 8 orang angkanya 28 → 18 → 15 detik. Jadi
  batas 4 memang lebih cepat daripada batas 3, tetapi selisihnya kecil.
- **Setiap panggilan membawa sekitar 2.600–7.700 token masuk** (umumnya sekitar 3.900–4.200), kebanyakan
  instruksi untuk Ratu AI dan daftar alatnya, dan sekitar 260–275 token keluar.

---

## 9. Kesimpulan dan saran

| Temuan | Saran |
|---|---|
| Batas 3 membuat jawaban di 8 orang sekitar sepertiga lebih cepat daripada batas 2 | Jangan kembali ke batas 2 |
| Batas 4 paling cepat, terutama di 5 orang (58 → 37 detik), tanpa tambahan listrik atau panas. Di 8 orang tambahannya kecil (lama satu panggilan 18 → 15 detik) | **Batas 4 layak dipakai.** Keputusan setelan tetap ada di pengelola server |
| Memori kerja model naik ke 50% dengan batas 4 | Masih aman. Kalau ingin mencoba batas 5, pantau angka ini; perbaikannya kemungkinan makin kecil karena di 8 orang antrean sudah tinggal 2,7 |
| Pertanyaan tiket dan SOP kadang tidak selesai atau keliru memilih alat saat ramai (batas 2 dan 3); di batas 4 tidak terjadi, tetapi baru satu kali uji | Ulangi uji batas 4 sekali lagi, dan rekam langkah-langkah Ratu AI supaya penyebabnya bisa dipastikan |
| Jumlah panggilan per pertanyaan berbeda antar uji (3,5–5,5 di 5–8 orang), sehingga waktu total tidak selalu adil dibandingkan | Pakai lama satu panggilan dan jeda sebagai pembanding utama setelan |
| Setiap panggilan membawa instruksi yang panjang | Mempersingkat instruksi Ratu AI akan membuat setiap panggilan lebih ringan |
| Alamat tunnel Cloudflare berganti setiap server dinyalakan ulang | Pakai alamat tetap (tunnel bernama) atau tunnel SSH |
| Jalur lewat portal belum diuji dengan setelan baru | Uji ulang setelah portal berjalan di server, bukan di laptop |

**Perkiraan kapasitas dengan batas 4:** nyaman sampai sekitar 5 orang bersamaan (jawaban sekitar
40 detik), dan masih bisa dipakai di 8 orang (sekitar 1,3 menit). Angka ini dari uji dengan
pertanyaan yang sudah ditentukan, bukan pemakaian sungguhan.

---

## 10. Batasan uji

- **Setiap setelan baru diuji satu atau dua kali**, dengan 3 pertanyaan per orang. Angka di 1–2 orang
  mudah naik-turun karena contohnya sedikit. Kesimpulan paling kuat ada di 5 dan 8 orang.
- **Angka 95% di bawah mudah bergeser** karena satu tahap hanya berisi 15 (5 orang) atau 24 (8 orang)
  pertanyaan. Satu pertanyaan lambat sudah cukup untuk mengubahnya.
- Semua "orang" adalah skrip yang memakai satu akun, dengan pertanyaan yang sudah ditentukan.
  Pemakai sungguhan bertanya lebih beragam dan tidak selalu bersamaan.
- Catatan server model ditulis kira-kira setiap 10 detik, jadi persen "penuh" dan jumlah yang
  menunggu adalah perkiraan.
- Uji 13 Nov pagi tidak merekam GPU. Perbandingan GPU memakai uji 13 Nov siang, 16 Nov pagi, dan
  16 Nov siang.
- Uji dijalankan di hari dan jam yang berbeda. Server model hanya dipakai uji ini selama uji
  berlangsung, tetapi kondisi jaringan bisa sedikit berbeda.
- Model pencarian SOP berjalan di laptop yang memorinya hampir penuh, dan ini bisa ikut
  memperlambat Q4.

**Data (folder `data/`, tidak ikut Git):**

| Berkas | Isi |
|---|---|
| `uji-beban-qwen3-14b-2026-11-13-04-11-A.json` | Uji batas 2, 13 Nov pagi |
| `uji-beban-qwen3-14b-2026-11-13-06-59-A-dengan-gpu.json` | Uji batas 2, 13 Nov siang, dengan rekaman GPU |
| `uji-beban-qwen3-14b-2026-11-16-02-47-A-dengan-gpu.json` | Uji batas 3, 16 Nov pagi, dengan rekaman GPU |
| `uji-beban-qwen3-14b-2026-11-16-04-32-A-dengan-gpu.json` | Uji batas 4, 16 Nov siang, dengan rekaman GPU |
| `uji-beban-qwen3-14b-vllm.json`, `-vllm-ulang-A.json`, `-vllm-seqs3-A.json`, `-vllm-seqs4-A.json` | Ringkasan antrean server model per uji |
| `litellm-waktu-qwen3-14b-2026-11-13.csv`, `-2026-11-16.csv`, `-2026-11-16-seqs4.csv` | Waktu dan token setiap panggilan ke model |
| `uji-beban-qwen3-14b-2026-11-16-02-18-A-dengan-gpu-GAGAL.*` | Percobaan pertama 16 Nov yang gagal tersambung (alamat tunnel lama). Tidak dipakai |
