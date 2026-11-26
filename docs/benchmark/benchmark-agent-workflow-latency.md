# Agent Workflow Latency Profiling — Ratu AI (Qwen3-14B)

**Tanggal uji:** 17 November 2026, 10.11–11.08 WIB
**Dashboard:** `docs/benchmark/grafik/grafik-agent-workflow-latency.html` (offline, tanpa CDN)
**Data mentah:** `data/agent-workflow-latency/2026-11-17-03-11/` (tidak ikut Git)
**Skrip:** `scripts/profil-alur-agent.mts` (pengukur), `scripts/olah-alur-agent.py` (pengolah + dashboard)
**Laporan sebelumnya:** profil 16 Nov (40 berurutan + 5 pengguna) disimpan utuh di `docs/benchmark/benchmark-agent-workflow-latency-16-nov.md`

---

## 1. Ringkasan

**Percobaan: 97 dari 97 dijalankan.**

| Tahap | Pertanyaan | Terjawab | Sesuai kriteria | Waktu habis | P50 | P95 | Panggilan model / pertanyaan |
|---|---:|---:|---:|---:|---:|---:|---:|
| Berurutan (baseline) | 40 | 40 | 39 | 0 | **29,3 dtk** | 58,3 dtk | 3,7 (1–7) |
| 1 pengguna | 3 | 3 | 3 | 0 | 24,6 dtk | 29,0 dtk | 3,3 |
| 2 pengguna | 6 | 6 | 6 | 0 | 31,6 dtk | 70,7 dtk | 4,2 |
| 3 pengguna | 9 | 9 | 9 | 0 | 34,5 dtk | 67,9 dtk | 3,6 |
| 5 pengguna | 15 | 15 | 15 | 0 | 50,5 dtk | 92,5 dtk | 4,1 |
| 8 pengguna | 24 | 23 | 22 | 1 | **73,3 dtk** | 115,9 dtk | 4,7 (1–27) |
| **Total** | **97** | **96** | **94** | **1** | | | |

Pemanasan (8 pertanyaan) dijalankan terpisah dan tidak ikut statistik. Tiket tersimpan: **0**. Preemption vLLM: **0**. Galat panggilan model atau retry HTTP: **0**.

**Penghambat terbesar, dari waktu eksklusif tanpa hitungan ganda (bagian 6):**

| # | Saat sepi (baseline) | Saat 8 pengguna |
|---:|---|---|
| 1 | **Model berpikir: 16,1 dtk (52%)** | **Menunggu token pertama, yaitu antrean vLLM: 30,8 dtk (41%)** |
| 2 | Model menulis teks: 11,5 dtk (37%) | Model berpikir: 25,2 dtk (33%) |
| 3 | Menunggu token pertama: 1,7 dtk (6%) | Model menulis teks: 16,8 dtk (22%) |
| — | Alat + query DB + embedding: **0,26 dtk (0,8%)** | Alat + query DB + embedding: 0,26 dtk (0,3%) |
| — | Persiapan agent: 0,28 dtk (0,9%) | Persiapan agent: 0,30 dtk (0,4%) |

Kesimpulan:
1. **Hampir semua waktu ada di model** (98% saat sepi). Lebih dari separuhnya adalah token berpikir yang tidak dibaca pengguna. Alat, database, retrieval SOP, dan kerangka agent bukan penghambat.
2. **Saat ramai, yang tumbuh adalah antrean, bukan kerja model.** Di 8 pengguna, antre di vLLM rata-rata 6,2 dtk per panggilan, dan satu pertanyaan memicu 4–5 panggilan berurutan. Decode per panggilan hanya naik dari 7,7 ke 9,8 dtk.
3. **Rute Q5 (tiket) tidak stabil.** Satu pertanyaan habis waktu karena perute menyerahkan ke agent Portal 7 kali (27 panggilan model), dan agent tetap bekerja setelah klien berhenti menunggu.

**Satu rekomendasi yang paling berpengaruh untuk diuji berikutnya:** matikan atau batasi mode berpikir Qwen3 pada panggilan yang hanya memilih agent atau alat, lalu ukur ulang dengan skrip yang sama, termasuk ketepatannya (bagian 10).

---

## 2. Arsitektur yang diukur

Diperiksa dari kode, bukan ditebak:

```
siapkanAgent()                     voltagent/jalur-agent.ts — akses + setelan agent/alat dari PostgreSQL
└─ Ratu AI Umum (perute)           LLM: berpikir → delegate_task
   └─ agent aplikasi               voltagent/agent-konfig.ts (Marketing / Portal / Admin / Super Tools)
      ├─ LLM: berpikir → memilih alat
      ├─ alat                      voltagent/tool-konfigurasi.ts
      │  ├─ query PostgreSQL       lib/db-perusahaan.ts
      │  └─ embedding SOP          voltagent/embedding.ts (model e5 di laptop) — hanya cari_sop
      └─ LLM: berpikir → menyusun hasil
└─ perute                          LLM: berpikir → menulis jawaban akhir (stream ke pengguna)
Setiap LLM: fetch → lib/gateway-fetch.ts → tunnel Cloudflare → LiteLLM → vLLM (EC2, A10G)
```

- Pertanyaan data: 4 panggilan model berurutan.
- Penolakan (Q7): 3 panggilan.
- Sapaan (Q8): 1–3 panggilan; kadang dijawab langsung oleh perute.
- Q4 dan Q5 kadang 5–7 panggilan karena alat tambahan atau delegasi kedua.
- Konfigurasi server tidak diubah: `--max-num-seqs 4`, `--max-model-len 16384`, `--gpu-memory-utilization 0.85`, parser `hermes` / `qwen3`.

---

## 3. Instrumentasi

### Modul `lib/profil-agent.ts` (baru), bawaan MATI

| Flag | Fungsi |
|---|---|
| `AGENT_PROFILING_ENABLED=1` | Nyalakan |
| `AGENT_PROFILING_FILE=<berkas.jsonl>` | Tujuan span (bawaan: `console.info`) |

- Setiap span mencatat `trace`, `span`, `parent`, `jenis`, `nama`, `status`, jam dinding mulai, dan durasi dari **jam monotonic** (`performance.now()`).
- Konteks trace dibawa `AsyncLocalStorage`, sehingga span dari agent bawahan, alat, dan query tercatat di pertanyaan yang benar, juga saat 8 pengguna bertanya bersamaan.
- Panggilan model: stream disalin (`tee`), dan salinan untuk aplikasi diteruskan apa adanya. Yang dicatat hanya waktu dan **jenis** potongan (berpikir / rencana alat / teks), jumlahnya, nama alat yang direncanakan, dan `finish_reason`.
- **Tidak dicatat:** isi prompt dan jawaban, argumen alat, teks SQL, hasil query, isi dokumen, data karyawan, header, dan kunci.

### Titik pasang (masing-masing 1–10 baris)

| Berkas | Span | Saat flag mati |
|---|---|---|
| `lib/gateway-fetch.ts` | `llm`, per percobaan HTTP | pembungkus langsung memanggil `fetch` asli |
| `voltagent/tool-konfigurasi.ts` | `alat` | `execute` tidak disentuh sama sekali |
| `voltagent/embedding.ts` | `embedding` | `rentang()` langsung memanggil isi fungsi |
| `lib/db-perusahaan.ts` | `db`, durasi saja | `pool.query` tidak disentuh |
| `scripts/profil-alur-agent.mts` | `permintaan`, `persiapan`, `delegasi` (dari event stream tingkat atas) | — |

### Overhead (diukur, 20.000 panggilan)

| Kondisi | Per panggilan |
|---|---:|
| Tanpa pembungkus | 0,13 µs |
| Pembungkus, flag mati | 1,4 µs |
| Pembungkus, flag menyala | 12 µs per span (penulisan berkas tertunda 250 ms) |

Uji lama tetap lolos dengan flag mati maupun menyala: `test:gateway-retry` 22/22, `test:tool-konfig` 54/54, `test:kb-beda` (pencarian SOP 7/9, sama seperti sebelumnya). Prompt, rute, alat, sampling, dan respons ke klien tidak berubah.

---

## 4. Metodologi

| Hal | Isi |
|---|---|
| Health check sebelum mulai | vLLM `/health` 200 dan antrean kosong; LiteLLM `/models` OK; jalur agent `konfigurasi`. Kalau gagal, uji tidak dimulai |
| Pemanasan | 8 pertanyaan (Q1–Q8 sekali), dicatat terpisah, tidak ikut statistik |
| Baseline berurutan | 8 pertanyaan × 5 kali, satu per satu, urutan diacak (seed tetap), jeda 5 dtk, percakapan baru per pertanyaan |
| Tahap beban | 1, 2, 3, 5, 8 pengguna bersamaan. Masing-masing 3 pertanyaan berurutan (jeda 5 dtk), pola sama dengan `scripts/uji-beban.mts`: titik awal acak (seed 1000×n), lalu bergiliran |
| Jeda antar tahap | 120 dtk, lalu menunggu antrean vLLM kosong sebelum tahap berikutnya |
| Batas waktu | 300 dtk per pertanyaan. Waktu habis tetap dicatat sebagai hasil |
| Tiket | Hanya rancangan. Jumlah tiket di database sebelum dan sesudah: +0 |
| Sumber pendukung (hanya membaca) | Catatan LiteLLM (kolom waktu/token/status), histogram & log statistik vLLM lewat SSH, `nvidia-smi` setiap 0,5 dtk |

**Sebaran pertanyaan per tahap tidak seimbang.** Ini memang sifat pola skrip lama, bukan dipilih:

| Tahap | Pertanyaan yang muncul |
|---|---|
| 1 pengguna | Q1, Q7, Q8 |
| 2 pengguna | Q1, Q2, Q3, Q4, Q5, Q8 (tanpa Q6, Q7) |
| 3 pengguna | semua, Q6 dua kali |
| 5 pengguna | semua, Q8 sekali |
| 8 pengguna | semua, masing-masing 3 kali |

Karena itu, angka tahap 1 dan 2 dipengaruhi jenis pertanyaannya. Tahap 1 berisi pertanyaan ringan, sehingga lebih cepat daripada baseline.

**Sanity check, semua lolos:**
- durasi tidak negatif;
- span anak selesai sebelum induk;
- pecahan eksklusif = total (selisih < 1 ms);
- semua panggilan model punya trace;
- 419 dari 419 panggilan cocok dengan catatan LiteLLM;
- jumlah pertanyaan per tahap sesuai (40 / 3 / 6 / 9 / 15 / 24);
- status sesuai galat;
- tiket +0;
- preemption 0.

Satu catatan: 4 span alat dan delegasi dari Q5 yang habis waktu selesai **setelah** pertanyaan dinyatakan habis. Agent memang tetap bekerja di latar (bagian 8).

---

## 5. Statistik per skenario (baseline berurutan, n=5 per pertanyaan)

| Pertanyaan | Benar | P50 | P95 | Min–maks | Panggilan model | Token masuk | Token keluar |
|---|---:|---:|---:|---:|---:|---:|---:|
| Q1 Data penjualan | 5 | 27,9 | 29,9 | 23,8–29,9 | 4 | 16.500 | 1.238 |
| Q2 Peringatan dini | 5 | 51,3 | 66,2 | 42,3–66,2 | 4 | 19.082 | 2.330 |
| Q3 Stok kosong | 5 | 37,9 | 46,4 | 33,1–46,4 | 4 | 17.820 | 1.718 |
| Q4 SOP | 4 | 29,3 | 62,1 | 12,6–62,1 | 4,4 (3–7) | 18.662 | 1.441 |
| Q5 Rancangan tiket | 5 | 22,3 | 39,9 | 18,3–39,9 | 4,6 (4–7) | 20.805 | 1.056 |
| Q6 Data karyawan | 5 | 35,0 | 39,4 | 26,7–39,4 | 4 | 15.491 | 1.513 |
| Q7 Harus ditolak | 5 | 12,2 | 13,3 | 11,7–13,3 | 3 | 9.965 | 559 |
| Q8 Sapaan | 5 | 22,0 | 46,4 | 15,8–46,4 | 1,8 (1–3) | 6.395 | 1.288 |

Waktu dalam detik. Token dari catatan LiteLLM: jumlah semua panggilan per pertanyaan, dirata-rata dari 5 ulangan. Statistik tiap tahap beban ada di dashboard (view *Per skenario*).

**Setiap jenis panggilan model** (baseline, waktu tengah):

| Jenis | n | Lama | Berpikir | Token keluar | ≈ porsi berpikir | TTFT klien | TTFT LiteLLM |
|---|---:|---:|---:|---:|---:|---:|---:|
| Perute: memilih agent | 37 | 3,9 dtk | 2,5 dtk | 184 | 80% | 237 ms | 49 ms |
| Marketing: memilih alat | 15 | 4,8 dtk | 3,5 dtk | 221 | 86% | 253 ms | 56 ms |
| Portal: memilih alat | 10 | 5,9 dtk | 4,8 dtk | 272 | 89% | 243 ms | 57 ms |
| Admin: memilih alat | 5 | 3,2 dtk | 2,4 dtk | 146 | 92% | 235 ms | 53 ms |
| Marketing: menyusun hasil | 15 | 18,9 dtk | 6,7 dtk | 833 | 40% | 1.039 ms | 842 ms |
| Portal: menyusun hasil | 10 | 6,3 dtk | 3,7 dtk | 240 | 66% | 1.195 ms | 990 ms |
| **Perute: jawaban akhir** | 37 | **7,5 dtk** | 3,1 dtk | 355 | 51% | 384 ms | 175 ms |
| Perute: menjawab langsung (sapaan) | 3 | 17,1 dtk | 12,0 dtk | 840 | 80% | 230 ms | 49 ms |

"≈ porsi berpikir" adalah perkiraan dari jumlah potongan stream berjenis berpikir, bukan hitungan tokenizer.

---

## 6. Ke mana waktunya habis: waktu eksklusif per tahap

Satu pertanyaan dipotong di setiap batas span. Setiap potongan waktu diberikan ke **satu** bagian, yaitu yang paling spesifik dari span yang sedang aktif. Urutan prioritasnya: embedding > query DB di alat > alat > model (tunggu / berpikir / rencana / menulis / ekor) > persiapan > orkestrasi > lain. Dengan cara ini tidak ada waktu yang terhitung dua kali, dan jumlah semua bagian sama dengan waktu jawab.

Rata-rata detik per pertanyaan:

| Bagian | Baseline | 1 | 2 | 3 | 5 | 8 |
|---|---:|---:|---:|---:|---:|---:|
| Model: menunggu token pertama | 1,7 | 1,1 | 2,1 | 1,8 | 7,3 | **30,8** |
| Model: berpikir | **16,1** | 14,2 | 23,3 | 16,7 | 24,7 | 25,2 |
| Model: rencana alat | 1,2 | 0,9 | 1,6 | 1,2 | 1,5 | 2,0 |
| Model: menulis teks + ekor | 11,5 | 5,2 | 14,8 | 16,2 | 18,3 | 16,8 |
| Alat + query DB + embedding | 0,26 | 0,10 | 0,27 | 0,16 | 0,18 | 0,26 |
| Persiapan agent | 0,28 | 0,22 | 0,19 | 0,29 | 0,20 | 0,30 |
| Orkestrasi + kerangka agent | 0,08 | 0,07 | 0,07 | 0,12 | 0,06 | 0,10 |
| **Rata-rata waktu jawab** | **31,1** | 21,8 | 42,3 | 36,3 | 52,2 | **75,4** |

**Perubahan dibanding baseline (P50):** 1 pengguna −16%, 2 pengguna +8%, 3 pengguna +18%, 5 pengguna +72%, 8 pengguna +150%.

**vLLM per tahap** (histogram, rata-rata per panggilan) **dan GPU:**

| Tahap | Panggilan | Antre | Prefill | Decode | Prefix cache | KV cache maks | Menunggu maks | Daya GPU |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 149 | 0 ms | 219 ms | 7,7 dtk | 90% | 17% | 0 | 183 W |
| 1 | 10 | 0 ms | 84 ms | 6,1 dtk | 97% | 11% | 0 | 186 W |
| 2 | 25 | 0 ms | 260 ms | 9,5 dtk | 90% | 28% | 0 | 216 W |
| 3 | 32 | 0 ms | 209 ms | 9,5 dtk | 92% | 36% | 0 | 214 W |
| 5 | 61 | **1,2 dtk** | 299 ms | 11,0 dtk | 89% | 43% | 1 | 223 W |
| 8 | 112 | **6,2 dtk** | 279 ms | 9,8 dtk | 90% | 44% | 5 | 223 W |

Yang terbaca:
- **Sampai 3 pengguna tidak ada antrean.** Batas 4 permintaan sekaligus belum tercapai.
- **Di 5 dan 8 pengguna, antrean menjadi pengubah terbesar.** Menunggu token pertama naik dari 1,7 ke 30,8 dtk per pertanyaan. Ini cocok dengan antre vLLM 6,2 dtk × ±4,7 panggilan.
- **Berpikir dan menulis bertambah lebih sedikit** (±12 dtk), karena decode per panggilan sedikit melambat saat GPU dibagi (7,7 → 9,8 dtk). Sebagian juga karena sebaran pertanyaan berbeda.
- **Memori kerja (KV cache) paling tinggi 44%**, tidak ada preemption, dan daya GPU sekitar 223 W dari 300 W.

---

## 7. Waterfall per pertanyaan

Contoh ulangan dengan total paling dekat waktu tengah. Angka di kolom "Langkah" adalah detik sejak pertanyaan dikirim. Waterfall lengkap per percobaan, termasuk span yang tumpang tindih, ada di dashboard (view *Waterfall*).

**Q1 Data penjualan**

| Langkah | Baseline (27,9 dtk) | 8 pengguna (74,0 dtk) |
|---|---|---|
| Persiapan | 0,0–0,3 | 0,0–0,2 |
| Perute: memilih agent | 0,3–3,9 (berpikir 2,4) | 0,2–10,9 (**menunggu 6,8**, berpikir 2,6) |
| `delegate_task` | 3,9–20,7, melingkupi 3 langkah di bawah | 10,9–56,5 |
| Marketing: memilih alat | 4,0–12,4 (berpikir 7,3) | 10,9–29,1 (**menunggu 8,1**, berpikir 8,8) |
| Alat `total_penjualan` | 12,4–12,7 | 29,1–29,4 |
| Marketing: menyusun hasil | 12,7–20,7 | 29,5–56,5 (**menunggu 12,2**) |
| Perute: jawaban akhir | 20,7–27,9 | 56,5–74,0 (**menunggu 11,8**) |

**Q4 SOP**

| Langkah | Baseline (29,3 dtk) | 8 pengguna (64,4 dtk) |
|---|---|---|
| Perute: memilih agent | 0,1–4,5 | 0,1–15,8 (menunggu 3,1, **berpikir 11,4**) |
| Portal: memilih alat | 4,6–8,8 | 15,8–41,4 (**berpikir 24,4**, 908 token; menunggu hanya 0,27) |
| `cari_sop` (embedding 0,3 / 0,1) | 8,8–9,1 | 41,4–41,5 |
| Portal: menyusun hasil | 9,1–20,8 | 41,5–55,0 |
| Perute: jawaban akhir | 20,8–29,3 | 55,0–64,4 |

**Q5 Rancangan tiket**

| Langkah | Baseline (22,3 dtk) | 8 pengguna (83,2 dtk) |
|---|---|---|
| Perute: memilih agent | 0,9–4,8 | 0,2–14,2 (menunggu 9,9) |
| Portal: memilih alat | 4,8–10,5 | 14,2–29,7 (menunggu 7,4) |
| Alat | `siapkan_tiket` 0,0 dtk | `cari_sop` 0,1 dtk |
| Portal: memilih alat lagi | — | 29,9–50,2 (menunggu 9,6), lalu `siapkan_tiket` 0,0 dtk |
| Portal: menyusun hasil | 10,6–17,4 | 50,2–65,9 |
| Perute: jawaban akhir | 17,4–22,3 | 65,9–83,2 |

**Q8 Sapaan**

| | Baseline (22,0 dtk) | 8 pengguna (34,2 dtk) |
|---|---|---|
| Alur | Perute → delegasi ke Portal (menjawab langsung) → perute jawaban akhir; 3 panggilan | Hanya perute, 1 panggilan: menunggu 13,4 dtk, **berpikir 15,9 dtk (±700 token)**, menulis 4,5 dtk |

Pola yang sama di semua contoh:
- **Saat sepi**, setiap panggilan diawali berpikir 2–7 dtk, dan alatnya hanya garis tipis.
- **Saat 8 pengguna**, setiap panggilan diawali blok "menunggu token pertama" 3–12 dtk. Perute juga menulis ulang jawaban akhir setelah agent aplikasi selesai.

---

## 8. Analisis khusus Q4 (SOP) dan Q5 (rancangan tiket)

| Tahap | Q4: n / benar / P50 / panggilan | Q5: n / benar / P50 / panggilan |
|---|---|---|
| Baseline | 5 / 4 / 29,3 dtk / 4,4 | 5 / 5 / 22,3 dtk / 4,6 |
| 2 pengguna | 1 / 1 / 53,1 / 6 | 1 / 1 / 27,0 / 4 |
| 3 pengguna | 1 / 1 / 33,3 / 4 | 1 / 1 / 28,4 / 4 |
| 5 pengguna | 2 / 2 / 34,4 / 6 | 2 / 2 / 30,0 / 4 |
| 8 pengguna | 3 / 3 / 64,4 / 4,7 | 3 / **1** / 83,2 / **12** (satu 27) |

Tahap 1 pengguna tidak memuat Q4 maupun Q5, karena polanya mengikuti skrip lama.

**Q4: tidak ada masalah retrieval atau database** (12 kali ditanyakan, 11 benar).
- `cari_sop` P50 0,1–0,3 dtk, dengan embedding 50–360 ms dan query DB < 130 ms.
- Pemanggilan embedding **pertama** setelah proses mulai (pemanasan) butuh **5,5 dtk** karena memuat model di laptop (*cold start*).
- Masalahnya ada di model:
  - **sekali menjawab tanpa alat SOP** (baseline, 12,6 dtk, kurang tepat);
  - **dua kali menambah alat `persetujuan_pengajuan_saya`** dengan delegasi kedua (7 panggilan, 62 dan 87 dtk);
  - **sekali berpikir 24 dtk** hanya untuk memilih alat (8 pengguna).

**Q5: jalur tidak stabil, dan ada pengulangan rute.**
- Jalurnya berganti-ganti dari 12 kali Q5 ditanyakan (10 benar): `cari_sop` saja (5×), `siapkan_tiket` langsung (4×), atau keduanya (3×).
- Di 8 pengguna:
  - sekali **kurang tepat**, karena hanya mencari SOP tanpa menyiapkan tiket;
  - sekali **habis waktu**. Perute menyerahkan ke agent Portal **7 kali** (`delegate_task`), dan di antara setiap penyerahan perute menulis 2 panggilan lagi. Totalnya **27 panggilan model**.
  - Alat `cari_sop` dan `siapkan_tiket` di kasus itu selesai dalam 0,0–1,1 dtk setiap kali.
- Agent **tetap bekerja sampai detik ±339**, padahal klien sudah berhenti menunggu di detik 300. Pekerjaan yang ditinggalkan tetap mengisi antrean vLLM untuk pengguna lain.
- Polanya sama dengan kasus 278 dtk pada 16 Nov.
- **Tidak ada retry HTTP, galat panggilan model, atau galat alat.** Pengulangan terjadi di tingkat keputusan rute model.

---

## 9. Dibandingkan pengukuran sebelumnya (kualitatif)

| Pengukuran | Yang diukur | Angka yang relevan |
|---|---|---|
| Benchmark model langsung (16 Nov) | Satu panggilan vLLM, tanpa agent, mode berpikir mati | ±50 token/detik per permintaan; TTFT prompt dari cache ±40 ms |
| Uji beban Batas 4 (16 Nov) | Waktu jawab agent, tanpa trace | P50 5 pengguna 37,1 dtk, 8 pengguna 77,3 dtk |
| Profil 16 Nov | 40 berurutan + 5 pengguna, trace tanpa span DB/embedding | Berurutan P50 34,5 dtk, berpikir 51% |
| **Profil ini (17 Nov)** | 97 pertanyaan, span bertingkat | Berurutan P50 29,3 dtk, berpikir 52%; 8 pengguna 73,3 dtk |

- Hasil konsisten dengan pengukuran sebelumnya: berpikir sekitar separuh waktu, alat < 2%, dan antrean baru muncul di atas 4 permintaan sekaligus.
- **TPS model langsung tidak bisa dibandingkan dengan "TPS agent".** Satu pertanyaan agent terdiri dari 3–5 panggilan dengan prompt 2.800–7.300 token, mode berpikir menyala, dan jawaban alami. Benchmark model memakai satu panggilan sintetik.
- Di 5 pengguna, P50 hari ini (50,5 dtk) lebih tinggi daripada uji beban 16 Nov (37,1 dtk). Sebaran pertanyaan berbeda, dan jumlah panggilan per pertanyaan 4,1 vs 3,8. Satu kali uji per hari belum cukup untuk menyimpulkan ada perubahan.

---

## 10. Ranking penghambat dan rekomendasi

| # | Penghambat | Bukti | Dampak | Prioritas | Risiko terhadap ketepatan |
|---:|---|---|---|---|---|
| 1 | **Token berpikir di setiap panggilan** | 16,1 dtk (52%) saat sepi; 80–92% token keluar pada panggilan pemilih agent/alat; sapaan sesekali berpikir ±700–1.000 token | Terbesar saat sepi, dan ikut memperpanjang antrean saat ramai | Tinggi | **Sedang**: pemilihan alat bisa memburuk tanpa berpikir |
| 2 | **Antrean vLLM saat > 4 permintaan** | Antre 0 → 1,2 → 6,2 dtk per panggilan (3 → 5 → 8 pengguna); menunggu token pertama 30,8 dtk per pertanyaan di 8 pengguna | Terbesar saat ramai | Tinggi | Rendah |
| 3 | **Jumlah panggilan berurutan** (4 per pertanyaan data), termasuk perute menulis ulang jawaban | "Perute: jawaban akhir" 7,5 dtk per pertanyaan (24%) | Besar, dan memperbanyak antrean | Sedang–tinggi | Sedang: format atau gaya jawaban bisa berubah |
| 4 | **Pengulangan rute Q5** | 1 kali 7 delegasi / 27 panggilan / > 300 dtk; jalur Q5 berganti-ganti | Jarang, tapi sangat mahal dan membebani pengguna lain | Tinggi (*quick win*) | Rendah kalau berupa batas |
| 5 | Embedding SOP *cold start* | 5,5 dtk pada pemanggilan pertama, sesudahnya 0,05–0,4 dtk | Kecil, hanya sekali per proses | Rendah | Tidak ada |
| — | Alat, DB, persiapan, kerangka agent, transport | Masing-masing < 1 dtk per pertanyaan; transport + gateway ±0,2 dtk per panggilan | Tidak signifikan | — | — |

### Quick wins: tidak mengubah ketepatan, risiko rendah

1. **Batasi `delegate_task` ke agent yang sama**, misalnya paling banyak 2 kali per pertanyaan, dan hentikan pekerjaan agent saat klien membatalkan atau waktu habis. Ini mencegah kasus 300+ dtk yang juga membebani antrean pengguna lain.
2. **Muat model embedding saat proses mulai.** Ini menghilangkan *cold start* 5,5 dtk pada pertanyaan SOP pertama.

### Perlu eksperimen: bisa mengubah kualitas jawaban

3. **Matikan atau batasi berpikir pada panggilan pemilih agent/alat** (`enable_thinking: false` per langkah). Perkiraan dari data: hemat ±5–8 dtk per pertanyaan data saat sepi, dan lebih sedikit token berarti antrean lebih pendek saat ramai. Wajib diukur ulang dengan skrip yang sama, termasuk ketepatan Q4/Q5.
4. **Teruskan jawaban agent aplikasi tanpa ditulis ulang perute.** Perkiraan hemat ±7 dtk dan satu panggilan per pertanyaan.
5. **Perjelas rute Q5** (tiket langsung ke `siapkan_tiket`, tanpa mencari SOP dulu), lalu uji ketepatannya.
6. **Kapasitas:** kalau target pengguna bersamaan lebih dari 4, uji `max-num-seqs` 5–6 secara terpisah. KV cache paling tinggi 44%. Keputusan ini milik pengelola server, dan tidak diubah di uji ini.

Semua rekomendasi di atas **belum diterapkan**. Uji ini tidak mengubah prompt, rute, sampling, maupun konfigurasi server.

---

## 11. Yang tidak dapat diukur secara valid

| Hal | Status |
|---|---|
| Antre vLLM **per permintaan** saat beban | *Not observable*: histogram vLLM kumulatif, jadi hanya rata-rata per tahap |
| Jaringan vs LiteLLM secara terpisah | *Not observable*: hanya gabungan "transport + gateway" (±170–200 ms per panggilan) |
| TTFT internal vLLM per panggilan | *Not observable*: tersedia TTFT klien, TTFT LiteLLM, dan rata-rata TTFT vLLM per tahap. TTFT LiteLLM ≠ TTFT vLLM |
| Waktu internal VoltAgent (perpindahan agent) | Hanya sebagai sisa: orkestrasi + kerangka < 0,15 dtk per pertanyaan |
| Token berpikir vs teks | Perkiraan dari porsi potongan stream, bukan tokenizer |
| Query lewat `pool.connect()` (transaksi), pool MySQL portal | Tidak dibungkus |
| KV cache tertinggi per detik | Dari log statistik vLLM (±10 dtk), bukan kontinu |

---

## 12. Batasan

- **Satu sesi uji.** Tahap beban berisi 3–24 pertanyaan, sehingga P95 per tahap sangat sensitif terhadap satu-dua pertanyaan lambat.
- **Sebaran Q1–Q8 per tahap tidak seimbang**, mengikuti pola skrip lama (bagian 4).
- Semua pengguna virtual memakai satu akun dengan pertanyaan tetap.
- Agent berjalan di laptop (memori hampir penuh) lewat tunnel Cloudflare. Di server, persiapan, embedding, dan transport bisa berbeda.
- Pencocokan LiteLLM berdasarkan jam mulai. Saat 8 pengguna, satu-dua pasangan bisa tertukar, misalnya ada satu nilai transport negatif pada "Super Tools". Pengaruhnya pada rata-rata kecil, karena 419 dari 419 panggilan tetap berpasangan.

---

## 13. Cara menjalankan ulang

```bash
cd marketing
# 1 pertanyaan untuk memeriksa trace
npx tsx --env-file=.env.local scripts/profil-alur-agent.mts --coba
# uji penuh (±60 menit): pemanasan + 40 berurutan + tahap 1/2/3/5/8
npx tsx --env-file=.env.local scripts/profil-alur-agent.mts
# log statistik vLLM (hanya membaca), lalu olah + dashboard
ssh mr-ec2 "docker logs qwen3-vllm --since <jam mulai UTC> 2>&1" | grep throughput > data/agent-workflow-latency/<waktu>/vllm-stat.log
python scripts/olah-alur-agent.py data/agent-workflow-latency/<waktu> --vllm-log data/agent-workflow-latency/<waktu>/vllm-stat.log
```

Profiling di aplikasi tetap mati, kecuali `AGENT_PROFILING_ENABLED=1` disetel di proses yang ingin diukur.

**Berkas data** (`data/agent-workflow-latency/2026-11-17-03-11/`):

| Berkas | Isi |
|---|---|
| `span.jsonl`, `span.csv` | 1.696 span bertingkat |
| `kejadian.jsonl` | Info, health check, hasil per pertanyaan, cuplikan vLLM, sampel GPU |
| `pertanyaan.csv` | 105 baris (8 pemanasan + 97): status, waktu, pecahan eksklusif, token |
| `panggilan.csv` | 419 panggilan model + waktu & token LiteLLM |
| `litellm.csv`, `vllm-stat.log` | Sumber mentah dari server (kolom waktu/token/status; baris statistik vLLM) |
| `ringkasan.json`, `cek.json`, `intinya.json` | Angka ringkas, sanity check, teks dashboard |
