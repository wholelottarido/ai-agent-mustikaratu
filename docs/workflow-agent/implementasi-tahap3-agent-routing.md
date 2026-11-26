# Implementasi Tahap 3 — Agent Routing Intelligence & Capability Matching (F.4, Q4)

**Tanggal:** 24 Nov 2026 · **Status:** selesai dan tervalidasi **offline**. Live inference dan benchmark **belum dijalankan** (rencana di §21, menunggu persetujuan).
**Cadangan:** `.cadangan/tahap3-2026-11-24-1353/` · **Saklar:** `RUTE_KEMAMPUAN=mati`

Dokumen terkait (semua di `docs/workflow-agent/`): `rca-kegagalan-workflow-agent-qwen14b.md` (RCA, F.4), `implementasi-perbaikan-workflow-agent-qwen14b.md` (Tahap 1), `implementasi-tahap2-agent-orchestration.md` (Tahap 2), `implementasi-final-perbaikan-workflow-agent.md` (Tahap 4–6 + status gabungan).

---

## 1. Executive Summary

Kegagalan Q4 terjadi karena perute memilih agent dari **kemiripan kata**, bukan dari **kemampuan alatnya**. Deskripsi Super Tools memuat frasa "pengajuan cuti", padahal agent itu tidak punya alat pencari SOP.

Tahap 3 menambahkan empat hal, semuanya bekerja dari metadata alat yang benar-benar terpasang untuk pemakai, bukan dari nama agent:

| Komponen | Yang dilakukan |
|---|---|
| **Registri kemampuan dinamis** | Tiap agent dirangkum jadi jenis kemampuan (*cari dokumen* / *baca data* / *siapkan tindakan*) dari alat yang terpasang **sesudah** penyaringan akses & izin. Tanpa query tambahan. |
| **Penjaga kemampuan sebelum delegasi** | Sebelum `delegate_task` jalan, tujuan tugas dibaca, lalu target dicek. Target yang **pasti** tidak mampu tidak pernah dieksekusi. |
| **Fallback terkendali** | Untuk kebutuhan dokumen, penjaga mengalihkan langsung ke pemegang alat dokumen, tanpa panggilan perute tambahan. Untuk data/tindakan, penjaga menolak sekali dengan saran. Paling banyak 1 agent alternatif per kebutuhan, dan tidak ada fallback sesudah akses ditolak. |
| **Status hasil terstruktur** | Hasil `delegate_task` diberi `status_rute`: `tanpa-alat`, `tidak-ditemukan`, `akses-ditolak`, `galat-alat`, `tidak-bisa`, `perlu-pengguna`, atau `berhasil`. Status ini diambil dari **bukti eksekusi alat**, bukan dari kalimat "tidak bisa". |

**Hasil offline:**
- **142 pemeriksaan baru lolos** (120 unit + integrasi tiruan dua format, 22 dengan konfigurasi sungguhan, hanya baca).
- **390 pemeriksaan lama tetap lolos.**
- **0 galat TypeScript baru.**
- Pada setelan hari ini, Q4 yang salah diarahkan ke Super Tools **dialihkan ke Portal sebelum Super Tools jalan**, dengan perute tetap 2 panggilan.
- Kontrol negatif tanpa Tahap 3 mereproduksi Q4 persis seperti RCA: Super Tools dijalankan dan menjawab "tidak dapat membantu".

Target live (Q4 ≥ 95% agent relevan, `cari_sop` ≥ 98%) **belum boleh diklaim** dari uji tiruan.

---

## 2. Root Cause dan Baseline Q4

| Metrik (RCA, 465 skenario) | Nilai |
|---|---:|
| Q4 total | 58 |
| Lulus / gagal | 51 / 7 |
| Delegasi pertama ke Super Tools | 21 (36%) |
| …pulih ke Portal | 14 |
| …diterima sebagai jawaban akhir | 7 |

Rantai kegagalan, yang sama di ketujuh kasus:
1. Perute meneruskan `{"task":"prosedur pengajuan cuti","targetAgents":["Ratu AI Super Tools"]}`.
2. Super Tools menjawab tanpa alat ("belum bisa mengambil data prosedur…").
3. Perute menerima jawaban itu sebagai jawaban akhir.

Ada dua sebab:
- **Kata mengalahkan aturan.** Aturan "utamakan Portal untuk SOP" sudah ada, tapi kalah oleh deskripsi agent yang memuat frasa sama persis.
- **Ketidakmampuan dianggap ketiadaan data.** Perute tidak bisa membedakan "agent ini tidak punya alatnya" dari "datanya tidak ada".

---

## 3. Analisis Routing Existing

Diaudit langsung pada kode terpasang (@voltagent/core 2.10.0):

| Pertanyaan | Jawaban (kode) |
|---|---|
| Bagaimana perute tahu agent yang ada? | `buatRouter()` (`voltagent/agent-konfig.ts`) merakit bawahan dari `ai_agent` yang **aplikasinya boleh diakses pemakai** (`aksesApps` dari sesi). Agent tanpa alat tidak dijadikan bawahan. |
| Deskripsi & kemampuan | Daftar teks di prompt: `ai_agent.deskripsi` + "Bisa: <nama alat terpasang>". Tidak ada jenis kemampuan. |
| Alat diteruskan ke perute? | Tidak, hanya namanya di teks. Alatnya dirakit per agent bawahan oleh `buatToolDariKonfig()`, sesudah `ai_tool.izin` dicocokkan ke izin pemakai. |
| Hak akses | Dua lapis, keduanya **sebelum** model terlibat: (1) agent yang aplikasinya tidak boleh diakses tidak dipasang; (2) alat yang izinnya tidak dimiliki tidak dirakit. |
| Pemilihan target | Sepenuhnya keputusan LLM perute lewat `delegate_task({task, targetAgents})`. Target yang tidak dikenal ditolak VoltAgent dengan galat teks. |
| Hasil bawahan | `delegate_task` memulangkan `[{agentName, response, usage, bailed}]`. Isinya teks bebas. |
| Membedakan berhasil / tidak mampu / galat | **Tidak ada.** Semua sampai ke perute sebagai teks. |
| Fallback | Hanya bergantung pada LLM perute (14/21 berhasil). |
| Interaksi dengan Tahap 2 | `periksaDelegasi()` di `onToolStart` perute sudah menjadi titik validasi sebelum eksekusi (terbukti API-A). Pengubahan `args` sampai ke `execute` (API-B). |

**Temuan tambahan saat audit:**
- **Setelan berubah lagi sejak RCA.** Super Tools tercatat 43 baris alat. Untuk pemakai dengan izin penuh hanya **5 yang terpasang**, karena penangan lain belum dikenal.
- **`cari_sop` sekarang dipegang dua agent** (Portal dan Admin). Pemetaan nama tetap jadi mustahil.
- **Aturan 5 di prompt sudah usang.** Isinya "Kalau daftar agent tidak menyebut lembur … jangan mengarahkannya ke Super Tools", padahal `ajukan_izin_cuti` milik Super Tools kini menyebut lembur. Aturan itu dihapus dan diganti versi umum.
- **Prompt perute memuat nama agent tetap** ("Ratu AI Portal", "Super Tools", "Marketing"). Diganti rujukan ke jenis kemampuan.

---

## 4. Desain Intent-aware Routing

Pendekatannya hibrida dan **tanpa panggilan LLM tambahan**:

1. **LLM perute** tetap memilih target. Prompt-nya kini meminta "tujuan dulu, baru kemampuan" (§6).
2. **Kode** membaca tujuan **tugas delegasi** (bukan seluruh pesan) dengan pola tujuan kalimat (`kebutuhanTugas()` di `lib/alur/kemampuan.ts`):

| Kebutuhan | Dikenali dari | Contoh |
|---|---|---|
| `dokumen` (KNOWLEDGE) | menanyakan cara, syarat, alur, aturan, kebijakan, "berapa lama prosesnya", "siapa yang menyetujui" | "Bagaimana prosedur pengajuan cuti?" |
| `data` (DATA/STATUS/ANALYTICS) | status, sisa, jumlah, riwayat, bandingkan, periode, "milik saya" | "Apakah cuti saya sudah disetujui?" |
| `tindakan` (ACTION) | bentuk permintaan: buatkan, siapkan, ajukan, batalkan (bukan "cara membuat") | "Buatkan tiket komputer rusak." |
| `campuran` (MULTI) | klausa berbeda kebutuhan, dipisah di "dan/serta/lalu" + kata tanya/perintah | "Berapa penjualan bulan lalu dan bagaimana SOP cuti?" |
| `tidak-jelas` (AMBIGUOUS) | tidak cocok satu pun | "Cuti saya bagaimana?" |

Kata benda seperti "cuti", "SOP", atau "penjualan" **bukan** penentu. "Prosedur pengajuan cuti" adalah dokumen, sedangkan "cuti saya sudah disetujui?" adalah data. GENERAL_CONVERSATION (sapaan) tetap ditangani Tahap 5 **sebelum** penilaian ini.

3. **Validasi kemampuan** di kode memakai registri (§5) dengan tiga tingkat keyakinan:

| Tingkat | Syarat | Akibat |
|---|---|---|
| `cocok` (CONFIRMED_MATCH) | target memegang alat jenis yang dibutuhkan (untuk data/tindakan: alat sejenis yang beririsan kata isi dengan tugas) | jalan |
| `tidak-cocok` (CONFIRMED_MISMATCH) | **dokumen:** target tidak punya alat dokumen sama sekali, padahal agent tersedia lain punya. **data/tindakan:** tidak satu pun kata isi tugas muncul di deskripsi agent maupun di alat target mana pun, padahal alat sejenis milik agent lain memuatnya | dokumen → dialihkan; data/tindakan → ditolak sekali dengan saran |
| `tidak-diketahui` (UNKNOWN) | tujuan belum jelas, tugas campuran yang sudah tercakup, jawaban singkat atas pertanyaan sebelumnya, tidak ada pemegang lain, atau bidang target menyinggung tugas | jalan; keputusan tetap di perute |

4. **Klarifikasi** hanya untuk tujuan yang benar-benar ganda (prosedur atau pengajuan). Ini satu pertanyaan tentang **tujuan**, bukan tentang isi data, jadi Aturan Nomor Satu (teruskan dulu) tetap berlaku.

---

## 5. Dynamic Capability Registry

**Struktur** (`lib/alur/kemampuan.ts`):

```
RegistriKemampuan { agent: AgentKemampuan[] }
AgentKemampuan    { nama, deskripsi, alat: AlatKemampuan[] }
AlatKemampuan     { nama (nama yang dilihat model), label, deskripsi, jenis: "dokumen" | "data" | "tindakan" }
```

**Dari mana jenisnya** (`kemampuanTool()` di `agent-konfig.ts`):

| Tool | Jenis |
|---|---|
| `jenis = "kode"` | sifat penangannya, dari `KEMAMPUAN_KODE` di `voltagent/registry-kode.ts`. `cari_sop`, `daftar_sop` → dokumen; lainnya → data |
| `jenis = "konfigurasi"` | `operasi = "baca"` → data; tambah/ubah/hapus → tindakan (rancangan `siapkan_*`) |

`KEMAMPUAN_KODE` bertipe `Record<keyof typeof PENANGAN, …>`. Akibatnya, penangan baru yang lupa menyatakan kemampuannya membuat `tsc` gagal, sama seperti `SUMBER_KODE`.

**Sifat yang dijamin:**
- **Disusun di `buatRouter()`** dari **alat yang sama** yang dipasang ke agent itu untuk pemakai itu, yaitu sesudah akses aplikasi, izin, dan pemangkasan model lokal. Terbukti dengan data sungguhan: registri = bawahan beralat, jumlah alat sama persis, dan alat berizin hilang saat izin dicabut (27 vs 104 alat).
- **Satu registri per permintaan** (dipegang `PemegangPenjaga`), tidak ada cache global. Dua pemakai bersamaan tidak berbagi registri (diuji).
- **Tanpa query tambahan.** Semuanya dari konfigurasi yang sudah dimuat `muatKonfig()`.
- **Tanpa nama agent di kode.** Agent baru, nama baru, atau `cari_sop` yang dipasang ke agent lain lewat Kelola AI langsung terbaca (diuji: ganti nama, pindah ke agent baru, cabut, tambah).
- **Tabel `ai_agent`/`ai_tool` tidak diubah.**

**Keterbatasan metadata:**
- Kemampuan "dokumen" hanya dikenali dari penangan kode. Itu cukup karena pencarian makna memang hanya bisa lewat penangan kode.
- Bidang data/tindakan dinilai dari kata isi nama, label, dan deskripsi alat. Tidak ada tag bidang di `ai_tool`. Karena itu penilaian bidang hanya "kemungkinan" dan diperlakukan lunak (§7).

---

## 6. Perubahan Router Prompt

| Bagian | Sebelum | Sesudah (saklar menyala) |
|---|---|---|
| Daftar agent | deskripsi + "Bisa: …" | + satu baris "Jenis kemampuan: cari dokumen/SOP/panduan; baca data; siapkan tindakan", dihitung dari alat |
| Aturan 2 (prosedur) | "utamakan **Ratu AI Portal** … misalnya kata 'cuti'" | "kirim ke agent yang jenis kemampuannya mencakup *cari dokumen*; memegang DATA pengajuan ≠ memegang DOKUMEN prosedurnya" |
| Aturan 5 | lembur & "jangan ke **Super Tools**" (usang, §3) | cocokkan dari alat, bukan kata; bedakan "tidak punya alatnya" dari "sudah dicari dan tidak ada" |
| Contoh "SALAH" ramalan | "Agent **Marketing**" | "agent yang memegang alat ramalan" |
| Baru: "Memilih agent: tujuan dulu" | — | prosedur vs status; informasi vs tindakan; pisahkan kebutuhan majemuk; sapaan + data = data; satu pertanyaan tujuan bila ganda |
| Baru: arti `status_rute` | — | `tanpa-alat` ≠ bukti tidak ada, `tidak-ditemukan`, `akses-ditolak` (jangan cari lewat agent lain) |
| `ditolak-penjaga` | ikuti pesan; jangan coba lagi kecuali diminta meneruskan apa adanya | + boleh meneruskan tugas yang sama ke `saran_agent` |

**Yang dipertahankan:**
- Aturan Nomor Satu (teruskan dulu);
- aturan Tahap 2 (larangan persetujuan atas nama pengguna, larangan klaim tersimpan, `ditolak-penjaga`);
- 5a sapaan (Tahap 5);
- aturan HITL.

Aturan baru tidak memuat nama agent, nama alat, maupun JSON (diuji statis), supaya tidak tersalin sebagai jawaban atau panggilan mentah.

**Ukuran:** instruksi perute 10.636 → 12.471 karakter (+1.835, ±460 token) pada akses penuh. Registri sendiri (±23 KB) **tidak dikirim ke model**.

---

## 7. Pre-delegation Capability Guard

Lokasinya `periksaKemampuan()` di `lib/alur/penjaga-alur.ts`, dipanggil dari `periksaDelegasi()` (hook `onToolStart` perute). Posisinya **sesudah** aturan Tahap 5 (sapaan) dan Tahap 2 (persetujuan karangan), dan **sebelum** batas delegasi per agent, deteksi delegasi berulang, dan larangan menjawab atas nama pengguna. Dengan begitu, target pengganti tetap tunduk pada semua batas Tahap 2.

```
delegate_task(task, targetAgents)
  → [T2] sudah berhenti? → [T5] sapaan? → [T2] persetujuan karangan?
  → [T3] target tersedia untuk pemakai? ── tidak ──► agent-tidak-tersedia (daftar agent_tersedia)
  → [T3] jawaban singkat atas pertanyaan sebelumnya? ── ya ──► lewati penilaian kemampuan
  → [T3] tugas yang sama pernah ditolak karena AKSES? ── ya ──► akses-ditolak-sebelumnya + berhenti
  → [T3] cocokkan(target, tugas)
        cocok / tidak-diketahui ─────────────────────────────► lanjut
        tidak-cocok, sebagian target ──► target itu dibuang, sisanya lanjut
        tidak-cocok, dokumen ──► dialihkan ke pemegang dokumen paling khusus (tanpa panggilan perute)
        tidak-cocok, data/tindakan/campuran ──► ditolak terstruktur + saran_agent (perute memutuskan)
  → [T3] batas fallback per kebutuhan
  → [T2] batas per agent, delegasi berulang, agent yang sedang bertanya, batas total
  → jalan (args.targetAgents diganti bila dialihkan)
```

**Contoh hasil penolakan** (dibaca model sebagai hasil alat; bentuknya sama dengan penolakan Tahap 2):

```json
{ "status": "ditolak-penjaga", "kode": "kemampuan-tidak-cocok",
  "pesan": "Delegasi ditolak sistem (kemampuan-tidak-cocok): … Teruskan tugas yang SAMA ke salah satu agent di saran_agent. …",
  "kebutuhan": "data", "kemampuan_dibutuhkan": "baca data", "saran_agent": ["Ratu AI Portal"] }
```

`saran_agent` dan `agent_tersedia` **hanya** berisi agent dari registri pemakai itu.

**Dua derajat bukti:**
- **Dokumen: pasti.** Target tidak punya alat pencari dokumen satu pun. Penolakannya keras: bersikeras pun tetap ditolak, dan target tidak pernah jalan.
  - Karena alat dokumen di semua agent adalah penangan yang sama dengan penyaring sesi yang sama, penjaga **langsung mengalihkan**. Pilihannya: alat dokumen terbanyak, lalu alat total tersedikit (prompt bawahan lebih kecil). Pada setelan hari ini dengan akses penuh (Admin & Portal sama-sama memegang `cari_sop`), hasilnya **Portal**.
- **Data/tindakan: kemungkinan.** Penilaiannya dari kata isi, jadi sinonim bisa menipu. Penjaga menolak **sekali** dengan saran. Kalau perute tetap memilih target yang sama untuk tugas yang sama, keputusannya dihormati dan dicatat sebagai `dipertahankan`. Penjaga tidak pernah mengalihkan otomatis untuk data/tindakan.

**Bukti "agent yang ditolak tidak dieksekusi":**
- Mekanismenya sama dengan Tahap 2 (lempar `GalatPenjaga` di `onToolStart` → `onToolError` mengubahnya jadi hasil alat).
- Pengalihan mengganti `args.targetAgents`, yaitu objek yang sama yang diteruskan ke `execute` (API-B).
- Diuji: Super Tools menerima **0 panggilan LLM** di format OpenAI-compatible dan Anthropic.

---

## 8. Controlled Fallback Routing

| Kondisi | Bukti yang dipakai | Perilaku |
|---|---|---|
| Target tidak punya kemampuan | registri | dokumen: dialihkan; data/tindakan: ditolak + saran |
| Target tidak menjalankan alat apa pun | `status_rute: tanpa-alat` (tidak ada `onToolEnd` di handoff itu) | `catatan_rute`: "BUKAN bukti tidak ada", + `saran_agent` bila target **tidak** terbukti cocok dan ada pemegang lain; kalau tidak ada, "sampaikan keterbatasan" |
| Data tidak ditemukan | `total=0`, daftar kosong, status `tidak-ketemu`/`data-belum-ada` | "sampaikan apa adanya; jangan cari ke agent lain" |
| Hak akses | galat "izin/akses/belum terhubung…" atau status `ditolak` dengan alasan akses | "sampaikan apa adanya"; delegasi tugas yang sama ke agent lain → `akses-ditolak-sebelumnya` + berhenti |
| Parameter kurang | (Tahap 4 `perlu-periode`, Tahap 6 `perlu-perbaikan`) | tidak diubah; mekanisme tahap itu yang berjalan |
| Galat alat sementara | galat sungguhan di `onToolEnd` (bukan penolakan penjaga) | `galat-alat`; boleh satu alternatif; retry gateway lama tetap berlaku |
| Butuh konfirmasi | `perlu-pengguna` (HITL Tahap 2) | alur berhenti menunggu pengguna (Tahap 2) |
| Tujuan tidak jelas | `tidak-jelas` | tidak ditolak; prompt mengizinkan satu pertanyaan tujuan |

**Pencegahan putaran** (state per permintaan, tanpa state global):
- **`maksFallback = 1`.** Untuk satu kebutuhan (tugas mirip ≥ 0,6), paling banyak satu agent lain sesudah yang pertama gagal. Percobaan ketiga → `batas-fallback` + berhenti.
- **Pencarian dokumen tidak diulang.** Kalau satu pemegang dokumen sudah mengerjakan tugas itu, pemegang lain tidak dicoba lagi.
- **`maksTolakKemampuan = 2`.** Penolakan kemampuan ketiga menghentikan alur.
- Batas Tahap 2 tetap berlaku untuk target pengganti: 3/agent, 6 total, delegasi berulang, agent yang sedang bertanya, dan `maxSteps = 12` (tidak diturunkan).
- Tidak ada pengecualian yang melewati penjaga Tahap 2.

---

## 9. Structured Capability Failure

VoltAgent tidak menyediakan status terstruktur dari agent bawahan. Hasil `delegate_task` cuma teks. Tahap 3 menyusunnya dari **bukti eksekusi** yang sudah dilihat penjaga:
- hook `onToolEnd` bawahan mencatat status tiap hasil alat (`statusHasilAlat()`);
- `onToolEnd` yang membawa galat sungguhan dicatat `galat-alat` (penolakan penjaga dikecualikan);
- `onHandoffComplete` menggabungkannya jadi satu status handoff (`statusHandoff()`);
- `onToolEnd` **perute** untuk `delegate_task` menempelkan `status_rute`, `catatan_rute`, dan `saran_agent` ke tiap elemen hasil. Penimpaan hasil lewat `{output}` terbukti sampai ke model di kedua format.

Pemetaannya ke status konseptual:

| Konsep | `status_rute` |
|---|---|
| SUCCESS | `berhasil` |
| DATA_NOT_FOUND | `tidak-ditemukan` |
| ACCESS_DENIED | `akses-ditolak` |
| TOOL_ERROR | `galat-alat` |
| NEED_CLARIFICATION | `perlu-pengguna` |
| CAPABILITY_MISMATCH (pasca-eksekusi) | `tanpa-alat` |
| UNKNOWN | `tidak-bisa` |

Kalimat "tidak bisa" **tidak pernah** dipakai sebagai bukti. Yang dipakai hanya ada/tidaknya eksekusi alat dan bentuk hasilnya.

---

## 10. Arsitektur Sebelum dan Sesudah

```
SEBELUM
Pengguna → Perute (LLM) ──delegate_task(Super Tools)──► Super Tools (LLM, tanpa alat) ──"tidak bisa"──► Perute ──► "tidak dapat membantu"

SESUDAH
Pengguna → Perute (LLM) ──delegate_task(Super Tools)──► [penjaga T3: tugas=dokumen, Super Tools tanpa alat dokumen]
                                                        └─ targetAgents := [pemegang dokumen di registri pemakai]
                                                           └► Portal (LLM) → cari_sop → SOP ──status_rute: berhasil──► Perute ──► jawaban SOP
```

Panggilan LLM untuk Q4 yang salah rute sekarang **4**: perute 2, Portal 2 (alat + rangkuman). Angka ini sama dengan Q4 yang sejak awal dirutekan benar. Sebelumnya:
- **3 panggilan dengan jawaban salah** (perute 2 + Super Tools 1), atau
- **6 panggilan kalau pulih** (perute 3 + Super Tools 1 + Portal 2).

Super Tools tidak pernah dipanggil.

---

## 11. Daftar File yang Dimodifikasi

| File | Perubahan | Baris |
|---|---|---:|
| `lib/alur/kemampuan.ts` | **baru**: tujuan tugas, registri, `cocokkan()`, status hasil | 240 |
| `lib/alur/penjaga-alur.ts` | `periksaKemampuan()`, `catatanDelegasi()`, `catatGalatAlat()`, status handoff, metadata `rute`, `pakaiRegistri`/`registri` | +213 −14 |
| `voltagent/kendali-alur.ts` | `targetBaru` → `args.targetAgents`; `onToolEnd` perute; galat alat bawahan | +16 −1 |
| `voltagent/agent-konfig.ts` | `ruteKemampuanDinyalakan()`, `kemampuanTool()`, registri di `buatRouter()`, baris "Jenis kemampuan", aturan perute (versi lama dipertahankan di balik saklar) | +92 −11 |
| `voltagent/registry-kode.ts` | `KEMAMPUAN_KODE` (dijaga tsc) + `kemampuanKode()` | +25 |
| `package.json` | `test:tahap3`, `test:tahap3-data`; `test:alur-semua` ikut Tahap 3 & audit | +3 −1 |
| `scripts/test-tahap3-rute.mts` | **baru**: unit + integrasi tiruan + 2 kontrol negatif | 449 |
| `scripts/test-tahap3-data.mts` | **baru**: konfigurasi sungguhan, hanya baca | 104 |

**Tidak diubah:**
- evaluator v1/v2 dan `profil-alur-agent.mts` (metadata rute ikut otomatis lewat `penjaga.keadaan()`);
- validasi periode (Tahap 4) dan Tahap 5/6;
- jalur WhatsApp;
- Docker, LiteLLM, vLLM, dan tabel database.

Semua file tetap CRLF, sesuai aslinya.

---

## 12. Integrasi dengan Tahap 1, 2, 4, 5, dan 6

| Tahap | Titik temu | Status |
|---|---|---|
| 1 Evaluator & observability | Jawaban Q4 sesudah pengalihan dinilai **lulus** oleh v2 tanpa mengubah evaluator. Penolakan T3 berstatus `ditolak-penjaga`, sehingga dikurangkan dari jumlah delegasi oleh `profil-alur-agent`. `penjaga.rute` (kebutuhan, target pertama, dialihkan, dibuang, dipertahankan, status handoff, agent dipakai) ikut tercatat tanpa isi pertanyaan | ✅ diuji |
| 2 Orkestrasi | Urutan pemeriksaan (§7); target pengganti tunduk pada semua batas; HITL: agent yang sudah bertanya tidak bisa "dikejar" ke agent lain; penyaring stream tidak berubah | ✅ diuji |
| 4 Periode | Tidak diubah. Alat data hasil pengalihan tetap lewat `perlu-periode` | ✅ (lihat §19, catatan pesan majemuk) |
| 5 Sapaan | Diperiksa **sebelum** kemampuan; sapaan tetap tanpa delegasi | ✅ diuji 2 format |
| 6 Sub-kategori | Tidak disentuh; jawaban singkat ("LAN", "2") atas pertanyaan sebelumnya **tidak dinilai** kemampuannya | ✅ diuji |

---

## 13. Hasil Unit Test

`npm run test:tahap3`, bagian unit: **96 pemeriksaan**, semuanya lolos.

| Kelompok | Isi |
|---|---|
| Tujuan tugas | 27 kalimat A–E (prosedur, status, data, tindakan, ambigu, lintas) + akar kata |
| Kecocokan | Q4 & variannya, status/sisa cuti, tiket, penjualan, tindakan; 8 kasus "tidak boleh ditolak"; tugas majemuk; registri tanpa pemegang dokumen |
| Status hasil | berhasil, kosong, akses, galat, penolakan penjaga bukan hasil alat, tanpa alat, gabungan |
| Penjaga | pengalihan Q4, dua pemegang dokumen, penolakan terstruktur data, "dipertahankan", dokumen bersikeras, agent tidak tersedia, jawaban singkat, akses terbatas, `tanpa-alat` + saran, fallback 1× lalu `batas-fallback`, akses → `akses-ditolak-sebelumnya`, `tidak-ditemukan` |
| Konfigurasi dinamis | ganti nama, pindah ke agent baru, dicabut, ditambah ke agent lain, dua pemakai bersamaan |
| Antar-tahap | tanpa registri = perilaku lama; sapaan; persetujuan karangan; lintas agent sah; tidak berputar sesudah HITL; evaluator v2; format penolakan; privasi metadata; prompt tanpa nama agent/JSON |

---

## 14. Hasil Offline Integration Test

Agent VoltAgent sungguhan memakai hook produksi dan server tiruan, format **OpenAI-compatible (Qwen) dan Anthropic**. Total 24 pemeriksaan (12 per format), semuanya lolos.

| Skenario | Yang dibuktikan |
|---|---|
| F1 Q4 salah rute | Super Tools 0 panggilan; `cari_sop` 1×; jawaban dari SOP; perute 2 panggilan; metadata `target_pertama`=Super Tools, `agent_dipakai`=Portal, `berhasil` |
| F2 salah rute data | Perute menerima `kemampuan-tidak-cocok` + `saran_agent`, lalu memilih Portal; Super Tools 0 panggilan |
| F2c dua pemegang dokumen | Langsung ke Portal; Admin & Super Tools 0 panggilan; perute 2× |
| F3 tanpa alat → fallback | Hasil `delegate_task` membawa `status_rute: tanpa-alat` + saran; satu fallback; angka benar; tidak berputar |
| F4 lintas agent | Tugas majemuk ke satu agent diminta dipisah; dua agent relevan jalan; jawaban memuat keduanya |
| F5 hak akses | Agent di luar akses tidak jalan; tidak ada agent bawahan lain yang dicoba |
| F6 sapaan | Tetap tanpa delegasi (Tahap 5) |

Dengan **konfigurasi sungguhan** (`npm run test:tahap3-data`, hanya membaca setelan, tanpa model): **22/22 lolos**.
- Registri cocok dengan alat terpasang, termasuk penyaringan izin.
- Q4 → **dialihkan ke Portal**.
- Pemakai tanpa pemegang dokumen tidak dialihkan ke luar aksesnya.
- 7 pertanyaan data/tindakan: pemilik alat bidangnya tidak pernah ditolak.
- 4 pertanyaan ambigu: tidak ada yang ditolak.
- Saklar `RUTE_KEMAMPUAN=mati` terbukti mengembalikan instruksi lama tanpa mematikan penjaga Tahap 2/5.

---

## 15. Hasil Negative Control

| Kontrol | Integrasi lolos | Arti |
|---|---:|---|
| Tahap 3 menyala | 24 / 24 | (kontrol tidak menjalankan cek metadata F1d, jadi pembaginya 22) |
| `UJI_TANPA_RUTE=1` (Tahap 2–6 menyala, Tahap 3 mati) | **4 / 22** | Q4 terulang persis seperti RCA: Super Tools jalan, jawaban "tidak dapat membantu", tidak ada `status_rute`, tidak ada fallback |
| `UJI_TANPA_PENJAGA=1` (tanpa penjaga sama sekali) | **2 / 22** | sama, ditambah sapaan didelegasikan |

Yang tetap lolos di kontrol memang hal yang sudah dijamin sebelum Tahap 3:
- agent di luar akses tidak bisa dipanggil (ditegakkan saat perakitan);
- sapaan (Tahap 5).

---

## 16. Hasil Regression Test

| Rangkaian | Hasil |
|---|---|
| `test:api-voltagent` · `test:penjaga-alur` · `test:alur-tahap2` | 27 · 77 · 49 |
| `test:tahap4-6` · `test:audit-integrasi` · `test:pilihan-tiket` | 86 · 24 · 8 |
| `test:evaluator` · `test:batal-agent` | 42 · 5 |
| `test:jalur` · `test:agent-konfig` · `test:tiket` | 12 · 23 · 37 |
| **Lama: 390 / 390** · Baru: `test:tahap3` 120 + `test:tahap3-data` 22 | **Total 532 / 532** |
| `tsc --noEmit` | 0 galat baru (8 galat lama di berkas yang tidak disentuh) |

Isi regresi itu: Q1 periode, Q2/Q3 alat data, Q5 rancangan & klarifikasi, Q8 sapaan, multi-giliran, delegasi lintas agent, pembatalan (abort ke bawahan), isolasi sesi, dan penyaring stream.

**Tidak dijalankan:**
- `test:perute` (memanggil Claude);
- `test:tulis-umum` dan `test:tiket-ubah` (menulis ke database).

---

## 17. Analisis False-positive dan False-negative

**False positive (menolak target yang benar): 0 pada skenario uji.** Penekannya ada di desain:
- Penilaian hanya keras untuk dokumen, yang buktinya struktural.
- Data/tindakan ditolak paling banyak sekali, lalu keputusan perute dihormati.
- Tujuan `tidak-jelas` dan `campuran` yang tercakup tidak pernah ditolak.
- Jawaban singkat atas pertanyaan sebelumnya tidak dinilai.
- Kata periode (nama bulan) dan kata umum (total, status, daftar…) tidak dihitung sebagai bidang.

**Risiko yang tersisa:**
- Sinonim pada data/tindakan bisa memicu satu penolakan yang tidak perlu (biayanya satu langkah perute).
- Pertanyaan prosedur yang jawabannya justru ada di alat **data** (mis. materi induction) akan diarahkan ke pemegang dokumen.

**False negative (tidak menangkap salah rute):**
- **Kalimat di luar pola bahasa Indonesia** (Inggris, singkatan chat) jatuh ke `tidak-jelas` dan dilepas ke keputusan perute. Ini aman, tapi tidak dilindungi.
- **Salah rute data antar agent yang sama-sama menyinggung bidangnya** (mis. "penjualan" di Report dan Marketing) tidak ditolak. Yang menangkapnya `status_rute: tanpa-alat` + satu fallback (F3).
- **Tugas yang ditulis ulang perute** sampai kehilangan kata tujuannya tidak terbaca. Aturan Nomor Satu meminta kalimat pemakai apa adanya.

---

## 18. Dampak terhadap Performa

**Terukur offline:**

| Hal | Nilai |
|---|---|
| Panggilan LLM Q4 salah rute | sebelumnya 3 (jawaban salah) atau 6 (pulih); sesudah **4** = sama dengan rute benar (diuji: perute 2, Super Tools 0) |
| Panggilan tambahan untuk validasi | **0**. Semuanya deterministik di kode |
| Overhead kode per delegasi | regex + irisan himpunan atas ±100 alat, jauh di bawah 1 ms (tidak terukur di antara latensi tiruan) |
| Prompt perute | +1.835 karakter (±460 token) pada akses penuh |
| Registri | ±23 KB di memori per permintaan, tidak dikirim ke model |

**Perkiraan live (belum terukur):**
- **Q4 salah rute (36% pada baseline).**
  - Kasus yang dulu pulih (14/58) menghemat 2 panggilan: Super Tools (±7 dtk di RCA) dan satu langkah perute.
  - Kasus yang dulu gagal (7/58) jadi benar dengan biaya +1 panggilan (Portal merangkum).
  - Kalau proporsinya sama, rata-rata Q4 turun beberapa detik dan antrean vLLM berkurang ±2 panggilan per kasus yang dulu pulih.
- **Penolakan data** menambah satu langkah perute (biaya prompt perute, tanpa menjalankan agent salah). Jumlahnya harus diukur di live.
- **Biaya token tetap:** ±460 token per panggilan perute, untuk semua pertanyaan. Apakah ini tertutup oleh panggilan yang dihemat bergantung pada seberapa sering salah rute terjadi di live; ini diukur di R1/R2.

---

## 19. Risiko dan Keterbatasan

1. **Semua bukti offline.** Belum diukur bagaimana Qwen3-14B menanggapi `saran_agent`, `status_rute`, dan aturan "tujuan dulu".
2. **Pola tujuan berbasis bahasa Indonesia** (§17).
3. **Bidang data/tindakan dinilai dari kata.** Kalau tim IT menambahkan tag bidang di Kelola AI kelak, penilaiannya bisa dipertajam. Usulan ini **tidak** dikerjakan karena butuh persetujuan perubahan tabel.
4. **Pengalihan mengubah target** dari pilihan perute. Di benchmark, peristiwa `tool-call` tetap mencatat pilihan perute (Super Tools), sementara agent yang benar-benar menjawab terlihat di `jawaban_agen` dan `penjaga.rute.agent_dipakai`. Metrik live "agent relevan pertama" harus dihitung dari **keduanya**: pilihan model vs agent efektif.
5. **Validasi periode Tahap 4 membaca pesan pemakai utuh**, bukan potongan tugas. Pada pesan majemuk, alat berargumen periode milik bagian lain juga diingatkan periodenya. Tidak salah, tapi bisa menambah satu langkah. Tidak diubah karena di luar lingkup.
6. **`catatan_rute` bisa disalin perute ke pengguna.** Isinya tidak sensitif dan tidak dinilai "pesan internal" oleh evaluator, tapi tidak disaring.
7. **Dua delegasi paralel ke agent yang sama** dalam satu langkah berbagi catatan status per nama agent. Kasus ini tidak pernah muncul di RCA.
8. **Bot WhatsApp** memakai jalur lama, jadi tidak terpengaruh (sama seperti Tahap 2–6).
9. **Setelan berubah tanpa pemberitahuan** (§3). Registri mengikutinya otomatis, tapi skenario Q4 di benchmark bergantung pada Super Tools dan pemegang `cari_sop` yang ada saat uji.

---

## 20. Prosedur Rollback

1. **Cepat, tanpa ubah kode:** `RUTE_KEMAMPUAN=mati`, lalu restart.
   - Registri, penjaga kemampuan, `status_rute`, dan aturan perute baru mati; instruksi perute kembali ke versi sebelum Tahap 3 (diuji).
   - Penjaga Tahap 2/4/5/6 **tetap menyala**. Saklar mereka terpisah: `PENJAGA_ALUR`.
2. **Pulihkan file:**

   ```bash
   node .cadangan/tahap3-2026-11-24-1353/pulihkan.mjs              # simulasi
   node .cadangan/tahap3-2026-11-24-1353/pulihkan.mjs --jalankan
   ```

   - Sidik SHA-256 diperiksa lebih dulu.
   - 7 file dipulihkan ke versi sesudah Tahap 4–6.
   - 4 file baru dipindah ke `dibuang-<waktu>/`.
   - Independen dari cadangan Tahap 2 dan 4–6, yang tidak ditimpa.
3. **Kalau semua tahap dibatalkan:** urutannya Tahap 3 → Tahap 4–6 → Tahap 2.
   - Skrip lama menyebut dokumen di jalur `docs/` sebelum folder dirapikan. Jalankan dulu `node .cadangan/rapikan-docs-2026-11-24/pulihkan.mjs --jalankan` supaya jalurnya cocok.
4. Cadangan tidak memuat kredensial, dan `/.cadangan/` ada di `.gitignore`.

---

## 21. Rencana Live Testing Tahap 3 (PERLU PERSETUJUAN)

Digabung dengan rencana live Tahap 1–6 (`implementasi-final-perbaikan-workflow-agent.md` §11). Model `mr-ai-gateway-4gpu`, 4 replika, `max-num-seqs=4`, tanpa Anthropic, dan hanya membaca database.

| Fase | Isi | Permintaan | Kriteria |
|---|---|---:|---|
| **R1** A-B Q4 | `--fase berurutan --kode Q4 --ulang 20`, lalu sama dengan `RUTE_KEMAMPUAN=mati` | 40 | Menyala: `cari_sop` ≥ 98%, gagal 0, agent **efektif** = pemegang dokumen ≥ 95%, Super Tools tidak dieksekusi. Pilihan **pertama model** dicatat terpisah |
| **R2** kontrol intent | Pertanyaan §14 A–E (±18 pertanyaan) × 2. Butuh tambahan daftar di `profil-alur-agent.mts`, **minta persetujuan dulu** | ±36 | Status/sisa cuti ke pemegang data cuti, bukan ke SOP; tiket ke pemegang tiket; lintas agent menjawab dua bagian; ambigu tidak dipaksa; `tolak_kemampuan` dan `dipertahankan` dicatat |
| **R3** regresi | Q1–Q8 ×5 (sama dengan L3) | 40 | Tidak ada penurunan dibanding Tahap 4–6 offline/23 Nov |
| **R4** beban | Ikut L6 (10–20 pengguna) | — | `batas-fallback` dan putaran = 0; antrean vLLM untuk Q4 lebih rendah daripada 23 Nov |

Data yang dianalisis per permintaan:
- `penjaga.rute`: kebutuhan, target pertama, dialihkan, dibuang, dipertahankan, status handoff, agent dipakai;
- `delegasi_ditolak` dan `jawaban_agen`.

**Berhenti dan laporkan** kalau R1 tidak memenuhi kriteria.

---

## 22. Kesimpulan

Tahap 3 memindahkan keputusan "agent mana yang mampu" dari kemiripan kata ke **kemampuan alat yang terbukti terpasang** untuk pemakai itu.
- Tanpa nama agent di kode.
- Tanpa query atau panggilan LLM tambahan.
- Tanpa melewati penjaga Tahap 2–6.

Salah rute Q4 tertangkap **sebelum** agent yang salah berjalan dan dialihkan tanpa putaran. Hasil bawahan kini membedakan "tidak punya alat", "tidak ditemukan", dan "akses ditolak", sehingga fallback berjalan sekali dan berhenti.

Seluruh validasi masih offline: 532/532 dan dua kontrol negatif yang mereproduksi RCA. Klaim terhadap target live baru bisa dibuat sesudah R1–R4 disetujui dan dijalankan.
