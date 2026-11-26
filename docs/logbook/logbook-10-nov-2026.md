# Logbook Harian — Integrasi Qwen3-14B AWS dan Pengembangan Ratu AI

**Tanggal:** Selasa, 10 November 2026  
**Proyek:** Integrasi model Qwen3-14B pada Ratu AI, pengelolaan API Gateway, dan evaluasi workflow RAG SOP  
**Lingkungan kerja:** AWS EC2 Jakarta (`ap-southeast-3`), Docker/vLLM, LiteLLM, PostgreSQL, Windows PowerShell, dan portal Ratu AI (Next.js/TypeScript)

> Pekerjaan hari ini berfokus pada penyelesaian infrastruktur inference Qwen3-14B berbasis AWS agar dapat diakses melalui API, penyiapan mekanisme API key untuk pengguna, serta integrasi model sebagai salah satu provider pada menu dropdown Ratu AI. Pengujian dilanjutkan ke kemampuan tool calling dan pencarian dokumen SOP berbasis RAG.

> **Temuan utama hari ini:** Qwen3-14B berhasil menjawab permintaan dari laptop melalui SSH Tunnel dan menghasilkan `tool_calls` yang valid lewat LiteLLM. Akan tetapi, pada pertanyaan SOP pengajuan cuti, agent menemukan dokumen yang relevan namun gagal mengolah hasilnya pada putaran berikutnya karena konteks yang dikirim melebihi batas deployment 8.192 token. Perbaikan pembatasan RAG dan jumlah tools telah dilaporkan dari pengembangan portal, tetapi hasil uji ulang akhir masih perlu diverifikasi.

---

## Ringkasan

| Pekerjaan | Status |
|---|---|
| Pembuatan jaringan Docker internal untuk vLLM | Selesai |
| Konfigurasi PostgreSQL dan LiteLLM API Gateway | Selesai |
| Pengujian Chat Completions melalui LiteLLM | Berhasil |
| Pembuatan dan pengujian Virtual API Key | Berhasil |
| Akses API AWS dari Windows melalui SSH Tunnel | Berhasil |
| Penyusunan spesifikasi dashboard pengelolaan API dan monitoring | Selesai sebagai rancangan; web custom belum diimplementasikan |
| Penambahan Qwen3-14B (Gateway) ke dropdown provider Ratu AI | Diimplementasikan pada portal berdasarkan hasil Codex |
| Aktivasi parser tool calling pada vLLM | Selesai |
| Pengujian `get_inventory_stock` melalui LiteLLM | Berhasil menghasilkan pemanggilan fungsi |
| Pengujian pencarian SOP pengajuan cuti melalui Qwen | Dokumen ditemukan, jawaban akhir belum sesuai |
| Optimasi jumlah potongan RAG dan daftar tools | Dilaporkan diterapkan di kode portal; perlu pengujian ulang |
| Peningkatan context window vLLM menjadi 16.384 token | Belum dilakukan; masih usulan pengujian |
| Akses API publik dengan domain/HTTPS | Belum dilakukan; sementara melalui SSH Tunnel |

---

## Entri 1 — Persiapan jaringan Docker untuk layanan inference

Memeriksa deployment Qwen3-14B-AWQ yang telah berjalan pada instance AWS EC2 GPU dan menyiapkan komunikasi internal antara server inference dengan API Gateway. Jaringan Docker bernama `ai-internal` dibuat dan container `qwen3-vllm` dihubungkan tanpa perlu menginstal ulang model.

Verifikasi jaringan menunjukkan container `qwen3-vllm` terdaftar dengan alamat internal `172.18.0.2/16`. Komunikasi antarlayanan dirancang menggunakan nama container `qwen3-vllm:8000`, sehingga tidak bergantung pada alamat IP Docker yang dapat berubah.

Konfigurasi keamanan tetap mempertahankan port inference `8000` yang hanya dipublikasikan pada `127.0.0.1` di host, bukan secara langsung ke internet.

---

## Entri 2 — Pemasangan LiteLLM API Gateway dan PostgreSQL

Menyiapkan direktori `/opt/qwen3/gateway`, konfigurasi environment, file `config.yaml`, serta `compose.yaml` untuk menjalankan PostgreSQL dan LiteLLM. PostgreSQL menggunakan persistent volume, sedangkan LiteLLM terhubung ke jaringan Docker internal yang sama dengan vLLM.

Pada tahap awal, akses ke endpoint readiness sempat menghasilkan `Connection reset by peer`. Pemeriksaan status Docker menunjukkan PostgreSQL berstatus `healthy` dan LiteLLM berstatus `Up`. Log LiteLLM memperlihatkan migrasi database telah diterapkan, proses startup selesai, dan server Uvicorn berjalan pada port `4000`.

Pengujian berikutnya membuktikan endpoint readiness dari Windows mengembalikan HTTP `200 OK` dengan respons `{"status":"healthy","db":"connected"}`. Ini mengonfirmasi bahwa LiteLLM dan koneksi database berfungsi melalui jalur akses yang disiapkan.

---

## Entri 3 — Verifikasi API model dan pengujian inference

Memeriksa daftar model melalui endpoint `GET /v1/models` menggunakan autentikasi LiteLLM Master Key. API berhasil menampilkan model `qwen3-14b` dengan metadata batas input dan output 8.192 token.

Pengujian `POST /v1/chat/completions` melalui LiteLLM berhasil menghasilkan jawaban bahasa Indonesia untuk pertanyaan tentang AI Agent. Hasil pengujian yang terdokumentasi menggunakan 28 prompt token, 71 completion token, dan 99 token total, dengan `finish_reason: stop`.

Pengujian lain dilakukan menggunakan Virtual API Key developer untuk pertanyaan tiga manfaat AI dalam pengembangan aplikasi. Model mengembalikan jawaban yang relevan dengan total 284 token (28 input dan 256 output).

Hasil ini memastikan alur **client → LiteLLM → vLLM → Qwen3-14B** telah berjalan untuk permintaan chat biasa.

---

## Entri 4 — Pembuatan API Key dan akses server dari Windows

Membuat Virtual API Key melalui fitur manajemen LiteLLM dan mengujinya sebagai kredensial inference terpisah dari Master Key administrator. Konsep pengelolaan pengguna memungkinkan pemberian key berbeda untuk developer dan pemantauan pemakaian masing-masing.

Akses dari laptop Windows disiapkan menggunakan SSH Tunnel ke EC2 dengan port forwarding lokal `127.0.0.1:4000`. Saat percobaan pertama, OpenSSH menolak private key `.pem` karena permission file terlalu terbuka. Izin akses berkas diperbaiki melalui `icacls` sehingga private key hanya dapat dibaca oleh akun yang diizinkan.

Setelah koneksi tunnel aktif, pemeriksaan `/health/readiness` dari PowerShell memberikan HTTP `200 OK`. Pengujian chat menggunakan Virtual API Key dari laptop juga berhasil; Qwen3-14B memperkenalkan dirinya dalam bahasa Indonesia.

Untuk POC, akses masih bergantung pada SSH Tunnel aktif. Saat tunnel ditutup, akses API dari laptop terputus, meskipun layanan AWS tetap berjalan. Private key yang pernah dibagikan ke percakapan perlu dirotasi sebelum akses diperluas.

---

## Entri 5 — Rancangan web administrasi dan monitoring AI Gateway

Menyusun kebutuhan web **Mustika Ratu AI Gateway Dashboard** untuk mengelola pemakaian API oleh banyak developer tanpa membuat ulang fungsi inti LiteLLM. Rancangan memanfaatkan LiteLLM Management API, PostgreSQL, dan frontend Next.js/TypeScript.

Fitur yang direncanakan mencakup:

- dashboard total requests, input/output tokens, status layanan, dan tingkat keberhasilan;
- pengelolaan user serta Virtual API Key, termasuk masa aktif, rate limit, dan pencabutan akses;
- statistik penggunaan token per user, key, model, dan periode waktu;
- request logs serta metrik latency dan throughput;
- monitoring vLLM/GPU melalui metrik tambahan;
- audit perubahan administrasi serta laporan penggunaan.

Spesifikasi teknis disusun dalam Markdown untuk diteruskan ke Codex. Pada hari ini dashboard custom masih berada di tahap perancangan; belum ada bukti bahwa seluruh modul tersebut telah diimplementasikan atau di-deploy.

---

## Entri 6 — Integrasi Qwen3-14B sebagai provider Ratu AI

Melanjutkan pengembangan portal Ratu AI dengan menambahkan provider baru dari `.env.local`. Berdasarkan hasil pekerjaan Codex, model ditampilkan sebagai **Qwen3 14B (Gateway)** pada dropdown, menggunakan variabel `AI_BASE_URL`, `AI_API_KEY`, dan `AI_MODEL`. Provider default portal tetap Sonnet, dan API key disimpan pada sisi server.

Percobaan awal menunjukkan permintaan sudah mencapai LiteLLM dan model Qwen3, tetapi workflow agent mengalami kegagalan saat membutuhkan tool calling. Penyebabnya adalah vLLM belum dikonfigurasi untuk melakukan pemilihan tool otomatis.

Hasil tersebut membedakan kemampuan menjawab percakapan biasa dengan kemampuan agent yang harus memilih fungsi, menjalankan alat aplikasi, menerima hasil, dan menyusun jawaban akhir.

---

## Entri 7 — Aktivasi dan pengujian tool calling Qwen3

Memeriksa parameter container vLLM melalui `docker inspect`, kemudian membuat ulang container dengan tetap mempertahankan model `Qwen/Qwen3-14B-AWQ`, volume cache, jaringan internal, port localhost, batas konteks 8.192 token, utilisasi GPU 0,85, dan `max-num-seqs 2`.

Menambahkan tiga parameter:

- `--enable-auto-tool-choice`;
- `--tool-call-parser hermes`;
- `--reasoning-parser qwen3`.

Container sebelumnya disimpan sebagai `qwen3-vllm-backup` untuk rollback. Container baru berhasil berjalan dan log menunjukkan `"auto" tool choice has been enabled` serta `Application startup complete`. Endpoint `/v1/models` tetap mengembalikan `qwen3-14b`.

Pengujian melalui LiteLLM menggunakan fungsi contoh `get_inventory_stock` dan produk **Bengkoang Whitening Body Lotion** berhasil menghasilkan `finish_reason: tool_calls` dengan nama fungsi serta argumen `product_name` yang tepat. Satu respons tercatat menggunakan 175 prompt token dan 30 completion token, atau total 205 token. Pengujian tersebut membuktikan model dapat **meminta pemanggilan fungsi**, tetapi belum membuktikan eksekusi database dan jawaban akhir oleh workflow Ratu AI.

---

## Entri 8 — Evaluasi perbedaan jawaban RAG SOP antarmodel

Menguji pertanyaan tentang prosedur pengajuan cuti melalui dropdown Ratu AI menggunakan Qwen3-14B Gateway dan membandingkan tampilan hasil dengan Haiku 4.5 serta Gemma 12B. Pada pengujian tersebut, Haiku dan Gemma memberikan langkah pengajuan cuti, sedangkan Qwen menyatakan SOP tidak ditemukan, walaupun bagian sumber menampilkan dokumen yang relevan.

Hasil analisis Codex terhadap log menunjukkan pencarian RAG sebenarnya berhasil:

- dokumen relevan: **Panduan Mengajukan Request (Cuti, Lembur, dll)**;
- peringkat hasil: pertama;
- kemiripan yang dilaporkan: **0,82**;
- panjang instruksi agen: **9.966 karakter**;
- jumlah tools terpasang: **15**;
- panjang hasil pencarian SOP: **6.507 karakter**;
- batas konteks deployment Qwen: **8.192 token**.

Masalah terjadi pada putaran setelah pencarian, ketika hasil RAG, instruksi, riwayat, dan schema tools dikirim kembali ke model sehingga request ditolak karena konteks terlalu panjang. Teks awal yang telanjur dikirim oleh agent tetap tampil sebagai jawaban parsial, sehingga pengguna menerima kesimpulan yang tidak sesuai dengan hasil pencarian.

Codex melaporkan perubahan untuk mengurangi hasil RAG dari lima menjadi tiga potongan teratas, membatasi tools menjadi maksimal sepuluh per agen, dan mencegah Qwen menyimpulkan ketiadaan SOP sebelum hasil `cari_sop` diterima. Pemeriksaan ESLint dilaporkan berhasil, tetapi pengujian akhir dengan percakapan baru belum terdokumentasi dalam aktivitas ini.

---

## Hasil pemeriksaan terakhir

| Pemeriksaan | Hasil |
|---|---|
| Docker network `ai-internal` | Berhasil, `qwen3-vllm` terhubung |
| PostgreSQL | Healthy |
| LiteLLM startup dan migrasi | Berhasil |
| Readiness API melalui SSH Tunnel Windows | HTTP 200; database connected |
| `/v1/models` melalui LiteLLM | Menampilkan `qwen3-14b` |
| Chat completion via Master Key | Berhasil |
| Chat completion via Virtual API Key | Berhasil |
| vLLM tool parser | Aktif dan terverifikasi pada log startup |
| `get_inventory_stock` tool call via LiteLLM | Berhasil menghasilkan `tool_calls` |
| Eksekusi penuh fungsi dalam Ratu AI | Belum terverifikasi |
| Jawaban SOP Qwen pada pengujian awal | Belum sesuai meskipun dokumen ditemukan |
| Perubahan pembatasan RAG/tools | Dilaporkan diterapkan; hasil pengujian ulang belum tersedia |
| Dashboard administrasi custom | Spesifikasi selesai; implementasi belum dibuktikan |

---

## Kesalahan dan temuan kerja hari ini

- Paste perintah multiline pada terminal browser sempat terlihat tercampur dan menyebabkan pemeriksaan ulang terhadap file Docker Compose. Isi file akhirnya terbukti lengkap.
- LiteLLM sempat mengembalikan `Connection reset by peer` ketika proses inisialisasi belum dipastikan selesai; log berikutnya menunjukkan migrasi dan startup berhasil.
- Perintah `docker run` untuk mengganti container vLLM sempat dijalankan dua kali. Docker menolak pembuatan kedua karena nama container sudah digunakan; container pertama tetap aktif.
- File private key SSH memiliki permission terlalu terbuka pada Windows, sehingga ditolak OpenSSH hingga izin akses diperbaiki.
- Pengujian chat biasa berhasil lebih dahulu, tetapi kebutuhan agent mengharuskan aktivasi dan pengujian tool calling secara terpisah.
- Hasil pencarian dokumen dengan kemiripan tinggi tidak menjamin jawaban akhir terbentuk bila model gagal membaca hasil tool pada putaran lanjutan.
- Error streaming dapat meninggalkan jawaban parsial yang menyesatkan apabila frontend tidak membedakan proses gagal dengan jawaban final.
- Batas konteks 8.192 token merupakan konfigurasi deployment vLLM saat ini; mengubah metadata model di LiteLLM saja tidak menaikkan kapasitas konteks server.

---

## Masalah yang masih terbuka

- **Validasi ulang SOP:** perlu menguji kembali pertanyaan cuti dalam percakapan baru untuk memastikan hasil pembatasan RAG dan tools berhasil.
- **Pengelolaan anggaran token:** perlu menghitung token aktual instruksi, riwayat, schema tools, hasil RAG, serta cadangan output sebelum setiap putaran agent.
- **Context window vLLM:** opsi pengujian 16.384 token masih perlu dievaluasi terhadap konsumsi VRAM, latency, dan request paralel; belum diterapkan.
- **Handling error streaming:** frontend perlu memastikan hasil parsial tidak disajikan sebagai jawaban final apabila putaran agent gagal.
- **Rate limit Virtual API Key:** batas yang dilaporkan Codex sebesar 1 RPM perlu diperiksa dan disesuaikan dengan kebutuhan beberapa putaran agent.
- **Akses tim:** koneksi masih melalui SSH Tunnel lokal. Penggunaan bersama membutuhkan pengaturan akses tersendiri serta rotasi SSH key yang pernah dibagikan.
- **Dashboard monitoring custom:** fitur pengelolaan user, token usage, latency, dan GPU masih dalam rancangan implementasi.

---

## Rencana berikutnya

1. Menguji ulang provider **Qwen3 14B (Gateway)** pada percakapan baru dengan pertanyaan SOP pengajuan cuti.
2. Memastikan `cari_sop` mengembalikan dokumen yang benar dan Ratu AI mampu menyusun jawaban akhir berdasarkan hasilnya.
3. Menambahkan token budgeting dan pengendalian riwayat/tool schemas agar putaran agent tidak melampaui konteks vLLM.
4. Memeriksa RPM dan batas konkurensi Virtual API Key untuk workflow agent multi-request.
5. Menguji secara bertahap opsi peningkatan context window vLLM hanya jika optimasi prompt dan RAG belum cukup.
6. Melanjutkan implementasi MVP dashboard admin Next.js untuk pengelolaan developer, API key, request logs, dan penggunaan token.
7. Menyiapkan monitoring performa inference (latency, throughput, VRAM) serta rencana akses privat tim yang lebih praktis.
8. Mendokumentasikan hasil uji end-to-end, perubahan konfigurasi, dan langkah rollback sebelum deployment lebih luas.
