/**
 * Alat pergerakan penjualan, tanpa model bahasa. Hanya membaca.
 *
 *   npm run test:pergerakan
 *
 * Pembandingnya query terpisah per produk, bukan hasil alat itu sendiri.
 * `sekarang` dipatok supaya hasilnya tidak bergantung tanggal menjalankan uji.
 */
import { AMBANG_GERAK_PERSEN, buatToolPergerakanPenjualan, susunPetunjuk } from "../voltagent/tools-penjualan.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

type Petunjuk = { outlet: string; unit_per_outlet: string; harga_rata_rata: string; laporan_stok_kosong: string; berubah_bersamaan_belum_tentu_penyebab: string[] };
type Baris = { kode: string; nama: string; unit: number; biasanya_unit: number; perubahan_persen: number; rupiah: number; biasanya_rupiah: number; petunjuk?: Petunjuk };
type Hasil = Record<string, unknown> & { turun?: Baris[]; naik?: Baris[] };
const buat = (bulan: string) => buatToolPergerakanPenjualan(() => bulan) as unknown as { execute: (a: Record<string, unknown>) => Promise<Hasil> };
const alat = buat("2026-11");
const db = poolPerusahaan();

const satu = async (kode: string, a: string, b: string, sampaiHari?: number) => {
  const { rows } = await db.query<{ q: string; v: string }>(
    `SELECT coalesce(sum(qty), 0)::text q, coalesce(sum(qty * price), 0)::text v FROM trx_ba_sales
      WHERE item_code = $1 AND trx_date >= $2::date AND trx_date < $3::date
        AND ($4::int IS NULL OR extract(day FROM trx_date) <= $4::int)`, [kode, a, b, sampaiHari ?? null]);
  return { unit: Number(rows[0].q), rupiah: Number(rows[0].v) };
};

try {
  console.log("=== 1. Bulan penuh ===");
  const h = await alat.execute({ bulan: "2026-09" });
  cek("siap", h.status === "siap", String(h.periode));
  cek("menyebut pembanding", String(h.dibanding).includes("2026-06 sampai 2026-08"), String(h.dibanding));
  cek("menyebut tanggal data terakhir", /^\d{4}-\d{2}-\d{2}$/.test(String(h.data_terakhir_tanggal)), String(h.data_terakhir_tanggal));
  cek("jumlah sesuai pengecekan awal", (h.jumlah_turun as number) > 0 && (h.jumlah_naik as number) > 0, `turun ${h.jumlah_turun}, naik ${h.jumlah_naik} dari ${h.jumlah_produk_diperiksa}`);
  const contoh = h.turun![0];
  const nyata = await satu(contoh.kode, "2026-09-01", "2026-10-01");
  const lalu = await satu(contoh.kode, "2026-06-01", "2026-09-01");
  cek("unit sama dengan query langsung", contoh.unit === Math.round(nyata.unit), `${contoh.nama}: ${contoh.unit}`);
  cek("pembanding sama dengan query langsung", contoh.biasanya_unit === Math.round(lalu.unit / 3), `${contoh.biasanya_unit}`);
  cek("rupiah sama dengan query langsung", contoh.rupiah === Math.round(nyata.rupiah));
  cek("persen bisa dihitung ulang", Math.abs(contoh.perubahan_persen - (nyata.unit / (lalu.unit / 3) - 1) * 100) < 0.1, `${contoh.perubahan_persen}%`);
  cek("semua yang turun melewati ambang", h.turun!.every((x) => x.perubahan_persen <= -AMBANG_GERAK_PERSEN));
  cek("semua yang naik melewati ambang", h.naik!.every((x) => x.perubahan_persen >= AMBANG_GERAK_PERSEN));
  cek("diurutkan dari selisih terbesar", h.turun!.every((x, i, a) => i === 0 || Math.abs(a[i - 1].unit - a[i - 1].biasanya_unit) >= Math.abs(x.unit - x.biasanya_unit)));
  cek("nama produk terbaca", h.turun!.every((x) => x.nama.length > 0));
  cek("dua arah dibatasi lebih pendek", h.turun!.length <= 5 && h.naik!.length <= 5);
  const satuArah = await alat.execute({ bulan: "2026-09", arah: "turun" });
  cek("satu arah boleh lebih panjang", satuArah.turun!.length > 5 && satuArah.turun!.length <= 10, `${satuArah.turun!.length} produk`);
  cek("jumlah sebenarnya tetap disebut", satuArah.jumlah_turun === h.jumlah_turun, `${satuArah.jumlah_turun}`);
  cek("kalimat bukan penyebab ikut", String(h.wajib_ditulis).includes("belum tentu penyebabnya"));

  console.log("\n=== 1b. Petunjuk ===");
  cek("tiap baris membawa petunjuk", [...h.turun!, ...h.naik!].every((x) => x.petunjuk && x.petunjuk.berubah_bersamaan_belum_tentu_penyebab.length > 0));
  const { rows: oLama } = await db.query<{ n: string }>(
    `SELECT (count(*) / 3.0)::text n FROM (SELECT DISTINCT date_trunc('month', trx_date), id_customer FROM trx_ba_sales
      WHERE item_code = $1 AND trx_date >= '2026-06-01' AND trx_date < '2026-09-01' AND qty > 0) x`, [contoh.kode]);
  const { rows: oBaru } = await db.query<{ n: number }>(
    `SELECT count(DISTINCT id_customer)::int n FROM trx_ba_sales WHERE item_code = $1 AND trx_date >= '2026-09-01' AND trx_date < '2026-10-01' AND qty > 0`, [contoh.kode]);
  const fmt = (n: number) => Math.round(n).toLocaleString("id-ID");
  cek("outlet sama dengan query langsung", contoh.petunjuk?.outlet === `${fmt(Number(oLama[0].n))} ke ${fmt(oBaru[0].n)}`, contoh.petunjuk?.outlet);
  const { rows: ks } = await db.query<{ k: number; l: string }>(
    `SELECT count(*) FILTER (WHERE trx_date >= '2026-09-01')::int k, (count(*) FILTER (WHERE trx_date < '2026-09-01') / 3.0)::text l
       FROM trx_ba_oos WHERE item_code = $1 AND trx_date >= '2026-06-01' AND trx_date < '2026-10-01'
        AND id_customer IN (SELECT id_customer FROM trx_ba_oos WHERE trx_date >= '2026-06-01' AND trx_date < '2026-10-01'
                             GROUP BY 1 HAVING bool_or(trx_date >= '2026-09-01') AND count(DISTINCT date_trunc('month', trx_date)) FILTER (WHERE trx_date < '2026-09-01') = 3)`, [contoh.kode]);
  cek("stok kosong hanya dari outlet yang melapor di setiap bulan",
    /^hanya dari [\d.]+ outlet yang melapor/.test(String(h.laporan_stok_kosong_dihitung)), String(h.laporan_stok_kosong_dihitung));
  cek("stok kosong sama dengan query langsung", contoh.petunjuk?.laporan_stok_kosong === `${fmt(Number(ks[0].l))} ke ${fmt(ks[0].k)}`, contoh.petunjuk?.laporan_stok_kosong);
  cek("harga sama dengan query langsung", contoh.petunjuk?.harga_rata_rata.endsWith(`Rp${fmt(nyata.rupiah / nyata.unit)}`) === true, contoh.petunjuk?.harga_rata_rata);
  const dasar = { unit: 500, biasanyaUnit: 1000, outlet: 50, outletLalu: 100, harga: 10000, hargaLalu: 10000, kosong: 0, kosongLalu: 0 };
  const tampil = (u: Partial<typeof dasar>) => susunPetunjuk({ ...dasar, ...u }).berubah_bersamaan_belum_tentu_penyebab.join(" | ");
  cek("outlet berkurang terbaca", tampil({}).includes("outlet yang menjual berkurang 50%"), tampil({}));
  cek("penjualan per outlet stabil tidak disebut", !tampil({}).includes("per outlet"));
  cek("per outlet turun terbaca", tampil({ outlet: 100 }).includes("penjualan per outlet berkurang 50%"), tampil({ outlet: 100 }));
  cek("harga berubah terbaca", tampil({ harga: 12000 }).includes("harga rata-rata naik 20%"));
  cek("harga sedikit berubah tidak disebut", !tampil({ harga: 10300 }).includes("harga"));
  cek("stok kosong melonjak terbaca", tampil({ kosong: 30, kosongLalu: 8 }).includes("laporan stok kosong naik dari 8 ke 30"));
  cek("laporan sedikit tidak disebut", !tampil({ kosong: 3, kosongLalu: 0 }).includes("stok kosong"));
  cek("tidak ada penjualan disebut", tampil({ unit: 0, outlet: 0 }).includes("tidak ada penjualan tercatat"));
  cek("tanpa pembanding outlet tidak melempar", susunPetunjuk({ ...dasar, outletLalu: 0 }).berubah_bersamaan_belum_tentu_penyebab.length > 0);
  cek("tidak ada yang menonjol dikatakan", tampil({ unit: 980, outlet: 98 }) === "tidak ada yang menonjol dari data ini", tampil({ unit: 980, outlet: 98 }));
  cek("kalimatnya tidak menyebut sebab", ![...h.turun!, ...h.naik!].some((x) => x.petunjuk?.berubah_bersamaan_belum_tentu_penyebab.some((y) => /karena|akibat|sebab/i.test(y))));

  console.log("\n=== 2. Bulan belum penuh dibandingkan hari-untuk-hari ===");
  const b = await alat.execute({});
  cek("bawaan memakai data terbaru", String(b.periode).startsWith("2026-10"), String(b.periode));
  cek("periode menyebut belum penuh", String(b.periode).includes("belum penuh"));
  cek("pembanding menyebut rentang tanggal", String(b.dibanding).includes("tanggal 1-18"), String(b.dibanding));
  const c2 = b.turun![0] ?? b.naik![0];
  if (c2) {
    const n2 = await satu(c2.kode, "2026-10-01", "2026-11-01");
    const l2 = await satu(c2.kode, "2026-07-01", "2026-10-01", 18);
    cek("unit bulan berjalan sama dengan query langsung", c2.unit === Math.round(n2.unit), `${c2.unit}`);
    cek("pembanding hanya tanggal yang sama", c2.biasanya_unit === Math.round(l2.unit / 3), `${c2.biasanya_unit}`);
  }

  console.log("\n=== 2b. Dua bulan tertentu ===");
  const dua = await alat.execute({ bulan: "2026-09", dibanding_bulan: "2026-08", arah: "turun" });
  cek("pembanding menyebut bulannya", dua.dibanding === "2026-08", String(dua.dibanding));
  const d1 = dua.turun![0];
  cek("ada produk turun", Boolean(d1), `${dua.jumlah_turun} produk`);
  if (d1) {
    const sep = await satu(d1.kode, "2026-09-01", "2026-10-01");
    const agu = await satu(d1.kode, "2026-08-01", "2026-09-01");
    cek("unit September sama dengan query langsung", d1.unit === Math.round(sep.unit), `${d1.nama}: ${d1.unit}`);
    cek("pembanding Agustus sama dengan query langsung", d1.biasanya_unit === Math.round(agu.unit), `${d1.biasanya_unit}`);
    const { rows: o } = await db.query<{ a: number; s: number }>(
      `SELECT count(DISTINCT id_customer) FILTER (WHERE trx_date < '2026-09-01')::int a, count(DISTINCT id_customer) FILTER (WHERE trx_date >= '2026-09-01')::int s
         FROM trx_ba_sales WHERE item_code = $1 AND trx_date >= '2026-08-01' AND trx_date < '2026-10-01' AND qty > 0`, [d1.kode]);
    cek("outlet memakai dua bulan itu saja", d1.petunjuk?.outlet === `${o[0].a.toLocaleString("id-ID")} ke ${o[0].s.toLocaleString("id-ID")}`, d1.petunjuk?.outlet);
  }
  const lompat = await alat.execute({ bulan: "2026-09", dibanding_bulan: "2026-06", arah: "turun" });
  const l1 = lompat.turun![0];
  if (l1) {
    const { rows: o } = await db.query<{ a: number }>(
      `SELECT count(DISTINCT id_customer)::int a FROM trx_ba_sales WHERE item_code = $1 AND trx_date >= '2026-06-01' AND trx_date < '2026-07-01' AND qty > 0`, [l1.kode]);
    cek("bulan yang dilompati tidak ikut terhitung", l1.petunjuk?.outlet.startsWith(`${o[0].a.toLocaleString("id-ID")} ke`) === true, l1.petunjuk?.outlet);
  }
  cek("pembanding sesudah sasaran ditolak", (await alat.execute({ bulan: "2026-08", dibanding_bulan: "2026-09" })).status === "tidak-bisa");
  cek("pembanding format salah ditolak", (await alat.execute({ bulan: "2026-09", dibanding_bulan: "agustus" })).status === "tidak-bisa");
  const berjalan = await alat.execute({ bulan: "2026-10", dibanding_bulan: "2026-09" });
  cek("bulan belum penuh tetap hari-untuk-hari", String(berjalan.dibanding).includes("tanggal 1-18"), String(berjalan.dibanding));

  console.log("\n=== 3. Data yang belum ada ===");
  const bi = await alat.execute({ relatif: "bulan_ini" });
  cek("bulan ini mengaku belum ada data", bi.status === "data-belum-ada", String(bi.pesan));
  cek("tidak membawa daftar", bi.turun === undefined && bi.naik === undefined);
  const bl = await alat.execute({ relatif: "bulan_lalu" });
  cek("bulan lalu terbaca", String(bl.periode).startsWith("2026-10"), String(bl.periode));
  const jan = await buat("2027-01").execute({ relatif: "bulan_lalu" });
  cek("bulan lalu melewati pergantian tahun", jan.status === "data-belum-ada" && String(jan.pesan).includes("2026-12"));

  console.log("\n=== 4. Saringan ===");
  const hanyaTurun = await alat.execute({ bulan: "2026-09", arah: "turun" });
  cek("arah turun saja", Array.isArray(hanyaTurun.turun) && hanyaTurun.naik === undefined);
  const hanyaNaik = await alat.execute({ bulan: "2026-09", arah: "naik" });
  cek("arah naik saja", Array.isArray(hanyaNaik.naik) && hanyaNaik.turun === undefined);
  const m = await alat.execute({ bulan: "2026-09", merek: "PUTERI" });
  cek("merek mengurangi jumlah produk", (m.jumlah_produk_diperiksa as number) < (h.jumlah_produk_diperiksa as number), `${m.jumlah_produk_diperiksa} produk`);
  const k = await alat.execute({ bulan: "2026-09", merek: "MEREK KARANGAN" });
  cek("merek karangan tidak mengarang", k.status === "siap" && k.jumlah_produk_diperiksa === 0);

  console.log("\n=== 5. Masukan tidak sah ===");
  cek("format bulan salah", (await alat.execute({ bulan: "september" })).status === "tidak-bisa");
  cek("kutip di bulan ditolak", (await alat.execute({ bulan: "2026-09'; --" })).status === "tidak-bisa");
  const j = await alat.execute({ bulan: "2026-09", merek: "x'; DROP TABLE employee; --" });
  cek("kutip di merek hanya jadi teks", j.status === "siap" && j.jumlah_produk_diperiksa === 0);
} finally {
  await db.end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.stdout.write("", () => process.exit(gagal > 0 ? 1 : 0));
}
