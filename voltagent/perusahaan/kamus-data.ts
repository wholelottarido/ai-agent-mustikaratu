/**
 * Kamus data untuk database perusahaan (PostgreSQL `mustika_ratu_dev`).
 *
 * ⚠️ DIBANGKITKAN DARI `view-perusahaan.ts`, BUKAN DIKETIK.
 *
 * Versi lama berupa satu teks tetap yang mendaftarkan view-nya sendiri. Teks
 * itu MELESET dari daftar izin di tool: bilang "8 view", mendaftarkan 6,
 * sementara tool cuma mengizinkan 5. Model menuruti kamus, ditolak tool, lalu
 * menjawab user "ada kendala teknis".
 *
 * Sekarang daftarnya datang dari `viewBoleh(departemen)` — sumber yang sama
 * yang dipakai tool untuk menolak. Jumlahnya dihitung dari panjang daftar.
 * Kamus tidak bisa lagi menjanjikan view yang tool-nya tolak, dan pengguna
 * non-marketing tidak pernah diberi tahu view marketing itu ada.
 *
 * ⚠️ DIALEKNYA PostgreSQL, BUKAN MySQL.
 * Itu perbedaan yang paling sering bikin query gagal, jadi disebut paling
 * awal dan paling tegas.
 */
import { viewBoleh, viewLintasOrang } from "./view-perusahaan";

/** Penjelasan per view. Kuncinya HARUS sama dengan nama di `view-perusahaan.ts`. */
const PENJELASAN: Record<string, string> = {
  v_asisten_karyawan: `### v_asisten_karyawan — data kepegawaian (1.954 baris)
\`id_employee, nama, nik, departemen, jabatan, perusahaan, atasan,
mulai_kerja, aktif, id_department, id_company\``,

  v_asisten_pengajuan: `### v_asisten_pengajuan — pengajuan cuti & izin
\`id_employee_request, jenis, sub_jenis, dari_tanggal, sampai_tanggal,
jumlah_hari, status, alasan, dibuat, karyawan, id_employee, id_department,
id_company\``,

  v_asisten_tiket: `### v_asisten_tiket — tiket helpdesk (10.082 baris)
\`status\`: RESOLVED, REJECTED, ASSIGNED, IN_PROGRESS, OPEN, CANCELLED.
Jangan mengarang status di luar daftar itu.
\`prioritas\`: URGENT, NORMAL, LOW. Dua-duanya sudah teks, bukan angka.
\`id_ticket, no_ticket, judul, status, prioritas, kategori, sub_kategori,
teknisi, pelapor, dibuat, ditutup, id_employee, id_department, id_company\``,

  v_asisten_aset: `### v_asisten_aset — aset yang dipegang karyawan (948 baris)
\`id_asset_user, no_asset, seri, mulai_dipakai, selesai_dipakai, catatan,
pemakai, id_employee, id_department, id_company\`

Tidak ada kolom jenis/tipe aset — rujukannya di database tidak ketemu.`,

  v_asisten_kunjungan: `### v_asisten_kunjungan — kunjungan outlet (call plan)
\`id, tanggal, outlet, status, jenis_kunjungan, terencana, check_in,
check_out, karyawan, id_employee, id_department, id_company\``,

  v_asisten_penjualan: `### v_asisten_penjualan — penjualan BA (4,1 juta baris)
\`tanggal, kode_ba, nama_ba, outlet, kode_outlet, wilayah, produk,
kode_produk, kategori, qty, harga, nilai\`

\`nilai\` sudah = qty x harga, jangan dihitung ulang. Satu baris = satu produk
terjual oleh satu BA di satu outlet pada satu tanggal.

Rentang 20 Okt 2010 – **20 Sep 2026**. Setahun terakhir: 139 BA aktif,
397 outlet, omzet Rp 45,1 miliar. Sepanjang sejarah 1.934 BA — jangan
tertukar, yang relevan biasanya setahun terakhir.`,

  v_asisten_klaim: `### v_asisten_klaim — klaim program promosi (29.199 baris)
\`id_claim, no_klaim, no_program, nama_program, distributor, jenis_klaim,
total, status, tanggal_terima, jatuh_tempo, tanggal_bayar, dibuat,
id_created_users, id_department\`

\`status\` sudah berupa teks: Pengecekan Data, Menunggu Approval, Diproses,
Ditolak, Disetujui, Dibatalkan. Rentang datanya Feb 2021 – Agu 2026.`,
};

const DIALEK = `## Database yang kamu baca

PostgreSQL \`mustika_ratu_dev\` — data operasional perusahaan.

⚠️ **INI PostgreSQL, BUKAN MySQL.** Yang paling sering salah:

| Jangan pakai (MySQL) | Pakai ini (PostgreSQL) |
|---|---|
| \`DATE_FORMAT(x, '%Y-%m')\` | \`TO_CHAR(x, 'YYYY-MM')\` |
| \`CURDATE()\` | \`CURRENT_DATE\` |
| \`NOW()\` | \`NOW()\` (sama) |
| \`IFNULL(a, b)\` | \`COALESCE(a, b)\` |
| nama kolom diapit backtick | \`"nama kolom"\` (kutip ganda) |
| \`CONCAT(a, b)\` | \`a || b\` atau \`CONCAT\` (dua-duanya jalan) |
| \`x LIKE '%abc%'\` peka huruf | \`x ILIKE '%abc%'\` tidak peka huruf |

Perbandingan teks di PostgreSQL **peka huruf besar-kecil**. Untuk mencari
nama, pakai \`ILIKE\`, bukan \`LIKE\`.`;

const JEBAKAN = `## ⚠️ Jebakan yang HARUS kamu tahu

**1. Kolom \`id_*\` itu untuk penyaringan, bukan untuk ditampilkan.**
\`id_employee\`, \`id_department\`, \`id_company\` berupa uuid. Jangan
menampilkannya ke user — pakai \`nama\`, \`departemen\`, \`karyawan\` untuk itu.

**2. 52% karyawan aktif TIDAK punya departemen.** Kolom \`departemen\` sering
kosong. Kalau mengelompokkan per departemen, sebutkan berapa yang kosong —
kalau tidak, angkanya menyesatkan.

**3. NIK sering kosong.** Cuma 391 dari 1.954 karyawan punya NIK. Jangan
memakai NIK sebagai penanda utama; pakai \`nama\`.

**4. Nama karyawan TIDAK unik.** Ada beberapa orang dengan nama, departemen,
dan jabatan sama persis. Kalau user menyebut nama dan hasilnya lebih dari
satu, sampaikan pilihannya — jangan memilih sendiri.

**5. Datanya historis.** Rentangnya 2010–2026, tapi 30 hari terakhir
sangat sedikit. Pertanyaan "bulan ini" bisa terlihat kosong padahal datanya memang
belum ada, bukan query yang salah. Sebutkan itu kalau hasilnya nol, dan
tawarkan periode yang lebih panjang.

**6. Ada 15 baris karyawan bernama "-", "--", atau "---------".** Dari 1.269
karyawan aktif. Ada juga "IT Development" dan "Salesman Baru" yang jelas nama
uji, bukan nama orang. Kalau muncul di hasil, JANGAN disebut sebagai nama
karyawan — lewati atau sebutkan bahwa datanya tidak wajar.

**7. TIDAK ADA data gaji di database ini.** Tidak ada kolom gaji, payroll,
tunjangan, atau THP di seluruh database. Kalau ditanya, bilang datanya tidak
ada di sumber ini — jangan bilang "tidak punya akses", karena memang tidak
ada.`;

/**
 * Jebakan yang HANYA berlaku kalau view penjualan ikut terbaca.
 *
 * ⚠️ JANGAN dipindah ke `JEBAKAN`. Bagian itu dibaca semua departemen,
 * jadi HR akan diberi tahu soal view yang tool-nya tolak -- bug yang sama
 * yang bikin agent menjawab "ada kendala teknis". Sempat terjadi lagi di
 * sini, dan yang menangkapnya `npm run test:sumber-agent`.
 */
const JEBAKAN_PENJUALAN = `**8. Penjualan: \`nama_ba\` TIDAK unik dan kadang kosong.** 139 kode BA
cuma punya 135 nama berbeda, dan 966 baris setahun terakhir namanya kosong.
Kalau membedakan BA, pakai \`kode_ba\`; \`nama_ba\` untuk ditampilkan saja.

**9. Penjualan: 7% baris tidak punya kategori produk.** Kalau mengelompokkan
per kategori, sebutkan berapa yang tidak berkategori.

**10. Penjualan: baris "tidak jualan" TIDAK ADA di view ini.** Catatan BA yang
Sakit/Cuti/Toko Tutup sengaja dikeluarkan supaya rata-rata transaksi tidak
salah. Jadi pertanyaan "kenapa BA X tidak jualan" TIDAK bisa dijawab dari
sini — bilang datanya tidak ada di view ini, jangan mengarang alasan.`;

/**
 * Jebakan yang HANYA berlaku kalau tiket dibaca sebagai data tim (IT).
 *
 * ⚠️ JANGAN dipindah ke `JEBAKAN`. Marketing & HR juga boleh membaca tiket,
 * tapi milik mereka sendiri saja -- angka-angka di bawah (10.084 tiket, 11
 * teknisi) tidak berlaku untuk mereka dan cuma membingungkan.
 */
const JEBAKAN_TIKET = `**Tiket: URGENT hampir tidak bermakna.** Sekitar **65% tiket berprioritas
URGENT** (NORMAL ~33%, LOW ~2%). Jadi "urgent"
BUKAN penanda mendesak — itu nilai yang hampir selalu dipilih. Jangan
mengurutkan pekerjaan berdasarkan prioritas, dan jangan bilang "ada 6.607
tiket mendesak" seolah itu krisis.

**Tiket: sekitar 800 tiket TIDAK punya teknisi.** Kalau menghitung beban per
teknisi, sebutkan berapa yang belum ditugaskan — kalau tidak, totalnya
tidak akan cocok dengan jumlah tiket.

**Tiket: cuma 11 teknisi, dan bebannya sangat timpang.** Satu orang
menangani sekitar 37% dari semua tiket. Itu keadaan nyata, bukan salah
data. Ada juga "IT Development" yang jelas nama sistem, bukan
orang — jangan disebut sebagai teknisi.

**Tiket: volume terbaru jauh lebih kecil daripada rata-rata sejarahnya**
(puluhan per bulan, bukan ratusan). Pertanyaan "bulan ini"
akan terlihat sepi — sebutkan angkanya apa adanya dan jangan menyimpulkan
"tiket menurun drastis" tanpa diminta; bisa jadi pencatatannya yang
berpindah sistem.

**Tiket: rata-rata penyelesaian sekitar 5 hari.** Pakai \`ditutup - dibuat\`, dan hitung hanya yang \`ditutup\` terisi.`;

/**
 * Kamus data untuk pengguna dari departemen ini.
 *
 * ⚠️ Yang didaftarkan HANYA view yang benar-benar boleh dia baca. Menyebut
 * view lain "cuma sebagai informasi" berarti mengundang model memakainya
 * lalu ditolak — persis bug yang berkas ini ada untuk mencegahnya.
 */
export function kamusPerusahaan(departemen: string): string {
  const boleh = viewBoleh(departemen);

  const diri = boleh.filter((v) => !viewLintasOrang(departemen, v));
  const lintas = boleh.filter((v) => viewLintasOrang(departemen, v));

  const bagian = [
    DIALEK,
    "",
    `## Yang boleh kamu baca: ${boleh.length} view`,
    "",
    "Tidak ada tabel lain yang bisa kamu sentuh — bukan karena dilarang di",
    "sini, tapi karena izin databasenya memang cuma untuk view ini.",
    "",
    ...diri.map((v) => `${PENJELASAN[v]}\n`),
  ];

  if (lintas.length > 0) {
    bagian.push(
      "## ⚠️ View di bawah ini BUKAN data milik user yang bertanya",
      "",
      `${lintas.length} view berikut berisi data SELURUH perusahaan, sedangkan`,
      `${diri.length} view di atas otomatis disaring ke data user yang bertanya.`,
      "Waktu menjawab dari view ini, sebut angkanya sebagai angka perusahaan —",
      'jangan bilang "punyamu" atau "kamu".',
      "",
      ...lintas.map((v) => `${PENJELASAN[v]}\n`),
    );
  }

  if (boleh.includes("v_asisten_penjualan")) bagian.push(JEBAKAN_PENJUALAN, "");
  // Cuma dipasang kalau tiket memang dibaca sebagai data tim -- yaitu IT.
  // Untuk marketing & HR tiket tetap tersaring ke diri sendiri, dan angka
  // 10.084 di jebakan itu tidak berlaku bagi mereka.
  if (viewLintasOrang(departemen, "v_asisten_tiket")) bagian.push(JEBAKAN_TIKET, "");
  bagian.push(JEBAKAN);
  return bagian.join("\n").trim();
}
