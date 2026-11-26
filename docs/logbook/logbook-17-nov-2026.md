# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Selasa, 17 November 2026
**Proyek:** Merapikan dashboard hasil uji, mengukur waktu tiap langkah Ratu AI secara rinci (97 pertanyaan), dan menyiapkan pengujian di server baru dengan 4 kartu grafis
**Lokasi kerja:** folder `marketing/`

> Pagi ini halaman grafik hasil uji dibangun ulang menjadi dashboard yang lebih ringkas. Setelah itu
> Ratu AI diuji 97 kali sambil mencatat waktu setiap langkahnya: panggilan model, alat, query
> database, dan pencarian SOP. Sore harinya, server baru dengan 4 kartu grafis disambungkan sebagai
> pilihan model kedua, sementara server lama dengan 1 kartu grafis tetap dipakai sebagai pembanding.

> **Temuan terbesar hari ini:** saat satu orang bertanya, **52% waktu jawab Ratu AI habis untuk
> bagian "berpikir" model**, yaitu teks yang ditulis model tetapi tidak dibaca pengguna. Alat,
> database, dan pencarian SOP bersama-sama kurang dari 1%. Saat 8 orang bertanya bersamaan, yang
> membengkak adalah **antrean di server model**: waktu menunggu kata pertama naik dari 1,7 menjadi
> 30,8 detik per pertanyaan.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Dashboard hasil uji dibangun ulang (5 tampilan) | Selesai |
| Pencatat waktu per langkah di aplikasi, bawaannya mati | Selesai |
| Pengukuran 97 pertanyaan (40 berurutan + 1/2/3/5/8 pengguna) | Selesai |
| Laporan dan dashboard alur agent | Selesai |
| Pilihan model kedua: Qwen3 14B (4 GPU) | Selesai, sudah diverifikasi |
| Akses ke server 4 GPU (hanya membaca) | Selesai |
| Pengujian 1 GPU vs 4 GPU | Belum, ditunda atas keputusan pemilik proyek |
| Logbook 16 Nov diperbarui (bagian profiling) | Belum |
| Penyimpanan kode ke Git | Belum |

---

## Entri 1 — Dashboard hasil uji dibangun ulang

Atas permintaan pemilik proyek, halaman `docs/grafik-uji-beban-qwen3-14b.html` diubah dari 7 tab
yang banyak grafik berulang menjadi dashboard dengan 5 tampilan: **Overview, Load Testing, Model
Performance, Agent Workflow, GPU Analytics**. Metodologi dan daftar istilah dipindah ke panel
samping.

- Halaman sekarang **dibangun dari data mentah** oleh `scripts/buat-dashboard.py`. Ini sekaligus
  menggantikan skrip pembuat grafik yang hilang kemarin.
- Fitur baru:
  - pilihan metrik dan uji yang benar-benar mengubah grafik;
  - tabel yang bisa dicari, diurutkan, dan diekspor ke CSV;
  - tema terang dan gelap;
  - tampilan cetak ke PDF;
  - tampilan ponsel.
- **Angka-angkanya dicocokkan ke laporan.** Rumus "listrik per jawaban" sempat berbeda 0,01 Wh. Setelah
  dicari, ternyata generator lama memakai nilai tengah listrik saat jeda antar tahap sebagai patokan
  "diam". Rumus itu dipakai lagi sehingga angkanya sama persis dengan laporan.
- Halaman lama dicadangkan di `docs/benchmark/grafik/grafik-uji-beban-qwen3-14b.backup.html`.
- QA otomatis: 25 pemeriksaan lolos, 0 galat JavaScript, dan tidak ada tampilan yang meluber di lebar
  ponsel, tablet, maupun desktop.

---

## Entri 2 — Pencatat waktu per langkah di aplikasi

Supaya terlihat langkah mana yang paling lama, dibuat `lib/profil-agent.ts`. Pencatat ini **mati secara
bawaan** dan baru menyala kalau `AGENT_PROFILING_ENABLED=1` disetel.

Pencatat dipasang di 4 tempat. Masing-masing hanya pembungkus, dan perilaku aplikasi tidak berubah:

| Tempat | Yang dicatat |
|---|---|
| `lib/gateway-fetch.ts` | Setiap panggilan model: menunggu kata pertama, berpikir, rencana alat, menulis |
| `voltagent/tool-konfigurasi.ts` | Setiap alat |
| `voltagent/embedding.ts` | Pencarian SOP (embedding) |
| `lib/db-perusahaan.ts` | Setiap query database, hanya lamanya, tanpa isi SQL |

- Semua langkah satu pertanyaan diberi satu **kode pelacak (trace ID)**, termasuk saat 8 orang
  bertanya bersamaan.
- Isi pertanyaan, jawaban, dokumen, data karyawan, dan kunci **tidak dicatat**.
- Beban tambahan pencatat: 1,4 mikrodetik saat mati, dan 12 mikrodetik per langkah saat menyala.
- Uji lama tetap lolos: gateway 22/22, alat 54/54, pencarian SOP sama seperti sebelumnya.

---

## Entri 3 — Pengukuran 97 pertanyaan

Skrip `scripts/profil-alur-agent.mts` dijalankan pukul 10.11–11.08 WIB.
- Diawali pemeriksaan kesehatan server, lalu pemanasan 8 pertanyaan yang tidak dihitung.
- Berikutnya 40 pertanyaan satu per satu.
- Terakhir 1, 2, 3, 5, dan 8 orang bersamaan, dengan pola yang sama seperti uji beban sebelumnya.

| Tahap | Pertanyaan | Sesuai kriteria | Waktu tengah | 95% di bawah |
|---|---:|---:|---:|---:|
| Satu per satu | 40 | 39 | 29,3 dtk | 58,3 dtk |
| 1 orang | 3 | 3 | 24,6 dtk | 29,0 dtk |
| 2 orang | 6 | 6 | 31,6 dtk | 70,7 dtk |
| 3 orang | 9 | 9 | 34,5 dtk | 67,9 dtk |
| 5 orang | 15 | 15 | 50,5 dtk | 92,5 dtk |
| 8 orang | 24 | 22 (+1 waktu habis) | 73,3 dtk | 115,9 dtk |

- **Ke mana waktunya habis saat satu orang bertanya:** model berpikir 52%, model menulis 37%,
  menunggu kata pertama 6%, dan alat + database + SOP kurang dari 1%.
- **Saat 8 orang bertanya:** menunggu kata pertama menjadi bagian terbesar, 41%. Antrean di server
  model rata-rata 6,2 detik per panggilan, dan satu pertanyaan memanggil model 4–5 kali.
- **Pertanyaan tiket (Q5) masih tidak stabil.** Satu kali habis waktu karena Ratu AI menyerahkan
  pertanyaan ke agent Portal 7 kali berturut-turut, sehingga ada 27 panggilan model. Agent bahkan
  tetap bekerja sampai detik ±339, setelah uji berhenti menunggu di detik 300. Alat tiketnya
  sendiri selesai dalam kurang dari 1 detik.
- **Pertanyaan SOP (Q4) sekali dijawab tanpa alat SOP**, padahal hanya satu orang yang bertanya.
- Semua 419 panggilan model cocok dengan catatan gerbang model (LiteLLM). Tiket tersimpan: 0.

---

## Entri 4 — Laporan dan dashboard alur agent

- Laporan baru: `docs/benchmark/benchmark-agent-workflow-latency.md`. Isinya meliputi:
  - ranking penghambat beserta buktinya;
  - analisis khusus Q4 dan Q5;
  - daftar hal yang **tidak bisa diukur dengan pasti**;
  - rekomendasi.
- Dashboard baru: `docs/benchmark/grafik/grafik-agent-workflow-latency.html`. Berisi waterfall per pertanyaan (urutan
  langkah dan lamanya), perbandingan antar tahap, dan pemeriksaan kewajaran data.
- Laporan kemarin dengan nama yang sama dipindah utuh ke
  `docs/benchmark/benchmark-agent-workflow-latency-16-nov.md`.
- **Rekomendasi utama untuk diuji berikutnya:** matikan atau batasi bagian berpikir pada langkah yang
  hanya memilih agent atau alat. Perkiraan hematnya 5–8 detik per pertanyaan, tapi harus diuji ulang,
  termasuk ketepatannya. Perbaikan cepat yang risikonya rendah: batasi penyerahan berulang ke agent
  yang sama.

---

## Entri 5 — Server baru dengan 4 kartu grafis

Pemilik proyek menyiapkan server AWS g5.12xlarge dengan 4 GPU A10G. Isinya model yang sama, Qwen3 14B,
dijalankan dalam 4 salinan (satu per GPU) dan dibagi bergiliran oleh LiteLLM.

**Pemeriksaan koneksi** (hanya membaca):
- daftar model dan satu jawaban uji berhasil;
- **pemanggilan alat berfungsi** (`finish_reason: tool_calls`);
- dua alur Ratu AI lengkap berhasil: Q1 benar, Q5 menyiapkan rancangan, 0 tiket tersimpan.

**Temuan penting dari pemeriksaan:**
- Setiap jawaban LiteLLM menyebut **salinan GPU mana yang melayani**. Enam permintaan uji terbagi ke
  keempat salinan, jadi pembagian beban bisa dibuktikan tanpa akses admin.
- Kunci virtual hanya boleh memanggil model; halaman pemantauan LiteLLM ditolak. Ini sesuai aturan,
  dan tidak dicoba diakali.
- Akses SSH lama (`mr-ec2`) ternyata masih ke server 1 GPU. Pemilik proyek memberi akses ke server
  baru. Hasil pemeriksaannya:
  - pengaturan keempat salinan **identik** dengan server lama;
  - perbedaannya hanya versi: vLLM *nightly* (`0.33.0rc1.dev1030`) di server baru, sedangkan server
    lama memakai rilis stabil `0.33.0`.

**Pilihan model kedua ditambahkan: "Qwen3 14B (4 GPU)".**
- Alamat, nama model, dan kunci dibaca dari `AI_BASE_URL_2` / `AI_MODEL_2` / `AI_API_KEY_2`, hanya di
  server. `/v1` ditambahkan otomatis kalau alamatnya tanpa path.
- Pilihan lama "Qwen3 14B (Gateway)" tidak berubah dan tetap menjadi pembanding.
- Kunci dan alamat tidak masuk log maupun browser. Pesan galat ke browser tidak lagi menampilkan alamat
  gateway.
- Terverifikasi:
  - kedua pilihan muncul di daftar model;
  - alur Q1 lewat 4 GPU 25,7 detik dan lewat 1 GPU 26,4 detik, keduanya benar;
  - uji lama lolos (biaya 16/16, gateway 22/22).

**Keputusan pemilik proyek untuk pengujian nanti:**
- akses SSH memakai berkas kunci yang ada di `docs/`;
- pembanding 1 GPU memakai data 17 Nov tanpa uji ulang;
- stress test 12 dan 16 orang dijalankan setelah tahap 1–8 selesai;
- benchmark kecepatan model langsung di server baru masih dipertimbangkan.

---

## Hasil uji hari ini

| Uji | Hasil |
|---|---|
| Alur agent, 97 pertanyaan (1 GPU) | 94 sesuai kriteria, 1 waktu habis; waktu tengah 29,3 dtk (1 orang) → 73,3 dtk (8 orang) |
| Panggilan model selama pengukuran | 419, semuanya tercatat dan cocok dengan LiteLLM |
| Koneksi server 4 GPU | 4 salinan sehat, pemanggilan alat berfungsi |
| Alur agent lewat 4 GPU (uji coba) | Q1 benar (25,7 dtk), Q5 menyiapkan rancangan |
| Tiket tersimpan | 0 |

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- **Ringkasan dashboard sempat membandingkan angka yang tidak sebanding.** Batas 2 siang dibandingkan
  dengan Batas 4, padahal jumlah panggilan model per pertanyaannya berbeda (4,3–5,5 vs 3,5–3,8).
  Sudah diganti dengan Batas 2 pagi, yang jumlah panggilannya sama.
- **Laporan lama tidak benar-benar dipindah.** Perintah `git mv` tidak melakukan apa-apa karena folder
  ini bukan repositori Git, dan galatnya tertelan. Ketahuan saat diperiksa, lalu dipindah ulang dengan
  `mv` biasa.
- **Angka di teks dashboard sempat salah:** "Q4 15 dari 16 benar", padahal yang benar 11 dari 12. Ada
  juga satu jumlah jalur Q5 yang salah hitung. Keduanya sudah dibetulkan setelah dicocokkan ulang ke
  data.
- **Tampilan ponsel sempat meluber**, dan label grafik terpotong. Sudah dibetulkan dan diuji di lebar
  390 px.

---

## Masalah yang masih terbuka

- **Kunci virtual gateway 4 GPU sempat tertempel di percakapan.** Sebaiknya dirotasi setelah pengujian.
  Begitu pula kunci SSH dan kunci API yang tercatat sejak 10 Nov.
- **Berkas kunci SSH server 4 GPU disimpan di `docs/`.** Sudah dikecualikan dari Git lewat `*.pem`,
  tapi lebih aman dipindah ke `~/.ssh/`.
- **Alamat tunnel kedua server bersifat sementara** dan berganti setiap tunnel dinyalakan ulang.
- **Rute Q5 masih bisa berulang** sampai habis waktu, dan agent tidak berhenti saat pengguna berhenti
  menunggu.
- **Logbook 16 Nov** masih menulis profiling sebagai "sedang berjalan".
- **Perubahan belum disimpan ke Git.** Repositori perlu dijadikan private lebih dulu.

---

## Rencana berikutnya

1. Menjalankan pengujian 1 GPU vs 4 GPU dengan skrip dan skenario yang sama: pemanasan, 40 berurutan,
   lalu 1/2/3/5/8 orang. Metrik dicatat per salinan GPU (antrean, token, listrik). Setelah itu stress
   test 12 dan 16 orang.
2. Memutuskan perlu tidaknya benchmark kecepatan model langsung di server baru (±25 menit), untuk
   memastikan versi vLLM nightly tidak mengubah kecepatan dasar.
3. Menyusun laporan dan dashboard perbandingan 1 GPU vs 4 GPU untuk pembimbing.
4. Menguji rekomendasi pengurangan bagian berpikir model, setelah perbandingan server selesai.
5. Merotasi kunci yang tersisa, lalu menyimpan kode ke Git setelah repositori dipastikan private.
