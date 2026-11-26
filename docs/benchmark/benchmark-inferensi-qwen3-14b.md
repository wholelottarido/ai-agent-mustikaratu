# Benchmark Inferensi Qwen3 14B di AWS EC2 (A10G)

**Tanggal:** 16 November 2026, 15.13–15.36 WIB (23 menit)
**Grafik:** tab **Kecepatan model** di `docs/grafik-uji-beban-qwen3-14b.html`
**Skrip:** `scripts/benchmark-inferensi-vllm.py` (pengukur) dan `scripts/olah-benchmark-inferensi.py` (pengolah)
**Data mentah:** `data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13.jsonl`, `.csv`, `-ringkasan.json` (tidak ikut Git)

> Benchmark ini mengukur **kecepatan model itu sendiri**. Uji beban sebelumnya
> (`docs/benchmark/hasil-uji-beban-qwen3-14b.md`) mengukur **waktu Ratu AI menjawab satu pertanyaan**, yang
> terdiri dari 3–5 panggilan model ditambah pengambilan data. Keduanya saling melengkapi, tetapi
> angkanya tidak bisa dibandingkan langsung. Lihat bagian 7.

---

## 1. Ringkasan

| Ukuran | Hasil |
|---|---|
| Kecepatan menulis, 1 pengguna | **49–53 token per detik** (satu token setiap 19–20 ms) |
| Jeda sampai kata pertama, prompt belum di cache | 0,25 dtk (540 token) · 0,95 dtk (2.100 token) · 1,9 dtk (4.200 token) |
| Jeda sampai kata pertama, prompt sudah di cache | **sekitar 40 ms**, berapa pun panjang prompt-nya |
| Total waktu, jawaban 512 token | 9,7–12,3 detik, tergantung panjang prompt dan cache |
| Token keluar per detik, gabungan | 43 (1 permintaan) · 72 (2 sekaligus) · **110 (4 sekaligus, 2,5×)** |
| GPU saat bekerja | listrik ±230 W (puncak 280 W dari 300 W), suhu maks 70 °C, clock tetap 1.710 MHz |
| Masalah | 0 galat, 0 preemption, 0 permintaan terganggu pemakai lain |

Kesimpulan:
1. **Modelnya sendiri cepat dan sangat stabil.** Satu jawaban 256 token selesai dalam sekitar 5 detik,
   dan angka P95 hampir sama dengan P50 di semua kombinasi.
2. **Kecepatan menulis satu permintaan sudah dekat batas fisik A10G.** Untuk model sebesar ini,
   kecepatan menulis ditentukan oleh seberapa cepat GPU membaca bobot model dari memorinya. Angka
   ±53 token per detik kira-kira 80–85% dari batas teoritis kartu ini (bagian 6).
3. **GPU masih punya ruang untuk mengerjakan beberapa permintaan sekaligus.** Dengan 4 permintaan
   bersamaan, jumlah token yang selesai per detik naik 2,5 kali, dan memori kerja baru terpakai 19%.
4. **Lambatnya Ratu AI saat ramai bukan karena GPU kehabisan tenaga.** Penyebabnya adalah
   banyaknya panggilan model dan token per pertanyaan, ditambah antrean karena batas 4 permintaan
   sekaligus (bagian 7).
5. **Upgrade GPU belum diperlukan untuk beban sekarang.** Cara yang lebih murah dan lebih
   berpengaruh adalah mengurangi panggilan dan token per pertanyaan di Ratu AI (bagian 8).

---

## 2. Cara uji

| Hal | Isi |
|---|---|
| Server | AWS EC2, GPU NVIDIA A10G 24 GB (batas listrik 300 W), driver 580.105.08 |
| Model | Qwen3 14B AWQ, vLLM 0.33.0 |
| Setelan vLLM | `max-num-seqs 4`, `max-model-len 16384`, `gpu-memory-utilization 0.85`, cache prompt aktif. Tidak diubah |
| Jalur | Langsung ke `127.0.0.1:8000` dari dalam server lewat SSH. Tanpa Ratu AI, LiteLLM, Cloudflare, atau portal |
| Skrip | Python bawaan saja, dijalankan lewat `ssh mr-ec2 python3 - < skrip`. Tidak ada berkas yang ditulis di server |
| Panjang prompt | Target 512, 2.048, 4.096 token. Aktual (dihitung tokenizer model lewat `/tokenize` dan `usage`): **540, 2.112, 4.170** |
| Panjang jawaban | 128, 256, 512 token, dipaksa tepat lewat `ignore_eos` |
| Setelan jawaban | `temperature 0`, `seed 1234`, mode berpikir dimatikan (`enable_thinking: false`), tanpa alat |
| Satu pengguna | 9 kombinasi × (1 pemanasan + 5 streaming cold + 5 streaming warm + 5 non-streaming cold + 5 non-streaming warm). Permintaan berikutnya baru dikirim setelah yang sebelumnya selesai |
| Paralel | 1, 2, dan 4 permintaan dikirim bersamaan, masing-masing 5 putaran. Prompt 2.112 token, jawaban 256 token, cold |
| Rekaman | `nvidia-smi` setiap 0,5 detik; `/metrics` vLLM setiap 2 detik |
| Pengaman | Berhenti otomatis kalau ada HTTP 5xx, galat koneksi, atau preemption bertambah. Tidak terjadi |

**Cold dan warm diukur terpisah.** vLLM menyimpan hasil olahan prompt di cache, jadi prompt yang
sama tidak dihitung ulang.
- **Cold:** di awal prompt ada kode acak, sehingga cache tidak bisa dipakai. Terbukti: 0% token
  prompt diambil dari cache.
- **Warm:** prompt persis sama dengan yang sudah dikirim sebelumnya. Terbukti: 98–99,8% token prompt
  diambil dari cache.

**Semua jawaban tercatat "terpotong".** Panjang jawaban sengaja dipaksa tepat lewat `ignore_eos`,
supaya setiap permintaan membawa beban yang sama. Karena itu semua 224 permintaan berakhir di batas
`max_tokens` (`finish_reason = length`). Jumlah token aktual selalu sama dengan targetnya.

Istilah:
- **TTFT:** jeda dari permintaan dikirim sampai kata (token) pertama keluar.
- **TPOT:** waktu rata-rata untuk setiap token berikutnya.
- **Token per detik (TPS):** kecepatan menulis setelah kata pertama keluar, sama dengan 1.000 ÷ TPOT.
- **P50:** waktu tengah. Separuh permintaan lebih cepat dari angka ini.
- **P95:** 95 dari 100 permintaan lebih cepat dari angka ini.

---

## 3. Kecepatan model saat satu pengguna

### Kecepatan menulis

| Prompt (aktual) | TPOT P50 | TPOT P95 | Token per detik |
|---:|---:|---:|---:|
| 540 token | 18,8 ms | 18,8 ms | 53,2 |
| 2.110 token | 19,4 ms | 19,5 ms | 51,6 |
| 4.168 token | 20,2 ms | 20,2 ms | 49,5 |

- **Panjang jawaban tidak mengubah kecepatan menulis.** Jawaban 128, 256, dan 512 token ditulis
  dengan kecepatan yang sama. Cold atau warm juga tidak berpengaruh.
- **Prompt yang panjang sedikit memperlambat** (sekitar 7% dari 540 ke 4.168 token), karena setiap
  token baru harus "melihat" prompt yang lebih panjang.
- **Hampir tidak ada naik-turun.** P95 nyaris sama dengan P50, artinya server tidak terganggu
  apa pun selama pengukuran.

### Total waktu satu permintaan (P50, detik)

| Prompt | Jawaban | Cold | Warm |
|---:|---:|---:|---:|
| 540 | 128 | 2,63 | 2,42 |
| 540 | 256 | 5,04 | 4,82 |
| 540 | 512 | 9,87 | 9,66 |
| 2.110 | 128 | 3,41 | 2,50 |
| 2.110 | 256 | 5,89 | 4,98 |
| 2.110 | 512 | 10,88 | 9,98 |
| 4.168 | 128 | 4,48 | 2,60 |
| 4.168 | 256 | 7,07 | 5,19 |
| 4.168 | 512 | 12,26 | 10,38 |

- **Total waktu terutama ditentukan oleh panjang jawaban.** Setiap 100 token jawaban menambah
  sekitar 2 detik.
- **Streaming dan non-streaming selesai di waktu yang sama** (selisihnya di bawah 0,01 detik).
  Streaming tidak membuat jawaban selesai lebih cepat. Bedanya, pengguna sudah melihat kata pertama
  setelah 0,04–1,9 detik, bukan menunggu sampai seluruh jawaban selesai.
- Semua sel berisi 5 pengulangan, dan P95-nya berbeda paling banyak 0,01 detik dari P50. Tabel
  lengkapnya ada di grafik ("Lihat angkanya").

---

## 4. Pengaruh panjang prompt terhadap TTFT

| Prompt (aktual) | TTFT cold P50 / P95 | TTFT warm P50 / P95 | Cache terpakai (cold / warm) |
|---:|---:|---:|---:|
| 540 token | 248 / 249 ms | 38 / 38 ms | 0% / 98% |
| 2.110 token | 945 / 945 ms | 41 / 42 ms | 0% / 99% |
| 4.168 token | 1.924 / 1.924 ms | 44 / 44 ms | 0% / 100% |

- **Tanpa cache, TTFT naik hampir lurus dengan panjang prompt:** sekitar 0,46 ms per token prompt.
  Dengan kata lain, GPU mengolah prompt sekitar 2.200 token per detik.
- **Dengan cache, TTFT hampir nol (±40 ms)** dan tidak bergantung panjang prompt.
- Ini penting untuk Ratu AI. Setiap panggilan Ratu AI membawa sekitar 3.900–4.200 token prompt,
  dan sebagian besar isinya (instruksi dan daftar alat) sama di setiap panggilan. Catatan server
  sejak dinyalakan menunjukkan **87% token prompt diambil dari cache**. Itu sebabnya di uji beban,
  jeda sebelum kata pertama tanpa antrean hanya 0,05–0,25 detik walaupun prompt-nya panjang.

---

## 5. Throughput 1, 2, dan 4 permintaan paralel

Prompt 2.112 token (cold), jawaban 256 token, 5 putaran per tingkat.

| Bersamaan | Token keluar per detik (gabungan) | Dibanding 1 permintaan | TTFT P50 / P95 | TPOT P50 / P95 | Total P50 / P95 | Menunggu maks |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 43,5 | 1,0× | 0,95 / 0,95 dtk | 19,4 / 19,4 ms | 5,9 / 5,9 dtk | 0 |
| 2 | 72,2 | 1,7× | 1,81 / 1,88 dtk | 20,4 / 20,7 ms | 7,1 / 7,1 dtk | 0 |
| 4 | 109,9 | **2,5×** | 2,71 / 3,75 dtk | 22,3 / 29,2 ms | 9,3 / 9,3 dtk | 2 |

"Token keluar per detik (gabungan)" = total token jawaban semua permintaan ÷ waktu dari permintaan
pertama dikirim sampai yang terakhir selesai. Angka ini termasuk jeda awal, jadi lebih kecil daripada
kecepatan menulis murni (51,6 token per detik untuk 1 permintaan).

Yang terbaca:
- **GPU bisa mengerjakan beberapa permintaan sekaligus dengan efisien.** 4 permintaan bersamaan
  menghasilkan 2,5× lebih banyak token per detik daripada 1 permintaan.
- **Harganya: tiap permintaan sedikit lebih lambat.** Waktu per token naik dari 19,4 ke 22,3 ms (P95
  29 ms), dan total waktu satu jawaban naik dari 5,9 ke 9,3 detik.
- **TTFT naik karena prompt diproses bergantian.** Empat prompt cold 2.112 token yang datang bersamaan
  tidak diolah serentak. Masing-masing butuh ±0,95 detik, jadi yang terakhir baru mulai menulis
  setelah ±3–4 detik. Dua permintaan sempat tercatat "menunggu" di vLLM karena alasan ini, walaupun
  batas 4 permintaan belum penuh.
- **Memori kerja (KV cache) paling tinggi terpakai 19%**, jadi pada panjang prompt ini memori bukan
  penghambat.
- Batas `max-num-seqs 4` berarti tingkat paralel di atas 4 tidak diuji di sini. Permintaan kelima
  dan seterusnya pasti menunggu giliran, seperti terlihat di uji beban 5 dan 8 orang.

---

## 6. Kondisi GPU dan apakah A10G menjadi penghambat

| Saat | GPU sibuk | Listrik rata / puncak | VRAM terpakai | Suhu maks | Clock SM |
|---|---:|---:|---:|---:|---:|
| Diam (sebelum mulai) | 0% | 62 / 62 W | 18.377 / 23.028 MiB | 41 °C | 1.710 MHz |
| 1 pengguna, prompt 540 | 100% | 228 / 241 W | 18.377 MiB | 67 °C | 1.710 MHz |
| 1 pengguna, prompt 2.110 | 100% | 233 / 268 W | 18.377 MiB | 68 °C | 1.710 MHz |
| 1 pengguna, prompt 4.168 | 100% | 236 / 280 W | 18.377 MiB | 70 °C | 1.710 MHz |
| 2 sekaligus | 96% | 211 W | 18.377 MiB | — | — |
| 4 sekaligus | 98% | 226 W | 18.377 MiB | — | — |

- **VRAM tetap 18,4 GB dari awal sampai akhir.** vLLM memesan 85% memori GPU sejak dinyalakan,
  untuk bobot model ditambah ruang memori kerja. Angka ini tidak naik-turun mengikuti beban, jadi
  tidak bisa dipakai untuk menilai seberapa penuh GPU. Ukuran yang tepat adalah memori kerja dari
  vLLM: paling tinggi 19% di benchmark ini, dan 50% di uji beban 8 orang dengan batas 4.
- **Tidak ada pelambatan karena panas atau listrik.** Clock tetap 1.710 MHz, suhu paling tinggi
  70 °C, dan listrik puncak 280 W masih di bawah batas 300 W.
- **"GPU sibuk 100%" tidak berarti GPU kewalahan.** Angka ini hanya menunjukkan GPU sedang bekerja.
  Saat satu permintaan berjalan pun angkanya sudah 100%, padahal menambah permintaan kedua sampai
  keempat masih menaikkan hasil 2,5 kali.

**Apakah A10G penghambat?** Jawabannya berbeda untuk dua hal:

| Yang dinilai | Penghambat? | Alasan |
|---|---|---|
| Kecepatan menulis **satu** jawaban (±50 token per detik) | **Ya, ini batas fisik kartu** | Saat menulis, setiap token baru mengharuskan GPU membaca seluruh bobot model (±9–10 GB) dari memorinya. Dengan kecepatan memori A10G sekitar 600 GB per detik, batas teoritisnya sekitar 60–65 token per detik. Hasil 53 token per detik sudah sekitar 80–85% dari batas itu. Ini perkiraan kasar, bukan hasil ukur |
| Jumlah jawaban yang bisa dikerjakan **bersamaan** | **Belum** | Paralel 4 masih naik 2,5×, memori kerja baru 19–50%, listrik dan suhu masih ada ruang. Yang membatasi jumlah bersamaan adalah setelan `max-num-seqs 4`, bukan GPU-nya |
| Mengolah prompt panjang | **Tidak, untuk Ratu AI** | ±2.200 token per detik tanpa cache, dan 87% prompt Ratu AI sudah ada di cache |

---

## 7. Perbandingan dengan uji beban Ratu AI

**Keduanya mengukur hal yang berbeda:**

| | Benchmark ini | Uji beban Ratu AI |
|---|---|---|
| Satu "permintaan" | Satu panggilan model | Satu pertanyaan pengguna = 2,7–5,5 panggilan model + pengambilan data + alat |
| Prompt | 540–4.170 token, cold atau warm terkendali | ±3.900–4.200 token per panggilan, sebagian besar dari cache |
| Jawaban | Tepat 128/256/512 token, tanpa mode berpikir | ±260–275 token per panggilan (P50), ditentukan model |
| Jalur | Langsung ke vLLM di server | Laptop → Cloudflare → LiteLLM → vLLM |
| Yang diukur | Kecepatan model | Waktu yang dirasakan pengguna |

**Angka benchmark menjelaskan angka uji beban dengan cukup baik.** Perhitungannya (perkiraan):
- **Satu panggilan Ratu AI saat sepi:** jeda awal ±0,1–0,3 detik (prompt dari cache), ditambah
  ±270 token × ±20 ms, totalnya ±5,5–6 detik. Hasil uji beban di 1–3 orang: **5,1–7,3 detik**.
- **Satu pertanyaan saat sepi:** 3–4 panggilan × ±5,5 detik, kira-kira 16–22 detik, ditambah waktu
  pengambilan data. Hasil uji beban di 1 orang: **16–34 detik**.
- **Satu panggilan di 8 orang, batas 4:** di uji beban butuh 15,4 detik. Kalau 4 permintaan berjalan
  bersamaan, menulis ±270 token makan ±6–8 detik (TPOT 22–29 ms). Sisanya, sekitar 6 detik, adalah
  waktu menunggu giliran. Ini sesuai dengan jeda sebelum kata pertama di uji beban: 6,1 detik.

Artinya, **waktu tunggu Ratu AI = (jumlah panggilan per pertanyaan) × (token per panggilan ÷ ±50
token per detik) + antrean.** GPU-nya bekerja secepat yang bisa dilakukan kartu ini. Yang membuat
jawaban terasa lama adalah banyaknya langkah, banyaknya token yang ditulis di tiap langkah, dan
antrean saat lebih dari 4 permintaan datang bersamaan.

**Perkiraan kapasitas kasar.** Dengan 4 permintaan sekaligus, GPU menghasilkan ±110 token per detik.
Satu pertanyaan Ratu AI menghasilkan sekitar 3,5 × 270 ≈ 950 token, jadi model yang terus penuh bisa
menyelesaikan sekitar **6–7 pertanyaan per menit**. Ini perkiraan, karena tidak menghitung pengambilan
data dan perbedaan antar jenis pertanyaan.

---

## 8. Rekomendasi

Urutan berikut berdasarkan dampak terhadap waktu tunggu pengguna dan biayanya.

| No | Area | Saran | Alasan dari data |
|---|---|---|---|
| 1 | **Ratu AI (agent)** | Kurangi jumlah panggilan model per pertanyaan, misalnya pertanyaan sederhana cukup satu alat lalu langsung menjawab | Setiap panggilan ±5,5 detik saat sepi. Pertanyaan dengan 4–5 panggilan otomatis butuh 20–30 detik, berapa pun kecepatan GPU-nya |
| 2 | **Ratu AI (agent)** | Periksa apakah mode berpikir (thinking) Qwen3 aktif di Ratu AI, dan apakah token "berpikir" ikut ditulis di setiap langkah | Setiap token jawaban ±20 ms. Benchmark ini memakai mode berpikir mati. Kalau di Ratu AI menyala, sebagian dari ±270 token per panggilan mungkin teks berpikir yang tidak dibaca pengguna |
| 3 | **Prompt** | Pertahankan instruksi dan daftar alat tetap sama dan di awal prompt; mempersingkatnya boleh, tetapi dampaknya kecil | Bagian yang ada di cache hanya menambah ±40 ms. Prompt baru 4.000 token menambah ±1,9 detik, jadi yang penting bagian awalnya tidak berubah-ubah |
| 4 | **Setelan vLLM** | `max-num-seqs 4` dipertahankan dulu. Kalau nanti pengguna bersamaan sering di atas 4, batas 5–6 bisa diuji dengan uji beban yang sama | Memori kerja paling tinggi 50% di 8 orang. Tetapi setiap permintaan tambahan memperlambat yang lain (TPOT 19 → 22–29 ms), jadi perlu diukur, bukan ditebak. Keputusan setelan ada di pengelola server |
| 5 | **Model** | Hanya kalau satu jawaban harus jauh lebih cepat: uji model yang lebih kecil, atau teknik seperti speculative decoding | Kecepatan menulis satu jawaban sudah dekat batas fisik A10G. Model lebih kecil berarti lebih sedikit bobot yang dibaca per token, tetapi ketepatannya harus diuji ulang |
| 6 | **Upgrade GPU** | **Belum perlu** untuk beban sekarang (sampai ±5–8 pengguna bersamaan) | GPU tidak kewalahan: paralel masih naik 2,5×, memori kerja ≤ 50%, tanpa pelambatan panas. Upgrade baru masuk akal kalau target kecepatan per jawaban jauh di atas ±50 token per detik, atau pengguna bersamaan jauh lebih banyak setelah saran 1–2 dijalankan |

Rekomendasi 6 sengaja tidak didasarkan pada angka "GPU sibuk 100%". Angka itu sudah 100% saat
satu permintaan berjalan, jadi tidak menunjukkan apakah GPU masih sanggup mengerjakan lebih banyak.

---

## 9. Batasan

- **Satu kali pengukuran**, dengan 5 pengulangan per kombinasi. Hasilnya sangat stabil (P95 ≈ P50),
  tetapi belum diulang di hari lain.
- **Prompt berupa teks umum yang sama** (bukan percakapan Ratu AI). Isi prompt hampir tidak
  memengaruhi kecepatan; yang berpengaruh adalah jumlah tokennya.
- **Panjang jawaban dipaksa** (`ignore_eos`). Di pemakaian nyata, model berhenti sendiri, jadi
  panjang jawabannya beragam.
- **Mode berpikir dimatikan** dan tanpa alat, sesuai tujuan mengukur kecepatan dasar.
- **Paralel hanya diuji di 1, 2, dan 4**, dengan satu panjang prompt (2.112 token, cold). Permintaan
  paralel dengan prompt dari cache akan mendapat TTFT yang jauh lebih kecil.
- **Batas teoritis A10G (±60–65 token per detik) adalah perkiraan kasar**, dihitung dari spesifikasi
  kecepatan memori kartu dan perkiraan ukuran bobot model, bukan diukur.
- Selama benchmark, server model hanya menerima permintaan dari benchmark ini (diperiksa dari
  `/metrics`: tidak ada permintaan lain yang berjalan atau menunggu).

**Berkas:**

| Berkas | Isi |
|---|---|
| `data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13.jsonl` | Data mentah: setiap permintaan, sampel GPU, dan sampel `/metrics` |
| `data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13.csv` | Satu baris per permintaan |
| `data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13-ringkasan.json` | Angka ringkas yang dipakai laporan dan grafik |
| `data/benchmark-inferensi-intinya.json` | Teks "Intinya" di grafik |
| `data/cadangan-grafik-uji-beban-sebelum-tab-model.html` | Halaman grafik sebelum tab Kecepatan model ditambahkan |
