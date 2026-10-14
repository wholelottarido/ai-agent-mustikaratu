-- ============================================================
-- View permukaan data untuk asisten AI
-- ============================================================
-- Database : mustika_ratu_dev @ 157.20.255.29 (PostgreSQL 18.6)
-- Dijalankan sebagai: postgres (superuser)
--
-- ⚠️ INI MENULIS KE DATABASE PERUSAHAAN. Sudah dibicarakan dengan pemegang
-- server: view `v_ai_*` yang lama memang sengaja dihapus, dan disepakati
-- kita membuat sendiri dengan AWALAN BERBEDA supaya tidak bingung.
--
-- ⚠️ AWALAN `v_asisten_`, BUKAN `v_ai_`.
--
-- `v_ai_*` itu milik lapisan AI mereka, yang sedang mereka tata ulang. Memakai
-- awalan yang sama berarti dua pihak membuat objek bernama mirip di database
-- yang sama -- dan orang berikutnya tidak akan tahu mana yang benar.
-- Awalan `v_asisten_` diperiksa bebas sebelum dipakai.
--
-- ⚠️ VIEW TIDAK MENYIMPAN DATA. Isinya rumus. Menghapusnya tidak menghilangkan
-- satu baris pun dari tabel aslinya -- itu sebabnya `v_ai_*` hilang tapi
-- `employee` tetap 1.954 baris.
--
-- ⚠️ TIDAK ADA WHERE PER PENGGUNA di view ini, sama seperti `v_ai_*` dulu.
-- Penyaring "cuma data saya" dipasang APLIKASI saat query, lewat CTE yang
-- menutupi nama view (lihat `voltagent/perusahaan/tool-query.ts`). View ini
-- menyaring data terhapus saja.
--
-- Membatalkan seluruhnya:
--   DROP VIEW IF EXISTS v_asisten_karyawan, v_asisten_pengajuan,
--     v_asisten_aset, v_asisten_kunjungan, v_asisten_tiket, v_asisten_klaim,
--     v_asisten_tugas, v_asisten_rekrutmen, v_asisten_program;
-- ============================================================

-- ------------------------------------------------------------
-- 1. Karyawan
-- ------------------------------------------------------------
-- Mengikuti bentuk `v_ai_karyawan` yang sempat terbaca 29 Sep pagi.
--
-- ⚠️ LEFT JOIN, bukan INNER. 52% karyawan aktif tidak punya departemen --
-- INNER JOIN akan MENGHILANGKAN separuh barisnya tanpa ada yang sadar.
--
-- Kolom pribadi SENGAJA tidak ikut: address, birth_date, phone, images.
-- `employee` punya 29 kolom; yang dibuka 11.
CREATE OR REPLACE VIEW v_asisten_karyawan AS
SELECT e.id_employee,
       e.fullname                AS nama,
       e.nik,
       d.name                    AS departemen,
       p.positions               AS jabatan,
       co.name_company           AS perusahaan,
       m.fullname                AS atasan,
       e.start_of_work           AS mulai_kerja,
       e.is_active               AS aktif,
       e.id_department,
       e.id_company
  FROM employee e
  LEFT JOIN department d  ON d.id_department = e.id_department
  LEFT JOIN positions  p  ON p.id_positions  = e.id_positions
  LEFT JOIN company    co ON co.id_company   = e.id_company
  LEFT JOIN employee   m  ON m.id_employee   = e.id_manager;

-- ------------------------------------------------------------
-- 2. Pengajuan cuti & izin
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_asisten_pengajuan AS
SELECT r.id_employee_request,
       r.type            AS jenis,
       r.sub_type        AS sub_jenis,
       r.date_from       AS dari_tanggal,
       r.date_to         AS sampai_tanggal,
       r.leave_days      AS jumlah_hari,
       r.status,
       r.reason          AS alasan,
       r.created_at      AS dibuat,
       e.fullname        AS karyawan,
       r.id_employee,
       e.id_department,
       r.id_company
  FROM employee_request r
  LEFT JOIN employee e ON e.id_employee = r.id_employee;

-- ------------------------------------------------------------
-- 3. Aset yang dipegang karyawan
-- ------------------------------------------------------------
-- ⚠️ Kolom "jenis" TIDAK ADA di sini, berbeda dari `v_ai_aset` dulu.
-- `asset.id_type` diperiksa dan TIDAK cocok ke tabel mana pun (0 dari 585
-- baris cocok ke `category`). Kolom yang selalu kosong lebih buruk daripada
-- tidak ada: model akan menyebutnya di jawaban lalu bingung sendiri.
-- Kalau nanti ketahuan tabel rujukannya, tinggal ditambahkan.
CREATE OR REPLACE VIEW v_asisten_aset AS
SELECT u.id_asset_user,
       u.no_asset,
       a.series          AS seri,
       u.start_date      AS mulai_dipakai,
       u.end_date        AS selesai_dipakai,
       u.note            AS catatan,
       e.fullname        AS pemakai,
       u.id_employee,
       e.id_department,
       e.id_company
  FROM asset_user u
  LEFT JOIN asset    a ON a.no_asset    = u.no_asset
  LEFT JOIN employee e ON e.id_employee = u.id_employee;

-- ------------------------------------------------------------
-- 4. Kunjungan outlet (call plan)
-- ------------------------------------------------------------
-- `"in"` dan `"out"` wajib pakai tanda kutip ganda -- keduanya kata kunci SQL.
CREATE OR REPLACE VIEW v_asisten_kunjungan AS
SELECT cp.id,
       cp.date           AS tanggal,
       cu.customer_name  AS outlet,
       cp.status,
       cp.visit_type     AS jenis_kunjungan,
       cp.is_plan        AS terencana,
       cp."in"           AS check_in,
       cp."out"          AS check_out,
       e.fullname        AS karyawan,
       cp.id_employee,
       e.id_department,
       cp.id_company
  FROM supertools_callplan cp
  LEFT JOIN customer cu ON cu.id_customer = cp.id_customer
  LEFT JOIN employee e  ON e.id_employee  = cp.id_employee
 WHERE cp.is_active IS DISTINCT FROM false;

-- ------------------------------------------------------------
-- 5. Tiket helpdesk
-- ------------------------------------------------------------
-- `status` dan `priority` di sini SUDAH berupa teks (RESOLVED, URGENT, dst),
-- jadi tidak perlu CASE seperti pada klaim.
--
-- Teknisi ditarik lewat `portal_technician` -> `employee` (cocok 9.261 dari
-- 10.082; sisanya tiket yang belum ada teknisinya).
CREATE OR REPLACE VIEW v_asisten_tiket AS
SELECT t.id_ticket,
       t.no_ticket,
       t.subject                 AS judul,
       t.status,
       t.priority                AS prioritas,
       k.category_name           AS kategori,
       sk.sub_category_name      AS sub_kategori,
       tek.fullname              AS teknisi,
       e.fullname                AS pelapor,
       t.created_at              AS dibuat,
       t.closed_at               AS ditutup,
       t.id_employee,
       e.id_department,
       e.id_company
  FROM portal_ticket t
  LEFT JOIN category          k   ON k.id_category      = t.id_category
  LEFT JOIN sub_category      sk  ON sk.id_sub_category = t.id_sub_category
  LEFT JOIN portal_technician pt  ON pt.id_technician   = t.id_technician
  LEFT JOIN employee          tek ON tek.id_employee    = pt.id_employee
  LEFT JOIN employee          e   ON e.id_employee      = t.id_employee;

-- ------------------------------------------------------------
-- 6. Klaim program promosi (MAPS)
-- ------------------------------------------------------------
-- ⚠️ Penyaringnya `id_department`, BUKAN `id_employee` -- sama seperti
-- `v_ai_klaim_maps` dulu. Selama pengguna portal belum dipetakan ke
-- departemen perusahaan, view ini TIDAK bisa disaring per orang, jadi
-- aplikasi belum memasukkannya ke daftar yang boleh dibaca.
--
-- `status` angka diterjemahkan, persis seperti view lama.
CREATE OR REPLACE VIEW v_asisten_klaim AS
SELECT c.id_claim,
       c.claim_number   AS no_klaim,
       pr.program_number AS no_program,
       pr.name          AS nama_program,
       co.name_company  AS distributor,
       c.claim_type     AS jenis_klaim,
       c.total,
       CASE
         WHEN c.status = 0 AND c.receive_status = 0 THEN 'Pengecekan Data'
         WHEN c.status = 0 THEN 'Menunggu Approval'
         WHEN c.status = 1 THEN 'Diproses'
         WHEN c.status = 2 THEN 'Ditolak'
         WHEN c.status = 3 THEN 'Dihapus'
         WHEN c.status = 4 THEN 'Disetujui'
         WHEN c.status = 5 THEN 'Dibatalkan'
         ELSE c.status::text
       END              AS status,
       c.receive_date   AS tanggal_terima,
       c.due_date       AS jatuh_tempo,
       c.payment_date   AS tanggal_bayar,
       c.created_at     AS dibuat,
       c.id_created_users,
       pr.id_department
  FROM maps_claim c
  LEFT JOIN maps_program pr ON pr.id_program = c.id_program
  LEFT JOIN company      co ON co.id_company = c.id_company
 WHERE c.status IS DISTINCT FROM 3;

-- ------------------------------------------------------------
-- 7. Tugas lapangan (Super Tools)
-- ------------------------------------------------------------
-- ⚠️ PENYARINGNYA `assign_to`, BUKAN `created_by`. "Tugas saya" berarti yang
-- DITUGASKAN ke saya, bukan yang saya buat. Dua-duanya kebetulan cocok 31/31
-- ke `employee.id_employee`, jadi salah pilih tidak menimbulkan galat apa pun
-- -- cuma menjawab pertanyaan yang berbeda dari yang ditanyakan.
--
-- ⚠️ `assign_to` berisi `id_employee`, BUKAN `id_users`, walau namanya tidak
-- menunjukkan itu. Diperiksa 6 Okt 2026:
--     assign_to -> employee.id_employee  31/31
--     assign_to -> users.id_users         0/31
--
-- View `v_ai_sim_tugas_lapangan` milik tim lain memakai dugaan yang kedua
-- (`LEFT JOIN users ON users.id_users = assign_to`), jadi kolom `petugas`-nya
-- NULL untuk seluruh 31 baris. Perlu diberitahukan ke mereka.
CREATE OR REPLACE VIEW v_asisten_tugas AS
SELECT t.id_task_list,
       t.name           AS tugas,
       t.description    AS keterangan,
       t.priority       AS prioritas,
       t.status,
       t.start_date     AS mulai,
       t.end_date       AS selesai,
       pel.fullname     AS petugas,
       cu.customer_name AS outlet,
       t.created_at     AS dibuat,
       t.assign_to      AS id_employee,
       pel.id_department,
       t.id_company
  FROM supertools_task_list t
  LEFT JOIN employee pel ON pel.id_employee = t.assign_to
  LEFT JOIN customer cu  ON cu.id_customer  = t.id_customer;

-- ------------------------------------------------------------
-- 8. Permintaan rekrutmen (Recruitment)
-- ------------------------------------------------------------
-- Penyaringnya `id_department` saja. Tabelnya punya `created_by`, tapi isinya
-- NAMA ORANG sebagai teks bebas ("Rangga Nugraha") -- bukan identitas, tidak
-- bisa dicocokkan ke sesi login, dan dua orang bernama sama akan tertukar.
-- Terisi 100% justru membuatnya menggoda dipakai.
CREATE OR REPLACE VIEW v_asisten_rekrutmen AS
SELECT s.id_submission,
       s.submission_number AS no_pengajuan,
       s."position"        AS posisi,
       d.name              AS departemen,
       s.date_needed       AS dibutuhkan,
       s.status,
       s.created_at        AS dibuat,
       s.id_department
  FROM hr_employee_submission s
  LEFT JOIN department d ON d.id_department = s.id_department;

-- ------------------------------------------------------------
-- 9. Program promosi (MAPS)
-- ------------------------------------------------------------
-- Penyaringnya `id_department` (terisi 15.532 dari 15.927 = 97,5%).
--
-- ⚠️ `id_created_users` SENGAJA TIDAK diikutkan: terisi 2 dari 15.927 baris.
-- Mendaftarkannya sebagai penyaring per orang berarti hampir semua orang
-- dapat hasil kosong -- tanpa galat, jadi tidak ada yang tahu.
--
-- ⚠️ `status` dibiarkan ANGKA MENTAH sebagai `kode_status`, tidak
-- diterjemahkan seperti di `v_asisten_klaim`. Arti angkanya untuk program
-- belum dipastikan ke pemilik data, dan menebak label status berarti
-- menampilkan kata yang salah dengan penuh percaya diri.
CREATE OR REPLACE VIEW v_asisten_program AS
SELECT p.id_program,
       p.program_number AS no_program,
       p.name           AS nama_program,
       p.activity       AS aktivitas,
       p.period_start   AS mulai,
       p.period_end     AS selesai,
       p.status         AS kode_status,
       p.created_at     AS dibuat,
       d.name           AS departemen,
       p.id_department,
       p.id_company
  FROM maps_program p
  LEFT JOIN department d ON d.id_department = p.id_department;

-- ============================================================
-- Izin baca untuk akun asisten
-- ============================================================
-- ⚠️ KOREKSI (30 Sep 2026): komentar di sini dulu menyatakan view baru
-- TIDAK otomatis ikut karena `ALTER DEFAULT PRIVILEGES` cuma mencakup TABLES.
-- ITU SALAH. Di PostgreSQL, tipe objek TABLES pada default privileges berarti
-- RELASI, dan view termasuk relasi. Terbukti waktu `v_login_profil` dibuat:
-- ai_readonly langsung bisa membacanya tanpa GRANT apa pun.
--
-- GRANT di bawah jadi mubazir, tapi SENGAJA dipertahankan: izin yang tertulis
-- jelas lebih mudah diperiksa daripada izin yang diwarisi diam-diam.
GRANT SELECT ON v_asisten_karyawan, v_asisten_pengajuan, v_asisten_aset,
                v_asisten_kunjungan, v_asisten_tiket, v_asisten_klaim,
                v_asisten_tugas, v_asisten_rekrutmen, v_asisten_program
  TO ai_readonly;

-- ============================================================
-- Yang harus terlihat setelah ini
-- ============================================================
SELECT c.relname AS view,
       has_table_privilege('ai_readonly', c.oid, 'SELECT') AS bisa_dibaca_asisten
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'v\_asisten\_%'
 ORDER BY 1;

-- Harus 9 baris, semuanya bisa_dibaca_asisten = true.
