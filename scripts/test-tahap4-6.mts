/**
 * Uji Tahap 4–6 (F.6 periode, F.7 sapaan, F.8 pilihan tiket) — unit + integrasi OFFLINE.
 *   npm run test:tahap4-6
 *
 * Tanpa model sungguhan, tanpa database, tanpa biaya. Integrasi memakai agent VoltAgent sungguhan dengan
 * hook yang SAMA dengan produksi (`voltagent/kendali-alur.ts`) dan server tiruan dua format
 * (OpenAI-compatible untuk Qwen, Anthropic). Kontrol negatif: `UJI_TANPA_PENJAGA=1`.
 */
import { Agent, createTool } from "@voltagent/core";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { mulaiServerTiruan, type Format, type Jawaban, type Permintaan } from "./lib/server-tiruan.mts";
import { periodeDalamTeks, pilihanBerdasar, sapaanAtauKemampuan, POLA_ARG_PERIODE } from "../lib/alur/pola-teks.ts";
import { buatPemegangPenjaga, buatPenjagaAlur, TEKS_TERIMA_KASIH } from "../lib/alur/penjaga-alur.ts";
import { jagaPotongan } from "../lib/alur/jaga-stream.ts";
import { hookBawahan, kendaliPerute, metaAlat, teksKemampuan } from "../voltagent/kendali-alur.ts";
import { masalahJadiTeks } from "../lib/entri/tiket.ts";
import { klarifikasiTulis } from "../voltagent/registry-tulis.ts";

const KONTROL = process.env.UJI_TANPA_PENJAGA === "1";
if (KONTROL) console.log("⚠️  KONTROL NEGATIF: tanpa penjaga (perilaku sebelum Tahap 2–6)");
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };
const ui = (peran: "user" | "assistant", teks: string) => ({ id: Math.random().toString(36), role: peran, parts: [{ type: "text", text: teks }] });

if (!KONTROL) {
  // ================================================================== unit: sapaan (Tahap 5)
  console.log("— sapaan / kemampuan");
  const sapaPositif: [string, string][] = [
    ["Halo, kamu bisa bantu apa saja?", "kemampuan"], ["halo", "sapaan"], ["Selamat pagi Ratu AI", "sapaan"],
    ["hai kak, kamu siapa?", "kemampuan"], ["apa yang bisa kamu bantu?", "kemampuan"], ["fiturmu apa saja?", "kemampuan"],
    ["terima kasih ya", "terima-kasih"], ["Makasih banyak!", "terima-kasih"], ["Assalamualaikum", "sapaan"],
  ];
  for (const [t, j] of sapaPositif) cek(`sapaan dikenali: "${t}" → ${j}`, sapaanAtauKemampuan(t) === j, String(sapaanAtauKemampuan(t)));
  const sapaNegatif = ["SOP apa saja yang ada?", "halo, tiket saya gimana?", "bisa bantu cek stok lulur?", "kamu bisa bantu saya buat tiket?",
    "produk apa saja yang dijual?", "ya", "ok", "tolong buatkan tiket", "halo, berapa penjualan September 2026?", "siapa yang menyetujui cuti?"];
  for (const t of sapaNegatif) cek(`BUKAN sapaan (butuh data / jawaban atas tawaran): "${t}"`, sapaanAtauKemampuan(t) === null, String(sapaanAtauKemampuan(t)));

  // ================================================================== unit: periode (Tahap 4)
  console.log("— periode dari kalimat pengguna (hari ini 2026-11)");
  const p = (t: string) => periodeDalamTeks(t, "2026-11");
  const sama = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  cek("'September 2026' → 2026-09", sama([p("Berapa total penjualan September 2026?")?.dari, p("Berapa total penjualan September 2026?")?.sampai], ["2026-09", "2026-09"]));
  cek("'juli sampai september 2026' → 2026-07..09", sama([p("penjualan juli sampai september 2026")?.dari, p("penjualan juli sampai september 2026")?.sampai], ["2026-07", "2026-09"]));
  cek("'Sept 2026' (singkatan) → 2026-09", p("omzet Sept 2026")?.dari === "2026-09");
  cek("'desember' tanpa tahun → yang terakhir lewat (2025-12)", p("penjualan desember")?.dari === "2025-12");
  cek("'oktober' tanpa tahun → 2026-10", p("stok kosong oktober")?.dari === "2026-10");
  cek("'bulan lalu' → relatif bulan_lalu", p("total penjualan bulan lalu")?.relatif === "bulan_lalu");
  cek("'tahun ini' → relatif tahun_ini", p("penjualan tahun ini")?.relatif === "tahun_ini");
  cek("'2026-08' → 2026-08", p("data 2026-08")?.dari === "2026-08");
  cek("'tahun 2025' → 2025-01..12", sama([p("penjualan tahun 2025")?.dari, p("penjualan tahun 2025")?.sampai], ["2025-01", "2025-12"]));
  cek("'penjualan terbaru' → tidak ada periode", p("berapa total penjualan terbaru?") === null);
  cek("nama produk tanpa bulan → tidak ada periode", p("total penjualan Masker Beras 100g") === null);
  cek("pola nama argumen periode (dari/sampai/bulan/relatif/tanggal_mulai) — bukan produk/merek",
    ["dari", "sampai", "bulan", "relatif", "tanggal_mulai", "periode"].every((k) => POLA_ARG_PERIODE.test(k)) && !["produk", "merek", "menurut"].some((k) => POLA_ARG_PERIODE.test(k)));

  // ================================================================== unit: pilihan pengguna (Tahap 6)
  console.log("— pilihan harus dari pengguna");
  cek("'LAN' tidak berdasar pada 'internet mati'", !pilihanBerdasar("LAN", "internet di ruangan saya mati, tolong buatkan tiket"));
  cek("'WIFI' berdasar pada 'wifi kantor mati'", pilihanBerdasar("WIFI", "wifi kantor mati, buatkan tiket"));
  cek("'Wi-Fi' berdasar pada 'wifi' (tanda baca/spasi diabaikan)", pilihanBerdasar("Wi-Fi", "wifi mati"));
  cek("jawaban nomor '2' → pilihan kedua", pilihanBerdasar("WIFI", "2", ["LAN", "WIFI", "VPN"], "2") && !pilihanBerdasar("VPN", "2", ["LAN", "WIFI", "VPN"], "2"));
  cek("tombol web 'LAN (kode 12)' berdasar", pilihanBerdasar("LAN", "LAN (kode 12)"));

  console.log("— klarifikasi tombol, teks kemampuan, pesan tiket");
  const kl = klarifikasiTulis({ status: "perlu-perbaikan", masalah: [{ jenis: "kurang", label: "Sub-kategori", pilihan: [{ nilai: "12", label: "LAN" }, { nilai: "13", label: "WIFI" }] }] });
  cek("pilihan sah dari alat tulis → tombol klarifikasi {kode,nama}", sama(kl?.pilihan, [{ kode: "12", nama: "LAN" }, { kode: "13", nama: "WIFI" }]) && kl?.pesan === "Sub-kategori mana yang dimaksud?");
  cek("tanpa pilihan / status lain → tidak ada tombol", !klarifikasiTulis({ status: "perlu-perbaikan", masalah: [{ jenis: "kurang", label: "Judul" }] }) && !klarifikasiTulis({ status: "siap" }));
  cek("pilihan berupa teks (alat tulis umum) juga jadi tombol", klarifikasiTulis({ status: "perlu-perbaikan", masalah: [{ label: "Jenis", pilihan: ["Tahunan", "Sakit"] }] })?.pilihan.length === 2);
  cek("pesan 'kurang' menyebut pilihan yang sah", masalahJadiTeks([{ jenis: "kurang", kolom: "id_sub_category", label: "Sub-kategori", pilihan: [{ nilai: "1", label: "LAN" }, { nilai: "2", label: "WIFI" }] }]).includes("Pilihannya: LAN, WIFI"));
  const km = teksKemampuan("Ratu AI", [{ nama: "Ratu AI Portal", bisa: ["Tiket helpdesk", "Cari SOP"] }, { nama: "Ratu AI Marketing", bisa: ["Total penjualan"] }]);
  cek("teks kemampuan disusun dari agent & alat yang terpasang", km.includes("Ratu AI Portal") && km.includes("Cari SOP") && km.includes("Total penjualan"));
  cek("teks kemampuan tanpa agent → minta akses, tidak menjanjikan apa pun", teksKemampuan("Ratu AI", []).includes("belum ada asisten aplikasi"));
  const contohAlat = createTool({ name: "x", description: "x", tags: ["pilihan-pengguna:sub"], parameters: z.object({ dari: z.string().optional(), sub: z.string().optional() }), execute: async () => ({}) });
  cek("metaAlat membaca nama argumen & tag dari definisi alat", sama(metaAlat(contohAlat), { argumen: ["dari", "sub"], tag: ["pilihan-pengguna:sub"] }), JSON.stringify(metaAlat(contohAlat)));

  // ================================================================== unit: penjaga
  console.log("— penjaga: sapaan");
  {
    const pp = buatPemegangPenjaga(); pp.pakaiKemampuan(km);
    const r = pp.ambil().periksaDelegasi({ task: "Halo, kamu bisa bantu apa saja?", targetAgents: ["Ratu AI Portal"] }, [ui("user", "Halo, kamu bisa bantu apa saja?")]);
    cek("sapaan yang didelegasikan → ditolak + berhenti", !r.boleh && r.galat.kode === "sapaan-langsung" && pp.ambil().harusBerhenti());
    cek("…penutup = teks kemampuan dari daftar agent", pp.ambil().teksPenutup("") === km);
    const t = buatPenjagaAlur();
    t.periksaDelegasi({ task: "x", targetAgents: ["Portal"] }, [ui("user", "terima kasih ya")]);
    cek("terima kasih → 'sama-sama', tanpa delegasi", t.teksPenutup("") === TEKS_TERIMA_KASIH);
    const sop = buatPenjagaAlur().periksaDelegasi({ task: "SOP apa saja yang ada?", targetAgents: ["Portal"] }, [ui("user", "SOP apa saja yang ada?")]);
    cek("'SOP apa saja yang ada?' TETAP diteruskan", sop.boleh);
    const tawar = buatPenjagaAlur().periksaDelegasi({ task: "User menyetujui tawaran sebelumnya: siapkan tiket helpdesk", targetAgents: ["Portal"] },
      [ui("assistant", "Apakah Anda ingin saya menyiapkan tiket helpdesk?"), ui("user", "ok")]);
    cek("'ok' atas tawaran yang menunggu TIDAK dianggap sapaan", tawar.boleh);
    const mentah = buatPemegangPenjaga(); mentah.pakaiKemampuan(km); mentah.ambil().mulai([ui("user", "Halo, kamu bisa bantu apa saja?")]);
    cek("perute menulis panggilan alat mentah untuk sapaan (tersaring habis) → teks kemampuan, bukan 'belum selesai'",
      mentah.ambil().saring('delegate_task ke Portal, isinya "halo"').teks === "" && mentah.ambil().teksPenutup("") === km);
  }
  console.log("— penjaga: periode");
  {
    const meta = { argumen: ["relatif", "dari", "sampai", "produk", "merek"] };
    const q = buatPenjagaAlur({ hariIni: () => "2026-11" }); q.mulai([ui("user", "Berapa total penjualan September 2026?")]);
    const r1 = q.periksaAlat("Marketing", "total_penjualan", {}, [], "a1", meta);
    cek("argumen periode kosong padahal pengguna menyebut September 2026 → ditolak SEBELUM jalan", !r1.boleh && r1.galat.kode === "perlu-periode");
    cek("…pesannya memberi periode yang dihitung kode: dari=2026-09, sampai=2026-09", !r1.boleh && String(r1.galat.hasil.pesan).includes('dari="2026-09", sampai="2026-09"'));
    cek("…panggilan ulang dengan periode → boleh", q.periksaAlat("Marketing", "total_penjualan", { dari: "2026-09", sampai: "2026-09" }, [], "a2", meta).boleh);
    cek("…kalau model TETAP mengosongkan, diloloskan (tidak berputar)", q.periksaAlat("Marketing", "total_penjualan", {}, [], "a3", meta).boleh);
    const g = q.catatHasilAlat("Marketing", "total_penjualan", { status: "siap", periode: { dari: "2026-10", sampai: "2026-10" } }, "a3", undefined, meta) as Record<string, unknown> | undefined;
    cek("…dan hasilnya ditandai periode_otomatis + catatan", g?.periode_otomatis === true && String(g?.catatan_periode).includes("JANGAN menyimpulkan"));
    cek("hasil yang sudah membawa periode_otomatis (dari alatnya sendiri) tidak ditimpa",
      q.catatHasilAlat("Marketing", "total_penjualan", { status: "siap", periode_otomatis: true }, "a3", undefined, meta) === undefined);
    const baru = buatPenjagaAlur({ hariIni: () => "2026-11" }); baru.mulai([ui("user", "berapa total penjualan terbaru?")]);
    cek("'terbaru' tanpa periode → langsung boleh (tidak ada panggilan tambahan)", baru.periksaAlat("Marketing", "total_penjualan", {}, [], "b1", meta).boleh);
    const stok = buatPenjagaAlur({ hariIni: () => "2026-11" }); stok.mulai([ui("user", "produk apa yang paling sering kosong bulan Oktober?")]);
    const rs = stok.periksaAlat("Marketing", "stok_kosong", { menurut: "produk" }, [], "s1", { argumen: ["bulan", "relatif", "menurut"] });
    cek("alat lain (stok_kosong, argumen `bulan`) ikut terjaga → saran bulan=2026-10", !rs.boleh && String(rs.galat.hasil.pesan).includes('bulan="2026-10"'));
    const lalu = buatPenjagaAlur({ hariIni: () => "2026-11" }); lalu.mulai([ui("user", "pergerakan penjualan bulan lalu")]);
    const rl = lalu.periksaAlat("Marketing", "pergerakan_penjualan", {}, [], "l1", { argumen: ["bulan", "relatif", "dibanding_bulan", "arah", "merek"] });
    cek("'bulan lalu' → saran relatif=bulan_lalu", !rl.boleh && String(rl.galat.hasil.pesan).includes('relatif="bulan_lalu"'));
    const tulis = buatPenjagaAlur({ hariIni: () => "2026-11" }); tulis.mulai([ui("user", "ajukan cuti 5 Desember")]);
    cek("alat tulis `siapkan_*` TIDAK kena aturan periode (memvalidasi isiannya sendiri)", tulis.periksaAlat("HR", "siapkan_cuti", {}, [], "c1", { argumen: ["tanggal_mulai", "tanggal_akhir"] }).boleh);
    const tanpa = buatPenjagaAlur({ hariIni: () => "2026-11" }); tanpa.mulai([ui("user", "status tiket saya")]);
    cek("alat tanpa argumen periode tidak terpengaruh", tanpa.periksaAlat("Portal", "tiket_saya", {}, [], "t1", { argumen: ["status"] }).boleh);
  }
  console.log("— penjaga: pilihan sub-kategori");
  {
    const meta = { argumen: ["kategori", "sub_kategori", "judul", "deskripsi"], tag: ["pilihan-pengguna:sub_kategori"] };
    const a = buatPenjagaAlur(); a.mulai([ui("user", "internet di ruangan saya mati, tolong buatkan tiket")]);
    const args: Record<string, unknown> = { kategori: "NETWORK", sub_kategori: "LAN", judul: "Internet mati", deskripsi: "internet mati" };
    const r = a.periksaAlat("Portal", "siapkan_tiket", args, [], "k1", meta);
    cek("sub-kategori yang TIDAK disebut pengguna dikosongkan sebelum alat jalan", r.boleh && args.sub_kategori === "" && !!r.dikosongkan?.includes("sub_kategori"));
    cek("…kategori (penafsiran keluhan) tidak disentuh", args.kategori === "NETWORK");
    const b = buatPenjagaAlur(); b.mulai([ui("user", "internet mati"), ui("assistant", "Sub-kategori mana yang dimaksud?\n- LAN\n- WIFI"), ui("user", "WIFI")]);
    const args2: Record<string, unknown> = { kategori: "NETWORK", sub_kategori: "WIFI" };
    cek("pilihan yang ditulis pengguna di giliran berikutnya dipertahankan", b.periksaAlat("Portal", "siapkan_tiket", args2, [], "k2", meta).boleh && args2.sub_kategori === "WIFI");
    const c = buatPenjagaAlur(); c.mulai([ui("user", "internet mati"), ui("assistant", "Sub-kategori mana yang dimaksud?\n- LAN\n- WIFI"), ui("user", "2")]);
    const args3: Record<string, unknown> = { kategori: "NETWORK", sub_kategori: "WIFI" };
    cek("jawaban nomor '2' dipetakan ke pilihan kedua", c.periksaAlat("Portal", "siapkan_tiket", args3, [], "k3", meta).boleh && args3.sub_kategori === "WIFI");
    const d = buatPenjagaAlur(); d.mulai([ui("user", "printer saya bergaris, buatkan tiket")]);
    const args4: Record<string, unknown> = { kategori: "HARDWARE", sub_kategori: "PRINTER" };
    d.periksaAlat("Portal", "siapkan_tiket", args4, [], "k4", meta);
    cek("pengguna menyebut 'printer' → sub-kategori PRINTER dipertahankan (tidak menambah giliran tanya)", args4.sub_kategori === "PRINTER");
    const e = buatPenjagaAlur(); e.mulai([ui("user", "internet mati, buatkan tiket")]);
    const args5: Record<string, unknown> = { kategori: "NETWORK", sub_kategori: "LAN" };
    e.periksaAlat("Portal", "siapkan_tiket", args5, [], "k5", { argumen: meta.argumen });
    cek("alat TANPA tag pilihan-pengguna tidak disentuh (perilaku lama)", args5.sub_kategori === "LAN");
  }
}

// ==================================================================== integrasi offline
const srv = await mulaiServerTiruan();
const model = (f: Format) => f === "anthropic"
  ? createAnthropic({ baseURL: srv.url(f), apiKey: "tiruan" })("claude-tiruan")
  : createOpenAICompatible({ name: "tiruan", baseURL: srv.url(f), apiKey: "tiruan" })("tiruan");
type Penjawab = { kunci: string; jawab: (p: Permintaan) => Jawaban };
const daftar: Penjawab[] = [];
srv.setel((p) => (daftar.find((d) => p.teksPesan.includes(d.kunci))?.jawab ?? (() => ({ teks: "?" })))(p));
const ke = (p: Permintaan) => p.hasilAlat.length;
const delegasi = (task: string, ...targetAgents: string[]): Jawaban => ({ alat: [{ nama: "delegate_task", argumen: { task, targetAgents } }] });
const alat = (nama: string, argumen: Record<string, unknown>): Jawaban => ({ alat: [{ nama, argumen }] });
const panggilan = (kunci: string, peran: "perute" | "bawahan") => srv.catatan.filter((p) => p.teksPesan.includes(kunci) && p.peran === peran);

function rakit(f: Format) {
  const pp = buatPemegangPenjaga({ idSesi: "uji", hariIni: () => "2026-11" });
  const catat = { penjualan: [] as Record<string, unknown>[], tiket: [] as Record<string, unknown>[], sop: 0 };
  const totalPenjualan = createTool({
    name: "total_penjualan", description: "Total penjualan per bulan (tiruan).",
    parameters: z.object({ relatif: z.string().optional(), dari: z.string().optional(), sampai: z.string().optional(), produk: z.string().optional() }),
    execute: async (a: Record<string, unknown>) => {
      catat.penjualan.push({ ...a });
      const bulan = (a.dari as string) || "2026-10";
      return { status: "siap", periode: { dari: bulan, sampai: (a.sampai as string) || bulan }, total_rupiah: bulan === "2026-09" ? 156770 : 99999 };
    },
  });
  const daftarSop = createTool({ name: "daftar_sop", description: "Daftar SOP (tiruan).", parameters: z.object({}), execute: async () => { catat.sop++; return { status: "siap", sop: ["SOP Cuti"] }; } });
  const tiket = createTool({
    name: "siapkan_tiket", description: "Rancangan tiket (tiruan).", tags: ["pilihan-pengguna:sub_kategori"],
    parameters: z.object({ kategori: z.string().optional(), sub_kategori: z.string().optional(), judul: z.string().optional() }),
    execute: async (a: Record<string, unknown>) => {
      catat.tiket.push({ ...a });
      const sub = String(a.sub_kategori ?? "").toUpperCase();
      if (!["LAN", "WIFI"].includes(sub)) {
        return { status: "perlu-perbaikan", pesan: "Sub-kategori belum dipilih. Pilihannya: LAN, WIFI.",
          masalah: [{ jenis: "kurang", label: "Sub-kategori", pilihan: [{ nilai: "12", label: "LAN" }, { nilai: "13", label: "WIFI" }] }] };
      }
      return { status: "siap", sidik: `sdk-${sub}`, draf: { ...a } };
    },
  });
  const mk = (nama: string, tools: unknown[]) => new Agent({ name: nama, purpose: nama, instructions: `[AGENT:${nama}] Jawab.`, model: model(f),
    tools: tools as never, maxSteps: 6, ...(KONTROL ? {} : { hooks: hookBawahan(pp) }) });
  const anak = [mk("Marketing", [totalPenjualan]), mk("Portal", [daftarSop, tiket])];
  pp.pakaiKemampuan(teksKemampuan("Ratu AI", [{ nama: "Marketing", bisa: ["Total penjualan"] }, { nama: "Portal", bisa: ["Daftar SOP", "Tiket helpdesk"] }]));
  const perute = new Agent({ name: "Perute", purpose: "perute", instructions: "[PERUTE] Teruskan.", model: model(f), subAgents: anak,
    maxSteps: 12, supervisorConfig: { systemMessage: "[PERUTE] Teruskan.", customGuidelines: [] }, ...(KONTROL ? {} : kendaliPerute(pp, 12)) } as never);
  return { perute, pp, catat };
}
async function jalankan(r: ReturnType<typeof rakit>, riwayat: { peran: "user" | "assistant"; teks: string }[]) {
  const h = await r.perute.streamText(riwayat.map((m, i) => ({ id: `m${i}`, role: m.peran, parts: [{ type: "text", text: m.teks }] })) as never);
  const potongan: { type: string; delta?: string }[] = [];
  const s = h.toUIMessageStream() as AsyncIterable<{ type: string; delta?: string }>;
  for await (const x of KONTROL ? s : jagaPotongan(s, r.pp.ambil(), "ui")) potongan.push(x);
  return { teks: potongan.filter((x) => x.type === "text-delta").map((x) => x.delta ?? "").join(""), k: r.pp.ambil().keadaan() };
}

for (const f of ["openai", "anthropic"] as const) {
  console.log(`\n=== integrasi, format ${f} ===`);
  const S = (n: string) => `uji46-${n}-${f}`;

  // I1 — Q1: argumen periode kosong padahal pertanyaan menyebut bulan
  {
    const k = S("q1");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`Berapa total penjualan September 2026? ${k}`, "Marketing") : { teks: "Total penjualan September 2026: Rp 156.770." })
      : (ke(p) === 0 ? alat("total_penjualan", {}) : ke(p) === 1 && p.hasilAlat[0].includes("perlu-periode") ? alat("total_penjualan", { dari: "2026-09", sampai: "2026-09" }) : { teks: "Rp 156.770 untuk September 2026." }) });
    const r = rakit(f);
    const o = await jalankan(r, [{ peran: "user", teks: `Berapa total penjualan September 2026? ${k}` }]);
    cek(`[${f}] I1a panggilan tanpa periode TIDAK dijalankan; alat hanya jalan dengan periode yang ditanyakan`,
      r.catat.penjualan.length === 1 && r.catat.penjualan[0].dari === "2026-09", JSON.stringify(r.catat.penjualan));
    cek(`[${f}] I1b jawaban memuat angka bulan yang ditanyakan`, o.teks.includes("156.770"), JSON.stringify(o.teks).slice(0, 70));
  }
  // I2 — "terbaru": tetap satu panggilan, hasil ditandai periode_otomatis
  {
    const k = S("baru");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`total penjualan terbaru ${k}`, "Marketing") : { teks: "Total penjualan terbaru (Oktober 2026): Rp 99.999." })
      : (ke(p) === 0 ? alat("total_penjualan", {}) : { teks: "Oktober 2026: Rp 99.999." }) });
    const r = rakit(f);
    await jalankan(r, [{ peran: "user", teks: `total penjualan terbaru ${k}` }]);
    const kedua = panggilan(k, "bawahan").find((p) => ke(p) === 1);
    cek(`[${f}] I2 'terbaru': alat langsung jalan (1×) dan model menerima tanda periode_otomatis`,
      r.catat.penjualan.length === 1 && !!kedua && kedua.hasilAlat[0].includes("periode_otomatis"));
  }
}
// I3–I7: kalimat pengguna harus utuh (pengenal sapaan memeriksa SELURUH kalimat), jadi penanda skenario
// diletakkan di pesan asisten sebelumnya, bukan di kalimat pengguna.
for (const f of ["openai", "anthropic"] as const) {
  const k = `uji46-sapa-${f}`;
  daftar.unshift({ kunci: k, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`Halo, kamu bisa bantu apa saja? (${k})`, "Portal") : { teks: "Portal menampilkan daftar SOP." })
    : (ke(p) === 0 ? alat("daftar_sop", {}) : { teks: "Ini daftar SOP." }) });
  const r = rakit(f);
  const o = await jalankan(r, [{ peran: "assistant", teks: `(${k})` }, { peran: "user", teks: "Halo, kamu bisa bantu apa saja?" }]);
  cek(`[${f}] I3a sapaan: tanpa delegasi dan tanpa alat (agent bawahan 0×, daftar_sop 0×)`, panggilan(k, "bawahan").length === 0 && r.catat.sop === 0);
  cek(`[${f}] I3b sapaan: dijawab dari daftar agent terpasang`, o.teks.includes("Portal") && o.teks.includes("Total penjualan"), JSON.stringify(o.teks).slice(0, 70));

  const k2 = `uji46-mentah-${f}`;
  daftar.unshift({ kunci: k2, jawab: () => ({ teks: 'delegate_task ke Portal, isinya "Apa yang bisa saya bantu?"' }) });
  const o2 = await jalankan(rakit(f), [{ peran: "assistant", teks: `(${k2})` }, { peran: "user", teks: "Halo, kamu bisa bantu apa saja?" }]);
  cek(`[${f}] I4 sapaan dijawab dengan teks panggilan alat mentah → diganti teks kemampuan`, !o2.teks.includes("delegate_task") && o2.teks.includes("Saya bisa membantu"), JSON.stringify(o2.teks).slice(0, 60));

  const k3 = `uji46-sop-${f}`;
  daftar.unshift({ kunci: k3, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`SOP apa saja yang ada? (${k3})`, "Portal") : { teks: "SOP yang ada: SOP Cuti." })
    : (ke(p) === 0 ? alat("daftar_sop", {}) : { teks: "SOP Cuti." }) });
  const r3 = rakit(f);
  const o3 = await jalankan(r3, [{ peran: "assistant", teks: `(${k3})` }, { peran: "user", teks: "SOP apa saja yang ada?" }]);
  cek(`[${f}] I5 'SOP apa saja yang ada?' tetap ke agent + daftar_sop`, r3.catat.sop === 1 && o3.teks.includes("SOP Cuti"));

  // I6 — tiket: sub-kategori karangan dikosongkan → alat memulangkan daftar → berhenti, tanya pengguna
  const k4 = `uji46-tiket-${f}`;
  daftar.unshift({ kunci: k4, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`internet di ruangan saya mati, tolong buatkan tiket ${k4}`, "Portal") : delegasi(`Pengguna memilih LAN (${k4})`, "Portal"))
    : (ke(p) === 0 ? alat("siapkan_tiket", { kategori: "NETWORK", sub_kategori: "LAN", judul: "Internet mati" }) : { teks: "Sub-kategori mana yang dimaksud: LAN atau WIFI?" }) });
  const r4 = rakit(f);
  const o4 = await jalankan(r4, [{ peran: "user", teks: `internet di ruangan saya mati, tolong buatkan tiket ${k4}` }]);
  cek(`[${f}] I6a sub-kategori karangan ('LAN') DIKOSONGKAN sebelum alat jalan`, r4.catat.tiket.length === 1 && r4.catat.tiket[0].sub_kategori === "", JSON.stringify(r4.catat.tiket));
  cek(`[${f}] I6b tanpa rancangan; alur berhenti; pengguna ditanya dengan pilihan yang sah`,
    o4.k.rancangan === 0 && o4.k.berhenti?.kode === "klarifikasi" && o4.teks.includes("LAN atau WIFI"), JSON.stringify(o4.teks).slice(0, 70));

  // I7 — giliran berikutnya: pengguna memilih WIFI → dipertahankan → rancangan
  const k5 = `uji46-pilih-${f}`;
  daftar.unshift({ kunci: k5, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`WIFI (${k5})`, "Portal") : { teks: "Rancangan tiket sudah disiapkan; tekan Simpan." })
    : (ke(p) === 0 ? alat("siapkan_tiket", { kategori: "NETWORK", sub_kategori: "WIFI", judul: "Internet mati" }) : { teks: "Rancangan disiapkan." }) });
  const r5 = rakit(f);
  await jalankan(r5, [{ peran: "user", teks: `internet mati, buatkan tiket ${k5}` }, { peran: "assistant", teks: "Sub-kategori mana yang dimaksud?\n- LAN\n- WIFI" }, { peran: "user", teks: "WIFI" }]);
  cek(`[${f}] I7 pilihan pengguna (WIFI) dipertahankan → rancangan terbentuk`, r5.catat.tiket[0]?.sub_kategori === "WIFI" && r5.pp.ambil().keadaan().rancangan === 1);
}

await srv.tutup();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
