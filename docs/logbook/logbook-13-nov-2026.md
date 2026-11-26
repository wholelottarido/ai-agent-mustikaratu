# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Jumat, 13 November 2026
**Proyek:** Menjalankan uji beban Ratu AI dengan model Qwen3 14B, merekam beban server dan kartu grafis, lalu menyusun laporan, halaman grafik, dan naskah penjelasan
**Lokasi kerja:** folder `marketing/`

> Hari ini rencana uji beban dari kemarin dijalankan. Skrip berpura-pura menjadi 1, 2, 3, 5, dan
> 8 orang yang bertanya ke Ratu AI bersamaan. Setiap orang mengirim 3 pertanyaan. Uji dijalankan
> dua kali: pagi, lalu siang. Uji siang sekaligus merekam kerja kartu grafis server model.

> **Temuan terbesar hari ini:** Ratu AI menjadi lambat karena **antrean**, bukan karena modelnya
> lambat. Server model hanya mengerjakan **2 permintaan sekaligus**. Tanpa antrean, model mulai
> menulis dalam 0,05 detik. Pada 8 orang, jeda itu naik menjadi 17–20 detik karena menunggu giliran.
> Kartu grafisnya belum bekerja maksimal: listriknya 223 dari 300 watt.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Uji beban pagi, jalur A (langsung ke model) dan jalur B (lewat portal) | Selesai |
| Laporan hasil (`.md`) dan halaman grafik (`.html` + `.png`) | Selesai |
| Membaca beban server model lewat akses EC2 (hanya membaca) | Selesai |
| Alat perekam kartu grafis | Selesai |
| Uji ulang jalur A sambil merekam kartu grafis | Selesai |
| Uji ulang jalur B | Gagal karena laptop kehabisan memori. Ditunda atas keputusan pemilik proyek |
| Data "jeda sebelum model mulai menulis" dari catatan gerbang model | Selesai |
| Desain ulang halaman grafik dan penyederhanaan bahasanya | Selesai |
| Naskah penjelasan untuk presentasi | Selesai |
| Catatan percakapan tentang pengujian | Selesai |
| Laporan `.md` disesuaikan dengan halaman grafik | Belum |
| Penyimpanan kode ke Git | Belum |

---

## Entri 1 — Uji beban pagi

Dibuat `scripts/uji-beban.mts` untuk menjalankan uji sesuai rencana kemarin, dengan
8 jenis pertanyaan. Contohnya total penjualan, stok kosong, prosedur cuti, membuat tiket, dan
pertanyaan yang harus ditolak. Setiap jenis pertanyaan punya kriteria "dianggap benar".

| Orang bersamaan | Jalur A, waktu tengah | Jalur B, waktu tengah | Jalur B berhasil |
|---:|---:|---:|---:|
| 1 | 18 dtk | 20 dtk | 3/3 |
| 2 | 42 dtk | 35 dtk | 6/6 |
| 3 | 44 dtk | 72 dtk | 9/9 |
| 5 | 73 dtk | 145 dtk | 15/15 |
| 8 | 125 dtk | 238 dtk | 15/24 |

- Jalur A: **57 dari 57 pertanyaan terjawab dan benar.** Target untuk 5 orang (waktu tengah
  ≤ 90 detik) tercapai.
- Jalur B sekitar dua kali lebih lambat. Laptop yang menjalankan portal sedang sibuk: CPU 54–66%
  dan RAM hampir penuh.
- Tidak ada galat 429 lagi setelah kunci diganti kemarin.
- Tidak ada tiket yang tersimpan. Jumlah tiket di database diperiksa sebelum dan sesudah uji.

---

## Entri 2 — Laporan dan halaman grafik

Ditulis `docs/benchmark/hasil-uji-beban-qwen3-14b.md` dan `docs/grafik-uji-beban-qwen3-14b.html`, beserta
gambar PNG-nya. Atas permintaan pemilik proyek, ditambahkan dua tabel:

- daftar 8 pertanyaan uji beserta kriteria benarnya;
- daftar pertanyaan yang gagal atau kurang tepat, beserta penyebabnya.

---

## Entri 3 — Membaca beban server model

Pemilik proyek memberi akses ke server model dengan cara yang aman. Kunci SSH tidak ditempel ke
percakapan. Pemilik proyek cukup membuat nama pintas `mr-ec2` di `~/.ssh/config`. Claude hanya
menjalankan perintah baca (`docker ps`, `docker logs`, `nvidia-smi`), tanpa restart dan tanpa
mengubah setelan.

Yang ditemukan dari catatan server model:

| Temuan | Arti |
|---|---|
| 416 dari 416 permintaan selama uji pagi dibalas berhasil | Sambungan yang putus di jalur B **bukan** berasal dari server |
| Di jalur A pada 5–8 orang, model penuh 94–99% waktu, dengan 2–5 permintaan antre | Antrean adalah penyebab lambat |
| Memori kerja model baru terpakai sekitar sepertiga | Ruangnya masih ada untuk mengerjakan lebih dari 2 permintaan sekaligus |
| Di jalur B, model justru lebih longgar | Di jalur B, permintaan tertahan di laptop sebelum sampai ke model |

---

## Entri 4 — Merekam kartu grafis dan uji ulang

Beban kartu grafis saat uji pagi tidak bisa dipulihkan, karena `nvidia-smi` tidak menyimpan
riwayat. Karena itu dibuat `scripts/rekam-gpu.mts`, yang merekam kartu grafis setiap 0,5 detik
lewat SSH. Rekaman itu lalu dicocokkan dengan jam setiap pertanyaan, sehingga terlihat beban
kartu grafis untuk tiap pertanyaan.

Uji ulang dijalankan dengan cara yang **sama persis** seperti uji pagi. Hasil jalur A
(13.31–13.59 WIB):

| Orang bersamaan | Waktu tengah | Listrik rata-rata | Listrik per jawaban |
|---:|---:|---:|---:|
| 1 | 34 dtk | 207 W | 1,25 Wh |
| 2 | 28 dtk | 215 W | 0,87 Wh |
| 3 | 43 dtk | 217 W | 0,77 Wh |
| 5 | 60 dtk | 222 W | 1,14 Wh |
| 8 | 129 dtk | 223 W | 0,96 Wh |

- Hasilnya mirip dengan uji pagi, jadi angkanya bisa dipercaya.
- Saat tidak ada pertanyaan, kartu grafis memakai sekitar 64 W, dan batasnya 300 W. Suhu
  tertinggi selama uji 67 °C, masih aman.
- Angka "GPU sibuk" sudah 91–100% walaupun baru 1 orang. Angka ini hanya menunjukkan kartu sedang
  bekerja atau tidak, bukan seberapa keras. Listrik lebih tepat dipakai untuk melihat beratnya.
  Listrik hanya naik sedikit dari 1 ke 8 orang, karena orang tambahan lebih banyak menunggu
  giliran.
- Ada 3 pertanyaan yang tidak selesai dalam 5 menit, yaitu tiket dan SOP pada 5 dan 8 orang. Ada
  juga 1 jawaban SOP yang kurang tepat. Dugaan penyebabnya: di uji ulang, Ratu AI memanggil model
  lebih sering (5,5 kali per pertanyaan pada 5 orang, sedangkan pagi 3,7 kali). Dugaan ini belum
  bisa dipastikan.

Jalur B di uji ulang gagal. Portal di laptop menyalakan ulang dirinya sendiri karena memorinya
hampir penuh. Pemilik proyek memutuskan untuk fokus ke jalur A saja.

---

## Entri 5 — Jeda sebelum model mulai menulis

Pemilik proyek meminta dicari catatan yang menghitung jeda ini (TTFT). Gerbang model (LiteLLM)
ternyata mencatat setiap panggilan: jam masuk, jam kata pertama keluar, jam selesai, dan jumlah
token. Yang diambil hanya kolom waktu, token, dan status, tanpa isi percakapan dan tanpa kunci.

| Orang bersamaan | Jeda (waktu tengah) |
|---:|---:|
| 1 | 0,05 dtk |
| 3 | 0,9 dtk |
| 5 | 6,5–8 dtk |
| 8 | 17–20 dtk |

Dari 459 panggilan ke model di kedua uji, tidak ada satu pun yang gagal.

Ditemukan juga bahwa setiap panggilan membawa sekitar 3.800 token. Sebagian besar berupa instruksi
untuk Ratu AI dan daftar alatnya, bukan pertanyaan pengguna.

---

## Entri 6 — Merapikan halaman grafik untuk dibaca orang lain

Halaman grafik diubah dalam tiga hal:

- **Tampilan:** ada kotak angka ringkas di atas, menu yang tetap terlihat, bagian bernomor, kotak
  "Intinya" di tiap grafik, dan pilihan tema terang/gelap.
- **Tabel beban kartu grafis per pertanyaan** bisa diurutkan dengan mengklik judul kolomnya.
- **Isi:** jalur B disembunyikan sementara. Grafik kini membandingkan uji pagi dengan uji ulang.
  Istilah teknis diganti dengan kata sehari-hari. Misalnya "P50" menjadi "waktu tengah", "TTFT"
  menjadi "jeda sebelum model mulai menulis", dan "KV cache" menjadi "memori kerja model".

---

## Entri 7 — Naskah penjelasan dan catatan percakapan

- `docs/benchmark/skrip-penjelasan-uji-beban-qwen3-14b.md` adalah naskah lisan sekitar 6–8 menit, dengan
  petunjuk grafik mana yang ditampilkan. Antrean dijelaskan dengan perumpamaan "loket dengan
  2 petugas". Naskah juga memuat kesimpulan, saran, dan 6 perkiraan pertanyaan beserta jawabannya.
- `docs/benchmark/catatan-percakapan-uji-beban-qwen3-14b.md` mencatat urutan percakapan tentang uji ini dari
  12–13 November. Kunci, alamat server, dan alamat tunnel tidak dicantumkan.

---

## Hasil uji terakhir

| Uji | Hasil |
|---|---|
| Jalur A, uji pagi | 57/57 benar; waktu tengah 18 dtk (1 orang) sampai 125 dtk (8 orang) |
| Jalur A, uji ulang + kartu grafis | 3 tidak selesai dalam 5 menit, 1 kurang tepat; waktu tengah 34–129 dtk |
| Jalur B, uji pagi | 48/57 berhasil; gagal di 8 orang karena laptop |
| Jalur B, uji ulang | Gagal, portal di laptop menyalakan ulang dirinya |
| Panggilan ke model | 0 gagal dari 459 |
| Tiket tersimpan selama uji | 0 |

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- **Salah menangkap permintaan.** Saat diminta data beban kartu grafis, Claude sempat menjalankan
  uji satu pertanyaan demi satu pertanyaan. Padahal yang diminta adalah uji yang sama persis
  dengan pagi. Uji itu dihentikan, lalu diulang dengan cara yang benar.
- **Perekam kartu grafis tertinggal.** Setelah uji dihentikan paksa, proses perekam SSH masih
  berjalan. Prosesnya sudah dimatikan, dan perekam kini otomatis berhenti saat skrip uji berhenti
  atau dihentikan.
- **Angka di laporan dan di halaman grafik sempat berbeda.** Angka "95% selesai" untuk jeda di
  laporan dihitung dengan cara yang berbeda dari halaman grafik. Sudah disamakan. Pembulatan
  angka juga sudah dibetulkan supaya 222,5 menjadi 223, bukan 222.

---

## Masalah yang masih terbuka

- **Batas "2 permintaan sekaligus" di server model** adalah penyebab utama antrean. Batas ini bisa
  dipertimbangkan untuk dinaikkan, misalnya menjadi 4, lalu uji diulang. Keputusannya ada di
  pengelola server. Portal tidak mengubah setelan server.
- **Jalur portal perlu diuji ulang** setelah portal berjalan di server, bukan di laptop.
- **Laporan `docs/benchmark/hasil-uji-beban-qwen3-14b.md`** masih memuat jalur B dan bahasa teknis, sehingga
  belum sejalan dengan halaman grafik.
- **Penyebab 3 pertanyaan yang tidak selesai di uji ulang** belum pasti, karena langkah-langkah
  agent tidak direkam.
- **Kunci SSH dan kunci API Qwen3.5 35B** yang sempat terlihat di percakapan sebelumnya belum
  dirotasi.
- **Perubahan belum disimpan ke Git.** Repositori perlu dijadikan private lebih dulu.

---

## Rencana berikutnya

1. Menyesuaikan laporan `.md` dengan halaman grafik: jalur B disembunyikan dan bahasanya
   disederhanakan.
2. Menyampaikan hasil uji ke pembimbing dan pengelola server, memakai halaman grafik dan naskah
   penjelasan.
3. Kalau pengelola server menaikkan batas permintaan sekaligus, mengulang uji jalur A dengan cara
   yang sama untuk membandingkan hasilnya.
4. Merekam langkah-langkah agent di uji berikutnya, supaya penyebab pertanyaan yang tidak selesai
   bisa dipastikan.
5. Merotasi kunci yang tersisa, lalu menyimpan kode ke Git setelah repositori dipastikan private.
