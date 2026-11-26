# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Jumat, 20 November 2026
**Proyek:** Menguji Ratu AI di server 4 kartu grafis (g5.12xlarge), membandingkannya dengan server 1 kartu grafis (g5.2xlarge), lalu menyatukan semua hasil uji ke satu halaman yang bisa dikirim
**Lokasi kerja:** folder `marketing/`

> Pagi ini server baru dengan 4 kartu grafis diperiksa, lalu Ratu AI diuji 97 pertanyaan dengan
> skenario yang sama persis seperti uji 17 Nov di server 1 kartu grafis. Hasil sementaranya
> ditampilkan langsung untuk meeting pukul 10.00. Siang harinya, semua hasil uji 13–20 Nov
> disatukan ke satu berkas HTML, dan teksnya ditulis ulang dengan bahasa sehari-hari. Sore harinya
> uji 4 GPU diulang, kali ini sambil mencatat isi jawaban, dan hasilnya menggantikan uji pagi.

> **Temuan terbesar hari ini:** 4 kartu grafis **tidak mempercepat satu jawaban** (tetap ±30 detik
> saat satu orang bertanya), tapi **menghilangkan antrean** saat banyak orang bertanya bersamaan.
> Di 8 pengguna, waktu jawab tengah turun dari 73,3 ke 35,3 detik, dan jumlah pertanyaan yang
> selesai per menit naik 2,1×. Kenaikannya belum 4×, karena di 8 pengguna server 4 GPU belum penuh.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Pemeriksaan kondisi server 4 GPU (hanya membaca) | Selesai |
| Skrip uji disiapkan untuk banyak GPU | Selesai |
| Uji pertama 4 GPU, 97 pertanyaan (pagi) | Selesai, lalu diarsipkan |
| Dashboard perbandingan 1 GPU vs 4 GPU, termasuk mode "hasil sementara" untuk meeting | Selesai |
| Laporan `docs/benchmark/benchmark-1gpu-vs-4gpu.md` | Selesai |
| Semua hasil uji 13–20 Nov disatukan ke satu HTML, dengan sub-menu per bagian | Selesai |
| Teks ketiga dashboard ditulis ulang dengan bahasa sehari-hari | Selesai |
| Uji ulang 4 GPU sambil mencatat isi jawaban (sore) | Selesai, hasilnya dipakai di dashboard dan laporan |
| Stress test 12 dan 16 pengguna | Belum |
| Penyimpanan kode ke Git | Belum |

---

## Entri 1 — Pemeriksaan server 4 GPU

Sebelum menguji, kondisi server `mr-g5-12x` diperiksa tanpa mengubah apa pun.

| Komponen | Kondisi |
|---|---|
| Mesin | AWS g5.12xlarge: 48 vCPU AMD EPYC, RAM 186 GiB, Ubuntu 24.04 |
| Kartu grafis | 4× NVIDIA A10G 24 GB, semuanya diam (0%, ±63 W) |
| Model | 4 salinan Qwen3 14B, satu per kartu grafis, semuanya sehat |
| Gerbang model (LiteLLM) | Sehat, membagi permintaan secara acak ke 4 salinan |

Kesimpulannya, server siap dipakai. Satu-satunya yang perlu diperbarui adalah alamat tunnel, yaitu
jalur dari laptop ke server, karena alamatnya berganti setiap kali tunnel dinyalakan ulang.

---

## Entri 2 — Skrip uji disiapkan untuk banyak GPU

Skrip yang dipakai 17 Nov (`scripts/profil-alur-agent.mts`) ditambah opsi untuk memilih server,
model, dan port. Bawaannya tetap server 1 GPU, jadi uji 17 Nov bisa diulang persis.

Yang baru dicatat untuk server 4 GPU:
- **salinan GPU mana yang melayani** setiap panggilan model;
- jumlah token berpikir yang persis, dari catatan LiteLLM (di server lama masih berupa perkiraan);
- listrik, suhu, dan kesibukan **per kartu grafis** (GPU 0–3);
- penghitung (counter) tiap salinan model.

**Pembagian beban dibuktikan dari tiga sumber yang dicatat terpisah:** header jawaban LiteLLM,
catatan LiteLLM, dan penghitung vLLM. Di uji ulang, ketiganya cocok untuk 383 dari 383 panggilan.

Selisih jam laptop dan server (±11,5 detik) sekarang dikoreksi otomatis saat mencocokkan catatan.

---

## Entri 3 — Uji pertama dan dashboard untuk meeting

Uji penuh pertama berjalan pukul 09.19–10.15 WIB, dengan skenario yang sama seperti 17 Nov:
- pemanasan 8 pertanyaan (tidak dihitung);
- 40 pertanyaan satu per satu;
- 1, 2, 3, 5, dan 8 orang bertanya bersamaan.

Karena hasilnya harus ditampilkan di meeting pukul 10.00 saat uji masih berjalan, dibuat **mode
hasil sementara**:
- data diolah ulang setiap 2 menit di latar belakang;
- halaman memuat ulang sendiri setiap 60 detik, tanpa kehilangan posisi gulir;
- spanduk kuning menunjukkan jam data terakhir dan berapa pertanyaan yang sudah selesai;
- bagian yang datanya baru ada di akhir uji ditulis "menunggu akhir uji", **bukan angka nol**.

Setelah uji selesai, halaman berganti sendiri ke versi final. Atas permintaan pemilik proyek, alur
halamannya diubah jadi empat bagian: hasil server 1 GPU, hasil server 4 GPU, Perbandingan, dan
Metodologi.

---

## Entri 4 — Semua hasil uji jadi satu HTML

Masalahnya, hasil uji tersebar di tiga berkas HTML yang saling bertautan. Kalau hanya satu berkas
yang dikirim, tautannya putus.

Sekarang cukup kirim satu berkas: **`docs/grafik-uji-beban-qwen3-14b.html`**. Berkas ini bisa dibuka
tanpa internet dan tanpa berkas lain.

| Grup menu | Halaman |
|---|---|
| Beranda | Ringkasan semua uji, dengan tombol pintas ke tiap halaman |
| 1 GPU vs 4 GPU · 20 Nov | Perbandingan, g5.2xlarge, g5.12xlarge, Metodologi |
| Alur agent · 17 Nov | Ringkasan, Tahap beban, Urutan langkah, Per pertanyaan, Q4 & Q5, Cara uji & cek |
| Uji beban & model · 13–16 Nov | Overview, Load Testing, Model, Agent Workflow, GPU |

- Tiap halaman punya alamat sendiri, misalnya `...html#gpu4-banding` langsung membuka Perbandingan.
- Tema gelap/terang berlaku ke semua halaman.
- **Sub-menu di sidebar:** daftar bagian halaman yang sedang dibuka muncul di bawah namanya. Klik
  untuk melompat, dan bagian yang sedang terlihat ikut ditandai. Di ponsel ada tombol "Bagian ▾".
- Dashboard ini dibangun otomatis oleh skrip, jadi setiap kali data perbandingan diperbarui, berkas
  gabungannya ikut diperbarui.
- QA otomatis di browser: 61 pemeriksaan lolos, 0 galat JavaScript.

---

## Entri 5 — Teks dashboard ditulis ulang

Atas permintaan pemilik proyek, teks di ketiga dashboard ditulis ulang supaya mudah dipahami orang
yang bukan engineer:
- kalimat dipendekkan, satu kalimat satu hal;
- istilah teknis dijelaskan sekali, dengan istilah aslinya di dalam kurung, misalnya "waktu tengah
  (P50)" dan "replika, yaitu salinan model, satu per GPU";
- kata Inggris diganti kalau ada padanannya, misalnya "Key findings" jadi "Temuan utama".

**Angkanya tidak ikut berubah.** Ini sudah dicek: yang berbeda antara data lama dan baru hanya
paragraf teks dan nama kategori.

---

## Entri 6 — Apakah jawaban model tersimpan?

Pemilik proyek menanyakan apakah isi jawaban model tercatat di suatu tempat.

| Tempat | Hasil |
|---|---|
| Skrip uji | Sengaja hanya mencatat **panjang** jawaban, bukan isinya |
| LiteLLM server 4 GPU | 415 baris catatan 17–20 Nov, **0** yang berisi pertanyaan atau jawaban |
| Server 1 GPU | Tidak bisa dicek, servernya tidak terjangkau |

Karena itu ditambahkan opsi **`--simpan-jawaban`** (bawaannya mati). Isi jawaban dicatat ke
`jawaban.jsonl` **hanya di laptop**, di folder `data/` yang tidak ikut Git. Isinya bisa memuat data
perusahaan, jadi tidak boleh dikirim ke luar.

---

## Entri 7 — Uji ulang 4 GPU dengan isi jawaban

Uji diulang pukul 14.30–15.24 WIB, dengan skenario sama dan isi jawaban dicatat.

Percobaan pertama gagal di pemeriksaan awal, karena tunnel ke server sudah mati. Uji **tidak
dimulai** dan folder kosongnya dihapus. Setelah tunnel dinyalakan ulang di server, pemeriksaan
lolos dan uji berjalan sampai selesai.

Hasil uji pagi tidak dihapus, hanya dipindah ke
`data/agent-workflow-latency/arsip-2026-11-20-02-19-4gpu-lama/`. Dashboard dan laporan sekarang
memakai uji sore.

**Hasil (8 orang bertanya bersamaan):**

| Ukuran | 1 GPU (17 Nov) | 4 GPU pagi | 4 GPU sore (dipakai) |
|---|---:|---:|---:|
| Waktu jawab tengah | 73,3 dtk | 33,5 dtk | **35,3 dtk** |
| 95% pertanyaan selesai di bawah | 115,9 dtk | 73,3 dtk | **68,2 dtk** |
| Antre di server model per panggilan | 6,15 dtk | 0,21 dtk | **0,07 dtk** |
| Pertanyaan selesai per menit | 4,1 | 8,3 | **8,8** |
| Sesuai kriteria (dari 97) | 94 | 91 | **93** |
| Habis waktu | 1 | 0 | **0** |
| Listrik GPU | 222 W | 672 W | **719 W** |

Selisih uji pagi dan sore kecil. Ini menunjukkan seberapa besar hasil bisa bergeser antar-uji
walaupun skenarionya sama.

**Yang terbaca dari isi jawaban:**
- **Q1 (total penjualan) benar 13 dari 13.** Pagi harinya Q1 gagal 4 kali, jadi itu kebetulan,
  bukan pola tetap.
- **Dua jawaban Q5 (buat tiket) tidak layak dikirim ke pengguna.** Satu berisi pesan serah-terima
  antar agent ("User menyetujui tawaran sebelumnya: siapkan tiket…"), satu lagi hanya kata "ya".
  Keduanya terjadi saat agent mencari SOP alih-alih menyiapkan tiket. Ini masalah alur agent, bukan
  kartu grafis.
- Q8 (sapaan) sekali memakai alat. Jawabannya wajar, tapi tidak lolos aturan "sapaan tanpa alat".
- Q4 (SOP cuti) sekali menjawab "belum bisa mengambil data" tanpa mencoba mencari SOP.

**Pembagian beban masih acak.** Di 8 pengguna satu GPU mendapat 27 panggilan, yang lain 18.
Pagi harinya ketimpangannya lebih besar, 32 lawan 13.

---

## Hasil uji hari ini

| Uji | Hasil |
|---|---|
| Alur agent 4 GPU, 97 pertanyaan (uji sore) | 93 sesuai kriteria, 0 habis waktu; waktu tengah 29,5 dtk (satu per satu) → 35,3 dtk (8 orang) |
| Panggilan model | 383, semuanya berhasil dan cocok di tiga sumber catatan |
| Alat yang dipanggil | 76 dari 76 berhasil |
| Tiket tersimpan selama uji | 0 |
| QA dashboard gabungan | 61 lolos, 0 galat |

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- **Uji ulang sempat dijalankan saat tunnel sudah mati.** Pemeriksaan awal skrip menahannya, jadi
  tidak ada data rusak yang tercatat. Ke depan, tunnel dicek dulu sebelum uji panjang.
- **Nama menu di dashboard utama sempat tidak sama dengan halaman di dalamnya** setelah teks ditulis
  ulang ("Waterfall" vs "Urutan langkah"). Ketahuan saat QA dan sudah disamakan.
- **Sub-menu sempat tidak menandai bagian terakhir** yang pendek, karena halaman sudah mentok di
  bawah. Ditambah aturan: kalau halaman sudah di dasar, bagian terakhir yang ditandai.
- **Satu angka di laporan lama tertulis keliru** (waktu "menulis" 1 GPU saat satu per satu tertulis
  13,2, padahal datanya 12,6). Ketahuan saat laporan diperbarui dengan angka uji sore.

---

## Masalah yang masih terbuka

- **Teks internal agent bisa sampai ke pengguna** sebagai jawaban akhir (temuan Q5 di atas). Perlu
  penjaga: kalau jawaban kosong, sangat pendek, atau berisi pesan serah-terima, tampilkan pesan gagal
  yang jujur.
- **Pembagian beban LiteLLM acak.** Strategi lain seperti `least-busy` perlu diuji, tapi itu mengubah
  setelan server, jadi butuh persetujuan.
- **Tunnel ke server 4 GPU masih menyala** dan bersifat sementara. Alamatnya berganti setiap
  dinyalakan ulang.
- **Kunci virtual gateway 4 GPU** sempat tertempel di percakapan, sebaiknya dirotasi.
- **Logbook 18 dan 19 Nov** belum dibuat.
- **Perubahan belum disimpan ke Git.** Repositori perlu dijadikan private lebih dulu.

---

## Rencana berikutnya

1. Stress test 12 dan 16 pengguna di server 4 GPU, untuk menemukan batas kemampuannya.
2. Memasang penjaga jawaban supaya teks internal agent tidak sampai ke pengguna, lalu menguji ulang Q5.
3. Menguji pengurangan bagian "berpikir" model pada langkah pemilih agent atau alat. Ini yang bisa
   menurunkan batas bawah ±30 detik, karena menambah GPU tidak menurunkannya.
4. Mematikan tunnel setelah pengujian selesai, lalu merotasi kunci yang tersisa.
