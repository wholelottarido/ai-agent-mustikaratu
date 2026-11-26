# Implementasi Tahap 2 — Agent Orchestration Reliability (Qwen3-14B)

**Tanggal:** 24 Nov 2026 · **Status:** implementasi + uji offline **selesai**. Live inference dan benchmark **belum dijalankan** (menunggu persetujuan).
**Dasar:** `docs/workflow-agent/rca-kegagalan-workflow-agent-qwen14b.md`, `docs/workflow-agent/implementasi-perbaikan-workflow-agent-qwen14b.md` §6.
**Paket terpasang yang diverifikasi:** `@voltagent/core` 2.10.0 · `ai` 6.0.290 · `@ai-sdk/openai-compatible` 2.0.78 · `@ai-sdk/anthropic` 3.0.122.

---

## 1. Ringkasan implementasi

Perbaikan ditegakkan **di kode dan state**, bukan hanya di prompt. Prompt ikut dirapikan, tetapi tidak ada aturan yang bergantung pada model menurut.

| Tujuan | Mekanisme | Bukti offline |
|---|---|---|
| Perute tidak mengarang persetujuan | Isi `delegate_task` divalidasi **sebelum dijalankan**. Persetujuan/pilihan di tugas harus cocok dengan pesan terakhir pengguna dan dengan tawaran/pertanyaan yang memang menunggu | 2a–2c, 4a–4b, 6a |
| Perute tidak menjawab pertanyaan agent bawahan | Agent bawahan yang sudah bertanya pada giliran ini tidak boleh ditanya lagi. Delegasinya ditolak dan alur berhenti | 3a–3b |
| Human-in-the-loop | Status alat yang meminta keputusan pengguna (`perlu-perbaikan` dengan pilihan/kurang, `perlu-diperjelas`) atau tawaran tindakan → perute **berhenti** dan pertanyaan agent sampai ke pengguna apa adanya | 1a–1d, 2b |
| Tidak looping | Batas per agent tujuan (3) dan total (6) per giliran. Tugas yang sama/mirip (Jaccard ≥ 0,75) ke agent yang sama ditolak. `maxSteps` **tetap 12** | 8, 9, unit |
| Rancangan tidak berulang | Sidik alat = sesi + permintaan + agent + alat + argumen yang dinormalisasi. Panggilan identik tidak dijalankan; hasil sebelumnya dipakai ulang | 7 |
| Agent bawahan tidak memilihkan | Sesudah alat tulis minta keputusan, nilai baru yang tidak ditulis pengguna ditolak (`menunggu-pengguna`) | unit |
| Tidak ada jawaban kosong | Langkah terakhir dipaksa menulis teks (`toolChoice: none`). Kalau tetap kosong: hasil valid terakhir → status rancangan → pesan jujur | 9a–9b, 4b, 10b |
| Tidak ada klaim "sudah tersimpan" | Kalimat klaim diganti status **aktual** dari hasil alat ("rancangan sudah disiapkan dan belum tersimpan, tekan Simpan") | 5c |
| Tidak ada teks internal / panggilan alat mentah | Penyaring stream per kalimat, **sebelum** potongan dikirim ke browser | 10a–10c |
| Multi-turn sah tetap jalan | "LAN", "2", "ya setuju" sesudah tawaran yang sah diteruskan, dan konteks pertanyaan sebelumnya ditempel otomatis ke tugas | 5a, 6a–6b |
| Tidak tercampur antar pengguna | Penjaga dibuat per permintaan (closure), tanpa variabel modul | 11, 12, API-G |

Hasil uji: **235 pemeriksaan lolos, 0 gagal** di 7 rangkaian (rincian di §8). Kontrol negatif membuktikan uji integrasi benar-benar menguji penjaga: skenario yang sama **tanpa** penjaga gagal 40 dari 49 pemeriksaan, termasuk pola Q5 asli (12 panggilan perute, jawaban kosong).

Inkonsistensi Q1 di laporan Tahap 1 §4 **sudah diverifikasi dan dikoreksi**. Dari 34 jawaban Q1 yang tercatat, **33** lolos evaluator lama (bukan "semua 34"), dan ke-33 itu memuat 156.770. Satu sisanya (`d130aae3`, 23 Nov) gagal di kedua evaluator karena periodenya kosong. Tabel 4.2 sudah benar; yang salah hanya kalimat pembukanya.

---

## 2. Daftar file

### 2.1 Diubah (cadangan tersedia, lihat §10)

| File | Perubahan |
|---|---|
| `voltagent/agent-konfig.ts` | `buatAgentDariKonfig` & `buatRouter` menerima `penjaga` (opsional) dan memasang hook. Instruksi perute: contoh yang dulu disalin mentah diganti (`delegate_task ke Marketing, isinya …` dan `User menyetujui tawaran sebelumnya: …`), ditambah larangan menyatakan persetujuan atas nama pengguna, larangan klaim tersimpan, dan cara menanggapi `ditolak-penjaga`. 48 baris diff |
| `voltagent/jalur-agent.ts` | Membuat pemegang penjaga per permintaan. `HasilJalur.penjaga()`. Saklar `PENJAGA_ALUR=mati` |
| `app/api/chat/route.ts` | Stream UI perute dibungkus `jagaStream(…, "ui")` sebelum dikirim. Ringkasan penjaga dicatat ke log (tanpa isi pesan) hanya kalau ada yang ditindak |
| `scripts/profil-alur-agent.mts` | Jawaban dibaca sesudah penyaring. Event `q` mendapat field `penjaga` (kode penolakan, alasan berhenti, jenis penutup). Event `info` mendapat `penjaga_alur`. Opsi baru `--kode Q5,Q8`. Evaluator v2 tetap dipakai |
| `scripts/uji-alur-tiket.mts` | Jawaban dibaca sesudah penyaring (harness 3 giliran untuk smoke test) |
| `package.json` | `test:api-voltagent`, `test:penjaga-alur`, `test:alur-tahap2`, `test:tahap2` |
| `.gitignore` | `/.cadangan/` |
| `docs/workflow-agent/implementasi-perbaikan-workflow-agent-qwen14b.md` | Koreksi kalimat Q1 (33 dari 34) |

### 2.2 Baru

| File | Isi |
|---|---|
| `lib/alur/pola-teks.ts` | Pola teks murni: klaim persetujuan, tawaran/klarifikasi tertunda, panggilan alat mentah, klaim tersimpan, status alat "butuh keputusan pengguna", sidik argumen |
| `lib/alur/penjaga-alur.ts` | State per permintaan + semua aturan (§4–§6). Murni: tanpa VoltAgent, DB, jaringan |
| `lib/alur/jaga-stream.ts` | Penyaring stream per kalimat + penyisip teks penutup, untuk bentuk `ui` dan `full` |
| `voltagent/kendali-alur.ts` | Penyambung ke VoltAgent: `hookBawahan()`, `kendaliPerute()` |
| `scripts/lib/server-tiruan.mts` | Server model tiruan format OpenAI-compatible **dan** Anthropic |
| `scripts/test-api-voltagent.mts` | Verifikasi API VoltAgent di paket terpasang (§7) |
| `scripts/test-penjaga-alur.mts` | Uji unit |
| `scripts/test-alur-tahap2.mts` | Uji integrasi offline + kontrol negatif (`UJI_TANPA_PENJAGA=1`) |
| `.cadangan/tahap2-2026-11-24-1043/` | Cadangan `.bak`, `MANIFEST.txt` (SHA-256), `pulihkan.mjs` |

**Tidak disentuh:** model, Docker, LiteLLM, vLLM, tabel `ai_agent`/`ai_tool`, database produksi, data benchmark historis, evaluator v2 (`scripts/lib/evaluator-agent.mts`), dan bot WhatsApp.

---

## 3. Arsitektur sebelum dan sesudah

**Sebelum** — semua keputusan alur ada di tangan model perute:

```
pengguna → perute ──delegate_task(tugas bebas)──▶ agent bawahan ──▶ alat
              ▲                                         │
              └──────────── jawaban teks ◀──────────────┘
           (perute boleh mendelegasikan lagi dengan tugas apa pun,
            sampai maxSteps 12; teks apa pun langsung di-stream ke browser)
```

**Sesudah** — model tetap memilih, tetapi setiap langkah melewati penjaga:

```
pengguna → perute ─[onToolStart: periksaDelegasi]─▶ agent bawahan ─[onToolStart: periksaAlat]─▶ alat
              │        ✗ ditolak = alat TIDAK jalan          │        ✗ identik / memilihkan = TIDAK jalan
              │        ✓ boleh (+ konteks klarifikasi)        │ [onToolEnd: catat status AKTUAL]
              │                                              ▼
              │◀──────── [onHandoffComplete: catatHandoff] ── jawaban
              │          butuh keputusan pengguna / tawaran → berhenti
              │
              ├─ prepareStep: berhenti atau langkah terakhir → toolChoice "none"
              ├─ stopWhen:    [stepCountIs(12), penjaga.harusBerhenti]
              ▼
     toUIMessageStream ─▶ jagaStream: tahan per kalimat → saring → kirim
                                      sebelum finish → sisip teks penutup
                                    ─▶ browser
```

---

## 4. Delegation guard

Dijalankan di `onToolStart` perute untuk `delegate_task`. Kalau ditolak, `GalatPenjaga` dilempar **sebelum** `execute`, jadi agent bawahan tidak pernah dipanggil. `onToolError` lalu mengubahnya menjadi hasil alat `{status: "ditolak-penjaga", kode, pesan}` yang dibaca model (terbukti API-A1–A3, dua format).

| Kode | Kapan | Berhenti? |
|---|---|---|
| `persetujuan-karangan` | Tugas menyatakan pengguna menyetujui/memilih/mengonfirmasi, padahal **salah satu** dari ini terjadi: tidak ada tawaran/pertanyaan yang menunggu; pesan terakhir penolakan; untuk tawaran, jawabannya bukan persetujuan **atau** isi tugas tidak sesuai tawaran; untuk klarifikasi, pilihan di tugas tidak ditulis pengguna (nomor "2" dipetakan ke pilihan kedua); atau agent bawahan **sudah menjawab** di giliran ini | Tidak pada teguran pertama sebelum ada jawaban agent (perute boleh memperbaiki tugasnya). Ya untuk yang berikutnya atau sesudah ada jawaban agent |
| `menjawab-atas-nama-pengguna` | Agent tujuan sudah bertanya/menawarkan di giliran ini | Ya |
| `delegasi-berulang` | Tugas ke agent yang sama sama persis atau mirip (Jaccard kata isi ≥ 0,75) | Ya |
| `batas-delegasi-agent` / `batas-delegasi` | > 3 ke satu agent / > 6 total per giliran | Ya |
| `sudah-berhenti` | Ada delegasi sesudah alur dihentikan | Ya |

**Sumber kebenaran persetujuan.** Yang dibaca adalah pesan **terakhir** pengguna dan pesan asisten **sebelumnya** dari `OperationContext.input`, yaitu teks yang benar-benar dilihat dan dijawab pengguna. Kata "ya" saja tidak cukup: harus ada operasi yang menunggu, dan tugas harus mengenai operasi itu (uji: "ya" atas tawaran tiket tidak bisa dipakai untuk "buat laporan omzet").

**Permintaan langsung tidak dianggap karangan.** Kalau pengguna menulis sendiri permintaan tindakan ("tolong buatkan tiket …"), tugas yang menyebut persetujuannya diloloskan, karena tidak ada yang dikarang.

**Persetujuan menyiapkan ≠ menyimpan.** Tidak berubah: menyimpan tetap hanya lewat tombol Simpan pada kartu (sidik diperiksa server). Penjaga tidak membuka jalan simpan apa pun.

---

## 5. Human-in-the-loop

1. `onToolEnd` agent bawahan mencatat **hasil aktual** alat. `butuhKeputusanPengguna()` bernilai ya untuk:
   - `perlu-perbaikan` dengan masalah berpilihan (`pilihan`/`boleh`) atau informasi kurang;
   - `perlu-diperjelas`.

   Masalah konfigurasi saja, atau masalah yang bisa diperbaiki model sendiri (`kepanjangan`), tidak dihitung. Berlaku untuk **semua** alat penyusun rancangan dan alat baca yang memulangkan pilihan, bukan khusus tiket.
2. `onHandoffComplete` perute: kalau status terakhir agent itu "butuh keputusan", atau jawabannya menawarkan tindakan tanpa rancangan, alur **berhenti**.
3. `stopWhen` menghentikan perute **tanpa panggilan LLM berikutnya**, sehingga perute tidak sempat menjawab atas nama pengguna (uji 1b: 1 panggilan perute; kontrol tanpa penjaga: 12).
4. `jagaStream` menyisipkan pertanyaan agent bawahan **apa adanya** (disaring) + nama agent sebelum `finish`. Kalau teks agent kosong, dipakai `pesan` dari hasil alat. Kalau beberapa agent dalam satu langkah, semua jawabannya disertakan.
5. **Konteks giliran berikutnya.** Pertanyaan itu menjadi pesan asisten di riwayat. Saat pengguna menjawab pendek ("LAN", "2", "ya"), penjaga menempelkan blok ini ke tugas delegasi pertama:

   ```
   [Konteks dari giliran sebelumnya — ditambahkan sistem]
   Pertanyaan/tawaran asisten: «…»
   Pilihan yang ditampilkan: …
   Jawaban pengguna apa adanya: «…»
   ```

   Ini menutup temuan RCA bahwa agent bawahan hanya menerima 2 pesan. Terbukti lewat mutasi `args` di `onToolStart` (API-B, uji 5a).

**`bail()` sengaja tidak dipakai.** Diuji di paket terpasang (API-E, dua format): `bail()` memang menghentikan perute dan `text` akhir berisi jawaban agent, tetapi **stream web berakhir dengan potongan `abort` tanpa teks apa pun**. Pertanyaan klarifikasi tidak akan pernah sampai ke browser. `stopWhen` + penyisip teks memberi hasil yang sama (perute berhenti), dengan stream yang selesai normal (`finish`).

**Web dan WhatsApp.** Web: terbukti offline lewat jalur yang sama dengan route (`toUIMessageStream` → `jagaStream`). WhatsApp: **bot WA tidak memakai perute konfigurasi**. `wa-bot/index.mts` memanggil `ambilAgent(dep, peran)` (jalur lama per departemen) dan membaca `textStream`, jadi kegagalan Q5/Q8 tidak terjadi di sana dan Tahap 2 tidak mengubahnya. Kalau suatu saat WA dipindah ke perute, ia **wajib** membaca `jagaPotongan(fullStream, penjaga, "full")`, bukan `textStream`, karena teks penutup hanya disisipkan oleh pembungkus itu. Bentuk `full` sudah diuji unit.

---

## 6. Loop detection dan idempotency

| Mekanisme | Kunci | Hasil |
|---|---|---|
| Delegasi identik/mirip | agent tujuan + kata isi tugas (tanpa blok konteks) | ditolak + berhenti; penutup = hasil valid terakhir |
| Batas delegasi | per agent tujuan (3), total (6) per giliran | ditolak + berhenti |
| Alat identik | `idSesi \| idPermintaan \| agent \| alat \| argumenStabil(args)` (kunci urut, huruf kecil, spasi dirapikan) | **tidak dijalankan**; model menerima hasil sebelumnya + catatan "jangan memanggil lagi". Rancangan & kartu tidak dobel (uji 7: 1 eksekusi) |
| Memilihkan sesudah keputusan diminta | nilai argumen baru yang kata-katanya tidak ada di masukan agent bawahan | ditolak `menunggu-pengguna` |
| Langkah tanpa progres | — | tertutup oleh batas di atas. Tidak ada aturan "jumlah LLM call" terpisah |

- **Tanpa state global.** Semua state ada di closure `buatPenjagaAlur()`, satu per `siapkanAgent()`. `buatPemegangPenjaga()` membuat penjaga baru kalau perute yang sama dipakai lagi **berurutan** (operationId baru, uji 12).
- **`maxSteps` tidak diturunkan.** Alur multi-agent yang sah tetap punya 12 langkah (uji 8: Marketing + Portal tanpa penolakan).

---

## 7. Penanganan output streaming

**Verifikasi API (`npm run test:api-voltagent`, 27/27, dua format):**

| Uji | API | Hasil di paket terpasang | Dipakai? |
|---|---|---|---|
| A | `onToolStart` melempar + `onToolError` mengganti hasil | Alat tidak dijalankan; model menerima hasil pengganti | ✅ |
| B | mutasi `args` di `onToolStart` | Sampai ke agent bawahan | ✅ |
| C | `stopWhen` kustom | Berhenti sesudah langkah alat, 1 panggilan LLM, `finish` normal, tanpa teks perute | ✅ |
| D | `prepareStep` di supervisor | Dipanggil tiap langkah. OpenAI: `tool_choice:"none"` terkirim. Anthropic: AI SDK **membuang daftar alat** (tidak ada `tool_choice:none`), efeknya sama | ✅ |
| E | `onHandoffComplete` + `bail()` | `text` = jawaban bawahan, tapi stream web berakhir `abort` **tanpa teks** | ❌ |
| F | `outputGuardrails` | Handler non-stream baru mengubah teks akhir; potongan mentah **sudah** terkirim. `text`/`fullStream` tidak selesai dalam 10 dtk | ❌ |
| G | state per permintaan di closure | Tidak tercampur saat bersamaan | ✅ |

**Penyaring (`lib/alur/jaga-stream.ts`):**
- Teks ditahan sampai batas kalimat (baris baru, atau `.!?` diikuti spasi; "156.770" bukan batas; lepas paksa kalau > 600 karakter), lalu `penjaga.saring()`, baru dikirim. Keputusan diambil **sebelum** potongan keluar. Mengubah `finalText` sesudahnya tidak dipakai.
- `saring()`:
  - panggilan alat mentah → seluruh sisa bagian teks dibuang;
  - kalimat atas nama pengguna → dibuang;
  - klaim tersimpan → diganti kalimat status aktual. Hanya kalau permintaan ini memanggil alat `siapkan_*`, supaya "tiket yang sudah dibuat minggu lalu" pada pertanyaan baca tidak diubah.
- Di `text-end`, sisa ditahan dilepas sebelum `text-end`. Sebelum `finish`, teks penutup disisipkan sebagai bagian teks baru (`text-start/delta/end`). Stream yang dibatalkan (tanpa `finish`) hanya melepas sisa, tanpa penutup.
- Potongan UI baru dibuat hanya dengan kunci `type/id/delta(/providerMetadata)`, mengikuti skema ketat AI SDK.

**Status aktual sebagai sumber kebenaran.** Rancangan = hasil alat `status:"siap"` + `sidik` (dicatat `onToolEnd`), bukan teks model. Di jalur agent tidak ada satu pun alat yang menyimpan, jadi klaim "tersimpan" di jalur ini selalu palsu.

---

## 8. Hasil uji

Semua dijalankan 24 Nov 2026 di laptop, **tanpa model sungguhan** (server tiruan lokal). `test:jalur` dan `test:agent-konfig` membaca konfigurasi dari PostgreSQL perusahaan (**hanya SELECT**, sudah diperiksa tidak ada operasi tulis). `test:perute` **sengaja tidak dijalankan** karena memanggil Claude sungguhan.

| Rangkaian | Hasil | Isi |
|---|---|---|
| `test:api-voltagent` | **27/27** | §7, untuk OpenAI-compatible & Anthropic |
| `test:penjaga-alur` | **77/77** | Unit: pola teks, aturan penjaga, penyaring stream (bentuk UI & full, batal) |
| `test:alur-tahap2` | **49/49** | Integrasi: 10 skenario × 2 format + bersamaan + pakai ulang + pembatalan |
| `test:alur-tahap2` **kontrol** (`UJI_TANPA_PENJAGA=1`) | 9 lolos / **40 gagal** | Diharapkan gagal. Yang lolos memang hal yang harus tetap jalan tanpa penjaga (stream selesai, jalur sah, multi-agent, pembatalan) |
| `test:evaluator` (Tahap 1) | **42/42** | Evaluator v2 tidak berubah |
| `test:batal-agent` (Tahap 1) | **5/5** | Pembatalan ke agent bawahan |
| `test:jalur` | **12/12** | Perakitan jalur konfigurasi |
| `test:agent-konfig` | **23/23** | Perakitan agent & tool per pengguna |
| `tsc --noEmit` | bersih untuk semua file Tahap 2 | 8 galat yang tersisa sudah ada sebelumnya (`.next/types`, `diagnose-rapor-gagal`, `ukur-skenario-outlet`) |

Skenario integrasi (masing-masing untuk OpenAI & Anthropic):

| # | Skenario (kebutuhan §8 permintaan) | Pemeriksaan kunci |
|---|---|---|
| 1 | Minta tiket, sub-kategori belum ada; agent bertanya | Pertanyaan sampai ke stream; perute 1 panggilan (kontrol: 12, jawaban kosong) |
| 2 | Perute mengarang persetujuan | Ditolak sebelum jalan; perute memperbaiki tugas; tawaran sampai |
| 3 | Perute mencoba menjawab pertanyaan agent | Ditolak; pengguna menerima pertanyaannya, bukan "sudah saya pilihkan" |
| 4 | "ya setuju" tanpa operasi menunggu | Tidak sampai ke agent bawahan; jawaban jujur (kontrol: "Tiket sudah dibuat.") |
| 5 | "LAN" pada giliran berikutnya | Konteks pertanyaan ikut ke agent; 1 rancangan; klaim "telah dibuat … TKT-0001" diganti status sebenarnya |
| 6 | "ya" sesudah tawaran sah | Diteruskan tanpa penolakan; rancangan terbentuk |
| 7 | Rancangan identik berulang | 1 eksekusi, 1 rancangan |
| 8 | Delegasi berbeda yang sah (2 agent) | Tanpa penolakan; jawaban gabungan utuh |
| 9 | `maxSteps` tercapai | Langkah terakhir `toolChoice none`; penutup = hasil valid terakhir |
| 10 | Panggilan alat mentah di stream | Tidak ada di potongan maupun teks gabungan; kalimat wajar sebelum JSON tetap lolos |
| 11 | Dua sesi bersamaan | State terpisah |
| 12 | Perute dipakai ulang berurutan | Giliran kedua dapat penjaga bersih |
| 13 | Pembatalan saat habis waktu | Agent bawahan tetap diputus (2,3 dtk) walau stream lewat penyaring |

Dua kesalahan uji ditemukan dan diperbaiki selama pengerjaan:
- **10a semula lolos juga di kontrol**, karena "delegate_task" terpotong di antara potongan stream. Sekarang teks gabungan ikut diperiksa.
- **Server tiruan salah mengenali langkah perute di Anthropic**, karena daftar alat dibuang saat `toolChoice: none`. Sekarang perute dikenali dari penanda instruksi.

---

## 9. Risiko regresi dan keterbatasan

| Risiko / keterbatasan | Dampak | Mitigasi |
|---|---|---|
| **Belum diuji dengan model sungguhan.** Perilaku Qwen3-14B terhadap `ditolak-penjaga` dan `toolChoice none` belum diukur | Bisa ada pola baru, mis. mencoba lagi dengan kata lain sampai batas | Batas per agent/total tetap menutup putaran; smoke test §11 |
| Pendeteksi berbasis pola bahasa Indonesia (persetujuan, tawaran, klaim, pertanyaan) | Bisa meleset untuk gaya bahasa baru. Salah positif "pertanyaan" membuat agent yang bertanya tidak bisa ditanya lagi di giliran yang sama | Aturan berhenti utama memakai **status alat** (terstruktur). Pola teks hanya pelengkap. Pola penjaga terpisah dari evaluator, jadi salah deteksi tidak tersembunyi di keduanya |
| Penahanan per kalimat | TTFT jawaban di benchmark bisa naik sampai satu kalimat. **Uji baru tidak sebanding persis** dengan 13–23 Nov | Bandingkan dengan `PENJAGA_ALUR=mati` (A-B) |
| Saat berhenti karena satu agent bertanya, perute tidak merangkai jawaban | Pertanyaan lintas aplikasi: semua jawaban agent di langkah itu disertakan apa adanya, berlabel nama agent | Disengaja; lebih baik daripada perute menjawab atas nama pengguna |
| Riwayat web dikirim klien | Klien bisa memalsukan "tawaran" di riwayat | Tidak menambah kuasa: menyimpan tetap butuh tombol Simpan + sidik yang diperiksa server |
| Pesan panjang berisi permintaan tindakan meloloskan klaim persetujuan | Mis. "ya, tolong buatkan tiket wifi" | Itu memang permintaan pengguna sendiri |
| Panggilan alat mentah di tengah jawaban | Kalimat sebelumnya yang sudah terkirim tidak bisa ditarik (sisa bagian itu dibuang) | Pola Q8 yang tercatat selalu di awal |
| Satu jalur dipakai **bersamaan** | Tidak didukung (sama dengan `sumber`/`rancangan` yang sudah ada) | Route & skrip membuat jalur per permintaan |
| Bot WA tidak memakai perute | Tahap 2 tidak berlaku di WA | Tidak ada regresi di WA. Catatan migrasi di §5 |
| Browser menutup koneksi di tengah jawaban web | Route belum meneruskan `req.signal` ke `streamText`. Apakah generasi ikut berhenti belum terbukti | Masuk rencana §12; tidak diubah di tahap ini |
| Di luar cakupan (sesuai instruksi) | Salah rute Q4, parameter kosong Q1, sapaan yang didelegasikan (efisiensi Q8) | Belum disentuh |

---

## 10. Prosedur rollback

1. **Tercepat, tanpa mengubah kode:** setel `PENJAGA_ALUR=mati` di `.env.local`, lalu restart (`npm run deploy` / dev server). Hook tidak dipasang dan stream tidak disaring, kembali ke perilaku sebelum Tahap 2. Log mencatat `PENJAGA_ALUR=mati`. Instruksi perute yang baru tetap aktif; untuk mengembalikannya pakai langkah 2.
2. **Pulihkan file:**

   ```bash
   node .cadangan/tahap2-2026-11-24-1043/pulihkan.mjs              # simulasi: tampilkan rencana
   node .cadangan/tahap2-2026-11-24-1043/pulihkan.mjs --jalankan   # pulihkan
   ```

   - Sidik SHA-256 setiap cadangan diperiksa terhadap `MANIFEST.txt` dulu (rusak = berhenti tanpa menimpa apa pun).
   - Lalu 8 file dipulihkan, dan 9 file baru **dipindah** (tidak dihapus) ke `dibuang-<waktu>/`.
   - Sesudahnya restart server.
3. Perubahan Tahap 1 **tidak ikut terhapus**, karena cadangan diambil sesudah Tahap 1. Data benchmark historis tidak pernah diubah.
4. Cadangan tidak berisi kredensial (sudah diperiksa), berada di luar `public/`, dan `/.cadangan/` masuk `.gitignore`.

---

## 11. Rencana smoke test Qwen3-14B (BELUM dijalankan — perlu persetujuan)

**Prasyarat:**
- g5.12xlarge menyala, 4 replika `qwen3-14b`, `max-num-seqs=4`;
- tunnel & `AI_BASE_URL_2` mutakhir;
- model portal `mr-ai-gateway-4gpu`.

Tidak ada perubahan Docker/LiteLLM/vLLM. Tidak memakai Anthropic.

| Langkah | Perintah | Jumlah permintaan | Tujuan |
|---|---|---:|---|
| S0 | `profil-alur-agent.mts --model mr-ai-gateway-4gpu --dry-run …` | 0 | Kesehatan + setelan replika |
| S1 | `uji-alur-tiket.mts normal mr-ai-gateway-4gpu` × 5 | ±15 | Tiga giliran: minta tiket → "iya" → sub-kategori. Rancangan terbentuk, **tiket tersimpan = 0** (diperiksa skrip) |
| S2 | `profil-alur-agent.mts --fase berurutan --kode Q5,Q8 --ulang 10 --simpan-jawaban --catat-argumen --label tahap2-smoke` | 20 | Q5 & Q8 berurutan, evaluator v2 + field `penjaga` |
| S3 | sama dengan S2 + `PENJAGA_ALUR=mati`, `--ulang 5 --label tahap2-ab-mati` | 10 | Pembanding A-B pada hari & server yang sama |
| S4 | `profil-alur-agent.mts --fase berurutan --ulang 3 --label tahap2-regresi` | 24 | Q1–Q8 × 3: regresi Q2/Q3/Q6/Q7 |

**Kriteria lulus:**
- Q5: `pesan-internal` = `klaim-tersimpan-palsu` = `kosong` = `timeout` = 0;
- Q8: `pesan-internal` = 0;
- Q2/Q3/Q6/Q7 tetap lulus seperti sebelumnya;
- median durasi Q5 tidak lebih lambat dari A-B;
- distribusi `penjaga.ditolak` dicatat. Penolakan pada pertanyaan yang semestinya lolos dihitung sebagai salah positif.

Total ±70 permintaan, berurutan (1 pengguna). Setelah S2 lolos, uji terarah G dari RCA (Q5 20× di 12 pengguna) bisa diajukan terpisah.

---

## 12. Rencana uji pembatalan end-to-end LiteLLM + vLLM (BELUM dijalankan)

Yang sudah terbukti:
- VoltAgent → agent bawahan → `fetch` (offline 171 ms; Tahap 2 uji 13: tetap terputus 2,3 dtk walau lewat penyaring);
- tunnel → LiteLLM → vLLM untuk **satu stream** (24 Nov: berhenti di 206 token).

| Langkah | Cara | Bukti yang dicari |
|---|---|---|
| E1 | `profil-alur-agent.mts --fase berurutan --kode Q5 --ulang 3 --timeout 15` (batas dipendekkan supaya pasti habis di tengah delegasi) | Event `q` berstatus `waktu-habis`; span delegasi `batal` |
| E2 | Selama E1, ambil `/metrics` keempat replika tiap 2 dtk (hanya membaca, seperti 24 Nov) | `num_requests_running` kembali 0 ≤ 5 dtk sesudah batas; `generation_tokens_total` berhenti naik |
| E3 | Catatan LiteLLM untuk rentang yang sama (hanya kolom waktu/status/token, seperti `--model-litellm`) | Permintaan yang dibatalkan tidak tercatat selesai dengan token penuh |
| E4 | **Jalur web:** tutup tab di tengah jawaban web, amati `/metrics` | Apakah generasi berhenti. Route belum meneruskan `req.signal` ke `streamText`; kalau E4 menunjukkan generasi tetap jalan, perbaikannya (teruskan `req.signal`) diajukan sebagai perubahan terpisah |

Semua langkah E hanya membaca metrik dan tidak mengubah konfigurasi server. E1–E3 sekitar 3 permintaan.
