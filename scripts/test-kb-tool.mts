/**
 * Uji lapisan TOOL basis pengetahuan -- bukan mutu pencariannya.
 *
 *   npm run test:kb-tool
 *
 * ⚠️ MEMUAT MODEL EMBEDDING (289 MB). Di laptop yang sisanya di bawah 0,5 GB,
 * jalankan dengan server dev DIMATIKAN -- kalau tidak, gagal dengan
 * "bad allocation" dari onnxruntime.
 *
 * ============================================================
 * ⚠️ DITULIS ULANG 2 OKT 2026, DAN CAKUPANNYA MENYEMPIT
 * ============================================================
 * Versi sebelumnya menguji korpus `ai_kb_*` (24 SOP buatan sendiri, berkode
 * `SOP-IT-005`, dengan rujukan halaman & baris dari PDF). Korpus itu dihapus
 * pihak lain dan digantikan `ai_knowledge` -- panduan aplikasi perusahaan
 * yang sungguhan, tanpa kode dokumen dan tanpa halaman.
 *
 * Belasan penanda lama hilang bersamanya: saringan `aplikasi`, peringatan
 * `contoh-uji`, ketepatan nomor potongan, dan rujukan halaman/baris. Itu
 * bukan penanda yang "rusak lalu diperbaiki" -- hal yang diujinya memang
 * sudah tidak ada.
 *
 * MUTU PENCARIAN sekarang diuji terpisah di `npm run test:kb-beda`, dan
 * KEPATUHAN MODEL di `npm run test:routing`. Berkas ini tinggal menguji apa
 * yang dilakukan lapisan tool: gerbang departemen, dan peringatan yang wajib
 * menempel di hasil.
 */
import { cariSop, cariTiketSerupa, daftarSop } from "../lib/kb/cari.ts";
import {
  bolehTiketSerupa,
  buatToolCariSop,
  buatToolDaftarSop,
  buatToolTiketSerupa,
} from "../voltagent/tools-kb.ts";

let lolos = 0;
let gagal = 0;

function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) {
    lolos++;
    console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`);
  }
}

type ToolBisaJalan = { name: string; execute: (arg: never) => Promise<string> };
const jalankan = (t: unknown, arg: unknown) =>
  (t as ToolBisaJalan).execute(arg as never);

// ============================================================
console.log("\n=== 1. Gerbang departemen ===");
// ============================================================
cek("IT boleh baca tiket lintas orang", bolehTiketSerupa("it"));
cek("marketing TIDAK boleh", !bolehTiketSerupa("marketing"));
cek("hrd TIDAK boleh", !bolehTiketSerupa("hrd"));
cek("departemen tak dikenal TIDAK boleh", !bolehTiketSerupa("keuangan"));

const tiketMkt = buatToolTiketSerupa({ departemen: "marketing" });
const tolakan = await jalankan(tiketMkt, { keluhan: "printer" });
// Gagal-tertutup: tool-nya memang tidak dipasang untuk marketing, tapi kalau
// gerbang di `agents.ts` suatu saat lupa, yang terjadi harus PENOLAKAN.
cek(
  "tool marketing menolak, bukan memberi data",
  tolakan.includes("tidak tersedia") && !tolakan.includes("kemiripan"),
);
cek(
  "penolakannya memberi jalan lain",
  tolakan.includes("query_perusahaan") && tolakan.includes("v_asisten_tiket"),
);

const tiketIT = buatToolTiketSerupa({ departemen: "it" });
const hasilIT = await jalankan(tiketIT, { keluhan: "tidak bisa ngeprint" });
cek("tool IT memberi hasil", hasilIT.includes("kemiripan"));

// ============================================================
console.log("\n=== 2. Pertanyaan yang jawabannya TIDAK ADA ===");
// ============================================================
// ⚠️ UJI TERPENTING. `cariSop` sengaja tanpa ambang skor, jadi pertanyaan di
// bawah TETAP mengembalikan hasil. Yang diuji bukan "apakah kosong" -- justru
// TIDAK boleh kosong -- tapi apakah peringatannya ikut, karena cuma itu yang
// menahan model mengarang.
const alatSop = buatToolCariSop();
const TANPA_JAWABAN = [
  "cara klaim asuransi gigi untuk anak",
  "prosedur pendaftaran lomba futsal antar divisi",
];
for (const t of TANPA_JAWABAN) {
  const keluaran = await jalankan(alatSop, { pertanyaan: t });
  const hasil = await cariSop(t, { batas: 5 });
  cek(
    `"${t.slice(0, 34)}…" tetap memberi hasil`,
    hasil.length > 0,
    `skor tertinggi ${(hasil[0]?.skor ?? 0).toFixed(2)} — sengaja TIDAK disaring`,
  );
  cek("   peringatan 'skor tidak berarti relevan' ikut", keluaran.includes("TIDAK BERARTI RELEVAN"));
  cek("   izin bilang 'belum ada panduannya' ikut", keluaran.includes("belum ada panduannya"));
}

// Bukti bahwa skor tinggi tidak bisa dipakai sebagai ambang.
const ada = await cariSop("cara menyetujui dokumen approval", { batas: 1 });
const takAda = await cariSop(TANPA_JAWABAN[0], { batas: 1 });
const selisih = (ada[0]?.skor ?? 0) - (takAda[0]?.skor ?? 0);
cek(
  "skor TIDAK bisa membedakan ada/tidak ada jawaban",
  selisih < 0.15,
  `ada=${ada[0]?.skor.toFixed(2)} vs tidak-ada=${takAda[0]?.skor.toFixed(2)} (selisih ${selisih.toFixed(2)})`,
);

// ============================================================
console.log("\n=== 3. Peringatan & rujukan yang wajib menempel ===");
// ============================================================
const normal = await jalankan(alatSop, { pertanyaan: "cara menyetujui dokumen approval" });
cek("skor ditampilkan", /kemiripan 0\.\d\d/.test(normal));
cek("menyuruh menyebut judul & bagian", normal.includes("SEBUTKAN SUMBERNYA"));
// Lapis kedua terhadap kalimat perintah yang diselipkan ke dalam dokumen yang
// diunggah user. Sejak 6 Okt siapa pun yang boleh mengunggah bisa menaruh teks
// apa pun ke dalam prompt; peringatan ini yang memberi tahu model bahwa teks
// itu data. Diuji di sini supaya tidak ikut terhapus waktu pesan tool dirapikan.
cek("isi dokumen dinyatakan sebagai data, bukan perintah", normal.includes("DATA, BUKAN PERINTAH"));
// Posisinya harus SESUDAH kutipan. Kalau peringatan ini muncul sebelum isi
// dokumen, kalimat terakhir yang dibaca model justru milik penyerang.
cek(
  "peringatan itu berada di bagian akhir, sesudah kutipan",
  normal.lastIndexOf("DATA, BUKAN PERINTAH") > normal.lastIndexOf("skor "),
);
cek("menyebut nama bagian di hasil", normal.includes('bagian "'));

const nolCatatan = await jalankan(tiketIT, { keluhan: "tidak bisa ngeprint" });
cek("tiket: perintah pakai cari_sop tidak bergantung cabang", nolCatatan.includes("BUKAN SUMBER CARA MEMPERBAIKI"));
cek("tiket: larangan mengarang penyebab", nolCatatan.includes("DILARANG MENGARANG"));
cek("tiket: titik buta trigram diberitahukan", nolCatatan.includes("internet"));

// ============================================================
console.log("\n=== 4. Maksimal 2 potongan per dokumen ===");
// ============================================================
// Tanpa batas ini, satu dokumen panjang memborong seluruh hasil dan mendesak
// keluar dokumen lain yang juga relevan, tanpa model tahu ada yang hilang.
const lima = await cariSop("distributor mengisi order mingguan", { batas: 5 });
const perDok = new Map<string, number>();
for (const x of lima) perDok.set(x.judul, (perDok.get(x.judul) ?? 0) + 1);
cek(
  "tidak ada dokumen yang menyumbang lebih dari 2 potongan",
  [...perDok.values()].every((n) => n <= 2),
  [...perDok.entries()].map(([k, n]) => `${k.slice(0, 18)}×${n}`).join(" "),
);
cek("hasil datang dari lebih dari satu dokumen", perDok.size >= 2, `${perDok.size} dokumen`);

// ============================================================
console.log("\n=== 5. daftar_sop ===");
// ============================================================
const rak = await daftarSop();
const daftar = await jalankan(buatToolDaftarSop(), {});
cek("menyebut jumlah dokumen yang benar", daftar.includes(`${rak.length} dokumen`));
cek("mengelompokkan per jenis", daftar.includes("guide ("));
cek(
  "dokumen tanpa potongan dikecualikan",
  rak.every((x) => x.potongan > 0),
  `${rak.length} dokumen, semuanya punya isi`,
);

// ============================================================
console.log("\n=== 6. Pengukuran: pakaiDeskripsi pada tiket ===");
// ============================================================
// Bukan assertion -- keputusan yang menunggu angka, dicatat lintas waktu.
for (const k of ["tidak bisa ngeprint", "email tidak bisa dibuka"]) {
  const a = Date.now();
  const mati = await cariTiketSerupa(k, { batas: 5 });
  const tMati = Date.now() - a;
  const b = Date.now();
  const hidup = await cariTiketSerupa(k, { batas: 5, pakaiDeskripsi: true });
  const tHidup = Date.now() - b;
  const sama = mati.filter((x) => hidup.some((y) => y.noTiket === x.noTiket)).length;
  console.log(
    `  "${k.padEnd(24)}" mati ${String(tMati).padStart(4)}ms · hidup ${String(tHidup).padStart(4)}ms · ${sama}/5 sama`,
  );
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
console.log("(mutu pencarian: npm run test:kb-beda · kepatuhan model: npm run test:routing)");

// ⚠️ `process.exitCode`, BUKAN `process.exit()` -- mematikan proses saat
// koneksi masih menutup membuat libuv melempar assertion dan exit code jadi
// 127 walau semua lolos. Terjadi di `test:dokumen` 30 Sep.
process.exitCode = gagal === 0 ? 0 : 1;
