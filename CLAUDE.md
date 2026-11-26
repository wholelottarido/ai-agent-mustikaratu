# Ratu AI — Portal AI Assistant Multi-Departemen (VoltAgent + Next.js)

> **Berkas ini sengaja pendek** (diringkas 26 Nov 2026). Catatan sejarah lengkap per tahap
> (Sep – Nov 2026, ±6.400 baris) dipindah UTUH ke `docs/riwayat/catatan-pengembangan-sep-nov-2026.md`.
> Jangan dibaca utuh; pakai indeks di bagian paling bawah atau `grep -n`.

## Aturan kerja untuk Claude Code (WAJIB)
- Pakai bahasa Indonesia yang santai, asik, dan gampang dimengerti.
- Sebelum membuat file atau kode: **jelaskan dulu konsepnya + langkah-langkahnya**, tunggu user setuju, baru eksekusi.
- Kerjakan **per tahap**. Jangan lompat tahap tanpa konfirmasi.
- Jawaban ringkas; pakai tabel/list pendek, hindari paragraf panjang.
- Setelah satu tahap selesai, update bagian **Status terkini** di file ini (singkat), dan catatan panjangnya ke logbook.

### ⚠️ Yang ditambahkan USER, bukan Claude (9 Okt 2026)

Tool agent **ditambah dan diubah user sendiri dari halaman Kelola AI**, bukan
oleh Claude lewat hardcode atau panggilan API. Diminta berulang kali:

> "dr kmrn padahal saya inginnya saya yang menambahkan pada halaman kelola-ai,
> kenapa lu yg nambahin sendiri"
> "saya ingin buat tool nya sendiri di halaman kelola ai. bukan lewat hardcode lagi"

Tugas Claude **membangun kemampuan layarnya**, lalu memberi tahu langkahnya.
Kalau sebuah kemampuan belum ada di layar, bangun dulu borang/tombolnya —
jangan diselesaikan lewat skrip. Berlaku juga untuk menyetujui tool tulis tim
lain: tawarkan tombolnya, jangan tekan sendiri.

Alasannya bukan kerapian: setelan ini menentukan apa yang didapat SEMUA pemakai
portal, dan keputusannya milik tim IT.

### ⚠️ Jangan tulis berkas lewat heredoc kalau ada backslash

`cat > x.ts <<'EOF'` **memakan backslash** di lingkungan ini, walau penanda
heredoc-nya dikutip. Regex `\d` jadi `d`, `\n` jadi baris baru. Sudah merusak
berkas berkali-kali (29 Sep, 13 Okt, terulang 25 Nov). Pakai tool Write/Edit.

### Batasan tetap
- Jangan cetak/simpan API key, password, URL tunnel, atau isi berkas `.pem`.
- Server (EC2) dan database perusahaan: **hanya baca** kecuali diizinkan eksplisit.
- Akun "UJI PORTAL ... - HAPUS" milik tim lain: jangan ditelusuri atau dihapus.
- Jaga akhir baris berkas (banyak berkas CRLF): pakai Edit/Write, atau Python mode biner. Jangan `sed -i`.
- Laporan ke user dan logbook: bahasa awam ("alat", bukan "tool").

### Logbook & transkrip
- Logbook harian: `docs/logbook/logbook-<tanggal>.md` — untuk pembimbing magang; cara tercepat tahu KAPAN dan KENAPA sesuatu diputuskan.
- Transkrip percakapan: `claude_context/*.txt` (besar, ±15.000 baris/hari). Jangan dibaca utuh: `grep -n "kata kunci" claude_context/*.txt | head -20`.
- ⚠️ Transkrip dan `db/*.sql` memuat kredensial asli. Jangan dorong repo ini ke remote publik tanpa menggantinya.

---

## Proyek ini apa

**Ratu AI**: portal web tempat karyawan bertanya ke AI soal data departemennya (penjualan, stok,
karyawan, SOP, tiket IT, ramalan penjualan, riset pasar), lewat **web** dan **WhatsApp**. Bisa juga
**mengisi data** (tiket, penjualan, lembur, pelamar) lewat rancangan + konfirmasi pengguna.
Awalnya (23 Sep) satu agent Marketing di MySQL; sekarang multi-departemen di atas **PostgreSQL
perusahaan** dengan agent & alat yang diatur dari layar **Kelola AI**.

Pengguna akhir: karyawan perusahaan (login akun perusahaan). Pengatur: tim IT. Pembaca laporan: mentor/pembimbing magang.

## Peta folder (`marketing/`)

| Folder / berkas | Isi |
|---|---|
| `app/` | Next.js 16 App Router: chat, login, `kelola-ai/` (tim IT), `api/*` |
| `voltagent/` | Agent: perute (router) + agent aplikasi, rakitan alat dari konfigurasi, model, penjaga alur |
| `lib/` | Akses DB (`db-*.ts`), entri/tulis (`lib/entri/`), RAG SOP (`lib/kb/`), alur (`lib/alur/`), kuota, sesi |
| `wa-bot/` | Bot WhatsApp (Baileys 6.17.16), proses terpisah |
| `forecast-service/` | Layanan Python (FastAPI, port 8100) untuk ramalan penjualan |
| `mr-gateway/` | Proyek Next.js terpisah: dashboard MR AI Gateway (LiteLLM). Punya CLAUDE.md sendiri |
| `scripts/` | Uji (`test-*.mts`), benchmark (`profil-alur-agent.mts`), pembuat dashboard (`buat-dashboard*.py`) |
| `data/` | Hasil uji & benchmark mentah — **jangan ditimpa** |
| `db/` | SQL setup MySQL portal & PostgreSQL (role, view, grant) |
| `docs/` | Lihat `docs/README.md`: logbook, benchmark, workflow-agent, fitur, gateway, database, panduan, riwayat |
| `../openclaw/` | Prototipe pertama (OpenClaw), hanya pembanding. **Bukan** Ratu AI OpenClaw milik mentor |

## Arsitektur sekarang

```
Browser / WhatsApp
  -> /api/chat (sesiAtau401)
     -> agent UMUM (perute)  --delegate_task-->  agent APLIKASI (portal/maps/hr/marketing/…)
          dirakit dari baris ai_agent / ai_agent_tool / ai_tool / ai_sumber_data (PostgreSQL perusahaan)
          baca  -> SELECT view asisten (role read-only)
          tulis -> RANCANGAN + kartu konfirmasi; disimpan hanya lewat tombol/balasan YA
     penjaga alur (lib/alur/penjaga-alur.ts, voltagent/kendali-alur.ts): flag PENJAGA_ALUR, RUTE_KEMAMPUAN
```

- **Model** (dipilih user, whitelist `voltagent/models.ts`): Claude Sonnet 5 / Haiku 4.5 (Anthropic) · Qwen3 14B, Qwen3 14B 4 GPU, Qwen3.5 35B (lewat **MR AI Gateway** = LiteLLM) · Gemma 12B (server kantor) · Qwen2.5 7B (Ollama lokal) · Qwen2.5 14B.
- **Server model sendiri**: AWS EC2 g5.12xlarge (4× A10G, Jakarta), vLLM 4 replika Qwen3-14B-AWQ, max-num-seqs 4, LiteLLM simple-shuffle, tunnel Cloudflare. SSH alias `mr-g5-12x`. Tarif USD 7,93854/jam. Server sering dimatikan; IP bisa berubah.
- **Tabel setelan agent/alat DIBAGI dengan tim lain dan kita cuma membaca.** Isinya bisa berubah kapan saja. Keputusan kita disimpan di DB portal sendiri (`ai_tool_agent`, `ai_tulis_disetujui`). Jangan menanam nama alat tim lain di uji.

### Database

| DB | Untuk | Catatan |
|---|---|---|
| PostgreSQL perusahaan | Data bisnis, konfigurasi agent/alat, SOP (`ai_knowledge`, pgvector), tiket | Banyak role sempit: read-only (chat), konfig, tulis per kolom, login, ingest. Cek hak dengan `has_column_privilege()`, bukan `information_schema` |
| MySQL portal (Laragon) | Pengguna, percakapan, pesan, kuota/`pemakaian`, tautan WA | User terpisah per fungsi (`portal_readonly`, `portal_app`, `portal_admin`, …). Laragon harus menyala |
| MySQL `marketing` / `hr` | Data dummy awal (Sep) | Masih dipakai sebagian jalur lama |

Kredensial semua di `.env.local` (nama variabel `DEMO_PG_*`, `PORTAL_*`, `MYSQL_*`). Jangan dicetak.

### Peta berkas penting

| Yang dicari | Di mana |
|---|---|
| Membaca & memvalidasi setelan agent/alat | `lib/ai-konfig.ts` |
| Rakit alat BACA dari setelan + gerbang izin | `voltagent/tool-konfigurasi.ts` |
| Rakit alat TULIS (penyusun rancangan) | `voltagent/registry-tulis.ts`, `lib/entri/tulis-umum.ts` |
| Perute + instruksinya, rute kemampuan (Tahap 3) | `voltagent/agent-konfig.ts`, `lib/alur/kemampuan.ts` |
| Penjaga alur (Tahap 2–6) | `lib/alur/penjaga-alur.ts`, `voltagent/kendali-alur.ts`, `voltagent/jalur-agent.ts` |
| Model & penyedia | `voltagent/models.ts`, `voltagent/agents.ts` |
| Layar Kelola AI | `app/kelola-ai/`, `app/api/admin/ai-tool/route.ts` |
| Persetujuan alat tulis tim lain | `lib/tulis-disetujui.ts` |
| Izin pemakai dari peran | `lib/akses-aplikasi.ts` |
| Pencatatan token & kuota | `lib/pemakaian.ts` |

## Menjalankan

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Next.js dev |
| `npm run deploy` | `tsc --noEmit` + build + start di **port 3018** (type-check sengaja dipisah karena RAM) |
| `npm run wa` | Bot WhatsApp |
| `npm run forecast` | Layanan ramalan Python, port 8100 |
| `npm run voltagent:run` | Server debug VoltOps, port 3141 |

Script `scripts/*.mts` dijalankan lewat `tsx --env-file=.env.local`. Uji yang menyentuh MySQL harus diakhiri `process.exit()`.
Suite inti (jalankan satu per satu): `test:konfig test:tool-konfig test:agent-konfig test:akses-app test:jalur test:ubah-tool test:buat-tool test:rapikan test:wa test:tiket test:tiket-insert test:tiket-ubah test:tulis-umum test:tool-tulis test:tulis-setuju test:penjaga`, plus `test:alur-semua` (penjaga alur & Tahap 3, tanpa model).

Benchmark (butuh server EC2 hidup): `scripts/profil-alur-agent.mts` → `kejadian.jsonl` dkk → `scripts/olah-alur-agent.py` (**selalu `--tanpa-dashboard`**, kalau tidak dashboard historis tertimpa).

---

## Status terkini (26 Nov 2026)

| Periode | Yang dikerjakan |
|---|---|
| 23 Sep – 30 Sep | Agent Marketing → portal multi-departemen, login, riwayat, WhatsApp, kuota, entri data + pembatalan, entri HR, pindah ke PostgreSQL perusahaan, login akun perusahaan, baca dokumen |
| 1 – 29 Okt | RAG SOP (`cari_sop`, rujukan halaman), unggah dokumen, layar **Kelola AI** + jalur tulis + persetujuan alat tim lain, Qwen lewat API, mesin **ramalan penjualan** + backtest, riset pasar |
| 2 – 12 Nov | Server DB baru, alat total penjualan / pergerakan / stok kosong, rapor ramalan, Qwen3 14B & 3.5 35B lewat **MR AI Gateway** |
| 13 – 23 Nov | Uji beban & benchmark Qwen3-14B: 1 GPU (g5.2xlarge) → 4 GPU (g5.12xlarge), profil waktu per langkah, uji Qwen3.8-27B (ditolak: 26/97 habis waktu) |
| 24 Nov | RCA kegagalan → perbaikan alur agent **Tahap 1–6**; uji ulang 1–20 pengguna (T7): akurasi v2 **94,4%** (dari 89,6%), gagal 19 → 2, P99 di 20 pengguna 167 → 100 dtk |
| 25 Nov | Dashboard evaluasi baru 7 halaman + kalkulator **EC2 vs API Anthropic**; cek cache (portal 0%, OpenClaw ±77%); dokumen permintaan uji ke Ratu AI OpenClaw mentor |
| 26 Nov | Akun ridho cuma dapat 80 dari ±300 alat → diberi peran di 8 aplikasi (`scripts/beri-peran-lengkap.mts`, atas izin user, ada cadangan di `data/`). Lalu **penyelarasan dengan sistem tim lain** tanpa mengubah DB: izin per aplikasi + izin ganda (`lib/izin-tool.ts`), `ai_tool_cakupan`, saklar `IZIN_GANDA` / `TINJAU_TOOL_BARU` / `ALAT_PORTAL` → ridho 143 alat. User minta: **jangan ubah izin di DB perusahaan lagi**. Agent paham alat: urutan + `batas_baris` di keterangan alat, aturan "terbaru ≠ hari ini", status `galat-model` (jujur saat model gagal), `MAKS_BARIS_SERVER` untuk Gemma. Uji langsung Haiku 5/5, Gemma 2/3 + 1 gagal jujur |

**Hasil & laporan terbaru**
- Dashboard utama: `docs/benchmark/grafik/ratu-ai-performance-evaluation.html` (dibangun ulang: `python scripts/buat-dashboard-evaluasi.py`, template `scripts/dashboard-evaluasi.template.html`). Dokumentasinya: `docs/benchmark/dokumentasi-dashboard-evaluasi.md`.
- Arsip dashboard lama: `docs/benchmark/grafik/hasil-pengujian.html`.
- Perbaikan alur agent: `docs/workflow-agent/` (RCA, implementasi Tahap 3, hasil uji final).

**Menunggu / belum dikerjakan**
- Penyelarasan alat: user memilih saklar di `.env.local` (lihat logbook 26 Nov, Entri 5); arti koma izin ganda belum dikonfirmasi tim lain; alat tulis umum ±150 (butuh hak tulis PG dari tim IT); penangan khusus yang belum ada 35–47 alat. Di Kelola AI (user): 4 alat tulis belum disetujui, `asisten_pengajuan` belum tersambung.
- Uji ke **Ratu AI OpenClaw milik mentor** (8 pengguna × 3 pertanyaan, Q1–Q8): menunggu izin & cara akses. Dokumen: `docs/benchmark/permintaan-uji-openclaw-8-pengguna.md`. Q5 bisa membuat tiket sungguhan.
- Uji live T2–T6 (multi-giliran, variasi, uji ulang, A/B, pembatalan) — skrip siap. T1 dihentikan atas keputusan user.
- Uji setelan max-num-seqs 8: **berhenti dan minta izin** sebelum mengubah konfigurasi server.
- Portal belum memakai prompt caching Anthropic (peluang hemat ±45–60%).
- Pekerjaan Qwen via Colab ditahan user sejak 26 Okt — jangan dilanjutkan tanpa diminta.
- Daftar tertunda lama (Okt): lihat arsip, bagian "Berikutnya" & "Tertunda".

---

## Jebakan yang sudah pernah terjadi (ringkas)

| Jebakan | Intinya |
|---|---|
| Docs/tipe library tidak sesuai kenyataan | Docs VoltAgent Next.js, `ollama.chat(id, settings)`, impor default Baileys, `UsageInfo` (pakai `inputTokens`). Cek `node_modules/<paket>/dist/*.d.ts` |
| Versi terkunci | `ai@6` (jangan v7 sebelum VoltAgent mendukung), `ollama-ai-provider-v2@^3.6`, Baileys 6.17.16 (bukan RC 7) |
| Next.js 16 | `middleware.ts` → `proxy.ts`; route baru tidak otomatis terbuka di proxy; Turbopack kadang perlu hapus `.next` |
| Kurs di klien | Wajib `NEXT_PUBLIC_KURS_USD` (17.900), ikut ter-bundel saat build |
| Hak kolom PostgreSQL | `information_schema` menyembunyikan hak per kolom → pakai `has_column_privilege()` |
| Collation MySQL | Tabel baru wajib `utf8mb4_unicode_ci`, kalau tidak JOIN gagal saat runtime |
| Pool koneksi | Satu pool per user DB, dibagi antarmodul (batas `MAX_USER_CONNECTIONS`) |
| Model mengarang | Nama produk, klaim "sudah tersimpan", angka hasil query disesuaikan sendiri → aturan instruksi + penjaga alur |
| Tanggal hari ini | Disuntik per request ke instruksi (`bagianTanggal()`), model tidak tahu sendiri |
| Uji yang dihentikan | Bisa meninggalkan data uji nyangkut → skrip uji membersihkan sisa di awal |
| `TaskStop` | Tidak membunuh proses anak `tsx` → cek proses yatim |
| Persentil | Semua laporan baru pakai interpolasi linear; laporan lama (peringkat terdekat) bisa beda |

Detail tiap jebakan: cari kata kuncinya di arsip.

---

## Indeks arsip `docs/riwayat/catatan-pengembangan-sep-nov-2026.md`

Nomor = baris di berkas arsip. Buka dengan `Read` offset/limit, atau `grep -n`.

| Baris | Bagian |
|---:|---|
| 77 | Stack & versi terkunci (tabel lengkap) |
| 138 | Setup VoltAgent + Next.js · 178 contoh docs usang · 196 pilihan model |
| 230 | Arsitektur 13 Okt + peta berkas · 302 prinsip data · 307 keamanan DB |
| 355 | Tahap 1–6 (23 Sep): MySQL read-only, view, embedding, `cari_teks` |
| 688 | Portal multi-departemen: login, proxy, HR, isolasi peran |
| 985 | Riwayat percakapan, tampilan, tema |
| 1272 / 1359 / 1525 | Ollama · Bifrost (Gemma) · memori model lokal (`num_ctx`) |
| 1595 | Deploy (build + Cloudflare Tunnel) |
| 1687 | Bot WhatsApp (LID, kode verifikasi, `/model`) |
| 1967 / 2045 / 2227 / 2305 | Kuota · pendaftaran & persetujuan admin · penautan WA · token & biaya per jawaban |
| 2433 – 3140 | Entri penjualan: draf, izin tulis, konfirmasi, pembatalan |
| 3149 – 3600 | Entri HR: lembur, pelamar, persetujuan |
| 3639 / 3708 | PostgreSQL perusahaan: role read-only, sumber data Tahap A–E, 9A–9B |
| 3972 / 4038 | Login akun perusahaan (10A–10B) |
| 4143 / 4221 | Baca dokumen, OCR |
| 4276 – 4463 | RAG SOP (15A–16) |
| 5694 / 5655 / 5529 | Kelola AI (23) · penyaring dari layar (24) · persetujuan alat tulis tim lain (25) |
| 5464 / 5313 | Operasi `tambah` (26) · Qwen 14B lewat API + bug perute (27) |
| 5250 – 4529 | Ramalan penjualan (28–31) · riset pasar (32) |
| 6307 / 6345 / 6367 | Keadaan 26 Okt · rencana berikutnya · tertunda |

Catatan November (gateway, benchmark, penjaga alur, dashboard) tidak ada di arsip ini — lihat `docs/logbook/logbook-*-nov-2026.md` dan `docs/benchmark/`, `docs/workflow-agent/`.

<!-- ryux-rules:start -->
## RYUX

RYUX is installed as one skill, `ryux`, in this project's agent skills folder. Load it before any
UI, UX, copy, frontend, or product visual work (illustration, 3D, imagery, motion), even when the
request does not mention RYUX. Say what you are doing (analyze, design, build, critique, or QA); RYUX
picks the knowledge it needs and ends with the Delivery Gate. Reference data and structured review will come
from the ryux MCP, which is not available yet.
<!-- ryux-rules:end -->
