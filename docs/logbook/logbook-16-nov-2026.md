# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Senin, 16 November 2026
**Proyek:** Menguji ulang Ratu AI setelah setelan server model diubah (batas 3, lalu batas 4), mengukur kecepatan model itu sendiri, dan mulai mengukur waktu tiap langkah Ratu AI
**Lokasi kerja:** folder `marketing/`

> Hari ini pengelola server menaikkan **batas permintaan yang dikerjakan model sekaligus**
> (`max-num-seqs`), pertama dari 2 menjadi 3, lalu menjadi 4. Setiap kali setelan berubah, uji beban
> yang sama dengan 13 November dijalankan ulang. Sore harinya, kecepatan model diukur langsung di
> server, tanpa melewati Ratu AI.

> **Temuan terbesar hari ini:** menaikkan batas dari 2 ke 3 membuat Ratu AI **sekitar sepertiga
> lebih cepat** saat 8 orang bertanya bersamaan, tanpa menambah listrik atau panas kartu grafis.
> Batas 4 masih sedikit lebih cepat lagi. Model sendiri menulis sekitar **50 token per detik**, dan
> angka itu sudah dekat batas kemampuan kartu grafis A10G. Lamanya Ratu AI menjawab lebih banyak
> disebabkan oleh **jumlah langkah per pertanyaan**, bukan oleh kartu grafisnya.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Uji beban dengan batas 3 | Selesai (percobaan pertama gagal tersambung, diulang) |
| Halaman grafik dipisah per setelan (tab) | Selesai |
| Laporan hasil uji ditulis ulang | Selesai |
| Uji beban dengan batas 4, plus tab dan laporan | Selesai |
| Benchmark kecepatan model langsung di server | Selesai |
| Tab "Kecepatan model" dan laporan benchmark | Selesai |
| Memulihkan halaman grafik yang tertimpa versi lama | Selesai |
| Mengukur waktu tiap langkah Ratu AI (profil alur agent) | Sedang berjalan |
| Naskah penjelasan diperbarui dengan hasil batas 3 dan 4 | Belum |
| Penyimpanan kode ke Git | Belum |

---

## Entri 1 — Uji beban dengan batas 3

Pengelola server mengubah batas dari 2 menjadi 3. Uji dijalankan dengan cara yang sama persis
seperti 13 November: 1, 2, 3, 5, lalu 8 orang bertanya bersamaan, 3 pertanyaan per orang, sambil
merekam kartu grafis.

- **Percobaan pertama gagal tersambung.** Alamat tunnel Cloudflare berganti setelah server
  dinyalakan ulang. Pemilik proyek mengganti alamatnya di `.env.local`, lalu uji diulang
  (09.23–09.47 WIB). Data percobaan gagal disimpan dengan akhiran `-GAGAL` dan tidak dipakai.
- Hasilnya: 56 dari 57 terjawab, 54 benar.

| 8 orang bersamaan | Batas 2 | Batas 3 |
|---|---:|---:|
| Waktu tengah menjawab | 129 dtk | **84 dtk** |
| Jeda sebelum model mulai menulis | 20 dtk | **10 dtk** |
| Permintaan yang menunggu giliran | 4,6 | **3,2** |
| Listrik kartu grafis | 223 W | 221 W |

---

## Entri 2 — Halaman grafik dipisah per setelan

Atas permintaan pemilik proyek, halaman grafik dibuat bertab: **Cara uji · Batas 2 · Batas 3 ·
Bandingkan**. Menambah setelan baru cukup dengan menambah satu baris di skrip pembuatnya, dan tab
Bandingkan otomatis memuatnya.

Laporan `docs/benchmark/hasil-uji-beban-qwen3-14b.md` ditulis ulang dengan bahasa sederhana, hanya jalur
langsung ke model, dan disusun per setelan. Laporan lama yang masih memuat jalur portal disimpan
utuh di `docs/benchmark/hasil-uji-beban-qwen3-14b-13-nov-lengkap.md`.

---

## Entri 3 — Uji beban dengan batas 4

Pengelola server menaikkan batas lagi menjadi 4. Setelan server diperiksa lebih dulu (hanya
dibaca) untuk memastikan batasnya memang 4, lalu uji yang sama dijalankan (11.10–11.32 WIB).

- **57 dari 57 terjawab dan benar**, dan tidak ada tiket yang tersimpan.
- Di 5 orang paling terasa: waktu tengah 37 detik (batas 3: 58 detik).
- Di 8 orang hanya sedikit lebih cepat: 77 detik (batas 3: 84 detik). Waktu untuk 95% pertanyaan
  justru sedikit lebih lama (113 detik, batas 3: 106 detik).
- Memori kerja model naik ke 50%, masih aman. Listrik dan suhu tidak berubah.
- **Perbandingan di 8 orang tidak sepenuhnya adil.** Di uji ini, Ratu AI memanggil model 3,5 kali
  per pertanyaan, sedangkan di uji batas 3 4,3 kali. Pembanding yang paling adil adalah lama satu
  panggilan ke model: 28 → 18 → 15 detik untuk batas 2 → 3 → 4.

Halaman grafik mendapat tab **Batas 4**, dan laporan diperbarui dengan ketiga setelan.

---

## Entri 4 — Mengukur kecepatan model itu sendiri

Pemilik proyek meminta kecepatan model diukur tanpa Ratu AI, gerbang LiteLLM, tunnel, atau portal.
Dibuat `scripts/benchmark-inferensi-vllm.py`, yang dijalankan di server lewat SSH, tanpa memasang
apa pun dan tanpa meninggalkan berkas di server (15.13–15.36 WIB, 224 permintaan).

| Ukuran | Hasil |
|---|---|
| Kecepatan menulis, 1 pengguna | 49–53 token per detik, sangat stabil |
| Jeda sebelum kata pertama, prompt baru | 0,25 / 0,95 / 1,9 dtk untuk prompt 540 / 2.100 / 4.200 token |
| Jeda sebelum kata pertama, prompt yang sudah pernah dikirim | sekitar 0,04 dtk |
| 1 / 2 / 4 permintaan sekaligus | 43 / 72 / 110 token per detik |
| Masalah | 0 galat, 0 preemption |

Kesimpulannya:
- Kecepatan menulis satu jawaban sudah dekat batas kemampuan kartu A10G.
- Kartu grafis masih sanggup mengerjakan beberapa jawaban sekaligus.
- **Upgrade kartu grafis belum perlu.** Yang lebih berpengaruh adalah mengurangi jumlah langkah dan
  jumlah kata yang ditulis model untuk setiap pertanyaan.

Hasilnya ditambahkan sebagai tab **Kecepatan model** di halaman grafik yang sama, dan ditulis di
`docs/benchmark/benchmark-inferensi-qwen3-14b.md`.

---

## Entri 5 — Halaman grafik tertimpa versi lama

Pukul 15.57, `docs/grafik-uji-beban-qwen3-14b.html` tiba-tiba berisi versi 13 November, tanpa tab.
Waktunya bersamaan dengan berkas itu dibuka di VS Code. Dugaan terkuat: VS Code masih menyimpan
isi lama berkas itu, lalu isi lama itu tersimpan menimpa versi baru.

Halaman dipulihkan dari cadangan, lalu tab Kecepatan model disisipkan lagi. Versi yang tertimpa
disimpan di `data/tertimpa-grafik-uji-beban-15-57.html`.

**Pelajaran:** halaman grafik dibuka lewat browser, bukan lewat VS Code.

---

## Entri 6 — Mengukur waktu tiap langkah Ratu AI (sedang berjalan)

Uji beban sebelumnya hanya mengukur waktu total per pertanyaan, sehingga tidak terlihat langkah
mana yang paling lama. Dibuat `scripts/profil-agent.mts`. Skrip ini mencatat setiap pertanyaan
langkah demi langkah:
- persiapan;
- setiap panggilan model, termasuk lama "berpikir";
- setiap alat;
- penyusunan jawaban akhir.

Setiap langkah ditandai dengan satu kode pelacak (trace ID).

- **Kode Ratu AI, prompt, dan setelan tidak diubah.** Pencatatnya hanya dipasang di skrip uji.
- Yang disimpan hanya waktu, nama alat, dan jumlah token. Isi pertanyaan, jawaban, dokumen, dan
  data karyawan tidak disimpan.
- **Uji coba satu pertanyaan (data penjualan, 37 detik):** Ratu AI memanggil model 4 kali, dan
  setiap panggilan diawali bagian "berpikir" sekitar 3–4 detik. Alat pengambil datanya sendiri
  hanya sekitar 2,3 detik.
- Uji penuh dimulai pukul 16.22: 8 pertanyaan × 5 kali berurutan, lalu 5 pengguna bersamaan.
  Sampai pukul 16.27, 7 pertanyaan sudah selesai dan semuanya benar.

---

## Hasil uji hari ini

| Uji | Hasil |
|---|---|
| Uji beban batas 3 | 56/57 terjawab, 54 benar; 8 orang: 84 dtk |
| Uji beban batas 4 | 57/57 benar; 5 orang: 37 dtk, 8 orang: 77 dtk |
| Benchmark kecepatan model | 224 permintaan, 0 galat; sekitar 50 token per detik |
| Panggilan ke model yang gagal di server (empat uji beban 13–16 Nov) | 0 dari 888 |
| Tiket tersimpan selama uji | 0 |

---

## Kesalahan kerja hari ini

Dicatat supaya tidak terulang:

- **Folder sementara terhapus.** Skrip pembuat tab uji beban (Batas 2–4, Bandingkan) dan beberapa
  cadangan disimpan di folder sementara sesi Claude, dan folder itu ikut terhapus. Tab-tabnya masih
  utuh di halaman, tapi kalau perlu diubah, skripnya harus ditulis ulang. Sejak itu, skrip baru
  disimpan di `scripts/` dan cadangan di `data/`.
- **Keterangan grafik yang tertulis tetap.** Di halaman grafik ada tulisan "2 atau 3" yang tidak
  ikut berubah saat batas 4 ditambahkan, dan label ujung garis hanya berisi tanggal. Keduanya
  sudah dibetulkan supaya mengikuti data.
- **Grafik dengan dua satuan dalam satu sumbu.** Di tab Kecepatan model, satu grafik sempat
  mencampur milidetik dan detik ÷ 10. Grafik itu sudah dipecah menjadi dua.

---

## Masalah yang masih terbuka

- **Setelan batas 4 baru diuji satu kali.** Pertanyaan tiket dan SOP yang sempat bermasalah di
  batas 2 dan 3 tidak bermasalah di batas 4, tapi satu kali uji belum cukup untuk memastikannya.
- **Apakah mode "berpikir" Qwen3 perlu menyala di setiap langkah Ratu AI** belum diputuskan. Data
  profil yang sedang berjalan akan menunjukkan seberapa besar pengaruhnya.
- **Alamat tunnel Cloudflare berganti** setiap server dinyalakan ulang. Perlu alamat tetap.
- **Naskah penjelasan** masih berisi hasil batas 2 saja.
- **Skrip pembuat tab uji beban hilang**, jadi tab-tab itu belum bisa dibuat ulang otomatis.
- **Kunci SSH dan kunci API Qwen3.5 35B** belum dirotasi.
- **Perubahan belum disimpan ke Git.** Repositori perlu dijadikan private lebih dulu.

---

## Rencana berikutnya

1. Menyelesaikan profil alur agent, lalu membuat tab "Alur agent" dan laporan
   `docs/benchmark/benchmark-agent-workflow-latency.md`, termasuk analisis khusus SOP (Q4) dan tiket (Q5).
2. Menyampaikan hasil batas 2/3/4 dan benchmark kecepatan model ke pembimbing dan pengelola server.
3. Memperbarui naskah penjelasan dengan hasil batas 3, batas 4, dan kecepatan model.
4. Kalau diperlukan, menulis ulang skrip pembuat tab uji beban supaya bisa dijalankan lagi.
5. Merotasi kunci yang tersisa, lalu menyimpan kode ke Git setelah repositori dipastikan private.
