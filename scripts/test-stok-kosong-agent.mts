/**
 * Uji stok kosong melalui agent Marketing dan model sungguhan.
 *
 *   npx tsx --env-file=.env.local scripts/test-stok-kosong-agent.mts <model>
 * Contoh model: llama.cpp/gemma-4-12b-it-q8 atau claude-haiku-4-5
 * HANYA MEMBACA database; panggilan Haiku memakai API Anthropic.
 */
import { buatAgentDariKonfig } from "../voltagent/agent-konfig.ts";
import { KUNCI_MODEL, KUNCI_SALURAN } from "../voltagent/agents.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

const MODEL = process.argv[2] ?? "llama.cpp/gemma-4-12b-it-q8";
const PERTANYAAN = "Produk apa yang paling sering kosong bulan September 2026?";
const db = poolPerusahaan();
try {
  lupakanKonfig();
  const konfig = await muatKonfig();
  const marketing = konfig.agent.find((a) => a.kode === "agent-marketing");
  if (!marketing) throw new Error("agent-marketing tidak ada di konfigurasi");
  const { rows } = await db.query<{ id_employee: string }>(
    `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
      WHERE lower(u.username) = 'ridho@mustika-ratu.co.id' LIMIT 1`,
  );
  if (!rows.length) throw new Error("akun uji tidak ada");
  const akses = await aksesUntukEmployee(rows[0].id_employee);
  if (!akses) throw new Error("akses akun uji tidak terbaca");
  const { agent, tool } = buatAgentDariKonfig(marketing, akses.sesi);
  const stok = tool.find((t) => t.name === "stok_kosong");
  if (!stok) throw new Error("tool stok_kosong tidak terpasang di agent Marketing");
  console.log(`model: ${MODEL}; tool stok_kosong terpasang; pertanyaan: ${PERTANYAAN}`);
  const started = Date.now();
  const result = (await agent.generateText(PERTANYAAN, {
    context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" },
  })) as {
    text?: string;
    steps?: { toolCalls?: { toolName: string }[]; toolResults?: { output?: unknown }[] }[];
    usage?: { inputTokens?: number; outputTokens?: number };
  };
  const calls = new Set<string>();
  const outputs: unknown[] = [];
  for (const step of result.steps ?? []) {
    for (const call of step.toolCalls ?? []) calls.add(call.toolName);
    for (const toolResult of step.toolResults ?? []) outputs.push(toolResult.output);
  }
  console.log(`tool dipanggil: ${[...calls].join(", ") || "(tidak ada)"}`);
  console.log(`hasil stok_kosong: ${JSON.stringify(outputs.filter((o) => (o as { status?: string })?.status))}`);
  console.log(`jawaban: ${result.text ?? "(kosong)"}`);
  console.log(`waktu: ${((Date.now() - started) / 1000).toFixed(1)} dtk; token: ${result.usage?.inputTokens ?? "?"}/${result.usage?.outputTokens ?? "?"}`);
  if (!calls.has("stok_kosong")) process.exitCode = 1;
} finally {
  await db.end();
}
