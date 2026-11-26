import { muatKonfig, lupakanKonfig } from "@/lib/ai-konfig";

lupakanKonfig();
const k = await muatKonfig();
const mkt = k.agent.find((a) => a.kode === "agent-marketing");
console.log(`agent-marketing: ${mkt ? `${mkt.tool.length} tool aktif` : "TIDAK ADA"}`);
for (const t of mkt?.tool ?? []) {
  console.log(`  ${t.kode.padEnd(26)} jenis=${t.jenis} penangan=${t.penangan ?? "-"}`);
}
process.exit(0);
