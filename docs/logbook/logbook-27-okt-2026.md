# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Selasa, 27 Oktober 2026
**Proyek:** Peramalan penjualan — memperbaiki ketepatan dan kejujuran hasilnya
**Lokasi kerja:** folder `marketing/`

> Kemarin mesin peramalannya jadi. Hari ini **dibenahi supaya hasilnya benar**,
> dibantu dokumen spesifikasi dari rekan di tim sebelah dan percobaan langsung
> di layar.

> **Benang merah hari ini: tiga kali dugaan saya dibantah oleh pengukuran, dan
> ketiganya mengubah keputusan.** Dua di antaranya baru ketahuan karena
> diukur dulu sebelum kodenya ditulis; yang ketiga ketahuan karena pertanyaan
> yang diajukan waktu mencoba sendiri di layar.

---

## Entri 1 — Membaca spesifikasi rekan, lalu lima perbaikan

**Waktu:** pagi

**Uraian kegiatan**

Membaca `DOKUMEN SPESIFIKASI SUBSISTEM FORECAST PENJUALAN` (46 halaman) milik
rekan dari tim sebelah, lalu mengerjakan bagian yang bisa diterapkan ke sistem
kita.

| # | Perbaikan | Sebabnya |
|---|---|---|
| 1 | Ukuran ketepatan diganti dari MAPE ke **WAPE** | MAPE membagi per bulan, jadi bulan bernilai nol harus dilewati — untuk produk yang jarang terjual, nilainya bisa dihitung dari **satu bulan saja** |
| 2 | Jeda data **ditembus**, bukan cuma diperingatkan | Data berhenti Juli, pertanyaan diajukan Oktober. Versi lama menjawab Agu/Sep/Okt — tiga bulan yang **sudah lewat** |
| 3 | Produk yang sudah berhenti dijual ditolak lebih awal | Meramal penjualan barang yang tidak dijual lagi berarti mengarang angka |
| 4 | Penjualan yang terlalu goyah → rata-rata 3 bulan **berlabel** | Lebih berguna daripada menolak, asal disebut apa adanya |
| 5 | Ditambah **rentang** "paling rendah – paling tinggi" | Satu angka membuat pembacanya mengira kita tahu persis |

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Produk terlaris yang "diramal" padahal lebih buruk daripada menebak nol | **75 dari 300** sebelum diperbaiki |
| Contoh terburuk | `MINUMAN BERAS KENCUR B 200 ML` — disodorkan 21 unit/bulan, melesetnya 449%, dihitung dari satu titik |
| Pemeriksaan otomatis | 129 lolos |

**Temuan penting**

Satu penjagaan yang saya pasang pagi harinya **dihapus lagi** sore harinya —
ternyata ia cuma menambal kelemahan MAPE, dan sesudah MAPE diganti ia tidak
punya alasan untuk ada.

---

## Entri 2 — Memakai model machine learning tim sebelah, tanpa menjalankannya

**Waktu:** siang

**Uraian kegiatan**

Ditemukan bahwa tabel `ai_forecast_ml` di database perusahaan **sudah terisi**
hasil model LightGBM milik tim sebelah: 9.240 baris ramalan untuk 770 produk.
Artinya model itu bisa ikut bersaing dengan model kita **tanpa menjalankan
Python sama sekali** — cukup dibaca dari database.

**Hasil terukur**

| Cara membandingkan | LightGBM menang |
|---|---|
| Memakai angka ketepatan yang **mereka laporkan** (9 bulan) | 7 dari 56 |
| **Diukur ulang** pada jendela uji kita (3 bulan) | **16 dari 56** |

**Temuan penting**

Perbandingan pertama saya **keliru**, dan untungnya ketahuan sebelum kodenya
ditulis. Membandingkan ketepatan yang diukur 9 bulan dengan yang diukur 3
bulan lalu memilih angka terkecil itu tidak adil — periode yang lebih panjang
lebih sulit, jadi model yang diuji lebih keras justru terlihat lebih buruk.
Selisihnya lebih dari dua kali lipat, cukup untuk mengubah kesimpulan.

Jadi ketepatan LightGBM **dihitung ulang sendiri** memakai penjualan nyata
versi kita, bukan dipercaya dari angka yang mereka laporkan.

---

## Entri 3 — Model untuk produk yang tidak terjual tiap bulan

**Waktu:** sore

**Uraian kegiatan**

Menambahkan lima model khusus untuk **permintaan terputus** (Croston, SBA,
TSB, ADIDA, IMAPA) — produk yang beberapa bulan tidak ada penjualannya sama
sekali.

Rencana awalnya memakai layanan Python terpisah. **Diputuskan tidak**, dan
ditulis langsung di bahasa yang sudah dipakai, karena: rumusnya memang
sederhana (di bawah 200 baris), layanan terpisah harus dinyalakan dulu supaya
ramalannya jalan, dan datanya jadi tidak perlu keluar dari proses yang ada.

**Hasil terukur**

| Yang diperiksa | 144 produk terlaris | 94 produk volume terkecil |
|---|---|---|
| Golongan **terputus/bergumpal** | **0** | 44 |
| Golongan ragam lebar | 72 | 38 |
| Model baru lolos kelayakan | 43 | 34 |
| Ketepatan jadi lebih baik | 9 | 9 |
| Ketepatan jadi lebih buruk | 0 | 0 |
| Produk yang terselamatkan dari "cuma rata-rata" | 1 | 2 |

Dari 400 produk volume terkecil, **306 ternyata sudah berhenti dijual** dan
memang ditolak lebih awal.

⚠️ **Angka di atas sudah memakai cara penilaian baru dari Entri 4, dan jauh
lebih kecil daripada hasil pengukuran sore tadi** (yang menunjukkan 22 dan 17
produk membaik, 10 dan 9 terselamatkan). Selisihnya bukan karena ada yang
rusak: penilaian lama memakai 3 bulan, dan sebagian kemenangan model baru di
situ ternyata memang **kebetulan periode**. Yang berlaku adalah angka yang
baru.

**Temuan penting**

**Alasan saya mengerjakan tahap ini ternyata salah.** Saya menduga produk
terlaris yang hasilnya kurang baik disebabkan bulan-bulan yang kosong.
Diukur sebelum menulis kode: **tidak ada satu pun** produk terlaris yang
bolong bulannya — mereka terjual tiap bulan, dan yang jadi masalah adalah
jumlahnya yang **berayun lebar**.

Akibatnya penjaganya dipecah dua mengikuti cara kerja rumusnya: tiga model
yang mengukur jarak antar penjualan hanya untuk produk yang bolong; dua model
yang menumpuk beberapa bulan juga boleh untuk produk yang berayun. Pemecahan
itulah yang menentukan hasilnya — tanpa itu, cuma 10 produk yang terbantu.

---

## Entri 4 — Pertanyaan dari layar: kenapa ramalannya selalu rata?

**Waktu:** sore sampai malam

**Uraian kegiatan**

Mencoba sendiri di layar, lalu muncul pertanyaan: kenapa ramalan tiga bulannya
memberi **angka yang sama terus**? Diperiksa, dan jawabannya membuka masalah
yang lebih besar daripada pertanyaannya.

Jendela penilaian model digeser 3 bulan — data yang sama persis, cuma titik
penilaiannya bergeser. **Pemenangnya terbalik di ketiga produk yang diperiksa.**

| Produk | penilaian sekarang | penilaian digeser 3 bulan |
|---|---|---|
| PASTA GIGI SIRIH KB 150 | IMAPA 22,7% menang | Naive 24,2% menang, IMAPA jadi 70,5% |
| BODY S CRYSANT KB 245 | IMAPA 18,7% menang | Naive 26,8% menang, IMAPA jadi 82,0% |
| MINYAK CEMCEMAN 75 | IMAPA 22,8% menang | Naive 54,4% menang, IMAPA jadi 58,8% |

**Hasil terukur** — diuji pada 60 produk terlaris:

| Lama penilaian | Pemenangnya tetap sama waktu digeser |
|---|---|
| 3 bulan (yang dipakai selama ini) | **43%** |
| 6 bulan | 63% |
| 9 bulan | 67% |
| **12 bulan** | **88%** |
| 15 bulan | 88% — berhenti membaik |

**Temuan penting**

Model dipilih dari **tiga titik data**, dan tiga titik itu memutuskan jawaban
yang berbeda lebih dari dua kali lipat. Lebih halus lagi: angka ketepatan yang
ditampilkan ke pemakai diukur **pada periode yang dipakai memilih
pemenangnya** — jadi selalu terlihat lebih bagus daripada kenyataannya.

Sedang diperbaiki menjadi penilaian di beberapa periode sekaligus. Hasil
sementara: ketiga produk di atas berpindah ke model yang lebih sederhana, dan
ketepatan yang dilaporkan berubah dari 22,7% menjadi **43,9%** — bukan karena
hasilnya memburuk, melainkan karena angka sebelumnya terlalu bagus.

---

## Masalah lain yang ditemukan dan diperbaiki hari ini

| Masalah | Akibatnya kalau dibiarkan |
|---|---|
| Satu produk menyajikan ramalan **tanpa angka ketepatan sama sekali** — terpilih karena urutan daftar, bukan karena diuji | Di layar tampilannya persis seperti ramalan yang sudah diuji |
| Peringatan menyebut "angka ini bukan hasil model", padahal angka yang tampil **memang** hasil model | Pembaca berhenti mempercayai peringatan yang benar |
| Unit bergerak naik sementara rupiah diam di satu angka | Tabelnya menyatakan harga per unit turun sepertiga — tanpa dasar apa pun |
| Keterangan alat diperpanjang, lalu asisten mulai **bertanya balik** sebelum menjawab | Dua pemeriksaan ujung-ke-ujung turun dari 12/12 ke 11/12 |

Yang terakhir mengulang pelajaran tanggal 26: bukan isi kalimatnya yang salah,
melainkan **letaknya** — aturan penting terdorong ke bawah dan ikut melemah.

---

## Ringkasan hari ini

| Yang dikerjakan | Keadaan |
|---|---|
| Lima perbaikan dari spesifikasi rekan (WAPE, jeda data, produk berhenti, cadangan, rentang) | selesai |
| Model LightGBM tim sebelah ikut bersaing, tanpa menjalankan Python | selesai |
| Lima model untuk produk yang tidak terjual tiap bulan | selesai |
| Pemeriksaan otomatis | 256 lolos, ditambah 24 lewat asisten sungguhan |
| Penilaian model di beberapa periode | **sedang dikerjakan**, 1 pemeriksaan masih merah |
| Layanan Python terpisah | diputuskan **tidak dibuat** |

**Catatan untuk besok:**

1. Selesaikan penilaian beberapa periode, perbaiki 1 pemeriksaan yang masih
   merah, lalu jalankan seluruh pemeriksaan termasuk yang lewat asisten.
2. Entri 3 sudah diukur ulang (lihat tanda ⚠️ di sana). Yang masih perlu
   diperiksa: sekarang **lebih banyak produk jatuh ke rata-rata berlabel**
   (42 dan 83, naik dari 36 dan 66). Itu kemungkinan besar benar — produk itu
   memang tidak punya model yang cukup tepat kalau diuji 12 bulan — tapi
   perlu dipastikan pemakai mengerti bedanya "rata-rata berlabel" dan
   "ramalan model".
3. **Perlu dibicarakan dengan tim sebelah:** cross-validation mereka cuma 9
   bulan. Kalau diperpanjang jadi 12 bulan, seluruh katalog bisa memakai
   penilaian yang lebih stabil (88%) tanpa kehilangan model LightGBM mereka.
