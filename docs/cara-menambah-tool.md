# Cara menambah tool dari halaman Kelola AI

**Untuk:** tim IT yang mengatur asisten AI portal
**Halaman:** `/kelola-ai` — hanya terbuka untuk departemen IT

---

## Yang bisa dan tidak bisa dibuat dari halaman ini

| | |
|---|---|
| **Bisa** | tool **baca** — menjawab pertanyaan dari satu sumber data |
| **Belum bisa** | tool **tulis** — membuat, mengubah, atau membatalkan data |

Ini bukan "belum sempat". Role database halaman ini **tidak punya hak** mengisi
kolom yang menentukan jenis operasi. Artinya tool yang lahir dari borang ini
selalu beroperasi `baca` — dijamin database, bukan oleh kebenaran kodenya.

Kalau borangnya suatu saat salah, atau ada bug di jalur penyimpanannya, tool
tulis **tetap tidak bisa** lahir dari sini.

---

## Langkah

1. Buka `/kelola-ai`.
2. Pilih tab **Agent**, klik agent yang dituju (mis. Ratu AI Portal).
   Tombolnya akan berbunyi **+ Tambah tool untuk Ratu AI Portal** — tool yang
   dibuat dari sini langsung menempel ke agent itu.
   *(Dari tab **Tool**, tombolnya menambah tool yang menempel ke agent pemegang
   aplikasi sumbernya — bukan ke agent tertentu.)*
3. Isi borang, lihat ketentuan tiap kolom di bawah.
4. **Simpan**.
5. Tool lahir dalam keadaan **tidak aktif**. Nyalakan lewat saklar **Aktif** di
   kartunya.
6. Coba di chat dengan akun yang berhak.

---

## Ketentuan tiap kolom

### Kode
Nama yang dipakai AI saat memanggil tool.

- huruf kecil, angka, garis bawah; **3–60 huruf**; diawali huruf
- harus **belum dipakai** tool lain — termasuk tool tim lain
- contoh: `aset_departemen`, `kunjungan_saya`

> Kode tidak bisa diubah setelah tool dibuat. Yang bisa diubah cuma setelannya.

### Nama
Yang ditampilkan ke administrator di layar. Bebas, wajib diisi.

### Deskripsi untuk model
**Minimal 15 huruf.** Ini kolom yang paling menentukan.

Ini **satu-satunya dasar AI memutuskan kapan memakai tool ini.** Deskripsi yang
kabur membuat tool dipanggil di saat yang salah — atau tidak dipanggil sama
sekali, lalu AI menjawab "saya tidak punya data itu" padahal punya.

Tulis apa isinya dan kapan dipakai:

> ✅ "Aset perusahaan yang sedang dipegang karyawan penanya: laptop, monitor,
> HP, beserta tanggal mulai dipakai."
>
> ❌ "Data aset."

### Sumber data
Pilih dari daftar. Isinya view database yang sudah terdaftar — tidak bisa
mengetik nama tabel sendiri.

Kalau sumber yang Anda butuhkan belum ada, itu **tidak bisa dibuat dari
halaman ini**; pendaftarannya lewat skrip, karena perlu memeriksa kolom
penyaring orangnya ke katalog database.

### Kolom yang boleh dibaca
Centang minimal satu.

**Yang tidak dicentang tidak pernah sampai ke AI.** Ini bukan soal rapi — kolom
yang ikut terbawa akan masuk ke konteks model dan ke catatan pemakaian setiap
kali tool dipanggil. Centang yang benar-benar dibutuhkan pertanyaan.

### Urutkan menurut
Opsional, dan **hanya kolom yang sudah dicentang** yang muncul di pilihan.

Mengurutkan menurut kolom yang tidak dibaca membuat query gagal **waktu
dipanggil**, bukan waktu disimpan — jadi pilihannya memang dibatasi.

### Batas baris
**1 sampai 200.** Bawaannya 20.

> ⚠️ Perlu Anda tahu: AI hanya melihat sebanyak batas ini. Pertanyaan "ada
> berapa" akan dijawab dari jendela itu, bukan dari jumlah sebenarnya di
> database. Ini keterbatasan yang belum diperbaiki.

### Cakupan — siapa yang barisnya terlihat

| Pilihan | Artinya |
|---|---|
| Diri sendiri | hanya baris milik penanya |
| Diri + bawahan | penanya dan bawahan langsungnya |
| Satu departemen | seluruh departemen penanya |
| Satu perusahaan | seluruh perusahaan penanya |
| Seluruh perusahaan | **tanpa penyaring orang** |

**Pilihan yang tidak mungkin tidak ditampilkan.** Kalau sumbernya tidak punya
kolom penyaring orang, hanya "Seluruh perusahaan" yang muncul — bukan
ditampilkan lalu ditolak saat disimpan.

> ⚠️ "Seluruh perusahaan" berarti tool ini terpasang untuk **setiap orang**
> yang bisa membuka aplikasi sumbernya. Aman untuk data umum seperti SOP atau
> direktori karyawan. Untuk data pribadi — tiket, pengajuan, aset — isi
> **Syarat izin** di bawah.

### Syarat izin — siapa yang DAPAT tool ini
Opsional. Kosong = tidak ada syarat.

Diketik dengan bantuan saran; isinya kode izin yang **benar-benar diberikan ke
peran** di sistem perusahaan, mis. `ticket:read`, `assignment-ticket:read`.
Angka di sebelah kode = berapa peran yang memilikinya.

- izin yang **tidak ada** ditolak saat disimpan
- izin yang ada tapi **tidak dimiliki siapa pun** (0 peran) akan membuat
  tool-nya tidak pernah terpasang untuk siapa pun — tidak ada pesan galat, ia
  cuma menghilang

Izin hanya **mempersempit** siapa yang mendapat tool, tidak pernah melebarkan.

### Contoh pertanyaan
Opsional, tapi berguna. Ikut dibaca AI sebagai petunjuk bentuk pertanyaan yang
cocok, dan ditampilkan ke administrator di layar.

---

## Sesudah tool dibuat

**Tool lahir tidak aktif.** Itu disengaja: tool yang langsung hidup begitu
disimpan berarti kesalahan ketik di kolom deskripsi langsung sampai ke pengguna.

Yang masih bisa diubah kapan saja dari layar: nama, deskripsi, kolom, urutan,
batas, cakupan, syarat izin, contoh pertanyaan, dan aktif/tidak.

Yang **tidak bisa** diubah: kode, sumber data, jenis, dan operasi. Keempatnya
menentukan **apa** yang dikerjakan tool, bukan sekadar setelannya — dan role
database layar ini memang tidak punya hak menyentuhnya.

---

## Melepas tool dari sebuah agent

Di halaman agent ada dua daftar berbeda, dan bedanya penting:

**Disambungkan dari sini** — tool milik portal ini yang Anda sambungkan.
Tombol `×` memutus sambungannya.

**Tool tim lain yang dipasang di sini** — tool dari sistem AI tim lain. Tombol
`lepas` membuat portal ini berhenti memasangnya.

> ⚠️ **Melepas tidak menghapus apa pun.** Baris tool itu tetap utuh di database
> perusahaan, dan sistem AI tim lain tetap memakainya seperti biasa. Yang
> berubah cuma apa yang dirakit portal ini, dan itu dicatat di database portal.
> Bisa dipasang lagi kapan saja lewat daftar **Dilepas dari agent ini**.

---

## Kalau tool tidak muncul di chat

Periksa berurutan:

1. **Sudah aktif?** Tool baru lahir tidak aktif.
2. **Syarat izinnya dimiliki akun yang mencoba?** Kalau tidak, tool tidak
   dipasang sama sekali — dan alasannya tercetak di log server.
3. **Agent-nya dapat aplikasi itu?** Tool menempel ke agent lewat aplikasi
   sumbernya, kecuali dibuat langsung dari halaman agent.
4. **Deskripsinya cukup jelas?** Tool bisa terpasang tapi tidak pernah dipilih
   AI kalau deskripsinya tidak menyebut kapan ia dipakai.
