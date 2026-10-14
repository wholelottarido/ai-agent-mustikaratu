# Pemetaan Database Perusahaan (Demo) — 29 September 2026

**Sumber:** PostgreSQL 18.6 · `mustika_ratu_dev` · `157.20.255.29:5432`
**Akses:** user `postgres` (superuser) — seluruh query hari ini HANYA BACA katalog

---

## 1. Ukuran

| Item | Jumlah |
|---|---|
| Skema | 1 (`public`) |
| Tabel | 220 |
| View | 13 |
| Ukuran database | 2.931 MB |
| Primary key | 195 dari 220 tabel |
| Foreign key | 82 |

⚠️ **115 dari 220 tabel belum pernah dihitung statistiknya.** Akibatnya
`reltuples` (perkiraan jumlah baris) untuk tabel-tabel itu bernilai 0 dan
**menyesatkan** — pada pemeriksaan pertama, tabel `ai_*` terbaca "kosong",
padahal `COUNT(*)` menunjukkan sudah terisi. Untuk tabel yang penting, hitung
dengan `COUNT(*)`, jangan percaya perkiraan.

## 2. Modul berdasarkan awalan nama

| Awalan | Tabel | Perkiraan baris | Ukuran | Isi |
|---|---|---|---|---|
| `maps_` | 41 | 1.363.693 | 648 MB | Program & klaim promosi: budget, claim, program_product, program_kpi, approver |
| `supertools_` | 27 | — | 1,3 MB | Aplikasi lapangan: callplan, checkin, fraud_log |
| `marketing_` | 16 | — | 3,7 MB | analysis, channel, generate_content |
| `ai_` | 13 | — | 0,8 MB | **Lapisan AI — lihat bagian 3** |
| `cmod_` | 12 | — | 1,9 MB | config, customer_profile, doc_sequence |
| `portal_` | 10 | 68.079 | 21 MB | induction programs, materials, documents |
| `trx_` | 4 | **4.293.687** | **2.051 MB** | Transaksi penjualan BA |
| `minis_` | 5 | 32.853 | 7 MB | company_master, company_stock, customer_mapping |
| `employee`, `hr_` | 8 | 2.267 | 2 MB | Kepegawaian |

Tabel terbesar: **`trx_ba_sales`** — 4,2 juta baris, 2.011 MB. Sendirian itu
dua pertiga isi database.

Tabel inti yang relevan ke portal:

```
trx_ba_sales     4.208.867 baris, 16 kolom
customer            65.638 baris, 40 kolom
price               25.055 baris,  8 kolom
product              8.008 baris, 21 kolom
employee             1.952 baris, 29 kolom
users                1.639 baris, 10 kolom
```

---

## 3. ⚠️ TEMUAN UTAMA: lapisan AI SUDAH ADA dan sudah terkonfigurasi

Database ini bukan sekadar sumber data. Di dalamnya sudah ada **arsitektur
asisten AI yang dirancang lengkap**, dengan penamaan berbahasa Indonesia yang
sangat mirip dengan prototipe MySQL kita.

### 9 agent terdaftar

```
agent-general      Ratu AI Umum         (umum)
agent-hr           Ratu AI HR
agent-marketing    Ratu AI Marketing
agent-maps         Ratu AI MAPS
agent-cmod         Ratu AI CMOD
agent-portal       Ratu AI Portal
agent-report       Ratu AI Report
agent-supertools   Ratu AI Super Tools
agent-admin        Ratu AI Admin
```

Semuanya aktif. Prototipe kita punya 2 agent (marketing, hr); di sini ada 9.

### 6 sumber data — DAFTAR VIEW, bukan tabel mentah

`ai_sumber_data` mendaftarkan view mana yang boleh dibaca agent, beserta
**kolom penyaring barisnya**:

| kode | view | penyaring baris |
|---|---|---|
| `karyawan` | `v_ai_karyawan` | employee, departemen, perusahaan |
| `aset` | `v_ai_aset` | employee, departemen, perusahaan |
| `kunjungan` | `v_ai_kunjungan` | employee, departemen, perusahaan |
| `pengajuan` | `v_ai_pengajuan` | employee, departemen, perusahaan |
| `tiket` | `v_ai_tiket` | employee, departemen, perusahaan |
| `klaim_maps` | `v_ai_klaim_maps` | departemen saja |

### 7 tool — DIDEFINISIKAN SEBAGAI DATA, bukan kode

| kode | jenis | sumber | batas | cakupan |
|---|---|---|---|---|
| `data_karyawan` | konfigurasi | `v_ai_karyawan` | 30 | bawahan |
| `aset_karyawan` | konfigurasi | `v_ai_aset` | 20 | diri |
| `kunjungan_outlet` | konfigurasi | `v_ai_kunjungan` | 30 | diri |
| `pengajuan_karyawan` | konfigurasi | `v_ai_pengajuan` | 20 | diri |
| `tiket_helpdesk` | konfigurasi | `v_ai_tiket` | 20 | diri |
| `klaim_maps` | konfigurasi | `v_ai_klaim_maps` | 30 | diri |
| `tim_saya` | **kode** | — | 100 | bawahan |

Enam dari tujuh tool berjenis `konfigurasi` — artinya tool ditambah dengan
**menambah baris**, bukan menulis kode dan deploy ulang. Kolom `kolom[]`,
`filter` (jsonb), `urut_kolom`, `batas`, dan `izin` menyusun query-nya.

### Cakupan baris: `diri` / `bawahan` / `semua`

Inilah perbedaan mendasar dari prototipe kita. Kita memisahkan akses dengan
**user MySQL per departemen** (9 user, izin per kolom). Di sini pemisahannya
**per BARIS**, ditentukan `ai_tool.cakupan_bawaan` dan `ai_tool_cakupan` per
peran, dipetakan lewat kolom `id_employee` / `id_department` / `id_company` di
view-nya.

### Pemakaian, biaya, dan kuota

- `ai_pemakaian_model` — token masuk/keluar **plus token cache baca/tulis**,
  `provider`, `model`, `biaya_usd`, `run_id`, `session_key`
- `ai_harga_model` — harga per model termasuk **harga cache read & write**
- `ai_kuota` — batas **dalam rupiah per karyawan**, bukan jumlah pertanyaan
- `ai_pengaturan` — `kuota_bawaan_idr` = 50.000; `kurs_usd_idr` masih **kosong**

### Percakapan

`ai_percakapan` punya `rantai_agent text[]` dan `agent_awal` — rancangannya
mendukung **satu pertanyaan melewati beberapa agent**, bukan satu agent saja.

---

## 4. Perbandingan dengan prototipe MySQL

| Hal | Prototipe (MySQL) | Perusahaan (PostgreSQL) |
|---|---|---|
| Pemisahan akses | User DB per departemen, izin per kolom | Per BARIS lewat `diri`/`bawahan`/`semua` |
| Definisi tool | Kode TypeScript, perlu deploy | Baris di `ai_tool`, tanpa deploy |
| Jumlah agent | 2 | 9 |
| Kuota | 20/jam, 80/hari (jumlah pertanyaan) | Rupiah per karyawan (bawaan 50.000) |
| Token cache | Belum dicatat | Sudah ada kolomnya |
| Alur multi-agent | Tidak ada | `rantai_agent text[]` |
| Entri data | Ada (penjualan, lembur, pelamar) | **Belum terlihat** — semua tool baca |

Yang prototipe punya dan di sana belum terlihat: **jalur tulis**. Tidak ada
tabel setara `entri_log`, dan ketujuh tool semuanya membaca.

---

## 5. Yang berubah dari rencana kemarin

Rencana kemarin: membangun halaman `/dbadmin` sebagai saklar sumber data.

Ternyata konsep itu **sudah ada** di sana, dan lebih jauh: `ai_sumber_data`
bukan saklar antara dua database, melainkan **daftar view yang boleh dibaca
agent** beserta aturan penyaring barisnya. Ditambah `ai_tool` dan
`ai_tool_cakupan`, itu praktis sudah berupa halaman admin — tinggal antarmukanya.

Jadi pertanyaannya bergeser: bukan lagi "bagaimana merancang saklarnya", tapi
**"apakah aplikasi kita menyesuaikan diri ke kontrak yang sudah ada ini"**.

⚠️ Catatan nama: kemarin saya mengingatkan nama `sumber_data` sudah dipakai di
prototipe untuk hal lain (mencatat tabel yang dipakai tiap jawaban). Ternyata
di sini `ai_sumber_data` artinya berbeda lagi. Tiga arti untuk satu istilah —
perlu disepakati sebelum dipakai di kode.

---

## 5b. Breakdown: tabel mana milik agent mana

Awalan nama tabel ternyata sejajar hampir satu-satu dengan 9 agent yang sudah
terdaftar. Pembagian domainnya **sudah ada**, tinggal dipetakan.

| Agent | Tabel | Jumlah | Baris |
|---|---|---|---|
| `agent-maps` | `maps_*`, `approver_*` | 43 | 1.577.332 |
| `agent-supertools` | `supertools_*`, `ba_*`, `trx_ba_*`, `attendance*` | 35 | 4.296.448 |
| `agent-marketing` | `marketing_*`, `product*`, `price*`, `customer*`, `brand`, `category`, `channel` | 30 | 104.023 |
| `agent-cmod` | `cmod_*`, `minis_*` | 17 | 34.965 |
| `agent-portal` | `portal_*`, `news`, `guidelines*` | 14 | 68.427 |
| `agent-hr` | `employee*`, `hr_*`, `positions`, `department`, `holiday`, `jobdesk`, `leave_period` | 15 | 4.900 |
| `agent-report` | `report_*`, `pivot_configs` | 7 | 26.648 |
| `agent-admin` | `ai_*`, `users*`, `roles`, `menu`, `role_menu`, `permission_section`, `apps` | 26 | 4.400 |
| `agent-general` | `company*`, `area`, `region`, `country`, `uom`, `status` | 10 | 13.000 |

## 5c. ⚠️ Tiga hal yang mematahkan asumsi awal

### (1) TIDAK ADA data gaji sama sekali

Dicari di 220 tabel + 13 view, dengan pola nama
`gaji|salary|payroll|upah|thp|tunjangan|bonus|insentif`: **nol hasil.**

Tabel `employee` berisi `nik`, `fullname`, `id_department`, `id_positions`,
`id_manager`, `start_of_work`, `annual_leave_quota` — tidak ada satu pun kolom
kompensasi.

Artinya aturan "kalau dia Head, boleh membaca gaji" **tidak bisa diterapkan di
database ini**, karena datanya memang tidak ada di sini. Data gaji yang kita
pakai selama ini adalah data dummy di MySQL.

### (2) Peran itu per-APLIKASI, bukan per-departemen

45 peran tersebar di 8 aplikasi:

```
Super Tools (6)          Area Manager, Area Supervisor, Head Office,
                         Regional Sales Manager, Salesman, Super Admin
Supertools Mobile (5)    BA - Beauty Advisor, BA - Team Leader, Salesman, ...
Confirm Weekly Order (3) Admin Sales CMOD, Distributor CMOD, Super Admin
Marketing (3)            Reviewer, Super Admin, User
Report BA (2)            BA - Beauty Advisor, BA - Team Leader
Admin Console (2)        Budget Control - MAPS, Super Admin
Portal (1)               Portal - User
Report (1)               Super Admin
```

Peran seperti `Manager`, `General Manager`, `Direktur`, `Presiden Direktur`
ada, tapi TIDAK terikat ke aplikasi mana pun. Jadi "Head" bukan satu peran
tunggal — bentuknya berbeda di tiap aplikasi.

### (3) 52% karyawan aktif TIDAK punya departemen

```
employee: 1.954 total, 1.269 aktif
  aktif tanpa departemen : 661  (52%)
  aktif tanpa jabatan    : 125
  aktif tanpa akun users :   0
```

Di `v_ai_karyawan` (sumber data yang dibaca agent), 1.064 dari 1.954 baris
departemennya kosong; Sales 541, Marketing 89.

**Akibatnya, aturan "user Marketing → agent Marketing" hanya bisa diterapkan
ke 89 orang.** Lebih dari separuh karyawan tidak punya departemen untuk
dijadikan dasar pengarahan.

### Kaitan user → peran tidak lewat kolom

`users` (1.641 baris) TIDAK punya kolom `id_roles`. Kaitannya ada di
`users_config.apps_config` berupa **jsonb**, dan cuma 817 dari 1.641 user yang
punya baris di situ. Jadi menentukan "peran user ini apa" berarti mengurai
jsonb per aplikasi, bukan sekadar join.

Kolom `id_roles` cuma muncul di 4 tabel: `roles`, `role_menu`,
`hr_employee_submission`, dan `ai_tool_cakupan`.

## 5d. Bagaimana tool disusun jadi query

Ini inti mekanismenya. Sebuah tool = **SELECT berparameter di atas view yang
terdaftar**:

```
SELECT   <ai_tool.kolom[]>
FROM     <ai_sumber_data.nama_view>
WHERE    <filter yang diisi MODEL>        -- dari ai_tool.filter
  AND    <penyaring cakupan>              -- diri / bawahan / semua, lewat
                                          -- kolom_employee / kolom_departemen
                                          -- / kolom_perusahaan
ORDER BY <urut_kolom> <urut_arah>
LIMIT    <batas>
```

### `ai_sumber_data.kolom` — metadata kolom

```json
[{ "nama": "nik", "tipe": "teks", "label": "NIK" },
 { "nama": "mulai_kerja", "tipe": "tanggal", "label": "Mulai Kerja" }]
```

### `ai_tool.filter` — INI parameter tool-nya

```json
[{ "kolom": "status", "label": "Status (Pengecekan Data, Menunggu Approval,
                                Diproses, Ditolak, Disetujui, Dibatalkan)",
   "operator": "sama" },
 { "kolom": "dibuat", "label": "Dibuat sejak (YYYY-MM-DD)", "operator": "dari" }]
```

`label` itu keterangan yang dibaca model — persis peran `.describe()` di zod
punya kita. Empat operator yang dipakai:

| operator | artinya |
|---|---|
| `berisi` | LIKE / ILIKE |
| `sama` | `=` |
| `dari` | `>=` |
| `sampai` | `<=` |

### `ai_tool.izin` menyambung ke `permission_section`

Nilai seperti `claim:read` dan `callplan:read` merujuk `permission_section.code`
(480 baris, mis. `callplan:read`, `callplan:approval:update`). Jadi sebuah tool
juga menuntut izin aplikasi, bukan cuma peran.

## 5e. ⚠️ PERBEDAAN ARSITEKTUR PALING BESAR

| | Prototipe kita | Perusahaan |
|---|---|---|
| Siapa menulis SQL | **Model** (tool `query_db`) | **Tidak ada** — SQL disusun sistem dari konfigurasi |
| Yang diisi model | seluruh query SELECT | cuma nilai filter |
| Penjaga | `sql-guard.ts` + GRANT per kolom | model memang tidak punya jalan menulis SQL |
| Bisa menjawab pertanyaan baru | ya, selama tabelnya ada di kamus data | tidak — terbatas pertanyaan yang sudah didaftarkan |

Ini bukan sekadar beda gaya. Di sana model **tidak bisa** salah menulis query,
karena tidak pernah menulis query. Harganya: setiap pertanyaan baru menuntut
baris `ai_tool` baru.

Punya kita kebalikannya: luwes, tapi butuh kamus data yang benar, penyaring
SQL, dan izin database berlapis untuk menahan kesalahan model.

## 5f. ⚠️ Pembatasan KOLOM per peran tidak ada padanannya

Prototipe kita memisahkan staf dari data gaji dengan
`GRANT SELECT (kolom)` — pembatasan di tingkat KOLOM, ditegakkan MySQL.

Di sana:

- `ai_tool.kolom[]` menentukan kolom, tapi **per tool**, bukan per peran
- `ai_tool_cakupan` mengatur cakupan BARIS (`diri`/`bawahan`/`semua`), bukan kolom
- `role_menu.field_rules` ada tapi cuma **1 dari 292** baris terisi, dan isinya
  untuk aksi UPDATE (kolom mana yang boleh DIUBAH di formulir), bukan dibaca
- `permission_section.fields` terisi 52 dari 480, juga untuk formulir ubah

**Kesimpulan:** untuk membuat "peran A lihat kolom X, peran B tidak", satu-satunya
cara di rancangan sekarang adalah **membuat dua tool berbeda**. Tidak ada
mekanisme satu tool dengan kolom berbeda per peran.

## 5g. Pola view `v_ai_*` — dibaca dari definisi aslinya

Semua view mengikuti bentuk yang sama:

```sql
SELECT x.<pk>,
       x.<kolom>  AS <nama_indonesia>,      -- SEMUA kolom diganti namanya
       CASE ... END AS status,              -- status angka → teks Indonesia
       x.id_employee, e.id_department, x.id_company   -- penyaring, di AKHIR
  FROM <satu_tabel_utama> x
  LEFT JOIN <lookup> ON ...                 -- LEFT, bukan INNER
 WHERE <saring data terhapus>               -- opsional
```

Contoh nyata, `v_ai_karyawan`:

```sql
SELECT e.id_employee, e.fullname AS nama, e.nik,
       d.name AS departemen, p.positions AS jabatan,
       co.name_company AS perusahaan, m.fullname AS atasan,
       e.start_of_work AS mulai_kerja, e.is_active AS aktif,
       e.id_department, e.id_company
  FROM employee e
  LEFT JOIN department d  ON d.id_department = e.id_department
  LEFT JOIN positions  p  ON p.id_positions  = e.id_positions
  LEFT JOIN company    co ON co.id_company   = e.id_company
  LEFT JOIN employee   m  ON m.id_employee   = e.id_manager;
```

### Enam aturan yang konsisten

1. **Satu tabel utama**, sisanya LEFT JOIN cuma untuk mengambil nama.
2. **LEFT JOIN, bukan INNER.** Penting: 52% karyawan tanpa departemen — INNER
   JOIN akan MENGHILANGKAN separuh barisnya tanpa ada yang sadar.
3. **Semua kolom diganti nama jadi bahasa Indonesia.**
4. **Status berupa angka diterjemahkan lewat `CASE`.** Di `v_ai_klaim_maps`,
   `status` 0–5 jadi "Pengecekan Data", "Menunggu Approval", dst. Itu sebabnya
   `ai_tool.filter` bisa menulis label berisi daftar status yang sah.
5. **Kolom penyaring dibiarkan mentah dan ditaruh di akhir** — `id_employee`,
   `id_department`, `id_company`. Itu yang dipakai cakupan diri/bawahan/semua.
6. **Kolom yang tidak perlu dibuang.** `employee` punya 29 kolom; view-nya cuma
   menampilkan 11 — alamat, tanggal lahir, telepon, foto tidak ikut.

### ⚠️ Koreksi catatan sebelumnya

Di bagian 5 saya menulis "semua view `v_ai_*` tidak punya WHERE". **Itu salah**
— pemeriksaannya memakai pola yang keliru. Yang benar: **4 dari 8 punya WHERE**.

```
v_ai_klaim_maps       WHERE c.status IS DISTINCT FROM 3
v_ai_kunjungan        WHERE cp.is_active IS DISTINCT FROM false
v_ai_pemakaian_biaya  (gabungan internal)
v_ai_percakapan_biaya (gabungan internal)
```

Tapi kesimpulannya tidak berubah: WHERE itu untuk menyaring data terhapus,
**bukan** menyaring per pengguna. Cakupan per-orang tetap tanggung jawab
aplikasi.

## 5h. ⚠️ "Marketing" di sana BUKAN marketing yang kita bangun

Ini perlu disadari sebelum membuat view untuk `agent-marketing`.

Prototipe MySQL kita: `sales_order`, `customer`, `campaign`, ROAS — analitik
penjualan dan kampanye.

`marketing_*` di sana (16 tabel): **media sosial, live commerce, dan analisis
konten**.

```
marketing_social_media    brand, username, platform, channel, account_id
marketing_live_sessions   session_id, marketplace, shop_id, started_at
marketing_scrape          (31 kolom)
marketing_analysis        content_topic, hook_analysis, visual_analysis,
                          why_good, why_bad, recomendation_step, score
```

Data penjualannya justru ada di `trx_ba_sales` (4,2 juta baris, penjualan
Beauty Advisor) — yang menurut awalan namanya masuk wilayah `agent-supertools`,
bukan `agent-marketing`.

## 5i. Usulan view untuk `agent-marketing` (BELUM DIBUAT)

`trx_ba_sales` ternyata **sudah ter-indeks dengan baik**:

```
trx_date · (id_customer, trx_date) · (id_area, trx_date) · (ba_code, trx_date)
· id_product · item_code
```

Query berbatas tanggal selesai dalam **23 ms** — aman dibuat view, asalkan
tool-nya selalu memberi batas tanggal.

Usulan, mengikuti pola yang sama persis:

```sql
CREATE VIEW v_ai_penjualan_ba AS
SELECT s.id,
       s.trx_date            AS tanggal,
       p.name                AS produk,
       p.sku,
       c.customer_name       AS outlet,
       a.area                AS wilayah,
       s.ba_name             AS beauty_advisor,
       s.qty                 AS jumlah,
       s.price               AS harga,
       (s.qty * s.price)     AS nilai,
       s.id_employee, e.id_department, a.id_company
  FROM trx_ba_sales s
  LEFT JOIN product  p ON p.id_product  = s.id_product
  LEFT JOIN customer c ON c.id_customer = s.id_customer
  LEFT JOIN employee e ON e.id_employee = s.id_employee
  LEFT JOIN area     a ON a.id          = s.id_area;
```

⚠️ **Membuat view = MENULIS ke database perusahaan.** Belum dilakukan, dan
perlu izin tersendiri — berbeda dari membuat role read-only yang hanya
mengurangi kuasa.

⚠️ Data 30 hari terakhir cuma **11 baris**. Isinya historis (2010–2026), jadi
pertanyaan "bulan ini" akan terlihat kosong. Perlu dicek apakah itu memang
begitu atau data demo yang berhenti diperbarui.

## 6. Yang belum diperiksa

- Struktur `trx_ba_sales` dan modul `maps_*` (41 tabel) secara rinci
- Definisi SQL di balik view `v_ai_*`
- Isi `ai_tool.filter` dan `ai_sumber_data.kolom` (jsonb) — menentukan persis
  bagaimana query disusun dari konfigurasi
- Tabel `roles` / peran, yang dirujuk `ai_tool_cakupan.id_roles`
- Apakah ada mekanisme tulis sama sekali

## 7. Pertanyaan yang perlu dijawab sebelum lanjut

1. Lapisan `ai_*` itu **dibuat siapa dan kapan** — sudah dipakai, atau
   rancangan yang menunggu diisi? (`ai_chat_session` punya 20 baris,
   `ai_pemakaian_model` 1 baris, jadi pernah dipakai tapi sedikit.)
2. Apakah aplikasi kita **diharapkan menulis ke tabel-tabel itu**, atau berdiri
   sendiri dengan databasenya sendiri?
3. Kalau menyesuaikan diri: pemisahan akses kita harus dirombak dari
   per-user-database menjadi per-baris. Itu pekerjaan besar dan sebaiknya
   diputuskan sadar, bukan ditemukan di tengah jalan.
