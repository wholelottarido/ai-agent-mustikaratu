# Profil Latensi Alur Agent Ratu AI — Qwen3 14B

**Tanggal:** 16 November 2026, 16.22–17.04 WIB
**Grafik:** tab **Alur agent** di `docs/grafik-uji-beban-qwen3-14b.html` (komposisi waktu, waterfall per pertanyaan, Q4/Q5)
**Skrip:** `scripts/profil-agent.mts` (pengukur) dan `scripts/olah-profil-agent.py` (pengolah)
**Data mentah:** `data/profil-agent-2026-11-16-09-22.jsonl` dan turunannya (bagian 10). Folder `data/` tidak ikut Git.

> Laporan ini melanjutkan dua pengukuran sebelumnya:
> - **uji beban** (`docs/benchmark/hasil-uji-beban-qwen3-14b.md`): berapa lama Ratu AI menjawab saat banyak
>   orang bertanya;
> - **benchmark model** (`docs/benchmark/benchmark-inferensi-qwen3-14b.md`): seberapa cepat model menulis.
>
> Pengukuran ini menjawab pertanyaan berikutnya: **di dalam satu pertanyaan, waktunya habis di
> langkah mana?**

---

## 1. Ringkasan

| Ukuran (1 pengguna, 40 pertanyaan) | Hasil |
|---|---|
| Waktu tengah per pertanyaan | **34,5 detik** (P95 61 detik) |
| Panggilan model per pertanyaan | 3,8 rata-rata (1–7) |
| Waktu yang dipakai model | **95%** dari total |
| — model **berpikir** (reasoning) | **17,3 detik = 51%** |
| — model menulis teks | 11,3 detik = 33% |
| — menunggu kata pertama | 2,6 detik = 8% |
| — model menulis rencana alat | 1,2 detik = 3% |
| Alat (query database, cari SOP, rancangan tiket) | **0,5 detik = 1,5%** |
| Persiapan agent (baca setelan dari database) | 1,1 detik = 3% |
| Token per pertanyaan | 16.400 masuk, 1.430 keluar, ±870 di antaranya berpikir (±61%) |

| Ukuran (5 pengguna bersamaan, 40 pertanyaan) | Hasil |
|---|---|
| Waktu tengah per pertanyaan | **48,3 detik** (P95 87,5 detik) |
| Antre di vLLM per panggilan | 1,3 detik (saat 1 pengguna: 0) |
| Waktu menulis per panggilan di vLLM | 10,3 detik (saat 1 pengguna: 8,3) |

| Hasil | |
|---|---|
| Benar | 77 dari 80 (semua yang kurang tepat adalah Q5 tiket) |
| Galat / preemption / tiket tersimpan | 0 / 0 / 0 |
| Panggilan model tercatat | 323, semuanya punya trace ID; 319 cocok dengan catatan LiteLLM |

**Penghambat terbesar, berdasarkan hasil ukur:**
1. **Bagian berpikir model, 51% waktu.** Setiap panggilan diawali reasoning. Itu termasuk
   panggilan yang tugasnya hanya memilih agent atau memilih alat, yang 82–92% token keluarannya
   adalah berpikir.
2. **Jumlah panggilan model yang berurutan, 4 untuk setiap pertanyaan data.** Salah satunya
   adalah perute yang menulis ulang jawaban akhir, sekitar 7,6 detik per pertanyaan, padahal agent
   aplikasi sudah menulis jawabannya.
3. **Rute yang tidak stabil di Q5 (tiket).** Satu kali terjadi pengulangan 12 kali penyerahan
   antar-agent, dengan 29 panggilan model dan waktu 278 detik.

**Yang bukan penghambat:** alat dan database (1,5%), persiapan agent (3%), jaringan dan gateway
(±1,4 detik per pertanyaan, 4%), serta kartu grafis. Dari benchmark model, kartu grafis bekerja
normal di sekitar 50 token per detik.

---

## 2. Arsitektur yang diukur

Jalur konfigurasi (`JALUR_AGENT=konfigurasi`), dipanggil langsung lewat
`siapkanAgent() → agent.streamText()`, sama dengan lapis A di uji beban. Pengukuran ini tidak lewat
portal Next.js.

```
siapkanAgent()                          persiapan: hak akses + setelan agent/alat dari database
└─ Ratu AI Umum (perute)                panggilan 1: berpikir → delegate_task ke agent aplikasi
   └─ agent aplikasi (Marketing/Portal/Admin/…)
      ├─ panggilan 2: berpikir → memilih alat
      ├─ alat: query view / cari_sop / siapkan_tiket (tidak menulis)
      └─ panggilan 3: berpikir → menulis hasil
   └─ panggilan 4: perute berpikir → menulis ulang jawaban akhir (streaming ke pengguna)
```

Agent aplikasi yang dipakai di uji ini:

| Agent | Pertanyaan |
|---|---|
| Ratu AI Marketing | Q1, Q2, Q3 |
| Ratu AI Portal | Q4 (SOP), Q5 (tiket) |
| Ratu AI Admin | Q6 (karyawan), Q7 (gaji, harus ditolak) |
| Ratu AI Super Tools | 1 kali di Q5 |

Q8 (sapaan) kadang langsung dijawab perute, kadang diserahkan dulu ke agent lain.

Setiap pertanyaan memakai model Qwen3 14B AWQ lewat LiteLLM dan tunnel Cloudflare, dengan vLLM
`max-num-seqs=4`. Mode berpikir Qwen3 **menyala** di jalur ini.

---

## 3. Cara mengukur

**Kode Ratu AI, prompt, logika rute, konfigurasi, dan Docker/AWS tidak diubah.** Pencatatnya
dipasang di skrip uji saja:

| Yang dicatat | Caranya |
|---|---|
| Setiap panggilan model | `fetch` global dibungkus sebelum modul agent dimuat, khusus alamat gateway. Stream diteruskan apa adanya lewat salinan (`tee()`). Salinannya hanya dibaca untuk mencatat **waktu dan jenis potongan** (berpikir, rencana alat, teks), bukan isinya. Nama agent dibaca dengan `ringkasPermintaan()` yang sudah ada |
| Setiap alat | `laporProgres` (parameter resmi `siapkanAgent`) mencatat mulai dan selesai |
| Trace ID | Dibuat per pertanyaan dan dibawa `AsyncLocalStorage`. Semua 323 panggilan dari agent bawahan tercatat di trace yang benar, termasuk saat 5 pengguna bertanya bersamaan |
| Token, TTFT server | Catatan LiteLLM (kolom waktu, token, status). Dicocokkan per panggilan berdasarkan jam mulai: 319 dari 323 cocok |
| Antre / prefill / decode | Histogram vLLM `/metrics` dibaca lewat SSH sebelum dan sesudah. Saat 1 pengguna: per pertanyaan (40 dari 40, jumlah permintaan cocok dengan jumlah panggilan). Saat 5 pengguna: untuk seluruh fase |

**Pecahan waktu satu pertanyaan.** Langkah-langkah agent berjalan satu per satu, jadi waktunya
bisa dijumlahkan:

| Bagian | Arti |
|---|---|
| Persiapan | `siapkanAgent`: baca hak akses dan setelan, rakit agent |
| Menunggu kata pertama | Panggilan dikirim sampai potongan pertama datang: jaringan, gateway, antre, dan olah prompt |
| Berpikir | Model menulis bagian reasoning (tidak ditampilkan ke pengguna) |
| Rencana alat | Model menulis nama dan argumen alat |
| Menulis teks | Model menulis teks |
| Alat | Alat berjalan, di luar waktu model |
| Lain | Sisa: kerangka agent, perpindahan antar-agent, jeda antar langkah |

**Jalannya uji.** Ke-8 pertanyaan sama persis dengan uji beban.
- **Berurutan:** 5 putaran, satu pertanyaan per waktu, jeda 5 detik, urutan diacak dengan seed
  tetap.
- **Lalu, setelah jeda 1 menit, 5 pengguna bersamaan:** setiap pengguna menanyakan ke-8 pertanyaan
  dengan urutannya sendiri.
- Batas waktu 5 menit per pertanyaan.
- Tiket hanya sampai rancangan. Jumlah tiket di database diperiksa sebelum dan sesudah: 0
  bertambah.

**Yang tidak dicatat:** isi pertanyaan, jawaban, dokumen SOP, argumen alat, data karyawan, API
key, dan header. Yang disimpan hanya kode pertanyaan, nama agent dan alat, waktu, jumlah potongan,
token, dan status.

---

## 4. Ke mana waktunya habis (1 pengguna)

Rata-rata 5 kali per pertanyaan, dalam detik:

| Pertanyaan | Total P50 | Panggilan model | Persiapan | Tunggu | **Berpikir** | Rencana | Menulis | **Alat** | Token keluar (≈ berpikir) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Q1 Data penjualan | 30,1 | 4 | 1,5 | 2,4 | **15,9** | 1,2 | 8,2 | 0,7 | 1.238 (813) |
| Q2 Peringatan dini | 57,2 | 4 | 0,6 | 3,6 | **17,8** | 1,2 | 29,5 | 0,5 | 2.305 (897) |
| Q3 Stok kosong | 40,7 | 4 | 1,1 | 2,5 | **15,8** | 1,4 | 17,5 | 0,4 | 1.652 (797) |
| Q4 SOP | 31,0 | 4,6 (4–7) | 0,9 | 3,6 | **19,0** | 1,2 | 7,9 | 1,1 | 1.359 (964) |
| Q5 Rancangan tiket | 37,9 | 5,0 (4–7) | 1,0 | 3,2 | **20,5** | 2,7 | 4,8 | 1,3 | 1.351 (1.038) |
| Q6 Data karyawan | 34,6 | 4 | 1,5 | 2,5 | **13,9** | 1,0 | 16,2 | 0,1 | 1.416 (686) |
| Q7 Harus ditolak | 15,1 | 3 | 1,2 | 1,8 | **9,9** | 0,5 | 2,2 | 0 | 620 (512) |
| Q8 Sapaan | 21,6 | 1,8 (1–3) | 1,0 | 0,8 | **25,8** | 0,2 | 4,2 | 0 | 1.484 (1.282) |
| **Semua** | **34,5** | **3,8** | **1,1** | **2,6** | **17,3** | **1,2** | **11,3** | **0,5** | **1.428 (874)** |

"Menulis" di tabel ini sudah termasuk ekor stream (±1 detik). "≈ berpikir" dihitung dari porsi
potongan berpikir di setiap panggilan, dikalikan token keluar dari LiteLLM. Angkanya perkiraan,
bukan hitungan tokenizer.

Yang terbaca:
- **Bagian berpikir adalah porsi terbesar di setiap jenis pertanyaan**, kecuali Q2 dan Q3 yang
  jawabannya panjang (daftar produk). Bahkan sapaan (Q8) rata-rata berpikir 25,8 detik. Salah satu
  sapaan berpikir sekitar 1.000 token dan butuh 71,9 detik, padahal hanya menjawab "halo".
- **Alat hampir tidak terasa:** 0–1,3 detik per pertanyaan.
- **Persiapan agent stabil sekitar 1 detik.** Ini waktu membaca setelan agent dan alat dari
  database perusahaan setiap kali ada pertanyaan.
- **Sangat sedikit waktu yang tersisa di luar model, alat, dan persiapan** (0,1–0,3 detik). Kerangka
  agent (VoltAgent) sendiri bukan penghambat.

---

## 5. Setiap jenis panggilan model (1 pengguna)

Waktu tengah per panggilan:

| Jenis panggilan | Jumlah | Lama | Berpikir | Token masuk | Token keluar | ≈ porsi berpikir |
|---|---:|---:|---:|---:|---:|---:|
| Perute: memilih agent | 37 | 4,9 dtk | 3,4 dtk | 2.779 | 227 | 82% |
| Perute: menjawab langsung (sapaan) | 3 | 14,7 dtk | 10,6 dtk | 2.777 | 715 | 77% |
| Marketing: memilih alat | 15 | 4,2 dtk | 3,0 dtk | 4.880 | 190 | 88% |
| Portal: memilih alat | 12 | 6,6 dtk | 5,6 dtk | 5.252 | 305 | 91% |
| Admin: memilih alat | 5 | 3,1 dtk | 2,2 dtk | 4.181 | 138 | 92% |
| Marketing: menyusun hasil | 15 | 18,1 dtk | 5,1 dtk | 6.585 | 754 | 37% |
| Portal: menyusun hasil | 12 | 6,4 dtk | 4,0 dtk | 7.267 | 260 | 67% |
| Admin: menyusun hasil | 5 | 12,9 dtk | 3,0 dtk | 5.208 | 579 | 33% |
| **Perute: jawaban akhir** | 37 | **7,6 dtk** | 3,5 dtk | 3.354 | 338 | 54% |

Yang terbaca:
- **Keputusan kecil memakan berpikir yang panjang.** Memilih agent atau alat hanya menghasilkan
  satu pemanggilan alat, tetapi model berpikir 2,2–5,6 detik dulu. Dua keputusan ini terjadi di
  setiap pertanyaan data, jadi menyumbang sekitar 9–11 detik.
- **Perute menulis ulang jawaban.** Setelah agent aplikasi selesai menulis hasil (260–750 token),
  perute berpikir lagi lalu menulis jawaban akhir (±340 token). Langkah ini makan 7,6 detik per
  pertanyaan, sekitar 22% dari total.
- **Menunggu kata pertama singkat saat sepi:** 0,3–1,2 detik per panggilan. Sebagian besar prompt
  sudah ada di cache vLLM (82–99% per pertanyaan). Olah prompt di vLLM rata-rata 0,24 detik per
  panggilan.
- **Jaringan dan gateway (laptop → Cloudflare → LiteLLM):** ±0,37 detik per panggilan, ±1,4 detik
  per pertanyaan. Angka ini adalah selisih lama panggilan di laptop dengan lama yang dicatat
  LiteLLM.

---

## 6. Alat dan database

| Alat | Dipanggil (1 / 5 pengguna) | P50 | Paling lama |
|---|---:|---:|---:|
| `total_penjualan` | 5 / 5 | 0,7 / 0,3 dtk | 1,3 dtk |
| `pergerakan_penjualan` | 5 / 5 | 0,6 / 0,5 dtk | 1,1 dtk |
| `stok_kosong` | 5 / 5 | 0,4 / 0,7 dtk | 1,3 dtk |
| `asisten_karyawan` | 5 / 5 | 0,07 / 0,03 dtk | 0,6 dtk |
| `cari_sop` | 9 / 8 | 0,6 / 0,7 dtk | **19,2 dtk** (5 pengguna) |
| `daftar_sop` | 1 / 0 | 0,1 dtk | 0,1 dtk |
| `siapkan_tiket` | 4 / 8 | 0,3 / 0,03 dtk | 0,4 dtk |

- **Query database tidak menjadi penghambat.** Semua query view selesai dalam ±1 detik, juga saat
  5 pengguna.
- **`cari_sop` sekali butuh 19 detik** saat 5 pengguna, dan sekali 2,7 detik saat 1 pengguna.
  Pencarian SOP membuat embedding dengan model `multilingual-e5-base` yang berjalan di laptop,
  sementara memori laptop hampir penuh. Dugaannya, lonjakan itu karena embedding berebut CPU dan
  memori. Penyebab pastinya belum dibuktikan, karena waktu embedding dan waktu query pgvector tidak
  diukur terpisah. Untuk memisahkannya, alat itu sendiri perlu diberi pencatat.
- Waktu database di dalam persiapan agent (±1 detik) tidak bisa dipecah lebih jauh tanpa
  menambah pencatat di `siapkanAgent`.

---

## 7. Efek antrean: 1 pengguna vs 5 pengguna bersamaan

| Ukuran | 1 pengguna | 5 bersamaan |
|---|---:|---:|
| Waktu tengah per pertanyaan | 34,5 dtk | **48,3 dtk** |
| P95 | 61,0 dtk | 87,5 dtk |
| Menunggu kata pertama, per pertanyaan | 2,6 dtk | 8,6 dtk |
| Berpikir, per pertanyaan | 17,3 dtk | 25,2 dtk |
| Menulis, per pertanyaan | 11,3 dtk | 16,4 dtk |
| Alat, per pertanyaan | 0,5 dtk | 1,0 dtk |
| vLLM: antre per panggilan | 0,00 dtk | **1,34 dtk** |
| vLLM: olah prompt (prefill) per panggilan | 0,24 dtk | 0,28 dtk |
| vLLM: menulis (decode) per panggilan | 8,3 dtk | **10,3 dtk** |
| Panggilan model per pertanyaan | 3,8 | 4,3 (Q5 sekali 29) |

Waktu tengah naik sekitar 14 detik, dengan dua penyebab:
- **Antre:** 4,3 panggilan × 1,3 detik ≈ 6 detik. Dengan 5 pengguna dan batas 4 permintaan
  sekaligus, sebagian panggilan harus menunggu giliran.
- **Menulis lebih lambat:** setiap token ditulis sekitar 20–25% lebih lambat karena kartu grafis
  dibagi. Ini sesuai dengan benchmark model (TPOT 19 → 22–29 ms pada 4 permintaan bersamaan).
  Karena sebagian besar token adalah berpikir, bagian berpikir ikut bertambah sekitar 8 detik.

Rata-rata waktu per pertanyaan saat 5 pengguna (54,6 detik) lebih tinggi daripada waktu tengahnya
(48,3 detik). Satu Q5 makan 278 detik, dan dibahas di bagian 8.

---

## 8. Analisis khusus Q4 (SOP) dan Q5 (rancangan tiket)

### Q4 — Bagaimana prosedur pengajuan cuti?

| Jalur | Kali | Benar | Total P50 | Panggilan model |
|---|---:|---:|---:|---:|
| `cari_sop` | 9 | 9 | 48,3 dtk | 4,2 |
| `cari_sop` → `daftar_sop` | 1 | 1 | 52,2 dtk | 7 |

- **Stabil: 10 dari 10 benar.** Pada 13 Nov, Q4 sempat dijawab tanpa alat SOP saat ramai. Di uji
  ini, itu tidak terjadi lagi.
- Waktu Q4 hampir seluruhnya model. Saat 1 pengguna, model berpikir 19 detik dan menulis 8 detik,
  sedangkan `cari_sop` hanya 1,1 detik.
- **Agent Portal berpikir paling lama saat memilih alat** (5,6 detik, 91% token keluar). Prompt
  Portal juga paling besar: ±5.250 token masuk pada panggilan pertama, dan ±7.270 pada panggilan
  menyusun hasil.

### Q5 — Buatkan tiket, komputer saya tidak ada akses internet

| Jalur | Kali | Benar | Total P50 | Panggilan model |
|---|---:|---:|---:|---:|
| `cari_sop` → `siapkan_tiket` | 5 | 4 | 44,2 dtk | 5,4 |
| `siapkan_tiket` langsung | 3 | 3 | 45,2 dtk | 12,3 (karena satu kasus 29) |
| `cari_sop` saja | 2 | **0** | 19,1 dtk | 4 |

- **Satu pertanyaan, tiga jalur.** Model kadang mencari SOP dulu, kadang langsung menyiapkan tiket,
  dan kadang hanya mencari SOP lalu berhenti. Kalau hanya mencari SOP, jawabannya kurang tepat
  (2 dari 2). Satu jalur `cari_sop → siapkan_tiket` juga kurang tepat.
- **Kasus terparah, 278 detik (5 pengguna bersamaan):**
  - perute menyerahkan pertanyaan ke agent Portal **12 kali berturut-turut** (`delegate_task`);
  - agent Portal menyiapkan rancangan tiket 5 kali, lalu beberapa kali menjawab tanpa alat;
  - perute terus menyerahkan lagi sampai rangkaiannya berhenti;
  - totalnya **29 panggilan model**;
  - alat `siapkan_tiket` sendiri selesai dalam kurang dari 0,1 detik setiap kali.

  Ini **pengulangan di tingkat rute**, bukan masalah alat atau kartu grafis. Tidak ada tiket yang
  tersimpan, karena alatnya hanya menyusun rancangan.
- Langkah "Portal: memilih alat lagi" (setelah `cari_sop`, sebelum `siapkan_tiket`) membawa prompt
  ±7.200 token dan berpikir 5,6 detik. Jalur yang langsung ke `siapkan_tiket` di uji berurutan
  hanya 23 detik.

---

## 9. Waktu model vs waktu agent dan alat

| Bagian | 1 pengguna | Porsi | 5 bersamaan | Porsi |
|---|---:|---:|---:|---:|
| Model (tunggu + berpikir + rencana + menulis) | 32,4 dtk | **95%** | 52,6 dtk | 96% |
| — di antaranya antre vLLM | 0 dtk | 0% | ±5,7 dtk | 10% |
| — di antaranya jaringan dan gateway | ±1,4 dtk | 4% | ±1,0 dtk | 2% |
| Alat (database, SOP, rancangan) | 0,5 dtk | 1,5% | 1,0 dtk | 2% |
| Persiapan agent | 1,1 dtk | 3% | 0,9 dtk | 2% |
| Kerangka agent dan jeda | 0,2 dtk | 0,6% | 0,1 dtk | 0,2% |

Angka di tabel ini adalah rata-rata, bukan waktu tengah. Total rata-rata saat 5 pengguna adalah
54,6 detik.

**Kesimpulan bagian ini:** hampir semua waktu ada di model. Di dalam model, porsi terbesar adalah
**token yang ditulis**: berpikir dan menulis. Sedikit sekali yang berasal dari olah prompt atau
antre, kecuali saat ramai.

---

## 10. Kesimpulan dan rekomendasi

**Penghambat terbesar adalah jumlah token yang ditulis model per pertanyaan**, terutama token
berpikir (±61% token keluaran, 51% waktu). Jumlah itu dikalikan dengan jumlah panggilan model yang
berurutan (3,8 per pertanyaan). Kartu grafis, database, alat, dan kerangka agent bukan penghambat.

Urutan rekomendasi berdasarkan dampak yang terukur. Semua perkiraan penghematan dihitung dari
angka di laporan ini, tetapi **belum diuji**. Setiap perubahan perlu diukur ulang dengan skrip
yang sama, dan ketepatan jawabannya diperiksa.

| No | Rekomendasi | Dasar dari data | Perkiraan dampak |
|---|---|---|---|
| 1 | **Matikan atau batasi mode berpikir Qwen3 untuk panggilan yang hanya memilih agent atau alat** (misalnya `enable_thinking: false` untuk langkah perute dan pemilih alat), lalu uji ulang ketepatannya | Panggilan pemilih: 82–92% token keluar adalah berpikir, 2,2–5,6 detik per panggilan, 2 kali per pertanyaan data | ±6–9 detik per pertanyaan (±20–25%), dan antrean saat ramai ikut berkurang karena token lebih sedikit |
| 2 | **Hilangkan penulisan ulang jawaban oleh perute.** Kalau agent aplikasi sudah menulis jawaban lengkap, teruskan langsung ke pengguna | "Perute: jawaban akhir" 7,6 detik per pertanyaan (37 dari 40 pertanyaan) | ±7 detik per pertanyaan (±20%), satu panggilan model lebih sedikit |
| 3 | **Batasi penyerahan berulang ke agent yang sama** (misalnya paling banyak 1–2 kali per pertanyaan) dan perjelas rute untuk permintaan tiket | Q5: 3 jalur berbeda; 3 dari 10 kurang tepat; satu kasus 12 penyerahan dan 29 panggilan, 278 detik | Mencegah pertanyaan yang sangat lama, dan mungkin memperbaiki ketepatan Q5 |
| 4 | Batasi panjang berpikir untuk sapaan dan pertanyaan sederhana | Q8 berpikir rata-rata 26 detik; sekali ±1.000 token (72 detik) | Waktu sapaan lebih stabil |
| 5 | Pisahkan waktu embedding dan query di `cari_sop`, atau jalankan embedding di server | `cari_sop` sekali 19 detik saat 5 pengguna; P50 hanya 0,7 detik | Menghilangkan lonjakan sesekali di Q4/Q5 |
| 6 | Simpan sementara hasil baca setelan agent (cache beberapa menit) | Persiapan ±1 detik per pertanyaan | ±1 detik (3%) |
| 7 | Pertahankan `max-num-seqs=4` dan kartu grafis A10G untuk sekarang | Antre hanya 1,3 detik per panggilan di 5 pengguna; benchmark model menunjukkan kartu masih bisa mengerjakan lebih banyak sekaligus | — |

Rekomendasi 1–3 mengubah perilaku agent: instruksi, setelan model per langkah, atau logika rute.
Sesuai ketentuan, **tidak satu pun diterapkan selama benchmark ini**. Keputusan dan pengujiannya
adalah langkah berikutnya.

---

## 11. Batasan

- **Satu sesi uji** (5 putaran berurutan + 1 putaran 5 pengguna). Ragam antar-putaran cukup besar
  untuk Q5 dan Q8, jadi angka per jenis pertanyaan sebaiknya dibaca sebagai pola, bukan angka pasti.
- **Porsi token berpikir adalah perkiraan.** Angkanya dihitung dari jumlah potongan stream
  berjenis berpikir dibanding semua potongan. Satu potongan biasanya satu token, tetapi tidak
  dijamin. Waktu berpikir sendiri diukur langsung dari stream.
- **Antre vLLM saat 5 pengguna hanya tersedia untuk seluruh fase**, bukan per pertanyaan, karena
  histogram vLLM bersifat kumulatif untuk semua permintaan.
- **4 dari 323 panggilan tidak tercocokkan** dengan catatan LiteLLM, sehingga token-nya tidak
  terhitung. Pengaruhnya pada rata-rata kecil.
- **Embedding SOP berjalan di laptop** yang memorinya hampir penuh. Di server, waktunya bisa
  berbeda.
- Jaringan diukur dari laptop lewat tunnel Cloudflare. Portal yang berjalan di server akan punya
  jalur jaringan yang lebih pendek.

---

## 12. Berkas

| Berkas | Isi |
|---|---|
| `data/profil-agent-2026-11-16-09-22.jsonl` | Data mentah: setiap pertanyaan, panggilan model, alat, sampel vLLM, dan GPU |
| `data/profil-agent-2026-11-16-09-22-pertanyaan.csv` | Satu baris per pertanyaan, dengan pecahan waktunya |
| `data/profil-agent-2026-11-16-09-22-panggilan.csv` | Satu baris per panggilan model, dengan token dari LiteLLM |
| `data/profil-agent-2026-11-16-09-22-alat.csv` | Satu baris per pemanggilan alat |
| `data/profil-agent-2026-11-16-09-22-ringkasan.json` | Angka ringkas yang dipakai laporan dan grafik |
| `data/litellm-waktu-qwen3-14b-2026-11-16-profil-agent.csv` | Waktu dan token per panggilan dari LiteLLM |
| `data/profil-agent-intinya.json` | Teks "Intinya" di grafik |
| `data/profil-agent-2026-11-16-09-12-coba.jsonl` | Uji coba 1 pertanyaan sebelum uji penuh |
| `data/cadangan-grafik-uji-beban-sebelum-tab-alur.html` | Halaman grafik sebelum tab Alur agent ditambahkan |
