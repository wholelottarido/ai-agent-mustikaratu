# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Selasa, 24 November 2026
**Proyek:** Mencari penyebab jawaban agent yang gagal, memperbaiki alur kerja agent (Tahap 1–6), lalu menguji ulang Ratu AI di server 4 kartu grafis dengan 1 sampai 20 pengguna bersamaan
**Lokasi kerja:** folder `marketing/`

> Pagi hari, semua kegagalan dari uji 17–23 November ditelusuri satu per satu (22 kegagalan dari 465
> pertanyaan). Hasilnya enam tahap perbaikan alur kerja agent, dikerjakan dan diuji tanpa model sungguhan
> lebih dulu (532 pemeriksaan, semuanya lolos). Sore hari, Ratu AI diuji ulang di server yang sama dengan
> setelan yang sama persis, 1 sampai 20 pengguna bersamaan, lalu hasilnya dimasukkan ke halaman
> `docs/benchmark/grafik/hasil-pengujian.html`.

> **Temuan terbesar hari ini:**
> - **Pertanyaan yang gagal turun dari 19 menjadi 2** (dari 231 pertanyaan, 1–20 pengguna), tanpa
>   mengubah model atau server. Tidak ada yang habis waktu, dan tidak ada tiket yang tersimpan.
> - **Sapaan sekarang dijawab langsung**, ±13 detik (dulu ±30 detik, karena diteruskan ke agent lain
>   dan sempat membuka daftar SOP).
> - **Pertanyaan paling lambat jauh lebih cepat saat ramai.** Di 12–20 pengguna, 1% pertanyaan paling
>   lambat selesai ±100 detik (dulu 167–239 detik). Biaya per pertanyaan yang berhasil turun ±29%.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Penelusuran penyebab kegagalan (RCA) uji 17–23 Nov | Selesai, disetujui |
| Tahap 1 — penilai jawaban versi 2, pencatatan langkah, pembatalan saat habis waktu | Selesai, disetujui |
| Tahap 2 — penjaga alur agent (persetujuan karangan, putaran, klaim "sudah disimpan") | Selesai (uji tanpa model) |
| Tahap 4–6 — periode penjualan, sapaan, pilihan sub-kategori tiket | Selesai (uji tanpa model) |
| Folder `docs/` dirapikan per topik | Selesai |
| Tahap 3 — pemilihan agent berdasarkan kemampuan alatnya | Selesai (uji tanpa model) |
| Uji live: pemeriksaan awal (T0) | Selesai |
| Uji live: uji terarah Q1/Q4/Q5/Q8 (T1) | **Dihentikan** sesudah 7 pertanyaan, atas keputusan pemilik proyek |
| Uji live: kapasitas 1–20 pengguna (T7) | Selesai, 239 pertanyaan |
| Laporan + halaman hasil (`hasil-pengujian.html`) | Selesai |
| Uji live T2–T6 (multi-giliran, pertanyaan variasi, uji ulang, A/B, pembatalan) | **Belum** — skripnya sudah siap |

---

## Entri 1 — Mencari penyebab jawaban yang gagal

Semua hasil uji 17, 20, dan 23 November ditelusuri ulang dari catatan langkah per pertanyaan:
agent mana yang dipanggil, alat apa yang dijalankan, dan apa isi perintahnya ke alat.

| Pertanyaan | Gagal | Penyebab |
|---|---:|---|
| Q4 "prosedur pengajuan cuti" | 7 dari 58 | Diteruskan ke agent Super Tools, yang deskripsinya memuat kata "pengajuan cuti" tetapi tidak punya alat pencari SOP |
| Q5 "buatkan tiket" | 7 dari 59 | Agent pintu masuk menjawab tawaran atas nama pengguna, lalu berputar sampai habis waktu |
| Q1 total penjualan September | 5 dari 60 | Sekali alat dipanggil tanpa periode, sehingga yang dihitung bulan terakhir di data |
| Q8 sapaan | 3 dari 58 | Diteruskan ke agent lain dan membuka daftar SOP |

Dokumennya `docs/workflow-agent/rca-kegagalan-workflow-agent-qwen14b.md`, berisi bukti per kasus
dan usulan perbaikan F.1–F.8.

---

## Entri 2 — Tahap 1: cara menilai jawaban diperbaiki

Penilai jawaban lama terlalu longgar. Contohnya, jawaban yang mengaku "tiket sudah dibuat" padahal
belum ada yang tersimpan tetap dianggap benar. Penilai versi 2 membedakan:
- benar, sebagian benar, gagal, dan tidak bisa dinilai;
- klarifikasi, tawaran, rancangan, klaim tersimpan palsu, jawaban kosong, dan habis waktu;
- untuk sapaan: jawabannya benar atau tidak, terpisah dari efisien atau borosnya.

Juga ditambahkan:
- **Pencatatan langkah yang lebih lengkap:** status hasil alat, agent tujuan, dan panjang jawaban
  tiap agent. Isinya tidak ikut dicatat.
- **Pembatalan saat habis waktu.** Terbukti sampai ke server model: pembuatan jawaban berhenti
  di token ke-206.
- **Penilaian ulang 465 pertanyaan lama** dengan penilai versi 2, tanpa memanggil model. Hasilnya
  di `data/agent-workflow-latency/evaluasi-v2/`.

---

## Entri 3 — Tahap 2, 4, 5, 6: penjaga alur agent

Dipasang "penjaga" di antara agent pintu masuk dan agent aplikasi. Penjaga ini memeriksa setiap
penerusan dan setiap pemanggilan alat **sebelum** dijalankan.

| Tahap | Yang dijaga |
|---|---|
| 2 | Agent tidak boleh menyatakan persetujuan yang tidak ditulis pengguna; penerusan berulang dihentikan; pemanggilan alat yang sama persis dipakai ulang hasilnya; kalimat "sudah disimpan" disaring dari jawaban |
| 4 | Kalau pengguna menyebut bulan tetapi alat dipanggil tanpa periode, alat ditolak sekali dan diberi periode yang benar |
| 5 | Sapaan dan "kamu bisa bantu apa?" dijawab langsung dari daftar agent yang benar-benar tersedia untuk pengguna itu |
| 6 | Sub-kategori tiket yang tidak disebut pengguna dikosongkan, sehingga alat menampilkan pilihan yang sah dari database |

Diuji tanpa model sungguhan (memakai server tiruan): **390 pemeriksaan lolos**.

Uji pembanding tanpa penjaga mengulang kegagalan lama persis seperti di laporan RCA, termasuk 12
rancangan tiket dengan sub-kategori karangan.

---

## Entri 4 — Folder dokumen dirapikan

Isi `docs/` dikelompokkan per isi:
- `logbook/`, `benchmark/` (dengan `grafik/`), `workflow-agent/`;
- `fitur/`, `gateway/`, `database/`, `panduan/`, `arsip-percakapan/`.

Delapan skrip yang menulis ke folder itu ikut disesuaikan. Daftar isinya di `docs/README.md`.
Berkas kunci server (`.pem`) sengaja tidak dipindah, dan sebaiknya disimpan di luar folder proyek.

---

## Entri 5 — Tahap 3: memilih agent berdasarkan kemampuan alatnya

Ini perbaikan untuk Q4. Sekarang setiap agent diringkas kemampuannya dari alat yang benar-benar
terpasang untuk pengguna itu, dalam tiga jenis: cari dokumen/SOP, baca data, atau siapkan tindakan.
- **Kalau yang diminta prosedur** tetapi agent tujuan tidak punya alat pencari dokumen, penerusan
  dialihkan ke agent yang punya, sebelum agent yang salah sempat jalan.
- **Hasil tiap agent kini membawa status yang jelas:** tidak memakai alat, data tidak ditemukan,
  akses ditolak, atau berhasil.
- **Tidak ada nama agent yang ditulis di kode.** Agent atau alat yang ditambah lewat Kelola AI
  langsung ikut terbaca.

Hasilnya 142 pemeriksaan baru lolos, termasuk 22 yang memakai setelan agent sungguhan (hanya membaca).
Total sekarang **532 pemeriksaan, semuanya lolos**.

Bisa dimatikan sendiri lewat `RUTE_KEMAMPUAN=mati` tanpa mematikan penjaga lain.

---

## Entri 6 — Uji live di server

**Pemeriksaan awal (T0)** — semuanya sesuai:
- 4 salinan model Qwen3-14B dengan batas 4 permintaan sekaligus per salinan, dan versi server
  model sama persis dengan uji 23 Nov;
- penjaga alur dan pemilihan agent menyala;
- Anthropic diblokir di proses uji supaya tidak ada biaya ke sana.

Beberapa hal di skrip uji ditambal (aplikasi tidak disentuh):
- opsi folder hasil;
- set pertanyaan variasi beserta kriterianya;
- skrip uji percakapan multi-giliran dan uji putus koneksi dari browser.

**Uji terarah (T1)** dihentikan sesudah 7 pertanyaan karena pemilik proyek memutuskan langsung ke
uji kapasitas. Ketujuhnya benar.

**Uji kapasitas (T7)**: 8 pemanasan, lalu 1, 2, 3, 5, 8, 10, 12, 16, dan 20 pengguna, masing-masing
3 pertanyaan. Total 239 pertanyaan dalam ±50 menit.

| | Sebelum perbaikan (20 & 23 Nov) | Sesudah (hari ini) |
|---|---:|---:|
| Sesuai kriteria (penilai versi 2) | 207 dari 231 | **218 dari 231** |
| Gagal | 19 | **2** |
| Habis waktu | 1 | **0** |
| Q4 prosedur cuti: gagal | 5 | **1** |
| Q5 buat tiket: gagal | 7 | **1** |
| Q8 sapaan: gagal / waktu tengah | 6 / ±30 dtk | **0 / 13 dtk** |
| 1% paling lambat, 20 pengguna | 167 dtk | **100 dtk** |
| Panggilan model per pertanyaan | 3,7–4,9 | **3,4–3,6** |
| Biaya per pertanyaan yang berhasil | USD 0,0205 | **USD 0,0146** |

Q2, Q3, Q6, dan Q7 tetap 100% benar; tidak ada yang memburuk.

**Sisa masalah yang terlihat:**
- **1 kegagalan Q4 menyesatkan.** Agent pintu masuk memilih agent Approval yang tidak punya alat.
  Penjaga menolak dengan benar, tetapi tidak menyarankan agent pemegang SOP, lalu jawabannya bilang
  SOP "belum tersedia". Ini celah di Tahap 3.
- **11 dari 30 Q5 baru menawarkan tiket**, padahal pengguna sudah minta dibuatkan. Tidak ada tiket
  tersimpan dan tidak ada persetujuan karangan, tapi satu giliran terbuang.

---

## Entri 7 — Server dinyalakan ulang & halaman hasil

**Server mati sesudah uji, lalu menyala lagi dengan alamat baru.** Sambungan ke server dan
`AI_BASE_URL_2` di `.env.local` diperbarui:
- 6 container yang dibutuhkan ternyata menyala sendiri;
- tunnel ke gateway dinyalakan ulang dengan cara yang sama seperti sebelumnya;
- isi `.env.local` lama dicadangkan.

Uji kapasitas sempat dimulai ulang, lalu dihentikan karena pemilik proyek memutuskan memakai hasil
yang sudah ada.

**Halaman hasil.** Dibuat dashboard baru, lalu dimasukkan ke `hasil-pengujian.html`:
- kartu teratas di Beranda;
- grup menu "Qwen3-14B · pasca-optimasi" berisi 8 halaman;
- satu baris di tabel urutan pengujian.

Gaya dan judulnya disamakan dengan halaman uji lain. Halaman lama dicadangkan di
`.cadangan/dashboard-gabung-2026-11-24/`.

Laporan lengkap: `docs/workflow-agent/hasil-pengujian-final-tahap1-6-qwen14b.md`.

---

## Hasil uji hari ini

| Uji | Hasil |
|---|---|
| Uji tanpa model (Tahap 1–6) | 532 dari 532 lolos, tanpa galat TypeScript baru |
| Uji terarah T1 (dihentikan) | 7 dari 7 benar |
| Uji kapasitas T7, 231 pertanyaan terukur | 218 sesuai kriteria, 11 sebagian, 2 gagal, 0 habis waktu |
| Tiket tersimpan selama uji | 0 |
| Biaya server hari ini | ±USD 8 (T0, T1 sebagian, T7) |

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- **Akhir baris berkas sempat tertukar** (CRLF ↔ LF) saat mengedit lewat Python mode teks dan
  `sed -i`. Sudah dikembalikan dan dicek terhadap cadangan. Ke depan selalu memakai alat edit berkas
  atau Python mode biner.
- **Menghentikan uji dari Claude Code tidak mematikan proses ujinya.** Proses uji T1 masih jalan di
  belakang sampai dimatikan manual. Pada penghentian uji ulang sore hari, perintah mematikannya
  ikut terhenti, jadi **perlu dicek apakah masih ada proses uji yang tertinggal**.
- **Log pemakaian memori server model tidak sempat diambil** karena server dimatikan sesudah uji.
  Ke depan log diambil langsung di ujung perintah uji.
- **Skrip pengolah data hampir menimpa dashboard 17 Nov.** Ketahuan sebelum dijalankan, dan selalu
  dipakai opsi `--tanpa-dashboard`.
- **Beberapa angka di laporan Tahap 3 sempat salah hitung** (jumlah pemeriksaan unit dan jumlah
  panggilan model). Ketahuan saat diperiksa ulang dan sudah dibetulkan.

---

## Masalah yang masih terbuka

- **Celah Tahap 3 (kegagalan Q4 di atas)** — perlu persetujuan untuk diperbaiki.
- **Q5 masih sering menawarkan tiket** alih-alih langsung menyusun rancangan.
- **Uji T1–T6 belum dijalankan:** uji terarah 20×, multi-giliran, pertanyaan variasi, uji ulang Q1–Q8,
  perbandingan A/B per mekanisme, dan pembatalan.
- **Pembatalan dari browser belum diteruskan ke model** (jalur web). Belum diuji, belum diubah.
- **Pemakaian memori (KV cache) per salinan model** belum tercatat untuk uji hari ini.
- **Server dan sambungan:**
  - tunnel ke server masih tunnel sementara (alamatnya berganti tiap dinyalakan);
  - alamat server juga berganti tiap server dinyalakan ulang.
- **Lain-lain:**
  - kunci virtual gateway sebaiknya dirotasi;
  - logbook 18 dan 19 Nov belum dibuat;
  - perubahan belum disimpan ke Git.

---

## Rencana berikutnya

1. Putuskan perbaikan celah Tahap 3 dan perilaku "menawarkan tiket" di Q5.
2. Jalankan uji yang belum: T1 (sisa), T2 multi-giliran, T3 pertanyaan variasi, T5 perbandingan A/B,
   dan T6 pembatalan. Skripnya sudah siap.
3. Sesudah itu, uji setelan server kedua (`max-num-seqs` 8) dengan hasil hari ini sebagai pembanding
   baru, setelah disetujui.
