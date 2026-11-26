# Rencana: unggah dokumen penjualan lewat chat

Dokumen serah-terima untuk yang mengerjakan berikutnya. Ditulis 5 Okt 2026.

**Tujuan:** karyawan marketing mengunggah data penjualan (PDF/gambar) lewat
chat portal. Isinya tersimpan, di-embed, dan bisa ditemukan rekan marketing
lain. Kalau orang IT atau HR bertanya soal penjualan, dokumen itu **tidak
muncul sama sekali**.

---

## Konteks singkat

Portal ini asisten AI internal (Next.js 16 + VoltAgent + Claude). Basis
pengetahuannya ada di schema `ai_knowledge` pada PostgreSQL perusahaan
(`mustika_ratu_dev`) — **dibangun dan dimiliki tim lain**, bukan kita.

Tiga tabel:

| Tabel | Isi | Catatan |
|---|---|---|
| `documents` | 59 baris, metadata | `title` + `kind` wajib, sisanya ada default |
| `chunks` | 98 baris, isi + `embedding vector(768)` | ini yang dicari |
| `processing_logs` | jejak tiap tahap | `kind`: sync/upload/ocr/embed/settings |

`kind` pada `documents` dibatasi CHECK: `guide` / `faq` / `upload`.

Pipeline mereka sudah lengkap dan berjalan: unggah → S3 → OCR (tesseract,
cadangan Claude) → potong + halaman/baris → embed → `status='embedded'`.
Terukur ~5 detik untuk PDF 2 halaman.

---

## SUDAH SELESAI — jangan dikerjakan ulang

### Penyaringan per departemen di pencarian

Sudah ada dan **sudah diverifikasi**:

- `lib/kb/cari.ts` → `cariSop(tanya, { departemen })` dan
  `daftarSop(departemen)` menyaring dengan
  `(access_menus IS NULL OR access_menus = $n)`
- `voltagent/agents.ts` baris ~767 meneruskan `dep.id` ke
  `buatToolCariSop()` dan `buatToolDaftarSop()`

Diuji 5 Okt dengan menandai satu dokumen `access_menus='marketing'` di dalam
transaksi lalu `ROLLBACK`:

```
marketing  melihat 2 potongan  KETEMU
it         melihat 0 potongan  tidak ketemu
hrd        melihat 0 potongan  tidak ketemu
```

⚠️ `access_menus IS NULL` berarti **terbuka untuk semua**, bukan tertutup.
Itu disengaja: 59 dokumen yang ada sekarang semuanya `null`, dan kalau `null`
diperlakukan sebagai tertutup, seluruh panduan hilang dari semua orang begitu
penyaringnya menyala.

### Vektorisasi

98 potongan sudah punya vektor, `multilingual-e5-base@q8`, 768 dimensi,
satu ragam. Kolom `chunks.embedding` sudah dipatok `vector(768)`.

### Uji penyaringan akses

`npm run test:akses` (`-- --agent` untuk uji kebocoran lewat model).
15 assertion, lolos semua. Menandai dokumen dummy sementara lalu
membersihkannya di `finally`, dan pembersihannya diperiksa sebagai assertion
terakhir.

### Rujukan letak

`cariSop` sudah membawa `halaman`, `barisAwal`, `barisAkhir` (dari kolom
`page_start` / `line_start` / `line_end`), dan `voltagent/tools-kb.ts` →
`rujukan()` menampilkannya **hanya kalau ada**. Dokumen hasil OCR punya;
panduan yang disinkronkan dari tabel tidak, dan tidak boleh dikarang.

---

## SELESAI 6 Okt — jalur unggah sudah jalan ujung ke ujung

Dikerjakan Codex (5 Okt), diperiksa dan diperbaiki 6 Okt. Jalur yang dipilih
**(B) portal menulis sendiri**, bukan (A) endpoint mereka — karena sampai
sekarang tim pemilik `ai_knowledge` belum menjawab (lihat bagian Diblokir).

Buktinya: `npm run test:unggah` — 19 pemeriksaan, berkas uji ditulis lalu
dihapus lagi, jumlah baris mereka dihitung sebelum dan sesudah.

| Berkas | Isinya |
|---|---|
| `lib/kb/unggah.ts` | baca → potong 1800 huruf (+ halaman & baris) → embed → tulis `documents`+`chunks`+`processing_logs` dalam SATU transaksi |
| `app/api/knowledge/documents/route.ts` | endpoint unggah, wajib login, wajib judul |
| `app/api/knowledge/documents/[id]/file/route.ts` | sajikan berkas asli, saring `access_menus`, balas **404 bukan 403** |
| `lib/dokumen/ocr-tesseract.ts` | OCR gambar lewat tesseract lokal |
| `scripts/buat-pg-ingest.mts` | role `ai_ingest` — SELECT+INSERT saja |
| `scripts/pasang-ocr-ind.mts` | pasang berkas bahasa Indonesia untuk OCR |
| `scripts/test-unggah-pengetahuan.mts` | uji ujung-ke-ujung + bersih-bersih |

### ⚠️ Enam hal yang ditemukan waktu pemeriksaan 6 Okt

Lima pertama tidak bikin galat apa pun — itu sebabnya perlu ditulis di sini.

**1. Fitur unggahnya TIDAK PERNAH BERHASIL SEKALI PUN.** Role `ai_ingest`
tidak diberi hak atas `processing_logs_id_log_seq`. Tiap unggahan jalan mulus
sampai INSERT terakhir, kena `permission denied for sequence`, lalu seluruh
transaksinya di-rollback. Tidak ada dokumen tersimpan, dan tidak ada jejak
galat di `processing_logs` — justru karena tabel ITU yang gagal. Typecheck,
lint, dan semua uji lain lolos. Satu-satunya cara menemukannya: benar-benar
menjalankan jalurnya sampai baris masuk database.
→ Sekarang hak sequence diberikan untuk **semua** sequence di schema lewat
loop, supaya tidak terulang tiap tabel baru ditambahkan tim lain.

**2. `embed_model` memakai pola kita, bukan pola mereka.** Ditulis
`Xenova/multilingual-e5-base`; 58 dokumen mereka memakai
`multilingual-e5-base@q8`. Vektornya benar, cuma labelnya. Akibatnya baru
terasa waktu mereka memigrasi model dan menjalankan
`WHERE embed_model = '...'` — dokumen kita terlewat, vektornya basi, jawaban
pelan-pelan jadi salah. → `LABEL_MODEL_EMBEDDING` di `voltagent/embedding.ts`
sekarang jadi satu-satunya sumber, dipakai `unggah.ts` dan
`scripts/embed-knowledge.mts`.

**3. `processing_logs.status = 'done'`** — nilai itu tidak ada di tabel
mereka. Yang ada `success` (311) dan `pending` (9). Kolomnya teks bebas jadi
database menerimanya; yang menolak adalah pemantauan mereka, diam-diam.
→ jadi `success`.

**4. OCR memakai model bahasa Inggris.** Installer Tesseract Windows cuma
memasang `eng` dan `osd`; `ind` tidak ada, dan `.env.local` sempat diisi
`eng` supaya tidak error. OCR tetap jalan dan tetap menyimpan teks.

Diukur, dan hasilnya **tidak seperti dugaan awal** (`npm run banding:ocr`):

| Gambar | `-l eng` | `-l ind` |
|---|---|---|
| render tajam 1100px | 0,0% kata salah | 0,0% kata salah |
| mirip foto HP (495px, JPEG mutu 32, miring, berbercak) | **73,0%** | **41,3%** |

Jadi di teks bersih bahasa tidak berpengaruh sama sekali — dugaan "Inggris
pasti merusak kata Indonesia" salah untuk kasus itu. Bedanya baru muncul di
gambar yang jelek, dan polanya persis seperti yang dikhawatirkan:
"penjualan" → "peniualan", "triwulan" → "riwulan". Kata yang salah ketik
tidak akan cocok dengan pertanyaan user yang ejaannya benar.
→ `npm run pasang:ocr-ind`, bawaannya sekarang `ind`.

⚠️ Yang sama pentingnya: `ind` pun masih 41% salah di gambar seburuk itu.
**Memilih bahasa yang benar tidak menyelamatkan foto yang jelek.** Mutu
gambar yang diunggah tetap faktor terbesar.

**5. Hak `UPDATE` diberikan padahal tidak dipakai.** `unggahPengetahuan`
hanya INSERT. Dengan UPDATE, satu bug di portal kita (WHERE hilang, id salah)
bisa menimpa 58 panduan milik tim lain. → dicabut, dan `npm run test:unggah`
sekarang ikut memeriksa hak itu tiap kali jalan.

**6. Berkas yatim menumpuk di disk.** Baris database dihapus, berkasnya
tinggal. Ditemukan 3 berkas (1,4 MB) tanpa pemilik. → uji membersihkan
berkasnya sendiri. Belum ada penyapu otomatis untuk kasus tim lain menghapus
baris `documents` — lihat daftar di bawah.

### Jalur mana yang bisa dan tidak

Tidak berubah dari temuan 5 Okt — ini batas yang sudah terbukti:

| Jenis berkas | Portal kita | Pipeline mereka |
|---|---|---|
| PDF digital (teks tertanam) | bisa | bisa |
| Gambar PNG/JPG/WebP | bisa (tesseract lokal) | bisa (tesseract) |
| **PDF hasil scan / foto dokumen** | **TIDAK BISA** | **bisa** |

PDF scan ditolak dengan pesan jujur, bukan disimpan kosong. Penyebabnya tiap
halaman harus dirender jadi gambar dulu, dan itu butuh pustaka `canvas` yang
belum terpasang (`lib/dokumen/baca.ts` sekitar baris 124).

**Data penjualan sering berbentuk hasil pindai.** Jadi (A) tetap lebih kuat
begitu tim mereka menjawab — bukan karena lebih rapi, tapi karena pipeline
mereka bisa mengerjakan yang kita tidak bisa.

---

## YANG MASIH HARUS DIKERJAKAN

### 1. Penyapu berkas yatim

Kalau tim lain menghapus baris `documents` (dan mereka pernah menghapus tabel
kita tanpa pemberitahuan, 2 Okt), berkasnya tetap di
`data/knowledge-files/` — berisi data perusahaan, tanpa pemilik, tanpa
catatan. Perlu skrip yang mencocokkan isi folder dengan `id_document` lalu
menghapus yang tidak dirujuk. Logikanya sudah terbukti waktu membersihkan 3
berkas yatim 6 Okt; tinggal dijadikan skrip tetap.

### 2. Batas ukuran dan jumlah unggahan per user

Sekarang batasnya cuma `DOKUMEN_UKURAN_MAKS` (15 MB per berkas). Tidak ada
batas berapa banyak per hari. PDF 201 potongan butuh ~2 menit embedding —
beberapa unggahan sekaligus akan membuat portal tidak responsif.

### 3. Penolakan harus TIDAK TERLIHAT (periksa ulang)

Kalau orang IT bertanya soal penjualan, agent **tidak boleh** bilang
*"ada dokumennya tapi kamu tidak boleh melihat"*. Dari sisi IT, dokumen itu
memang tidak ada.

Secara teknis sudah benar — penyaring di SQL, dokumen tidak ikut terambil,
dan `npm run test:akses -- --agent` memeriksa kalimat agent-nya. Yang belum
diperiksa: kasus dokumen yang BARU diunggah marketing, bukan dokumen dummy.

### 4. Uji regresi — SUDAH ADA

`npm run test:akses` (penyaringan) dan `npm run test:unggah` (jalur unggah).
Jangan ditulis ulang. Kalau menambah kasus, ikuti aturan di bawah.

---

## ATURAN YANG TIDAK BOLEH DILANGGAR

1. **Penyaring di SQL, bukan di prompt.** Model bisa dibujuk, `WHERE` tidak.
   Sudah jadi pola di repo ini: lihat `bungkusPenyaring()` di
   `voltagent/perusahaan/tool-query.ts` untuk `id_employee`.

2. **Identitas dari sesi, tidak pernah dari model.** Departemen dan
   `created_by` diambil dari token login.

3. **Jangan sentuh `documents.status`** kecuali tim pemiliknya memberi tahu
   nilai yang benar. Ada indeks `documents_status_idx`, jadi aplikasi mereka
   menyaring dengan kolom itu — nilai asing membuat dokumen hilang dari
   aplikasi mereka **tanpa galat apa pun**. (Per 5 Okt mereka memakai
   `embedded`.)

4. **Jangan mengarang rujukan.** Halaman/baris hanya untuk dokumen yang
   memang punya. "Halaman 1" untuk semua supaya seragam itu rujukan palsu,
   dan rujukan yang meleset lebih berbahaya daripada tidak ada.

5. ⚠️ **Penanda akses melindungi DOKUMEN, bukan INFORMASI.**

   Terbukti 5 Okt: uji versi pertama lolos 14/14 padahal kontrolnya bocor.
   Dokumen ditandai `marketing`, tapi isinya tetap sampai ke agent IT lewat
   dokumen KEMBAR yang isinya identik dan tidak ditandai — lalu lewat
   dokumen KETIGA yang judulnya berbeda tapi isinya memuat aturan yang sama.

   Akibatnya di produksi: rekap penjualan yang sama diunggah dua kali,
   sekali bertanda sekali tidak, membatalkan pembatasan untuk keduanya —
   tanpa galat, tanpa gejala.

   **Kode tidak bisa menyelesaikan ini.** Yang bisa: penanda uji harus
   memeriksa ISI yang sampai ke user, bukan judul dokumen yang disebut.
   Penanda berbasis kata gampang hijau tanpa arti.

6. **`npm run deploy` menjalankan `tsc --noEmit` lebih dulu.** Skrip uji yang
   rusak memblokir deploy.

7. **Uji yang memuat model embedding butuh server dev DIMATIKAN.** RAM 7,3 GB
   tidak cukup untuk keduanya — gagal "bad allocation" dari onnxruntime.

---

## DIBLOKIR — butuh jawaban tim pemilik `ai_knowledge`

### a. Endpoint unggah

Ada atau tidak? Kalau ada, bentuk yang diharapkan:

```http
POST /api/knowledge/documents
Authorization: Bearer <kunci portal>
Content-Type: multipart/form-data

file, title, kind=upload, created_by, access_menus
```

Balasan perlu memuat `id_document`, `status`, `file_path`.

Mereka menyebut endpoint-nya **perlu login**. Yang perlu dipastikan:
kredensialnya untuk **portal sebagai sistem**, bukan atas nama satu karyawan
— identitas karyawan tetap dikirim lewat `created_by`.

### b. `access_menus` — format dan kesepakatan

Sekarang `null` di 59 dari 59 dokumen. Perlu disepakati nilainya (kata apa
untuk tiap departemen) sebelum dokumen penjualan pertama masuk.

### c. ⚠️ Berkas di S3 TERBUKA tanpa login

Diverifikasi 5 Okt: `file_path` pada dokumen mereka
(`https://obs.nusagrid.co.id/mustika-s3/...`) bisa ditarik **tanpa kredensial
apa pun** — HTTP 206, isinya keluar (`%PDF-1.3`).

Alamatnya acak dan tidak bisa ditebak, tapi "sulit ditebak" bukan
"terlindungi": begitu alamat itu muncul di jawaban agent, tersalin ke chat,
atau terkirim lewat email, siapa pun bisa membukanya.

**Penyaring pencarian tanpa penjagaan berkas itu setengah kontrol.** Untuk
dokumen penjualan ini perlu diselesaikan — tautan bertanda tangan atau akses
berbatas waktu.

### d. ⚠️ Dua sistem membaca tabel yang sama

Portal ini **dan** Ratu AI sama-sama membaca `ai_knowledge`. Penyaring
`access_menus` yang cuma dipasang di `cariSop` portal tidak berlaku di Ratu
AI.

**Aturan akses yang hanya ditegakkan di salah satu dari dua pembaca bukan
aturan akses.** Harus disepakati dua pihak.

---

## Cara memeriksa pekerjaan

```bash
npx tsc --noEmit                  # wajib lolos, deploy bergantung padanya
npm run test:kb-tool              # lapisan tool (server dev dimatikan)
npm run test:kb-beda              # mutu pencarian
npm run test:routing              # kepatuhan model, ~34 detik, pakai Claude
npm run test:akses -- --agent     # penyaringan akses per departemen
npm run test:unggah               # jalur unggah ujung-ke-ujung, ~2 menit
npm run pasang:ocr-ind            # berkas bahasa OCR (sekali per mesin)
npm run dev:webpack               # server dev
```

⚠️ `npm run dev` (Turbopack) gagal di laptop ini dengan error postcss yang
menyesatkan — sebenarnya kehabisan memori. Pakai `dev:webpack`.

Riwayat keputusan lengkap ada di `CLAUDE.md`, bagian Tahap 15–18.
