# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Kamis, 12 November 2026
**Proyek:** Menguji Ratu AI lewat ekstensi Continue dan langsung lewat portal, menelusuri gangguan MR AI Gateway, dan menyusun rencana uji beban model Qwen3 14B
**Lokasi kerja:** folder `marketing/`

> Hari ini berfokus pada pengujian. Uji dilakukan dari tiga jalur: ekstensi Continue di VS Code,
> agent yang dijalankan langsung, dan portal lewat `/api/chat` persis seperti browser. Di tengah
> jalan gateway beberapa kali tidak bisa dihubungi, dan penyebab tiap gangguannya ditelusuri satu
> per satu.

> **Temuan terbesar hari ini:** virtual key Qwen3 14B di LiteLLM dibatasi **10 permintaan**,
> sedangkan satu pertanyaan Ratu AI bisa butuh 4–12 panggilan ke model. Satu pemakai saja sudah dua
> kali terkena galat 429 dalam lima putaran uji. Batas ini harus dinaikkan sebelum uji beban
> beberapa pemakai bisa memberi hasil yang berarti.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Menyiapkan prompt uji untuk Continue | Selesai |
| Penelusuran galat Continue dan gateway | Selesai; backend Qwen3.5 35B masih bermasalah |
| Dokumen pertanyaan untuk ChatGPT | Selesai |
| Uji alur tiket Qwen3 14B, agent langsung | Selesai, lolos 5/5 |
| Rencana uji beban Qwen3 14B | Selesai sebagai dokumen, belum dijalankan |
| Skrip uji lewat portal (`/api/chat`) | Selesai |
| Uji alur tiket Qwen3 14B lewat portal, 5 putaran | Selesai |
| Uji ulang dengan key Qwen3 14B yang baru | Berjalan, hasil dilaporkan besok |
| Penyimpanan kode ke Git | Belum |

---

## Entri 1 — Menguji Ratu AI lewat Continue

Pemilik proyek ingin mengetahui apakah agent di ekstensi Continue bisa menjalankan uji agent portal
yang membaca database. Disusun empat prompt bertahap: cek kemampuan, cek koneksi database, uji alur
tiket, dan uji saat sambungan putus. Setiap prompt melarang Continue membuka isi `.env.local`,
menulis ke database, dan mengubah kode.

Kendala yang muncul, dan penyebabnya:

| Kendala | Penyebab sebenarnya |
|---|---|
| `Missing script: "test:jalur"` | Perintah dijalankan di folder `MagangHub`, bukan `MagangHub\marketing`. Terlihat dari log npm |
| `.env.local: not found`, yang Continue sebut sebagai "pembatasan akses" | Lagi-lagi salah folder. Model Continue salah memahami larangan membaca `.env.local` sebagai larangan memuatnya lewat `--env-file`, lalu mengarang alasan yang terdengar meyakinkan |
| `&&` ditolak | Terminal Continue memakai PowerShell 5, yang tidak mengenal `&&`. Continue lalu memperbaikinya sendiri dengan `;` |
| "Message exceeds context limit" | Keluaran uji (sekitar 111 ribu karakter) melebihi batas konteks yang disetel di Continue (16.384 token). Ini batas Continue, bukan galat portal maupun model |
| "1 lolos, 4 gagal" | LiteLLM membalas "Connection error" untuk Qwen3.5 35B (lihat Entri 2) |

Pelajaran: untuk uji lewat agent seperti Continue, minta keluaran terminal apa adanya (bukan
kesimpulan model), dan saring keluaran panjang supaya tidak melebihi konteks.

---

## Entri 2 — Gangguan MR AI Gateway

| Waktu | Gejala | Pemeriksaan | Kesimpulan |
|---|---|---|---|
| Siang | `ECONNREFUSED` di semua permintaan | Port 4000 di laptop kosong, tidak ada proses `ssh` | Tunnel SSH ke EC2 tidak berjalan di laptop. Bukan batas kuota, karena batas kuota membalas HTTP 429 |
| Sesudah tunnel menyala | Qwen3.5 35B membalas HTTP 500 "LiteLLM: model group 'qwen35-35b' failed… Connection error" | LiteLLM sehat, Qwen3 14B membalas HTTP 200 | LiteLLM tidak bisa menghubungi vLLM yang menjalankan Qwen3.5 35B. Perlu dicek di EC2: status container, memori GPU, jaringan Docker |
| Akhir uji portal | `ECONNREFUSED` lagi | Readiness tidak menjawab | Tunnel putus lagi |

Perintah pemeriksaan di EC2 (hanya membaca) disarankan ke pemilik proyek: `docker ps -a`,
`docker logs`, `nvidia-smi`, dan `docker network inspect ai-internal`. Konfigurasi server tidak
diubah dari portal.

Disusun juga `docs/gateway/tanya-chatgpt-gateway-12-nov-2026.txt` untuk ditanyakan ke ChatGPT: gambaran
sistem, gejala, hasil pemeriksaan, riwayat, dan enam pertanyaan. Dokumen itu tanpa API key, kata
sandi, maupun alamat server.

---

## Entri 3 — Uji alur tiket Qwen3 14B, agent langsung

Alurnya: minta tiket → "iya" → pilih sub-kategori WIRELESS.

| Giliran | Waktu | Hasil |
|---|---:|---|
| 1 | 43,6 dtk | Panduan SOP belum ditemukan, lalu menawarkan tiket |
| 2 | 27,8 dtk | Menanyakan sub-kategori (LAN, OTHERS, WIRELESS) |
| 3 | 40,9 dtk | Rancangan NETWORK → WIRELESS tersusun |

Lolos 5/5, 12 panggilan ke model berhasil semua, dan 0 tiket tersimpan. Qwen3 14B sekitar tiga
kali lebih lambat daripada Qwen3.5 35B kemarin (10–13 detik per giliran).

---

## Entri 4 — Rencana uji beban Qwen3 14B

Pemilik proyek ingin mengetahui waktu jawab Ratu AI saat lima orang atau lebih bertanya
bersamaan. Disusun `docs/benchmark/rencana-uji-beban-qwen3-14b.md`. Belum ada yang dijalankan. Isinya:

- tujuan dan empat dugaan yang akan dibuktikan atau dibantah, misalnya antrean vLLM yang hanya
  melayani 2 permintaan sekaligus, dan batas key yang dibagi semua pemakai;
- delapan pertanyaan uji beserta kriteria "dianggap benar";
- tahap 1, 2, 3, 5, dan 8 pemakai, dalam dua lapis (agent langsung dan lewat portal);
- dua belas ukuran, termasuk waktu jawab median dan 95% terlama, waktu sampai kata pertama, galat,
  dan ketepatan;
- target usulan untuk lima pemakai, yang masih perlu disetujui;
- bentuk laporan: enam tabel kosong dan tujuh grafik, tanpa angka contoh supaya tidak tertukar
  dengan hasil asli;
- prosedur, batas keamanan, perkiraan waktu, dan risiko.

---

## Entri 5 — Uji alur tiket Qwen3 14B lewat portal

Dibuat `scripts/uji-portal-tiket.mts`, yang mengirim percakapan ke `/api/chat` seperti browser.
Sesi dibuat di laptop untuk akun pemilik proyek sendiri, tokennya tidak dicetak, dan percakapan uji
tidak tersimpan di riwayat. Akun perusahaan di portal ternyata disimpan sebagai `mr:<id karyawan>`,
bukan alamat email, jadi skrip memetakannya dulu.

Uji pertama (1 putaran): semua giliran HTTP 200 tanpa galat, sekitar 31–39 detik per giliran.
Tetapi rancangan belum tersusun, karena model kehilangan konteks dan menanyakan kategori dari awal.

Uji kedua (5 putaran):

| Ukuran | Hasil |
|---|---|
| Rancangan tersusun | 5 dari 5 putaran |
| Kategori rancangan benar (NETWORK) | 4 dari 5 |
| Giliran tanpa galat | 12 dari 15 |
| Galat 429 "Limit type: requests. Current limit: 10" | 2 kali |
| Galat sambungan (tunnel putus) | 1 kali |
| Waktu per giliran yang berhasil | 19–139 dtk, median sekitar 37 dtk |
| Waktu sampai kata pertama | biasanya 3–11 dtk; 19–65 dtk setelah terkena 429 |
| Tiket tersimpan | 0 |

Masalah ketepatan yang terlihat: sekali memilih kategori HARDWARE untuk masalah internet, kadang
memakai sub-kategori yang tidak ada, dan sekali menulis "tiket telah dibuat" padahal baru
rancangan. Kartu konfirmasi tetap jadi pengaman, karena tiket hanya tersimpan lewat tombol Simpan.

---

## Entri 6 — Key Qwen3 14B diganti

Pemilik proyek mengganti API key Qwen3 14B di `.env.local`. Key baru diterima gateway. Server portal
dinyalakan ulang, karena klien gateway menyimpan key di memori sejak pertama dibuat, dan tanpa
restart portal tetap memakai key lama. Uji ulang 5 putaran dijalankan dengan skrip yang sudah
diperbaiki, dan hasilnya dilaporkan besok.

---

## Hasil uji terakhir

| Uji | Hasil |
|---|---|
| Alur tiket Qwen3 14B, agent langsung | 5/5 |
| Alur tiket Qwen3 14B, lewat portal, 5 putaran | rancangan 5/5, kategori benar 4/5, galat 3 dari 15 giliran |
| Alur tiket Qwen3.5 35B | Tidak bisa diuji, backend tidak bisa dihubungi LiteLLM |
| Uji ulang dengan key baru | Berjalan, hasil besok |

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- Skrip uji portal tetap melanjutkan percakapan setelah rancangan tersusun, lalu hanya menilai
  giliran terakhir. Dua putaran yang sebenarnya berhasil di giliran 1 sempat terhitung gagal. Sudah
  diperbaiki: percakapan berhenti begitu rancangan muncul.
- Skrip uji portal awalnya mencari akun dengan alamat email, padahal username portal untuk akun
  perusahaan berbentuk `mr:<id karyawan>`.
- Prompt untuk Continue tidak menyebut folder kerja secara tegas, dan larangan soal `.env.local`
  ditulis terlalu umum, sehingga ditafsirkan keliru. Prompt berikutnya selalu diawali `cd` ke
  folder `marketing` dan membedakan "membaca isi" dari "memuat lewat `--env-file`".

---

## Masalah yang masih terbuka

- **Batas 10 permintaan pada key Qwen3 14B** perlu dinaikkan di LiteLLM sebelum uji beban. Kalau
  tidak, hasilnya hanya akan menunjukkan galat 429.
- **Backend Qwen3.5 35B** tidak bisa dihubungi LiteLLM ("Connection error"). Perlu dicek di EC2.
- **Tunnel SSH sering putus.** Perlu cara menjaga tunnel tetap hidup; sudah ditanyakan lewat
  dokumen untuk ChatGPT.
- **Model Qwen3 14B di Continue memakai tunnel publik** `trycloudflare.com`. Perlu dipastikan
  disengaja dan aman.
- **API key Qwen3.5 35B** yang sempat terlihat di percakapan dengan Claude kemarin belum dirotasi.
  Key Qwen3 14B sudah diganti hari ini.
- **Model pencarian SOP gagal dimuat karena RAM laptop penuh**, sehingga jawaban SOP selalu
  "panduan belum ditemukan".
- **Perubahan belum disimpan ke Git.**

---

## Rencana berikutnya

1. Membaca hasil uji ulang 5 putaran dengan key baru, terutama apakah galat 429 masih muncul.
2. Menambahkan temuan batas 10 permintaan ke rencana uji beban, lalu meminta persetujuan daftar
   pertanyaan, target, dan jadwal.
3. Membantu pemeriksaan backend Qwen3.5 35B di EC2 berdasarkan hasil `docker ps`, `docker logs`,
   dan `nvidia-smi` dari pemilik proyek.
4. Menjalankan uji beban setelah batas key dinaikkan dan tunnel stabil.
5. Merotasi key Qwen3.5 35B, lalu menyimpan kode ke Git setelah repositori dipastikan private.
