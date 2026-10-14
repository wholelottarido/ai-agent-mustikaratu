/**
 * Tes penjaga tool `query_perusahaan`.
 *
 * Yang dijaga di sini paling mahal kalau bocor: penyaring baris. View
 * `v_asisten_*` tidak punya WHERE, jadi tanpa penyaring yang benar, satu user
 * melihat data 1.954 karyawan, 10.082 tiket, dan semua pengajuan cuti.
 *
 * PRASYARAT: `db/demo-pg/02_view_asisten.sql` sudah dijalankan.
 */
import { Client } from "pg";
import { buatToolPerusahaan } from "../voltagent/perusahaan/tool-query.ts";

const lolos: string[] = [];
const gagal: string[] = [];
const cek = (ok: boolean, nama: string, detail = "") =>
  (ok ? lolos : gagal).push(nama + (detail ? ` — ${detail}` : ""));

const pg = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER, password: process.env.DEMO_PG_PASSWORD,
  connectionTimeoutMillis: 15_000,
});
await pg.connect();

// Karyawan yang benar-benar punya tiket, supaya penyaringnya teruji dengan
// data nyata -- bukan dengan orang yang kebetulan tidak punya apa-apa.
const [orang] = (await pg.query(
  `SELECT t.id_employee::text AS id, e.fullname, COUNT(*)::int n
     FROM portal_ticket t JOIN employee e ON e.id_employee = t.id_employee
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 1`)).rows;
const [semua] = (await pg.query("SELECT COUNT(*)::int n FROM v_asisten_tiket")).rows;
console.log(`karyawan uji : ${orang.fullname} — ${orang.n} tiket dari ${semua.n} total\n`);

/**
 * Angka dari baris TERAKHIR hasil tool.
 *
 * Jangan diraba dengan regex di seluruh teks: catatan "LIMIT 200 ditambahkan"
 * ikut tercocoki, dan tesnya membaca 200 alih-alih hasil sebenarnya. Itu
 * sempat membuat dua tes gagal padahal kodenya benar.
 */
function angkaHasil(teks: string): number {
  const baris = teks.trim().split("\n").filter((b) => b.trim() !== "");
  return Number(baris[baris.length - 1]?.trim() ?? -1);
}

/**
 * Jalankan tool seperti agent memanggilnya.
 *
 * Departemen bawaannya "hr" -- SENGAJA yang tidak istimewa. Tes lama ditulis
 * sebelum ada gerbang departemen, dan yang dijaganya (penyaring baris) harus
 * tetap berlaku untuk pengguna paling biasa.
 */
const jalan = async (idEmployee: string | null, sql: string, departemen = "hr") => {
  const tool = buatToolPerusahaan({ id: 1, username: "uji", idEmployee, departemen });
  return (await tool.execute!({ sql }, undefined)) as unknown as string;
};

console.log("--- akun belum dipetakan ---");
{
  const h = await jalan(null, "SELECT COUNT(*) FROM v_asisten_karyawan LIMIT 1");
  cek(h.includes("BELUM DIPETAKAN"), "ditolak dengan pesan jelas");
  cek(!/\d{3,}/.test(h.replace(/1\.954|10\.082/g, "")), "tidak membocorkan angka apa pun");
}

console.log("--- penyaring baris ---");
{
  const h = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_tiket");
  const angka = angkaHasil(h);
  cek(angka === orang.n, `tiket tersaring ke ${orang.n}, bukan ${semua.n}`, `dapat ${angka}`);
  cek(h.includes("sudah disaring"), "hasil menyebut bahwa data sudah disaring");
}
{
  const h = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_karyawan");
  const angka = angkaHasil(h);
  cek(angka === 1, "karyawan tersaring jadi 1 (dirinya sendiri)", `dapat ${angka}`);
}

console.log("--- celah yang harus ditutup ---");
{
  const h = await jalan(orang.id, "SELECT COUNT(*) FROM public.v_asisten_tiket");
  cek(h.includes("DITOLAK"), "nama berkualifikasi skema ditolak");
}
{
  const h = await jalan(orang.id, "SELECT COUNT(*) FROM employee");
  cek(h.includes("DITOLAK") || h.includes("ERROR"), "tabel mentah di luar daftar ditolak");
}
{
  const h = await jalan(orang.id, "SELECT COUNT(*) FROM v_asisten_klaim");
  cek(h.includes("DITOLAK"), "klaim DITOLAK untuk pengguna non-marketing");
  cek(!h.includes("29"), "penolakannya tidak ikut membocorkan jumlah barisnya");
}
{
  const h = await jalan(orang.id, "UPDATE employee SET fullname='x'");
  cek(h.includes("DITOLAK"), "UPDATE ditolak penyaring SQL");
}
{
  const h = await jalan(orang.id, "SELECT 1; DROP VIEW v_asisten_tiket");
  cek(h.includes("DITOLAK"), "dua statement ditolak");
}

console.log("--- gerbang departemen: view marketing ---");
{
  // Yang sama persis, tapi dari pengguna marketing: harus BOLEH.
  const h = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_klaim", "marketing");
  cek(!h.includes("DITOLAK"), "klaim BOLEH untuk marketing", h.slice(0, 90));
  cek(angkaHasil(h) > 1000, `klaim tidak tersaring per orang (${angkaHasil(h)} baris)`);
}
{
  // ⚠️ Yang paling gampang salah: model dibilangi "ini datamu" padahal data
  // seluruh perusahaan. Kalau kalimat ini hilang, model akan menyebut angka
  // perusahaan sebagai milik user yang bertanya.
  const h = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_klaim", "marketing");
  cek(h.includes("SELURUH perusahaan"), "hasil klaim ditandai sebagai data perusahaan");
  cek(!h.includes("sudah disaring ke data milik user"), "TIDAK diklaim sebagai data milik user");
}
{
  // Marketing tetap tersaring untuk view pribadi -- gerbangnya per view,
  // bukan sakelar yang membuka semuanya sekaligus.
  const h = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_karyawan", "marketing");
  cek(angkaHasil(h) === 1, "marketing TETAP tersaring di view pribadi", `dapat ${angkaHasil(h)}`);
}
{
  // Akun belum dipetakan: view pribadi tetap ditolak, view marketing boleh --
  // pemetaan memang tidak menentukan apa-apa di view yang bukan per-orang.
  const a = await jalan(null, "SELECT COUNT(*) AS n FROM v_asisten_klaim", "marketing");
  cek(!a.includes("BELUM DIPETAKAN"), "belum dipetakan tetap bisa baca klaim");
  const b = await jalan(null, "SELECT COUNT(*) AS n FROM v_asisten_tiket", "marketing");
  cek(b.includes("BELUM DIPETAKAN"), "belum dipetakan tetap ditolak di view pribadi");
}
{
  // Campuran: satu query menyentuh dua-duanya.
  const h = await jalan(orang.id,
    "SELECT (SELECT COUNT(*) FROM v_asisten_klaim) a, (SELECT COUNT(*) FROM v_asisten_tiket) b",
    "marketing");
  cek(h.includes("CAMPURAN"), "campuran ditandai khusus", h.slice(0, 90));
}

console.log("--- view penjualan ---");
{
  const hr = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_penjualan");
  cek(hr.includes("DITOLAK"), "penjualan DITOLAK untuk non-marketing");

  const mk = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_penjualan", "marketing");
  cek(!mk.includes("DITOLAK"), "penjualan BOLEH untuk marketing", mk.slice(0, 90));
  cek(angkaHasil(mk) > 4_000_000, `tidak tersaring per orang (${angkaHasil(mk)} baris)`);
  cek(mk.includes("SELURUH perusahaan"), "ditandai sebagai data perusahaan");
}
{
  // ⚠️ Baris "tidak jualan" (qty=0, alasan Sakit/Cuti/Toko Tutup) harus sudah
  // dikeluarkan view-nya. Kalau ikut, rata-rata nilai transaksi jadi salah.
  const h = await jalan(orang.id,
    "SELECT COUNT(*) AS n FROM v_asisten_penjualan WHERE qty <= 0", "marketing");
  cek(angkaHasil(h) === 0, "baris tidak-jualan sudah dikeluarkan", `dapat ${angkaHasil(h)}`);
}
{
  // ⚠️ TANGGAL HARUS BERUPA TEKS BIASA.
  //
  // Bawaan `pg` mengubah date jadi objek Date, dan satu sel jadi berbunyi
  // "Thu Feb 09 2023 00:00:00 GMT+0700 (Western Indonesia Time)" -- 57
  // karakter sampah per sel, dan tanggalnya bisa terbaca mundur sehari.
  // Diperbaiki di `lib/db-perusahaan.ts`; ini yang menjaganya.
  const h = await jalan(orang.id,
    "SELECT tanggal FROM v_asisten_penjualan LIMIT 1", "marketing");
  cek(/\d{4}-\d{2}-\d{2}/.test(h), "tanggal berupa teks YYYY-MM-DD");
  cek(!h.includes("GMT") && !h.includes("Indonesia Time"),
    "tanggal TIDAK berupa objek Date yang bertele-tele");
}
{
  // Pertanyaan marketing yang sebenarnya, lengkap dengan agregasi.
  const t = Date.now();
  const h = await jalan(orang.id,
    "SELECT TO_CHAR(tanggal,'YYYY-MM') AS bulan, SUM(nilai) AS omzet " +
    "FROM v_asisten_penjualan WHERE tanggal >= CURRENT_DATE - 365 " +
    "GROUP BY 1 ORDER BY 1 DESC", "marketing");
  const lama = Date.now() - t;
  cek(!h.includes("DITOLAK") && !h.includes("ERROR"), "omzet per bulan jalan", h.slice(0, 90));
  cek(lama < 30_000, `selesai dalam batas 30 dtk (${(lama / 1000).toFixed(1)} dtk)`);
}

console.log("--- IT: tiket jadi data TIM, bukan data diri ---");
{
  // ⚠️ INI BAGIAN PALING RAWAN DI SELURUH BERKAS INI.
  //
  // `v_asisten_tiket` dipakai TIGA departemen dengan aturan BERBEDA:
  // marketing & HR melihat tiket mereka sendiri, IT melihat semuanya.
  // Kalau pembedanya rusak, salah satu dari dua hal terjadi -- helpdesk
  // kehilangan hampir semua tiket, atau marketing/HR melihat 10.084 tiket
  // orang lain. Dua-duanya diuji di sini.
  const hr = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_tiket", "hr");
  const it = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_tiket", "it");
  cek(angkaHasil(hr) === orang.n, `HR tetap TERSARING (${orang.n})`, `dapat ${angkaHasil(hr)}`);
  cek(angkaHasil(it) === semua.n, `IT melihat SEMUA tiket (${semua.n})`, `dapat ${angkaHasil(it)}`);
  cek(angkaHasil(it) > angkaHasil(hr), "IT memang lebih banyak daripada HR");
}
{
  const it = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_tiket", "it");
  cek(it.includes("SELURUH perusahaan"), "hasil tiket IT ditandai data perusahaan");
  cek(!it.includes("sudah disaring ke data milik user"), "TIDAK diklaim sebagai data milik user");
}
{
  // Data pribadi TETAP tersaring untuk IT -- gerbangnya per view, bukan
  // sakelar yang membuka semuanya begitu departemennya IT.
  const h = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_karyawan", "it");
  cek(angkaHasil(h) === 1, "IT tetap tersaring di view karyawan", `dapat ${angkaHasil(h)}`);
}
{
  // IT bukan marketing: view marketing tetap tertutup.
  for (const v of ["v_asisten_penjualan", "v_asisten_klaim"]) {
    const h = await jalan(orang.id, `SELECT COUNT(*) FROM ${v}`, "it");
    cek(h.includes("DITOLAK"), `IT DITOLAK membaca ${v}`);
  }
}
{
  // Dan sebaliknya: marketing tidak ikut mendapat tiket selevel tim.
  const mk = await jalan(orang.id, "SELECT COUNT(*) AS n FROM v_asisten_tiket", "marketing");
  cek(angkaHasil(mk) === orang.n, "marketing TETAP tersaring di tiket", `dapat ${angkaHasil(mk)}`);
}


console.log("--- query yang sah tetap jalan ---");
{
  const h = await jalan(orang.id,
    "SELECT status, COUNT(*) AS jumlah FROM v_asisten_tiket GROUP BY status ORDER BY jumlah DESC");
  cek(!h.includes("DITOLAK") && !h.includes("ERROR"), "agregasi GROUP BY jalan");
  cek(h.includes("SQL dijalankan"), "SQL yang dijalankan ikut dilaporkan");
}
{
  // Model boleh menulis WITH sendiri; CTE penyaring harus digabung, bukan
  // membuat dua klausa WITH yang tidak sah.
  const h = await jalan(orang.id,
    "WITH x AS (SELECT status FROM v_asisten_tiket) SELECT COUNT(*) AS n FROM x");
  cek(!h.includes("ERROR"), "query yang diawali WITH tetap jalan", h.includes("ERROR") ? h.slice(0, 80) : "");
}

console.log();
for (const n of lolos) console.log(`  LOLOS  ${n}`);
for (const n of gagal) console.log(`  GAGAL  ${n}`);
console.log(`\n${lolos.length} lolos, ${gagal.length} gagal`);
await pg.end();
process.exit(gagal.length === 0 ? 0 : 1);
