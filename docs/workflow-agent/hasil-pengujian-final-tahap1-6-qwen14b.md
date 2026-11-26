# Hasil Pengujian Live Pasca-Optimasi (Tahap 1–6) — Qwen3-14B, 4× A10G, max-num-seqs 4

**Tanggal uji:** 24 Nov 2026, 07:54–08:45 UTC
**Data:** `data/agent-workflow-latency/2026-11-24-07-50-14b-post-optimization-seqs4/`
**Dashboard:**
- `docs/benchmark/grafik/hasil-pengujian.html`: menu "Qwen3-14B · pasca-optimasi", kartu teratas di Beranda.
- Versi berdiri sendiri: `docs/benchmark/grafik/hasil-pengujian-final-qwen14b.html`.
- Dibangun ulang dengan `python scripts/buat-dashboard-pasca-optimasi.py`, lalu `python scripts/buat-dashboard.py`.

> **Cakupan.** Atas keputusan pemilik proyek (24 Nov), uji langsung ke **T7 (benchmark konkurensi)** dengan pola yang sama seperti benchmark 20 & 23 Nov.
> - T0 (pre-flight) selesai.
> - T1 dihentikan sesudah 7 skenario (data parsial disimpan).
> - T2–T6 **belum dijalankan**.
>
> Bagian laporan yang bergantung pada T1–T6 ditandai *belum diuji*. Harness T2–T6 sudah siap (§21).

---

## 1. Executive Summary

Dengan konfigurasi inference yang **sama persis** (image vLLM, model, 4 replika, `max-num-seqs 4`, LiteLLM `simple-shuffle`), workflow agen pasca-optimasi pada 1–20 pengguna:

| | Sebelum optimasi (20 & 23 Nov) | Sesudah (24 Nov) |
|---|---:|---:|
| Pertanyaan terukur | 231 | 231 |
| **Lulus evaluator v2** | 207 (89,6%) | **218 (94,4%)** |
| **Gagal v2** | **19** | **2** |
| Sebagian v2 | 5 | 11 |
| Habis waktu / galat / kosong | 1 / 0 / 0 | **0 / 0 / 0** |
| Tiket tersimpan oleh uji | 0 | 0 |
| P95 latensi, 12 / 16 / 20 pengguna | 99,7 / 118,9 / 94,1 dtk | **79,1 / 90,6 / 98,0 dtk** |
| P99 latensi, 12 / 16 / 20 pengguna | 238,5 / 200,2 / 166,8 dtk | **100,6 / 99,2 / 100,0 dtk** |
| Panggilan LLM per workflow (rata-rata, 5–20 pengguna) | 3,7–4,9 | **3,4–3,6** |
| Waktu GPU semua tahap beban | 1.920 dtk ($4,24) | **1.439 dtk ($3,17)** |
| Biaya per workflow sukses | $0,0205 | **$0,0146 (−29%)** |

**Perbaikan per kegagalan RCA (beban 1–20 pengguna, ±29 skenario per jenis):**
- **Q4 (SOP):** gagal 5 → 1. Pilihan pertama perute ke agent pemegang SOP 18/22 (82%) → 28/29 (96,6%).
- **Q8 (sapaan):** gagal 6 → 0, efisien 21/29 → **29/29**, median 30,7 → **13,2 dtk**.
- **Q5 (tiket):** gagal 7 → 1. Tidak ada persetujuan karangan, putaran, rancangan ganda, klaim tersimpan, maupun timeout. Tetapi **11/30 hanya menawarkan tiket** (sebagian), padahal pengguna sudah meminta dibuatkan (§19).
- **Q1 (periode):** 29/29 angka & periode benar (dulu 28/29).
- **Q2, Q3, Q6, Q7:** tetap 100%, tanpa regresi.

**Yang belum tercapai / perlu dicatat:**
- 1 kegagalan Q4 menyesatkan: perute mengatakan kemampuan SOP "belum tersedia" padahal tersedia. Penyebabnya celah Tahap 3 (§19).
- Pengalihan otomatis Tahap 3 **tidak pernah terpicu**, karena pilihan pertama perute sudah benar di 28/29 Q4. Efektivitas pengalihannya belum terbukti live.
- Median latensi di 2 dan 10 pengguna sedikit lebih lambat daripada baseline.
- Pemakaian KV cache per replika tidak tercatat, karena server sudah dimatikan sebelum log vLLM diambil.

---

## 2. Konfigurasi pengujian

| Aspek | Nilai (diverifikasi saat uji) |
|---|---|
| Server | AWS g5.12xlarge, 4× NVIDIA A10G 23 GB |
| Model | `Qwen/Qwen3-14B-AWQ`, served `qwen3-14b`, 4 replika independen (port 8000–8003) |
| vLLM | image `390a656b54e1` (**sama dengan uji 23 Nov**), `--max-num-seqs 4 --max-model-len 16384 --gpu-memory-utilization 0.85 --quantization awq --tool-call-parser hermes --reasoning-parser qwen3` |
| LiteLLM | `routing_strategy: simple-shuffle`, `num_retries: 0` |
| Portal | model `mr-ai-gateway-4gpu` lewat Cloudflare Quick Tunnel (`AI_BASE_URL_2`) |
| Flag | `PENJAGA_ALUR` menyala, `RUTE_KEMAMPUAN` menyala, `JALUR_AGENT=konfigurasi` |
| Anthropic | diblokir di proses uji (`ANTHROPIC_BASE_URL` → port mati); tercatat `anthropic_diblokir: true` |
| Akun uji | sama dengan baseline; 5 agent beralat, 41 alat (Portal 10, Admin 10, MAPS 10, Marketing 7, Super Tools 5) |
| Workload | sama dengan baseline: pemanasan 8 (Q1–Q8), beban 1/2/3/5/8/10/12/16/20 pengguna × 3 pertanyaan, jeda 5 dtk antarpertanyaan, jeda 120 dtk antartahap, batas 300 dtk |
| Evaluator | v1 (kriteria lama) + v2 (`scripts/lib/evaluator-agent.mts`), **tidak diubah** |

Snapshot: `snapshot-konfigurasi.json` (versi paket, SHA-256 berkas kunci, flag) dan `snapshot-server.txt` (argumen container, config LiteLLM tanpa rahasia).

---

## 3. Hasil pre-flight (T0)

Semua lolos:
- **Server:** 6 container sehat, GPU menganggur (19,2/23 GB VRAM terisi oleh bobot).
- **vLLM:** keempat replika health 200, antrean 0, `max-num-seqs=4` di semua replika.
- **Gateway:** LiteLLM hidup, tabel `LiteLLM_SpendLogs` terbaca, tunnel & gateway menjawab.
- **Jalur agent:** `konfigurasi`.
- **Registri kemampuan akun uji:** tercatat di `T0-dryrun/registri-kemampuan.json`.

**Perubahan harness** (hanya `scripts/`; aplikasi tidak diubah; cadangan di `.cadangan/harness-live-2026-11-24/`):

| Berkas | Perubahan |
|---|---|
| `scripts/profil-alur-agent.mts` | `--folder`; `--set kontrol`; target progres berurutan = ulang × jumlah kode; event `info` mencatat `rute_kemampuan`, `anthropic_diblokir`, registri akun, harapan Agustus |
| `scripts/lib/skenario-kontrol.mts` | **baru**: 22 skenario kontrol T3 + kriteria (berbasis alat terpasang) |
| `scripts/uji-multigiliran.mts` | **baru**: 10 sesi multi-giliran T2, balasan adaptif dari pilihan yang ditampilkan |
| `scripts/uji-pembatalan-web.mts` | **baru**: emulasi browser menutup koneksi (T6/E4) |
| `scripts/analisis-uji-live.py`, `scripts/banding-pasca-optimasi.py` | **baru**: analisis & perbandingan |

---

## 4–9. Targeted, multi-turn, generalization, regression, A/B, cancellation

| Fase | Status |
|---|---|
| T1 terarah | Dihentikan sesudah 7 skenario (atas keputusan pemilik proyek): pemanasan Q1/Q4/Q5/Q8 + putaran 1 Q8/Q4/Q5. Q1 angka benar, Q4 `cari_sop`, Q8 langsung 10 dtk, Q5 penawaran. Data di `T1-terarah/` |
| T2–T6 | **Belum diuji** |

Indikasi fungsi Q1/Q4/Q5/Q8 di bawah beban tersedia dari T7 (§10–13), tetapi **bukan pengganti** uji terarah 20× dan A/B.

**Temuan statis T6:** `app/api/chat/route.ts:325` memanggil `streamText` tanpa `abortSignal`. Pembatalan saat browser ditutup belum diteruskan ke model. Ini tidak diubah, dan perlu diuji di T6.

---

## 10. Hasil concurrency benchmark (T7)

| Pengguna | n | v2 lulus / sebagian / gagal | v1 | Mean | P50 | P90 | P95 | P99 | Maks | TTFT P50 | LLM/wf | Tok masuk/wf | Tok keluar/wf |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3 | 3 / 0 / 0 | 3 | — | 14,1 | — | 22,8 | 22,8 | — | — | 2,7 | — | — |
| 2 | 6 | 6 / 0 / 0 | 5 | | 34,5 | | 48,4 | 48,5 | | 4,7 | 3,5 | 17.507 | 1.244 |
| 3 | 9 | 8 / 1 / 0 | 9 | | 32,7 | | 65,8 | 73,1 | | 5,9 | 3,4 | 16.336 | 1.398 |
| 5 | 15 | 15 / 0 / 0 | 13 | | 30,2 | | 69,1 | 82,4 | | 4,2 | 3,6 | 16.347 | 1.368 |
| 8 | 24 | 22 / 2 / 0 | 24 | | 31,1 | | 73,7 | 85,0 | | 5,0 | 3,4 | 15.229 | 1.285 |
| 10 | 30 | 28 / 2 / 0 | 29 | | 37,1 | | 68,5 | 82,1 | | 4,9 | 3,4 | 15.263 | 1.250 |
| 12 | 36 | 35 / 1 / 0 | 33 | | 36,9 | | 79,1 | 100,6 | | 4,9 | 3,5 | 16.146 | 1.302 |
| 16 | 48 | 46 / 1 / 1 | 43 | | 37,8 | | 90,6 | 99,2 | | 6,5 | 3,4 | 14.558 | 1.253 |
| 20 | 60 | 55 / 4 / 1 | 58 | | 48,8 | | 98,0 | 100,0 | | 7,6 | 3,4 | 14.958 | 1.267 |

Latensi dalam detik.
- Kolom yang kosong (mean, P90, maks) ada lengkap di `T7-konkurensi/banding.json` dan dashboard.
- TTFT = waktu sampai kata pertama yang **terlihat pengguna**.
- Token per workflow = rata-rata workflow yang seluruh panggilannya cocok dengan catatan LiteLLM.

**Pemanasan** (8 pertanyaan, dilaporkan terpisah): 8/8 v1, v2 7 lulus + 1 sebagian, P50 34,5 dtk, P95 69,7 dtk.

**Reliabilitas:**
- 231/231 selesai dengan teks.
- 0 habis waktu, 0 kosong, 0 galat.
- 0 tiket tersimpan; tidak ada operasi tulis.
- Alat yang dipanggil semuanya berhasil di pemanasan (6/6).

---

## 11. Perbandingan sebelum dan sesudah optimasi

| Pengguna | v2 gagal lama → baru | P50 lama → baru | P95 lama → baru | P99 lama → baru | LLM/wf lama → baru | wf sukses/menit lama → baru |
|---:|---|---|---|---|---|---|
| 1 | 0 → 0 | 23,6 → **14,1** | 26,6 → **22,8** | 26,9 → 22,8 | 2,7 → 2,7 | 2,5 → 3,1 |
| 2 | **2 → 0** | 32,5 → 34,5 | 54,3 → **48,4** | 58,4 → 48,5 | 3,3 → 3,5 | 1,8 → 2,9 |
| 3 | **1 → 0** | 36,1 → **32,7** | 87,2 → **65,8** | 89,9 → 73,1 | 4,1 → 3,4 | 2,9 → 3,2 |
| 5 | **1 → 0** | 33,2 → **30,2** | 56,3 → 69,1 | 63,3 → 82,4 | 3,7 → 3,6 | 5,9 → 5,4 |
| 8 | 0 → 0 | 35,5 → **31,1** | 67,7 → 73,7 | 68,7 → 85,0 | 3,8 → 3,4 | 8,1 → 7,7 |
| 10 | **3 → 0** | 32,7 → 37,1 | 79,9 → **68,5** | 91,6 → 82,1 | 3,6 → 3,4 | 9,1 → 9,2 |
| 12 | **2 → 0** | 42,7 → **36,9** | 99,7 → **79,1** | 238,5 → **100,6** | 4,9 → 3,5 | 5,5 → **10,6** |
| 16 | **5 → 1** | 42,5 → **37,8** | 118,9 → **90,6** | 200,2 → **99,2** | 4,4 → 3,4 | 6,6 → **14,8** |
| 20 | **5 → 1** | 53,9 → **48,8** | 94,1 → 98,0 | 166,8 → **100,0** | 3,9 → 3,4 | 10,2 → **16,4** |

Baseline: 1–8 pengguna = 20 Nov (`2026-11-20-07-30-4gpu`), 10–20 pengguna = 23 Nov (`2026-11-23-08-35-14b-seqs4-c10-20`). v2 untuk baseline diambil dari `evaluasi-v2/per-skenario.csv`.

**Per jenis pertanyaan (beban 1–20, v2):**

| Kode | Lama: lulus / sebagian / gagal | Baru: lulus / sebagian / gagal | Median lama (20N / 23N) → baru |
|---|---|---|---|
| Q1 Data penjualan | 28 / 0 / 1 | **29 / 0 / 0** | 31,3 / 39,9 → 35,0 |
| Q2 Peringatan dini | 28 / 0 / 0 | 28 / 0 / 0 | 65,1 / 82,9 → 84,0 |
| Q3 Stok kosong | 28 / 0 / 0 | 28 / 0 / 0 | 41,3 / 53,5 → 48,4 |
| Q4 SOP | 24 / 0 / **5** | **28 / 0 / 1** | 33,8 / 39,0 → 36,8 |
| Q5 Rancangan tiket | 18 / 5 / **7** | 18 / **11** / **1** | 26,8 / 54,2 → **25,8** |
| Q6 Data karyawan | 29 / 0 / 0 | 29 / 0 / 0 | 38,2 / 49,3 → 54,1 |
| Q7 Harus ditolak | 29 / 0 / 0 | 29 / 0 / 0 | 13,4 / 18,4 → 20,8 |
| Q8 Sapaan | 23 / 0 / **6** | **29 / 0 / 0** | 29,1 / 30,7 → **13,2** |

**Faktor yang memengaruhi keterbandingan:**
1. **Sama:** model, image vLLM, `max-num-seqs`, jumlah replika, LiteLLM, akun uji, workload & urutan (seed tetap), batas waktu.
2. **Evaluator:** v2 lahir sesudah baseline; data lama dinilai ulang dengan v2 dari bukti yang tercatat waktu itu.
   - Sebagian bukti lama tidak tercatat (mis. jawaban 20 Nov), jadi v2 lama bisa sedikit berbeda dari v2 seandainya dinilai saat uji.
   - **v1 turun 220 → 217** karena kriteria lama Q5 hanya mengenali kata "LAN/WIRELESS/sub-kategori/menyiapkan tiket". Sejak Tahap 6 agent menanyakan **kategori** dengan daftar sah dari database (13 kasus), dan v1 menganggapnya gagal, padahal v2 menilainya klarifikasi yang benar.
3. **Pembatalan saat habis waktu** menyala di uji baru (tidak di baseline). Tidak ada yang habis waktu, jadi **tidak memengaruhi** angka ini.
4. **Durasi tahap** = jam dinding sampai pertanyaan terakhir selesai. P99 baseline pada 12–20 pengguna yang 166–238 dtk memperpanjang tahapnya. Throughput per menit baru yang hampir 2× di 12–16 pengguna terutama berasal dari hilangnya ekor panjang ini, bukan GPU yang lebih cepat.
5. **Pencatatan delegasi** baru ada sejak 24 Nov. Kolom delegasi baseline = 0 bukan berarti tanpa delegasi.
6. **Setelan agent/tool di Kelola AI** bisa berubah antar-hari (tabel dibagi tim lain). Jumlah alat akun uji hari ini cocok dengan yang tercatat di RCA 23 Nov (Portal 10, Super Tools 5, Marketing 7).
7. **Satu kali jalan per kondisi.** Sampel per tahap kecil (3–60). Selisih di 1–8 pengguna masih dalam ragam antar-jalan.
8. **Kondisi database** bisa berbeda (data penjualan & tiket bertambah). Q1 tetap 156.770 unit di kedua uji.

---

## 12. Routing accuracy (Q4, beban 1–20)

| Metrik | Nilai | Target |
|---|---:|---:|
| Pilihan pertama model ke pemegang SOP (Portal/Admin) | **28/29 (96,6%)**; baseline 23 Nov 18/22 (82%), 4× ke Super Tools | — |
| Agent efektif = pemegang SOP | **28/29 (96,6%)** | ≥ 95% ✅ |
| Pengalihan otomatis Tahap 3 | 0 (tidak dibutuhkan; tidak ada pilihan Super Tools) | — |
| Agent tidak relevan dieksekusi | **0** | 0 ✅ |
| `cari_sop` dipanggil | 28/29 (96,6%) | ≥ 98% ❌ (1 kasus) |
| Jawaban akhir lulus v2 | 28/29 (96,6%) | — |
| Fallback berputar (`batas-fallback`) | 0 | 0 ✅ |

Satu-satunya kegagalan (tahap 16, `384ac9d8`) dibahas di §19.

---

## 13. Agent orchestration metrics (beban 1–20, 231 workflow)

| Metrik | Nilai |
|---|---|
| Panggilan LLM per workflow | 3,42 rata-rata (perute ±1,75, agent bawahan ±1,7). Q8 = 1, Q7 = 3, lainnya ±4 |
| Delegasi aktual per workflow | 0,87 (Q8 tidak pernah didelegasikan) |
| Delegasi ditolak penjaga | 1 (`agent-tidak-tersedia`) |
| Penolakan alat oleh penjaga | 9× `menunggu-pengguna` (agent mencoba memilih sub-kategori sendiri sesudah alat meminta pilihan pengguna) |
| Sub-kategori karangan dikosongkan (Tahap 6) | 4 workflow |
| Alur berhenti menunggu pengguna (HITL) | 30 (Q5: 19 klarifikasi, 11 tawaran) |
| Penolakan periode (Tahap 4) | 0. Model selalu mengirim periode untuk Q1 (29/29 `dari=2026-09`) |
| Sapaan ditolak penjaga (Tahap 5) | 0. Perute tidak pernah mencoba mendelegasikan sapaan |
| Persetujuan karangan / delegasi berulang / alat berulang | 0 / 0 / 0 |
| Rancangan ganda / klaim tersimpan palsu / pesan internal / teks alat bocor | 0 / 0 / 0 / 0 |
| False positive penjaga (terlihat) | 0. Penolakan `agent-tidak-tersedia` benar (Approval tanpa alat) |
| False negative penjaga (terlihat) | 1. Penolakan itu tidak menyarankan pemegang SOP, sehingga jawaban akhir menyesatkan (§19) |

---

## 14. Token consumption

- Token per workflow relatif tetap di semua tingkat konkurensi: masuk ±14.600–17.500, keluar ±1.250–1.400.
- Dibanding baseline 10–20 pengguna, rata-rata masuk turun dari ±15.000–23.000 menjadi ±14.600–16.100, dan keluar dari ±1.370–1.980 menjadi ±1.250–1.300.
  - Penyebab terbesarnya adalah panggilan LLM per workflow yang turun (mis. 12 pengguna 4,9 → 3,5).
  - Prompt perute bertambah ±460 token per panggilan (aturan Tahap 3), dan itu tertutup oleh panggilan yang hilang.
- Pencocokan token ke LiteLLM: 719/816 panggilan (88%). Baseline 23 Nov 736/762 (97%). Token per workflow hanya dihitung dari workflow yang seluruh panggilannya cocok.

---

## 15. Latency dan TTFT

- **P50** tetap 30–38 dtk sampai 16 pengguna. Pada 20 pengguna naik ke 48,8 dtk, karena antrean vLLM mulai memanjang (§16).
- **Ekor:** P99 tertahan di ±100 dtk pada 12–20 pengguna; baseline 167–239 dtk. Ini perbaikan paling jelas, datang dari hilangnya putaran Q5/Q4 dan sapaan yang didelegasikan.
- **TTFT terlihat pengguna** P50 4–8 dtk (naik dengan beban).
- **TTFT di vLLM** (rata-rata per permintaan): 0,12 dtk (1 pengguna) → 3,4 dtk (20 pengguna).
- **Per jenis:**
  - Q8 sapaan kini **13 dtk** (dulu ±30), karena tanpa delegasi dan cukup 1 panggilan.
  - Q5 25,8 dtk (23 Nov 54,2).
  - Q2 (±84 dtk) dan Q6 (±54 dtk) tetap yang paling lama. Keduanya tidak disentuh optimasi; Q6 sedikit lebih lambat daripada baseline 23 Nov (49,3), masih dalam ragam.

---

## 16. GPU utilization dan queue

| Pengguna | Util GPU rata-rata (%) | Antrean vLLM per permintaan | TTFT vLLM | Preemption | Prefix-cache hit |
|---:|---:|---:|---:|---:|---:|
| 1 | 17 | 0 ms | 0,12 dtk | 0 | 96% |
| 5 | 49 | 0 ms | 0,32 dtk | 0 | 89% |
| 8 | 67 | 0 ms | 0,32 dtk | 0 | 90% |
| 10 | 66 | 0,60 dtk | 0,94 dtk | 0 | 89% |
| 12 | 74 | 0,33 dtk | 0,69 dtk | 0 | 89% |
| 16 | 86 | 1,25 dtk | 1,60 dtk | 0 | 90% |
| 20 | 89 | 2,99 dtk | 3,36 dtk | 0 | 89% |

**Dibanding baseline:**
- Antrean pada 16 dan 20 pengguna turun dari 2,36 menjadi 1,25 dtk dan dari 3,40 menjadi 2,99 dtk.
- Utilisasi GPU lebih tinggi pada 12–20 pengguna (74–89% vs 56–66%), karena tahapnya lebih padat: kerja yang sama dalam waktu lebih pendek.
- Preemption 0 di semua tahap.
- Sebaran permintaan antar-4 replika merata (simple-shuffle). Rinciannya per tahap ada di `banding.json` → `replika`.

**Keterbatasan:** pemakaian KV cache, request berjalan/menunggu per detik, dan throughput token per detik dari log vLLM **tidak tercatat**. Instance sudah tidak terjangkau saat log hendak diambil. Untuk uji 23 Nov, KV cache tertinggi 44%.

---

## 17. Workflow throughput

| Pengguna | 1 | 2 | 3 | 5 | 8 | 10 | 12 | 16 | 20 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Workflow/menit | 3,1 | 2,9 | 3,6 | 5,4 | 8,4 | 9,9 | 11,0 | 15,4 | 17,9 |
| Workflow sukses (v2 lulus)/menit | 3,1 | 2,9 | 3,2 | 5,4 | 7,7 | 9,2 | 10,6 | 14,8 | 16,4 |
| Baseline sukses/menit | 2,5 | 1,8 | 2,9 | 5,9 | 8,1 | 9,1 | 5,5 | 6,6 | 10,2 |

Throughput ini dibatasi desain uji (3 pertanyaan per pengguna, jeda 5 dtk), bukan kapasitas maksimum.

---

## 18. Cost analysis

Tarif yang dipakai: **$7,94 per jam** (tarif yang sama dengan laporan sebelumnya; cek ulang terhadap tagihan AWS aktual).

| | Baseline | Baru |
|---|---:|---:|
| Waktu tahap beban 1–20 pengguna | 1.920 dtk | 1.439 dtk |
| Biaya tahap beban | $4,24 | $3,17 |
| Biaya per workflow dicoba | $0,0184 | $0,0137 |
| **Biaya per workflow sukses** | **$0,0205** | **$0,0146** |
| Biaya per workflow sukses, 20 pengguna | $0,0130 | $0,0081 |

Seluruh sesi T7 (pemanasan + jeda antartahap + beban) memakan ±50 menit instance, ±$6,6. Ditambah pre-flight dan T1 parsial, totalnya ±$8.

---

## 19. Failure analysis

**F1 — Q4, beban 16, trace `384ac9d8` (gagal v2; output menyesatkan)**

| | |
|---|---|
| Expected | Delegasi ke pemegang `cari_sop` → jawaban dari SOP |
| Actual | Perute `delegate_task {"task":"Bagaimana prosedur pengajuan cuti?","targetAgents":["Ratu AI Approval"]}`. Approval tercantum di daftar perute tetapi **tidak punya alat terpasang** untuk akun uji. Penjaga Tahap 3 menolak (`agent-tidak-tersedia`, dengan `agent_tersedia`). Perute lalu menjawab sendiri: kemampuan cari SOP "belum tersedia untuk akun ini… Agent yang diperlukan (Ratu AI Approval) tidak dapat diakses" |
| Bukti | `argumen-alat.jsonl`, `penjaga.ditolak`, `jawaban.jsonl` |
| Akar masalah | (1) **Capability routing:** cabang `agent-tidak-tersedia` di `periksaKemampuan()` berhenti sebelum penilaian kemampuan, jadi tidak ada pengalihan ke pemegang SOP maupun `saran_agent` (padahal kebutuhan "dokumen" jelas dan Portal/Admin tersedia). (2) **Model:** menyimpulkan "tidak tersedia" dari penolakan, walau aturan perute melarang menyimpulkan tanpa bertanya ke agent yang mampu. (3) **Konfigurasi:** agent tanpa alat (Approval, CMOD, Report) tetap tercantum di daftar perute |
| Kelas | Capability routing + model |
| Keyakinan | CONFIRMED |
| Usulan (perlu persetujuan) | Saat target tidak tersedia dan kebutuhan "dokumen" jelas, alihkan ke pemegang dokumen (sama seperti `tidak-cocok`); untuk kebutuhan lain sertakan `saran_agent`. Uji offline sudah ada polanya (F1/F2c) |

**F2 — Q5, beban 20, trace `7ca99286` (gagal v2 "lain"; dinilai salah oleh evaluator)**
- Agent memanggil `siapkan_tiket {"kategori":"Jaringan","sub_kategori":"Akses Internet",…}`. Alat menolak kategori yang tidak dikenal, lalu agent bertanya "Apakah Anda ingin menggunakan kategori **NETWORK**?" sambil menampilkan daftar kategori yang sah.
- **Perilakunya benar** (klarifikasi dengan pilihan dari database). Evaluator v2 tidak mengenalinya, karena "Pilihan kategori…" tidak cocok dengan pola `pilih|memilih` dan "menggunakan" tidak ada di pola tawaran.
- Kelas: Evaluator · Keyakinan: CONFIRMED.
- Evaluator **tidak diubah**. Kalau dihitung manual, Q5 menjadi 19 lulus / 11 sebagian / 0 gagal.

**F3 — Q5 "sebagian", 11 dari 30 (bukan gagal, tetapi di bawah harapan)**
- Pola tunggal: Portal memanggil `cari_sop`, tidak menemukan panduan, lalu **menawarkan** tiket ("Apakah Anda ingin saya menyiapkan tiket helpdesk?"). Penjaga menghentikan alur dengan benar untuk menunggu jawaban pengguna (HITL).
- Pengguna sebenarnya sudah meminta "Buatkan tiket", jadi satu giliran terbuang.
- Akar masalah: **Model + instruksi agent.** Aturan "panduan dulu sebelum tiket" di `agent-konfig.ts` (`ATURAN_SOP_SEBELUM_TIKET`) mengizinkan tiket langsung bila pengguna memintanya, tetapi model memilih menawarkan. Baseline: 5 sebagian (+7 gagal yang kini hilang).
- Bukan kegagalan material: tidak ada persetujuan karangan, tidak ada tiket tersimpan, tidak ada klaim palsu.
- Keyakinan: CONFIRMED pada pola; penyebab di model: LIKELY.

**Kegagalan material** (klaim palsu, pelanggaran hak akses, duplikasi operasi): **tidak ditemukan**. F1 tergolong output menyesatkan, 1 dari 231.

---

## 20. Risiko dan keterbatasan

1. **T1–T6 belum diuji.**
   - T1–T4: akurasi terarah 20×, multi-giliran, generalisasi, dan regresi berurutan.
   - T5: kontribusi tiap mekanisme (A/B).
   - T6: pembatalan end-to-end, termasuk jalur web yang belum meneruskan `req.signal`.
2. **Satu kali jalan per tingkat konkurensi**, sampel kecil di 1–8 pengguna.
3. **Pengalihan Tahap 3 belum teruji live**, karena model tidak pernah memilih Super Tools untuk Q4 di uji ini.
4. **Pemakaian KV cache / log vLLM** tidak tercatat (§16).
5. **Pencocokan token ke LiteLLM 88%** (lebih rendah dari 97% pada 23 Nov), sehingga token per workflow dihitung dari subset.
6. **v1 vs v2 berbeda arah untuk Q5** (§11). Kesimpulan akurasi sebaiknya memakai v2.
7. **Hasil bergantung pada setelan Kelola AI hari itu** (agent/alat bisa berubah tanpa pemberitahuan).
8. **Tarif biaya** memakai angka laporan sebelumnya, bukan tagihan aktual.

---

## 21. Rekomendasi berikutnya

1. **Perbaikan F1** (cabang `agent-tidak-tersedia` ikut mengalihkan/menyarankan pemegang kemampuan) + uji offline. *Perlu persetujuan.*
2. **Q5 penawaran vs langsung rancangan:** tinjau aturan perute/agent supaya permintaan eksplisit "buatkan tiket" langsung ke `siapkan_tiket`. *Perlu persetujuan; ukur dampaknya dengan A/B.*
3. **Jalankan T1 (80) dan T5 A/B (60)** untuk memisahkan kontribusi Tahap 3 dari penjaga lain. Harness siap.
   - T1: `profil-alur-agent.mts --fase pemanasan,berurutan --kode Q1,Q4,Q5,Q8 --ulang 20`
   - T5: tambahkan `RUTE_KEMAMPUAN=mati` / `PENJAGA_ALUR=mati` per proses.
4. **T2 dan T3:**
   - T2: `npx tsx --env-file=.env.local scripts/uji-multigiliran.mts --model mr-ai-gateway-4gpu --folder <dir>`
   - T3: `profil-alur-agent.mts --set kontrol --fase berurutan --ulang 2`
5. **T6 pembatalan:** `--kode Q5 --ulang 3 --timeout 12` dengan pencuplik `/metrics`, plus `scripts/uji-pembatalan-web.mts`. Kalau jalur web terbukti tidak berhenti, ajukan perubahan "teruskan `req.signal`".
6. Ambil log vLLM (`docker logs … | grep 'KV cache usage'`) **sebelum** instance dimatikan pada uji berikutnya.
7. Pertimbangkan menyembunyikan agent tanpa alat dari daftar perute, atau menandainya lebih tegas. Ini terkait F1.

---

## 22. Kesimpulan kelayakan sebelum pengujian max-num-seqs=8

Pada konfigurasi inference yang sama (`max-num-seqs 4`), perbaikan software Tahap 1–6:
- **menghilangkan hampir semua kegagalan workflow:** v2 gagal 19 → 2, termasuk Q8 6 → 0, Q5 7 → 1, Q4 5 → 1;
- **memangkas ekor latensi:** P99 di 12–20 pengguna dari 167–239 dtk menjadi ±100 dtk;
- **menurunkan panggilan LLM per workflow** (3,7–4,9 → 3,4–3,6) dan biaya per workflow sukses (−29%);
- tanpa regresi di Q2, Q3, Q6, Q7, dan tanpa kegagalan material.

Batasnya sekarang adalah **antrean GPU**: TTFT vLLM 3,4 dtk dan P50 48,8 dtk pada 20 pengguna, utilisasi 89%, sementara akurasi tetap terjaga. Inilah area yang relevan untuk `max-num-seqs=8`.

**Layak dilanjutkan ke uji max-num-seqs=8, dengan dua syarat:**
1. dibandingkan terhadap hasil 24 Nov ini sebagai baseline baru, dengan workload yang sama;
2. F1 diputuskan dulu (diperbaiki atau diterima sebagai risiko), dan T5/T6 dijalankan kalau kontribusi per mekanisme dan pembatalan perlu dibuktikan sebelum perubahan inference.

Prosedurnya ada di `docs/benchmark/prosedur-max-num-seqs-8.md`. Konfigurasi max-num-seqs **tidak diubah** dalam uji ini.
