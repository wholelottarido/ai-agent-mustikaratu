/**
 * Uji penyusunan rancangan tiket helpdesk.
 *
 *   npm run test:tiket
 *
 * ⚠️ TIDAK MENULIS SATU BARIS PUN ke `portal_ticket`. Berkas yang diuji di
 * sini memang tidak punya kemampuan itu — penyimpanan ada di modul terpisah.
 * Jumlah baris dihitung sebelum dan sesudah untuk membuktikannya, bukan untuk
 * meyakinkan.
 *
 * ============================================================
 * YANG DIBUKTIKAN
 * ============================================================
 *   1. rancangan tersusun dari kategori & sub-kategori SUNGGUHAN;
 *   2. sub-kategori milik kategori LAIN ditolak — ini penjagaan terpenting di
 *      sini, karena `portal_ticket` punya nol foreign key dan database akan
 *      menerimanya tanpa protes, lalu tiketnya masuk ke antrean yang salah;
 *   3. kolom wajib yang kosong dan teks yang kepanjangan ditolak SEBELUM
 *      menyentuh database;
 *   4. `id_employee` diambil dari sesi, tidak bisa dikirim dari permintaan;
 *   5. sidik rancangan berubah begitu isinya berubah — itu yang membuat
 *      "yang disimpan = yang dilihat" bisa ditegakkan.
 */
import {
  susunDraf, sidikDraf, konfigTiket, drafJadiTeks, masalahJadiTeks,
  type Permintaan,
} from "../lib/entri/tiket.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { buatToolTulis } from "../voltagent/registry-tulis.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const p = poolPerusahaan();
const sebelum = ((await p.query<{ n: number }>(`SELECT count(*)::int n FROM portal_ticket`)).rows[0]).n;
console.log(`portal_ticket sebelum: ${sebelum} baris\n`);

// Karyawan sungguhan, dipakai sebagai pelapor.
const [kar] = (await p.query<{ id_employee: string; fullname: string }>(
  `SELECT id_employee, fullname FROM employee WHERE is_active = true LIMIT 1`)).rows;

// ============================================================
console.log("=== 1. Konfigurasi terbaca ===");
// ============================================================
const k = await konfigTiket();
cek("konfigurasi buat_tiket ada", Boolean(k));
cek("menulis ke portal_ticket", k?.tabelTarget === "portal_ticket", k?.tabelTarget ?? "-");
cek("punya kolom isian", (k?.isian.length ?? 0) >= 5, `${k?.isian.length} kolom`);
cek("id_employee BUKAN kolom isian — datang dari sesi",
  !k?.isian.some((i) => i.kolom === "id_employee"));

const dasar: Permintaan = {
  kategori: "HARDWARE",
  subKategori: "PRINTER",
  judul: "Printer lantai 2 tidak bisa mencetak",
  deskripsi: "Printer di ruang saya menyala tapi dokumen tidak keluar sejak pagi.",
};

// ============================================================
console.log("\n=== 2. Rancangan yang sah ===");
// ============================================================
const r = await susunDraf(kar.id_employee, dasar);
cek("rancangan tersusun", r.ok, r.ok ? "" : masalahJadiTeks(r.masalah));
if (r.ok) {
  cek("kategori terpetakan ke id sungguhan", /^[0-9a-f-]{36}$/.test(r.draf.kategori.id), r.draf.kategori.nama);
  cek("sub-kategori terpetakan", /^[0-9a-f-]{36}$/.test(r.draf.subKategori.id), r.draf.subKategori.nama);
  cek("pelapor diambil dari sesi", r.draf.idEmployee === kar.id_employee, kar.fullname);
  cek("prioritas memakai nilai bawaan", r.draf.prioritas.nilai === "NORMAL", r.draf.prioritas.nilai);

  // Sub-kategori harus benar-benar milik kategori itu di database.
  const { rows: cocok } = await p.query<{ n: number }>(
    `SELECT count(*)::int n FROM sub_category WHERE id_sub_category = $1 AND id_category = $2`,
    [r.draf.subKategori.id, r.draf.kategori.id]);
  cek("sub-kategori benar milik kategorinya di database", cocok[0].n === 1);
  console.log(`\n${drafJadiTeks(r.draf)}\n`);
}

// ============================================================
console.log("=== 3. ⚠️ Sub-kategori dari kategori LAIN ditolak ===");
// ============================================================
// LAPTOP ada di HARDWARE, tidak di NETWORK. Tanpa penjagaan ini, tiketnya
// tersimpan dengan pasangan yang mustahil — dan database tidak akan mengeluh.
const silang = await susunDraf(kar.id_employee, { ...dasar, kategori: "NETWORK", subKategori: "LAPTOP" });
cek("pasangan kategori/sub yang mustahil ditolak", !silang.ok,
  silang.ok ? "MALAH DITERIMA" : silang.masalah[0].jenis);

// ============================================================
console.log("\n=== 4. Masukan tidak sah ditolak sebelum menyentuh database ===");
// ============================================================
const buruk: [string, Permintaan][] = [
  ["judul kosong", { ...dasar, judul: "" }],
  ["deskripsi kosong", { ...dasar, deskripsi: "" }],
  ["kategori kosong", { ...dasar, kategori: "" }],
  ["kategori karangan", { ...dasar, kategori: "ZZZ TIDAK ADA" }],
  ["judul kepanjangan", { ...dasar, judul: "x".repeat(200) }],
  ["deskripsi kepanjangan", { ...dasar, deskripsi: "x".repeat(5000) }],
  ["prioritas karangan", { ...dasar, prioritas: "SANGAT MENDESAK SEKALI" }],
];
for (const [nama, minta] of buruk) {
  const h = await susunDraf(kar.id_employee, minta);
  cek(`${nama} ditolak`, !h.ok, h.ok ? "MALAH DITERIMA" : masalahJadiTeks(h.masalah).slice(0, 56));
}

const tanpaSesi = await susunDraf(null, dasar);
cek("tanpa identitas karyawan ditolak", !tanpaSesi.ok);

// ============================================================
console.log("\n=== 5. Prioritas: nilai mentah maupun labelnya diterima ===");
// ============================================================
for (const [diberi, harus] of [["URGENT", "URGENT"], ["Mendesak", "URGENT"], ["rendah", "LOW"]]) {
  const h = await susunDraf(kar.id_employee, { ...dasar, prioritas: diberi });
  cek(`"${diberi}" -> ${harus}`, h.ok && h.draf.prioritas.nilai === harus,
    h.ok ? h.draf.prioritas.nilai : "ditolak");
}

// ⚠️ KASUS YANG MENENTUKAN BENTUK PENCOCOKAN. Kalimat ini memuat kata
// "mendesak", jadi pencocokan dua arah akan memetakannya ke URGENT — justru
// kebalikan maksudnya, dan tanpa satu pun pesan galat. Harus ditolak, bukan
// ditebak.
const negasi = await susunDraf(kar.id_employee, { ...dasar, prioritas: "tidak mendesak" });
cek('"tidak mendesak" TIDAK dipetakan ke URGENT', !negasi.ok || negasi.draf.prioritas.nilai !== "URGENT",
  negasi.ok ? `jadi ${negasi.draf.prioritas.nilai}` : "ditolak, pilihan ditawarkan");

// ============================================================
console.log("\n=== 6. Sidik menangkap perubahan isi ===");
// ============================================================
if (r.ok) {
  const sama = await susunDraf(kar.id_employee, dasar);
  cek("rancangan sama -> sidik sama", sama.ok && sidikDraf(sama.draf) === sidikDraf(r.draf));
  const beda = await susunDraf(kar.id_employee, { ...dasar, judul: "Printer lantai 3 rusak" });
  cek("judul berbeda -> sidik berbeda", beda.ok && sidikDraf(beda.draf) !== sidikDraf(r.draf));
  const bedaPri = await susunDraf(kar.id_employee, { ...dasar, prioritas: "URGENT" });
  cek("prioritas berbeda -> sidik berbeda", bedaPri.ok && sidikDraf(bedaPri.draf) !== sidikDraf(r.draf));
}

// ============================================================
console.log("\n=== 7. Tool yang dipegang model ===");
// ============================================================
// ⚠️ Dibangun LANGSUNG, tanpa `muatKonfig()`, supaya jalur ini bisa diuji
// walau MySQL portal mati — dan supaya yang diperiksa benar-benar tool yang
// sampai ke model, bukan tiruan.
const alat = buatToolTulis(
  { kode: "buat_tiket", operasi: "tambah" } as unknown as Parameters<typeof buatToolTulis>[0],
  { idEmployee: kar.id_employee, idUsers: null, idDepartment: null, idCompany: null, departemen: null },
);
cek("tool buat_tiket terakit", Boolean(alat));
cek("nama yang sampai ke model `siapkan_tiket`, bukan `buat_tiket`",
  alat?.name === "siapkan_tiket", alat?.name ?? "-");
cek("deskripsinya menyatakan TIDAK menyimpan",
  (alat?.description ?? "").includes("TIDAK MENYIMPAN"));

const keluar = (await alat!.execute!({
  kategori: "HARDWARE", sub_kategori: "PRINTER",
  judul: "Printer lantai 2 tidak bisa mencetak",
  deskripsi: "Menyala tapi dokumen tidak keluar sejak pagi.",
})) as any;
cek("hasilnya rancangan, berstatus siap", keluar.status === "siap", keluar.status);
cek("membawa sidik", typeof keluar.sidik === "string" && keluar.sidik.length === 16);
cek("membawa permintaan asli untuk dikirim ulang kartu", Boolean(keluar.permintaan?.kategori));
cek("hasilnya menyebut BELUM TERSIMPAN", String(keluar.catatan ?? "").includes("BELUM TERSIMPAN"));
cek("tidak memulangkan nomor tiket", !("noTicket" in keluar) && !("no_ticket" in keluar));

const buruk2 = (await alat!.execute!({
  kategori: "NETWORK", sub_kategori: "LAPTOP", judul: "x", deskripsi: "y",
})) as any;
cek("pasangan mustahil -> perlu-perbaikan, bukan rancangan",
  buruk2.status === "perlu-perbaikan", buruk2.status);
cek("menawarkan pilihan, bukan cuma menolak", Array.isArray(buruk2.masalah) && buruk2.masalah.length > 0);

// ============================================================
console.log("\n=== 8. Tidak ada yang tertulis ===");
// ============================================================
const sesudah = ((await p.query<{ n: number }>(`SELECT count(*)::int n FROM portal_ticket`)).rows[0]).n;
cek("jumlah tiket tidak berubah", sesudah === sebelum, `${sebelum} -> ${sesudah}`);

await p.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
