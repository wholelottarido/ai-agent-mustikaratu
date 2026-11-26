# Ratu AI — 1 GPU vs 4 GPU (Qwen3-14B, agent workflow)

**Uji:** 17 Nov 2026 (1 GPU) dan 20 Nov 2026 (4 GPU), masing-masing 97 pertanyaan
**Dashboard:** `docs/benchmark/grafik/hasil-pengujian.html`, grup menu **Qwen3-14B** (Mesin A · 1 GPU, Mesin B · 4 GPU, Perbandingan mesin A vs B, Jawaban model). Satu berkas offline yang memuat semua hasil uji 13–23 Nov, jadi cukup berkas ini yang dikirim.
**Data:** `data/agent-workflow-latency/2026-11-17-03-11/` (1 GPU), `data/agent-workflow-latency/2026-11-20-07-30-4gpu/` (4 GPU, uji ulang 20 Nov 14.30 WIB; uji pertama pagi harinya diarsipkan di `arsip-2026-11-20-02-19-4gpu-lama/`),
`data/agent-workflow-latency/banding-1gpu-vs-4gpu/banding.json` / `.csv` (perbandingan). Folder `data/` tidak ikut Git.
**Laporan terkait:** `docs/benchmark/benchmark-agent-workflow-latency.md` (uji 1 GPU secara rinci), `docs/benchmark/benchmark-inferensi-qwen3-14b.md` (kecepatan model langsung)

---

## 1. Ringkasan untuk mentor

Model yang sama (Qwen3-14B-AWQ) dijalankan di dua mesin:
- **g5.2xlarge:** 1 GPU A10G, 1 salinan model.
- **g5.12xlarge:** 4 GPU A10G, 4 salinan model yang dibagi oleh LiteLLM.

Ratu AI diuji dengan skrip, pertanyaan, dan pola beban yang **sama persis**.

| Ukuran | 1 GPU | 4 GPU | Perubahan |
|---|---:|---:|---:|
| **8 pengguna: waktu tengah (P50)** | 73,3 dtk | **35,3 dtk** | **−52%** |
| 8 pengguna: P95 | 115,9 dtk | 68,2 dtk | −41% |
| 8 pengguna: paling lama | 300,7 dtk (waktu habis) | 68,8 dtk | |
| 8 pengguna: antre di vLLM per panggilan | 6,15 dtk | 0,07 dtk | −99% |
| 8 pengguna: menunggu token pertama per pertanyaan | 30,8 dtk | 2,0 dtk | −94% |
| 8 pengguna: pertanyaan selesai per menit | 4,1 | **8,8** | **2,1×** |
| 8 pengguna: token keluar per detik (gabungan) | 118 | 222 | 1,9× |
| 5 pengguna: P50 | 50,5 dtk | 33,2 dtk | −34% |
| **Satu per satu (baseline): P50** | 29,3 dtk | 29,5 dtk | **sama** |
| Kecepatan menulis satu panggilan, saat sepi | 49,3 tok/dtk | 49,3 tok/dtk | sama |
| Sesuai kriteria (97 pertanyaan) | 94 | 93 | −1 |
| Waktu habis (300 dtk) | 1 | 0 | |
| Daya GPU saat 8 pengguna | 222 W (1 GPU) | 719 W (4 GPU) | 3,2× |
| Tiket tersimpan / preemption | 0 / 0 | 0 / 0 | |

**Kesimpulan:**
1. **4 GPU tidak mempercepat satu jawaban.** Saat satu orang bertanya, waktunya sama (±30 dtk), dan kecepatan menulis per panggilan juga sama persis (49,3 tok/dtk). Satu jawaban tetap dikerjakan oleh satu GPU.
2. **4 GPU menghilangkan antrean.** Di server 1 GPU, antrean mulai muncul di atas 4 permintaan sekaligus. Di server 4 GPU, antrean hampir tidak ada sampai 8 pengguna. Hasilnya, waktu tengah di 8 pengguna turun dari 73 ke 35 detik, dan jumlah pertanyaan yang selesai per menit naik 2,1×.
3. **Kenaikannya tidak 4×**, karena di 8 pengguna server 4 GPU **belum penuh**. Rata-rata tiap replika hanya penuh 3% waktu, dan GPU sibuk 66–85%. Batas kemampuannya belum tercapai; stress test 12 dan 16 pengguna diperlukan untuk menemukannya.
4. **Ada dua kelemahan baru.** Pembagian beban `simple-shuffle` tidak merata (satu replika mendapat 1,5× lebih banyak panggilan daripada replika lain), dan daya listriknya 3,2× lebih besar.
5. **Ketepatan jawaban tidak dipengaruhi perangkat keras.** Perbedaan 94 vs 93 berasal dari keragaman keputusan model (bagian 7), bukan dari jumlah GPU.

---

## 2. Lingkungan

| Hal | 1 GPU | 4 GPU |
|---|---|---|
| Instance | AWS g5.2xlarge | AWS g5.12xlarge (48 vCPU AMD EPYC 7R32, 186 GiB RAM) |
| GPU | 1× A10G 24 GB | 4× A10G 24 GB (driver 595.112.07) |
| Replika vLLM | 1 (`qwen3-vllm`) | 4 (`qwen14-vllm`, `qwen14-gpu1/2/3`), satu GPU per replika |
| Versi vLLM | 0.33.0 (stabil) | 0.33.0rc1.dev1030 (nightly) |
| Setelan per replika | sama: `max-num-seqs 4`, `max-model-len 16384`, `gpu-memory-utilization 0.85`, `hermes`, `qwen3` | sama, diperiksa identik di keempat replika |
| Gateway | LiteLLM (1 deployment) | LiteLLM `simple-shuffle`, `num_retries 0` (4 deployment) |
| Pilihan model di Ratu AI | `mr-ai-gateway` (`AI_BASE_URL`) | `mr-ai-gateway-4gpu` (`AI_BASE_URL_2`, `AI_MODEL_2`, `AI_API_KEY_2`) |
| Jalur | agent langsung (laptop) → tunnel Cloudflare → LiteLLM → vLLM; tanpa portal | sama |

**Metode yang sama:**
- skrip `scripts/profil-alur-agent.mts`;
- pemanasan 8 pertanyaan (tidak dihitung);
- 40 berurutan (8 pertanyaan × 5);
- tahap 1/2/3/5/8 pengguna × 3 pertanyaan, dengan pola `scripts/uji-beban.mts`;
- jeda 120 dtk antar tahap setelah antrean kosong, dan batas 300 dtk per pertanyaan;
- kriteria benar yang sama;
- pencatat span `lib/profil-agent.ts`.

Yang berbeda hanya opsi pemilihan server dan model:

```
--model mr-ai-gateway-4gpu --ssh-host mr-g5-12x --port 8000,8001,8002,8003 --db-container qwen14-postgres --label 4gpu
```

**Data tambahan yang hanya ada di uji 4 GPU:**
- replika yang melayani setiap panggilan (header `x-litellm-model-api-base`);
- token *reasoning* yang persis dari catatan LiteLLM (di uji 1 GPU masih berupa perkiraan);
- GPU per indeks;
- counter vLLM per port.

---

## 3. Latensi per tahap (detik)

| Tahap | n | P50 1→4 GPU | P95 1→4 GPU | Rata-rata 1→4 | Min 1→4 | Maks (≈P99*) 1→4 |
|---|---:|---|---|---|---|---|
| Berurutan | 40 | 29,3 → 29,5 | 58,3 → 52,9 | 31,1 → 30,5 | 11,7 → 11,8 | 66,2 → 70,8 |
| 1 pengguna | 3 | 24,6 → 23,6 | 29,0 → 27,0 | 21,8 → 21,0 | 11,9 → 12,3 | 29,0 → 27,0 |
| 2 pengguna | 6 | 31,6 → 31,5 | 70,7 → 59,4 | 42,3 → 33,3 | 27,0 → 13,4 | 70,7 → 59,4 |
| 3 pengguna | 9 | 34,5 → 36,1 | 67,9 → 90,6 | 36,3 → 42,5 | 12,5 → 13,4 | 67,9 → 90,6 |
| 5 pengguna | 15 | 50,5 → **33,2** | 92,5 → 65,1 | 52,2 → 34,5 | 21,1 → 11,4 | 92,5 → 65,1 |
| 8 pengguna | 24 | 73,3 → **35,3** | 115,9 → 68,2 | 75,4 → 38,4 | 9,6 → 12,0 | 300,7 → 68,8 |

\* Dengan 3–40 pertanyaan per tahap, P99 sama dengan nilai maksimum.

- **Sampai 3 pengguna** perbedaannya kecil. Batas 4 permintaan sekaligus di server 1 GPU belum tercapai, sehingga keduanya sama-sama tanpa antrean. Selisih di 1–3 pengguna sebagian besar berasal dari keragaman jalur model dan dari sampel yang kecil. Contohnya P95 3 pengguna di 4 GPU (90,6 dtk) adalah satu Q2 yang lambat, bukan antrean: antre vLLM di tahap itu 0.
- **Di 5 dan 8 pengguna**, waktu di server 4 GPU **hampir datar** (±33–35 dtk, sama dengan saat sepi). Di server 1 GPU waktunya naik tajam.

**Per jenis pertanyaan saat 8 pengguna (P50, detik):** tujuh jenis lebih cepat 36–70%. Q8 (sapaan) sedikit lebih lambat, tapi Q8 hanya 3 kali di tahap ini dan tidak memakai alat, jadi selisih 4 detik itu masih dalam keragaman jalur model.

| Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | Q7 | Q8 |
|---|---|---|---|---|---|---|---|
| 74 → 35 | 106 → 68 | 77 → 43 | 64 → 34 | 83 → 25 | 76 → 44 | 30 → 16 | 34 → 38 |

---

## 4. Ke mana waktunya habis (waktu eksklusif, rata-rata detik per pertanyaan)

| Tahap | Menunggu token pertama 1→4 | Berpikir 1→4 | Menulis + rencana + ekor 1→4 | Alat + DB + embedding 1→4 |
|---|---|---|---|---|
| Berurutan | 1,7 → 1,4 | 16,1 → 15,8 | 12,6 → 12,5 | 0,26 → 0,24 |
| 5 pengguna | 7,3 → 1,9 | 24,7 → 16,9 | 19,8 → 15,1 | 0,19 → 0,20 |
| 8 pengguna | **30,8 → 2,0** | 25,2 → 20,2 | 18,8 → 15,6 | 0,26 → 0,21 |

- **Yang hilang di 4 GPU hampir seluruhnya waktu menunggu**, yaitu antrean di vLLM.
- **Bagian berpikir dan menulis tetap ±30 dtk per pertanyaan di kedua server.** Ini adalah **batas bawah waktu jawab Ratu AI** yang tidak bisa diturunkan dengan menambah GPU, karena 3–4 panggilan model berjalan berurutan dan masing-masing ditulis satu GPU dengan kecepatan ±50 tok/dtk.
- Alat, database, dan pencarian SOP tetap di bawah 1% di kedua server.

---

## 5. Throughput, TPS, dan antrean

| Tahap | Pertanyaan/menit 1→4 | Token keluar/dtk gabungan 1→4 | Kecepatan menulis per panggilan 1→4 | TTFT LiteLLM P50 1→4 | Antre vLLM/panggilan 1→4 | Decode vLLM/panggilan 1→4 |
|---|---|---|---|---|---|---|
| Berurutan | 1,53 → 1,55 | 35,6 → 35,3 | 49,3 → 49,3 | 65 → 69 ms | 0 → 0 | 7,7 → 7,9 dtk |
| 3 pengguna | 3,50 → 3,21 | 84,8 → 98,0 | 42,3 → 47,7 | 100 → 135 ms | 0 → 0 | 9,5 → 9,6 dtk |
| 5 pengguna | 4,61 → 6,33 | 128,8 → 153,5 | 38,0 → 46,8 | 657 → 107 ms | 1,20 → 0 dtk | 11,0 → 8,6 dtk |
| 8 pengguna | 4,11 → **8,80** | 117,8 → **221,7** | 38,5 → 42,9 | 6.521 → 147 ms | **6,15 → 0,07 dtk** | 9,8 → 9,5 dtk |

Cara menghitung:
- "Token keluar/dtk gabungan" = semua token jawaban (termasuk berpikir) di satu tahap ÷ durasi tahap.
- "Kecepatan menulis per panggilan" = token keluar ÷ (lama di LiteLLM − TTFT LiteLLM).
- Angka-angka ini **tidak sama dengan** benchmark model langsung (±52 tok/dtk per permintaan dengan prompt sintetik), dan tidak boleh dibandingkan seolah satu metrik.

Yang terbaca:
- **Kecepatan menulis satu panggilan saat sepi identik (49,3 tok/dtk).** Ini menjawab pertanyaan apakah vLLM nightly mengubah kecepatan dasar: **tidak terlihat ada perbedaan**. Jadi perbedaan saat ramai memang datang dari jumlah replika, bukan dari versi vLLM.
- Di 8 pengguna, server 1 GPU mengerjakan 4 permintaan sekaligus di satu GPU, sehingga setiap panggilan melambat ke 38,5 tok/dtk. Server 4 GPU membagi beban ke 4 GPU, sehingga setiap panggilan tetap ±43 tok/dtk.
- **Server 4 GPU belum jenuh di 8 pengguna.** Rata-rata tiap replika penuh hanya 3% waktu (server 1 GPU: 66%), dan KV cache paling tinggi 32% (server 1 GPU: 44%).

---

## 6. Distribusi beban ke 4 GPU

Bukti dari **tiga sumber yang dicatat terpisah dan saling cocok**: header LiteLLM di setiap panggilan, kolom replika di catatan LiteLLM, dan selisih counter `request_success_total` / `generation_tokens_total` vLLM per port. Semua 383 panggilan model tercatat replikanya.

**Tahap 8 pengguna:**

| Replika (GPU) | Panggilan | Token keluar | Antre vLLM/panggilan | GPU sibuk | Daya rata | Suhu maks |
|---|---:|---:|---:|---:|---:|---:|
| `qwen14-vllm` (GPU 0) | **18** | 7.570 | 10 ms | 70% | 175 W | 63 °C |
| `qwen14-gpu1` (GPU 1) | 21 | 8.909 | 130 ms | 66% | 170 W | 64 °C |
| `qwen14-gpu2` (GPU 2) | 24 | 9.673 | 0 ms | 85% | 200 W | 67 °C |
| `qwen14-gpu3` (GPU 3) | **27** | 10.111 | 139 ms | 70% | 174 W | 63 °C |

- **Semua GPU dipakai, tapi tidak merata.** Di 8 pengguna, GPU 3 mendapat 1,5× lebih banyak panggilan daripada GPU 0. `simple-shuffle` memilih replika **secara acak, tanpa melihat** replika mana yang sedang sibuk. Akibatnya, sesekali satu replika antre (sampai 139 ms per panggilan) sementara replika lain menganggur. Di uji pertama pagi harinya ketimpangannya lebih besar (32 vs 13 panggilan, antre sampai 405 ms): karena acak, besarnya ketimpangan berubah-ubah tiap uji.
- Pola yang sama terlihat di seluruh uji, misalnya fase berurutan: 31 / 33 / 33 / 46 panggilan.
- **Cache prompt terbagi per replika.** Setiap replika menyimpan cache-nya sendiri. Persentase cache terpakai tetap tinggi (85–91% per replika di 8 pengguna, setara dengan 89–90% di server 1 GPU), tapi setiap replika harus "dipanaskan" sendiri saat awal.

---

## 7. Keberhasilan agent

| Tahap | Sesuai kriteria 1 GPU | Sesuai kriteria 4 GPU | Waktu habis 1/4 | Alat sukses 4 GPU | Panggilan model/pertanyaan 1→4 |
|---|---:|---:|---|---:|---|
| Berurutan | 39/40 | 38/40 | 0/0 | 31/31 | 3,73 → 3,58 |
| 1 pengguna | 3/3 | 3/3 | 0/0 | 1/1 | 3,33 → 2,67 |
| 2 pengguna | 6/6 | 5/6 | 0/0 | 4/4 | 4,17 → 3,33 |
| 3 pengguna | 9/9 | 8/9 | 0/0 | 10/10 | 3,56 → 4,11 |
| 5 pengguna | 15/15 | 15/15 | 0/0 | 12/12 | 4,07 → 3,73 |
| 8 pengguna | 22/24 | 24/24 | 1/0 | 18/18 | 4,67 → 3,75 |
| **Total** | **94/97** | **93/97** | **1/0** | 76/76 | |

**Yang tidak sesuai kriteria:**

| Server | Pertanyaan | Jumlah | Keterangan |
|---|---|---:|---|
| 1 GPU | Q4 tanpa alat SOP | 1 | |
| 1 GPU | Q5 hanya mencari SOP | 1 | |
| 1 GPU | Q5 waktu habis | 1 | Perute menyerahkan ke agent Portal 7 kali (27 panggilan model) |
| 4 GPU | Q8 (sapaan) memakai alat `daftar_sop` | 1 | Jawabannya wajar untuk pengguna (menyebut 63 SOP dan menawarkan bantuan); gagal karena kriteria "sapaan tanpa alat" |
| 4 GPU | **Q5: jawaban akhir berisi pesan serah-terima antar agent** | 1 | Isinya kalimat internal seperti "User menyetujui tawaran sebelumnya: siapkan tiket…", bukan rancangan tiket |
| 4 GPU | **Q5: jawaban akhir hanya "ya"** | 1 | Panjang jawaban 2 karakter |
| 4 GPU | Q4 tanpa alat SOP | 1 | Model menjawab "belum bisa mengambil data prosedur" tanpa mencoba `cari_sop` |

Di uji ulang ini **isi jawaban ikut dicatat** (opsi `--simpan-jawaban`, berkas `jawaban.jsonl`, hanya di laptop), jadi penyebab tiap kegagalan bisa dibaca langsung.

- **Ini bukan masalah perangkat keras.** Semua alat yang dipanggil di server 4 GPU berhasil (76/76), tidak ada galat panggilan model, dan tidak ada retry. Yang berbeda adalah **keputusan model**: alat mana yang dipilih dan teks apa yang ditulis.
- **Q1 13/13 benar di uji ulang ini.** Di uji pertama pagi harinya Q1 gagal 4 kali (angka 156.770 tidak tertulis). Jadi kegagalan Q1 itu bukan pola tetap, melainkan keragaman model. Penyebab pastinya tidak bisa dibaca karena isi jawaban uji pertama tidak disimpan.
- **Temuan baru: dua kegagalan Q5 adalah jawaban yang tidak layak dikirim ke pengguna.** Keduanya terjadi saat agent memilih `cari_sop` alih-alih `buat_tiket`. Setelah itu yang sampai ke pengguna adalah pesan serah-terima perute ke agent Portal, atau satu kata "ya". Ini masalah di alur perute/agent (teks internal bocor sebagai jawaban akhir), bukan di GPU, dan bisa terjadi juga di server 1 GPU.
- **Q5 tidak lagi mengulang rute** di server 4 GPU: semua Q5 tepat 4 panggilan model, dan 0 waktu habis. Dengan 13 kali Q5 per uji, ini belum cukup untuk menyimpulkan apakah perbedaannya karena kebetulan atau karena antrean yang hilang.

---

## 8. Apakah peningkatannya sebanding dengan perangkat keras?

| Ukuran | Kenaikan |
|---|---:|
| GPU | 4× |
| Daya GPU saat 8 pengguna | 3,2× (222 → 719 W) |
| Pertanyaan selesai per menit, 8 pengguna | 2,1× |
| Token keluar per detik, 8 pengguna | 1,9× |
| Waktu jawab satu pertanyaan saat sepi | 1,0× (tidak berubah) |

Belum sebanding, karena **8 pengguna belum cukup untuk memenuhi 4 GPU** (replika penuh hanya 3% waktu). Kapasitas teoretis server 4 GPU adalah 16 permintaan sekaligus (4 replika × 4); di 8 pengguna yang terpakai baru sekitar 8. Uji 12 dan 16 pengguna akan menunjukkan apakah throughput terus naik atau tertahan oleh pembagian beban yang acak.

Daya listrik GPU naik 3,2× walau beban hanya 2,1×, karena keempat GPU tetap menyala. Daya diam keempat GPU saja sudah sekitar 4 × 63 W.

---

## 9. Rekomendasi konfigurasi deployment

| No | Rekomendasi | Dasar | Catatan |
|---|---|---|---|
| 1 | **Pakai server multi-GPU kalau pengguna bersamaan diperkirakan lebih dari 4.** Untuk ≤3 pengguna, 1 GPU sudah sama cepatnya | Sampai 3 pengguna P50 sama; di 5–8 pengguna 4 GPU 34–52% lebih cepat | Keputusan biaya ada di pemilik server |
| 2 | **Uji strategi pembagian beban selain `simple-shuffle`**, misalnya `least-busy` atau berbasis jumlah permintaan berjalan | Ketimpangan 1,5× (uji ulang) sampai 2,5× (uji pertama); replika sempat antre 139–405 ms padahal replika lain kosong | Mengubah konfigurasi LiteLLM, butuh persetujuan |
| 3 | **Jalankan stress test 12 dan 16 pengguna** untuk menemukan batas server 4 GPU | Di 8 pengguna replika baru penuh 3% waktu | Sudah disetujui untuk dijalankan setelah tahap 1–8 |
| 4 | Pertimbangkan **2 replika** kalau target hanya ±8 pengguna | Beban 8 pengguna hanya memakai ±8 dari 16 slot | Belum diuji; perlu uji terpisah sebelum disimpulkan |
| 5 | **Turunkan batas bawah waktu jawab (±30 dtk) lewat agent, bukan lewat GPU**: batasi berpikir pada langkah pemilih agent/alat, dan hindari penulisan ulang jawaban oleh perute | Berpikir dan menulis tetap ±30 dtk di kedua server | Dari laporan 17 Nov; perlu uji ketepatan |
| 6 | **Cegah teks internal bocor sebagai jawaban akhir**: kalau jawaban agent kosong, sangat pendek, atau berisi pesan serah-terima, tampilkan pesan gagal yang jujur atau minta agent menjawab ulang | 2 dari 13 Q5 di uji ulang berisi pesan serah-terima atau hanya "ya" | Tidak terkait perangkat keras. Kegagalan Q1 di uji pertama tidak terulang (13/13 benar) |
| 7 | **Operasional server 4 GPU:** cache model di disk permanen (sekarang di disk ephemeral, diunduh ulang setiap start), `HF_TOKEN`, tunnel bernama atau layanan `cloudflared` | Laporan status server 20 Nov | Butuh persetujuan; container perlu dibuat ulang |

---

## 10. Batasan

- **Satu kali uji yang dipakai per server, di hari yang berbeda** (17 dan 20 Nov). Server 4 GPU sebenarnya diuji dua kali pada 20 Nov; angka di laporan ini dari uji ulang (14.30 WIB), uji pertama (09.19 WIB) diarsipkan. Selisih kedua uji 4 GPU kecil (P50 8 pengguna 33,5 vs 35,3 dtk; sesuai kriteria 91 vs 93) dan menunjukkan besarnya keragaman antar-uji. Tahap beban berisi 3–24 pertanyaan, sehingga P95 dan maksimum sensitif terhadap satu-dua pertanyaan lambat.
- **Versi vLLM berbeda**: stabil vs nightly. Kecepatan per panggilan saat sepi terukur identik, tapi perilaku penjadwalan saat ramai bisa saja berbeda.
- **Sebaran Q1–Q8 per tahap tidak seimbang**, mengikuti pola skrip uji beban lama, tapi sama di kedua uji.
- **Jam laptop tertinggal ±11,5 dtk dari server 4 GPU** (±1,6 dtk dari server 1 GPU). Selisih ini dikoreksi otomatis saat mencocokkan catatan LiteLLM (383/383 cocok) dan rekaman GPU. Durasi diukur dengan jam monotonic, jadi tidak terpengaruh.
- **Token berpikir** di server 1 GPU adalah perkiraan (porsi potongan stream), sedangkan di server 4 GPU angkanya persis dari LiteLLM. Perbandingan token berpikir antar server karena itu bersifat perkiraan.
- Agent berjalan di laptop lewat tunnel Cloudflare, sama di kedua uji. Portal yang berjalan di server belum diuji.
- **Tidak diukur:** antre vLLM per permintaan (hanya rata-rata per tahap), pemisahan waktu jaringan dan LiteLLM, serta waktu internal VoltAgent.

---

## 11. Cara menjalankan ulang

```bash
cd marketing
# uji 4 GPU (±55 menit); bawaan tanpa opsi = server 1 GPU
npx tsx --env-file=.env.local scripts/profil-alur-agent.mts --model mr-ai-gateway-4gpu \
  --ssh-host mr-g5-12x --port 8000,8001,8002,8003 --db-container qwen14-postgres --label 4gpu --simpan-jawaban
# --simpan-jawaban: isi jawaban ikut dicatat ke jawaban.jsonl (hanya di laptop, bisa memuat data perusahaan)
# log statistik vLLM per replika (hanya membaca), lalu olah tanpa menimpa dashboard 17 Nov
for c in qwen14-vllm qwen14-gpu1 qwen14-gpu2 qwen14-gpu3; do
  ssh mr-g5-12x "docker logs $c --since <jam mulai UTC> 2>&1" | grep throughput > data/agent-workflow-latency/<waktu>-4gpu/vllm-stat-$c.log; done
python scripts/olah-alur-agent.py data/agent-workflow-latency/<waktu>-4gpu --tanpa-dashboard \
  --vllm-log <4 berkas vllm-stat-*.log, dipisah koma>
# perbandingan + dashboard (tambahkan --live selama uji masih berjalan)
python scripts/banding-gpu.py data/agent-workflow-latency/2026-11-17-03-11 data/agent-workflow-latency/<waktu>-4gpu \
  --tambah-b data/agent-workflow-latency/2026-11-23-08-35-14b-seqs4-c10-20
# --tambah-b: tahap 10/12/16/20 pengguna (uji 23 Nov, setelan sama) ikut tampil di halaman Mesin B.
# Tanpa opsi ini halaman Mesin B kembali hanya 1–8 pengguna. Halaman Perbandingan A vs B tidak terpengaruh.
```
