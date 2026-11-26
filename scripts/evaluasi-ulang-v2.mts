/**
 * Penilaian ulang data benchmark LAMA dengan evaluator v2 — tanpa inference ulang, tanpa jaringan/database.
 *
 *   npx tsx scripts/evaluasi-ulang-v2.mts <folder uji> [<folder uji> ...] [--q1-angka 156770] [--keluar <folder>]
 *   npm run evaluasi:ulang -- data/agent-workflow-latency/2026-11-23-08-35-14b-seqs4-c10-20 ...
 *
 * Hanya MEMBACA kejadian.jsonl, span.jsonl, jawaban.jsonl, argumen-alat.jsonl di tiap folder.
 * Hasil ditulis ke folder BARU (bawaan data/agent-workflow-latency/evaluasi-v2/); data uji tidak disentuh.
 *
 * Angka harapan Q1: dari event info (`harapan.q1_angka`, dicatat sejak 24 Nov 2026). Uji lama belum mencatatnya;
 * untuk itu pakai --q1-angka. 156770 terverifikasi dari data: semua 34 jawaban Q1 yang lolos kriteria lama
 * di uji 20 Nov sore & 23 Nov memuat "156.770".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { hitung, nilai, type Bukti, type Nilai } from "./lib/evaluator-agent.mts";
import { jenisSkenario } from "./lib/skenario-agent.mts";

const argv = process.argv.slice(2);
const opsi = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const FOLDER = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const KELUAR = opsi("keluar") ?? "data/agent-workflow-latency/evaluasi-v2";
const Q1_CLI = opsi("q1-angka") ? Number(opsi("q1-angka")) : null;
if (!FOLDER.length) { console.log("pakai: npx tsx scripts/evaluasi-ulang-v2.mts <folder uji> [...] [--q1-angka N]"); process.exit(1); }

const jl = (p: string) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : null;
type Baris = { uji: string; trace: string; fase: string; tahap: number | null; kode: string; status: string; benar_lama: boolean; v2: Nilai;
  bukti: { jawaban: boolean; argumen: boolean; status_alat: boolean; delegasi: number | null } };
const SEMUA: Baris[] = [], RINGKAS: Record<string, unknown> = {};

for (const d of FOLDER) {
  const uji = basename(d.replace(/[\\/]+$/, ""));
  const KJ = jl(join(d, "kejadian.jsonl")) ?? [];
  const SP = jl(join(d, "span.jsonl")) ?? [];
  const JW = jl(join(d, "jawaban.jsonl"));
  const AR = jl(join(d, "argumen-alat.jsonl"));
  const info = KJ.find((x) => x.t === "info") ?? {};
  const selesai = KJ.find((x) => x.t === "selesai");
  const q1 = info.harapan?.q1_angka ?? Q1_CLI;
  // Tiket tersimpan hanya diketahui per UJI. Kalau 0, berarti tak satu skenario pun menyimpan tiket.
  const tiketUji: number | null = typeof selesai?.tiket_baru === "number" ? selesai.tiket_baru : null;
  const jawab = new Map<string, string>((JW ?? []).map((j) => [j.trace, j.jawaban ?? ""]));
  const argPer = new Map<string, { alat: string; argumen: string }[]>();
  for (const a of AR ?? []) if (a.alat !== "delegate_task") (argPer.get(a.trace) ?? argPer.set(a.trace, []).get(a.trace)!).push({ alat: a.alat, argumen: a.argumen ?? "" });
  const spanPer = new Map<string, Record<string, unknown>[]>();
  for (const s of SP) if (s.trace) (spanPer.get(s.trace) ?? spanPer.set(s.trace, []).get(s.trace)!).push(s);
  const adaStatusAlat = SP.some((s) => s.jenis === "alat" && "hasil_status" in s);

  const qs = KJ.filter((x) => x.t === "q");
  for (const q of qs.filter((x) => x.fase !== "pemanasan")) {
    const j = jenisSkenario(q.kode, { q1_angka: q1 ?? NaN, q1_periode: info.harapan?.q1_periode ?? "2026-09" });
    if (!j) continue;
    const sp = spanPer.get(q.trace) ?? [];
    // Delegasi perute: panggilan model yang memilih delegate_task (tercatat di semua uji sejak 17 Nov).
    const delegasi = sp.filter((s) => s.jenis === "llm" && Array.isArray(s.alat_dipilih) && (s.alat_dipilih as string[]).includes("delegate_task")).length;
    const bukti: Bukti = {
      status: q.status, teks: JW ? (jawab.get(q.trace) ?? null) : null,
      alat: (q.alat ?? []).filter((a: string) => a !== "delegate_task"), rancangan: q.rancangan ?? 0, delegasi,
      argumen: AR ? (argPer.get(q.trace) ?? []) : null,
      statusAlat: adaStatusAlat ? sp.filter((s) => s.jenis === "alat").map((s) => ({ alat: String(s.nama), status: (s.hasil_status as string) ?? null })) : null,
      tiketTersimpan: tiketUji === 0 ? 0 : null,
    };
    const v2 = Number.isNaN(q1 ?? NaN) && q.kode === "Q1"
      ? { versi: 2 as const, hasil: "tidak-bisa-dinilai" as const, kategori: "harapan-tidak-diketahui", alasan: "angka harapan Q1 tidak tercatat; pakai --q1-angka" }
      : nilai(j, bukti);
    SEMUA.push({ uji, trace: q.trace, fase: q.fase, tahap: q.tahap ?? null, kode: q.kode, status: q.status, benar_lama: !!q.benar, v2,
      bukti: { jawaban: bukti.teks !== null, argumen: bukti.argumen !== null, status_alat: bukti.statusAlat !== null, delegasi } });
  }
  RINGKAS[uji] = { skenario_total: qs.length, pemanasan: qs.filter((x) => x.fase === "pemanasan").length,
    terukur: qs.filter((x) => x.fase !== "pemanasan").length, q1_angka: q1, sumber_q1: info.harapan?.q1_angka ? "info uji" : Q1_CLI ? "--q1-angka" : "tidak ada",
    tiket_tersimpan_uji: tiketUji, ada_jawaban: !!JW, ada_argumen: !!AR, ada_status_alat: adaStatusAlat };
}

// ---------------- keluaran (folder baru)
mkdirSync(KELUAR, { recursive: true });
const kol = ["uji", "trace", "fase", "tahap", "kode", "status", "benar_lama", "v2_hasil", "v2_kategori", "v2_efisiensi", "v2_alasan", "bukti_jawaban", "bukti_argumen", "bukti_status_alat", "delegasi"];
const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync(join(KELUAR, "per-skenario.csv"), [kol.join(",")].concat(SEMUA.map((r) => [r.uji, r.trace, r.fase, r.tahap, r.kode, r.status, r.benar_lama,
  r.v2.hasil, r.v2.kategori, r.v2.efisiensi ?? "", r.v2.alasan, r.bukti.jawaban, r.bukti.argumen, r.bukti.status_alat, r.bukti.delegasi].map(esc).join(","))).join("\n") + "\n");

const perKode: Record<string, unknown> = {};
for (const k of [...new Set(SEMUA.map((r) => r.kode))].sort()) {
  const rs = SEMUA.filter((r) => r.kode === k);
  perKode[k] = { n: rs.length, lama_benar: rs.filter((r) => r.benar_lama).length, v2: hitung(rs.map((r) => r.v2)),
    v2_efisiensi: rs.some((r) => r.v2.efisiensi) ? { efisien: rs.filter((r) => r.v2.efisiensi === "efisien").length, boros: rs.filter((r) => r.v2.efisiensi === "boros").length } : undefined,
    beda: rs.filter((r) => r.benar_lama !== (r.v2.hasil === "lulus")).map((r) => ({ uji: r.uji, trace: r.trace.slice(0, 8), tahap: r.tahap, lama: r.benar_lama, v2: `${r.v2.hasil}:${r.v2.kategori}` })) };
}
const total = { n: SEMUA.length, lama_benar: SEMUA.filter((r) => r.benar_lama).length, v2: hitung(SEMUA.map((r) => r.v2)) };
writeFileSync(join(KELUAR, "ringkasan.json"), JSON.stringify({ dibuat: new Date().toISOString(), evaluator: "v2 (scripts/lib/evaluator-agent.mts)",
  catatan: "Hanya membaca data uji. 'lama_benar' = kriteria lama di kejadian.jsonl; v2 = evaluator baru. Pemanasan tidak dihitung.",
  per_uji: RINGKAS, total, per_kode: perKode }, null, 1));

// ---------------- tampilan berdampingan
console.log(`\nSkenario per uji (pemanasan tidak dihitung):`);
for (const [u, r] of Object.entries(RINGKAS) as [string, Record<string, unknown>][])
  console.log(`  ${u.padEnd(36)} total ${r.skenario_total} = terukur ${r.terukur} + pemanasan ${r.pemanasan} · jawaban ${r.ada_jawaban ? "ada" : "TIDAK"} · argumen ${r.ada_argumen ? "ada" : "TIDAK"} · Q1 harapan ${r.q1_angka} (${r.sumber_q1})`);
console.log(`\nKode  n    lama-benar | v2 lulus  sebagian  gagal  tak-bisa-dinilai`);
for (const [k, x] of Object.entries(perKode) as [string, { n: number; lama_benar: number; v2: ReturnType<typeof hitung> }][])
  console.log(`  ${k}  ${String(x.n).padStart(3)}  ${String(x.lama_benar).padStart(9)} | ${String(x.v2.lulus).padStart(8)}  ${String(x.v2.sebagian).padStart(8)}  ${String(x.v2.gagal).padStart(5)}  ${String(x.v2.tidak_bisa_dinilai).padStart(16)}`);
console.log(`  SEMUA ${String(total.n).padStart(3)}  ${String(total.lama_benar).padStart(9)} | ${String(total.v2.lulus).padStart(8)}  ${String(total.v2.sebagian).padStart(8)}  ${String(total.v2.gagal).padStart(5)}  ${String(total.v2.tidak_bisa_dinilai).padStart(16)}`);
console.log(`\nKeluaran: ${KELUAR}/per-skenario.csv, ${KELUAR}/ringkasan.json`);
