/**
 * Uji pengubahan setelan tool AI.
 *
 *   npm run test:ubah-tool
 *
 * ⚠️ MENGUBAH BARIS SUNGGUHAN di `ai_tool`, lalu MENGEMBALIKANNYA di
 * `finally` — termasuk kalau ujinya gagal di tengah. Nilai sebelum diubah
 * dibaca dulu dan dibandingkan lagi di akhir.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. baris MILIK MEREKA tidak bisa diubah, walau diminta langsung;
 *   2. cakupan yang kolom penyaringnya tidak ada DITOLAK — menaikkan cakupan
 *      jadi `semua` tidak pernah menimbulkan galat, cuma membuat tiap pemakai
 *      melihat data semua orang;
 *   3. kolom di luar katalog sumbernya ditolak sebelum jadi teks SELECT;
 *   4. database sendiri menolak kolom yang menentukan perilaku tool
 *      (`penangan`, `jenis`, `id_ai_sumber_data`, `tabel_target`) — lapis ini
 *      harus tetap berdiri walau seluruh berkas `ubah-tool.ts` salah.
 */
import { ubahTool, cakupanTersedia, ringkasTool, izinPilihan } from "../lib/ubah-tool.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { sambungTool, putusTool } from "../lib/sambung-tool.ts";
import { poolKonfig } from "../lib/db-konfig.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { buatToolDariKonfig } from "../voltagent/tool-konfigurasi.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const UJI = "asisten_tiket";
const baca = poolPerusahaan();
const [awal] = (await baca.query<{ batas: number; cakupan_bawaan: string; kolom: string[] }>(
  `SELECT batas, cakupan_bawaan, kolom FROM ai_tool WHERE kode = $1`, [UJI])).rows;
console.log(`sebelum: ${UJI} batas=${awal.batas} cakupan=${awal.cakupan_bawaan} ${awal.kolom.length} kolom\n`);

try {
  // ============================================================
  console.log("=== 1. Baris milik mereka tidak bisa disentuh ===");
  // ============================================================
  for (const milikMereka of ["tiket_helpdesk", "sim_klaim_maps", "buat_tiket"]) {
    const r = await ubahTool(milikMereka, { batas: 5 });
    cek(`${milikMereka} ditolak`, !r.ok, r.ok ? "MALAH BERHASIL" : r.sebab.slice(0, 60));
  }

  // ============================================================
  console.log("\n=== 2. Cakupan tanpa kolom penyaring ditolak ===");
  // ============================================================
  const k = await muatKonfig();
  const tiket = [...k.agent.flatMap((a) => a.tool), ...k.lepas].find((t) => t.kode === UJI)!;
  console.log(`  cakupan tersedia untuk ${UJI}: ${cakupanTersedia(tiket).join(", ")}`);
  cek("diri tersedia (sumbernya punya kolom_employee)", cakupanTersedia(tiket).includes("diri"));

  const klaim = [...k.agent.flatMap((a) => a.tool), ...k.lepas].find((t) => t.kode === "asisten_klaim")!;
  console.log(`  cakupan tersedia untuk asisten_klaim: ${cakupanTersedia(klaim).join(", ")}`);
  cek("diri TIDAK tersedia untuk asisten_klaim", !cakupanTersedia(klaim).includes("diri"),
    "sumbernya tidak punya kolom_employee");
  const tolak = await ubahTool("asisten_klaim", { cakupan: "diri" });
  cek("permintaan cakupan diri ditolak", !tolak.ok, tolak.ok ? "MALAH BERHASIL" : tolak.sebab.slice(0, 70));

  // ============================================================
  console.log("\n=== 3. Kolom di luar katalog ditolak ===");
  // ============================================================
  for (const asing of ["id_employee", "password", "nama_view; DROP TABLE ai_tool"]) {
    const r = await ubahTool(UJI, { kolom: ["no_ticket", asing] });
    cek(`kolom "${asing.slice(0, 24)}" ditolak`, !r.ok);
  }

  // ============================================================
  console.log("\n=== 4. Perubahan yang sah memang tersimpan ===");
  // ============================================================
  const ok = await ubahTool(UJI, { batas: 7 });
  cek("batas berhasil diubah", ok.ok, ok.ok ? "" : ok.sebab);
  const [sesudah] = (await baca.query<{ batas: number }>(
    `SELECT batas FROM ai_tool WHERE kode = $1`, [UJI])).rows;
  cek("nilainya benar-benar di database", sesudah.batas === 7, `batas=${sesudah.batas}`);

  lupakanKonfig();
  const k2 = await muatKonfig();
  const t2 = [...k2.agent.flatMap((a) => a.tool), ...k2.lepas].find((t) => t.kode === UJI)!;
  cek("pembaca konfigurasi langsung melihatnya", t2.batas === 7, `batas=${t2.batas}`);

  const batasSalah = await ubahTool(UJI, { batas: 9999 });
  cek("batas di luar 1..200 ditolak", !batasSalah.ok);

  // ============================================================
  console.log("\n=== 5. Database menolak kolom penentu perilaku ===");
  // ============================================================
  // Lapis ini harus berdiri WALAU seluruh `ubah-tool.ts` salah, jadi diuji
  // dengan menembaknya langsung lewat pool role itu.
  for (const [kolom, nilai] of [
    ["penangan", "cari_sop"],
    ["jenis", "kode"],
    ["tabel_target", "portal_ticket"],
    ["kode", "bajakan"],
  ] as const) {
    let ditolak = false;
    let pesan = "";
    try {
      await poolKonfig().query(`UPDATE ai_tool SET ${kolom} = $1 WHERE kode = $2`, [nilai, UJI]);
    } catch (e) {
      ditolak = true;
      pesan = (e as Error).message.slice(0, 48);
    }
    cek(`UPDATE ${kolom} ditolak database`, ditolak, pesan || "MALAH BERHASIL");
  }
  // ============================================================
  console.log("");
  console.log("=== 6. Layar menampilkan SEMUA tool, bukan cuma milik kita ===");
  // ============================================================
  // ⚠️ Versi pertama menyaring tool tim lain keluar "supaya tidak ada yang
  // mencoba mengubahnya". Itu keliru: halaman ini mengatur agent yang dipakai
  // SEMUA ORANG, dan separuh tool yang tidak kelihatan membuat administrator
  // mengambil keputusan dari gambar yang salah -- mis. mengira agent CMOD
  // tidak punya tool sama sekali.
  const tampil = await ringkasTool();
  const punyaMereka = tampil.filter((t) => !t.milikKita);
  const punyaKita = tampil.filter((t) => t.milikKita);
  console.log(`  ${tampil.length} tool: ${punyaKita.length} milik kita, ${punyaMereka.length} bawaan sistem`);
  cek("tool tim lain ikut ditampilkan", punyaMereka.length > 0, `${punyaMereka.length} tool`);
  cek("tool kita ikut ditampilkan", punyaKita.length > 0, `${punyaKita.length} tool`);
  cek("semuanya ditandai kepemilikannya", tampil.every((t) => typeof t.milikKita === "boolean"));

  // Menampilkan bukan mengizinkan: tiap tool yang ditandai bukan milik kita
  // harus tetap ditolak kalau benar-benar dicoba diubah.
  let semuaTertolak = true;
  for (const t of punyaMereka.slice(0, 4)) {
    const r = await ubahTool(t.kode, { batas: 3 });
    if (r.ok) { semuaTertolak = false; console.log(`    ${t.kode} MALAH BERHASIL diubah`); }
  }
  cek("yang ditandai bawaan sistem tetap ditolak kalau dicoba", semuaTertolak);

  // ============================================================
  console.log("");
  console.log("=== 7. Tool di dua agent muncul dua kali, dengan agent yang benar ===");
  // ============================================================
  // ⚠️ PENJAGA REGRESI. `ringkasTool()` dulu mengambil nama agent lewat
  // `find()` -- yang mengembalikan agent PERTAMA yang memakainya. Begitu satu
  // tool disambungkan ke dua agent, dua salinannya sama-sama diberi nama agent
  // pertama: muncul dua kali di satu kelompok dan hilang dari kelompok yang
  // lain. React menandainya sebagai kunci ganda, tapi yang rusak datanya.
  const sambung = await sambungTool("agent-admin", "daftar_sop", 0);
  cek("daftar_sop bisa disambungkan ke agent-admin", sambung.ok,
    sambung.ok ? "" : sambung.sebab);

  if (sambung.ok) {
    const dua = (await ringkasTool()).filter((t) => t.kode === "daftar_sop");
    console.log(`  daftar_sop muncul di: ${dua.map((t) => t.agent).join(", ")}`);
    cek("muncul dua kali", dua.length === 2, `${dua.length} baris`);
    cek("agent-nya berbeda", new Set(dua.map((t) => t.agent)).size === 2);
    cek("tiap baris menyebut agent lain yang memakainya",
      dua.every((t) => t.agentLain.length === 1 && t.agentLain[0] !== t.agent));

    // Kunci yang dipakai layar harus unik, kalau tidak React membuang salah satu.
    const semuaKunci = (await ringkasTool()).map((t) => `${t.agent}:${t.kode}`);
    cek("kunci agent+kode unik di seluruh daftar",
      new Set(semuaKunci).size === semuaKunci.length, `${semuaKunci.length} baris`);

    const putus = await putusTool("agent-admin", "daftar_sop");
    cek("sambungannya bisa dicabut lagi", putus.ok, putus.ok ? "" : putus.sebab);
  }

  // Yang menempel lewat kecocokan aplikasi TIDAK bisa diputus dari sini --
  // tombol yang membalas "tidak ada" adalah tombol yang berbohong.
  const salah = await putusTool("agent-portal", "daftar_sop");
  cek("tool yang menempel lewat aplikasi tidak bisa diputus", !salah.ok,
    salah.ok ? "MALAH BERHASIL" : salah.sebab.slice(0, 55));

// ============================================================
console.log("\n=== Izin ikut terlihat di layar pengaturan ===");
// ============================================================
// ⚠️ LAYAR YANG MENYEMBUNYIKAN INI MENYESATKAN. Administrator melihat tool
// bercakupan "Seluruh perusahaan" lalu menyimpulkan ia terbuka untuk siapa
// saja — padahal dijaga izin. Atau sebaliknya, dan itu yang berbahaya: ia
// mengira ada penjaganya padahal tidak.
const tampilIzin = await ringkasTool();
cek("tiap baris membawa kolom izin", tampilIzin.every((t) => "izin" in t));

const antre = tampilIzin.find((t) => t.kode === "asisten_antrean_tiket");
cek("tool antrean ada di layar", Boolean(antre));
if (antre) {
  cek("izinnya terlihat, bukan null", antre.izin === "assignment-ticket:read", antre.izin ?? "(null)");
  cek("cakupannya memang seluruh perusahaan", antre.cakupan === "semua", antre.cakupan);
}

// Tool bercakupan `semua` TANPA izin bukan bug — SOP dan direktori karyawan
// memang untuk semua orang. Yang penting keadaannya terbaca, bukan hilang.
const terbuka = tampilIzin.filter((t) => t.cakupan === "semua" && !t.izin);
console.log(`  cakupan semua tanpa izin: ${terbuka.map((t) => t.kode).join(", ") || "(tidak ada)"}`);
cek("yang terbuka bisa dihitung dari data layar, bukan harus ditebak",
  terbuka.every((t) => t.izin === null));

// ============================================================
console.log("\n=== Izin bisa DISETEL dari layar ===");
// ============================================================
const pilihan = await izinPilihan();
cek("daftar izin terisi", pilihan.length > 0, `${pilihan.length} kode`);
cek("tiap pilihan membawa jumlah peran", pilihan.every((i) => Number.isInteger(i.peran)));
cek("yang ditawarkan semuanya dimiliki minimal satu peran", pilihan.every((i) => i.peran >= 1));

// ⚠️ PEMERIKSAAN PALING PENTING DI BAGIAN INI.
//
// Izin yang salah ketik tidak menghasilkan galat apa pun waktu disimpan —
// tool-nya cuma berhenti muncul untuk SEMUA orang, selamanya. Tidak ada log,
// tidak ada pesan, cuma tool yang menghilang. Jadi ditolak sebelum tersimpan.
for (const buruk of ["tiket:baca", "assignment-ticket:readd", "AAA:read", "x", "ticket read"]) {
  const r = await ubahTool(UJI, { izin: buruk });
  cek(`izin karangan "${buruk}" ditolak`, !r.ok, r.ok ? "MALAH DISIMPAN" : r.sebab.slice(0, 48));
}

const sebelumIzin = (await ringkasTool()).find((t) => t.kode === UJI)?.izin ?? null;
const pasang = await ubahTool(UJI, { izin: "assignment-ticket:read" });
cek("izin sah tersimpan", pasang.ok, pasang.ok ? "" : pasang.sebab);
lupakanKonfig();
cek("layar langsung menampilkannya",
  (await ringkasTool()).find((t) => t.kode === UJI)?.izin === "assignment-ticket:read");

// Bukan cuma tersimpan — harus benar-benar MENGUBAH siapa yang dapat tool-nya.
{
  const kk = await muatKonfig();
  const tt = [...kk.agent.flatMap((a) => a.tool), ...kk.lepas].find((x) => x.kode === UJI)!;
  const sesiKosong = { idEmployee: null, idUsers: null, idDepartment: null, idCompany: null, departemen: null };
  cek("pemakai tanpa izin itu tidak mendapat tool-nya",
    buatToolDariKonfig([tt], { ...sesiKosong, izin: ["ticket:read"] }).tool.length === 0);
  cek("pemakai yang punya izin itu mendapatkannya",
    buatToolDariKonfig([tt], { ...sesiKosong, izin: ["assignment-ticket:read"] }).tool.length === 1);
}

// `null` mencabut, dan itu harus bisa dibedakan dari "tidak disebut".
const cabut = await ubahTool(UJI, { izin: null });
cek("izin bisa dicabut lagi", cabut.ok, cabut.ok ? "" : cabut.sebab);
lupakanKonfig();
cek("sesudah dicabut, syaratnya hilang",
  ((await ringkasTool()).find((t) => t.kode === UJI)?.izin ?? null) === sebelumIzin,
  String((await ringkasTool()).find((t) => t.kode === UJI)?.izin));


// ============================================================
console.log("\n=== Penyaring bisa diatur dari layar ===");
// ============================================================
// ⚠️ Penyaring menentukan PERTANYAAN APA yang bisa dijawab. Tanpa penyaring,
// model cuma bisa mengambil N baris teratas menurut urutan — dan baris yang
// dicari sering ada di luar jendela itu. Terjadi pada klaim MAPS: 26.061 baris
// punya jatuh tempo, tapi tak satu pun masuk 20 teratas menurut tanggal dibuat.
{
  const semula = (await ringkasTool()).find((t) => t.kode === UJI)!;
  cek("layar membawa daftar penyaring", Array.isArray(semula.filter));
  cek(
    "katalog kolom membawa tipe",
    semula.katalog[0]?.tipe !== undefined,
    semula.katalog.slice(0, 3).map((k) => `${k.nama}:${k.tipe}`).join(", "),
  );

  const buruk: [string, { kolom: string; label: string; operator: string }[]][] = [
    ["operator karangan", [{ kolom: "dibuat", label: "x", operator: "antara" }]],
    ["kolom karangan", [{ kolom: "tidak_ada", label: "x", operator: "sama" }]],
    // ⚠️ `dari`/`sampai` di-cast ke tanggal oleh perakit query. Di kolom teks
    // ia GAGAL WAKTU DIPANGGIL, bukan waktu disimpan — administrator baru tahu
    // setelah ada yang bertanya.
    ["`dari` di kolom teks", [{ kolom: "no_ticket", label: "x", operator: "dari" }]],
    ["kolom+operator kembar", [
      { kolom: "dibuat", label: "a", operator: "dari" },
      { kolom: "dibuat", label: "b", operator: "dari" },
    ]],
  ];
  for (const [nama, f] of buruk) {
    const r = await ubahTool(UJI, { filter: f });
    cek(`${nama} ditolak`, !r.ok, r.ok ? "MALAH DISIMPAN" : r.sebab.slice(0, 50));
  }

  lupakanKonfig();
  cek(
    "penyaring tidak berubah sesudah percobaan gagal",
    JSON.stringify((await ringkasTool()).find((t) => t.kode === UJI)!.filter) ===
      JSON.stringify(semula.filter),
  );

  const sah = await ubahTool(UJI, {
    filter: [...semula.filter, { kolom: "dibuat", label: "Dibuat", operator: "dari" }],
  });
  cek("rentang tanggal yang sah diterima", sah.ok, sah.ok ? "" : sah.sebab);

  await ubahTool(UJI, { filter: semula.filter });
  lupakanKonfig();
  cek(
    "dikembalikan seperti semula",
    JSON.stringify((await ringkasTool()).find((t) => t.kode === UJI)!.filter) ===
      JSON.stringify(semula.filter),
  );
}


} finally {
  // ⚠️ SELALU dikembalikan, apa pun yang terjadi di atas.
  await poolKonfig().query(
    `UPDATE ai_tool SET batas = $2, cakupan_bawaan = $3, kolom = $4, updated_at = now()
      WHERE kode = $1 AND updated_by = 'magang'`,
    [UJI, awal.batas, awal.cakupan_bawaan, awal.kolom]);
  const [akhir] = (await baca.query<{ batas: number; cakupan_bawaan: string; kolom: string[] }>(
    `SELECT batas, cakupan_bawaan, kolom FROM ai_tool WHERE kode = $1`, [UJI])).rows;
  console.log(`\nsesudah: ${UJI} batas=${akhir.batas} cakupan=${akhir.cakupan_bawaan} ${akhir.kolom.length} kolom`);
  cek("setelan dikembalikan seperti semula",
    akhir.batas === awal.batas && akhir.cakupan_bawaan === awal.cakupan_bawaan &&
      akhir.kolom.join(",") === awal.kolom.join(","));
  lupakanKonfig();
  await poolKonfig().end();
  await baca.end();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
// ⚠️ `process.exit`, bukan `exitCode`. Sejak `muatKonfig()` ikut membaca
// `ai_tool_agent` di MySQL, pool-nya menahan event loop tetap hidup dan
// skrip ini mencetak hasilnya lalu MENGGANTUNG — lolos tapi tidak pernah
// selesai, yang di CI terbaca sebagai uji yang macet.
process.exit(gagal === 0 ? 0 : 1);
