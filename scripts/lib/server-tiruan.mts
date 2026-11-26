/**
 * Server model TIRUAN untuk uji offline Tahap 2 (24 Nov 2026). Tanpa model sungguhan, tanpa biaya.
 *
 * Melayani dua format sekaligus, sehingga mekanisme yang sama bisa dibuktikan untuk kedua jenis penyedia:
 *   - OpenAI-compatible  POST /v1/chat/completions  (jalur Qwen lewat LiteLLM)
 *   - Anthropic          POST /v1/messages          (jalur Claude)
 *
 * Isi jawaban ditentukan fungsi `jawab` milik tiap uji: perute dikenali dari alat `delegate_task`
 * di permintaannya, agent bawahan dari ketiadaannya. Semua badan permintaan dicatat supaya uji bisa
 * memeriksa apa yang BENAR-BENAR dikirim (mis. `tool_choice`, isi tugas yang sampai ke bawahan).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type Format = "openai" | "anthropic";
export type Permintaan = {
  format: Format;
  peran: "perute" | "bawahan";
  /** Nomor urut permintaan untuk peran ini (mulai 1). */
  ke: number;
  badan: Record<string, unknown>;
  /** Sudah ada hasil alat di riwayat yang dikirim (artinya ini langkah sesudah memanggil alat). */
  adaHasilAlat: boolean;
  /** Teks gabungan seluruh pesan yang dikirim (untuk memeriksa isi tugas). */
  teksPesan: string;
  diputus?: boolean;
  /** Isi hasil alat yang sudah ada di riwayat, berurutan. */
  hasilAlat: string[];
  /** Nama agent dari penanda [AGENT:Nama] di instruksinya (agent bawahan tiruan). */
  agen?: string;
};
export type Jawaban = {
  teks?: string; alat?: { nama: string; argumen: Record<string, unknown> }[];
  /** Hanya OpenAI: tulis satu huruf "a" tiap `lambatMs` selama ±60 dtk (meniru generasi panjang, untuk uji pembatalan). */
  lambatMs?: number;
};

export type ServerTiruan = {
  url: (f: Format) => string;
  catatan: Permintaan[];
  setel: (jawab: (p: Permintaan) => Jawaban) => void;
  reset: () => void;
  tutup: () => Promise<void>;
};

function teksDari(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(teksDari).join("\n");
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return [o.text, o.content, o.input, o.arguments].map((v) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v))).join("\n");
  }
  return "";
}

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const sseA = (ev: string, o: unknown) => `event: ${ev}\ndata: ${JSON.stringify(o)}\n\n`;

function tulisOpenAI(res: ServerResponse, j: Jawaban) {
  const potong = (delta: Record<string, unknown>, finish: string | null = null) =>
    sse({ id: "x", object: "chat.completion.chunk", created: 0, model: "tiruan", choices: [{ index: 0, delta, finish_reason: finish }] });
  res.write(potong({ role: "assistant", content: "" }));
  if (j.lambatMs) {
    let i = 0;
    const t = setInterval(() => {
      if (res.writableEnded || res.destroyed) return clearInterval(t);
      res.write(potong({ content: "a" }));
      if (++i > 60_000 / j.lambatMs!) { clearInterval(t); res.write(potong({}, "stop")); res.write("data: [DONE]\n\n"); res.end(); }
    }, j.lambatMs);
    return;
  }
  if (j.teks) for (const bagian of j.teks.match(/[\s\S]{1,7}/g) ?? []) res.write(potong({ content: bagian }));
  if (j.alat?.length) {
    res.write(potong({ tool_calls: j.alat.map((a, i) => ({ index: i, id: `call_${i}_${Date.now()}`, type: "function",
      function: { name: a.nama, arguments: JSON.stringify(a.argumen) } })) }));
  }
  res.write(potong({}, j.alat?.length ? "tool_calls" : "stop"));
  res.write(sse({ id: "x", object: "chat.completion.chunk", created: 0, model: "tiruan", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  res.write("data: [DONE]\n\n");
  res.end();
}

function tulisAnthropic(res: ServerResponse, j: Jawaban) {
  res.write(sseA("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "tiruan",
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }));
  let i = 0;
  if (j.teks) {
    res.write(sseA("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }));
    for (const bagian of j.teks.match(/[\s\S]{1,7}/g) ?? []) {
      res.write(sseA("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: bagian } }));
    }
    res.write(sseA("content_block_stop", { type: "content_block_stop", index: i }));
    i++;
  }
  for (const a of j.alat ?? []) {
    res.write(sseA("content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: `toolu_${i}_${Date.now()}`, name: a.nama, input: {} } }));
    res.write(sseA("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(a.argumen) } }));
    res.write(sseA("content_block_stop", { type: "content_block_stop", index: i }));
    i++;
  }
  res.write(sseA("message_delta", { type: "message_delta", delta: { stop_reason: j.alat?.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }));
  res.write(sseA("message_stop", { type: "message_stop" }));
  res.end();
}

export async function mulaiServerTiruan(): Promise<ServerTiruan> {
  const catatan: Permintaan[] = [];
  let jawab: (p: Permintaan) => Jawaban = () => ({ teks: "tiruan" });
  const hitung = { perute: 0, bawahan: 0 };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let isi = "";
    req.on("data", (d) => (isi += d));
    req.on("end", () => {
      let badan: Record<string, unknown> = {};
      try { badan = JSON.parse(isi); } catch { /* bukan JSON */ }
      const format: Format = (req.url ?? "").includes("/messages") ? "anthropic" : "openai";
      const alat = (badan.tools as { name?: string; function?: { name?: string } }[] | undefined) ?? [];
      const pesan = (badan.messages as { role: string; content?: unknown }[] | undefined) ?? [];
      // Perute dikenali dari alat delegate_task ATAU penanda [PERUTE] di instruksinya. Penanda perlu karena
      // Anthropic tidak punya tool_choice "none": AI SDK membuang seluruh daftar alat, jadi langkah perute
      // yang dipaksa menulis teks tidak membawa delegate_task sama sekali.
      const perute = alat.some((t) => (t.function?.name ?? t.name) === "delegate_task")
        || teksDari(badan.system).includes("[PERUTE]")
        || pesan.some((m) => m.role === "system" && teksDari(m.content).includes("[PERUTE]"));
      const adaHasilAlat = pesan.some((m) => m.role === "tool" ||
        (Array.isArray(m.content) && m.content.some((c: { type?: string }) => c?.type === "tool_result")));
      const peran = perute ? "perute" : "bawahan";
      const sistem = [teksDari(badan.system), ...pesan.filter((m) => m.role === "system").map((m) => teksDari(m.content))].join("\n");
      const hasilAlat = pesan.flatMap((m) => m.role === "tool" ? [teksDari(m.content)]
        : Array.isArray(m.content) ? m.content.filter((c: { type?: string }) => c?.type === "tool_result").map((c: unknown) => teksDari(c)) : []);
      const p: Permintaan = { format, peran, ke: ++hitung[peran], badan, adaHasilAlat, hasilAlat,
        agen: /\[AGENT:([^\]]+)\]/.exec(sistem)?.[1],
        teksPesan: [teksDari(badan.system), ...pesan.map((m) => teksDari(m.content))].join("\n") };
      catatan.push(p);
      res.on("close", () => { if (!res.writableEnded) p.diputus = true; });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const j = jawab(p);
      if (format === "anthropic") tulisAnthropic(res, j); else tulisOpenAI(res, j);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const port = (server.address() as { port: number }).port;
  return {
    url: () => `http://127.0.0.1:${port}/v1`,
    catatan,
    setel: (f) => { jawab = f; },
    reset: () => { catatan.length = 0; hitung.perute = 0; hitung.bawahan = 0; },
    tutup: () => new Promise((ok) => server.close(() => ok())),
  };
}
