/**
 * Uji pembaca konfigurasi agent & tool.
 *
 *   npm run test:konfig
 *
 * HANYA MEMBACA. Tidak menulis apa pun ke schema siapa pun.
 *
 * ============================================================
 * KENAPA UJI INI ADA
 * ============================================================
 * `lib/ai-konfig.ts` berdiri di antara dua hal yang sama-sama bisa berubah
 * tanpa kita tahu: baris konfigurasi yang ditulis Admin Console tim lain, dan
 * view yang kolomnya bisa diubah siapa pun yang punya akses admin.
 *
 * Yang diperiksa di sini BUKAN "fungsinya mengembalikan objek", tapi dua hal
 * yang kalau salah tidak menimbulkan galat sama sekali:
 *
 *   1. tiap kolom yang diizinkan tool benar-benar ada di view-nya -- kalau
 *      tidak, query gagal di depan user;
 *   2. tiap tool bercakupan selain `semua` punya kolom penyaring yang NYATA
 *      ADA di view-nya -- kalau tidak, query jalan mulus tanpa WHERE dan
 *      membaca data semua orang.
 *
 * Nomor 2 itu alasan utama berkas ini ada. Dia tidak akan pernah muncul
 * sebagai error di log.
 */
import { sambunganTool } from "../lib/sambung-tool.ts";
import { muatKonfig, lupakanKonfig, agentUmum, agentUntukApp } from "../lib/ai-konfig.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

const SUPERTOOLS_MOBILE = "42a61687-0ad4-4565-bba8-a8b357c0313d";
const SUPERTOOLS = "ea3795c2-52e4-467e-a314-0dc1c140427d";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

// ============================================================
console.log("=== 1. Konfigurasi terbaca dari database ===");
// ============================================================
const pool = poolPerusahaan();
const k = await muatKonfig();
cek("agent terbaca", k.agent.length > 0, `${k.agent.length} agent`);
cek("ada agent pintu masuk", k.agent.some((a) => a.umum), k.agent.find((a) => a.umum)?.kode ?? "-");

const berTool = k.agent.filter((a) => a.tool.length > 0);
console.log(`\n  agent dan tool tersambungnya:`);
for (const a of k.agent) {
  console.log(`    ${a.kode.padEnd(18)} ${a.aktif ? "aktif " : "mati  "} ${a.tool.length} tool  ${a.tool.map((t) => t.kode).join(", ")}`);
}
cek("ada agent yang punya tool", berTool.length > 0, `${berTool.length} agent`);

// ⚠️ PENJAGA REGRESI, bukan uji formalitas.
//
// Versi pertama `ai-konfig.ts` menolak tiap tool yang `kolom`-nya kosong.
// Untuk operasi TULIS itu wajar -- dia tidak membaca kolom -- jadi ketiga
// tool tulis Portal terbuang diam-diam, dan agent Portal yang seharusnya
// punya 5 tool cuma punya 2. Tidak ada galat, tidak ada yang kelihatan
// kecuali kalau jumlahnya dihitung.
// ⚠️ "TERBUANG" BERBEDA DARI "DILEPAS", dan ujinya harus tahu bedanya.
//
// Tool tim lain bisa SENGAJA dilepas dari agent lewat layar Kelola AI —
// barisnya tetap utuh di database mereka, cuma tidak dipasang portal ini.
// Tanpa pembedaan ini, pelepasan yang benar terbaca sebagai tool yang hilang
// diam-diam, dan uji ini menghukum pemakaian fitur yang memang disediakan.
const { lepas: dilepas } = await sambunganTool();
const dilepasPortal = new Set(
  dilepas.filter((x) => x.agentKode === "agent-portal").map((x) => x.toolKode),
);
if (dilepasPortal.size > 0) {
  console.log(`  sengaja dilepas dari agent-portal: ${[...dilepasPortal].join(", ")}`);
}

const portal = k.agent.find((a) => a.kode === "agent-portal");
const tulis = (portal?.tool ?? []).filter((t) => t.operasi !== "baca");
// ⚠️ YANG DIPERIKSA SIFATNYA, BUKAN JUMLAHNYA.
//
// Versi pertama menuntut tepat 3 tool tulis. Begitu administrator menambah
// tool tulis sendiri dari layar Kelola AI -- justru tujuan fitur itu -- ujinya
// merah tanpa ada yang rusak. Uji yang menanam inventaris saat itu menghukum
// pemakaian yang benar.
//
// Yang benar-benar perlu dijaga: tool tulis TIDAK HILANG dari agent. Jadi
// dibandingkan dengan jumlah tool tulis yang memang terdaftar untuk agent itu
// di `ai_tool`, bukan dengan angka yang ditulis tangan.
const { rows: tulisTerdaftar } = await pool.query<{ kode: string }>(
  `SELECT t.kode FROM ai_tool t
     JOIN ai_agent_tool at ON at.id_ai_tool = t.id_ai_tool
     JOIN ai_agent a ON a.id_ai_agent = at.id_ai_agent AND a.kode = 'agent-portal'
    WHERE t.operasi <> 'baca' AND t.is_active
   UNION
   SELECT t.kode FROM ai_tool t
    WHERE t.operasi <> 'baca' AND t.updated_by = 'magang'`,
);
const hilang = tulisTerdaftar
  .map((r) => r.kode)
  .filter((kode) => !tulis.some((t) => t.kode === kode) && !dilepasPortal.has(kode));
cek("tool tulis Portal tidak terbuang", hilang.length === 0,
  hilang.length === 0
    ? `${tulis.length} terpasang: ${tulis.map((t) => `${t.kode}(${t.operasi})`).join(", ")}`
    : `HILANG: ${hilang.join(", ")}`);
cek("tool tulis menyebut tabel sasaran", tulis.every((t) => Boolean(t.tabelTarget)),
  [...new Set(tulis.map((t) => t.tabelTarget))].join(", ") || "-");
cek("tool tulis punya kolom isian atau kunci", tulis.every((t) => t.isian.length > 0 || t.kunci.length > 0));

// ============================================================
console.log("");
console.log("=== 2. Tool kita dipakai, tapi tabel bersama tidak disentuh ===");
// ============================================================
// Rancangan ini BERUBAH 7 Okt 2026. Sebelumnya tool `asisten_*` sengaja
// dibiarkan lepas, dan uji di sini menuntut itu. Sekarang dia dipasang lewat
// kecocokan `id_apps` + `tabel_asal` -- membiarkannya lepas berarti agent
// terus membaca data satu perusahaan padahal penggantinya sudah ada.
//
// Yang TIDAK berubah, dan itu intinya: `ai_agent_tool` milik mereka tetap
// tidak disentuh. Kalau suatu hari baris kita muncul di sana, sistem mereka
// ikut berubah dari sisi kita tanpa mereka tahu.
const dipakaiAgent = new Set(k.agent.flatMap((a) => a.tool.map((t) => t.kode)));
const punyaKita = [...dipakaiAgent].filter((x) => x.startsWith("asisten_"));
console.log(`  terpasang: ${punyaKita.join(", ") || "(tidak ada)"}`);
cek("tool asisten_* benar-benar dipakai agent", punyaKita.length > 0, `${punyaKita.length} tool`);

const diTabelMereka = (await pool.query<{ kode: string }>(
  `SELECT t.kode FROM ai_agent_tool at JOIN ai_tool t ON t.id_ai_tool = at.id_ai_tool
    WHERE t.updated_by = 'magang'`)).rows.map((r) => r.kode);
cek("tidak ada baris kita di ai_agent_tool mereka", diTabelMereka.length === 0,
  diTabelMereka.join(", ") || "bersih");

const aktifDiDb = (await pool.query<{ n: number }>(
  `SELECT count(*)::int n FROM ai_tool WHERE updated_by = 'magang' AND is_active`)).rows[0].n;
cek("tool kita tetap is_active=false di database", aktifDiDb === 0, `${aktifDiDb} aktif`);
// ============================================================
console.log("\n=== 3. apps_lain ikut dipetakan ===");
// ============================================================
const mobile = await agentUntukApp(SUPERTOOLS_MOBILE);
cek("Supertools Mobile menemukan agent lewat apps_lain", mobile?.kode === "agent-supertools", mobile?.kode ?? "tidak ketemu");
const utama = await agentUntukApp(SUPERTOOLS);
cek("Super Tools menemukan agent lewat id_apps", utama?.kode === "agent-supertools", utama?.kode ?? "tidak ketemu");
const umum = await agentUmum();
cek("agent umum tidak ikut terpilih untuk aplikasi", mobile?.umum === false && umum?.umum === true);

// ============================================================
console.log("\n=== 4. Tiap kolom yang diizinkan BENAR-BENAR ada di view ===");
// ============================================================
// Diperiksa ulang di sini dengan query sendiri, bukan dengan memanggil fungsi
// yang sama -- uji yang memakai logika yang diujinya tidak membuktikan apa pun.
const semuaTool = [...k.agent.flatMap((a) => a.tool), ...k.lepas].filter((t) => t.jenis === "konfigurasi");
let kolomSalah = 0;
let penyaringSalah = 0;
for (const t of semuaTool) {
  if (!t.sumber) { kolomSalah++; continue; }
  const ada = new Set((await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [t.sumber.view])).rows.map((r) => r.column_name));

  const perlu = [
    ...t.kolom,
    ...t.filter.map((f) => f.kolom),
    ...t.kunci.map((x) => x.kolom),
    t.urut.kolom,
  ].filter(Boolean) as string[];
  const hilang = perlu.filter((c) => !ada.has(c));
  if (hilang.length > 0) { kolomSalah++; console.log(`    ${t.kode}: kolom hilang ${hilang.join(", ")}`); }

  if (t.cakupan !== "semua") {
    const kol = t.cakupan === "departemen" ? t.sumber.penyaring.departemen
      : t.cakupan === "perusahaan" ? t.sumber.penyaring.perusahaan
      : t.sumber.penyaring.employee;
    if (!kol || !ada.has(kol)) { penyaringSalah++; console.log(`    ${t.kode}: cakupan ${t.cakupan} tanpa kolom penyaring nyata`); }
  }
}
cek("semua kolom tool ada di view-nya", kolomSalah === 0, `${semuaTool.length} tool diperiksa`);
cek("semua tool bercakupan sempit punya kolom penyaring nyata", penyaringSalah === 0);

// ============================================================
console.log("\n=== 5. Tool yang tidak lolos dibuang, tapi kelihatan ===");
// ============================================================
console.log(`  masalah: ${k.masalah.length}`);
for (const m of k.masalah) console.log(`    ${m.tool}: ${m.sebab}`);
// Tidak diharuskan nol: konfigurasi milik tim lain boleh saja cacat, dan yang
// penting adalah kita MELIHATNYA, bukan menuntut mereka rapi. Yang dilarang
// adalah tool bermasalah tetap ikut terpakai.
const kodeBermasalah = new Set(k.masalah.map((m) => m.tool));
const lolosDiam = [...k.agent.flatMap((a) => a.tool), ...k.lepas].filter((t) => kodeBermasalah.has(t.kode));
cek("tool bermasalah tidak ikut dipakai", lolosDiam.length === 0, lolosDiam.map((t) => t.kode).join(", ") || "bersih");

// ============================================================
console.log("\n=== 6. Singgahan menahan query, dan bisa dilupakan ===");
// ============================================================
const a1 = await muatKonfig();
const a2 = await muatKonfig();
cek("panggilan kedua memakai singgahan", a1 === a2);
lupakanKonfig();
const a3 = await muatKonfig();
cek("lupakanKonfig() memaksa baca ulang", a3 !== a1 && a3.agent.length === a1.agent.length);

// Dibaca bersamaan: 5 permintaan sekaligus harus jadi SATU pembacaan.
lupakanKonfig();
const bareng = await Promise.all([muatKonfig(), muatKonfig(), muatKonfig(), muatKonfig(), muatKonfig()]);
cek("permintaan bersamaan digabung jadi satu", bareng.every((x) => x === bareng[0]));

// ============================================================
console.log("");
console.log("=== 7. Tool portal menggantikan tool bercakupan luas ===");
// ============================================================
// ⚠️ Aturan ini hidup di KODE, bukan di `ai_agent_tool` -- tabel itu dibaca
// juga sistem mereka yang sedang dipakai orang. Karena hidup di kode, dia
// bisa lepas tanpa galat apa pun: yang terjadi cuma agent kembali membaca
// data satu perusahaan, dan tidak ada yang menandainya.
console.log(`  penggantian: ${k.gantian.length}`);
for (const g of k.gantian) console.log(`    ${g.agent}: ${g.dipakai} <- ${g.menggantikan.join(", ") || "(tidak ada)"}`);
cek("ada penggantian yang tercatat", k.gantian.length > 0, `${k.gantian.length} agent`);

// Pelepasan sadar dari layar Kelola AI, per agent. Dipakai kedua blok di
// bawah: tool yang hilang karena DILEPAS bukan tool yang hilang diam-diam,
// dan uji yang tidak membedakannya menghukum pemakaian fitur yang benar.
const dilepasPer = new Map<string, Set<string>>();
for (const x of dilepas) {
  if (!dilepasPer.has(x.agentKode)) dilepasPer.set(x.agentKode, new Set());
  dilepasPer.get(x.agentKode)!.add(x.toolKode);
}

// ⚠️ SEBAB KETIGA SEBUAH TOOL BOLEH HILANG, dan versi pertama pemeriksaan ini
// melupakannya: DIBUANG PEMERIKSA. Tujuh tool mereka ditolak `ai-konfig.ts`
// karena cakupannya `diri` sementara sumbernya tidak punya kolom penyaringnya
// — penolakan yang benar, dan justru alasan utama pembaca konfigurasi ada.
//
// Hilangnya tidak diam: sebabnya tercatat di `k.masalah` dan dicetak bagian 5.
// Jadi yang dijaga di sini bukan "tidak ada tool yang hilang", tapi "tiap tool
// yang hilang punya sebab yang KELIHATAN" — dilepas, digantikan, atau ditolak.
const ditolak = new Set(k.masalah.map((m) => m.tool));

// ⚠️ DITULIS ULANG 13 Okt 2026, DAN SEBABNYA LAYAK DICATAT.
//
// Versi sebelumnya menyebut nama: `sim_aset_karyawan digantikan asisten_aset`,
// `sim_departemen tidak ikut terbuang`, dan seterusnya. Semuanya benar waktu
// ditulis.
//
// Lalu tim lain membangun ulang katalog tool mereka dalam sehari (13 Okt 2026:
// 140 baris baru, seluruh `sim_*` hilang, `agent-portal` dari 9 jadi 21 tool).
// Lima uji jadi merah sekaligus — dan tidak satu pun karena ada yang rusak.
// Yang rusak ujinya: dia menanam inventaris sebelah, lalu menghukum sebelah
// karena mengubah inventarisnya sendiri.
//
// Jadi yang diperiksa sekarang SIFAT aturannya, bukan nama tool yang kebetulan
// ada. Sifatnya satu kalimat: tool mereka hilang dari sebuah agent HANYA
// kalau tool kita membaca tabel yang sama. Itu persis kekeliruan yang pernah
// terjadi (`agent-hr` kehilangan `sim_permintaan_rekrutmen`, `agent-admin`
// kehilangan `sim_departemen`), dan satu-satunya yang perlu dijaga.
{
  // Apa yang SEBENARNYA terpaut di `ai_agent_tool`, langsung dari database —
  // bukan dari hasil pembaca konfigurasi, karena hasil itu yang sedang diuji.
  const { rows: paut } = await pool.query<{
    agent: string; kode: string; operasi: string; tabel_asal: string | null; pemilik: string | null;
  }>(
    `SELECT a.kode AS agent, t.kode, t.operasi, s.tabel_asal, t.updated_by AS pemilik
       FROM ai_agent_tool at
       JOIN ai_agent a ON a.id_ai_agent = at.id_ai_agent
       JOIN ai_tool  t ON t.id_ai_tool  = at.id_ai_tool
       LEFT JOIN ai_sumber_data s ON s.id_ai_sumber_data = t.id_ai_sumber_data
      WHERE t.is_active`,
  );


  let diperiksa = 0;
  const salah: string[] = [];
  for (const a of k.agent) {
    const terpasang = new Set(a.tool.map((t) => t.kode));
    // Tabel yang dibaca tool KITA di agent ini — satu-satunya alasan sah
    // sebuah tool mereka boleh hilang.
    const tabelKita = new Set(
      a.tool.filter((t) => t.pemilik === "magang").map((t) => t.sumber?.tabelAsal).filter(Boolean) as string[],
    );
    const dilepas = dilepasPer.get(a.kode) ?? new Set<string>();

    for (const p of paut.filter((x) => x.agent === a.kode)) {
      if (terpasang.has(p.kode)) continue;       // masih ada, tidak ada yang hilang
      if (dilepas.has(p.kode)) continue;         // dilepas SENGAJA dari layar Kelola AI
      if (ditolak.has(p.kode)) continue;         // ditolak pemeriksa, sebabnya tercatat di k.masalah
      diperiksa++;
      // Hilang tanpa dilepas -> harus karena digantikan, dan penggantian cuma
      // sah untuk tool BACA atas tabel yang sama.
      if (p.operasi !== "baca") {
        salah.push(`${a.kode}/${p.kode}: tool TULIS hilang — penggantian tidak pernah boleh membuang tool tulis`);
      } else if (!p.tabel_asal) {
        salah.push(`${a.kode}/${p.kode}: hilang padahal sumbernya tidak punya tabel_asal — tidak ada yang bisa menggantikannya`);
      } else if (!tabelKita.has(p.tabel_asal)) {
        salah.push(`${a.kode}/${p.kode}: hilang padahal tak ada tool kita yang membaca ${p.tabel_asal}`);
      }
    }
  }
  cek("tool mereka hilang HANYA kalau tool kita membaca tabel yang sama",
    salah.length === 0,
    salah.length === 0 ? `${diperiksa} penggantian diperiksa` : salah.join(" | "));

  // Sisi lain dari aturan yang sama: tiap penggantian yang DICATAT harus benar
  // -- yang digantikan memang hilang, dan penggantinya memang ada. Catatan
  // yang menyebut penggantian yang tidak terjadi sama buruknya dengan
  // penggantian yang tidak dicatat.
  const bohong: string[] = [];
  for (const g of k.gantian) {
    const a = k.agent.find((x) => x.kode === g.agent);
    const terpasang = new Set(a?.tool.map((t) => t.kode) ?? []);
    for (const m of g.menggantikan) {
      if (terpasang.has(m)) bohong.push(`${g.agent}: ${m} dicatat digantikan tapi masih terpasang`);
    }
    for (const d of g.dipakai.split(", ").filter(Boolean)) {
      if (!terpasang.has(d)) bohong.push(`${g.agent}: ${d} dicatat sebagai pengganti tapi tidak terpasang`);
    }
  }
  cek("catatan penggantian cocok dengan keadaan sebenarnya", bohong.length === 0,
    bohong.length === 0 ? `${k.gantian.length} agent` : bohong.join(" | "));
}

// Tool tulis juga harus bertahan: kita belum punya penggantinya, dan
// membuangnya menyembunyikan bahwa agent itu sebenarnya bisa menulis.
//
// ⚠️ DAFTARNYA DARI DATABASE, BUKAN DARI NAMA YANG DITULIS TANGAN. Versi
// sebelumnya menyebut `buat_tiket, ubah_tiket, batalkan_tiket`; `ubah_tiket`
// sudah tidak ada di katalog mereka sejak 13 Okt 2026, dan uji yang menuntut
// namanya akan merah selamanya tanpa ada yang rusak. Pemeriksaannya sudah
// dilakukan di bagian 1 ("tool tulis Portal tidak terbuang") dengan sumber
// yang benar; yang di sini cuma memastikan agent lain ikut terjaga.
{
  const { rows: tulisLain } = await pool.query<{ agent: string; kode: string }>(
    `SELECT a.kode AS agent, t.kode
       FROM ai_agent_tool at
       JOIN ai_agent a ON a.id_ai_agent = at.id_ai_agent
       JOIN ai_tool  t ON t.id_ai_tool  = at.id_ai_tool
      WHERE t.is_active AND t.operasi <> 'baca'`,
  );
  const hilangTulis: string[] = [];
  for (const r of tulisLain) {
    const a = k.agent.find((x) => x.kode === r.agent);
    if (!a) continue;
    if (a.tool.some((t) => t.kode === r.kode)) continue;
    if ((dilepasPer.get(r.agent) ?? new Set()).has(r.kode)) continue;
    if (ditolak.has(r.kode)) continue; // ditolak pemeriksa — sebabnya tercatat, bukan hilang diam-diam
    hilangTulis.push(`${r.agent}/${r.kode}`);
  }
  cek("tool tulis mereka tidak terbuang dari agent mana pun", hilangTulis.length === 0,
    hilangTulis.length === 0 ? `${tulisLain.length} tool tulis terpaut` : `HILANG: ${hilangTulis.join(", ")}`);
}

await pool.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
// ⚠️ `process.exit`, bukan `exitCode`. Sejak `muatKonfig()` ikut membaca
// `ai_tool_agent` di MySQL, pool-nya menahan event loop tetap hidup dan
// skrip ini mencetak hasilnya lalu MENGGANTUNG — lolos tapi tidak pernah
// selesai, yang di CI terbaca sebagai uji yang macet.
process.exit(gagal === 0 ? 0 : 1);
