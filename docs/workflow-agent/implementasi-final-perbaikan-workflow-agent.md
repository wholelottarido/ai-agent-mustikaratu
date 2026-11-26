# Implementasi Final — Perbaikan Workflow Agent Ratu AI (Tahap 1–6)

**Tanggal:** 24 Nov 2026 · **Model sasaran:** Qwen3-14B (4 replika A10G, `max-num-seqs=4`), tetap kompatibel dengan semua penyedia.
**Status:** Tahap 1–6 selesai. Tahap 2–6 tervalidasi **offline** (Tahap 3 menyusul 24 Nov sore). Live inference, smoke test, dan benchmark **belum dijalankan** (menunggu persetujuan; rencana di §11).

Dokumen terkait:
- `docs/workflow-agent/rca-kegagalan-workflow-agent-qwen14b.md` — RCA, rekomendasi F.1–F.8
- `docs/workflow-agent/implementasi-perbaikan-workflow-agent-qwen14b.md` — Tahap 1 (evaluator v2, observability, pembatalan)
- `docs/workflow-agent/implementasi-tahap2-agent-orchestration.md` — Tahap 2 (delegation guard, HITL, loop/idempotency, penyaring stream)
- `docs/workflow-agent/implementasi-tahap3-agent-routing.md` — Tahap 3 (registri kemampuan, penjaga kemampuan sebelum delegasi, fallback terkendali, `status_rute`)

---

## 1. Ringkasan

| Tahap | Isi (RCA) | Status |
|---|---|---|
| 1 | F.5 evaluator v2, observability, pembatalan saat habis waktu | ✅ (24 Nov, disetujui) |
| 2 | F.1–F.3 Q5: persetujuan karangan, putaran, klaim tersimpan, HITL, penyaring stream | ✅ offline |
| 3 | F.4 Q4: rute berdasarkan kemampuan alat, bukan kemiripan kata | ✅ offline + konfigurasi sungguhan (baca saja), 24 Nov sore. Rincian di dokumen Tahap 3 |
| **4** | **F.6 Q1: periode tidak lagi diam-diam diganti bawaan** | ✅ offline |
| **5** | **F.7 Q8: sapaan dijawab tanpa delegasi/alat** | ✅ offline |
| **6** | **F.8: sub-kategori tiket dari data, dipilih pengguna** | ✅ offline + data sungguhan (baca saja) |

**Hasil validasi:**
- **390 pemeriksaan lolos, 0 gagal** di 11 rangkaian uji. Satu rangkaian membaca data sungguhan, hanya `SELECT`.
- **0 galat TypeScript baru.**
- Kontrol negatif Tahap 4–6 (`UJI_TANPA_PENJAGA=1`): **16 dari 20** pemeriksaan integrasi gagal tanpa penjaga. Ini termasuk pola Q5 asli: 12 rancangan dengan sub-kategori karangan.
- Audit integrasi menemukan **3 benturan antar tahap**, dan semuanya sudah diperbaiki (§7).

Prinsip yang dipegang di ketiga tahap:
- Aturan dibaca dari **bentuk** alat (nama argumen, tag, status hasil) dan **kalimat pengguna yang sebenarnya**, bukan dari kode Q1–Q8 atau nama alat tertentu.
- Mekanismenya memakai penjaga Tahap 2 yang sudah terbukti (`onToolStart` → tolak/ubah sebelum alat jalan, `onToolEnd` → tandai hasil, `stopWhen` → berhenti untuk menunggu pengguna).

---

## 2. Tahap 4 — Validasi parameter periode (F.6, Q1)

**Masalah (RCA D.3).** `total_penjualan {}`, yaitu tanpa `dari`/`sampai`/`relatif`, diam-diam menghitung bulan data terakhir. Model menerima angka Oktober untuk pertanyaan September, lalu menjawab "September tidak ada".

**Tool lain dengan pola serupa (hasil audit):**

| Alat | Argumen periode | Bawaan kalau kosong |
|---|---|---|
| `total_penjualan` | `relatif`, `dari`, `sampai` | bulan data terakhir |
| `pergerakan_penjualan` | `bulan`, `relatif`, `dibanding_bulan` | bulan data terakhir (atau sebelumnya kalau baru < 7 hari) |
| `stok_kosong` | `bulan`, `relatif` | bulan data terakhir |
| alat dari setelan Kelola AI | tergantung setelan | tergantung alat |

`ramal_penjualan` juga punya bawaan (3 bulan ke depan), tetapi itu jumlah bulan, bukan periode yang bisa bertentangan dengan pertanyaan, jadi tidak termasuk.

**Perbaikan — dua lapis, umum untuk semua alat baca:**

1. **Sebelum alat jalan (penjaga, `periksaAlat`).** Berlaku untuk alat yang punya argumen periode (nama argumen cocok `POLA_ARG_PERIODE`: `dari`, `sampai`, `bulan`, `relatif`, `periode`, `tahun`, `tanggal_*`…), yang dipanggil dengan **semua argumen periode kosong**, padahal kalimat pengguna menyebut periode.
   - Periode dibaca **oleh kode** (`periodeDalamTeks`): nama/singkatan bulan ± tahun, rentang "juli sampai september 2026", `YYYY-MM`, "tahun 2025", "bulan lalu/ini", "tahun lalu/ini".
   - Panggilan ditolak **sekali**, dengan saran argumen sesuai nama argumen alat itu, mis. `dari="2026-09", sampai="2026-09"`, `bulan="2026-10"`, atau `relatif="bulan_lalu"`.
   - Kalau model tetap mengosongkan, panggilan kedua diloloskan, supaya tidak berputar.
   - Kalimat tanpa periode ("total penjualan terbaru") tidak tertahan dan tidak menambah panggilan.
2. **Sesudah alat jalan (`catatHasilAlat` → `onToolEnd`).** Hasil alat baca yang dipanggil tanpa periode diberi `periode_otomatis: true` + `catatan_periode`: sebut periode yang dipakai, jangan simpulkan periode yang ditanya tidak ada.
3. **Di alatnya sendiri (sesuai RCA).**
   - `total_penjualan` mengisi `periode_otomatis` + `catatan_periode` dengan bulan yang dipakai, dan deskripsinya mewajibkan `dari`/`sampai` kalau pertanyaan menyebut bulan.
   - Deskripsi argumen `bulan` di `pergerakan_penjualan` dan `stok_kosong` diperjelas: "WAJIB diisi kalau user menyebut bulan; kosongkan HANYA untuk data terbaru".

Hasil tetap dikembalikan dengan tanda, tidak diganti `perlu-periode` tanpa angka. Ini varian yang disarankan RCA supaya pertanyaan "terbaru" yang sah tidak butuh panggilan tambahan.

**Dikecualikan:** alat tulis `siapkan_*` (memvalidasi isian wajibnya sendiri lewat `perlu-perbaikan`) dan alat tanpa argumen periode.

---

## 3. Tahap 5 — Optimasi routing sapaan (F.7, Q8)

**Masalah (RCA D.4).**
- Sapaan diserahkan ke agent di 19/58 kemunculan; 3 di antaranya memanggil `daftar_sop`. Waktunya 35–72 dtk, padahal ±8 dtk kalau dijawab langsung.
- 6 dari 34 jawaban berisi teks panggilan alat mentah. Itu sudah ditangani Tahap 2, tetapi penggantinya waktu itu masih "belum selesai diproses".

**Perbaikan:**
1. **Pengenal sapaan yang sempit** (`sapaanAtauKemampuan`). Dikenali: sapaan, terima kasih, dan pertanyaan umum tentang asisten ("kamu bisa bantu apa saja?", "kamu siapa?", "fiturmu apa saja?"). **Seluruh kalimat** harus cocok.
   - Ditolak (tetap diteruskan): "SOP apa saja yang ada?", "halo, tiket saya gimana?", "bisa bantu cek stok?", "kamu bisa bantu saya buat tiket?", "produk apa saja yang dijual?", serta "ya"/"ok".
   - Ini menjaga batas yang pernah kabur pada 26 Okt (catatan di `agent-konfig.ts`).
2. **Penjaga delegasi.** Kalau perute mendelegasikan sapaan, padahal tidak ada tawaran/pertanyaan yang menunggu dan belum ada delegasi di giliran itu:
   - delegasi ditolak (`sapaan-langsung`) dan perute berhenti, jadi tidak ada agent bawahan maupun alat;
   - jawabannya **teks kemampuan** yang disusun `teksKemampuan()` dari **agent & alat yang benar-benar terpasang untuk pemakai itu**. Teks ini ikut berubah kalau setelan Kelola AI berubah, dan tidak menjanjikan kemampuan yang tidak ada;
   - "terima kasih" dijawab "Sama-sama!…".
3. **Pengganti teks mentah.** Sapaan yang jawabannya tersaring habis (perute menulis `delegate_task …` sebagai teks) sekarang dijawab dengan teks kemampuan, bukan "belum selesai diproses". Untuk itu penjaga kini membaca pesan pengguna di `onStart` perute, tidak hanya saat ada delegasi.
4. **Instruksi perute** (aturan 5a). Sapaan & pertanyaan umum dijawab sendiri tanpa `delegate_task`. Pertanyaan tentang isi data/dokumen tetap diteruskan, dengan contoh yang mirip bentuknya.

**Penyaring Tahap 2 tetap utuh.** Teks kemampuan lewat `saring()` tanpa berubah, dan teks alat mentah tetap dibuang (audit §7).

---

## 4. Tahap 6 — Validasi kategori & sub-kategori tiket (F.8)

**Masalah (RCA C.2/D.2).** `sub_kategori` teks bebas. Model mengarang ("INTERNET"), lalu perute memilihkan. Validasinya sendiri sudah benar: `cocokkan()` membaca `category`/`sub_category` lewat setelan `buat_tiket`, dan pencocokannya satu arah. Yang kurang ada dua: model **tidak punya daftar** sebelum menebak, dan nilai yang **sah tetapi tidak dipilih pengguna** (mis. "LAN" untuk "internet mati") diterima.

**Perbaikan:**
1. **Daftar sah dari data** (`lib/entri/tiket.ts`). Kategori atau sub-kategori yang kosong kini menghasilkan masalah `kurang` + `pilihan` berisi daftar dari database. Sub-kategori disempitkan ke kategori terpilih. Pesannya: "… belum dipilih. Pilihannya: …. Tanyakan ke pengguna."
2. **Skema alat** (`siapkan_tiket`):
   - `kategori` & `sub_kategori` kini opsional;
   - contoh nilai karangan dihapus ("NETWORK", "LAPTOP" dsb. dulu bisa disalin model);
   - deskripsi mewajibkan sub-kategori hanya dari kata pengguna atau pilihannya, dan mengosongkan kalau belum disebut;
   - alat diberi tag `pilihan-pengguna:sub_kategori`.
3. **Penjaga "pilihan harus dari pengguna"** (`periksaAlat`, umum untuk alat bertag).
   - Nilai argumen bertag yang **tidak berasal dari kata pengguna** (`pilihanBerdasar`: label muncul di pesan pengguna; tanda baca/spasi diabaikan; jawaban nomor dipetakan ke daftar yang tampil) **dikosongkan sebelum alat jalan**.
   - Akibatnya alat sendiri memulangkan daftar sah. Lalu HITL Tahap 2 menghentikan perute, dan pertanyaan beserta pilihannya sampai ke pengguna.
   - Sumber kebenarannya **riwayat pesan pengguna**, bukan isi tugas delegasi, karena perute bisa menyisipkan pilihan ke tugas.
   - Kategori (penafsiran keluhan) tidak dikunci; kartu konfirmasi tetap menampilkan keduanya untuk dikoreksi.
4. **Tombol pilihan di web.**
   - Masalah berpilihan (2–20) dari alat tulis apa pun kini ikut dikirim sebagai `klarifikasi` (`klarifikasiTulis`), lewat jalur dan komponen tombol yang sama dengan "produk yang mana?". Tidak ada perubahan UI dan tidak ada alat baru.
   - Tombol mengirim "Label (kode X)". `cocokkan()` sekarang mencocokkan `(kode X)` **persis** ke `nilai`; kode yang tidak dikenal dibuang lalu label dicocokkan seperti biasa. Aturan satu arah tidak dilonggarkan.
5. **Integrasi dengan guard yang ada:**
   - HITL: `kurang` + `pilihan` → `butuhKeputusanPengguna` → berhenti;
   - delegation guard: perute yang mencoba "Pengguna memilih LAN" ditolak;
   - idempotency: tebakan kedua yang juga karangan dikosongkan → identik dengan panggilan pertama → tidak dijalankan lagi;
   - `menunggu-pengguna` tetap aktif.

**Data sungguhan (baca saja):** HARDWARE punya 4 sub-kategori (LAPTOP, OTHERS, PC, PRINTER). Sub-kategori kosong memulangkan keempatnya sebagai 4 tombol. Jawaban tombol berkode UUID dikenali dan rancangan tersusun. Jumlah `portal_ticket` tidak berubah.

---

## 5. File yang dimodifikasi

### 5.1 Tahap 4–6 (cadangan `.cadangan/tahap4-6-2026-11-24-1139/`)

| File | Perubahan | Baris diff |
|---|---|---:|
| `lib/alur/pola-teks.ts` | `sapaanAtauKemampuan`, `periodeDalamTeks`, `POLA_ARG_PERIODE`, `pilihanBerdasar` | 106 |
| `lib/alur/penjaga-alur.ts` | Aturan sapaan, periode, pilihan-pengguna; `MetaAlat`; teks penutup sapaan; `pakaiKemampuan`; sidik memakai hasil yang dilihat model | 144 |
| `voltagent/kendali-alur.ts` | `metaAlat()` (argumen & tag dari definisi alat), hasil pengganti di `onToolEnd`, `mulai()` di `onStart`, `teksKemampuan()` | 51 |
| `voltagent/agent-konfig.ts` | Aturan 5a sapaan di instruksi perute; teks kemampuan ke penjaga | 13 |
| `voltagent/tools-penjualan.ts` | `periode_otomatis` + catatan di `total_penjualan`; deskripsi `bulan` | 16 |
| `voltagent/tools-stok.ts` | Deskripsi `bulan` | 2 |
| `voltagent/registry-tulis.ts` | Skema `siapkan_tiket` (opsional, tanpa contoh karangan, tag); `klarifikasiTulis`; pembungkus jejak meneruskan opsi eksekusi | 43 |
| `lib/entri/tiket.ts` | `kurang` + `pilihan` untuk kategori & sub-kategori | 12 |
| `lib/entri/pilihan.ts` | `cocokkan()` mengenali "(kode X)" persis | 9 |
| `scripts/profil-alur-agent.mts` | Delegasi yang ditolak penjaga tidak dihitung; field `delegasi_ditolak`; span `ditolak` | 12 |
| `package.json` | `test:tahap4-6`, `test:pilihan-tiket`, `test:audit-integrasi`, `test:alur-semua` | 4 |

Baru: `scripts/test-tahap4-6.mts`, `scripts/test-pilihan-tiket-data.mts`, `scripts/test-audit-integrasi.mts`, dokumen ini.

### 5.2 Kumulatif Tahap 1–6

| Lapisan | File |
|---|---|
| Penjaga (murni) | `lib/alur/pola-teks.ts`, `lib/alur/penjaga-alur.ts`, `lib/alur/jaga-stream.ts` |
| Penyambung VoltAgent | `voltagent/kendali-alur.ts`, `voltagent/agent-konfig.ts`, `voltagent/jalur-agent.ts` |
| Jalur web | `app/api/chat/route.ts` |
| Alat | `voltagent/tools-penjualan.ts`, `voltagent/tools-stok.ts`, `voltagent/registry-tulis.ts`, `voltagent/tool-konfigurasi.ts` (T1: span), `lib/entri/tiket.ts`, `lib/entri/pilihan.ts` |
| Observability | `lib/profil-agent.ts` (T1) |
| Benchmark & evaluator | `scripts/profil-alur-agent.mts`, `scripts/uji-alur-tiket.mts`, `scripts/lib/evaluator-agent.mts` (T1, **tidak disentuh sejak T1**), `scripts/lib/skenario-agent.mts`, `scripts/evaluasi-ulang-v2.mts` |
| Uji | `scripts/lib/server-tiruan.mts`, `scripts/test-*.mts` (lihat §6) |

**Tidak disentuh:**
- model, Docker, LiteLLM, vLLM;
- tabel `ai_agent`/`ai_tool`/setelan bersama;
- database produksi (tidak ada operasi tulis);
- data benchmark historis;
- bot WhatsApp;
- komponen UI.

---

## 6. Hasil validasi

Dijalankan 24 Nov 2026, tanpa model sungguhan. Uji yang membaca PostgreSQL perusahaan **hanya SELECT**. `test:perute`, `test:tulis-umum`, `test:tiket-ubah` **sengaja tidak dijalankan**: yang pertama memanggil Claude sungguhan, dua lainnya menulis ke database.

| Rangkaian | Hasil | Isi |
|---|---|---|
| `test:api-voltagent` (T2) | 27/27 | API VoltAgent, OpenAI-compatible & Anthropic |
| `test:penjaga-alur` (T2) | 77/77 | Unit penjaga & penyaring stream |
| `test:alur-tahap2` (T2) | 49/49 | Integrasi offline 2 format |
| **`test:tahap4-6`** | **86/86** | Unit sapaan/periode/pilihan + integrasi offline 2 format |
| **`test:audit-integrasi`** | **24/24** | Konsistensi antar tahap (§7) |
| **`test:pilihan-tiket`** | **8/8** | Tahap 6 dengan data sungguhan (baca saja) |
| `test:evaluator` (T1) | 42/42 | Evaluator v2 |
| `test:batal-agent` (T1) | 5/5 | Pembatalan ke agent bawahan |
| `test:jalur` | 12/12 | Perakitan jalur |
| `test:agent-konfig` | 23/23 | Perakitan agent & alat |
| `test:tiket` | 37/37 | Penyusun rancangan tiket (data sungguhan, baca saja) |
| **Jumlah** | **390/390** | |
| `tsc --noEmit` | 0 galat baru | 8 galat lama di file yang tidak disentuh (`.next/types`, `diagnose-rapor-gagal`, `ukur-skenario-outlet`) |
| Akhir baris | sama dengan aslinya di semua 13 file | diperiksa terhadap cadangan |

**Kontrol negatif** (`UJI_TANPA_PENJAGA=1 npm run test:tahap4-6`): 16 dari 20 pemeriksaan integrasi gagal.

| Skenario | Tanpa penjaga | Dengan penjaga |
|---|---|---|
| Q1 tanpa periode | alat jalan dengan `{}` | alat hanya jalan dengan `dari=2026-09` |
| Q8 sapaan | delegasi + `daftar_sop` | 0 agent bawahan, 0 alat, jawaban dari daftar agent |
| Q8 teks mentah | `delegate_task ke Portal…` sampai ke pengguna | teks kemampuan |
| Tiket "internet mati" | **12 rancangan** "LAN" (putaran sampai batas langkah), jawaban kosong | sub-kategori dikosongkan → 1 eksekusi → pengguna ditanya LAN/WIFI |

Yang tetap lolos tanpa penjaga memang hal yang harus tetap jalan: "SOP apa saja yang ada?" diteruskan, dan teks mock yang sudah benar.

---

## 7. Audit integrasi Tahap 1–6

### 7.1 Benturan yang ditemukan dan diperbaiki

| # | Antara | Benturan | Perbaikan |
|---|---|---|---|
| 1 | T1 (benchmark/evaluator) ↔ T2/T5 | Delegasi yang **ditolak** penjaga tetap muncul sebagai `tool-call delegate_task`, jadi `delegasi` terhitung. Evaluator v2 akan menilai sapaan yang dijawab langsung sebagai "boros" | `profil-alur-agent.mts`: `delegasi = total − ditolak`, field baru `delegasi_ditolak` (kode), span berstatus `ditolak`. Evaluator tidak diubah |
| 2 | T2 (idempotensi) ↔ T4 (tanda periode) | Hasil yang disimpan untuk dipakai ulang adalah hasil **sebelum** diberi `periode_otomatis` | Sidik menyimpan hasil yang **dilihat model** |
| 3 | T6 (tombol) ↔ pencocokan pilihan | Tombol mengirim "LAN (kode 12)", padahal `cocokkan()` hanya kenal label, sehingga pengguna ditanya ulang | `cocokkan()` mencocokkan kode persis; diuji dengan data sungguhan (UUID) |

### 7.2 Diperiksa dan konsisten (`test:audit-integrasi`)

| Titik temu | Hasil |
|---|---|
| Teks sisipan penjaga (kemampuan, rancangan belum tersimpan, jujur, terima kasih, HITL) dinilai evaluator v2 | Tidak ada yang dianggap pesan internal atau klaim tersimpan. Sapaan → `lulus/efisien`; pengganti klaim → `lulus`; HITL → `lulus/klarifikasi`; pesan jujur → `gagal/lain` (jujur, tidak disamarkan jadi lulus) |
| Q1 dengan panggilan pertama ditolak + panggilan kedua berperiode | Evaluator `cekPeriode` = "sesuai" → lulus |
| Penyaring T2 terhadap teks T5/T6 | Kelimanya lolos utuh, juga saat penyaring klaim aktif |
| Pola penjaga vs evaluator (sengaja terpisah) | Sepakat untuk kalimat klaim baku |
| Pengosongan pilihan (T6) vs sidik (T2) | Pengosongan terjadi sebelum sidik dihitung; tebakan kedua → `alat-berulang` |
| Sapaan (T5) vs persetujuan (T2) | "ok"/"ya" sesudah tawaran diteruskan; "terima kasih" sesudah tawaran **bukan** sapaan dan **bukan** persetujuan |
| Pemegang penjaga dipakai ulang | Teks kemampuan tetap berlaku di operasi berikutnya |
| Pembatalan T1 lewat penyaring T2 | Terbukti di `test:alur-tahap2` #13 |
| Prompt perute | Aturan 5a ditulis sebagai satu-satunya **pengecualian** dari aturan 1–2 (meneruskan). Aturan "jawaban pendek diteruskan" tetap; penjaga sapaan tidak aktif saat ada tawaran yang menunggu |
| Saklar `PENJAGA_ALUR=mati` | Mematikan semua penjaga T2–T6. Perubahan di **alat** (tanda periode, skema & daftar tiket, kode tombol) **tetap aktif**, karena itu perbaikan data, bukan penjaga |

---

## 8. Risiko regresi

| Perubahan | Risiko | Mitigasi |
|---|---|---|
| T4: penolakan sekali saat periode kosong | +1 panggilan LLM per kasus (yang lupa periode; di data 23 Nov 1/21) | Hanya kalau kalimat menyebut periode; maksimal sekali per alat per giliran |
| T4: pembaca periode | Salah baca singkatan bulan (mis. "mei" sebagai kata lain, "des") atau tahun salah untuk bulan tanpa tahun | Saran hanya di pesan ke model; model tetap yang mengisi argumen. Aturan tahun sama dengan instruksi agent |
| T4: tanda `periode_otomatis` di semua alat baca berargumen periode | Alat dari setelan Kelola AI dengan argumen bernama mirip ikut ditandai | Tanda bersifat tambahan; isi hasil tidak diubah |
| T5: sapaan tidak didelegasikan | Pertanyaan kemampuan yang sebenarnya butuh data bisa terjawab umum | Pengenal menuntut seluruh kalimat cocok; 10 kalimat negatif diuji. Contoh batas ada di prompt |
| T5: jawaban sapaan dari daftar alat | Nama alat dari setelan bisa kurang ramah dibaca | Diambil dari `nama` alat (yang tampil di Kelola AI); maks 6 per agent |
| T6: sub-kategori dikosongkan kalau tidak disebut | Satu giliran tanya tambahan, walau tebakan model sebenarnya tepat. Sinonim ("wifi" vs "WIRELESS") dianggap tidak berdasar | Disengaja: pengguna yang memutuskan. Tombol membuat jawabannya satu klik |
| T6: skema `kategori`/`sub_kategori` opsional | Model lebih sering mengirim kosong | Alat memulangkan daftar; HITL menghentikan perute |
| T6: tombol untuk SEMUA alat tulis berpilihan | Alat tulis umum lain ikut mendapat tombol | Hanya 2–20 pilihan dengan bentuk sah. Jalur tombolnya sudah dipakai produksi |
| T6: `cocokkan()` mengenali "(kode X)" | Dipakai bersama alat tulis umum | Kode harus persis; tanpa kode perilakunya identik dengan sebelumnya. `test:tulis-umum` (menulis DB) belum dijalankan; perlu izin |
| Benchmark: `delegasi` kini tanpa yang ditolak | Angka delegasi uji baru tidak sebanding langsung dengan 13–23 Nov | `delegasi_ditolak` dicatat terpisah, jadi total lama = `delegasi + delegasi_ditolak` |

---

## 9. Keterbatasan

- **Semua bukti offline.** Perilaku Qwen3-14B terhadap pesan `perlu-periode`, `sapaan-langsung`, dan sub-kategori yang dikosongkan belum diukur.
- ~~Q4 (F.4) belum diperbaiki.~~ **Dikerjakan di Tahap 3 (24 Nov sore)**, lihat `implementasi-tahap3-agent-routing.md`:
  - regresi gabungan **532/532** (390 di atas + 142 Tahap 3);
  - keterbatasannya ada di §19 dokumen itu.
- **Pengenal sapaan & pembaca periode berbasis pola bahasa Indonesia.** "minggu ini", "kuartal 3", dan "semester lalu" tidak dikenali, sehingga tidak dijaga. Tidak salah, tetapi tidak dilindungi.
- **Kategori tiket tidak dikunci** ke kata pengguna (hanya sub-kategori). Kategori salah tetap bisa lolos sampai kartu konfirmasi.
- **`test:tulis-umum` dan `test:tiket-ubah` tidak dijalankan** karena menulis ke database. `cocokkan()` bersama diuji lewat `test:tiket` dan `test:pilihan-tiket`.
- **Bot WhatsApp memakai jalur lama** (bukan perute). Penjaga T2–T6 tidak berlaku di sana. Perubahan alat (tanda periode, skema tiket) berlaku kalau alat itu dipakai jalur lama.
- **Evaluator untuk skenario kontrol baru** ("total penjualan terbaru", "SOP apa saja yang ada?", "printer bergaris") belum ada di `profil-alur-agent.mts`. Daftarnya tetap Q1–Q8; perlu ditambahkan sebelum L4 (§11).
- **Penutupan tab browser** di tengah jawaban web: `req.signal` belum diteruskan ke `streamText` (Tahap 2 §12, E4).

---

## 10. Rollback

1. **Cepat, tanpa ubah kode:** `PENJAGA_ALUR=mati` lalu restart. Ini mematikan penjaga T2–T6 (sapaan, periode, pilihan, delegation guard, HITL, penyaring stream). Perubahan alat dan prompt tetap aktif.
2. **Pulihkan file Tahap 4–6:**

   ```bash
   node .cadangan/tahap4-6-2026-11-24-1139/pulihkan.mjs              # simulasi
   node .cadangan/tahap4-6-2026-11-24-1139/pulihkan.mjs --jalankan
   ```

   - Sidik SHA-256 diperiksa dulu; cadangan rusak = berhenti tanpa menimpa apa pun.
   - Lalu 13 file dipulihkan, dan 4 file baru dipindah ke `dibuang-<waktu>/`.
3. **Kalau Tahap 2 juga dibatalkan:** jalankan langkah 2 **lebih dulu**, lalu `node .cadangan/tahap2-2026-11-24-1043/pulihkan.mjs --jalankan`. Urutannya penting, karena cadangan Tahap 2 diambil sebelum Tahap 4–6.
3a. **Tahap 3 (ditambahkan 24 Nov sore):**
   - Cepat: `RUTE_KEMAMPUAN=mati`. Ini hanya mematikan Tahap 3; penjaga T2/T4–T6 tetap menyala.
   - File: `node .cadangan/tahap3-2026-11-24-1353/pulihkan.mjs --jalankan`.
   - Kalau semua tahap dibatalkan, urutannya **Tahap 3 → Tahap 4–6 → Tahap 2**.
   - Dokumen sudah dipindah ke `docs/workflow-agent/`, sehingga skrip Tahap 2 dan 4–6 menyebut jalur lama. Jalankan dulu `node .cadangan/rapikan-docs-2026-11-24/pulihkan.mjs --jalankan`.
4. Tahap 1 tidak terpengaruh kedua rollback di atas. Cadangan tidak berisi kredensial, dan `/.cadangan/` sudah ada di `.gitignore`.

---

## 11. Rencana pengujian menyeluruh (live) — PERLU PERSETUJUAN

**Prasyarat:**
- g5.12xlarge menyala; 4 replika `qwen3-14b`, `max-num-seqs=4` (konfigurasi A);
- tunnel & `AI_BASE_URL_2` mutakhir; model portal `mr-ai-gateway-4gpu`.

Tidak ada perubahan Docker/LiteLLM/vLLM, dan **tidak memakai Anthropic**. Semua uji membaca database saja: rancangan tidak pernah disimpan, dan `uji-alur-tiket` memeriksa jumlah tiket.

| Fase | Perintah (opsi server seperti uji sebelumnya) | Permintaan | Tujuan / kriteria lulus |
|---|---|---:|---|
| **L0** kering | `profil-alur-agent.mts --model mr-ai-gateway-4gpu --dry-run` | 0 | Kesehatan, setelan replika |
| **L1** fungsi, A-B | `--fase berurutan --kode Q1,Q5,Q8 --ulang 5 --simpan-jawaban --catat-argumen --label final-on`, lalu sama dengan `PENJAGA_ALUR=mati --label final-off` | 30 | Q1: angka 156.770 + periode "sesuai", `periode-kosong`=0. Q5: `pesan-internal`=`klaim-tersimpan-palsu`=`kosong`=`timeout`=0. Q8: `pesan-internal`=0, efisiensi "efisien" ≥ 80%, median < 15 dtk |
| **L2** multi-giliran | `uji-alur-tiket.mts normal mr-ai-gateway-4gpu` × 5 | ±15 | Giliran 1 bertanya dengan pilihan sah (bukan menebak). Rancangan setelah pengguna memilih. Tiket tersimpan = 0 |
| **L3** regresi | `--fase berurutan --ulang 5 --label final-regresi` | 40 | Q2, Q3, Q6, Q7 lulus seperti 23 Nov. Q4 kini diukur sebagai hasil Tahap 3, dengan A-B Q4 tersendiri di R1 dokumen Tahap 3 (§21) |
| **L4** kontrol | butuh tambahan pertanyaan kontrol di skrip (belum dibuat): "total penjualan terbaru", "SOP apa saja yang ada?", "printer saya bergaris, buatkan tiket", "terima kasih" | ±16 | "terbaru" 1 panggilan + periode disebut; "SOP apa saja" tetap `daftar_sop`; "printer" tanpa giliran tanya tambahan; "terima kasih" tanpa delegasi |
| **L5** pembatalan e2e | Tahap 2 §12 E1–E4 (`--kode Q5 --timeout 15`, baca `/metrics`) | ±3 | vLLM berhenti ≤ 5 dtk sesudah batas; E4 menjawab soal tutup tab |
| **L6** beban | `--fase beban --concurrency 10,12,16,20 --label final-beban` (+ satu putaran `--tanpa-batal` untuk keterbandingan dengan 23 Nov) | ±150–300 | Akurasi v2 per tahap tidak turun dibanding 1 pengguna. `delegasi_ditolak` & `penjaga` dianalisis. Antrean vLLM dibandingkan dengan 23 Nov |

**Urutan dan titik berhenti:**
- L0 → L1. **Berhenti dan laporkan** kalau L1 gagal kriteria.
- Lalu L2 → L3 → L5.
- L4 setelah skrip kontrol ditambahkan.
- L6 terakhir, dan hanya kalau L1–L3 lulus.

**Biaya:**
- L0–L5 ±100 permintaan, ±1–1,5 jam GPU (≈ $8–12 pada $7,94/jam);
- L6 ±1–1,5 jam lagi.

Keputusan yang diperlukan sebelum mulai:
1. persetujuan menjalankan L0–L5;
2. ~~apakah Q4 (F.4) dikerjakan dulu~~ — sudah dikerjakan (Tahap 3); tambahan R1–R4 ada di dokumen Tahap 3 §21;
3. persetujuan menambah pertanyaan kontrol L4 ke skrip benchmark;
4. persetujuan L6 terpisah sesudah hasil L1–L3.
