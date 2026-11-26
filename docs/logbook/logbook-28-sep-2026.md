# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Senin, 28 September 2026
**Proyek:** Asisten AI untuk menjawab & mencatat data departemen
**Lokasi kerja:** folder `marketing/`

> Sebelum hari ini, sistem hanya bisa **menjawab pertanyaan**. Hari ini
> ditambahkan kemampuan **mencatat data**, lengkap dengan pembatalan dan
> persetujuan.

---

## Entri 1 — Pencatatan data penjualan

**Waktu:** pagi

**Uraian kegiatan**

Dibangun kemampuan mencatat penjualan lewat percakapan biasa. Karyawan cukup
mengetik *"catat penjualan 4 Masker Beras 100g ke UD Sentosa Bekasi"*, lalu
sistem menampilkan **rancangan** berisi nama pelanggan, barang, harga, dan
total — belum tersimpan. Data baru masuk setelah karyawan menekan tombol
Simpan.

Prinsip yang dipegang dan menentukan seluruh rancangan berikutnya: **AI tidak
diberi satu pun alat yang bisa menulis ke database.** AI hanya menyusun
rancangan; yang menyimpan adalah tombol yang ditekan manusia. Dengan begitu,
salah tafsir paling buruk pun hanya menghasilkan rancangan keliru yang bisa
ditolak.

Harga selalu diambil dari database, bukan dari yang diketik karyawan. Tiap
rancangan diberi "sidik jari" — bila angkanya diubah di tengah jalan, sidiknya
tidak cocok dan penyimpanan ditolak.

Ditambahkan juga jalur yang sama lewat WhatsApp, dengan konfirmasi balasan
**YA** atau **BATAL**.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Aturan penyimpanan & pemalsuan angka | **15/15 lolos** |
| Jalur dari tombol di layar | **12/12 lolos** |

Dibuktikan berurutan dari ujung ke ujung: sistem ditanya total pembelian
pelanggan (336 unit), dicatat penjualan baru 4 unit, lalu ditanya ulang dengan
pertanyaan yang sama — jawabannya berubah jadi 340 unit. Data ujinya kemudian
dihapus.

**Temuan penting**

**AI sempat mengaku sudah menyimpan padahal belum.** Saat karyawan membalas
"ya", AI menjawab *"data telah dikonfirmasi dan masuk ke sistem untuk
diproses"* — padahal tidak ada satu baris pun yang tersimpan. Aturan lama
hanya melarang AI *menyimpan*; ternyata itu tidak melarangnya *mengaku sudah
menyimpan*. Aturannya diperketat.

**Kendala**

Tombol Simpan sempat tidak muncul di layar. Ditelusuri berlapis — kode, data
yang dikirim, dan hasil akhirnya semua terbukti benar. Penyebabnya ternyata
halaman di peramban masih memakai versi lama yang belum dimuat ulang. Memakan
waktu cukup lama sebelum polanya ketahuan.

---

## Entri 2 — Pembatalan & koreksi data

**Waktu:** siang

**Uraian kegiatan**

Setelah pencatatan jadi, muncul kebutuhan yang jelas: salah catat harus bisa
dibetulkan. Sebelumnya satu-satunya cara adalah masuk langsung ke database
sebagai administrator — dan cara itu tidak meninggalkan jejak siapa menghapus
apa.

Dibangun jalur pembatalan dengan tiga aturan yang disepakati lebih dulu:
hanya orang yang mencatat yang boleh membatalkan, paling lama **2 jam** setelah
dicatat, dan alasannya **wajib** diisi.

Pembatalan tidak menghapus datanya, hanya mengubah statusnya jadi
"dibatalkan". Seluruh laporan otomatis mengabaikan status itu, jadi angkanya
langsung bersih tanpa mengubah satu pun laporan.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Batas izin di database | **11/11 lolos** |
| Aturan pembatalan | **26/26 lolos** |
| Jalur dari tombol di layar | **15/15 lolos** |
| Penguraian balasan WhatsApp | **36/36 lolos** |

Diuji dari sisi penyalahgunaan: membatalkan pesanan orang lain ditolak,
mengaku sebagai orang lain ditolak, dan data lama hasil impor tidak bisa
dibatalkan sama sekali.

**Temuan penting**

**Kata "BATAL" di WhatsApp punya dua arti.** Saat yang ditunggu adalah
konfirmasi pembatalan, "BATAL" bisa berarti *"ya, batalkan pesanannya"* atau
*"jangan jadi membatalkan"*. Salah tebak berarti mengubah data yang tidak
dimaksud. Kata itu akhirnya tidak ditebak sama sekali — sistem meminta
pengguna memperjelas.

**AI mengira pembatalan belum terjadi.** Setelah sebuah pesanan dibatalkan,
karyawan menanyakan totalnya. AI menyebut angka yang benar, lalu menambahkan
saran mengurangi angka itu "kalau pesanannya jadi dibatalkan" — padahal sudah.
Kalau diikuti, angkanya berkurang dua kali. Ini kebalikan persis dari temuan
pagi, dan sumbernya sama: AI tidak pernah diberi tahu hasil penekanan tombol.
Sekarang ia dilarang berspekulasi ke kedua arah.

**Kendala**

Ditemukan data uji dari pengujian yang terhenti di tengah tertinggal di
database dan ikut terhitung sebagai omzet. Dibersihkan, dan sejak itu setiap
pengujian membersihkan sisa percobaan sebelumnya di awal.

---

## Entri 3 — Pencatatan & persetujuan data HR

**Waktu:** sore

**Uraian kegiatan**

Departemen HR sebelumnya hanya bisa membaca data. Ditambahkan kemampuan
mencatat, dengan pembagian tugas per jabatan:

- **Kepala HR** — mencatat lembur, serta menyetujui/menolaknya
- **Staf HR** — mencatat pelamar kerja baru

Pembagian ini bukan sekadar aturan tampilan. Nilai rupiah lembur dihitung dari
gaji karyawan, sementara staf HR memang tidak berhak melihat gaji. Sebaliknya,
data pelamar tidak menyentuh gaji sama sekali, sehingga aman dikerjakan staf.

Sebelum itu ditemukan bahwa cara pengaturan izin yang lama akan memberi HR
akses ke alat pencatatan **penjualan** — milik departemen Marketing.
Pengaturannya dirombak lebih dulu agar izin dinyatakan per jenis data **dan**
per jabatan.

Rencana awal mencakup persetujuan **cuti** juga, tetapi dibatalkan setelah
datanya diperiksa: di perusahaan ini cuti disetujui **atasan langsung**
pemohon (458 dari 465 data), bukan kepala HR.

**Hasil terukur**

| Yang diuji | Hasil |
|---|---|
| Perombakan pengaturan izin | **6/6 lolos** |
| Batas izin database HR | **13/13 lolos** |
| Aturan pencatatan lembur | **38/38 lolos** |
| Jalur tombol lembur | **13/13 lolos** |
| Aturan pencatatan pelamar | **40/40 lolos** |
| Jalur tombol pelamar | **14/14 lolos** |
| Aturan persetujuan | **28/28 lolos** |

Pemisahan tugas terbukti mengikat di kedua arah: staf HR yang mencoba mencatat
lembur ditolak, dan kepala HR yang mencoba memasukkan pelamar juga ditolak.
Jalur persetujuan juga terbukti tidak bisa dipakai mengubah jumlah jam maupun
nilai rupiahnya.

**Temuan penting**

**Perhitungan nilai lembur hampir salah di setiap baris.** Rumus perusahaan
membulatkan hasilnya ke ratusan rupiah terdekat. Pembulatan biasa yang semula
dipakai cocok dengan **0 dari 585** data; setelah dibetulkan, **585 dari 585**.

**Jabatan tertentu tidak berhak lembur.** Terlihat dari data: 16 orang di
tingkat Manajer ke atas tidak punya satu pun catatan lembur, sementara tingkat
Staf, Operator, dan Supervisor punya 585 — sesuai aturan ketenagakerjaan.
Aturannya dipasang, sehingga percobaan mencatat lembur untuk Direktur ditolak
beserta penjelasannya.

**Nama karyawan tidak unik.** Ditemukan dua karyawan dengan nama, departemen,
dan jabatan sama persis — pembedanya hanya nomor induk. Sistem tidak menebak:
ia menampilkan pilihan beserta nomor induk dan menunggu pengguna memilih.

**Sistem tidak tahu hari ini tanggal berapa.** Ketahuan saat mencoba mencatat
lembur "kemarin": AI justru balik bertanya tanggalnya. Ternyata tanggal
sekarang tidak pernah diberitahukan kepadanya. Dampaknya luas — kata "bulan
lalu", "minggu ini", "tahun ini" pada **semua** pertanyaan selama ini
diterjemahkan AI berdasarkan perkiraannya sendiri. Sudah diperbaiki.

**"Datanya tidak ada" tidak sama dengan "saya tidak boleh melihatnya".** Saat
staf HR menanyakan total biaya lembur, AI menjawab bahwa database tidak
mencatat biaya lembur. Keliru — datanya ada, stafnya yang tidak berhak.
Bahayanya bukan teknis: staf bisa meneruskan kekeliruan itu ke atasannya.
Sekarang jawabannya: *"Kolom tersebut ada di database, tapi izin akun saya
tidak mencakupnya. Coba tanyakan ke kepala HR."*

**Kendala**

Pengujian langsung lewat WhatsApp belum dilakukan karena perlu penyalaan ulang
layanan. Dijadwalkan besok.

---

## Ringkasan Hari Ini

| Item | Jumlah |
|---|---|
| Jenis data yang bisa dicatat | 3 (penjualan, lembur, pelamar) |
| Alur baru | 2 (pembatalan, persetujuan) |
| Perintah pengujian otomatis baru | 12 |
| Pemeriksaan yang sudah dijalankan hari ini | **237** |
| Berkas kode tersentuh | ±90 |

**Benang merah tiga temuan hari ini:** AI berkali-kali **menebak hal yang
tidak ia ketahui** — mengaku sudah menyimpan, mengira pembatalan belum
terjadi, menyimpulkan data tidak ada padahal hanya tidak boleh dilihat, dan
menerka tanggal hari ini. Semuanya bukan kesalahan perhitungan, melainkan AI
mengisi kekosongan informasi dengan dugaan yang terdengar meyakinkan. Empatnya
diperbaiki dengan cara yang sama: memberitahu apa yang sebenarnya tidak ia
ketahui, dan melarangnya menduga.

**Rencana besok:** pengujian langsung lewat WhatsApp untuk kedua peran HR.
