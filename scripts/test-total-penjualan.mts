/**
 * Tool total penjualan, tanpa model bahasa. Hanya membaca.
 *
 *   npm run test:total-penjualan
 *
 * Pembandingnya query terpisah ke tabelnya, bukan hasil tool itu sendiri.
 * `sekarang` dipatok supaya hasilnya tidak bergantung tanggal menjalankan uji.
 */
import { buatToolTotalPenjualan } from "../voltagent/tools-penjualan.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

type Hasil = Record<string, unknown>;
const alat = buatToolTotalPenjualan(() => "2026-11") as unknown as {
  execute: (a: Record<string, unknown>) => Promise<Hasil>;
};
const db = poolPerusahaan();

async function langsung(dari: string, sampai: string, tambahan = "", nilai: unknown[] = []) {
  const { rows } = await db.query<{ u: string; r: string; n: number }>(
    `SELECT coalesce(sum(qty), 0)::text u, coalesce(sum(value), 0)::text r, count(DISTINCT period)::int n
       FROM ai_forecast_sales_monthly
      WHERE source = 'ba_sales' AND period >= $1::date AND period <= $2::date ${tambahan}`,
    [`${dari}-01`, `${sampai}-01`, ...nilai]);
  return { unit: Math.round(Number(rows[0].u)), rupiah: Math.round(Number(rows[0].r)), bulan: rows[0].n };
}

/** Pembanding bulan yang belum ada di tabel: langsung dari data mentah. */
async function mentah(dari: string, sebelum: string) {
  const { rows } = await db.query<{ u: string; r: string }>(
    `SELECT sum(qty)::text u, sum(qty * price)::text r FROM trx_ba_sales
      WHERE item_code IS NOT NULL AND trx_date >= $1::date AND trx_date < $2::date`, [dari, sebelum]);
  return { unit: Math.round(Number(rows[0].u)), rupiah: Math.round(Number(rows[0].r)) };
}

try {
  console.log("=== 1. Angka sama dengan query langsung ===");
  {
    const h = await alat.execute({ dari: "2026-06", sampai: "2026-06" });
    const b = await langsung("2026-06", "2026-06");
    cek("satu bulan", h.total_unit === b.unit && h.total_rupiah === b.rupiah, `${h.total_unit} unit, Rp${h.total_rupiah}`);
    const r = await alat.execute({ dari: "2026-01", sampai: "2026-07" });
    const br = await langsung("2026-01", "2026-07");
    cek("rentang bulan", r.total_unit === br.unit && r.total_rupiah === br.rupiah);
    cek("rincian per bulan menjumlah ke total",
      (r.per_bulan as { unit: number }[]).reduce((a, x) => a + x.unit, 0) === r.total_unit);
    cek("per merek tidak melebihi total",
      (r.per_merek_terbesar as { rupiah: number }[]).reduce((a, x) => a + x.rupiah, 0) <= (r.total_rupiah as number));
    const semua = await db.query<{ v: string }>(
      `SELECT sum(value)::text v FROM ai_forecast_sales_monthly WHERE period = '2026-07-01'`);
    const jul = await alat.execute({ dari: "2026-07" });
    cek("data dummy tidak ikut terhitung",
      (jul.total_rupiah as number) <= Math.round(Number(semua.rows[0].v)), `${jul.total_rupiah}`);
    const kosong = await alat.execute({});
    cek("tanpa periode memakai bulan terakhir data", (kosong.periode as { dari: string }).dari === kosong.data_perusahaan_sampai);
    const teksKosong = await alat.execute({ relatif: undefined, dari: "", sampai: "", produk: "", merek: "" });
    cek("teks kosong dari model tidak merusak", teksKosong.status === "siap");
  }

  console.log("\n=== 2. Bulan yang belum ada datanya ===");
  {
    const h = await alat.execute({ relatif: "bulan_lalu" });
    cek("bulan lalu dihitung dari tanggal, bukan model", (h.periode as { dari: string }).dari === "2026-10");
    cek("mengaku data belum ada", h.status === "data-belum-ada", String(h.pesan));
    cek("tidak membawa angka nol", h.total_unit === undefined && h.total_rupiah === undefined);
    const t = await alat.execute({ relatif: "tahun_ini" });
    cek("tahun ini tetap dihitung sebagian", t.status === "siap" && (t.bulan_berisi_data as number) === 9, `${t.bulan_berisi_data} bulan`);
    cek("bulan yang belum penuh disebut belum ada",
      JSON.stringify(t.bulan_belum_ada_data) === JSON.stringify(["2026-10", "2026-11"]));
    const b = await langsung("2026-01", "2026-07");
    const bm = await mentah("2026-08-01", "2026-10-01");
    cek("total sebagian sama dengan tabel ditambah data mentah", t.total_rupiah === b.rupiah + bm.rupiah, `Rp${t.total_rupiah}`);
    const agt = await alat.execute({ dari: "2026-08" });
    cek("Agustus dari data mentah", agt.total_unit === 155280, `${agt.total_unit} unit`);
    const okt = await alat.execute({ dari: "2026-10" });
    cek("Oktober yang belum penuh tidak dihitung", okt.status === "data-belum-ada" && okt.total_unit === undefined);
    const mAgt = await alat.execute({ merek: "PUTERI", dari: "2026-08" });
    cek("merek ikut terbawa ke data mentah", (mAgt.total_unit as number) > 0, `${mAgt.total_unit} unit`);
    const lalu = await alat.execute({ relatif: "tahun_lalu" });
    cek("tahun lalu lengkap", lalu.status === "siap" && (lalu.bulan_berisi_data as number) === 12 && lalu.bulan_belum_ada_data === undefined);
    const jan = buatToolTotalPenjualan(() => "2027-01") as unknown as typeof alat;
    cek("bulan lalu melewati pergantian tahun",
      ((await jan.execute({ relatif: "bulan_lalu" })).periode as { dari: string }).dari === "2026-12");
  }

  console.log("\n=== 3. Produk dan merek ===");
  {
    const h = await alat.execute({ produk: "1006000", dari: "2026-07" });
    const b = await langsung("2026-07", "2026-07", "AND sku_code = $3", ["1006000"]);
    cek("satu produk lewat kode", h.total_unit === b.unit && h.total_rupiah === b.rupiah, `${h.total_unit} unit`);
    cek("menyebut nama produknya", (h.produk as { nama: string })?.nama?.includes("MINYAK ZAITUN"));
    cek("cocok dengan angka ramalan 2026-07", h.total_unit === 22388);
    const a = await alat.execute({ produk: "minyak zaitun" });
    cek("nama ambigu meminta dipilih", a.status === "perlu-diperjelas" && (a.pilihan as unknown[]).length > 1);
    cek("nama ambigu tidak membawa total", a.total_unit === undefined);
    const k = await alat.execute({ produk: "PRODUK KARANGAN ZZZ" });
    cek("produk tak ada mengaku", k.status === "tidak-ketemu");
    const m = await alat.execute({ merek: "PUTERI", dari: "2026-07" });
    const bm = await langsung("2026-07", "2026-07", "AND brand ILIKE '%' || $3 || '%'", ["PUTERI"]);
    cek("satu merek", m.total_rupiah === bm.rupiah && (m.total_rupiah as number) > 0, `Rp${m.total_rupiah}`);
    const n = await alat.execute({ merek: "MEREK KARANGAN", dari: "2026-07" });
    cek("merek tak ada berarti nol baris, dan dikatakan", n.status === "siap" && n.bulan_berisi_data === 0 && String(n.catatan).includes("Tidak ada"));
  }

  console.log("\n=== 4. Masukan yang tidak sah ===");
  {
    cek("format bulan salah", (await alat.execute({ dari: "juni 2026" })).status === "tidak-bisa");
    cek("bulan 13", (await alat.execute({ dari: "2026-13" })).status === "tidak-bisa");
    cek("awal sesudah akhir", (await alat.execute({ dari: "2026-07", sampai: "2026-01" })).status === "tidak-bisa");
    const j = await alat.execute({ merek: "x'; DROP TABLE employee; --", dari: "2026-07" });
    cek("kutip di merek hanya jadi teks pencarian", j.status === "siap" && j.bulan_berisi_data === 0);
    cek("kutip di bulan ditolak", (await alat.execute({ dari: "2026-07'; --" })).status === "tidak-bisa");
  }
} finally {
  await db.end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.stdout.write("", () => process.exit(gagal > 0 ? 1 : 0));
}
