/**
 * Kamus data HR yang ditempel ke instructions agent.
 *
 * Disusun dari penelusuran langsung ke database (23 Sep 2026), bukan tebakan.
 * Kalau skema berubah: jalankan `npm run gen:schema -- hr`, lalu samakan
 * daftar tabel di bawah dengan hasilnya.
 *
 * KAMUS_DATA        dipakai semua peran.
 * KAMUS_DATA_KEPALA disambung khusus untuk peran 'kepala' -- berisi tabel &
 *                   kolom kompensasi yang memang tidak bisa dibaca staf.
 */

export const KAMUS_DATA = `
## Daftar tabel (database \`hr\`, 21 tabel)

| Tabel | Baris | Isi |
|---|---|---|
| absensi | 41.396 | Absensi harian, HANYA hari kerja (Senin-Jumat) |
| karyawan | 254 | Data induk karyawan |
| kontrak | 287 | Riwayat kontrak kerja |
| jabatan | 12 | Master jabatan (level & grade) |
| departemen | 12 | Master departemen |
| lokasi_kerja | 6 | Lokasi kerja perusahaan |
| cuti | 465 | Pengajuan cuti |
| saldo_cuti | 243 | Saldo cuti tahunan per karyawan |
| lembur | 585 | Pengajuan & realisasi lembur |
| penilaian_kinerja | 423 | Penilaian kinerja per periode |
| pelanggaran | 60 | Catatan pelanggaran & sanksi |
| resignasi | 28 | Data resign / turnover |
| riwayat_jabatan | 40 | Promosi, rotasi, mutasi |
| lowongan | 14 | Lowongan / permintaan tenaga kerja |
| pelamar | 454 | Pelamar kerja |
| tahapan_seleksi | 952 | Riwayat tahapan seleksi pelamar |
| training | 11 | Program pelatihan |
| training_peserta | 235 | Peserta training |
| survey_engagement | 1 | Survei keterlibatan karyawan |
| engagement_response | 996 | Jawaban survei engagement |

## ⚠️ ATURAN PALING PENTING: JANGAN PAKAI \`SELECT *\`

Beberapa tabel dibatasi per KOLOM oleh izin MySQL. \`SELECT *\` akan **gagal**
karena tanda bintang ikut memuat kolom yang tidak boleh dibaca.
**Selalu sebutkan nama kolom satu per satu.**

Contoh benar : \`SELECT nama, status_kerja FROM karyawan LIMIT 10\`
Contoh salah : \`SELECT * FROM karyawan LIMIT 10\`  <- ditolak MySQL

## 5 aturan WAJIB saat bikin query

1. **Ada DUA kolom status di \`karyawan\` — jangan tertukar.**
   - \`status_kerja\`    = masih kerja atau tidak: AKTIF (223), RESIGN (28), PENSIUN (3)
   - \`status_karyawan\` = jenis kepegawaian: TETAP (174), KONTRAK (70), MAGANG (10)

   Untuk "berapa karyawan kita" jawabannya **223** (filter \`status_kerja='AKTIF'\`),
   BUKAN 254 (itu termasuk yang sudah resign & pensiun).

2. **\`absensi\` hanya berisi hari kerja.** Sabtu & Minggu memang tidak ada barisnya.
   Jadi jangan hitung "hari tidak masuk" dari selisih tanggal — pakai kolom \`status\`.

3. **Kolom teks isinya template berulang.** \`lembur.alasan\` cuma punya 9 kalimat
   berbeda dari 585 baris; \`tahapan_seleksi.catatan\` 17 dari 952. Jadi untuk
   pertanyaan "alasannya apa saja", \`GROUP BY\` memberi jawaban LENGKAP dan PERSIS —
   tidak perlu cara lain.

4. **\`penilaian_kinerja.periode\` itu SEMESTERAN**, bukan bulanan.
   Nilainya '2025-H2' dan '2026-H1'. Jangan disamakan dengan '2026-01'.

5. **\`pelamar\` bisa punya \`karyawan_id\`** kalau dia akhirnya diterima
   (status HIRED). Kalau NULL berarti belum/tidak jadi karyawan.

## Nilai enum

- karyawan.status_kerja: AKTIF, RESIGN, PENSIUN
- karyawan.status_karyawan: TETAP, KONTRAK, MAGANG
- karyawan.pendidikan: S1 (99), SMA/SMK (87), D3 (59), S2 (9)
- karyawan.jenis_kelamin: L (132), P (122)
- kontrak.jenis: PKWTT, PKWT, MAGANG — kontrak.status: AKTIF, DIPERPANJANG, BERAKHIR
- absensi.status: HADIR (35.281), TERLAMBAT (4.239), CUTI (785), SAKIT (484), IZIN (329), ALPA (278)
- cuti.jenis: TAHUNAN, SAKIT, PENTING, TANPA_GAJI, MELAHIRKAN — cuti.status: APPROVED, REJECTED, PENDING
- lembur.status: APPROVED, REJECTED, PENDING
- penilaian_kinerja.rating: A (27), B (146), C (179), D (62), E (9)
- pelanggaran.sanksi: TEGURAN_LISAN (31), SP1 (25), SP2 (4)
- pelamar.status: REJECTED (394), SCREENING (24), HIRED (16), PSIKOTES, INTERVIEW_HR, INTERVIEW_USER, OFFERING
- tahapan_seleksi.tahap: SCREENING -> PSIKOTES -> INTERVIEW_HR -> INTERVIEW_USER -> OFFERING
- tahapan_seleksi.hasil: LULUS (660), TIDAK_LULUS (248), PENDING (44)
- resignasi.kategori_alasan: Karier (8), Gaji/Benefit (7), Lingkungan Kerja (6), Lanjut Studi (3), Keluarga (2), Kesehatan (1), Lain-lain (1)
- riwayat_jabatan.jenis: PROMOSI (22), ROTASI (11), MUTASI (7)
- training_peserta.status: HADIR (211), TIDAK_HADIR (15), TERDAFTAR (9)
- jabatan.level: Operator, Staff, Supervisor, Manager, General Manager, Direktur (grade G1-G7)
- departemen: HRD, FIN, ITD, MKT, SLS, PRD, QCL, RND, SCM, GAF, PUR, WHS

## Kolom tiap tabel (nama persis — JANGAN ditebak)

absensi: id, karyawan_id, tanggal, jam_masuk, jam_pulang, status, menit_terlambat
cuti: id, karyawan_id, jenis, tanggal_mulai, tanggal_selesai, jumlah_hari, alasan, status, approver_id, tanggal_pengajuan
departemen: id, kode, nama, lokasi_id
engagement_response: id, survey_id, karyawan_id, aspek, skor, komentar
jabatan: id, nama, level, grade
karyawan: id, nik, nama, jenis_kelamin, tanggal_lahir, status_pernikahan, pendidikan, email, telepon, departemen_id, jabatan_id, lokasi_id, atasan_id, tanggal_masuk, status_karyawan, status_kerja, tanggal_keluar
kontrak: id, karyawan_id, jenis, tanggal_mulai, tanggal_selesai, status
lembur: id, karyawan_id, tanggal, jam, alasan, status

**Data kompensasi ADA, tapi dibatasi per peran.**

Gaji, payroll, rentang gaji jabatan, dan nilai rupiah lembur TERSIMPAN di
database ini. Yang menentukan kamu bisa melihatnya atau tidak adalah izin
MySQL akun yang kamu pakai, bukan ada-tidaknya datanya.

Kalau kolom-kolom itu tidak ada di daftar di atas, berarti peran ini tidak
punya aksesnya. Kalau user menanyakannya, bilang **"saya tidak punya akses ke
data itu, coba tanyakan ke kepala HR"** — JANGAN bilang datanya tidak ada atau
tidak dicatat. Itu keliru, dan user bisa meneruskan kekeliruan itu ke atasannya.
lokasi_kerja: id, nama, kota, tipe
lowongan: id, kode, jabatan_id, departemen_id, jumlah_dibutuhkan, tanggal_buka, tanggal_tutup, status
pelamar: id, lowongan_id, nama, email, telepon, pendidikan, pengalaman_tahun, sumber, tanggal_lamar, status, karyawan_id
pelanggaran: id, karyawan_id, tanggal, jenis, sanksi, keterangan
penilaian_kinerja: id, karyawan_id, periode, skor_kpi, skor_kompetensi, nilai_akhir, rating, catatan, penilai_id, tanggal_review
resignasi: id, karyawan_id, tanggal_pengajuan, tanggal_efektif, kategori_alasan, keterangan, skor_exit_interview
riwayat_jabatan: id, karyawan_id, tanggal, jenis, jabatan_lama_id, jabatan_baru_id, departemen_baru_id, catatan
saldo_cuti: karyawan_id, tahun, kuota, terpakai, sisa
survey_engagement: id, judul, periode, tanggal_mulai, tanggal_selesai
tahapan_seleksi: id, pelamar_id, tahap, tanggal, hasil, catatan
training: id, judul, kategori, penyelenggara, tanggal_mulai, tanggal_selesai, lokasi, biaya
training_peserta: id, training_id, karyawan_id, status, nilai_post_test

## Pola JOIN baku

Hampir semua pertanyaan berangkat dari \`karyawan\`:

\`\`\`sql
FROM karyawan k
JOIN departemen d ON d.id = k.departemen_id
JOIN jabatan j    ON j.id = k.jabatan_id
WHERE k.status_kerja = 'AKTIF'
\`\`\`

Atasan langsung: \`LEFT JOIN karyawan a ON a.id = k.atasan_id\` (self-join).
Filter bulan absensi: \`DATE_FORMAT(a.tanggal, '%Y-%m') = '2026-08'\`.

## Rumus istilah HR

| Istilah | Rumus |
|---|---|
| Jumlah karyawan | COUNT(*) WHERE status_kerja='AKTIF' |
| Turnover rate | jumlah resign periode itu / rata-rata karyawan aktif x 100% |
| Tingkat kehadiran | HADIR / total baris absensi periode itu |
| Tingkat keterlambatan | TERLAMBAT / total baris absensi |
| Absensi bermasalah | status IN ('ALPA','TERLAMBAT') |
| Sisa cuti | saldo_cuti.sisa (sudah dihitung, jangan kurangi manual) |
| Masa kerja | DATEDIFF / TIMESTAMPDIFF dari tanggal_masuk |
| Conversion rate rekrutmen | pelamar HIRED / total pelamar |
| Cost per hire | training/rekrutmen tidak punya kolom biaya per lowongan — jelaskan tidak tersedia |

## Jebakan waktu

- **Rentang data: 1 Januari – 20 September 2026.** Absensi sampai 18 Sep,
  cuti sampai 20 Sep. Kalau user tanya "bulan ini", cek dulu datanya ada.
- \`kontrak.tanggal_mulai\` bisa mundur sampai 2012 (karyawan lama) — itu normal.
- \`pelamar.tanggal_lamar\` ada yang sampai **Oktober 2026**, melewati data lain.
- \`penilaian_kinerja\` cuma 2 periode: 2025-H2 dan 2026-H1.
`.trim();

/**
 * Tambahan KHUSUS peran 'kepala'.
 *
 * Staf HR tidak mendapat bagian ini -- dan memang tidak bisa membacanya,
 * karena user MySQL `hr_readonly` tidak diberi izin ke kolom/tabel ini.
 * Menyembunyikannya dari kamus data mencegah agent staf mencoba lalu ditolak
 * berulang kali.
 */
export const KAMUS_DATA_KEPALA = `
## Data kompensasi (khusus kepala HR)

Kamu punya akses ke data gaji. Perlakukan dengan hati-hati: sebutkan angka
individual hanya kalau user memang menanyakan orang tertentu.

| Tabel/kolom | Isi |
|---|---|
| \`payroll\` (2.069 baris) | Payroll bulanan per karyawan, periode 2026-01 s/d 2026-09 |
| \`karyawan.gaji_pokok\` | Gaji pokok terkini |
| \`jabatan.gaji_min\`, \`gaji_max\` | Rentang gaji per jabatan |
| \`lembur.nilai_rp\` | Nilai rupiah lembur |

Kolom \`payroll\`: id, periode, karyawan_id, gaji_pokok, tunjangan_jabatan,
tunjangan_transport, tunjangan_makan, upah_lembur, thr, potongan_bpjs,
potongan_pph21, potongan_absen, thp

**Jebakan payroll:**
- \`thp\` = take home pay, sudah bersih setelah potongan. Jangan jumlahkan
  komponen satu per satu kalau yang diminta THP.
- **Maret 2026 melonjak 2x lipat karena THR** (Rp 2,49 M dari total Rp 4,82 M).
  Kalau membandingkan antar bulan, sebutkan ini — kalau tidak, grafiknya menyesatkan.
  Bulan lain \`thr\` = 0.
- Jumlah baris payroll berubah tiap bulan (227-232) mengikuti karyawan masuk/keluar.
`.trim();
