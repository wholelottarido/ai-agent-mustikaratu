# Implementasi Perbaikan Workflow Agent — Qwen3-14B

**Dasar:** [rca-kegagalan-workflow-agent-qwen14b.md](rca-kegagalan-workflow-agent-qwen14b.md) (disetujui 24 Nov 2026)
**Status:** Tahap 1 (F.5 evaluator & observability) **selesai** · Tahap 2 (Q5) **rencana, belum diimplementasikan, menunggu persetujuan**
**Tidak diubah:** model, 4 replika, `max-num-seqs=4`, Docker, LiteLLM, tabel `ai_agent`/`ai_tool`, data uji historis, perilaku agent untuk pengguna.

---

## 1. Ringkasan Tahap 1

| Butir permintaan | Hasil |
|---|---|
| Evaluator Q5 tidak meloloskan klaim "sudah dibuat" | ✅ Kategori `klaim-tersimpan-palsu` → gagal, kecuali ada bukti benar-benar tersimpan |
| Bedakan klarifikasi / penawaran / rancangan / tersimpan / kosong / timeout | ✅ Plus `pesan-internal` (pesan perute & persetujuan karangan). Tiga tingkat hasil: lulus / sebagian / gagal, ditambah `tidak-bisa-dinilai` kalau bukti tidak tercatat |
| Q1: normalisasi angka + validasi periode | ✅ 156.770 = 156,770 = 156 770 = 156770. Periode dicek dari argumen alat: `sesuai` / `relatif` / `kosong` / `lain` / `tidak-tercatat` |
| Q8: fungsi & efisiensi terpisah | ✅ `hasil` (fungsi) dan `efisiensi` (efisien/boros) dicatat terpisah |
| Catat status hasil alat | ✅ `hasil_status`, `hasil_kunci`, `hasil_kar` di span alat, **tanpa isi** |
| Catat target delegasi & panjang jawaban agent bawahan | ✅ `target`, `tugas_kar`, `hasil_kar`, `jawaban_agen[{agen, kar}]` di span delegasi |
| Argumen alat langkah terakhir | ✅ Dibaca juga dari **respons** stream model, tidak hanya dari permintaan berikutnya |
| Timeout meneruskan pembatalan | ✅ Sampai ke agent bawahan dan ke HTTP (uji offline), **dan sampai ke vLLM** (uji server 24 Nov, lihat §3) |
| Tidak mencatat kredensial / data sensitif | ✅ Lihat 2.3 |
| Verifikasi 465 vs 497 | ✅ Lihat 4.1 |
| Evaluasi ulang data historis tanpa inference | ✅ 4 uji, 465 skenario. Hasil di folder baru `data/agent-workflow-latency/evaluasi-v2/` |

**Dua temuan baru dari evaluasi ulang yang mengoreksi RCA** (rinci di 4.3):
1. **6 jawaban Q8 berisi teks panggilan alat mentah**, misalnya `delegate_task ke Portal, isinya "…"`. Evaluator lama meloloskannya.
2. **Q5 yang berputar sampai batas langkah ada 4, bukan 3.** Satu kasus berakhir tanpa jawaban tetapi lolos evaluator lama karena rancangan sempat terbentuk.

---

## 2. File yang dimodifikasi

### 2.1 Daftar

| File | Jenis | Perubahan |
|---|---|---|
| `scripts/lib/evaluator-agent.mts` | **baru** | Evaluator v2: pendeteksi generik + penilaian per jenis pertanyaan |
| `scripts/lib/skenario-agent.mts` | **baru** | Pemetaan skenario Q1–Q8 → jenis evaluator (satu tempat, dipakai uji & penilaian ulang) |
| `scripts/evaluasi-ulang-v2.mts` | **baru** | Penilaian ulang data lama, hanya membaca, keluaran ke folder baru |
| `scripts/test-evaluator-agent.mts` | **baru** | 42 uji unit evaluator (teks jawaban nyata + kasus "jangan salah tuduh") |
| `scripts/test-batal-agent.mts` | **baru** | Uji offline pembatalan: perute → agent bawahan → server tiruan |
| `scripts/profil-alur-agent.mts` | ubah | Evaluator v2, pembatalan saat timeout, target & panjang delegasi, argumen dari respons stream, progres v2, `--tanpa-batal` |
| `lib/profil-agent.ts` | ubah | `rentang()` menerima peringkas hasil (opsional); `ringkasHasilAlat()` baru |
| `voltagent/tool-konfigurasi.ts` | ubah | Span alat memakai `ringkasHasilAlat` (hanya saat profiling menyala) |
| `package.json` | ubah | `test:evaluator`, `test:batal-agent`, `evaluasi:ulang` |

Keluaran baru (data uji historis **tidak disentuh**): `data/agent-workflow-latency/evaluasi-v2/per-skenario.csv`, `ringkasan.json`.

### 2.2 Sebelum dan sesudah

| Bagian | Sebelum | Sesudah |
|---|---|---|
| Penilaian Q5 | lulus kalau ada rancangan **atau** teks cocok `LAN\|WIRELESS\|sub-kategori\|menyiapkan tiket` | `benar` lama tetap dicatat; **tambah** `nilai_v2`: klaim palsu, pesan perute, kosong & timeout = gagal; penawaran = sebagian; rancangan/klarifikasi = lulus |
| Penilaian Q1 | string persis `"156.770"` tanpa spasi | Normalisasi angka (titik/koma/spasi), plus periode dari argumen alat |
| Penilaian Q8 | gagal kalau ada alat apa pun | Fungsi (teks wajar, bukan pesan internal) terpisah dari efisiensi (delegasi/alat) |
| Span alat | nama, status, durasi | + `hasil_status` (mis. `perlu-perbaikan`), `hasil_kunci` (nama field saja), `hasil_kar` |
| Span delegasi | durasi, status | + `target` (nama agent), `tugas_kar`, `hasil_kar`, `jawaban_agen` (panjang per agent) |
| Argumen alat (`--catat-argumen`) | dari badan permintaan berikutnya saja; langkah terakhir hilang | + dari respons stream (`sumber: "respons"`), dedup per id |
| Timeout 300 dtk | klien berhenti menunggu; agent tetap jalan & memakai slot | `AbortController` → `streamText({ abortSignal })`, dibatalkan saat batas; `--tanpa-batal` = perilaku lama |
| Event info uji | — | + `batal_saat_habis`, `evaluator`, `harapan.q1_angka/q1_periode` (supaya penilaian ulang tidak perlu menebak) |
| `progres.json` | ok/benar/timeout/galat | + `evaluator_v2` per tahap |

### 2.3 Data yang dicatat — dan yang tidak

- **Dicatat:** label status alat, nama field hasil (disaring, hanya yang berbentuk nama field biasa), panjang dalam karakter, nama agent tujuan delegasi.
- **Tidak dicatat:** isi hasil alat (angka, nama karyawan, isi SOP), isi tugas delegasi, isi jawaban agent bawahan.
- **Isi jawaban dan argumen alat** tetap hanya dengan opsi yang sudah ada (`--simpan-jawaban`, `--catat-argumen`), disimpan di `data/` yang tidak ikut Git.
- Tidak ada kunci, URL tunnel, atau kredensial yang masuk catatan.

**Perilaku aplikasi untuk pengguna tidak berubah.** Pembungkus span di `tool-konfigurasi.ts` hanya dipasang kalau `AGENT_PROFILING_ENABLED=1` (bawaan mati). Parameter baru `rentang()` opsional, jadi pemanggil lama tidak terpengaruh.

---

## 3. Validasi

| Pemeriksaan | Hasil |
|---|---|
| `tsc --noEmit` | **0 galat baru.** 8 galat yang ada sudah ada sebelumnya: 6 di `.next/types/` (tipe hasil build lama untuk halaman `app/mr-ai-gateway/*` yang sudah tidak ada) dan 2 di skrip lain yang tidak disentuh (`diagnose-rapor-gagal.mts`, `ukur-skenario-outlet.mts`) |
| `npm run test:evaluator` | **42 lolos, 0 gagal** |
| `npm run test:batal-agent` (offline) | **5 lolos, 0 gagal**: perute menyerahkan ke bawahan; permintaan bawahan **diputus klien 171 ms** sesudah abort; tidak ada permintaan baru |
| `npm run test:gateway-retry` | 22/22 (regresi `lib/profil-agent.ts`) |
| `npm run test:tool-konfig` | 54/54 (regresi `tool-konfigurasi.ts`) |
| `npm run test:agent-konfig` | 23/23 |
| `npm run test:perute` | 5/5. ⚠️ Uji lama ini memanggil **Claude Haiku 4.5 sungguhan** (model bawaannya), 5 permintaan. Tidak ada request ke Qwen |
| **Pembatalan sampai ke vLLM** (24 Nov, setelah server tersambung lagi) | ✅ Satu permintaan stream (`max_tokens` 3.000) lewat tunnel → LiteLLM, diputus klien setelah 4 dtk. Replika yang melayani berhenti di **206 token**, `num_requests_running` kembali 0 dalam 2 dtk, dan penghitung token tetap 206 selama 8 dtk berikutnya. LiteLLM meneruskan pemutusan stream ke vLLM |
| Uji kering skrip benchmark | Belum dijalankan |

---

## 4. Hasil evaluasi ulang data historis

Tanpa inference ulang. Perintah:

```bash
npx tsx scripts/evaluasi-ulang-v2.mts data/agent-workflow-latency/2026-11-17-03-11 \
  data/agent-workflow-latency/arsip-2026-11-20-02-19-4gpu-lama data/agent-workflow-latency/2026-11-20-07-30-4gpu \
  data/agent-workflow-latency/2026-11-23-08-35-14b-seqs4-c10-20 --q1-angka 156770
```

Angka harapan Q1 156.770 terverifikasi. Dari **34 jawaban Q1 yang tercatat** (20 Nov sore: 13, 23 Nov: 21), **33 lolos evaluator lama, dan ke-33 jawaban itu memuat "156.770"**. Satu sisanya (23 Nov, trace `d130aae3`) gagal di kedua evaluator: alat dipanggil tanpa periode dan angkanya tidak sesuai.

> **Koreksi 24 Nov (Tahap 2):** versi awal kalimat ini menulis "semua 34 jawaban Q1 yang lolos evaluator lama". Itu keliru: yang lolos 33 dari 34, sesuai tabel 4.2. Diperiksa ulang dari `evaluasi-v2/per-skenario.csv`.

### 4.1 Verifikasi 465 vs 497

| Uji | Skenario terukur | Pemanasan | Total |
|---|---:|---:|---:|
| 17 Nov (1 GPU) | 97 | 8 | 105 |
| 20 Nov pagi | 97 | 8 | 105 |
| 20 Nov sore | 97 | 8 | 105 |
| 23 Nov (10–20 pengguna) | 174 | 8 | 182 |
| **Jumlah** | **465** | **32** | **497** |

RCA menghitung kegagalan dari 465 skenario terukur. Pengecekan isolasi sesi memakai **semua** panggilan pertama perute, termasuk 32 pemanasan, sehingga 497. Keduanya benar untuk tujuannya masing-masing; selisihnya tepat 32 pemanasan.

### 4.2 Lama vs baru, berdampingan

**(a) Skenario yang jawabannya tercatat** (20 Nov sore + 23 Nov, 271 skenario) — perbandingan adil:

| Kode | n | Lama: lulus | v2: lulus | v2: sebagian | v2: gagal | Kategori v2 yang tidak lulus |
|---|---:|---:|---:|---:|---:|---|
| Q1 | 34 | 33 | 33 | 0 | 1 | periode-kosong 1 |
| Q2 | 33 | 33 | 33 | 0 | 0 | — |
| Q3 | 33 | 33 | 33 | 0 | 0 | — |
| Q4 | 34 | 29 | 29 | 0 | 5 | tanpa-alat-sop 5 |
| **Q5** | 35 | **30** | **21** | **6** | **8** | penawaran 6 · pesan-internal 3 · klaim-tersimpan-palsu 2 · kosong 2 · timeout 1 |
| Q6 | 34 | 34 | 34 | 0 | 0 | — |
| Q7 | 34 | 34 | 34 | 0 | 0 | — |
| **Q8** | 34 | **32** | **28** | 0 | **6** | pesan-internal 6 |
| **Semua** | **271** | **258** | **245** | **6** | **20** | |

Q8 efisiensi (terpisah dari fungsi): efisien 25 · boros 9.

Perbedaan lama → v2, satu per satu:

| Kode | Lama | v2 | Jumlah | Arti |
|---|---|---|---:|---|
| Q5 | lulus | gagal: klaim-tersimpan-palsu | 2 | "Tiket telah dibuat" padahal hanya rancangan (tersimpan 0) |
| Q5 | lulus | gagal: kosong | 1 | Berputar 12× sampai batas langkah, tanpa jawaban, tapi 10 rancangan sempat terbentuk |
| Q5 | lulus | sebagian: penawaran | 6 | Baru menawarkan "Apakah Anda ingin saya menyiapkan tiket?" |
| Q8 | lulus | gagal: pesan-internal | 6 | Teks panggilan alat mentah sampai ke pengguna |
| Q8 | gagal | lulus (boros) | 2 | Jawaban wajar lewat agent + `daftar_sop`; kini dicatat sebagai lambat, bukan gagal |

**(b) Semua 465 skenario** (termasuk uji tanpa catatan jawaban):

| Kode | n | Lama: lulus | v2: lulus | sebagian | gagal | tidak bisa dinilai |
|---|---:|---:|---:|---:|---:|---:|
| Q1 | 60 | 55 | 33 | 0 | 2 | 25 |
| Q2 | 57 | 57 | 57 | 0 | 0 | 0 |
| Q3 | 57 | 57 | 57 | 0 | 0 | 0 |
| Q4 | 58 | 51 | 51 | 0 | 7 | 0 |
| Q5 | 59 | 52 | 21 | 6 | 9 | 23 |
| Q6 | 58 | 58 | 58 | 0 | 0 | 0 |
| Q7 | 58 | 58 | 34 | 0 | 0 | 24 |
| Q8 | 58 | 55 | 28 | 0 | 6 | 24 |
| **Semua** | **465** | **443** | **339** | **6** | **24** | **96** |

"Tidak bisa dinilai" (96) adalah skenario dari 17 Nov & 20 Nov pagi untuk pertanyaan yang kriterianya butuh isi jawaban. Evaluator v2 sengaja **tidak menebak** di sana. Angka lama untuk skenario itu tidak bisa dibuktikan atau dibantah.

### 4.3 Koreksi terhadap laporan RCA

1. **Q8 — temuan baru.** 6 dari 34 jawaban Q8 yang tercatat (18%) berisi panggilan alat yang ditulis sebagai teks, misalnya:
   - `delegate_task ke Portal, isinya "Apa yang bisa saya bantu?"`;
   - `delegate_task {"task": "Halo, kamu bisa bantu apa saja?", "targetAgents": ["Ratu AI Portal"], ...}`.

   Bentuk pertama sama persis dengan contoh di instruksi perute ([agent-konfig.ts:546-549](../voltagent/agent-konfig.ts#L546-L549): `> Kamu: delegate_task ke Marketing, isinya "..."`). Ini pola yang sama dengan Q5, yaitu **contoh di prompt disalin kata demi kata**. RCA menyebut Q8 gagal 3/58; yang sebenarnya gagal fungsi minimal 6, dan Q8 yang memakai alat (3) sebetulnya jawaban wajar. Pola ini tidak ditemukan di Q1–Q7.
2. **Q5 — putaran sampai batas langkah ada 4, bukan 3.** Skenario `23N-870c581b` (16 pengguna): 12 delegasi, 266 dtk, jawaban kosong, rancangan 10. Evaluator lama meloloskannya karena `rancangan > 0` dan status kosong tidak dianggap galat.
3. **Q5 — klaim palsu 2 kasus** dan **penawaran tanpa rancangan 6 kasus**: sesuai RCA. Kini terukur otomatis.
4. **465 vs 497**: lihat 4.1.

---

## 5. Keterbatasan implementasi Tahap 1

- **Pembatalan terbukti untuk permintaan stream, bukan non-stream.** Rantai lengkap terbukti: VoltAgent → agent bawahan → `fetch` (offline, 171 ms) → tunnel → LiteLLM → vLLM (server, berhenti di 206 token). Agent Ratu AI selalu memakai stream. Permintaan **non-stream** yang diputus tetap ditulis server sampai selesai (smoke test 23 Nov); itu tidak berlaku untuk jalur agent.
- **Pembatalan mengubah keterbandingan.** Mulai uji berikutnya, pertanyaan yang habis waktu tidak lagi memakai slot sesudah 300 dtk. Di 16–20 pengguna, ini bisa membuat hasil sedikit lebih baik daripada uji 13–23 Nov. Pakai `--tanpa-batal` untuk perbandingan langsung.
- **Argumen dari respons hanya untuk format chat-completions OpenAI** (gateway LiteLLM). Untuk penyedia lain (Anthropic, Ollama) respons diteruskan tanpa dibaca, sehingga argumen langkah terakhir tetap hanya dari permintaan berikutnya. Aplikasinya tidak terpengaruh.
- **`tiketTersimpan` per skenario tidak diketahui.** Penghitung tiket hanya per uji. Kalau total uji = 0 (semua uji sejauh ini), semua klaim "sudah dibuat" pasti palsu. Kalau suatu uji punya tiket > 0, klaim per skenario jadi tidak bisa dipastikan.
- **Status hasil alat hanya untuk uji baru.** Data 13–23 Nov tidak punya `hasil_status`.
- **Pendeteksi berbasis pola bahasa Indonesia** (klaim, penawaran, klarifikasi). Sudah diuji dengan jawaban nyata, tapi bisa meleset untuk gaya bahasa baru. Satu salah deteksi ("memilih" tidak dikenali) ketahuan saat evaluasi ulang dan sudah diperbaiki.
- **96 skenario lama tidak bisa dinilai ulang** karena isi jawabannya tidak pernah dicatat.
- **Folder ini bukan repositori Git.** Rollback tidak bisa lewat `git revert`; lihat bagian 8.

---

## 6. Rencana teknis Tahap 2 — perbaikan Q5 (F.1–F.3)

> **Update 24 Nov 2026: sudah diimplementasikan, dengan penyesuaian.** Lihat `docs/workflow-agent/implementasi-tahap2-agent-orchestration.md`. Hasil uji API mengubah dua rencana di bawah: `bail()` tidak dipakai (stream web berakhir `abort` tanpa teks), dan `outputGuardrails` diganti penyaring stream sendiri (potongan mentah sudah terkirim sebelum guardrail bekerja).
>
> Teks asli rencana: **Belum diimplementasikan.** Semua API di bawah diverifikasi di `node_modules/@voltagent/core` **2.10.0** (`dist/index.d.ts` & `dist/index.js`). Yang ditandai ⚠️ ada di kode, tetapi perilakunya pada streaming harus dibuktikan dulu dengan uji offline (pola sama dengan `test-batal-agent.mts`) sebelum dipakai.

### 6.1 API VoltAgent yang terverifikasi

| API | Bukti di paket | Kegunaan |
|---|---|---|
| `hooks.onHandoffComplete({ agent, sourceAgent, result, messages, context, bail })` | d.ts 7502-7521; js 30535-30585 | Dipanggil sesudah agent bawahan selesai. `bail(teks?)` **menghentikan perute dan memakai jawaban bawahan sebagai jawaban akhir** (js 32260: "Using bailed subagent result as final output") |
| `hooks.onToolEnd` → `{ output }` | d.ts 7644, `OnToolEndHookResult.output` | Membaca/menimpa hasil alat di agent bawahan |
| `stopWhen` (opsi Agent) | d.ts 8437 (`StopWhen` = `stopWhen` AI SDK) | Kondisi berhenti per langkah, bisa fungsi atas `steps` |
| `prepareStep` (opsi Agent) | d.ts 8448, contoh resmi `{ toolChoice: 'none' }` | Memaksa langkah berikutnya menulis teks, bukan memanggil alat |
| `outputGuardrails` + `modifiedOutput` | d.ts 8294-8304, 8416 | Mengganti teks akhir sebelum dikirim |
| `abortSignal` diteruskan ke bawahan | js 30480, 33771-33778 | (sudah dipakai di Tahap 1) |

### 6.2 Rancangan per butir

| # | Masalah | Mekanisme (kode & state, bukan hanya prompt) | Tempat |
|---|---|---|---|
| 1 | Perute mengarang persetujuan | **Penjaga isi delegasi:** fungsi murni `delegasiSah(tugas, pesanUserTerakhir)`. Kalau tugas memuat persetujuan ("menyetujui", "setuju", "ya") tetapi pesan pengguna terakhir bukan persetujuan → langkah berikutnya dipaksa menjawab (`prepareStep` → `toolChoice: 'none'`), bukan meneruskan. Contoh "User menyetujui…" di prompt diganti contoh bertanda yang tidak bisa disalin mentah | `voltagent/agent-konfig.ts` (`buatRouter`), modul baru `lib/alur/penjaga-delegasi.ts` + uji unit |
| 2 | Agent bawahan butuh klarifikasi | **Sinyal terstruktur dari alat:** `onToolEnd` di agent bawahan menandai operasi kalau alat mengembalikan `status` yang meminta keputusan pengguna (`perlu-perbaikan`, `perlu-diperjelas`, pilihan). Di perute, `onHandoffComplete` membaca tanda itu dan memanggil `bail()`, sehingga pertanyaan bawahan sampai ke pengguna **apa adanya** dan perute berhenti. Ini berlaku untuk semua alat penyusun rancangan, bukan khusus tiket | `voltagent/agent-konfig.ts`, `voltagent/registry-tulis.ts` (status hasil), `lib/alur/penjaga-delegasi.ts` |
| 3 | Delegasi berulang tanpa progres | **`stopWhen` / `prepareStep` atas riwayat langkah:** hitung delegasi ke agent yang sama di permintaan ini. Kalau tugas (dinormalisasi) sama dengan sebelumnya, atau sudah ≥2 ke agent yang sama tanpa pesan pengguna baru, langkah berikutnya `toolChoice: 'none'` | `buatRouter`; fungsi murni `progresDelegasi(steps)` |
| 4 | `maxSteps` tercapai tanpa teks | (a) `prepareStep` memaksa `toolChoice: 'none'` di langkah terakhir (`stepNumber === MAKS_LANGKAH - 1`), sehingga perute selalu menulis sesuatu. (b) Jaring pengaman di jalur web & WA: kalau stream selesai tanpa teks, kirim pesan tetap ("Permintaan ini belum selesai diproses. Coba ulangi atau perjelas.") | `buatRouter`; `app/api/chat/route.ts`; `wa-bot/` |
| 5 | Rancangan diklaim tersimpan | (a) Aturan larangan klaim yang sekarang hanya ada di agent bawahan ([agent-konfig.ts:187-224](../voltagent/agent-konfig.ts#L187-L224)) ikut dipasang di perute. (b) ⚠️ `outputGuardrails` perute: kalau operasi ini mencatat rancangan (`catatRancangan` sudah ada) **dan** teks memuat klaim tersimpan, kalimatnya diganti "Rancangan sudah disiapkan. Tekan Simpan untuk menyimpan." Pendeteksinya memakai `klaimTersimpan()` dari evaluator, dipindah ke `lib/` | `buatRouter`, modul baru `lib/alur/klaim.ts` |
| 6 | Multi-turn yang sah tetap jalan | Penjaga #1 & #3 memakai **pesan pengguna terakhir**: "ya setuju", "LAN", nomor pilihan tetap boleh diteruskan bersama konteks tawaran (alur [agent-konfig.ts:612-624](../voltagent/agent-konfig.ts#L612-L624) dipertahankan). `bail` hanya saat bawahan meminta keputusan pengguna, tidak saat bawahan sudah menyusun rancangan | Uji dua giliran wajib (6.4) |

Temuan Q8 (teks panggilan alat mentah, 4.3 #1) ditangani oleh mekanisme yang sama: contoh `delegate_task ke …, isinya …` di prompt diganti, ditambah jaring pengaman #4b yang juga menangkap teks berbentuk panggilan alat. Ini masuk Tahap 2 karena sumbernya sama.

### 6.3 Yang harus dibuktikan dulu (⚠️) sebelum dipakai

1. `bail()` pada **stream**: apakah teks jawaban bawahan benar-benar sampai ke `toUIMessageStreamResponse` (web) dan ke bot WA, bukan hanya ke `onFinish`. Kode menunjukkan `finalText = bailedResult.response` (js 32260-32285); event stream ke UI belum dibuktikan.
2. `prepareStep` di **perute (supervisor)**: apakah VoltAgent meneruskannya ke AI SDK untuk agent yang memakai `subAgents`.
3. `outputGuardrails` pada streaming: apakah teks yang sudah terkirim per potongan bisa diganti, atau perlu `streamHandler`.
4. Penyedia: semua mekanisme di atas berada di lapisan VoltAgent/AI SDK, jadi berlaku sama untuk Qwen (openai-compatible) dan Anthropic. Ini dibuktikan dengan menjalankan uji offline untuk kedua bentuk penyedia, dengan server tiruan masing-masing format.

Kalau salah satu tidak terbukti, alternatifnya adalah membungkus alat `delegate_task` sendiri (`supervisorConfig`) atau menegakkannya di lapisan route. Keputusannya dilaporkan sebelum implementasi.

### 6.4 Validasi Tahap 2

- Uji unit untuk fungsi murni (`delegasiSah`, `progresDelegasi`, `klaimTersimpan`).
- Uji offline dengan server tiruan:
  - bawahan meminta klarifikasi → perute berhenti dan teks bawahan sampai ke stream;
  - delegasi berulang → berhenti di ≤2;
  - langkah habis → ada teks.
- Uji dua giliran (butuh server): giliran 2 = "LAN" dan giliran 2 = "ya" → rancangan terbentuk, tanpa klaim tersimpan.
- Uji terarah G (butuh server, tidak dijalankan tanpa persetujuan): Q5 20× berurutan + 20× di 12 pengguna dengan evaluator v2. Target: `pesan-internal`, `klaim-tersimpan-palsu`, `kosong`, `timeout` = 0. Regresi Q2, Q3, Q6, Q7.

---

## 7. Risiko regresi

| Perubahan | Risiko | Mitigasi |
|---|---|---|
| **Tahap 1:** pembatalan saat timeout | Uji baru tidak sebanding langsung dengan 13–23 Nov di beban tinggi | `--tanpa-batal`; `batal_saat_habis` dicatat di event info |
| **Tahap 1:** pembungkus fetch membaca respons | Respons stream di-`tee()`; kalau ada bug, uji benchmark bisa terganggu | Hanya aktif dengan `--catat-argumen`; galat pembacaan ditelan; respons asli diteruskan utuh |
| **Tahap 1:** evaluator v2 | Angka akurasi turun karena lebih ketat (Q5 30→21 lulus dari 35) dan bisa dibaca sebagai regresi model | Laporkan `benar` lama dan `nilai_v2` berdampingan |
| **Tahap 1:** `ringkasHasilAlat` di span | Nama field hasil ikut tercatat | Disaring ke pola nama field, maks 12; hanya saat profiling menyala |
| **Tahap 2:** `bail` | Perute tidak lagi merangkai jawaban dua agent kalau salah satunya meminta klarifikasi | `bail` hanya saat ada tanda klarifikasi; uji pertanyaan lintas aplikasi |
| **Tahap 2:** penjaga delegasi | Pertanyaan lanjutan sah ("ya setuju") ikut tertahan | Keputusan berdasarkan pesan pengguna terakhir; uji dua giliran wajib |
| **Tahap 2:** guardrail klaim | Kalimat sah ("tiket yang sudah dibuat minggu lalu") ikut diganti | Hanya aktif kalau operasi ini membuat rancangan baru |

---

## 8. Rollback Tahap 1

Folder `marketing/` **bukan repositori Git**, jadi rollback dilakukan per file:

1. **Matikan perilaku baru tanpa mengubah kode:**
   - pembatalan → jalankan uji dengan `--tanpa-batal`;
   - argumen dari respons → jangan pakai `--catat-argumen`;
   - span tambahan → hanya muncul kalau profiling menyala (`AGENT_PROFILING_ENABLED=1`), yang bawaannya mati.
2. **Hapus file baru** (tidak dipakai aplikasi): `scripts/lib/evaluator-agent.mts`, `scripts/lib/skenario-agent.mts`, `scripts/evaluasi-ulang-v2.mts`, `scripts/test-evaluator-agent.mts`, `scripts/test-batal-agent.mts`, folder `data/agent-workflow-latency/evaluasi-v2/`. Hapus juga tiga baris skrip di `package.json`.
3. **Kembalikan perubahan kecil di kode aplikasi:**
   - `voltagent/tool-konfigurasi.ts`: hapus argumen `, {}, ringkasHasilAlat` di pemanggilan `rentang("alat", …)` dan `ringkasHasilAlat` dari import;
   - `lib/profil-agent.ts`: parameter ke-5 `ringkasHasil` boleh tetap (opsional, tidak mengubah apa pun); `ringkasHasilAlat` boleh dihapus.
4. **`scripts/profil-alur-agent.mts`**: hanya dipakai untuk uji. Kalau perlu versi lama, hapus blok yang ditandai komentar "24 Nov 2026" (pembungkus respons, `BATAL_SAAT_HABIS`, `nilai_v2`, `jenisSkenario`, field delegasi tambahan).
5. Data uji historis tidak pernah diubah, jadi tidak ada yang perlu dipulihkan.

**Untuk Tahap 2:** sebelum mengubah `voltagent/agent-konfig.ts`, salin dulu berkas aslinya (mis. `agent-konfig.ts.sebelum-tahap2`), karena tidak ada Git untuk kembali.
