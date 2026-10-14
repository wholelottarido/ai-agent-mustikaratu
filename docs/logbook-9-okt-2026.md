# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Jumat, 9 Oktober 2026
**Proyek:** Alat AI yang dibuat sendiri dari layar, tanpa menulis kode
**Lokasi kerja:** folder `marketing/`

> Kemarin alat tulis masih harus ditulis programmer satu per satu. Hari ini
> pembimbing **membuat alatnya sendiri dari layar pengaturan**, lalu
> memakainya di percakapan — tanpa satu baris kode baru.

> **Benang merah hari ini: yang tertulis tidak sama dengan yang berlaku.**
> Hampir semua kekeliruan hari ini bukan logika yang salah, melainkan label,
> penjaga, dan pemeriksaan yang menyatakan sesuatu yang berbeda dari
> kenyataannya — dan karena semuanya terlihat normal, tidak ada yang
> menandainya.

---

## Entri 1 — Melepas alat tim lain, tanpa menghapus apa pun

**Waktu:** pagi

**Uraian kegiatan**

Pembimbing meminta alat pengubah dan pembatal tiket dihapus supaya ia bisa
membuat versinya sendiri. Penelusuran menemukan bahwa keempat alat tiket itu
**milik tim lain** dan tersambung ke asisten lewat tabel milik mereka juga.
Menghapusnya berarti mengubah sistem AI mereka yang sedang dipakai orang.

Jadi yang dibuat bukan "hapus", melainkan **lepas**: portal kita berhenti
memasangnya, dan keputusan itu dicatat di database kita sendiri. Baris mereka
tetap utuh, sistem mereka tidak terpengaruh sama sekali, dan alatnya bisa
dipasang kembali kapan saja.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Alat tiket yang dicek kepemilikannya | 4, semuanya milik tim lain |
| Baris milik tim lain yang diubah/dihapus | **0** |
| Tombol baru di layar | Lepas, dan Pasang lagi |

**Temuan penting**

Kata "lepas" mudah terbaca sebagai "hapus", dan administrator yang mengira ia
menghapus data tim lain akan ragu memakainya — atau lebih buruk, memakainya
dengan keyakinan yang salah. Jadi keterangannya ditulis di layar: melepas
tidak menghapus apa pun, yang berubah cuma apa yang dipasang portal ini.

---

## Entri 2 — Borang pembuatan alat mati total, dan tidak ada yang tahu

**Waktu:** pagi

**Uraian kegiatan**

Saat pembimbing mencoba membuat alat, borangnya menolak dengan pesan tentang
kolom izin. Ternyata kolom itu masih terdaftar sebagai "tidak boleh diatur
dari sini" — sisa dari sebelum layar diberi hak menyetelnya sehari sebelumnya.

Dan karena borang **selalu mengirim** kolom itu walau kosong, **setiap**
pembuatan alat gagal, bukan hanya yang mengisi izin.

**Kendala**

Kerusakan ini lolos sejak kemarin karena pengujiannya memanggil fungsi
pembuatan alat secara langsung, bukan lewat alamat web yang dipakai borang.
Sesudah diperbaiki, pengujiannya diulang lewat jalur yang sama dengan borang:

| Yang dicoba | Hasil |
|---|---|
| izin kosong (seperti borang) | diterima |
| izin diisi benar | diterima |
| izin karangan | ditolak, menyebut sebabnya |
| operasi tulis lewat jalur baca | ditolak |

---

## Entri 3 — "Cuma 6 baris?" — dan AI yang menyimpulkan sendiri

**Waktu:** siang

**Uraian kegiatan**

Pembimbing membuat alat "Aset departemen" sendiri dari layar, lalu bertanya
apakah departemennya memang hanya punya 6 aset. Jawabannya tidak: **ada 22
baris, 16 di antaranya tidak pernah sampai ke AI** karena batas baris yang
diisi di borang adalah 6.

Yang lebih penting: jawaban AI berbunyi *"6 baris data ini ... belum ada data
tambahan yang bisa ditarik lebih lanjut"*. Hasil alatnya menandai dengan benar
bahwa datanya terpotong — lalu AI membatalkannya sendiri di kalimat
berikutnya, dan pembacanya menyimpulkan departemen itu memang punya 6 aset.

Sebabnya: alat memberi tahu **bahwa** ada lagi, tapi tidak **berapa**. Tanpa
angka pembanding, AI mengisi kekosongan itu dengan kesimpulan.

**Hasil terukur**

Sekarang tiap hasil membawa dua angka — yang terbaca dan yang sebenarnya:

| Pertanyaan | Jawaban AI | Di database |
|---|---|---|
| "Ada berapa tiket helpdesk seluruh perusahaan?" | **10.091** | 10.091 |
| "Tiket berstatus RESOLVED ada berapa?" | **9.043** | 9.043 |

Sebelum ini keduanya akan dijawab "20" — jumlah baris yang kebetulan terbaca.

**Temuan penting**

Jumlah sebenarnya **ikut penyaring**, bukan menghitung seluruh tabel. Hitungan
seluruh tabel akan menjawab "10.091" untuk pertanyaan tentang satu status saja
— angka yang benar untuk pertanyaan yang salah, dan itu lebih berbahaya
daripada tidak punya angka sama sekali.

Perhitungan tambahan hanya dijalankan kalau datanya memang terpotong. Kalau
tidak, yang terbaca sudah totalnya, dan perhitungan kedua cuma beban.

---

## Entri 4 — Jawaban menyebutkan alat yang dipakainya

**Waktu:** siang

**Uraian kegiatan**

Atas permintaan pembimbing, baris keterangan di bawah tiap jawaban kini
menyebut **alat apa yang dipakai**, bukan cuma tabel sumbernya.

Keduanya perlu dan tidak bisa saling diturunkan: nama tabel menjawab "datanya
dari mana", nama alat menjawab "yang mengambilnya apa". Dua alat berbeda bisa
membaca tabel yang sama dengan cakupan berbeda — satu hanya data penanya, satu
seluruh perusahaan — dan menyebut tabelnya saja membuat keduanya tak
terbedakan.

**Hasil terukur**

| Pertanyaan | Alat | Sumber |
|---|---|---|
| tiket saya yang belum selesai | `asisten_tiket` | `v_ai_mg_tiket` |
| SOP apa saja yang ada | `daftar_sop` | *(tidak ada)* |
| halo, apa kabar | *(tidak ada)* | *(tidak ada)* |

**Temuan penting**

Baris kedua memperbaiki hal yang selama ini salah tanpa disadari: pencarian
SOP dulu berlabel **"tidak mengambil data dari database"**, karena ia memang
tidak membaca tabel mana pun — ia mencari lewat kedekatan makna. Jawabannya
jadi terbaca seperti karangan padahal ada sumbernya.

---

## Entri 5 — Unggah PDF diperiksa, dan satu uji ternyata sudah lama mati

**Waktu:** siang

**Uraian kegiatan**

Ditanyakan apakah unggah PDF sudah benar. Diperiksa dari ujung ke ujung, dan
jawabannya ya: satu laporan 201 potongan, semuanya sudah punya vektor,
ditemukan kembali saat dicari, dan penyaring aksesnya bekerja — dokumen
bertanda departemen marketing tidak terbaca akun IT.

**Tapi pemeriksaannya menemukan hal lain.** Perintah uji basis pengetahuan
(`npm run test:kb`) **sudah lama mati** — ia menunjuk tabel korpus lama yang
dihapus pihak lain berbulan-bulan sebelumnya. Penggantinya sudah ada dan
berjalan baik; yang rusak itu versi lamanya yang tidak pernah dibuang.

**Kendala**

Kerusakan itu lolos karena perintah tersebut tidak ikut daftar uji yang
dijalankan tiap hari. Selama berbulan-bulan laporan "semua hijau" tidak
mencakupnya.

Sekarang skrip usang itu berhenti dengan keterangan dan menunjuk penggantinya,
bukan menabrak galat database yang terbaca seperti sistem rusak.

---

## Entri 6 — Tiap pintu masuk harus berpenjaga

**Waktu:** sore

**Uraian kegiatan**

Logbook kemarin mencatat bahwa penjagaan sesi di 23 alamat web bersih, **tapi
bersandar pada seseorang yang ingat memeriksanya**. Hari ini kedisiplinan itu
diubah jadi pemeriksaan otomatis.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Pintu masuk | 23 |
| Berpenjaga | 22 |
| Sengaja terbuka | 1 — pendaftaran akun baru |

Uji ini **dibuktikan bisa gagal**, bukan hanya lolos: satu pintu tanpa penjaga
dibuat sementara, ujinya langsung menandainya, lalu pintu itu dihapus lagi.
Uji yang tidak pernah bisa gagal tidak menjaga apa pun.

---

## Entri 7 — Alat tulis dibuat sendiri dari layar

**Waktu:** sore

**Uraian kegiatan**

Ini yang diminta pembimbing sejak kemarin. Borang pembuatan alat kini punya
pilihan operasi di paling atas — Baca, Ubah, atau Batalkan — dan sisa
borangnya berganti mengikuti pilihan itu. Dua borang terpisah sebelumnya
memaksa administrator tahu lebih dulu jenis apa yang ia butuhkan sebelum
menemukan tombol yang benar.

Pembimbing membuat alat pengubah tiketnya sendiri, dan alat itu bekerja penuh
di percakapan.

**Satu jaminan sengaja dilepas.** Sampai kemarin, alat buatan layar **selalu**
hanya bisa membaca — dijamin database. Jaminan itu kini dilepas agar
administrator bisa membuat alat tulis tanpa menunggu programmer.

Yang **tidak** dilepas, dan itu yang membuatnya tidak jadi lubang: alat buatan
layar tetap tidak bisa menunjuk program apa pun untuk dijalankan. Dan empat
penjagaan lain diperiksa ulang **tiap kali alat dipakai**, bukan hanya saat
dibuat: tabel sasaran hanya dari daftar yang diizinkan, kolom hanya yang boleh
ditulis database, penyaring "hanya milik penanya" selalu ikut, dan kunci
penunjuk baris wajib ada.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Pembuatan alat tulis dari layar | **26/26 lolos** |
| Konfigurasi berbahaya saat dibuat | ditolak, 10 bentuk |
| Alat buatan pembimbing, dipakai di percakapan | **berhasil** |

**Temuan penting**

Satu pemeriksaan ternyata tidak menguji apa pun: penjagaan "kolom kunci tidak
boleh ikut diubah" selalu disalip penolakan lain yang datang lebih dulu, jadi
penjagaan yang dimaksud tidak pernah tercapai. Diperbaiki supaya penolakannya
benar-benar datang dari sana.

**Kendala**

Operasi **Tambah** belum bisa dibuat dari layar, dan itu bukan kelalaian:
membuat baris baru sering perlu nilai yang harus dibangkitkan lebih dulu —
nomor tiket, misalnya — dan borang tidak bisa menyatakan aturan pembangkitnya.
Keterangan itu ditulis di layar supaya tidak terbaca sebagai sesuatu yang
terlupa.

---

## Entri 8 — Label yang berbohong tentang 13 alat sekaligus

**Waktu:** sore

**Uraian kegiatan**

Alat buatan pembimbing menyusun rancangan dengan benar, kartunya muncul, lalu
tombol Simpan ditolak: *"Tool sedang tidak aktif."*

Penelusurannya menemukan salah paham yang jauh lebih luas. Tanda "aktif" pada
baris **milik kita** tidak berarti nyala atau mati — artinya *"sistem AI tim
lain tidak mengambilnya"*. Itu cara kita menahan alat kita dari sistem mereka.

**Ketiga belas alat kita bertanda tidak aktif**, termasuk yang dipakai setiap
hari, dan pembaca konfigurasi memang sengaja mengabaikannya untuk alat milik
sendiri.

Akibatnya dua hal yang berbeda sama-sama salah:

1. Alamat penyimpanan yang baru dibuat memakai arti yang keliru dan menolak
   penyimpanan yang sah.
2. **Layar pengaturan menampilkan "belum dinyalakan" untuk ketiga belas alat
   yang semuanya berjalan** — itu yang membuat pembimbing mencari saklar yang
   tidak pernah mematikan apa pun.

**Hasil terukur**

| Sebelum | Sesudah |
|---|---|
| "belum dinyalakan" untuk semua alat kita | "tidak dibagikan ke sistem tim lain" |
| penyimpanan ditolak dengan alasan keliru | diperiksa apakah alat benar-benar terpasang |

Diuji dengan alat buatan pembimbing lewat alamat sungguhan: tersimpan, dan
isinya benar-benar berubah di database.

---

## Entri 9 — Tiga pemeriksaan yang menghukum perubahan yang benar

**Waktu:** sore

**Uraian kegiatan**

Setelah alat baru dibuat dan alat tim lain dilepas, tiga pemeriksaan otomatis
berubah merah — padahal tidak ada yang rusak. Ketiganya menanam keadaan saat
ditulis:

1. menuntut **tepat tiga** alat tulis, sehingga menambah alat sendiri — justru
   tujuan fitur itu — membuatnya merah;
2. membandingkan dengan kode baris, padahal alat tulis dipegang AI dengan nama
   yang berbeda;
3. menuntut alat tim lain tetap terpasang, padahal melepasnya adalah keputusan
   yang memang disediakan fiturnya.

Ketiganya diperbaiki supaya membandingkan dengan **sumber yang sama dengan
yang dipakai sistem** — daftar alat di database, penentu nama alat, dan daftar
pelepasan — bukan dengan angka atau nama yang ditulis tangan di ujinya.

**Temuan penting**

Yang ketiga memperkenalkan pembedaan yang sebelumnya tidak ada: **"hilang
diam-diam" berbeda dari "dilepas sengaja"**. Yang dilepas dikecualikan dengan
nama dan tercetak di hasil uji, bukan dengan melonggarkan syaratnya — jadi
alat yang hilang tanpa keputusan tetap akan merah.

---

## Ringkasan Hari Ini

| Item | Jumlah |
|---|---|
| Pemeriksaan otomatis yang dijalankan | **413** |
| Kemarin | 353 |
| Kegagalan tersisa | **0** |
| Berkas tersentuh | 28 |
| Perintah uji baru | 2 (penjagaan pintu masuk, pembuatan alat tulis) |

**Benang merah: yang tertulis tidak sama dengan yang berlaku.**

1. Tanda **"aktif"** berarti "dibagikan ke sistem tim lain", bukan nyala/mati —
   dan layar menampilkannya sebagai "belum dinyalakan" untuk 13 alat yang
   semuanya berjalan.
2. **Perintah uji basis pengetahuan** mengaku sebagai uji, padahal sudah mati
   berbulan-bulan dan tidak pernah ikut dijalankan.
3. **Kolom izin** masih terdaftar terlarang sehari setelah diizinkan, dan itu
   mematikan seluruh pembuatan alat — bukan hanya yang memakai izin.
4. **Pemilih izin** mengaku punya daftar saran; penunjuknya salah, jadi
   sarannya tidak pernah muncul sama sekali.
5. **Tiga pemeriksaan otomatis** mengaku menjaga, padahal menghukum perubahan
   yang justru benar.
6. **Hasil alat** menandai datanya terpotong dengan benar, lalu AI menyimpulkan
   sebaliknya karena tidak diberi tahu terpotong dari berapa.

Tidak satu pun dari enam hal itu menghasilkan galat. Semuanya terlihat normal
sampai seseorang membandingkannya dengan kenyataan.

**Yang masih tertunda**

- Laporan untuk tim pemilik: tiga kekeliruan data, permintaan peran sempit
  sebagai ganti peran raksasa yang dipakai akun uji, dan satu baris uji yang
  masih ada di antrean tiket mereka.
- Operasi **Tambah** dari layar — terhalang aturan pembangkit nomor.
- Pembuatan tiket masih memakai program khusus, belum lewat penjalan umum.
- Model per asisten: belum bisa dibedakan, semua memakai model yang sama.

**Rencana berikutnya:** laporan untuk tim pemilik aplikasi, karena tiga hal di
daftar tertunda menunggu jawaban mereka.
