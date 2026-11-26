/**
 * Uji retry `lib/gateway-fetch.ts` dengan server HTTP tiruan di komputer ini. Tidak menyentuh
 * gateway, database, maupun model.
 *
 *   npm run test:gateway-retry
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buatFetchGateway, ringkasPermintaan, MAKS_ULANG_GATEWAY } from "@/lib/gateway-fetch";

let lolos = 0, gagal = 0;
function cek(nama: string, ok: boolean, info = "") {
  if (ok) lolos++; else gagal++;
  console.log(`  ${ok ? "LOLOS" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
}

type Perilaku = (n: number, req: http.IncomingMessage, res: http.ServerResponse) => void;
async function server(perilaku: Perilaku) {
  let n = 0;
  const s = http.createServer((req, res) => {
    let badan = "";
    req.on("data", (c) => (badan += c));
    req.on("end", () => perilaku(++n, req, res));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/v1/chat/completions`, jumlah: () => n, tutup: () => s.close() };
}

/** Memutus sambungan dengan RST, sama seperti `read ECONNRESET` di log 11 Nov 2026. */
const putus = (res: http.ServerResponse) => res.socket?.resetAndDestroy();
const jsonOk = (res: http.ServerResponse) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
};

const RAHASIA = "sk-RAHASIA-JANGAN-DICATAT";
const ISI_PRIBADI = "printer saya tidak bisa mencetak";
const badanUji = (stream = false) => JSON.stringify({
  model: "qwen35-35b", stream,
  messages: [
    { role: "system", content: "Kamu Ratu AI Umum, pintu masuk asisten portal." },
    { role: "user", content: ISI_PRIBADI },
    { role: "tool", content: "[]" },
  ],
});
const init = (stream = false, signal?: AbortSignal): RequestInit => ({
  method: "POST", body: badanUji(stream), signal,
  headers: { Authorization: `Bearer ${RAHASIA}`, "Content-Type": "application/json" },
});

console.log("\n=== 1. Putus sebelum balasan, lalu berhasil ===");
{
  const s = await server((n, _q, res) => (n === 1 ? putus(res) : jsonOk(res)));
  const log: Record<string, unknown>[] = [];
  const f = buatFetchGateway("mr-ai-gateway-qwen35", "qwen35-35b", { catat: (b) => log.push(b), jedaMs: 10 });
  const r = await f(s.url, init());
  cek("berhasil sesudah diulang", r.status === 200, `status ${r.status}`);
  cek("server menerima tepat 2 permintaan", s.jumlah() === 2, String(s.jumlah()));
  cek("log mencatat kode galat dan bahwa diulang", log.some((b) => b.galat === "ECONNRESET" && b.diulang === true), JSON.stringify(log[0]));
  cek("log akhir mencatat ulang = 1", log.at(-1)?.ulang === 1);
  cek("log memuat model, agent, dan durasi", log.at(-1)?.model === "qwen35-35b" && log.at(-1)?.agent === "Ratu AI Umum" && typeof log.at(-1)?.ms === "number");
  const teksLog = JSON.stringify(log);
  cek("log tidak memuat API key", !teksLog.includes(RAHASIA));
  cek("log tidak memuat isi pesan", !teksLog.includes(ISI_PRIBADI));
  s.tutup();
}

console.log("\n=== 2. Putus terus: hanya diulang sekali ===");
{
  const s = await server((_n, _q, res) => putus(res));
  const f = buatFetchGateway("mr-ai-gateway", "qwen3-14b", { catat: () => {}, jedaMs: 10 });
  let galat: unknown = null;
  try { await f(s.url, init()); } catch (e) { galat = e; }
  cek("akhirnya melempar galat", galat !== null);
  cek(`total percobaan = 1 + ${MAKS_ULANG_GATEWAY}`, s.jumlah() === 1 + MAKS_ULANG_GATEWAY, String(s.jumlah()));
  s.tutup();
}

console.log("\n=== 3. Server sudah membalas: tidak diulang ===");
for (const status of [500, 429, 400]) {
  const s = await server((_n, _q, res) => { res.writeHead(status); res.end("{}"); });
  const f = buatFetchGateway("mr-ai-gateway", "qwen3-14b", { catat: () => {}, jedaMs: 10 });
  const r = await f(s.url, init());
  cek(`HTTP ${status} diteruskan apa adanya, 1 permintaan`, r.status === status && s.jumlah() === 1, `${r.status}, ${s.jumlah()} permintaan`);
  s.tutup();
}

console.log("\n=== 4. Dibatalkan pemakai: tidak diulang ===");
{
  const s = await server(() => { /* tidak pernah membalas */ });
  const ac = new AbortController();
  const f = buatFetchGateway("mr-ai-gateway", "qwen3-14b", { catat: () => {}, jedaMs: 10 });
  setTimeout(() => ac.abort(), 100);
  let galat: unknown = null;
  try { await f(s.url, init(false, ac.signal)); } catch (e) { galat = e; }
  cek("pembatalan diteruskan sebagai galat", galat !== null);
  cek("tidak ada permintaan kedua", s.jumlah() <= 1, String(s.jumlah()));
  s.tutup();
}

console.log("\n=== 5. Putus di tengah stream: TIDAK diulang ===");
{
  const s = await server((_n, _q, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"Halo"}}]}\n\n');
    setTimeout(() => putus(res), 50);
  });
  const log: Record<string, unknown>[] = [];
  const f = buatFetchGateway("mr-ai-gateway-qwen35", "qwen35-35b", { catat: (b) => log.push(b), jedaMs: 10 });
  const r = await f(s.url, init(true));
  let potongan = "", galat: unknown = null;
  try { potongan = await r.text(); } catch (e) { galat = e; }
  cek("stream berakhir dengan galat, bukan jawaban kedua", galat !== null && !potongan.includes("Halo", 10), potongan.slice(0, 40));
  cek("server hanya menerima 1 permintaan", s.jumlah() === 1, String(s.jumlah()));
  cek("log mencatat putus di tengah stream, tidak diulang", log.some((b) => b.tahap === "tengah-stream" && b.diulang === false), JSON.stringify(log.at(-1)));
  s.tutup();
}

console.log("\n=== 6. Stream normal diteruskan utuh ===");
{
  const s = await server((_n, _q, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"a":1}\n\n');
    res.end("data: [DONE]\n\n");
  });
  const log: Record<string, unknown>[] = [];
  const f = buatFetchGateway("mr-ai-gateway", "qwen3-14b", { catat: (b) => log.push(b), jedaMs: 10 });
  const teks = await (await f(s.url, init(true))).text();
  cek("isi stream sama persis", teks === 'data: {"a":1}\n\ndata: [DONE]\n\n');
  cek("durasi stream tercatat", typeof log.at(-1)?.ms === "number" && typeof log.at(-1)?.msHeader === "number");
  s.tutup();
}

console.log("\n=== 7. Ringkasan permintaan ===");
{
  const r = ringkasPermintaan(badanUji(true));
  cek("nama agent terbaca", r.agent === "Ratu AI Umum", r.agent);
  cek("putaran lanjutan terbaca", r.lanjutan === true && r.pesan === 3);
  cek("badan rusak tidak melempar", ringkasPermintaan("{rusak").agent === "tidak diketahui");
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
