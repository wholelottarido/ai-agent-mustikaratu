/**
 * Memberi PERAN pada akun uji di `users_config`.
 *
 *   npm run beri:peran-uji -- ridho
 *   npm run beri:peran-uji -- dafi
 *   npm run beri:peran-uji -- dafi --batal
 *
 * ⚠️ MENULIS KE DATABASE PERUSAHAAN. Memakai `DEMO_PG_ADMIN_*`.
 *
 * ============================================================
 * KENAPA INI PERLU
 * ============================================================
 * `ai_tool.izin` sekarang dibaca, dan tool tiket milik tim lain mensyaratkan
 * `ticket:read`. Akun uji yang kita suntikkan dulu punya daftar APLIKASI tapi
 * `roles: []` kosong di tiap aplikasi — berbeda dari akun karyawan sungguhan,
 * yang punya peran. Akibatnya tool tiket, termasuk pembuatan tiket yang baru
 * selesai dikerjakan, ditolak gerbang izin.
 *
 * Yang diberikan di sini peran yang BENAR-BENAR ADA dan dipakai 8 karyawan
 * sungguhan — "Portal - User", satu-satunya peran aplikasi Portal. Bukan peran
 * karangan, dan bukan Super Admin.
 *
 * ⚠️ TIDAK MEMBERI `assignment-ticket:read`. Izin itu cuma dimiliki peran
 * "Super Admin" di Admin Console, bersama sebelas izin lain termasuk hapus.
 * Memberi Super Admin kepada akun uji supaya bisa melihat antrean tiket adalah
 * memberi jauh lebih banyak daripada yang diminta, dan itu keputusan tim
 * pemilik aplikasinya.
 *
 * Isi `apps_config` sebelum diubah disalin ke `data/peran-uji-cadangan-*.json`,
 * dan `--batal` mengembalikannya persis.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Peran yang bisa diberikan, beserta aplikasi tempatnya menempel.
 *
 * ⚠️ `super-admin` SENGAJA TIDAK JADI BAWAAN, dan harus disebut namanya.
 *
 * Peran itu membawa 44 izin MENGHAPUS -- termasuk `user:delete`,
 * `employee:delete`, `company:delete`, dan `apps:delete`. Dan `users_config`
 * dipakai aplikasi Admin Console mereka yang sungguhan, bukan cuma gerbang
 * izin portal ini: yang diberikan bukan "lolos pemeriksaan di kode kita",
 * melainkan kemampuan menghapus data perusahaan betulan.
 *
 * Diberikan atas permintaan eksplisit untuk pengujian antrean tiket, karena
 * `assignment-ticket:read` tidak dimiliki peran lain mana pun.
 */
const PERAN: Record<string, { role_id: string; role_name: string; id_apps: string; apps: string }> = {
  "portal-user": {
    role_id: "38c34530-d07b-4235-81d0-59f8b89afa22",
    role_name: "Portal - User",
    id_apps: "b1952feb-2114-4892-a8f9-fab1ccc17469",
    apps: "Portal",
  },
  "super-admin": {
    role_id: "9c01de6d-9e26-4ce5-bc6c-4252c901ba2c",
    role_name: "Super Admin",
    id_apps: "392d9f16-0944-4e31-af17-6680c6737e02",
    apps: "Admin Console",
  },
};

const AKUN: Record<string, string> = {
  ridho: "ridho@mustika-ratu.co.id",
  dafi: "dafi@mustika-ratu.co.id",
};

const kunci = (process.argv[2] ?? "").toLowerCase();
const batal = process.argv.includes("--batal");
const kunciPeran = (process.argv.slice(3).find((x) => !x.startsWith("--")) ?? "portal-user").toLowerCase();
const username = AKUN[kunci];
const peran = PERAN[kunciPeran];
if (!username) {
  console.error(`Sebutkan akunnya: ${Object.keys(AKUN).join(" | ")}`);
  process.exit(1);
}
if (!peran) {
  console.error(`Peran tidak dikenal: ${kunciPeran}. Yang ada: ${Object.keys(PERAN).join(" | ")}`);
  process.exit(1);
}

// Cadangan dipisah per PERAN, bukan cuma per akun: kalau satu akun diberi dua
// peran, cadangan tunggal akan tertimpa dan `--batal` yang kedua mengembalikan
// keadaan yang sudah mengandung peran pertama tanpa ada yang menyadarinya.
const CADANGAN = join(process.cwd(), "data", `peran-uji-cadangan-${kunci}-${kunciPeran}.json`);

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
});
await c.connect();

const { rows: u } = await c.query<{ id_users: string }>(
  `SELECT id_users FROM users WHERE lower(username) = $1`, [username.toLowerCase()]);
if (u.length === 0) { console.error(`Akun ${username} tidak ada.`); await c.end(); process.exit(1); }
const idUsers = u[0].id_users;

const { rows: kini } = await c.query<{ apps_config: { apps?: Record<string, unknown>[] } | null }>(
  `SELECT apps_config FROM users_config WHERE id_users = $1`, [idUsers]);
if (kini.length === 0) { console.error("Akun ini belum punya baris users_config."); await c.end(); process.exit(1); }
const konfig = kini[0].apps_config ?? { apps: [] };

if (batal) {
  // ⚠️ Cadangan diperiksa MILIK SIAPA sebelum dipakai. Mengembalikan konfigurasi
  // orang lain ke akun ini akan memberi atau mencabut akses tanpa ada yang tahu.
  const cad = JSON.parse(await readFile(CADANGAN, "utf8")) as { idUsers: string; apps_config: unknown };
  if (cad.idUsers !== idUsers) {
    console.error(`DITOLAK: cadangan ini milik id_users lain (${cad.idUsers}).`);
    await c.end(); process.exit(1);
  }
  await c.query(`UPDATE users_config SET apps_config = $2::jsonb, updated_at = now() WHERE id_users = $1`,
    [idUsers, JSON.stringify(cad.apps_config)]);
  console.log(`${username}: dikembalikan ke isi semula.`);
  await c.end();
  process.exit(0);
}

// ⚠️ Peringatan dicetak SEBELUM menulis, dan menyebut angkanya. Peran yang
// membawa hak hapus tidak boleh diberikan tanpa yang menjalankan melihat
// seberapa besar yang ia berikan.
const { rows: hapus } = await c.query<{ n: number }>(
  `SELECT count(DISTINCT k)::int n FROM role_menu rm, LATERAL unnest(rm.permissions) AS k
    WHERE rm.id_roles = $1 AND k LIKE '%:delete'`, [peran.role_id]);
if (hapus[0].n > 0) {
  console.log(`
⚠️  Peran "${peran.role_name}" membawa ${hapus[0].n} izin MENGHAPUS.`);
  console.log(`    users_config dipakai aplikasi ${peran.apps} yang sungguhan, bukan cuma`);
  console.log(`    gerbang izin portal ini. Penghapusan yang terlanjur terjadi TIDAK ikut`);
  console.log(`    terbatalkan oleh --batal.
`);
}

await mkdir(join(process.cwd(), "data"), { recursive: true });
await writeFile(CADANGAN, JSON.stringify({ idUsers, username, apps_config: konfig }, null, 2));
console.log(`cadangan ditulis: ${CADANGAN}`);

const apps = Array.isArray(konfig.apps) ? konfig.apps : [];
const sasaran = apps.find((a) => a.app_id === peran.id_apps);
if (!sasaran) {
  console.error(`Akun ini tidak punya aplikasi ${peran.apps} di apps_config — tidak ada yang bisa diberi peran.`);
  await c.end(); process.exit(1);
}

const peranLama = Array.isArray(sasaran.roles) ? (sasaran.roles as Record<string, unknown>[]) : [];
if (peranLama.some((r) => r.role_id === peran.role_id)) {
  console.log(`${username}: sudah punya peran "${peran.role_name}" di ${peran.apps}. Tidak ada yang diubah.`);
  await c.end();
  process.exit(0);
}

// ⚠️ HANYA entri Portal yang disentuh, dan hanya `roles`-nya. Menulis ulang
// seluruh apps_config berarti satu kesalahan menghapus akses aplikasi lain.
sasaran.roles = [...peranLama, { role_id: peran.role_id, role_name: peran.role_name }];
await c.query(`UPDATE users_config SET apps_config = $2::jsonb, updated_at = now() WHERE id_users = $1`,
  [idUsers, JSON.stringify(konfig)]);

// Pembuktian: izinnya dibaca ULANG lewat jalur yang sama dengan yang dipakai portal.
const { rows: izin } = await c.query<{ kode: string }>(
  `SELECT DISTINCT k AS kode
     FROM users_config uc
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(uc.apps_config->'apps','[]'::jsonb)) ap
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ap->'roles','[]'::jsonb)) rr
     JOIN role_menu rm ON rm.id_roles = (rr->>'role_id')::uuid
     CROSS JOIN LATERAL unnest(COALESCE(rm.permissions,'{}')) AS k
    WHERE uc.id_users = $1 ORDER BY 1`, [idUsers]);
console.log(`\n${username}: peran "${peran.role_name}" ditambahkan ke aplikasi ${peran.apps}.`);
console.log(`izin sekarang (${izin.length}): ${izin.map((x) => x.kode).join(", ")}`);
console.log(
  izin.some((x) => x.kode === "ticket:read")
    ? `OK  — tool tiket akan lolos gerbang izin.`
    : `⚠️  ticket:read belum ada; tool tiket tetap ditolak.`,
);
// ⚠️ KUNCI PERANNYA IKUT DISEBUT, dan itu bukan kerapian.
//
// `--batal` memulihkan cadangan milik (akun, peran) ini. Tanpa menyebut
// perannya, perintah jatuh ke bawaan `portal-user` dan memulihkan keadaan
// SEBELUM peran pertama diberikan — mencabut dua peran sekaligus padahal yang
// diminta cuma satu, tanpa pesan apa pun.
console.log(`\nUntuk mengembalikan: npm run beri:peran-uji -- ${kunci} ${kunciPeran} --batal`);
await c.end();
process.exit(0);
