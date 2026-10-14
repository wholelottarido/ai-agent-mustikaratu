/**
 * Mengisi basis pengetahuan dengan dokumen SOP CONTOH + vektornya.
 *
 *   npm run pasang:kb            # buat tabel (kalau belum) lalu isi
 *   npm run pasang:kb -- --hapus # kosongkan lagi
 *
 * ⚠️ MENULIS KE DATABASE PERUSAHAAN (schema public), atas permintaan pemilik
 * proyek 1 Okt 2026.
 *
 * ⚠️ ISINYA BUKAN SOP RESMI. Ditulis untuk menguji apakah pencarian makna
 * (vektor) benar-benar berguna untuk dokumen panjang -- pertanyaan yang
 * belum terjawab setelah terbukti pg_trgm lebih baik untuk judul tiket
 * pendek. Temanya didasarkan pada tiket yang benar-benar sering muncul:
 * request email baru (351), Navision (192), printer (163), kode barang (98).
 *
 * Tiap dokumen diberi penanda di baris pertama, dan tiap baris ditandai
 * `sumber='contoh-uji'`, supaya tidak ada yang mengira ini dokumen sah.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { embed, awalanPassage, DIMENSI, MODEL_EMBEDDING } from "../voltagent/embedding.ts";

const HAPUS = process.argv.includes("--hapus");
const PENANDA = "[DOKUMEN CONTOH UNTUK UJI COBA — bukan SOP resmi perusahaan]";

type Dok = { kode: string; judul: string; kategori: string; aplikasi: string; isi: string };

const DOKUMEN: Dok[] = [
  {
    kode: "SOP-IT-001", judul: "Permintaan Email Baru untuk Karyawan", kategori: "PERMINTAAN BARU", aplikasi: "Helpdesk",
    isi: `Permintaan pembuatan alamat email kantor untuk karyawan baru atau penggantian alamat lama.

Siapa yang boleh mengajukan. Atasan langsung karyawan bersangkutan, atau staf HRD untuk karyawan yang baru bergabung. Karyawan tidak mengajukan untuk dirinya sendiri karena pembuatan email menuntut konfirmasi bahwa yang bersangkutan benar tercatat sebagai karyawan aktif.

Data yang harus disertakan. Nama lengkap sesuai data kepegawaian, departemen, jabatan, tanggal mulai bekerja, dan nama atasan langsung. Tanpa tanggal mulai bekerja, permintaan akan dikembalikan karena alamat email tidak dibuat lebih dari tujuh hari sebelum karyawan masuk.

Bentuk alamat. Pola bakunya nama depan titik nama belakang. Kalau sudah ada yang memakai, ditambahkan huruf pertama nama tengah. Alamat berbentuk jabatan seperti admin atau helpdesk hanya dibuat untuk fungsi yang dipakai bersama lebih dari satu orang, dan harus disetujui kepala departemen.

Lama pengerjaan. Dua hari kerja sejak permintaan lengkap. Permintaan yang datanya kurang tidak dihitung sampai dilengkapi.

Setelah email aktif. Kata sandi awal dikirim ke atasan yang mengajukan, bukan ke karyawannya, dan wajib diganti pada login pertama. Karyawan juga didaftarkan ke grup distribusi departemennya.

Yang sering jadi masalah. Permintaan email untuk karyawan yang ternyata belum tercatat di sistem kepegawaian akan ditolak. Selesaikan dulu pencatatannya di HRD, baru ajukan email.`,
  },
  {
    kode: "SOP-IT-002", judul: "Penghapusan Akun Karyawan yang Keluar", kategori: "OTHERS", aplikasi: "Helpdesk",
    isi: `Penonaktifan seluruh akses sistem untuk karyawan yang mengakhiri hubungan kerja.

Pemicu. HRD memberi tahu IT paling lambat pada hari terakhir karyawan bekerja. Pemberitahuan yang terlambat adalah risiko keamanan: akun yang masih hidup setelah orangnya keluar bisa dipakai siapa saja yang tahu kata sandinya.

Urutan penonaktifan. Pertama akun email dinonaktifkan, bukan dihapus. Kedua akses ke aplikasi internal dicabut: Portal, MAPS, Super Tools, CMOD, dan aplikasi lain sesuai hak yang pernah diberikan. Ketiga perangkat yang dipegang dikembalikan dan dicatat.

Kenapa dinonaktifkan dulu, bukan dihapus. Email yang dihapus langsung membuat riwayat surat hilang, padahal sering masih dibutuhkan untuk pekerjaan yang belum selesai. Akun ditahan nonaktif selama sembilan puluh hari, lalu dihapus.

Pengalihan surat masuk. Atas permintaan atasan, surat yang masuk ke alamat itu dapat diteruskan ke penggantinya selama masa sembilan puluh hari.

Perangkat. Laptop, telepon, dan aset lain dikembalikan dengan berita acara. Aset yang tidak kembali dicatat sebagai kehilangan dan dilaporkan ke atasan departemen.

Yang sering terlewat. Akun aplikasi pihak ketiga dan akses VPN. Dua hal ini tidak muncul di daftar aplikasi internal, jadi harus diperiksa manual.`,
  },
  {
    kode: "SOP-IT-003", judul: "Permintaan Laptop atau Komputer Baru", kategori: "PERMINTAAN BARU", aplikasi: "Helpdesk",
    isi: `Pengajuan perangkat komputer untuk karyawan baru, penggantian perangkat rusak, atau penambahan unit.

Dasar permintaan. Ada tiga alasan yang diterima: karyawan baru yang belum punya perangkat, perangkat lama yang sudah tidak layak pakai, dan penambahan untuk pekerjaan yang benar-benar menuntutnya. Alasan lain perlu persetujuan kepala departemen.

Perangkat dianggap tidak layak kalau. Umurnya lebih dari lima tahun, atau biaya perbaikannya melebihi separuh harga unit baru, atau sudah tiga kali diperbaiki untuk kerusakan yang sama dalam satu tahun.

Yang harus dilampirkan. Nama pengguna, departemen, jenis pekerjaan, dan untuk penggantian: nomor aset perangkat lama. Tanpa nomor aset lama, permintaan penggantian tidak bisa diproses karena IT tidak bisa memastikan perangkat mana yang diganti.

Lama pengerjaan. Bergantung ketersediaan stok. Kalau ada di gudang, tiga hari kerja. Kalau harus dibeli, mengikuti jadwal pengadaan dan bisa sampai empat minggu.

Serah terima. Perangkat diserahkan dengan berita acara yang ditandatangani penerima. Nomor aset dicatat atas nama karyawan tersebut, dan dia bertanggung jawab atasnya sampai dikembalikan.

Perangkat lama. Dikembalikan ke IT pada hari yang sama saat menerima yang baru. Data dipindahkan lebih dulu oleh IT, bukan oleh penggunanya, supaya tidak ada yang tertinggal.`,
  },
  {
    kode: "SOP-IT-004", judul: "Peminjaman Aset IT Sementara", kategori: "PEMINJAMAN", aplikasi: "Helpdesk",
    isi: `Peminjaman perangkat untuk keperluan sementara seperti rapat, presentasi, pelatihan, atau perjalanan dinas.

Perangkat yang bisa dipinjam. Proyektor, laptop cadangan, kamera, pengeras suara, dan kabel penyambung. Perangkat yang sudah dipegang karyawan lain tidak bisa dipinjamkan.

Waktu pengajuan. Paling lambat satu hari kerja sebelum dipakai. Untuk acara besar yang menuntut lebih dari dua perangkat, tiga hari kerja sebelumnya.

Isi permintaan. Jenis perangkat, tanggal dan jam pemakaian, tempat, dan nama penanggung jawab. Penanggung jawab adalah orang yang mengambil dan mengembalikan, dan dialah yang bertanggung jawab kalau perangkat rusak atau hilang.

Pengambilan dan pengembalian. Diambil di ruang IT pada jam kerja, dikembalikan paling lambat satu hari kerja setelah pemakaian selesai. Keterlambatan pengembalian membuat permintaan peminjaman berikutnya dari orang yang sama ditunda.

Kerusakan. Kerusakan yang terjadi saat pemakaian dilaporkan segera, jangan menunggu pengembalian. Perangkat rusak yang dikembalikan tanpa laporan akan ditelusuri dan dibebankan.

Catatan tentang proyektor. Proyektor adalah perangkat yang paling sering diminta mendadak. Kalau acaranya sudah terjadwal, ajukan jauh hari; peminjaman mendadak sering tidak bisa dipenuhi karena unitnya terbatas.`,
  },
  {
    kode: "SOP-IT-005", judul: "Penanganan Printer Tidak Bisa Mencetak", kategori: "HARDWARE", aplikasi: "Helpdesk",
    isi: `Langkah penanganan untuk printer yang tidak merespons perintah cetak.

Periksa sendiri lebih dulu. Sebelum membuat tiket, pastikan printer menyala, kabel daya dan kabel data terpasang, kertas ada dan tidak tersangkut, serta tinta atau toner belum habis. Lebih dari sepertiga tiket printer selesai hanya dengan pemeriksaan ini.

Kalau printer dipakai bersama lewat jaringan. Periksa apakah rekan satu ruangan juga tidak bisa mencetak. Kalau semua tidak bisa, masalahnya di printer atau jaringan. Kalau hanya satu komputer, masalahnya di komputer itu.

Mencoba mencetak halaman uji. Buka pengaturan printer di komputer, pilih printer bersangkutan, lalu cetak halaman uji. Kalau halaman uji keluar tapi dokumen tidak, masalahnya ada di aplikasi atau dokumennya, bukan di printer.

Antrean cetak menumpuk. Dokumen yang gagal sering menumpuk di antrean dan menghalangi yang berikutnya. Kosongkan antrean, lalu coba lagi. Kalau antrean tidak bisa dikosongkan, komputer perlu dinyalakan ulang.

Kapan membuat tiket. Kalau langkah di atas sudah dicoba dan tetap gagal. Sertakan merek dan tipe printer, letak ruangannya, pesan kesalahan yang muncul kalau ada, dan apakah orang lain mengalami hal yang sama.

Hasil cetak buruk, bukan tidak keluar. Garis, warna pudar, atau hasil kotor biasanya soal tinta atau head yang perlu dibersihkan, bukan kerusakan. Sebutkan jelas di tiket bahwa cetakannya keluar tapi hasilnya tidak bagus, supaya tidak tertukar dengan printer mati.`,
  },
  {
    kode: "SOP-IT-006", judul: "Masalah Koneksi Internet dan Jaringan", kategori: "NETWORK", aplikasi: "Helpdesk",
    isi: `Penanganan gangguan akses internet, jaringan kabel, dan wifi di lingkungan kantor.

Tentukan dulu luas gangguannya. Tanyakan ke rekan di ruangan yang sama apakah mereka juga terganggu. Gangguan yang dialami satu orang berbeda penanganannya dengan gangguan yang dialami satu lantai.

Hanya satu komputer yang terganggu. Periksa kabel jaringan terpasang dan lampu di colokannya menyala. Untuk wifi, periksa apakah terhubung ke jaringan kantor dan bukan ke jaringan lain. Coba lepas lalu sambungkan kembali.

Satu ruangan atau satu lantai terganggu. Kemungkinan besar perangkat jaringan di lantai itu bermasalah. Buat satu tiket untuk seluruh ruangan, jangan satu tiket per orang, karena tiket yang menumpuk untuk masalah yang sama memperlambat penanganan.

Internet lambat, bukan mati. Sebutkan jelas bahwa koneksi ada tapi lambat. Sertakan kapan mulai terasa lambat, apakah terjadi sepanjang hari atau pada jam tertentu, dan aplikasi apa yang paling terasa.

Aplikasi tertentu tidak bisa dibuka padahal internet jalan. Ini bukan gangguan jaringan. Kemungkinan aplikasinya yang bermasalah atau aksesnya belum diberikan. Buat tiket dengan kategori aplikasi, bukan jaringan.

Bekerja dari luar kantor. Akses ke aplikasi internal dari luar kantor menuntut VPN. Permintaan akses VPN diajukan terpisah dan menuntut persetujuan kepala departemen.`,
  },
  {
    kode: "SOP-IT-007", judul: "Akses dan Gangguan Aplikasi Navision", kategori: "SOFTWARE", aplikasi: "Helpdesk",
    isi: `Penanganan permintaan akses dan gangguan pada aplikasi Navision.

Permintaan akses baru. Diajukan atasan langsung, menyebutkan nama pengguna, departemen, dan modul yang dibutuhkan. Akses Navision diberikan per modul, bukan menyeluruh, jadi sebutkan pekerjaan yang akan dilakukan supaya modulnya tepat.

Persetujuan. Akses ke modul keuangan dan modul persediaan menuntut persetujuan kepala departemen terkait, bukan cukup atasan langsung. Permintaan tanpa persetujuan itu akan ditahan.

Tidak bisa masuk. Periksa dulu apakah kata sandinya baru diganti, apakah tombol caps lock menyala, dan apakah rekan lain bisa masuk. Kalau semua orang tidak bisa masuk, berarti layanannya yang bermasalah dan cukup satu tiket untuk semua.

Akun terkunci. Terjadi setelah beberapa kali salah kata sandi. Pembukaan kunci dilakukan IT setelah memastikan identitas pemohon. Permintaan pembukaan kunci lewat pesan singkat tanpa tiket tidak dilayani.

Aplikasi terbuka tapi tampilan berbeda atau menu hilang. Biasanya hak aksesnya berubah, bukan aplikasinya rusak. Sebutkan menu apa yang hilang supaya bisa dicocokkan dengan hak akses yang tercatat.

Aplikasi berhenti merespons saat memproses data banyak. Catat jam kejadian dan jenis proses yang dijalankan. Gangguan seperti ini sering berkaitan dengan beban pada jam tertentu, dan catatan waktu sangat membantu penelusuran.`,
  },
  {
    kode: "SOP-IT-008", judul: "Permintaan Kode Barang Baru", kategori: "PERMINTAAN BARU", aplikasi: "Helpdesk",
    isi: `Pembuatan kode barang baru di sistem untuk produk, bahan, atau perlengkapan yang belum terdaftar.

Siapa yang mengajukan. Bagian yang membutuhkan kode tersebut, dengan sepengetahuan atasannya. Untuk produk jadi, pengajuan datang dari Marketing atau NPD. Untuk bahan baku dan kemasan, dari Produksi atau Pengadaan.

Data wajib. Nama barang lengkap, satuan, kategori, dan keterangan singkat yang membedakannya dari barang serupa. Nama yang terlalu umum akan dikembalikan karena menyulitkan pencarian di kemudian hari.

Periksa dulu apakah sudah ada. Banyak permintaan kode baru ternyata barangnya sudah terdaftar dengan nama berbeda. Cari dulu dengan beberapa kata kunci sebelum mengajukan. Kode ganda menyulitkan laporan persediaan dan sulit digabung setelah terlanjur dipakai.

Lama pengerjaan. Satu hari kerja untuk permintaan lengkap. Permintaan yang datanya kurang akan dikembalikan, dan hitungan waktu dimulai ulang setelah dilengkapi.

Setelah kode terbit. Kode dikirim ke pengaju dan langsung bisa dipakai. Perubahan nama barang setelah kode terbit menuntut permintaan terpisah dan tidak selalu disetujui, karena nama yang sudah dipakai di transaksi lama ikut berubah.

Penghapusan kode. Kode yang sudah dipakai dalam transaksi tidak dihapus, hanya dinonaktifkan supaya tidak muncul lagi saat input baru.`,
  },
  {
    kode: "SOP-IT-009", judul: "Cara Membuat Tiket Helpdesk yang Baik", kategori: "OTHERS", aplikasi: "Portal",
    isi: `Panduan menulis tiket supaya cepat ditangani dan tidak bolak-balik ditanya ulang.

Judul yang baik. Sebutkan perangkat atau aplikasinya dan apa yang terjadi. "Printer lantai 2 tidak bisa mencetak" jauh lebih berguna daripada "printer" atau "tolong dibantu". Judul yang jelas membuat tiket serupa mudah ditemukan, dan sering jawabannya sudah pernah ada.

Isi keterangan. Jelaskan apa yang sedang dikerjakan saat masalah muncul, apa yang diharapkan terjadi, dan apa yang sebenarnya terjadi. Sertakan pesan kesalahan apa adanya, jangan diringkas, karena kata persisnya sering menentukan penyebabnya.

Sertakan gambar layar kalau ada pesan kesalahan. Satu gambar layar sering menggantikan beberapa putaran tanya jawab.

Satu masalah satu tiket. Menggabungkan beberapa masalah dalam satu tiket membuat salah satunya terlewat saat ditutup. Kalau ada tiga masalah berbeda, buat tiga tiket.

Tentang prioritas. Prioritas mendesak dipakai untuk masalah yang membuat pekerjaan berhenti total dan tidak ada cara lain mengerjakannya. Menandai semua tiket mendesak membuat penanda itu kehilangan artinya, dan tiket yang benar-benar mendesak jadi tidak terlihat.

Setelah tiket dibuat. Nomor tiket dikirim sebagai tanda terima. Simpan nomornya; semua komunikasi lanjutan memakai nomor itu. Menanyakan perkembangan lewat pesan pribadi tanpa menyebut nomor tiket memperlambat, bukan mempercepat.`,
  },
  {
    kode: "SOP-IT-010", judul: "Alur Status dan Penutupan Tiket", kategori: "OTHERS", aplikasi: "Portal",
    isi: `Penjelasan arti tiap status tiket dan kapan tiket boleh ditutup.

Status terbuka. Tiket sudah masuk tapi belum ada teknisi yang memegangnya. Tiket dalam status ini masih bisa diubah atau dibatalkan sendiri oleh pembuatnya.

Status ditugaskan. Sudah ada teknisi yang bertanggung jawab. Mulai titik ini perubahan isi tiket dilakukan lewat teknisi tersebut, bukan diubah sendiri.

Status dikerjakan. Teknisi sedang menangani. Kalau penanganan menuntut waktu lama atau menunggu barang, teknisi mencatat alasannya di tiket supaya pembuatnya tahu bukan terbengkalai.

Status selesai. Masalah sudah ditangani. Tiket tidak langsung dikunci; pembuatnya punya waktu untuk menyatakan masalahnya belum benar-benar selesai.

Status ditolak. Permintaan tidak dapat dipenuhi, misalnya karena di luar lingkup IT atau datanya tidak lengkap setelah ditanyakan. Alasan penolakan selalu dicantumkan.

Status dibatalkan. Pembuat tiket membatalkan sendiri, biasanya karena masalahnya hilang atau sudah tertangani lewat cara lain.

Rata-rata waktu penyelesaian. Sekitar lima hari kerja untuk keseluruhan tiket, tapi sangat beragam menurut jenisnya. Permintaan yang menunggu pengadaan barang jauh lebih lama daripada gangguan yang bisa ditangani di tempat.

Menutup tiket sendiri. Pembuat tiket dapat menutup tiketnya sendiri kalau masalahnya hilang sebelum ditangani. Sertakan keterangan singkat, karena tiket yang ditutup tanpa keterangan menyulitkan penelusuran kalau masalahnya berulang.`,
  },
  {
    kode: "SOP-IT-011", judul: "Laptop atau Komputer Mati Total", kategori: "HARDWARE", aplikasi: "Helpdesk",
    isi: `Penanganan perangkat yang tidak menyala sama sekali.

Pastikan benar-benar mati total. Perangkat yang layarnya gelap tapi lampunya menyala bukan mati total, melainkan masalah tampilan, dan penanganannya berbeda. Sebutkan jelas mana yang terjadi.

Untuk laptop. Lepas pengisi daya, tahan tombol daya tiga puluh detik, pasang kembali pengisi daya, lalu coba nyalakan. Langkah ini mengatasi sebagian kasus. Periksa juga lampu pada pengisi daya; pengisi daya rusak sering disangka laptop rusak.

Untuk komputer meja. Periksa kabel daya di kedua ujung dan sakelar di belakang kotak komputer. Periksa apakah stop kontaknya berfungsi dengan mencoba perangkat lain.

Kalau sudah menyala tapi tidak masuk ke sistem. Catat pesan yang muncul di layar apa adanya. Pesan itu menentukan apakah masalahnya pada penyimpanan, sistem operasi, atau perangkat keras lain.

Data di dalamnya. Sebutkan di tiket kalau ada data penting yang belum tersalin. Penanganan akan diatur supaya pemulihan data didahulukan sebelum perbaikan yang berisiko menghapus isi penyimpanan.

Perangkat pengganti sementara. Kalau pekerjaan tidak bisa berhenti, sebutkan di tiket. Ketersediaan unit cadangan terbatas dan diberikan menurut urgensi, bukan urutan permintaan.`,
  },
  {
    kode: "SOP-IT-012", judul: "Aturan Kata Sandi dan Keamanan Akun", kategori: "OTHERS", aplikasi: "Helpdesk",
    isi: `Ketentuan kata sandi untuk seluruh akun sistem internal.

Panjang dan susunan. Paling sedikit dua belas karakter, menggabungkan huruf besar, huruf kecil, angka, dan tanda baca. Kata sandi yang hanya terdiri dari kata umum ditolak sistem walaupun panjang.

Yang tidak boleh dipakai. Nama sendiri, nama perusahaan, tanggal lahir, nomor karyawan, dan urutan sederhana. Empat hal ini yang pertama dicoba kalau ada yang hendak menebak.

Penggantian berkala. Kata sandi diganti paling lambat setiap sembilan puluh hari. Sistem mengingatkan tujuh hari sebelumnya. Kata sandi baru tidak boleh sama dengan lima kata sandi sebelumnya.

Jangan dipakai ulang di luar kantor. Kata sandi akun kantor tidak boleh sama dengan kata sandi layanan pribadi. Kebocoran di satu layanan membuat semua akun dengan kata sandi sama ikut terbuka.

Jangan dibagikan. Termasuk kepada rekan satu tim dan termasuk kepada petugas IT. IT tidak pernah meminta kata sandi; permintaan semacam itu patut dicurigai dan dilaporkan.

Kalau lupa. Ajukan lewat tiket atau datang langsung ke IT dengan membawa identitas. Pengaturan ulang tidak dilayani lewat telepon atau pesan karena identitas penelepon tidak bisa dipastikan.

Kalau diduga bocor. Ganti segera, lalu laporkan. Melaporkan lebih awal jauh lebih baik daripada menunggu kepastian.`,
  },
  {
    kode: "SOP-IT-013", judul: "Permintaan Pemasangan Perangkat Lunak", kategori: "SOFTWARE", aplikasi: "Helpdesk",
    isi: `Pengajuan pemasangan aplikasi pada perangkat kantor.

Siapa yang memasang. Pemasangan dilakukan IT, bukan penggunanya. Perangkat kantor dibatasi supaya pengguna tidak memasang sendiri, karena aplikasi yang dipasang tanpa pemeriksaan sering membawa masalah keamanan dan tidak bisa ditelusuri waktu ada gangguan.

Yang perlu disebutkan. Nama aplikasi beserta versinya, untuk pekerjaan apa, dan nomor aset perangkat yang akan dipasangi. Permintaan tanpa penjelasan kegunaan akan ditanyakan ulang.

Aplikasi berbayar. Menuntut persetujuan kepala departemen dan pemeriksaan ketersediaan lisensi. Kalau lisensi belum ada, permintaan diteruskan ke pengadaan dan waktunya mengikuti jadwal pembelian.

Aplikasi bebas biaya. Tetap melalui pemeriksaan, karena bebas biaya bukan berarti bebas risiko. Beberapa aplikasi bebas biaya tidak boleh dipakai untuk keperluan komersial.

Aplikasi yang tidak disetujui. Aplikasi berbagi berkas pribadi, aplikasi pengunduh, dan aplikasi yang mengubah pengaturan sistem tidak dipasang pada perangkat kantor.

Lama pengerjaan. Dua hari kerja untuk aplikasi yang lisensinya sudah tersedia.

Setelah terpasang. Pemasangan dicatat pada data aset perangkat tersebut. Pencatatan ini yang dipakai waktu memeriksa kepatuhan lisensi, jadi aplikasi yang dipasang di luar jalur ini menimbulkan selisih yang harus ditelusuri.`,
  },
  {
    kode: "SOP-IT-014", judul: "Pencadangan dan Pemulihan Data", kategori: "OTHERS", aplikasi: "Helpdesk",
    isi: `Ketentuan penyimpanan data kerja dan cara meminta pemulihan.

Di mana data kerja disimpan. Pada penyimpanan jaringan departemen, bukan pada penyimpanan laptop. Data yang disimpan hanya di laptop tidak tercakup pencadangan, dan hilang bersama perangkatnya kalau rusak atau hilang.

Jadwal pencadangan. Penyimpanan jaringan dicadangkan setiap malam pada hari kerja. Salinan disimpan tiga puluh hari ke belakang.

Permintaan pemulihan. Sebutkan nama berkas atau folder selengkap mungkin, letaknya, dan perkiraan tanggal terakhir berkas itu masih benar. Tanpa perkiraan tanggal, pemulihan menjadi menebak dan sering menghasilkan versi yang salah.

Lama pemulihan. Satu hari kerja untuk berkas yang masih dalam rentang tiga puluh hari. Di luar rentang itu, data sudah tidak dapat dipulihkan.

Berkas yang terhapus hari ini. Periksa dulu tempat sampah di komputer sebelum membuat tiket. Sebagian besar permintaan pemulihan selesai di langkah ini.

Data di surat elektronik. Lampiran yang hanya ada di surat tidak termasuk pencadangan data kerja. Simpan lampiran penting ke penyimpanan jaringan.

Data pribadi. Penyimpanan jaringan dan pencadangan diperuntukkan bagi data pekerjaan. Berkas pribadi yang ikut tersimpan tidak dijamin dan dapat dihapus saat pembersihan.`,
  },
  {
    kode: "SOP-ST-001", judul: "Super Tools: Memberikan Tanggapan pada Task List", kategori: "SOFTWARE", aplikasi: "Super Tools",
    isi: `Panduan bagi pembuat task untuk meninjau dan menanggapi task list yang sudah dikerjakan tim eksekutor lapangan.

Kapan tombol tanggapan muncul. Bagian Tanggapan Diperlukan beserta tombolnya muncul otomatis pada halaman detail task list begitu tim eksekutor mulai mengerjakan. Sebelum itu tombolnya tidak ada, dan itu bukan kesalahan sistem.

Membuka form tanggapan. Buka halaman detail task list yang hendak ditinjau, lalu tekan tombol Beri Tanggapan. Form berisi ringkasan hasil pekerjaan yang dikirim pelaksana beserta lampirannya.

Menyetujui. Pilih Setuju kalau hasil pekerjaan sudah sesuai instruksi. Catatan tambahan bersifat pilihan dan boleh dikosongkan.

Menolak. Pilih Tolak kalau hasilnya belum sesuai. Kolom komentar wajib diisi dengan alasan yang jelas dan spesifik, supaya tim lapangan memahami bagian mana yang perlu diperbaiki dan dapat segera merevisi. Penolakan tanpa alasan yang jelas membuat perbaikan berputar-putar.

Setelah seluruh proses selesai. Status task list berubah menjadi Selesai, dan halaman detailnya menampilkan seluruh rangkaian pengerjaan serta peninjauan.

Riwayat persetujuan. Bagian ini menampilkan kronologi lengkap setiap perubahan status, dari pembuatan task sampai persetujuan akhir, beserta siapa yang melakukannya dan kapan.

Riwayat dokumen. Mencatat setiap perubahan pada task list secara terperinci, termasuk perubahan status tiap butir checklist beserta waktunya.`,
  },
  {
    kode: "SOP-ST-002", judul: "Super Tools: Call Plan dan Kunjungan Outlet", kategori: "SOFTWARE", aplikasi: "Super Tools",
    isi: `Pengaturan rencana kunjungan dan pencatatan kunjungan outlet oleh tim lapangan.

Menyusun rencana kunjungan. Rencana disusun untuk periode satu minggu ke depan, memuat outlet yang akan dikunjungi beserta harinya. Rencana yang disusun belakangan setelah kunjungan terjadi tidak mencerminkan perencanaan dan terlihat jelas di laporan.

Kunjungan terencana dan tidak terencana. Kunjungan di luar rencana tetap boleh dicatat, tapi ditandai berbeda. Perbandingan antara keduanya dipakai menilai kualitas perencanaan wilayah.

Mencatat kedatangan. Pencatatan kedatangan dilakukan di lokasi outlet, bukan sebelum berangkat atau sesudah pulang, karena waktu dan tempatnya ikut tercatat.

Mencatat kepulangan. Dilakukan saat meninggalkan outlet. Kunjungan tanpa pencatatan kepulangan tidak terhitung lengkap dan tidak masuk hitungan pencapaian.

Kunjungan yang batal. Dicatat beserta alasannya, misalnya outlet tutup atau pemilik tidak di tempat. Kunjungan batal yang tidak dicatat terbaca sebagai kunjungan yang tidak dilakukan.

Hubungan dengan laporan penjualan. Kunjungan dan penjualan dicatat terpisah. Kunjungan yang tercatat tanpa penjualan adalah hal yang wajar dan bukan kesalahan pencatatan.

Memperbaiki catatan. Perbaikan catatan kunjungan yang sudah lewat menuntut persetujuan atasan wilayah, karena data ini dipakai menilai kinerja.`,
  },
  {
    kode: "SOP-MAPS-001", judul: "MAPS: Pengajuan Klaim Program Promosi", kategori: "SOFTWARE", aplikasi: "MAPS",
    isi: `Pengajuan klaim atas program promosi yang sudah dijalankan distributor.

Siapa yang mengajukan. Distributor, cabang, atau toko yang menjalankan program, melalui akun MAPS masing-masing.

Syarat pengajuan. Program harus sudah berjalan dan selesai, bukan sedang berjalan. Nomor programnya harus dicantumkan; klaim tanpa nomor program tidak dapat ditelusuri ke anggaran mana pun.

Kelengkapan. Bukti pelaksanaan, rincian biaya, dan dokumen pendukung sesuai jenis klaimnya. Kelengkapan diperiksa bagian pelayanan distributor sebelum diteruskan.

Tahapan persetujuan. Pengecekan data, menunggu persetujuan, diproses, lalu disetujui atau ditolak. Klaim yang ditolak selalu disertai alasan dan boleh diajukan ulang setelah diperbaiki.

Jatuh tempo. Klaim diajukan paling lambat tiga puluh hari setelah program berakhir. Lewat dari itu, pengajuan menuntut persetujuan pengendali anggaran.

Pembayaran. Dilakukan setelah klaim disetujui dan mengikuti jadwal pembayaran yang berlaku. Tanggal persetujuan bukan tanggal pembayaran.

Penelusuran. Perkembangan klaim dapat dilihat sendiri di MAPS. Menanyakan perkembangan lewat jalur lain tidak mempercepat karena petugas membaca data yang sama.

Klaim yang dibatalkan. Pengaju dapat membatalkan klaim yang belum masuk tahap persetujuan. Setelah itu pembatalan menuntut permintaan ke pengendali anggaran.`,
  },
  {
    kode: "SOP-MAPS-002", judul: "MAPS: Pembuatan dan Pengendalian Anggaran Program", kategori: "SOFTWARE", aplikasi: "MAPS",
    isi: `Pembuatan program promosi dan pengendalian anggarannya.

Siapa yang membuat program. Admin program dari Sales, Marketing, E-Commerce, atau Key Account, sesuai wilayah tanggung jawab masing-masing.

Isi program. Nama program, periode pelaksanaan, outlet atau distributor yang tercakup, produk yang terlibat, dan anggaran yang dialokasikan. Program tanpa periode yang jelas tidak dapat dipakai sebagai dasar klaim.

Persetujuan anggaran. Program dengan anggaran di atas batas yang ditetapkan menuntut persetujuan pengendali anggaran sebelum dapat dijalankan.

Mengubah program yang sedang berjalan. Perubahan periode dan anggaran menuntut persetujuan ulang. Perubahan daftar outlet masih dimungkinkan selama belum ada klaim yang masuk.

Koreksi anggaran. Hanya pengendali anggaran yang dapat melakukannya, dan setiap koreksi tercatat beserta alasannya.

Penarikan program. Program yang sudah terlanjur dijalankan tapi ternyata keliru dapat ditarik oleh pengendali anggaran. Klaim yang terlanjur masuk atas program itu ikut dibatalkan dan pengajunya diberi tahu.

Pemantauan penyerapan. Penyerapan anggaran dapat dilihat per program dan per periode. Program yang penyerapannya jauh di bawah rencana menjelang berakhir sebaiknya ditinjau, karena anggaran yang tidak terpakai tidak berpindah ke periode berikutnya.`,
  },
  {
    kode: "SOP-CMOD-001", judul: "CMOD: Order Mingguan Distributor", kategori: "SOFTWARE", aplikasi: "CMOD",
    isi: `Pengisian dan pengesahan order mingguan oleh distributor.

Jadwal pengisian. Order diisi distributor pada rentang hari yang ditetapkan tiap minggu. Order yang masuk di luar rentang itu masuk ke periode berikutnya.

Mengisi order. Distributor memilih produk dan mengisi jumlah. Produk yang tidak muncul di daftar berarti belum terdaftar untuk distributor tersebut, dan itu diajukan terpisah.

Memeriksa hasil input. Admin sales memeriksa order yang masuk, dapat menyesuaikan jumlah, lalu menyetujui atau menolak. Penyesuaian jumlah selalu disertai keterangan supaya distributor mengerti alasannya.

Order yang ditolak. Dikembalikan ke distributor beserta alasannya dan dapat diisi ulang selama masih dalam rentang waktu pengisian.

Batas kredit. Order yang melampaui batas kredit distributor tertahan dan menuntut persetujuan tersendiri. Periksa sisa batas kredit sebelum mengisi order besar.

Setelah disetujui. Order diteruskan ke proses berikutnya dan tidak dapat diubah. Perubahan setelah titik ini menuntut pembatalan dan pengisian ulang pada periode berikutnya.

Kesalahan yang sering terjadi. Mengisi jumlah dalam satuan yang berbeda dari satuan produk. Periksa satuan pada tiap baris sebelum mengirim, karena selisih satuan baru ketahuan saat barang dikirim.`,
  },
  {
    kode: "SOP-HR-001", judul: "Portal: Pengajuan Cuti dan Izin", kategori: "SOFTWARE", aplikasi: "Portal",
    isi: `Pengajuan cuti, izin, dan ketidakhadiran melalui portal karyawan.

Jenis pengajuan. Cuti tahunan, izin sakit, izin keperluan pribadi, dan izin khusus sesuai ketentuan kepegawaian. Jenis yang dipilih menentukan dokumen pendukung yang diminta.

Waktu pengajuan. Cuti tahunan diajukan paling lambat tiga hari kerja sebelumnya. Izin sakit dapat diajukan pada hari yang sama atau setelahnya dengan melampirkan surat keterangan untuk sakit lebih dari satu hari.

Siapa yang menyetujui. Atasan langsung pemohon, bukan HRD. HRD mencatat dan memeriksa kesesuaian dengan sisa hak cuti, tapi keputusannya ada pada atasan.

Sisa hak cuti. Dapat dilihat sendiri di portal. Pengajuan yang melebihi sisa hak akan ditahan dan dibicarakan dengan HRD.

Mengubah atau membatalkan. Pengajuan yang belum disetujui dapat dibatalkan sendiri. Setelah disetujui, pembatalan menuntut persetujuan atasan yang sama.

Cuti bersama dan hari libur. Hari libur yang ditetapkan tidak memotong hak cuti, kecuali untuk jenis yang dinyatakan sebagai cuti bersama.

Pengajuan mendadak. Keadaan mendesak tetap diajukan lewat portal secepatnya setelah kejadian, disertai keterangan. Ketidakhadiran tanpa pengajuan tercatat sebagai mangkir dan ditangani sesuai ketentuan kepegawaian.`,
  },
  {
    kode: "SOP-HR-002", judul: "Serah Terima Perangkat untuk Karyawan Baru", kategori: "PERMINTAAN BARU", aplikasi: "Helpdesk",
    isi: `Penyiapan perangkat dan akses untuk karyawan yang baru bergabung.

Pemberitahuan awal. HRD memberi tahu IT paling lambat tiga hari kerja sebelum karyawan masuk, menyebutkan nama, departemen, jabatan, dan tanggal mulai. Pemberitahuan mendadak membuat perangkat belum siap pada hari pertama.

Yang disiapkan. Perangkat komputer sesuai jenis pekerjaan, alamat surat elektronik, akun portal karyawan, dan akses aplikasi sesuai jabatan.

Akses aplikasi. Diberikan menurut jabatan, bukan menurut permintaan. Akses tambahan di luar yang baku diajukan terpisah oleh atasan dengan penjelasan kebutuhannya.

Hari pertama. Perangkat diserahkan dengan berita acara. Karyawan menerima penjelasan singkat tentang aturan kata sandi, tempat menyimpan data kerja, dan cara membuat tiket bantuan.

Pencatatan aset. Perangkat dicatat atas nama karyawan tersebut. Pencatatan ini yang dipakai waktu pengembalian, jadi perangkat yang diserahkan tanpa pencatatan menimbulkan selisih yang sulit ditelusuri.

Masa percobaan. Tidak membedakan hak akses. Karyawan dalam masa percobaan menerima akses yang sama sesuai jabatannya.

Karyawan pindah departemen. Diperlakukan seperti penyesuaian akses, bukan pendaftaran baru. Akses lama dicabut dan akses baru diberikan sesuai jabatan barunya, dan perangkatnya tetap.`,
  },
  {
    kode: "SOP-IT-015", judul: "Penggunaan VPN untuk Bekerja dari Luar Kantor", kategori: "NETWORK", aplikasi: "Helpdesk",
    isi: `Permintaan dan penggunaan akses jaringan pribadi maya untuk menjangkau aplikasi internal dari luar kantor.

Kapan dibutuhkan. Aplikasi internal seperti Navision, MAPS, dan portal karyawan hanya dapat dijangkau dari jaringan kantor. Dari luar kantor, aksesnya menuntut VPN.

Permintaan akses. Diajukan atasan langsung dengan menyebutkan alasan dan jangka waktu yang dibutuhkan. Akses VPN diberikan berjangka, tidak selamanya, dan diperpanjang kalau masih dibutuhkan.

Persetujuan. Menuntut persetujuan kepala departemen. Akses dari luar jaringan kantor memperluas permukaan risiko, jadi diberikan terbatas.

Penggunaan. Hanya pada perangkat kantor. Menyambungkan perangkat pribadi ke jaringan internal tidak diizinkan karena perangkat itu tidak melalui pemeriksaan keamanan.

Sambungan terputus-putus. Periksa dulu kualitas koneksi internet tempat Anda berada. Sebagian besar keluhan VPN terputus sebenarnya berasal dari koneksi yang tidak stabil, bukan dari layanan VPN.

Aplikasi terasa lambat lewat VPN. Wajar sampai batas tertentu karena data berputar lebih jauh. Lambat yang mengganggu pekerjaan dilaporkan dengan menyebutkan aplikasi, jam, dan tempat Anda terhubung.

Setelah selesai. Putuskan sambungan VPN saat tidak dipakai. Sambungan yang dibiarkan terbuka sepanjang hari membebani kapasitas yang terbatas.`,
  },
  {
    kode: "SOP-IT-016", judul: "Pengelolaan Data Aset Perangkat", kategori: "OTHERS", aplikasi: "Helpdesk",
    isi: `Pencatatan, pemindahan, dan penghapusan data aset perangkat milik perusahaan.

Apa yang dicatat sebagai aset. Setiap perangkat bernilai yang diserahkan untuk dipakai karyawan: komputer, laptop, monitor, telepon, dan perangkat pendukung tertentu. Tiap aset punya nomor yang tertempel pada fisiknya.

Pemegang aset. Setiap aset tercatat atas nama satu karyawan. Perangkat yang dipakai bersama dicatat atas nama penanggung jawab ruangan, bukan dibiarkan tanpa pemegang.

Memindahkan aset ke orang lain. Melalui tiket, bukan diserahkan langsung antar karyawan. Pemindahan tanpa pencatatan membuat data aset tidak lagi mencerminkan kenyataan, dan itu baru ketahuan saat pemeriksaan.

Perangkat rusak. Tetap tercatat sampai dinyatakan tidak layak pakai dan dihapuskan melalui prosedur penghapusan aset. Perangkat rusak yang disimpan di laci tanpa pelaporan tetap terhitung sebagai aset aktif.

Perangkat hilang. Dilaporkan segera beserta kronologinya. Keterlambatan melaporkan kehilangan menyulitkan penelusuran dan penggantian.

Pemeriksaan berkala. Dilakukan untuk mencocokkan catatan dengan keberadaan fisik. Selisih yang ditemukan ditelusuri bersama pemegang terakhir yang tercatat.

Spesifikasi perangkat. Tercatat pada data aset dan dipakai menilai kelayakan saat ada permintaan penggantian.`,
  },
  {
    kode: "SOP-IT-017", judul: "Eskalasi Gangguan yang Menghentikan Pekerjaan", kategori: "OTHERS", aplikasi: "Helpdesk",
    isi: `Penanganan gangguan yang menghentikan pekerjaan banyak orang sekaligus.

Apa yang dianggap menghentikan pekerjaan. Gangguan yang membuat satu bagian atau lebih tidak dapat bekerja sama sekali, dan tidak ada cara lain mengerjakannya. Gangguan yang masih ada jalan keluarnya tidak termasuk, walaupun merepotkan.

Melaporkan. Buat satu tiket untuk gangguan tersebut, lalu beri tahu IT secara langsung supaya segera terlihat. Jangan membuat tiket terpisah untuk tiap orang yang terdampak; tiket yang menumpuk untuk masalah yang sama justru memperlambat.

Isi laporan. Sebutkan berapa banyak orang terdampak, bagian mana, sejak jam berapa, dan apakah ada pekerjaan dengan tenggat yang terancam.

Yang dilakukan IT. Penanganan gangguan semacam ini didahulukan di atas permintaan biasa. Permintaan yang tertunda karenanya akan diberi tahu.

Kabar perkembangan. Diberikan secara berkala melalui tiket, termasuk saat belum ada kemajuan. Diam tanpa kabar membuat orang membuat tiket baru, dan itu menambah beban.

Setelah pulih. Penyebab dan penanganannya dicatat di tiket. Catatan ini yang dipakai menelusuri kalau gangguan serupa berulang.

Yang bukan eskalasi. Permintaan yang mendesak bagi satu orang bukan gangguan yang menghentikan pekerjaan. Tandai prioritasnya dengan jujur; menandai semua sebagai mendesak membuat yang benar-benar mendesak tidak terlihat.`,
  },
];

// ============================================================
// Pemotongan teks
// ============================================================
/**
 * ⚠️ Dipotong per ALINEA, bukan per sekian karakter.
 *
 * Tiap alinea di dokumen ini satu gagasan utuh ("Lama pengerjaan...",
 * "Yang sering jadi masalah..."). Memotong di tengah kalimat menghasilkan
 * potongan yang tidak bisa dipahami sendirian -- dan potongan itulah yang
 * nanti dibaca model sebagai jawaban.
 *
 * Alinea yang terlalu pendek digabung dengan tetangganya supaya tidak ada
 * potongan sependek satu kalimat, yang hampir selalu kalah di pencarian
 * karena terlalu sedikit konteksnya.
 */
const MIN_POTONGAN = 220;

function potong(judul: string, isi: string): string[] {
  const alinea = isi.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const hasil: string[] = [];
  let buf = "";
  for (const p of alinea) {
    buf = buf ? `${buf}\n\n${p}` : p;
    if (buf.length >= MIN_POTONGAN) {
      hasil.push(buf);
      buf = "";
    }
  }
  if (buf) {
    if (hasil.length > 0) hasil[hasil.length - 1] += `\n\n${buf}`;
    else hasil.push(buf);
  }
  // Judul disematkan di tiap potongan: tanpa itu, potongan "Lama pengerjaan:
  // dua hari kerja" tidak punya petunjuk apa pun tentang topiknya.
  return hasil.map((t) => `${judul}\n\n${t}`);
}

// ============================================================
const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 300_000,
});
await c.connect();

// ⚠️ KORPUSNYA SUDAH TIDAK ADA. Tabel `ai_kb_dokumen`/`ai_kb_potongan`
// dihapus pihak lain dan digantikan `ai_knowledge`. Skrip pengisi ini usang;
// berhenti dengan keterangan, bukan menabrak galat SQL yang terbaca seperti
// database rusak. Lihat `scripts/test-kb-beda-kata.mts` untuk korpus baru.
{
  const { rows } = await c.query<{ ada: boolean }>(
    "SELECT to_regclass('public.ai_kb_dokumen') IS NOT NULL AS ada",
  );
  if (!rows[0].ada) {
    console.log("Korpus `ai_kb_*` sudah tidak ada -- skrip pengisi ini usang.");
    console.log("Korpus yang dipakai sekarang: ai_knowledge (diisi lewat layar unggah dokumen).");
    await c.end();
    process.exit(0);
  }
}

const [{ current_user: aku, current_database: db }] = (
  await c.query("SELECT current_user, current_database()")
).rows;
console.log(`tersambung: ${aku} @ ${db}\n`);

if (HAPUS) {
  const d = await c.query("DELETE FROM ai_kb_dokumen WHERE sumber = 'contoh-uji' RETURNING kode");
  console.log(`dihapus: ${d.rowCount} dokumen (potongannya ikut lewat ON DELETE CASCADE)`);
  await c.end();
  process.exit(0);
}

// Tabelnya dibuat kalau belum ada.
const sql = readFileSync("db/demo-pg/04_kb_dokumen.sql", "utf8");
await c.query(sql);
console.log("tabel siap.\n");

console.log(`model embedding: ${MODEL_EMBEDDING} (${DIMENSI} dimensi)`);
console.log(`dokumen        : ${DOKUMEN.length}\n`);

await c.query("DELETE FROM ai_kb_dokumen WHERE sumber = 'contoh-uji'");

let totalPotongan = 0;
const t0 = Date.now();

for (const d of DOKUMEN) {
  const isiLengkap = `${PENANDA}\n\n${d.isi}`;
  const r = await c.query(
    `INSERT INTO ai_kb_dokumen (kode, judul, kategori, aplikasi, isi, sumber)
     VALUES ($1, $2, $3, $4, $5, 'contoh-uji') RETURNING id_dokumen`,
    [d.kode, d.judul, d.kategori, d.aplikasi, isiLengkap],
  );
  const id = r.rows[0].id_dokumen as string;

  const potongan = potong(d.judul, d.isi);
  const vektor = await embed(potongan.map(awalanPassage));

  for (let i = 0; i < potongan.length; i++) {
    await c.query(
      `INSERT INTO ai_kb_potongan (id_dokumen, urutan, teks, vektor)
       VALUES ($1, $2, $3, $4::vector)`,
      [id, i, potongan[i], `[${vektor[i].join(",")}]`],
    );
  }
  totalPotongan += potongan.length;
  console.log(`  ${d.kode.padEnd(13)} ${potongan.length} potongan  ${d.judul.slice(0, 46)}`);
}

const detik = (Date.now() - t0) / 1000;
console.log(`\nselesai: ${DOKUMEN.length} dokumen, ${totalPotongan} potongan, ${detik.toFixed(1)} detik`);

const cek = await c.query(`
  SELECT COUNT(DISTINCT d.id_dokumen) dokumen, COUNT(p.id_potongan) potongan,
         COUNT(p.vektor) ada_vektor, ROUND(AVG(LENGTH(p.teks))) rata_panjang
  FROM ai_kb_dokumen d LEFT JOIN ai_kb_potongan p ON p.id_dokumen = d.id_dokumen
  WHERE d.sumber = 'contoh-uji'`);
console.table(cek.rows);
await c.end();
