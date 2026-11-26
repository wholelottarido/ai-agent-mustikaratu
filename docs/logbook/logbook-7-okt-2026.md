# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Rabu, 7 Oktober 2026
**Proyek:** Asisten AI per aplikasi, dengan pengaturan tanpa menulis kode
**Lokasi kerja:** folder `marketing/`

> Benang merah hari ini: **datanya benar, keterangannya yang salah.** Tiga
> masalah yang ditemukan hari ini sama polanya — sistem menampilkan sesuatu
> yang tidak sama dengan keadaan sebenarnya, dan pembacanya tidak punya cara
> mengetahuinya.

---

## Entri 1 — Menambah alat per asisten, dan melihat asal datanya

**Waktu:** pagi

**Uraian kegiatan**

Dilanjutkan layar **Kelola AI** dari kemarin. Sekarang petugas IT bisa membuka
satu asisten, melihat alat apa saja yang dipakainya, lalu menambah alat baru
**langsung untuk asisten itu** — tanpa menulis satu baris kode. Alat yang
dibuat dari layar ini otomatis menempel ke asisten yang sedang dibuka, bukan
ke asisten lain yang kebetulan memiliki sumber datanya.

Ditambahkan juga hal yang diminta sejak kemarin: tiap alat kini bisa ditelusuri
**datanya diambil dari mana**. Dibuat gambar relasi antartabel yang ditarik
langsung dari struktur database — nama kolom, jenis isinya, dan kunci utamanya
dibaca dari katalog, bukan digambar tangan. Tabel pokok ditaruh di tengah,
tabel yang dirujuknya di kanan, yang merujuk kepadanya di kiri, supaya garis
penghubungnya tidak saling menyilang.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Asisten terdaftar | 9 |
| Alat terdaftar | 20 |
| Sumber data yang dipakai | 16 |
| Tabrakan kotak pada gambar relasi | **0** |
| Halaman sumber data yang dibuka | **4/4 tampil normal** |

**Temuan penting**

**Garis pada gambar relasi itu sebagian besar bukan hubungan resmi.** Setelah
gambarnya jadi, ketahuan bahwa tabel-tabel seperti `portal_ticket` dan
tetangganya **tidak punya satu pun hubungan yang ditegakkan database**.
Artinya database akan menerima nomor rujukan karangan tanpa protes.

Ini tidak disembunyikan supaya gambarnya terlihat rapi. Garis yang hanya
*disimpulkan* dari kesamaan nama kolom digambar **putus-putus**, yang resmi
digambar utuh, dan di bawah gambar ditulis keterangannya apa adanya. Gambar
yang menyamarkan ini akan membuat pembacanya mengira datanya lebih terjaga
daripada kenyataannya.

---

## Entri 2 — Jawaban yang tampil mentah di layar

**Waktu:** menjelang siang

**Uraian kegiatan**

Dilaporkan jawaban yang muncul di layar seperti ini:

> Pantau Status: ... melalui tahapan: Pengecekan Data `$\rightarrow$`
> Menunggu/Diproses (approval) `$\rightarrow$` Disetujui / Ditolak.

Tulisan `$\rightarrow$` itu notasi rumus matematika yang dikeluarkan AI, dan
tampilan portal tidak mengenalnya, jadi ditampilkan apa adanya. Pembaca melihat
kode mentah di tengah kalimat.

Diperbaiki berlapis tiga: AI dilarang memakai notasi itu sejak awal; yang
telanjur keluar diterjemahkan jadi tanda panah biasa (→) saat ditampilkan; dan
notasi yang belum didukung dilaporkan ke catatan pengembang supaya tidak perlu
menunggu laporan pengguna lagi.

**Pertimbangan yang menentukan rancangannya.** Ada cara yang lebih "resmi",
yaitu memasang penafsir rumus sungguhan. Cara itu **ditolak**: penanda rumus
adalah tanda dolar, sedangkan jawaban portal ini penuh nominal uang. Kalimat
*"harganya $500 sampai $700"* akan dibaca sebagai rumus dan angkanya rusak.
Jadi yang dikerjakan menerjemahkan, bukan menafsirkan — dan hanya pada tulisan
yang jelas-jelas berisi perintah rumus.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Pemeriksaan otomatis baru | **39/39 lolos** |
| Jawaban tersimpan yang diperiksa | 198 |
| Jawaban yang memuat notasi rumus | 2 — keduanya kini terbaca benar |
| Kalimat berisi nominal uang yang ikut rusak | **0** |

Perapihan dilakukan **saat menampilkan**, bukan saat menyimpan. Akibatnya
jawaban lama yang sudah tersimpan ikut terbaca benar tanpa perlu mengubah
database, dan yang tersimpan tetap kata-kata asli AI.

**Temuan tambahan**

Pemeriksaan pada data sungguhan memunculkan kekurangan yang tidak terduga:
rumus pecahan `(a+b)/c` sempat diratakan menjadi `a+b/c` — **artinya berubah**,
bukan sekadar kurang rapi. Sudah diperbaiki dengan menambahkan tanda kurung.

---

## Entri 3 — Menyiapkan pengujian untuk akun MAPS

**Waktu:** siang

**Uraian kegiatan**

Disusun daftar pertanyaan uji untuk akun `dafi@` yang sengaja dibuat hanya
memiliki aplikasi **MAPS + Portal**, untuk membuktikan bahwa pembatasan akses
benar-benar bekerja pada akun yang terbatas, bukan hanya pada akun IT.

Daftarnya tidak dikarang. Tiap alat dijalankan sungguhan memakai sesi akun itu,
lalu jumlah baris yang benar-benar keluar dicatat, supaya contoh pertanyaannya
menyentuh data yang memang ada.

**Hasil terukur**

| Yang diperiksa dengan sesi akun `dafi@` | Hasil |
|---|---|
| Aplikasi yang terbuka | 2 — Portal, MAPS |
| Klaim MAPS yang terlihat (departemen Trade Marketing) | 16.783 baris |
| Program MAPS yang terlihat | 2.664 baris |
| Aset & tiket pribadi | 0 baris — jawaban yang benar adalah "tidak ada" |
| Dokumen SOP yang terbaca | 63 |
| Halaman **Kelola AI** | **tertutup** — dialihkan ke beranda |
| Pintu belakang halaman tersebut | **ditolak** |
| Akun IT pada halaman yang sama | **terbuka** |

---

## Entri 4 — Temuan serius: jawaban benar, labelnya berbohong

**Waktu:** sore

**Uraian kegiatan**

Saat daftar uji tadi dijalankan, muncul masalah yang paling penting hari ini.
Akun `dafi@` (departemen Trade Marketing) ditanya:

> "Klaim departemen HR apa saja?"

AI menjawab **"Berikut adalah daftar klaim untuk departemen HR:"** lalu
menampilkan tabel berisi belasan klaim.

**Datanya tidak bocor.** Nomor-nomor klaim yang ditampilkan dicocokkan satu per
satu dengan database, dan semuanya milik Trade Marketing — penyaringnya bekerja
dengan benar. Yang salah **namanya**: data departemen sendiri disajikan sebagai
data departemen HR.

Ini lebih berbahaya daripada menolak menjawab, karena pembacanya tidak punya
cara mengetahui bahwa labelnya keliru. Ia bisa meneruskan angka itu ke
atasannya sebagai data HR.

**Sebabnya** bukan kesalahan perhitungan. Hasil pencarian yang diterima AI
hanya menyebut *"disaring per departemen"* — **tanpa menyebut departemen yang
mana**. AI mengisi kekosongan itu dengan departemen yang sedang ditanyakan.

**Perbaikannya** bukan menambah aturan, melainkan menutup kekosongan itu di
tempat yang tidak bisa dilewatkan: hasil pencarian kini menyebut pemiliknya
dengan nama — *"departemen Trade Marketing"* — beserta peringatan yang
diletakkan tepat di sebelah datanya.

**Hasil terukur**

Diuji ulang dengan AI dan pertanyaan yang sama persis:

| Pertanyaan | Jawaban sesudah perbaikan |
|---|---|
| "Klaim departemen HR apa saja?" | *Maaf, data klaim untuk departemen HR tidak dapat diakses.* |
| "Klaim departemen saya apa saja?" | 3 klaim, **cocok dengan database** |

Uji kedua itu sama pentingnya: perbaikan yang membuat AI menolak segalanya
bukan perbaikan.

Ditambahkan **7 pemeriksaan otomatis** supaya kekeliruan ini tidak kembali
diam-diam, termasuk satu yang memastikan alat berlingkup "seluruh perusahaan"
**tidak** ikut diberi peringatan itu — peringatan yang tidak berlaku hanya akan
mengajari AI mengabaikannya.

---

## Entri 5 — Pemeriksaan keamanan pintu masuk

**Waktu:** sore

**Uraian kegiatan**

Ditanyakan apakah rancangan sistem ini berisiko, karena penjagaan sesi ditulis
di tiap pintu masuk, bukan di satu tempat terpusat. Diperiksa seluruhnya,
bukan diperkirakan.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Pintu masuk (alamat API) | 21 |
| Berpenjaga sesi | **20** |
| Terbuka tanpa login | 1 — **disengaja** |

Yang satu itu adalah pendaftaran akun baru, yang memang harus terbuka karena
orang yang belum punya akun tidak bisa login dulu. Ia dibatasi per alamat
jaringan, dan yang masuk **tidak langsung menjadi akun** — hanya mengantre
sampai admin menyetujui.

**Catatan** Hasilnya bersih, tetapi itu bersandar pada kedisiplinan, bukan
pada penegakan otomatis. Satu pintu baru yang ditambah terburu-buru bisa lolos
tanpa ada yang menegur. Disarankan menambah satu pemeriksaan otomatis yang
menyusuri semua pintu dan menuntut tiap pintu berpenjaga atau terdaftar sebagai
pengecualian. Belum dikerjakan.

---

## Ringkasan Hari Ini

| Item | Jumlah |
|---|---|
| Pemeriksaan otomatis yang dijalankan hari ini | **215** |
| Pemeriksaan **baru** yang ditulis hari ini | 46 |
| Kegagalan tersisa | **0** |
| Masalah pengguna yang diperbaiki | 2 (tampilan mentah, label keliru) |
| Berkas kode tersentuh | ±45 |

**Benang merah hari ini: datanya benar, keterangannya yang salah.** Ketiga
masalah hari ini satu pola — bukan AI salah menghitung, melainkan **yang
terbaca pengguna tidak sama dengan keadaan sebenarnya**:

1. gambar relasi yang akan terlihat seolah hubungan antartabel terjaga database,
   padahal tidak;
2. jawaban yang menampilkan kode mentah di tengah kalimat;
3. data Trade Marketing yang diberi nama "klaim departemen HR".

Ketiganya diperbaiki dengan cara yang sama: **membuat sistem menyebutkan apa
yang sebenarnya ia ketahui**, di tempat yang tidak bisa dilewatkan — garis
putus-putus beserta keterangannya, terjemahan saat menampilkan, dan nama
pemilik data yang menempel pada datanya sendiri.

**Yang masih tertunda**

- Operasi menulis dari pengaturan (membuat, mengubah, membatalkan tiket) —
  masih sengaja dilewati, dan alasannya tercetak jelas, bukan gagal diam-diam.
- Tiga kekeliruan data milik tim lain yang perlu dilaporkan, antara lain
  pengurutan klaim yang membuat pertanyaan tentang jatuh tempo selalu terjawab
  "tidak ada" padahal datanya ada.
- Pemeriksaan otomatis untuk penjagaan pintu masuk (Entri 5).

**Rencana besok:** melanjutkan daftar uji akun MAPS yang belum dijalankan —
terutama pertanyaan tentang kode status yang tidak jelas artinya, dan permintaan
membuat tiket yang seharusnya ditolak terus terang.
