# Hasil Uji Beban Ratu AI — Model Qwen3 14B

**Tanggal uji:** Jumat, 13 November 2026, pukul 10.06–11.13 WIB
**Rencana:** `docs/benchmark/rencana-uji-beban-qwen3-14b.md`
**Grafik:** `docs/grafik-uji-beban-qwen3-14b.html` (interaktif) dan `docs/benchmark/grafik/grafik-uji-beban-qwen3-14b.png`
**Data mentah:** `data/uji-beban-qwen3-14b-2026-11-13-*.csv` / `.json` (tidak ikut Git)

---

## 1. Ringkasan

Dengan setelan sekarang, Ratu AI berbasis Qwen3 14B **nyaman dipakai sampai sekitar 2–3 orang
bersamaan** (median di bawah sekitar 1 menit per pertanyaan). Pada **5 orang**, semua pertanyaan
tetap terjawab benar, tetapi lewat portal satu jawaban butuh **sekitar 2,5 menit** (median).
Pada **8 orang**, lewat portal **9 dari 24 pertanyaan gagal**, sebagian besar karena menunggu lebih
dari 5 menit.

Temuan terbesar: **lewat portal sekitar dua kali lebih lambat** daripada memanggil agent langsung
pada 5–8 pemakai (median 145 lawan 73 detik pada 5 pemakai), padahal jumlah panggilan ke model
per pertanyaan hampir sama. Jadi selain antrean di GPU, **server portal di laptop ikut menjadi
titik sempit**. Galat batas kuota (429) **tidak muncul sama sekali** dengan key yang baru.

Log server EC2 (dibaca sesudah uji) menguatkan ini: saat agent dipanggil langsung, model **penuh
hampir sepanjang waktu** pada 5–8 pemakai (2 permintaan sekaligus, sisanya mengantre). Saat lewat
portal, model justru **lebih sering longgar** walau pemakai menunggu lebih lama. Jadi pada jalur
portal, waktu tunggu terbesar terjadi sebelum permintaan sampai ke model. Semua 416 permintaan yang
sampai ke model dibalas `200 OK`, sehingga sambungan putus di jalur portal tidak berasal dari server.

---

## 2. Kondisi uji

| Hal | Nilai |
|---|---|
| Model | `qwen3-14b` lewat MR AI Gateway (LiteLLM), vLLM di AWS EC2, GPU NVIDIA A10G 24 GB |
| Alamat gateway | Tunnel publik Cloudflare (`trycloudflare.com`), tetap memerlukan API key |
| Portal | Server Next.js mode **dev** di laptop pemilik proyek (RAM sekitar 7,3 GB) |
| Akun uji | Satu akun (pemilik proyek, departemen IT), dipakai semua pemakai virtual |
| Pertanyaan | 8 jenis (bagian 5 rencana), dibagi bergiliran, 3 pertanyaan per pemakai, jeda 5 dtk |
| Batas waktu per pertanyaan | 300 detik |
| Urutan | Lapis B (10.06–10.45), lalu lapis A (10.46–11.13) |
| Tiket tersimpan selama uji | **0** di kedua lapis (yang diuji hanya rancangan) |

---

## 3. Hasil utama per tahap

| Tahap | Pemakai | Lapis | Pertanyaan | Berhasil | Benar | P50 (dtk) | P95 (dtk) | Kata pertama P50 (dtk) | Panggilan model / pertanyaan | 429 | Sambungan gateway putus (diulang) | Waktu habis | Gagal lain |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T1 | 1 | A | 3 | 3 | 3 | 18,5 | 25,2 | 5,7 | 2,7 | 0 | 0 | 0 | 0 |
| T2 | 2 | A | 6 | 6 | 6 | 41,6 | 76,8 | 3,2 | 4,0 | 0 | 0 | 0 | 0 |
| T3 | 3 | A | 9 | 9 | 9 | 44,0 | 81,7 | 4,2 | 3,6 | 0 | 0 | 0 | 0 |
| T4 | 5 | A | 15 | 15 | 15 | 73,2 | 101,1 | 9,1 | 3,7 | 0 | 0 | 0 | 0 |
| T5 | 8 | A | 24 | 24 | 24 | 124,5 | 154,5 | 19,5 | 3,5 | 0 | 0 | 0 | 0 |
| T1 | 1 | B | 3 | 3 | 3 | 20,3 | 34,4 | 8,5 | 2,7 | 0 | 0 | 0 | 0 |
| T2 | 2 | B | 6 | 6 | 6 | 34,9 | 66,9 | 4,6 | 3,7 | 0 | 0 | 0 | 0 |
| T3 | 3 | B | 9 | 9 | 8 | 71,6 | 154,0 | 7,7 | 3,6 | 0 | 0 | 0 | 0 |
| T4 | 5 | B | 15 | 15 | 15 | 144,9 | 196,5 | 22,4 | 3,9 | 0 | 1 | 0 | 0 |
| T5 | 8 | B | 24 | **15** | 14 | 238,4 | 295,1 | 32,0 | 3,5 | 0 | 9 | **8** | 1 |

Keterangan:
- P50 dan P95 dihitung dari pertanyaan yang **berhasil** saja. Di T5 lapis B, 9 pertanyaan yang
  gagal tidak ikut, jadi angka sebenarnya lebih buruk dari yang tertulis.
- "Panggilan model / pertanyaan" lapis B dihitung ulang dari log server portal. Waktu di log itu
  dihitung sejak server dinyalakan, sehingga dicocokkan ke jam biasa terlebih dahulu (214 dari 286
  panggilan masuk ke jendela uji; sisanya dari uji sebelumnya).
- "Gagal lain" di T5 lapis B: satu permintaan ke portal gagal tersambung ("fetch failed") setelah
  11 detik.

---

## 4. Per jenis pertanyaan (T4, 5 pemakai)

| Kode | Jenis | Jumlah dijawab (A / B) | Berhasil | Benar | Median lapis A (dtk) | Median lapis B (dtk) |
|---|---|---:|---:|---:|---:|---:|
| Q1 | Data penjualan | 2 / 2 | semua | semua | 78,4 | 169,5 |
| Q2 | Peringatan dini | 2 / 2 | semua | semua | 96,0 | 166,7 |
| Q3 | Stok kosong | 2 / 2 | semua | semua | 70,6 | 129,3 |
| Q4 | SOP | 2 / 2 | semua | semua | 64,8 | 147,6 |
| Q5 | Rancangan tiket | 2 / 2 | semua | semua | 64,3 | 137,0 |
| Q6 | Data karyawan | 2 / 2 | semua | semua | 75,9 | 150,5 |
| Q7 | Harus ditolak | 2 / 2 | semua | semua | 30,1 | 68,4 |
| Q8 | Sapaan | 1 / 1 | semua | semua | 33,3 | 71,4 |

Pertanyaan yang memanggil alat data (Q1–Q6) dua sampai tiga kali lebih lama daripada yang tidak
(Q7, Q8), karena butuh lebih banyak panggilan ke model. Skrip uji tidak mencatat token, tetapi
catatan LiteLLM mencatat token setiap panggilan ke model (bagian 5c).

---

## 5. Sumber daya

| Tahap | Memori GPU | Beban GPU | Daya GPU | RAM laptop maks | CPU laptop rata-rata (A / B) |
|---|---|---|---|---:|---|
| T1 | 18.375 / 23.028 MiB | 100% (03:06:52 UTC, awal T1 lapis B) | 218 W | 7,3 GB | 36% / 63% |
| T2 | tidak tercatat | tidak tercatat | — | 6,8 / 7,3 GB | 26% / 54% |
| T3 | 18,4 / 22,5 GiB (tetap) | sekitar 75%, lalu 0% di jeda tahap (10.20 WIB) | 63 W saat jeda | 6,7 / 7,3 GB | 25% / 57% |
| T4 | tidak tercatat | tidak tercatat | — | 6,6 / 7,3 GB | 27% / 66% |
| T5 | tidak tercatat | tidak tercatat | — | 7,2 / 7,3 GB | 28% / 63% |

- Memori GPU **tetap sekitar 18 GB** sepanjang uji, karena vLLM memesan memori di depan. Angka ini
  tidak menunjukkan beban.
- Hanya ada **satu proses vLLM** di GPU, yaitu Qwen3 14B. Ini konsisten dengan galat "Connection
  error" Qwen3.5 35B kemarin: kemungkinan server model-nya tidak sedang menyala.
- **CPU laptop sekitar dua kali lebih sibuk saat lewat portal** (54–66%) daripada agent langsung
  (25–36%), dan RAM laptop hampir penuh di semua tahap.
- Beban GPU (persen, daya) pada tahap 5 dan 8 pemakai **tidak tercatat**. Penggantinya adalah log
  vLLM di bawah, yang mencatat isi antrean model.

### 5a. Beban model (log vLLM di EC2)

Diambil sesudah uji lewat `docker logs` container `qwen3-vllm` (hanya dibaca, tidak ada setelan
yang diubah). vLLM mencetak satu baris statistik sekitar tiap 10 detik selama ada permintaan; 271
baris jatuh di jendela uji. vLLM disetel melayani **paling banyak 2 permintaan sekaligus**
(`max-num-seqs 2`); permintaan berikutnya mengantre.

| Tahap | Lapis | Model penuh (% waktu) | Antrean rata-rata | Antrean terbanyak | Memori KV terpakai maks | Token keluar / dtk saat sibuk |
|---|---|---:|---:|---:|---:|---:|
| T1 | A / B | 0% / 0% | 0 / 0 | 0 / 0 | 10% / 11% | 31 / 30 |
| T2 | A / B | 56% / 56% | 0 / 0 | 0 / 0 | 30% / 31% | 72 / 62 |
| T3 | A / B | 71% / 44% | 0,4 / 0,2 | 1 / 1 | 27% / 28% | 72 / 70 |
| T4 | A / B | **94%** / 51% | **2,0** / 0,8 | 3 / 3 | 31% / 33% | 83 / 70 |
| T5 | A / B | **99%** / 31% | **4,7** / 1,2 | 7 / 8 | 28% / 31% | 84 / 66 |

Yang terbaca dari tabel:
- **Lapis A: model jadi titik sempit mulai 5 pemakai.** Pada 8 pemakai model penuh 99% waktu
  dan rata-rata hampir 5 permintaan menunggu. Ini cocok dengan waktu sampai kata pertama yang naik
  ke 20 detik.
- **Lapis B: model justru longgar.** Pada 8 pemakai model hanya penuh 31% waktu, padahal pemakai
  menunggu dua kali lebih lama daripada lapis A. Artinya permintaan tertahan **sebelum** sampai ke
  model, yaitu di portal mode dev di laptop (CPU 54–66%, RAM hampir penuh) atau di tunnel.
- **Memori KV hanya terpakai maksimal sekitar 33%.** Batas 2 permintaan sekaligus, bukan memori
  GPU, yang membatasi kapasitas. Secara teori ada ruang untuk melayani lebih banyak permintaan
  sekaligus, tetapi itu perubahan setelan vLLM dan harus diputuskan dan diuji pemilik server.
- Kecepatan keluaran total model sekitar **84 token/detik** saat penuh, atau sekitar 42 token/detik
  per permintaan.
- **Tidak ada galat di server.** LiteLLM dan vLLM sama-sama mencatat 416 permintaan
  `POST /v1/chat/completions` di jendela uji, semuanya `200 OK`. Tidak ada baris error, timeout,
  atau abort.

Data olahan: `data/uji-beban-qwen3-14b-vllm.json` (tidak ikut Git). Grafiknya G7–G9 di
`docs/grafik-uji-beban-qwen3-14b.html`.

### 5b. Uji ulang lapis A dengan rekaman GPU (13.31–13.59 WIB)

Beban GPU tidak direkam saat uji pagi, dan `nvidia-smi` tidak menyimpan riwayat, jadi lapis A
diulang dengan **protokol yang sama persis** (1, 2, 3, 5, 8 pemakai; 3 pertanyaan per pemakai;
urutan pertanyaan sama; batas 300 dtk; jeda tahap 120 dtk). Bedanya hanya satu: GPU direkam tiap
0,5 detik lewat `nvidia-smi` di server (`scripts/rekam-gpu.mts`, lewat SSH, hanya membaca). Fokusnya
lapis A, karena jalur ini langsung ke model.

| Pemakai | Berhasil (pagi / ulang) | P50 dtk (pagi / ulang) | P95 dtk (pagi / ulang) | GPU rata-rata | Daya rata-rata | Daya puncak | Suhu puncak | Energi GPU per pertanyaan* | Model penuh / antrean rata-rata (vLLM) |
|---:|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 3/3 / 3/3 | 18,5 / 33,7 | 25,2 / 35,2 | 91% | 207 W | 228 W | 63 °C | 1,25 Wh | 31% / 0 |
| 2 | 6/6 / 6/6 | 41,6 / 27,7 | 76,8 / 66,1 | 96% | 215 W | 265 W | 66 °C | 0,87 Wh | 72% / 0 |
| 3 | 9/9 / 9/9 | 44,0 / 43,1 | 81,7 / 72,9 | 99% | 217 W | 257 W | 60 °C | 0,77 Wh | 80% / 0,4 |
| 5 | 15/15 / 14/15 | 73,2 / 59,8 | 101,1 / 95,0 | 99% | 222 W | 268 W | 66 °C | 1,14 Wh | 82% / 1,4 |
| 8 | 24/24 / 22/24 | 124,5 / 129,1 | 154,5 / 149,3 | 100% | 223 W | 269 W | 67 °C | 0,96 Wh | 100% / 4,6 |

\* Energi GPU di atas kondisi diam (sekitar 64 W) selama tahap, dibagi jumlah pertanyaan yang berhasil.

Yang terbaca:
- **Hasil uji ulang sebanding dengan uji pagi.** Waktu jawab di 3, 5, dan 8 pemakai mirip, dan
  antrean model pada 8 pemakai hampir sama (rata-rata 4,6 lawan 4,7 permintaan menunggu). Selisih
  di 1 pemakai berasal dari sampel kecil (3 pertanyaan).
- **Persen beban GPU sudah sekitar 90% walau hanya 1 pemakai.** Angka persen dari `nvidia-smi`
  berarti berapa lama GPU sedang bekerja, bukan seberapa penuh kemampuannya. Jadi angka ini tidak
  bisa naik lagi saat pemakai bertambah, dan bukan ukuran yang tepat untuk "seberapa berat".
- **Daya lebih menggambarkan beban:** 207 W (1 pemakai) naik pelan ke 223 W (8 pemakai), dari batas
  300 W kartu A10G. Kenaikannya kecil karena vLLM hanya melayani 2 permintaan sekaligus; pemakai
  berikutnya menunggu, bukan membuat GPU bekerja lebih keras.
- **Listrik per pertanyaan sekitar 1 Wh** (0,8–1,3 Wh), tidak banyak berubah dengan jumlah pemakai.
- **Suhu tetap aman** (puncak 67 °C).
- **3 pertanyaan kena batas waktu 300 detik** (pagi: 0): Q5 rancangan tiket di 5 dan 8 pemakai, dan
  Q4 SOP di 8 pemakai. Antrean model saat itu sama dengan pagi, jadi dugaannya agent memerlukan lebih
  banyak langkah pada dua pertanyaan itu. Isi langkahnya tidak direkam, jadi belum dipastikan.
  Ada juga 1 jawaban Q4 yang selesai tanpa memanggil alat SOP.
- 0 galat 429, 0 sambungan putus, 0 tiket tersimpan.

**Lapis B tidak diulang.** Percobaan pertama lapis B sore ini gagal di 3 pemakai (1 dari 9
berhasil), karena server portal mode dev di laptop menyalakan ulang dirinya sendiri setelah
memorinya hampir penuh ("Server is approaching the used memory threshold, restarting"). Antrean
model saat itu hampir kosong. Hasil itu menguatkan temuan bahwa pada jalur portal, laptop yang
menjadi titik sempit, bukan GPU.

Data: `data/uji-beban-qwen3-14b-2026-11-13-06-59-A-dengan-gpu.json` (berisi 3.421 sampel GPU) dan
`data/uji-beban-qwen3-14b-vllm-ulang-A.json` (tidak ikut Git). Grafik G10–G13 dan tabel GPU setiap
pertanyaan ada di `docs/grafik-uji-beban-qwen3-14b.html`.

### 5c. Waktu sampai token pertama (TTFT) di model

LiteLLM menyimpan catatan setiap panggilan ke model di database gateway (tabel `LiteLLM_SpendLogs`):
jam masuk, jam token pertama keluar, jam selesai, jumlah token, dan status. Catatan ini ada sejak
10 November, jadi uji pagi dan uji ulang ikut tercatat (826 panggilan Qwen3 14B pada 13 November).
Yang diambil **hanya kolom waktu, token, dan status**; isi percakapan dan API key tidak dibaca.

Ini TTFT per **panggilan ke model**, berbeda dengan "kata pertama" di bagian 3 yang diukur dari sisi
pemakai. Satu pertanyaan Ratu AI memanggil model beberapa kali (perute lalu agent aplikasi), jadi
"kata pertama" mencakup semua panggilan sebelum teks pertama muncul.

| Pemakai | Panggilan per pertanyaan (A pagi / A ulang) | TTFT median A pagi | TTFT median B pagi | TTFT median A ulang | TTFT P95 A pagi | Lama satu panggilan, median (A pagi) |
|---:|---|---:|---:|---:|---:|---:|
| 1 | 2,7 / 4,7 | 0,05 dtk | 0,07 | 0,08 | 0,3 | 5,0 dtk |
| 2 | 4,0 / 3,5 | 0,13 | 0,18 | 0,14 | 1,1 | 6,6 |
| 3 | 3,6 / 3,6 | 0,89 | 0,79 | 0,90 | 9,0 | 10,7 |
| 5 | 3,7 / 5,5 | 8,0 | 4,9 | 6,5 | 25,7 | 15,7 |
| 8 | 3,5 / 4,3 | 17,3 | 8,9 | 19,8 | 50,4 | 29,0 |

Yang terbaca:
- **Model sendiri cepat.** Tanpa antrean, token pertama keluar dalam sekitar 0,05–0,1 detik
  (bagian awal perintah sudah tersimpan di cache vLLM).
- **TTFT yang besar adalah waktu menunggu giliran.** TTFT naik ke 17–20 detik di 8 pemakai, sejalan
  dengan antrean vLLM (bagian 5a). Ini menguatkan bahwa batas 2 permintaan sekaligus adalah titik
  sempit di jalur langsung.
- **TTFT lapis B lebih rendah daripada lapis A**, karena permintaan lapis B tertahan lebih dulu di
  laptop sehingga antrean di model lebih pendek.
- **Token per panggilan:** sekitar 3.500–4.900 token masuk dan 250–310 token keluar (median).
  Bagian terbesar token masuk adalah instruksi agent dan daftar alat.
- **Uji ulang memanggil model lebih sering pada 5 pemakai** (5,5 lawan 3,7 panggilan per pertanyaan).
  Ini cocok dengan dugaan bahwa agent mengambil lebih banyak langkah, yang menjelaskan 3 pertanyaan
  yang kena batas waktu di uji ulang.
- Semua panggilan berstatus `success`.

Data: `data/litellm-waktu-qwen3-14b-2026-11-13.csv` (tidak ikut Git). Grafik G14 di halaman grafik.

Catatan: vLLM juga punya angka TTFT di endpoint metriknya, tetapi hanya sebagai total sejak server
dinyalakan (rata-rata 6,0 detik dari 1.187 permintaan, dengan 5,7 detik di antaranya waktu antre),
jadi tidak bisa dipisah per uji.

---

## 6. Pencapaian target (5 pemakai)

| Ukuran | Target usulan | Lapis A | Lapis B | Status (lapis B, jalur yang dipakai pemakai) |
|---|---|---:|---:|---|
| Waktu jawab P50 | ≤ 90 dtk | 73,2 | 144,9 | **TIDAK TERCAPAI** (lapis A tercapai) |
| Waktu jawab P95 | ≤ 180 dtk | 101,1 | 196,5 | **TIDAK TERCAPAI** (lapis A tercapai) |
| Persen berhasil | ≥ 90% | 100% | 100% | TERCAPAI |
| Galat 429 | 0 | 0 | 0 | TERCAPAI |
| Ketepatan | ≥ 80%, turun ≤ 10 poin dari T1 | 100% | 100% | TERCAPAI |
| Tiket tersimpan | 0 (wajib) | 0 | 0 | TERCAPAI |
| API key di log atau laporan | 0 (wajib) | 0 | 0 | TERCAPAI |

---

## 7. Pembuktian dugaan

| Dugaan | Hasil | Bukti |
|---|---|---|
| H1 Waktu naik tajam di atas 2 pemakai | **Terbukti** | Lapis A: 18 → 42 → 44 → 73 → 125 dtk. Waktu sampai kata pertama naik dari sekitar 4 dtk (≤ 3 pemakai) ke 9 dtk (5) dan 20 dtk (8), tanda permintaan mengantre di server model. Jumlah panggilan model per pertanyaan tetap sekitar 3,5, jadi kenaikannya bukan karena pertanyaannya lebih berat |
| H2 Galat 429 muncul sebelum GPU penuh | **Tidak terbukti** | Dengan key baru, 0 galat 429 di 205 panggilan model (lapis A) dan 214 (lapis B) |
| H3 Lapis B lebih lambat dari lapis A | **Terbukti, dan selisihnya besar** | Median lapis B sekitar 2× lapis A pada 5 dan 8 pemakai; CPU laptop sekitar 2× lebih sibuk. Log vLLM menunjukkan model lebih longgar di lapis B (penuh 31% lawan 99% waktu pada 8 pemakai), jadi waktu tunggu tambahannya terjadi sebelum model, di portal atau tunnel. Mana yang paling berperan belum dipisahkan, lihat bagian 8 |
| H4 Ketepatan tidak turun karena beban | **Terbukti untuk jawaban yang selesai** | Lapis A 75/75 benar. Lapis B 46/57 benar: 9 gagal karena waktu habis atau sambungan, 2 jawaban selesai tetapi tidak memenuhi kriteria (T3: rancangan tiket tidak terbentuk; T5: total penjualan dijawab tanpa memanggil alat) |

---

## 8. Temuan tambahan

1. **Sambungan ke gateway putus setelah menunggu sekitar 140–150 detik.** Pada tahap 5 dan 8
   pemakai lewat portal, 3 permintaan ke model diputus setelah 142–149 detik menunggu tanpa balasan,
   lalu diulang otomatis. Ada juga 4 yang putus setelah 26–38 detik, dan 2 `ECONNABORTED` di akhir
   tahap 8 pemakai, yang kemungkinan dari pertanyaan yang dihentikan batas waktu 300 detik.
   **Dugaan:** tunnel Cloudflare memutus permintaan yang terlalu lama belum dibalas. Retry otomatis
   lalu menaruh permintaan itu kembali ke ujung antrean, sehingga waktu tunggu makin panjang. Di
   lapis A, yang memakai tunnel yang sama, tidak ada sambungan putus, jadi dugaan ini belum terbukti.
   **Yang sudah pasti dari log server:** LiteLLM dan vLLM tidak mencatat satu pun galat atau
   permintaan yang dibatalkan; semua 416 permintaan dibalas `200 OK`. Jadi pemutusnya ada di antara
   laptop dan LiteLLM (portal, jaringan laptop, atau tunnel), bukan di server model.
2. **Lapis B dijalankan lebih dulu.** Kondisi GPU atau pemakaian lain di jam itu bisa sedikit
   berbeda dengan saat lapis A, sehingga sebagian selisih A dan B bisa datang dari waktu uji.
   Selisih sebesar sekitar 2× kecil kemungkinannya hanya karena itu.
3. **Portal berjalan dalam mode dev**, yang lebih lambat dan memakan memori lebih besar daripada mode
   produksi (`npm run deploy`). Di server produksi, angka lapis B kemungkinan membaik. Ini belum
   diuji.

---

## 9. Kesimpulan dan saran

| Titik sempit | Bukti | Saran (diputuskan pemilik proyek) |
|---|---|---|
| Antrean di server model | Lapis A: model penuh 94–99% waktu dan rata-rata 2–5 permintaan mengantre pada 5–8 pemakai; memori KV hanya terpakai maksimal sekitar 33% | Pertimbangkan menaikkan `max-num-seqs` vLLM (misalnya 4), lalu uji ulang. Ini perubahan setelan server, jadi diputuskan dan dijalankan pemilik server; rekam `nvidia-smi` selama uji |
| Server portal di laptop | Lapis B sekitar 2× lebih lambat, padahal model lebih longgar (penuh 31% waktu pada 8 pemakai); CPU laptop sekitar 2× lebih sibuk, RAM hampir penuh | Jalankan portal dalam mode produksi di server, bukan mode dev di laptop, lalu uji ulang lapis B |
| Tunnel publik Cloudflare | Sambungan putus setelah sekitar 140 dtk menunggu | Pakai tunnel bernama atau jalur privat yang lebih stabil, atau naikkan batas waktu tunggu di sisi tunnel |
| Langkah agent per pertanyaan | Pertanyaan data sekitar 2–3× lebih lama daripada sapaan | Kurangi langkah delegasi untuk pertanyaan data yang sederhana |

**Batas pemakaian yang disarankan untuk saat ini:** sekitar 2–3 pemakai bersamaan untuk Qwen3 14B
lewat portal di laptop. Hasil ini belum diuji dengan pemakai sungguhan.

---

## 10. Batasan uji

- Satu sesi uji, 3 pertanyaan per pemakai. Angkanya bisa berbeda di jam lain.
- Semua pemakai virtual memakai satu akun yang sama.
- Beban GPU terukur hanya untuk uji ulang lapis A (bagian 5b). Di uji pagi, persen beban dan daya GPU
  di tahap 5 dan 8 pemakai tidak tercatat; isi antrean model diambil
  dari log vLLM sesudah uji. Baris statistik vLLM muncul sekitar tiap 10 detik dan tidak muncul
  saat model menganggur, jadi persen waktu "penuh" adalah perkiraan per 10 detik.
- Skrip uji tidak mencatat token per pertanyaan; yang tersedia token per panggilan ke model dari
  catatan LiteLLM (bagian 5c).
- Model pencarian SOP berjalan di laptop yang RAM-nya hampir penuh; ini bisa ikut memperlambat Q4.
- Konfigurasi EC2, vLLM, LiteLLM, dan model bawaan portal **tidak diubah** selama uji.
