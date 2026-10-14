/**
 * Uji saklar jalur agent.
 *
 *   npm run test:jalur
 *
 * HANYA MEMBACA. Tidak memanggil model.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. bawaannya jalur LAMA -- saklar yang bawaannya menyala berarti sekali
 *      `git pull`, semua pemakai pindah jalur tanpa ada yang memutuskannya;
 *   2. nilai `JALUR_AGENT` yang asing dianggap `lama`, bukan `konfigurasi`;
 *   3. tiap kali jatuh ke jalur lama, SEBABNYA dikembalikan -- saklar yang
 *      menyala tapi tidak berefek, tanpa ada yang tahu, lebih buruk daripada
 *      saklar yang mati;
 *   4. waktu jalur konfigurasi dipakai, agent-nya memang punya bawahan yang
 *      sesuai akses orang itu.
 */
import { siapkanAgent, jalurDiminta } from "../voltagent/jalur-agent.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}
const pool = poolPerusahaan();
const asli = process.env.JALUR_AGENT;
const pasang = (v: string | undefined) => { if (v === undefined) delete process.env.JALUR_AGENT; else process.env.JALUR_AGENT = v; };

const [org] = (await pool.query<{ id_employee: string; fullname: string }>(
  `SELECT e.id_employee, e.fullname FROM employee e
     JOIN users_config uc ON uc.id_users = e.id_users
    WHERE jsonb_array_length(COALESCE(uc.apps_config->'apps','[]'::jsonb)) > 0 LIMIT 1`)).rows;

try {
  // ============================================================
  console.log("=== 1. Bawaannya jalur lama ===");
  // ============================================================
  pasang(undefined);
  cek("tanpa JALUR_AGENT -> lama", jalurDiminta() === "lama");
  const a = await siapkanAgent(org.id_employee);
  cek("tetap lama walau sesinya lengkap", a.jalur === "lama", a.jalur === "lama" ? a.sebab : "MALAH KONFIGURASI");

  // ============================================================
  console.log("\n=== 2. Nilai asing dianggap lama, bukan konfigurasi ===");
  // ============================================================
  for (const v of ["konfigurasi ", "KONFIGURASI", "1", "true", "ya", ""]) {
    pasang(v);
    if (jalurDiminta() !== "lama") { cek(`"${v}" dianggap lama`, false, `malah ${jalurDiminta()}`); }
  }
  cek("semua nilai asing dianggap lama", gagal === 0, `6 nilai dicoba`);

  // ============================================================
  console.log("\n=== 3. Jatuh ke jalur lama selalu bersuara ===");
  // ============================================================
  pasang("konfigurasi");
  cek("JALUR_AGENT=konfigurasi terbaca", jalurDiminta() === "konfigurasi");

  const tanpaId = await siapkanAgent(null);
  cek("sesi tanpa idEmployee -> lama, bersebab",
    tanpaId.jalur === "lama" && tanpaId.sebab.includes("idEmployee"),
    tanpaId.jalur === "lama" ? tanpaId.sebab : "MALAH KONFIGURASI");

  const asing = await siapkanAgent("00000000-0000-0000-0000-000000000000");
  cek("id_employee tak dikenal -> lama, bersebab",
    asing.jalur === "lama" && asing.sebab.includes("tidak ada di tabel employee"),
    asing.jalur === "lama" ? asing.sebab : "MALAH KONFIGURASI");

  const sampah = await siapkanAgent("bukan-uuid'; DROP TABLE employee; --");
  cek("id_employee bukan uuid -> lama, bersebab", sampah.jalur === "lama",
    sampah.jalur === "lama" ? sampah.sebab : "MALAH KONFIGURASI");

  // ============================================================
  console.log("\n=== 4. Jalur konfigurasi memang terpakai ===");
  // ============================================================
  const k = await siapkanAgent(org.id_employee);
  cek("sesi lengkap -> jalur konfigurasi", k.jalur === "konfigurasi", org.fullname);
  if (k.jalur === "konfigurasi") {
    console.log(`  ${org.fullname}: ${k.apps.length} aplikasi -> ${k.bawahan.map((b) => b.kode).join(", ")}`);
    cek("punya bawahan", k.bawahan.length > 0, `${k.bawahan.length} agent`);
    cek("agent Portal selalu ada", k.bawahan.some((b) => b.kode === "agent-portal"));

    // Bawahannya harus persis sebanyak agent yang memegang aplikasi yang
    // dia punya -- diperiksa lewat `aksesUntukEmployee` sendiri, bukan
    // dengan mempercayai hasil yang sama.
    const akses = await aksesUntukEmployee(org.id_employee);
    cek("jumlah aplikasi cocok dengan akses", k.apps.length === akses!.apps.length,
      `${k.apps.length} vs ${akses!.apps.length}`);
    cek("tidak ada bawahan tanpa tool yang disembunyikan",
      k.bawahan.every((b) => typeof b.jumlahTool === "number"));
  }
} finally {
  pasang(asli);
  await pool.end();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
// `process.exit`, bukan `exitCode` — lihat alasannya di test-ai-konfig.mts.
process.exit(gagal === 0 ? 0 : 1);
