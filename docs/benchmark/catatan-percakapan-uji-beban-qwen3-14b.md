# Catatan Percakapan — Uji Beban Ratu AI dengan Model Qwen3 14B

**Periode:** 12–13 November 2026
**Pihak:** pemilik proyek (peserta magang) dan Claude Code (asisten pemrograman)
**Isi:** urutan percakapan tentang uji beban, mulai dari pertanyaan awal sampai skrip penjelasan.
Ditulis ulang supaya mudah dibaca, bukan salinan kata per kata. Kalimat pemilik proyek yang dikutip
ditulis apa adanya.

> Kunci API, kunci SSH, alamat server, dan alamat tunnel sengaja tidak dicantumkan.

---

## Ringkasan

| Hal | Hasil |
|---|---|
| Pertanyaan awal | Berapa lama Ratu AI menjawab kalau 5 orang atau lebih bertanya bersamaan? |
| Yang diuji | 1, 2, 3, 5, dan 8 orang bersamaan, 3 pertanyaan per orang, 8 jenis pertanyaan |
| Jalur | A: langsung ke model. B: lewat halaman portal (sementara disembunyikan dari laporan) |
| Hasil utama (jalur A) | Di bawah 1 menit sampai 3 orang; sekitar 1 menit di 5 orang (target 90 detik tercapai); sekitar 2 menit di 8 orang |
| Penyebab lambat | Antrean: server model hanya mengerjakan 2 permintaan sekaligus |
| Beban kartu grafis | Listrik 207 → 223 watt (batas 300 watt), sekitar 1 Wh per jawaban, suhu paling tinggi 67 °C |
| Jeda sebelum model menulis | 0,05 detik tanpa antrean, 17–20 detik di 8 orang |
| Kestabilan server | 0 gagal dari 459 panggilan ke model |
| Dokumen yang dihasilkan | Rencana uji, laporan hasil, halaman grafik + PNG, skrip penjelasan, catatan ini |

---

## Bagian 1 — Dari pertanyaan ke rencana uji (12 November)

**Pemilik proyek:**
> "oke sebenernya saya ingin model ini saya uji untuk pengukuran semisal kecepatan ketika membalas
> dan lain-lain. menurutmu apa yang mempengaruhi kecepatan model dalam menjawab dan seberapa akurat
> jawaban itu"

**Claude:** menjelaskan hal-hal yang memengaruhi kecepatan. Yang dibahas: ukuran model, panjang
instruksi dan riwayat, jumlah langkah agent per pertanyaan, antrean di server model, jaringan ke
server, dan beban laptop yang menjalankan portal. Ketepatan diukur dengan kriteria "dianggap benar"
per jenis pertanyaan, misalnya angka penjualan harus sama dengan database.

**Pemilik proyek:**
> "oke jadi rencana saya adalah untuk menguji ketika ada 5 user dan seterusnya sedang memakai ratu
> ai bersamaan. berapa lama kah ratu ai akan menjawab>"

> "jangan dulu. kasih tau dulu rencananya"

> "fokus saya disini untuk menguji yang model 14B. buatkan saya .md/.txt untuk rencana pengujian
> ini lengkap dengan target hasilnya gmana (harus ada grafik, tabel hasil, dll)"

**Claude:** menyusun `docs/benchmark/rencana-uji-beban-qwen3-14b.md`, berisi:
- tujuan dan empat dugaan yang akan diuji;
- 8 pertanyaan beserta kriteria benarnya;
- tahap 1, 2, 3, 5, dan 8 orang, dalam dua jalur: A langsung ke model, B lewat portal;
- target untuk 5 orang: waktu tengah ≤ 90 detik, 95% pertanyaan ≤ 180 detik, ≥ 90% berhasil;
- bentuk tabel dan grafik laporan;
- batas keamanan: tidak menyimpan tiket, tidak mencetak kunci API.

**Masalah sebelum uji bisa jalan:**
- Kunci API model 14B dibatasi **10 permintaan**, padahal satu pertanyaan bisa memanggil model
  4–12 kali, sehingga muncul galat 429. Pemilik proyek mengganti kuncinya:
  > "coba lagi. udah saya ganti api key di env untuk yang model 14b"
- Portal perlu dinyalakan ulang supaya kunci baru terbaca.

**Pemilik proyek:**
> "oke buatkan logbook untuk hari ini dlu. hasilnya kasih tau besok saja"

---

## Bagian 2 — Menjalankan uji (13 November pagi)

**Pemilik proyek:**
> "oke lanjutkan pengujian yang kemarin"

> "coba tes lagi krn ai base url udah saya ganti"

> "oke lanjut"

**Claude:** membuat `scripts/uji-beban.mts` lalu menjalankan dua jalur:

| Jalur | Waktu (WIB) |
|---|---|
| B, lewat portal | 10.06–10.45 |
| A, langsung ke model | 10.46–11.13 |

Selama uji, pemilik proyek mengirim tangkapan layar kondisi kartu grafis (nvidia-smi dan nvtop).

**Hasil uji pagi:**

| Orang bersamaan | Jalur A, waktu tengah | Jalur B, waktu tengah | Jalur B berhasil |
|---:|---:|---:|---:|
| 1 | 18 dtk | 20 dtk | 3/3 |
| 2 | 42 dtk | 35 dtk | 6/6 |
| 3 | 44 dtk | 72 dtk | 9/9 |
| 5 | 73 dtk | 145 dtk | 15/15 |
| 8 | 125 dtk | 238 dtk | **15/24** |

- Jalur A: 57 dari 57 pertanyaan terjawab dan benar.
- Jalur B sekitar 2× lebih lambat, karena laptop yang menjalankan portal sibuk (CPU 54–66%, RAM
  hampir penuh).
- Tidak ada galat 429, dan tidak ada tiket yang tersimpan.

---

## Bagian 3 — Laporan dan halaman grafik

**Claude:** menulis `docs/benchmark/hasil-uji-beban-qwen3-14b.md` dan `docs/grafik-uji-beban-qwen3-14b.html`
(beserta PNG).

**Pemilik proyek:**
> "oh ya untuk pertanyaan pada pengujia juga tolong dimasukkan ... tolong di update"

> "yang gagal juga tolong di lampirin itu gagal yang mana"

**Claude:** menambahkan tabel 8 pertanyaan beserta kriteria benarnya, dan tabel setiap pertanyaan
yang gagal atau kurang tepat lengkap dengan penyebabnya.

---

## Bagian 4 — Beban server dan akses ke server model

**Pemilik proyek:**
> "bisakah kamu memasukkan beban server/model juga?"

> "kalo saya kasih akses ec2nya apakah bisa"

**Claude:** menjelaskan bahwa bisa, dengan cara yang aman:
- Kunci SSH tidak ditempel ke percakapan. Pemilik proyek cukup membuat alias di `~/.ssh/config`.
- Claude hanya menjalankan perintah baca: `docker ps`, `docker logs`, `nvidia-smi`.
- Tidak ada restart dan tidak ada setelan server yang diubah.

**Pemilik proyek:**
> "oke sudah saya tambahkan di ssh/config"

**Yang ditemukan dari catatan server:**
- Log server model menyimpan isi antrean setiap sekitar 10 detik, jadi beban selama uji pagi masih
  bisa dibaca.
- **Semua 416 permintaan ke model selama uji pagi dibalas berhasil (200 OK).** Sambungan yang putus
  di jalur B tidak berasal dari server.
- Di jalur A, model penuh 94–99% waktu pada 5–8 orang, dengan rata-rata 2–5 permintaan antre.
- Di jalur B, model justru lebih longgar. Artinya, di jalur B permintaan tertahan di laptop sebelum
  sampai ke model.

---

## Bagian 5 — Merekam beban kartu grafis

**Pemilik proyek:**
> "untuk yang beban gpu apakah gabisa disesuaikan atau sama. terus kemudian saya maunya ada data
> yang menunjukkan beban gpu yang digunakan ketika ada pertanyaan"

**Claude:** menjelaskan bahwa beban kartu grafis saat uji pagi tidak bisa dipulihkan, karena
`nvidia-smi` tidak menyimpan riwayat dan alat pemantau di server tidak merekamnya. Solusinya:
merekam kartu grafis setiap 0,5 detik lewat SSH (`scripts/rekam-gpu.mts`), lalu mencocokkannya
dengan jam setiap pertanyaan.

**Pemilik proyek:**
> "oke gas"

Claude sempat memulai uji model lain (satu pertanyaan demi satu pertanyaan), lalu pemilik proyek
meluruskan:

> "saya pengennya seperti uji tadi pagi, jadi datanya tidak beda.., sama nnti yang baru sudah ada
> sama beban gpu ketika pertanyaan dikirim baik hanya 1 user sampai 8 user bersamaan seperti itu"

**Claude:** menghentikan uji itu, lalu menjalankan ulang dengan cara yang **sama persis** seperti
uji pagi, ditambah rekaman kartu grafis.

**Jalur B di uji ulang gagal:** portal di laptop menyalakan ulang dirinya sendiri karena memorinya
hampir penuh, sehingga hanya 1 dari 9 pertanyaan di tahap 3 orang yang berhasil.

**Pemilik proyek:**
> "kita fokus ke lapis A aja yang langsung ke model"

**Hasil uji ulang jalur A (13.31–13.59 WIB):**

| Orang bersamaan | Waktu tengah | Kartu grafis sibuk | Listrik | Listrik per jawaban |
|---:|---:|---:|---:|---:|
| 1 | 34 dtk | 91% | 207 W | 1,25 Wh |
| 2 | 28 dtk | 96% | 215 W | 0,87 Wh |
| 3 | 43 dtk | 99% | 217 W | 0,77 Wh |
| 5 | 60 dtk | 99% | 222 W | 1,14 Wh |
| 8 | 129 dtk | 100% | 223 W | 0,96 Wh |

- Hasilnya mirip dengan uji pagi, jadi datanya bisa dipercaya.
- Angka "sibuk" sudah hampir 100% walau baru 1 orang. Angka itu hanya menunjukkan kartu sedang
  bekerja atau tidak, jadi listrik lebih tepat untuk melihat beratnya.
- Ada 3 pertanyaan yang tidak selesai dalam 5 menit (tiket dan SOP, di 5 dan 8 orang), dan
  1 jawaban SOP yang kurang tepat.

---

## Bagian 6 — Tabel bisa diurutkan, dan mencari catatan "jeda sebelum model menulis"

**Pemilik proyek:**
> "mana htmlnya"

> "yang di beban gpu setiap pertanyaan tolong kasih fitur sort"

**Claude:** tabel per pertanyaan bisa diurutkan dengan mengklik judul kolomnya.

**Pemilik proyek:**
> "ubah desain htmlnya buat jadi rapi dan cari adakah log yg menghitung tfft"

**Yang ditemukan:**
- **Gerbang model (LiteLLM) mencatat setiap panggilan ke model**: jam masuk, jam kata pertama
  keluar, jam selesai, dan jumlah token. Hanya kolom waktu dan token yang diambil, tanpa isi
  percakapan.
- Server model juga punya angka ini, tetapi hanya totalnya sejak server menyala, jadi tidak bisa
  dipisah per uji.

| Orang bersamaan | Jeda sebelum model menulis (waktu tengah) |
|---:|---:|
| 1 | 0,05 dtk |
| 3 | 0,9 dtk |
| 5 | 6,5–8 dtk |
| 8 | 17–20 dtk |

Kesimpulannya: modelnya sendiri cepat, dan jeda yang panjang adalah waktu antre.

Halaman grafik didesain ulang dengan kotak angka di atas, menu yang tetap terlihat, bagian
bernomor, kotak "Intinya", dan pilihan tema terang/gelap.

---

## Bagian 7 — Menyederhanakan untuk dibaca orang lain

**Pemilik proyek:**
> "untuk sementara hapus hasil lapis B dl saja. kemudian copywritingnya diubah agar penjelasan yang
> ada memakai bahasa yang jelas dan sederhana"

**Claude:**
- **Jalur B disembunyikan dari halaman grafik.** Datanya tetap ada, dan versi lengkap bisa
  dimunculkan lagi.
- **Grafik sekarang membandingkan uji pagi dengan uji ulang.**
- **Istilah teknis diganti**, misalnya "P50" menjadi "waktu tengah", "TTFT" menjadi "jeda sebelum
  model mulai menulis", dan "KV cache" menjadi "memori kerja model".

**Pemilik proyek:**
> "oke kemudian buatkan saya skrip penjelasan dari data yang dihasilkan dengan sederhana dan jelas
> dan mudah dimengerti"

**Claude:** menulis `docs/benchmark/skrip-penjelasan-uji-beban-qwen3-14b.md`. Isinya:
- naskah lisan sekitar 6–8 menit, dengan petunjuk grafik mana yang ditampilkan;
- perumpamaan "loket dengan 2 petugas" untuk menjelaskan antrean;
- kesimpulan, saran, dan 6 perkiraan pertanyaan beserta jawabannya.

**Pemilik proyek:**
> "oke ubah percakapan kita terkait pengujian ini jadi .md"

Dokumen ini adalah hasilnya.

---

## Keputusan dan batasan yang dipegang selama percakapan

| Hal | Keputusan |
|---|---|
| Setelan server model, gerbang model, Docker | Tidak diubah. Hanya dibaca |
| Kunci SSH | Tidak ditempel ke percakapan; dipakai lewat alias `mr-ec2` |
| Kunci API | Tidak dicetak di log, laporan, atau dokumen |
| Tiket helpdesk | Hanya sampai rancangan; jumlah tiket diperiksa sebelum dan sesudah uji (0 bertambah) |
| Isi percakapan di catatan server | Tidak dibaca; hanya waktu, jumlah token, dan status |
| Jalur B (portal) | Disembunyikan sementara; akan diuji ulang setelah portal berjalan di server |

---

## Daftar berkas

| Berkas | Isi |
|---|---|
| `docs/benchmark/rencana-uji-beban-qwen3-14b.md` | Rencana uji dan target |
| `docs/benchmark/hasil-uji-beban-qwen3-14b.md` | Laporan hasil lengkap (masih memuat jalur B) |
| `docs/grafik-uji-beban-qwen3-14b.html` / `.png` | Halaman grafik, jalur A saja |
| `docs/benchmark/skrip-penjelasan-uji-beban-qwen3-14b.md` | Naskah presentasi |
| `docs/benchmark/catatan-percakapan-uji-beban-qwen3-14b.md` | Dokumen ini |
| `scripts/uji-beban.mts` | Skrip uji beban (opsi `--gpu` untuk merekam kartu grafis) |
| `scripts/rekam-gpu.mts` | Perekam kartu grafis lewat SSH |
| `data/uji-beban-qwen3-14b-*` | Data mentah uji (tidak ikut Git) |
| `data/litellm-waktu-qwen3-14b-2026-11-13.csv` | Catatan waktu dari gerbang model (tidak ikut Git) |

---

## Yang masih terbuka

1. Menaikkan batas "2 permintaan sekaligus" di server model, lalu mengulang uji. Keputusannya di
   pengelola server.
2. Menguji ulang jalur portal setelah portal berjalan di server, bukan di laptop.
3. Menyesuaikan laporan `.md` supaya sejalan dengan halaman grafik: jalur B disembunyikan dan
   bahasanya disederhanakan.
4. Merotasi kunci SSH dan kunci API Qwen3.5 35B yang sempat terlihat di percakapan sebelumnya.
5. Menyimpan perubahan ke Git setelah repositori dijadikan private.
