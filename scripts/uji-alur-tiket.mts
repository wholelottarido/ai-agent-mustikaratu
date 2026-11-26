/**
 * Uji alur multi-agent pembuatan tiket helpdesk lewat MR AI Gateway, dengan agent yang SAMA
 * dengan portal (`siapkanAgent` -> `streamText`).
 *
 *   npx tsx --env-file=.env.local scripts/uji-alur-tiket.mts [normal|putus-sekali|gateway-mati] [model]
 *
 *   normal        -> langsung ke gateway
 *   putus-sekali  -> lewat perantara lokal yang memutus (RST) permintaan ke-2 dan ke-5 sebelum
 *                    membalas; retry di `lib/gateway-fetch.ts` harus menutupinya
 *   gateway-mati  -> perantara memutus SEMUA permintaan; harus berakhir dengan pesan galat yang
 *                    jelas, tanpa jawaban karangan
 *
 * Alur: minta tiket -> "iya" -> pilih sub-kategori. Agent hanya menyusun RANCANGAN; menyimpan
 * tiket butuh tombol di kartu konfirmasi, dan skrip ini tidak pernah menekannya. Jumlah tiket di
 * `portal_ticket` diperiksa sebelum dan sesudah: tidak boleh bertambah.
 *
 * HANYA MEMBACA database. Konfigurasi EC2, LiteLLM, vLLM, dan model bawaan tidak disentuh.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const MODE = (process.argv[2] ?? "normal") as "normal" | "putus-sekali" | "gateway-mati";
const MODEL = process.argv[3] ?? "mr-ai-gateway-qwen35";
const AKUN = "ridho@mustika-ratu.co.id";

// ---------- perantara pengganggu (mode putus-sekali / gateway-mati) ----------
const asli = (process.env.AI_BASE_URL ?? "").replace(/\/+$/, "");
let nomor = 0;
const diputus: number[] = [];
if (MODE !== "normal") {
  const target = new URL(asli);
  const perantara = http.createServer((req, res) => {
    const potong: Buffer[] = [];
    req.on("data", (c) => potong.push(c));
    req.on("end", async () => {
      const ke = ++nomor;
      const putus = MODE === "gateway-mati" || ke === 2 || ke === 5;
      if (putus && req.url?.includes("/chat/completions")) {
        diputus.push(ke);
        res.socket?.resetAndDestroy();
        return;
      }
      try {
        const r = await fetch(`${target.origin}${req.url}`, {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "content-length", "connection"].includes(k))) as Record<string, string>,
          body: req.method === "GET" ? undefined : Buffer.concat(potong),
        });
        res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k))));
        if (r.body) {
          const pembaca = r.body.getReader();
          for (let p = await pembaca.read(); !p.done; p = await pembaca.read()) res.write(p.value);
        }
        res.end();
      } catch {
        res.socket?.resetAndDestroy();
      }
    });
  });
  await new Promise<void>((r) => perantara.listen(0, "127.0.0.1", r));
  const port = (perantara.address() as AddressInfo).port;
  process.env.AI_BASE_URL = `http://127.0.0.1:${port}${target.pathname}`;
}

// Modul agent diimpor SESUDAH alamat gateway diganti, supaya klien gateway memakai perantara.
const { siapkanAgent } = await import("../voltagent/jalur-agent.ts");
const { jagaPotongan } = await import("../lib/alur/jaga-stream.ts");
const { KUNCI_MODEL, KUNCI_SALURAN } = await import("../voltagent/agents.ts");
const { maksToolGatewayModel, pesanGalatGateway } = await import("../voltagent/models.ts");
const { poolPerusahaan } = await import("../lib/db-perusahaan.ts");

const logGateway: Record<string, unknown>[] = [];
const infoAsli = console.info;
console.info = (...a: unknown[]) => {
  const s = String(a[0] ?? "");
  if (s.startsWith("[gateway] ")) logGateway.push(JSON.parse(s.slice(10)));
  else if (!s.startsWith("[/api/chat]")) infoAsli(...a);
};

let lolos = 0, gagal = 0;
function cek(nama: string, ok: boolean, info = "") {
  if (ok) lolos++; else gagal++;
  infoAsli(`  ${ok ? "LOLOS" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
}

const db = poolPerusahaan();
const { rows: [akun] } = await db.query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users WHERE lower(u.username) = $1`, [AKUN]);
const mulaiUji = new Date();
const hitungTiket = async () => {
  const { rows: [r] } = await db.query<{ semua: number; milik: number }>(
    `SELECT count(*)::int semua, count(*) FILTER (WHERE id_employee = $1 AND created_at >= $2)::int milik FROM portal_ticket`,
    [akun.id_employee, mulaiUji]);
  return r;
};
const sebelum = await hitungTiket();

type Pesan = { id: string; role: "user" | "assistant"; parts: { type: "text"; text: string }[] };
const riwayat: Pesan[] = [];
type Giliran = { teks: string; galat: string | null; rancangan: unknown[]; klarifikasi: unknown[]; ms: number };

async function tanya(kalimat: string): Promise<Giliran> {
  riwayat.push({ id: `u${riwayat.length}`, role: "user", parts: [{ type: "text", text: kalimat }] });
  const mulai = Date.now();
  // Sama dengan route: agent dirakit ulang tiap permintaan, dengan batas tool per model.
  const jalur = await siapkanAgent(akun.id_employee, maksToolGatewayModel(MODEL));
  if (jalur.jalur !== "konfigurasi") throw new Error(`jalur ${jalur.jalur}: ${jalur.sebab}`);
  let teks = "", galat: string | null = null;
  try {
    // Galat sebelum keluaran pertama bisa dilempar di sini, bukan lewat stream.
    const hasil = await jalur.agent.streamText(riwayat as never, {
      context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" },
    });
    // Tahap 2 (24 Nov 2026): dibaca SESUDAH penyaring penjaga, sama dengan yang diterima pengguna web.
    type Bagian = { type: string; text?: string; textDelta?: string; error?: unknown };
    const pj = jalur.penjaga();
    const aliran = (pj ? jagaPotongan(hasil.fullStream as AsyncIterable<Bagian>, pj, "full") : hasil.fullStream) as AsyncIterable<Bagian>;
    for await (const p of aliran) {
      if (p.type === "text-delta") teks += p.text ?? p.textDelta ?? "";
      if (p.type === "error") galat = pesanGalatGateway(p.error) ?? String((p.error as Error)?.message ?? p.error);
    }
  } catch (e) {
    galat = pesanGalatGateway(e) ?? (e as Error).message;
  }
  riwayat.push({ id: `a${riwayat.length}`, role: "assistant", parts: [{ type: "text", text: teks || "(kosong)" }] });
  return { teks: teks.trim(), galat, rancangan: [...jalur.rancangan], klarifikasi: [...jalur.klarifikasi], ms: Date.now() - mulai };
}

const ringkas = (g: Giliran) =>
  `${(g.ms / 1000).toFixed(1)} dtk, rancangan ${g.rancangan.length}${g.galat ? `, GALAT: ${g.galat.slice(0, 90)}` : ""} | ${g.teks.replace(/\s+/g, " ").slice(0, 160)}`;

infoAsli(`\n=== Mode ${MODE}, model ${MODEL} ===`);
const g1 = await tanya("Buatkan tiket karena komputer saya tidak ada akses internet atau wifi");
infoAsli(`  [1] ${ringkas(g1)}`);
let g2: Giliran | null = null, g3: Giliran | null = null;
if (MODE === "gateway-mati") {
  cek("gateway mati berakhir dengan galat, bukan jawaban karangan", g1.galat !== null && g1.teks === "", g1.galat ?? g1.teks);
  cek("pesan galat menyebut gateway dan cara memulihkan", /MR AI Gateway terputus/.test(g1.galat ?? ""), g1.galat ?? "");
  cek("retry dicoba tepat sekali per permintaan", logGateway.filter((b) => b.diulang === true).length >= 1 && logGateway.every((b) => Number(b.ulang) <= 1));
} else {
  cek("giliran 1 dijawab tanpa galat", g1.galat === null && g1.teks.length > 0);
  g2 = await tanya("iya");
  infoAsli(`  [2] ${ringkas(g2)}`);
  cek("giliran 2 (\"iya\") dijawab tanpa galat", g2.galat === null && g2.teks.length > 0);
  if (g2.rancangan.length === 0) {
    g3 = await tanya("WIRELESS");
    infoAsli(`  [3] ${ringkas(g3)}`);
    cek("giliran 3 (sub-kategori) dijawab tanpa galat", g3.galat === null && g3.teks.length > 0);
  }
  const akhir = g3 ?? g2;
  cek("rancangan tiket tersusun", akhir.rancangan.length > 0, JSON.stringify(akhir.rancangan.at(-1) ?? null).slice(0, 160));
}

const sesudah = await hitungTiket();
cek("tidak ada tiket tersimpan oleh uji ini (hanya rancangan)", sesudah.milik === 0, `tiket baru milik akun uji: ${sesudah.milik}`);
infoAsli(`  info: total portal_ticket ${sebelum.semua} -> ${sesudah.semua} (bisa bertambah karena pemakai lain)`);

if (MODE === "putus-sekali") {
  cek("perantara benar-benar memutus sambungan", diputus.length > 0, `permintaan diputus: ${diputus.join(", ")}`);
  const ulang = logGateway.filter((b) => b.diulang === true);
  cek("setiap putus sebelum balasan diulang sekali", ulang.length === diputus.length, `${ulang.length} retry untuk ${diputus.length} putus`);
}
const permintaan = logGateway.filter((b) => b.status !== undefined && b.tahap === undefined);
infoAsli(`  log gateway: ${permintaan.length} permintaan berhasil, ${logGateway.filter((b) => b.galat).length} galat sambungan`);
for (const b of logGateway.filter((b) => b.galat).slice(0, 6)) infoAsli(`    ${JSON.stringify(b)}`);
const contoh = permintaan.at(-1);
if (contoh) infoAsli(`    contoh log sukses: ${JSON.stringify(contoh)}`);

infoAsli(`\n${lolos} lolos, ${gagal} gagal`);
process.stdout.write("", () => process.exit(gagal ? 1 : 0));
