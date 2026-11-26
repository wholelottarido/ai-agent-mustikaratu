# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Senin, 2 November 2026
**Proyek:** Menyalakan riset pasar di portal, lalu memperbaiki tiga hal yang
ditemukan saat mencobanya
**Lokasi kerja:** folder `marketing/`

> Rencana hari ini sederhana: nyalakan fitur riset pasar, daftarkan tiga alat
> barunya, lalu coba langsung di layar. Penyalaannya cepat. Yang memakan hampir
> seluruh hari adalah tiga hal yang baru kelihatan justru karena fiturnya
> dipakai.

> **Benang merah hari ini: tiga kesalahan yang semuanya tidak punya gejala.**
> Jawabannya keluar, tabelnya penuh, angkanya rapi — dan tetap salah. Tidak
> satu pun dari ketiganya bisa ditemukan dengan melihat layar; semuanya baru
> terbukti setelah diukur.

---

## Entri 1 — Menyalakan riset pasar, dan satu alat uji yang jadi berbelanja ke internet

**Waktu:** pagi

**Uraian kegiatan**

Dua pekerjaan yang tertunda dari Jumat diselesaikan:

1. Setelan `MARKET_SEARCH_ENABLED` dinyalakan.
2. Tiga alat riset pasar diaktifkan di daftar alat (`cari_tren_pasar`,
   `riset_pesaing`, `analisis_pasar_penjualan`).

Begitu setelannya dinyalakan, **dua pemeriksaan otomatis yang tadinya hijau
jadi merah.** Setelah dilihat sebabnya, yang merah bukan fiturnya — yang merah
cara ujinya ditulis.

Berkas uji itu di kepalanya menulis bahwa ia "TIDAK menyentuh internet". Isinya
ternyata bergantung pada setelan di `.env.local`: selama setelannya mati,
ujinya memang tidak ke internet. Begitu dinyalakan, **setiap kali uji itu
dijalankan ia benar-benar memanggil layanan pencarian di luar** — memakai kuota
yang dibayar, untuk pemeriksaan yang seharusnya gratis dan tidak bergantung
jaringan.

**Perbaikan**

Setelan itu sekarang **dimatikan paksa di dalam berkas ujinya sendiri**, bukan
dibaca dari setelan portal. Ditambah catatan larangan supaya tidak dibuat
bergantung setelan lagi.

**Temuan penting**

Janji yang ditulis di komentar ("tidak menyentuh internet") tidak dijaga oleh
apa pun. Ia benar waktu ditulis, dan berhenti benar tanpa ada yang mengubah
berkas itu — yang berubah ada di tempat lain.

---

## Entri 2 — Label "tidak mengambil data dari database" di bawah jawaban yang jelas dari database

**Waktu:** siang

**Uraian kegiatan**

Saat mencoba di layar, jawaban ramalan keluar dengan angka penjualan nyata dari
database perusahaan — tapi di bawahnya tertulis **"tidak mengambil data dari
database"**.

Penyebabnya: alat-alat yang ditulis tangan (ramalan dan tiga alat pasar)
melaporkan sumber datanya sebagai "tidak ada", dipatok begitu di kode. Itu
benar untuk pencarian SOP, tapi salah untuk empat alat yang lain.

**Ini pengulangan keempat dari pola yang sama.** Tiga sebelumnya sudah tercatat
di berkas tampilan percakapan. Tiap kali ada alat baru yang membawa data,
labelnya tidak ikut diberi tahu.

**Perbaikan — tiga lapis, bukan satu**

| Lapis | Apa yang dijaga |
|---|---|
| Daftar sumber per alat | labelnya sekarang benar |
| Tipe datanya dikunci | alat baru yang lupa didaftarkan membuat **pemeriksaan tipe gagal**, bukan diam-diam salah label |
| Pemeriksaan baru (`test:label-sumber`) | menyadap query yang sungguhan, mencatat tabel apa yang **benar-benar** dibaca, lalu membandingkan dengan yang diklaim |

Lapis ketiga perlu karena dua lapis pertama tidak bisa menilai **isinya** benar
atau tidak: nama tabel salah ketik, atau alat yang berhenti membaca tabel tapi
klaimnya tertinggal, keduanya lolos pemeriksaan tipe.

**Terbukti langsung pada pembuatnya sendiri**

Pemeriksaan baru itu, pada jalan pertamanya, **menangkap kesalahan saya sendiri
yang baru dibuat beberapa menit sebelumnya**: saya mendaftarkan `riset_pesaing`
sebagai pembaca tabel penjualan. Alat itu tidak membaca tabel apa pun — yang
diterimanya kategori produk berupa teks bebas, langsung ke internet. Klaim itu
sudah diperbaiki jadi "tidak ada".

---

## Entri 3 — 34% nama produk tidak bisa ditemukan dengan mengetik namanya

**Waktu:** sore

**Uraian kegiatan**

Saat memeriksa hasil ramalan, ketahuan bahwa jawaban di layar **membahas produk
yang berbeda dari yang ditanyakan.**

Yang ditanya `MINYAK CEMCEMAN 175 ML RJ`. Yang dijawab `MINYAK CEMCEMAN 175 ML
RJ NF` — varian lain, riwayatnya 28 bulan, bukan 86 bulan.

Sebabnya: di database nama itu ditulis dengan **spasi ganda**
(`"MINYAK CEMCEMAN    175 ML RJ"`). Pencariannya mencocokkan huruf per huruf,
jadi mengetik namanya secara normal tidak menemukannya — yang ketemu varian
yang spasinya tunggal.

**Seberapa luas**

| | |
|---|---|
| Nama produk memuat spasi ganda | **589 dari 1737 (34%)** |
| Termasuk | hampir seluruh produk terlaris |

```
"RAMUAN P.RAMBUT   175 ML RJ"     86 bln   430.494 unit
"MINYAK CEMCEMAN    175 ML RJ"    86 bln   347.383 unit
"SHAMPO BAYAM  175 ML RJ"         86 bln   252.074 unit
```

**Temuan penting**

Yang membuat ini berbahaya: **tidak ada gejala sama sekali.** Pencariannya
berhasil, tabelnya penuh, namanya mirip, angkanya masuk akal. Tidak ada cara
pemakai mengetahui ia sedang melihat ramalan produk lain.

**Perbaikan**

Spasi sekarang dirapikan di kedua sisi sebelum dicocokkan. Akibatnya ketiga
varian muncul bersamaan dan asisten **balik bertanya** produk mana yang
dimaksud, alih-alih memilih sendiri.

**Catatan koreksi:** contoh pertanyaan yang saya berikan sebelum perbaikan ini
mengandung kesalahan yang sama — angka yang saya sebut milik produk 86 bulan,
sementara yang akan dijawab portal waktu itu produk 28 bulan.

---

## Entri 4 — Nilai rupiah sekarang mengikuti ramalan unit

**Waktu:** sore

**Uraian kegiatan**

Di layar terlihat ganjil: ramalan **unit** bergerak tiap bulan (2.158 / 2.214 /
2.105), tapi ramalan **rupiah** sama persis tiga bulan berturut-turut
(Rp 149.951.090). Dua sisi dari satu produk, berjalan seolah tidak saling
mengenal.

Sebabnya memang begitu rancangannya: sisi unit dan sisi rupiah masing-masing
diramal sendiri, lalu masing-masing dipilih modelnya sendiri.

**Cara yang dipilih**

Cara "unit × harga per unit" **tidak dipaksa menang.** Ia dimasukkan sebagai
**calon tambahan** yang diuji dengan ujian yang sama seperti model lain, dan
hanya dipakai kalau terbukti lebih tepat. Alasannya: memaksanya menang berarti
menukar angka yang terukur dengan angka yang kelihatan lebih rapi.

**Harganya ditebak dari mana — diukur, bukan dikira**

| Cara menebak harga | Rata-rata meleset |
|---|---|
| **Harga bulan terakhir** | **1,9%** |
| Rata-rata 12 bulan terakhir | 6,0% |

Diukur pada lima produk terbesar. Sebabnya harga naik pelan dan teratur, jadi
rata-rata selalu tertinggal di belakang.

**Hasil pada produk yang jadi contoh**

| | Sebelum | Sesudah |
|---|---|---|
| Des 2026 | Rp 149.951.090 | **Rp 181.384.006** |
| Jan 2027 | Rp 149.951.090 | **Rp 186.068.049** |
| Feb 2027 | Rp 149.951.090 | **Rp 176.967.622** |
| Tingkat kesalahan | 31,8% | **28,1%** |

Pada tiga produk lain yang dicoba, hasilnya **seri** dengan cara lama, jadi
tidak ada yang berubah di sana. Itu memang seharusnya: kalau sisi unit memakai
model "sama dengan bulan terakhir", maka "unit terakhir × harga terakhir" sama
persis dengan rupiah bulan terakhir.

**Satu kalimat peringatan yang jadi berbohong**

Perubahan ini membuat kalimat lama di jawaban keliru: *"Ramalan rupiah tetap
dari model kita"* — padahal rupiahnya justru diturunkan dari ramalan unit milik
alat tim sebelah. Kalimat itu sudah dipisah supaya hanya diucapkan setelah sisi
rupiah benar-benar selesai dipilih.

**Temuan penting tentang cara saya bekerja**

Setelah perubahan ini selesai, seluruh pemeriksaan dijalankan: **408 lolos** —
angka yang **sama persis** dengan sebelum perubahan. Artinya kode baru itu
belum diuji sama sekali. Pemeriksaannya lalu ditambahkan (21 pemeriksaan baru),
dan yang paling penting di antaranya menjaga agar calon baru itu **tidak
mengintip** harga bulan yang sedang diujikan kepadanya — kalau mengintip, ia
akan terlihat lebih tepat daripada kenyataannya lalu menang dengan angka yang
tidak pernah benar.

---

## Entri 5 — Daftar produk sekarang bisa dipilih langsung, tanpa diketik ulang

**Waktu:** menjelang sore

**Uraian kegiatan**

Akibat perbaikan Entri 3, asisten sekarang sering menawarkan beberapa varian
dan bertanya "yang mana?". Satu-satunya cara menjawabnya adalah **mengetik
ulang** nama panjang yang baru saja ditampilkan di layar yang sama — misalnya
`MINYAK CEMCEMAN  175 ML RJ+M.ZAITUN 12ML`. Satu huruf salah berarti
pertanyaannya terulang.

Daftar itu sekarang muncul sebagai **tombol**. Tekan satu, pertanyaannya
langsung terkirim. Tiap tombol menyebutkan tiga hal:

```
MINYAK CEMCEMAN 175 ML RJ
1005998 · riwayat 86 bulan · sampai 2026-07
```

Panjang riwayat ikut disebut karena itu yang paling menentukan pilihan: varian
86 bulan dan varian 28 bulan namanya hampir sama, tapi ramalan dari 28 bulan
jauh lebih lemah — dan tanpa angka itu tidak ada cara pemakai mengetahuinya.

**Yang hampir terlewat, dan akan merusak seluruh fitur ini**

Tombol itu **tidak akan pernah menyelesaikan pertanyaannya** kalau hanya
ditempel di layar. Nama `MINYAK CEMCEMAN 175 ML RJ` masih cocok sebagian ke
`... RJ NF`, jadi menekan tombol memulangkan daftar yang sama — berulang terus,
tanpa gejala selain orang yang menekan berkali-kali.

Jadi pencariannya diubah: **nama yang persis sama menutup pertanyaan.** Nama
penuh berarti pemakai sudah memilih; menanyakannya lagi hanya karena nama itu
kebetulan awalan nama lain adalah pertanyaan yang tidak punya jawaban baru.

**Pemeriksaannya menguji sifatnya, bukan satu contoh**

Bukan "coba satu nama lalu lihat hasilnya", tapi: **setiap** varian yang
ditawarkan, kalau dikirim kembali, harus menyelesaikan pertanyaannya.

```
"MINYAK CEMCEMAN" -> 8 varian ditawarkan
8 dari 8 varian, waktu ditekan, menyelesaikan pertanyaannya
```

**Catatan teknis yang perlu diingat**

Tombol ini dikirim lewat jalur **metadata**, bukan lewat hasil alat. Sebabnya
sama dengan kejadian 8 Oktober pada tombol simpan tiket: waktu penerus pesan
melimpahkan pekerjaan ke asisten pemasaran, pemanggilan alat asisten bawahan
tidak pernah sampai ke layar — yang lewat hanya pelimpahannya. Kalau dibaca
dari hasil alat, tombolnya tidak akan pernah muncul.

**Satu aturan penerus pesan ikut diubah**

Yang dikirim tombol itu nama produknya saja, persis seperti orang menjawab
"yang mana?". Aturan penerus pesan sebelumnya hanya menyebut jawaban pendek
berupa "ya", "tidak", angka, atau nomor pilihan — nama produk belum termasuk,
jadi ada kemungkinan ia dibaca sebagai permintaan baru, bukan jawaban.

Aturannya ditambah. Perubahan seperti ini **wajib diukur**, karena 27 Oktober
memanjangkan keterangan alat menurunkan hasil dari 12 ke 11 tanpa ada yang
terlihat salah. Diukur hari ini sesudah perubahan: **12 lolos, 0 gagal.**

Hasil itu hanya menunjukkan aturan baru tidak merusak yang lama. Tidak satu pun
dari 12 kasus itu mengirim nama produk sebagai jawaban, jadi **alur tombolnya
sendiri belum teruji** sampai hari ini ditutup.

---

## Entri 6 — Satu pemeriksaan yang merah sekali dari enam kali jalan

**Waktu:** sore

**Uraian kegiatan**

Pemeriksaan label sumber (Entri 2) sekali terlihat merah lalu hijau lagi tanpa
ada kode yang berubah. Keterangannya hanya `(tidak ada query)`.

Dijalankan enam kali berturut-turut untuk mengejarnya. Yang merah satu kali:

```
GAGAL  cari_sop: membaca tabel seperti diharapkan — (tidak ada query)
```

**Sebabnya masih dugaan, belum terlihat langsung.** Pencarian SOP mengubah
pertanyaan jadi vektor **lebih dulu**. Kalau panggilan itu gagal sesaat, kodenya
menangkapnya dan memulangkan pesan "basis pengetahuan tidak bisa dibaca" —
**tanpa query, dan tanpa melempar galat.** Itu cocok dengan gejalanya, tapi
kesimpulan ini diambil dari membaca kode: saat uji itu merah, isi jawabannya
tidak tercatat. Dalam tiga putaran berikutnya kejadiannya tidak muncul lagi.
Uji yang sudah diperbaiki akan mencetak sebab teknisnya kalau terulang.

**Perbaikan pada ujinya**

Keadaan itu sekarang **dibedakan, bukan dimaafkan**: kalau alatnya memulangkan
pesan "tidak bisa dibaca", ujinya mencetak tanda ⚠️ beserta sebab teknisnya,
dan tetap hijau. Tapi alat yang berhenti membaca tabel **tanpa mengatakannya**
tetap merah.

Alasannya: merah yang tidak bisa dijelaskan siapa pun mengajari orang
mengabaikan merah.

---

## Entri 7 — Database perusahaan sempat tidak bisa dihubungi

**Waktu:** siang

**Uraian kegiatan**

Di tengah pengujian, server database perusahaan tidak bisa dihubungi: ping 0
dari 3 berhasil, dan sambungan ke porta database ditolak 3 dari 3 — sementara
internet sendiri normal. Setelah beberapa saat pulih sendiri tanpa ada yang
diubah.

**Temuan penting**

Yang sampai ke pemakai di layar adalah tulisan mentah:

```
Gagal: {"error":"Connection terminated due to connection timeout"}
```

Itu bukan kalimat untuk orang. Pemakai tidak bisa tahu apakah dia salah
bertanya, portalnya rusak, atau servernya sedang mati — padahal ketiganya
butuh tindakan yang berbeda. **Belum diperbaiki**, dicatat sebagai pekerjaan
berikutnya.

---

## Ringkasan hari ini

| Yang dikerjakan | Keadaan |
|---|---|
| Fitur riset pasar dinyalakan | **selesai** |
| Tiga alat riset pasar diaktifkan | **selesai** |
| Label sumber data di bawah jawaban | **diperbaiki** + penjaga 3 lapis |
| 34% nama produk tidak bisa dicari | **diperbaiki** |
| Nilai rupiah mengikuti ramalan unit | **selesai**, menang 28,1% lawan 31,8% |
| Daftar produk bisa dipilih langsung (tombol) | **selesai** |
| Aturan penerus pesan untuk jawaban berupa nama produk | **selesai**, tidak merusak uji lama (12 lolos), alurnya sendiri belum teruji |
| Uji yang merah sekali dari enam | **sebabnya diduga**, ujinya diperbaiki supaya mencetak sebabnya |
| Pesan galat mentah ke pemakai | **belum** |
| Dicoba langsung di layar oleh pemakai | **belum** |

**Pemeriksaan otomatis:** **450 lolos, 0 gagal** (dari 408 sebelum uji rupiah ditambahkan).
Pemeriksaan lewat model bahasa: **12 lolos, 0 gagal**. Pemeriksaan tipe bersih.

| Berkas uji | Hasil |
|---|---|
| ramalan-deret | 31 |
| ramalan-model | 54 |
| ramalan-pilih | 74 |
| ramalan-jarang | 91 |
| ramalan-tool | 38 |
| pasar-kueri | 44 |
| pasar-saring | 41 |
| pasar-tool | 29 |
| label-sumber | 48 |

**Catatan untuk hari kerja berikutnya:**

1. **Coba langsung di layar** — ini yang belum dilakukan sama sekali hari ini,
   padahal jadi tujuan awalnya. Tekan tombol pilihan produk, dan pastikan
   jawaban yang keluar memang tentang produk yang ditekan.
2. Perbaiki pesan galat yang sampai ke pemakai waktu database tidak bisa
   dihubungi (Entri 7).
3. Tombol pilihan **hanya muncul di percakapan yang sedang berjalan.** Kalau
   percakapan lama dibuka kembali, daftarnya tetap ada sebagai tulisan tapi
   tombolnya tidak — karena yang tersimpan di database hanya teks jawaban.
   Perlu diputuskan apakah itu cukup.
4. Berkas-berkas uji sekali pakai yang dibuat hari ini (berawalan `_`) belum
   dibersihkan.
5. **Masih perlu dibicarakan dengan tim sebelah** (belum tersampaikan): data
   pembanding mereka baru 9 bulan; kalau diperpanjang jadi 12 bulan,
   kestabilan pemilihan model naik dari 67% ke 88%.
