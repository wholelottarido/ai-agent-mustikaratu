# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Senin, 23 November 2026
**Proyek:** Menguji model yang lebih besar (Qwen3.8-27B) di server 4 kartu grafis, lalu menguji berapa banyak pengguna bersamaan yang sanggup dilayani Qwen3-14B di server yang sama
**Lokasi kerja:** folder `marketing/`

> Pagi sampai siang, Ratu AI diuji dengan model Qwen3.8-27B memakai 97 pertanyaan yang sama dengan
> uji Qwen3-14B. Sambil uji berjalan, waktu tiap langkah dibedah untuk mencari penyebab jawaban yang
> lama. Sore harinya server dikembalikan ke Qwen3-14B oleh pemilik server, lalu Qwen3-14B diuji
> dengan 10, 12, 16, dan 20 pengguna bersamaan. Semua hasil dimasukkan ke satu halaman
> `docs/benchmark/grafik/hasil-pengujian.html`, yang sidebar-nya dirapikan.

> **Temuan terbesar hari ini:**
> - **Qwen3.8-27B menjawab benar setiap kali sempat selesai (71 dari 71), tapi terlalu lambat.**
>   Ia menulis ±11 token per detik, sedangkan Qwen3-14B ±49. Dari 97 pertanyaan, 26 tidak selesai
>   dalam batas 5 menit. Jadi masalahnya kecepatan pada setelan server sekarang, bukan kualitas.
> - **Qwen3-14B di server 4 GPU sanggup melayani sampai 20 pengguna bersamaan tanpa macet.**
>   Sampai 10 pengguna, waktu jawab tengahnya tetap ±32 detik. Antrean mulai terasa di 16 pengguna.
>   Di 20 pengguna, waktu tengah naik ke ±54 detik, tetapi jumlah pertanyaan yang tuntas per menit
>   justru paling tinggi (11,1).

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Pemeriksaan awal & uji coba Qwen3.8-27B (hanya membaca) | Selesai |
| Uji Qwen3.8-27B, 97 pertanyaan | Selesai |
| Bedah waktu per langkah (pertanyaan Q2 & Q3 yang paling lama) | Selesai |
| Laporan 27B (7 berkas + rincian hambatan) | Selesai |
| Halaman hasil diganti nama jadi `hasil-pengujian.html`, sidebar dirapikan | Selesai |
| Pemeriksaan server & skrip untuk uji 10–20 pengguna | Selesai |
| Uji kapasitas Qwen3-14B, 10/12/16/20 pengguna (setelan sekarang) | Selesai |
| Prosedur uji setelan kedua (`max-num-seqs` 8) | Ditulis, **belum dijalankan** — menunggu persetujuan |
| Pembanding Anthropic | Dihentikan atas permintaan pemilik proyek |

---

## Entri 1 — Pemeriksaan awal Qwen3.8-27B

Sebelum menguji, server dan sambungan diperiksa tanpa mengubah apa pun.

| Yang diperiksa | Hasil |
|---|---|
| Server | g5.12xlarge **on-demand di Jakarta** (`ap-southeast-3`) |
| Cara model dijalankan | 1 salinan model dibelah ke 4 GPU. Batas panjang percakapan **8.192 token**. Opsi `--enforce-eager` menyala |
| Sambungan & nama model | `qwen38-27b` terdaftar dan bisa dipanggil |
| Tanya-jawab biasa | Berhasil, jawaban ada di kolom `content` |
| Memanggil alat | Berhasil, isi perintahnya benar (`periode: 2026-09`) |
| Permintaan terlalu panjang | Ditolak dengan pesan yang jelas (lebih dari 8.192 token) |

**Dua hal yang dicatat sejak awal:**
- **Batas 8.192 token terlalu sempit untuk agent kita.** Di uji 14B, perintah ke model saja sudah
  sampai 8.003 token, belum termasuk jawabannya. Akibatnya sebagian jawaban 27B pasti terpotong.
- **Modelnya lambat:** ±12 token per detik (14B: ±49).

**Perubahan di skrip uji** (aplikasi Ratu AI tidak disentuh):
- **Argumen alat ikut dicatat.** Ini supaya bisa dinilai apakah model mengisi perintah ke alat
  dengan benar. Dicatat hanya di laptop, atas persetujuan pemilik proyek.
- **Nama model di catatan LiteLLM sekarang bisa diatur.** Sebelumnya terkunci ke `qwen3-14b`,
  sehingga catatan token untuk 27B kosong. Ini ketahuan saat uji coba, sebelum uji penuh.

**Tarif server diverifikasi dari daftar harga resmi AWS:** g5.12xlarge on-demand Linux di Jakarta =
**USD 7,93854 per jam** (terbit 21 Nov 2026), belum termasuk disk, transfer data, dan pajak.

---

## Entri 2 — Uji Qwen3.8-27B (97 pertanyaan)

Uji berjalan pukul 10.35–14.05 WIB dengan skenario yang sama persis seperti Qwen3-14B:
- 8 pertanyaan pemanasan yang tidak dihitung;
- 40 pertanyaan satu per satu;
- 1, 2, 3, 5, dan 8 pengguna bersamaan.

| Ukuran | Qwen3-14B (20 Nov) | Qwen3.8-27B |
|---|---:|---:|
| Sesuai kriteria (97 pertanyaan) | 93 | **71** |
| Tidak selesai dalam 5 menit | 0 | **26** |
| Waktu tengah, satu per satu | 29,7 dtk | **144,9 dtk** |
| Waktu tengah, 8 pengguna | 35,5 dtk | **300,4 dtk** |
| Pertanyaan tuntas per menit, 8 pengguna | 8,80 | **1,58** |
| Kecepatan menulis model | ±49 token/dtk | **±11 token/dtk** |
| Jawaban terpotong batas 8.192 token | — | **19** |

- **Semua 71 pertanyaan yang sempat selesai dijawab sesuai kriteria.** Ke-26 kegagalan semuanya
  habis waktu, bukan jawaban salah. Tidak ada angka karangan, dan pertanyaan gaji tetap ditolak.
- **58% token yang ditulis 27B adalah "berpikir"** yang tidak dibaca pengguna.
- Biaya server selama uji: **USD 25,20** (3,17 jam). Dengan server yang sama, 27B sekitar
  **5,6× lebih mahal per pertanyaan** dibanding 14B pada setelan masing-masing.

Pembanding dengan Anthropic sempat disiapkan (format data dan tarif), tetapi **dihentikan dan dikeluarkan
dari laporan** atas permintaan pemilik proyek, supaya fokus ke model Qwen. Tidak pernah ada permintaan
yang dikirim ke Anthropic.

---

## Entri 3 — Bedah waktu: kenapa Q2 dan Q3 lama sekali

Saat pemanasan, Q2 butuh 264 detik dan Q3 229 detik. Pemilik proyek meminta penyebabnya dicari tanpa
menghentikan uji. Ternyata waktu tiap langkah **sudah tercatat sejak awal uji**, jadi tinggal dibedah dari
salinan datanya. Uji yang sedang berjalan tidak disentuh.

**Q2 (264 detik), per langkah:**

| Langkah | Waktu | Porsi |
|---|---:|---:|
| Perute memilih agent | 28,5 dtk | 11% |
| Agent marketing memilih alat | 10,1 dtk | 4% |
| **Agent marketing menyusun hasil alat** | **148,6 dtk** | **56%** |
| Perute menulis jawaban akhir | 75,7 dtk | 29% |
| Alat + database | 0,6 dtk | <1% |

- **Hampir semua waktu dipakai model menulis token.** Lama satu pertanyaan ≈ jumlah token yang ditulis
  dibagi ±11,5 token per detik.
- Langkah "menyusun hasil" di Q2 **menabrak batas 8.192 token**, jadi jawabannya terpotong.
- **Saat ramai, hambatannya pindah ke antrean.** Di 8 pengguna, tiap panggilan menunggu giliran
  ±56 detik, karena server ini hanya punya 4 slot untuk seluruh pengguna.

---

## Entri 4 — Halaman hasil dirapikan

Atas permintaan pemilik proyek:
- **Nama berkas diganti** dari `grafik-uji-beban-qwen3-14b.html` jadi **`hasil-pengujian.html`**.
  Tautan di berkas lain sudah diarahkan ke nama baru.
- **Sidebar dikelompokkan per model**, dan tiap grup bisa dibuka-tutup. Yang terbuka hanya grup halaman
  yang sedang dibaca, jadi tidak lagi 17 menu menumpuk sekaligus.
- **Hasil 27B dibuat jadi 5 halaman:**
  - perbandingan 14B vs 27B;
  - hasil & performa;
  - akurasi;
  - token & hambatan;
  - biaya.
- Beranda mendapat kartu ringkasan untuk tiap uji baru.

---

## Entri 5 — Persiapan uji kapasitas Qwen3-14B (10–20 pengguna)

Pemilik server mengembalikan 4 salinan Qwen3-14B. Pemeriksaan (hanya membaca):

| Yang diperiksa | Hasil |
|---|---|
| Setelan tiap salinan | `max-num-seqs 4`, batas 16.384 token, 1 salinan per GPU |
| Versi vLLM | `0.33.0rc1.dev1030`, **sama persis dengan uji 20 Nov** |
| LiteLLM | Sama dengan 20 Nov: 4 salinan, dibagi acak (`simple-shuffle`) |
| Kunci akses | Boleh memakai `qwen3-14b` |
| Memori untuk percakapan (KV cache) | 57.856 token per salinan |

Karena setelannya sama, **hasil 1–8 pengguna dari 20 Nov tidak perlu diulang** dan bisa disambung
langsung dengan uji hari ini.

**Tambahan di skrip uji:**

| Tambahan | Fungsi |
|---|---|
| `--concurrency 10,12,16,20` | Menentukan jumlah pengguna bersamaan per tahap. Tiap pengguna tetap bertanya 3 kali berurutan |
| Pembacaan setelan otomatis | Setelan tiap salinan model dibaca langsung dari server saat uji dimulai, lalu dicatat bersama hasil |
| `progres.json` | Diperbarui tiap pertanyaan selesai, jadi uji bisa dipantau tanpa membuka terminal |
| Uji kering | Hanya cek kesehatan + baca setelan, tanpa mengirim pertanyaan |

**Prosedur setelan kedua (`max-num-seqs` 8) ditulis di `docs/benchmark/prosedur-max-num-seqs-8.md`.** Isinya
lengkap dengan cadangan setelan lama dan cara mengembalikannya. **Belum dijalankan**, karena harus
mengganti container di server dan butuh persetujuan.

---

## Entri 6 — Uji kapasitas Qwen3-14B

Uji berjalan pukul 15.36–16.08 WIB: 182 pertanyaan (8 pemanasan + 30 + 36 + 48 + 60).

| Pengguna | Sesuai kriteria | Waktu tengah | Tuntas/menit | Menunggu giliran per pertanyaan |
|---:|---:|---:|---:|---:|
| 8 (20 Nov) | 24/24 | 35,3 dtk | 8,80 | 2,0 dtk |
| 10 | 27/30 | 31,9 dtk | 10,53 | 3,4 dtk |
| 12 | 35/36 | 42,6 dtk | 5,84* | 4,2 dtk |
| 16 | 46/48 | 41,7 dtk | 7,69* | 13,9 dtk |
| 20 | 57/60 | 53,7 dtk | 11,13 | 16,8 dtk |

\* Turun karena tahap itu tertahan **satu** pertanyaan Q5 yang macet 4–5 menit, bukan karena server penuh.
Kalau dihitung sampai 90% pertanyaan selesai, throughput terus naik sampai 20 pengguna.

- **Server belum jenuh di 20 pengguna:** slot penuh 27% waktu, GPU sibuk 66%, tidak ada pemotongan
  permintaan (preemption).
- **Pembagian ke 4 GPU makin timpang saat ramai.** Di 20 pengguna, satu GPU antre rata-rata 7,3 detik
  per panggilan, yang lain 0,8 detik.
- **Ketepatan tidak turun karena ramai.** Yang gagal adalah pola lama:
  - Q4 tanpa mencari SOP;
  - Q5 berputar antar agent sampai habis waktu atau berakhir kosong;
  - Q8 memakai alat;
  - satu kali Q1 tanpa angka.
- Biaya server selama uji ±USD 4.

**Hasil dimasukkan ke halaman:**
- Ada grup baru **"Qwen3-14B · kapasitas"** (Skala 1–20 pengguna, Antrean & GPU, Ketepatan saat ramai).
  Halaman ini sudah disiapkan supaya hasil setelan kedua nanti muncul sebagai garis kedua.
- Halaman **Mesin B · 4 GPU** juga diperpanjang sampai 20 pengguna. Halaman perbandingan mesin A vs B
  tetap 1–8 pengguna, karena mesin A tidak pernah diuji di 10–20.
- Grup Qwen3-14B dipecah jadi tiga grup kecil (mesin A vs B, kapasitas, alur agent rinci), sehingga
  tiap grup paling banyak 5 menu.
- Pemeriksaan otomatis: semua 26 menu dibuka, 0 masalah, 0 galat JavaScript.

---

## Hasil uji hari ini

| Uji | Hasil |
|---|---|
| Qwen3.8-27B, 97 pertanyaan | 71 sesuai kriteria (semua yang selesai), 26 habis waktu, 0 galat model |
| Qwen3-14B, 10–20 pengguna, 174 pertanyaan | 165 sesuai kriteria, 1 habis waktu, 2 jawaban kosong (semuanya Q5) |
| Tiket tersimpan selama kedua uji | 0 |
| Biaya server kedua uji | ±USD 29 |

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- **Permintaan uji coba yang dibatalkan dari laptop tetap jalan di server.** Satu permintaan esai panjang
  saat uji coba terus ditulis server ±5 menit, sehingga pemeriksaan awal uji pertama menolak mulai
  karena server belum kosong. Tidak ada data yang rusak. Ke depan, uji coba memakai jawaban pendek.
- **Nama model di pengambil catatan LiteLLM terkunci ke 14B.** Ketahuan dari uji coba sebelum uji penuh,
  dan sudah diperbaiki.
- **Beberapa angka di laporan 27B sempat salah:**
  - waktu bertuliskan detik padahal isinya milidetik;
  - porsi waktu model tertulis 107%, karena pertanyaan yang habis waktu ikut dihitung;
  - antrean vLLM kosong, karena diambil dari tempat yang salah;
  - kartu 27B di Beranda mengambil folder uji coba (3 pertanyaan), bukan hasil penuh.

  Semua ketahuan saat laporan diperiksa, dan sudah dibetulkan sebelum dikirim.
- **Penulisan berkas lewat heredoc lagi-lagi memakan garis miring terbalik** (`\1`, `\n`). Ini sudah
  diperingatkan di CLAUDE.md. Berkasnya diperbaiki memakai alat tulis berkas biasa.
- **Pengolah data macet lebih dari 10 menit pada data 20 pengguna.** Bagian pencocok jam laptop dan
  server melambat drastis karena jumlah panggilan meledak. Sudah diperbaiki: sekarang 15 detik, dan
  terbukti hasilnya sama persis pada data 20 Nov dan data 27B.
- **Cuplikan sementara sempat diolah ke folder proyek.** Folder `data/benchmark-qwen38-27b/snap27b` dan
  `...-coba` tersisa, dan tidak bisa dihapus otomatis karena ditahan pemeriksaan keamanan.

---

## Masalah yang masih terbuka

- **Setelan kedua (`max-num-seqs` 8) belum diuji.** Perlu persetujuan, dan perlu diputuskan siapa yang
  mengganti container di server.
- **Q5 (buat tiket) masih bisa berputar antar agent** sampai habis waktu atau berakhir dengan jawaban
  kosong. Muncul di uji 17, 20, dan 23 Nov.
- **Rekomendasi untuk 27B semuanya butuh perubahan server:** menaikkan batas 8.192 token, mematikan
  `--enforce-eager`, atau memakai versi terkuantisasi supaya muat lebih dari satu salinan.
- **Pembagian beban LiteLLM acak** dan makin timpang saat ramai. Perlu dicoba strategi lain, misalnya
  `least-busy` (butuh persetujuan).
- **Folder sisa yang perlu dihapus manual:**
  - `data/benchmark-qwen38-27b/snap27b`;
  - `data/benchmark-qwen38-27b/2026-11-23-03-32-27b-coba`;
  - `data/agent-workflow-latency/2026-11-23-08-28-14b-seqs4-c10-20-dryrun`.
- **Tunnel ke server masih tunnel sementara**, yang alamatnya berganti setiap dinyalakan ulang.
- Kunci virtual gateway sebaiknya dirotasi. Logbook 18 dan 19 Nov belum dibuat. Perubahan belum
  disimpan ke Git.

---

## Rencana berikutnya

1. Setelah disetujui, jalankan setelan kedua (`max-num-seqs` 8) pada 10, 12, 16, dan 20 pengguna, lalu
   bandingkan dengan hasil hari ini di halaman kapasitas.
2. Tentukan jumlah pengguna bersamaan yang realistis untuk produksi dari kedua setelan.
3. Perbaiki perulangan Q5 di sisi agent, lalu uji ulang Q5.
4. Kalau 27B tetap dipertimbangkan, ajukan perubahan setelan server (batas token, `--enforce-eager`,
   versi terkuantisasi) dan uji ulang.
