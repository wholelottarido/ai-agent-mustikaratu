# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Senin, 26 Oktober 2026
**Proyek:** Peramalan penjualan — angka dihitung model statistik, bukan ditebak AI
**Lokasi kerja:** folder `marketing/`

> Hari ini asisten untuk pertama kalinya **meramal penjualan produk ke depan**.
> Yang menghitung bukan model bahasa, melainkan tiga model statistik yang
> dipilih lewat uji ketepatan. Model bahasa cuma merangkai hasilnya jadi
> kalimat — dan itu sengaja, karena angka ramalan adalah jenis angka yang
> dipakai orang mengambil keputusan.

> **Benang merah hari ini: 116 pemeriksaan hijau, lalu tiga kegagalan nyata
> ditemukan dalam sepuluh menit mencoba langsung di layar.**
> Ketiganya luput bukan karena pemeriksaannya kurang teliti, melainkan karena
> dua di antaranya memeriksa **lapisan yang bukan dipakai pemakai**. Itu
> pelajaran terbesar hari ini.

---

## Entri 1 — Mesin peramalan, lima tahap

**Waktu:** pagi sampai sore

**Uraian kegiatan**

Dikerjakan bertahap, tiap tahap diuji sebelum tahap berikutnya dimulai.

| Tahap | Isi | Uji |
|---|---|---|
| 1 | Membaca deret bulanan per produk dari `ai_forecast_sales_monthly` | 20 |
| 2 | Tiga model: Naive, Musiman, AutoARIMA | 31 |
| 3 | Pemilih model lewat backtest + penjaga kewajaran | 27 |
| 4 | Tool `ramal_penjualan` untuk asisten | 27 |
| 5 | Uji lewat agent sungguhan, ujung ke ujung | 11 |
| | **Jumlah** | **116** |

Tidak ada model yang perlu diunduh atau dilatih. Paket `arima` berukuran
547 KB dan berjalan di dalam proses yang sama — berbeda dengan model bahasa
yang perlu server tersendiri.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Produk dengan riwayat >= 26 bulan | 420 |
| Di antaranya yang riwayatnya tidak terputus | 161 |
| MAPE (meleset rata-rata) di produk yang diuji | 15,6% – 32% |
| Bulan terakhir yang ada datanya | Juli 2026 |

**Temuan penting**

Model yang menang **berbeda-beda per produk**. Tidak ada satu model terbaik:
produk dengan riwayat panjang dimenangkan AutoARIMA, produk baru yang riwayatnya
cuma 11 bulan dimenangkan Naive. Karena itu pemilihannya diserahkan ke backtest,
bukan ditentukan di awal.

Tabel sumbernya **tertinggal tiga bulan** — berhenti di Juli 2026 sementara data
mentah sudah sampai Oktober. Diputuskan tidak dilengkapi (tabel itu milik tim
sebelah), jadi sebagai gantinya tool wajib menyebutkan bulan terakhirnya di
setiap jawaban.

---

## Entri 2 — API key OpenAI diperiksa, lalu tidak dipakai

**Waktu:** sore

**Uraian kegiatan**

Diberi API key OpenAI untuk ditambahkan ke pilihan model. Diperiksa dulu
sebelum dipasang.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Key-nya sah | ya — 127 model terbaca |
| Saldo akun | kosong, tiap permintaan ditolak |
| Model termurah yang direncanakan | `gpt-4.1-nano`, `o4-mini` — dua-duanya sudah tidak didukung |

**Temuan penting**

Tidak ditambahkan ke pilihan model. Menambahkan pilihan yang pasti gagal berarti
memberi pemakai tombol yang hanya menghasilkan galat — lebih baik tidak ada
sama sekali daripada ada tapi rusak. Daftar `/v1/models` ternyata **masih
menyebut model yang sudah tidak bisa dipakai**, jadi daftar itu tidak bisa
dijadikan patokan.

---

## Entri 3 — ⚠️ Tiga kegagalan yang baru terlihat waktu dicoba sendiri

**Waktu:** sore

**Uraian kegiatan**

Sesudah 116 pemeriksaan hijau, asisten dicoba langsung lewat layar dengan enam
pertanyaan. Tiga kegagalan muncul, dan tidak satu pun tertangkap pemeriksaan
otomatis.

### 3a. Asisten mengarang nama varian produk

Ditanya "prediksi penjualan minyak zaitun", asisten **tidak memanggil alat
peramalan sama sekali**. Ia bertanya balik minta ukuran kemasan dan menyebutkan
contohnya sendiri: *"misalnya 75 ML, 175 ML, dll"*.

Angka itu datang dari ingatan model, bukan dari database. Yang membuatnya
berbahaya: pertanyaan balik **terlihat seperti kehati-hatian**. Tidak ada galat,
tidak ada angka ramalan yang salah, dan pemakai justru merasa dilayani dengan
teliti — sambil menerima daftar varian karangan.

Sebabnya ditemukan di lapisan yang tidak pernah diuji. Layar tidak memakai agent
Marketing langsung; ada **agent penerus** di depannya yang memutuskan meneruskan
pertanyaan atau menjawab sendiri. Agent penerus itu tidak punya alat satu pun —
jadi ia tidak mungkin tahu varian apa yang ada, tapi tetap menjawab.

### 3b. "Tiga bulan ke depan" yang jatuh di masa lalu

Untuk produk yang sudah lama berhenti terjual, horizon dihitung dari bulan
terakhir produk itu sendiri.

| Produk | Data terakhir | Yang diramal | Keadaan |
|---|---|---|---|
| BODY S ROSE MANGO 135 ML RJ | Maret 2026 | April–Juni 2026 | sudah lewat 4 bulan |

Hitungannya benar. Yang keliru adalah menyebut isian mundur sebagai "ramalan ke
depan".

### 3c. Unit naik, rupiah diam

Unit dan rupiah diramal terpisah, masing-masing memilih modelnya sendiri.

| Produk | Satuan | Model menang | MAPE | Hasil |
|---|---|---|---|---|
| MINYAK ZAITUN 75 ML RJ | unit | AutoARIMA | 16,7% | naik 24.986 → 28.233 (+13%) |
| | rupiah | Naive | 23,0% | **diam** di Rp617.244.300 |

Masing-masing sah. Disandingkan, keduanya menyatakan bahwa harga per unit turun
dari Rp24.703 ke Rp21.863 — sesuatu yang tidak pernah dimaksudkan siapa pun.

Yang membuatnya pantas diperbaiki: model rupiah pemenang cuma unggul **1,1 poin
persen** dari AutoARIMA (23,0% vs 24,1%) — masih di dalam derau untuk uji tiga
bulan. Keterbacaan tabel ditukar dengan ketepatan yang tidak terbukti ada.

**Perbaikan yang dikerjakan**

| Masalah | Perbaikan |
|---|---|
| 3a | Agent penerus dilarang bertanya balik soal isi data sebelum meneruskan — ia tidak punya alat, jadi tidak bisa tahu isinya |
| 3b | Bulan yang sudah lewat dihitung dan dibawa sebagai **angka**, bukan cuma kalimat peringatan, dengan larangan menyebutnya "ke depan" |
| 3c | Rupiah mengikuti model unit kalau selisih ketepatannya <= 2 poin persen; selisih besar tetap dihormati, dan penukarannya diberitahukan ke pemakai |

**Hasil terukur**

| Yang diperiksa | Sebelum | Sesudah |
|---|---|---|
| Uji pemilih model | 27 lolos | 37 lolos |
| MINYAK ZAITUN 75 ML RJ | unit AutoARIMA, rupiah Naive | dua-duanya AutoARIMA |
| Periode yang sudah lewat | tidak terdeteksi | dihitung dan diperingatkan |

**Temuan penting**

**Pemeriksaan otomatis yang menguji lapisan yang salah adalah pemeriksaan yang
menenangkan tanpa menjamin apa pun.** Uji ujung-ke-ujung yang dibuat tadi pagi
merakit agent Marketing langsung — sementara layar memakai agent penerus di
depannya. Semua hijau, dan pertanyaan pertama di layar tetap gagal.

Sudah dibuat pemeriksaan baru yang lewat jalur yang sama dengan layar, dan
pemeriksaan itu kini ikut memeriksa ketiga kegagalan di atas. Belum dijalankan
sampai akhir hari ini.

---

## Ringkasan hari ini

| Yang dikerjakan | Keadaan |
|---|---|
| Mesin peramalan 5 tahap | selesai, 116 pemeriksaan hijau |
| Alat `ramal_penjualan` terpasang di asisten Marketing | ya, 13 → 14 alat |
| OpenAI ditambahkan ke pilihan model | tidak — saldo akun kosong |
| Tiga kegagalan ditemukan lewat percobaan langsung | sudah diperbaiki ketiganya |
| Pemeriksaan lewat jalur layar | sudah dibuat, belum dijalankan |

**Catatan untuk besok:** jalankan pemeriksaan jalur layar, lalu perbarui
`CLAUDE.md` dengan pekerjaan peramalan ini.
