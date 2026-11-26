# MR AI Gateway — catatan MVP

## Yang dibangun

Dashboard lokal mandiri berada di `mr-gateway/`, dengan login di `http://localhost:3020/login`. Aplikasi ini dipisahkan dari aplikasi portal supaya tidak melewati proxy dan koneksi database portal. Portal, `proxy.ts`, dan autentikasi portal tidak diubah untuk membuka dashboard ini. UI berbahasa Indonesia menyediakan ikhtisar, direktori developer, metadata API key, analitik penggunaan, log permintaan tanpa isi prompt/jawaban, dan kesehatan sistem. Semua permintaan LiteLLM berjalan di server Next.js; master key tidak dikirim ke peramban. List key dan user disaring ke field metadata yang diizinkan.

Dashboard terhubung melalui `LITELLM_BASE_URL` yang default-nya `http://127.0.0.1:4000`. Tidak ada perubahan EC2, Docker, jaringan, atau database. OpenAPI gateway lokal dibaca secara GET-only untuk memetakan path dan request schema. Tunnel pada port 4000 terverifikasi lewat readiness `healthy` dan database `connected`; daftar model terautentikasi terbaca dari gateway. Route dashboard juga tetap dilindungi sesi portal perusahaan yang diwajibkan `proxy.ts`, lalu sesi khusus dashboard memisahkan peran admin dan viewer.

## Setup lokal

1. Pastikan operator sudah membuat SSH tunnel lokal yang disetujui. Jangan jalankan tunnel dengan key yang dibaca oleh aplikasi.
2. Buat `mr-gateway/.env.local` dari `mr-gateway/.env.example`. Isi `MR_GATEWAY_ADMIN_PASSWORD` (min. 12 karakter) dan `MR_GATEWAY_AUTH_SECRET` (min. 32 karakter). Isi `LITELLM_MASTER_KEY` dari secret store lokal untuk akses management. Opsional, isi `MR_GATEWAY_VIEWER_PASSWORD`.
3. Dari `marketing/mr-gateway`, jalankan `npm run dev`, lalu buka `http://localhost:3020/login`.

Sesi login ditandatangani HS256, HttpOnly, SameSite=Lax, dan kedaluwarsa setelah 8 jam. Viewer hanya dapat membaca dashboard; API mutation memerlukan role admin. Tanpa konfigurasi login, halaman login menampilkan setup yang dibutuhkan. Tanpa master key, fitur management tidak tersedia. Jangan gunakan fallback secret demo pada deployment bersama; set `MR_GATEWAY_AUTH_SECRET` secara eksplisit.

## Batas MVP

- Overview dan tren token menampilkan “—”/“belum tersedia” sampai respons agregasi LiteLLM dipetakan dan diuji. Log memberi ringkasan maksimum halaman pertama; paginasi lanjutan dan filter aktif masih tahap berikutnya.
- CRUD user lokal, audit log persisten, dan create user belum dibuat karena aplikasi belum memiliki database admin terpisah serta pemetaan policy user belum ditetapkan.
- Form penerbitan key/konfirmasi interaktif belum diaktifkan di UI; endpoint server untuk admin siap setelah auth dan master key dikonfigurasi. Periksa payload OpenAPI terhadap versi gateway sebelum menggunakan aksi produksi.
- Konkurensi dapat diteruskan sebagai `max_parallel_requests`; batas RPM/TPM tersedia bila API gateway mengaktifkannya.
- Angka biaya, latency, TTFT, GPU, dan TPS tidak direka.

## Pemeriksaan

Dilakukan pemeriksaan koneksi GET readiness, GET `/openapi.json`, dan GET daftar endpoint. Tidak ada endpoint mutasi LiteLLM yang dipanggil. Typecheck terisolasi untuk seluruh file dashboard berhasil (`tsc --project .tsconfig-mr-gateway.json`, Node heap 2 GB). Typecheck repo penuh gagal pada route validator `.next` lama dan dua script kerja ramalan di luar scope; satu percobaan typecheck terisolasi tanpa batas heap juga OOM. `next build` belum terverifikasi karena proses worker build tidak mengembalikan status final dan percobaan ulang mendeteksi build lock. Smoke test browser belum dilakukan.
