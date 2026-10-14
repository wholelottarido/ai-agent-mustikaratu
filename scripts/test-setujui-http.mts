/**
 * Tes jalur HTTP keputusan lembur (HR-5).
 *
 * Yang diuji di sini dan TIDAK di `test:setujui`:
 *   * gerbang PERSETUJUAN — staf HR ditolak 403, dan pemeriksaannya memakai
 *     `bolehSetujui`, bukan `bolehEntri`
 *   * status karangan dari klien tidak bisa menembus ke kolom `status`
 *
 * ⚠️ Memakai baris `lembur` yang SUDAH ADA dan mengembalikannya ke PENDING di
 * akhir. Itu butuh root: aplikasi sengaja tidak bisa membatalkan keputusan.
 */
import mysql from "mysql2/promise";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PENANDA = "uji setujui http";

async function masuk(username: string, password: string) {
  let r: Response;
  try {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    console.log(`⛔ Tidak ada server di ${BASE}. Jalankan \`npm run deploy\` dulu.`);
    process.exit(1);
  }
  if (!r.ok) return null;
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function jsonAman(r: Response) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { __bukanJson: t.slice(0, 80) }; }
}

const kepala = await masuk("hr2", "hr2");
cek(kepala !== null, "login hr2 (kepala)");
if (!kepala) { console.log("gagal login hr2, berhenti"); process.exit(1); }
const staf = await masuk("hr1", "hr1");
cek(staf !== null, "login hr1 (staf)");

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.HR_DB_NAME,
});

// Kembalikan sisa run yang terputus.
const [sisa]: any = await root.query(
  "SELECT DISTINCT ref_id FROM entri_log WHERE entitas='lembur' AND permintaan=?", [PENANDA]);
for (const { ref_id } of sisa) {
  await root.query("UPDATE lembur SET status='PENDING' WHERE id=?", [ref_id]);
  await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?", [ref_id, PENANDA]);
}
if (sisa.length) console.log(`⚠️  ${sisa.length} keputusan sisa run sebelumnya dikembalikan\n`);

const status = async (id: number) => {
  const [r]: any = await root.query("SELECT status FROM lembur WHERE id=?", [id]);
  return r[0]?.status;
};
const [p]: any = await root.query("SELECT id, jam, nilai_rp FROM lembur WHERE status='PENDING' LIMIT 1");
if (!p.length) { console.log("Tidak ada lembur PENDING."); process.exit(1); }
const ID = Number(p[0].id);
const JAM = Number(p[0].jam);
const NILAI = Number(p[0].nilai_rp);
console.log(`lembur uji: #${ID} (${JAM} jam, ${NILAI})\n`);

const kirim = (cookie: string | null, body: unknown) =>
  fetch(`${BASE}/api/entri/lembur/putuskan`, {
    method: "POST",
    headers: cookie
      ? { "Content-Type": "application/json", cookie }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

{
  const r = await kirim(kepala, { id: ID, keputusan: "MAYBE" });
  if (r.status === 404) {
    console.log(`⛔ /api/entri/lembur/putuskan BELUM ADA di build ${BASE}. Jalankan \`npm run deploy\`.`);
    await root.end();
    process.exit(1);
  }
}

console.log("--- yang harus ditolak ---");
{
  const r = await kirim(null, { id: ID, keputusan: "APPROVED" });
  cek(r.status === 401, `tanpa cookie ditolak (HTTP ${r.status})`);
}
if (staf) {
  const r = await kirim(staf, { id: ID, keputusan: "APPROVED" });
  const d = await jsonAman(r);
  cek(r.status === 403, `STAF HR ditolak (HTTP ${r.status})`, d.error);
}
{
  const r = await kirim(kepala, { id: ID, keputusan: "MAYBE" });
  cek(r.status === 400, `keputusan karangan ditolak (HTTP ${r.status})`);
}
{
  // "PENDING" adalah status sah di tabel, tapi bukan keputusan yang sah.
  const r = await kirim(kepala, { id: ID, keputusan: "PENDING" });
  cek(r.status === 400, `keputusan "PENDING" ditolak (HTTP ${r.status})`);
}
{
  const r = await kirim(kepala, { id: ID, keputusan: "REJECTED", catatan: "no" });
  cek(r.status === 400, `tolak dengan alasan pendek ditolak (HTTP ${r.status})`);
}
{
  const r = await kirim(kepala, { id: 999_999, keputusan: "APPROVED" });
  cek(r.status === 400, `id karangan ditolak (HTTP ${r.status})`);
}
cek((await status(ID)) === "PENDING", "belum berubah setelah semua penolakan");

console.log("--- jalur lancar ---");
{
  // Kiriman jahat: jam & nilai karangan ikut di body. Harus diabaikan.
  const r = await kirim(kepala, {
    id: ID, keputusan: "APPROVED", permintaan: PENANDA,
    jam: 99, nilai_rp: 99_999_999, nilaiRp: 99_999_999,
  });
  const d = await jsonAman(r);
  cek(r.ok, `disetujui (HTTP ${r.status})`, d.error ?? d.keputusan);
  cek((await status(ID)) === "APPROVED", "status jadi APPROVED");

  const [b]: any = await root.query("SELECT jam, nilai_rp FROM lembur WHERE id=?", [ID]);
  cek(Number(b[0].jam) === JAM && Number(b[0].nilai_rp) === NILAI,
    "jam & nilai_rp utuh, angka dari klien diabaikan");

  const [log]: any = await root.query(
    "SELECT aksi, username, peran, asal FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?",
    [ID, PENANDA]);
  cek(log.length === 1 && log[0].aksi === "SETUJU", `jejak SETUJU (${log[0]?.aksi})`);
  cek(log[0]?.username === "hr2" && log[0]?.peran === "kepala" && log[0]?.asal === "web",
    `audit: ${log[0]?.username}/${log[0]?.peran}/${log[0]?.asal}`);

  const r2 = await kirim(kepala, { id: ID, keputusan: "REJECTED", catatan: "berubah pikiran", permintaan: PENANDA });
  cek(r2.status === 409, `keputusan kedua ditolak (HTTP ${r2.status})`);
  const [log2]: any = await root.query(
    "SELECT COUNT(*) c FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?", [ID, PENANDA]);
  cek(Number(log2[0].c) === 1, "tidak ada jejak dobel");
}

console.log("--- bersih-bersih ---");
await root.query("UPDATE lembur SET status='PENDING' WHERE id=?", [ID]);
await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=? AND permintaan=?", [ID, PENANDA]);
cek((await status(ID)) === "PENDING", "dikembalikan ke PENDING");

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
