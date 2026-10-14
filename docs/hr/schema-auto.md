# Skema Database `hr` (auto-generated)

> Dibuat otomatis oleh `scripts/generate-schema-doc.mts` pada 2026-09-24. **Jangan edit manual** — jalankan `npm run gen:schema`.
> Penjelasan istilah bisnis ada di [kamus-data.md](kamus-data.md).

## Daftar tabel

| Tabel | Baris | Keterangan |
|---|---:|---|
| `absensi` | 41.396 | Absensi harian (hari kerja saja) |
| `cuti` | 465 | Pengajuan cuti |
| `departemen` | 12 | Master departemen |
| `engagement_response` | 996 | Jawaban survei engagement |
| `jabatan` | 12 | Master jabatan dan salary range |
| `karyawan` | 254 | Data induk karyawan |
| `kontrak` | 287 | Riwayat kontrak kerja |
| `lembur` | 585 | Pengajuan dan realisasi lembur |
| `lokasi_kerja` | 6 | Lokasi kerja perusahaan |
| `lowongan` | 14 | Lowongan / permintaan tenaga kerja |
| `pelamar` | 454 | Pelamar kerja |
| `pelanggaran` | 60 | Catatan pelanggaran dan sanksi |
| `penilaian_kinerja` | 423 | Penilaian kinerja per periode |
| `resignasi` | 28 | Data resign / turnover |
| `riwayat_jabatan` | 40 | Riwayat promosi dan mutasi |
| `saldo_cuti` | 243 | Saldo cuti tahunan |
| `survey_engagement` | 1 | Survei keterlibatan karyawan |
| `tahapan_seleksi` | 952 | Riwayat tahapan seleksi pelamar |
| `training` | 11 | Program pelatihan |
| `training_peserta` | 235 | Peserta training |

## Relasi antar tabel

| Dari | Kolom | Ke |
|---|---|---|
| `absensi` | `karyawan_id` | `karyawan.id` |
| `cuti` | `approver_id` | `karyawan.id` |
| `cuti` | `karyawan_id` | `karyawan.id` |
| `departemen` | `lokasi_id` | `lokasi_kerja.id` |
| `engagement_response` | `karyawan_id` | `karyawan.id` |
| `engagement_response` | `survey_id` | `survey_engagement.id` |
| `karyawan` | `atasan_id` | `karyawan.id` |
| `karyawan` | `departemen_id` | `departemen.id` |
| `karyawan` | `jabatan_id` | `jabatan.id` |
| `karyawan` | `lokasi_id` | `lokasi_kerja.id` |
| `kontrak` | `karyawan_id` | `karyawan.id` |
| `lembur` | `karyawan_id` | `karyawan.id` |
| `lowongan` | `departemen_id` | `departemen.id` |
| `lowongan` | `jabatan_id` | `jabatan.id` |
| `pelamar` | `karyawan_id` | `karyawan.id` |
| `pelamar` | `lowongan_id` | `lowongan.id` |
| `pelanggaran` | `karyawan_id` | `karyawan.id` |
| `penilaian_kinerja` | `karyawan_id` | `karyawan.id` |
| `penilaian_kinerja` | `penilai_id` | `karyawan.id` |
| `resignasi` | `karyawan_id` | `karyawan.id` |
| `riwayat_jabatan` | `departemen_baru_id` | `departemen.id` |
| `riwayat_jabatan` | `jabatan_baru_id` | `jabatan.id` |
| `riwayat_jabatan` | `jabatan_lama_id` | `jabatan.id` |
| `riwayat_jabatan` | `karyawan_id` | `karyawan.id` |
| `saldo_cuti` | `karyawan_id` | `karyawan.id` |
| `tahapan_seleksi` | `pelamar_id` | `pelamar.id` |
| `training_peserta` | `karyawan_id` | `karyawan.id` |
| `training_peserta` | `training_id` | `training.id` |

## Detail kolom

### `absensi`

Absensi harian (hari kerja saja). Jumlah baris: 41.396.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `tanggal` | date | ya |  | — |
| `jam_masuk` | time | ya |  | — |
| `jam_pulang` | time | ya |  | — |
| `status` | varchar(12) | ya |  | HADIR, TERLAMBAT, SAKIT, IZIN, CUTI, ALPA, LIBUR |
| `menit_terlambat` | int | ya |  | — |

### `cuti`

Pengajuan cuti. Jumlah baris: 465.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `jenis` | varchar(15) | ya |  | TAHUNAN, SAKIT, MELAHIRKAN, PENTING, TANPA_GAJI |
| `tanggal_mulai` | date | ya |  | — |
| `tanggal_selesai` | date | ya |  | — |
| `jumlah_hari` | int | ya |  | — |
| `alasan` | varchar(255) | ya |  | Alasan yang ditulis karyawan |
| `status` | varchar(10) | ya |  | PENDING, APPROVED, REJECTED |
| `approver_id` | int | ya | FK → `karyawan` | FK karyawan.id (atasan yang approve) |
| `tanggal_pengajuan` | date | ya |  | — |

### `departemen`

Master departemen. Jumlah baris: 12.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `kode` | varchar(10) | ya | unik | — |
| `nama` | varchar(60) | ya |  | — |
| `lokasi_id` | int | ya | FK → `lokasi_kerja` | FK lokasi_kerja.id |

### `engagement_response`

Jawaban survei engagement. Jumlah baris: 996.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `survey_id` | int | ya | FK → `survey_engagement` | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `aspek` | varchar(30) | ya |  | Kompensasi, Karier, Atasan, Lingkungan Kerja, Beban Kerja, Fasilitas |
| `skor` | tinyint | ya |  | Skala 1-5 |
| `komentar` | text | ya |  | Masukan bebas karyawan |

### `jabatan`

Master jabatan dan salary range. Jumlah baris: 12.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `nama` | varchar(60) | ya |  | — |
| `level` | varchar(20) | ya |  | Operator, Staff, Supervisor, Manager, General Manager, Direktur |
| `grade` | char(2) | ya |  | G1 (terendah) - G7 (tertinggi) |

### `karyawan`

Data induk karyawan. Jumlah baris: 254.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `nik` | varchar(15) | ya | unik | Nomor induk karyawan |
| `nama` | varchar(100) | ya |  | — |
| `jenis_kelamin` | char(1) | ya |  | L / P |
| `tanggal_lahir` | date | ya |  | — |
| `status_pernikahan` | varchar(10) | ya |  | LAJANG, MENIKAH, CERAI |
| `pendidikan` | varchar(10) | ya |  | SMA/SMK, D3, S1, S2 |
| `email` | varchar(100) | ya |  | — |
| `telepon` | varchar(20) | ya |  | — |
| `departemen_id` | int | ya | FK → `departemen` | FK departemen.id |
| `jabatan_id` | int | ya | FK → `jabatan` | FK jabatan.id |
| `lokasi_id` | int | ya | FK → `lokasi_kerja` | FK lokasi_kerja.id |
| `atasan_id` | int | ya | FK → `karyawan` | FK karyawan.id (atasan langsung) |
| `tanggal_masuk` | date | ya |  | — |
| `status_karyawan` | varchar(10) | ya |  | TETAP, KONTRAK, MAGANG |
| `status_kerja` | varchar(10) | ya |  | AKTIF, RESIGN, PENSIUN |
| `tanggal_keluar` | date | ya |  | Terisi jika sudah tidak aktif |

### `kontrak`

Riwayat kontrak kerja. Jumlah baris: 287.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `jenis` | varchar(15) | ya |  | PKWT, PKWTT, MAGANG |
| `tanggal_mulai` | date | ya |  | — |
| `tanggal_selesai` | date | ya |  | NULL untuk karyawan tetap (PKWTT) |
| `status` | varchar(15) | ya |  | AKTIF, BERAKHIR, DIPERPANJANG |

### `lembur`

Pengajuan dan realisasi lembur. Jumlah baris: 585.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `tanggal` | date | ya |  | — |
| `jam` | decimal(4,1) | ya |  | Jumlah jam lembur |
| `alasan` | varchar(255) | ya |  | — |
| `status` | varchar(10) | ya |  | APPROVED, PENDING, REJECTED |

### `lokasi_kerja`

Lokasi kerja perusahaan. Jumlah baris: 6.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `nama` | varchar(60) | ya |  | — |
| `kota` | varchar(50) | ya |  | — |
| `tipe` | varchar(20) | ya |  | Head Office, Pabrik, Cabang, Gudang |

### `lowongan`

Lowongan / permintaan tenaga kerja. Jumlah baris: 14.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `kode` | varchar(20) | ya | unik | — |
| `jabatan_id` | int | ya | FK → `jabatan` | — |
| `departemen_id` | int | ya | FK → `departemen` | — |
| `jumlah_dibutuhkan` | int | ya |  | — |
| `tanggal_buka` | date | ya |  | — |
| `tanggal_tutup` | date | ya |  | — |
| `status` | varchar(12) | ya |  | OPEN, CLOSED, ON_HOLD |

### `pelamar`

Pelamar kerja. Jumlah baris: 454.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `lowongan_id` | int | ya | FK → `lowongan` | — |
| `nama` | varchar(100) | ya |  | — |
| `email` | varchar(100) | ya |  | — |
| `telepon` | varchar(20) | ya |  | — |
| `pendidikan` | varchar(10) | ya |  | — |
| `pengalaman_tahun` | int | ya |  | — |
| `sumber` | varchar(20) | ya |  | JobStreet, LinkedIn, Referral, Walk-in, Kampus |
| `tanggal_lamar` | date | ya |  | — |
| `status` | varchar(20) | ya |  | SCREENING, INTERVIEW_HR, INTERVIEW_USER, OFFERING, HIRED, REJECTED |
| `karyawan_id` | int | ya | FK → `karyawan` | Terisi jika diterima jadi karyawan |

### `pelanggaran`

Catatan pelanggaran dan sanksi. Jumlah baris: 60.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `tanggal` | date | ya |  | — |
| `jenis` | varchar(40) | ya |  | mis. Terlambat berulang, Mangkir, Kelalaian K3 |
| `sanksi` | varchar(15) | ya |  | TEGURAN_LISAN, SP1, SP2, SP3 |
| `keterangan` | varchar(255) | ya |  | — |

### `penilaian_kinerja`

Penilaian kinerja per periode. Jumlah baris: 423.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `periode` | varchar(10) | ya |  | mis. 2025-H2, 2026-H1 |
| `skor_kpi` | decimal(4,1) | ya |  | Skala 0-100 |
| `skor_kompetensi` | decimal(4,1) | ya |  | Skala 0-100 |
| `nilai_akhir` | decimal(4,1) | ya |  | — |
| `rating` | char(1) | ya |  | A (istimewa) - E (kurang) |
| `catatan` | text | ya |  | Catatan kualitatif dari penilai |
| `penilai_id` | int | ya | FK → `karyawan` | — |
| `tanggal_review` | date | ya |  | — |

### `resignasi`

Data resign / turnover. Jumlah baris: 28.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `tanggal_pengajuan` | date | ya |  | — |
| `tanggal_efektif` | date | ya |  | — |
| `kategori_alasan` | varchar(30) | ya |  | Gaji/Benefit, Karier, Lingkungan Kerja, Keluarga, Lanjut Studi, Kesehatan, Lain-lain |
| `keterangan` | text | ya |  | Alasan detail dari exit interview |
| `skor_exit_interview` | decimal(3,1) | ya |  | Skala 1-5 |

### `riwayat_jabatan`

Riwayat promosi dan mutasi. Jumlah baris: 40.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `tanggal` | date | ya |  | — |
| `jenis` | varchar(15) | ya |  | PROMOSI, MUTASI, ROTASI |
| `jabatan_lama_id` | int | ya | FK → `jabatan` | — |
| `jabatan_baru_id` | int | ya | FK → `jabatan` | — |
| `departemen_baru_id` | int | ya | FK → `departemen` | — |
| `catatan` | varchar(255) | ya |  | — |

### `saldo_cuti`

Saldo cuti tahunan. Jumlah baris: 243.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `karyawan_id` | int | tidak | PK | — |
| `tahun` | smallint | tidak | PK | — |
| `kuota` | int | ya |  | Hak cuti per tahun (hari) |
| `terpakai` | int | ya |  | — |
| `sisa` | int | ya |  | — |

### `survey_engagement`

Survei keterlibatan karyawan. Jumlah baris: 1.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `judul` | varchar(120) | ya |  | — |
| `periode` | varchar(10) | ya |  | — |
| `tanggal_mulai` | date | ya |  | — |
| `tanggal_selesai` | date | ya |  | — |

### `tahapan_seleksi`

Riwayat tahapan seleksi pelamar. Jumlah baris: 952.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `pelamar_id` | int | ya | FK → `pelamar` | — |
| `tahap` | varchar(20) | ya |  | SCREENING, PSIKOTES, INTERVIEW_HR, INTERVIEW_USER, OFFERING |
| `tanggal` | date | ya |  | — |
| `hasil` | varchar(12) | ya |  | LULUS, TIDAK_LULUS, PENDING |
| `catatan` | text | ya |  | Catatan interviewer |

### `training`

Program pelatihan. Jumlah baris: 11.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `judul` | varchar(120) | ya |  | — |
| `kategori` | varchar(30) | ya |  | Teknis, Soft Skill, K3, Leadership, Compliance |
| `penyelenggara` | varchar(60) | ya |  | — |
| `tanggal_mulai` | date | ya |  | — |
| `tanggal_selesai` | date | ya |  | — |
| `lokasi` | varchar(60) | ya |  | — |
| `biaya` | decimal(14,2) | ya |  | Total biaya training (Rp) |

### `training_peserta`

Peserta training. Jumlah baris: 235.

| Kolom | Tipe | Null | Key | Keterangan |
|---|---|---|---|---|
| `id` | int | tidak | PK | — |
| `training_id` | int | ya | FK → `training` | — |
| `karyawan_id` | int | ya | FK → `karyawan` | — |
| `status` | varchar(15) | ya |  | TERDAFTAR, HADIR, TIDAK_HADIR |
| `nilai_post_test` | decimal(4,1) | ya |  | — |
