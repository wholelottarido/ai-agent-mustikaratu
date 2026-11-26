# Rencana Uji Beban Ratu AI — Model Qwen3 14B (MR AI Gateway)

**Disusun:** 12 November 2026
**Status:** RENCANA, belum dijalankan. Semua tabel hasil di bawah masih kosong dan diisi setelah uji.
**Model yang diuji:** `Qwen3 14B (Gateway)` → deployment `qwen3-14b` di LiteLLM, vLLM di AWS EC2 Jakarta

> Dokumen ini menjelaskan apa yang diuji, bagaimana caranya, apa yang diukur, dan bentuk laporan
> hasilnya. Angka "target" di bagian 8 adalah **usulan awal** yang perlu disetujui, bukan
> persyaratan resmi perusahaan.

---

## 1. Latar belakang

Ratu AI menjawab satu pertanyaan lewat beberapa langkah. Ratu AI Umum meneruskan pertanyaan ke agent
aplikasi, agent memanggil alat (database, SOP, rancangan tiket), lalu jawaban dirangkai. Dari uji
11–12 November 2026, satu pertanyaan memakai **sekitar 4–12 panggilan ke model**.

Data awal dengan **satu pemakai** (uji alur tiket, 12 Nov 2026):

| Giliran | Waktu | Hasil |
|---|---:|---|
| Minta tiket | 43,6 dtk | Berhasil |
| "iya" | 27,8 dtk | Berhasil |
| Pilih sub-kategori | 40,9 dtk | Rancangan tersusun |
| Total panggilan ke model | 12 | Semua HTTP 200, tanpa retry |

Yang belum diketahui: **apa yang terjadi kalau beberapa orang bertanya bersamaan.**

## 2. Tujuan

1. Mengukur **waktu jawab** Ratu AI saat 1, 2, 3, 5, dan 8 orang bertanya bersamaan.
2. Menemukan jumlah pemakai di mana jawaban mulai **gagal** (429, putus koneksi, waktu habis).
3. Menentukan **titik sempit**: GPU/vLLM, batas virtual key LiteLLM, atau laptop yang menjalankan
   portal.
4. Memeriksa apakah **ketepatan jawaban** turun saat beban naik.

## 3. Dugaan awal (hipotesis yang diuji)

Dugaan berikut dibuktikan atau dibantah oleh hasil uji:

| No | Dugaan | Dasar |
|---|---|---|
| H1 | Waktu jawab naik tajam di atas 2 pemakai | vLLM disetel `max-num-seqs 2` (logbook 10 Nov), jadi hanya 2 permintaan dilayani sekaligus |
| H2 | Galat 429 muncul sebelum GPU penuh | Semua pemakai portal berbagi satu virtual key, dan key 14B pernah kena 429 dengan satu pemakai (11 Nov) |
| H3 | Lewat portal (lapis B) lebih lambat daripada agent langsung (lapis A) | Portal berjalan di laptop 8 GB dalam mode dev, dan model pencarian SOP butuh RAM besar |
| H4 | Ketepatan pemilihan alat tidak turun karena beban | Beban hanya memperlambat; isi permintaan ke model tetap sama |

## 4. Ruang lingkup

| Diuji | Tidak diuji |
|---|---|
| Qwen3 14B lewat MR AI Gateway | Qwen3.5 35B, Claude, Gemma |
| Alur agent yang sama dengan portal (`siapkanAgent` → `streamText`) | Penyimpanan data. Tiket hanya sampai rancangan |
| Dua lapis: agent langsung dan lewat `/api/chat` | Perubahan konfigurasi EC2, Docker, vLLM, atau LiteLLM |
| Kecepatan, keberhasilan, ketepatan | Kualitas bahasa jawaban secara subjektif |

## 5. Daftar pertanyaan uji

Delapan pertanyaan yang mewakili fitur portal. Setiap pemakai virtual mengambil pertanyaan secara
acak dengan urutan yang bisa diulang (seed tetap), supaya setiap tahap bisa dibandingkan.

| Kode | Jenis | Pertanyaan | Dianggap benar kalau |
|---|---|---|---|
| Q1 | Data penjualan | "Berapa total penjualan September 2026?" | Alat `total_penjualan` dipanggil dan angka cocok dengan query database |
| Q2 | Peringatan dini | "Produk apa yang penjualannya turun di September 2026?" | Alat `pergerakan_penjualan` dipanggil |
| Q3 | Stok kosong | "Produk apa yang paling sering kosong di September 2026?" | Alat `stok_kosong` dipanggil |
| Q4 | SOP | "Bagaimana prosedur pengajuan cuti?" | Alat `cari_sop` dipanggil dan menyebut dokumen yang ditemukan |
| Q5 | Rancangan tiket | "Buatkan tiket, komputer saya tidak ada akses internet" | Diteruskan ke agent Portal; rancangan atau pertanyaan sub-kategori muncul; tidak ada tiket tersimpan |
| Q6 | Data karyawan | "Siapa saja karyawan departemen IT?" | Alat data karyawan dipanggil |
| Q7 | Harus ditolak | "Berapa gaji direktur?" | Menolak tanpa menyebut angka |
| Q8 | Sapaan | "Halo, kamu bisa bantu apa saja?" | Dijawab tanpa memanggil alat data |

Daftar ini perlu disetujui pemilik proyek sebelum uji dijalankan.

## 6. Skenario uji

### 6.1 Tahap jumlah pemakai

| Tahap | Pemakai bersamaan | Pertanyaan per pemakai | Total pertanyaan | Lanjut ke tahap berikut kalau |
|---|---:|---:|---:|---|
| T1 Dasar | 1 | 3 | 3 | selalu |
| T2 Ringan | 2 | 3 | 6 | galat < 50% |
| T3 Sedang | 3 | 3 | 9 | galat < 50% |
| T4 Target | 5 | 3 | 15 | galat < 20% |
| T5 Batas | 8 | 3 | 24 | — (tahap terakhir) |

- Jeda antar pertanyaan dari satu pemakai: **5 detik**, meniru orang membaca lalu mengetik.
- Jeda antar tahap: **2 menit**, supaya antrean GPU dan kuota key kembali normal.
- Batas waktu satu pertanyaan: **300 detik**. Lewat dari itu dihitung "waktu habis".
- Semua pemakai virtual mulai bersamaan di awal tahap.

### 6.2 Dua lapis pengukuran

| Lapis | Jalur | Yang diukur |
|---|---|---|
| **A — Agent langsung** | Skrip memanggil agent seperti `scripts/uji-alur-tiket.mts` | Gateway + model, tanpa server web |
| **B — Lewat portal** | Skrip mengirim permintaan ke `http://localhost:3000/api/chat` dengan sesi login | Gateway + model + server Next.js di laptop |

Lapis A dijalankan dulu untuk semua tahap, baru lapis B. Selisih A dan B menunjukkan beban yang datang
dari laptop.

### 6.3 Pengulangan

Kalau waktu memungkinkan, seluruh uji diulang sekali di jam berbeda. Jawaban model berubah-ubah, dan
beban server bisa berbeda tiap jam.

## 7. Yang diukur

| No | Ukuran | Satuan | Sumber |
|---|---|---|---|
| M1 | Waktu jawab per pertanyaan: median (P50) dan 95% terlama (P95) | detik | Skrip uji |
| M2 | Waktu sampai kata pertama (TTFT) per panggilan model | detik | Log `[gateway]` (`msHeader`) |
| M3 | Jumlah panggilan ke model per pertanyaan | kali | Log `[gateway]` |
| M4 | Token masuk dan keluar per pertanyaan | token | Metadata jawaban |
| M5 | Persen pertanyaan berhasil | % | Skrip uji |
| M6 | Jenis galat: 429, ECONNRESET, ECONNREFUSED, 500, waktu habis | jumlah | Skrip uji + log `[gateway]` |
| M7 | Jumlah retry otomatis | kali | Log `[gateway]` (`ulang`) |
| M8 | Ketepatan: pertanyaan yang memenuhi kolom "dianggap benar" di bagian 5 | % | Pemeriksaan otomatis |
| M9 | Tiket yang tersimpan selama uji | jumlah | Query `portal_ticket` sebelum dan sesudah |
| M10 | Memori GPU terpakai, beban GPU | GB, % | `nvidia-smi` di EC2, dicatat pemilik proyek |
| M11 | CPU dan RAM container vLLM dan LiteLLM | %, GB | `docker stats` di EC2, dicatat pemilik proyek |
| M12 | RAM dan CPU laptop | GB, % | Dicatat skrip uji dari laptop |

## 8. Target hasil (usulan, perlu disetujui)

Target ini **usulan awal** berdasarkan pengamatan satu pemakai (28–44 detik per giliran). Kalau
pemilik proyek atau tim punya angka lain, angka di bawah diganti.

| Ukuran | Target pada T4 (5 pemakai) | Keterangan |
|---|---|---|
| Waktu jawab P50 | ≤ 90 dtk | Sekitar 2× waktu satu pemakai |
| Waktu jawab P95 | ≤ 180 dtk | Di atas 3 menit, pemakai kemungkinan besar berhenti menunggu |
| Persen berhasil | ≥ 90% | |
| Galat 429 | 0 | Kalau ada, batas key yang jadi titik sempit, bukan model |
| Ketepatan (M8) | ≥ 80%, dan tidak turun lebih dari 10 poin dari T1 | |
| Tiket tersimpan (M9) | **0, wajib** | Uji hanya membuat rancangan |
| API key di log atau laporan | **0, wajib** | |

Hasil akhir dinyatakan per target: **TERCAPAI**, **TIDAK TERCAPAI**, atau **TIDAK TERUKUR**
(dengan alasannya).

## 9. Bentuk laporan hasil

Laporan ditulis sebagai `docs/benchmark/hasil-uji-beban-qwen3-14b.md`, plus berkas data mentah
`data/uji-beban-qwen3-14b-<tanggal>.csv` yang tidak ikut Git. Isinya sebagai berikut.

### 9.1 Ringkasan satu paragraf

Berapa pemakai yang masih nyaman, di mana titik sempitnya, dan saran utama.

### 9.2 Tabel hasil utama (per tahap, per lapis)

| Tahap | Pemakai | Lapis | Pertanyaan | Berhasil | P50 (dtk) | P95 (dtk) | TTFT P50 (dtk) | Panggilan model / pertanyaan | 429 | Putus koneksi | Waktu habis | Retry |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T1 | 1 | A | | | | | | | | | | |
| T2 | 2 | A | | | | | | | | | | |
| T3 | 3 | A | | | | | | | | | | |
| T4 | 5 | A | | | | | | | | | | |
| T5 | 8 | A | | | | | | | | | | |
| T1 | 1 | B | | | | | | | | | | |
| T2 | 2 | B | | | | | | | | | | |
| T3 | 3 | B | | | | | | | | | | |
| T4 | 5 | B | | | | | | | | | | |
| T5 | 8 | B | | | | | | | | | | |

### 9.3 Tabel per jenis pertanyaan (pada T4, 5 pemakai)

| Kode | Jenis | Jumlah dijawab | Berhasil | Benar (M8) | P50 (dtk) | Panggilan model rata-rata | Token keluar rata-rata |
|---|---|---:|---:|---:|---:|---:|---:|
| Q1 | Data penjualan | | | | | | |
| Q2 | Peringatan dini | | | | | | |
| Q3 | Stok kosong | | | | | | |
| Q4 | SOP | | | | | | |
| Q5 | Rancangan tiket | | | | | | |
| Q6 | Data karyawan | | | | | | |
| Q7 | Harus ditolak | | | | | | |
| Q8 | Sapaan | | | | | | |

### 9.4 Tabel sumber daya

| Tahap | GPU memori (GB) | Beban GPU (%) | CPU vLLM (%) | RAM laptop terpakai (GB) | CPU laptop (%) |
|---|---:|---:|---:|---:|---:|
| T1 | | | | | |
| T2 | | | | | |
| T3 | | | | | |
| T4 | | | | | |
| T5 | | | | | |

### 9.5 Tabel pencapaian target

| Ukuran | Target | Hasil | Status |
|---|---|---|---|
| Waktu jawab P50 (T4) | ≤ 90 dtk | | |
| Waktu jawab P95 (T4) | ≤ 180 dtk | | |
| Persen berhasil (T4) | ≥ 90% | | |
| Galat 429 (T4) | 0 | | |
| Ketepatan (T4) | ≥ 80% | | |
| Tiket tersimpan | 0 | | |
| API key di log | 0 | | |

### 9.6 Tabel pembuktian dugaan

| Dugaan | Terbukti / Tidak / Belum jelas | Bukti |
|---|---|---|
| H1 Waktu naik tajam di atas 2 pemakai | | |
| H2 429 muncul sebelum GPU penuh | | |
| H3 Lapis B lebih lambat dari lapis A | | |
| H4 Ketepatan tidak turun karena beban | | |

### 9.7 Grafik

Grafik dibuat dari data uji yang sebenarnya. Tidak ada angka contoh atau angka karangan. Bentuknya
halaman HTML statis di `docs/grafik-uji-beban-qwen3-14b.html` (dengan versi gambar PNG untuk
logbook), mode terang dan gelap, plus tabel datanya di bawah tiap grafik.

| No | Grafik | Sumbu X | Sumbu Y | Jenis | Yang ingin dilihat |
|---|---|---|---|---|---|
| G1 | Waktu jawab vs jumlah pemakai | Pemakai (1, 2, 3, 5, 8) | Detik | Garis, dua garis per lapis (P50 tegas, P95 putus-putus), dengan garis batas target | Kapan waktu jawab mulai melonjak, dan apakah target tercapai |
| G2 | Persen berhasil vs jumlah pemakai | Pemakai | % berhasil | Garis + garis target 90% | Kapan galat mulai muncul |
| G3 | Jenis galat per tahap | Tahap T1–T5 | Jumlah galat | Batang bertumpuk (429, putus koneksi, waktu habis, 500) | Galat mana yang dominan |
| G4 | Sebaran waktu jawab per tahap | Tahap T1–T5 | Detik | Titik per pertanyaan (strip plot) | Apakah lambatnya merata atau hanya sebagian pertanyaan |
| G5 | Waktu jawab per jenis pertanyaan (T4) | Q1–Q8 | Detik P50 | Batang horizontal | Pertanyaan jenis apa yang paling berat |
| G6 | Ketepatan vs jumlah pemakai | Pemakai | % benar | Garis | Apakah beban menurunkan ketepatan |
| G7 | Lapis A vs lapis B | Pemakai | Detik P50 | Dua garis | Seberapa besar beban dari laptop |

Sketsa bentuk G1 (tanpa angka):

```
detik
  |                                   ● P95 lapis B
  |                          ●  - - -
  |                 ●  - - -            ○ P50 lapis B
  |  - - - - - - - - - - - - - - - - - -  batas target P95
  |        ○ ─ ─ ─ ○ ─ ─ ─ ─ ○
  |  ○ ─ ─ ○
  +----+-----+-----+-----------+--------> pemakai bersamaan
       1     2     3           5        8
```

### 9.8 Kesimpulan dan saran

Saran ditulis berdasarkan titik sempit yang terbukti, misalnya:

| Kalau titik sempitnya | Saran yang mungkin |
|---|---|
| Antrean vLLM (`max-num-seqs`) | Menaikkan `max-num-seqs` sesuai sisa memori GPU, lalu uji ulang |
| Batas virtual key (429) | Menaikkan RPM/TPM key, atau key terpisah per pemakai |
| Laptop (lapis B jauh lebih lambat) | Menjalankan portal di server, bukan di laptop |
| Jumlah panggilan model per pertanyaan | Mengurangi langkah agent, misalnya alat yang menjawab langsung tanpa delegasi |

Saran bersifat usulan. Perubahan di EC2, vLLM, atau LiteLLM diputuskan dan dikerjakan pemilik proyek.

## 10. Prosedur pelaksanaan

| Langkah | Siapa | Isi |
|---|---|---|
| 1 | Pemilik proyek | Menyetujui daftar pertanyaan (bagian 5) dan target (bagian 8) |
| 2 | Pemilik proyek | Memberi tahu batas RPM/TPM virtual key `qwen3-14b` (angkanya saja, bukan key-nya) |
| 3 | Claude | Membuat skrip uji beban dan pemeriksaan ketepatan, lalu uji coba dengan 1 pemakai |
| 4 | Pemilik proyek | Memastikan tunnel SSH menyala, Continue dan pemakai lain tidak memakai Qwen3 14B |
| 5 | Pemilik proyek | Membuka terminal EC2 dan menjalankan `nvidia-smi -l 5` serta `docker stats` selama uji |
| 6 | Claude | Menjalankan lapis A, tahap T1–T5 |
| 7 | Claude | Menjalankan lapis B, tahap T1–T5, dengan server portal menyala |
| 8 | Pemilik proyek | Mengirim catatan angka GPU dan container per tahap |
| 9 | Claude | Menyusun laporan, tabel, dan grafik (bagian 9) |
| 10 | Bersama | Membahas hasil dan memutuskan tindak lanjut |

## 11. Batas keamanan

- Database **hanya dibaca**. Rancangan tiket tidak pernah disimpan, dan jumlah tiket dicek sebelum
  dan sesudah uji.
- Tidak ada perubahan di EC2, Docker, vLLM, LiteLLM, maupun model bawaan portal.
- API key, isi `.env.local`, dan isi percakapan tidak dicetak ke log maupun laporan. Log gateway
  hanya memuat model, agent, durasi, status, dan jenis galat.
- Uji **dihentikan** kalau satu tahap galatnya lebih dari 50%, gateway berhenti menjawab, atau RAM
  laptop hampir habis.
- Data mentah hasil uji tidak ikut ke Git.

## 12. Perkiraan waktu dan beban

| Hal | Perkiraan |
|---|---|
| Membuat dan mencoba skrip | sekitar 1–1,5 jam |
| Menjalankan lapis A (T1–T5) | sekitar 25–40 menit |
| Menjalankan lapis B (T1–T5) | sekitar 25–40 menit |
| Menyusun laporan dan grafik | sekitar 1 jam |
| Total pertanyaan | 57 per lapis, 114 untuk dua lapis |
| Total panggilan ke model | sekitar 500–1.400, tergantung jenis pertanyaan |

## 13. Risiko dan batasan

| Risiko | Dampak | Penanganan |
|---|---|---|
| Batas key kecil | Hasil didominasi 429, kecepatan model kurang terlihat | Dicatat sebagai temuan; uji bisa diulang setelah batas dinaikkan |
| RAM laptop habis (model pencarian SOP gagal dimuat) | Q4 gagal karena laptop, bukan karena model | Dicatat terpisah; pertanyaan SOP dilaporkan dengan keterangan |
| Tunnel SSH putus di tengah uji | Lonjakan galat ECONNREFUSED | Tahap diulang setelah tunnel pulih |
| Pemakaian lain (Continue, tim) bersamaan | Angka tercampur | Uji dijadwalkan; pemakaian lain dicatat kalau terjadi |
| Jawaban model berbeda-beda tiap kali | Ketepatan bervariasi | Dilaporkan sebagai persentase dari beberapa jawaban |
| Satu sesi uji | Belum tentu mewakili jam lain | Diulang di jam berbeda kalau memungkinkan |

## 14. Hal yang perlu diputuskan sebelum mulai

- [ ] Daftar pertanyaan (bagian 5) disetujui
- [ ] Target hasil (bagian 8) disetujui atau diganti
- [ ] Batas RPM/TPM key `qwen3-14b` diketahui
- [ ] Jadwal uji ditentukan
- [ ] Pemantauan EC2 (`nvidia-smi`, `docker stats`) siap
