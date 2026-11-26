/**
 * Uji alur tiket LEWAT PORTAL (`POST /api/chat`), sama seperti browser: server Next.js, sesi,
 * kuota, retry gateway, dan stream jawaban ikut teruji.
 *
 *   npx tsx --env-file=.env.local scripts/uji-portal-tiket.mts [model] [username-portal]
 *
 * Sesi dibuat di laptop ini dengan SESSION_SECRET dari `.env.local`, untuk akun portal yang SUDAH
 * ADA (bawaan: akun Ridho). Token tidak dicetak. Tidak ada `percakapanId`, jadi percakapan uji
 * tidak tersimpan di riwayat. Tiket hanya sampai rancangan; jumlah `portal_ticket` dicek.
 */
import { buatToken, NAMA_COOKIE } from "../lib/sesi.ts";
import { cariPengguna } from "../lib/pengguna.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { usernamePortal } from "../lib/akun-perusahaan.ts";

const MODEL = process.argv[2] ?? "mr-ai-gateway";
const USERNAME = process.argv[3] ?? "ridho@mustika-ratu.co.id";
const PORTAL = process.env.PORTAL_URL ?? "http://localhost:3000";

let lolos = 0, gagal = 0;
function cek(nama: string, ok: boolean, info = "") {
  if (ok) lolos++; else gagal++;
  console.log(`  ${ok ? "LOLOS" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
}

// Akun perusahaan disimpan di portal sebagai `mr:<id_employee>`, jadi email dipetakan dulu.
const db = poolPerusahaan();
const { rows: [emp] } = await db.query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users WHERE lower(u.username) = $1`,
  [USERNAME.toLowerCase()]);
const p = await cariPengguna(emp ? usernamePortal(emp.id_employee) : USERNAME);
if (!p || !p.id_employee) throw new Error(`akun portal "${USERNAME}" tidak ada, tidak aktif, atau belum dipetakan ke karyawan`);
const token = await buatToken({
  id: p.id, username: p.username, nama: p.nama, departemen: p.departemen, peran: p.peran,
  admin: Boolean(p.is_admin), idEmployee: p.id_employee,
});
const cookie = `${NAMA_COOKIE}=${token}`;

const mulaiUji = new Date();
const tiketBaru = async () => {
  const { rows: [r] } = await db.query<{ n: number }>(
    `SELECT count(*)::int n FROM portal_ticket WHERE id_employee = $1 AND created_at >= $2`, [p.id_employee, mulaiUji]);
  return r.n;
};

type Bagian = { type: string; text?: string };
type Pesan = { id: string; role: "user" | "assistant"; parts: Bagian[] };
const riwayat: Pesan[] = [];

async function tanya(kalimat: string) {
  riwayat.push({ id: `u${riwayat.length}`, role: "user", parts: [{ type: "text", text: kalimat }] });
  const mulai = Date.now();
  let ttft: number | null = null;
  const r = await fetch(`${PORTAL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ messages: riwayat, model: MODEL }),
  });
  if (!r.ok || !r.body) {
    const isi = await r.text();
    return { ms: Date.now() - mulai, ttft, status: r.status, teks: "", galat: isi.slice(0, 300), rancangan: false, selesai: null as string | null };
  }
  let teks = "", galat: string | null = null, rancangan = false, selesai: string | null = null, sisa = "";
  const pembaca = r.body.getReader();
  const dek = new TextDecoder();
  for (let x = await pembaca.read(); !x.done; x = await pembaca.read()) {
    sisa += dek.decode(x.value, { stream: true });
    const baris = sisa.split("\n");
    sisa = baris.pop() ?? "";
    for (const b of baris) {
      if (!b.startsWith("data: ") || b === "data: [DONE]") continue;
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(b.slice(6)); } catch { continue; }
      if (ev.type === "text-delta") {
        if (ttft === null) ttft = Date.now() - mulai;
        teks += String(ev.delta ?? "");
      }
      if (ev.type === "error") galat = String(ev.errorText ?? "galat");
      const meta = ev.messageMetadata as { rancangan?: unknown; selesai?: string } | undefined;
      if (meta?.rancangan) rancangan = true;
      if (meta?.selesai) selesai = meta.selesai;
    }
  }
  riwayat.push({ id: `a${riwayat.length}`, role: "assistant", parts: [{ type: "text", text: teks || "(kosong)" }] });
  return { ms: Date.now() - mulai, ttft, status: r.status, teks: teks.trim(), galat, rancangan, selesai };
}

const ringkas = (h: Awaited<ReturnType<typeof tanya>>) =>
  `${(h.ms / 1000).toFixed(1)} dtk total, kata pertama ${h.ttft === null ? "-" : (h.ttft / 1000).toFixed(1) + " dtk"}, ` +
  `HTTP ${h.status}, selesai=${h.selesai ?? "-"}, rancangan=${h.rancangan ? "ya" : "tidak"}` +
  `${h.galat ? `, GALAT: ${h.galat.slice(0, 160)}` : ""} | ${h.teks.replace(/\s+/g, " ").slice(0, 170)}`;

console.log(`\n=== Uji lewat portal ${PORTAL}, model ${MODEL}, akun ${p.nama} (${p.departemen}/${p.peran}) ===`);
// Percakapan berhenti begitu rancangan muncul, seperti pemakai yang langsung memeriksa kartu
// konfirmasi. Dulu uji tetap melanjutkan sesudah rancangan jadi lalu hanya menilai giliran
// terakhir, sehingga rancangan di giliran 1 terhitung gagal (12 Nov 2026).
const giliran = [
  "Buatkan tiket karena komputer saya tidak ada akses internet atau wifi",
  "iya",
  "WIRELESS",
];
let adaRancangan = false;
for (const [i, kalimat] of giliran.entries()) {
  const g = await tanya(kalimat);
  console.log(`  [${i + 1}] ${ringkas(g)}`);
  cek(`giliran ${i + 1} dijawab tanpa galat`, g.status === 200 && !g.galat && g.teks.length > 0);
  if (g.rancangan) { adaRancangan = true; break; }
}
cek("rancangan tiket sampai ke browser (kartu konfirmasi)", adaRancangan);
const baru = await tiketBaru();
cek("tidak ada tiket tersimpan (hanya rancangan)", baru === 0, `tiket baru: ${baru}`);

console.log(`\n${lolos} lolos, ${gagal} gagal`);
await db.end();
process.stdout.write("", () => process.exit(gagal ? 1 : 0));
