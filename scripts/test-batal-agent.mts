/**
 * Uji pembatalan saat habis waktu (24 Nov 2026) — OFFLINE, tanpa model sungguhan, tanpa database.
 *   npm run test:batal-agent
 *
 * Meniru alur benchmark: perute VoltAgent -> delegate_task -> agent bawahan, keduanya lewat
 * @ai-sdk/openai-compatible (penyedia yang sama dengan gateway LiteLLM di voltagent/agents.ts) ke server
 * tiruan lokal. Model bawahan sengaja menjawab sangat lambat. Setelah 2 dtk, abortSignal dinyalakan —
 * persis seperti yang dilakukan scripts/profil-alur-agent.mts saat batas waktu tercapai.
 *
 * Yang dibuktikan: sinyal pembatalan dari streamText() perute sampai ke permintaan HTTP agent bawahan
 * (server tiruan melihat sambungannya DIPUTUS klien, bukan selesai sendiri), dan tidak ada permintaan
 * baru sesudah dibatalkan. Yang TIDAK dibuktikan di sini: apakah LiteLLM/vLLM ikut menghentikan
 * generasi saat sambungan putus — itu perilaku server, diuji terpisah.
 */
import { createServer } from "node:http";
import { Agent } from "@voltagent/core";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };

type Catatan = { peran: "perute" | "bawahan"; mulai: number; akhir?: number; diputusKlien?: boolean };
const PERMINTAAN: Catatan[] = [];
const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const potong = (delta: Record<string, unknown>, finish: string | null = null) =>
  sse({ id: "x", object: "chat.completion.chunk", created: 0, model: "tiruan", choices: [{ index: 0, delta, finish_reason: finish }] });

const server = createServer((req, res) => {
  let badan = "";
  req.on("data", (d) => (badan += d));
  req.on("end", () => {
    let b: { tools?: { function?: { name?: string } }[]; messages?: { role: string }[] } = {};
    try { b = JSON.parse(badan); } catch { /* bukan JSON */ }
    const perute = (b.tools ?? []).some((t) => t.function?.name === "delegate_task");
    const sudahAdaHasilAlat = (b.messages ?? []).some((m) => m.role === "tool");
    const c: Catatan = { peran: perute ? "perute" : "bawahan", mulai: Date.now() };
    PERMINTAAN.push(c);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.on("close", () => { c.akhir = Date.now(); if (!res.writableEnded) c.diputusKlien = true; });
    if (perute && !sudahAdaHasilAlat) {
      // Perute: langsung menyerahkan ke agent "Bawahan".
      res.write(potong({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function",
        function: { name: "delegate_task", arguments: JSON.stringify({ task: "uji pembatalan", targetAgents: ["Bawahan"] }) } }] }));
      res.write(potong({}, "tool_calls")); res.write("data: [DONE]\n\n"); res.end();
      return;
    }
    if (perute) { res.write(potong({ role: "assistant", content: "selesai" })); res.write(potong({}, "stop")); res.write("data: [DONE]\n\n"); res.end(); return; }
    // Bawahan: menulis satu huruf tiap 300 ms selama 60 dtk — jauh melewati batas uji.
    res.write(potong({ role: "assistant", content: "" }));
    let i = 0;
    const t = setInterval(() => {
      if (res.writableEnded || res.destroyed) return clearInterval(t);
      res.write(potong({ content: "a" }));
      if (++i > 200) { clearInterval(t); res.write(potong({}, "stop")); res.write("data: [DONE]\n\n"); res.end(); }
    }, 300);
  });
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
const port = (server.address() as { port: number }).port;
const penyedia = createOpenAICompatible({ name: "tiruan", baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "tiruan" });

const bawahan = new Agent({ name: "Bawahan", purpose: "agent bawahan tiruan", instructions: "Jawab.", model: penyedia("tiruan") });
const perute = new Agent({ name: "Perute", purpose: "perute tiruan", instructions: "Teruskan ke Bawahan.", model: penyedia("tiruan"), subAgents: [bawahan], maxSteps: 4 });

const ac = new AbortController();
const t0 = Date.now();
let galatStream = "";
const kerja = (async () => {
  try {
    const h = await perute.streamText("uji", { abortSignal: ac.signal } as never);
    for await (const _ of h.fullStream as AsyncIterable<unknown>) { /* habiskan stream */ }
  } catch (e) { galatStream = (e as Error)?.name ?? String(e); }
})();
await new Promise((r) => setTimeout(r, 2000));
const tBatal = Date.now();
ac.abort(new Error("batas waktu benchmark"));
await Promise.race([kerja, new Promise((r) => setTimeout(r, 5000))]);
await new Promise((r) => setTimeout(r, 1500));   // beri waktu kejadian "close" di server
const nSebelum = PERMINTAAN.length;
await new Promise((r) => setTimeout(r, 2000));   // pastikan tidak ada permintaan baru sesudah batal

const bw = PERMINTAAN.filter((p) => p.peran === "bawahan");
cek("perute menyerahkan ke agent bawahan (alur seperti benchmark)", PERMINTAAN.some((p) => p.peran === "perute") && bw.length >= 1,
  `${PERMINTAAN.length} permintaan: ${PERMINTAAN.map((p) => p.peran).join(", ")}`);
cek("permintaan agent bawahan DIPUTUS klien (bukan selesai sendiri)", bw.length > 0 && bw.every((p) => p.diputusKlien === true));
cek("sambungan bawahan putus < 1,5 dtk sesudah abort", bw.length > 0 && bw.every((p) => (p.akhir ?? Infinity) - tBatal < 1500),
  bw.map((p) => `${((p.akhir ?? NaN) - tBatal)} ms`).join(", "));
cek("tidak ada permintaan baru sesudah dibatalkan", PERMINTAAN.length === nSebelum && PERMINTAAN.every((p) => p.mulai < tBatal + 50));
cek("streamText berhenti (tidak menunggu 60 dtk)", Date.now() - t0 < 15_000, `${Date.now() - t0} ms total${galatStream ? `, galat stream: ${galatStream}` : ""}`);

server.close();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
