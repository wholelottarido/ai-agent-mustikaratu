/**
 * Tes pemetaan & verifikasi login akun perusahaan (Tahap 10B-1).
 *
 * PRASYARAT: `npm run buat:pg-login` sudah dijalankan.
 *
 * ⚠️ TIDAK ADA password asli yang dipakai di sini. Yang diuji: jalur
 * penolakan, bentuk data, dan pemetaan departemen/jabatan. Membuktikan
 * "password benar -> masuk" butuh kredensial karyawan sungguhan, yang tidak
 * kita punya dan tidak seharusnya punya.
 */
import {
  cekPasswordPerusahaan, profilAkun, petakanDepartemen, petakanPeran, nilaiProfil,
  poolLoginPerusahaan,
} from "../lib/login-perusahaan.ts";
import {
  simpanAkunPerusahaan, catatPilihanProfil, usernamePortal,
  tokenPilihProfil, bacaTokenPilihProfil,
} from "../lib/akun-perusahaan.ts";
import { buatToken } from "../lib/sesi.ts";
import mysql from "mysql2/promise";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

console.log("--- pemetaan departemen ---");
{
  cek(petakanDepartemen("Marketing") === "marketing", "Marketing -> marketing");
  cek(petakanDepartemen("Trade Marketing") === "marketing", "Trade Marketing -> marketing");
  cek(petakanDepartemen("HRD") === "hr", "HRD -> hr");
  cek(petakanDepartemen("HRD & GA") === "hr", "HRD & GA -> hr");

  // ⚠️ Inti perapian teks: database punya DUA baris department untuk hal yang
  // sama, `HRD` dan `HRD ` (berspasi). Tanpa trim, satu orang hilang.
  cek(petakanDepartemen("HRD ") === "hr", "HRD berspasi -> hr (bukan ditolak)");
  cek(petakanDepartemen("  marketing  ") === "marketing", "spasi & huruf kecil tetap kena");

  // Gagal-menolak: di luar daftar harus null, bukan ditebak.
  cek(petakanDepartemen("IT") === "it", "IT MASUK lingkup (ditambah 30 Sep 2026)");

  for (const d of ["Sales", "Finance", "Produksi", "", "HR Management"]) {
    cek(petakanDepartemen(d) === null, `"${d}" DITOLAK (di luar lingkup A)`);
  }
}

console.log("--- pemetaan peran ---");
{
  for (const j of ["GM HRD", "Senior HR Manager", "Head of Marketing", "Brand Manager",
                   "Group Brand Manager", "Manager Event & Design"]) {
    cek(petakanPeran(j) === "kepala", `${j} -> kepala`);
  }
  // Jabatan dengan spasi di belakang, seperti tersimpan di database.
  cek(petakanPeran("Recruitment Asst. Manager ") === "kepala",
    "Recruitment Asst. Manager (berspasi) -> kepala");

  for (const j of ["Brand Executive", "Admin Marketing", "Social Media Specialist",
                   "General Affairs", "Sekretariat HRD", ""]) {
    cek(petakanPeran(j) === "staf", `${j || "(kosong)"} -> staf`);
  }

  // ⚠️ Yang SENGAJA staf walau kedengaran pimpinan. Kalau salah satu berubah
  // jadi kepala tanpa ada yang memutuskan, tes ini yang berteriak.
  for (const j of ["Team Leader Makassar", "TL Makassar", "Web Devlp. Maint. & Design Sptd."]) {
    cek(petakanPeran(j) === "staf", `${j} tetap staf (belum diputuskan)`);
  }
  // Regex naif akan menjadikan ini kepala. Daftar-boleh tidak.
  for (const j of ["Assistant to the Manager", "Manager Trainee", "Head Chef"]) {
    cek(petakanPeran(j) === "staf", `"${j}" tidak otomatis kepala`);
  }
}

console.log("--- verifikasi password ---");
{
  const h = await cekPasswordPerusahaan("tidak-ada-akun-ini@contoh.test", "salah");
  cek(h === null, "akun karangan -> null");
}
{
  const h = await cekPasswordPerusahaan("unregisted@mustika-ratu.co.id", "password-salah-sekali");
  cek(h === null, "akun nyata + password salah -> null");
}
{
  // Penyuntikan SQL lewat username: harus tertolak biasa, bukan error.
  const h = await cekPasswordPerusahaan("' OR 1=1 --", "x");
  cek(h === null, "percobaan suntik SQL -> null, bukan error");
}

console.log("--- data profil ---");
{
  // Cari satu akun yang dipakai banyak orang, lewat view yang sama yang
  // dipakai portal. Tidak perlu password.
  const p = poolLoginPerusahaan();
  const r = await p.query<{ id_users: string; n: string }>(
    `SELECT id_users, COUNT(*)::text n FROM v_login_profil
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`);
  const { id_users, n } = r.rows[0];
  cek(Number(n) > 100, `ada akun berbagi (${n} profil)`);

  const daftar = await profilAkun(id_users);
  cek(daftar.length === Number(n), "profilAkun mengembalikan semuanya", `${daftar.length}`);
  cek(daftar.every((x) => x.idEmployee && x.nama !== undefined), "tiap profil punya idEmployee & nama");
  cek(daftar.every((x, k, a) => k === 0 || a[k - 1].nama.localeCompare(x.nama, "id") <= 0),
    "urut menurut nama (aturan JS, bukan collation database)");

  const kosong = await profilAkun("00000000-0000-0000-0000-000000000000");
  cek(kosong.length === 0, "id_users karangan -> daftar kosong");
}

console.log("--- lingkup login: marketing + HR + IT ---");
{
  const p = poolLoginPerusahaan();
  const semua = await p.query<{ nama: string; jabatan: string; departemen: string }>(
    "SELECT nama, jabatan, departemen FROM v_login_profil");

  // ⚠️ Akun uji DIKECUALIKAN dari hitungan.
  //
  // `npm run uji:akun` menambah 2 profil Marketing ke database perusahaan
  // supaya login bisa diuji ujung-ke-ujung. Tanpa pengecualian ini, tes
  // berubah merah jadi 47 padahal kodenya benar -- kesalahan yang sudah dua
  // kali terjadi di `test:sumber` dan `test:sumber-http`: tes yang
  // bergantung pada keadaan database yang bisa berubah.
  const PENANDA_UJI = ["UJI PORTAL", "Ridho"];
  const bukanUji = (n: string) => !PENANDA_UJI.some((x) => n.startsWith(x));
  const masuk = semua.rows.filter(
    (r) => petakanDepartemen(r.departemen) !== null && bukanUji(r.nama));
  // ⚠️ Dipecah PER DEPARTEMEN, bukan satu angka gabungan.
  //
  // Versi lama cuma menyatakan "tepat 45". Begitu IT ditambahkan, angkanya
  // jadi 58 dan tesnya merah tanpa memberi tahu BAGIAN MANA yang berubah.
  // Dipecah begini, kalau satu departemen bergeser langsung kelihatan yang
  // mana -- dan menambah departemen baru cuma menambah satu baris.
  const perDep: Record<string, number> = {};
  for (const r of masuk) {
    const d = petakanDepartemen(r.departemen)!;
    perDep[d] = (perDep[d] ?? 0) + 1;
  }
  for (const [dep, harap] of [["marketing", 38], ["hr", 7], ["it", 13]] as const) {
    cek(perDep[dep] === harap, `${dep}: ${harap} orang`, `dapat ${perDep[dep] ?? 0}`);
  }
  cek(masuk.length === 58, "total lingkup 58 orang",
    `dapat ${masuk.length} dari ${semua.rows.length}`);

  const kepala = masuk.filter((r) => petakanPeran(r.jabatan) === "kepala");
  console.log(`  -> ${kepala.length} kepala, ${masuk.length - kepala.length} staf`);
  cek(kepala.length > 0 && kepala.length < masuk.length,
    `ada kepala DAN staf (${kepala.length}/${masuk.length})`);

  // Tiap orang dalam lingkup harus dapat keputusan yang jelas.
  const macet = masuk.filter((r) => !nilaiProfil({
    idEmployee: "x", nama: r.nama, jabatan: r.jabatan, departemen: r.departemen }).ok);
  cek(macet.length === 0, "tidak ada yang masuk lingkup tapi ditolak nilaiProfil()");

  // Dan yang di luar lingkup harus benar-benar ditolak.
  const luar = semua.rows.find((r) => petakanDepartemen(r.departemen) === null);
  if (luar) {
    const h = nilaiProfil({ idEmployee: "x", nama: luar.nama, jabatan: luar.jabatan,
      departemen: luar.departemen });
    cek(!h.ok && h.sebab === "departemen-di-luar-lingkup",
      `di luar lingkup ditolak dengan sebab jelas ("${luar.departemen}")`);
  }

  console.log("\n  daftar kepala yang terdeteksi:");
  for (const k of kepala) console.log(`    ${k.jabatan}  —  ${k.departemen}`);
}

console.log("--- simpan akun & jejak audit ---");
{
  // ⚠️ Profil BUATAN, bukan karyawan sungguhan. Yang diuji perilaku
  // penyimpanan, bukan data orang. Dibersihkan di akhir blok ini.
  const UJI_EMP = "00000000-1111-2222-3333-444444444444";
  const profil = {
    idEmployee: UJI_EMP,
    nama: "Uji Simpan Akun",
    jabatan: "Brand Executive",
    departemen: "Marketing",
  };

  const root = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: "root", password: "", database: process.env.PORTAL_DB_NAME,
  });
  const bersihkan = async () => {
    await root.query("DELETE FROM pengguna WHERE id_employee = ?", [UJI_EMP]);
    await root.query("DELETE FROM login_perusahaan_log WHERE id_employee = ?", [UJI_EMP]);
  };
  await bersihkan();

  const akun = await simpanAkunPerusahaan({ profil, departemen: "marketing", peran: "staf" });
  cek(akun.id > 0, "baris pengguna dibuat", `id ${akun.id}`);
  cek(akun.username === usernamePortal(UJI_EMP), "username berbentuk mr:<id_employee>", akun.username);
  cek(akun.admin === false, "akun perusahaan TIDAK otomatis admin");

  const [b1]: any = await root.query(
    "SELECT password_hash, sumber_akun, departemen, peran, aktif FROM pengguna WHERE id_employee = ?",
    [UJI_EMP]);
  cek(b1[0].password_hash === null, "password_hash NULL (portal tidak menyimpan password perusahaan)");
  cek(b1[0].sumber_akun === "perusahaan", "sumber_akun = perusahaan");
  cek(String(b1[0].departemen) === "marketing" && String(b1[0].peran) === "staf",
    "departemen & peran tersimpan");

  // Login kedua dengan jabatan yang sudah naik: portal HARUS ikut berubah.
  await simpanAkunPerusahaan({
    profil: { ...profil, jabatan: "Brand Manager", nama: "Uji Simpan Akun (naik)" },
    departemen: "marketing", peran: "kepala" });
  const [b2]: any = await root.query(
    "SELECT COUNT(*) c FROM pengguna WHERE id_employee = ?", [UJI_EMP]);
  cek(Number(b2[0].c) === 1, "login ulang TIDAK membuat baris kedua");
  const [b3]: any = await root.query(
    "SELECT nama, peran FROM pengguna WHERE id_employee = ?", [UJI_EMP]);
  cek(String(b3[0].peran) === "kepala", "peran ikut diperbarui dari database perusahaan");
  cek(String(b3[0].nama).includes("naik"), "nama ikut diperbarui");

  await catatPilihanProfil({
    username: "uji@contoh.test", idUsers: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    profil, peran: "staf", jmlProfil: 4, ip: "127.0.0.1" });
  const [log]: any = await root.query(
    "SELECT username, jml_profil, ip, nama FROM login_perusahaan_log WHERE id_employee = ?",
    [UJI_EMP]);
  cek(log.length === 1, "pemilihan profil tercatat di audit");
  cek(Number(log[0]?.jml_profil) === 4, "audit menyimpan berapa profil tersedia saat itu");
  cek(log[0]?.ip === "127.0.0.1", "audit menyimpan IP");

  await bersihkan();
  const [sisa]: any = await root.query(
    "SELECT COUNT(*) c FROM pengguna WHERE id_employee = ?", [UJI_EMP]);
  cek(Number(sisa[0].c) === 0, "data uji dibersihkan");
  await root.end();
}

console.log("--- token pemilihan profil ---");
{
  const t = await tokenPilihProfil("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "uji@contoh.test");
  const isi = await bacaTokenPilihProfil(t);
  cek(isi?.idUsers === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "token bisa dibaca balik");

  cek((await bacaTokenPilihProfil("bukan.token.sama.sekali")) === null, "token ngawur ditolak");
  cek((await bacaTokenPilihProfil(t.slice(0, -3) + "xyz")) === null,
    "token yang diubah-ubah ditolak (tanda tangan tidak cocok)");

  // ⚠️ Token sesi TIDAK boleh lolos sebagai token pemilih profil, dan
  // sebaliknya. Kalau tertukar, orang bisa melewati pemilihan profil.
  const sesi = await buatToken({ id: 1, username: "x", nama: "x", departemen: "marketing",
    peran: "staf", idEmployee: null, admin: false });
  cek((await bacaTokenPilihProfil(sesi)) === null, "token SESI ditolak sebagai token pemilih");
}


console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await poolLoginPerusahaan().end();
process.exit(gagal.length === 0 ? 0 : 1);
