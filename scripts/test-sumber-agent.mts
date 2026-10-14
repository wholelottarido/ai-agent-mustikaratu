/**
 * Tes saklar sumber data pada agent (Tahap E).
 *
 * Yang dijaga: waktu sumbernya `perusahaan`, agent TIDAK boleh lagi memegang
 * tool MySQL. Kalau ikut terpasang, model punya dua dialek SQL sekaligus dan
 * akan menebak yang mana — persis yang mau dihindari dengan memilih satu
 * sumber.
 *
 * Tidak butuh server, tidak butuh panggilan ke model.
 */
import { pilihTools, buatInstruksi } from "../voltagent/agents.ts";
import { ambilDepartemen } from "../voltagent/index.ts";
import { viewBoleh, viewLintasOrang } from "../voltagent/perusahaan/view-perusahaan.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const hr = ambilDepartemen("hr")!;
const mk = ambilDepartemen("marketing")!;
const org = (idEmployee: string | null) => ({ id: 4, username: "hr2", idEmployee });
const nama = (dep: typeof hr, peran: string, sumber: string, id: string | null = "abc-123") =>
  pilihTools(dep, peran, "claude-haiku-4-5", org(id), sumber).map((t) => t.name);

console.log("--- sumber dummy: perilaku lama tidak berubah ---");
{
  const t = nama(hr, "kepala", "dummy");
  cek(t.includes("query_db"), "hr/kepala dapat query_db");
  cek(t.includes("siapkan_lembur"), "tool entri masih ada");
  cek(!t.includes("query_perusahaan"), "TIDAK dapat tool perusahaan");

  const m = nama(mk, "staf", "dummy");
  cek(m.includes("siapkan_penjualan") && m.includes("query_db"), "marketing/staf normal");
}

console.log("--- sumber perusahaan: tool MySQL dilepas ---");
{
  const t = nama(hr, "kepala", "perusahaan");
  // ⚠️ Yang dijaga BUKAN "tepat satu tool", tapi: ada query_perusahaan,
  // TIDAK ada tool MySQL, dan tidak ada tool entri. `baca_dokumen` ikut
  // karena dokumen unggahan itu data portal, bukan data perusahaan.
  cek(t.includes("query_perusahaan"), "dapat query_perusahaan", t.join(", "));
  cek(t.includes("baca_dokumen"), "dapat baca_dokumen di sumber perusahaan");
  cek(!t.includes("query_db") && !t.includes("cari_teks"), "TIDAK dapat tool MySQL");
  cek(!t.includes("siapkan_lembur") && !t.includes("siapkan_keputusan_lembur"),
    "tool entri & persetujuan DILEPAS");

  // Berlaku untuk semua departemen & peran, bukan cuma HR kepala.
  for (const [d, p, label] of [
    [mk, "staf", "marketing/staf"], [mk, "kepala", "marketing/kepala"],
    [hr, "staf", "hr/staf"]] as const) {
    const x = nama(d, p, "perusahaan");
    cek(x.includes("query_perusahaan") && !x.includes("query_db"),
      `${label} juga dapat query_perusahaan tanpa tool MySQL`, x.join(", "));
  }
}

console.log("--- akun belum dipetakan ---");
{
  // Tool TETAP diberikan, dan tool itu yang menolak dengan penjelasan.
  // Kalau tool-nya dihilangkan, agent cuma bilang "tidak punya akses" tanpa
  // sebab -- dan user tidak tahu apa yang harus dilakukan.
  const t = nama(hr, "kepala", "perusahaan", null);
  cek(t.includes("query_perusahaan"),
    "tetap dapat tool, penolakan dijelaskan tool-nya");
}

console.log("--- kamus data ikut berganti ---");
{
  const dummy = buatInstruksi(hr, "kepala", false, "web", "dummy");
  const usaha = buatInstruksi(hr, "kepala", false, "web", "perusahaan");

  cek(usaha.includes("v_asisten_"), "kamus perusahaan menyebut view v_asisten_");
  cek(usaha.includes("TO_CHAR"), "menyebut dialek PostgreSQL (TO_CHAR)");
  cek(!usaha.includes("siapkan_lembur"), "aturan entri TIDAK ikut (tool-nya tidak ada)");
  cek(!usaha.includes("cari_teks"), "aturan cari_teks TIDAK ikut");
  cek(!dummy.includes("v_asisten_"), "kamus dummy TIDAK menyebut view perusahaan");
  cek(!dummy.includes("TO_CHAR"), "kamus dummy TIDAK menyebut dialek PostgreSQL");
  cek(usaha.length < dummy.length, `prompt perusahaan lebih ramping`,
    `${usaha.length} vs ${dummy.length} karakter`);

  // Dua-duanya harus memberi tahu tanggal hari ini -- kalau tidak, "kemarin"
  // tidak bisa diterjemahkan. Pelajaran 28 Sep.
  cek(usaha.includes("## Hari ini") && dummy.includes("## Hari ini"),
    "dua-duanya menyebut tanggal hari ini");
}

console.log("--- gerbang departemen ada di kamus, bukan cuma di tool ---");
{
  // ⚠️ Kamus dan daftar izin tool dulu DITULIS TERPISAH, dan berbeda: kamus
  // bilang 8 view, mendaftarkan 6, tool mengizinkan 5. Model menuruti kamus,
  // ditolak tool, lalu menjawab user "ada kendala teknis". Sekarang dua-duanya
  // dibangkitkan dari `view-perusahaan.ts`.
  const mkKamus = buatInstruksi(mk, "staf", false, "web", "perusahaan");
  const hrKamus = buatInstruksi(hr, "staf", false, "web", "perusahaan");

  cek(mkKamus.includes("v_asisten_klaim"), "kamus marketing menyebut klaim");
  cek(!hrKamus.includes("v_asisten_klaim"), "kamus HR TIDAK menyebut klaim");
  cek(!hrKamus.includes("klaim"), "kamus HR tidak menyinggung klaim sama sekali");

  // Jumlahnya dihitung, jadi harus cocok dengan daftar izin tool-nya.
  cek(mkKamus.includes(`${viewBoleh("marketing").length} view`),
    `kamus marketing menyebut ${viewBoleh("marketing").length} view`);
  cek(hrKamus.includes(`${viewBoleh("hr").length} view`),
    `kamus HR menyebut ${viewBoleh("hr").length} view`);
  // Jangan dipatok ke angka tetap -- daftarnya memang tumbuh. Yang dijaga:
  // marketing dapat LEBIH, dan tiap tambahannya memang view lintas-orang.
  const lebih = viewBoleh("marketing").filter((v) => !viewBoleh("hr").includes(v));
  cek(lebih.length > 0 && lebih.every((v) => viewLintasOrang("marketing", v)),
    `marketing dapat ${lebih.length} view lebih, semuanya lintas-orang`, lebih.join(", "));
  cek(viewBoleh("hr").every((v) => !viewLintasOrang("hr", v)),
    "HR TIDAK dapat satu pun view lintas-orang");
  cek(mkKamus.includes("v_asisten_penjualan"), "kamus marketing menyebut penjualan");
  cek(!hrKamus.includes("penjualan"), "kamus HR tidak menyinggung penjualan");

  // Angka "8" yang dulu diketik tangan tidak boleh muncul lagi.
  cek(!mkKamus.includes("8 view") && !hrKamus.includes("8 view"),
    "tidak ada lagi jumlah view yang diketik tangan");

  // Peringatan bahwa view marketing BUKAN data penanya harus ada.
  cek(mkKamus.includes("BUKAN data milik user"), "kamus marketing memperingatkan data lintas orang");
}

console.log("--- departemen IT ---");
{
  const it = ambilDepartemen("it")!;
  cek(!!it, "departemen it terdaftar");
  cek(it.db === undefined, "IT TIDAK punya database MySQL dummy");
  cek(!it.entri && !it.persetujuan, "IT baca-saja: tanpa tool entri & persetujuan");

  const kamus = buatInstruksi(it, "staf", false, "web", "perusahaan");
  cek(kamus.includes("v_asisten_tiket"), "kamus IT menyebut view tiket");
  cek(kamus.includes("BUKAN data milik user"), "tiket ditandai lintas orang untuk IT");
  cek(kamus.includes("URGENT"), "jebakan prioritas URGENT ikut");
  cek(!kamus.includes("v_asisten_penjualan") && !kamus.includes("v_asisten_klaim"),
    "kamus IT TIDAK menyebut view marketing");

  // Jebakan tiket TIDAK boleh bocor ke departemen lain: angka 10.084 tidak
  // berlaku untuk mereka karena tiketnya tersaring.
  const hrKamus2 = buatInstruksi(hr, "staf", false, "web", "perusahaan");
  cek(!hrKamus2.includes("hampir tidak bermakna"),
    "jebakan tiket IT TIDAK ikut ke kamus HR");

  // Lingkup view: IT dapat 5, dan tiket ada di sisi lintas.
  cek(viewBoleh("it").length === 5, `IT dapat ${viewBoleh("it").length} view`);
  cek(viewLintasOrang("it", "v_asisten_tiket"), "tiket LINTAS untuk IT");
  cek(!viewLintasOrang("hr", "v_asisten_tiket"), "tiket DIRI untuk HR");
  cek(!viewLintasOrang("marketing", "v_asisten_tiket"), "tiket DIRI untuk marketing");

  // Sumber dummy: IT tidak punya apa-apa, dan itu harus dijelaskan.
  const dummyIt = buatInstruksi(it, "staf", false, "web", "dummy");
  cek(dummyIt.includes("/dbadmin"), "kamus dummy IT menyuruh ganti sumber lewat /dbadmin");
  cek(dummyIt.includes("JANGAN") && dummyIt.toLowerCase().includes("mengarang"),
    "kamus dummy IT melarang mengarang angka");

  const toolIt = nama(it, "staf", "perusahaan");
  cek(toolIt.includes("query_perusahaan") && !toolIt.includes("query_db"),
    "IT dapat query_perusahaan", toolIt.join(", "));
}

console.log("--- sumber tidak dikenal ---");
{
  // Nilai asing diperlakukan seperti dummy, bukan bikin agent kehilangan
  // semua tool. `sumberAktif()` juga sudah menjamin jatuh ke "dummy".
  const t = nama(hr, "kepala", "entah-apa");
  cek(t.includes("query_db"), "sumber asing jatuh ke perilaku dummy", t.join(", "));
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
process.exit(gagal.length === 0 ? 0 : 1);
