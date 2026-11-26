/**
 * Tool stok kosong: produk dan outlet yang paling sering kehabisan barang, beserta perkiraan
 * penjualan yang hilang.
 *
 * Sumbernya laporan BA di `trx_ba_oos`: satu baris berarti "produk X kosong di outlet Y pada
 * tanggal Z". Tidak ada jumlah barang yang kurang, jadi kerugiannya DIPERKIRAKAN:
 *
 *   hari kosong x rata-rata penjualan harian produk itu di outlet itu, 3 bulan sebelumnya
 *
 * ⚠️ PERKIRAAN KASAR, DAN CENDERUNG TERLALU KECIL. Satu laporan dianggap satu hari penuh kosong,
 * dan rata-rata 3 bulan sebelumnya ikut memuat hari-hari kosong. Outlet yang tidak pernah menjual
 * produknya dalam 3 bulan itu tidak bisa diperkirakan sama sekali, dan jumlahnya disebut.
 *
 * ⚠️ JUMLAH OUTLET PELAPOR BERUBAH JAUH. Sekitar 35 per bulan sampai Juli 2026, lalu 169 sejak
 * Agustus 2026. Jadi alat ini sengaja hanya melihat satu bulan, tanpa membandingkan antarbulan.
 * Perbandingan antarbulan ada di `pergerakan_penjualan`, yang menyaring outlet pelapornya.
 *
 * Nama BA tidak dipulangkan: itu data per orang.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { cariSku } from "@/lib/ramalan/deret";
import { bulanIni } from "@/lib/ramalan/pilih";

const SUMBER = "ba_sales";
const FORMAT_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Bulan berjalan yang datanya kurang dari ini diganti bulan sebelumnya. */
const MIN_HARI_BERJALAN = 7;
const BULAN_DASAR = 3;
export const MAKS_BARIS = 10;

const geserBulan = (bulan: string, n: number) => {
  const [y, m] = bulan.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const bulat = (s: string | null) => (s === null ? 0 : Math.round(Number(s)));

type BarisProduk = {
  kunci: string; nama: string | null; merek: string | null; kota: string | null;
  hari: string; outlet: string; produk: string; unit: string; rupiah: string; tanpa_riwayat: string;
};

/** `sekarang` hanya diisi uji, supaya hasilnya tidak bergantung tanggal menjalankannya. */
export function buatToolStokKosong(sekarang: () => string = bulanIni) {
  return createTool({
    name: "stok_kosong",
    description:
      "Produk atau outlet yang paling sering kehabisan barang dalam satu bulan, dari laporan stok kosong BA, " +
      "beserta perkiraan penjualan yang hilang. Pakai untuk pertanyaan seperti 'produk apa yang paling sering " +
      "kosong', 'outlet mana yang sering kehabisan', 'berapa penjualan yang hilang karena stok kosong', atau " +
      "'produk X kosong di mana saja'. ⚠️ PANGGIL DULU. ⚠️ Kerugiannya perkiraan kasar, sebut itu. " +
      "JANGAN menebak penyebab kosongnya.",
    parameters: z.object({
      bulan: z.string().optional().describe("Bulan, format YYYY-MM. WAJIB diisi kalau user menyebut bulan; kosongkan HANYA untuk data terbaru."),
      relatif: z.enum(["bulan_ini", "bulan_lalu"]).optional().describe("Isi kalau user menyebut bulan ini atau bulan lalu."),
      menurut: z.enum(["produk", "outlet"]).optional().describe("Dikelompokkan per produk (bawaan) atau per outlet."),
      produk: z.string().optional().describe("Nama produk atau kode SKU, kalau user menanyakan satu produk. Hasilnya per outlet."),
      merek: z.string().optional().describe("Nama merek. Kosongkan untuk semua merek."),
      urut: z.enum(["hari_kosong", "kerugian"]).optional().describe(
        "kerugian kalau user bertanya yang paling merugikan atau penjualan yang hilang. Bawaannya hari_kosong (paling sering kosong).",
      ),
    }),
    execute: async ({ bulan, relatif, menurut, produk, merek, urut }: {
      bulan?: string; relatif?: "bulan_ini" | "bulan_lalu"; menurut?: "produk" | "outlet";
      produk?: string; merek?: string; urut?: "hari_kosong" | "kerugian";
    }) => {
      const db = poolPerusahaan();
      const { rows: akhir } = await db.query<{ d: string | null }>(
        `SELECT to_char(max(trx_date), 'YYYY-MM-DD') AS d FROM trx_ba_oos WHERE trx_date <= current_date`);
      const terakhir = akhir[0]?.d;
      if (!terakhir) return { status: "tidak-bisa", pesan: "Data laporan stok kosong kosong." };
      const bulanData = terakhir.slice(0, 7);
      const hariData = Number(terakhir.slice(8));
      const akhirBulanData = new Date(Date.UTC(Number(bulanData.slice(0, 4)), Number(bulanData.slice(5)), 0)).getUTCDate();

      const kini = sekarang();
      const pilihan = bulan?.trim() || undefined;
      let sasaran: string;
      if (relatif) sasaran = relatif === "bulan_ini" ? kini : geserBulan(kini, -1);
      else if (pilihan) sasaran = pilihan;
      else sasaran = hariData < akhirBulanData && hariData < MIN_HARI_BERJALAN ? geserBulan(bulanData, -1) : bulanData;
      if (!FORMAT_BULAN.test(sasaran)) return { status: "tidak-bisa", pesan: "Format bulan harus YYYY-MM, misalnya 2026-09." };

      const dasar = { data_terakhir_tanggal: terakhir, sumber: "laporan stok kosong dari BA di outlet" };
      if (sasaran > bulanData) {
        return {
          status: "data-belum-ada",
          pesan: `Laporan stok kosong baru sampai ${terakhir}, jadi ${sasaran} belum ada datanya.`,
          ...dasar,
          catatan: `Tawarkan melihat ${bulanData} sebagai data terbaru. JANGAN menyebutnya tidak ada stok kosong.`,
        };
      }

      let satuProduk: { kode: string; nama: string } | undefined;
      const kataProduk = produk?.trim();
      if (kataProduk) {
        const calon = await cariSku(kataProduk, 8);
        if (calon.length === 0) return { status: "tidak-ketemu", pesan: `Produk "${kataProduk}" tidak ada di data penjualan.` };
        if (calon.length > 1) {
          return {
            status: "perlu-diperjelas",
            pesan: `Ada ${calon.length} produk yang cocok dengan "${kataProduk}". Yang mana?`,
            pilihan: calon.map((c) => ({ kode: c.sku, nama: c.nama, riwayat_bulan: c.bulan, data_terakhir: c.terakhir })),
          };
        }
        satuProduk = { kode: calon[0].sku, nama: calon[0].nama };
      }
      const kelompok = satuProduk ? "outlet" : (menurut ?? "produk");
      const sebagian = sasaran === bulanData && hariData < akhirBulanData;

      const awal = `${sasaran}-01`;
      const sesudah = `${geserBulan(sasaran, 1)}-01`;
      const dasarDari = `${geserBulan(sasaran, -BULAN_DASAR)}-01`;
      const nilai: unknown[] = [awal, sesudah, dasarDari, SUMBER, satuProduk?.kode ?? null];
      const kataMerek = merek?.trim();
      if (kataMerek) nilai.push(kataMerek);
      const kunci = kelompok === "produk" ? "k.item_code" : "k.id_customer::text";

      const { rows } = await db.query<BarisProduk>(
        `WITH katalog AS (
           SELECT sku_code, max(sku_name) AS nama, max(brand) AS merek FROM ai_forecast_sales_monthly
            WHERE source = $4 GROUP BY 1),
         kosong AS (
           SELECT o.id_customer, o.item_code, count(DISTINCT o.trx_date) AS hari
             FROM trx_ba_oos o LEFT JOIN katalog g ON g.sku_code = o.item_code
            WHERE o.trx_date >= $1::date AND o.trx_date < $2::date AND o.item_code IS NOT NULL AND o.id_customer IS NOT NULL
              AND ($5::text IS NULL OR o.item_code = $5)
              ${kataMerek ? `AND g.merek ILIKE '%' || $6 || '%'` : ""}
            GROUP BY 1, 2),
         -- Rata-rata harian 3 bulan sebelumnya, hanya untuk pasangan outlet-produk yang kosong.
         jual AS (
           SELECT t.id_customer, t.item_code,
                  sum(t.qty) / ($1::date - $3::date)::numeric AS unit_hari,
                  sum(t.qty * t.price) / ($1::date - $3::date)::numeric AS rp_hari
             FROM trx_ba_sales t JOIN kosong k USING (id_customer, item_code)
            WHERE t.trx_date >= $3::date AND t.trx_date < $1::date
            GROUP BY 1, 2
           HAVING sum(t.qty) > 0)
         SELECT ${kunci} AS kunci,
                ${kelompok === "produk" ? "max(g.nama)" : "max(c.customer_name)"} AS nama,
                ${kelompok === "produk" ? "max(g.merek)" : "NULL"} AS merek,
                ${kelompok === "produk" ? "NULL" : "max(c.city)"} AS kota,
                sum(k.hari)::text AS hari,
                count(DISTINCT k.id_customer)::text AS outlet,
                count(DISTINCT k.item_code)::text AS produk,
                coalesce(sum(k.hari * j.unit_hari), 0)::text AS unit,
                coalesce(sum(k.hari * j.rp_hari), 0)::text AS rupiah,
                count(*) FILTER (WHERE j.unit_hari IS NULL)::text AS tanpa_riwayat
           FROM kosong k
           LEFT JOIN jual j USING (id_customer, item_code)
           LEFT JOIN katalog g ON g.sku_code = k.item_code
           LEFT JOIN customer c ON c.id_customer = k.id_customer
          GROUP BY ROLLUP (${kunci})`,
        nilai,
      );

      const total = rows.find((r) => r.kunci === null);
      const baris = rows.filter((r) => r.kunci !== null)
        // Bawaannya hari kosong: separuh pasangan outlet-produk tidak punya riwayat jual (Sep 2026: 1.060
        // dari 2.056), jadi urutan kerugian menyembunyikan produk yang sering kosong tapi tidak bisa ditaksir.
        .sort(urut === "kerugian"
          ? (a, b) => Number(b.rupiah) - Number(a.rupiah) || Number(b.hari) - Number(a.hari)
          : (a, b) => Number(b.hari) - Number(a.hari) || Number(b.rupiah) - Number(a.rupiah));
      const periode = sebagian ? `${sasaran} tanggal 1-${hariData} (bulan belum penuh)` : sasaran;
      // ROLLUP tetap memulangkan satu baris total bernilai nol walau tidak ada laporan sama sekali.
      if (!total || baris.length === 0) {
        return {
          status: "siap", ...dasar, tabel_sumber: ["trx_ba_oos"], periode,
          ...(satuProduk ? { produk: satuProduk } : {}),
          pesan: `Tidak ada laporan stok kosong untuk ${periode}${satuProduk ? ` pada ${satuProduk.nama}` : ""}${kataMerek ? ` merek ${kataMerek}` : ""}.`,
          catatan: "Artinya tidak ada BA yang melaporkannya, bukan pasti tidak pernah kosong.",
        };
      }

      const { rows: pelapor } = await db.query<{ n: string }>(
        `SELECT count(DISTINCT id_customer)::text AS n FROM trx_ba_oos WHERE trx_date >= $1::date AND trx_date < $2::date`,
        [awal, sesudah]);

      const tampil = baris.slice(0, MAKS_BARIS).map((r) => ({
        ...(kelompok === "produk"
          ? { kode: r.kunci, nama: (r.nama ?? r.kunci).replace(/\s+/g, " ").trim(), merek: r.merek, jumlah_outlet: bulat(r.outlet) }
          : { outlet: (r.nama ?? "nama outlet tidak tercatat").replace(/\s+/g, " ").trim(), kota: r.kota, jumlah_produk: bulat(r.produk) }),
        hari_kosong: bulat(r.hari),
        perkiraan_unit_hilang: bulat(r.unit),
        perkiraan_rupiah_hilang: bulat(r.rupiah),
        ...(bulat(r.tanpa_riwayat) > 0 ? { pasangan_tanpa_riwayat_jual: bulat(r.tanpa_riwayat) } : {}),
      }));

      return {
        status: "siap",
        ...dasar,
        tabel_sumber: ["trx_ba_oos", "trx_ba_sales"],
        periode,
        menurut: kelompok,
        diurutkan: urut === "kerugian" ? "perkiraan kerugian terbesar" : "hari kosong terbanyak",
        ...(satuProduk ? { produk: satuProduk } : {}),
        ...(kataMerek ? { merek: kataMerek } : {}),
        outlet_pelapor: bulat(pelapor[0]?.n ?? "0"),
        ringkasan: {
          hari_kosong: bulat(total.hari),
          outlet_terdampak: bulat(total.outlet),
          produk_terdampak: bulat(total.produk),
          perkiraan_unit_hilang: bulat(total.unit),
          perkiraan_rupiah_hilang: bulat(total.rupiah),
          pasangan_outlet_produk_tanpa_riwayat_jual: bulat(total.tanpa_riwayat),
        },
        jumlah_baris: baris.length,
        arti_hari_kosong:
          "`hari_kosong` adalah jumlah laporan hari-kosong yang dijumlahkan dari banyak outlet, " +
          "bukan lamanya satu produk kosong terus-menerus.",
        daftar: tampil,
        cara_menghitung:
          `laporan hari-kosong x rata-rata penjualan harian produk itu di outlet itu selama ${BULAN_DASAR} bulan sebelumnya. ` +
          `Pasangan outlet-produk yang tidak terjual sama sekali dalam ${BULAN_DASAR} bulan itu tidak bisa diperkirakan.`,
        wajib_ditulis:
          "Kerugian ini perkiraan kasar dan cenderung lebih kecil dari sebenarnya. Hanya mencakup outlet yang punya BA dan melapor.",
        catatan:
          "`daftar` di atas adalah jawabannya: sampaikan sebagai tabel. Sampaikan periode, `outlet_pelapor`, dan " +
          "`data_terakhir_tanggal`. Angka di atas dari database, jangan dihitung ulang. Kalau daftarnya terpotong, " +
          "sebut `jumlah_baris`. Kalau `pasangan_outlet_produk_tanpa_riwayat_jual` lebih dari 0, sebut bahwa sebagian " +
          "kerugian tidak bisa diperkirakan. Gunakan istilah 'laporan hari-kosong' sesuai `arti_hari_kosong`; " +
          "JANGAN menulis seolah produk kosong terus-menerus selama sejumlah hari itu. Tulis `wajib_ditulis` apa " +
          "adanya di akhir. JANGAN membandingkan dengan " +
          "bulan lain dan JANGAN menebak penyebab kosongnya.",
      };
    },
  });
}
