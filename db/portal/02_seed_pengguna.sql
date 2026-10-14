-- ============================================================
-- Akun contoh untuk mencoba portal.
-- ============================================================
-- DI-GENERATE oleh scripts/buat-pengguna.mts -- jangan edit manual.
--
-- Jalankan sebagai root:
--   mysql -u root -p portal -e "source db/portal/02_seed_pengguna.sql"
--
-- Password sama dengan username (marketing1 / marketing1). Ini AKUN COBA-COBA;
-- kalau nanti dipakai sungguhan, ganti dulu lewat:
--   npm run buat:pengguna -- <username> <password> <nama> <departemen> <peran>
-- ============================================================

USE portal;

-- marketing1 / marketing1  (marketing, staf)
INSERT INTO pengguna (username, password_hash, nama, departemen, peran)
  VALUES ('marketing1', 'scrypt:265ef36b86847d441f10b2d4ff63e477:f93c4f206a26d2a25228b44e27b92b6790d8d0814f7c8a86bcab8e074cfcf9ac80810789bbcd184133ba66a7a6982505b3e8e13aa2b54416d9587a43a37fcec0', 'Budi Santoso', 'marketing', 'staf')
  ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash), nama = VALUES(nama),
    departemen = VALUES(departemen), peran = VALUES(peran), aktif = 1;

-- marketing2 / marketing2  (marketing, kepala)
INSERT INTO pengguna (username, password_hash, nama, departemen, peran)
  VALUES ('marketing2', 'scrypt:ac85cb1c915878499e5d65a8874dc0d0:68e05a7b34632295dc71cbc40fd6343ce175429e07da583023b5bc1fe404eb6107fc0403c1f7e6e1eeda826269b9fb420d89658237decdc5f3812ea8d86cb889', 'Sari Dewi', 'marketing', 'kepala')
  ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash), nama = VALUES(nama),
    departemen = VALUES(departemen), peran = VALUES(peran), aktif = 1;

-- hr1 / hr1  (hr, staf)
INSERT INTO pengguna (username, password_hash, nama, departemen, peran)
  VALUES ('hr1', 'scrypt:456328a9afebcff7fc0dd9866a1ae5be:3bb33a6fd3fc5762b9b4815b74b11047c6f085db2a8a8ddac976dfff553b63d54d80105fff3c2ee836393c808da096f97ff57df029050c7071d5e7335e2f5255', 'Rina Kusuma', 'hr', 'staf')
  ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash), nama = VALUES(nama),
    departemen = VALUES(departemen), peran = VALUES(peran), aktif = 1;

-- hr2 / hr2  (hr, kepala)
INSERT INTO pengguna (username, password_hash, nama, departemen, peran)
  VALUES ('hr2', 'scrypt:4a37dae960b2a9a787530ccb6c6067df:ebae1a28ff5fbd5b0762dc3d55f122b5ff4a2f392b5a0ad2810f03873aff60675ba0125bcbfdb8b823c86e76b59363deedf306b99eec898db1f7dc5a168d6fcd', 'Agus Wijaya', 'hr', 'kepala')
  ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash), nama = VALUES(nama),
    departemen = VALUES(departemen), peran = VALUES(peran), aktif = 1;

SELECT id, username, nama, departemen, peran, aktif FROM pengguna ORDER BY id;
