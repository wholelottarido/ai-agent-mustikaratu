# Kapan agent mengambil ke RAG, kapan ke database

Dokumen ini menjawab dua pertanyaan yang muncul dari tim pada 2 Oktober 2026:

1. **Berdasarkan apa** AI memilih mengambil ke RAG atau ke database biasa?
2. **Urutannya** bagaimana — RAG dulu atau database dulu?

Semua angka di sini hasil pengukuran pada sistem yang berjalan, bukan perkiraan.
Cara memeriksanya sendiri ada di bagian terakhir.

---

## 1. Berdasarkan apa AI memilih

### Mekanismenya: tool calling

Bukan logika yang kami tulis — ini kemampuan bawaan LLM. Model diberi daftar
fungsi beserta deskripsi dan skema parameternya. Keluaran model **bukan teks
jawaban**, melainkan **panggilan fungsi**.

Contoh nyata, hasil menjalankan sungguhan:

```
"ada berapa tiket yang statusnya OPEN?"
  → query_perusahaan({
      sql: "SELECT COUNT(*) FROM v_asisten_tiket WHERE status = 'OPEN'"
    })

"hasil cetakan saya bergaris dan warnanya pudar"
  → cari_sop({ pertanyaan: "printer bergaris dan warnanya pudar" })
  → cari_tiket_serupa({ keluhan: "printer bergaris dan warna pudar" })

"tiket saya berapa yang open, dan apa aturan penutupannya?"
  → query_perusahaan({ sql: "... WHERE id_employee = 'c8a9ca7a-…' AND status = 'OPEN'" })
  → cari_sop({ pertanyaan: "apa aturan penutupan tiket" })
```

Perhatikan tiga hal:

- SQL-nya **model yang menulis sendiri**, bukan template kami.
- Satu pertanyaan bisa menghasilkan **dua panggilan**.
- `id_employee` di contoh ketiga datang dari system prompt (identitas sesi login),
  lalu disisipkan model ke SQL-nya. Isi prompt mengarahkan isi panggilan.

### Yang menyetir pilihannya: dua hal, dua-duanya teks

**a. Deskripsi tiap tool.** Tiap tool menyatakan sendiri untuk apa dia, dan yang
lebih penting — untuk apa dia bukan:

> `cari_sop`: "Cari prosedur / panduan / SOP berdasarkan MAKNA pertanyaan…
> ⚠️ BUKAN untuk pertanyaan angka dari database — itu `query_perusahaan`."

> `cari_tiket_serupa`: "⚠️ INI BUKAN SUMBER SOLUSI. Hanya 4% tiket punya catatan
> penyelesaian… Kalau catatannya kosong, JANGAN mengarang cara memperbaikinya —
> cari di `cari_sop`."

**b. Tabel aturan di system prompt.** Teks aslinya:

| Pertanyaan user | Tool |
| --- | --- |
| Berapa, kapan, siapa, daftar data | `query_perusahaan` |
| Bagaimana cara, apa syaratnya, siapa yang menyetujui | `cari_sop` |
| Mengeluhkan gejala ("printer bergaris", "laptop mati") | `cari_sop` |

Disertai satu kalimat: *"Pertanyaan bisa butuh keduanya. Panggil dua-duanya,
jangan pilih salah satu."*

### Kenapa bukan ambang skor

Pertanyaan yang wajar: "kalau skor kemiripannya rendah, jangan pakai RAG."
Itu tidak bisa, dan sudah diukur:

| Pasangan | Hubungan | Skor |
| --- | --- | --- |
| `libur` ↔ `cuti` | bersinonim | **0,90** |
| `printer` ↔ `kucing` | tidak berhubungan | **0,87** |

Selisihnya 0,03. Ambang apa pun yang meloloskan yang pertama juga meloloskan
yang kedua. Skor vektor hanya berarti untuk **mengurutkan** di dalam satu
kumpulan hasil, bukan untuk menilai relevansi secara mutlak.

Karena itu `cari_sop` **selalu** mengembalikan 5 hasil, dan yang memutuskan
"tidak ada yang menjawab" adalah model setelah membaca isinya.

### Yang keras di kode, tidak bergantung model

Dua lapis berikut berjalan tanpa melibatkan model sama sekali:

**Sebelum memilih** — tool apa yang terpasang ditentukan departemen user.
Orang marketing tidak pernah mendapat tool tiket lintas-orang: bukan ditolak
waktu dipanggil, memang tidak ada di daftar tool-nya.

**Setelah memilih** — sebelum SQL dieksekusi:

- `validasiSql()` — daftar kata terlarang, hanya `SELECT`, `LIMIT 200`
  disisipkan paksa kalau tidak ada
- `validasiTambahan()` — nama view dicocokkan ke daftar izin per departemen;
  view di luar daftar ditolak mentah-mentah
- `bungkusPenyaring()` — query dibungkus CTE `id_employee = <yang login>`
- GRANT kolom di database menutup kolom kredensial

**Akibatnya: salah pilih tool menghasilkan jawaban yang kurang bagus, bukan
data orang lain yang terbuka.**

### Buktinya

`npm run test:routing` — 16 pemeriksaan, 6 skenario, semua lolos, ~34 detik.
Dijalankan dengan Haiku 4.5, bukan Sonnet, karena model yang lebih lemah itu
batas bawah yang jujur.

---

## 2. RAG dulu atau database dulu

**Tidak ada urutan tetap. Urutannya mengikuti urutan klausa di kalimat user.**

Dibuktikan dengan membalik susunan satu pertanyaan yang isinya identik:

```
"tiket saya berapa yang open, dan apa aturan penutupannya?"
   → query_perusahaan  →  cari_sop

"apa aturan penutupan tiket, dan tiket saya berapa yang masih open?"
   → cari_sop  →  query_perusahaan
```

### Contoh kasus

Semua hasil menjalankan sungguhan:

| Pertanyaan user | Tool yang dipanggil |
| --- | --- |
| "ada berapa karyawan di departemen IT?" | `query_perusahaan` |
| "bagaimana cara mengajukan cuti?" | `cari_sop` |
| "wifi di lantai 3 mati semua" | `cari_tiket_serupa` → `cari_sop` |
| "tiket saya berapa open, **dan** aturan penutupannya?" | `query_perusahaan` → `cari_sop` |
| "**aturan penutupan tiket**, dan tiket saya berapa open?" | `cari_sop` → `query_perusahaan` |
| "berapa gaji saya bulan ini?" | **tidak ada** |

Baris terakhir perlu diperhatikan: kolom gaji memang tidak dibuka di view mana
pun, jadi model tidak punya jalan ke sana dan menjawab apa adanya tanpa
memanggil tool.

---

## Batasan yang diketahui

**Instruksi itu arahan, bukan jaminan.** Kasus "wifi di lantai 3 mati"
memanggil `cari_tiket_serupa` lebih dulu, padahal instruksi menyatakan
`cari_sop` harus duluan untuk keluhan gejala. Akibatnya ringan — dua-duanya
tetap dipanggil — tapi urutannya tidak dituruti.

**Uji regresi belum memeriksa urutan.** `test:routing` memeriksa *tool mana*
yang dipanggil, bukan *urutannya*. Penyimpangan di atas lolos sampai jejaknya
diperiksa manual. Celah ini nyata dan murah ditutup.

**Routing berbasis kata kunci tidak akan menggantikan ini.** Sudah diukur: pada
10 pertanyaan yang kosakatanya sengaja dibuat berbeda dari dokumennya,
pencocokan huruf (trigram) dapat **4/10**, pemahaman makna dapat **9/10**. Dan
kasus yang pernah gagal — *"hasil cetakan saya bergaris"* — tidak mengandung
satu pun kata kunci seperti "bagaimana" atau "prosedur".

**Korpus ujinya masih dokumen contoh.** 24 dokumen SOP ditulis sendiri untuk
pengujian, dan pertanyaan ujinya ditulis oleh orang yang sama. Angka-angka di
atas membuktikan mesinnya bekerja, belum membuktikan kegunaannya pada dokumen
perusahaan yang sebenarnya.

---

## Memeriksa sendiri

```bash
npm run test:routing          # 6 skenario pemilihan tool, ~34 detik
npm run test:routing -- --hanya gejala    # satu skenario saja
npm run test:kb               # vektor vs trigram, 12 pertanyaan
npm run test:kb-beda          # 10 pertanyaan dengan kosakata berbeda
npm run uji:kb-berkas         # bukti potongan & vektor berasal dari PDF
```

Berkas yang relevan:

- `voltagent/agents.ts` — `bagianKbPerusahaan()` berisi tabel aturan
- `voltagent/tools-kb.ts` — deskripsi `cari_sop`, `daftar_sop`, `cari_tiket_serupa`
- `voltagent/perusahaan/view-perusahaan.ts` — daftar view per departemen
- `voltagent/sql-guard.ts` — validasi SQL sebelum dieksekusi
- `lib/kb/cari.ts` — pencarian vektor dan trigram
