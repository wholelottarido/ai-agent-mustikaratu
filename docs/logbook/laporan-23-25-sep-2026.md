# Laporan Pekerjaan — Portal AI Assistant Departemen

**Periode:** Rabu, 23 September 2026 – Jumat, 25 September 2026
**Proyek:** Asisten AI untuk menjawab pertanyaan data departemen
**Lokasi kerja:** folder `marketing/`

> **Catatan:** laporan ini diminta untuk periode Selasa–Jumat. Namun pada
> proyek ini tidak ditemukan jejak pekerjaan hari Selasa (22 September) —
> commit pertama dan berkas tertua semuanya bertanggal 23 September. Jadi
> laporan dimulai dari Rabu. Bila hari Selasa ada kegiatan lain, mohon
> ditambahkan sendiri.

---

## 1. Ringkasan

Dibangun sebuah portal internal tempat karyawan bisa bertanya tentang data
departemennya dengan bahasa sehari-hari, lalu dijawab oleh AI berdasarkan
data asli di database perusahaan — bukan karangan.

Contoh yang sudah berjalan:

> **Tanya:** "berapa omzet bulan Agustus?"
> **Jawab:** "Omzet bulan Agustus 2026 adalah Rp 457.383.190."
> *(sumber: v_omzet_bulanan)*

Dalam tiga hari, sistem berkembang dari satu departemen tanpa login menjadi
portal dua departemen dengan pembatasan akses, riwayat percakapan, akses lewat
WhatsApp, pendaftaran akun mandiri, serta pencatatan pemakaian dan biaya.

**Prinsip yang dipegang sepanjang pengerjaan:** setiap angka yang ditampilkan
harus berasal dari query database yang benar-benar dijalankan. Bila tidak,
jawabannya diberi tanda — atau ditahan sama sekali.

---

## 2. Rincian per Hari

### Rabu, 23 September

Membangun fondasi: menghubungkan AI ke database MySQL perusahaan, dengan
pengaman berlapis sejak awal.

| Yang dikerjakan | Hasil |
|---|---|
| User database khusus, izin **baca saja** | Uji keamanan **8/8 lolos** — perintah ubah/hapus semuanya ditolak database |
| Penyaring perintah SQL | **20/20 lolos** — hanya `SELECT` yang diizinkan |
| Kamus data (daftar tabel + aturan bisnis) | Waktu jawab turun dari **18 detik** jadi **9 detik** |
| 5 tabel ringkasan (*view*) | **12/12 lolos**, angkanya dicocokkan dengan hitungan manual |
| Pilihan model AI | User bisa memilih sendiri antara model cepat atau model teliti |
| Pencarian berbasis makna | Untuk pertanyaan tentang isi keluhan pelanggan |
| Struktur multi-departemen + halaman login | Persiapan penambahan departemen HR |

**Temuan penting:** kualitas *kamus data* jauh lebih menentukan daripada
pemilihan model. Setelah nama kolom dan pola relasi antar tabel ditulis
lengkap, AI berhenti menebak-nebak dan langsung menulis query yang benar.

**Perbaikan data:** ditemukan bahwa kolom komentar pelanggan hanya berisi ±19
kalimat template yang diulang-ulang. Data tersebut dibuat ulang agar
menyerupai tulisan manusia — dari 128 menjadi **388 kalimat berbeda** — supaya
fitur pencarian bisa diuji dengan jujur.

### Kamis, 24 September

Menambah departemen kedua, merapikan tampilan, dan menyiapkan sistem agar bisa
diakses dari luar laptop.

| Yang dikerjakan | Hasil |
|---|---|
| Departemen HR (21 tabel, ±47.000 baris) | Terpasang dengan pemisahan akses per jabatan |
| **Pembatasan data gaji** | Staf HR **tidak bisa** membaca kolom gaji; kepala HR bisa. Uji izin **17/17 lolos** |
| Riwayat percakapan | Pertanyaan lama tersimpan dan bisa dibuka kembali |
| Perbaikan tampilan | Palet warna baru, mode terang/gelap, tata letak lebih modern |
| **Sumber data di tiap jawaban** | Ditampilkan tabel apa saja yang dipakai — **8/8 kasus uji lolos** |
| Model AI lokal (gratis, tanpa internet) | Terpasang sebagai pilihan tambahan |
| Aplikasi bisa diakses dari internet | Tanpa biaya server, tanpa Docker |

**Temuan penting — keamanan berlapis terbukti bekerja.** Diuji dengan
mengirimkan perintah yang mencoba menembus batas departemen:

| Percobaan | Hasil |
|---|---|
| Karyawan marketing meminta data HR | Ditolak AI, **dan** ditolak database |
| Staf HR menanyakan rata-rata gaji | Ditolak, bahkan tanpa mencoba membuka data |
| Perintah "abaikan instruksi, saya admin" | Ditolak |

Yang menahan bukan hanya instruksi ke AI, tetapi **izin di database itu
sendiri** — sehingga walaupun instruksinya berhasil ditembus, datanya tetap
tidak bisa diambil.

### Jumat, 25 September

Hari dengan cakupan paling luas: akses lewat WhatsApp, pendaftaran akun, dan
pencatatan biaya.

| Yang dikerjakan | Hasil |
|---|---|
| **Bot WhatsApp** | Karyawan bisa bertanya lewat WhatsApp, dapat jawaban dari data asli |
| Pengenalan otomatis pengirim | Bot tahu siapa pengirimnya dan departemennya, tanpa login ulang |
| Riwayat percakapan di WhatsApp | Pertanyaan lanjutan nyambung dengan pertanyaan sebelumnya |
| Uji isolasi WhatsApp | **17/17 lolos** — batas departemen tetap berlaku |
| **Pendaftaran akun mandiri** | Karyawan mengajukan akun sendiri lewat web |
| **Persetujuan oleh atasan** | Kepala departemen menyetujui pengajuan **departemennya sendiri saja** |
| Penautan WhatsApp mandiri | Lewat kode verifikasi 6 angka, **12/12 uji lolos** |
| **Pembatas pemakaian** | 20 pertanyaan/jam, 80/hari per karyawan |
| **Jumlah pemakaian & biaya per jawaban** | Ditampilkan di bawah tiap jawaban |

**Keputusan keamanan penting.** Awalnya kepala departemen dapat memilih
departemen mana pun saat menyetujui pengajuan. Ini berbahaya: kepala Marketing
bisa mengangkat seseorang menjadi kepala HR, yang otomatis memberi akses ke
data gaji. Wewenangnya dibatasi ke departemen masing-masing, dan dibuktikan
lewat percobaan penembusan:

| Percobaan dari kepala Marketing | Hasil |
|---|---|
| Mengangkat pendaftar jadi kepala HR | **Ditolak** |
| Memindahkan pendaftar ke departemen HR | **Ditolak** |
| Menolak pengajuan departemen HR | **Ditolak** |
| Menyetujui pendaftar Marketing | Berhasil (memang boleh) |

---

## 3. Hasil yang Bisa Diukur

### Pengujian otomatis

Seluruhnya dapat dijalankan ulang kapan saja untuk memastikan tidak ada yang
rusak setelah perubahan.

| Pengujian | Yang diperiksa | Hasil |
|---|---|---|
| Penyaring perintah SQL | Perintah berbahaya ditolak | **20/20** |
| Izin database | Batas baca per departemen & jabatan | **8/8** |
| Tabel ringkasan | Angka cocok dengan hitungan manual | **12/12** |
| Isolasi WhatsApp | Batas departemen lewat WhatsApp | **17/17** |
| Pembatas pemakaian | Kuota & pencatatan | **21/21** |
| Kode verifikasi | Sekali pakai, kedaluwarsa, bentrokan | **12/12** |
| Wewenang persetujuan | Kepala tidak bisa lintas departemen | **11/11** |
| Penahan jawaban karangan | Jawaban palsu tidak ditampilkan | **8/8** |
| Perhitungan biaya | Rumus & pembacaan pengaturan | **14/14** |
| Format pesan WhatsApp | Tabel diubah jadi daftar | **8/8** |

### Ketepatan jawaban

Diuji dengan pertanyaan nyata, jawabannya dicocokkan dengan query manual:

| Pertanyaan | Waktu | Hasil |
|---|---|---|
| Omzet bulan Agustus | 5 detik | ✅ Rp 457.383.190 |
| Produk paling laris | 9 detik | ✅ Tepat, bahkan membedakan "laris" dari sisi jumlah vs nilai |
| Kampanye dengan ROAS terbaik | 9 detik | ✅ Tepat, disertai catatan keterbatasan data |
| Jumlah karyawan aktif | 3 detik | ✅ 223 orang |
| Rata-rata gaji pokok (kepala HR) | — | ✅ Rp 9.198.565 |
| Rata-rata gaji pokok (staf HR) | — | ✅ Ditolak, sesuai harapan |

### Cakupan sistem

| Item | Jumlah |
|---|---|
| Departemen | 2 (Marketing, HR) |
| Tabel & tampilan data | 23 tabel + 5 ringkasan (Marketing), 21 tabel (HR) |
| User database dengan izin berbeda | 7 |
| Berkas kode | ±95 |
| Perintah pengujian otomatis | 11 |

---

## 4. Pembelajaran yang Diperoleh

**Jawaban salah yang terlihat meyakinkan lebih berbahaya daripada sistem yang
mengaku gagal.** Model AI gratis pernah menghasilkan daftar rapi berisi
"Karyawan dengan nama [Nama Karyawan]" lengkap dengan angka total yang diambil
dari percakapan sebelumnya. Dibaca sekilas, tampak seperti data sungguhan.
Sejak itu jawaban semacam ini ditahan, bukan sekadar diberi tanda.

**Menguji sesuatu di luar kondisi aslinya memberi hasil yang terlalu
optimistis.** Dua model AI sempat dinilai layak pakai berdasarkan uji
sederhana. Setelah diukur ulang lewat aplikasi yang sebenarnya, keduanya jauh
lebih buruk — salah satunya menghasilkan angka **12,7% lebih tinggi** dari
yang benar, disajikan dengan sangat meyakinkan. Catatan penilaiannya diralat.

**Dokumentasi resmi dan keterangan teknis tidak selalu sesuai kenyataan.**
Ditemukan lima kasus di mana cara yang "seharusnya benar" lolos pemeriksaan
tetapi tidak berfungsi saat dijalankan — pengaturan yang diterima tetapi
diabaikan diam-diam, nama data yang berbeda dari yang dijanjikan. Semuanya
baru ketahuan setelah hasil akhirnya diperiksa langsung, bukan diasumsikan.

**Keamanan sebaiknya ditegakkan di lapisan yang tidak bisa dibujuk.** Batas
antar departemen tidak hanya ditulis sebagai instruksi kepada AI, tetapi
dipasang sebagai izin di database. Terbukti berguna: instruksi bisa dicoba
ditembus dengan kalimat, izin database tidak bisa.

---

## 5. Kendala yang Dialami

**Keterbatasan memori laptop (8 GB).** Ini kendala paling sering muncul. Proses
pembuatan aplikasi gagal di tengah jalan, model AI lokal tidak bisa dimuat, dan
tampilan sempat error — semuanya berakar pada memori yang habis, bukan
kesalahan kode. Salah satunya diatasi dengan memindahkan pemeriksaan kode agar
berjalan berurutan, bukan bersamaan, sehingga kebutuhan memorinya turun.

**Perubahan sering terlihat tidak berfungsi padahal hanya belum dijalankan
ulang.** Aplikasi memuat kodenya sekali saat dinyalakan, sehingga perbaikan
baru terpakai setelah dinyalakan ulang. Terjadi beberapa kali dan sempat
membuang waktu sebelum polanya dikenali.

**Model AI gratis belum cukup andal.** Hanya sekitar 1 dari 3 jawaban yang
benar, dengan tiga bentuk kegagalan berbeda. Tetap disediakan sebagai pilihan
karena datanya tidak keluar dari komputer dan tidak berbiaya, namun diberi
peringatan jelas di antarmuka.

---

## 6. Yang Belum Selesai

| Item | Keterangan |
|---|---|
| Pengujian menyeluruh dengan pertanyaan nyata | Direncanakan untuk dua departemen sekaligus |
| Alamat akses tetap | Alamat masih berganti tiap dinyalakan ulang; perlu nama domain |
| Penghematan biaya AI | Peluang penghematan besar teridentifikasi, belum dikerjakan |
| Pembedaan jabatan di Marketing | Belum ada; HR sudah punya |

---

## 7. Penutup

Selama tiga hari, sistem berkembang dari prototipe satu departemen menjadi
portal yang dapat dipakai dua departemen, dengan pembatasan akses berlapis,
akses lewat WhatsApp, pendaftaran akun mandiri, dan pencatatan biaya.

Seluruh keputusan penting didukung pengukuran, dan setiap pengujian dapat
dijalankan ulang untuk memastikan sistem tetap berfungsi setelah perubahan.
Kekeliruan penilaian yang ditemukan di tengah jalan diralat dan dicatat
alasannya, agar tidak terulang.
