/**
 * Verifikasi API VoltAgent yang dipakai Tahap 2 — OFFLINE, server tiruan, tanpa model sungguhan.
 *   npm run test:api-voltagent
 *
 * Setiap mekanisme dibuktikan pada paket yang TERPASANG (@voltagent/core 2.10.0, ai 6.0.290), untuk dua
 * format penyedia: OpenAI-compatible (Qwen lewat LiteLLM) dan Anthropic. Yang diuji:
 *   A. onToolStart melempar galat SEBELUM alat dijalankan → agent bawahan tidak pernah dipanggil,
 *      dan onToolError bisa mengganti hasil alat yang dilihat model.
 *   B. Mengubah `args` di onToolStart sampai ke pelaksanaan delegate_task (isi tugas di bawahan).
 *   C. stopWhen kustom menghentikan perute sesudah langkah alat, tanpa panggilan LLM berikutnya.
 *   D. prepareStep di perute (supervisor) dipanggil dan toolChoice "none" benar-benar terkirim.
 *   E. onHandoffComplete + bail(): apa yang SAMPAI ke stream web (toUIMessageStream) dan ke `text`.
 *   F. outputGuardrails: handler non-stream mengubah `text`, tetapi potongan stream yang sudah lewat tidak.
 *   G. Konteks per-permintaan: dua perute berjalan bersamaan tidak berbagi state.
 */
import { Agent, createOutputGuardrail } from "@voltagent/core";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { stepCountIs } from "ai";
import { mulaiServerTiruan, type Format, type Permintaan } from "./lib/server-tiruan.mts";

let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };

const srv = await mulaiServerTiruan();
const model = (f: Format) => f === "anthropic"
  ? createAnthropic({ baseURL: srv.url(f), apiKey: "tiruan" })("claude-tiruan")
  : createOpenAICompatible({ name: "tiruan", baseURL: srv.url(f), apiKey: "tiruan" })("tiruan");

const TANYA_BAWAHAN = "Sub-kategori mana yang dimaksud: LAN atau WIFI?";
/** Perute: langkah pertama mendelegasikan; sesudah ada hasil alat menulis "teks-perute". Bawahan: bertanya. */
const jawabBaku = (p: Permintaan) => p.peran === "bawahan" ? { teks: TANYA_BAWAHAN }
  : !p.adaHasilAlat ? { alat: [{ nama: "delegate_task", argumen: { task: "tugas asli", targetAgents: ["Bawahan"] } }] }
  : { teks: "teks-perute" };

function rakit(f: Format, opsiPerute: Record<string, unknown> = {}) {
  const bawahan = new Agent({ name: "Bawahan", purpose: "bawahan tiruan", instructions: "Jawab.", model: model(f) });
  const perute = new Agent({ name: "Perute", purpose: "perute tiruan", instructions: "Teruskan. [PERUTE]", model: model(f),
    subAgents: [bawahan], maxSteps: 6, ...opsiPerute } as never);
  return perute;
}

type HasilUI = { jenis: string[]; teks: string; galat: string };
async function lewatUI(perute: Agent): Promise<HasilUI & { textAkhir: string }> {
  const h = await perute.streamText("uji");
  const jenis: string[] = []; let teks = ""; let galat = "";
  try {
    for await (const c of h.toUIMessageStream() as AsyncIterable<{ type: string; delta?: string }>) {
      jenis.push(c.type); if (c.type === "text-delta") teks += c.delta ?? "";
    }
  } catch (e) { galat = (e as Error)?.name ?? String(e); }
  let textAkhir = ""; try { textAkhir = await h.text; } catch (e) { textAkhir = `<galat ${(e as Error)?.name}>`; }
  return { jenis, teks, galat, textAkhir };
}

for (const f of ["openai", "anthropic"] as const) {
  console.log(`\n=== format ${f} ===`);

  // ---------------------------------------------------------------- A
  srv.reset(); srv.setel(jawabBaku);
  let hasilAlat: unknown;
  {
    const perute = rakit(f, {
      hooks: {
        onToolStart: ({ tool }: { tool: { name: string } }) => { if (tool.name === "delegate_task") throw new Error("DITOLAK_PENJAGA"); },
        onToolError: ({ tool, originalError }: { tool: { name: string }; originalError: Error }) =>
          tool.name === "delegate_task" && originalError.message === "DITOLAK_PENJAGA" ? { output: { status: "ditolak-penjaga", pesan: "x" } } : undefined,
        onToolEnd: ({ tool, output }: { tool: { name: string }; output: unknown }) => { if (tool.name === "delegate_task") hasilAlat = output; },
      },
      stopWhen: [stepCountIs(6)],
    });
    const h = await perute.streamText("uji");
    let hasilDiStream: unknown;
    for await (const x of h.fullStream as AsyncIterable<{ type: string; output?: unknown }>) if (x.type === "tool-result") hasilDiStream = x.output;
    const bw = srv.catatan.filter((p) => p.peran === "bawahan").length;
    cek(`[${f}] A1 onToolStart melempar → agent bawahan TIDAK dipanggil`, bw === 0, `permintaan bawahan: ${bw}`);
    cek(`[${f}] A2 onToolError mengganti hasil alat yang dilihat model`,
      JSON.stringify(hasilDiStream ?? "").includes("ditolak-penjaga"), JSON.stringify(hasilDiStream)?.slice(0, 80));
    const kedua = srv.catatan.find((p) => p.peran === "perute" && p.ke === 2);
    cek(`[${f}] A3 hasil pengganti sampai ke LLM perute di langkah berikutnya`, !!kedua && kedua.teksPesan.includes("ditolak-penjaga"));
    void hasilAlat;
  }

  // ---------------------------------------------------------------- B
  srv.reset(); srv.setel(jawabBaku);
  {
    const perute = rakit(f, { hooks: { onToolStart: ({ tool, args }: { tool: { name: string }; args: { task: string } }) => {
      if (tool.name === "delegate_task") args.task = `${args.task}\n[KONTEKS-TAMBAHAN-UJI]`;
    } } });
    await lewatUI(perute);
    const bw = srv.catatan.find((p) => p.peran === "bawahan");
    cek(`[${f}] B  args yang diubah di onToolStart sampai ke agent bawahan`, !!bw && bw.teksPesan.includes("KONTEKS-TAMBAHAN-UJI"));
  }

  // ---------------------------------------------------------------- C
  srv.reset(); srv.setel(jawabBaku);
  {
    let berhenti = false;
    const perute = rakit(f, {
      hooks: { onHandoffComplete: () => { berhenti = true; } },
      stopWhen: [stepCountIs(6), () => berhenti],
    });
    const r = await lewatUI(perute);
    const nPerute = srv.catatan.filter((p) => p.peran === "perute").length;
    cek(`[${f}] C1 stopWhen kustom: perute berhenti sesudah langkah delegasi (1 panggilan LLM perute)`, nPerute === 1, `panggilan perute: ${nPerute}`);
    cek(`[${f}] C2 stream selesai normal (ada 'finish', tanpa galat)`, r.jenis.includes("finish") && !r.galat, r.galat);
    cek(`[${f}] C3 tanpa teks perute — teks akhir HARUS disisipkan lapisan kita`, r.teks === "", JSON.stringify(r.teks));
  }

  // ---------------------------------------------------------------- D
  srv.reset(); srv.setel(jawabBaku);
  {
    const nomor: number[] = [];
    const perute = rakit(f, { prepareStep: ({ stepNumber }: { stepNumber: number }) => {
      nomor.push(stepNumber); return stepNumber >= 1 ? { toolChoice: "none" } : undefined;
    } });
    await lewatUI(perute);
    const kedua = srv.catatan.find((p) => p.peran === "perute" && p.ke === 2)?.badan;
    const tc = kedua ? JSON.stringify(kedua.tool_choice ?? null) : "tidak ada";
    // Anthropic tidak punya tool_choice "none": AI SDK membuang daftar alatnya. Dua-duanya berarti "tidak boleh memanggil alat".
    const tanpaAlat = kedua && (kedua.tool_choice === "none" || !(kedua.tools as unknown[] | undefined)?.length);
    cek(`[${f}] D1 prepareStep perute dipanggil tiap langkah`, nomor.join(",") === "0,1", nomor.join(","));
    cek(`[${f}] D2 toolChoice "none" terkirim ke LLM di langkah 2`, !!tanpaAlat, `tool_choice=${tc}, alat=${(kedua?.tools as unknown[] | undefined)?.length ?? 0}`);
  }

  // ---------------------------------------------------------------- E
  srv.reset(); srv.setel(jawabBaku);
  {
    const perute = rakit(f, { hooks: { onHandoffComplete: ({ bail }: { bail: (t?: string) => void }) => bail() } });
    const r = await lewatUI(perute);
    const nPerute = srv.catatan.filter((p) => p.peran === "perute").length;
    cek(`[${f}] E1 bail(): perute tidak memanggil LLM lagi`, nPerute === 1, `panggilan perute: ${nPerute}`);
    cek(`[${f}] E2 bail(): \`text\` akhir = jawaban bawahan`, r.textAkhir === TANYA_BAWAHAN, JSON.stringify(r.textAkhir).slice(0, 70));
    console.log(`        (pengamatan) bail(): teks di stream web = ${JSON.stringify(r.teks)}; jenis potongan terakhir = ${r.jenis.slice(-3).join(",")}${r.galat ? `; galat ${r.galat}` : ""}`);
    cek(`[${f}] E3 bail(): pertanyaan bawahan TIDAK muncul sendiri di stream web (karena itu lapisan kita yang menyisipkan)`,
      !r.teks.includes(TANYA_BAWAHAN));
  }

  // ---------------------------------------------------------------- F
  srv.reset();
  srv.setel((p) => p.peran === "perute" ? { teks: "delegate_task ke Portal, isinya halo" } : { teks: "x" });
  {
    const g = createOutputGuardrail({ name: "uji", handler: async ({ output }: { output: string }) =>
      ({ pass: true, action: "modify", modifiedOutput: String(output).replace(/delegate_task[^\n]*/, "[DISARING]") }) } as never);
    const perute = rakit(f, { outputGuardrails: [g] });
    // Dibaca lewat fullStream (bukan UI) dan dengan batas waktu: membaca UI stream lalu `text` membuat uji
    // pertama menggantung — pipeline guardrail membelah stream, dan cabang yang tidak dibaca menahan yang lain.
    const h = await perute.streamText("uji");
    let teks = "";
    const habis = (ms: number) => new Promise<"habis">((ok) => setTimeout(() => ok("habis"), ms));
    const baca = (async () => { for await (const x of h.fullStream as AsyncIterable<{ type: string; text?: string }>) if (x.type === "text-delta") teks += x.text ?? ""; return "selesai" as const; })();
    const s1 = await Promise.race([baca, habis(10_000)]);
    const s2 = await Promise.race([Promise.resolve(h.text).then((t) => t), habis(10_000)]);
    // Pengamatan (bukan syarat lulus): `text` sesudah guardrail. Di paket terpasang ia tidak selesai dalam 10 dtk
    // kalau yang dibaca fullStream — satu lagi alasan guardrail VoltAgent tidak dipakai untuk jalur stream.
    console.log(`        (pengamatan) outputGuardrails: fullStream ${s1}; \`text\` = ${JSON.stringify(s2)}`);
    cek(`[${f}] F  outputGuardrails TIDAK cukup untuk stream: potongan teks mentah tetap sampai ke pembaca stream`,
      teks.includes("delegate_task"), JSON.stringify(teks));
  }
}

// ---------------------------------------------------------------- G
srv.reset(); srv.setel(jawabBaku);
{
  const catatan: Record<string, number> = {};
  const buat = (nama: string) => {
    const keadaan = { delegasi: 0 }; // state per permintaan, di closure — bukan global
    return { keadaan, agent: rakit("openai", { hooks: { onToolStart: ({ tool }: { tool: { name: string } }) => {
      if (tool.name === "delegate_task") { keadaan.delegasi++; catatan[nama] = keadaan.delegasi; }
    } } }) };
  };
  const a = buat("a"), b = buat("b");
  await Promise.all([lewatUI(a.agent), lewatUI(b.agent), lewatUI(a.agent)]);
  cek("[openai] G  state per permintaan tidak tercampur antar perute yang berjalan bersamaan",
    a.keadaan.delegasi === 2 && b.keadaan.delegasi === 1, `a=${a.keadaan.delegasi} (2 permintaan), b=${b.keadaan.delegasi} (1 permintaan)`);
}

await srv.tutup();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
