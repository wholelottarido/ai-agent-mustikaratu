# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Kamis, 29 Oktober 2026
**Proyek:** Peramalan penjualan (penyelesaian) + riset pasar dari internet
**Lokasi kerja:** folder `marketing/`

> Dua pekerjaan hari ini. Pagi menyelesaikan perbaikan penilaian model yang
> tertunda dari Selasa. Siang sampai sore membangun **fitur baru: asisten bisa
> mencari kondisi pasar dari internet** dan menyandingkannya dengan ramalan.

> **Benang merah hari ini: tiga kali pemeriksaan otomatis yang sudah hijau
> ternyata belum membuktikan apa-apa.** 110 pemeriksaan riset pasar hijau,
> lalu tiga kesalahan muncul begitu layanan internet yang sungguhan dipanggil.
> Pola yang sama sudah dua kali terjadi minggu ini.

---

## Entri 1 — Menyelesaikan perbaikan penilaian model

**Waktu:** pagi

**Uraian kegiatan**

Melanjutkan pekerjaan Selasa: model peramalan dinilai di **empat periode**
sekaligus, bukan satu, supaya pilihannya tidak ditentukan keberuntungan.

Sambil menyelesaikan, ditemukan dan diperbaiki:

| Masalah | Akibatnya kalau dibiarkan |
|---|---|
| Peringatan "unit bergerak tapi rupiah rata" menyala juga saat kedua satuan memakai model yang **sama** | Peringatannya menjelaskan sebab yang salah — bedanya datang dari datanya, bukan dari pilihan model |
| Dua contoh data uji buatan sendiri **tidak bisa menguji apa yang dimaksud** | Deret datar membuat satu model mencetak 0% dan tak terkalahkan; deret bolak-balik membuat model lain yang 0% |
| Satu pemeriksaan lolos tanpa menguji apa pun | Tertulis "tidak bentrok di data hari ini" — kalimat yang selalu benar |
| Catatan hasil uji menyesatkan | Mencetak dua batas *bawah* di bawah label "rendah – tinggi", terbaca seperti rentang selebar nol |

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Pemeriksaan peramalan | **261 lolos** |
| Pemeriksaan lewat asisten sungguhan | 12 + 12 lolos |

---

## Entri 2 — Saldo API habis, pindah ke model di server kantor

**Waktu:** pagi

**Uraian kegiatan**

Dua pemeriksaan yang memakai model bahasa tidak bisa dijalankan — saldo API
Claude habis. Dari lima model yang terdaftar di sistem:

| Model | Dipakai? | Sebab |
|---|---|---|
| Claude Sonnet 5 / Haiku 4.5 | tidak | saldo habis |
| **Qwen 14B** | **tidak boleh** | berjalan di Google Colab; aturan proyek melarang mengirim data perusahaan ke sana |
| Gemma 12B (server kantor) | **ya** | server internal, data tidak keluar perusahaan |
| Qwen 7B (komputer sendiri) | cadangan | dibatasi satu alat saja |

Aturannya dikutip langsung dari dokumen proyek, bukan dari ingatan:
*"Send production company data to the Colab endpoint during testing"* termasuk
daftar yang **dilarang**. Pemeriksaan ini membaca nama produk dan angka
penjualan asli — persis yang dilarang.

**Hasil terukur**

Dengan Gemma 12B: **12 lolos, 0 gagal** untuk keduanya.

**Temuan penting**

Hijau dengan Gemma lebih berarti daripada hijau dengan Claude: Gemma jauh
lebih lemah, jadi lolosnya membuktikan alatnya memang bisa dipakai benar —
angka tidak dikarang, ketepatan dan rentang tersampaikan, nama produk tidak
diada-adakan.

---

## Entri 3 — Fitur baru: riset pasar dari internet

**Waktu:** siang sampai sore

**Uraian kegiatan**

Mengerjakan Phase 2 sesuai dokumen `docs/fitur/sales-websearch.md`. Asisten sekarang
bisa mencari kondisi pasar dari internet dan menyandingkannya dengan ramalan.

| Alat baru | Guna |
|---|---|
| `cari_tren_pasar` | tren konsumen, berita industri untuk satu produk |
| `riset_pesaing` | kegiatan pesaing yang terbuka ke publik |
| `analisis_pasar_penjualan` | ramalan **dan** kondisi pasar bersebelahan |

**Dua batas yang dijaga keras**

1. **Angka ramalan tetap dari model statistik.** Informasi dari internet hanya
   untuk menjelaskan keadaan di sekitarnya. Asisten **dilarang** menaikkan
   atau menurunkan angka ramalan karena membaca berita — yang boleh
   disimpulkan adalah risiko, peluang, dan saran dalam bentuk kalimat.
2. **Data perusahaan tidak keluar.** Yang dikirim ke mesin pencari hanya nama
   dan kategori produk yang memang sudah publik.

**Cara batas kedua dijaga**

Bukan dengan menyaring satu per satu apa yang dilarang — kalau begitu, setiap
kolom baru yang ditambahkan orang lain nanti ikut keluar secara bawaan.
Sebaliknya: seluruh jalur riset pasar **hanya bisa menerima tiga keterangan**
(nama, merek, kategori). Angka penjualan dan kode produk tidak bisa ikut bukan
karena disaring, tapi karena tidak pernah diterima.

Nama produk juga dibersihkan sebelum dikirim:

```
MASKER BENGKOANG BT N.PACK 15GR  ->  masker bengkoang
MINYAK ZAITUN 175 ML RJ          ->  minyak zaitun
```

"BT", "RJ", "N.PACK" adalah tata nama internal perusahaan. Membuangnya
sekaligus menutup kebocoran **dan** memperbaiki hasil pencarian — tidak ada
artikel di internet tentang "N.PACK 15GR".

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Pemeriksaan riset pasar | **114 lolos** |
| Pemeriksaan peramalan (tetap hijau) | 261 lolos |

Pemeriksaan yang paling menentukan **menyadap apa yang benar-benar dikirim**
ke internet, memakai produk asli dari database:

```
produk uji: MINYAK ZAITUN 175 ML RJ (kode 1006000)
yang dikirim: "tren minyak zaitun Indonesia 2026" dan 3 lainnya

kode produk 1006000 TIDAK ikut        LOLOS
angka penjualan asli TIDAK ikut       LOLOS
tata nama internal TIDAK ikut         LOLOS
```

**Temuan penting**

Kebocoran data perusahaan **tidak menimbulkan pesan kesalahan apa pun**. Tidak
ada yang merah di layar; yang terjadi hanya angka penjualan Mustika Ratu
tercatat di server pihak ketiga. Satu-satunya cara mengetahuinya adalah
memeriksa apa yang benar-benar berangkat — karena itu pemeriksaan di atas
dibuat.

---

## Entri 4 — Memanggil layanan sungguhan, dan tiga kesalahan muncul

**Waktu:** sore

**Uraian kegiatan**

Setelah kunci API dipasang, jalur pencarian yang sungguhan diuji untuk
pertama kalinya. **110 pemeriksaan sudah hijau sebelumnya**, dan tiga hal
tetap muncul:

| # | Kesalahan | Akibatnya |
|---|---|---|
| 1 | Jenis pencarian yang dipilih **tidak memulangkan tanggal terbit sama sekali** | Semua sumber tampil "tanpa tanggal"; seluruh penilaian kemutakhiran mati **tanpa gejala apa pun** |
| 2 | Satu kata cocok dianggap cukup | Artikel "Pengolahan Limbah Agro-Industri" dinilai relevan hanya karena kata "minyak" ada di dalamnya |
| 3 | Jawaban alat **16,8 KB** untuk 19 sumber, padahal hanya 6 relevan | Yang relevan tenggelam; asisten cenderung merangkum yang terbanyak, bukan yang terlayak |

Ketiganya sudah diperbaiki. Ukuran jawaban turun ke 9,9 KB, dan sumber
teratas sekarang bertanggal.

**Hasil terukur**

```
MINYAK ZAITUN 175 ML RJ — 6,5 detik, 4 pencarian, 0 gagal

ramalan : 22.388 unit/bulan, meleset 16,7%   (dari model statistik)
pasar   : 19 sumber ditemukan, 6 relevan, 8 dikirim ke asisten
```

**Temuan penting**

Pemeriksaan otomatis memakai layanan **tiruan** yang bentuk jawabannya kita
tentukan sendiri. Yang tidak bisa dibuktikan cara itu: apakah layanan
sungguhan berbentuk sama. Di situlah ketiga kesalahan bersembunyi.

Ini kejadian ketiga minggu ini dengan pola yang sama — 26 Oktober (uji
menguji lapisan yang salah), 27 Oktober (penilaian satu periode), dan hari
ini. Pemeriksaan otomatis menjaga agar yang sudah benar tidak rusak; ia tidak
membuktikan bahwa yang baru memang benar.

---

## Ringkasan hari ini

| Yang dikerjakan | Keadaan |
|---|---|
| Penilaian model empat periode | selesai |
| Pemeriksaan lewat asisten (model server kantor) | 12 + 12 lolos |
| Fitur riset pasar: 3 alat baru | selesai |
| Pemeriksaan otomatis seluruhnya | **375 lolos** (261 peramalan + 114 pasar) |
| Jalur pencarian internet sungguhan | sudah diuji, 3 kesalahan ditemukan & diperbaiki |
| Fitur dinyalakan di portal | **belum** |
| Alat didaftarkan ke sistem | **belum** |

**Catatan untuk besok:**

1. Nyalakan fiturnya (`MARKET_SEARCH_ENABLED`) dan daftarkan ketiga alat baru,
   lalu coba langsung di layar seperti hari-hari sebelumnya.
2. **Perlu dibicarakan dengan tim sebelah:** data pembanding mereka hanya 9
   bulan. Kalau diperpanjang jadi 12 bulan, kestabilan pemilihan model untuk
   seluruh katalog naik dari 67% ke 88% tanpa kehilangan model mereka.
3. Isi saldo API Claude kalau pemeriksaan perlu dijalankan dengan model yang
   lebih kuat.
4. Catatan mutu: untuk produk bernama umum seperti "minyak zaitun", hasil
   pencarian condong ke tren konsumsi (minum minyak zaitun untuk diet)
   ketimbang pasar perawatan tubuh. Bukan kerusakan, tapi perlu diketahui
   sebelum dipakai untuk keputusan.
