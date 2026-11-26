/**
 * Uji beban Ratu AI dengan Qwen3 14B, sesuai `docs/benchmark/rencana-uji-beban-qwen3-14b.md`.
 *
 *   npx tsx --env-file=.env.local scripts/uji-beban.mts --lapis B [--tahap 1,2,3,5,8] [--per 3]
 *
 *   --lapis A  agent langsung (siapkanAgent -> streamText), mengukur gateway + model
 *   --lapis B  lewat http://localhost:3000/api/chat, ikut mengukur server portal di laptop
 *
 * Setiap pemakai virtual mengirim `--per` pertanyaan berurutan (jeda 5 dtk), masing-masing di
 * percakapan baru. Pertanyaan dipilih acak dengan seed tetap supaya tiap tahap bisa dibandingkan.
 * Semua pemakai virtual memakai akun pemilik proyek; sesi dibuat di laptop dan tokennya tidak
 * dicetak.
 *
 * HANYA MEMBACA database. Tiket hanya sampai rancangan; jumlah tiket dicek sebelum dan sesudah.
 * Hasil mentah: data/uji-beban-qwen3-14b-<waktu>-<lapis>.csv dan .json (tidak ikut Git).
 */
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { buatToken, NAMA_COOKIE } from "../lib/sesi.ts";
import { cariPengguna } from "../lib/pengguna.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { usernamePortal } from "../lib/akun-perusahaan.ts";

// ---------- argumen ----------
const arg = (n: string, b: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : b; };
const LAPIS = arg("lapis", "B") as "A" | "B";
const TAHAP = arg("tahap", "1,2,3,5,8").split(",").map(Number);
const PER = Number(arg("per", "3"));
const MODEL = arg("model", "mr-ai-gateway");
const BATAS_MS = Number(arg("timeout", "300")) * 1000;
const JEDA_PERTANYAAN_MS = 5_000;
const JEDA_TAHAP_MS = Number(arg("jeda-tahap", "120")) * 1000;
const PORTAL = process.env.PORTAL_URL ?? "http://localhost:3000";
// --mode gpu: 1 pemakai, tiap jenis pertanyaan --ulang kali, satu per satu, jeda --jeda dtk supaya
// GPU kembali diam di antara pertanyaan. Beban GPU per pertanyaan jadi bisa dipisahkan.
// --gpu: rekam nvidia-smi di server lewat SSH (scripts/rekam-gpu.mts) selama uji. Otomatis di --mode gpu.
const MODE = arg("mode", "beban") as "beban" | "gpu";
const REKAM_GPU = MODE === "gpu" || process.argv.includes("--gpu");
const ULANG = Number(arg("ulang", "3"));
const JEDA_GPU_MS = Number(arg("jeda", "20")) * 1000;
const AKUN = "ridho@mustika-ratu.co.id";

// ---------- pertanyaan (bagian 5 rencana) ----------
type Hasil = { teks: string; alat: string[]; rancangan: boolean };
type Pertanyaan = { kode: string; jenis: string; teks: string; benar: (h: Hasil) => boolean };
let totalSeptember = 0;
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

/** Acak dengan seed tetap (mulberry32), supaya urutan pertanyaan bisa diulang. */
function acak(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- akun, sesi, database ----------
const db = poolPerusahaan();
const { rows: [emp] } = await db.query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users WHERE lower(u.username) = $1`, [AKUN]);
const akun = await cariPengguna(usernamePortal(emp.id_employee));
if (!akun?.id_employee) throw new Error("akun portal uji tidak ditemukan");
const cookie = `${NAMA_COOKIE}=${await buatToken({
  id: akun.id, username: akun.username, nama: akun.nama, departemen: akun.departemen, peran: akun.peran,
  admin: Boolean(akun.is_admin), idEmployee: akun.id_employee,
})}`;
{
  const { buatToolTotalPenjualan } = await import("../voltagent/tools-penjualan.ts");
  const t = buatToolTotalPenjualan() as unknown as { execute: (a: object) => Promise<{ total_unit?: number }> };
  totalSeptember = (await t.execute({ dari: "2026-09", sampai: "2026-09" })).total_unit ?? 0;
}
const mulaiUji = new Date();
const tiketBaru = async () => (await db.query<{ n: number }>(
  `SELECT count(*)::int n FROM portal_ticket WHERE id_employee = $1 AND created_at >= $2`, [akun.id_employee, mulaiUji])).rows[0].n;

// ---------- log gateway ----------
// Lapis A: pembungkus fetch mencetak `[gateway] {...}` di proses ini. Lapis B: tercetak di log
// server portal, dibaca berdasarkan rentang waktu tahap.
type LogGw = { t: number; galat?: string; status?: number; ulang?: number; msHeader?: number; ms?: number; diulang?: boolean };
const logA: LogGw[] = [];
const infoAsli = console.info;
console.info = (...a: unknown[]) => {
  const s = String(a[0] ?? "");
  if (s.startsWith("[gateway] ")) { try { logA.push({ t: Date.now(), ...JSON.parse(s.slice(10)) }); } catch { /* lewati */ } }
};
async function logB(dari: number, sampai: number): Promise<LogGw[]> {
  const { readFile } = await import("node:fs/promises");
  const teks = await readFile(".next/dev/logs/next-development.log", "utf8").catch(() => "");
  const hasil: LogGw[] = [];
  const hariIni = new Date().toISOString().slice(0, 10);
  for (const baris of teks.split("\n")) {
    if (!baris.includes("[gateway]")) continue;
    try {
      const o = JSON.parse(baris) as { timestamp: string; message: string };
      const t = Date.parse(`${hariIni}T${o.timestamp}Z`);
      if (t < dari || t > sampai) continue;
      hasil.push({ t, ...JSON.parse(o.message.slice(o.message.indexOf("{"))) });
    } catch { /* lewati */ }
  }
  return hasil;
}

// ---------- satu pertanyaan ----------
type Baris = {
  lapis: string; tahap: number; pemakai: number; urut: number; kode: string; jenis: string;
  mulai: string; ms: number; ttft: number | null; status: string; galat: string; benar: boolean;
  alat: string; tokenMasuk: number | null; tokenKeluar: number | null;
  gpuRata?: number | null; gpuMaks?: number | null; dayaRataW?: number | null; dayaMaksW?: number | null;
  energiWh?: number | null; detikGpuSibuk?: number | null; suhuMaksC?: number | null;
};
const jenisGalat = (s: string) =>
  /429|Rate limit/i.test(s) ? "429" : /ECONNRESET|terputus|ECONNREFUSED|tidak bisa dihubungi/i.test(s) ? "putus-koneksi"
    : /waktu habis|timeout|aborted/i.test(s) ? "waktu-habis" : /500|InternalServer/i.test(s) ? "500" : "lain";

async function tanyaB(p: Pertanyaan): Promise<Omit<Baris, "lapis" | "tahap" | "pemakai" | "urut" | "kode" | "jenis" | "mulai">> {
  const mulai = Date.now();
  let ttft: number | null = null;
  const ac = new AbortController();
  const jam = setTimeout(() => ac.abort(), BATAS_MS);
  try {
    const r = await fetch(`${PORTAL}/api/chat`, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ model: MODEL, messages: [{ id: "u0", role: "user", parts: [{ type: "text", text: p.teks }] }] }),
    });
    if (!r.ok || !r.body) {
      const isi = (await r.text()).slice(0, 200);
      return { ms: Date.now() - mulai, ttft, status: String(r.status), galat: `${jenisGalat(isi)}: ${isi}`, benar: false, alat: "", tokenMasuk: null, tokenKeluar: null };
    }
    let teks = "", galat = "", sisa = "", alat: string[] = [], rancangan = false;
    let token: { masuk: number | null; keluar: number | null } | null = null;
    const pembaca = r.body.getReader(), dek = new TextDecoder();
    for (let x = await pembaca.read(); !x.done; x = await pembaca.read()) {
      sisa += dek.decode(x.value, { stream: true });
      const baris = sisa.split("\n"); sisa = baris.pop() ?? "";
      for (const b of baris) {
        if (!b.startsWith("data: ") || b === "data: [DONE]") continue;
        let ev: Record<string, unknown>; try { ev = JSON.parse(b.slice(6)); } catch { continue; }
        if (ev.type === "text-delta") { if (ttft === null) ttft = Date.now() - mulai; teks += String(ev.delta ?? ""); }
        if (ev.type === "error") galat = String(ev.errorText ?? "galat");
        const m = ev.messageMetadata as { alat?: string[]; rancangan?: unknown; token?: typeof token } | undefined;
        if (m?.alat) alat = m.alat;
        if (m?.rancangan) rancangan = true;
        if (m?.token) token = m.token;
      }
    }
    teks = teks.trim();
    return {
      ms: Date.now() - mulai, ttft, status: galat ? "galat" : teks ? "ok" : "kosong",
      galat: galat ? `${jenisGalat(galat)}: ${galat.slice(0, 160)}` : "", benar: !galat && p.benar({ teks, alat, rancangan }),
      alat: alat.join("|"),
      tokenMasuk: (token as { masuk: number | null } | null)?.masuk ?? null,
      tokenKeluar: (token as { keluar: number | null } | null)?.keluar ?? null,
    };
  } catch (e) {
    const s = (e as Error).name === "AbortError" ? "waktu habis" : (e as Error).message;
    return { ms: Date.now() - mulai, ttft, status: "galat", galat: `${jenisGalat(s)}: ${s.slice(0, 160)}`, benar: false, alat: "", tokenMasuk: null, tokenKeluar: null };
  } finally { clearTimeout(jam); }
}

let modulA: { siapkanAgent: typeof import("../voltagent/jalur-agent.ts").siapkanAgent; KUNCI_MODEL: string; KUNCI_SALURAN: string; maks: number; pesanGalat: (e: unknown) => string | null } | null = null;
async function tanyaA(p: Pertanyaan): ReturnType<typeof tanyaB> {
  if (!modulA) {
    const j = await import("../voltagent/jalur-agent.ts"), a = await import("../voltagent/agents.ts"), m = await import("../voltagent/models.ts");
    modulA = { siapkanAgent: j.siapkanAgent, KUNCI_MODEL: a.KUNCI_MODEL, KUNCI_SALURAN: a.KUNCI_SALURAN, maks: m.maksToolGatewayModel(MODEL), pesanGalat: m.pesanGalatGateway };
  }
  const mulai = Date.now();
  let ttft: number | null = null, teks = "", galat = "";
  const jalur = await modulA.siapkanAgent(akun!.id_employee, modulA.maks);
  if (jalur.jalur !== "konfigurasi") return { ms: 0, ttft, status: "galat", galat: `lain: jalur ${jalur.jalur}`, benar: false, alat: "", tokenMasuk: null, tokenKeluar: null };
  const kerja = (async () => {
    try {
      const h = await jalur.agent.streamText([{ id: "u0", role: "user", parts: [{ type: "text", text: p.teks }] }] as never,
        { context: { [modulA!.KUNCI_MODEL]: MODEL, [modulA!.KUNCI_SALURAN]: "web" } });
      for await (const x of h.fullStream as AsyncIterable<{ type: string; text?: string; textDelta?: string; error?: unknown }>) {
        if (x.type === "text-delta") { if (ttft === null) ttft = Date.now() - mulai; teks += x.text ?? x.textDelta ?? ""; }
        if (x.type === "error") galat = modulA!.pesanGalat(x.error) ?? String((x.error as Error)?.message ?? x.error);
      }
    } catch (e) { galat = modulA!.pesanGalat(e) ?? (e as Error).message; }
  })();
  const habis = await Promise.race([kerja.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), BATAS_MS))]);
  if (habis) galat = "waktu habis";
  teks = teks.trim();
  const alat = [...jalur.alat];
  return {
    ms: Date.now() - mulai, ttft, status: galat ? "galat" : teks ? "ok" : "kosong",
    galat: galat ? `${jenisGalat(galat)}: ${galat.slice(0, 160)}` : "",
    benar: !galat && p.benar({ teks, alat, rancangan: jalur.rancangan.length > 0 }),
    alat: alat.join("|"), tokenMasuk: null, tokenKeluar: null,
  };
}

// ---------- pemantau laptop ----------
const sampelLaptop: { t: number; ramTerpakaiGB: number; cpu: number }[] = [];
let cpuLalu = os.cpus().map((c) => c.times);
const pantau = setInterval(() => {
  const kini = os.cpus().map((c) => c.times);
  let sibuk = 0, total = 0;
  kini.forEach((t, i) => { const l = cpuLalu[i]; const d = (k: keyof typeof t) => t[k] - l[k];
    const tot = d("user") + d("nice") + d("sys") + d("idle") + d("irq"); total += tot; sibuk += tot - d("idle"); });
  cpuLalu = kini;
  sampelLaptop.push({ t: Date.now(), ramTerpakaiGB: (os.totalmem() - os.freemem()) / 2 ** 30, cpu: total ? (sibuk / total) * 100 : 0 });
}, 5_000);

// ---------- jalannya uji ----------
const persen = (a: number[], q: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const semua: Baris[] = [];
const ringkasan: Record<string, unknown>[] = [];
const tiketAwal = await tiketBaru();
const { mulaiRekamGpu, ringkasGpu } = await import("./rekam-gpu.mts");
const perekam = REKAM_GPU ? mulaiRekamGpu() : null;
if (perekam) {
  await new Promise((x) => setTimeout(x, 3000));
  if (!perekam.sampel.length) throw new Error(`perekam GPU tidak mendapat sampel lewat SSH: ${perekam.galat() || "(tanpa pesan)"}`);
  infoAsli(`    perekam GPU jalan (${perekam.sampel.length} sampel awal, GPU ${perekam.sampel.at(-1)!.gpu}%, ${perekam.sampel.at(-1)!.dayaW} W)`);
}
infoAsli(MODE === "gpu"
  ? `\n=== Uji beban GPU per pertanyaan, lapis ${LAPIS}, model ${MODEL}, ${PERTANYAAN.length} jenis x ${ULANG}, jeda ${JEDA_GPU_MS / 1000} dtk ===`
  : `\n=== Uji beban lapis ${LAPIS}, model ${MODEL}, tahap ${TAHAP.join(",")}, ${PER} pertanyaan/pemakai ===`);
infoAsli(`    pembanding Q1: total unit September 2026 = ${angkaId(totalSeptember)}`);

if (MODE === "gpu") {
  // Jeda awal supaya ada patokan GPU diam sebelum pertanyaan pertama.
  await new Promise((x) => setTimeout(x, JEDA_GPU_MS));
  let urut = 0;
  for (let u = 1; u <= ULANG; u++) {
    for (const p of PERTANYAAN) {
      urut++;
      const mulai = new Date().toISOString();
      const h = LAPIS === "A" ? await tanyaA(p) : await tanyaB(p);
      semua.push({ lapis: LAPIS, tahap: 1, pemakai: 1, urut, kode: p.kode, jenis: p.jenis, mulai, ...h });
      const g = perekam ? ringkasGpu(perekam.sampel, Date.parse(mulai), Date.now()) : null;
      infoAsli(`    ${urut}/${PERTANYAAN.length * ULANG} ${p.kode} ${(h.ms / 1000).toFixed(1)} dtk ${h.status}${h.galat ? ` (${h.galat.slice(0, 60)})` : ""}${h.benar ? "" : " [tidak benar]"}` +
        (g ? ` | GPU rata ${g.gpuRata}% maks ${g.gpuMaks}%, ${g.dayaRata} W, ${g.energiWh} Wh` : ""));
      await new Promise((x) => setTimeout(x, JEDA_GPU_MS));
    }
  }
}

for (const [ti, n] of (MODE === "gpu" ? [] : TAHAP).entries()) {
  const mulaiTahap = Date.now();
  const tugas = Array.from({ length: n }, async (_, u) => {
    // Bergiliran dengan titik awal acak (seed tetap), supaya tiap tahap mencakup jenis yang beragam
    // dan pemakai berbeda tidak semuanya menanyakan hal yang sama pada saat yang sama.
    const awal = Math.floor(acak(1000 * n)() * PERTANYAAN.length);
    for (let k = 0; k < PER; k++) {
      const p = PERTANYAAN[(awal + u * PER + k) % PERTANYAAN.length];
      const mulai = new Date().toISOString();
      const h = LAPIS === "A" ? await tanyaA(p) : await tanyaB(p);
      semua.push({ lapis: LAPIS, tahap: n, pemakai: u + 1, urut: k + 1, kode: p.kode, jenis: p.jenis, mulai, ...h });
      infoAsli(`    T${ti + 1} pemakai ${u + 1}/${n} ${p.kode} ${(h.ms / 1000).toFixed(1)} dtk ${h.status}${h.galat ? ` (${h.galat.slice(0, 60)})` : ""}${h.benar ? "" : " [tidak benar]"}`);
      if (k < PER - 1) await new Promise((x) => setTimeout(x, JEDA_PERTANYAAN_MS));
    }
  });
  await Promise.all(tugas);
  const selesaiTahap = Date.now();
  const baris = semua.filter((b) => b.tahap === n);
  const ok = baris.filter((b) => b.status === "ok");
  const log = LAPIS === "A" ? logA.filter((l) => l.t >= mulaiTahap && l.t <= selesaiTahap) : await logB(mulaiTahap, selesaiTahap);
  const lapt = sampelLaptop.filter((s) => s.t >= mulaiTahap && s.t <= selesaiTahap);
  const galatPer = (j: string) => baris.filter((b) => b.galat.startsWith(j)).length;
  const r = {
    lapis: LAPIS, tahap: `T${ti + 1}`, pemakai: n, pertanyaan: baris.length,
    berhasil: ok.length, persenBerhasil: baris.length ? Math.round((ok.length / baris.length) * 1000) / 10 : null,
    benar: baris.filter((b) => b.benar).length,
    p50: persen(ok.map((b) => b.ms / 1000), 0.5), p95: persen(ok.map((b) => b.ms / 1000), 0.95),
    ttftP50: persen(ok.flatMap((b) => (b.ttft === null ? [] : [b.ttft / 1000])), 0.5),
    panggilanModel: log.filter((l) => l.status !== undefined || l.galat).length,
    panggilanPerPertanyaan: baris.length ? Math.round((log.filter((l) => l.status !== undefined).length / baris.length) * 10) / 10 : null,
    gw429: log.filter((l) => l.status === 429).length,
    gwGalatSambungan: log.filter((l) => l.galat).length,
    retry: log.filter((l) => l.diulang).length,
    galat429: galatPer("429"), galatPutus: galatPer("putus-koneksi"), galatWaktuHabis: galatPer("waktu-habis"), galat500: galatPer("500"), galatLain: galatPer("lain"),
    kosong: baris.filter((b) => b.status === "kosong").length,
    ramLaptopMaksGB: lapt.length ? Math.round(Math.max(...lapt.map((s) => s.ramTerpakaiGB)) * 10) / 10 : null,
    cpuLaptopRata: lapt.length ? Math.round(lapt.reduce((a, s) => a + s.cpu, 0) / lapt.length) : null,
    gpu: perekam ? ringkasGpu(perekam.sampel, mulaiTahap, selesaiTahap) : null,
    mulai: new Date(mulaiTahap).toISOString(), selesai: new Date(selesaiTahap).toISOString(),
  };
  ringkasan.push(r);
  infoAsli(`  >> T${ti + 1} (${n} pemakai): berhasil ${r.berhasil}/${r.pertanyaan}, benar ${r.benar}, P50 ${r.p50?.toFixed(1)} dtk, P95 ${r.p95?.toFixed(1)} dtk, kata pertama P50 ${r.ttftP50?.toFixed(1)} dtk, ` +
    `429 ${r.gw429}, retry ${r.retry}, RAM laptop maks ${r.ramLaptopMaksGB} GB`);

  const galatPersen = 100 - (r.persenBerhasil ?? 0);
  if (galatPersen > 50) { infoAsli(`  !! galat ${galatPersen}% > 50%, uji dihentikan`); break; }
  const berikut = TAHAP[ti + 1];
  if (berikut === undefined) break;
  if (berikut > 5 && galatPersen >= 20) { infoAsli(`  !! galat ${galatPersen}% >= 20%, tahap ${berikut} pemakai dilewati`); break; }
  infoAsli(`  ... jeda ${JEDA_TAHAP_MS / 1000} dtk sebelum tahap berikut`);
  await new Promise((x) => setTimeout(x, JEDA_TAHAP_MS));
}
clearInterval(pantau);
const sampelGpu = perekam ? await perekam.berhenti() : [];
for (const b of semua) {
  const g = perekam ? ringkasGpu(sampelGpu, Date.parse(b.mulai), Date.parse(b.mulai) + b.ms) : null;
  Object.assign(b, { gpuRata: g?.gpuRata ?? null, gpuMaks: g?.gpuMaks ?? null, dayaRataW: g?.dayaRata ?? null, dayaMaksW: g?.dayaMaks ?? null,
    energiWh: g?.energiWh ?? null, detikGpuSibuk: g?.detikGpuSibuk ?? null, suhuMaksC: g?.suhuMaks ?? null });
}
if (perekam) infoAsli(`\n  sampel GPU: ${sampelGpu.length}`);

const tiketAkhir = await tiketBaru();
infoAsli(`\n  tiket tersimpan selama uji: ${tiketAkhir - tiketAwal} (harus 0)`);

mkdirSync("data", { recursive: true });
const stempel = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const dasar = `data/uji-beban-qwen3-14b-${stempel}-${LAPIS}${MODE === "gpu" ? "-gpu" : REKAM_GPU ? "-dengan-gpu" : ""}`;
const kolom = Object.keys(semua[0] ?? {}) as (keyof Baris)[];
writeFileSync(`${dasar}.csv`, [kolom.join(","), ...semua.map((b) => kolom.map((k) => JSON.stringify(b[k] ?? "")).join(","))].join("\n"));
writeFileSync(`${dasar}.json`, JSON.stringify({ lapis: LAPIS, model: MODEL, totalSeptember, tiketTersimpan: tiketAkhir - tiketAwal, ringkasan, laptop: sampelLaptop, gpuSampel: sampelGpu, pertanyaan: semua }, null, 2));
infoAsli(`  data: ${dasar}.csv / .json`);
await db.end();
process.stdout.write("", () => process.exit(0));
