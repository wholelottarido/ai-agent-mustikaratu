# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Rabu, 11 November 2026
**Proyek:** Menambah model Qwen3.5 35B lewat MR AI Gateway, merapikan tampilan yang bertumpuk, dan memperbaiki penanganan sambungan gateway yang terputus
**Lokasi kerja:** folder `marketing/`

> Hari ini melanjutkan integrasi gateway dari 10 November. Model kedua yang lebih besar
> ditambahkan ke pilihan model, lalu dipakai untuk mencoba alur pembuatan tiket helpdesk. Dari
> percobaan itu muncul galat "Cannot connect to API: read ECONNRESET", yang ditelusuri dengan
> bukti sebelum diperbaiki.

> **Temuan terbesar hari ini:** retry bawaan VoltAgent tidak bisa menolong kalau sambungan putus
> di tengah alur multi-agent, karena ia hanya mengulang kalau agent belum menghasilkan apa pun.
> Retry yang aman harus berada di tingkat satu permintaan ke model, bukan seluruh putaran agent.
> Dugaan awal bahwa penyebabnya koneksi lama yang basi diuji dan tidak terbukti.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Qwen3.5 35B (Gateway) di pilihan model | Selesai, aktif di portal |
| Tampilan bertumpuk (menu model, tabel jawaban) | Selesai, belum diperiksa visual oleh saya |
| Penelusuran galat ECONNRESET | Selesai; penyebab asli belum diketahui |
| Retry otomatis satu kali untuk sambungan gateway | Selesai, aktif di portal |
| Pesan jawaban kosong dibedakan menurut sebabnya | Selesai, aktif di portal |
| Log permintaan gateway | Selesai, aktif di portal |
| Uji alur tiket multi-agent | Selesai untuk Qwen3.5 35B; Qwen3 14B belum andal |
| Penyimpanan kode ke Git | Belum |

---

## Entri 1 — Membaca ulang logbook 9 dan 10 November

Logbook 10 November (infrastruktur Qwen di AWS, LiteLLM, virtual key, dan pemanggilan alat)
dibaca untuk menentukan pekerjaan hari ini. Masalah yang masih terbuka dari sana: jawaban SOP
Qwen3 14B gagal karena konteks 8.192 token terlampaui, dan perbaikan pembatasan RAG serta jumlah
alat belum diuji ulang.

---

## Entri 2 — Model Qwen3.5 35B lewat gateway

Pemilik proyek menambahkan model baru di LiteLLM, dengan virtual key sendiri. Sebelum dipasang,
modelnya diperiksa langsung:

| Pemeriksaan | Hasil |
|---|---|
| Nama model di gateway | `qwen35-35b`, dan key-nya hanya bisa melihat model ini |
| Batas konteks | 16.384 token, dua kali Qwen3 14B |
| Pemanggilan alat | Berhasil, `finish_reason: tool_calls` |

Portal tadinya hanya mengenal satu model gateway, dengan satu key. Sekarang setiap model gateway
membawa nama model dan key-nya sendiri dari `.env.local`, sedangkan alamat gatewaynya tetap sama.
Batas jumlah alat juga per model: 10 untuk Qwen3 14B dan 15 untuk Qwen3.5 35B. Key tetap hanya
dibaca di server, dan model yang setelannya kosong tidak muncul di pilihan.

Hasil pemeriksaan: kedua model muncul di pilihan dan tersambung ke gateway, dan uji daftar model
lolos 16/16.

---

## Entri 3 — Tampilan yang bertumpuk

Pemilik proyek mengirim tangkapan layar: menu pilihan model terbuka di belakang tabel jawaban.

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| Menu model tertimpa tabel | Kolom pengetik memakai efek blur sehingga lapisannya paling bawah, sedangkan header tabel yang menempel punya lapisan lebih tinggi | Kolom pengetik diberi lapisan sendiri di atas isi chat |
| Bagian atas menu terpotong | Menu memuat 7 model tanpa batas tinggi | Tinggi menu dibatasi sisa layar, dan isinya bisa digulir |
| Teks header tabel bertumpuk saat digulir | Latar header dan kolom pertama tembus pandang | Latar sel dibuat pekat dengan warna yang sama |

---

## Entri 4 — Galat "Cannot connect to API: read ECONNRESET"

Saat mencoba membuat tiket dengan Qwen3.5 35B, jawaban berhenti dengan galat itu. Di atasnya juga
muncul kalimat "pertanyaannya perlu terlalu banyak langkah… sebutkan satu produk", yang tidak
cocok untuk pertanyaan tiket.

**Yang ditemukan dari log**

- Agent Portal sudah selesai dan menanyakan sub-kategori tiket. Sambungan putus tepat saat Ratu AI
  Umum mengirim permintaan terakhirnya ke gateway.
- Kejadiannya dua kali, pukul 15.05 dan 15.09.
- VoltAgent sebenarnya punya retry (sampai 3 kali), tetapi log mencatat "percobaan 1 dari 3" tanpa
  percobaan kedua. VoltAgent hanya mengulang kalau agent belum menghasilkan apa pun, sedangkan di
  sini Ratu AI Umum sudah meneruskan pertanyaan ke agent Portal. Mengulang seluruh putaran memang
  tidak aman, karena alat di dalamnya bisa ikut terulang.

**Dugaan yang diuji dan tidak terbukti**

Dugaan awal: portal memakai ulang koneksi lama yang sudah ditutup server. Diuji dengan 18
permintaan berjeda 0 sampai 65 detik lewat `fetch` yang sama dengan portal. Semuanya berhasil, dan
gateway tidak mengirim pengaturan keep-alive khusus. Permintaan besar (sekitar 11 ribu token) dan
streaming dengan alat juga berhasil. Jadi penyebab putusnya belum diketahui; kemungkinannya
gangguan sesaat di tunnel atau gateway.

**Perbaikan**

1. **Retry satu kali di tingkat permintaan ke model.** Hanya kalau sambungan putus sebelum ada
   balasan. Tidak diulang kalau server sudah membalas (misalnya 429 atau 500), kalau putus di
   tengah jawaban, atau kalau pemakai membatalkan. Alat tidak pernah ikut terulang, karena alat
   dijalankan portal setelah balasan model diterima. Tiket juga hanya tersimpan lewat tombol
   Simpan di kartu konfirmasi.
2. **Pesan galat yang jelas.** Kalau retry juga gagal, pemakai membaca "Sambungan ke MR AI Gateway
   terputus… kirim ulang; kalau berulang, periksa tunnel SSH", bukan pesan teknis.
3. **Jawaban kosong dibedakan menurut sebabnya:** galat, jatah langkah agent habis, jawaban
   terpotong karena terlalu panjang, atau model memang tidak menulis apa pun.
4. **Log setiap permintaan ke gateway:** model, agent, tahap, durasi, jumlah retry, dan jenis galat.
   Kunci API dan isi percakapan tidak dicatat, dan ini diperiksa oleh uji otomatis.

---

## Entri 5 — Uji alur tiket multi-agent

Alurnya: minta tiket → jawab "iya" → pilih sub-kategori → rancangan tiket muncul. Uji memakai agent
yang sama dengan portal, dan jumlah tiket di database diperiksa sebelum dan sesudah. Untuk
menguji sambungan putus, dipasang perantara lokal yang sengaja memutus sambungan. Server gateway
tidak diubah.

| Uji | Hasil |
|---|---|
| Uji retry dengan server tiruan | 22/22 |
| Qwen3.5 35B, normal | 5/5, rancangan tersusun dalam 3 giliran, 0 tiket tersimpan |
| Qwen3.5 35B, sambungan diputus 2 kali | 7/7, setiap putus diulang tepat sekali, 0 tiket tersimpan |
| Qwen3.5 35B, gateway mati total | 4/4, pesan galat jelas, tanpa jawaban karangan, 0 tiket tersimpan |
| Qwen3 14B, sambungan diputus | 5/6, retry bekerja, tetapi model menyusun 8 rancangan dalam satu jawaban lalu terkena batas permintaan key (429) |
| Qwen3 14B, normal (pembanding) | 3/4, satu giliran makan 337 detik dan berakhir tanpa jawaban |

Pembanding Qwen3 14B tanpa pemutusan sambungan tetap bermasalah, jadi masalahnya ada pada model
dan batas key, bukan pada retry. Untuk alur tiket, Qwen3.5 35B jauh lebih andal.

---

## Entri 6 — Kalimat jawaban kosong muncul di tengah proses

Setelah perbaikan dicoba di browser, kalimat "Model tidak menghasilkan jawaban teks" muncul
padahal agent masih bekerja. Penyebabnya, kalimat itu ditampilkan begitu teks jawaban kosong, dan
teks memang selalu kosong di awal proses. Celah yang sama sudah ada pada kalimat lama. Sekarang
kalimatnya baru tampil setelah proses selesai. Log menunjukkan permintaan itu sendiri berhasil:
8 permintaan ke Qwen3.5 35B, semuanya berstatus 200.

---

## Hasil pemeriksaan terakhir

| Pemeriksaan | Hasil |
|---|---|
| Pemeriksaan tipe dan ESLint untuk berkas yang diubah | Bersih |
| Uji daftar model | 16/16 |
| Uji retry gateway | 22/22 |
| Uji alur tiket Qwen3.5 35B (tiga mode) | Lolos semua |
| Uji alur tiket Qwen3 14B | Belum andal, lihat Entri 5 |
| Pemeriksaan visual tampilan | Dilakukan pemilik proyek di browser; saya tidak punya akses login atau browser otomatis |

Dua galat tipe lama di skrip pengukuran ramalan masih ada, dan tidak berkaitan dengan pekerjaan
hari ini.

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- Penyebab galat sempat disebut "koneksi lama yang basi" sebelum ada bukti. Setelah diuji, dugaan
  itu tidak terbukti.
- Kalimat untuk jawaban kosong yang baru dibuat ikut tampil di tengah proses. Baru ketahuan dari
  tangkapan layar pemilik proyek.
- Skrip uji alur sempat berhenti sendiri pada mode gateway mati, karena galat dilempar di baris
  yang belum dibungkus penanganan galat.
- Server portal sempat dinyalakan dua kali; yang kedua berhenti sendiri karena portal sudah
  berjalan.

---

## Masalah yang masih terbuka

- **Penyebab sambungan putus belum diketahui.** Retry meredam gejalanya. Log gateway sekarang
  mencatat setiap kejadian, jadi polanya bisa dilihat kalau terulang.
- **Qwen3 14B belum andal untuk alur panjang:** memanggil alat berulang kali, dan batas permintaan
  per menit key-nya cepat habis. Batas key diatur di LiteLLM, dan tidak diubah dari portal.
- **Saat gateway mati total, ada 8 percobaan** sebelum galat tampil, sekitar 10 detik, karena retry
  VoltAgent dan retry baru bertumpuk. Tidak ada alat yang ikut terulang.
- **Pencarian SOP di laptop ini gagal memuat model embedding** karena RAM penuh, sehingga agent
  menjawab "panduan belum ditemukan".
- **Kunci API gateway sempat terlihat di percakapan dengan Claude** (lewat pilihan teks di editor),
  jadi sebaiknya dirotasi, sama seperti SSH key yang tercatat di logbook 10 November.
- **Perubahan belum disimpan ke Git.**

---

## Rencana berikutnya

1. Mengukur di mana Qwen3 14B berputar memanggil alat, lalu memutuskan perlu pembatas atau tidak.
2. Menguji ulang pertanyaan SOP cuti dengan Qwen3.5 35B, setelah memori laptop cukup untuk model
   embedding.
3. Memantau log gateway untuk melihat apakah sambungan putus terulang, dan kapan.
4. Mempertimbangkan pengurangan percobaan berulang saat gateway mati total.
5. Merotasi kunci API gateway, lalu menyimpan kode ke Git setelah repositori dipastikan private.
