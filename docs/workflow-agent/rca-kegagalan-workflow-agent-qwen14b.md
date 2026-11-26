# RCA — Kegagalan Workflow Agent Ratu AI pada Qwen3-14B-AWQ

> **Koreksi sesudah evaluasi ulang dengan evaluator v2 (24 Nov 2026)** — rincian di
> [implementasi-perbaikan-workflow-agent-qwen14b.md](implementasi-perbaikan-workflow-agent-qwen14b.md) §4.3:
> (1) Q8: **6 jawaban berisi teks panggilan alat mentah** (`delegate_task ke Portal, isinya "…"`) yang lolos evaluator lama
> — kegagalan fungsi Q8 sebenarnya minimal 6, sedangkan 3 kasus "memakai `daftar_sop`" sebetulnya jawaban wajar yang lambat.
> (2) Q5: putaran sampai batas langkah ada **4**, bukan 3 (`23N-870c581b`, 16 pengguna, kosong, lolos evaluator lama).
> (3) Angka 465 = skenario terukur; 497 = 465 + 32 pertanyaan pemanasan.

**Disusun:** 24 Nov 2026 · **Jenis:** analisis saja. Tidak ada kode, prompt, database, Docker, LiteLLM, atau benchmark yang diubah atau dijalankan ulang.
**Model:** Qwen3-14B-AWQ, vLLM `0.33.0rc1.dev1030`, LiteLLM `simple-shuffle`, `max-num-seqs 4`, batas 300 dtk per skenario.

**Data mentah yang ditelusuri** (semua di `data/agent-workflow-latency/`):

| Label | Folder | Mesin | Tahap | Isi jawaban | Argumen alat |
|---|---|---|---|---|---|
| 17N-A | `2026-11-17-03-11` | g5.2xlarge, 1 GPU | berurutan + 1/2/3/5/8 | NOT RECORDED | NOT RECORDED |
| 20N-pagi | `arsip-2026-11-20-02-19-4gpu-lama` | g5.12xlarge, 4 replika | berurutan + 1/2/3/5/8 | NOT RECORDED | NOT RECORDED |
| 20N-sore | `2026-11-20-07-30-4gpu` | g5.12xlarge, 4 replika | berurutan + 1/2/3/5/8 | ada (`jawaban.jsonl`) | NOT RECORDED |
| 23N | `2026-11-23-08-35-14b-seqs4-c10-20` | g5.12xlarge, 4 replika | 10/12/16/20 | ada | ada (`argumen-alat.jsonl`) |

Sumber per skenario: `kejadian.jsonl` (hasil & status), `span.jsonl` (tiap panggilan model, alat, delegasi, database), `panggilan.csv` (peran tiap panggilan + token dari LiteLLM), `jawaban.jsonl`, `argumen-alat.jsonl`. Konfigurasi agent dibaca ulang 24 Nov dengan memanggil `siapkanAgent()` secara baca-saja (lihat Batasan).

Label keyakinan: **CONFIRMED** = terbukti langsung dari data mentah atau kode · **LIKELY** = didukung bukti tidak langsung, belum dibuktikan · **UNKNOWN** = data yang dibutuhkan tidak tercatat.

---

## A. Executive Summary

**22 kegagalan dari 465 skenario** di empat uji (Q1, Q4, Q5, Q8; jenis pertanyaan lain tidak gagal).

| Pertanyaan | Gagal / muncul | Bentuk kegagalan |
|---|---:|---|
| Q4 SOP cuti | 7 / 58 | Dijawab "tidak bisa" tanpa `cari_sop` |
| Q5 rancangan tiket | 7 / 59 | 3 berputar sampai habis waktu/kosong, 4 jawaban akhir salah |
| Q1 total penjualan | 5 / 60 | Angka September tidak tertulis |
| Q8 sapaan | 3 / 58 | Memakai alat `daftar_sop` |

**Terkonfirmasi (CONFIRMED):**

1. **Q4 — salah rute oleh perute.** Ketujuh Q4 yang gagal diserahkan ke *Ratu AI Super Tools*, yang deskripsinya memuat frasa harfiah "**pengajuan cuti**" dan tidak punya `cari_sop`. Perute memilih Super Tools di 21 dari 58 Q4 (36%). 14 kali perute mencoba lagi ke Portal dan berhasil; 7 kali perute menerima jawaban "tidak bisa" sebagai jawaban akhir.
2. **Q5 — perute mengarang persetujuan pengguna, lalu berputar.** Kalimat contoh di instruksi perute, "User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk komputer…" ([agent-konfig.ts:619](../voltagent/agent-konfig.ts#L619)), muncul kata demi kata:
   - sebagai isi delegasi berulang di kasus habis waktu;
   - sebagai **jawaban akhir** ke pengguna (2 kasus).

   Agent Portal menerima tiap delegasi tanpa riwayat (`pesan=2`), sehingga selalu menebak lagi `sub_kategori: "INTERNET"` yang tidak sah. Perute mencapai batas 12 langkah (`MAKS_LANGKAH`, [agent-konfig.ts:38](../voltagent/agent-konfig.ts#L38)), lalu berakhir habis waktu atau jawaban kosong.
3. **Q1 (23N) — alat dipanggil tanpa periode.** Argumen `total_penjualan` tercatat `{}`. Alat itu diam-diam memakai bulan terakhir di tabel ([tools-penjualan.ts:73](../voltagent/tools-penjualan.ts#L73)), dan jawabannya menyatakan data September tidak ada, padahal ada.
4. **Q8 — perute menyerahkan sapaan ke Portal** (19 dari 58 Q8). Kalau Portal kemudian memakai `daftar_sop`, evaluator menggagalkannya. Jawaban ke pengguna sebenarnya masuk akal.
5. **Evaluator Q5 terlalu longgar.**
   - 49 dari 52 Q5 "benar" lolos hanya karena teksnya cocok pola.
   - **2 jawaban yang menyatakan "tiket telah dibuat" dinilai benar**, padahal tiket tersimpan selama uji = **0**. Yang terbentuk hanya rancangan.
6. **Tidak ada bukti kebocoran antar pengguna atau sesi.** 497/497 panggilan pertama perute dimulai tanpa riwayat. 163/164 isi delegasi sesuai pertanyaannya sendiri; satu sisanya tetap dari jejak yang sama.
7. **Habis waktu Q5 disebabkan putaran agent, bukan inference atau antrean.** Tiap panggilan model 3–34 dtk (normal); yang membuatnya 300 dtk adalah 25–36 panggilan berturut-turut.

**Masih hipotesis:**

- *LIKELY:* klaim "tiket telah dibuat" ditulis perute saat menyusun jawaban akhir. Alasannya: aturan larangan klaim hanya dipasang di agent yang punya alat rancangan ([agent-konfig.ts:187-224](../voltagent/agent-konfig.ts#L187-L224)), tidak di perute. Teks jawaban agent bawahan tidak tercatat, jadi belum terbukti siapa yang menulis.
- *LIKELY:* Q8 diserahkan karena instruksi perute tidak punya aturan untuk sapaan atau pertanyaan "bisa bantu apa".
- *UNKNOWN:* penyebab 4 kegagalan Q1 di 20N-pagi (jawaban & argumen tidak tercatat).
- *UNKNOWN:* putaran Q5 hanya muncul di ≥8 pengguna (6/32) dan tidak di 1–5 pengguna (0/27). Ini korelasi, mekanismenya tidak ditemukan; tiap skenario memakai sesi terpisah.

---

## B. Tabel RCA Per Skenario

ID = `<uji>-<8 karakter trace>`. Waktu dalam WIB. Kolom "Kategori" memakai enam kelompok penyebab: Model, Orkestrasi, Alat, LiteLLM/vLLM, Benchmark, Konkurensi/sesi.

| Scenario ID | Q | Pengguna | Waktu | Error | Expected | Actual | Root Cause (kategori) | Evidence | Confidence |
|---|---|---:|---|---|---|---|---|---|---|
| 17N-A-8669c2b0 | Q4 | berurutan | 17/11 10:33 | kriteria | `cari_sop` dipanggil | ke Super Tools, tanpa alat | Salah rute (Orkestrasi) | span: agent bawahan = Super Tools, 3 panggilan | CONFIRMED rute · jawaban NOT RECORDED |
| 17N-A-21dd04a3 | Q5 | 8 | 17/11 11:05 | kriteria | rancangan / minta sub-kategori | Portal pakai `cari_sop` saja | Jawaban akhir tidak memenuhi pola (Orkestrasi/Model) | span; teks NOT RECORDED | UNKNOWN |
| 17N-A-7fea9e97 | Q5 | 8 | 17/11 11:02 | habis waktu | rancangan / klarifikasi | 27 panggilan model, perute 12× | Putaran delegasi sampai batas langkah (Orkestrasi) | span: perute 12 panggilan; `cari_sop`×7, `siapkan_tiket`×1 | CONFIRMED putaran · isi delegasi NOT RECORDED |
| 20N-pagi-c9843f71 | Q1 | berurutan | 20/11 09:25 | kriteria | angka 156.770 | `total_penjualan` dipanggil | Tidak diketahui | span; jawaban & argumen NOT RECORDED | UNKNOWN |
| 20N-pagi-fd579512 | Q1 | berurutan | 20/11 09:31 | kriteria | idem | idem | Tidak diketahui | idem | UNKNOWN |
| 20N-pagi-f9322099 | Q1 | berurutan | 20/11 09:42 | kriteria | idem | perute delegasi, **tidak ada agent bawahan berjalan**, lalu menjawab sendiri | Delegasi ke agent yang tidak dipasang (Orkestrasi) | span: 2 panggilan perute, 0 panggilan agent bawahan | LIKELY (target delegasi NOT RECORDED) |
| 20N-pagi-c0ed2b31 | Q1 | 3 | 20/11 10:00 | kriteria | idem | `total_penjualan` dipanggil | Tidak diketahui | idem | UNKNOWN |
| 20N-pagi-967e75f1 | Q8 | 3 | 20/11 10:01 | kriteria | tanpa alat | ke Portal, `daftar_sop` | Delegasi sapaan (Orkestrasi) + kriteria ketat (Benchmark) | span | CONFIRMED rute |
| 20N-pagi-dd9a8492 | Q4 | 8 | 20/11 10:11 | kriteria | `cari_sop` | ke Super Tools | Salah rute (Orkestrasi) | span | CONFIRMED |
| 20N-sore-b550fa3d | Q8 | berurutan | 20/11 14:44 | kriteria | tanpa alat | ke Portal, `daftar_sop`; jawaban menyebut 63 SOP dan menawarkan bantuan | Delegasi sapaan (Orkestrasi) + kriteria ketat (Benchmark) | span + `jawaban.jsonl` | CONFIRMED |
| 20N-sore-f9e41979 | Q5 | berurutan | 20/11 14:57 | kriteria | klarifikasi / rancangan | jawaban akhir = "User menyetujui tawaran sebelumnya: siapkan tiket…" | Contoh prompt perute bocor ke jawaban (Orkestrasi) | `jawaban.jsonl`; [agent-konfig.ts:619](../voltagent/agent-konfig.ts#L619) | CONFIRMED |
| 20N-sore-d4e01e1d | Q4 | 2 | 20/11 15:08 | kriteria | `cari_sop` | Super Tools: "belum bisa mengambil data prosedur…" | Salah rute + perute tidak mencoba agent lain (Orkestrasi) | span + jawaban | CONFIRMED |
| 20N-sore-fa034cfa | Q5 | 3 | 20/11 15:13 | kriteria | klarifikasi / rancangan | jawaban akhir = "ya" (2 karakter) | Perute menjawab tawaran Portal atas nama pengguna (Orkestrasi) | span: Portal tulis 295 token teks, perute 2 token; jawaban | CONFIRMED |
| 23N-a0cbe4db | Q4 | 10 | 23/11 15:41 | kriteria | `cari_sop` | delegasi `{"task":"prosedur pengajuan cuti","targetAgents":["Ratu AI Super Tools"]}` | Salah rute (Orkestrasi) | `argumen-alat.jsonl` | CONFIRMED |
| 23N-cdef6b20 | Q5 | 10 | 23/11 15:41 | kriteria | klarifikasi / rancangan | jawaban akhir = "User menyetujui tawaran sebelumnya…" | Contoh prompt perute bocor (Orkestrasi) | jawaban; Portal hanya `cari_sop` | CONFIRMED |
| 23N-e69c2e7d | Q8 | 10 | 23/11 15:41 | kriteria | tanpa alat | delegasi "Halo, kamu bisa bantu apa saja?" ke Portal → `daftar_sop {}` | Delegasi sapaan (Orkestrasi) + kriteria ketat (Benchmark) | argumen + span | CONFIRMED |
| 23N-617e5976 | Q5 | 12 | 23/11 15:46 | habis waktu | klarifikasi / rancangan | 36 panggilan; perute 12×; `siapkan_tiket`×10 dengan `sub_kategori` INTERNET/AKSES INTERNET/KONEKSI INTERNET | Putaran: persetujuan dikarang + agent bawahan tanpa riwayat + `sub_kategori` ditebak (Orkestrasi + Alat) | argumen-alat (10 delegasi "User menyetujui…") | CONFIRMED |
| 23N-8bb3a0ac | Q4 | 16 | 23/11 15:54 | kriteria | `cari_sop` | ke Super Tools | Salah rute (Orkestrasi) | argumen-alat | CONFIRMED |
| 23N-d130aae3 | Q1 | 16 | 23/11 15:54 | kriteria | angka 156.770 | `total_penjualan {}` → data bulan terakhir; jawaban "tidak ada data September" | Argumen kosong (Model) + default diam-diam (Alat) | argumen-alat; [tools-penjualan.ts:73](../voltagent/tools-penjualan.ts#L73) | CONFIRMED |
| 23N-a660496f | Q4 | 20 | 23/11 16:02 | kriteria | `cari_sop` | ke Super Tools | Salah rute (Orkestrasi) | argumen-alat | CONFIRMED |
| 23N-8ee3e38f | Q4 | 20 | 23/11 16:03 | kriteria | `cari_sop` | ke Super Tools | Salah rute (Orkestrasi) | argumen-alat | CONFIRMED |
| 23N-9ae40e56 | Q5 | 20 | 23/11 16:03 | kosong | klarifikasi / rancangan | 25 panggilan; perute 12× lalu berhenti tanpa teks | Putaran sampai batas 12 langkah → jawaban kosong (Orkestrasi) | span + argumen-alat (perute menyuruh Portal "Pilih sub-kategori…" lalu 8× "belum memberikan deskripsi") | CONFIRMED |

---

## C. Agent Execution Trace

Urutan: User Request → Router → Selected Agent → LLM Call → Tool Call → Tool Result → Final Response → Evaluator. Hasil alat dan teks antar-agent **tidak dicatat** (`NOT RECORDED`); yang tercatat adalah status, waktu, nama alat, argumen (23N), dan jawaban akhir (20N-sore, 23N).

### C.1 Q4 — pola tunggal untuk ketujuh kasus

Contoh lengkap `23N-a0cbe4db` (10 pengguna):

| Langkah | Isi | Sumber |
|---|---|---|
| User Request | "Bagaimana prosedur pengajuan cuti?" | skrip |
| Router | 1 panggilan, 7,3 dtk, `finish=tool_calls`, `delegate_task` | span |
| Selected Agent | `{"task":"prosedur pengajuan cuti","targetAgents":["Ratu AI Super Tools"]}` | argumen-alat |
| LLM Call (Super Tools) | 7,3 dtk, `alat_tersedia=5`, `finish=stop`, tanpa alat | span |
| Tool Call | tidak ada | span |
| Tool Result | — | — |
| Final Response (Router) | "Ratu AI Super Tools belum bisa mengambil data prosedur pengajuan cuti dari sistem. Silakan … hubungi tim HR" | jawaban |
| Evaluator | gagal: `alat` tidak memuat `cari_sop` ([profil-alur-agent.mts:112](../scripts/profil-alur-agent.mts#L112)) | kejadian |

Kasus lain sama bentuknya. 17N-A-8669c2b0, 20N-pagi-dd9a8492, 20N-sore-d4e01e1d, 23N-8bb3a0ac, 23N-a660496f, dan 23N-8ee3e38f semuanya: perute → Super Tools → tanpa alat → perute menerima jawaban itu sebagai jawaban akhir. Jawaban untuk 17N dan 20N-pagi: `NOT RECORDED`.

Yang dilihat perute di daftar agent (dirakit ulang 24 Nov):

```
- Ratu AI Portal -- Tiket helpdesk, aset, profil & job scope, induction karyawan, dan Papan Kerja ...
  Bisa: ...; Cari SOP / panduan; Daftar SOP; ...
- Ratu AI Super Tools -- Kunjungan, callplan, order, tim lapangan, absensi, jam kerja,
  serta pengajuan cuti, izin, sakit, dan dinas.
  Bisa: Kunjungan outlet saya; Tugas lapangan saya; Baca persetujuan Supertools ...;
        Baca persetujuan cuti/izin untuk saya; Baca kotak masuk persetujuan Supertools.
```

### C.2 Q5 — tiga varian

**(a) Putaran sampai habis waktu — `23N-617e5976` (12 pengguna):**

| Langkah | Isi |
|---|---|
| User Request | "Buatkan tiket, komputer saya tidak ada akses internet" |
| Router #1 | delegasi ke Portal: "Buatkan tiket, komputer saya tidak ada akses internet" |
| Portal | `cari_sop {"pertanyaan":"komputer saya tidak ada akses internet"}` → menyusun hasil (teks NOT RECORDED) |
| Router #2 | delegasi: "**User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk komputer yang tidak ada akses internet**" |
| Portal | `siapkan_tiket {"kategori":"NETWORK","sub_kategori":"INTERNET",...}` → hasil alat NOT RECORDED (LIKELY `perlu-perbaikan`, lihat D.2) |
| Router #3–#12 | delegasi dengan kalimat yang **sama persis** 10 kali; tiap kali Portal mulai tanpa riwayat (`pesan=2`) dan memanggil `siapkan_tiket` lagi dengan sub-kategori tebakan (INTERNET ×8, AKSES INTERNET, KONEKSI INTERNET) |
| Final Response | tidak ada; klien berhenti di 301 dtk |
| Evaluator | `waktu-habis` |

Total 36 panggilan model (perute 12, Portal 24). Lama tiap panggilan 2,5–19 dtk, antrean vLLM di tahap ini rata-rata 0,34 dtk per panggilan, jadi bukan inference yang lambat.

**(b) Putaran sampai batas langkah — `23N-9ae40e56` (20 pengguna):**

Pola yang sama, tapi perute kali ini **menyuruh Portal memilih sendiri** ("Pilih sub-kategori yang sesuai dari opsi berikut: LAN, OTHERS, atau WIRELESS"), alih-alih menanyakannya ke pengguna. Setelah itu delegasinya 8× "User meminta bantuan … belum memberikan deskripsi masalah yang diperlukan". Panggilan perute ke-12 berakhir dengan `delegate_task`, jadi tidak ada langkah tersisa untuk menulis jawaban. Hasilnya stream selesai tanpa teks → status `kosong` di 237,9 dtk. Ini cocok dengan perilaku `maxSteps` yang sudah tercatat di CLAUDE.md (bagian "Dua bug yang ketahuan waktu Tahap 6").

**(c) Jawaban akhir salah — `20N-sore-f9e41979`, `23N-cdef6b20`, `20N-sore-fa034cfa`:**

| Langkah | Isi |
|---|---|
| Router | delegasi ke Portal |
| Portal | `cari_sop` (bukan `siapkan_tiket`), lalu menyusun hasil. Teks NOT RECORDED; LIKELY berupa langkah SOP + tawaran "Apakah Anda ingin saya menyiapkan tiket?" (bentuk ini muncul utuh di 6 jawaban Q5 lain) |
| Final Response (Router) | f9e41979 & cdef6b20: "User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk komputer yang tidak memiliki akses internet." · fa034cfa: "ya" |
| Evaluator | gagal (tidak memuat LAN/WIRELESS/sub-kategori/"menyiapkan tiket") |

Pada fa034cfa, Portal menulis 295 token teks, tetapi perute hanya menulis 2 token ("ya"). Perute **menjawab tawaran Portal seolah-olah dia penggunanya**.

17N-A-7fea9e97 (habis waktu, 8 pengguna) punya bentuk (a): perute 12 panggilan, Portal 7× `cari_sop` + 1× `siapkan_tiket`. Isi delegasi `NOT RECORDED`. 17N-A-21dd04a3: `NOT RECORDED` di luar span.

### C.3 Q1

`23N-d130aae3` (16 pengguna):

| Langkah | Isi |
|---|---|
| Router | delegasi ke Marketing: "Berapa total penjualan September 2026?" |
| Marketing | `total_penjualan {}`, **tanpa** `dari`/`sampai`/`relatif` |
| Tool Result | NOT RECORDED. Menurut kode: rentang = bulan terakhir di tabel ([tools-penjualan.ts:73](../voltagent/tools-penjualan.ts#L73)), tanpa penanda bahwa periodenya diganti |
| Final Response | menyatakan tidak ada data September, lalu menyebut total bulan Oktober (angka disamarkan di laporan ini) |
| Evaluator | gagal: teks tidak memuat 156.770 |

Pembanding: **20 dari 20** Q1 lain di 23N mengirim `{"dari":"2026-09","sampai":"2026-09"}` dan semuanya benar.

20N-pagi (4 kasus): tiga kasus berjalan perute → Marketing → `total_penjualan` → perute, normal di level span. Argumen dan jawaban `NOT RECORDED`. Satu kasus (f9322099): perute memanggil `delegate_task`, tetapi **tidak ada panggilan agent bawahan**, lalu perute menulis jawaban sendiri. Target delegasi `NOT RECORDED`. LIKELY targetnya agent yang tidak dipasang sebagai bawahan, misalnya *Ratu AI Report* ("Laporan penjualan dan stok", belum punya sumber data).

### C.4 Q8

`23N-e69c2e7d` (10 pengguna): perute berpikir 1.002 token (24,9 dtk) lalu delegasi `{"task":"Halo, kamu bisa bantu apa saja?","targetAgents":["Ratu AI Portal"]}`. Portal memanggil `daftar_sop {}`, lalu menyusun hasil, lalu perute menulis jawaban akhir: "Ratu AI Portal telah menampilkan daftar SOP yang tersedia…". Evaluator gagal karena ada alat. Total 72 dtk; Q8 yang dijawab langsung perute biasanya ±8 dtk.

20N-sore-b550fa3d dan 20N-pagi-967e75f1 sama bentuknya. Jawaban 20N-pagi `NOT RECORDED`.

---

## D. Analisis Pola Kegagalan

### D.1 Q4: kata "pengajuan cuti" mengalahkan aturan perute

| Pengguna | Q4 | Perute ke Super Tools dulu | Gagal |
|---:|---:|---:|---:|
| berurutan | 15 | 3 | 1 |
| 2 | 3 | 2 | 1 |
| 3 | 3 | 0 | 0 |
| 5 | 6 | 3 | 0 |
| 8 | 9 | 5 | 1 |
| 10 | 4 | 2 | 1 |
| 12 | 5 | 1 | 0 |
| 16 | 6 | 2 | 1 |
| 20 | 7 | 3 | 2 |
| **Total** | **58** | **21 (36%)** | **7** |

- Terjadi di **semua** tingkat pengguna, termasuk berurutan. **Konkurensi bukan penyebab.**
- Instruksi perute sudah berisi aturan yang tepat ([agent-konfig.ts:569-571](../voltagent/agent-konfig.ts#L569-L571)): "utamakan Ratu AI Portal … Jangan memilih agent hanya karena nama prosesnya, misalnya kata 'cuti'". **Aturan ini kalah oleh deskripsi agent yang memuat frasa yang sama persis** dengan pertanyaan.
- Aturan nomor 5 ([agent-konfig.ts:582-584](../voltagent/agent-konfig.ts#L582-L584)) membolehkan "tidak ada yang cocok" hanya kalau agent yang ditanya menjawab dokumennya tidak ada. Super Tools menjawab "tidak bisa mengambil data", dan perute **menerimanya sebagai jawaban akhir** di 7 dari 21 kasus. Di 14 kasus lain perute benar mencoba Portal.
- Evaluator Q4 sesuai perilaku aktual: jawabannya memang tidak memuat prosedur.

### D.2 Q5: satu rantai, tiga gejala

Rantai penyebabnya (semua langkah CONFIRMED kecuali yang ditandai):

1. **Alur bisnisnya memang butuh lebih dari satu giliran.** `siapkan_tiket` meminta `sub_kategori` berupa teks bebas tanpa daftar pilihan; contohnya hanya "PRINTER, LAPTOP". Model menebak "INTERNET", yang tidak sah untuk NETWORK, sehingga alat mengembalikan pilihan LAN / OTHERS / WIRELESS. Bukti: 15 jawaban Q5 di 23N dan 8 di 20N-sore berbunyi "Sub-kategori INTERNET tidak tersedia… pilih LAN, OTHERS, WIRELESS". Deskripsi alat memang menyuruh menyampaikan pilihan itu dan bertanya ke pengguna.
2. **Benchmark hanya satu giliran.** Perilaku yang benar adalah mengembalikan pertanyaan klarifikasi ke pengguna. Evaluator Q5 menerimanya lewat pola teks (`LAN|WIRELESS|sub-kategori|menyiapkan tiket`, [profil-alur-agent.mts:114-115](../scripts/profil-alur-agent.mts#L114-L115)). Jadi **ekspektasi evaluator pada dasarnya sesuai alur bisnis**: rancangan *atau* klarifikasi.
3. **Kegagalan muncul saat perute tidak mengembalikan pertanyaan itu ke pengguna.** Sebaliknya, perute:
   - meneruskan dengan persetujuan karangan, memakai kalimat contoh dari instruksinya sendiri ([agent-konfig.ts:612-624](../voltagent/agent-konfig.ts#L612-L624));
   - atau menulis kalimat itu sebagai jawaban akhir;
   - atau menjawab "ya" atas nama pengguna.

   Contoh itu ditulis untuk percakapan beberapa giliran ("sesudah Portal bertanya…, jawaban 'ya setuju' diteruskan sebagai…"). Di sini pengguna tidak pernah menjawab apa pun.
4. **Agent bawahan tidak melihat riwayat.** Setiap delegasi dimulai dengan `pesan=2` (sistem + tugas). Portal tidak tahu "INTERNET" sudah ditolak, jadi mengulang tebakan yang sama.
5. **Tidak ada penahan untuk delegasi berulang.** Satu-satunya batas adalah `maxSteps: 12` perute ([agent-konfig.ts:638](../voltagent/agent-konfig.ts#L638)). Dengan ±20 dtk per putaran, batas ini tercapai di ±240–300 dtk. Itu sebabnya hasilnya bisa habis waktu (617e5976, 7fea9e97) atau kosong (9ae40e56).

**Konkurensi:** putaran (perute ≥3 delegasi) muncul 0/27 di 1–5 pengguna dan 6/32 di 8–20 pengguna. Tiap skenario adalah sesi baru (`pesan=2` di panggilan pertama untuk 497/497 skenario). Tidak ada state bersama yang ditemukan di kode jalur benchmark. Isi delegasi selalu sesuai pertanyaannya sendiri. Penjelasan yang mungkin: sampling model tidak deterministik, dan hasil vLLM bisa sedikit berbeda menurut komposisi batch. Ini **UNKNOWN**; sampelnya kecil (32) untuk menyimpulkan.

**Evaluator Q5 terlalu longgar (CONFIRMED):**

| Kelompok jawaban Q5 (uji yang mencatat jawaban) | 20N-sore | 23N | Dinilai evaluator |
|---|---:|---:|---|
| Minta pilih sub-kategori (klarifikasi sah) | 8 | 15 | benar |
| Rancangan terbentuk | 0 | 1 | benar |
| Hanya menawarkan "menyiapkan tiket?", belum ada rancangan | 2 | 2 | benar |
| **Mengaku "tiket telah dibuat"**, padahal tersimpan 0 | 0 | **2** | **benar** |
| Teks prompt bocor / "ya" | 2 | 1 | gagal |
| Habis waktu / kosong | 0 | 2 | gagal |

Dua jawaban "Tiket helpdesk Anda telah dibuat. Nomor tiket akan terbentuk otomatis…" (12 dan 16 pengguna, `rancangan` 2 dan 1) melanggar aturan alat ("JANGAN katakan tiketnya sudah dibuat"). Di aplikasi web kartu konfirmasi tetap muncul, jadi tidak ada data tertulis. Tapi pengguna diberi tahu tiketnya sudah ada, dan bisa tidak menekan Simpan. Aturan larangan ini hanya ditempel ke agent dengan alat rancangan ([agent-konfig.ts:187-224](../voltagent/agent-konfig.ts#L187-L224)), bukan ke perute yang menulis jawaban akhir. Siapa yang menulis klaim itu: **LIKELY perute**, karena teks Portal tidak tercatat.

### D.3 Q1: argumen kosong + default diam-diam

- Di 23N: 20/20 benar dengan argumen lengkap, 1/1 gagal dengan `{}`. **CONFIRMED** untuk kasus ini.
- Skema `total_penjualan` tidak mewajibkan parameter apa pun. Kalau semuanya kosong, rentangnya diam-diam jadi bulan terakhir di tabel ([tools-penjualan.ts:73](../voltagent/tools-penjualan.ts#L73)). Model lalu menafsirkan hasil itu sebagai "September tidak ada". Ini gabungan **Model** (lupa mengisi periode) dan **Alat** (default yang tidak memberi tanda).
- 20N-pagi (4 kasus): **UNKNOWN**. Catatan: prompt panggilan pertama Marketing di 20N-pagi 4.875 token, sedangkan di 23N 4.154 token. Artinya setelan agent atau alat Marketing berubah di antara kedua uji (tabel setelan dibagi dengan tim lain). Q1 di 20N-sore benar 13/13. Hipotesis untuk 20N-pagi (argumen kosong, salah format angka, atau delegasi ke agent tak terpasang) belum bisa dibuktikan.
- Evaluator Q1 mewajibkan string persis "156.770". Format lain ("156,770", "156 ribu") akan gagal walau benar. Tidak ada bukti ini terjadi di 23N; di 20N-pagi UNKNOWN.

### D.4 Q8: sapaan diserahkan

- Perute menyerahkan Q8 di 19/58 kemunculan (Portal 18, Admin 1). Gagal hanya kalau Portal lalu memanggil `daftar_sop` (3 kasus); 15 delegasi lain dijawab Portal tanpa alat dan lolos.
- Instruksi perute mewajibkan meneruskan pertanyaan data dan prosedur, tetapi **tidak menyebut sapaan atau "bisa bantu apa"** (LIKELY penyebabnya). Perute berpikir panjang di kasus ini (959–1.002 token), tanda keputusannya ragu.
- **Tidak ada riwayat percakapan yang memengaruhi**: `pesan=2` di semua panggilan pertama. **Tidak ada kebocoran konteks**: isi delegasi = pertanyaan itu sendiri.
- Jawaban ke pengguna masuk akal (memperkenalkan SOP yang tersedia). Kerugiannya waktu (35–72 dtk vs ±8 dtk). **Kriteria evaluator lebih ketat daripada kebutuhan pengguna**; ini masalah kualitas, bukan kegagalan fungsi.

### D.5 Lintas workflow

| Kelompok penyebab | Temuan |
|---|---|
| **Model** | Q1 argumen kosong (1 kasus, CONFIRMED). Pemilihan agent Q4 dan Q8 juga keputusan model, tapi dipicu isi prompt dan daftar agent (lihat Orkestrasi) |
| **Orkestrasi** | Penyebab utama: Q4 salah rute (7), Q5 persetujuan karangan & putaran (6 dari 7), Q8 delegasi sapaan (3), Q1 delegasi tanpa agent berjalan (1, LIKELY). Batas 12 langkah membuat putaran berakhir kosong, bukan dengan pesan gagal |
| **Alat** | `total_penjualan` diam-diam memakai bulan terakhir; `siapkan_tiket` tidak memberi daftar `sub_kategori` sah di skema, sehingga klarifikasi pasti terjadi |
| **LiteLLM/vLLM** | Tidak ada bukti. Di ke-22 skenario gagal tercatat 155 panggilan model: **155/155 HTTP 200**, 0 terpotong (`finish` hanya `tool_calls` 87 dan `stop` 68), 0 retry LiteLLM. Antrean vLLM tidak menjelaskan habis waktu |
| **Benchmark** | Evaluator Q5 meloloskan klaim palsu "tiket telah dibuat" dan tawaran tanpa rancangan. Evaluator Q8 menggagalkan jawaban yang wajar. Skenario Q5 satu giliran untuk alur bisnis yang butuh dua giliran. Skenario habis waktu tidak dibatalkan di server ([profil-alur-agent.mts:252](../scripts/profil-alur-agent.mts#L252)), sehingga putaran tetap memakai slot sesudah 300 dtk |
| **Konkurensi/sesi** | Tidak ada bukti kebocoran. Q4 dan Q8 gagal juga saat berurutan. Q5 berputar hanya di ≥8 pengguna: korelasi, belum ada mekanisme (UNKNOWN) |

---

## E. Prioritas Perbaikan

| Prioritas | Masalah | Alasan |
|---|---|---|
| **P0** | — (tidak ditemukan) | Tiket tersimpan 0 di semua uji. Alat tulis hanya membuat rancangan. Tidak ada kebocoran antar pengguna. ⚠️ Persetujuan karangan (Q5) **akan menjadi P0** kalau suatu saat ada alat yang langsung menulis tanpa kartu konfirmasi |
| **P1** | 1. Q5: perute mengarang persetujuan pengguna & berputar sampai habis waktu/kosong | Alur gagal; jawaban kosong atau teks prompt bocor ke pengguna |
| **P1** | 2. Q5: klaim "tiket telah dibuat" padahal hanya rancangan | Pengguna salah paham dan bisa tidak menekan Simpan |
| **P1** | 3. Q4: salah rute ke Super Tools, lalu menyerah | Pertanyaan SOP dijawab "tidak bisa" padahal SOP-nya ada |
| **P1** | 4. Q1: periode kosong → bulan terakhir tanpa tanda | Jawaban salah ("September tidak ada") |
| **P1** | 5. Evaluator Q5 terlalu longgar | Tanpa ini, perbaikan nomor 1–2 tidak bisa diukur dan uji regresi bisa lolos palsu |
| **P2** | 6. Q8: sapaan diserahkan ke agent | Jawaban benar tapi 5–9× lebih lambat |
| **P2** | 7. `siapkan_tiket` tidak memberi daftar `sub_kategori` | Klarifikasi selalu terjadi, satu putaran terbuang |
| **P2** | 8. Celah pencatatan: hasil alat & teks antar-agent tidak tercatat; argumen dan jawaban baru dicatat sejak 20–23 Nov | Membatasi RCA (lihat Batasan) |

---

## F. Rekomendasi Teknis

> Semua rekomendasi belum dikerjakan. Yang menyentuh `ai_agent`/`ai_tool` adalah keputusan tim IT/pemilik setelan (tabel dibagi dengan tim lain; lihat CLAUDE.md "Tabel setelan itu DIBAGI").

### F.1 Q5 — hentikan persetujuan karangan (P1)
- **Penyebab:** contoh "User menyetujui tawaran sebelumnya…" di instruksi perute dipakai di percakapan satu giliran; perute menjawab tawaran agent atas nama pengguna.
- **Ubah:** `voltagent/agent-konfig.ts`, `instruksiPerute` ([baris 612-624](../voltagent/agent-konfig.ts#L612-L624)).
- **Bentuk:**
  1. Syarat eksplisit: kalimat "User menyetujui…" hanya boleh dipakai kalau **pesan terakhir dari pengguna** berisi persetujuan.
  2. Aturan: "Kalau agent bawahan bertanya atau menawarkan sesuatu, sampaikan pertanyaan itu ke pengguna dan berhenti. Jangan menjawabnya sendiri."
  3. Pertimbangkan contoh yang tidak bisa disalin mentah (mis. pakai placeholder), karena model menyalin contoh kata demi kata.
- **Dampak:** varian (a), (b), (c) di C.2 berhenti di klarifikasi pertama.
- **Risiko regresi:** perute jadi terlalu cepat berhenti pada pertanyaan lanjutan yang sah, yaitu alur dua giliran "ya setuju" yang menjadi alasan contoh itu ditulis.
- **Validasi:** G.2 Q5 satu giliran **dan** skenario dua giliran (giliran 2 = "LAN" / "ya") harus menghasilkan rancangan.

### F.2 Q5 — penahan putaran di kode (P1)
- **Penyebab:** tidak ada batas delegasi berulang selain `maxSteps 12`. Batas itu habis dalam keadaan tool-call, sehingga jawaban kosong.
- **Ubah:** jalur perute (`voltagent/agent-konfig.ts` / `voltagent/jalur-agent.ts`). **API VoltAgent untuk mencegat `delegate_task` perlu diverifikasi dulu di `node_modules/@voltagent/core`**, jangan ditebak dari docs (lihat CLAUDE.md).
- **Bentuk:** hitung delegasi ke agent yang sama per permintaan. Kalau isi tugasnya sama atau hampir sama dengan delegasi sebelumnya, atau sudah ≥3 kali, hentikan dan kembalikan jawaban terakhir agent ke pengguna. Kalau `maxSteps` habis tanpa teks, tampilkan pesan gagal yang jujur, bukan kosong.
- **Dampak:** habis waktu dan kosong Q5 → 0; waktu maksimum Q5 turun dari ±300 dtk ke ±60 dtk.
- **Risiko:** alur sah yang memang butuh banyak delegasi (pertanyaan lintas aplikasi) terpotong. Ambang harus berlaku per agent dan per isi tugas, bukan total.
- **Validasi:** G.2 Q5 di 12–20 pengguna; target perute ≤2 delegasi per Q5, 0 kosong, 0 habis waktu.

### F.3 Q5 — larangan klaim di perute (P1)
- **Penyebab (LIKELY):** aturan "JANGAN katakan sudah dibuat" hanya ada di agent dengan alat rancangan ([agent-konfig.ts:187-224](../voltagent/agent-konfig.ts#L187-L224)).
- **Ubah:** tambahkan aturan setara ke `instruksiPerute`. Opsional: pemeriksa pasca-jawaban di jalur web/WA. Kalau rancangan dibuat di permintaan ini dan teks memuat "telah/sudah/berhasil dibuat/disimpan", ganti dengan kalimat standar "Rancangan tiket sudah disiapkan, tekan Simpan".
- **Dampak:** klaim palsu → 0.
- **Risiko:** pemeriksa regex salah tangkap kalimat sah (mis. "tiket yang sudah dibuat minggu lalu" saat menanyakan tiket lama). Hanya aktifkan kalau ada rancangan baru di permintaan yang sama.
- **Validasi:** evaluator ketat F.5 di G.2.

### F.4 Q4 — rute SOP (P1)
- **Penyebab:** deskripsi Super Tools memuat "pengajuan cuti", dan perute menyerah setelah jawaban "tidak bisa".
- **Ubah, pilih salah satu atau gabungan:**
  1. *(keputusan tim IT, lewat layar Kelola AI)* perjelas deskripsi Super Tools, mis. "data pengajuan cuti milik penanya (status, persetujuan) — bukan prosedur/SOP";
  2. `instruksiPerute`: pertanyaan "bagaimana / prosedur / cara / syarat" → selalu Portal dulu, apa pun kata bendanya;
  3. aturan 5: kalau agent yang ditanya menjawab tidak punya alat untuk pertanyaan prosedur, wajib coba agent yang memegang `cari_sop` sebelum menyerah.
- **Dampak:** delegasi pertama ke Portal naik dari 64% ke mendekati 100%; kegagalan Q4 → 0.
- **Risiko:** pertanyaan data cuti pribadi ("cuti saya disetujui belum?") ikut terlempar ke Portal. Uji G.3 harus memuat pertanyaan itu.
- **Validasi:** G.2 Q4 + kasus kontrol data cuti.

### F.5 Evaluator benchmark (P1, harus sebelum uji regresi)
- **Ubah:** `scripts/profil-alur-agent.mts`, `PERTANYAAN[].benar` ([baris 106-121](../scripts/profil-alur-agent.mts#L106-L121)), dan pencatatan.
- **Bentuk:**
  - **Q5 lulus** kalau rancangan terbentuk **atau** jawaban berisi klarifikasi sub-kategori (LAN/WIRELESS/OTHERS). **Gagal** kalau memuat klaim "telah/sudah/berhasil dibuat/disimpan" atau teks "User menyetujui". "Hanya menawarkan" dicatat sebagai kategori sendiri.
  - **Q8:** catat "sapaan dengan alat" sebagai kualitas (lambat), terpisah dari gagal fungsi.
  - **Q1:** cocokkan angka setelah normalisasi format (titik/koma/spasi).
  - **Catat, tanpa isi:** status hasil alat (`siap` / `perlu-perbaikan` / `data-belum-ada`), panjang teks jawaban tiap agent bawahan, target delegasi di semua uji, dan argumen alat yang dipanggil di langkah terakhir (sekarang tertangkap hanya kalau ada panggilan model sesudahnya).
- **Dampak:** angka akurasi Q5 turun ke angka sebenarnya (23N: dari 20/23 ke 16–18/23). Penyebab bisa dibaca tanpa menebak.
- **Risiko:** angka historis tidak sebanding langsung; laporkan kedua versi evaluator berdampingan.
- **Validasi:** jalankan evaluator baru pada `jawaban.jsonl` lama (tanpa uji ulang). Harus menghasilkan tabel D.2.

### F.6 Q1 — default periode yang memberi tanda (P1)
- **Ubah:** `voltagent/tools-penjualan.ts` ([baris 69-73](../voltagent/tools-penjualan.ts#L69-L73)).
- **Bentuk:** kalau `relatif`, `dari`, dan `sampai` semuanya kosong, kembalikan `periode_otomatis: true` beserta pesan: "Pengguna tidak menyebut bulan di argumen; yang ditampilkan bulan terakhir X. Kalau pertanyaan menyebut bulan, panggil ulang dengan `dari`/`sampai`." Atau kembalikan `perlu-periode` tanpa angka.
- **Dampak:** model memanggil ulang dengan periode yang benar, tidak lagi menyimpulkan "September tidak ada".
- **Risiko:** pertanyaan sah "total penjualan terbaru" jadi butuh satu panggilan lagi. Pilih varian yang tetap mengembalikan data plus tanda.
- **Validasi:** G.2 Q1 + kontrol "berapa total penjualan terbaru?".

### F.7 Q8 — aturan sapaan (P2)
- **Ubah:** `instruksiPerute`.
- **Bentuk:** "Sapaan dan pertanyaan 'bisa bantu apa' dijawab sendiri dari daftar agent di atas, tanpa delegasi."
- **Risiko:** pertanyaan kemampuan spesifik ("SOP apa saja yang ada?") ikut dijawab perute tanpa `daftar_sop`. Ini kegagalan yang pernah terjadi 26 Okt (lihat komentar [agent-konfig.ts:455-461](../voltagent/agent-konfig.ts#L455-L461)). Batasi ke sapaan umum.
- **Validasi:** G.2 Q8 + kontrol "SOP apa saja yang ada?" (harus tetap `daftar_sop`).

### F.8 `siapkan_tiket` — daftar sub-kategori (P2)
- **Ubah:** definisi alat tiket (penyusun rancangan + `lib/entri/pilihan.ts`); keputusan tim IT kalau lewat setelan.
- **Bentuk:** sebutkan pasangan kategori → sub-kategori yang sah di deskripsi parameter, dengan instruksi "kalau tidak jelas mana, tanyakan".
- **Risiko:** model memilih sub-kategori sendiri tanpa bertanya, padahal pengguna yang tahu. Tetap tampilkan di kartu konfirmasi supaya pengguna bisa mengoreksi.

---

## G. Rencana Pengujian Ulang

**Prasyarat:** F.5 (evaluator ketat + pencatatan tambahan) dikerjakan lebih dulu. Skrip uji perlu opsi baru untuk memilih jenis pertanyaan dan jumlah ulangan (belum ada), dan skenario dua giliran untuk Q5 (belum ada).

### G.1 Ukuran keberhasilan

| Q | Metrik | Baseline (data saat ini) | Target |
|---|---|---|---|
| Q4 | delegasi pertama ke agent pemegang `cari_sop` | 37/58 (64%) | ≥ 95% |
| Q4 | `cari_sop` terpanggil | 51/58 (88%) | ≥ 98% |
| Q5 | habis waktu + kosong | 3/59 | 0 |
| Q5 | delegasi perute ≥3 per skenario | 6/59 | 0 |
| Q5 | klaim "telah dibuat" / "User menyetujui" / "ya" | 5 (di 35 yang tercatat jawabannya) | 0 |
| Q5 (2 giliran) | rancangan terbentuk setelah giliran 2 | belum pernah diuji | ≥ 90% |
| Q1 | argumen periode terisi | 20/21 (23N) | 100% |
| Q1 | angka benar (normalisasi format) | 55/60 | ≥ 98% |
| Q8 | dijawab tanpa delegasi | 39/58 | ≥ 90% |

### G.2 Uji terarah (Q1, Q4, Q5, Q8)

- Tiap Q **20 kali berurutan** (1 pengguna) **dan 20 kali di 12 pengguna**. Q5 hanya berputar di ≥8 pengguna, jadi tingkat ini wajib.
- Q5 tambahan: **10 skenario dua giliran**:
  - giliran 2 = "LAN" → harapan: rancangan terbentuk, tanpa klaim tersimpan;
  - giliran 2 = "ya" setelah tawaran → harapan: rancangan.
- **Kasus kontrol (tidak boleh rusak oleh perbaikan):**
  - "cuti saya sudah disetujui belum?" → harus ke Super Tools;
  - "SOP apa saja yang ada?" → harus `daftar_sop`;
  - "berapa total penjualan terbaru?" → angka bulan terakhir dengan tanda periode.

### G.3 Uji regresi (Q2, Q3, Q6, Q7)

- Tiap Q **10 kali berurutan + 10 kali di 12 pengguna**, kriteria lama tidak diubah.
- Ambang lulus: tidak lebih buruk dari baseline. Q2, Q3, Q6, Q7 di empat uji: **0 gagal** dari seluruh kemunculannya.
- Bandingkan juga P50 waktu dan jumlah panggilan model per pertanyaan; kenaikan >20% dicatat sebagai regresi performa.

### G.4 Cara membaca hasil
- Pakai penelusur jejak yang sama (`span.jsonl` + `argumen-alat.jsonl` + `jawaban.jsonl`) untuk tiap kegagalan baru, dan isi tabel B dengan format yang sama.
- Laporkan akurasi dengan evaluator lama **dan** baru berdampingan, supaya penurunan angka karena evaluator lebih ketat tidak dibaca sebagai regresi.

---

## Batasan analisis

- **Hasil alat dan teks antar-agent tidak pernah dicatat.** Isi yang dikembalikan `siapkan_tiket` (`perlu-perbaikan`?) dan `total_penjualan` disimpulkan dari kode dan dari jawaban akhir, bukan dibaca langsung.
- **Isi jawaban hanya ada di 20N-sore dan 23N; argumen alat hanya di 23N.** 9 dari 22 kasus (17N, 20N-pagi) hanya bisa ditelusuri sampai tingkat span.
- **Argumen alat ditangkap dari badan permintaan model berikutnya.** Alat yang dipanggil di langkah terakhir (tanpa panggilan model sesudahnya) tidak tercatat argumennya.
- **Token per panggilan di 10–20 pengguna kurang andal.** Pemasangan panggilan ke catatan LiteLLM 97% (736/762). Beberapa angka token di jejak 23N tampak tertukar antar panggilan yang mulai bersamaan; total per tahap tetap benar. Analisis ini tidak memakai token per panggilan sebagai bukti.
- **Konfigurasi agent dibaca ulang 24 Nov, bukan saat uji.** Tabel setelan dibagi dengan tim lain dan bisa berubah. Jumlah alat per agent (Portal 10, Super Tools 5, Marketing 7) cocok dengan `alat_tersedia` di jejak 23N, tapi ukuran prompt Marketing di 20N-pagi (4.875 token) berbeda dari 23N (4.154), jadi setelan 20N-pagi **tidak sama** dengan yang dibaca hari ini.
- **Satu kali uji per kondisi.** Jumlah per jenis pertanyaan per tahap 3–8, terlalu kecil untuk menyimpulkan efek konkurensi.

## Lampiran — cara memverifikasi

Penelusur yang dipakai ada di scratchpad sesi analisis dan hanya membaca berkas di `data/`:
- penelusur jejak per skenario (span + argumen + jawaban);
- penghitung pola lintas uji (agent pertama, alat, jumlah delegasi);
- perakit ulang daftar agent dan skema alat (memanggil `siapkanAgent()`, hanya SELECT, tanpa memanggil model).

Untuk memeriksa satu kasus tanpa skrip: cari `trace` di `kejadian.jsonl`, lalu saring `span.jsonl` dan `argumen-alat.jsonl` dengan `trace` yang sama, urutkan menurut `mulai`.
