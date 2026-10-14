/**
 * Akun UJI di database perusahaan — untuk menguji login ujung-ke-ujung.
 *
 *   npm run uji:akun                # semua akun uji
 *   npm run uji:akun -- it          # satu saja
 *   npm run uji:akun -- --hapus     # bersihkan semua
 *   npm run uji:akun -- it --hapus  # bersihkan satu
 *
 * ⚠️ MENULIS KE DATABASE PERUSAHAAN. Ini satu-satunya skrip kita yang menulis
 * ke sana — sisanya cuma membaca. Disetujui 30 Sep 2026.
 *
 * ============================================================
 * KENAPA IDENTITASNYA DIBUAT MENCOLOK
 * ============================================================
 * Baris ini ikut terlihat di `v_asisten_karyawan`, jadi kalau ada yang
 * bertanya ke agent "berapa karyawan Marketing?", angkanya bertambah.
 * Database ini dipakai orang lain juga.
 *
 * Karena itu nama karyawan diawali penanda, dan tes yang menghitung lingkup
 * login MENGECUALIKAN penanda itu (`test:login-pg`) supaya tidak berubah
 * merah padahal kodenya benar.
 *
 * ============================================================
 * DUA PROFIL PER AKUN
 * ============================================================
 * Sengaja: itu yang membuat layar pemilih profil ikut teruji, sekaligus
 * membuktikan pemetaan jabatan -> peran bekerja di dua sisi (staf & kepala).
 *
 * ⚠️ Password dibaca dari environment dan di-hash `crypt(..., gen_salt('bf'))`
 * — bcrypt yang sama seperti akun asli. Nilainya tidak pernah ditulis ke
 * berkas mana pun.
 */
import { Client } from "pg";

type Akun = {
  kunci: string;
  username: string;
  departemen: string;
  envPassword: string;
  penanda: string;
  profil: { nama: string; jabatan: string }[];
};

const AKUN: Akun[] = [
  {
    kunci: "marketing",
    username: "uji.portal@contoh.test",
    departemen: "Marketing",
    envPassword: "UJI_AKUN_PASSWORD",
    penanda: "UJI PORTAL",
    profil: [
      { nama: "UJI PORTAL STAF - HAPUS", jabatan: "Brand Executive" },
      { nama: "UJI PORTAL KEPALA - HAPUS", jabatan: "Brand Manager" },
    ],
  },
  {
    kunci: "it",
    // Email menyerupai email kantor, atas permintaan 30 Sep 2026. Nama
    // karyawannya tetap berpenanda supaya tetap bisa dibedakan dari data asli.
    username: "ridho@mustika-ratu.co.id",
    departemen: "IT",
    envPassword: "UJI_AKUN_IT_PASSWORD",
    penanda: "Ridho",
    profil: [
      // Nama sengaja SAMA, dibedakan jabatannya — persis seperti tampilan
      // pemilih profil di sistem perusahaan.
      { nama: "Ridho", jabatan: "IT Helpdesk Staff" },
      { nama: "Ridho", jabatan: "IT Helpdesk Lead" },
    ],
  },
  {
    kunci: "maps",
    username: "dafi@mustika-ratu.co.id",
    // ⚠️ "Trade Marketing", bukan "MAPS". Dua alasan, dua-duanya menentukan:
    //
    //   1. Portal cuma menerima departemen yang terpetakan di
    //      `petakanDepartemen()` — marketing / hr / it. "MAPS" bukan
    //      departemen di tabel mereka, dan profil di luar lingkup DIBUANG,
    //      jadi akunnya akan ada tapi tidak bisa login sama sekali.
    //   2. Cakupan `departemen` di `asisten_klaim` menyaring lewat
    //      `id_department`. Trade Marketing punya 16.783 dari 29.199 klaim
    //      MAPS — cukup untuk membuktikan penyaringnya bekerja, dan cukup
    //      sedikit untuk membuktikan dia TIDAK melihat semuanya.
    departemen: "Trade Marketing",
    envPassword: "UJI_AKUN_MAPS_PASSWORD",
    penanda: "Dafi",
    // Satu profil saja — sengaja beda dari dua akun di atas, supaya jalur
    // login TANPA layar pemilih profil ikut teruji.
    // Jabatan harus ADA di tabel `positions` mereka -- skrip ini menolak yang
    // tidak ketemu, dan itu benar: jabatan karangan membuat baris karyawan
    // yang tidak cocok dengan data mana pun. "Admin Marketing" dipakai 2 orang
    // sungguhan, dan TIDAK ada di daftar-boleh kepala, jadi Dafi jadi `staf`.
    profil: [{ nama: "Dafi", jabatan: "Admin Marketing" }],
  },
];

const arg = process.argv.slice(2);
const HAPUS = arg.includes("--hapus");
const pilih = arg.filter((a) => !a.startsWith("--"));
const daftar = pilih.length > 0 ? AKUN.filter((a) => pilih.includes(a.kunci)) : AKUN;

if (daftar.length === 0) {
  console.log(`⛔ Akun uji tidak dikenal. Pilihan: ${AKUN.map((a) => a.kunci).join(", ")}`);
  process.exit(1);
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

const hitung = async () => {
  const r = await c.query("SELECT (SELECT COUNT(*) FROM employee) k, (SELECT COUNT(*) FROM users) u");
  return `${r.rows[0].k} karyawan, ${r.rows[0].u} akun`;
};
console.log(`sebelum : ${await hitung()}\n`);

let gagal = false;

for (const a of daftar) {
  console.log(`=== ${a.kunci} — ${a.username} ===`);
  const PW = process.env[a.envPassword];
  if (!HAPUS && !PW) {
    console.log(`  ⛔ ${a.envPassword} belum diisi di .env.local. Dilewati.\n`);
    gagal = true;
    continue;
  }

  try {
    await c.query("BEGIN");

    if (HAPUS) {
      // ⚠️ Dua syarat, bukan satu: username uji DAN nama berpenanda. Satu
      // kesalahan ketik tidak boleh menghapus karyawan sungguhan.
      const e = await c.query(
        `DELETE FROM employee
          WHERE fullname LIKE $1
            AND id_users IN (SELECT id_users FROM users WHERE username = $2)
          RETURNING fullname`,
        [`${a.penanda}%`, a.username],
      );
      const u = await c.query("DELETE FROM users WHERE username = $1 RETURNING username", [
        a.username,
      ]);
      await c.query("COMMIT");
      console.log(`  dihapus: ${e.rowCount} profil, ${u.rowCount} akun\n`);
      continue;
    }

    const dep = await c.query("SELECT id_department FROM department WHERE name = $1 LIMIT 1", [
      a.departemen,
    ]);
    if (dep.rows.length === 0) throw new Error(`Departemen "${a.departemen}" tidak ketemu.`);

    // ⚠️ TIDAK pakai ON CONFLICT (username).
    //
    // `users.username` TIDAK punya unique constraint — justru itu sebabnya ada
    // 3 username kembar di database ini. ON CONFLICT menuntut constraint yang
    // cocok, jadi versi pertama skrip ini gagal mentah-mentah.
    const punya = await c.query("SELECT id_users FROM users WHERE username = $1", [a.username]);
    if (punya.rows.length > 1) {
      throw new Error(
        `Username "${a.username}" ternyata ada ${punya.rows.length} baris. ` +
          "Akun kembar tidak akan pernah bisa login (penjaga di cek_login_perusahaan). " +
          "Bersihkan dulu: npm run uji:akun -- --hapus",
      );
    }

    let idUsers: string;
    if (punya.rows.length === 1) {
      idUsers = punya.rows[0].id_users;
      await c.query(
        `UPDATE users SET password = crypt($2, gen_salt('bf')), is_active = true
          WHERE id_users = $1`,
        [idUsers, PW],
      );
    } else {
      const u = await c.query(
        `INSERT INTO users (id_users, username, password, is_active, is_verify)
         VALUES (gen_random_uuid(), $1, crypt($2, gen_salt('bf')), true, true)
         RETURNING id_users`,
        [a.username, PW],
      );
      idUsers = u.rows[0].id_users;
    }

    // Dibuat ulang dari nol supaya dijalankan berkali-kali tidak menumpuk.
    await c.query("DELETE FROM employee WHERE id_users = $1 AND fullname LIKE $2", [
      idUsers,
      `${a.penanda}%`,
    ]);

    for (const p of a.profil) {
      const pos = await c.query("SELECT id_positions FROM positions WHERE positions = $1 LIMIT 1", [
        p.jabatan,
      ]);
      if (pos.rows.length === 0) throw new Error(`Jabatan "${p.jabatan}" tidak ketemu.`);
      await c.query(
        `INSERT INTO employee (id_employee, id_users, fullname, id_department, id_positions, start_of_work)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_DATE)`,
        [idUsers, p.nama, dep.rows[0].id_department, pos.rows[0].id_positions],
      );
      console.log(`  profil : ${p.nama} — ${p.jabatan}`);
    }

    await c.query("COMMIT");

    // Dibuktikan lewat jalur yang sebenarnya dipakai portal.
    const benar = await c.query("SELECT cek_login_perusahaan($1,$2) AS id", [a.username, PW]);
    const salah = await c.query("SELECT cek_login_perusahaan($1,$2) AS id", [a.username, `${PW}x`]);
    const jml = await c.query("SELECT COUNT(*) n FROM v_login_profil WHERE id_users = $1", [idUsers]);
    console.log(`  password benar -> ${benar.rows[0].id ? "diterima ✅" : "DITOLAK ❌"}`);
    console.log(`  password salah -> ${salah.rows[0].id ? "DITERIMA ❌" : "ditolak ✅"}`);
    console.log(`  profil terbaca portal: ${jml.rows[0].n}\n`);
    if (!benar.rows[0].id) gagal = true;
  } catch (e) {
    await c.query("ROLLBACK");
    console.log(`  ⛔ GAGAL, dibatalkan: ${e instanceof Error ? e.message : String(e)}\n`);
    gagal = true;
  }
}

console.log(`sesudah : ${await hitung()}`);
if (!HAPUS && !gagal) {
  console.log(`\nLogin di /login tab "Akun perusahaan" dengan salah satu username di atas.`);
  console.log(`Selesai tes, bersihkan:  npm run uji:akun -- --hapus`);
}
await c.end();
process.exitCode = gagal ? 1 : 0;
