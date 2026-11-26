/**
 * Uji alat `stok_kosong` pada data asli, tanpa model bahasa. HANYA MEMBACA.
 *
 *   npm run test:stok-kosong
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { buatToolStokKosong, MAKS_BARIS } from "@/voltagent/tools-stok";

let lolos = 0, gagal = 0;
function cek(nama: string, ok: boolean, info = "") {
  if (ok) lolos++; else gagal++;
  console.log(`  ${ok ? "LOLOS" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
}
type Hasil = Record<string, unknown> & {
  ringkasan?: Record<string, number>;
  daftar?: Record<string, unknown>[];
};
const alat = buatToolStokKosong(() => "2026-11") as unknown as { execute: (a: object) => Promise<Hasil> };
const db = poolPerusahaan();

console.log("\n=== 1. Per produk, September 2026 ===");
const h = await alat.execute({ bulan: "2026-09" });
cek("siap", h.status === "siap", String(h.status));
const { rows: [l] } = await db.query<{ n: number; o: number; p: number; pel: number }>(
  `SELECT count(*)::int n, count(DISTINCT id_customer)::int o, count(DISTINCT item_code)::int p,
          (SELECT count(DISTINCT id_customer)::int FROM trx_ba_oos WHERE trx_date >= '2026-09-01' AND trx_date < '2026-10-01') pel
     FROM (SELECT DISTINCT id_customer, item_code, trx_date FROM trx_ba_oos
            WHERE trx_date >= '2026-09-01' AND trx_date < '2026-10-01' AND item_code IS NOT NULL AND id_customer IS NOT NULL) x`);
cek("hari kosong sama dengan query langsung", h.ringkasan?.hari_kosong === l.n, `${h.ringkasan?.hari_kosong} lawan ${l.n}`);
cek("outlet terdampak sama", h.ringkasan?.outlet_terdampak === l.o);
cek("produk terdampak sama", h.ringkasan?.produk_terdampak === l.p);
cek("outlet pelapor sama", h.outlet_pelapor === l.pel, String(h.outlet_pelapor));
cek("daftar dibatasi", (h.daftar?.length ?? 0) === Math.min(MAKS_BARIS, Number(h.jumlah_baris)), `${h.daftar?.length} dari ${h.jumlah_baris}`);
cek("diurutkan dari hari kosong", h.daftar!.every((d, i, a) => i === 0 || Number(a[i - 1].hari_kosong) >= Number(d.hari_kosong)));
cek("kalimat perkiraan kasar ikut", String(h.wajib_ditulis).includes("perkiraan kasar"));
cek("tidak membawa nama BA", !JSON.stringify(h).includes("ba_name") && !JSON.stringify(h).includes("\"ba\""));
cek("tabel sumber disebut", JSON.stringify(h.tabel_sumber) === JSON.stringify(["trx_ba_oos", "trx_ba_sales"]));

// Perkiraan kerugian satu produk, dihitung ulang dengan cara lain.
const contoh = h.daftar![0];
const { rows: [k] } = await db.query<{ unit: string }>(
  `WITH k AS (SELECT id_customer, count(DISTINCT trx_date) hari FROM trx_ba_oos
               WHERE item_code = $1 AND trx_date >= '2026-09-01' AND trx_date < '2026-10-01' AND id_customer IS NOT NULL GROUP BY 1),
        j AS (SELECT id_customer, sum(qty) q FROM trx_ba_sales WHERE item_code = $1 AND trx_date >= '2026-06-01' AND trx_date < '2026-09-01' GROUP BY 1)
   SELECT coalesce(sum(k.hari * j.q / 92.0) FILTER (WHERE j.q > 0), 0)::text unit FROM k LEFT JOIN j USING (id_customer)`, [contoh.kode]);
cek("perkiraan unit hilang bisa dihitung ulang", Number(contoh.perkiraan_unit_hilang) === Math.round(Number(k.unit)),
  `${contoh.nama}: ${contoh.perkiraan_unit_hilang} lawan ${Math.round(Number(k.unit))}`);

console.log("\n=== 2. Urutan dan pengelompokan ===");
const rugi = await alat.execute({ bulan: "2026-09", urut: "kerugian" });
cek("urut kerugian", rugi.daftar!.every((d, i, a) => i === 0 || Number(a[i - 1].perkiraan_rupiah_hilang) >= Number(d.perkiraan_rupiah_hilang)));
cek("ringkasan tidak berubah karena urutan", JSON.stringify(rugi.ringkasan) === JSON.stringify(h.ringkasan));
const outlet = await alat.execute({ bulan: "2026-09", menurut: "outlet" });
cek("per outlet membawa nama outlet", outlet.daftar!.every((d) => typeof d.outlet === "string" && (d.outlet as string).length > 0));
cek("total per outlet sama dengan per produk", JSON.stringify(outlet.ringkasan) === JSON.stringify(h.ringkasan));
const merek = await alat.execute({ bulan: "2026-09", merek: "MRPC" });
cek("merek mengurangi cakupan", (merek.ringkasan?.produk_terdampak ?? 0) < (h.ringkasan?.produk_terdampak ?? 0), `${merek.ringkasan?.produk_terdampak} produk`);

console.log("\n=== 3. Satu produk ===");
const satu = await alat.execute({ bulan: "2026-09", produk: "PEELING MUNDISARI 60 GR RJ" });
cek("satu produk dikelompokkan per outlet", satu.menurut === "outlet" && satu.ringkasan?.produk_terdampak === 1, String(satu.menurut));
const samar = await alat.execute({ bulan: "2026-09", produk: "PEELING" });
cek("nama samar minta diperjelas", samar.status === "perlu-diperjelas", String(samar.status));
const karang = await alat.execute({ bulan: "2026-09", produk: "PRODUK KARANGAN XYZ" });
cek("produk karangan tidak mengarang", karang.status === "tidak-ketemu", String(karang.status));

console.log("\n=== 4. Bulan ===");
const baru = await alat.execute({});
cek("bawaan ke data terbaru", String(baru.periode).startsWith("2026-10") && String(baru.periode).includes("belum penuh"), String(baru.periode));
const lalu = await alat.execute({ relatif: "bulan_lalu" });
cek("bulan lalu terbaca", String(lalu.periode).startsWith("2026-10"), String(lalu.periode));
const kini = await alat.execute({ relatif: "bulan_ini" });
cek("bulan tanpa data tidak disebut nol", kini.status === "data-belum-ada", `${kini.status}: ${kini.pesan ?? ""}`);
const salah = await alat.execute({ bulan: "2026-13" });
cek("format bulan salah", salah.status === "tidak-bisa");
const kutip = await alat.execute({ bulan: "2026-09", merek: "x' OR '1'='1" });
cek("kutip di merek hanya jadi teks", kutip.status === "siap" && kutip.ringkasan === undefined, String(kutip.pesan ?? ""));
cek("tidak ada laporan tidak disebut nol", String(kutip.pesan).startsWith("Tidak ada laporan stok kosong"));

console.log(`\n${lolos} lolos, ${gagal} gagal`);
await db.end();
process.stdout.write("", () => process.exit(gagal ? 1 : 0));
