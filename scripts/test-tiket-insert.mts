/**
 * Uji perakitan INSERT tiket — DI DALAM TRANSAKSI YANG SELALU DIBATALKAN.
 *
 *   npm run test:tiket-insert
 *
 * ============================================================
 * KENAPA ROLLBACK, BUKAN BUAT-LALU-HAPUS
 * ============================================================
 * `portal_ticket` itu antrean helpdesk yang hidup. Tiket uji yang sempat
 * tersimpan — walau dihapus semenit kemudian — tetap bisa terlihat teknisi,
 * terkirim sebagai notifikasi, atau terbawa laporan harian mereka.
 *
 * Di dalam transaksi yang dibatalkan, PostgreSQL tetap memeriksa SELURUHNYA:
 * kolom wajib, tipe data, `UNIQUE` pada `no_ticket`, dan hak akses role. Yang
 * tidak terbukti cuma satu hal — bahwa barisnya menetap. Itu memang perlu satu
 * tiket sungguhan, sekali, dan bukan di sini.
 *
 * ⚠️ MEMAKAI KREDENSIAL ADMIN kalau `DEMO_PG_TULIS_USER` belum dibuat. Yang
 * diuji dengan admin adalah SQL dan constraint-nya; hak role `ai_tulis` baru
 * ikut teruji setelah `npm run buat:pg-tulis` dijalankan. Perbedaan itu
 * dicetak, bukan disamarkan.
 */
import { Client } from "pg";
import { susunDraf } from "../lib/entri/tiket.ts";
import { KOLOM_ISI, nomorBerikutnya } from "../lib/entri/simpan-tiket.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const pakaiRole = Boolean(process.env.DEMO_PG_TULIS_USER && process.env.DEMO_PG_TULIS_PASSWORD);
console.log(
  pakaiRole
    ? "memakai role ai_tulis — hak per kolom IKUT teruji\n"
    : "⚠️ role ai_tulis belum ada; memakai kredensial admin.\n" +
      "   Yang teruji: SQL + constraint. Yang BELUM: hak per kolom role.\n",
);

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: pakaiRole ? process.env.DEMO_PG_TULIS_USER : process.env.DEMO_PG_ADMIN_USER,
  password: pakaiRole ? process.env.DEMO_PG_TULIS_PASSWORD : process.env.DEMO_PG_ADMIN_PASSWORD,
});
await c.connect();

const baca = poolPerusahaan();
const sebelum = ((await baca.query<{ n: number }>(`SELECT count(*)::int n FROM portal_ticket`)).rows[0]).n;
console.log(`portal_ticket sebelum: ${sebelum} baris\n`);

const [kar] = (await baca.query<{ id_employee: string }>(
  `SELECT id_employee FROM employee WHERE is_active = true LIMIT 1`)).rows;

const r = await susunDraf(kar.id_employee, {
  kategori: "HARDWARE",
  subKategori: "PRINTER",
  judul: "UJI OTOMATIS — jangan dikerjakan",
  deskripsi: "Baris ini dibuat skrip pengujian di dalam transaksi yang dibatalkan.",
  prioritas: "rendah",
});
if (!r.ok) { console.log("rancangan gagal disusun"); process.exit(1); }
const d = r.draf;

// ============================================================
console.log("=== 1. INSERT diterima database, lalu dibatalkan ===");
// ============================================================
const nomor = `T${new Date().toISOString().slice(0, 10).replace(/-/g, "")}9999`;
let ditulis: { id_ticket: string; no_ticket: string; status: string; priority: string } | undefined;
await c.query("BEGIN");
try {
  const { rows } = await c.query<any>(
    `INSERT INTO portal_ticket (${KOLOM_ISI.join(", ")})
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id_ticket, no_ticket, status, priority, created_at, self_closed`,
    [nomor, d.idEmployee, d.kategori.id, d.subKategori.id, d.judul, d.deskripsi, d.prioritas.nilai],
  );
  ditulis = rows[0];
  cek("INSERT diterima", Boolean(ditulis), ditulis?.no_ticket);
  // ⚠️ INI INTINYA: status TIDAK diisi kode kita, tapi database tetap
  // memberinya OPEN. Itu jaminan yang berdiri walau kode kita salah.
  cek("status = OPEN dari nilai bawaan database", ditulis!.status === "OPEN", ditulis!.status);
  cek("prioritas tersimpan apa adanya", ditulis!.priority === "LOW", ditulis!.priority);
  cek("self_closed = false dari bawaan", rows[0].self_closed === false);
  cek("created_at terisi sendiri", Boolean(rows[0].created_at));

  const { rows: ada } = await c.query<{ n: number }>(
    `SELECT count(*)::int n FROM portal_ticket WHERE no_ticket = $1`, [nomor]);
  cek("terlihat DI DALAM transaksi", ada[0].n === 1);
} finally {
  await c.query("ROLLBACK");
}

const { rows: hilang } = await c.query<{ n: number }>(
  `SELECT count(*)::int n FROM portal_ticket WHERE no_ticket = $1`, [nomor]);
cek("hilang sesudah ROLLBACK", hilang[0].n === 0);

// ============================================================
console.log("\n=== 2. Nomor kembar ditolak database ===");
// ============================================================
// Ini yang membuat pencetakan nomor dua sistem aman: tabrakan gagal keras.
const [adaNo] = (await baca.query<{ no_ticket: string }>(
  `SELECT no_ticket FROM portal_ticket ORDER BY created_at DESC LIMIT 1`)).rows;
await c.query("BEGIN");
let ditolak = false;
let pesan = "";
try {
  await c.query(
    `INSERT INTO portal_ticket (${KOLOM_ISI.join(", ")}) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [adaNo.no_ticket, d.idEmployee, d.kategori.id, d.subKategori.id, d.judul, d.deskripsi, d.prioritas.nilai],
  );
} catch (e) {
  ditolak = true;
  pesan = (e as { code?: string }).code ?? "";
}
await c.query("ROLLBACK");
cek("nomor yang sudah dipakai ditolak", ditolak, `kode ${pesan} (23505 = unique_violation)`);

// ============================================================
console.log("\n=== 3. Kolom yang TIDAK boleh disentuh ===");
// ============================================================
if (pakaiRole) {
  for (const kolom of ["status", "id_technician", "closed_at", "self_closed"]) {
    await c.query("BEGIN");
    let tolak = false;
    try {
      await c.query(
        `INSERT INTO portal_ticket (no_ticket, id_employee, subject, ${kolom})
         VALUES ($1,$2,'x',$3)`,
        [`${nomor}-${kolom}`, d.idEmployee, kolom === "self_closed" ? true : kolom === "closed_at" ? new Date() : "RESOLVED"],
      );
    } catch { tolak = true; }
    await c.query("ROLLBACK");
    cek(`INSERT yang mengisi ${kolom} ditolak database`, tolak);
  }
} else {
  console.log("  (dilewati — perlu role ai_tulis, bukan admin yang memang boleh segalanya)");
}

// ============================================================
console.log("\n=== 4. Nomor tiket mengikuti format mereka ===");
// ============================================================
// ⚠️ LAHIR DARI KEGAGALAN NYATA, 8 Okt 2026. Penghitung nomor dikira naik
// terus, padahal MELINGKAR di 9999 -> 1000. `max()` seluruh tabel memberi
// 9999 + 1 = 10000, dan lahirlah `T2026100810000`: lima digit, satu-satunya
// nomor sepanjang 14 huruf di antara 10.089 nomor sepanjang 13.
const no1 = await nomorBerikutnya(c as never, 0);
const no2 = await nomorBerikutnya(c as never, 1);
cek("panjangnya 13 seperti nomor mereka", no1.length === 13, no1);
cek("bentuknya T + 12 angka", /^T[0-9]{12}$/.test(no1), no1);
cek("mencoba ulang memberi nomor BERBEDA", no1 !== no2, `${no1} vs ${no2}`);
/**
 * Baris rusak yang SUDAH diketahui dan sengaja dibiarkan.
 *
 * ⚠️ Dikecualikan dengan NAMA, bukan dengan melonggarkan syaratnya. Mengubah
 * pemeriksaan jadi "boleh ada beberapa yang rusak" akan membuat nomor rusak
 * BERIKUTNYA lolos tanpa ada yang tahu — dan itu persis kegagalan yang baru
 * saja terjadi. Baris ini sudah ditandai `[UJI PORTAL AI - ABAIKAN]` di
 * judulnya; begitu tim pemilik menghapusnya, baris ini ikut dihapus dari sini.
 */
const DIKENAL_RUSAK = ["T2026100810000"];
const { rows: rusak } = await baca.query<{ no_ticket: string; panjang: number }>(
  `SELECT no_ticket, length(no_ticket) panjang FROM portal_ticket
    WHERE no_ticket !~ '^T[0-9]{12}$' ORDER BY created_at DESC`);
const baru = rusak.filter((r) => !DIKENAL_RUSAK.includes(r.no_ticket));
cek(
  "tidak ada nomor salah bentuk yang BARU",
  baru.length === 0,
  baru.length === 0
    ? `${rusak.length} dikenal, 0 baru`
    : baru.map((b) => `${b.no_ticket} (${b.panjang} huruf)`).join(", "),
);
const masihAda = rusak.filter((r) => DIKENAL_RUSAK.includes(r.no_ticket));
if (masihAda.length > 0) {
  console.log(`  catatan: ${masihAda.length} baris uji masih ada di tabel mereka — ${masihAda.map((m) => m.no_ticket).join(", ")}`);
}

// ============================================================
console.log("\n=== 5. Tidak ada yang tertinggal ===");
// ============================================================
const sesudah = ((await baca.query<{ n: number }>(`SELECT count(*)::int n FROM portal_ticket`)).rows[0]).n;
cek("jumlah tiket tidak berubah", sesudah === sebelum, `${sebelum} -> ${sesudah}`);
const { rows: uji } = await baca.query<{ n: number }>(
  `SELECT count(*)::int n FROM portal_ticket WHERE subject LIKE 'UJI OTOMATIS%'`);
cek("tidak ada tiket uji yang tersimpan", uji[0].n === 0, `${uji[0].n} ditemukan`);

await c.end();
await baca.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
