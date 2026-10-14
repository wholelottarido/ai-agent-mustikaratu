/**
 * Mencoba `/api/chat` lewat HTTP sungguhan, memakai sesi akun uji.
 *
 *   npm run coba:chat
 *   npm run coba:chat -- "pertanyaan lain"
 *
 * ⚠️ MEMANGGIL CLAUDE SUNGGUHAN lewat route, jadi kuota dan pencatatan token
 * ikut jalan — tidak seperti `npm run coba:konfig` yang memanggil agent
 * langsung dan melewati semua itu.
 *
 * PRASYARAT: `npx next dev -p 3018` hidup, dan `npm run sesi:uji` sudah
 * dijalankan untuk mengambil cookie.
 *
 * Yang dibuktikan di sini dan TIDAK bisa dibuktikan uji sebelumnya: route
 * membaca sesi, memilih jalur, dan mengembalikan stream yang benar-benar
 * berisi jawaban — plus kuota dan `pemakaian` ikut tercatat.
 */
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const TANYA = process.argv[2] ?? "Tiket helpdesk saya yang belum selesai apa saja?";

let kue: string;
try { kue = (await readFile(join(tmpdir(), "sesi-uji-portal.txt"), "utf8")).trim(); }
catch { console.error("Belum ada cookie sesi. Jalankan `npm run sesi:uji` dulu."); process.exit(1); }

console.log(`tanya : ${TANYA}\n`);
const mulai = Date.now();

const r = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: kue },
  body: JSON.stringify({
    messages: [{ id: "1", role: "user", parts: [{ type: "text", text: TANYA }] }],
    model: process.env.COBA_MODEL ?? "claude-haiku-4-5",
  }),
});

console.log(`HTTP ${r.status} ${r.headers.get("content-type") ?? ""}`);
if (!r.ok) { console.error(await r.text()); process.exit(1); }

// Stream UI message: baris `data: {...}`. Yang dikumpulkan cuma potongan teks.
const teks: string[] = [];
const lain = new Set<string>();
const badan = await r.text();
for (const baris of badan.split("\n")) {
  if (!baris.startsWith("data: ")) continue;
  const isi = baris.slice(6).trim();
  if (isi === "[DONE]") continue;
  try {
    const o = JSON.parse(isi) as { type?: string; delta?: string; text?: string };
    if (o.type === "text-delta" && o.delta) teks.push(o.delta);
    else if (o.type) lain.add(o.type);
  } catch { /* baris bukan JSON — diabaikan */ }
}

console.log("─".repeat(70));
console.log(teks.join("") || "(tidak ada teks di stream)");
console.log("─".repeat(70));
console.log(`\njenis part lain : ${[...lain].join(", ") || "-"}`);
console.log(`waktu           : ${((Date.now() - mulai) / 1000).toFixed(1)} detik`);
console.log(`\nLihat log server untuk baris "[/api/chat] jalur konfigurasi" atau peringatan jatuh ke jalur lama.`);
