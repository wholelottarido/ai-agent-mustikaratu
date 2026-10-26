/**
 * Uji operasi `tambah` lewat PENJALAN UMUM.
 *
 *   npm run test:tulis-tambah
 *
 * MENULIS satu baris `portal_ticket` dan menghapusnya lagi di `finally`.
 * Judulnya diawali `[UJI OTOMATIS]` supaya kelihatan kalau ada yang tertinggal.
 *
 * ============================================================
 * KENAPA UJI INI ADA
 * ============================================================
 * Sampai 21 Okt 2026, `tambah` punya jalur sendiri (`tiket.ts` +
 * `simpan-tiket.ts`) — satu-satunya sisa hardcode di jalur tulis. Yang
 * menahannya cuma satu hal: nomor tiket harus dibangkitkan, dan aturannya
 * tidak boleh datang dari setelan.
 *
 * ⚠️ KONFIGURASINYA DISUSUN DI SINI, BUKAN DIBACA DARI DATABASE.
 *
 * Disengaja. Uji yang membaca baris `buat_tiket` milik tim lain akan merah
 * tiap kali mereka mengubahnya — sudah terjadi 13 Okt, waktu 263 dari 280
 * baris lahir dalam sehari. Yang diuji di sini PENJALANNYA, dan setelan
 * dipegang di tangan supaya yang merah berarti penjalannya yang rusak.
 *
 * Bentuk setelannya ditiru dari `buat_tiket` yang sungguhan (kategori
 * bertingkat, prioritas tetap, nomor dibangkitkan) — bukan dikarang, supaya
 * yang lolos di sini memang lolos di keadaan sebenarnya.
 */
import { Client } from "pg";
import {
  bacaKonfigTulis, susunDrafUmum, jalankanUmum, sidikUmum, masalahUmumJadiTeks,
} from "../lib/entri/tulis-umum.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const JUDUL = "[UJI OTOMATIS] tambah lewat penjalan umum";
const baca = poolPerusahaan();

const adm = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER, password: process.env.DEMO_PG_ADMIN_PASSWORD,
});
await adm.connect();

const { rows: kar } = await baca.query<{ id_employee: string }>(
  `SELECT id_employee FROM employee WHERE is_active = true LIMIT 2`);
const [pemilik, lain] = kar;

/** Setelan yang BENAR — ditiru dari `buat_tiket`. */
const dasar = {
  kode: "uji_tambah_tiket",
  operasi: "tambah",
  tabelTarget: "portal_ticket",
  kunci: [],
  syarat: [],
  isian: [
    {
      kolom: "id_category", label: "Kategori", wajib: true,
      pilihan: {
        jenis: "relasi", tabel: "category",
        kolom_nilai: "id_category", kolom_label: "category_name",
        saring_tetap: [{ kolom: "category_type", nilai: "ticket" }],
      },
    },
    {
      kolom: "id_sub_category", label: "Sub-kategori", wajib: true,
      pilihan: {
        jenis: "relasi", tabel: "sub_category",
        kolom_nilai: "id_sub_category", kolom_label: "sub_category_name",
        induk: { isian: "id_category", kolom_relasi: "id_category" },
      },
    },
    { kolom: "subject", label: "Judul", wajib: true, maks: 150 },
    { kolom: "description", label: "Deskripsi", wajib: true, maks: 4000 },
    {
      kolom: "priority", label: "Prioritas", wajib: false, bawaan: "Normal",
      pilihan: {
        jenis: "tetap",
        opsi: [
          { nilai: "LOW", label: "Rendah" },
          { nilai: "NORMAL", label: "Normal" },
          { nilai: "URGENT", label: "Mendesak" },
        ],
      },
    },
  ],
  otomatis: [
    { kolom: "no_ticket", label: "Nomor tiket", sumber: "bangkit", pembangkit: "nomor_tiket" },
  ],
};

try {
  // ============================================================
  console.log("=== 1. Setelan yang keliru ditolak SEBELUM dirakit ===");
  // ============================================================
  // Yang ditolak di sini sampai ke administrator sebagai alasan di layar.
  // Yang lolos lalu gagal saat dipakai cuma sampai ke PEMAKAI, sebagai galat
  // yang tidak menunjuk sebabnya.
  const buruk: [string, Record<string, unknown>][] = [
    ["tanpa isian", { isian: [] }],
    ["tabel pilihan di luar daftar-boleh", {
      isian: [{ ...dasar.isian[0], pilihan: { ...dasar.isian[0].pilihan, tabel: "employee" } }],
    }],
    ["kolom pilihan di luar daftar-boleh", {
      isian: [{ ...dasar.isian[0], pilihan: { ...dasar.isian[0].pilihan, kolom_label: "created_at" } }],
    }],
    ["induk yang bukan isian mana pun", {
      isian: [{ ...dasar.isian[1], pilihan: { ...dasar.isian[1].pilihan, induk: { isian: "ngawur", kolom_relasi: "id_category" } } }],
    }],
    // ⚠️ Urutan setelan ITULAH urutan pengisiannya. Induk yang disebut
    // belakangan tidak akan pernah terisi waktu anaknya butuh — dan daftar
    // pilihan yang disusun TANPA saringan induk justru yang berbahaya:
    // sub-kategori milik kategori lain ikut lolos.
    ["induk disebut sesudah anaknya", { isian: [dasar.isian[1], dasar.isian[0]] }],
    ["pembangkit tidak dikenal", {
      otomatis: [{ kolom: "no_ticket", label: "No", sumber: "bangkit", pembangkit: "karangan" }],
    }],
  ];
  for (const [nama, ubah] of buruk) {
    const r = bacaKonfigTulis({ ...dasar, ...ubah } as never);
    cek(`${nama} ditolak`, !r.ok, r.ok ? "MALAH DITERIMA" : r.sebab.slice(0, 62));
  }

  const konf = bacaKonfigTulis(dasar as never);
  cek("setelan yang benar diterima", konf.ok, konf.ok ? "" : konf.sebab);
  if (!konf.ok) throw new Error("setelan dasar ditolak: " + konf.sebab);
  const k = konf.konfig;

  // ============================================================
  console.log("\n=== 2. Rancangan: yang kurang & yang tidak dikenal ===");
  // ============================================================
  const { rows: kat } = await baca.query<{ id_category: string; category_name: string }>(
    `SELECT id_category, category_name FROM category WHERE category_type = 'ticket' ORDER BY category_name LIMIT 2`);
  const { rows: sub } = await baca.query<{ sub_category_name: string }>(
    `SELECT sub_category_name FROM sub_category WHERE id_category = $1 ORDER BY sub_category_name LIMIT 1`,
    [kat[0].id_category]);
  console.log(`  kategori uji: ${kat[0].category_name} / ${sub[0].sub_category_name}`);

  const lengkap = {
    id_category: kat[0].category_name,
    id_sub_category: sub[0].sub_category_name,
    subject: JUDUL,
    description: "Dibuat skrip pengujian penjalan umum.",
  };

  {
    const r = await susunDrafUmum(k, pemilik.id_employee, { ...lengkap, subject: "" });
    cek("isian wajib yang kosong ditolak", !r.ok,
      r.ok ? "MALAH DISUSUN" : masalahUmumJadiTeks(r.masalah).slice(0, 50));
  }
  {
    const r = await susunDrafUmum(k, pemilik.id_employee, { ...lengkap, id_category: "kategori karangan" });
    const daftar = !r.ok && r.masalah[0].jenis === "tidak-dikenal" ? r.masalah[0].pilihan.length : 0;
    // ⚠️ DAFTAR PILIHANNYA IKUT, bukan cuma penolakan. Model yang ditolak
    // tanpa daftar akan menebak lagi dengan kata yang sedikit berbeda, dan
    // tebakan kedua tidak lebih baik dari yang pertama.
    cek("kategori karangan ditolak DENGAN daftar pilihannya", !r.ok && daftar > 0, `${daftar} pilihan ditawarkan`);
  }
  {
    // ⚠️ INTI PILIHAN BERTINGKAT. Sub-kategori milik kategori LAIN harus
    // ditolak — kalau tidak, tiket masuk ke antrean yang salah dan dikerjakan
    // orang yang salah, tanpa satu pun galat.
    const { rows: subLain } = await baca.query<{ sub_category_name: string }>(
      `SELECT sub_category_name FROM sub_category WHERE id_category = $1 LIMIT 1`, [kat[1].id_category]);
    if (subLain.length > 0) {
      const r = await susunDrafUmum(k, pemilik.id_employee,
        { ...lengkap, id_sub_category: subLain[0].sub_category_name });
      cek("sub-kategori milik kategori lain ditolak", !r.ok,
        r.ok ? "MALAH LOLOS" : (r.masalah[0] as { jenis: string }).jenis);
    } else {
      console.log("  (lewat: kategori kedua tidak punya sub-kategori)");
    }
  }
  {
    const r = await susunDrafUmum(k, pemilik.id_employee, { ...lengkap, subject: "x".repeat(200) });
    cek("judul kepanjangan ditolak", !r.ok && r.masalah[0].jenis === "kepanjangan");
  }

  // ============================================================
  console.log("\n=== 3. Rancangan yang sah ===");
  // ============================================================
  const h = await susunDrafUmum(k, pemilik.id_employee, lengkap);
  cek("rancangan tersusun", h.ok, h.ok ? "" : masalahUmumJadiTeks(h.masalah));
  if (!h.ok) throw new Error("rancangan gagal: " + masalahUmumJadiTeks(h.masalah));
  const draf = h.draf;
  const isi = new Map(draf.perubahan.map((p) => [p.kolom, p.jadi]));

  cek("judul kartunya judul tiketnya", draf.judulBaris === JUDUL, draf.judulBaris);
  cek("kunci kosong — barisnya belum ada", Object.keys(draf.kunci).length === 0);
  cek("tidak ada nilai lama", draf.perubahan.every((p) => p.dari === ""));

  // ⚠️ PENJAGAAN YANG TIDAK BISA DIMATIKAN SETELAN.
  cek("kolom pemilik diisi dari SESI", isi.get("id_employee") === pemilik.id_employee);
  cek("kolom pemilik bukan dari masukan",
    (await susunDrafUmum(k, pemilik.id_employee, { ...lengkap, id_employee: lain.id_employee }))
      .ok && isi.get("id_employee") === pemilik.id_employee);

  cek("prioritas memakai bawaan waktu tidak disebut", isi.get("priority") === "NORMAL", isi.get("priority"));
  cek("kategori jadi UUID, bukan namanya", isi.get("id_category") === kat[0].id_category);

  // ⚠️ Nomor BELUM ada di rancangan, dan itu disengaja: menghitungnya sekarang
  // membuat dua orang yang membuka kartu bersamaan melihat nomor yang sama.
  cek("nomor tiket TIDAK ada di rancangan", !isi.has("no_ticket"));
  cek("nomor tiket disebut sebagai dibangkitkan",
    draf.dibangkitkan.some((d) => d.kolom === "no_ticket"),
    draf.dibangkitkan.map((d) => d.kolom).join(", ") || "(kosong)");

  // ============================================================
  console.log("\n=== 4. Disimpan, dan hasilnya diperiksa di database ===");
  // ============================================================
  const salah = await jalankanUmum(k, pemilik.id_employee, lengkap, "0000000000000000");
  cek("sidik palsu ditolak", !salah.ok && salah.sebab === "draf-berubah");
  const { rows: belum } = await baca.query<{ n: number }>(
    `SELECT count(*)::int n FROM portal_ticket WHERE subject = $1`, [JUDUL]);
  cek("belum ada baris sesudah percobaan gagal", belum[0].n === 0, `${belum[0].n} baris`);

  const jadi = await jalankanUmum(k, pemilik.id_employee, lengkap, sidikUmum(draf));
  cek("tersimpan", jadi.ok, jadi.ok ? "" : jadi.pesan);

  const { rows: baris } = await baca.query<{
    no_ticket: string; id_employee: string; id_category: string;
    id_sub_category: string; priority: string; status: string; description: string;
  }>(`SELECT no_ticket, id_employee, id_category, id_sub_category, priority, status, description
        FROM portal_ticket WHERE subject = $1`, [JUDUL]);
  cek("tepat SATU baris lahir", baris.length === 1, `${baris.length} baris`);
  if (baris.length === 1) {
    const b = baris[0];
    cek("pemiliknya benar", b.id_employee === pemilik.id_employee);
    cek("kategorinya benar", b.id_category === kat[0].id_category);
    // ⚠️ 13 huruf: `T` + 8 tanggal + 4 urut. Nomor 14 huruf pernah lahir
    // sungguhan (8 Okt 2026) karena penghitungnya disangka naik terus.
    cek("nomor tiket berbentuk benar", /^T\d{12}$/.test(b.no_ticket), b.no_ticket);
    cek("status memakai bawaan database", Boolean(b.status), b.status);
  }

  // ============================================================
  console.log("\n=== 5. Penyaring pemilik, dari sisi yang satunya ===");
  // ============================================================
  // ⚠️ Pada `ubah`, kolom pemilik jadi penyaring WHERE. Pada `tambah` ia jadi
  // nilai yang DITULIS. Arah berbeda, tujuan sama — dan yang diuji di sini
  // arah yang baru.
  const h2 = await susunDrafUmum(k, lain.id_employee, lengkap);
  cek("orang lain membuat baris atas namanya SENDIRI",
    h2.ok && h2.draf.perubahan.find((p) => p.kolom === "id_employee")?.jadi === lain.id_employee);

  const kosong = await susunDrafUmum(k, null, lengkap);
  cek("sesi tanpa karyawan ditolak", !kosong.ok);
} finally {
  const { rowCount } = await adm.query(`DELETE FROM portal_ticket WHERE subject LIKE '[UJI OTOMATIS]%'`);
  const { rows } = await adm.query<{ n: number }>(
    `SELECT count(*)::int n FROM portal_ticket WHERE subject LIKE '[UJI OTOMATIS]%'`);
  cek("tidak ada tiket uji yang tertinggal", rows[0].n === 0, `${rowCount ?? 0} dihapus`);
  await adm.end();
  await baca.end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.exit(gagal === 0 ? 0 : 1);
}
