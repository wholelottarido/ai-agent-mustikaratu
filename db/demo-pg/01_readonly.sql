-- ============================================================
-- User PostgreSQL READ-ONLY untuk agent
-- ============================================================
-- Database : mustika_ratu_dev @ 157.20.255.29
-- Dijalankan sebagai: postgres (superuser)
--
-- ⚠️ INI MENGUBAH SERVER PERUSAHAAN, BUKAN LAPTOP SENDIRI.
-- Beri tahu pemegang server sebelum dijalankan. Role baru yang muncul tanpa
-- keterangan akan membingungkan orang berikutnya yang memeriksa.
--
-- ⚠️ KENAPA PERLU.
--
-- Saat ini satu-satunya role di server ini adalah `postgres` (superuser).
-- Kalau aplikasi menyambung dengan itu, SATU-SATUNYA yang menahan model
-- menulis/menghapus adalah `sql-guard.ts` -- kode kita sendiri.
--
-- Seluruh proyek ini dibangun di atas prinsip sebaliknya: yang menahan harus
-- lapisan yang TIDAK BISA DIBUJUK. Di MySQL, staf HR tidak bisa membaca gaji
-- bukan karena promptnya melarang, tapi karena GRANT-nya memang tidak ada.
-- Menyambung sebagai superuser membuang jaminan itu.
--
-- Role ini TIDAK menambah kuasa apa pun ke siapa pun. Dia cuma menyediakan
-- identitas koneksi yang secara struktural tidak bisa menulis.
--
-- Membatalkan: DROP OWNED BY ai_readonly; DROP ROLE ai_readonly;
--
-- ⚠️ BERKAS INI DOKUMENTASI, BUKAN YANG DIJALANKAN.
--
-- Yang dijalankan: `scripts/buat-pg-readonly.mts`, karena passwordnya dibaca
-- dari `.env.local` dan TIDAK boleh ditulis di berkas SQL — sudah ada 5
-- berkas SQL di proyek ini yang memuat password, dan itu jangan ditambah.
--
-- Sesudahnya jalankan juga `scripts/tutup-kolom-sensitif.mts`: GRANT SELECT
-- ON ALL TABLES di bawah ini ikut membuka `users.password` dan 3 kolom token
-- lain. Verifikasi dengan `npm run uji:pg` (19 pemeriksaan).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Role
-- ------------------------------------------------------------
-- NOLOGIN-nya tidak dipakai: role ini memang untuk dipakai menyambung.
-- Tanpa CREATEDB, CREATEROLE, SUPERUSER, BYPASSRLS, REPLICATION.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_readonly') THEN
    CREATE ROLE ai_readonly LOGIN PASSWORD 'GANTI_DENGAN_PASSWORD_ANDA';
  END IF;
END
$$;

-- Batas beban, sepadan dengan MAX_USER_CONNECTIONS di MySQL kita.
ALTER ROLE ai_readonly CONNECTION LIMIT 10;

-- Query yang kelamaan dipotong sendiri. Tabel terbesar di sini 4,2 juta baris
-- (`trx_ba_sales`); satu query ceroboh tanpa batas bisa membebani server yang
-- dipakai orang lain.
ALTER ROLE ai_readonly SET statement_timeout = '30s';

-- Jaring pengaman tambahan: walaupun nanti ada yang keliru memberi izin
-- tulis, seluruh transaksi role ini tetap read-only.
ALTER ROLE ai_readonly SET default_transaction_read_only = on;

-- ------------------------------------------------------------
-- 2. Izin baca
-- ------------------------------------------------------------
GRANT CONNECT ON DATABASE mustika_ratu_dev TO ai_readonly;
GRANT USAGE   ON SCHEMA public             TO ai_readonly;

-- Tahap awal: baca seluruh skema public. Ini SUDAH jauh lebih sempit daripada
-- superuser, dan masih bisa dipersempit lagi nanti (lihat bagian 4).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_readonly;

-- Tabel/view yang dibuat `postgres` SETELAH ini ikut terbaca. Tanpa baris ini,
-- tabel baru tidak terlihat dan gejalanya muncul belakangan sebagai
-- "permission denied" yang membingungkan.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO ai_readonly;

-- ------------------------------------------------------------
-- 3. Yang harus terlihat setelah ini
-- ------------------------------------------------------------
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolconnlimit
  FROM pg_roles WHERE rolname = 'ai_readonly';

-- Harus: rolsuper=f, rolcreatedb=f, rolcreaterole=f, rolcanlogin=t
-- Kalau rolsuper=t, BATALKAN dan periksa ulang.

-- ============================================================
-- 4. Kalau mau dipersempit ke permukaan agent saja
-- ============================================================
-- Rancangan perusahaan sudah menyediakan 8 view `v_ai_*` sebagai permukaan
-- data yang layak dibaca agent. Kalau nanti disepakati cuma itu yang boleh:
--
--   REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM ai_readonly;
--   GRANT SELECT ON v_ai_aset, v_ai_karyawan, v_ai_klaim_maps, v_ai_kunjungan,
--                   v_ai_pengajuan, v_ai_tiket
--     TO ai_readonly;
--
-- ⚠️ Catatan penting: view `v_ai_*` TIDAK punya WHERE -- semuanya menampilkan
-- SELURUH baris. Penyaring per-pengguna (diri/bawahan/semua) tetap harus
-- dipasang aplikasi, bukan diandalkan dari view-nya.
