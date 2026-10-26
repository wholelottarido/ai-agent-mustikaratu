/**
 * Uji pembuatan tool TULIS dari layar pengaturan.
 *
 *   npm run test:tool-tulis
 *
 * ⚠️ MEMBUAT BARIS SUNGGUHAN di `ai_tool`, lalu MENGHAPUSNYA di `finally` —
 * termasuk kalau ujinya gagal di tengah.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. tool tulis buatan layar TETAP `jenis = konfigurasi` tanpa `penangan` —
 *      dijamin DATABASE. Ini satu-satunya jaminan yang tersisa setelah
 *      `operasi` dibuka, jadi ia yang paling penting;
 *   2. kunci WAJIB — tanpa kunci yang dirangkai UPDATE tanpa WHERE;
 *   3. kolom kunci tidak boleh ikut diubah — kalau boleh, model bisa
 *      memindahkan baris ke kunci lain dan menimpa baris orang;
 *   4. kolom yang role penulisnya tidak punya hak DITOLAK saat dibuat, bukan
 *      gagal belakangan waktu dipakai;
 *   5. tool yang dibuat benar-benar BISA DIJALANKAN penjalan umum.
 */
import { buatToolTulisBaru, targetTulis, type ToolTulisBaru } from "../lib/tool-tulis-baru.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { bacaKonfigTulis } from "../lib/entri/tulis-umum.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const KODE = "uji_tutup_tiket";
const baca = poolPerusahaan();
const sebelum = ((await baca.query<{ n: number }>(`SELECT count(*)::int n FROM ai_tool`)).rows[0]).n;

try {
  // ============================================================
  console.log("=== 1. Tabel sasaran yang ditawarkan borang ===");
  // ============================================================
  const target = await targetTulis();
  console.log(`  ${target.length} tabel: ${target.map((t) => `${t.tabel} (lewat ${t.sumber})`).join(", ")}`);
  cek("ada tabel yang bisa ditulis", target.length > 0);
  const tiket = target.find((t) => t.tabel === "portal_ticket");
  cek("portal_ticket ada", Boolean(tiket));
  if (!tiket) throw new Error("portal_ticket tidak ada di daftar target");

  // ⚠️ DUA HAK, BUKAN SATU (21 Okt 2026). `bisaIsi` = INSERT, `bisaUbah` =
  // UPDATE, dan daftarnya memang berbeda: `no_ticket` boleh diisi saat tiket
  // lahir tapi tidak boleh diubah sesudahnya.
  const bisaTulis = tiket.kolom.filter((k) => k.bisaUbah).map((k) => k.nama);
  const bisaIsi = tiket.kolom.filter((k) => k.bisaIsi).map((k) => k.nama);
  console.log(`  boleh DIUBAH : ${bisaTulis.join(", ")}`);
  console.log(`  boleh DIISI  : ${bisaIsi.join(", ")}`);
  cek("kolom yang boleh diubah dibaca dari hak database", bisaTulis.length > 0, `${bisaTulis.length} kolom`);
  cek("kolom yang boleh diisi dibaca dari hak database", bisaIsi.length > 0, `${bisaIsi.length} kolom`);
  // ⚠️ Kedua daftar harus BEDA. Kalau sama, hampir pasti keduanya dibaca dari
  // hak yang sama dan salah satunya bohong.
  cek("hak isi dan hak ubah memang berbeda",
    JSON.stringify(bisaIsi) !== JSON.stringify(bisaTulis),
    `isi ${bisaIsi.length}, ubah ${bisaTulis.length}`);
  // ⚠️ Kalau ini kosong, borang akan terlihat seolah tidak ada yang bisa diisi
  // — persis gejala waktu haknya dibaca lewat tampilan yang salah.
  cek("kolom TERLARANG tidak ikut ditawarkan",
    !bisaTulis.includes("id_employee") && !bisaTulis.includes("no_ticket"),
    bisaTulis.includes("id_employee") ? "id_employee BOCOR" : "bersih");

  const dasar: ToolTulisBaru = {
    kode: KODE,
    nama: "Uji tutup tiket",
    deskripsi: "Tool uji yang dibuat skrip pengujian dan dihapus lagi sesudahnya.",
    sumber: tiket.sumber,
    operasi: "hapus",
    kunci: [{ kolom: "no_ticket", label: "No. tiket" }],
    isian: [],
    otomatis: [{ kolom: "status", label: "Status baru", nilai: "CANCELLED" }],
    syarat: [{ kolom: "status", boleh: ["OPEN"] }],
    contoh: null,
  };

  // ============================================================
  console.log("\n=== 2. Konfigurasi berbahaya ditolak SAAT DIBUAT ===");
  // ============================================================
  const buruk: [string, Partial<ToolTulisBaru>][] = [
    ["tanpa kunci", { kunci: [] }],
    ["tanpa isian maupun nilai tetap", { isian: [], otomatis: [] }],
    ["kunci ikut diubah", { otomatis: [{ kolom: "no_ticket", label: "x", nilai: "y" }] }],
    ["kolom tidak ada di tabelnya", { otomatis: [{ kolom: "kolom_karangan", label: "x", nilai: "y" }] }],
    ["kolom yang tidak boleh ditulis", { otomatis: [{ kolom: "id_employee", label: "x", nilai: "y" }] }],
    ["operasi tambah (belum ada penjalannya)", { operasi: "tambah" as never }],
    ["sumber yang tidak mengarah ke tabel boleh", { sumber: "asisten_klaim" }],
    ["deskripsi terlalu pendek", { deskripsi: "pendek" }],
  ];
  for (const [nama, ubah] of buruk) {
    const r = await buatToolTulisBaru({ ...dasar, ...ubah });
    cek(`${nama} ditolak`, !r.ok, r.ok ? "MALAH DIBUAT" : r.sebab.slice(0, 58));
  }
  // ⚠️ KASUS KHUSUS, dan alasannya perlu ditulis.
  //
  // "kunci ikut diubah" di atas memang ditolak — tapi oleh pemeriksaan HAK
  // KOLOM, yang menyalip lebih dulu karena `no_ticket` kebetulan tidak boleh
  // ditulis. Artinya penjagaan bentrok-kunci itu sendiri tidak pernah
  // tercapai, dan uji yang tidak mencapai penjagaannya tidak menguji apa pun.
  //
  // Di sini kuncinya dipakai kolom yang BOLEH ditulis, supaya penolakan benar-
  // benar datang dari pemeriksaan yang dimaksud.
  const bentrokAsli = await buatToolTulisBaru({
    ...dasar,
    kunci: [{ kolom: "priority", label: "Prioritas" }],
    otomatis: [{ kolom: "priority", label: "Prioritas", nilai: "LOW" }],
  });
  cek("kunci yang BOLEH ditulis pun tidak boleh ikut diubah", !bentrokAsli.ok,
    bentrokAsli.ok ? "MALAH DIBUAT" : bentrokAsli.sebab.slice(0, 58));
  cek("penolakannya memang dari pemeriksaan bentrok, bukan hak kolom",
    !bentrokAsli.ok && bentrokAsli.sebab.includes("kunci tidak boleh ikut diubah"),
    bentrokAsli.ok ? "-" : bentrokAsli.sebab.slice(0, 50));

  const belum = ((await baca.query<{ n: number }>(
    `SELECT count(*)::int n FROM ai_tool WHERE kode = $1`, [KODE])).rows[0]).n;
  cek("tidak satu pun yang ditolak menyentuh database", belum === 0);

  // ============================================================
  console.log("\n=== 3. Pembuatan yang sah ===");
  // ============================================================
  const buat = await buatToolTulisBaru(dasar);
  cek("tool tulis dibuat dari layar", buat.ok, buat.ok ? "" : buat.sebab);

  const [baris] = (await baca.query<{
    jenis: string; operasi: string; tabel_target: string; penangan: string | null;
    is_active: boolean; updated_by: string; kolom_kunci: unknown; syarat: unknown;
  }>(`SELECT jenis, operasi, tabel_target, penangan, is_active, updated_by, kolom_kunci, syarat
        FROM ai_tool WHERE kode = $1`, [KODE])).rows;

  // ⚠️ DUA PEMERIKSAAN PALING PENTING DI BERKAS INI.
  cek("jenis TETAP konfigurasi — dijamin database", baris.jenis === "konfigurasi", baris.jenis);
  cek("penangan TETAP kosong — tidak bisa menunjuk fungsi", baris.penangan === null);

  cek("operasi tersimpan", baris.operasi === "hapus", baris.operasi);
  cek("tabel sasaran ikut sumbernya", baris.tabel_target === "portal_ticket", baris.tabel_target);
  cek("lahir tidak aktif", baris.is_active === false);
  cek("ditandai milik portal ini", baris.updated_by === "magang", baris.updated_by);

  const kembar = await buatToolTulisBaru(dasar);
  cek("kode kembar ditolak", !kembar.ok, kembar.ok ? "MALAH DIBUAT" : kembar.sebab.slice(0, 40));

  // ============================================================
  console.log("\n=== 4. Yang dibuat BISA dijalankan penjalan umum ===");
  // ============================================================
  // Tool yang tersimpan rapi tapi ditolak penjalannya adalah kegagalan yang
  // baru ketahuan waktu dipakai orang — justru yang paling mahal.
  lupakanKonfig();
  const k = await muatKonfig();
  const t = [...k.agent.flatMap((a) => a.tool), ...k.lepas].find((x) => x.kode === KODE);
  cek("tool baru terbaca pembaca konfigurasi", Boolean(t));
  if (t) {
    const siap = bacaKonfigTulis({
      kode: t.kode, operasi: t.operasi, tabelTarget: t.tabelTarget,
      isian: t.isian, otomatis: t.otomatis, kunci: t.kunci, syarat: t.syarat,
    });
    cek("penjalan umum menerima konfigurasinya", siap.ok, siap.ok ? "" : siap.sebab);
  }
} finally {
  // ⚠️ `ai_konfig` sengaja tidak punya DELETE, jadi pembersihan memakai
  // kredensial admin — sama seperti skrip pendaftaran.
  const { Client } = await import("pg");
  const adm = new Client({
    host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
    database: process.env.DEMO_PG_DATABASE,
    user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
  });
  await adm.connect();
  await adm.query(`DELETE FROM ai_tool WHERE kode = $1 AND updated_by = 'magang'`, [KODE]);
  const sesudah = ((await adm.query<{ n: number }>(`SELECT count(*)::int n FROM ai_tool`)).rows[0]).n;
  console.log(`\njumlah tool: ${sebelum} -> ${sesudah}`);
  cek("tidak ada baris uji yang tertinggal", sesudah === sebelum);
  await adm.end();
  lupakanKonfig();
  await baca.end();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
