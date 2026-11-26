# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Selasa, 13 Oktober 2026
**Proyek:** Alat AI yang dibuat sendiri dari layar, tanpa menulis kode
**Lokasi kerja:** folder `marketing/`

> Hari ini untuk pertama kalinya asisten **mengubah data sungguhan di sistem
> helpdesk perusahaan** atas perintah seorang karyawan — lewat rancangan yang
> diperiksa manusia dan tombol yang ditekan manusia. Satu tiket, dua kolom,
> tidak ada yang lain tersentuh.

> **Benang merah hari ini: yang berubah di luar kendali kita.**
> Katalog alat milik tim sebelah dibangun ulang dalam semalam — 263 dari 280
> barisnya lahir hari ini. Hampir semua pekerjaan hari ini adalah akibatnya:
> kemampuan yang muncul tanpa diminta, pemeriksaan yang merah tanpa ada yang
> rusak, dan borang yang menawarkan pilihan yang mustahil. Tidak satu pun
> karena ada yang salah di pihak kita.

---

## Entri 1 — Pertanyaan yang tidak pernah bisa dijawab, dan sebabnya bukan AI

**Waktu:** pagi

**Uraian kegiatan**

Pembimbing menanyakan klaim MAPS yang jatuh tempo bulan ini. Asisten selalu
menjawab salah, dan dugaan pertama adalah urutannya yang keliru. Penelusuran
membuktikan dugaan itu salah — **tidak ada urutan yang bisa memperbaikinya**:

| Urutan yang dicoba | Yang muncul di 20 baris teratas |
|---|---|
| Terbaru dibuat | nol baris berjatuh tempo |
| Jatuh tempo paling awal | baris tahun 1970 |
| Jatuh tempo paling akhir | baris kosong semua |

Dari 29.199 klaim, cuma 82 yang jatuh tempo bulan ini. Asisten membaca 20
baris teratas; peluang baris yang dicari ada di situ praktis nol.

Yang kurang bukan urutan, melainkan **penyaring** — dan penyaring belum bisa
diatur dari layar sama sekali. Jadi yang dibuat hari ini: penyunting penyaring
di layar pengaturan, yang menawarkan pembanding sesuai jenis kolomnya.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Klaim seluruhnya | 29.199 |
| Jatuh tempo bulan ini | 82 |
| Jawaban sesudah penyaring dipasang | "ada 34 klaim" |
| Hitungan langsung ke database | 34 — cocok |

**Temuan penting**

Penyaring menentukan **pertanyaan apa yang bisa dijawab**, bukan sekadar
mempercepat. Tanpa penyaring, asisten cuma bisa mengambil N baris teratas, dan
baris yang dicari hampir selalu ada di luar jendela itu. Kegagalannya tidak
menghasilkan galat apa pun — jawabannya terlihat wajar, cuma salah.

Pembanding `dari`/`sampai` sengaja **hanya ditawarkan untuk kolom tanggal**.
Dipasang di kolom teks, ia gagal saat dipanggil, bukan saat disimpan — artinya
administrator baru tahu berhari-hari kemudian, lewat keluhan orang lain.

---

## Entri 2 — Dua penyaring di satu kolom menjadi satu

**Waktu:** pagi

**Uraian kegiatan**

Begitu kolom "jatuh tempo" diberi batas awal **dan** batas akhir, keduanya
bertabrakan. Nama parameternya diturunkan dari nama kolom saja, jadi dua
penyaring di kolom yang sama menghasilkan **satu** parameter — dan nilai yang
sama dipasang ke `>=` sekaligus `<=`.

Akibatnya rentang tanggal apa pun tidak pernah menyaring. Tidak ada galat,
tidak ada peringatan; jawabannya cuma salah dengan tenang.

**Hasil terukur**

| Keadaan | Nama parameter |
|---|---|
| Satu penyaring di sebuah kolom | `jatuh_tempo` (tetap pendek) |
| Dua penyaring di kolom yang sama | `jatuh_tempo_dari`, `jatuh_tempo_sampai` |

**Temuan penting**

Pemeriksaan otomatis untuk ini sengaja tidak berhenti pada nama parameternya.
Nama bisa benar sementara nilainya tetap dipasang ke dua sisi yang sama, dan
gejalanya persis sama: tidak ada galat. Jadi yang diperiksa **hasilnya** —
rentang sempit harus mengembalikan baris lebih sedikit daripada tanpa rentang.

---

## Entri 3 — Katalog tetangga dibangun ulang dalam semalam

**Waktu:** siang

**Uraian kegiatan**

Seluruh pemeriksaan otomatis dijalankan, dan tujuh berubah merah sekaligus.
Tidak satu pun karena perubahan pagi tadi. Penelusuran ke database menemukan
sebabnya di luar proyek ini:

| Keadaan tabel alat bersama | Angka |
|---|---|
| Baris seluruhnya | 280 |
| **Dibuat 13 Oktober** | **263** |
| Alat lama berawalan `sim_` yang tersisa | **0** |
| Alat yang dipegang asisten Portal | 21 (sebelumnya 9) |

Tim sebelah mengganti hampir seluruh katalognya. Tujuh pemeriksaan kita
menyebut nama alat mereka yang sekarang sudah tidak ada.

**Temuan penting**

Tabel setelan ini **dibagi dua tim**, dan satu-satunya hal yang kita punya
atasnya adalah hak membaca. Isinya bisa berubah kapan saja tanpa
pemberitahuan, dan hari ini terbukti bisa berubah seluruhnya dalam satu hari.
Semua yang menyusul hari ini adalah akibat langsung dari fakta itu.

---

## Entri 4 — Kemampuan mengubah data yang datang tanpa ada yang memutuskan

**Waktu:** siang

**Uraian kegiatan**

Pemeriksaan katalog baru menemukan sesuatu yang lebih serius daripada
pemeriksaan merah. Penjalan alat tulis yang dibuat minggu lalu merakit alat
**dari baris setelan, tanpa program khusus** — itu memang tujuannya, supaya
tim IT bisa menambah alat sendiri. Tapi baris setelan juga diisi tim sebelah.

Akibatnya dua alat pengubah tiket milik mereka **sudah hidup di portal kita**,
dan tidak seorang pun pernah meninjaunya:

| Alat | Yang dilakukannya |
|---|---|
| `tutup_tiket` | menandai tiket selesai |
| `batalkan_tiket` | membatalkan tiket |

Yang kedua adalah alat yang **empat hari sebelumnya dihapus dari portal ini
atas permintaan pembimbing**. Ia kembali bukan karena ada yang memutuskan,
melainkan karena katalog sebelah berubah.

Setelah ditimbang bersama pembimbing, dibuat **gerbang persetujuan**: alat
tulis milik tim lain tidak dirakit sampai tim IT portal ini menyetujuinya dari
layar, satu per satu.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Alat tulis tim lain yang tadinya hidup tanpa ditinjau | 2 |
| Alat tulis tim lain yang menunggu persetujuan sekarang | 5 |
| Alat yang disetujui saat gerbang dipasang | **0** |
| Baris milik tim lain yang diubah/dihapus | **0** |

**Temuan penting**

Penjagaan teknisnya sebenarnya **tidak bocor sama sekali**: daftar tabel yang
boleh ditulis menolak tabel lain, hak per-kolom di database tetap membatasi
kolomnya, penyaring "hanya milik penanya" tetap ikut, dan penyimpanannya tetap
butuh tombol yang ditekan manusia. Yang hilang satu hal saja — **keputusan**.

Persetujuannya sengaja menyimpan **operasi dan tabelnya**, bukan cuma nama
alatnya. Baris tetangga bisa berubah tanpa kita tahu; persetujuan yang cuma
menyimpan nama akan tetap berlaku untuk alat yang isinya sudah lain.

---

## Entri 5 — Pemeriksaan yang menanam inventaris tetangga

**Waktu:** siang

**Uraian kegiatan**

Tujuh pemeriksaan merah itu ditulis ulang. Yang lama menyebut nama: "alat A
digantikan alat B", "alat C tidak ikut terbuang". Semuanya benar saat ditulis,
dan semuanya menghukum tetangga karena mengganti inventarisnya sendiri.

Yang baru memeriksa **sifat aturannya**, dalam satu kalimat: alat tetangga
hilang dari sebuah asisten **hanya kalau alat kita membaca tabel yang sama**.

**Hasil terukur**

| | Sebelum | Sesudah |
|---|---|---|
| Pemeriksaan yang menyebut nama alat tetangga | 13 | **0** |
| Asisten yang diperiksa | 1 | semuanya |
| Kegagalan | 7 | 0 |

**Temuan penting**

Pemeriksaan baru ini langsung menemukan **sebab ketiga** sebuah alat bisa
hilang, yang pemeriksaan lama tidak pernah melirik: dibuang pemeriksa karena
setelannya tidak masuk akal. Saat ini ada **12 alat tetangga** dalam keadaan
itu — semuanya mengaku "hanya menampilkan data saya sendiri", padahal sumber
datanya tidak punya kolom pemilik sama sekali.

Di portal kita alat seperti itu dibuang. Di sistem mereka, alat yang mengaku
menyaring pemilik tapi sumbernya tidak bisa menyaring pemilik **tidak bisa
menyaring di mana pun**. Ini perlu disampaikan ke mereka.

---

## Entri 6 — Borang menawarkan pilihan yang mustahil

**Waktu:** sore

**Uraian kegiatan**

Satu pemeriksaan tetap merah sesudah yang lain hijau, dan ternyata ia
menunjuk kerusakan sungguhan di kode kita sendiri.

Borang pembuatan alat tulis memilih sumber data dengan cara "pakai yang
pertama ketemu". Selama tabel tiket cuma punya satu sumber, itu aman. Tim
sebelah menambah sumber kedua hari ini, dan sumber itulah yang kebetulan lebih
dulu — padahal ia **tidak punya kolom pemilik**.

Alat tulis yang lahir darinya akan tersimpan rapi, lolos seluruh pemeriksaan
borang, lalu **ditolak setiap kali dimuat**. Administrator tidak akan tahu
apa-apa sampai ada orang bertanya ke asisten.

**Hasil terukur**

| | Sebelum | Sesudah |
|---|---|---|
| Cara memilih sumber | yang pertama ketemu | milik kita dulu, lalu urut nama |
| Sumber tanpa kolom pemilik | ikut ditawarkan | tidak ditawarkan, alasannya dicatat |

**Temuan penting**

Ini persis kegagalan yang berkas itu ditulis untuk mencegah — tertulis di
komentarnya sendiri sejak awal: "borang yang menawarkan yang penjalannya tolak
akan membuat administrator menyimpan alat yang rapi lalu tidak pernah jalan".
Penjaganya ada, tapi lubangnya lewat pintu yang berbeda: bukan tabel yang
salah, melainkan sumber yang salah untuk tabel yang benar.

---

## Entri 7 — Asisten mengubah data sungguhan, untuk pertama kalinya

**Waktu:** sore

**Uraian kegiatan**

Pembimbing menyetujui `batalkan_tiket` dari layar, lalu seorang karyawan
meminta pembatalan tiket lewat percakapan biasa. Sasarannya dipilih sengaja:
**tiket uji yang 8 Oktober lalu tidak sengaja masuk ke antrean helpdesk
sungguhan** dan sejak itu menggantung sebagai keluhan terbuka.

Urutannya: asisten menyusun rancangan → kartu konfirmasi muncul → pembimbing
memeriksanya → pembimbing menekan Simpan.

**Hasil terukur**

| Yang diperiksa di database sesudahnya | Hasil |
|---|---|
| `status` | `OPEN` → `CANCELLED` |
| `updated_at` | diperbarui |
| Kolom lain (judul, keterangan, prioritas, kategori, pemilik, …) | **tidak tersentuh** |
| Baris lain yang ikut berubah | **0** |

Penolakan yang ikut terbukti sepanjang jalan:

| Yang dicoba | Hasil |
|---|---|
| Sebelum disetujui | asisten tidak memegang alatnya sama sekali |
| Tiket milik orang lain | "bukan milik kamu" |
| Nomor yang tidak ada | "data tidak ada" |
| Membatalkan dua kali | ditolak syarat statusnya |

**Temuan penting**

Sebelum disetujui, asisten menjawab apa adanya bahwa ia tidak bisa
membatalkan tiket — **bukan** mengarang bahwa tiketnya sudah dibatalkan. Itu
perilaku yang paling penting dari seluruh rangkaian ini.

Pembimbing sempat mengira tiketnya akan hilang dari daftar. Ia tidak hilang,
dan memang tidak boleh: nama operasinya di katalog tetangga adalah "hapus",
tapi artinya "menandai dibatalkan". Role database yang dipakai jalur ini
bahkan **tidak punya hak menghapus baris sama sekali** — walau ada kekeliruan
di kode kita, jalur ini tidak bisa menghilangkan satu pun tiket dari tabel
helpdesk. Untuk tiket, itu memang yang diinginkan: tiket yang dibatalkan tetap
jadi riwayat.

---

## Entri 8 — Kartu yang tidak memberi tahu apa yang dibatalkan

**Waktu:** sore

**Uraian kegiatan**

Kartu konfirmasi yang pertama menampilkan nomor tiket, nama tabel, dan
`OPEN → CANCELLED`. Semuanya benar, dan pembimbing langsung menunjuk
kekurangannya: kartu itu menyuruh orang membatalkan sesuatu **tanpa memberi
tahu sesuatu itu apa**. Nomor tiket bukan bahasa manusia, dan satu angka salah
ketik membatalkan keluhan orang lain tanpa ada yang menyadarinya.

Kartunya sekarang menampilkan judul, keterangan, prioritas, dan kapan tiket
itu dibuat — sebelum menanyakan keputusan.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Kolom yang sedang diubah, diulang di keterangan? | tidak |
| Waktu ditampilkan sampai | menit |
| Kolom keterangan ikut tertulis ke database? | **tidak** |
| Sidik rancangan berubah karena keterangan? | **tidak** |

**Temuan penting**

Dua keputusan kecil yang akibatnya besar kalau terbalik:

1. **Keterangan tidak ikut sidik rancangan.** Sidik ada untuk menangkap baris
   yang berubah di tengah. Kalau judul tiket ikut disidik, satu suntingan tak
   berbahaya dari orang lain sedetik sebelum Simpan akan menolak pembatalan
   yang sah — dan gejalanya cuma "coba lagi" tanpa sebab yang kelihatan.
2. **Kolom keterangan hanya ditambahkan ke daftar yang dibaca.** Kalau suatu
   hari ia bocor ke daftar yang ditulis, pembatalan tiket akan menimpa judul
   dan deskripsinya dengan nilai yang kebetulan terbaca. Ada pemeriksaan
   otomatis khusus untuk itu.

---

## Ringkasan Hari Ini

| Item | Jumlah |
|---|---|
| Pemeriksaan otomatis yang dijalankan | **444** |
| 9 Oktober | 413 |
| Kegagalan tersisa | **0** |
| Berkas tersentuh | 18 |
| Perintah uji baru | 1 (gerbang persetujuan alat tulis) |
| Data sungguhan yang diubah asisten | 1 baris, 2 kolom |

**Benang merah: yang berubah di luar kendali kita.**

1. **263 dari 280** baris setelan alat lahir hari ini, ditulis tim lain, dan
   kita cuma punya hak membaca.
2. **Dua kemampuan mengubah data** muncul di portal kita tanpa ada yang
   memutuskan — salah satunya alat yang empat hari sebelumnya sengaja dihapus.
3. **Tujuh pemeriksaan** merah bukan karena ada yang rusak, melainkan karena
   menanam inventaris tetangga yang kini sudah berganti.
4. **Satu borang** mulai menawarkan pilihan yang mustahil, karena sumber data
   baru muncul dan kebetulan terurut lebih dulu.
5. **Dua belas alat tetangga** mengaku menyaring pemilik, padahal sumbernya
   tidak punya kolom pemilik.

Tidak satu pun dari kelima hal itu berasal dari kekeliruan di pihak kita.
Yang bisa kita kerjakan bukan mencegahnya, melainkan **membuat akibatnya
kelihatan** — alat yang dilewati selalu menyebutkan alasannya, dan kemampuan
menulis selalu menunggu keputusan manusia.

**Yang masih tertunda**

- **Laporan untuk tim pemilik**, sekarang bertambah satu temuan: 12 alat
  bercakupan "data saya sendiri" dengan sumber tanpa kolom pemilik. Yang lama
  masih berlaku: 433 baris setelan pemakai menunjuk aplikasi yang sudah tidak
  ada, dan 464 klaim berjatuh tempo sebelum tahun 2000.
- **Empat alat tulis tetangga** menunggu ditinjau satu per satu.
- Operasi **Tambah** dari layar — masih terhalang aturan pembangkit nomor.
- Pembuatan tiket masih memakai program khusus, belum lewat penjalan umum.
- Model per asisten: belum bisa dibedakan.
- Satu nilai rahasia dari berkas setelan sempat tertempel ke kolom percakapan
  uji dan masih tersimpan di sana. Tidak keluar dari mesin ini — percakapan itu
  dijawab model lokal — tapi perlu dibersihkan dan nilainya diganti.

**Rencana berikutnya:** laporan untuk tim pemilik aplikasi. Hari ini
menambahkan temuan yang paling kuat sekaligus yang paling mendesak — makin
lama ditunda, makin banyak alat baru lahir dengan pola yang sama.
