/**
 * Uji unggah dokumen lewat HTTP (Tahap 12B).
 *
 *   npm run test:dokumen-http
 *
 * PRASYARAT: server hidup di ALAMAT (default 3018), dan PDF contoh ada.
 *
 * ⚠️ Membuat baris `dokumen` sungguhan, lalu MENGHAPUSNYA lewat endpoint
 * DELETE-nya sendiri -- jadi jalur hapus ikut teruji, bukan dibersihkan
 * lewat SQL di belakang layar.
 */
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { cariDokumenNama } from "../lib/dokumen/simpan.ts";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const PDF = process.argv[2] ?? "C:/Users/ridho/Downloads/Detail Guideline _ Supertools.pdf";

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

const kue = await masuk("marketing1", "marketing1");
if (!kue) { console.log("⛔ Gagal login marketing1."); process.exit(1); }
cek(true, "login marketing1");

// PNG 1x1 piksel yang sah, dipakai sebagai bahan uji supaya tidak
// bergantung berkas luar.
const PNG_KOSONG = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
));

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: "root", password: "", database: process.env.PORTAL_DB_NAME,
});
const [pu]: any = await db.query("SELECT id FROM pengguna WHERE username='marketing1'");
const idPengguna = Number(pu[0].id);
await db.end();

const kirim = (isi: FormData, c: string | null) =>
  fetch(`${BASE}/api/dokumen`, { method: "POST", headers: c ? { cookie: c } : {}, body: isi });

function form(nama: string, jenis: string, isi: Uint8Array) {
  const f = new FormData();
  f.append("berkas", new File([isi as BlobPart], nama, { type: jenis }));
  return f;
}

console.log("--- gerbang & penolakan ---");
{
  const r = await kirim(form("x.pdf", "application/pdf", new Uint8Array(4)), null);
  cek(r.status === 401, `tanpa login ditolak (HTTP ${r.status})`);
}
{
  const r = await kirim(form("x.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    new Uint8Array(10)), kue);
  cek(r.status === 415, `jenis tidak didukung -> 415 (HTTP ${r.status})`);
}
{
  const r = await kirim(form("rusak.pdf", "application/pdf", new Uint8Array([1, 2, 3])), kue);
  cek(r.status === 422, `PDF rusak -> 422 (HTTP ${r.status})`);
  const d = await r.json();
  cek(typeof d.error === "string" && d.error.length > 10, "errornya kalimat, bukan kode mentah");
}
{
  const r = await fetch(`${BASE}/api/dokumen`, { method: "POST", headers: { cookie: kue } });
  cek(r.status === 400, `tanpa berkas -> 400 (HTTP ${r.status})`);
}

console.log("--- unggah PDF sungguhan ---");
let idDok = "";
{
  let isi: Uint8Array;
  try {
    isi = new Uint8Array(await readFile(PDF));
  } catch {
    console.log(`⛔ PDF contoh tidak ketemu: ${PDF}`);
    process.exit(1);
  }

  const t = Date.now();
  const r = await kirim(form("Detail Guideline _ Supertools.pdf", "application/pdf", isi), kue);
  const d = await r.json();
  cek(r.ok, `terunggah (HTTP ${r.status})`, d.error ?? "");
  if (r.ok) {
    idDok = d.id;
    cek(d.cara === "teks-tertanam", `pakai teks tertanam, BUKAN OCR (${d.cara})`);
    cek(d.halaman === 4, `${d.halaman} halaman`);
    cek(d.panjangTeks > 2000, `${d.panjangTeks} karakter terbaca`);
    cek(!d.sudahAda, "pertama kali: bukan dari simpanan");
    cek(Date.now() - t < 10_000, `cepat (${((Date.now() - t) / 1000).toFixed(1)} dtk)`);

    // ⚠️ Teks LENGKAP tidak boleh ikut ke browser -- cuma cuplikan.
    cek(typeof d.cuplikan === "string" && d.cuplikan.length <= 400,
      "cuma cuplikan yang dikirim balik", `${d.cuplikan?.length} karakter`);
    cek(d.teks === undefined, "teks lengkap TIDAK dikirim ke browser");
  }
}

console.log("--- unggah ulang berkas yang sama ---");
{
  const isi = new Uint8Array(await readFile(PDF));
  const r = await kirim(form("nama-lain.pdf", "application/pdf", isi), kue);
  const d = await r.json();
  cek(r.ok && d.sudahAda === true, "dikenali sudah pernah diunggah");
  cek(d.id === idDok, "mengembalikan dokumen yang SAMA, bukan kembar");
}

console.log("--- dua dokumen berbeda ---");
{
  // ⚠️ BUG NYATA 30 Sep 2026: melampirkan 2 gambar, agent cuma membaca
  // satu dan mengulang dokumen yang sama.
  //
  // Sebabnya penanda di pesan cuma berisi NAMA berkas, sedangkan tool cuma
  // menerima `id` -- yang tidak pernah dilihat model. Jadi tiap panggilan
  // tanpa id mengembalikan dokumen PALING BARU yang itu-itu juga.
  //
  // Diperbaiki dengan parameter `nama`. Tes ini menjaga pencarian per-nama
  // benar-benar membedakan dokumen.
  const satu = new TextEncoder().encode("%PDF-bukan-pdf");
  const f1 = form("alpha.png", "image/png", PNG_KOSONG);
  const r1 = await kirim(f1, kue);
  const d1 = await r1.json();

  // Berkas KEDUA harus beda isi, kalau sama akan dianggap dokumen yang sama
  // (dikunci hash) -- dan itu memang perilaku yang benar.
  const png2 = new Uint8Array([...PNG_KOSONG, ...satu]);
  const r2 = await kirim(form("beta.png", "image/png", png2), kue);
  const d2 = await r2.json();

  cek(r1.ok && r2.ok, "dua gambar terunggah", `${d1.error ?? ""} ${d2.error ?? ""}`.trim());
  if (r1.ok && r2.ok) {
    cek(d1.id !== d2.id, "id-nya BERBEDA, bukan dokumen yang sama");

    const a = await cariDokumenNama(idPengguna, "alpha.png");
    const b = await cariDokumenNama(idPengguna, "beta.png");
    cek(a?.id === d1.id, "cari per nama: alpha.png -> dokumen yang benar");
    cek(b?.id === d2.id, "cari per nama: beta.png -> dokumen yang benar");
    cek(a?.id !== b?.id, "dua nama berbeda TIDAK mengembalikan dokumen yang sama");

    const asing = await cariDokumenNama(idPengguna, "tidak-ada.png");
    cek(asing === null, "nama karangan -> null, bukan asal ambil");

    for (const id of [d1.id, d2.id]) {
      await fetch(`${BASE}/api/dokumen?id=${id}`, { method: "DELETE", headers: { cookie: kue } });
    }
  }
}


console.log("--- daftar & hapus ---");
{
  const r = await fetch(`${BASE}/api/dokumen`, { headers: { cookie: kue } });
  const d = await r.json();
  cek(r.ok && Array.isArray(d.dokumen), "daftar dokumen terbaca");
  cek(d.dokumen.some((x: { id: string }) => x.id === idDok), "dokumen tadi ada di daftar");
}
{
  const r = await fetch(`${BASE}/api/dokumen?id=tidak-ada`, {
    method: "DELETE", headers: { cookie: kue },
  });
  cek(r.status === 404, `hapus id karangan -> 404 (HTTP ${r.status})`);
}
if (idDok) {
  const r = await fetch(`${BASE}/api/dokumen?id=${idDok}`, {
    method: "DELETE", headers: { cookie: kue },
  });
  cek(r.ok, `terhapus (HTTP ${r.status})`);
  const cekLagi = await fetch(`${BASE}/api/dokumen`, { headers: { cookie: kue } });
  const d = await cekLagi.json();
  cek(!d.dokumen.some((x: { id: string }) => x.id === idDok), "tidak ada lagi di daftar");
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
process.exit(gagal.length === 0 ? 0 : 1);
