/**
 * Tes jalur HTTP entri lembur (HR-3).
 *
 * Menguji apa yang PERSIS terjadi saat tombol Simpan di kartu lembur ditekan.
 *
 * Yang paling penting di sini dan TIDAK teruji di `test:lembur`:
 *   * gerbang PERAN — staf HR harus ditolak 403, cuma kepala yang boleh
 *   * nilai rupiah dari klien harus DIABAIKAN, bukan dipercaya
 *
 * PRASYARAT: server hidup di ALAMAT (default 3018, port `npm run deploy`).
 */
import mysql from "mysql2/promise";
import { susunDrafLembur, sidikDrafLembur } from "../lib/entri/lembur.ts";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const PENANDA = "uji lembur http";

async function masuk(username: string, password: string) {
  let r: Response;
  try {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    console.log(
      [
        `⛔ Tidak ada server di ${BASE}.`,
        "   Jalankan `npm run deploy` di terminal lain, tunggu sampai siap.",
      ].join("\n"),
    );
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

// Sisa run yang terputus.
const [sisa]: any = await root.query(
  "SELECT DISTINCT ref_id FROM entri_log WHERE entitas='lembur' AND permintaan=?", [PENANDA]);
for (const { ref_id } of sisa) {
  await root.query("DELETE FROM lembur WHERE id=?", [ref_id]);
  await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=?", [ref_id]);
}
if (sisa.length) console.log(`⚠️  ${sisa.length} lembur sisa run sebelumnya dibersihkan\n`);

const hitung = async () => {
  const [r]: any = await root.query("SELECT COUNT(*) c FROM lembur");
  return Number(r[0].c);
};
const awal = await hitung();

const [k]: any = await root.query(
  `SELECT k.nama FROM karyawan k JOIN jabatan j ON j.id=k.jabatan_id
    WHERE k.status_kerja='AKTIF' AND j.level='Operator'
      AND k.nama NOT IN (SELECT nama FROM (SELECT nama FROM karyawan GROUP BY nama HAVING COUNT(*)>1) d)
    LIMIT 1`);
const ORANG = k[0].nama as string;
const dasar = { karyawan: ORANG, jam: 2, alasan: "closing bulanan" };
const draf = await susunDrafLembur(dasar);
if (!draf.ok) { console.log("draf gagal disusun"); process.exit(1); }
const sidik = sidikDrafLembur(draf.draf);
console.log(`karyawan uji: ${ORANG} · nilai ${draf.draf.nilaiRp} · sidik ${sidik}\n`);

const kirim = (cookie: string | null, body: unknown) =>
  fetch(`${BASE}/api/entri/lembur`, {
    method: "POST",
    headers: cookie
      ? { "Content-Type": "application/json", cookie }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

{
  const r = await kirim(kepala, { ...dasar, sidik: "x", permintaan: PENANDA });
  if (r.status === 404) {
    console.log(`⛔ /api/entri/lembur BELUM ADA di build ${BASE}. Jalankan \`npm run deploy\`.`);
    await root.end();
    process.exit(1);
  }
}

console.log("--- yang harus ditolak ---");
{
  const r = await kirim(null, { ...dasar, sidik, permintaan: PENANDA });
  cek(r.status === 401, `tanpa cookie ditolak (HTTP ${r.status})`);
}
if (staf) {
  const r = await kirim(staf, { ...dasar, sidik, permintaan: PENANDA });
  const d = await jsonAman(r);
  cek(r.status === 403, `STAF HR ditolak (HTTP ${r.status})`, d.error);
}
{
  const r = await kirim(kepala, { ...dasar, sidik: "0".repeat(16), permintaan: PENANDA });
  cek(r.status === 409 || r.status === 400, `sidik palsu ditolak (HTTP ${r.status})`);
}
{
  const r = await kirim(kepala, { ...dasar, alasan: "a", sidik, permintaan: PENANDA });
  cek(r.status === 400 || r.status === 409, `alasan pendek ditolak (HTTP ${r.status})`);
}
cek((await hitung()) === awal, "tidak ada yang tersimpan dari semua penolakan");

console.log("--- jalur lancar ---");
{
  // Nilai rupiah KARANGAN ikut dikirim. Harus diabaikan sepenuhnya.
  const r = await kirim(kepala, {
    ...dasar, sidik, permintaan: PENANDA,
    nilaiRp: 99_999_999, nilai_rp: 99_999_999,
  });
  const d = await jsonAman(r);
  cek(r.ok, `tersimpan (HTTP ${r.status})`, d.error ?? `id ${d.id}`);
  if (r.ok) {
    cek(Number(d.nilaiRp) === draf.draf.nilaiRp, "nilai dari server, bukan dari klien",
      `${d.nilaiRp} vs karangan 99.999.999`);
    const [b]: any = await root.query(
      "SELECT karyawan_id, jam, status, nilai_rp FROM lembur WHERE id=?", [d.id]);
    cek(Number(b[0].nilai_rp) === draf.draf.nilaiRp, "nilai_rp tersimpan dari perhitungan server");
    cek(String(b[0].status) === "PENDING", "status PENDING");

    const [log]: any = await root.query(
      "SELECT username, peran, asal FROM entri_log WHERE entitas='lembur' AND ref_id=?", [d.id]);
    cek(log[0]?.username === "hr2" && log[0]?.peran === "kepala" && log[0]?.asal === "web",
      `audit: ${log[0]?.username}/${log[0]?.peran}/${log[0]?.asal}`);

    await root.query("DELETE FROM lembur WHERE id=?", [d.id]);
    await root.query("DELETE FROM entri_log WHERE entitas='lembur' AND ref_id=?", [d.id]);
    cek((await hitung()) === awal, "dibersihkan, kembali ke jumlah semula");
  }
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
