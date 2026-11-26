# Rencana Bot WhatsApp (Baileys + VoltAgent)

## Konteks Project
- Project: AI assistant berbasis **VoltAgent + Next.js**
- Data: MySQL lokal, agent **hanya baca (read-only)**
- Kasus pertama: departemen **marketing** (sales, engagement)
- Tujuan baru: user bisa tanya ke agent lewat **WhatsApp**, selain lewat web

## Keputusan yang Sudah Diambil
| Topik | Keputusan | Alasan |
|---|---|---|
| Library WA | **Baileys** | Tanpa Docker, tanpa browser, paling ringan untuk laptop dengan resource terbatas |
| Opsi yang dicoret | WAHA (butuh Docker), OpenWA (tetap jalan browser/Chromium, v5 masih alpha) | Terlalu berat |
| API resmi Meta | **Tidak dipakai** | Tidak punya akun; Baileys cukup pakai nomor WA biasa + scan QR |
| Posisi bot | **Proses terpisah** (folder `wa-bot/`), bukan di dalam Next.js | Baileys butuh koneksi yang nyala terus; Next.js sering restart saat development sehingga koneksi bisa putus/dobel |
| Agent | **Satu agent dipakai bersama** oleh web dan bot WA | Tidak perlu duplikasi prompt/tools |

## Arsitektur
```
Web (Next.js)   ─┐
                 ├──► Agent VoltAgent (shared) ──► MySQL (read-only)
Bot WA (Baileys) ┘
```

## Langkah-langkah

### Persiapan
1. **Install Baileys** (paket npm `baileys`, dulu bernama `@whiskeysockets/baileys`) + library untuk menampilkan QR di terminal. Pakai Node.js versi 20 ke atas.
2. **Buat folder `wa-bot/`** berisi file utama bot, terpisah dari kode web.
3. **Pisahkan definisi agent** (prompt, tools MySQL, model) ke satu file sendiri supaya bisa di-import oleh web dan bot WA.

### Koneksi ke WhatsApp
4. **Login via QR**: jalankan bot → QR muncul di terminal → scan dari HP (menu *Perangkat Tertaut*).
5. **Simpan sesi login** ke folder (misal `wa-bot/auth/`) supaya tidak perlu scan ulang saat restart. **Masukkan folder ini ke `.gitignore`.**
6. **Auto-reconnect**: kalau koneksi putus, sambung ulang otomatis. Kalau statusnya *logged out* (logout dari HP), jangan reconnect — minta scan ulang.

### Logika Pesan
7. **Terima pesan + filter**. Abaikan jika:
   - pesan dari grup
   - pesan status/story
   - pesan dari nomor bot sendiri
   - nomor pengirim **tidak ada di daftar yang diizinkan (allowlist)** → penting karena ini data perusahaan
8. **Oper ke agent** dengan **nomor pengirim sebagai ID percakapan/user**, supaya agent ingat konteks tiap orang.
9. **Balas**: tampilkan status "sedang mengetik…" selama agent memproses, lalu kirim jawaban ke pengirim.

### Tes
10. Jalankan bot, kirim chat dari nomor lain yang ada di allowlist, cek balasan.

## Hal yang Perlu Disiapkan
- Nomor WA **khusus bot** (jangan nomor pribadi / nomor utama kantor)
- HP untuk scan QR sekali di awal
- Laptop/server yang menyala selama bot mau aktif
- Daftar nomor yang boleh akses (allowlist), disimpan di `.env`

## Risiko & Tips Anti-Banned
- Baileys **tidak resmi**, jadi ada risiko nomor diblokir
- Pakai untuk **internal dulu** (tim marketing), jangan broadcast massal
- Jangan mengirim pesan duluan ke nomor yang belum pernah chat
- Beri jeda sedikit sebelum membalas (efek "mengetik")
- Nomor baru sebaiknya dipakai chat normal beberapa hari dulu ("dipanaskan")
- Kalau nanti dipakai ke customer skala besar → pertimbangkan pindah ke WhatsApp Cloud API resmi

## Saran Urutan Kerja di Claude Code
1. Minta Claude Code membaca struktur project dan menemukan file definisi agent yang sekarang
2. Kerjakan **Langkah 1–3** (install, folder, pisahkan agent) → pastikan web masih jalan normal
3. Kerjakan **Langkah 4–6** (koneksi + sesi + reconnect) → tes scan QR saja dulu, belum membalas
4. Kerjakan **Langkah 7–9** (filter, oper ke agent, balas)
5. Tambahkan script di `package.json` untuk menjalankan bot terpisah dari web
6. Tes end-to-end (Langkah 10)

Contoh prompt pembuka untuk Claude Code:
> Baca file `rencana-bot-wa-baileys.md` ini dan struktur project saya. Kita kerjakan Langkah 1–3 dulu. Jelaskan dulu apa yang akan kamu ubah sebelum menulis kode.
