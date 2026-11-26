# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Jumat, 30 Oktober 2026
**Proyek:** Pemeriksaan ulang peramalan & riset pasar dengan model yang lebih kuat
**Lokasi kerja:** folder `marketing/`

> Saldo API Claude sudah diisi, jadi dua pemeriksaan yang kemarin terpaksa
> dijalankan dengan model server kantor hari ini diulang dengan model yang
> lebih kuat. Keduanya lolos penuh.

> **Benang merah hari ini: dua hal yang terlihat seperti kegagalan dan
> keberhasilan ternyata tertukar.** Satu kegagalan di layar ternyata kesalahan
> alat ujinya sendiri, dan satu pemeriksaan yang saya anggap sudah lolos
> ternyata belum pernah dijalankan.

---

## Entri 1 — Menjalankan ulang pemeriksaan dengan model Claude

**Waktu:** pagi

**Uraian kegiatan**

Kemarin dua pemeriksaan yang memakai model bahasa hanya bisa dijalankan dengan
Gemma 12B di server kantor karena saldo API Claude habis. Hari ini saldo sudah
pulih, jadi keduanya diulang dengan Claude Haiku 4.5.

Alasan diulang, bukan dianggap cukup: Gemma dan Claude membaca keterangan alat
dengan cara yang berbeda. Lolos di satu model tidak membuktikan lolos di model
lain, dan **model yang dipakai di portal sehari-hari adalah Claude**.

Seluruh pemeriksaan otomatis juga dijalankan ulang lebih dulu, supaya kalau ada
yang merah di pemeriksaan lewat asisten, sudah pasti bukan karena perhitungannya
yang rusak.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Pemeriksaan otomatis (peramalan + riset pasar) | **375 lolos** |
| Pemeriksaan lewat asisten — ramalan langsung | **12 lolos, 0 gagal** |
| Pemeriksaan lewat asisten — lewat penerus pesan | **12 lolos, 0 gagal** |

Yang dibuktikan pemeriksaan lewat asisten, bukan cuma "tidak error":

```
18 angka di jawaban, semuanya berasal dari alat    (tidak ada yang dikarang)
model yang dipakai disebut                          Naive (sama dengan bulan terakhir)
tingkat kesalahan disebut                           ada
rentang terendah-tertinggi tersampaikan             17.004 - 27.772
bulan terakhir data disebut                         2026-07
produk yang tidak ada di database                   ditolak, tidak dikarang
produk yang sudah berhenti terjual                  diakui berhenti, tanpa angka ramalan
nama produk belum lengkap                           ditanya balik, bukan dikira-kira
```

---

## Entri 2 — Satu "angka karangan" yang ternyata bukan karangan

**Waktu:** pagi

**Uraian kegiatan**

Putaran pertama dengan Claude berhenti di satu kegagalan:

```
GAGAL  tidak ada angka karangan di jawaban — angka tak dikenal: 1006000
```

Pemeriksaan ini tugasnya menjaga agar asisten tidak pernah menyebut angka yang
tidak berasal dari data. Jadi merahnya serius — kalau benar, berarti asisten
mengarang angka.

Ternyata bukan. **1006000 adalah kode produk**, data asli yang memang dikirim
oleh alat. Yang kurang adalah daftar angka sah di alat ujinya: kode produk tidak
pernah dimasukkan ke dalamnya, jadi angka yang paling sah justru dibaca sebagai
karangan.

Sekalian ditutup satu sumber kesalahan serupa yang sempat muncul 27 Oktober.
Asisten menulis rupiah dengan satuan:

```
yang ditulis asisten : "Rp 1.156,3 juta"
yang terbaca penguji : 1156
angka aslinya        : 1.156.272.700
```

Dibandingkan apa adanya, 1.156 dan 1,16 miliar tidak mirip sama sekali — padahal
itu angka yang sama, cuma ditulis dalam juta. Sekarang angka yang sama dengan
angka sah dibagi seribu, sejuta, atau semiliar ikut diterima.

**Hasil terukur**

Setelah alat ujinya diperbaiki: **12 lolos, 0 gagal**.

**Temuan penting**

Ini melonggarkan ujinya atau tidak? Tidak — **menolaknya yang keliru.** Dan uji
yang merah untuk perilaku yang benar justru berbahaya: ia mengajari
pembacanya mengabaikan warna merah, sehingga merah yang sungguhan nanti ikut
dilewati.

Perbaikan ini juga terbantu oleh keputusan 27 Oktober untuk **mencetak jawaban
penuh setiap kali gagal**. Tanpa itu yang terlihat di layar cuma "angka tak
dikenal: 1006000", tanpa cara apa pun untuk tahu dari mana angka itu datang.

---

## Entri 3 — Pemeriksaan yang terlihat lolos padahal belum pernah jalan

**Waktu:** menjelang siang

**Uraian kegiatan**

Dua pemeriksaan lewat asisten dijalankan berurutan dalam satu proses yang
berjalan di latar belakang. Waktu dicek, hasil pemeriksaan pertama ada, dan
tidak ada satu pun pesan kesalahan.

Setelah diperiksa lebih teliti, berkas hasil pemeriksaan **kedua tidak pernah
terbentuk**, dan catatan prosesnya kosong — artinya proses itu mati di tengah,
setelah pemeriksaan pertama selesai dan sebelum yang kedua mulai.

Pemeriksaan kedua lalu dijalankan sendiri: **12 lolos, 0 gagal**.

**Temuan penting**

Yang berbahaya di sini bukan prosesnya mati, tapi **matinya tidak meninggalkan
jejak merah apa pun**. Kalau saya hanya melihat "pemeriksaan pertama lolos" lalu
menyimpulkan keduanya lolos, saya akan melaporkan hasil yang tidak pernah
diukur.

Pelajarannya: **tidak adanya pesan kesalahan bukan bukti pekerjaan sudah
selesai.** Yang membuktikan hanya ada atau tidaknya hasil yang bisa dibaca.

Pola ini sudah berulang sepanjang minggu dengan wajah yang berbeda-beda:

| Tanggal | Yang terlihat baik | Yang sebenarnya terjadi |
|---|---|---|
| 26 Okt | pemeriksaan hijau | menguji lapisan yang salah |
| 27 Okt | ketepatan model 22,7% | diukur di periode yang sama dengan yang dipakai memilih |
| 29 Okt | 110 pemeriksaan hijau | tiga kesalahan muncul saat layanan sungguhan dipanggil |
| 29 Okt | semua sumber tampil normal | tanggal terbit tidak pernah ikut; penilaian kemutakhiran mati |
| 30 Okt | tidak ada pesan kesalahan | satu pemeriksaan tidak pernah dijalankan |

---

## Ringkasan hari ini

| Yang dikerjakan | Keadaan |
|---|---|
| Pemeriksaan otomatis seluruhnya | **375 lolos** |
| Pemeriksaan lewat asisten dengan Claude | **12 + 12 lolos, 0 gagal** |
| Perbaikan alat uji (kode produk & satuan juta/miliar) | selesai |
| Fitur riset pasar dinyalakan di portal | **belum** |
| Tiga alat riset pasar didaftarkan ke sistem | **belum** |

**Keadaan fitur peramalan:** sudah terbukti bisa dipakai lewat percakapan, baik
langsung maupun lewat penerus pesan, dengan model kuat (Claude) maupun model
lemah (Gemma di server kantor).

**Catatan untuk hari kerja berikutnya:**

1. Nyalakan fitur riset pasar (`MARKET_SEARCH_ENABLED`) dan daftarkan ketiga
   alat baru, lalu coba langsung di layar.
2. **Perlu dibicarakan dengan tim sebelah:** data pembanding mereka baru 9
   bulan. Kalau diperpanjang jadi 12 bulan, kestabilan pemilihan model untuk
   seluruh katalog naik dari 67% ke 88% tanpa kehilangan model mereka.
3. Pemeriksaan yang memakai model bahasa sebaiknya dijalankan satu per satu,
   bukan berurutan dalam satu proses latar belakang — supaya yang tidak jalan
   kelihatan tidak jalan.
