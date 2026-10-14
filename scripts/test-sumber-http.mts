/**
 * Tes jalur HTTP saklar sumber data (Tahap C).
 *
 * Yang diuji di sini dan TIDAK di `test:sumber`:
 *   * gerbang ADMIN PENUH — kepala departemen harus ditolak, bukan cuma staf
 *   * 404 (bukan 403) supaya keberadaan halaman tidak dikonfirmasi
 *
 * PRASYARAT: server hidup di ALAMAT (default 3018).
 */
import mysql from "mysql2/promise";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

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

const root = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.PORTAL_DB_NAME,
});
const [awal]: any = await root.query("SELECT kode, tersedia, aktif FROM sumber_db ORDER BY kode");
const pulihkan = async () => {
  for (const x of awal)
    await root.query("UPDATE sumber_db SET tersedia=?, aktif=?, diubah_oleh=NULL WHERE kode=?",
      [x.tersedia, x.aktif, x.kode]);
};

// ⚠️ Keadaan `tersedia` DIPAKSA, tidak diandaikan.
//
// Tes ini semula mengandalkan `perusahaan` masih tersedia=0. Begitu view dan
// tool-nya jadi dan kolomnya diubah jadi 1, dua tes gagal -- padahal kodenya
// benar. Kesalahan yang sama sudah pernah terjadi di `test:sumber`, dan
// pelajarannya tidak langsung diterapkan ke sini.
//
// Dijalankan SEBELUM permintaan HTTP pertama, supaya singgahan server tidak
// keburu terisi nilai lama.
await root.query("UPDATE sumber_db SET tersedia=0 WHERE kode='perusahaan'");

// `admin` satu-satunya yang boleh. Dua KEPALA ikut diuji -- mereka boleh
// menyetujui pendaftaran departemennya, TAPI tidak boleh mengganti sumber
// data, karena itu berlaku lintas departemen.
//
// ⚠️ `hr2` dulu admin dan dipakai sebagai "admin" di tes ini. Haknya dicabut
// (`15_akun_admin.sql`) supaya satu akun tidak memegang dua kekuasaan, jadi
// sekarang dia masuk daftar YANG DITOLAK.
const admin = await masuk("admin", "admin1");
cek(admin !== null, "login admin (admin penuh)");
if (!admin) { console.log("gagal login admin, berhenti"); process.exit(1); }
const kepala = await masuk("marketing2", "marketing2");
const kepalaHr = await masuk("hr2", "hr2");
const staf = await masuk("marketing1", "marketing1");
cek(kepala !== null && staf !== null, "login marketing2 (kepala) & marketing1 (staf)");
cek(kepalaHr !== null, "login hr2 (kepala HR, bukan admin lagi)");

const ambil = (c: string | null) =>
  fetch(`${BASE}/api/admin/sumber`, { headers: c ? { cookie: c } : {} });
const ganti = (c: string | null, body: unknown) =>
  fetch(`${BASE}/api/admin/sumber`, {
    method: "POST",
    headers: c ? { "Content-Type": "application/json", cookie: c } : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

{
  const r = await ambil(admin);
  if (r.status === 404 && !(await jsonAman(r)).sumber) {
    const d = await jsonAman(await ambil(admin));
    if (!d.sumber) {
      console.log(`⛔ /api/admin/sumber BELUM ADA di build ${BASE}. Jalankan \`npm run deploy\`.`);
      await root.end();
      process.exit(1);
    }
  }
}

console.log("--- gerbang akses ---");
{
  const r = await ambil(null);
  cek(r.status === 401, `tanpa cookie ditolak (HTTP ${r.status})`);
}
if (staf) {
  const r = await ambil(staf);
  cek(r.status === 404, `staf ditolak dengan 404, bukan 403 (HTTP ${r.status})`);
}
if (kepala) {
  // Kepala BOLEH menyetujui pendaftaran, tapi TIDAK boleh mengganti sumber.
  const r = await ambil(kepala);
  cek(r.status === 404, `KEPALA marketing ditolak (HTTP ${r.status})`);
  const p = await ganti(kepala, { kode: "dummy" });
  cek(p.status === 404, `kepala marketing tidak bisa mengganti sumber (HTTP ${p.status})`);
}
if (kepalaHr) {
  // hr2: bekas admin. Kalau pencabutannya tidak berlaku, ini yang ketahuan.
  const r = await ambil(kepalaHr);
  cek(r.status === 404, `hr2 (bekas admin) ditolak (HTTP ${r.status})`);
  const p = await ganti(kepalaHr, { kode: "dummy" });
  cek(p.status === 404, `hr2 tidak bisa mengganti sumber (HTTP ${p.status})`);
}

console.log("--- admin membaca ---");
// ⚠️ SINGGAHAN SERVER dibuang dulu, lewat jalur resmi.
//
// `tersedia` sudah dipaksa 0 di atas lewat root, tapi itu belum cukup: daftar
// sumber disinggahkan 10 detik DI DALAM PROSES SERVER. `lupakanSinggahan()`
// tidak bisa dipanggil dari sini -- beda proses. Jadi GET masih membaca nilai
// lama, sementara POST lolos karena `gantiSumber()` membaca segar di dalam
// transaksinya sendiri. Itu sebabnya tadi 409-nya benar tapi bacaannya salah.
//
// Ganti ke `dummy` (yang memang sudah aktif) memaksa server membuang
// singgahannya, tanpa menunggu 10 detik.
await ganti(admin, { kode: "dummy" });
{
  const r = await ambil(admin);
  const d = await jsonAman(r);
  cek(r.ok, `admin bisa membaca (HTTP ${r.status})`);
  cek(Array.isArray(d.sumber) && d.sumber.length >= 2, `dapat ${d.sumber?.length} sumber`);
  cek(d.sumber?.filter((s: any) => s.aktif).length === 1, "tepat satu aktif");
  cek(d.sumber?.some((s: any) => s.kode === "perusahaan" && s.tersedia === false),
    "perusahaan ditandai belum tersedia");
}

console.log("--- admin mengganti ---");
{
  const r = await ganti(admin, { kode: "tidak-ada" });
  cek(r.status === 404, `kode karangan -> 404 (HTTP ${r.status})`);
}
{
  const r = await ganti(admin, { kode: "perusahaan" });
  const d = await jsonAman(r);
  cek(r.status === 409, `belum tersedia -> 409 (HTTP ${r.status})`, d.sebab);
}
{
  const r = await ganti(admin, {});
  cek(r.status === 400, `kode kosong -> 400 (HTTP ${r.status})`);
}
{
  await root.query("UPDATE sumber_db SET tersedia=1 WHERE kode='perusahaan'");
  const r = await ganti(admin, { kode: "perusahaan" });
  const d = await jsonAman(r);
  cek(r.ok, `berganti ke perusahaan (HTTP ${r.status})`, d.error ?? "");
  const [b]: any = await root.query("SELECT kode, aktif, diubah_oleh FROM sumber_db ORDER BY kode");
  cek(b.filter((x: any) => Number(x.aktif) === 1).length === 1, "tetap tepat satu aktif");
  cek(b.find((x: any) => x.kode === "perusahaan")?.diubah_oleh === "admin", "dicatat atas nama admin");

  const kembali = await ganti(admin, { kode: "dummy" });
  cek(kembali.ok, "bisa kembali ke dummy");
}

await pulihkan();
const [akhir]: any = await root.query("SELECT kode, tersedia, aktif FROM sumber_db ORDER BY kode");
cek(JSON.stringify(akhir) === JSON.stringify(awal), "keadaan awal dipulihkan");

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await root.end();
process.exit(gagal.length === 0 ? 0 : 1);
