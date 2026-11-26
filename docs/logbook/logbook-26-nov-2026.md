# Logbook Harian — Portal AI Assistant Departemen

**Tanggal:** Kamis, 26 November 2026
**Proyek:** Menelusuri kenapa sebagian besar alat AI tidak bisa dipakai akun akun IT (ridho), lalu memberi akun itu peran di aplikasi-aplikasi perusahaan
**Lokasi kerja:** folder `marketing/`

> **Temuan terbesar hari ini:** alat-alatnya tidak hilang. Di database perusahaan semua alat masih
> terpasang ke agentnya. Yang menahan adalah pemeriksaan izin di portal: akun ridho hanya punya peran di
> 2 dari 11 aplikasi, dan portal belum bisa menjalankan sebagian jenis alat.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Menelusuri alat per agent untuk akun ridho (hanya membaca) | Selesai |
| Memberi akun ridho peran di 8 aplikasi (menulis ke database perusahaan, atas izin user) | Selesai, ada cadangan |
| Membuka izin ganda, alat tulis umum, fungsi yang belum ada | Belum, perlu rancangan dulu |
| Keputusan alat di layar Kelola AI | Belum, dikerjakan user |

---

## Entri 1 — Penelusuran (hanya membaca)

Perakit alat portal dijalankan untuk akun ridho tanpa memanggil model. Dari ±300 alat yang terdaftar di
agent, hanya **80** yang bisa dipakai. Sebabnya:

| Sebab | Kira-kira jumlah alat |
|---|---:|
| Akun tidak punya peran di 9 aplikasi, jadi izinnya tidak ada | ±130 |
| Jenis alat tulis (tambah, ubah, hapus) belum bisa dijalankan portal | ±120 |
| Syarat izin ganda (`"a:read,b:read"`) dibandingkan sebagai satu teks, jadi tidak pernah lolos | ±80 |
| Fungsi khusus belum ada di portal (papan kerja, monitoring DIS, dll.) | ±20 |
| Alat tulis tim lain belum disetujui di Kelola AI | 4 |

Selain itu ada **21 alat baru tim lain yang menunggu keputusan** di Kelola AI, dan **13 alat yang
setelannya tidak cocok** (dibatasi "milik sendiri" tapi datanya tidak punya kolom untuk itu). Kedua
kelompok ini tidak sampai ke agent sama sekali.

Ada koreksi di tengah penelusuran. Awalnya 20 alat buatan portal dikira mati. Ternyata tanda "tidak
aktif" pada alat milik kita artinya "tidak dibagikan ke sistem tim lain", dan alat itu tetap dipakai
portal.

## Entri 2 — Memberi peran (menulis ke database perusahaan)

Atas permintaan dan izin user, akun ridho diberi peran terlengkap di tiap aplikasi yang punya alat AI.
Ditulis lewat skrip baru `scripts/beri-peran-lengkap.mts`:
- uji coba dulu tanpa menyimpan;
- satu transaksi;
- hanya menambah, dengan penjaga supaya peran dan aplikasi lain tidak berubah.

| Aplikasi | Peran yang ditambahkan |
|---|---|
| Approval, CMOD, Marketing, Report, Super Tools | Super Admin |
| MAPS | MAPS - Budget Control |
| Upload DIS, PickPack (aplikasi baru di akun) | Super Admin |

- Izin akun naik menjadi 490.
- Cadangan isi lama ada di `data/peran-lengkap-cadangan-ridho-2026-11-26T03-35-56-675Z.json`. Bisa dikembalikan dengan `--batal`.
- ⚠️ Peran ini juga berlaku di aplikasi perusahaan yang sungguhan, termasuk hak menghapus data. Pemilik aplikasinya sebaiknya diberi tahu.

**Hasil sesudahnya:** alat yang bisa dipakai naik dari **80 menjadi 104**. Agent DIS dan PickPack tidak
terkunci lagi. **Tidak ada lagi alat yang tertahan karena kurang peran.** Sisa 229 alat tertahan karena
sebab di bawah.

| Sebab sisa | Jumlah alat |
|---|---:|
| Jenis alat tulis belum bisa dijalankan portal | 123 |
| Syarat izin ganda | ±79 |
| Fungsi khusus belum ada di portal | 23 |
| Alat tulis tim lain belum disetujui | 4 |

User lalu meminta: **jangan ada lagi perubahan izin di database perusahaan.** Yang diinginkan adalah portal
membaca agent dan alat persis seperti sistem tim lain. Peran yang sudah diberikan dibiarkan dulu.

## Entri 3 — Cara sistem tim lain bekerja (hanya membaca)

Dibaca dari tabel milik sistem mereka di database perusahaan. Hanya angka ringkas, isi percakapan tidak dibuka.

| Temuan | Sumber |
|---|---|
| Izin dicek dari peran **di aplikasi pemilik alat**. Pesan tolaknya: "Role Anda di aplikasi Upload DIS tidak memiliki akses ke menu yang dibutuhkan (file-list:read)" | `ai_tool_log` (1.180 catatan, 28 Sep – 5 Nov) |
| Ada aturan cakupan khusus per peran: 32 alat Super Tools bercakupan "bawahan", tapi Super Admin Super Tools melihat "semua" | `ai_tool_cakupan` |
| Alat tulis tambah, ubah, hapus sudah mereka jalankan: 157 tulisan berhasil | `ai_aksi_draft` |
| Arti koma di izin ganda belum bisa dipastikan dari data | — |

## Entri 4 — Penyelarasan di backend portal (tanpa mengubah database)

| Perubahan | Berkas |
|---|---|
| Izin disimpan per aplikasi, ditambah daftar peran pemakai | `lib/akses-aplikasi.ts` |
| Pemeriksaan izin bersama: per aplikasi pemilik alat, izin ganda dipecah, pesan tolak mirip tim lain | `lib/izin-tool.ts` (baru) |
| Pemeriksaan itu dipakai waktu alat dirakit **dan** waktu tombol Simpan | `voltagent/tool-konfigurasi.ts`, `app/api/entri/umum/route.ts` |
| `ai_tool_cakupan` ikut dibaca, dan cakupan khusus per peran dipakai | `lib/ai-konfig.ts`, `voltagent/tool-konfigurasi.ts` |
| Tiga saklar baru di `.env.local`. Bawaannya sama dengan perilaku lama | `lib/ai-konfig.ts`, `lib/izin-tool.ts` |

Saklar baru:
- `IZIN_GANDA` = `semua` (bawaan) atau `salah-satu`;
- `TINJAU_TOOL_BARU` = `nyala` (bawaan) atau `mati`, sehingga alat baru tim lain langsung dipakai;
- `ALAT_PORTAL` = `ganti` (bawaan), `tambah`, atau `tanpa`, yang mengatur apakah alat buatan portal menggantikan, menambah, atau tidak dipakai sama sekali.

Pengecualian: alat **buatan portal** tetap memakai izin gabungan. Kalau dicek per aplikasi,
`asisten_antrean_tiket` hilang untuk semua orang, karena izinnya hanya ada di Admin Console sedangkan alatnya
tercatat di Portal.

**Uji:**
- Uji baru `test:izin-tool`: 22 lolos.
- `test:tool-konfig` 54, `test:akses-app` 20, `test:agent-konfig` 23, `test:jalur` 12, `test:penjaga` 26, `test:wa` 8, dan `test:alur-semua`: semuanya lolos.
- `test:konfig`: 20 lolos, 2 gagal. Keduanya sudah ada sebelum hari ini:
  - satu hilang kalau antrean tinjauan dimatikan;
  - satu karena `tambah_kartu_papan_kerja` termasuk 13 alat yang setelannya tidak cocok.
- Pemeriksaan tipe: tidak ada error di berkas yang diubah.

## Entri 5 — Perbandingan saklar (tanpa model)

Jumlah alat yang bisa dipakai. "Karyawan biasa" adalah satu akun acak pemegang peran Head Office di
Super Tools.

| ALAT_PORTAL / TINJAU / IZIN_GANDA | ridho | karyawan biasa |
|---|---:|---:|
| Sebelum hari ini | 80 | – |
| ganti / nyala / semua (bawaan baru) | 143 | 14 |
| ganti / nyala / salah-satu | 143 | 37 |
| ganti / mati / semua | 151 | 14 |
| tambah / nyala / semua | 153 | 16 |
| tanpa / nyala / semua (persis tim lain) | 134 | 8 |

- **Izin ganda**: untuk akun ridho tidak ada bedanya, tapi untuk karyawan biasa 14 lawan 37. Perlu jawaban tim lain sebelum diganti.
- **Tinjauan dimatikan**: ridho mendapat 9 alat tambahan. 12 dari 21 alat yang ditahan butuh fungsi yang belum ada di portal.
- **`tambah`** membuat alat dobel atas data yang sama (`tiket_helpdesk` dan `asisten_tiket`, `aset_saya` dan `asisten_aset`).
- **`tanpa`** menghilangkan alat buatan portal yang tidak ada padanannya: SOP, ramalan penjualan, riset pasar, dan stok kosong.
- **Uji langsung alat yang baru terbuka**: `absensi_karyawan` dan `order_outlet` memakai cakupan "semua" karena peran Super Admin Super Tools, dan `postingan_medsos` mengembalikan 50 baris.

## Entri 6 — Uji langsung dengan Gemma 12B (akun ridho)

Jalurnya sama dengan chat web, termasuk batas alat untuk server kantor (15 alat per agent). Saklar memakai
bawaan. Ada lima pertanyaan, dan **semuanya diteruskan ke agent yang benar, lalu alatnya terpanggil**.

| Pertanyaan | Alat | Hasil | Waktu |
|---|---|---|---:|
| Tiket helpdesk saya yang belum selesai | `asisten_tiket` | Dijawab | 47 dtk |
| Akun media sosial yang dipantau | `akun_medsos` (izin ganda) | **Gagal**, lalu dijawab "tidak ada data" | 52 dtk |
| 5 data outlet terbaru (Super Tools) | `data_outlet` (cakupan per peran) | **Gagal**, lalu dijawab "tidak dapat menampilkan" | 51 dtk |
| Kiriman PickPack terbaru | `kiriman_pickpack` (agent baru terbuka) | Dijawab, tabel dari data | 70 dtk |
| Harga produk CMOD | `harga_cmod` (izin ganda) | **Gagal**, lalu dijawab "tidak memberikan data" | 39 dtk |

**Penyebab gagal:** sesudah alat mengembalikan data, permintaan berikutnya ke Gemma menjadi 9.000–12.000
token. Server Gemma hanya menampung 8.192 token, jadi permintaan itu ditolak.

Diuji ulang dengan batas 8 alat:
- Marketing berhasil, dan daftar akun tampil lengkap.
- Super Tools dan CMOD tetap gagal (±10.000 token). Untuk dua agent itu, yang terlalu besar adalah hasil alatnya, bukan daftar alatnya.

**Masalah kedua, lebih serius:** waktu agent bawahan gagal, perute menjawab seolah datanya kosong. Jawaban
seperti itu menyesatkan pemakai.

## Entri 7 — Uji ulang dengan Claude Haiku 4.5

Pertanyaan dan akunnya sama. Haiku memegang semua alat, tanpa batas.

| Pertanyaan | Alat | Hasil | Waktu |
|---|---|---|---:|
| Tiket helpdesk saya | `asisten_tiket` | Dijawab: tidak ada tiket terbuka | 6 dtk |
| Akun media sosial | `akun_medsos` | Dijawab lengkap (30 akun) | 14 dtk |
| 5 data outlet terbaru | – | Tidak memanggil alat; balik bertanya minta filter (kota, tipe, salesman) | 6 dtk |
| Kiriman PickPack terbaru | `kiriman_pickpack` | Menyaring ke "hari ini" lalu menjawab belum ada kiriman. Gemma menampilkan data terakhir (30 Okt) | 5 dtk |
| Harga produk CMOD | – | Tidak memanggil alat; balik bertanya nama produk / SKU | 5 dtk |

- Tidak ada galat batas kapasitas, dan semua jawaban sesuai keadaan sebenarnya.
- Tapi dua permintaan yang sebenarnya jelas ("tampilkan 5") dijawab dengan pertanyaan balik.
- Satu permintaan "terbaru" diartikan "hari ini".

## Entri 8 — Agent memahami pertanyaan dan alatnya

| Perubahan | Berkas |
|---|---|
| Keterangan tiap alat baca untuk model ditambah **urutan hasilnya** (mis. "turun, terbaru dulu") dan "semua filter opsional". Diturunkan dari setelan, tanpa menyebut nama alat | `voltagent/tool-konfigurasi.ts` |
| Parameter baru `batas_baris` di setiap alat baca: "tampilkan 5" benar-benar mengambil 5 baris. Model hanya bisa mengurangi, tidak menambah | `voltagent/tool-konfigurasi.ts` |
| Instruksi agent: daftar umum / "terbaru" → panggil alat tanpa filter; "terbaru" ≠ filter hari ini; alat yang tidak berurutan waktu tetap ditampilkan sambil disebut urutannya | `voltagent/agent-konfig.ts` |
| Status serah-tugas baru **`galat-model`**: teks agent bawahan kosong atau berisi galat kapasitas → perute wajib bilang gagal, bukan "tidak ada data" | `lib/alur/kemampuan.ts`, `lib/alur/penjaga-alur.ts` |
| Batas baris khusus model server kantor (`MAKS_BARIS_SERVER`, bawaan 10). Qwen/gateway sengaja tidak, supaya angka benchmark tetap sebanding | `voltagent/agent-konfig.ts`, `voltagent/jalur-agent.ts`, `app/api/chat/route.ts` |

**Uji:**
- `test:izin-tool`: 26 lolos (ditambah uji galat model).
- `test:tool-konfig`: 54 lolos (uji nama parameter disesuaikan dengan `batas_baris`).
- `test:agent-konfig`, `test:jalur`, `test:penjaga`, `test:wa`, `test:alur-semua`: semua lolos.

**Uji langsung ulang (akun ridho):**

| Pertanyaan | Haiku sebelum → sesudah | Gemma sebelum → sesudah |
|---|---|---|
| Tiket helpdesk | ✅ → ✅ | ✅ (tidak diulang) |
| Akun media sosial | ✅ → ✅ | ❌ "tidak ada data" → ⚠️ **jujur**: "gagal diproses karena data terlalu besar" |
| 5 data outlet terbaru | ⚠️ bertanya balik → ✅ 5 outlet + penjelasan urutan | ❌ → ✅ |
| Kiriman PickPack terbaru | ⚠️ "hari ini" kosong → ✅ kiriman terbaru | ✅ (tidak diulang) |
| 5 harga CMOD | ⚠️ bertanya balik → ✅ 5 dari 1.063 | ❌ → ✅ |

Catatan Gemma:
- Untuk Marketing masih kepenuhan. Dengan batas 8 alat (uji sebelumnya), Marketing berhasil.
- Di tabel outlet, satu nama outlet yang berisi karakter aneh disalin Gemma dari baris di atasnya. Haiku menampilkannya apa adanya.

---

## Belum dikerjakan

- Gemma: pertimbangkan `MAKS_TOOL_SERVER=8` (Marketing berhasil dengan 8 alat).
- Gemma 12B: minta server kantor menaikkan kapasitas di atas 8.192 token, atau uji memakai Qwen3 14B (server EC2 harus dinyalakan).
- Memilih saklar dan mengisinya di `.env.local` (user).
- Menanyakan arti izin ganda ke tim lain.
- Alat tulis umum (tambah, ubah, hapus): ±150 alat. Butuh hak tulis di PostgreSQL dari tim IT.
- Penangan khusus yang belum ada: 35–47 alat.
- Di Kelola AI (user): setujui 4 alat tulis, sambungkan `asisten_pengajuan`.
- Memberi tahu pemilik aplikasi soal peran baru akun ridho, dan tim pemilik 13 alat yang setelannya tidak cocok.
