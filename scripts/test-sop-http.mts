/**
 * Uji endpoint berkas SOP lewat HTTP sungguhan.
 *
 *   npm run test:sop-http
 *   UJI_BASE=http://localhost:3000 npm run test:sop-http
 *
 * PRASYARAT: server hidup, dan `npm run pasang:kb-pdf` sudah dijalankan.
 *
 * ⚠️ KENAPA LEWAT HTTP, BUKAN MEMANGGIL FUNGSINYA LANGSUNG.
 *
 * Yang paling mungkin salah di endpoint bukan logikanya, tapi hal-hal yang
 * cuma ada di jalur HTTP: proxy menolak path yang tidak terdaftar, cookie
 * tidak terbaca, atau Content-Type membuat browser menampilkan PDF sebagai
 * teks acak. Memanggil fungsinya langsung melewatkan semua itu — dan pernah
 * terjadi: route login sempat dikira jalan padahal proxy menolaknya, ketahuan
 * baru waktu diuji lewat HTTP (30 Sep).
 */
const BASE = process.env.UJI_BASE ?? "http://localhost:3000";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

async function masuk(username: string, password: string) {
  let r: Response;
  try {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    console.log(`⛔ Tidak ada server di ${BASE}.`);
    process.exit(1);
  }
  if (!r.ok) return null;
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const url = (kode: string) => `${BASE}/api/sop/${kode}/berkas`;

// ⚠️ Diperiksa sebelum uji pertama. Permintaan pertama di bawah terjadi
// SEBELUM login, jadi tanpa penjagaan ini galat "server mati" muncul sebagai
// tumpukan ECONNREFUSED yang tidak ada hubungannya dengan apa yang diuji.
try {
  await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(8000) });
} catch {
  console.log(`⛔ Tidak ada server di ${BASE}. Jalankan \`npm run dev:webpack\` dulu.`);
  process.exit(1);
}

// ⚠️ Diuji DULUAN, sebelum login. Dokumen SOP memang untuk seluruh karyawan,
// tapi "seluruh karyawan" bukan "siapa saja yang tahu alamatnya".
{
  const r = await fetch(url("SOP-IT-005"));
  cek(r.status === 401, `tanpa login ditolak (HTTP ${r.status})`);
}

const kue = await masuk("marketing1", "marketing1");
if (!kue) {
  console.log("⛔ Gagal login marketing1.");
  process.exit(1);
}
cek(true, "login marketing1");

// Orang marketing pun boleh membaca SOP IT — SOP ada supaya dibaca, dan
// pembatasan per departemen di sini akan membuat orang tidak bisa menemukan
// prosedurnya sendiri. Disepakati 1 Okt 2026.
{
  const r = await fetch(url("SOP-IT-005"), { headers: { cookie: kue } });
  cek(r.ok, `marketing boleh membaca SOP IT (HTTP ${r.status})`);

  const jenis = r.headers.get("content-type") ?? "";
  cek(jenis.includes("application/pdf"), "Content-Type PDF", jenis || "(kosong)");

  const disposisi = r.headers.get("content-disposition") ?? "";
  cek(disposisi.includes("SOP-IT-005.pdf"), "nama berkasnya benar", disposisi);

  const bita = new Uint8Array(await r.arrayBuffer());
  const tanda = new TextDecoder().decode(bita.slice(0, 5));
  cek(tanda === "%PDF-", `isinya PDF sungguhan (tanda "${tanda}")`);
  cek(bita.length > 1000, `ukurannya wajar (${bita.length} bita)`);

  // ⚠️ Pernah terjadi: PDF tersimpan 0 bita karena pdf.js mengosongkan array
  // yang dioper ke dia, dan tidak ada galat apa pun. Dijaga di sini juga.
  cek(bita.length > 0, "bukan berkas kosong");
}

{
  const r = await fetch(url("SOP-TIDAK-ADA-999"), { headers: { cookie: kue } });
  cek(r.status === 404, `kode tidak dikenal -> 404 (HTTP ${r.status})`);
}

{
  // Kode dengan bentuk yang tidak sah ditolak SEBELUM menyentuh database.
  const r = await fetch(`${BASE}/api/sop/a%2Fb/berkas`, { headers: { cookie: kue } });
  cek(r.status === 400 || r.status === 404, `kode ngawur ditolak (HTTP ${r.status})`);
}

{
  // Huruf kecil tetap jalan: user bisa saja menyalin kodenya dari teks jawaban.
  const r = await fetch(url("sop-it-005"), { headers: { cookie: kue } });
  cek(r.ok, `huruf kecil tetap jalan (HTTP ${r.status})`);
}

console.log(`\n${lolos.length} lolos, ${gagal.length} gagal\n`);
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);

process.exitCode = gagal.length === 0 ? 0 : 1;
