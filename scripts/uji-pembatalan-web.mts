/**
 * T6/E4 uji live (24 Nov 2026) — EMULASI browser menutup koneksi di jalur WEB. HARNESS UJI: aplikasi tidak diubah.
 *
 *   npx tsx --env-file=.env.local scripts/uji-pembatalan-web.mts --model mr-ai-gateway-4gpu --folder <dir> [--putus-dtk 8] [--amati-dtk 60]
 *
 * Meniru `/api/chat` (app/api/chat/route.ts): `streamText` TANPA `abortSignal` (route belum meneruskan `req.signal`),
 * stream UI dibungkus penyaring penjaga, lalu dijadikan Response. Sesudah `--putus-dtk` detik pembaca Response
 * di-`cancel()` — itu yang dilakukan Next.js saat klien memutus. Pertanyaannya: apakah panggilan model ikut berhenti?
 * Diamati dari dalam proses: panggilan fetch ke gateway yang DIMULAI sesudah pemutusan (permintaan LLM lanjutan) dan
 * yang masih berjalan. Metrik vLLM diamati terpisah oleh pencuplik di sisi server (hanya membaca).
 */
import { appendFileSync, mkdirSync } from "node:fs";

const arg = (n: string, b: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : b; };
const MODEL = arg("model", "mr-ai-gateway-4gpu");
const DIR = arg("folder", `data/agent-workflow-latency/pembatalan-web-${Date.now()}`);
const PUTUS_MS = Number(arg("putus-dtk", "8")) * 1000;
const AMATI_MS = Number(arg("amati-dtk", "60")) * 1000;
const KALIMAT = arg("kalimat", "Buatkan tiket, komputer saya tidak ada akses internet");
mkdirSync(DIR, { recursive: true });

// Hitung panggilan model (chat/completions) dari proses ini: kapan mulai, kapan selesai.
const panggilan: { mulai: number; selesai: number | null; status: number | null }[] = [];
const asli = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/chat\/completions/.test(url)) return asli(input, init);
  const p = { mulai: Date.now(), selesai: null as number | null, status: null as number | null };
  panggilan.push(p);
  try {
    const r = await asli(input, init);
    p.status = r.status;
    if (!r.body) { p.selesai = Date.now(); return r; }
    const [a, b] = r.body.tee();
    (async () => { const rd = b.getReader(); try { while (!(await rd.read()).done) { /* tunggu habis */ } } catch { /* putus */ } p.selesai = Date.now(); })();
    return new Response(a, { status: r.status, statusText: r.statusText, headers: r.headers });
  } catch (e) { p.selesai = Date.now(); throw e; }
}) as typeof fetch;

const { siapkanAgent } = await import("../voltagent/jalur-agent.ts");
const { jagaStream } = await import("../lib/alur/jaga-stream.ts");
const { KUNCI_MODEL, KUNCI_SALURAN } = await import("../voltagent/agents.ts");
const { maksToolGatewayModel } = await import("../voltagent/models.ts");
const { poolPerusahaan } = await import("../lib/db-perusahaan.ts");

const db = poolPerusahaan();
const { rows: [akun] } = await db.query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users WHERE lower(u.username) = $1`, ["ridho@mustika-ratu.co.id"]);

const jalur = await siapkanAgent(akun.id_employee, maksToolGatewayModel(MODEL));
if (jalur.jalur !== "konfigurasi") throw new Error(jalur.sebab);
const t0 = Date.now();
// = route.ts:325 — TANPA abortSignal.
const h = await jalur.agent.streamText([{ id: "u0", role: "user", parts: [{ type: "text", text: KALIMAT }] }] as never,
  { context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" } } as never);
const pj = jalur.penjaga();
const ui = h.toUIMessageStream() as ReadableStream<unknown>;
const respons = new Response((pj ? jagaStream(ui as never, pj, "ui") : ui) as never);
const pembaca = respons.body!.getReader();
let byte = 0;
const baca = (async () => { try { for (;;) { const r = await pembaca.read(); if (r.done) break; byte += r.value?.length ?? 0; } } catch { /* dibatalkan */ } })();
await Promise.race([baca, new Promise((r) => setTimeout(r, PUTUS_MS))]);
const tPutus = Date.now();
const sebelumPutus = panggilan.length;
await pembaca.cancel("klien menutup koneksi (emulasi)").catch(() => {});
console.log(`putus pada ${(tPutus - t0) / 1000} dtk · byte diterima ${byte} · panggilan model sejauh ini ${sebelumPutus}`);
await new Promise((r) => setTimeout(r, AMATI_MS));
const lanjutan = panggilan.filter((p) => p.mulai > tPutus);
const masihJalan = panggilan.filter((p) => p.mulai <= tPutus && (p.selesai === null || p.selesai > tPutus + 5000));
const hasil = { t: "pembatalan-web", kalimat_kar: KALIMAT.length, putus_ms: tPutus - t0, t_putus: tPutus, byte_sebelum_putus: byte,
  panggilan_sebelum_putus: sebelumPutus, panggilan_lanjutan_sesudah_putus: lanjutan.length,
  panggilan_aktif_lebih_5dtk_sesudah_putus: masihJalan.length,
  panggilan: panggilan.map((p) => ({ mulai_rel_ms: p.mulai - t0, selesai_rel_ms: p.selesai === null ? null : p.selesai - t0, status: p.status })) };
appendFileSync(`${DIR}/pembatalan-web.jsonl`, JSON.stringify(hasil) + "\n");
console.log(JSON.stringify({ ...hasil, panggilan: undefined }));
console.log(lanjutan.length || masihJalan.length
  ? "HASIL: generasi TIDAK berhenti saat klien memutus (route belum meneruskan req.signal) — keterbatasan, bukan diperbaiki di uji ini"
  : "HASIL: tidak ada panggilan model sesudah pemutusan");
await db.end().catch(() => {});
process.exit(0);
