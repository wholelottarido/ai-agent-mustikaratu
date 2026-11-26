# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Kamis, 8 Oktober 2026
**Proyek:** Asisten AI per aplikasi — dari hanya membaca, jadi bisa mencatat
**Lokasi kerja:** folder `marketing/`

> Sebelum hari ini asisten hanya bisa **menjawab**. Hari ini ia bisa
> **membuat, mengubah, dan membatalkan tiket helpdesk**; ada pembatas "siapa
> boleh memakai alat apa"; dan alat tulis yang baru tidak lagi perlu ditulis
> satu per satu di kode.

> **Benang merah hari ini: yang sudah ada tapi tidak terbaca, dan yang dibaca
> dari tempat yang salah.** Hampir semua kekeliruan hari ini sepolanya — bukan
> informasi yang tidak ada, melainkan kode yang bertanya ke tempat yang keliru
> lalu menyimpulkan "tidak ada".

---

## Entri 1 — Membuat tiket helpdesk lewat percakapan

**Waktu:** pagi

**Uraian kegiatan**

Karyawan kini bisa mengetik *"tolong buatkan tiket, printer di ruangan saya
tidak bisa mencetak"*, lalu sistem menampilkan **rancangan** berisi kategori,
sub-kategori, judul, dan prioritas — belum tersimpan. Tiket baru dibuat setelah
karyawan menekan **Simpan**.

Prinsipnya sama dengan pencatatan penjualan bulan lalu: **AI tidak diberi satu
pun alat yang bisa menulis.** Nama alat yang dipegang AI pun diubah dari "buat
tiket" jadi "siapkan tiket", supaya ia tidak tergoda menjawab "tiket sudah
dibuat" padahal belum ada apa-apa.

Yang dikirim ke server saat tombol ditekan bukan rancangannya, melainkan
permintaan aslinya beserta "sidik". Server menyusun ulang rancangannya sendiri
lalu membandingkan sidiknya — mengubah angka di layar tidak mengubah yang
tersimpan.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Penyusunan rancangan | **37/37 lolos** |
| Perakitan perintah simpan | **18/18 lolos** |
| Sidik dipalsukan | ditolak |
| Tanpa login | ditolak |

Seluruh pengujian penyimpanan dijalankan **di dalam transaksi yang dibatalkan**,
bukan dengan membuat tiket lalu menghapusnya. Alasannya: tabel tiket itu antrean
kerja teknisi IT yang hidup — 10.089 tiket, 20 di antaranya masih terbuka. Tiket
uji yang sempat tersimpan, walau dihapus semenit kemudian, tetap bisa terlihat
teknisi dan jadi pekerjaan yang tidak ada.

**Temuan penting**

**Database menerima pasangan kategori yang mustahil tanpa protes.** Tabel tiket
tidak punya satu pun hubungan yang ditegakkan database, jadi sub-kategori
"LAPTOP" bisa tersimpan di kategori "NETWORK" — dan tiketnya masuk antrean yang
salah, dikerjakan orang yang salah. Validasinya harus ada di kode kita.

**Sistem sempat menebak kebalikan dari maksud pengguna.** Pencocokan kata
menerima *"SANGAT MENDESAK SEKALI"* sebagai prioritas Mendesak. Kedengarannya
membantu — sampai disadari kalimat *"tidak mendesak"* juga memuat kata
"mendesak", dan akan dibaca sebagai **Mendesak**. Pencocokannya dipersempit:
kalimat panjang sekarang dijawab dengan menawarkan pilihan, bukan ditebak.

**Hak menulisnya dibatasi di database, bukan cuma di kode.** Dibuat pengguna
database khusus yang hanya boleh mengisi tujuh kolom tertentu. Ia secara harfiah
tidak bisa mengisi status, teknisi, atau tanggal tutup — jadi tiket buatan
portal **selalu lahir berstatus terbuka dan belum ditugaskan**, dijamin
database, bukan oleh kebenaran kode kita.

---

## Entri 2 — Tombol Simpan tidak muncul

**Waktu:** menjelang siang

**Uraian kegiatan**

Saat diuji, rancangannya tersusun benar dan AI bahkan menulis *"silakan tekan
tombol Simpan"* — **tapi tombolnya tidak ada.**

Sebabnya: pertanyaan tentang tiket diteruskan dari asisten utama ke asisten
Portal, dan pekerjaan asisten bawahan tidak ikut terkirim ke layar. Yang sampai
hanya catatan "sudah diteruskan". Masalah yang sama persis pernah terjadi pada
label sumber data, dan penyelesaiannya dipakai ulang.

**Hasil terukur**

| Pertanyaan | Hasil |
|---|---|
| "buatkan tiket, printer tidak bisa mencetak" | kartu **muncul**, lalu tersimpan |
| "buatkan tiket, mouse saya rusak" | kartu tidak muncul — AI **bertanya** dulu |

Yang kedua bukan kegagalan. "Mouse" bukan sub-kategori yang ada, jadi AI
menawarkan pilihan sebenarnya (PC / LAPTOP / OTHERS) dan menunggu jawaban —
tepat yang dikehendaki, karena menebak berarti tiket masuk antrean yang salah.

---

## Entri 3 — Kekeliruan yang berdampak ke tim lain

**Waktu:** siang

**Uraian kegiatan**

Pengujian yang diperkirakan akan gagal justru berhasil, dan **satu tiket
sungguhan masuk ke antrean helpdesk mereka**. Nomornya pun salah bentuk: 14
huruf, satu-satunya di antara 10.089 nomor sepanjang 13.

Sebabnya aturan penomoran yang **dikarang, bukan dibaca dari datanya**.
Diperkirakan penghitungnya naik terus; ternyata ia 4 digit dan **melingkar**:

```
2025: 8656 .. 9522
2026: 1000 .. 9999      <- menyentuh 9999 lalu balik ke 1000
```

Sudah diperbaiki. **Baris yang terlanjur dibuat** judul dan isinya diubah jadi
menyebut terang bahwa itu baris pengujian portal AI dan tidak perlu
ditindaklanjuti, supaya teknisi tidak mengerjakan masalah yang tidak ada.
Nomornya tidak diubah — menyentuh kolom nomor di tabel milik tim lain demi
kerapian bukan pertukaran yang sepadan.

**Temuan penting**

Pemeriksaan otomatis ditulis supaya nomor salah bentuk **berikutnya** tetap
ketahuan, dengan mengecualikan baris yang sudah diketahui **menurut namanya** —
bukan dengan melonggarkan syaratnya jadi "boleh ada beberapa yang rusak".
Melonggarkannya akan membuat kekeliruan berikutnya lolos tanpa ada yang tahu.

---

## Entri 4 — Pembatas "siapa boleh memakai alat apa"

**Waktu:** sore

**Uraian kegiatan**

Ditanyakan bagaimana akun IT bisa melihat tiket yang masuk. Jawabannya: belum
bisa — dan penelusurannya menemukan lubang yang lebih besar dari pertanyaannya.

Kedua alat tiket yang ada hanya menampilkan tiket **milik penanya sendiri**.
Untuk melihat antrean, perlu alat yang membaca tiket semua orang. Tapi sampai
hari ini **satu-satunya pembatas sebuah alat adalah cakupan datanya** — artinya
alat yang membaca semua tiket akan terpasang untuk **setiap** pemegang aplikasi
Portal, yaitu semua orang yang bisa login. Keluhan siapa pun terbaca siapa pun.

Ternyata tim pemilik sudah menyediakan tempatnya: ada kolom izin di tabel alat,
sudah mereka isi, dan **tidak pernah sekali pun dibaca sistem kita**. Sekarang
dibaca, dan alat yang izinnya tidak dimiliki pemakai tidak dipasang sama sekali,
dengan alasan yang tercetak.

**Hasil terukur**

| Yang diperiksa | Hasil |
|---|---|
| Pemeriksaan gerbang izin | **11/11 lolos** |
| Penelusuran izin pemakai | **4/4 lolos** |
| Akun IT bertanya antrean | melihat 20 tiket terbuka seluruh perusahaan |
| Akun MAPS bertanya hal sama | **ditolak**, beserta alasannya |

**Kendala**

Menyalakan gerbang ini **langsung mematikan pembuatan tiket yang baru selesai
dikerjakan**, karena alat tiket mensyaratkan izin yang tidak dimiliki kedua akun
uji. Penyebabnya: akun uji yang kita buat dulu punya daftar aplikasi tapi tanpa
peran sama sekali — berbeda dari akun karyawan sungguhan. Diperbaiki dengan
memberi peran yang benar-benar ada dan dipakai 8 karyawan.

**Temuan penting**

Izin untuk melihat antrean helpdesk ternyata **hanya melekat pada satu peran
raksasa**: 245 izin, termasuk 45 izin menghapus — menghapus karyawan,
perusahaan, bahkan aplikasi. Tidak ada peran menengah yang berarti "boleh
melihat antrean saja".

Untuk keperluan pengujian, peran itu diberikan ke akun uji IT **atas keputusan
pembimbing**, setelah konsekuensinya disampaikan: data yang dipakai bukan hanya
gerbang izin portal kita, melainkan aplikasi administrasi mereka yang sungguhan.
Perintah pembatalannya disiapkan, dengan catatan jujur bahwa pembatalan
mengembalikan **peran**, bukan data yang telanjur terhapus.

Permintaan peran sempit ke tim pemilik tetap jalan yang benar, dan sekarang
punya bukti konkret: portal ini memakai **1 dari 245** izin itu.

---

## Entri 5 — Izin ikut terlihat dan bisa disetel dari layar

**Waktu:** sore

**Uraian kegiatan**

Setelah gerbang izin berdiri, layar pengaturan justru jadi menyesatkan:
administrator melihat alat bercakupan "Seluruh perusahaan" tanpa petunjuk apa
pun bahwa ada izin yang menjaganya — dan alat lain yang **tidak** dijaga
terlihat persis serupa.

Sekarang keduanya ditandai berbeda, dan administrator bisa memberi atau
mencabut syarat izin langsung dari layar.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Pemeriksaan tampilan & penyetelan izin | **14/14 lolos** |
| Izin salah ketik | ditolak |
| Penyetelan benar-benar mengubah siapa yang dapat alatnya | terbukti |

**Temuan penting**

**Izin yang salah ketik tidak menghasilkan galat apa pun saat disimpan** —
alatnya cuma berhenti muncul untuk semua orang, selamanya. Tidak ada pesan,
tidak ada catatan, hanya alat yang menghilang. Karena itu masukannya dibuat
pilihan, bukan ketikan bebas, dan daftarnya diambil dari izin yang **benar-benar
diberikan ke peran** — bukan dari katalog. Bedanya nyata: 62 kode terdaftar di
katalog tidak dimiliki satu peran pun.

Memberi layar kemampuan menyetel izin **tidak melemahkan apa pun**: izin hanya
mempersempit siapa yang mendapat alat, tidak pernah melebarkan. Yang justru
berbahaya adalah keadaan sebelumnya — administrator bisa membuat alat terbuka
dan tidak punya cara menutupnya sendiri.

---

## Entri 6 — Mengubah dan membatalkan tiket

**Waktu:** sore

**Uraian kegiatan**

Dua kemampuan terakhir yang sejak awal dilewati akhirnya dikerjakan: menyunting
tiket (judul, deskripsi, prioritas) dan membatalkannya.

Membatalkan ternyata **bukan menghapus** — konfigurasinya mengubah status jadi
"CANCELLED". Tidak ada baris yang hilang, dan hak menghapus tidak perlu
diberikan sama sekali.

Kartu penyuntingan menampilkan **apa yang berubah**, bukan isi barunya. Kartu
pembuatan menampilkan isi lengkap karena belum ada apa-apa sebelumnya; di sini
sudah ada, dan menampilkan isi baru saja memaksa pengguna mengingat sendiri
yang lama untuk tahu apa yang ia setujui.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Penyuntingan tiket | **23/23 lolos** |
| Tiket milik orang lain | ditolak |
| Tiket yang sudah dikerjakan teknisi | ditolak |
| "Tidak ada yang berubah" | ditolak, bukan kartu kosong |

**Temuan penting**

**Satu jaminan turun, dan itu disengaja.** Pada pembuatan tiket, "tidak bisa
lahir sudah selesai" dijamin database — kolom statusnya memang tidak boleh
diisi. Pada penyuntingan, "hanya tiket milik saya" **tidak bisa** dijamin
begitu: PostgreSQL tidak punya batas per-baris tanpa menyalakan fitur yang akan
mengubah perilaku aplikasi tim lain.

Jadi batas itu berdiri di kode kita, di **dua** tempat — saat menyusun rancangan
dan lagi saat menyimpan, karena di antara keduanya ada jeda. Yang tetap dijamin
database hanya kolom mana yang boleh berubah: bug di kode kita berarti judul
tiket orang lain bisa berubah — tidak bisa jadi tiket orang lain tertutup,
ditugaskan ulang, atau terhapus. Ditulis lengkap di komentar berkasnya supaya
tidak terbaca sebagai jaminan yang setara.

---

## Entri 7 — Alat tulis tidak lagi perlu ditulis satu per satu

**Waktu:** sore

**Uraian kegiatan**

Dua kemampuan di Entri 6 masing-masing butuh kodenya sendiri. Itu bertentangan
dengan tujuan proyek ini: alat seharusnya bisa **dibuat dari layar pengaturan**,
bukan ditulis programmer satu per satu.

Dibuat satu **penjalan umum** yang merakit operasinya dari baris konfigurasi —
kolom apa yang diisi, kolom mana kuncinya, syarat apa yang harus dipenuhi,
nilai apa yang tetap. Pembatalan tiket kemudian berjalan penuh **tanpa satu
baris kode khusus**, dan alat tulis berikutnya juga tidak akan perlu.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Penjalan umum | **21/21 lolos** |
| Tabel di luar daftar-boleh | ditolak |
| Operasi ubah tanpa kunci | ditolak |
| Pembatalan dari percakapan, ujung ke ujung | **berhasil** |

Empat penjagaan yang **tidak bisa dimatikan dari layar pengaturan**: tabel
sasaran dari daftar tetap di kode; kolom yang boleh ditulis dibaca dari hak
database saat itu juga; penyaring pemilik selalu ikut; dan operasi tanpa kunci
ditolak — karena tanpa kunci, satu perintah akan menyentuh seluruh tabel.

**Temuan penting**

**Nilai tetap tidak boleh jadi pilihan AI.** Status "CANCELLED" datang dari
konfigurasi, bukan dari AI. Kalau ia jadi masukan AI, AI bisa memilih
"RESOLVED" — menutup tiket, bukan membatalkannya.

**Kendala**

Saat diuji, AI justru **menolak** permintaan pembatalan dengan alasan tidak
punya akses. Ternyata keterangan alat itu diambil dari baris milik tim lain yang
berbunyi *"Menandai terhapus data Batalkan tiket helpdesk."* — teks contoh yang
belum terisi. AI membacanya lalu menyimpulkan ia tidak berwenang. Sekarang
kalimat kita yang memimpin, keterangan baris jadi catatan di belakang.

---

## Ringkasan Hari Ini

| Item | Jumlah |
|---|---|
| Pemeriksaan otomatis yang dijalankan | **353** |
| Kemarin | 215 |
| Pemeriksaan **baru** hari ini | 138 |
| Kegagalan tersisa | **0** |
| Berkas kode tersentuh | 34 |

**Benang merah: yang sudah ada tapi tidak terbaca, dan yang dibaca dari tempat
yang salah.** Hampir semua kekeliruan hari ini sepolanya:

1. **Izin** sudah dituliskan tim pemilik di database, tapi tidak pernah dibaca
   sistem kita — jadi ia berlaku di satu tempat dan tidak di tempat lain.
2. **Hak kolom database** ditanyakan lewat tampilan yang hanya memperlihatkan
   hak milik penanya sendiri. Hasilnya kosong, lalu disimpulkan "haknya tidak
   ada" — padahal ada. Kekeliruan ini terjadi **dua kali** dalam satu hari.
3. **Aturan penomoran tiket** ada di datanya, tapi dikarang sendiri.
4. **Nama alat** dihitung di dua tempat yang tidak saling tahu, sehingga
   keterangan untuk AI menyebut nama yang tidak ada — juga **dua kali**.
5. **Keterangan alat** dibaca dari baris yang isinya teks contoh belum terisi,
   dan AI menolak pekerjaan yang sebenarnya bisa ia lakukan.

Dan satu lagi yang paling halus: **dua pemeriksaan otomatis tetap hijau justru
ketika yang diperiksanya sudah salah** — satu membandingkan kode di database
alih-alih nama yang benar-benar dipegang AI, satu lagi masih menuntut perilaku
lama yang sudah sengaja diubah. Keduanya diperbaiki supaya membandingkan dengan
sumber yang sama dengan yang dipakai sistem, bukan dengan tulisannya sendiri.

**Yang masih tertunda**

- Borang "Tambah tool" masih hanya bisa membuat alat **baca**. Mesinnya sudah
  siap menerima alat tulis buatan layar; yang kurang tinggal borangnya. Ini
  langkah berikutnya.
- Jumlah sebenarnya di tiap hasil: semua alat membaca paling banyak 20 baris,
  padahal antrean tiket berisi 10.091 — pertanyaan "ada berapa" dijawab dari
  jendela sempit.
- Satu baris uji masih ada di tabel tiket mereka, sudah ditandai jelas.
- Permintaan peran sempit ke tim pemilik, sebagai ganti peran raksasa yang
  sekarang dipakai akun uji.

**Rencana besok:** melengkapi borang "Tambah tool" supaya alat tulis bisa dibuat
sendiri dari layar, lalu permintaan peran sempit ke tim pemilik aplikasi.
