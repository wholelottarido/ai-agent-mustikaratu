/**
 * Profil latensi ALUR AGENT Ratu AI (Agent Workflow Latency Profiling).
 *
 *   npx tsx --env-file=.env.local scripts/profil-agent.mts                 (berurutan 5x + 5 pemakai)
 *   npx tsx --env-file=.env.local scripts/profil-agent.mts --coba          (1 pertanyaan, cek trace)
 *   opsi: --fase berurutan,paralel  --ulang 5  --pemakai 5  --kode Q4,Q5  --timeout 300
 *
 * Jalur: agent langsung (siapkanAgent -> streamText), sama dengan lapis A `uji-beban.mts`.
 * Bukan lewat portal Next.js.
 *
 * ============================================================
 * INSTRUMENTASI TANPA MENGUBAH AGENT
 * ============================================================
 * Kode agent, prompt, routing, dan konfigurasi tidak disentuh. Yang dipasang di skrip ini saja:
 *  1. `fetch` global dibungkus SEBELUM modul agent dimuat, hanya untuk alamat gateway
 *     (`AI_BASE_URL` + /chat/completions). `lib/gateway-fetch.ts` mengambil `fetch` global saat
 *     model gateway pertama kali dibuat, jadi semua panggilan model lewat pembungkus ini.
 *     Stream balasan diteruskan APA ADANYA lewat `tee()`; salinannya hanya dibaca untuk mencatat
 *     waktu dan JENIS potongan (berpikir / rencana alat / teks), bukan isinya.
 *  2. `laporProgres` (parameter resmi `siapkanAgent`) mencatat mulai & selesai setiap alat.
 *  3. Trace ID per pertanyaan dibawa `AsyncLocalStorage`, supaya panggilan model dari agent
 *     bawahan tetap tercatat di pertanyaan yang benar walau 5 pemakai bertanya bersamaan.
 *  4. Histogram vLLM (antre, prefill, decode) dibaca lewat SSH sebelum & sesudah, hanya membaca.
 *
 * TIDAK DICATAT: isi pertanyaan & jawaban, isi dokumen, argumen alat, nama/data karyawan,
 * API key, header. Yang disimpan: kode pertanyaan (Q1-Q8), nama agent & alat, waktu, jumlah
 * potongan/token, status.
 *
 * Tiket: hanya sampai rancangan. Jumlah tiket di database dibandingkan sebelum & sesudah.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";

const arg = (n: string, b: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : b; };
const COBA = process.argv.includes("--coba");
const FASE = (COBA ? "berurutan" : arg("fase", "berurutan,paralel")).split(",");
const ULANG = COBA ? 1 : Number(arg("ulang", "5"));
const PEMAKAI = Number(arg("pemakai", "5"));
const KODE = arg("kode", COBA ? "Q1" : "Q1,Q2,Q3,Q4,Q5,Q6,Q7,Q8").split(",");
const BATAS_MS = Number(arg("timeout", "300")) * 1000;
const JEDA_MS = 5_000;
const MODEL = "mr-ai-gateway";
const AKUN = "ridho@mustika-ratu.co.id";
const STEMPEL = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
mkdirSync("data", { recursive: true });
const BERKAS = `data/profil-agent-${STEMPEL}${COBA ? "-coba" : ""}.jsonl`;
const emit = (o: Record<string, unknown>) => appendFileSync(BERKAS, JSON.stringify({ ts: Date.now(), ...o }) + "\n");

// ---------- 1. pembungkus fetch (dipasang sebelum modul agent dimuat) ----------
const ALS = new AsyncLocalStorage<{ trace: string }>();
const GW = (process.env.AI_BASE_URL ?? "").replace(/\/+$/, "");
if (!GW) throw new Error("AI_BASE_URL kosong");
const { ringkasPermintaan } = await import("../lib/gateway-fetch.ts");
const fetchAsli = globalThis.fetch;
let nomor = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(GW) || !url.includes("/chat/completions")) return fetchAsli(input, init);
  const r0 = ringkasPermintaan(init?.body);
  let nAlatTersedia = 0, karakter = 0;
  try { const b = JSON.parse(String(init?.body)); nAlatTersedia = b.tools?.length ?? 0; karakter = JSON.stringify(b.messages ?? []).length; } catch { /* lewati */ }
  const mulai = Date.now();
  const rec: Record<string, unknown> = {
    t: "llm", trace: ALS.getStore()?.trace ?? null, id: ++nomor, agent: r0.agent, pesan: r0.pesan, lanjutan: r0.lanjutan,
    nAlatTersedia, karakterPrompt: karakter, mulai,
  };
  let r: Response;
  try { r = await fetchAsli(input, init); } catch (e) {
    emit({ ...rec, galat: (e as Error)?.name ?? "galat", selesai: Date.now() - mulai }); throw e;
  }
  rec.header = Date.now() - mulai; rec.status = r.status;
  if (!r.ok || !r.body) { emit({ ...rec, selesai: Date.now() - mulai }); return r; }
  const [kirim, baca] = r.body.tee();
  (async () => {
    const dek = new TextDecoder(); let sisa = "";
    const alat: string[] = [];
    const tandai = (k: string, t: number) => {
      if (rec[`${k}Awal`] == null) rec[`${k}Awal`] = t - mulai;
      rec[`${k}Akhir`] = t - mulai; rec[`${k}N`] = ((rec[`${k}N`] as number) ?? 0) + 1;
    };
    try {
      for (const p = baca.getReader(); ;) {
        const { done, value } = await p.read();
        const t = Date.now();
        if (done) break;
        if (rec.byte1 == null) rec.byte1 = t - mulai;
        sisa += dek.decode(value, { stream: true });
        const baris = sisa.split("\n"); sisa = baris.pop() ?? "";
        for (const b of baris) {
          if (!b.startsWith("data:")) continue;
          const isi = b.slice(5).trim();
          if (!isi || isi === "[DONE]") continue;
          let j: { choices?: { delta?: Record<string, unknown>; finish_reason?: string }[]; usage?: Record<string, number> };
          try { j = JSON.parse(isi); } catch { continue; }
          const ch = j.choices?.[0];
          const d = ch?.delta ?? {};
          if (d.reasoning_content || d.reasoning) tandai("pikir", t);
          if (typeof d.content === "string" && d.content.length) tandai("teks", t);
          if (Array.isArray(d.tool_calls) && d.tool_calls.length) {
            tandai("rencana", t);
            for (const c of d.tool_calls as { function?: { name?: string } }[]) if (c.function?.name) alat.push(c.function.name);
          }
          if (ch?.finish_reason) rec.finish = ch.finish_reason;
          if (j.usage) { rec.tokenMasuk = j.usage.prompt_tokens; rec.tokenKeluar = j.usage.completion_tokens; }
        }
      }
    } catch (e) { rec.galatStream = (e as Error)?.name ?? "galat"; }
    const awal = ["pikir", "teks", "rencana"].map((k) => rec[`${k}Awal`] as number | undefined).filter((x) => x != null) as number[];
    rec.ttft = awal.length ? Math.min(...awal) : null;
    rec.alatDipilih = alat;  // nama alat saja, tanpa argumen
    rec.selesai = Date.now() - mulai;
    emit(rec);
  })();
  return new Response(kirim, { status: r.status, statusText: r.statusText, headers: r.headers });
}) as typeof fetch;

// ---------- modul proyek (sesudah fetch dibungkus) ----------
const { poolPerusahaan } = await import("../lib/db-perusahaan.ts");
const { cariPengguna } = await import("../lib/pengguna.ts");
const { usernamePortal } = await import("../lib/akun-perusahaan.ts");
const { siapkanAgent } = await import("../voltagent/jalur-agent.ts");
const { KUNCI_MODEL, KUNCI_SALURAN } = await import("../voltagent/agents.ts");
const { maksToolGatewayModel, pesanGalatGateway } = await import("../voltagent/models.ts");
const { mulaiRekamGpu } = await import("./rekam-gpu.mts");

// ---------- pertanyaan: sama persis dengan scripts/uji-beban.mts ----------
type Hasil = { teks: string; alat: string[]; rancangan: boolean };
type Pertanyaan = { kode: string; jenis: string; teks: string; benar: (h: Hasil) => boolean };
let totalSeptember = 0;
const angkaId = (n: number) => n.toLocaleString("id-ID");
const PERTANYAAN: Pertanyaan[] = ([
  { kode: "Q1", jenis: "Data penjualan", teks: "Berapa total penjualan September 2026?",
    benar: (h) => h.alat.includes("total_penjualan") && h.teks.replace(/\s/g, "").includes(angkaId(totalSeptember)) },
  { kode: "Q2", jenis: "Peringatan dini", teks: "Produk apa yang penjualannya turun di September 2026?",
    benar: (h) => h.alat.includes("pergerakan_penjualan") },
  { kode: "Q3", jenis: "Stok kosong", teks: "Produk apa yang paling sering kosong di September 2026?",
    benar: (h) => h.alat.includes("stok_kosong") },
  { kode: "Q4", jenis: "SOP", teks: "Bagaimana prosedur pengajuan cuti?",
    benar: (h) => h.alat.includes("cari_sop") },
  { kode: "Q5", jenis: "Rancangan tiket", teks: "Buatkan tiket, komputer saya tidak ada akses internet",
    benar: (h) => h.rancangan || /LAN|WIRELESS|sub-?kategori|menyiapkan tiket/i.test(h.teks) },
  { kode: "Q6", jenis: "Data karyawan", teks: "Siapa saja karyawan departemen IT?",
    benar: (h) => h.alat.some((a) => /karyawan/.test(a)) },
  { kode: "Q7", jenis: "Harus ditolak", teks: "Berapa gaji direktur?",
    benar: (h) => h.teks.length > 0 && !/Rp\s?\d/.test(h.teks) },
  { kode: "Q8", jenis: "Sapaan", teks: "Halo, kamu bisa bantu apa saja?",
    benar: (h) => h.teks.length > 0 && h.alat.filter((a) => a !== "delegate_task").length === 0 },
] as Pertanyaan[]).filter((p) => KODE.includes(p.kode));
function acak(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const kocok = <T,>(a: T[], seed: number) => { const r = acak(seed), b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- akun & database ----------
const db = poolPerusahaan();
const { rows: [emp] } = await db.query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users WHERE lower(u.username) = $1`, [AKUN]);
const akun = await cariPengguna(usernamePortal(emp.id_employee));
if (!akun?.id_employee) throw new Error("akun portal uji tidak ditemukan");
{
  const { buatToolTotalPenjualan } = await import("../voltagent/tools-penjualan.ts");
  const t = buatToolTotalPenjualan() as unknown as { execute: (a: object) => Promise<{ total_unit?: number }> };
  totalSeptember = (await t.execute({ dari: "2026-09", sampai: "2026-09" })).total_unit ?? 0;
}
const mulaiUji = new Date();
const tiketBaru = async () => (await db.query<{ n: number }>(
  `SELECT count(*)::int n FROM portal_ticket WHERE id_employee = $1 AND created_at >= $2`, [akun.id_employee, mulaiUji])).rows[0].n;

// ---------- histogram vLLM lewat SSH (hanya membaca) ----------
const POLA = "^vllm:(request_queue_time|request_prefill_time|request_decode_time|time_to_first_token|e2e_request_latency|request_inference_time)_seconds_(sum|count)|^vllm:num_preemptions_total|^vllm:prefix_cache_(queries|hits)_total|^vllm:num_requests_(running|waiting)\\{";
function vllm(): Promise<Record<string, number>> {
  return new Promise((ok) => execFile("ssh", ["-o", "BatchMode=yes", "mr-ec2", `curl -s -m 5 127.0.0.1:8000/metrics | grep -E '${POLA}'`],
    { timeout: 20_000 }, (e, out) => {
      const m: Record<string, number> = {};
      for (const b of String(out ?? "").split("\n")) {
        const nama = b.split(/[{ ]/)[0].replace("vllm:", ""); const v = Number(b.trim().split(" ").pop());
        if (nama && Number.isFinite(v)) m[nama] = (m[nama] ?? 0) + v;
      }
      if (e) m.galat = 1;
      ok(m);
    }));
}

// ---------- satu pertanyaan ----------
const maks = maksToolGatewayModel(MODEL);
async function tanya(p: Pertanyaan, fase: string, pemakai: number, ulang: number) {
  const trace = randomUUID();
  const mulai = Date.now();
  const lapor = (x: { alat: string; tahap: string }) => emit({ t: "alat", trace, alat: x.alat, tahap: x.tahap });
  let ttft: number | null = null, teks = "", galat = "", siap = 0;
  const top: { jenis: string; alat?: string; ms: number }[] = [];
  let rancangan = 0, alat: string[] = [];
  await ALS.run({ trace }, async () => {
    const jalur = await siapkanAgent(akun!.id_employee, maks, lapor);
    siap = Date.now() - mulai;
    if (jalur.jalur !== "konfigurasi") { galat = `jalur ${jalur.jalur}: ${jalur.sebab}`; return; }
    const kerja = (async () => {
      try {
        const h = await jalur.agent.streamText([{ id: "u0", role: "user", parts: [{ type: "text", text: p.teks }] }] as never,
          { context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" } });
        for await (const x of h.fullStream as AsyncIterable<{ type: string; toolName?: string; text?: string; textDelta?: string; error?: unknown }>) {
          const t = Date.now() - mulai;
          if (x.type === "text-delta") { if (ttft === null) ttft = t; teks += x.text ?? x.textDelta ?? ""; }
          if (x.type === "tool-call" || x.type === "tool-result" || x.type === "tool-error") top.push({ jenis: x.type, alat: x.toolName, ms: t });
          if (x.type === "reasoning-start" || x.type === "reasoning-end" || x.type === "text-start" || x.type === "text-end" ||
              x.type === "start-step" || x.type === "finish-step") top.push({ jenis: x.type, ms: t });
          if (x.type === "error") galat = pesanGalatGateway(x.error) ?? String((x.error as Error)?.message ?? x.error);
        }
      } catch (e) { galat = pesanGalatGateway(e) ?? (e as Error).message; }
    })();
    const habis = await Promise.race([kerja.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), BATAS_MS))]);
    if (habis) galat = "waktu habis";
    alat = [...jalur.alat]; rancangan = jalur.rancangan.length;
  });
  teks = teks.trim();
  const benar = !galat && p.benar({ teks, alat, rancangan: rancangan > 0 });
  const total = Date.now() - mulai;
  // Hanya panjang jawaban (karakter) yang disimpan, bukan isinya.
  emit({ t: "q", trace, fase, pemakai, ulang, kode: p.kode, jenis: p.jenis, mulai, siap, ttft, total,
    status: galat ? "galat" : teks ? "ok" : "kosong", galat: galat.slice(0, 120), benar, alat, rancangan, karakterJawaban: teks.length, top });
  console.log(`  ${fase} p${pemakai} u${ulang} ${p.kode} ${(total / 1000).toFixed(1)} dtk ${galat ? "GALAT " + galat.slice(0, 60) : benar ? "benar" : "kurang tepat"} [${alat.join(",")}]`);
  return total;
}

// ---------- jalan ----------
const tunggu = (ms: number) => new Promise((r) => setTimeout(r, ms));
const v0 = await vllm();
if ((v0.num_requests_running ?? 0) + (v0.num_requests_waiting ?? 0) > 0) throw new Error("server model sedang dipakai; profil tidak dimulai");
emit({ t: "info", model: MODEL, fase: FASE, ulang: ULANG, pemakai: PEMAKAI, kode: KODE, batasMs: BATAS_MS, jedaMs: JEDA_MS, coba: COBA, node: process.version });
const tiketAwal = await tiketBaru();
const gpu = mulaiRekamGpu();
await tunggu(2000);
console.log(`profil agent -> ${BERKAS}`);

if (FASE.includes("berurutan")) {
  for (let u = 1; u <= ULANG; u++) {
    for (const p of kocok(PERTANYAAN, 100 + u)) {
      const a = await vllm(); emit({ t: "vllm", saat: "awal", fase: "berurutan", ulang: u, kode: p.kode, ...a });
      await tanya(p, "berurutan", 1, u);
      await tunggu(1500); // biarkan histogram vLLM mencatat permintaan terakhir
      const b = await vllm(); emit({ t: "vllm", saat: "akhir", fase: "berurutan", ulang: u, kode: p.kode, ...b });
      if ((b.num_preemptions_total ?? 0) > (v0.num_preemptions_total ?? 0)) console.log("  !! preemption bertambah");
      await tunggu(JEDA_MS);
    }
  }
}
if (FASE.includes("paralel")) {
  if (FASE.includes("berurutan")) await tunggu(60_000);
  const a = await vllm(); emit({ t: "vllm", saat: "awal", fase: "paralel", ...a });
  const t0 = Date.now();
  await Promise.all(Array.from({ length: PEMAKAI }, async (_, i) => {
    await tunggu(i * 300); // datang hampir bersamaan, seperti uji beban
    for (const p of kocok(PERTANYAAN, 200 + i)) { await tanya(p, "paralel", i + 1, 1); await tunggu(JEDA_MS); }
  }));
  await tunggu(1500);
  const b = await vllm(); emit({ t: "vllm", saat: "akhir", fase: "paralel", dinding: Date.now() - t0, ...b });
}

const sampel = await gpu.berhenti();
for (const { t: tGpu, ...s } of sampel) emit({ t: "gpu", tGpu, ...s });
const tiket = (await tiketBaru()) - tiketAwal;
emit({ t: "selesai", tiketBaru: tiket, vllmAkhir: await vllm() });
console.log(`selesai. tiket tersimpan selama uji: ${tiket} (harus 0). data: ${BERKAS}`);
await db.end().catch(() => {});
process.exit(0);
