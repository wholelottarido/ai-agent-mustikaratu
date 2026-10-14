/**
 * Uji perakit tool dari konfigurasi.
 *
 *   npm run test:tool-konfig
 *
 * HANYA MEMBACA. Tidak menulis apa pun.
 *
 * ============================================================
 * YANG DIBUKTIKAN DI SINI
 * ============================================================
 * Bukan "fungsinya mengembalikan tool", tapi empat hal yang kalau salah TIDAK
 * menimbulkan galat sama sekali:
 *
 *   1. tool bercakupan `diri` benar-benar cuma mengembalikan baris orang itu
 *      -- dibandingkan dengan hitungan yang diambil lewat query sendiri;
 *   2. dua orang berbeda mendapat hasil berbeda dari tool yang sama;
 *   3. sesi yang TIDAK punya `id_employee` DITOLAK, bukan diberi semuanya.
 *      Ini yang paling penting: melepas penyaring tidak pernah error, dia
 *      cuma mengembalikan data semua orang;
 *   4. isi filter dari model diperlakukan sebagai NILAI, bukan potongan SQL.
 */
import { muatKonfig } from "../lib/ai-konfig.ts";
import { buatToolBaca, buatToolDariKonfig, type SesiPemakai } from "../voltagent/tool-konfigurasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { namaUntukModel } from "../voltagent/registry-tulis.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}
const kosong: SesiPemakai = { idEmployee: null, idDepartment: null, idCompany: null, idUsers: null, departemen: null };
const pool = poolPerusahaan();
const k = await muatKonfig();

const tiket = [...k.lepas, ...k.agent.flatMap((a) => a.tool)].find((t) => t.kode === "asisten_tiket");
if (!tiket) throw new Error("tool asisten_tiket tidak ditemukan di konfigurasi");

// Dua orang yang memang punya tiket, diambil dari data -- bukan ditebak.
const orang = (await pool.query<{ id_employee: string; n: number }>(
  `SELECT id_employee, count(*)::int n FROM v_ai_mg_tiket GROUP BY 1 ORDER BY 2 DESC LIMIT 2`)).rows;
const [a, b] = orang;
const sesiA: SesiPemakai = { idEmployee: a.id_employee, idDepartment: null, idCompany: null, idUsers: null, departemen: null };
const sesiB: SesiPemakai = { idEmployee: b.id_employee, idDepartment: null, idCompany: null, idUsers: null, departemen: null };

// ============================================================
console.log("=== 1. Cakupan `diri` benar-benar menyaring ===");
// ============================================================
const tA = buatToolBaca(tiket, sesiA);
const rA = await tA.execute!({}) as { baris: Record<string, unknown>[]; jumlah: number; terpotong: boolean };
const totalSemua = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM v_ai_mg_tiket`)).rows[0].n;
console.log(`  orang A punya ${a.n} tiket, seluruh view ${totalSemua} tiket`);
cek("hasilnya tidak sebanyak seluruh view", rA.jumlah < totalSemua, `${rA.jumlah} baris`);
cek("hasilnya dibatasi `batas` konfigurasi", rA.jumlah <= tiket.batas, `batas=${tiket.batas}`);
cek("ditandai terpotong kalau memang lebih", rA.terpotong === a.n > tiket.batas);

// Barisnya memang milik A: dicocokkan lewat nomor tiket ke query sendiri.
const noA = rA.baris.map((x) => x.no_ticket as string);
const milikA = (await pool.query<{ n: number }>(
  `SELECT count(*)::int n FROM v_ai_mg_tiket WHERE no_ticket = ANY($1) AND id_employee = $2`,
  [noA, a.id_employee])).rows[0].n;
cek("setiap baris yang keluar memang milik orang itu", milikA === noA.length, `${milikA}/${noA.length}`);

// ============================================================
console.log("\n=== 2. Orang berbeda, hasil berbeda ===");
// ============================================================
const tB = buatToolBaca(tiket, sesiB);
const rB = await tB.execute!({}) as { baris: Record<string, unknown>[] };
const noB = new Set(rB.baris.map((x) => x.no_ticket as string));
const beririsan = noA.filter((n) => noB.has(n));
cek("tidak ada tiket yang muncul di dua-duanya", beririsan.length === 0, `${beririsan.length} beririsan`);

// ============================================================
console.log("\n=== 3. Sesi tanpa identitas DITOLAK, bukan dibuka ===");
// ============================================================
// Ini uji yang paling penting di berkas ini. Kalau penyaringnya dilepas
// karena sesi kosong, query-nya tetap berhasil -- dan mengembalikan tiket
// semua orang tanpa satu pun tanda bahwa ada yang salah.
const tKosong = buatToolBaca(tiket, kosong);
const rKosong = await tKosong.execute!({}) as { galat?: string; baris?: unknown[] };
cek("ditolak dengan alasan, bukan diberi data", Boolean(rKosong.galat) && !rKosong.baris, rKosong.galat ?? "MALAH DAPAT DATA");

// ============================================================
console.log("\n=== 4. Isi filter diperlakukan sebagai nilai, bukan SQL ===");
// ============================================================
const jahat = ["x' OR '1'='1", "'; DROP TABLE portal_ticket; --", "%"];
let aman = true;
for (const j of jahat) {
  try {
    const r = await buatToolBaca(tiket, sesiA).execute!({ no_ticket: j }) as { jumlah: number };
    // `%` wajar mengembalikan semua tiket MILIK A (ILIKE), tapi tidak pernah
    // boleh melebihi jumlah tiket A.
    if (r.jumlah > Math.min(a.n, tiket.batas)) { aman = false; console.log(`    "${j}" -> ${r.jumlah} baris, KEBANYAKAN`); }
  } catch (e) { aman = false; console.log(`    "${j}" -> galat ${(e as Error).message.slice(0, 80)}`); }
}
cek("tidak ada isi filter yang menembus penyaring", aman, `${jahat.length} nilai dicoba`);
const masihAda = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM v_ai_mg_tiket`)).rows[0].n;
cek("tabelnya masih utuh setelah dicoba", masihAda === totalSemua, `${masihAda} baris`);

// ============================================================
console.log("\n=== 5. Kolom yang tidak dicentang tidak pernah keluar ===");
// ============================================================
// `id_employee` ADA di view tapi tidak masuk `kolom` -- uuid tidak berguna
// buat model, dan penyaringnya sudah otomatis.
const kolomKeluar = new Set(Object.keys(rA.baris[0] ?? {}));
const bocor = [...kolomKeluar].filter((c) => !tiket.kolom.includes(c));
cek("tidak ada kolom di luar daftar yang dicentang", bocor.length === 0, bocor.join(", ") || "bersih");
cek("id_employee tidak ikut keluar", !kolomKeluar.has("id_employee"));

// ============================================================
console.log("\n=== 6. Yang belum bisa dirakit dilewati dengan alasan ===");
// ============================================================
const portal = k.agent.find((x) => x.kode === "agent-portal")!;
// ⚠️ Sesinya diberi `ticket:read`, kalau tidak ketiga tool tiket tersaring di
// gerbang izin LEBIH DULU dan bagian ini berhenti menguji apa yang dimaksud —
// yaitu bahwa operasi tulis tidak ikut dirakit diam-diam. Gerbang izinnya
// sendiri diuji di bagian 9.
const { tool, dilewati } = buatToolDariKonfig(portal.tool, { ...sesiA, izin: ["ticket:read"] });
console.log(`  dirakit : ${tool.map((t) => t.name).join(", ")}`);
for (const d of dilewati) console.log(`  dilewati: ${d.kode} — ${d.sebab}`);
cek("tool baca dirakit", tool.length > 0, `${tool.length} tool`);
// ⚠️ JAMINANNYA BERUBAH, DAN UJINYA IKUT BERUBAH.
//
// Dulu: tool tulis TIDAK dirakit sama sekali, dan ujinya menuntut ada alasan
// "operasi ... belum dirakit". Sejak penjalan tulis umum ada, tool tulis
// memang dirakit — jadi pemeriksaan lama bukan cuma gagal, ia menegaskan hal
// yang sudah tidak benar.
//
// Yang berlaku sekarang: tool tulis boleh dirakit, TAPI namanya harus selalu
// berawalan `siapkan_`. Nama tanpa awalan itu (`buat_tiket`,
// `batalkan_tiket`) mengundang model menjawab "sudah dibuat" / "sudah
// dibatalkan" padahal belum ada satu baris pun tersimpan.
const kodeTulis = new Set(portal.tool.filter((t) => t.operasi !== "baca").map((t) => t.kode));
const namaTulis = tool.map((x) => x.name).filter((n) => n.startsWith("siapkan_"));
cek("tool tulis dirakit, bukan dilewati", namaTulis.length > 0, namaTulis.join(", "));
cek("TIDAK ada tool bernama kode tulis mentahnya",
  !tool.some((x) => kodeTulis.has(x.name)),
  tool.map((x) => x.name).filter((n) => kodeTulis.has(n)).join(", ") || "bersih");
// Namanya diambil dari `namaUntukModel` — SATU sumber kebenaran yang sama
// dengan yang dipakai perakit dan instruksi agent. Menuliskan pola namanya
// sendiri di sini akan membuat uji ini setuju dengan dirinya sendiri, bukan
// dengan yang benar-benar dipegang model.
for (const t of portal.tool.filter((x) => x.operasi !== "baca")) {
  const n = namaUntukModel(t);
  const ada = tool.some((x) => x.name === n) || dilewati.some((d) => d.kode === t.kode);
  cek(`${t.kode} -> ${n}`, ada && n.startsWith("siapkan_"), ada ? n : "tidak terakit & tidak dilewati");
}
cek("jumlahnya genap: dirakit + dilewati = tool agent", tool.length + dilewati.length === portal.tool.length);

// ============================================================
console.log("");
console.log("=== 7. Sumber yang dibaca ikut tercatat ===");
// ============================================================
// ⚠️ PENJAGA REGRESI. Waktu router mendelegasikan, pemanggilan tool agent
// bawahan TIDAK sampai ke klien -- yang sampai cuma `delegate_task`. Jadi nama
// view hanya bisa sampai ke layar lewat pencatat ini. Kalau dia lepas,
// jawaban yang jelas membaca database akan berlabel "tidak mengambil data
// dari database", dan tidak ada galat yang menandainya.
const tercatat: string[] = [];
const alatTercatat: string[] = [];
const rakit = buatToolDariKonfig([tiket], sesiA, (j) => {
  if (j.view) tercatat.push(j.view);
  alatTercatat.push(j.alat);
});
cek("tool terakit", rakit.tool.length === 1);
cek("belum ada yang tercatat sebelum dipanggil", tercatat.length === 0);
await rakit.tool[0].execute!({});
cek("view tercatat sesudah tool dipanggil", tercatat.includes(tiket.sumber!.view),
  tercatat.join(", ") || "kosong");
// ⚠️ ALAT ikut dicatat, bukan cuma view-nya. Label jawaban menyebut keduanya,
// dan "tool apa yang dipakai" tidak bisa diturunkan dari nama view: satu view
// bisa dibaca beberapa tool dengan cakupan berbeda.
cek("nama alat ikut tercatat", alatTercatat.includes(tiket.kode), alatTercatat.join(", ") || "kosong");

// Sesi tanpa identitas ditolak sebelum query jalan, jadi tidak boleh ada
// sumber yang tercatat -- kalau tercatat, labelnya mengaku membaca data yang
// tidak pernah dibaca.
const tercatat2: string[] = [];
await buatToolDariKonfig([tiket], kosong, (j) => { if (j.view) tercatat2.push(j.view); }).tool[0].execute!({});
cek("permintaan yang ditolak tidak mencatat sumber", tercatat2.length === 0,
  tercatat2.join(", ") || "bersih");

// ============================================================
console.log("\n=== 8. Hasil menyebut PEMILIK barisnya, bukan cuma cakupannya ===");
// ============================================================
// ⚠️ LAHIR DARI KEGAGALAN NYATA, 7 Okt 2026. Ditanya "klaim departemen HR apa
// saja?", model membaca baris Trade Marketing yang sudah tersaring BENAR lalu
// menyajikannya sebagai "daftar klaim untuk departemen HR". Datanya tidak
// bocor -- labelnya yang berbohong. Sebabnya: hasil tool cuma menyebut
// `cakupan: "departemen"`, tanpa departemen yang mana.
const klaim = [...k.lepas, ...k.agent.flatMap((a) => a.tool)].find((t) => t.kode === "asisten_klaim");
if (!klaim) {
  cek("tool asisten_klaim ada", false, "tidak ditemukan");
} else {
  const { rows: dep } = await pool.query<{ id_department: string; nama: string }>(
    `SELECT e.id_department, d.name AS nama FROM employee e
       JOIN department d ON d.id_department = e.id_department
      WHERE e.id_department IS NOT NULL LIMIT 1`);
  const sesiDep: SesiPemakai = {
    idEmployee: null, idUsers: null, idCompany: null, departemen: null,
    idDepartment: dep[0].id_department, namaDepartemen: dep[0].nama,
  };
  const alat = buatToolDariKonfig([klaim], sesiDep).tool[0];

  cek("deskripsi tool menyebut nama departemennya",
    (alat.description ?? "").includes(dep[0].nama), dep[0].nama);

  const rD = (await alat.execute!({})) as any;
  cek("hasil punya kolom `milik`", typeof rD.milik === "string", rD.milik);
  cek("`milik` menyebut nama departemennya, bukan cuma kata \"departemen\"",
    typeof rD.milik === "string" && rD.milik.includes(dep[0].nama), rD.milik);
  cek("hasil membawa catatan larangan salah label", typeof rD.catatan === "string" && rD.catatan.length > 40);

  // Tool bercakupan `semua` tidak perlu catatan ini -- barisnya memang milik
  // semua orang, dan peringatan yang tidak berlaku cuma mengajari model
  // mengabaikannya.
  const sop = [...k.lepas, ...k.agent.flatMap((a) => a.tool)]
    .find((t) => t.cakupan === "semua" && t.jenis === "konfigurasi" && t.operasi === "baca");
  if (sop) {
    const rS = (await buatToolDariKonfig([sop], sesiDep).tool[0].execute!({})) as any;
    cek(`tool cakupan semua (${sop.kode}) TIDAK membawa catatan`, rS.catatan === undefined);
    cek("tapi tetap menyebut miliknya", rS.milik === "seluruh perusahaan", rS.milik);
  }

  // Sesi tanpa nama departemen tetap harus menyebut sesuatu yang jujur,
  // bukan string kosong atau "departemen undefined".
  const tanpaNama = buatToolDariKonfig([klaim], { ...sesiDep, namaDepartemen: null }).tool[0];
  const rN = (await tanpaNama.execute!({})) as any;
  cek("tanpa nama departemen, labelnya tetap masuk akal",
    typeof rN.milik === "string" && !/undefined|null/.test(rN.milik), rN.milik);
}

// ============================================================
console.log("\n=== 9. Jumlah SEBENARNYA, bukan jumlah yang terbaca ===");
// ============================================================
// ⚠️ LAHIR DARI KEGAGALAN NYATA, 9 Okt 2026. Tool berbatas 6 baris dipakai di
// departemen yang punya 22. Hasilnya bertanda `terpotong: true` dengan benar,
// lalu model menjawab "belum ada data tambahan yang bisa ditarik lebih
// lanjut" — pembacanya menyimpulkan departemen itu memang punya 6 aset.
//
// `terpotong` memberi tahu BAHWA ada lagi; `total` memberi tahu BERAPA.
{
  const kecil = { ...tiket, batas: 3, cakupan: "semua" as const };
  const r = (await buatToolDariKonfig([kecil], sesiA).tool[0].execute!({})) as any;
  const { rows: asli } = await pool.query<{ n: number }>(
    `SELECT count(*)::int n FROM "${tiket.sumber!.view}"`);
  cek("yang dibaca dibatasi", r.jumlah === 3, `${r.jumlah} baris`);
  cek("ditandai terpotong", r.terpotong === true);
  cek("total = jumlah SEBENARNYA di view", r.total === asli[0].n, `${r.total} vs ${asli[0].n}`);
  cek("total BERBEDA dari jumlah yang dibaca", r.total !== r.jumlah);

  // ⚠️ SIFAT PALING MENENTUKAN: total harus ikut penyaring. Total yang
  // menghitung seluruh tabel akan menjawab "ada 10.091" untuk pertanyaan
  // tentang satu status saja — angka yang benar untuk pertanyaan yang salah.
  const saring = (await buatToolDariKonfig([kecil], sesiA).tool[0].execute!({ status: "OPEN" })) as any;
  const { rows: open } = await pool.query<{ n: number }>(
    `SELECT count(*)::int n FROM "${tiket.sumber!.view}" WHERE status = 'OPEN'`);
  cek("total ikut penyaring, bukan seluruh tabel", saring.total === open[0].n,
    `${saring.total} vs ${open[0].n}`);

  // Tidak terpotong -> total = jumlah, dan TANPA query hitung kedua.
  //
  // ⚠️ Dipersempit lewat FILTER, bukan lewat batas besar. Percobaan pertama
  // memakai `batas: 200` dan menganggap itu pasti cukup — ternyata satu
  // karyawan di data ini punya 1.040 tiket, jadi hasilnya tetap terpotong dan
  // ujinya gagal karena ekspektasinya yang keliru, bukan kodenya.
  const [satu] = (await pool.query<{ no_ticket: string }>(
    `SELECT no_ticket FROM "${tiket.sumber!.view}" LIMIT 1`)).rows;
  const r2 = (await buatToolDariKonfig([{ ...tiket, cakupan: "semua" as const }], sesiA)
    .tool[0].execute!({ no_ticket: satu.no_ticket })) as any;
  cek("tidak terpotong -> total sama dengan jumlah", r2.total === r2.jumlah && !r2.terpotong,
    `jumlah=${r2.jumlah} total=${r2.total} terpotong=${r2.terpotong}`);
}


// ============================================================
console.log("\n=== 9b. Dua penyaring di kolom yang sama ===");
// ============================================================
// ⚠️ LAHIR DARI KEGAGALAN NYATA, 13 Okt 2026. Nama parameter diturunkan dari
// nama KOLOM saja. Selama tiap kolom cuma punya satu penyaring itu aman — dan
// memang begitu keadaannya sampai `jatuh_tempo` diberi `dari` DAN `sampai`
// dari layar pengaturan.
//
// Akibatnya keduanya jadi SATU parameter, dan nilai yang sama dipasang ke
// `>=` sekaligus `<=`. Tidak ada galat: rentang tanggal apa pun cuma tidak
// pernah menyaring, dan jawabannya terlihat wajar.
{
  const bentukDari = (a: unknown) =>
    Object.keys((a as { parameters?: { shape?: Record<string, unknown> } }).parameters?.shape ?? {});

  const satu = { ...tiket, filter: [{ kolom: "status", label: "Status", operator: "sama" as const }] };
  const pSatu = bentukDari(buatToolDariKonfig([satu], sesiA).tool[0]);
  cek("kolom dengan SATU penyaring tetap bernama pendek", pSatu.join(",") === "status", pSatu.join(","));

  const dua = {
    ...tiket,
    filter: [
      { kolom: "dibuat", label: "Dibuat", operator: "dari" as const },
      { kolom: "dibuat", label: "Dibuat", operator: "sampai" as const },
    ],
  };
  const pDua = bentukDari(buatToolDariKonfig([dua], sesiA).tool[0]);
  cek(
    "kolom dengan DUA penyaring jadi dua parameter berbeda",
    pDua.length === 2 && pDua.includes("dibuat_dari") && pDua.includes("dibuat_sampai"),
    pDua.join(","),
  );

  // ⚠️ Dan rentangnya benar-benar MENYARING — bukan cuma namanya berbeda.
  // Tanpa pemeriksaan ini, nama parameter bisa benar sementara nilainya tetap
  // dipasang ke dua sisi yang sama, dan gejalanya persis sama: tidak ada galat.
  const lebar = { ...dua, cakupan: "semua" as const };
  const semua = (await buatToolDariKonfig([lebar], sesiA).tool[0].execute!({})) as { total: number };
  const sempit = (await buatToolDariKonfig([lebar], sesiA).tool[0].execute!({
    dibuat_dari: "2026-01-01",
    dibuat_sampai: "2026-01-31",
  })) as { total: number };
  cek("rentang tanggal benar-benar menyaring", sempit.total < semua.total,
    `${sempit.total} dari ${semua.total}`);
}


// ============================================================
console.log("\n=== 10. Gerbang izin ===");
// ============================================================
// ⚠️ `ai_tool.izin` diisi tim lain (`ticket:read` pada tool tiket) dan selama
// ini TIDAK PERNAH dibaca. Akibatnya satu-satunya pembatas sebuah tool adalah
// cakupannya — dan tool bercakupan `semua` terlihat SEMUA pemegang
// aplikasinya. Untuk antrean tiket itu berarti keluhan siapa pun terbaca
// siapa pun.
const berizin = portal.tool.filter((t) => t.izin);
const tanpaIzin = portal.tool.filter((t) => !t.izin);
cek("ada tool yang mensyaratkan izin", berizin.length > 0,
  berizin.map((t) => `${t.kode}:${t.izin}`).join(", "));

const tolak = buatToolDariKonfig(portal.tool, { ...sesiA, izin: [] });
cek("tool berizin ditolak waktu pemakai tidak punya izinnya",
  berizin.every((t) => tolak.dilewati.some((d) => d.kode === t.kode && d.sebab.includes("butuh izin"))));
// ⚠️ YANG DIPERIKSA SEBABNYA, BUKAN KEHADIRANNYA — dan bedanya penting.
//
// Versi sebelumnya menuntut tiap tool tanpa syarat izin HADIR di hasil. Itu
// menganggap gerbang izin satu-satunya alasan sebuah tool bisa dilewati, dan
// itu tidak benar: tool tulis ke tabel di luar daftar-boleh dilewati, begitu
// juga tool tulis tim lain yang belum disetujui, dan tool berjenis kode yang
// penanganya tidak dikenal. Semuanya benar, dan tidak satu pun soal izin.
//
// Terbukti 13 Okt 2026: tiga tool `*_jobdesk` tim lain masuk ke agent-portal,
// ketiganya tanpa syarat izin, ketiganya dilewati karena `jobdesk` di luar
// daftar-boleh — dan uji gerbang izin jadi merah untuk penolakan yang justru
// kita inginkan.
//
// Yang benar-benar dijaga gerbang izin: tool tanpa syarat izin TIDAK PERNAH
// dilewati DENGAN ALASAN IZIN. Dilewati karena sebab lain bukan urusan di sini.
//
// Nama dibandingkan lewat `namaUntukModel`: tool tulis dipegang model dengan
// nama lain (`ubah_tiket_saya` -> `siapkan_ubah_tiket_saya`).
{
  const salahAlasan = tanpaIzin
    .filter((t) => !tolak.tool.some((x) => x.name === namaUntukModel(t)))
    .map((t) => ({ t, sebab: tolak.dilewati.find((d) => d.kode === t.kode)?.sebab }))
    // Tidak ada di hasil DAN tidak ada alasannya = hilang diam-diam. Itu
    // kegagalan, apa pun sebabnya.
    .filter((x) => !x.sebab || x.sebab.includes("izin"));
  cek("tool tanpa syarat izin tidak pernah dilewati karena izin",
    salahAlasan.length === 0,
    salahAlasan.length === 0
      ? `${tanpaIzin.length} tool tanpa syarat izin`
      : salahAlasan.map((x) => `${x.t.kode}: ${x.sebab ?? "HILANG TANPA ALASAN"}`).join(" | "));

  // Dan yang dilewati karena sebab LAIN tetap dicetak — bukan supaya ujinya
  // merah, tapi supaya penolakan yang benar tetap kelihatan. Penolakan yang
  // tidak pernah dilihat siapa pun sama saja dengan tool yang hilang.
  const sebabLain = tanpaIzin
    .filter((t) => !tolak.tool.some((x) => x.name === namaUntukModel(t)))
    .map((t) => `${t.kode}: ${tolak.dilewati.find((d) => d.kode === t.kode)?.sebab ?? "?"}`);
  if (sebabLain.length > 0) {
    console.log(`         dilewati bukan karena izin: ${sebabLain.length}`);
    for (const x of sebabLain) console.log(`           ${x}`);
  }
}

// ⚠️ `izin: undefined` BERBEDA dari `izin: []`, dan alasannya harus berbeda
// juga: "tidak punya izin" ditangani dengan memberi peran, "belum ditelusuri"
// ditangani dengan memperbaiki kode yang menyusun sesi.
const belum = buatToolDariKonfig(portal.tool, sesiA);
cek("sesi tanpa penelusuran izin ditolak dengan alasan BERBEDA",
  belum.dilewati.some((d) => d.sebab.includes("belum ditelusuri")),
  belum.dilewati.find((d) => d.sebab.includes("izin"))?.sebab ?? "-");

// Izinnya dikumpulkan dari tool-nya sendiri, bukan ditulis tetap: begitu ada
// tool baru dengan izin lain, pemeriksaan ini ikut, bukan jadi usang diam-diam.
const semuaIzin = [...new Set(berizin.map((t) => t.izin!))];
const lolosIzin = buatToolDariKonfig(portal.tool, { ...sesiA, izin: semuaIzin });
cek("tool berizin lolos waktu izinnya dipunyai",
  berizin.every((t) => !lolosIzin.dilewati.some((d) => d.kode === t.kode && d.sebab.includes("butuh izin"))),
  semuaIzin.join(", "));

// Izin yang MIRIP tapi bukan yang diminta tidak boleh lolos.
const mirip = buatToolDariKonfig(portal.tool, { ...sesiA, izin: ["ticket:read:all", "ticket", "read"] });
cek("izin yang mirip tapi tidak sama DITOLAK",
  berizin.every((t) => mirip.dilewati.some((d) => d.kode === t.kode && d.sebab.includes("butuh izin"))));

// ⚠️ PEMERIKSAAN PALING PENTING DI BAGIAN INI.
//
// `asisten_antrean_tiket` satu-satunya tool kita yang membaca data PRIBADI
// orang lain tanpa penyaring orang: cakupan `semua` atas tiket, yang memuat
// nama pelapor dan isi keluhannya. Yang membuatnya bukan kebocoran cuma satu
// baris — `izin`-nya. Kalau baris itu dikosongkan, tool ini terpasang untuk
// SETIAP pemegang Portal, yaitu semua orang yang bisa login.
const antrean = portal.tool.find((t) => t.kode === "asisten_antrean_tiket");
cek("tool antrean terdaftar", Boolean(antrean));
if (antrean) {
  cek("cakupannya memang `semua`", antrean.cakupan === "semua", antrean.cakupan);
  cek("DAN mensyaratkan izin — tanpa ini ia terbuka untuk semua orang",
    antrean.izin === "assignment-ticket:read", antrean.izin ?? "(KOSONG — BOCOR)");
  cek("tidak terpasang untuk pemakai tanpa izin itu",
    !buatToolDariKonfig([antrean], { ...sesiA, izin: ["ticket:read"] }).tool.length);
  cek("terpasang untuk pemakai yang punya izin itu",
    buatToolDariKonfig([antrean], { ...sesiA, izin: ["assignment-ticket:read"] }).tool.length === 1);
}

await pool.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
// ⚠️ `process.exit`, bukan `exitCode`. Sejak `muatKonfig()` ikut membaca
// `ai_tool_agent` di MySQL, pool-nya menahan event loop tetap hidup dan
// skrip ini mencetak hasilnya lalu MENGGANTUNG — lolos tapi tidak pernah
// selesai, yang di CI terbaca sebagai uji yang macet.
process.exit(gagal === 0 ? 0 : 1);
