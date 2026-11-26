/**
 * Agent Workflow Latency Profiling — 97 pertanyaan (40 berurutan + tahap beban 1/2/3/5/8 x 3).
 *
 *   npx tsx --env-file=.env.local scripts/profil-alur-agent.mts            (semua fase)
 *   npx tsx --env-file=.env.local scripts/profil-alur-agent.mts --coba     (1 pertanyaan, cek trace)
 *   opsi: --fase pemanasan,berurutan,beban  --ulang 5  --tahap 1,2,3,5,8  --jeda-tahap 120  --timeout 300
 *         --model mr-ai-gateway                      pilihan model (mr-ai-gateway-4gpu = server 4 GPU)
 *         --ssh-host mr-ec2  --ssh-key <berkas.pem>   server yang dibaca metriknya (hanya membaca)
 *         --port 8000          (mis. 8000,8001,8002,8003)  replika vLLM di server itu
 *         --db-container gateway-db-1                container PostgreSQL LiteLLM di server itu
 *         --label <teks>                             akhiran nama folder hasil (mis. 4gpu)
 *         --model-litellm qwen3-14b                  nama model di catatan LiteLLM (mis. qwen38-27b)
 *         --simpan-jawaban  --catat-argumen          isi jawaban / argumen alat ke data/ (bawaan mati)
 *         --concurrency 10,12,16,20                  = --tahap; jumlah pengguna aktif per tahap (3 pertanyaan per pengguna)
 *         --dry-run                                  cek kesehatan + baca setelan replika, lalu berhenti tanpa beban
 *         --tanpa-batal                              pertanyaan yang habis waktu TIDAK dibatalkan (perilaku uji 13-23 Nov)
 *         --kode Q5,Q8                               hanya pertanyaan dengan kode ini (uji terarah Tahap 2; bawaan semua)
 *   PENJAGA_ALUR=mati                                matikan penjaga alur Tahap 2 (perbandingan A-B; bawaan menyala)
 *   Bawaan semua opsi = server 1 GPU, sama persis dengan uji 17 Nov 2026.
 *   Alamat IP & path kunci SSH sengaja tidak ditulis di skrip; diberikan sebagai opsi.
 *
 * Hasil: data/agent-workflow-latency/<waktu>/
 *   span.jsonl       span bertingkat dari lib/profil-agent.ts (llm, alat, db, embedding, persiapan, ...)
 *   kejadian.jsonl   info, hasil per pertanyaan, cuplikan vLLM, sampel GPU, penanda tahap
 *   litellm.csv      waktu & token per panggilan dari LiteLLM (kolom waktu/token/status saja)
 * Olah dengan: python scripts/olah-alur-agent.py data/agent-workflow-latency/<waktu>
 *
 * Jalur: agent langsung (siapkanAgent -> streamText), sama dengan lapis A uji beban. Bukan portal.
 * Profiling dinyalakan HANYA di proses ini (AGENT_PROFILING_ENABLED=1); aplikasi lain tidak terpengaruh.
 * Prompt, rute, alat, sampling, konfigurasi vLLM/LiteLLM/Docker/AWS tidak diubah.
 * Tidak dicatat: isi pertanyaan, isi jawaban (kecuali --simpan-jawaban -> jawaban.jsonl), argumen alat (kecuali --catat-argumen -> argumen-alat.jsonl), SQL, hasil query, isi dokumen, kunci.
 * Tiket: hanya rancangan; jumlah tiket di database dibandingkan sebelum & sesudah.
 */
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const arg = (n: string, b: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : b; };
const COBA = process.argv.includes("--coba");
const FASE = (COBA ? "berurutan" : arg("fase", "pemanasan,berurutan,beban")).split(",");
const ULANG = COBA ? 1 : Number(arg("ulang", "5"));
// --concurrency = nama lain --tahap (jumlah pengguna aktif bersamaan per tahap). Tiap pengguna tetap 3 pertanyaan berurutan.
const TAHAP = arg("concurrency", arg("tahap", "1,2,3,5,8")).split(",").map(Number);
if (TAHAP.some(n => !Number.isInteger(n) || n < 1 || n > 64)) throw new Error("--concurrency/--tahap harus bilangan bulat 1–64, dipisah koma");
const PER = 3;                                   // pertanyaan per pemakai di tahap beban (sama dengan uji beban)
const JEDA_PERTANYAAN_MS = 5_000;                // sama dengan uji beban
const JEDA_TAHAP_MS = Number(arg("jeda-tahap", "120")) * 1000;
const BATAS_MS = Number(arg("timeout", "300")) * 1000;
const MODEL = arg("model", "mr-ai-gateway");
const SSH_KEY = arg("ssh-key", "");
const SSH_ARGS = [...(SSH_KEY ? ["-i", SSH_KEY] : []), arg("ssh-host", "mr-ec2")];
const PORT = arg("port", "8000").split(",").map(Number);
const DB_CONTAINER = arg("db-container", "gateway-db-1");
const LABEL = arg("label", "");
// Nama model di catatan LiteLLM (bawaan qwen3-14b = uji 17 & 20 Nov). Hanya huruf/angka/titik/strip karena masuk ke SQL.
const MODEL_LITELLM = arg("model-litellm", "qwen3-14b");
if (!/^[\w.-]+$/.test(MODEL_LITELLM)) throw new Error("--model-litellm hanya boleh huruf, angka, titik, strip");
const AKUN = "ridho@mustika-ratu.co.id";

const STEMPEL = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-") + (LABEL ? `-${LABEL}` : "") + (COBA ? "-coba" : "");
// --folder <path> (uji live 24 Nov 2026): taruh hasil di folder induk satu sesi uji (mis. .../<waktu>-14b-post-optimization-seqs4/T1),
// supaya fase-fase satu sesi tidak tercecer. Bawaan tetap data/agent-workflow-latency/<waktu>[-label].
const DIR = arg("folder", "") || `data/agent-workflow-latency/${STEMPEL}`;
// --set kontrol (uji live 24 Nov 2026): pertanyaan kontrol generalisasi (scripts/lib/skenario-kontrol.mts) dengan
// kriterianya sendiri. Bawaan "q" = Q1–Q8 historis, evaluator v1/v2 tidak berubah.
const SET = arg("set", "q");
if (!["q", "kontrol"].includes(SET)) throw new Error("--set harus q atau kontrol");
mkdirSync(DIR, { recursive: true });
// --simpan-jawaban: isi jawaban ikut dicatat ke jawaban.jsonl (hanya di laptop; folder data/ tidak ikut Git).
// Bawaan MATI. Dinyalakan atas persetujuan user 20 Nov 2026 untuk menelusuri jawaban yang tidak sesuai kriteria.
// Jawaban bisa memuat data perusahaan (angka penjualan, nama karyawan) — jangan dikirim ke luar.
const SIMPAN_JAWABAN = process.argv.includes("--simpan-jawaban");
// --catat-argumen: argumen tiap panggilan alat dicatat ke argumen-alat.jsonl (hanya di laptop). Bawaan MATI.
// Dinyalakan atas persetujuan user 23 Nov 2026 untuk mengukur ketepatan argumen alat (benchmark Qwen3.8-27B).
// Caranya hanya di proses uji ini: fetch global dibungkus SEBELUM modul aplikasi dimuat, lalu badan permintaan
// model berikutnya dibaca — di sana pesan asisten memuat tool_calls lengkap dengan argumennya. Aplikasi tidak diubah.
const CATAT_ARGUMEN = process.argv.includes("--catat-argumen");
let traceSekarang: () => string | null = () => null;
/** Argumen alat per trace (hanya saat --catat-argumen), dipakai evaluator v2 saat uji berjalan. */
const ARGUMEN = new Map<string, { alat: string; argumen: string }[]>();
if (CATAT_ARGUMEN) {
  const asli = globalThis.fetch, sudah = new Set<string>();
  const simpanArg = (tr: string | null, id: string, alat: string, argumen: string, sumber: "permintaan" | "respons") => {
    const k = `${tr}:${id}`;
    if (!id || sudah.has(k)) return; sudah.add(k);
    appendFileSync(`${DIR}/argumen-alat.jsonl`, JSON.stringify({ ts: Date.now(), trace: tr, id, alat, argumen, sumber }) + "\n");
    if (tr) { const l = ARGUMEN.get(tr) ?? []; l.push({ alat, argumen }); ARGUMEN.set(tr, l); }
  };
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const tr = traceSekarang();
    // (1) Dari badan PERMINTAAN: pesan asisten sebelumnya memuat tool_calls lengkap (cara lama, 23 Nov 2026).
    try {
      const b = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      for (const m of b?.messages ?? []) for (const tc of m?.role === "assistant" ? m.tool_calls ?? [] : [])
        simpanArg(tr, tc.id, tc.function?.name, tc.function?.arguments, "permintaan");
    } catch { /* badan bukan JSON: abaikan */ }
    const r = await asli(input, init);
    // (2) Dari RESPONS stream (24 Nov 2026): alat yang dipanggil di LANGKAH TERAKHIR tidak pernah muncul di
    // permintaan berikutnya, jadi dulu argumennya hilang (mis. delegasi terakhir perute sebelum batas langkah).
    // Hanya format chat-completions OpenAI (gateway LiteLLM). Format lain diteruskan tanpa dibaca.
    // Respons diteruskan apa adanya: salinan dibaca lewat tee(), kegagalan membaca tidak mengganggu pemanggil.
    if (!r.ok || !r.body || !(r.headers.get("content-type") ?? "").includes("event-stream")) return r;
    const [kirim, baca] = r.body.tee();
    (async () => {
      const kumpul = new Map<number, { id: string; nama: string; arg: string }>(), dek = new TextDecoder();
      let sisa = "";
      try {
        for (const p = baca.getReader(); ;) {
          const { done, value } = await p.read(); if (done) break;
          sisa += dek.decode(value, { stream: true });
          const baris = sisa.split("\n"); sisa = baris.pop() ?? "";
          for (const l of baris) {
            if (!l.startsWith("data:") || l.includes("[DONE]")) continue;
            let j: { choices?: { delta?: { tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
            try { j = JSON.parse(l.slice(5)); } catch { continue; }
            for (const tc of j.choices?.[0]?.delta?.tool_calls ?? []) {
              const i = tc.index ?? 0, x = kumpul.get(i) ?? { id: "", nama: "", arg: "" };
              if (tc.id) x.id = tc.id; if (tc.function?.name) x.nama += tc.function.name; if (tc.function?.arguments) x.arg += tc.function.arguments;
              kumpul.set(i, x);
            }
          }
        }
      } catch { /* stream dibatalkan/putus: simpan yang sudah terkumpul */ }
      for (const x of kumpul.values()) simpanArg(tr, x.id, x.nama, x.arg, "respons");
    })();
    return new Response(kirim, { status: r.status, statusText: r.statusText, headers: r.headers });
  }) as typeof fetch;
}
// Pembatalan saat habis waktu (24 Nov 2026). Bawaan MENYALA: pertanyaan yang melewati batas dibatalkan, dan
// VoltAgent meneruskan sinyalnya ke agent bawahan dan ke fetch panggilan model (diverifikasi di
// node_modules/@voltagent/core 2.10.0: createOperationContext + handoff memakai abortController yang sama).
// --tanpa-batal = perilaku lama (agent tetap bekerja setelah batas), untuk membandingkan dengan uji 13–23 Nov.
const BATAL_SAAT_HABIS = !process.argv.includes("--tanpa-batal");
process.env.AGENT_PROFILING_ENABLED = "1";
process.env.AGENT_PROFILING_FILE = `${DIR}/span.jsonl`;
const KEJADIAN = `${DIR}/kejadian.jsonl`;
const catat = (o: Record<string, unknown>) => appendFileSync(KEJADIAN, JSON.stringify({ ts: Date.now(), mono: performance.now(), ...o }) + "\n");

// ---------- modul (sesudah flag dipasang) ----------
const prof = await import("../lib/profil-agent.ts");
traceSekarang = () => prof.konteksProfil().trace ?? null;
const { poolPerusahaan } = await import("../lib/db-perusahaan.ts");
const { cariPengguna } = await import("../lib/pengguna.ts");
const { usernamePortal } = await import("../lib/akun-perusahaan.ts");
const { siapkanAgent } = await import("../voltagent/jalur-agent.ts");
const { KUNCI_MODEL, KUNCI_SALURAN } = await import("../voltagent/agents.ts");
const { maksToolGatewayModel, pesanGalatGateway, gatewayHidup } = await import("../voltagent/models.ts");
const { mulaiRekamGpu } = await import("./rekam-gpu.mts");
const { nilai: nilaiV2 } = await import("./lib/evaluator-agent.mts");
const { jenisSkenario } = await import("./lib/skenario-agent.mts");
const { jagaPotongan } = await import("../lib/alur/jaga-stream.ts");

// ---------- pertanyaan: sama persis dengan scripts/uji-beban.mts ----------
type Hasil = { teks: string; alat: string[]; rancangan: boolean };
// `benar` = kriteria LAMA (13–23 Nov), dibiarkan apa adanya supaya hasil lama & baru bisa dibandingkan.
// Evaluator v2: jenis tiap pertanyaan di scripts/lib/skenario-agent.mts, kriterianya di scripts/lib/evaluator-agent.mts.
type Pertanyaan = { kode: string; jenis: string; teks: string; benar: (h: Hasil) => boolean; kontrol?: import("./lib/skenario-kontrol.mts").Kontrol };
let totalSeptember = 0, totalAgustus = 0;
const angkaId = (n: number) => n.toLocaleString("id-ID");
const PERTANYAAN: Pertanyaan[] = [
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
];
// Tahap 2 (24 Nov 2026): `--kode Q5,Q8` menyaring pertanyaan untuk uji terarah. Bawaan: semua, perilaku lama tidak berubah.
const { KONTROL } = await import("./lib/skenario-kontrol.mts");
const SUMBER = SET === "kontrol"
  ? KONTROL.map((k) => ({ kode: k.kode, jenis: `Kontrol: ${k.kelompok}`, teks: k.teks, benar: () => false, kontrol: k } as Pertanyaan))
  : PERTANYAAN;
const KODE = arg("kode", "").split(",").map((s) => s.trim()).filter(Boolean);
const DAFTAR = KODE.length ? SUMBER.filter((p) => KODE.includes(p.kode)) : SUMBER;
if (KODE.length && DAFTAR.length !== KODE.length) throw new Error(`--kode tidak dikenal: ${KODE.filter((k) => !SUMBER.some((p) => p.kode === k)).join(",")}`);
/** Acak dengan seed tetap (mulberry32) — sama dengan uji-beban.mts. */
function acak(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const kocok = <T,>(a: T[], seed: number) => { const r = acak(seed), b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- akun & database (hanya membaca) ----------
const db = poolPerusahaan();
const { rows: [emp] } = await db.query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users WHERE lower(u.username) = $1`, [AKUN]);
const akun = await cariPengguna(usernamePortal(emp.id_employee));
if (!akun?.id_employee) throw new Error("akun portal uji tidak ditemukan");
{
  const { buatToolTotalPenjualan } = await import("../voltagent/tools-penjualan.ts");
  const t = buatToolTotalPenjualan() as unknown as { execute: (a: object) => Promise<{ total_unit?: number }> };
  totalSeptember = (await t.execute({ dari: "2026-09", sampai: "2026-09" })).total_unit ?? 0;
  totalAgustus = (await t.execute({ dari: "2026-08", sampai: "2026-08" })).total_unit ?? 0;
}
// Registri kemampuan akun uji, dirakit PERSIS seperti produksi (akses aplikasi + izin + batas alat model), hanya
// nama & jenis alat. Dipakai kriteria kontrol ("kemampuan yang benar-benar terpasang") dan snapshot pre-flight.
const registriAkun = await (async () => {
  const { aksesUntukEmployee } = await import("../lib/akses-aplikasi.ts");
  const { buatRouter } = await import("../voltagent/agent-konfig.ts");
  const { buatPemegangPenjaga } = await import("../lib/alur/penjaga-alur.ts");
  const akses = await aksesUntukEmployee(akun!.id_employee!);
  const pp = buatPemegangPenjaga();
  const r = akses ? await buatRouter(akses.sesi, akses.apps, undefined, undefined, maksToolGatewayModel(MODEL), undefined, pp) : undefined;
  return { bawahan: r?.bawahan.map((b) => ({ nama: b.nama, jumlah_alat: b.jumlahTool })) ?? [],
    agent: pp.registri()?.agent.map((a) => ({ nama: a.nama, alat: a.alat.map((t) => ({ nama: t.nama, jenis: t.jenis })) })) ?? null };
})();
writeFileSync(`${DIR}/registri-kemampuan.json`, JSON.stringify(registriAkun, null, 1));
const ALAT_TERSEDIA = new Set((registriAkun.agent ?? []).flatMap((a) => a.alat.map((t) => t.nama)));
const mulaiUji = new Date();
const tiketBaru = async () => (await db.query<{ n: number }>(
  `SELECT count(*)::int n FROM portal_ticket WHERE id_employee = $1 AND created_at >= $2`, [akun.id_employee, mulaiUji])).rows[0].n;

// ---------- vLLM lewat SSH (hanya membaca) ----------
const POLA = "^vllm:(request_queue_time|request_prefill_time|request_decode_time|time_to_first_token|e2e_request_latency|request_inference_time)_seconds_(sum|count)|^vllm:num_preemptions_total|^vllm:prefix_cache_(queries|hits)_total|^vllm:kv_cache_usage_perc|^vllm:num_requests_(running|waiting)\\{|^vllm:(prompt_tokens|generation_tokens|request_success)_total";
type Cuplikan = Record<string, number> & { per_replika?: Record<string, Record<string, number>> };
/**
 * Cuplikan /metrics SEMUA replika (`--port`). Kunci tingkat atas = JUMLAH semua replika, jadi format
 * lama (1 replika) tetap terbaca pengolah. `per_replika` = angka tiap port. `health` = 200 hanya
 * kalau setiap replika menjawab 200.
 */
function vllm(): Promise<Cuplikan> {
  const perintah = PORT.map((p) => `echo "##${p} $(curl -s -m 5 -o /dev/null -w '%{http_code}' 127.0.0.1:${p}/health)"; curl -s -m 5 127.0.0.1:${p}/metrics | grep -E '${POLA}'`).join("; ");
  return new Promise((ok) => execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", ...SSH_ARGS, perintah],
    { timeout: 30_000 }, (e, out) => {
      const total: Record<string, number> = {}, per: Record<string, Record<string, number>> = {};
      let port = "", semuaSehat = true;
      for (const b of String(out ?? "").split("\n")) {
        const h = /^##(\d+) (\d+)/.exec(b);
        if (h) { port = h[1]; per[port] = { health: Number(h[2]) }; if (h[2] !== "200") semuaSehat = false; continue; }
        const nama = b.split(/[{ ]/)[0].replace("vllm:", ""); const v = Number(b.trim().split(" ").pop());
        if (port && nama && Number.isFinite(v)) { per[port][nama] = (per[port][nama] ?? 0) + v; total[nama] = (total[nama] ?? 0) + v; }
      }
      const m = { ...total, health: semuaSehat && Object.keys(per).length === PORT.length ? 200 : 0 } as Cuplikan;
      if (PORT.length > 1) m.per_replika = per;
      if (e) m.galat_ssh = 1;
      ok(m);
    }));
}
const tunggu = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function tungguKosong(label: string) {
  for (let i = 0; i < 60; i++) {
    const v = await vllm();
    if (v.health === 200 && (v.num_requests_running ?? 0) + (v.num_requests_waiting ?? 0) === 0) return v;
    await tunggu(5000);
  }
  throw new Error(`antrean vLLM tidak kosong sebelum ${label}`);
}

// ---------- setelan replika yang SEDANG jalan (hanya membaca: docker ps + docker inspect) ----------
// Supaya laporan tidak bergantung pada ingatan "terakhir diketahui": max-num-seqs dll dibaca langsung dari container.
type Setelan = { port: number; nama: string; max_num_seqs: number | null; max_model_len: number | null; gpu_mem: number | null; gambar: string };
function bacaSetelan(): Promise<Setelan[]> {
  const perintah = PORT.map((p) => `n=$(docker ps --filter publish=${p} --format '{{.Names}}' | head -1); echo "##${p} $n $(docker inspect $n --format '{{.Image}}' 2>/dev/null | cut -c8-19) $(docker inspect $n --format '{{join .Args " "}}' 2>/dev/null)"`).join("; ");
  return new Promise((ok) => execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", ...SSH_ARGS, perintah], { timeout: 30_000 }, (_e, out) => {
    const hasil: Setelan[] = [];
    for (const b of String(out ?? "").split("\n")) {
      const m = /^##(\d+) (\S*) (\S*) (.*)$/.exec(b); if (!m) continue;
      const ambil = (k: string) => { const r = new RegExp(`--${k}[ =]([0-9.]+)`).exec(m[4]); return r ? Number(r[1]) : null; };
      hasil.push({ port: Number(m[1]), nama: m[2], gambar: m[3], max_num_seqs: ambil("max-num-seqs"), max_model_len: ambil("max-model-len"), gpu_mem: ambil("gpu-memory-utilization") });
    }
    ok(hasil);
  }));
}

// ---------- progres: progres.json diperbarui tiap pertanyaan selesai, bisa dipantau tanpa Claude Code ----------
const TARGET: Record<string, number> = {
  ...(FASE.includes("pemanasan") ? { pemanasan: 8 } : {}),
  ...(FASE.includes("berurutan") ? { berurutan: COBA ? 1 : ULANG * DAFTAR.length } : {}),
  ...(FASE.includes("beban") ? Object.fromEntries(TAHAP.map((n) => [`beban-${n}`, n * PER])) : {}),
};
const PROG = { mulai: new Date().toISOString(), konfig: "", tahap_sekarang: "", per_tahap: {} as Record<string, { target: number; selesai: number; ok: number; benar: number; habis_waktu: number; galat: number; durasi: number[]; v2: Record<string, number> }> };
const persentil = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const k = (s.length - 1) * p; const f = Math.floor(k), c = Math.min(f + 1, s.length - 1); return s[f] + (s[c] - s[f]) * (k - f); };
function catatProgres(kunci: string, status: string, benar: boolean, detik: number, hasilV2?: string) {
  const t = PROG.per_tahap[kunci] ??= { target: TARGET[kunci] ?? 0, selesai: 0, ok: 0, benar: 0, habis_waktu: 0, galat: 0, durasi: [], v2: {} };
  t.selesai++; t.durasi.push(detik);
  if (status === "ok") t.ok++; if (benar) t.benar++; if (status === "waktu-habis") t.habis_waktu++; if (status === "galat") t.galat++;
  if (hasilV2) t.v2[hasilV2] = (t.v2[hasilV2] ?? 0) + 1;
  const semua = Object.values(PROG.per_tahap), tot = Object.values(TARGET).reduce((a, b) => a + b, 0);
  const isi = {
    diperbarui: new Date().toISOString(), mulai: PROG.mulai, konfig: PROG.konfig, folder: DIR, tahap_sekarang: kunci,
    total: { target: tot, selesai: semua.reduce((a, x) => a + x.selesai, 0) },
    per_tahap: Object.fromEntries(Object.entries(PROG.per_tahap).map(([k, x]) => [k, {
      target: x.target, selesai: x.selesai, sisa: Math.max(0, x.target - x.selesai), ok: x.ok, sesuai_kriteria: x.benar, habis_waktu: x.habis_waktu, galat: x.galat, evaluator_v2: x.v2,
      p50_dtk: Math.round((persentil(x.durasi, .5) ?? 0) * 10) / 10, p95_dtk: Math.round((persentil(x.durasi, .95) ?? 0) * 10) / 10 }])),
  };
  try { writeFileSync(`${DIR}/progres.json`, JSON.stringify(isi, null, 1)); } catch { /* jangan hentikan uji gara-gara berkas progres */ }
  if (t.selesai === t.target) {
    console.log(`  >> selesai ${kunci}: ${t.selesai}/${t.target} · ok ${t.ok} · sesuai kriteria ${t.benar} · habis waktu ${t.habis_waktu} · galat ${t.galat} · v2 ${Object.entries(t.v2).map(([h, n]) => `${h} ${n}`).join("/")} · P50 ${isi.per_tahap[kunci].p50_dtk} dtk · P95 ${isi.per_tahap[kunci].p95_dtk} dtk · total ${isi.total.selesai}/${tot}`);
  }
}

// ---------- satu pertanyaan ----------
const maks = maksToolGatewayModel(MODEL);
let galatBeruntun = 0;
async function tanya(p: Pertanyaan, meta: Record<string, unknown>) {
  const trace = randomUUID();
  const mono0 = performance.now(), mulai = Date.now();
  let ttft: number | null = null, teks = "", galat = "", rancangan = 0, alat: string[] = [], habis = false, nDelegasi: number | null = null;
  const uji: { penjaga: { keadaan: () => Record<string, unknown> } | null } = { penjaga: null };
  const delegasiDitolak: string[] = [];   // kode penolakan penjaga per delegate_task yang tidak dijalankan
  await prof.denganTrace(trace, () => prof.rentang("permintaan", p.kode, async () => {
    const induk = prof.konteksProfil().span;
    const jalur = await prof.rentang("persiapan", "siapkanAgent", () => siapkanAgent(akun!.id_employee, maks));
    if (jalur.jalur !== "konfigurasi") { galat = `jalur ${jalur.jalur}: ${jalur.sebab}`; return; }
    // Delegasi (delegate_task) diamati dari event stream tingkat atas: mulai saat tool-call, selesai saat tool-result.
    // 24 Nov 2026 (RCA): ikut dicatat TARGET delegasi (nama agent saja), panjang tugas, dan panjang jawaban tiap
    // agent bawahan — tanpa isi. Isi tugas hanya tercatat di argumen-alat.jsonl kalau --catat-argumen.
    const delegasi = new Map<string, { m: number; w: number; id: string; target: string[]; tugas_kar: number | null }>();
    const ac = new AbortController();
    const kerja = (async () => {
      try {
        const h = await jalur.agent.streamText([{ id: "u0", role: "user", parts: [{ type: "text", text: p.teks }] }] as never,
          { context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" }, ...(BATAL_SAAT_HABIS ? { abortSignal: ac.signal } : {}) } as never);
        // Tahap 2 (24 Nov 2026): jawaban dibaca SESUDAH penyaring penjaga — sama dengan yang diterima pengguna web.
        // Dengan PENJAGA_ALUR=mati penjaga tidak ada dan stream dibaca mentah (perbandingan A-B).
        type Bagian = { type: string; toolName?: string; toolCallId?: string; text?: string; textDelta?: string; error?: unknown; input?: unknown; args?: unknown; output?: unknown; result?: unknown };
        const pj = jalur.penjaga();
        uji.penjaga = pj;
        const aliran = (pj ? jagaPotongan(h.fullStream as AsyncIterable<Bagian>, pj, "full") : h.fullStream) as AsyncIterable<Bagian>;
        for await (const x of aliran) {
          const t = performance.now();
          if (x.type === "text-delta") { ttft ??= t - mono0; teks += x.text ?? x.textDelta ?? ""; }
          if (x.type === "tool-call" && x.toolName === "delegate_task") {
            const inp = (x.input ?? x.args ?? {}) as { targetAgents?: unknown; task?: unknown };
            const target = Array.isArray(inp.targetAgents) ? inp.targetAgents.filter((a) => typeof a === "string").map((a) => String(a).slice(0, 60)) : [];
            delegasi.set(x.toolCallId ?? String(delegasi.size), { m: t, w: Date.now(), id: randomUUID().replace(/-/g, "").slice(0, 16),
              target, tugas_kar: typeof inp.task === "string" ? inp.task.length : null });
          }
          if ((x.type === "tool-result" || x.type === "tool-error") && x.toolName === "delegate_task") {
            const d = delegasi.get(x.toolCallId ?? "") ?? [...delegasi.values()].at(-1);
            const out = x.output ?? x.result;
            // Panjang jawaban per agent bawahan (bentuk hasil delegate_task VoltAgent: daftar {agentName, response}).
            const jawabanAgen = Array.isArray(out) ? out.map((o) => ({ agen: String((o as { agentName?: unknown })?.agentName ?? "?").slice(0, 60),
              kar: String((o as { response?: unknown })?.response ?? "").length })) : null;
            let hasilKar: number | null = null;
            try { hasilKar = typeof out === "string" ? out.length : (JSON.stringify(out) ?? "").length; } catch { /* abaikan */ }
            // Tahap 2–6: delegasi yang DITOLAK penjaga tidak pernah menjalankan agent bawahan. Dihitung terpisah
            // supaya evaluator v2 (efisiensi sapaan, jumlah delegasi) tidak menganggapnya delegasi sungguhan.
            const ditolak = !!out && !Array.isArray(out) && (out as { status?: unknown }).status === "ditolak-penjaga";
            if (ditolak) delegasiDitolak.push(String((out as { kode?: unknown }).kode ?? "?"));
            if (d) prof.catatProfil({ t: "span", trace, span: d.id, parent: induk, jenis: "delegasi", nama: "delegate_task", status: ditolak ? "ditolak" : x.type === "tool-result" ? "ok" : "galat",
              mulai: d.w, mulai_mono: d.m, durasi_ms: t - d.m, target: d.target, tugas_kar: d.tugas_kar, hasil_kar: hasilKar, jawaban_agen: jawabanAgen });
          }
          if (x.type === "error") galat = pesanGalatGateway(x.error) ?? String((x.error as Error)?.message ?? x.error);
        }
      } catch (e) { if (!ac.signal.aborted) galat = pesanGalatGateway(e) ?? (e as Error).message; }
    })();
    habis = await Promise.race([kerja.then(() => false), tunggu(BATAS_MS).then(() => true)]);
    if (habis) {
      galat = `waktu habis (${BATAS_MS / 1000} dtk)`;
      if (BATAL_SAAT_HABIS) {
        ac.abort(new Error("batas waktu benchmark"));
        await Promise.race([kerja, tunggu(10_000)]);   // beri kesempatan span ditutup berstatus "batal"
      }
    }
    alat = [...jalur.alat]; rancangan = jalur.rancangan.length; nDelegasi = delegasi.size - delegasiDitolak.length;
  }));
  teks = teks.trim();
  const total = performance.now() - mono0;
  const status = galat ? (habis ? "waktu-habis" : "galat") : teks ? "ok" : "kosong";
  // Evaluator v2 (scripts/lib/evaluator-agent.mts), dinilai dari bukti yang ada saat uji. Status hasil alat
  // baru tersedia di span sesudah uji, jadi dipakai saat penilaian ulang (scripts/evaluasi-ulang-v2.mts).
  // tiketTersimpan per skenario tidak diketahui di sini (penghitung tiket hanya per uji) -> null.
  const bukti = { status, teks, alat: alat.filter((a) => a !== "delegate_task"), rancangan,
    delegasi: nDelegasi, argumen: CATAT_ARGUMEN ? (ARGUMEN.get(trace) ?? []) : null, statusAlat: null, tiketTersimpan: null } as const;
  const keadaanPenjaga = uji.penjaga ? uji.penjaga.keadaan() as { penutup?: string } : null;
  const nilai_v2 = p.kontrol
    ? p.kontrol.nilai({ ...bukti }, { tersedia: ALAT_TERSEDIA, angka: { agustus: totalAgustus, september: totalSeptember }, penjaga: keadaanPenjaga })
    : nilaiV2(jenisSkenario(p.kode, { q1_angka: totalSeptember, q1_periode: "2026-09" })!, { ...bukti });
  // v1 (`benar`) untuk set kontrol = lulus kriteria kontrol (tidak ada kriteria lama untuk pertanyaan baru).
  const benar = !galat && (p.kontrol ? nilai_v2.hasil === "lulus" : p.benar({ teks, alat, rancangan: rancangan > 0 }));
  catat({ t: "q", trace, ...meta, kode: p.kode, jenis: p.jenis, mulai, total_ms: total, ttft_jawaban_ms: ttft,
    status, galat: galat.slice(0, 120), benar, nilai_v2, delegasi: nDelegasi, alat, rancangan,
    karakter_jawaban: teks.length,  // panjang saja, bukan isi
    // Tahap 2: ringkasan penjaga (kode penolakan, alasan berhenti, jenis penutup) — tanpa isi pesan. null = penjaga mati.
    penjaga: uji.penjaga ? (({ idPermintaan: _i, ...k }) => k)(uji.penjaga.keadaan() as { idPermintaan?: unknown }) : null,
    delegasi_ditolak: delegasiDitolak });
  if (SIMPAN_JAWABAN) appendFileSync(`${DIR}/jawaban.jsonl`, JSON.stringify({ trace, ...meta, kode: p.kode, benar, nilai_v2, status, alat, rancangan, jawaban: teks }) + "\n");
  galatBeruntun = galat && !habis ? galatBeruntun + 1 : 0;
  catatProgres(meta.fase === "beban" ? `beban-${meta.tahap}` : String(meta.fase), status, benar, total / 1000, nilai_v2.hasil);
  console.log(`  ${String(meta.fase).padEnd(10)} ${meta.tahap ? `T${meta.tahap} p${meta.pemakai}/${meta.tahap} #${meta.urut}` : `u${meta.ulang}`} ${p.kode} ${(total / 1000).toFixed(1)} dtk ${galat ? "GALAT " + galat.slice(0, 50) : benar ? "benar" : "kurang tepat"} · v2 ${nilai_v2.hasil}/${nilai_v2.kategori} [${alat.join(",")}]`);
  if (galatBeruntun >= 3) throw new Error("3 galat beruntun: layanan tidak stabil, uji dihentikan");
}

// ---------- LiteLLM (hanya kolom waktu, token, status) ----------
function ambilLiteLLM(dari: Date, sampai: Date): Promise<string> {
  const f = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  const sql = `\\pset footer off
select to_char("startTime", 'YYYY-MM-DD HH24:MI:SS.MS') mulai, round(extract(epoch from "completionStartTime" - "startTime")::numeric, 3) ttft,
 round(extract(epoch from "endTime" - "startTime")::numeric, 3) total, prompt_tokens, completion_tokens, status,
 coalesce(to_jsonb(s)->>'api_base', '') api_base,
 coalesce(to_jsonb(s)->'metadata'->'usage_object'->'completion_tokens_details'->>'reasoning_tokens', '') reasoning_tokens
from "LiteLLM_SpendLogs" s where model ilike '%${MODEL_LITELLM}%' and "startTime" >= '${f(dari)}' and "startTime" <= '${f(sampai)}' order by 1;
`;
  return new Promise((ok) => {
    const p = spawn("ssh", ["-o", "BatchMode=yes", ...SSH_ARGS, `docker exec -i ${DB_CONTAINER} sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -A -F , -q'`]);
    let out = ""; p.stdout.on("data", (d) => out += d); p.on("close", () => ok(out)); p.stdin.end(sql);
  });
}

// ---------- jalan ----------
console.log(`profil alur agent -> ${DIR}`);
// health check: vLLM, LiteLLM, jalur agent
const v0 = await vllm();
const gw = await gatewayHidup(MODEL);
const uji = await siapkanAgent(akun.id_employee, maks);
const sehat = { vllm_health: v0.health, vllm_replika: PORT.length, vllm_kosong: (v0.num_requests_running ?? 0) + (v0.num_requests_waiting ?? 0) === 0, litellm: gw, jalur_agent: uji.jalur };
const setelan = await bacaSetelan();
const seqs = [...new Set(setelan.map((s) => s.max_num_seqs))];
PROG.konfig = `${MODEL_LITELLM} · ${setelan.length} replika · max-num-seqs=${seqs.join("/")} per replika · max-model-len=${[...new Set(setelan.map((s) => s.max_model_len))].join("/")}`;
catat({ t: "info", sehat, server: { port: PORT, db_container: DB_CONTAINER, label: LABEL, pakai_kunci_ssh: Boolean(SSH_KEY), replika: setelan }, fase: FASE, ulang: ULANG, tahap: TAHAP, per: PER, jeda_tahap_ms: JEDA_TAHAP_MS, batas_ms: BATAS_MS, model: MODEL, model_litellm: MODEL_LITELLM, node: process.version, coba: COBA, target: TARGET,
  batal_saat_habis: BATAL_SAAT_HABIS, evaluator: SET === "kontrol" ? "kontrol (scripts/lib/skenario-kontrol.mts)" : "v1 (benar) + v2 (nilai_v2)",
  penjaga_alur: process.env.PENJAGA_ALUR !== "mati", rute_kemampuan: process.env.RUTE_KEMAMPUAN !== "mati", set: SET, kode: DAFTAR.map((p) => p.kode),
  // Penjaga biaya: uji live hanya lewat gateway; alamat Anthropic diarahkan ke port mati di proses ini (tidak dicatat nilainya).
  anthropic_diblokir: /127\.0\.0\.1:9\b/.test(process.env.ANTHROPIC_BASE_URL ?? ""),
  harapan: { q1_angka: totalSeptember, q1_periode: "2026-09", agustus_angka: totalAgustus },
  registri: { agent: registriAkun.agent?.length ?? null, alat: ALAT_TERSEDIA.size } });
console.log("health check:", JSON.stringify(sehat));
console.log(`konfigurasi: ${PROG.konfig}`);
for (const s of setelan) console.log(`  port ${s.port} -> ${s.nama || "(tidak ketemu)"} · max-num-seqs ${s.max_num_seqs} · max-model-len ${s.max_model_len} · gpu-mem ${s.gpu_mem} · image ${s.gambar}`);
console.log(`rencana: ${Object.entries(TARGET).map(([k, v]) => `${k}=${v}`).join(", ")} · total ${Object.values(TARGET).reduce((a, b) => a + b, 0)} pertanyaan · progres: ${DIR}/progres.json`);
if (setelan.length !== PORT.length || setelan.some((s) => !s.nama)) console.log("PERINGATAN: tidak semua port punya container yang cocok — periksa --port");
if (seqs.length > 1) console.log("PERINGATAN: max-num-seqs berbeda antar replika — hasil tidak mewakili satu konfigurasi");
if (process.argv.includes("--dry-run")) { console.log("--dry-run: berhenti sebelum pertanyaan pertama. Tidak ada beban yang dikirim."); catat({ t: "stop", alasan: "dry-run" }); await db.end().catch(() => {}); process.exit(0); }
if (v0.health !== 200 || !gw || uji.jalur !== "konfigurasi" || !sehat.vllm_kosong) {
  catat({ t: "stop", alasan: "health check gagal" }); console.log("health check gagal: uji TIDAK dimulai"); process.exit(1);
}
const tiketAwal = await tiketBaru();
const gpu = mulaiRekamGpu("", 500, { sshArgs: SSH_ARGS, indeks: true });
await tunggu(3000);
const mulaiSemua = new Date();
try {
  if (FASE.includes("pemanasan")) {
    catat({ t: "fase", fase: "pemanasan", saat: "mulai" });
    for (const p of DAFTAR) { await tanya(p, { fase: "pemanasan" }); await tunggu(JEDA_PERTANYAAN_MS); }
    catat({ t: "fase", fase: "pemanasan", saat: "selesai" });
  }
  if (FASE.includes("berurutan")) {
    catat({ t: "fase", fase: "berurutan", saat: "mulai" });
    for (let u = 1; u <= ULANG; u++) {
      for (const p of (COBA ? DAFTAR.slice(0, 1) : kocok(DAFTAR, 100 + u))) {
        catat({ t: "vllm", saat: "awal", fase: "berurutan", ulang: u, kode: p.kode, ...await vllm() });
        await tanya(p, { fase: "berurutan", ulang: u });
        await tunggu(1500);
        catat({ t: "vllm", saat: "akhir", fase: "berurutan", ulang: u, kode: p.kode, ...await vllm() });
        await tunggu(JEDA_PERTANYAAN_MS);
      }
    }
    catat({ t: "fase", fase: "berurutan", saat: "selesai" });
  }
  if (FASE.includes("beban")) {
    for (const [ti, n] of TAHAP.entries()) {
      if (ti > 0 || FASE.includes("berurutan")) { console.log(`  jeda ${JEDA_TAHAP_MS / 1000} dtk sebelum tahap ${n} pengguna`); await tunggu(JEDA_TAHAP_MS); }
      const va = await tungguKosong(`tahap ${n}`);
      catat({ t: "vllm", saat: "awal", fase: "beban", tahap: n, ...va });
      catat({ t: "fase", fase: "beban", tahap: n, saat: "mulai" });
      await Promise.all(Array.from({ length: n }, async (_, u) => {
        // Pola uji-beban.mts: titik awal acak (seed 1000 x n), lalu bergiliran per pemakai.
        const awal = Math.floor(acak(1000 * n)() * DAFTAR.length);
        for (let k = 0; k < PER; k++) {
          const p = DAFTAR[(awal + u * PER + k) % DAFTAR.length];
          await tanya(p, { fase: "beban", tahap: n, pemakai: u + 1, urut: k + 1 });
          if (k < PER - 1) await tunggu(JEDA_PERTANYAAN_MS);
        }
      }));
      catat({ t: "fase", fase: "beban", tahap: n, saat: "selesai" });
      await tunggu(1500);
      catat({ t: "vllm", saat: "akhir", fase: "beban", tahap: n, ...await vllm() });
    }
  }
} catch (e) {
  catat({ t: "stop", alasan: (e as Error).message });
  console.log("DIHENTIKAN:", (e as Error).message);
}
const selesaiSemua = new Date();
const sampel = await gpu.berhenti();
for (const { t: tGpu, ...s } of sampel) catat({ t: "gpu", tGpu, ...s });
const tiket = (await tiketBaru()) - tiketAwal;
await tunggu(3000);
writeFileSync(`${DIR}/litellm.csv`, await ambilLiteLLM(new Date(mulaiSemua.getTime() - 60_000), new Date(selesaiSemua.getTime() + 60_000)));
catat({ t: "selesai", tiket_baru: tiket, vllm_akhir: await vllm() });
prof.siramProfil();
console.log(`selesai. tiket tersimpan selama uji: ${tiket} (harus 0). data: ${DIR}`);
await db.end().catch(() => {});
process.exit(0);
