/**
 * Tes jalur HTTP entri pelamar (HR-4).
 *
 * Yang diuji di sini dan TIDAK di `test:pelamar`:
 *   * gerbang PERAN — KEPALA HR harus ditolak 403 (kebalikan dari lembur)
 *   * lowongan dari klien tidak bisa dipakai menembus pemeriksaan server
 *
 * PRASYARAT: server hidup di ALAMAT (default 3018).
 */
import mysql from "mysql2/promise";
import { susunDrafPelamar, sidikDrafPelamar } from "../lib/entri/pelamar.ts";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PENANDA = "uji pelamar http";

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

const staf = await masuk("hr1", "hr1");
cek(staf !== null, "login hr1 (staf)");
if (!staf) { console.log("gagal login hr1, berhenti"); process.exit(1); }
const kepala = await masuk("hr2", "hr2");
cek(kepala !== null, "login hr2 (kepala)");

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.HR_DB_NAME,
});

const [sisa]: any = await root.query(
  "SELECT DISTINCT ref_id FROM entri_log WHERE entitas='pelamar' AND permintaan=?", [PENANDA]);
for (const { ref_id } of sisa) {
  await root.query("DELETE FROM pelamar WHERE id=?", [ref_id]);
  await root.query("DELETE FROM entri_log WHERE entitas='pelamar' AND ref_id=?", [ref_id]);
}
if (sisa.length) console.log(`⚠️  ${sisa.length} pelamar sisa run sebelumnya dibersihkan\n`);

const hitung = async () => {
  const [r]: any = await root.query("SELECT COUNT(*) c FROM pelamar");
  return Number(r[0].c);
};
const awal = await hitung();

const [b]: any = await root.query(
  "SELECT kode FROM lowongan WHERE status='OPEN' AND tanggal_tutup >= CURDATE() LIMIT 1");
const [tutup]: any = await root.query("SELECT kode FROM lowongan WHERE status <> 'OPEN' LIMIT 1");
const LOW = b[0].kode as string;

const dasar = {
  lowongan: LOW,
  nama: "Sinta Uji HTTP",
  email: "sinta.uji.http@contoh.test",
  telepon: "08129876543",
  pendidikan: "S1",
  pengalaman: 2,
  sumber: "LinkedIn",
};
const draf = await susunDrafPelamar(dasar);
if (!draf.ok) { console.log("draf gagal:", JSON.stringify(draf.masalah)); process.exit(1); }
const sidik = sidikDrafPelamar(draf.draf);
console.log(`lowongan: ${LOW} · sidik ${sidik}\n`);

const kirim = (cookie: string | null, body: unknown) =>
  fetch(`${BASE}/api/entri/pelamar`, {
    method: "POST",
    headers: cookie
      ? { "Content-Type": "application/json", cookie }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

{
  const r = await kirim(staf, { ...dasar, sidik: "x", permintaan: PENANDA });
  if (r.status === 404) {
    console.log(`⛔ /api/entri/pelamar BELUM ADA di build ${BASE}. Jalankan \`npm run deploy\`.`);
    await root.end();
    process.exit(1);
  }
}

console.log("--- yang harus ditolak ---");
{
  const r = await kirim(null, { ...dasar, sidik, permintaan: PENANDA });
  cek(r.status === 401, `tanpa cookie ditolak (HTTP ${r.status})`);
}
if (kepala) {
  const r = await kirim(kepala, { ...dasar, sidik, permintaan: PENANDA });
  const d = await jsonAman(r);
  cek(r.status === 403, `KEPALA HR ditolak (HTTP ${r.status})`, d.error);
}
{
  const r = await kirim(staf, { ...dasar, sidik: "0".repeat(16), permintaan: PENANDA });
  cek(r.status === 409 || r.status === 400, `sidik palsu ditolak (HTTP ${r.status})`);
}
if (tutup.length) {
  // Sidik dari lowongan yang sah, tapi body menunjuk lowongan yang tutup.
  // Server menyusun ulang dari body, jadi harus ketahuan.
  const r = await kirim(staf, { ...dasar, lowongan: tutup[0].kode, sidik, permintaan: PENANDA });
  cek(r.status === 400 || r.status === 409,
    `lowongan CLOSED lewat body ditolak (HTTP ${r.status})`, tutup[0].kode);
}
{
  const r = await kirim(staf, { ...dasar, pendidikan: "S3", sidik, permintaan: PENANDA });
  cek(r.status === 400 || r.status === 409, `pendidikan karangan ditolak (HTTP ${r.status})`);
}
cek((await hitung()) === awal, "tidak ada yang tersimpan dari semua penolakan");

console.log("--- jalur lancar ---");
{
  // Status karangan ikut dikirim. Harus diabaikan; server memaksa SCREENING.
  const r = await kirim(staf, { ...dasar, sidik, permintaan: PENANDA, status: "HIRED", karyawan_id: 1 });
  const d = await jsonAman(r);
  cek(r.ok, `tersimpan (HTTP ${r.status})`, d.error ?? `id ${d.id}`);
  if (r.ok) {
    cek(d.lowongan === LOW, "lowongan benar");
    const [x]: any = await root.query(
      "SELECT status, karyawan_id, email, pendidikan FROM pelamar WHERE id=?", [d.id]);
    cek(String(x[0].status) === "SCREENING", `status SCREENING, bukan "HIRED" dari klien`);
    cek(x[0].karyawan_id === null, "karyawan_id tetap NULL, bukan 1 dari klien");

    const [log]: any = await root.query(
      "SELECT username, peran, asal FROM entri_log WHERE entitas='pelamar' AND ref_id=?", [d.id]);
    cek(log[0]?.username === "hr1" && log[0]?.peran === "staf" && log[0]?.asal === "web",
      `audit: ${log[0]?.username}/${log[0]?.peran}/${log[0]?.asal}`);

    await root.query("DELETE FROM pelamar WHERE id=?", [d.id]);
    await root.query("DELETE FROM entri_log WHERE entitas='pelamar' AND ref_id=?", [d.id]);
    cek((await hitung()) === awal, "dibersihkan, kembali ke jumlah semula");
  }
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
