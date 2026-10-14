/**
 * Mendaftarkan sumber data & tool AI milik PORTAL KITA ke tabel konfigurasi
 * `ai_sumber_data` dan `ai_tool` di database perusahaan.
 *
 *   npm run daftar:sumber-ai           -> pasang / perbarui
 *   npm run daftar:sumber-ai -- --batal -> cabut lagi
 *
 * ⚠️ MENULIS KE SCHEMA BERSAMA YANG SEDANG DIPAKAI SISTEM LAIN.
 *
 * `ai_aksi_draft` masih bertambah 6 Okt 2026, `ai_chat_session` dan
 * `ai_pemakaian_model` 5 Okt. Jadi tabel ini bukan tabel mati yang kebetulan
 * ada -- ada agent lain yang membacanya sambil kita bekerja.
 *
 * ============================================================
 * KENAPA ADITIF, BUKAN MENGUBAH BARIS MEREKA
 * ============================================================
 * Masalahnya: 13 dari 15 sumber data yang terdaftar TIDAK punya kolom
 * penyaring per orang sama sekali (`kolom_employee`, `kolom_departemen`,
 * `kolom_perusahaan` semuanya NULL). Bukan karena lupa diisi -- view-nya
 * memang tidak membawa kolom itu. Akibatnya `cakupan` cuma bisa `semua`, dan
 * tiap pemakai agent HR melihat pengajuan cuti SELURUH karyawan.
 *
 * View `v_asisten_*` milik kita sudah membawa `id_employee`, `id_department`,
 * dan `id_company` untuk data yang sama. Jadi yang kurang bukan datanya,
 * cuma pendaftarannya.
 *
 * ============================================================
 * KENAPA ADA VIEW PEMBUNGKUS `v_ai_mg_*`
 * ============================================================
 * `ai_sumber_data` punya CHECK yang tidak kelihatan sampai INSERT ditolak:
 *
 *     CHECK (nama_view ~ '^v_ai_[a-z0-9_]+$')
 *
 * Jadi `v_asisten_aset` TIDAK BISA didaftarkan, apa pun isinya. Aturan itu
 * disengaja dan masuk akal: nama view menandai permukaan yang terbuka untuk
 * AI, dan itu harus kelihatan dari namanya saja -- tanpa membuka tabel
 * konfigurasi.
 *
 * Jadi tiap sumber dapat pembungkus setipis mungkin, `v_ai_mg_<nama>`, yang
 * cuma menyebut ulang kolom dari view `v_asisten_*` di bawahnya. `mg` =
 * magang, supaya pemiliknya kelihatan dari nama. Tidak ada logika di
 * pembungkus: satu definisi tetap satu tempat, di `02_view_asisten.sql`.
 *
 * Yang TIDAK dilakukan di sini, dan itu disengaja:
 *
 *   - tidak mengubah satu pun baris milik mereka (`dibuat_dari = 'admin'`);
 *   - tidak menyentuh `ai_agent_tool` sama sekali.
 *
 * Yang kedua itu yang penting. Menukar sambungan agent->tool akan mengubah
 * perilaku agent yang SEDANG DIPAKAI orang, dari sisi kita, tanpa mereka
 * tahu. Tool yang didaftarkan di sini sengaja `is_active = false` dan tidak
 * tersambung ke agent mana pun: dia tidak bisa dipanggil siapa-siapa sampai
 * pembaca konfigurasi di portal kita siap, dan itu keputusan terpisah.
 *
 * ============================================================
 * CAKUPAN YANG DIPILIH, DAN KENAPA
 * ============================================================
 * `diri`       -> data yang memang milik orang per orang (aset, tiket,
 *                 pengajuan, kunjungan). Penyaringnya `id_employee`.
 * `departemen` -> data kerja bersama yang tidak masuk akal disaring per orang
 *                 (direktori karyawan, klaim MAPS).
 *
 * `asisten_klaim` sengaja TIDAK diberi `kolom_employee` walau view-nya punya
 * `id_created_users`: kolom itu terisi 2 dari 29.199 baris (0,007%). Memakainya
 * sebagai penyaring berarti hampir semua orang dapat hasil kosong -- tanpa
 * galat, jadi tidak ada yang tahu. Pola yang sama dengan `v_ai_penjualan`.
 */
import { Client } from "pg";

/**
 * Daftar-boleh. Skrip ini HANYA boleh menyentuh baris yang kodenya diawali
 * ini, dan memeriksanya ulang sebelum tiap perintah.
 *
 * Alasannya sama dengan `VIEW_BOLEH` di `pasang-view-pg.mts`: skrip yang
 * memegang kredensial admin dan menulis ke schema bersama adalah alat
 * berbahaya untuk ditinggalkan di repo. Untuk yang menjaga sesuatu,
 * gagal-menolak lebih aman daripada gagal-mengizinkan.
 */
const AWALAN = "asisten_";

/**
 * Daftar-boleh kedua: nama view yang boleh dibuat/ditimpa/dihapus skrip ini.
 *
 * `CREATE OR REPLACE VIEW` dengan kredensial superuser adalah perintah yang
 * bisa menimpa view orang lain tanpa peringatan apa pun. Awalan ini yang
 * memastikan yang tertimpa cuma punya kita.
 */
const AWALAN_VIEW = /^v_ai_mg_[a-z0-9_]+$/;

/**
 * Penanda pemilik baris. Baris tanpa ini TIDAK PERNAH kita sentuh.
 *
 * Maksimal 10 huruf: `ai_sumber_data.dibuat_dari` itu `varchar(10)`, dan
 * nilai yang kepanjangan ditolak dengan `value too long` tanpa menyebut
 * kolomnya. Punya mereka "admin".
 */
const PEMILIK = "magang";

const APP = {
  portal: "b1952feb-2114-4892-a8f9-fab1ccc17469",
  admin: "392d9f16-0944-4e31-af17-6680c6737e02",
  recruitment: "cfe05522-8790-4013-a8b7-ecf6ebd38378",
  supertools: "ea3795c2-52e4-467e-a314-0dc1c140427d",
  maps: "84480b32-4c93-46da-96c4-59ddf2308a5a",
} as const;

type Kolom = { nama: string; tipe: "teks" | "angka" | "tanggal" | "boolean"; label: string };
type Filter = { kolom: string; label: string; operator: "berisi" | "sama" | "dari" | "sampai" };

type Sumber = {
  kode: string;
  nama: string;
  deskripsi: string;
  /** View yang didaftarkan. Wajib `v_ai_mg_*` -- lihat CHECK di atas. */
  view: string;
  /** View kita yang jadi isinya. Pembungkus tidak menambah logika apa pun. */
  basis: string;
  app: string;
  kolom: Kolom[];
  /**
   * Tabel operasional utama di balik view-nya.
   *
   * View kita menggabung beberapa tabel, jadi ini bukan daftar lengkap — ini
   * tabel POKOKNYA. Gunanya satu: `lib/ai-konfig.ts` memakainya untuk tahu
   * tool mereka yang mana yang digantikan tool ini. Tanpa itu, penggantiannya
   * harus ditebak dari nama, atau ditulis sebagai daftar pasangan di kode.
   */
  tabelAsal: string;
  /** Kolom penyaring. `null` = cakupan itu TIDAK tersedia untuk sumber ini. */
  employee: string | null;
  departemen: string | null;
  perusahaan: string | null;
};

/**
 * Tool `jenis = "kode"` — ditulis tangan, tanpa sumber data.
 *
 * Yang didaftarkan di sini CUMA barisnya; isinya ada di
 * `voltagent/registry-kode.ts`, dicocokkan lewat `penangan`.
 *
 * ⚠️ `deskripsi` di baris ini TIDAK dipakai model. Untuk tool `kode`,
 * deskripsi yang berlaku ikut pembuatnya di `tools-kb.ts` — lengkap dengan
 * peringatan yang lahir dari kegagalan nyata. Yang di sini catatan untuk
 * administrator.
 */
type ToolKode = {
  kode: string;
  nama: string;
  deskripsi: string;
  penangan: string;
  app: string;
  contoh: string;
};

const TOOL_KODE: ToolKode[] = [
  {
    kode: "cari_sop",
    nama: "Cari SOP / panduan",
    deskripsi:
      "Pencarian SOP berdasarkan MAKNA pertanyaan, bukan kata yang sama. " +
      "Deskripsi yang dibaca model ada di kode (voltagent/tools-kb.ts), bukan di baris ini.",
    penangan: "cari_sop",
    // Ditempel ke Portal, bukan ke aplikasi tertentu: SOP lintas aplikasi, dan
    // Portal satu-satunya yang terbuka untuk semua orang yang bisa login.
    app: APP.portal,
    contoh: "Bagaimana cara mengajukan cuti?",
  },
  {
    kode: "daftar_sop",
    nama: "Daftar SOP",
    deskripsi:
      "Menampilkan seluruh dokumen SOP yang terlihat untuk departemen penanya. " +
      "Deskripsi yang dibaca model ada di kode (voltagent/tools-kb.ts), bukan di baris ini.",
    penangan: "daftar_sop",
    app: APP.portal,
    contoh: "SOP apa saja yang ada?",
  },
];

type Tool = {
  kode: string;
  nama: string;
  deskripsi: string;
  sumber: string;
  app: string;
  kolom: string[];
  filter: Filter[];
  urut: string;
  cakupan: "diri" | "departemen" | "semua";
  /**
   * Kode izin yang wajib dipunyai pemakai, mis. `assignment-ticket:read`.
   *
   * ⚠️ SATU-SATUNYA PEMBATAS untuk tool bercakupan `semua`. Tanpa ini, tool
   * `semua` terlihat SETIAP pemegang aplikasinya — untuk antrean tiket itu
   * berarti keluhan siapa pun terbaca siapa pun.
   *
   * Tidak bisa diisi dari layar pengaturan: role `ai_konfig` tidak punya hak
   * INSERT pada kolom `izin`, jadi tool berizin hanya lahir dari skrip ini
   * yang memakai kredensial admin.
   */
  izin?: string;
  contoh: string;
};

const SUMBER: Sumber[] = [
  {
    kode: "asisten_aset",
    nama: "Aset karyawan",
    deskripsi: "Aset perusahaan (laptop, monitor, HP) yang dipegang karyawan.",
    view: "v_ai_mg_aset",
    basis: "v_asisten_aset",
    tabelAsal: "asset_user",
    app: APP.portal,
    kolom: [
      { nama: "no_asset", tipe: "teks", label: "No. aset" },
      { nama: "seri", tipe: "teks", label: "Seri" },
      { nama: "pemakai", tipe: "teks", label: "Pemakai" },
      { nama: "mulai_dipakai", tipe: "tanggal", label: "Mulai dipakai" },
      { nama: "selesai_dipakai", tipe: "tanggal", label: "Selesai dipakai" },
      { nama: "catatan", tipe: "teks", label: "Catatan" },
    ],
    employee: "id_employee",
    departemen: "id_department",
    perusahaan: "id_company",
  },
  {
    kode: "asisten_tiket",
    nama: "Tiket helpdesk",
    deskripsi: "Tiket helpdesk IT beserta kategori, status, teknisi, dan pelapornya.",
    view: "v_ai_mg_tiket",
    basis: "v_asisten_tiket",
    tabelAsal: "portal_ticket",
    app: APP.portal,
    kolom: [
      { nama: "no_ticket", tipe: "teks", label: "No. tiket" },
      { nama: "judul", tipe: "teks", label: "Judul" },
      { nama: "status", tipe: "teks", label: "Status" },
      { nama: "prioritas", tipe: "teks", label: "Prioritas" },
      { nama: "kategori", tipe: "teks", label: "Kategori" },
      { nama: "sub_kategori", tipe: "teks", label: "Sub-kategori" },
      { nama: "teknisi", tipe: "teks", label: "Teknisi" },
      { nama: "pelapor", tipe: "teks", label: "Pelapor" },
      { nama: "dibuat", tipe: "tanggal", label: "Dibuat" },
      { nama: "ditutup", tipe: "tanggal", label: "Ditutup" },
    ],
    employee: "id_employee",
    departemen: "id_department",
    perusahaan: "id_company",
  },
  {
    kode: "asisten_karyawan",
    nama: "Direktori karyawan",
    deskripsi: "Karyawan beserta departemen, jabatan, atasan, dan tanggal mulai bekerja.",
    view: "v_ai_mg_karyawan",
    basis: "v_asisten_karyawan",
    tabelAsal: "employee",
    app: APP.admin,
    kolom: [
      { nama: "nama", tipe: "teks", label: "Nama" },
      { nama: "nik", tipe: "teks", label: "NIK" },
      { nama: "departemen", tipe: "teks", label: "Departemen" },
      { nama: "jabatan", tipe: "teks", label: "Jabatan" },
      { nama: "perusahaan", tipe: "teks", label: "Perusahaan" },
      { nama: "atasan", tipe: "teks", label: "Atasan" },
      { nama: "mulai_kerja", tipe: "tanggal", label: "Mulai bekerja" },
      { nama: "aktif", tipe: "boolean", label: "Aktif" },
    ],
    employee: "id_employee",
    departemen: "id_department",
    perusahaan: "id_company",
  },
  {
    kode: "asisten_pengajuan",
    nama: "Pengajuan cuti & izin",
    deskripsi: "Pengajuan cuti, izin, dan dinas karyawan beserta status persetujuannya.",
    view: "v_ai_mg_pengajuan",
    basis: "v_asisten_pengajuan",
    tabelAsal: "employee_request",
    app: APP.recruitment,
    kolom: [
      { nama: "karyawan", tipe: "teks", label: "Karyawan" },
      { nama: "jenis", tipe: "teks", label: "Jenis" },
      { nama: "sub_jenis", tipe: "teks", label: "Sub-jenis" },
      { nama: "dari_tanggal", tipe: "tanggal", label: "Dari tanggal" },
      { nama: "sampai_tanggal", tipe: "tanggal", label: "Sampai tanggal" },
      { nama: "jumlah_hari", tipe: "angka", label: "Jumlah hari" },
      { nama: "status", tipe: "teks", label: "Status" },
      { nama: "alasan", tipe: "teks", label: "Alasan" },
      { nama: "dibuat", tipe: "tanggal", label: "Dibuat" },
    ],
    employee: "id_employee",
    departemen: "id_department",
    perusahaan: "id_company",
  },
  {
    kode: "asisten_kunjungan",
    nama: "Kunjungan outlet",
    deskripsi: "Rencana dan realisasi kunjungan outlet: tanggal, outlet, status, jam masuk/keluar.",
    view: "v_ai_mg_kunjungan",
    basis: "v_asisten_kunjungan",
    tabelAsal: "supertools_callplan",
    app: APP.supertools,
    kolom: [
      { nama: "tanggal", tipe: "tanggal", label: "Tanggal" },
      { nama: "outlet", tipe: "teks", label: "Outlet" },
      { nama: "karyawan", tipe: "teks", label: "Karyawan" },
      { nama: "status", tipe: "teks", label: "Status" },
      { nama: "jenis_kunjungan", tipe: "teks", label: "Jenis kunjungan" },
      { nama: "terencana", tipe: "boolean", label: "Terencana" },
      { nama: "check_in", tipe: "tanggal", label: "Check in" },
      { nama: "check_out", tipe: "tanggal", label: "Check out" },
    ],
    employee: "id_employee",
    departemen: "id_department",
    perusahaan: "id_company",
  },
  {
    kode: "asisten_klaim",
    nama: "Klaim MAPS",
    deskripsi: "Klaim program MAPS: nomor klaim, program, distributor, total, jatuh tempo, status.",
    view: "v_ai_mg_klaim",
    basis: "v_asisten_klaim",
    tabelAsal: "maps_claim",
    app: APP.maps,
    kolom: [
      { nama: "no_klaim", tipe: "teks", label: "No. klaim" },
      { nama: "no_program", tipe: "teks", label: "No. program" },
      { nama: "nama_program", tipe: "teks", label: "Nama program" },
      { nama: "distributor", tipe: "teks", label: "Distributor" },
      { nama: "jenis_klaim", tipe: "teks", label: "Jenis klaim" },
      { nama: "total", tipe: "angka", label: "Total" },
      { nama: "status", tipe: "teks", label: "Status" },
      { nama: "tanggal_terima", tipe: "tanggal", label: "Tanggal terima" },
      { nama: "jatuh_tempo", tipe: "tanggal", label: "Jatuh tempo" },
      { nama: "tanggal_bayar", tipe: "tanggal", label: "Tanggal bayar" },
      { nama: "dibuat", tipe: "tanggal", label: "Dibuat" },
    ],
    // id_created_users ADA di view, tapi terisi 2 dari 29.199 baris.
    // Mendaftarkannya = menjanjikan cakupan "diri" yang hasilnya selalu kosong.
    employee: null,
    departemen: "id_department",
    perusahaan: null,
  },
  {
    kode: "asisten_tugas",
    nama: "Tugas lapangan",
    deskripsi: "Tugas untuk tim lapangan: nama tugas, prioritas, status, periode, outlet, dan petugasnya.",
    view: "v_ai_mg_tugas",
    basis: "v_asisten_tugas",
    tabelAsal: "supertools_task_list",
    app: APP.supertools,
    kolom: [
      { nama: "tugas", tipe: "teks", label: "Tugas" },
      { nama: "keterangan", tipe: "teks", label: "Keterangan" },
      { nama: "prioritas", tipe: "teks", label: "Prioritas" },
      { nama: "status", tipe: "teks", label: "Status" },
      { nama: "mulai", tipe: "tanggal", label: "Mulai" },
      { nama: "selesai", tipe: "tanggal", label: "Selesai" },
      { nama: "petugas", tipe: "teks", label: "Petugas" },
      { nama: "outlet", tipe: "teks", label: "Outlet" },
      { nama: "dibuat", tipe: "tanggal", label: "Dibuat" },
    ],
    // Dari `assign_to` -- yang DITUGASI, bukan yang membuat. Lihat catatan
    // panjang di `02_view_asisten.sql` nomor 7.
    employee: "id_employee",
    departemen: "id_department",
    perusahaan: "id_company",
  },
  {
    kode: "asisten_rekrutmen",
    nama: "Permintaan rekrutmen",
    deskripsi: "Permintaan tenaga kerja baru: nomor pengajuan, posisi, departemen, tanggal dibutuhkan, status.",
    view: "v_ai_mg_rekrutmen",
    basis: "v_asisten_rekrutmen",
    tabelAsal: "hr_employee_submission",
    app: APP.recruitment,
    kolom: [
      { nama: "no_pengajuan", tipe: "teks", label: "No. pengajuan" },
      { nama: "posisi", tipe: "teks", label: "Posisi" },
      { nama: "departemen", tipe: "teks", label: "Departemen" },
      { nama: "dibutuhkan", tipe: "tanggal", label: "Dibutuhkan" },
      { nama: "status", tipe: "teks", label: "Status" },
      { nama: "dibuat", tipe: "tanggal", label: "Dibuat" },
    ],
    // `created_by` ADA dan terisi 100%, tapi isinya nama orang sebagai teks
    // bebas -- bukan identitas. Tidak didaftarkan.
    employee: null,
    departemen: "id_department",
    perusahaan: null,
  },
  {
    kode: "asisten_program",
    nama: "Program promosi MAPS",
    deskripsi: "Program promosi MAPS: nomor, nama, aktivitas, periode, departemen pemilik, dan kode status.",
    view: "v_ai_mg_program",
    basis: "v_asisten_program",
    tabelAsal: "maps_program",
    app: APP.maps,
    kolom: [
      { nama: "no_program", tipe: "teks", label: "No. program" },
      { nama: "nama_program", tipe: "teks", label: "Nama program" },
      { nama: "aktivitas", tipe: "teks", label: "Aktivitas" },
      { nama: "departemen", tipe: "teks", label: "Departemen" },
      { nama: "mulai", tipe: "tanggal", label: "Mulai" },
      { nama: "selesai", tipe: "tanggal", label: "Selesai" },
      { nama: "kode_status", tipe: "angka", label: "Kode status" },
      { nama: "dibuat", tipe: "tanggal", label: "Dibuat" },
    ],
    // id_created_users terisi 2 dari 15.927. Jebakan yang sama dengan klaim.
    employee: null,
    departemen: "id_department",
    perusahaan: "id_company",
  },
];

const TOOL: Tool[] = [
  {
    kode: "asisten_aset",
    nama: "Aset saya",
    deskripsi: "Aset perusahaan yang sedang dipegang karyawan yang bertanya: laptop, monitor, HP, beserta nomor seri dan sejak kapan dipakai.",
    sumber: "asisten_aset",
    app: APP.portal,
    kolom: ["no_asset", "seri", "mulai_dipakai", "selesai_dipakai", "catatan"],
    filter: [
      { kolom: "no_asset", label: "No. aset", operator: "berisi" },
      { kolom: "seri", label: "Seri", operator: "berisi" },
    ],
    urut: "mulai_dipakai",
    cakupan: "diri",
    contoh: "Aset apa saja yang saya pegang?",
  },
  {
    kode: "asisten_tiket",
    nama: "Tiket helpdesk saya",
    deskripsi: "Tiket helpdesk IT milik karyawan yang bertanya: nomor, judul, kategori, prioritas, status, teknisi, dan tanggal dibuat.",
    sumber: "asisten_tiket",
    app: APP.portal,
    kolom: ["no_ticket", "judul", "kategori", "sub_kategori", "prioritas", "status", "teknisi", "dibuat"],
    filter: [
      { kolom: "status", label: "Status", operator: "sama" },
      { kolom: "kategori", label: "Kategori", operator: "berisi" },
      { kolom: "no_ticket", label: "No. tiket", operator: "berisi" },
    ],
    urut: "dibuat",
    cakupan: "diri",
    contoh: "Tiket helpdesk saya yang belum selesai apa saja?",
  },
  {
    // ⚠️ SATU-SATUNYA TOOL KITA YANG BERCAKUPAN `semua` ATAS DATA PRIBADI.
    //
    // Tiket memuat keluhan orang: nama pelapor dan isi masalahnya. Tool ini
    // membaca SELURUHNYA tanpa penyaring orang, dan itu disengaja — petugas
    // helpdesk memang perlu melihat antrean yang bukan miliknya.
    //
    // Yang membuatnya tidak jadi kebocoran adalah `izin` di bawah. Begitu
    // baris itu dikosongkan, tool ini terpasang untuk SETIAP pemegang Portal,
    // yaitu semua orang yang bisa login. Jangan dikosongkan.
    kode: "asisten_antrean_tiket",
    nama: "Antrean tiket helpdesk",
    deskripsi:
      "Antrean tiket helpdesk IT SELURUH perusahaan — tiket siapa pun, bukan cuma milik penanya. " +
      "Untuk petugas yang menangani antrean: nomor, judul, kategori, prioritas, status, teknisi, " +
      "dan pelapornya. Kalau penanya cuma ingin tahu tiketnya sendiri, pakai `asisten_tiket`.",
    sumber: "asisten_tiket",
    app: APP.portal,
    kolom: ["no_ticket", "judul", "kategori", "sub_kategori", "prioritas", "status", "teknisi", "pelapor", "dibuat"],
    filter: [
      { kolom: "status", label: "Status", operator: "sama" },
      { kolom: "prioritas", label: "Prioritas", operator: "sama" },
      { kolom: "kategori", label: "Kategori", operator: "berisi" },
      { kolom: "no_ticket", label: "No. tiket", operator: "berisi" },
    ],
    urut: "dibuat",
    cakupan: "semua",
    izin: "assignment-ticket:read",
    contoh: "Tiket helpdesk yang masih OPEN ada berapa?",
  },
  {
    kode: "asisten_karyawan",
    nama: "Direktori karyawan",
    deskripsi: "Daftar karyawan perusahaan: nama, departemen, jabatan, atasan, dan tanggal mulai bekerja.",
    sumber: "asisten_karyawan",
    app: APP.admin,
    // `nik` SENGAJA tidak dibaca. Tidak ada pertanyaan direktori yang
    // membutuhkannya ("siapa di departemen IT", "siapa atasan saya"), tapi
    // dia ikut ke konteks model dan ke `ai_tool_log` tiap kali tool dipanggil.
    // Tool mereka `sim_direktori_karyawan` juga tidak membawanya.
    kolom: ["nama", "departemen", "jabatan", "atasan", "mulai_kerja", "aktif"],
    filter: [
      { kolom: "nama", label: "Nama", operator: "berisi" },
      { kolom: "jabatan", label: "Jabatan", operator: "berisi" },
      { kolom: "aktif", label: "Aktif (true/false)", operator: "sama" },
    ],
    urut: "mulai_kerja",
    // SENGAJA `semua`, bukan `departemen`, walau sumbernya punya
    // `kolom_departemen`. `employee.id_department` kosong untuk 1.060 dari
    // 1.958 karyawan (54%). Cakupan `departemen` di sini tidak menentukan
    // "satu departemen denganmu" tapi "kolomnya kebetulan terisi" -- jawaban
    // yang separuhnya hilang tanpa galat, dan terlihat lengkap.
    //
    // Penyaring yang memilih berdasarkan kebetulan tidak menjaga apa pun.
    // Yang dibatasi kolomnya (lihat `nik` di atas), bukan barisnya. Tool
    // mereka `sim_direktori_karyawan` memang sudah `semua` dan sudah jalan.
    cakupan: "semua",
    contoh: "Siapa saja karyawan di departemen IT?",
  },
  {
    kode: "asisten_pengajuan",
    nama: "Pengajuan cuti & izin saya",
    deskripsi: "Pengajuan cuti, izin, dan dinas milik karyawan yang bertanya, beserta status persetujuannya.",
    sumber: "asisten_pengajuan",
    app: APP.recruitment,
    kolom: ["jenis", "sub_jenis", "dari_tanggal", "sampai_tanggal", "jumlah_hari", "status", "alasan", "dibuat"],
    filter: [
      { kolom: "status", label: "Status", operator: "sama" },
      { kolom: "jenis", label: "Jenis", operator: "berisi" },
      { kolom: "dari_tanggal", label: "Sejak (YYYY-MM-DD)", operator: "dari" },
    ],
    urut: "dari_tanggal",
    cakupan: "diri",
    contoh: "Pengajuan cuti saya statusnya bagaimana?",
  },
  {
    kode: "asisten_kunjungan",
    nama: "Kunjungan outlet saya",
    deskripsi: "Rencana dan realisasi kunjungan outlet milik karyawan yang bertanya: tanggal, outlet, status, jam masuk dan keluar.",
    sumber: "asisten_kunjungan",
    app: APP.supertools,
    kolom: ["tanggal", "outlet", "status", "jenis_kunjungan", "terencana", "check_in", "check_out"],
    filter: [
      { kolom: "status", label: "Status", operator: "sama" },
      { kolom: "outlet", label: "Outlet", operator: "berisi" },
      { kolom: "tanggal", label: "Sejak (YYYY-MM-DD)", operator: "dari" },
    ],
    urut: "tanggal",
    cakupan: "diri",
    contoh: "Kunjungan outlet saya minggu ini sudah berapa yang selesai?",
  },
  {
    kode: "asisten_klaim",
    nama: "Klaim MAPS departemen",
    deskripsi: "Klaim program MAPS milik departemen penanya: nomor klaim, program, distributor, total, jatuh tempo, dan status.",
    sumber: "asisten_klaim",
    app: APP.maps,
    kolom: ["no_klaim", "no_program", "nama_program", "distributor", "jenis_klaim", "total", "status", "jatuh_tempo", "tanggal_bayar", "dibuat"],
    filter: [
      { kolom: "no_klaim", label: "No. klaim", operator: "berisi" },
      { kolom: "no_program", label: "No. program", operator: "berisi" },
      { kolom: "jenis_klaim", label: "Jenis klaim", operator: "sama" },
      { kolom: "jatuh_tempo", label: "Jatuh tempo sampai (YYYY-MM-DD)", operator: "sampai" },
    ],
    urut: "dibuat",
    cakupan: "departemen",
    contoh: "Klaim MAPS departemen saya yang jatuh tempo bulan ini apa saja?",
  },
  {
    kode: "asisten_tugas",
    nama: "Tugas lapangan saya",
    deskripsi: "Tugas lapangan yang DITUGASKAN kepada karyawan yang bertanya: nama tugas, prioritas, status, periode, dan outletnya.",
    sumber: "asisten_tugas",
    app: APP.supertools,
    kolom: ["tugas", "keterangan", "prioritas", "status", "mulai", "selesai", "outlet"],
    filter: [
      { kolom: "status", label: "Status", operator: "sama" },
      { kolom: "prioritas", label: "Prioritas", operator: "sama" },
      { kolom: "mulai", label: "Mulai sejak (YYYY-MM-DD)", operator: "dari" },
    ],
    urut: "mulai",
    cakupan: "diri",
    contoh: "Tugas lapangan saya yang belum selesai apa saja?",
  },
  // ⚠️ TIDAK ADA TOOL untuk `asisten_rekrutmen`, dan itu disengaja.
  //
  // Sumbernya didaftarkan supaya view dan katalog kolomnya siap, tapi tidak
  // ada tool yang memakainya -- karena tidak ada cakupan yang benar untuk
  // tabel ini sekarang:
  //
  //   `departemen` -> `hr_employee_submission.id_department` cuma nyambung
  //                   34 dari 309 ke tabel `department`, dan cuma 33 baris
  //                   (10,7%) departemennya dipakai minimal satu karyawan.
  //                   Jadi 276 pengajuan tidak akan pernah terlihat siapa
  //                   pun. Itu bukan penyaring, itu kehilangan data diam-diam.
  //
  //   `semua`      -> permintaan rekrutmen membocorkan rencana headcount dan
  //                   reorganisasi sebelum diumumkan. Beda dengan direktori
  //                   karyawan, ini BUKAN data yang memang sudah terbuka.
  //
  // Jadi yang kurang di sini bukan setelan, tapi jawaban dari pemilik data:
  // `id_department` di tabel itu memakai kosakata yang mana. Sampai itu
  // terjawab, lebih baik tidak ada tool daripada tool yang menjawab salah.
  {
    kode: "asisten_program",
    nama: "Program MAPS departemen",
    deskripsi: "Program promosi MAPS milik departemen penanya: nomor, nama, aktivitas, dan periodenya. `kode_status` masih berupa angka mentah -- jangan diterjemahkan jadi kata, sebutkan apa adanya.",
    sumber: "asisten_program",
    app: APP.maps,
    kolom: ["no_program", "nama_program", "aktivitas", "departemen", "mulai", "selesai", "kode_status", "dibuat"],
    filter: [
      { kolom: "no_program", label: "No. program", operator: "berisi" },
      { kolom: "nama_program", label: "Nama program", operator: "berisi" },
      { kolom: "aktivitas", label: "Aktivitas", operator: "berisi" },
      { kolom: "mulai", label: "Mulai sejak (YYYY-MM-DD)", operator: "dari" },
    ],
    urut: "dibuat",
    // 10.934 dari 15.927 baris (68,6%) departemennya dipakai minimal satu
    // karyawan. Sisanya milik departemen yang tidak ada karyawannya -- besar
    // kemungkinan struktur lama. Tidak ideal, tapi masih penyaring yang
    // berarti: 7 dari 11 departemen di data ini dikenal karyawan.
    cakupan: "departemen",
    contoh: "Program MAPS departemen saya yang masih berjalan apa saja?",
  },
];

// ── penjagaan sebelum apa pun menyentuh database ────────────────────────────

const batal = process.argv.includes("--batal");

// Tool `jenis = "kode"` memakai nama aslinya (`cari_sop`), bukan awalan
// `asisten_` -- namanya ikut jadi nama tool yang dipanggil model, dan model
// sudah dilatih instruksi lama dengan nama itu.
const KODE_BOLEH = new Set(TOOL_KODE.map((t) => t.kode));

for (const x of [...SUMBER.map((s) => s.kode), ...TOOL.map((t) => t.kode)]) {
  if (!x.startsWith(AWALAN)) {
    console.error(`DITOLAK: kode "${x}" di luar daftar-boleh "${AWALAN}*".`);
    process.exit(1);
  }
}
for (const s of SUMBER) {
  if (!AWALAN_VIEW.test(s.view)) {
    console.error(`DITOLAK: view "${s.view}" di luar daftar-boleh ${AWALAN_VIEW}.`);
    process.exit(1);
  }
  // Nama kolom ikut masuk ke teks CREATE VIEW, jadi tidak boleh ada apa pun
  // di luar huruf kecil, angka, dan garis bawah.
  for (const k of [...s.kolom.map((x) => x.nama), s.employee, s.departemen, s.perusahaan, s.basis]) {
    if (k && !/^[a-z][a-z0-9_]*$/.test(k)) {
      console.error(`DITOLAK: nama "${k}" di sumber ${s.kode} bukan pengenal yang aman.`);
      process.exit(1);
    }
  }
}
for (const t of TOOL) {
  const s = SUMBER.find((x) => x.kode === t.sumber);
  if (!s) { console.error(`DITOLAK: tool ${t.kode} menunjuk sumber ${t.sumber} yang tidak didaftarkan.`); process.exit(1); }
  // Cakupan yang tidak punya kolom penyaingnya akan diam-diam membaca
  // SEMUA baris. Lebih baik skrip ini berhenti sekarang.
  if (t.cakupan === "diri" && !s.employee) { console.error(`DITOLAK: ${t.kode} minta cakupan "diri" tapi ${s.kode} tidak punya kolom_employee.`); process.exit(1); }
  if (t.cakupan === "departemen" && !s.departemen) { console.error(`DITOLAK: ${t.kode} minta cakupan "departemen" tapi ${s.kode} tidak punya kolom_departemen.`); process.exit(1); }
  const ada = new Set(s.kolom.map((k) => k.nama));
  for (const k of [...t.kolom, ...t.filter.map((f) => f.kolom), t.urut]) {
    if (!ada.has(k)) { console.error(`DITOLAK: ${t.kode} memakai kolom "${k}" yang tidak ada di sumber ${s.kode}.`); process.exit(1); }
  }
}

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
});
await c.connect();
const q = async (s: string, p: unknown[] = []) => (await c.query(s, p)).rows;
console.log(`tersambung sebagai: ${(await q("SELECT current_user"))[0].current_user}\n`);

/** Jumlah baris MILIK MEREKA, sebelum dan sesudah. Pembuktian, bukan harapan. */
const hitungMereka = async () =>
  (await q(`SELECT (SELECT count(*)::int FROM ai_sumber_data WHERE dibuat_dari IS DISTINCT FROM $1) s,
                   (SELECT count(*)::int FROM ai_tool        WHERE updated_by  IS DISTINCT FROM $1) t,
                   (SELECT count(*)::int FROM ai_agent_tool) at,
                   (SELECT count(*)::int FROM ai_agent) a`, [PEMILIK]))[0];

const sebelum = await hitungMereka();
console.log(`sebelum: ${sebelum.s} sumber + ${sebelum.t} tool milik mereka, ${sebelum.a} agent, ${sebelum.at} sambungan agent-tool\n`);

try {
  await q("BEGIN");

  // View BASIS harus benar-benar ada, dan tiap kolom yang didaftarkan harus
  // benar-benar ada di situ. Nama yang salah di sini jadi tool yang gagal
  // waktu dipanggil user, bukan waktu didaftarkan.
  for (const s of SUMBER) {
    const kol = (await q(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [s.basis])).map((r) => (r as { column_name: string }).column_name);
    if (kol.length === 0) throw new Error(`view basis ${s.basis} tidak ada`);
    for (const k of [...s.kolom.map((x) => x.nama), s.employee, s.departemen, s.perusahaan]) {
      if (k && !kol.includes(k)) throw new Error(`kolom ${k} tidak ada di ${s.basis}`);
    }
  }

  if (batal) {
    const t = await q(
      `DELETE FROM ai_tool WHERE (kode LIKE $1 OR kode = ANY($3::text[])) AND updated_by = $2 RETURNING kode`,
      [`${AWALAN}%`, PEMILIK, [...KODE_BOLEH]]);
    const s = await q(`DELETE FROM ai_sumber_data WHERE kode LIKE $1 AND dibuat_dari = $2 RETURNING kode`, [`${AWALAN}%`, PEMILIK]);
    // View dihapus PALING AKHIR: selama masih ada baris konfigurasi yang
    // menunjuk ke situ, view yang hilang berarti tool yang gagal diam-diam.
    for (const x of SUMBER) await q(`DROP VIEW IF EXISTS ${x.view}`);
    console.log(`dicabut: ${t.length} tool, ${s.length} sumber, ${SUMBER.length} view`);
  } else {
    for (const s of SUMBER) {
      // Pembungkus setipis mungkin. Kolom disebut satu per satu, bukan `*`:
      // dengan `*`, kolom yang suatu hari ditambahkan di view basis ikut
      // terbuka untuk AI tanpa ada yang memutuskannya.
      const kolom = [...s.kolom.map((x) => x.nama), s.employee, s.departemen, s.perusahaan]
        .filter(Boolean)
        .join(", ");
      await q(`CREATE OR REPLACE VIEW ${s.view} AS SELECT ${kolom} FROM ${s.basis}`);
      await q(`GRANT SELECT ON ${s.view} TO ai_readonly`);
      console.log(`view    ${s.view.padEnd(20)} <- ${s.basis}`);
    }

    for (const s of SUMBER) {
      // ON CONFLICT dijaga `dibuat_dari`: kalau kode ini ternyata sudah dipakai
      // baris MEREKA, perintahnya tidak mengubah apa pun dan kita berhenti.
      const r = await q(
        `INSERT INTO ai_sumber_data
           (kode, nama, deskripsi, nama_view, id_apps, kolom,
            kolom_employee, kolom_departemen, kolom_perusahaan,
            is_active, dibuat_dari, updated_by, updated_at, tabel_asal)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,true,$10,$10,now(),$11)
         ON CONFLICT (kode) DO UPDATE SET
           nama=EXCLUDED.nama, deskripsi=EXCLUDED.deskripsi, nama_view=EXCLUDED.nama_view,
           id_apps=EXCLUDED.id_apps, kolom=EXCLUDED.kolom,
           kolom_employee=EXCLUDED.kolom_employee, kolom_departemen=EXCLUDED.kolom_departemen,
           kolom_perusahaan=EXCLUDED.kolom_perusahaan, updated_by=EXCLUDED.updated_by,
           tabel_asal=EXCLUDED.tabel_asal, updated_at=now()
         WHERE ai_sumber_data.dibuat_dari = $10
         RETURNING kode`,
        [s.kode, s.nama, s.deskripsi, s.view, s.app, JSON.stringify(s.kolom),
         s.employee, s.departemen, s.perusahaan, PEMILIK, s.tabelAsal]);
      if (r.length === 0) throw new Error(`kode sumber "${s.kode}" sudah dipakai baris milik orang lain -- tidak disentuh`);
      const cak = [s.employee && "diri", s.departemen && "departemen", "semua"].filter(Boolean).join("/");
      console.log(`sumber  ${s.kode.padEnd(20)} -> ${s.view.padEnd(22)} cakupan: ${cak}`);
    }

    for (const t of TOOL) {
      const [{ id }] = await q(`SELECT id_ai_sumber_data id FROM ai_sumber_data WHERE kode=$1`, [t.sumber]) as { id: string }[];
      const r = await q(
        `INSERT INTO ai_tool
           (kode, nama, deskripsi, jenis, id_ai_sumber_data, id_apps, kolom, filter,
            urut_kolom, urut_arah, batas, cakupan_bawaan, operasi, contoh_pertanyaan,
            izin, is_active, updated_by, updated_at)
         VALUES ($1,$2,$3,'konfigurasi',$4,$5,$6,$7::jsonb,$8,'desc',20,$9,'baca',$10,$12,false,$11,now())
         ON CONFLICT (kode) DO UPDATE SET
           nama=EXCLUDED.nama, deskripsi=EXCLUDED.deskripsi,
           id_ai_sumber_data=EXCLUDED.id_ai_sumber_data, id_apps=EXCLUDED.id_apps,
           kolom=EXCLUDED.kolom, filter=EXCLUDED.filter, urut_kolom=EXCLUDED.urut_kolom,
           cakupan_bawaan=EXCLUDED.cakupan_bawaan, contoh_pertanyaan=EXCLUDED.contoh_pertanyaan,
           izin=EXCLUDED.izin,
           updated_by=EXCLUDED.updated_by, updated_at=now()
         WHERE ai_tool.updated_by = $11
         RETURNING kode`,
        [t.kode, t.nama, t.deskripsi, id, t.app, t.kolom, JSON.stringify(t.filter),
         t.urut, t.cakupan, t.contoh, PEMILIK, t.izin ?? null]);
      if (r.length === 0) throw new Error(`kode tool "${t.kode}" sudah dipakai baris milik orang lain -- tidak disentuh`);
      console.log(`tool    ${t.kode.padEnd(20)} cakupan=${t.cakupan.padEnd(10)} ${t.kolom.length} kolom, ${t.filter.length} filter${t.izin ? `, izin=${t.izin}` : ""} (is_active=false)`);
    }

    for (const t of TOOL_KODE) {
      // Tanpa sumber data, dan itu sah: CHECK di tabelnya berbunyi
      // `jenis = 'kode' OR id_ai_sumber_data IS NOT NULL`.
      const r = await q(
        `INSERT INTO ai_tool
           (kode, nama, deskripsi, jenis, penangan, id_apps, cakupan_bawaan, operasi,
            contoh_pertanyaan, is_active, updated_by, updated_at)
         VALUES ($1,$2,$3,'kode',$4,$5,'semua','baca',$6,false,$7,now())
         ON CONFLICT (kode) DO UPDATE SET
           nama=EXCLUDED.nama, deskripsi=EXCLUDED.deskripsi, penangan=EXCLUDED.penangan,
           id_apps=EXCLUDED.id_apps, contoh_pertanyaan=EXCLUDED.contoh_pertanyaan,
           updated_by=EXCLUDED.updated_by, updated_at=now()
         WHERE ai_tool.updated_by = $7
         RETURNING kode`,
        [t.kode, t.nama, t.deskripsi, t.penangan, t.app, t.contoh, PEMILIK]);
      if (r.length === 0) throw new Error(`kode tool "${t.kode}" sudah dipakai baris milik orang lain -- tidak disentuh`);
      console.log(`kode    ${t.kode.padEnd(20)} penangan=${t.penangan} (is_active=false)`);
    }
  }

  await q("COMMIT");
} catch (e) {
  await q("ROLLBACK").catch(() => {});
  console.error(`\nGAGAL, semua dibatalkan: ${(e as Error).message}`);
  await c.end();
  process.exit(1);
}

const sesudah = await hitungMereka();
console.log(`\nsesudah: ${sesudah.s} sumber + ${sesudah.t} tool milik mereka, ${sesudah.a} agent, ${sesudah.at} sambungan agent-tool`);

const utuh =
  sesudah.s === sebelum.s && sesudah.t === sebelum.t &&
  sesudah.a === sebelum.a && sesudah.at === sebelum.at;
console.log(utuh
  ? "OK  — tidak ada baris milik mereka yang bertambah, berkurang, atau tersambung ulang."
  : "⚠️  JUMLAH BARIS MEREKA BERUBAH. Periksa sebelum melanjutkan.");

await c.end();
process.exitCode = utuh ? 0 : 1;
