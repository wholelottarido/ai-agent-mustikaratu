/**
 * Uji ramalan lewat ROUTER — jalur yang benar-benar dipakai web.
 *
 *   npm run test:ramalan-router
 *   npm run test:ramalan-router -- --model claude-sonnet-5
 *
 * HANYA MEMBACA. Memanggil model sungguhan, ~15-40 detik per kasus.
 *
 * ============================================================
 * ⚠️ KENAPA ADA DUA UJI AGENT, BUKAN SATU
 * ============================================================
 * `test:ramalan-agent` merakit agent Marketing LANGSUNG lewat
 * `buatAgentDariKonfig()`. Semua kasusnya hijau 26 Okt 2026 — dan pada hari
 * yang sama, pertanyaan "prediksi penjualan minyak zaitun" di layar GAGAL.
 *
 * Sebabnya: web tidak memakai agent itu langsung. Web memakai
 * `buatRouter()`, yang menaruh agent umum di DEPAN agent aplikasi dan
 * menyambungkannya lewat `delegate_task`. Router punya instruksinya sendiri,
 * tidak punya tool satu pun — dan dialah yang memutuskan meneruskan atau
 * menjawab sendiri.
 *
 * Yang dia putuskan waktu itu: menjawab sendiri. Ia bertanya balik minta
 * ukuran kemasan dan menyebutkan contohnya dari ingatan — "misalnya 75 ML,
 * 175 ML, dll". Tool `ramal_penjualan` tidak pernah dipanggil, jadi seluruh
 * penjagaan di dalamnya tidak berlaku.
 *
 * Uji yang menguji lapisan yang salah adalah uji yang menenangkan tanpa
 * menjamin apa pun. Berkas ini menguji lapisan yang dipakai pemakai.
 *
 * ⚠️ PENANDANYA STRUKTURAL. Yang diperiksa: tool mana yang BENAR-BENAR
 * jalan (lewat pencatat `catat`, karena tool agent bawahan tidak muncul di
 * `steps` router), dan apakah ukuran kemasan yang disebut jawaban ada di
 * daftar produk yang sungguhan. Mencocokkan susunan kalimat sudah dua kali
 * terbukti rapuh — lihat Tahap 17 di CLAUDE.md.
 */
import { buatRouter } from "../voltagent/agent-konfig.ts";
import { KUNCI_MODEL, KUNCI_SALURAN } from "../voltagent/agents.ts";
import { lupakanKonfig } from "../lib/ai-konfig.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { bulanTerakhirData, cariSku } from "../lib/ramalan/deret.ts";
import { polaBulan } from "./lib/pola-bulan.mts";
import type { Jejak } from "../voltagent/tool-konfigurasi.ts";

const argModel = process.argv.indexOf("--model");
const MODEL = argModel > -1 ? process.argv[argModel + 1] : "claude-haiku-4-5";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

/**
 * Ukuran kemasan yang disebut di teks: "75 ML", "200GR", "135 ml".
 *
 * Inilah bentuk karangan yang muncul di layar. Router tidak punya cara tahu
 * ukuran apa saja yang ada, jadi tiap ukuran yang dia sebut tanpa memanggil
 * tool adalah tebakan yang dibaca pemakai sebagai daftar resmi.
 */
function ukuranDiTeks(t: string): string[] {
  return [...t.matchAll(/\b(\d{1,4})\s*(ML|GR|GRAM|L|KG)\b/gi)]
    .map((m) => `${m[1]}${m[2].toUpperCase()}`);
}

try {
  lupakanKonfig();

  const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
    `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
      WHERE lower(u.username) = 'ridho@mustika-ratu.co.id' LIMIT 1`);
  if (rows.length === 0) throw new Error("akun uji tidak ada");
  const akses = await aksesUntukEmployee(rows[0].id_employee);
  if (!akses) throw new Error("akses akun uji tidak terbaca");

  // Pencatat yang sama dengan yang dipakai `jalur-agent.ts`. Tanpa ini, tool
  // yang jalan di dalam agent bawahan tidak terlihat sama sekali dari sini.
  let alat: string[] = [];
  const catat = (j: Jejak) => { if (!alat.includes(j.alat)) alat.push(j.alat); };

  const router = await buatRouter(akses.sesi, akses.apps, catat);
  if (!router) throw new Error("router tidak terbentuk — agent umum mati?");
  const agentRouter = router.agent;

  const mkt = router.bawahan.find((b) => b.kode === "agent-marketing");
  cek("agent Marketing jadi bawahan router", Boolean(mkt), `${router.bawahan.length} bawahan`);
  cek("router tahu Marketing bisa meramal",
    Boolean(mkt?.bisa.some((n) => /ramal/i.test(n))), mkt?.bisa.filter((n) => /ramal/i.test(n)).join(", "));

  const context = { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" };
  console.log(`model: ${MODEL}\n`);

  async function tanya(t: string): Promise<{ teks: string; alat: string[] }> {
    alat = [];
    const mulai = Date.now();
    const r = (await agentRouter.generateText(t, { context })) as { text?: string };
    console.log(`  (${((Date.now() - mulai) / 1000).toFixed(0)} dtk) alat: ${alat.join(", ") || "(TIDAK ADA)"}`);
    console.log(`  ${String(r.text ?? "").replace(/\s+/g, " ").slice(0, 200)}\n`);
    return { teks: String(r.text ?? ""), alat: [...alat] };
  }

  // ============================================================
  console.log("=== 1. ⚠️ KASUS YANG GAGAL DI LAYAR: nama produk belum lengkap ===");
  // ============================================================
  // Ini pertanyaan yang persis sama dengan yang gagal 26 Okt 2026.
  {
    const nyata = await cariSku("minyak zaitun", 8);
    const ukuranNyata = new Set(nyata.flatMap((c) => ukuranDiTeks(c.nama)));
    console.log(`  ukuran yang BENAR ada: ${[...ukuranNyata].join(", ") || "(tidak terbaca)"}\n`);

    const h = await tanya("Prediksi penjualan minyak zaitun");

    // ⚠️ INTI UJI INI. Router yang menjawab sendiri tidak akan pernah
    // memunculkan nama tool di sini.
    cek("router MENERUSKAN — ramal_penjualan benar-benar dipanggil",
      h.alat.includes("ramal_penjualan"), h.alat.join(", ") || "tidak ada tool yang jalan");

    const disebut = ukuranDiTeks(h.teks);
    const karangan = disebut.filter((u) => !ukuranNyata.has(u));
    cek("tidak menyebut ukuran kemasan yang tidak ada di database",
      karangan.length === 0,
      karangan.length ? `ukuran karangan: ${[...new Set(karangan)].join(", ")}` : `${disebut.length} ukuran, semuanya nyata`);

    // Ambigu berarti bertanya, bukan memilihkan.
    cek("tidak menyodorkan angka ramalan untuk produk yang belum dipilih",
      !/\b\d{1,3}(?:[.,]\d{3})+\b/.test(h.teks) || /mana|pilih|maksud/i.test(h.teks),
      h.teks.replace(/\s+/g, " ").slice(0, 70));
  }

  // ============================================================
  console.log("=== 2. Nama lengkap -> diteruskan dan dijawab ===");
  // ============================================================
  {
    const h = await tanya("Prediksi penjualan MINYAK ZAITUN 175 ML RJ untuk 3 bulan ke depan");
    cek("ramal_penjualan dipanggil lewat router", h.alat.includes("ramal_penjualan"),
      h.alat.join(", ") || "tidak ada tool yang jalan");
    cek("jawabannya membawa ketepatan (WAPE)", /wape|ketepatan|akurasi|%/i.test(h.teks));
    cek("menyebut bulan terakhir data", polaBulan((await bulanTerakhirData()) ?? "").test(h.teks));
  }

  // ============================================================
  console.log("=== 3. ⚠️ Produk yang datanya berhenti lama -> bukan 'ke depan' ===");
  // ============================================================
  // `BODY S ROSE MANGO 135 ML RJ` penjualan terakhirnya Mar 2026, sementara
  // data perusahaan sudah sampai Jul 2026 — empat bulan tanpa penjualan.
  //
  // Di layar (26 Okt 2026) sistem menyajikan "3 bulan ke depan (April-Juni
  // 2026)". Sejak `BULAN_BERHENTI` dipasang, produk seperti ini TIDAK
  // diramal sama sekali: tool memulangkan `produk-berhenti`.
  {
    // BODY S ROSE MANGO terjual lagi 3 unit di Sep 2026, jadi tidak lagi berhenti (terlihat 4 Nov 2026).
    const h = await tanya("Prediksi penjualan MINYAK CEMCEMAN 175 ML RJ+M.ZAITUN 12ML untuk 3 bulan ke depan");
    cek("ramal_penjualan dipanggil", h.alat.includes("ramal_penjualan"), h.alat.join(", ") || "tidak ada");
    // ⚠️ INTI: tidak boleh ada angka ramalan sama sekali. Tool memang tidak
    // memulangkannya; yang diuji di sini apakah model menahan diri untuk
    // tidak mengarang penggantinya.
    const angkaBesar = [...h.teks.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b/g)].map((m) => m[0]);
    cek("tidak menyodorkan angka ramalan untuk produk berhenti",
      angkaBesar.length === 0, angkaBesar.slice(0, 3).join(", ") || "tidak ada angka");
    cek("mengaku produknya sudah tidak terjual",
      /berhenti|tidak .*(terjual|dijual)|sudah tidak|discontinu/i.test(h.teks),
      h.teks.replace(/\s+/g, " ").slice(0, 90));
  }

  // ============================================================
  console.log("=== 4. Penyeimbang: pertanyaan historis bukan ramalan ===");
  // ============================================================
  {
    const h = await tanya("Berapa total penjualan bulan lalu?");
    cek("tidak memakai ramal_penjualan untuk data historis",
      !h.alat.includes("ramal_penjualan"), h.alat.join(", ") || "tidak ada tool");
  }
} finally {
  await poolPerusahaan().end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (gagal > 0) process.exitCode = 1;
  // Sambungan MySQL menahan program tetap hidup, dan hasil yang disaring baru tampil sesudah program berhenti.
  process.stdout.write("", () => process.exit());
}
