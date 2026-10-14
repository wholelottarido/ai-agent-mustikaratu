/**
 * Uji pabrik agent dari konfigurasi.
 *
 *   npm run test:agent-konfig
 *
 * HANYA MEMBACA. Tidak memanggil model, jadi tidak ada biaya.
 *
 * ============================================================
 * YANG DIBUKTIKAN DI SINI
 * ============================================================
 * Yang diperiksa bukan "agent terbentuk", tapi hal-hal yang kalau salah
 * menghasilkan agent yang KELIHATAN bekerja:
 *
 *   1. aplikasi yang TIDAK diakses pemakai tidak jadi bawahan router sama
 *      sekali -- bukan jadi bawahan lalu dilarang lewat kalimat prompt;
 *   2. instruksi tidak pernah menyebut tool yang tidak terpasang, karena
 *      model akan memanggil nama yang tidak ada lalu kehabisan langkah;
 *   3. agent tanpa tool mengaku tidak punya tool, bukan diam-diam mengarang;
 *   4. dua pemakai menghasilkan agent yang berbeda -- kalau instance-nya
 *      dipakai ulang, penyaring orang pertama ikut terbawa ke orang kedua.
 */
import { muatKonfig } from "../lib/ai-konfig.ts";
import { buatAgentDariKonfig, buatRouter, agentAplikasi } from "../voltagent/agent-konfig.ts";
import type { SesiPemakai } from "../voltagent/tool-konfigurasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

const APP = {
  portal: "b1952feb-2114-4892-a8f9-fab1ccc17469",
  maps: "84480b32-4c93-46da-96c4-59ddf2308a5a",
  supertoolsMobile: "42a61687-0ad4-4565-bba8-a8b357c0313d",
  supertools: "ea3795c2-52e4-467e-a314-0dc1c140427d",
};

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const pool = poolPerusahaan();
const k = await muatKonfig();
// `izin` diisi supaya tool tiket ikut terakit — kalau tidak, bagian yang
// memeriksa nama tool tulis berhenti menguji apa pun.
const sesi = (id: string | null): SesiPemakai => ({ idEmployee: id, idDepartment: null, idCompany: null, idUsers: null, departemen: null, izin: ["ticket:read"] });
const andi = sesi("11111111-1111-1111-1111-111111111111");

/** Instruksi agent dibangun per request lewat context — ini tiruannya. */
const ctx = (saluran = "web") => ({ context: new Map([["saluran", saluran]]) }) as never;
const bacaInstruksi = (a: { instructions: unknown }, saluran = "web"): string => {
  const i = a.instructions;
  return typeof i === "function" ? String((i as (x: unknown) => string)(ctx(saluran))) : String(i);
};

// ============================================================
console.log("=== 1. Agent aplikasi terbentuk dari konfigurasi ===");
// ============================================================
const portal = await agentAplikasi(APP.portal, andi);
cek("Portal punya agent", Boolean(portal), portal?.agent.name ?? "-");
const mobile = await agentAplikasi(APP.supertoolsMobile, andi);
cek("Supertools Mobile ikut lewat apps_lain", mobile?.agent.name === "Ratu AI Super Tools", mobile?.agent.name ?? "-");

// ============================================================
console.log("\n=== 2. Instruksi tidak menyebut tool yang tidak terpasang ===");
// ============================================================
// agent-portal punya 5 tool di konfigurasi, tapi 3 di antaranya operasi tulis
// yang belum bisa dirakit. Kalau instruksinya tetap menyebut `buat_tiket`,
// model akan memanggil nama yang tidak ada, gagal, lalu mencoba lagi sampai
// jatah langkahnya habis -- dan user melihat balasan kosong.
const teks = bacaInstruksi(portal!.agent);
const tidakDirakit = portal!.dilewati.map((d) => d.kode);
const disebutSalah = tidakDirakit.filter((kode) => teks.includes(`\`${kode}\``));
console.log(`  tidak dirakit: ${tidakDirakit.join(", ")}`);
cek("tool yang tidak dirakit tidak disebut di instruksi", disebutSalah.length === 0, disebutSalah.join(", ") || "bersih");
// ⚠️ DIBANDINGKAN DENGAN NAMA TOOL YANG SUNGGUHAN, bukan dengan kode barisnya.
//
// Tool tulis dipegang model dengan nama lain: baris `buat_tiket` jadi tool
// `siapkan_tiket`, supaya model tidak mengira pemanggilannya sudah menyimpan.
// Versi lama memeriksa kode baris, jadi ia tetap hijau justru waktu instruksi
// menyebut `buat_tiket` sementara model memegang `siapkan_tiket` — nama yang
// tidak ada. Yang harus cocok adalah apa yang BENAR-BENAR dipegang model.
const namaDirakit = portal!.tool.map((x) => x.name);
const tidakDisebut = namaDirakit.filter((n) => !teks.includes(`\`${n}\``));
cek("tiap tool yang dipegang model disebut di instruksi", tidakDisebut.length === 0,
  tidakDisebut.length === 0 ? namaDirakit.join(", ") : `hilang: ${tidakDisebut.join(", ")}`);
cek("nama tool tulis yang sampai ke model bukan `buat_`",
  !namaDirakit.some((n) => n.startsWith("buat_")), namaDirakit.filter((n) => n.startsWith("siapkan_")).join(", ") || "(tidak ada tool tulis)");

// ============================================================
console.log("\n=== 3. Cakupan ikut diberitahukan ke model ===");
// ============================================================
cek("tool bercakupan diri ditandai di instruksi", teks.includes("HANYA data penanya sendiri"));
cek("aturan dilarang mengarang ada", teks.includes("jangan mengarang"));
cek("aturan galat disampaikan apa adanya ada", teks.toLowerCase().includes("galat"));

// ============================================================
console.log("\n=== 4. Saluran WhatsApp mengubah aturan format ===");
// ============================================================
const wa = bacaInstruksi(portal!.agent, "wa");
cek("web boleh tabel", teks.includes("Boleh memakai tabel markdown"));
cek("wa dilarang tabel", wa.includes("JANGAN memakai tabel markdown") && !wa.includes("Boleh memakai tabel markdown"));

// ============================================================
console.log("\n=== 5. Agent tanpa tool mengaku tidak punya tool ===");
// ============================================================
const umum = k.agent.find((a) => a.umum)!;
const kosong = buatAgentDariKonfig({ ...umum, umum: false, tool: [] }, andi);
const teksKosong = bacaInstruksi(kosong.agent);
cek("ditandai terang-terangan di instruksi", teksKosong.includes("belum punya tool"));
cek("disuruh tidak berpura-pura bisa", teksKosong.includes("Jangan berpura-pura bisa"));

// ============================================================
console.log("\n=== 6. Router hanya menurunkan aplikasi yang BOLEH diakses ===");
// ============================================================
// Larangan yang cuma kalimat di prompt bisa dibujuk. Agent yang tidak
// dipasang tidak bisa dipanggil sama sekali.
const sempit = await buatRouter(andi, [APP.portal]);
console.log(`  akses Portal saja -> bawahan: ${sempit!.bawahan.map((b) => b.kode).join(", ") || "(tidak ada)"}`);
cek("cuma agent Portal yang jadi bawahan", sempit!.bawahan.length === 1 && sempit!.bawahan[0].kode === "agent-portal");

const luas = await buatRouter(andi, [APP.portal, APP.maps, APP.supertools]);
console.log(`  akses 3 aplikasi  -> bawahan: ${luas!.bawahan.map((b) => b.kode).join(", ")}`);
cek("tiga aplikasi jadi tiga bawahan", luas!.bawahan.length === 3);
cek("agent di luar akses tidak ikut", !luas!.bawahan.some((b) => b.kode === "agent-hr" || b.kode === "agent-cmod"));

const tanpa = await buatRouter(andi, []);
cek("tanpa akses tetap jadi agent, tanpa bawahan", tanpa!.bawahan.length === 0);
cek("router mengakui tidak ada agent terbuka", bacaInstruksi(tanpa!.agent).includes("belum ada agent aplikasi yang terbuka"));

// Supertools Mobile saja harus tetap menurunkan agent Super Tools.
const lewatMobile = await buatRouter(andi, [APP.supertoolsMobile]);
cek("akses Supertools Mobile menurunkan agent Super Tools",
  lewatMobile!.bawahan.length === 1 && lewatMobile!.bawahan[0].kode === "agent-supertools");

// ============================================================
console.log("\n=== 7. Dua pemakai = dua agent, tidak dipakai ulang ===");
// ============================================================
// Tool terikat `SesiPemakai`. Satu instance yang dipakai berdua berarti
// penyaring orang pertama ikut dipakai orang kedua -- dan itu tidak akan
// pernah muncul sebagai galat.
// Diperiksa lewat PERILAKU, bukan lewat identitas objek. Versi pertama uji
// ini membandingkan `agent.tools?.[0]`, padahal `Agent.tools` tidak terbaca
// dari instance-nya: dua sisi sama-sama `undefined`, dan pemeriksaannya tidak
// membuktikan apa pun sambil terlihat tegas.
const [x, y] = (await pool.query<{ id_employee: string }>(
  `SELECT id_employee FROM v_ai_tiket_helpdesk GROUP BY 1 ORDER BY count(*) DESC LIMIT 2`)).rows;
const rX = await agentAplikasi(APP.portal, sesi(x.id_employee));
const rY = await agentAplikasi(APP.portal, sesi(y.id_employee));
cek("instance agent berbeda", rX!.agent !== rY!.agent);

const ambil = async (r: NonNullable<Awaited<ReturnType<typeof agentAplikasi>>>) => {
  // Sejak tool portal menggantikan tool bercakupan luas, yang terpasang
  // `asisten_tiket`. Dua-duanya diterima supaya uji ini tidak ikut gugur
  // kalau penggantiannya sengaja dimatikan.
  const t = (r.tool.find((z) => z.name === "asisten_tiket") ??
    r.tool.find((z) => z.name === "tiket_helpdesk"))!;
  const h = (await t.execute!({})) as { baris: Record<string, unknown>[] };
  return h.baris.map((b) => String(b.no_ticket));
};
const tiketX = await ambil(rX!);
const tiketY = await ambil(rY!);
const sama = tiketX.filter((n) => tiketY.includes(n));
cek("tool dua pemakai mengembalikan tiket berbeda",
  tiketX.length > 0 && tiketY.length > 0 && sama.length === 0,
  `${tiketX.length} vs ${tiketY.length} tiket, ${sama.length} beririsan`);

// ============================================================
console.log("");
console.log("=== 8. Router tahu KEMAMPUAN tiap bawahan, bukan cuma namanya ===");
// ============================================================
// ⚠️ PENJAGA REGRESI. Versi pertama router cuma menuliskan
// `ai_agent.deskripsi` tiap bawahan -- satu kalimat seperti "Tiket helpdesk,
// aset, profil, dan pengajuan karyawan". Akibatnya "SOP apa saja yang ada?"
// DITOLAK dengan alasan tidak ada agent yang menanganinya, padahal
// `cari_sop` dan `daftar_sop` terpasang di agent Portal.
//
// Tidak ada galat yang menandainya: penolakan itu terbaca sopan dan masuk
// akal. Yang membuatnya ketahuan cuma mencobanya sebagai pemakai.
const rKemampuan = await buatRouter(sesi(x.id_employee), [APP.portal]);
const teksRouter = bacaInstruksi(rKemampuan!.agent);
const portalBawahan = rKemampuan!.bawahan.find((b) => b.kode === "agent-portal")!;
console.log(`  bisa: ${portalBawahan.bisa.join("; ")}`);
cek("kemampuan bawahan ikut dikumpulkan", portalBawahan.bisa.length > 0,
  `${portalBawahan.bisa.length} tool`);
cek("kemampuan itu benar-benar masuk ke instruksi router",
  portalBawahan.bisa.every((n) => teksRouter.includes(n)));
cek("tool SOP ikut disebut", teksRouter.toLowerCase().includes("sop"),
  teksRouter.toLowerCase().includes("sop") ? "disebut" : "TIDAK DISEBUT");

await pool.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
// ⚠️ `process.exit`, bukan `exitCode`. Sejak `muatKonfig()` ikut membaca
// `ai_tool_agent` di MySQL, pool-nya menahan event loop tetap hidup dan
// skrip ini mencetak hasilnya lalu MENGGANTUNG — lolos tapi tidak pernah
// selesai, yang di CI terbaca sebagai uji yang macet.
process.exit(gagal === 0 ? 0 : 1);
