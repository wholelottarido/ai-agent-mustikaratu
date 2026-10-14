-- ============================================================
-- Akun administrator untuk halaman /dbadmin
-- ============================================================
-- Jalankan SEBAGAI ROOT:
--   mysql -u root -p portal -e "source db/portal/15_akun_admin.sql"
--
-- Sebelum ini, satu-satunya admin adalah `hr2` -- akun yang sekaligus dipakai
-- sebagai kepala HR untuk menguji entri lembur dan persetujuan. Dua peran
-- menumpuk di satu akun bikin pengujian saling mengganggu: tiap kali mau
-- memindah sumber data, harus login sebagai orang yang juga sedang dipakai
-- menguji hal lain.
--
-- Akun ini MURNI administrator.
--
-- ⚠️ `is_admin = 1`, DAN peran `kepala`.
--
-- `is_admin` yang menentukan akses /dbadmin (diperiksa `hakPersetujuan()` ->
-- `cakupan: null`). Peran `kepala` ikut diisi karena kolomnya NOT NULL dan
-- dipakai memilih user MySQL departemen -- tapi akun ini tidak dimaksudkan
-- untuk bertanya soal data HR.
--
-- ⚠️ PASSWORDNYA LEMAH DAN DISENGAJA: `admin1`.
-- Ini portal uji di laptop sendiri, bukan sistem produksi. Kalau nanti
-- dipakai sungguhan, ganti dulu -- `npm run buat:pengguna` mencetak SQL-nya.
--
-- Yang tersimpan di bawah cuma HASH scrypt-nya; password polosnya tidak
-- pernah masuk ke berkas mana pun.
-- ============================================================

USE portal;

INSERT INTO pengguna (username, password_hash, nama, departemen, peran, is_admin, aktif)
  VALUES (
    'admin',
    'scrypt:bc67fc18c3ce6afe922653ca9e42d1c2:418c7a6007e377583ceba8ca30a59ff6a96c782cfbdec0391448d7956591caf80e3f5c4609a7636b04dd3a3b3e9cefb78c2d0ba55a78be8283ac441071630475',
    'Administrator',
    'hr',
    'kepala',
    1,
    1
  )
  ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash),
    nama          = VALUES(nama),
    is_admin      = 1,
    aktif         = 1;

-- ============================================================
-- Cabut hak admin dari `hr2`
-- ============================================================
-- ⚠️ SATU AKUN, SATU KEKUASAAN.
--
-- `hr2` dipakai sebagai kepala HR: mencatat lembur, menyetujui lembur,
-- meninjau pendaftaran departemennya. Hak admin menumpuk di atas itu membuat
-- dia bisa mengganti sumber data SELURUH sistem -- lintas departemen, di luar
-- wewenangnya sebagai kepala.
--
-- Setelah ini `hr2` tetap:
--   * mencatat & menyetujui lembur HR  (dari `peran = kepala`)
--   * meninjau pendaftaran HR          (`hakPersetujuan` -> cakupan 'hr')
-- Yang HILANG cuma akses /dbadmin.
--
-- Kalau suatu saat perlu dikembalikan:
--   UPDATE pengguna SET is_admin = 1 WHERE username = 'hr2';
UPDATE pengguna SET is_admin = 0 WHERE username = 'hr2';

SELECT id, username, nama, departemen, peran, is_admin, aktif
  FROM pengguna ORDER BY id;
