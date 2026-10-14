/**
 * Uji pembuatan tool baru dari layar pengaturan.
 *
 *   npm run test:buat-tool
 *
 * ⚠️ MEMBUAT BARIS SUNGGUHAN di `ai_tool`, lalu MENGHAPUSNYA di `finally` —
 * termasuk kalau ujinya gagal di tengah. Jumlah baris dihitung sebelum dan
 * sesudah untuk membuktikan tidak ada sisa.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. tool buatan layar SELALU `jenis=konfigurasi` + `operasi=baca` —
 *      dijamin DATABASE, bukan oleh validasi kita. Role `ai_konfig` tidak
 *      punya hak INSERT pada kolom yang menentukan sebaliknya, jadi penjagaan
 *      ini tetap berdiri walau seluruh `buatTool()` salah;
 *   2. cakupan yang kolom penyaringnya tidak ada ditolak;
 *   3. kode yang tidak sah dan kode kembar ditolak sebelum menyentuh database;
 *   4. `id_apps` diambil dari sumbernya, bukan dari pengirim — itu yang
 *      menentukan agent mana memakainya.
 */
import { buatTool, sumberPilihan, type ToolBaru } from "../lib/ubah-tool.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { poolKonfig } from "../lib/db-konfig.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const KODE = "uji_tool_sementara";
const baca = poolPerusahaan();
const sebelum = ((await baca.query<{ n: number }>(`SELECT count(*)::int n FROM ai_tool`)).rows[0]).n;
console.log(`sebelum: ${sebelum} tool\n`);

try {
  // ============================================================
  console.log("=== 1. Sumber dan pilihannya ===");
  // ============================================================
  const sumber = await sumberPilihan();
  console.log(`  ${sumber.length} sumber tersedia`);
  const tiket = sumber.find((s) => s.kode === "asisten_tiket")!;
  const klaim = sumber.find((s) => s.kode === "asisten_klaim")!;
  cek("sumber bertanya kolom_employee menawarkan cakupan diri", tiket.cakupanBisa.includes("diri"));
  cek("sumber tanpa kolom_employee TIDAK menawarkannya", !klaim.cakupanBisa.includes("diri"),
    klaim.cakupanBisa.join(", "));

  // ============================================================
  console.log("\n=== 2. Masukan yang tidak sah ditolak ===");
  // ============================================================
  const dasar = {
    nama: "Uji tool sementara",
    deskripsi: "Tool uji yang dibuat skrip pengujian dan dihapus lagi.",
    sumber: "asisten_tiket",
    kolom: ["no_ticket", "judul"],
    cakupan: "diri" as const,
    batas: 10,
    urut: null,
    contoh: null,
  };
  // Tanpa `as const`: array readonly membuat `kolom: []` tidak cocok dengan
  // `string[]`, dan typecheck menolaknya walau ujinya jalan.
  const buruk: [string, Partial<ToolBaru>][] = [
    ["kode dengan huruf besar", { kode: "UjiTool" }],
    ["kode terlalu pendek", { kode: "ab" }],
    ["kode dengan spasi", { kode: "uji tool" }],
    ["deskripsi terlalu pendek", { kode: KODE, deskripsi: "pendek" }],
    ["kolom kosong", { kode: KODE, kolom: [] }],
    ["kolom asing", { kode: KODE, kolom: ["no_ticket", "password"] }],
    ["batas di luar 1..200", { kode: KODE, batas: 5000 }],
    ["sumber tidak terdaftar", { kode: KODE, sumber: "tidak_ada" }],
    ["urut di luar kolom yang dibaca", { kode: KODE, urut: "prioritas" }],
  ];
  for (const [nama, ubah] of buruk) {
    // `kode` ikut di tiap `ubah`, jadi tidak disebut dua kali di sini.
    const r = await buatTool({ ...dasar, kode: KODE, ...ubah } as ToolBaru);
    cek(`${nama} ditolak`, !r.ok, r.ok ? "MALAH DIBUAT" : r.sebab.slice(0, 52));
  }

  const cakupanSalah = await buatTool({ ...dasar, kode: KODE, sumber: "asisten_klaim", kolom: ["no_klaim"], cakupan: "diri" });
  cek("cakupan tanpa kolom penyaring ditolak", !cakupanSalah.ok,
    cakupanSalah.ok ? "MALAH DIBUAT" : cakupanSalah.sebab.slice(0, 60));

  const belumAda = ((await baca.query<{ n: number }>(
    `SELECT count(*)::int n FROM ai_tool WHERE kode = $1`, [KODE])).rows[0]).n;
  cek("tidak satu pun yang ditolak menyentuh database", belumAda === 0);

  // ============================================================
  console.log("\n=== 3. Pembuatan yang sah ===");
  // ============================================================
  const buat = await buatTool({ ...dasar, kode: KODE });
  cek("tool dibuat", buat.ok, buat.ok ? "" : buat.sebab);

  const [baris] = (await baca.query<{
    jenis: string; operasi: string; tabel_target: string | null; penangan: string | null;
    is_active: boolean; updated_by: string; cakupan_bawaan: string; id_apps: string;
    kolom: string[]; batas: number;
  }>(`SELECT jenis, operasi, tabel_target, penangan, is_active, updated_by,
             cakupan_bawaan, id_apps, kolom, batas FROM ai_tool WHERE kode = $1`, [KODE])).rows;

  // ⚠️ INI PEMERIKSAAN PALING PENTING DI BERKAS INI.
  cek("jenis = konfigurasi (bawaan database)", baris.jenis === "konfigurasi", baris.jenis);
  cek("operasi = baca (bawaan database)", baris.operasi === "baca", baris.operasi);
  cek("tabel_target kosong — tidak bisa menulis", baris.tabel_target === null);
  cek("penangan kosong — bukan tool berjenis kode", baris.penangan === null);
  cek("is_active = false — sistem tim lain tidak mengambilnya", baris.is_active === false);
  cek("ditandai milik portal ini", baris.updated_by === "magang", baris.updated_by);
  cek("cakupan tersimpan", baris.cakupan_bawaan === "diri", baris.cakupan_bawaan);
  cek("kolom tersimpan", baris.kolom.join(",") === "no_ticket,judul", baris.kolom.join(","));
  cek("batas tersimpan", baris.batas === 10, String(baris.batas));

  // `id_apps` diambil dari sumbernya, bukan dari pengirim.
  const [sum] = (await baca.query<{ id_apps: string }>(
    `SELECT id_apps FROM ai_sumber_data WHERE kode = 'asisten_tiket'`)).rows;
  cek("id_apps ikut sumbernya, bukan dari borang", baris.id_apps === sum.id_apps);

  const kembar = await buatTool({ ...dasar, kode: KODE });
  cek("kode kembar ditolak", !kembar.ok, kembar.ok ? "MALAH DIBUAT" : kembar.sebab.slice(0, 44));

  // ============================================================
  console.log("\n=== 4. Database menolak membuat tool tulis ===");
  // ============================================================
  // Lapis ini harus berdiri WALAU `buatTool()` seluruhnya salah, jadi diuji
  // dengan menembak pool role itu langsung.
  for (const kolom of ["jenis", "operasi", "tabel_target", "penangan"]) {
    let ditolak = false;
    let pesan = "";
    try {
      await poolKonfig().query(
        `INSERT INTO ai_tool (kode, nama, deskripsi, ${kolom}) VALUES ($1, 'x', 'xxxxxxxxxxxxxxxx', $2)`,
        [`uji_bocor_${kolom}`, kolom === "operasi" ? "tambah" : "x"],
      );
    } catch (e) {
      ditolak = true;
      pesan = (e as Error).message.slice(0, 44);
    }
    cek(`INSERT yang mengisi ${kolom} ditolak database`, ditolak, pesan || "MALAH BERHASIL");
  }

  // ============================================================
  console.log("\n=== 5. Tool baru langsung terbaca pembaca konfigurasi ===");
  // ============================================================
  lupakanKonfig();
  const k = await muatKonfig();
  const semua = [...k.agent.flatMap((a) => a.tool), ...k.lepas];
  const baru = semua.find((t) => t.kode === KODE);
  cek("tool baru ikut terbaca", Boolean(baru));
  cek("menempel ke agent Portal lewat id_apps",
    k.agent.some((a) => a.kode === "agent-portal" && a.tool.some((t) => t.kode === KODE)));
} finally {
  // ⚠️ SELALU dibersihkan. `ai_konfig` sengaja tidak punya DELETE, jadi
  // pembersihan memakai kredensial admin — sama seperti skrip pendaftaran.
  const { Client } = await import("pg");
  const adm = new Client({
    host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
    database: process.env.DEMO_PG_DATABASE,
    user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
  });
  await adm.connect();
  await adm.query(`DELETE FROM ai_tool WHERE kode LIKE 'uji_%' AND updated_by IS NOT DISTINCT FROM 'magang'`);
  await adm.query(`DELETE FROM ai_tool WHERE kode LIKE 'uji_bocor_%'`);
  const sesudah = ((await adm.query<{ n: number }>(`SELECT count(*)::int n FROM ai_tool`)).rows[0]).n;
  console.log(`\nsesudah: ${sesudah} tool`);
  cek("tidak ada baris uji yang tertinggal", sesudah === sebelum);
  await adm.end();
  lupakanKonfig();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
