/**
 * Uji penjalan tulis UMUM — mesin yang membuat tool tulis bisa lahir dari
 * layar Kelola AI tanpa kode baru.
 *
 *   npm run test:tulis-umum
 *
 * ⚠️ Memakai satu tiket uji yang dibuat dan dihapus di `finally`.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. tool tulis dirakit dari baris konfigurasi, TANPA entri di registry;
 *   2. tabel di luar daftar-boleh ditolak — konfigurasi tidak bisa mengarahkan
 *      penulisan ke `employee` atau `users`;
 *   3. operasi ubah/hapus TANPA kunci ditolak — itu UPDATE tanpa WHERE;
 *   4. penyaring pemilik SELALU ikut, dan tidak ada setelan yang mematikannya;
 *   5. kolom yang role database-nya tidak punya hak ditolak dengan alasan,
 *      bukan gagal belakangan;
 *   6. nilai otomatis TIDAK jadi parameter model — model tidak bisa memilih
 *      status.
 */
import { Client } from "pg";
import {
  bacaKonfigTulis, susunDrafUmum, sidikUmum, jalankanUmum, masalahUmumJadiTeks,
  TABEL_BOLEH,
} from "../lib/entri/tulis-umum.ts";
import { buatToolTulis, tulisDikenal, namaUntukModel } from "../voltagent/registry-tulis.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const adm = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
});
await adm.connect();
const baca = poolPerusahaan();
const NOMOR = `T${new Date().toISOString().slice(0, 10).replace(/-/g, "")}0009`;

const { rows: kar } = await baca.query<{ id_employee: string }>(
  `SELECT id_employee FROM employee WHERE is_active = true LIMIT 2`);
const [pemilik, lain] = kar;

try {
  const { rows: kat } = await baca.query<{ id_category: string; id_sub_category: string }>(
    `SELECT c.id_category, s.id_sub_category FROM category c
       JOIN sub_category s ON s.id_category = c.id_category
      WHERE c.category_type = 'ticket' LIMIT 1`);
  await adm.query(
    `INSERT INTO portal_ticket (no_ticket, id_employee, id_category, id_sub_category, subject, description, priority)
     VALUES ($1,$2,$3,$4,'[UJI OTOMATIS] penjalan umum','Dibuat skrip pengujian.','NORMAL')`,
    [NOMOR, pemilik.id_employee, kat[0].id_category, kat[0].id_sub_category]);

  lupakanKonfig();
  const k = await muatKonfig();
  const batal = [...k.agent.flatMap((a) => a.tool), ...k.lepas].find((t) => t.kode === "batalkan_tiket")!;

  // ============================================================
  console.log("=== 1. Dirakit TANPA kode khusus ===");
  // ============================================================
  cek("batalkan_tiket TIDAK punya penjalan khusus", !tulisDikenal().includes("batalkan_tiket"),
    `yang khusus: ${tulisDikenal().join(", ")}`);
  const sesi = { idEmployee: pemilik.id_employee, idUsers: null, idDepartment: null, idCompany: null, departemen: null };
  const alat = buatToolTulis(batal, sesi);
  cek("tetap terakit lewat penjalan umum", Boolean(alat));
  cek("namanya siapkan_batalkan_tiket", alat?.name === "siapkan_batalkan_tiket", alat?.name ?? "-");
  cek("namaUntukModel setuju dengan nama tool aslinya", namaUntukModel(batal) === alat?.name);

  const param = Object.keys((alat as unknown as { parameters?: { shape?: object } })?.parameters?.shape ?? {});
  cek("parameter model cuma kuncinya", param.join(",") === "no_ticket", param.join(","));
  // ⚠️ `status` datang dari konfigurasi, bukan dari model. Kalau ia jadi
  // parameter, model bisa memilih RESOLVED alih-alih CANCELLED.
  cek("status BUKAN parameter model", !param.includes("status"));

  // ============================================================
  console.log("\n=== 2. Konfigurasi yang berbahaya ditolak ===");
  // ============================================================
  const dasar = {
    kode: "uji", operasi: "ubah", tabelTarget: "portal_ticket",
    isian: [], otomatis: [], kunci: [{ kolom: "no_ticket" }], syarat: [],
  };
  cek("tabel di luar daftar-boleh ditolak",
    !bacaKonfigTulis({ ...dasar, tabelTarget: "employee" }).ok);
  cek("tabel karangan ditolak",
    !bacaKonfigTulis({ ...dasar, tabelTarget: "users; DROP TABLE x" }).ok);
  cek("ubah tanpa kunci ditolak — itu UPDATE tanpa WHERE",
    !bacaKonfigTulis({ ...dasar, kunci: [] }).ok);
  cek("tabel_target kosong ditolak", !bacaKonfigTulis({ ...dasar, tabelTarget: null }).ok);
  cek("daftar-boleh memang sempit", Object.keys(TABEL_BOLEH).join(",") === "portal_ticket",
    Object.keys(TABEL_BOLEH).join(","));

  // ============================================================
  console.log("\n=== 3. ⚠️ Penyaring pemilik tidak bisa dimatikan ===");
  // ============================================================
  const konf = bacaKonfigTulis({
    kode: batal.kode, operasi: batal.operasi, tabelTarget: batal.tabelTarget,
    isian: batal.isian, otomatis: batal.otomatis, kunci: batal.kunci, syarat: batal.syarat,
  });
  if (!konf.ok) { cek("konfigurasi batalkan_tiket terbaca", false, konf.sebab); }
  else {
    const curi = await susunDrafUmum(konf.konfig, lain.id_employee, { no_ticket: NOMOR });
    cek("tiket orang lain ditolak", !curi.ok, curi.ok ? "MALAH DISUSUN" : curi.masalah[0].jenis);

    const r = await susunDrafUmum(konf.konfig, pemilik.id_employee, { no_ticket: NOMOR });
    cek("tiket sendiri bisa", r.ok, r.ok ? "" : masalahUmumJadiTeks(r.masalah));
    if (r.ok) {
      cek("perubahannya status OPEN -> CANCELLED",
        r.draf.perubahan.length === 1 && r.draf.perubahan[0].dari === "OPEN" && r.draf.perubahan[0].jadi === "CANCELLED",
        r.draf.perubahan.map((p) => `${p.kolom}:${p.dari}->${p.jadi}`).join(", "));

      // ============================================================
      console.log("\n=== 3b. Keterangan baris ikut ke kartu ===");
      // ============================================================
      // ⚠️ DIMINTA TIM IT 13 Okt 2026 sesudah melihat kartunya yang pertama:
      // kartu itu menyuruh orang membatalkan sesuatu tanpa memberi tahu
      // sesuatu itu apa — cuma nomor tiket, nama tabel, dan OPEN -> CANCELLED.
      const ket = new Map(r.draf.keterangan.map((x) => [x.kolom, x.nilai]));
      cek("judul tiketnya ikut", ket.get("subject") === "[UJI OTOMATIS] penjalan umum",
        ket.get("subject") ?? "TIDAK ADA");
      cek("keterangannya ikut", ket.get("description") === "Dibuat skrip pengujian.",
        ket.get("description") ?? "TIDAK ADA");

      // ⚠️ KOLOM YANG SUDAH TAMPIL SEBAGAI PERUBAHAN TIDAK DIULANG. Tanpa ini
      // kartunya menampilkan "Status sekarang: OPEN" tepat di atas "Status
      // baru: OPEN -> CANCELLED" — dua baris untuk satu hal, dan pembaca harus
      // memastikan sendiri keduanya tidak bertentangan.
      cek("kolom yang sedang diubah tidak diulang di keterangan",
        !ket.has("status") && r.draf.perubahan.some((p) => p.kolom === "status"),
        [...ket.keys()].join(", "));

      // Waktu dipendekkan sampai menit: `2026-10-08 11:22:30.551121` tidak
      // membantu siapa pun memutuskan, dan panjangnya mendorong kolom lain
      // keluar layar di ponsel.
      cek("waktu dipendekkan sampai menit",
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ket.get("created_at") ?? ""),
        ket.get("created_at") ?? "TIDAK ADA");

      // ⚠️ KETERANGAN TIDAK MENGUBAH SIDIK, dan ini yang paling penting di
      // blok ini. Sidik ada untuk menangkap baris yang berubah DI TENGAH
      // antara menyusun rancangan dan menyimpannya. Kalau judul tiket ikut
      // disidik, satu suntingan tak berbahaya dari orang lain akan menolak
      // pembatalan yang sah — dan gejalanya "coba lagi" tanpa sebab yang
      // kelihatan.
      {
        const tanpaKet = { ...r.draf, keterangan: [] };
        const beda = { ...r.draf, keterangan: [{ kolom: "subject", label: "Judul", nilai: "judul lain" }] };
        cek("sidik tidak berubah walau keterangannya berbeda",
          sidikUmum(tanpaKet) === sidikUmum(r.draf) && sidikUmum(beda) === sidikUmum(r.draf),
          sidikUmum(r.draf));
      }

      // ⚠️ DAN KOLOM KETERANGAN TIDAK IKUT DITULIS. Ia ditambahkan ke daftar
      // kolom yang DIBACA; kalau suatu hari ikut ke SET, pembatalan tiket akan
      // menimpa judul dan deskripsinya dengan nilai yang kebetulan terbaca.
      cek("keterangan tidak jadi perubahan",
        r.draf.perubahan.every((p) => !["subject", "description", "created_at"].includes(p.kolom)),
        r.draf.perubahan.map((p) => p.kolom).join(", "));

      // ============================================================
      console.log("\n=== 4. Dijalankan, dan WHERE-nya menjaga ===");
      // ============================================================
      const salahSidik = await jalankanUmum(konf.konfig, pemilik.id_employee, { no_ticket: NOMOR }, "0000000000000000");
      cek("sidik palsu ditolak", !salahSidik.ok && salahSidik.sebab === "draf-berubah");

      const curiJalan = await jalankanUmum(konf.konfig, lain.id_employee, { no_ticket: NOMOR }, sidikUmum(r.draf));
      cek("orang lain tetap ditolak di tahap menjalankan", !curiJalan.ok);
      const { rows: belum } = await baca.query<{ status: string }>(
        `SELECT status FROM portal_ticket WHERE no_ticket = $1`, [NOMOR]);
      cek("statusnya belum berubah sesudah dua percobaan gagal", belum[0].status === "OPEN", belum[0].status);

      const jadi = await jalankanUmum(konf.konfig, pemilik.id_employee, { no_ticket: NOMOR }, sidikUmum(r.draf));
      cek("pemilik berhasil membatalkan", jadi.ok, jadi.ok ? "" : jadi.pesan);
      const { rows: sesudah } = await baca.query<{ status: string }>(
        `SELECT status FROM portal_ticket WHERE no_ticket = $1`, [NOMOR]);
      cek("status di database jadi CANCELLED", sesudah[0].status === "CANCELLED", sesudah[0].status);

      // Sekali lagi: syaratnya status OPEN, jadi sekarang harus ditolak.
      const ulang = await susunDrafUmum(konf.konfig, pemilik.id_employee, { no_ticket: NOMOR });
      cek("membatalkan dua kali ditolak oleh syarat", !ulang.ok,
        ulang.ok ? "MALAH BISA" : ulang.masalah[0].jenis);
    }
  }
} finally {
  await adm.query(`DELETE FROM portal_ticket WHERE no_ticket = $1`, [NOMOR]);
  const { rows } = await adm.query<{ n: number }>(
    `SELECT count(*)::int n FROM portal_ticket WHERE subject LIKE '[UJI OTOMATIS]%'`);
  cek("tidak ada tiket uji yang tertinggal", rows[0].n === 0, `${rows[0].n} tersisa`);
  await adm.end();
  await baca.end();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
