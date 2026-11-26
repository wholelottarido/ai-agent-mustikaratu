# Dashboard Evaluasi Ratu AI — dokumentasi

Berkas: `docs/benchmark/grafik/ratu-ai-performance-evaluation.html` (satu berkas, ±127 KB).
Dibangun ulang dengan: `python scripts/buat-dashboard-evaluasi.py`
Template: `scripts/dashboard-evaluasi.template.html`

Dibaca oleh pembimbing dan tim IT. Tiga pertanyaan utama: **seberapa cepat, seberapa benar, berapa biayanya.**

- Tidak ada benchmark atau inference baru yang dijalankan untuk dashboard ini.
- Semua angka dihitung dari data uji yang sudah ada.

## 1. Perubahan struktur

Sebelumnya hasil uji tersebar di beberapa dashboard per pengujian, digabung di `hasil-pengujian.html` lewat iframe. Sekarang ada satu dashboard dengan 7 halaman, dan datanya ditanam langsung (tanpa iframe).

| # | Halaman | Isi utama |
|---|---|---|
| 1 | Ringkasan Eksekutif | 3 kelompok KPI (Kecepatan, Akurasi, Biaya) + perubahan dari sebelum optimasi; tabel sebelum/sesudah; kesimpulan "sudah terbukti" vs "masih terbatas" |
| 2 | Kecepatan Respons | Kecepatan model dipisah dari kecepatan jawaban Ratu AI; grafik 1–20 pengguna dengan pilihan ukuran; penjelajah per jumlah pengguna; Q1–Q8 beserta alasannya |
| 3 | Akurasi dan Keandalan | Evaluator v2 sebagai angka utama; lulus/sebagian/gagal, selesai, habis waktu, kosong, alat berhasil; daftar kegagalan yang bisa dibuka, difilter, dan dicari |
| 4 | Biaya Operasional | Tombol lompat ke 4 bagian: (1) kalkulator server EC2 + data instance, (2) biaya per tahap uji, (3) EC2 vs API Anthropic, (4) simulasi volume; "cara membaca angka biaya" dilipat di bawah. Bawaan: jam kerja 08.00–17.00 (9 jam) × 20 hari kerja |
| 5 | Perbandingan Model | 14B vs 27B: konfigurasi, kecepatan, akurasi (v1), biaya, rekomendasi, trade-off |
| 6 | Detail Teknis | GPU, VRAM, KV, antrean, distribusi replika, panggilan model, token, penjaga alur, rute, HITL, idempotensi, pembatalan, akar masalah, kamus metrik, metodologi |
| 7 | Riwayat Pengujian | Status fase T0–T7; linimasa 7 kelompok uji (13–24 Nov) menurut tujuannya |

- Setiap halaman berisi judul, tujuan, kesimpulan singkat, visual utama, lalu rincian.
- Rincian teknis dilipat (`details`) supaya tidak membanjiri pembaca.
- Dashboard lama **tidak diubah** dan tetap jadi arsip.
- Cadangannya ada di `.cadangan/dashboard-redesign-2026-11-25/` (7 berkas).

## 2. Perubahan visualisasi

| Visual | Dipakai untuk |
|---|---|
| Kartu KPI + chip perubahan | Ringkasan dan penjelajah per jumlah pengguna |
| Garis (sebelum putus-putus abu, sesudah garis aksen) | Kecepatan, throughput, akurasi, dan biaya per jumlah pengguna |
| Batang berpasangan | Q1–Q8, biaya per jawaban benar, 14B vs 27B |
| Batang bertumpuk | Lulus/sebagian/gagal: total dan per jenis pertanyaan |
| Tabel + cari + unduh CSV | Semua tabel data |
| Akordion | Kegagalan, detail teknis, metodologi |
| Tooltip | Setiap titik dan batang grafik, serta ikon (?) |

Aturan warna:
- Abu netral untuk data sebelum optimasi.
- Satu warna aksen untuk hasil terbaru.
- Merah hanya untuk kegagalan sungguhan dan perubahan yang memburuk.

## 3. Sumber metrik

| Data | Sumber |
|---|---|
| Sesudah optimasi (24 Nov) | `data/agent-workflow-latency/2026-11-24-07-50-14b-post-optimization-seqs4/T7-konkurensi/` (`kejadian.jsonl`, `ringkasan.json`, `analisis.json`, `jawaban.jsonl`) |
| Sebelum optimasi, 1–8 pengguna | `.../2026-11-20-07-30-4gpu/` |
| Sebelum optimasi, 10–20 pengguna | `.../2026-11-23-08-35-14b-seqs4-c10-20/` |
| Akurasi v2 sebelum optimasi | `.../evaluasi-v2/per-skenario.csv` (penilaian ulang) |
| 27B | `data/benchmark-qwen38-27b/2026-11-23-03-35-27b/` |
| Model langsung (g5.2xlarge) | `data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13-ringkasan.json` |
| Riwayat 13–17 Nov | `data/uji-beban-*`, `data/profil-agent-*`, `.../banding-1gpu-vs-4gpu/banding.json` |

Cara mengolah:
- Persentil dihitung ulang dari waktu tiap pertanyaan, memakai interpolasi linear.
- 8 pertanyaan pemanasan dipisah dan tidak dihitung di angka mana pun.

## 4. Rumus biaya

| Ukuran | Rumus |
|---|---|
| Biaya instance per bulan | tarif × jam/hari × hari/bulan × jumlah instance |
| Biaya tahap uji | (lama tahap dalam detik ÷ 3600) × tarif |
| Per pertanyaan dicoba / selesai / berhasil | biaya tahap ÷ n / selesai / lulus v2 |
| Berhasil per jam server | (lulus v2 ÷ lama tahap dalam menit) × 60 |
| Simulasi volume | jam = N ÷ (pertanyaan per menit × 60); biaya = jam × tarif; jawaban benar = N × akurasi tahap |
| Rupiah | USD × kurs |

- Nilai bawaan: tarif USD 7,93854/jam dan kurs 17.900.
- Keduanya bisa diubah, dan semua angka biaya di semua halaman ikut dihitung ulang.
- Angka biaya ini **tidak termasuk** EBS, transfer data keluar, Elastic IP, pajak, dan diskon.
- Biaya per pertanyaan adalah **estimasi biaya komputasi**, bukan tagihan AWS. Tagihan dihitung dari lamanya server menyala dan tidak turun karena server bekerja lebih cepat.

### Perbandingan EC2 vs API Anthropic (ditambahkan 25 Nov)

Bagian ini ada di halaman Biaya Operasional, judulnya "Bandingkan: server sendiri (EC2) vs API Anthropic". Isinya hanya hitungan; tidak ada panggilan ke API Anthropic.

| Ukuran | Rumus |
|---|---|
| Harga masuk rata-rata | porsi normal × harga masuk + porsi baca cache × harga baca cache + porsi tulis cache × harga tulis cache (porsi normal = 100% − baca − tulis) |
| Biaya API per pertanyaan | token masuk × pengali × harga masuk rata-rata + token keluar × pengali × harga keluar |
| Biaya API per bulan | per pertanyaan × pertanyaan per hari × hari per bulan |
| Kapasitas 1 server EC2 per hari | 17,86 pertanyaan/menit (uji 20 pengguna) × 60 × jam per hari. Dengan bawaan 9 jam = 9.644. Isian "pertanyaan per hari" mengikuti angka ini sampai pengguna mengetik angka sendiri |
| Jumlah server EC2 | pembulatan ke atas dari (pertanyaan per hari ÷ kapasitas 1 server) |
| Titik impas | tarif × jam per hari ÷ biaya API per pertanyaan |

Token per pertanyaan diambil dari uji 24 Nov:
- **Campuran:** tahap 20 pengguna, 13.662 token masuk dan 1.151 token keluar (610 di antaranya token berpikir).
- **Per jenis Q1–Q8:** rata-rata semua tahap untuk jenis tersebut.

Isi token masuk dan token keluar:
- **Token masuk** bukan hanya pertanyaan pengguna (±10 token). Isinya terutama instruksi agent, daftar alat, dan hasil alat. Semua itu dikirim ulang di setiap panggilan model, dan satu pertanyaan memakai rata-rata ±3,4 panggilan.
- **Token keluar** terdiri dari:
  - token berpikir (terukur);
  - jawaban yang dikirim ke pengguna (diperkirakan dari jumlah huruf ÷ 4);
  - panggilan alat dan pesan antar-agent (sisanya).

Harga API (USD per 1 juta token, daftar harga Anthropic per 3 Nov 2026):

| Model | Masuk | Keluar | Baca cache | Tulis cache |
|---|---|---|---|---|
| Opus 5.5 | 4 | 20 | 0,20 | 5,00 (aturan 1,25×) |
| Sonnet 5.5 | 2 | 10 | 0,10 | 2,50 (aturan 1,25×) |
| Sonnet 5 | 2 | 10 | 0,20 | 2,50 (tabel `ai_harga_model` DB perusahaan) |
| Haiku 4.5 | 1 | 5 | 0,10 | 1,25 (tabel `ai_harga_model` DB perusahaan) |
| Haiku 5.5 | 0,10 | 0,50 | 0,01 (aturan 10%) | 0,125 (aturan 1,25×) |

Porsi cache sungguhan (data dibaca 25 Nov, hanya agregat):

| Sistem | Sumber | Baca cache | Tulis cache | Normal |
|---|---|---|---|---|
| Portal VoltAgent | MySQL `portal.pemakaian`, 242 permintaan Haiku 4.5 + 61 Sonnet 5, 25 Sep – 11 Nov | 0% | 0% | 100% |
| OpenClaw, Haiku 4.5 | PostgreSQL `ai_pemakaian_model`, 74 panggilan, 1 Okt | 77,2% | 22,3% | 0,5% |
| OpenClaw, Sonnet 5 | PostgreSQL `ai_pemakaian_model`, 521 panggilan, 28 Sep – 2 Nov | 75,7% | 23,8% | 0,5% |

Isi cepat di kalkulator: "Tanpa cache (portal VoltAgent)" = 0/0, dan "Seperti OpenClaw" = 77% baca / 22% tulis.

Semua harga bisa diubah dari dashboard.

Hasil uji kalkulator (jsdom, dicocokkan dengan hitungan manual):
- Sonnet 5.5, campuran, 8.573 pertanyaan/hari: USD 0,0388 per pertanyaan dan USD 7.324 per bulan. Dengan cache 80%: USD 3.408 per bulan.
- Titik impas terhadap 1 server EC2 yang menyala 8 jam/hari: ±1.635 pertanyaan per hari.
- Isian yang tidak valid ditolak dengan pesan.
- Volume di atas kapasitas menambah jumlah server.
- Tombol dari halaman Ringkasan membuka halaman ini.

## 5. Istilah

| Di dashboard | Istilah teknis |
|---|---|
| Waktu hingga jawaban mulai muncul | TTFT (kata pertama yang terlihat) |
| Waktu hingga jawaban selesai | End-to-end latency |
| Waktu respons median / batas 95% / batas 99% | P50 / P95 / P99 |
| Pertanyaan diproses per menit | Throughput |
| Pengguna aktif bersamaan | Concurrency |
| Memenuhi seluruh kriteria / sebagian / gagal | Full pass / partial / fail (evaluator v2) |
| Permintaan yang selesai | Completion rate |
| Panggilan model AI | LLM calls |
| Memori kerja model | KV cache |
| Menunggu giliran | Queue latency |
| Permintaan disela | Preemption |

Daftar lengkapnya (satuan, cara membaca, dan dampaknya) ada di halaman 6 → Kamus metrik.

## 6. Hasil uji tampilan (25 Nov 2026)

| Uji | Cara | Hasil |
|---|---|---|
| Navigasi 7 halaman | jsdom + Edge headless | Semua tampil; menu aktif benar |
| Galat JS | jsdom + log konsol Edge | 0 |
| Teks NaN/undefined/Infinity | jsdom, semua halaman | 0 |
| Pilihan ukuran (5) & jumlah pengguna (9) | jsdom | Grafik dan penjelajah berubah |
| Filter & cari kegagalan | jsdom | Semua 3 kelompok · gagal 2 · sebagian 1 · "evaluator" 1 · tidak cocok → pesan kosong |
| Kalkulator | jsdom, dicocokkan dengan hitungan manual | 7,93854 × 8 × 22 = USD 1.397,18 = Rp 25.009.576 ✓; 2 instance menggandakan hasil ✓; isian tidak sah ditolak dengan pesan ✓ |
| Tarif & kurs ikut ke halaman lain | jsdom | Ringkasan, tabel biaya, dan simulasi ikut berubah |
| CSV | jsdom | ringkas 10 baris, biaya 19 baris, kegagalan 53 baris (pakai BOM, terbaca Excel) |
| Desktop 1440px, terang & gelap | Edge headless, tangkapan layar | Rapi |
| HP 390px | Edge headless di dalam iframe 390px* | Tanpa geser horizontal halaman; tabel dan grafik digeser di dalam kotaknya sendiri |
| Cetak / PDF | Edge `--print-to-pdf` | 21 lembar, ketujuh halaman, bagian lipat ikut terbuka |
| Offline / tanpa CDN | grep | 0 URL eksternal, 0 iframe, 0 kredensial |

\* Edge headless di Windows tidak bisa membuat jendela lebih sempit dari 496px, sehingga tangkapan 390px awalnya menipu: tampilannya terpotong padahal layarnya sebenarnya 496px. Karena itu uji lebar HP dijalankan di dalam iframe selebar 390px.

Yang **tidak** diuji:
- Pembaca layar.
- Perangkat HP asli.
- Firefox dan Safari.

## 7. Inkonsistensi data yang ditemukan

1. **P95/P99 berbeda dari laporan lama.** Laporan lama memakai peringkat terdekat; dashboard ini memakai interpolasi linear untuk semua uji. Contoh: P95 di 12 pengguna sebelum optimasi tercatat 99,7 dtk di sini, sedangkan di laporan 1 vs 4 GPU 122,4 dtk.
2. **Waktu kata pertama gabungan naik** (4,9 → 5,5 dtk), padahal di 20 pengguna turun (12,2 → 7,6 dtk). Penyaring jawaban per kalimat diduga sebagai penyebabnya, tetapi ini belum diukur terpisah.
3. **Kata pertama per panggilan model (LiteLLM) di 20 pengguna naik** (681 → 1.470 ms), sementara yang dilihat pengguna turun. Dugaannya: lebih banyak permintaan mengantre bersamaan karena tidak ada lagi pertanyaan yang macet. Dugaan ini belum dibuktikan karena log antrean vLLM 24 Nov tidak ada.
4. **KV cache, jumlah berjalan/antre per detik 24 Nov: belum tercatat.** Log vLLM tidak sempat diambil sebelum server dimatikan. Di dashboard ditulis "Belum tercatat", bukan 0.
5. **Akurasi v1 sesudah optimasi sedikit turun** (220 → 217), sementara v2 naik. Kriteria lama Q5 tidak mengenali pertanyaan balik soal kategori tiket.
6. **Model 27B hanya punya penilaian v1.** Perbandingan model memakai v1 untuk kedua model.
7. **Tarif g5.2xlarge tidak tercatat.** Uji 13–17 Nov tidak diberi angka biaya, dan tarif g5.12xlarge sengaja tidak dipakai untuk uji-uji itu.
8. **Data "sebelum" berasal dari dua hari** (20 Nov untuk 1–8 pengguna, 23 Nov untuk 10–20 pengguna). Setelannya sama, tetapi uji dijalankan di hari yang berbeda.
9. **Hanya T7 (kapasitas) yang selesai.** T1 dihentikan sesudah 7 skenario; T2–T5 belum diuji; T6 belum diuji live. Status ini ditampilkan apa adanya di halaman Riwayat.
10. Pada 5 dan 8 pengguna, biaya per jawaban benar sesudah optimasi **sedikit lebih mahal** (0,0224 → 0,0245 dan 0,0164 → 0,0173 USD). Hal ini tetap ditampilkan di grafik dan tidak disembunyikan.
