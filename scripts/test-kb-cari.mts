/**
 * Adu cara mencari di basis pengetahuan: VEKTOR vs TRIGRAM.
 *
 *   npm run test:kb
 *
 * PRASYARAT: `npm run pasang:kb` sudah dijalankan.
 *
 * ⚠️ KENAPA TES INI ADA.
 *
 * Untuk judul tiket pendek, `pg_trgm` terbukti MENGALAHKAN vektor (5/6 vs
 * 2/10, dan tanpa persiapan apa pun). Itu membatalkan rencana memakai vektor
 * untuk tiket. Pertanyaan yang belum terjawab: apakah hasilnya tetap begitu
 * untuk DOKUMEN PANJANG, di mana pertanyaan dan jawabannya sering tidak
 * berbagi satu kata pun.
 *
 * Pertanyaan uji di bawah SENGAJA memakai kata yang berbeda dari isi
 * dokumennya ("resign" vs "mengakhiri hubungan kerja", "bergaris" vs "garis,
 * warna pudar"). Memakai kata yang sama akan menguntungkan trigram dan
 * membuat perbandingannya tidak berarti.
 */
import { Client } from "pg";
import { embed, awalanQuery } from "../voltagent/embedding.ts";

// ============================================================
// ⚠️ KORPUSNYA SUDAH TIDAK ADA — SKRIP INI TIDAK BISA JALAN LAGI.
// ============================================================
// Tabel `ai_kb_dokumen` dan `ai_kb_potongan` DIHAPUS pihak lain, dan
// digantikan korpus `ai_knowledge` berisi panduan aplikasi perusahaan yang
// sungguhan. Ground truth lamanya -- kode seperti `SOP-IT-005` -- tidak ada
// lagi, jadi ujinya DITULIS ULANG di `scripts/test-kb-beda-kata.mts`
// (`npm run test:kb-beda`), bukan ditambal.
//
// Berkas ini ditahan karena mencatat percobaannya: vektor vs trigram untuk
// dokumen panjang. Hasilnya sudah diputuskan dan dipakai -- `cari_sop`
// memakai vektor.
//
// ⚠️ Berhenti di sini DENGAN KETERANGAN, bukan menabrak galat SQL.
// Sebelumnya ia gagal dengan `relation "ai_kb_potongan" does not exist`, yang
// terbaca seperti database rusak alih-alih skrip yang usang. Dan karena
// skrip ini tidak ikut daftar suite harian, kerusakannya lolos berbulan-bulan.
const { Client: Periksa } = await import("pg");
const periksa = new Periksa({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER,
  password: process.env.DEMO_PG_PASSWORD,
});
await periksa.connect();
const { rows: adaTabel } = await periksa.query<{ ada: boolean }>(
  "SELECT to_regclass('public.ai_kb_potongan') IS NOT NULL AS ada",
);
await periksa.end();
if (!adaTabel[0].ada) {
  console.log("Korpus `ai_kb_*` sudah tidak ada -- skrip ini usang.");
  console.log("Penggantinya: npm run test:kb-beda  (scripts/test-kb-beda-kata.mts)");
  process.exit(0);
}


type Uji = { tanya: string; harap: string };

const UJI: Uji[] = [
  { tanya: "berapa lama proses pembuatan alamat surel karyawan", harap: "SOP-IT-001" },
  { tanya: "karyawan resign, akunnya diapakan", harap: "SOP-IT-002" },
  { tanya: "mau pinjam proyektor buat presentasi besok", harap: "SOP-IT-004" },
  { tanya: "hasil cetakan bergaris dan warnanya pudar", harap: "SOP-IT-005" },
  { tanya: "wifi satu lantai mati semua", harap: "SOP-IT-006" },
  { tanya: "akun navision terkunci gara-gara salah sandi", harap: "SOP-IT-007" },
  { tanya: "barang belum terdaftar di sistem, bagaimana", harap: "SOP-IT-008" },
  { tanya: "berkas kehapus kemarin masih bisa diambil lagi", harap: "SOP-IT-014" },
  { tanya: "cara menolak pekerjaan tim lapangan di supertools", harap: "SOP-ST-001" },
  { tanya: "pengajuan penggantian biaya promosi ditolak", harap: "SOP-MAPS-001" },
  { tanya: "mau libur minggu depan, ajukan ke siapa", harap: "SOP-HR-001" },
  { tanya: "komputer sama sekali tidak menyala", harap: "SOP-IT-011" },
];

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_USER,
  password: process.env.DEMO_PG_PASSWORD,
  statement_timeout: 120_000,
});
await c.connect();

const n = await c.query(
  "SELECT COUNT(*)::int x FROM ai_kb_potongan p JOIN ai_kb_dokumen d USING (id_dokumen) WHERE d.sumber='contoh-uji'",
);
console.log(`korpus: ${n.rows[0].x} potongan dari 24 dokumen\n`);

/** Dokumen teratas menurut potongan paling mirip. */
async function cariVektor(tanya: string, batas = 3): Promise<{ kode: string; skor: number }[]> {
  const [v] = await embed([awalanQuery(tanya)]);
  const r = await c.query(
    `SELECT d.kode, MIN(p.vektor <=> $1::vector) AS jarak
       FROM ai_kb_potongan p JOIN ai_kb_dokumen d USING (id_dokumen)
      WHERE d.sumber = 'contoh-uji'
      GROUP BY d.kode ORDER BY jarak LIMIT $2`,
    [`[${v.join(",")}]`, batas],
  );
  return (r.rows as { kode: string; jarak: string }[]).map((x) => ({
    kode: x.kode,
    skor: 1 - Number(x.jarak),
  }));
}

/**
 * `word_similarity`, bukan `similarity`.
 *
 * `similarity` membandingkan DUA TEKS UTUH; pertanyaan 40 huruf melawan
 * potongan 366 huruf selalu dapat skor rendah. `word_similarity` mencari
 * potongan pertanyaan DI DALAM teks panjang -- itu perbandingan yang adil.
 */
async function cariTrigram(tanya: string, batas = 3): Promise<{ kode: string; skor: number }[]> {
  const r = await c.query(
    `SELECT d.kode, MAX(word_similarity($1, LOWER(p.teks))) AS skor
       FROM ai_kb_potongan p JOIN ai_kb_dokumen d USING (id_dokumen)
      WHERE d.sumber = 'contoh-uji'
      GROUP BY d.kode ORDER BY skor DESC LIMIT $2`,
    [tanya.toLowerCase(), batas],
  );
  return (r.rows as { kode: string; skor: string }[]).map((x) => ({
    kode: x.kode,
    skor: Number(x.skor),
  }));
}

let kenaV1 = 0, kenaV3 = 0, kenaT1 = 0, kenaT3 = 0;
const tV: number[] = [], tT: number[] = [];

for (const u of UJI) {
  const a = Date.now(); const v = await cariVektor(u.tanya); tV.push(Date.now() - a);
  const b = Date.now(); const t = await cariTrigram(u.tanya); tT.push(Date.now() - b);

  const v1 = v[0]?.kode === u.harap, v3 = v.some((x) => x.kode === u.harap);
  const t1 = t[0]?.kode === u.harap, t3 = t.some((x) => x.kode === u.harap);
  if (v1) kenaV1++; if (v3) kenaV3++; if (t1) kenaT1++; if (t3) kenaT3++;

  console.log(`"${u.tanya}"`);
  console.log(`   harap   ${u.harap}`);
  console.log(`   vektor  ${v1 ? "TEPAT " : v3 ? "di-3  " : "MELESET"}  ${v.map((x) => `${x.kode}(${x.skor.toFixed(2)})`).join("  ")}`);
  console.log(`   trigram ${t1 ? "TEPAT " : t3 ? "di-3  " : "MELESET"}  ${t.map((x) => `${x.kode}(${x.skor.toFixed(2)})`).join("  ")}\n`);
}

const rata = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log("=".repeat(58));
console.log(`                 peringkat-1     dalam-3     waktu`);
console.log(`  VEKTOR         ${String(kenaV1).padStart(2)}/${UJI.length}           ${String(kenaV3).padStart(2)}/${UJI.length}       ${rata(tV)} ms`);
console.log(`  TRIGRAM        ${String(kenaT1).padStart(2)}/${UJI.length}           ${String(kenaT3).padStart(2)}/${UJI.length}       ${rata(tT)} ms`);
console.log("=".repeat(58));

await c.end();
