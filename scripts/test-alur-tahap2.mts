/**
 * Uji integrasi OFFLINE Tahap 2 — agent VoltAgent sungguhan + hook penjaga yang SAMA dengan produksi
 * (`voltagent/kendali-alur.ts`) + penyaring stream (`lib/alur/jaga-stream.ts`), terhadap server model tiruan.
 *   npm run test:alur-tahap2
 *
 * Tanpa model sungguhan, tanpa database, tanpa biaya. Setiap skenario dijalankan untuk DUA format penyedia:
 * OpenAI-compatible (Qwen lewat LiteLLM) dan Anthropic. Stream dibaca lewat `toUIMessageStream()` +
 * `jagaPotongan(…, "ui")` — jalur yang sama dengan `app/api/chat/route.ts`.
 *
 * Model tiruan sengaja berperilaku BURUK seperti di RCA (mengarang persetujuan, memilihkan, mengulang,
 * menulis panggilan alat sebagai teks, mengklaim tersimpan). Yang diuji: sistem tetap berperilaku benar.
 */
import { Agent, createTool } from "@voltagent/core";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { mulaiServerTiruan, type Format, type Jawaban, type Permintaan } from "./lib/server-tiruan.mts";
import { buatPemegangPenjaga, TEKS_BELUM_SELESAI, type OpsiPenjaga } from "../lib/alur/penjaga-alur.ts";
import { jagaPotongan } from "../lib/alur/jaga-stream.ts";
import { hookBawahan, kendaliPerute } from "../voltagent/kendali-alur.ts";

/**
 * KONTROL NEGATIF: `UJI_TANPA_PENJAGA=1` menjalankan skenario yang sama TANPA hook penjaga dan tanpa
 * penyaring stream (perilaku sebelum Tahap 2). Uji yang benar-benar menguji penjaga harus GAGAL di sini;
 * kalau lolos juga, ujinya tidak membuktikan apa-apa.
 */
const KONTROL = process.env.UJI_TANPA_PENJAGA === "1";
if (KONTROL) console.log("⚠️  KONTROL NEGATIF: tanpa penjaga (perilaku sebelum Tahap 2)");

let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };

const srv = await mulaiServerTiruan();
const model = (f: Format) => f === "anthropic"
  ? createAnthropic({ baseURL: srv.url(f), apiKey: "tiruan" })("claude-tiruan")
  : createOpenAICompatible({ name: "tiruan", baseURL: srv.url(f), apiKey: "tiruan" })("tiruan");

// Penjawab per skenario, dipilih dari penanda unik yang muncul di SETIAP permintaan skenario itu.
// Urutan langkah diambil dari jumlah hasil alat di riwayat — aman untuk skenario yang berjalan bersamaan.
type Penjawab = { kunci: string; jawab: (p: Permintaan) => Jawaban };
const daftar: Penjawab[] = [];
srv.setel((p) => (daftar.find((d) => p.teksPesan.includes(d.kunci))?.jawab ?? (() => ({ teks: "?" })))(p));
const ke = (p: Permintaan) => p.hasilAlat.length;
const dipaksaTeks = (p: Permintaan) => p.badan.tool_choice === "none" || !(p.badan.tools as unknown[] | undefined)?.length;
const delegasi = (task: string, ...targetAgents: string[]): Jawaban => ({ alat: [{ nama: "delegate_task", argumen: { task, targetAgents } }] });
const alat = (nama: string, argumen: Record<string, unknown>): Jawaban => ({ alat: [{ nama, argumen }] });

type Pesan = { peran: "user" | "assistant"; teks: string };
function rakit(f: Format, bawahan: string[], opsi: { maksLangkah?: number; penjaga?: OpsiPenjaga } = {}) {
  const pp = buatPemegangPenjaga({ idSesi: "uji", ...opsi.penjaga });
  const keadaan = { eksekusiTiket: 0, rancangan: 0 };
  const tiket = createTool({
    name: "siapkan_tiket",
    description: "Menyiapkan RANCANGAN tiket (tiruan). Tidak menyimpan apa pun.",
    parameters: z.object({ kategori: z.string(), sub_kategori: z.string(), judul: z.string().optional() }),
    execute: async (a: { kategori: string; sub_kategori: string }) => {
      keadaan.eksekusiTiket++;
      if (!["LAN", "WIFI", "KOMPUTER"].includes(a.sub_kategori.toUpperCase())) {
        return { status: "perlu-perbaikan", pesan: `Sub-kategori "${a.sub_kategori}" tidak dikenal. Pilihan: LAN, WIFI.`,
          masalah: [{ jenis: "tidak-dikenal", label: "Sub-kategori", diberi: a.sub_kategori, pilihan: [{ label: "LAN" }, { label: "WIFI" }] }] };
      }
      keadaan.rancangan++;
      return { status: "siap", sidik: `sdk-${a.sub_kategori}`, draf: { ...a }, catatan: "BELUM TERSIMPAN." };
    },
  });
  const anak = bawahan.map((nama) => new Agent({ name: nama, purpose: nama, instructions: `[AGENT:${nama}] Jawab.`, model: model(f),
    tools: nama === "Portal" ? [tiket] : [], maxSteps: 6, ...(KONTROL ? {} : { hooks: hookBawahan(pp) }) }));
  const maks = opsi.maksLangkah ?? 12;
  const perute = new Agent({ name: "Perute", purpose: "perute", instructions: "[PERUTE] Teruskan.", model: model(f), subAgents: anak,
    maxSteps: maks, supervisorConfig: { systemMessage: "[PERUTE] Teruskan.", customGuidelines: [] }, ...(KONTROL ? {} : kendaliPerute(pp, maks)) } as never);
  return { perute, pp, keadaan };
}

async function jalankan(r: ReturnType<typeof rakit>, riwayat: Pesan[], abortSignal?: AbortSignal) {
  const pesan = riwayat.map((m, i) => ({ id: `m${i}`, role: m.peran, parts: [{ type: "text", text: m.teks }] }));
  const h = await r.perute.streamText(pesan as never, (abortSignal ? { abortSignal } : {}) as never);
  const potongan: { type: string; delta?: string }[] = [];
  const ui = h.toUIMessageStream() as AsyncIterable<{ type: string; delta?: string }>;
  for await (const x of KONTROL ? ui : jagaPotongan(ui, r.pp.ambil(), "ui")) potongan.push(x);
  return { potongan, teks: potongan.filter((x) => x.type === "text-delta").map((x) => x.delta ?? "").join(""), k: r.pp.ambil().keadaan() };
}
const panggilan = (kunci: string, peran: "perute" | "bawahan", agen?: string) =>
  srv.catatan.filter((p) => p.teksPesan.includes(kunci) && p.peran === peran && (!agen || p.agen === agen));

const KLARIFIKASI = (k: string) => `Sub-kategori yang tersedia:\n- LAN\n- WIFI\nSub-kategori mana yang dimaksud untuk ${k}?`;
const TAWARAN = (k: string) => `Panduan untuk ${k} belum ditemukan. Apakah Anda ingin saya menyiapkan tiket helpdesk untuk ${k}?`;

async function skenario(f: Format) {
  console.log(`\n=== format ${f} ===`);
  const S = (n: string) => `uji-${n}-${f}`;   // penanda unik per skenario & format

  // ---------------------------------------------------------------- 1. rancangan tanpa sub-kategori → klarifikasi, perute berhenti
  {
    const k = S("s1");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`internet ${k} mati, tolong buatkan tiket`, "Portal") : delegasi(`Pengguna memilih LAN ${k}`, "Portal"))
      : ke(p) === 0 ? alat("siapkan_tiket", { kategori: "NETWORK", sub_kategori: "INTERNET" }) : { teks: KLARIFIKASI(k) } });
    const r = rakit(f, ["Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: `internet ${k} mati, tolong buatkan tiket` }]);
    cek(`[${f}] 1a sub-kategori belum ada: pertanyaan agent bawahan sampai ke stream`, o.teks.includes(`Sub-kategori mana yang dimaksud untuk ${k}?`), JSON.stringify(o.teks).slice(0, 80));
    cek(`[${f}] 1b perute BERHENTI (1 panggilan LLM, tidak mengarang pilihan)`, panggilan(k, "perute").length === 1 && !o.teks.includes("memilih"), `perute=${panggilan(k, "perute").length}`);
    cek(`[${f}] 1c agent bawahan tidak memilihkan; tanpa rancangan; status klarifikasi`, r.keadaan.eksekusiTiket === 1 && r.keadaan.rancangan === 0 && o.k.berhenti?.kode === "klarifikasi");
    cek(`[${f}] 1d stream selesai normal`, o.potongan.at(-1)?.type === "finish");
  }

  // ---------------------------------------------------------------- 2. perute mengarang persetujuan di giliran pertama
  {
    const k = S("s2");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`User menyetujui tawaran sebelumnya: siapkan tiket untuk komputer ${k}`, "Portal")
        : ke(p) === 1 ? delegasi(`komputer saya ${k} mengeluarkan asap`, "Portal") : { teks: "selesai" })
      : { teks: TAWARAN(k) } });
    const r = rakit(f, ["Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: `komputer saya ${k} mengeluarkan asap` }]);
    const bw = panggilan(k, "bawahan", "Portal");
    cek(`[${f}] 2a delegasi berisi persetujuan karangan DITOLAK sebelum jalan`, o.k.ditolak[0]?.kode === "persetujuan-karangan" && bw.every((p) => !p.teksPesan.includes("menyetujui")), `bawahan=${bw.length}`);
    cek(`[${f}] 2b perute memperbaiki tugasnya; tawaran agent sampai ke pengguna; alur berhenti`, bw.length === 1 && o.teks.includes("Apakah Anda ingin saya menyiapkan tiket") && o.k.berhenti?.kode === "tawaran");
    cek(`[${f}] 2c tanpa teks atas nama pengguna`, !/user menyetujui/i.test(o.teks));
  }

  // ---------------------------------------------------------------- 3. perute mencoba menjawab pertanyaan agent bawahan
  {
    const k = S("s3");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`koneksi ${k} putus`, "Portal") : ke(p) === 1 ? delegasi(`Pengguna memilih LAN untuk ${k}`, "Portal") : { teks: "Sudah saya pilihkan LAN." })
      : { teks: `Koneksi ${k} lewat kabel atau nirkabel — mau pakai LAN atau WIFI?` } });
    const r = rakit(f, ["Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: `koneksi ${k} putus` }]);
    cek(`[${f}] 3a jawaban atas nama pengguna ditolak; agent bawahan tidak ditanya ulang`, panggilan(k, "bawahan").length === 1 && o.k.ditolak.length === 1);
    cek(`[${f}] 3b pengguna menerima pertanyaannya, bukan "sudah saya pilihkan"`, o.teks.includes("mau pakai LAN atau WIFI?") && !o.teks.includes("pilihkan"), JSON.stringify(o.teks).slice(0, 80));
  }

  // ---------------------------------------------------------------- 4. "ya setuju" tanpa operasi yang menunggu
  {
    const k = S("s4");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) <= 1 ? delegasi(`User menyetujui pembuatan tiket ${k}${ke(p)}`, "Portal") : { teks: "Tiket sudah dibuat." })
      : { teks: "x" } });
    const r = rakit(f, ["Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: `berapa omzet ${k}?` }, { peran: "assistant", teks: "Omzet Agustus 2026 Rp 457.383.190." }, { peran: "user", teks: "ya setuju" }]);
    cek(`[${f}] 4a persetujuan tanpa tawaran tidak pernah sampai ke agent bawahan`, panggilan(k, "bawahan").length === 0 && o.k.ditolak.every((d) => d.kode === "persetujuan-karangan"));
    cek(`[${f}] 4b jawaban jujur, bukan kosong dan bukan klaim tersimpan`, o.teks === TEKS_BELUM_SELESAI, JSON.stringify(o.teks).slice(0, 80));
  }

  // ---------------------------------------------------------------- 5. pilihan "LAN" pada giliran berikutnya + klaim tersimpan palsu
  {
    const k = S("s5");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi("LAN", "Portal") : { teks: "Tiket Anda telah dibuat dengan nomor TKT-0001. Teknisi segera menghubungi Anda." })
      : ke(p) === 0 ? alat("siapkan_tiket", { kategori: "NETWORK", sub_kategori: "LAN" }) : { teks: "Rancangan tiket sudah disiapkan. Silakan tekan Simpan." } });
    const r = rakit(f, ["Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: "internet mati, buatkan tiket" }, { peran: "assistant", teks: KLARIFIKASI(k) }, { peran: "user", teks: "LAN" }]);
    const bw = panggilan(k, "bawahan", "Portal")[0];
    cek(`[${f}] 5a jawaban "LAN" diteruskan BERSAMA pertanyaan sebelumnya ke agent bawahan`, !!bw && bw.teksPesan.includes("Sub-kategori mana yang dimaksud") && bw.teksPesan.includes("«LAN»"));
    cek(`[${f}] 5b rancangan terbentuk sekali`, r.keadaan.rancangan === 1 && o.k.rancangan === 1);
    cek(`[${f}] 5c klaim "telah dibuat"/nomor karangan TIDAK terkirim; status sebenarnya disampaikan`,
      !o.teks.includes("telah dibuat") && !o.teks.includes("TKT-0001") && o.teks.includes("belum tersimpan") && o.teks.includes("Teknisi segera"), JSON.stringify(o.teks).slice(0, 100));
  }

  // ---------------------------------------------------------------- 6. "ya" sesudah tawaran yang sah
  {
    const k = S("s6");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk ${k}`, "Portal") : { teks: "Rancangan tiket sudah disiapkan; periksa kartunya lalu tekan Simpan." })
      : ke(p) === 0 ? alat("siapkan_tiket", { kategori: "HARDWARE", sub_kategori: "KOMPUTER" }) : { teks: "Rancangan sudah disiapkan." } });
    const r = rakit(f, ["Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: `komputer ${k} berasap` }, { peran: "assistant", teks: TAWARAN(k) }, { peran: "user", teks: "ya setuju" }]);
    const bw = panggilan(k, "bawahan", "Portal")[0];
    cek(`[${f}] 6a persetujuan yang sah DITERUSKAN (tidak ditolak)`, o.k.ditolak.length === 0 && !!bw && bw.teksPesan.includes("«ya setuju»"));
    cek(`[${f}] 6b rancangan terbentuk; jawaban perute sampai utuh`, r.keadaan.rancangan === 1 && o.teks.includes("Rancangan tiket sudah disiapkan"));
  }

  // ---------------------------------------------------------------- 7. agent bawahan membuat rancangan identik berulang
  {
    const k = S("s7");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`wifi ${k} mati, buatkan tiket`, "Portal") : { teks: "Rancangan tiket WIFI sudah disiapkan." })
      : ke(p) <= 1 ? alat("siapkan_tiket", { kategori: "NETWORK", sub_kategori: "WIFI", judul: `wifi ${k}` }) : { teks: "Sudah disiapkan." } });
    const r = rakit(f, ["Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: `wifi ${k} mati, buatkan tiket` }]);
    cek(`[${f}] 7  rancangan identik kedua TIDAK dijalankan (1 eksekusi, 1 rancangan)`, r.keadaan.eksekusiTiket === 1 && r.keadaan.rancangan === 1 && o.k.ditolak.some((d) => d.kode === "alat-berulang"),
      `eksekusi=${r.keadaan.eksekusiTiket}`);
  }

  // ---------------------------------------------------------------- 8. beberapa delegasi berbeda yang sah
  {
    const k = S("s8");
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`omzet agustus ${k}`, "Marketing") : ke(p) === 1 ? delegasi(`status tiket saya ${k}`, "Portal")
        : { teks: "Omzet Agustus Rp 457.383.190, dan Anda punya 2 tiket terbuka." })
      : p.agen === "Marketing" ? { teks: "Omzet Agustus Rp 457.383.190." } : { teks: "Anda punya 2 tiket terbuka." } });
    const r = rakit(f, ["Marketing", "Portal"]);
    const o = await jalankan(r, [{ peran: "user", teks: `berapa omzet agustus dan status tiket saya ${k}?` }]);
    cek(`[${f}] 8  dua delegasi berbeda jalan, tanpa penolakan, jawaban gabungan utuh`,
      panggilan(k, "bawahan", "Marketing").length === 1 && panggilan(k, "bawahan", "Portal").length === 1 && o.k.ditolak.length === 0 && !o.k.berhenti
      && o.teks.includes("2 tiket terbuka") && o.teks.includes("457.383.190"));
  }

  // ---------------------------------------------------------------- 9. batas langkah tercapai
  {
    const k = S("s9");
    const tugas = ["omzet agustus", "stok gudang", "tiket printer", "cuti tahunan", "aset laptop"];
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (dipaksaTeks(p) ? { teks: "" } : delegasi(`${tugas[ke(p)]} ${k}`, "Portal"))
      : { teks: `Data ${tugas[Math.max(0, tugas.findIndex((t) => p.teksPesan.includes(t)))]} sudah saya ambil.` } });
    const r = rakit(f, ["Portal"], { maksLangkah: 4, penjaga: { maksDelegasiPerAgent: 50, maksDelegasiTotal: 50 } });
    const o = await jalankan(r, [{ peran: "user", teks: `rekap semuanya ${k}` }]);
    const pr = panggilan(k, "perute");
    cek(`[${f}] 9a langkah terakhir dipaksa menulis teks (toolChoice none)`, pr.length === 4 && dipaksaTeks(pr[3]) && !dipaksaTeks(pr[0]), `perute=${pr.length}`);
    cek(`[${f}] 9b batas langkah tanpa teks → hasil valid terakhir, bukan kosong`, o.teks.includes("sudah saya ambil") && o.k.penutup === "hasil-terakhir", JSON.stringify(o.teks).slice(0, 60));
  }

  // ---------------------------------------------------------------- 10. panggilan alat mentah di stream
  {
    const k = S("s10");
    daftar.push({ kunci: k, jawab: () => ({ teks: `delegate_task ke Portal, isinya "Apa yang bisa saya bantu ${k}?"` }) });
    const o = await jalankan(rakit(f, ["Portal"]), [{ peran: "user", teks: `halo ${k}, bisa bantu apa?` }]);
    // Diperiksa di teks GABUNGAN juga: potongan stream bisa memecah "delegate_task" di tengah kata,
    // sehingga memeriksa per potongan saja bisa lolos walau teksnya sampai (ketahuan lewat kontrol negatif).
    cek(`[${f}] 10a teks panggilan alat TIDAK sampai ke pengguna (per potongan & gabungan)`,
      !o.potongan.some((x) => JSON.stringify(x).includes("delegate_task")) && !/delegate_?t?a?s?k?/.test(o.teks.replace(/\s/g, "")));
    cek(`[${f}] 10b pengguna tetap menerima teks (jujur)`, o.teks === TEKS_BELUM_SELESAI);
    const k2 = S("s10b");
    daftar.push({ kunci: k2, jawab: () => ({ teks: `Saya bisa membantu tiket dan data penjualan.\n{"task": "halo ${k2}", "targetAgents": ["Portal"]}` }) });
    const o2 = await jalankan(rakit(f, ["Portal"]), [{ peran: "user", teks: `halo ${k2}` }]);
    cek(`[${f}] 10c kalimat wajar lolos, JSON alat sesudahnya dibuang`, o2.teks.trim() === "Saya bisa membantu tiket dan data penjualan." , JSON.stringify(o2.teks));
  }
}

for (const f of ["openai", "anthropic"] as const) await skenario(f);

// ---------------------------------------------------------------- 11. beberapa sesi bersamaan
{
  console.log("\n=== bersamaan ===");
  const kA = "uji-sesiA", kB = "uji-sesiB";
  daftar.push({ kunci: kA, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`internet ${kA} mati`, "Portal") : delegasi(`Pengguna memilih LAN ${kA}`, "Portal"))
    : ke(p) === 0 ? alat("siapkan_tiket", { kategori: "NETWORK", sub_kategori: "INTERNET" }) : { teks: KLARIFIKASI(kA) } });
  daftar.push({ kunci: kB, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk ${kB}`, "Portal") : { teks: "Rancangan disiapkan." })
    : ke(p) === 0 ? alat("siapkan_tiket", { kategori: "HARDWARE", sub_kategori: "KOMPUTER" }) : { teks: "ok" } });
  const a = rakit("openai", ["Portal"]), b = rakit("openai", ["Portal"]);
  const [oa, ob] = await Promise.all([
    jalankan(a, [{ peran: "user", teks: `internet ${kA} mati` }]),
    jalankan(b, [{ peran: "user", teks: `pc ${kB} rusak` }, { peran: "assistant", teks: TAWARAN(kB) }, { peran: "user", teks: "ya" }]),
  ]);
  cek("11 dua sesi bersamaan: A berhenti menunggu pengguna, B membuat rancangan — state tidak tercampur",
    oa.k.berhenti?.kode === "klarifikasi" && a.keadaan.rancangan === 0 && !ob.k.berhenti && ob.k.ditolak.length === 0 && b.keadaan.rancangan === 1
    && oa.k.idPermintaan !== ob.k.idPermintaan);
}

// ---------------------------------------------------------------- 12. jalur dipakai ulang berurutan → penjaga baru
{
  const k = "uji-ulang";
  daftar.push({ kunci: k, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`cek ${k}`, "Portal") : { teks: "ok" }) : { teks: TAWARAN(k) } });
  const r = rakit("openai", ["Portal"]);
  const o1 = await jalankan(r, [{ peran: "user", teks: `cek ${k}` }]);
  const o2 = await jalankan(r, [{ peran: "user", teks: `cek ${k} lagi` }]);
  cek("12 perute yang sama dipakai lagi: giliran kedua mendapat penjaga bersih (tidak langsung ditolak)",
    o1.k.berhenti?.kode === "tawaran" && o2.k.idPermintaan !== o1.k.idPermintaan && o2.k.ditolak.length === 0);
}

// ---------------------------------------------------------------- 13. pembatalan (Tahap 1) tetap sampai lewat penyaring
{
  const k = "uji-batal";
  daftar.push({ kunci: k, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`rekap panjang ${k}`, "Portal") : { teks: "ok" }) : { lambatMs: 200 } });
  const r = rakit("openai", ["Portal"]);
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(new Error("batas waktu benchmark")), 1500);
  try { await jalankan(r, [{ peran: "user", teks: `rekap panjang ${k}` }], ac.signal); } catch { /* pembatalan boleh berupa galat */ }
  await new Promise((ok) => setTimeout(ok, 800));
  const bw = panggilan(k, "bawahan");
  cek("13 pembatalan tetap memutus agent bawahan walau stream lewat penyaring (< 10 dtk, sambungan diputus)",
    Date.now() - t0 < 10_000 && bw.length === 1 && bw[0].diputus === true, `${Date.now() - t0} ms, diputus=${bw[0]?.diputus}`);
}

await srv.tutup();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
