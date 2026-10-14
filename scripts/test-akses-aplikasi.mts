/**
 * Uji pembaca identitas & akses aplikasi.
 *
 *   npm run test:akses-app
 *
 * HANYA MEMBACA.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. identitas yang dipakai penyaring (`id_department`, `id_company`)
 *      benar-benar milik karyawan itu, bukan tertukar;
 *   2. `app_id` yang sudah tidak ada di tabel `apps` TIDAK ikut jadi akses --
 *      ada 433 baris konfigurasi yang menunjuk id Portal lama;
 *   3. akses dibaca lewat `id_users` dari baris `employee`, jadi username
 *      ganda tidak membuat orang dapat akses milik baris yang lain;
 *   4. karyawan tanpa pemberian aplikasi tetap dapat Portal -- dan HANYA
 *      Portal, bukan daftar semua aplikasi. Portal itu gerbangnya: siapa pun
 *      yang bisa login ada di dalamnya.
 */
import { aksesUntukEmployee, APP_PORTAL } from "../lib/akses-aplikasi.ts";
import { buatRouter } from "../voltagent/agent-konfig.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import type { QueryResultRow } from "pg";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}
const pool = poolPerusahaan();
// `<T,>` bukan salah ketik: di berkas .mts, `<T>` terbaca sebagai awalan JSX.
const q = async <T extends QueryResultRow,>(s: string, p: unknown[] = []) =>
  (await pool.query<T>(s, p)).rows;

// ============================================================
console.log("=== 1. Identitas penyaring diambil dari orang yang benar ===");
// ============================================================
const [contoh] = await q<{ id_employee: string; fullname: string; id_department: string | null; id_company: string | null; id_users: string | null }>(
  `SELECT id_employee, fullname, id_department, id_company, id_users
     FROM employee WHERE id_department IS NOT NULL AND id_users IS NOT NULL LIMIT 1`);
const a = await aksesUntukEmployee(contoh.id_employee);
cek("karyawan ditemukan", Boolean(a), contoh.fullname);
cek("id_department cocok", a!.sesi.idDepartment === contoh.id_department);
cek("id_company cocok", a!.sesi.idCompany === contoh.id_company);
cek("id_users cocok", a!.sesi.idUsers === contoh.id_users);

// ============================================================
console.log("\n=== 2. app_id yang sudah tidak ada tidak jadi akses ===");
// ============================================================
const [basi] = await q<{ id_employee: string; fullname: string }>(
  `SELECT e.id_employee, e.fullname
     FROM employee e JOIN users_config uc ON uc.id_users = e.id_users
     CROSS JOIN LATERAL jsonb_array_elements(uc.apps_config->'apps') x
     LEFT JOIN apps ap ON ap.id_apps = (x->>'app_id')::uuid
    WHERE ap.id_apps IS NULL LIMIT 1`);
const b = await aksesUntukEmployee(basi.id_employee);
console.log(`  ${basi.fullname}: ${b!.apps.length} aplikasi, ${b!.diabaikan.length} diabaikan`);
for (const d of b!.diabaikan) console.log(`    diabaikan ${d.id} (${d.nama ?? "tanpa nama"}) — ${d.sebab}`);
cek("ada yang diabaikan", b!.diabaikan.length > 0);
cek("yang diabaikan tidak ikut di daftar apps", b!.diabaikan.every((d) => !b!.apps.includes(d.id)));

// Tiap app yang lolos harus benar-benar ada DAN aktif -- diperiksa lewat query
// sendiri, bukan dengan memanggil fungsi yang sama.
let sahSemua = true;
for (const id of b!.apps) {
  const [ap] = await q<{ n: number }>(`SELECT count(*)::int n FROM apps WHERE id_apps = $1 AND is_active`, [id]);
  if (ap.n !== 1) { sahSemua = false; console.log(`    ${id} TIDAK aktif/ada`); }
}
cek("setiap aplikasi yang lolos benar-benar ada dan aktif", sahSemua, `${b!.apps.length} aplikasi`);

// ============================================================
console.log("\n=== 3. Username ganda tidak membuat akses tertukar ===");
// ============================================================
// `users` tidak punya batasan unik pada username. Kalau akses dicari lewat
// username, orang bisa mendapat daftar aplikasi milik baris users yang lain.
const ganda = await q<{ username: string; n: number }>(
  `SELECT lower(username) username, count(*)::int n FROM users GROUP BY 1 HAVING count(*) > 1`);
console.log(`  username ganda di users: ${ganda.length} (${ganda.map((g) => g.username).join(", ")})`);
let konsisten = true;
for (const g of ganda) {
  const emp = await q<{ id_employee: string; id_users: string }>(
    `SELECT e.id_employee, e.id_users FROM employee e JOIN users u ON u.id_users = e.id_users
      WHERE lower(u.username) = $1`, [g.username]);
  for (const e of emp) {
    const r = await aksesUntukEmployee(e.id_employee);
    if (r?.sesi.idUsers !== e.id_users) { konsisten = false; console.log(`    ${e.id_employee}: id_users ${r?.sesi.idUsers} != ${e.id_users}`); }
  }
}
cek("id_users selalu dari baris employee-nya sendiri", konsisten, `${ganda.length} username diperiksa`);

// ============================================================
console.log("\n=== 4. Tanpa pemberian aplikasi = Portal saja, bukan semua ===");
// ============================================================
const [tanpa] = await q<{ id_employee: string; fullname: string }>(
  `SELECT e.id_employee, e.fullname FROM employee e
    LEFT JOIN users_config uc ON uc.id_users = e.id_users
   WHERE uc.id_users IS NULL LIMIT 1`);
const t = await aksesUntukEmployee(tanpa.id_employee);
cek("karyawan tetap ditemukan", Boolean(t), tanpa.fullname);
// ⚠️ Portal SELALU terbuka — siapa pun yang bisa login ada di dalamnya.
// Tanpa aturan itu, 1.133 karyawan tanpa baris `users_config` tidak akan
// punya satu pun agent, termasuk yang paling berguna buat mereka.
cek("tetap dapat Portal", t!.apps.includes(APP_PORTAL), `${t!.apps.length} aplikasi`);
cek("HANYA Portal, tidak ada tambahan", t!.apps.length === 1, t!.apps.join(", "));
const totalApps = (await q<{ n: number }>(`SELECT count(*)::int n FROM apps WHERE is_active`))[0].n;
cek("tidak diam-diam diberi semua aplikasi", t!.apps.length < totalApps, `${totalApps} aplikasi aktif ada di sistem`);

cek("id_employee yang tidak ada mengembalikan undefined",
  (await aksesUntukEmployee("00000000-0000-0000-0000-000000000000")) === undefined);
cek("id_employee yang bukan uuid ditolak tanpa query",
  (await aksesUntukEmployee("bukan-uuid'; DROP TABLE employee; --")) === undefined);

// ============================================================
console.log("\n=== 5. Akses menentukan bawahan router ===");
// ============================================================
// Inilah gunanya berkas ini: daftar aplikasi -> agent mana yang terpasang.
const kaya = await q<{ id_employee: string; fullname: string; n: number }>(
  `SELECT e.id_employee, e.fullname, jsonb_array_length(uc.apps_config->'apps') n
     FROM employee e JOIN users_config uc ON uc.id_users = e.id_users
    ORDER BY n DESC LIMIT 1`);
const kayaAkses = await aksesUntukEmployee(kaya[0].id_employee);
const r1 = await buatRouter(kayaAkses!.sesi, kayaAkses!.apps);
console.log(`  ${kaya[0].fullname}: ${kayaAkses!.apps.length} aplikasi -> bawahan ${r1!.bawahan.map((x) => x.kode).join(", ") || "(tidak ada)"}`);
cek("punya aplikasi -> punya bawahan", r1!.bawahan.length > 0);

const r2 = await buatRouter(t!.sesi, t!.apps);
console.log(`  ${tanpa.fullname}: tanpa users_config -> bawahan ${r2!.bawahan.map((x) => x.kode).join(", ") || "(tidak ada)"}`);
cek("tanpa users_config tetap dapat agent Portal",
  r2!.bawahan.length === 1 && r2!.bawahan[0].kode === "agent-portal");

// ============================================================
console.log("\n=== Izin pemakai ikut ditelusuri ===");
// ============================================================
// ⚠️ Izin datang dari PERAN di `users_config`, bukan dari departemen.
// Departemen menjawab "orang ini bagian apa"; izin menjawab "orang ini boleh
// apa". Menyamakannya berarti tiap orang IT otomatis boleh segalanya.
const { rows: berperan } = await pool.query<{ id_employee: string; username: string }>(
  `SELECT e.id_employee, u.username FROM users u
     JOIN employee e ON e.id_users = u.id_users
     JOIN users_config uc ON uc.id_users = u.id_users
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(uc.apps_config->'apps','[]'::jsonb)) ap
    WHERE jsonb_array_length(COALESCE(ap->'roles','[]'::jsonb)) > 0
    LIMIT 1`);
if (berperan.length === 0) {
  cek("ada karyawan berperan untuk diuji", false, "tidak ada satu pun di database");
} else {
  const a = await aksesUntukEmployee(berperan[0].id_employee);
  cek("izin ditelusuri, bukan undefined", Array.isArray(a?.sesi.izin));
  cek("karyawan berperan punya minimal satu izin", (a?.sesi.izin?.length ?? 0) > 0,
    (a?.sesi.izin ?? []).slice(0, 4).join(", "));
  cek("kodenya berbentuk `bagian:aksi`", (a?.sesi.izin ?? []).every((k) => /^[a-z0-9-]+:[a-z0-9:-]+$/.test(k)),
    (a?.sesi.izin ?? []).join(", ").slice(0, 60));
}

// Karyawan tanpa baris users_config tidak boleh membuat penelusuran izin
// meledak -- dia cuma tidak punya izin.
const kosong = await aksesUntukEmployee(tanpa.id_employee);
cek("tanpa users_config -> izin kosong, bukan galat", Array.isArray(kosong?.sesi.izin) && kosong!.sesi.izin!.length === 0);

await pool.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
// ⚠️ `process.exit`, bukan `exitCode`. Sejak `muatKonfig()` ikut membaca
// `ai_tool_agent` di MySQL, pool-nya menahan event loop tetap hidup dan
// skrip ini mencetak hasilnya lalu MENGGANTUNG — lolos tapi tidak pernah
// selesai, yang di CI terbaca sebagai uji yang macet.
process.exit(gagal === 0 ? 0 : 1);
