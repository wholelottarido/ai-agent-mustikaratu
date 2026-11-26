/**
 * Tool total penjualan dari tabel penjualan bulanan.
 *
 * Jumlahnya dihitung database, bukan model bahasa. Jenis `kode` karena hasilnya
 * penjumlahan beserta pemeriksaan bulan yang belum ada datanya, dan borang Kelola AI
 * hanya bisa merakit baris tanpa penjumlahan.
 *
 * ⚠️ DATA BERHENTI DI BULAN PENUH TERAKHIR. "Bulan lalu" bisa saja belum ada datanya,
 * dan menjumlahkan bulan kosong menghasilkan nol yang terbaca seperti "tidak ada
 * penjualan". Karena itu bulan tanpa data selalu disebut.
 *
 * ⚠️ Sumbernya `ba_sales`. Belum tentu sama dengan seluruh pendapatan perusahaan,
 * jadi model diminta menyebut sumbernya, bukan menyebutnya pendapatan perusahaan.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { batasSambung, bulanTerakhirData, cariSku } from "@/lib/ramalan/deret";
import { bulanIni, bulanSetelah, selisihBulan } from "@/lib/ramalan/pilih";

const SUMBER = "ba_sales";
const FORMAT_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Rincian per bulan dipotong sampai sebanyak ini, supaya jawaban tetap bisa dibaca. */
const MAKS_RINCIAN_BULAN = 24;
const MAKS_MEREK = 10;

const RELATIF = ["bulan_ini", "bulan_lalu", "tahun_ini", "tahun_lalu"] as const;
type Relatif = (typeof RELATIF)[number];

/** Rentang bulan untuk kata seperti "bulan lalu". Dihitung di sini, bukan oleh model. */
function rentangRelatif(r: Relatif, sekarang: string): { dari: string; sampai: string } {
  const tahun = Number(sekarang.slice(0, 4));
  if (r === "bulan_ini") return { dari: sekarang, sampai: sekarang };
  if (r === "tahun_ini") return { dari: `${tahun}-01`, sampai: sekarang };
  if (r === "tahun_lalu") return { dari: `${tahun - 1}-01`, sampai: `${tahun - 1}-12` };
  const [y, m] = sekarang.split("-").map(Number);
  const lalu = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { dari: lalu, sampai: lalu };
}

type Baris = { bulan: string; unit: string; rupiah: string };

/** `sekarang` hanya diisi uji, supaya hasilnya tidak bergantung tanggal menjalankannya. */
export function buatToolTotalPenjualan(sekarang: () => string = bulanIni) {
  return createTool({
    name: "total_penjualan",
    description:
      "Menjumlahkan penjualan yang SUDAH terjadi per bulan: total unit dan rupiah, seluruh produk, " +
      "satu produk, atau satu merek. Pakai untuk pertanyaan seperti 'total penjualan bulan lalu', " +
      "'penjualan tahun ini', atau 'penjualan produk X Juni 2026'. Untuk bulan ke depan pakai ramalan, " +
      "bukan tool ini. " +
      "⚠️ PANGGIL DULU, jangan menghitung tanggal sendiri: untuk kata 'bulan lalu' atau 'tahun ini' " +
      "isi `relatif`. ⚠️ Kalau pertanyaan menyebut bulan atau tahun (mis. 'September 2026'), WAJIB isi " +
      "`dari` dan `sampai`; mengosongkan semuanya berarti bulan data TERAKHIR, bukan bulan yang ditanyakan. " +
      "⚠️ Kalau hasilnya `data-belum-ada`, sampaikan bahwa data bulan itu belum ada, " +
      "JANGAN menyebutnya nol atau tidak ada penjualan.",
    parameters: z.object({
      relatif: z.enum(RELATIF).optional().describe("Isi kalau user menyebut bulan ini, bulan lalu, tahun ini, atau tahun lalu."),
      dari: z.string().optional().describe("Bulan awal, format YYYY-MM."),
      sampai: z.string().optional().describe("Bulan akhir, format YYYY-MM."),
      produk: z.string().optional().describe("Nama produk atau kode SKU dari kata user. Kosongkan untuk semua produk."),
      merek: z.string().optional().describe("Nama merek. Kosongkan untuk semua merek."),
    }),
    execute: async ({ relatif, dari, sampai, produk, merek }: {
      relatif?: Relatif; dari?: string; sampai?: string; produk?: string; merek?: string;
    }) => {
      const akhirData = await bulanTerakhirData();
      if (!akhirData) return { status: "tidak-bisa", pesan: "Tabel penjualan bulanan kosong." };

      // Model kadang mengirim teks kosong untuk parameter yang tidak dipakai.
      const awal = dari?.trim() || undefined;
      const akhir = sampai?.trim() || undefined;
      // ⚠️ RCA 24 Nov 2026 (F.6): kalau ketiganya kosong, rentangnya bulan data terakhir — dan dulu itu terjadi
      // DIAM-DIAM. Model menerima angka Oktober untuk pertanyaan September, lalu menyimpulkan "September tidak
      // ada". Data tetap dikembalikan (pertanyaan "terbaru" sah), tetapi ditandai `periode_otomatis`.
      const periodeOtomatis = !relatif && !awal && !akhir;
      const rentang = relatif
        ? rentangRelatif(relatif, sekarang())
        : { dari: awal ?? akhir ?? akhirData, sampai: akhir ?? awal ?? akhirData };

      if (!FORMAT_BULAN.test(rentang.dari) || !FORMAT_BULAN.test(rentang.sampai)) {
        return { status: "tidak-bisa", pesan: "Format bulan harus YYYY-MM, misalnya 2026-06." };
      }
      if (rentang.dari > rentang.sampai) {
        return { status: "tidak-bisa", pesan: `Bulan awal ${rentang.dari} sesudah bulan akhir ${rentang.sampai}.` };
      }

      const syarat = ["source = $1", "period >= $2::date", "period <= $3::date"];
      const nilai: unknown[] = [SUMBER, `${rentang.dari}-01`, `${rentang.sampai}-01`];
      // Bulan yang belum ada di tabel dihitung dari data mentah, hanya bulan penuh.
      const sambung = await batasSambung();
      let dataBulanan = "ai_forecast_sales_monthly";
      if (sambung) {
        nilai.push(sambung.dari, sambung.sebelum);
        const [d, s] = [nilai.length - 1, nilai.length];
        dataBulanan = `(SELECT source, period, sku_code, brand, qty, value FROM ai_forecast_sales_monthly
                        UNION ALL
                        SELECT $1, date_trunc('month', t.trx_date)::date, t.item_code, m.brand, t.qty, t.qty * t.price
                          FROM trx_ba_sales t
                          LEFT JOIN (SELECT sku_code, max(brand) AS brand FROM ai_forecast_sales_monthly
                                      WHERE source = $1 GROUP BY 1) m ON m.sku_code = t.item_code
                         WHERE t.item_code IS NOT NULL AND t.trx_date >= $${d}::date AND t.trx_date < $${s}::date) AS bulanan`;
      }
      let namaProduk: { kode: string; nama: string } | undefined;

      const kataProduk = produk?.trim();
      if (kataProduk) {
        const calon = await cariSku(kataProduk, 8);
        if (calon.length === 0) {
          return { status: "tidak-ketemu", pesan: `Produk "${kataProduk}" tidak ada di data penjualan bulanan.` };
        }
        if (calon.length > 1) {
          return {
            status: "perlu-diperjelas",
            pesan: `Ada ${calon.length} produk yang cocok dengan "${kataProduk}". Yang mana?`,
            pilihan: calon.map((c) => ({ kode: c.sku, nama: c.nama, riwayat_bulan: c.bulan, data_terakhir: c.terakhir })),
          };
        }
        namaProduk = { kode: calon[0].sku, nama: calon[0].nama };
        nilai.push(calon[0].sku);
        syarat.push(`sku_code = $${nilai.length}`);
      }

      const kataMerek = merek?.trim();
      if (kataMerek) {
        nilai.push(kataMerek);
        syarat.push(`brand ILIKE '%' || $${nilai.length} || '%'`);
      }

      const where = syarat.join(" AND ");
      const { rows } = await poolPerusahaan().query<Baris>(
        `SELECT to_char(period, 'YYYY-MM') AS bulan, sum(qty)::text AS unit, sum(value)::text AS rupiah
           FROM ${dataBulanan} WHERE ${where} GROUP BY 1 HAVING sum(qty) <> 0 OR sum(value) <> 0 ORDER BY 1`,
        nilai,
      );

      const jumlahBulan = selisihBulan(rentang.dari, rentang.sampai) + 1;
      const semuaBulan = [rentang.dari, ...bulanSetelah(rentang.dari, jumlahBulan - 1)];
      // Bulan sesudah akhir tabel belum dilaporkan. Bulan sebelumnya yang kosong memang
      // tidak ada penjualan untuk pilihan ini.
      const belumAda = semuaBulan.filter((b) => b > akhirData);
      const batasTabel = sambung?.dari.slice(0, 7);
      const tabelSumber = [
        ...(!batasTabel || rentang.dari < batasTabel ? ["ai_forecast_sales_monthly"] : []),
        ...(batasTabel && rentang.sampai >= batasTabel ? ["trx_ba_sales"] : []),
      ];
      const dasar = {
        tabel_sumber: tabelSumber,
        periode: { dari: rentang.dari, sampai: rentang.sampai },
        data_perusahaan_sampai: akhirData,
        sumber: "penjualan lewat BA (ba_sales), belum tentu seluruh penjualan perusahaan",
        ...(namaProduk ? { produk: namaProduk } : {}),
        ...(kataMerek ? { merek: kataMerek } : {}),
        ...(periodeOtomatis ? {
          periode_otomatis: true,
          catatan_periode: `Periode TIDAK disebut di argumen, jadi yang dihitung bulan data terakhir (${akhirData}). ` +
            `Sebut bulan itu ke pengguna. Kalau pertanyaannya menyebut bulan atau tahun lain, panggil ulang dengan ` +
            "`dari`/`sampai` — JANGAN menyimpulkan data bulan yang ditanyakan tidak ada.",
        } : {}),
      };

      if (belumAda.length === semuaBulan.length) {
        return {
          status: "data-belum-ada",
          pesan: `Data penjualan baru sampai ${akhirData}, jadi ${rentang.dari} sampai ${rentang.sampai} belum bisa dihitung.`,
          ...dasar,
          catatan: `Tawarkan total ${akhirData} sebagai data terakhir yang ada. Jangan menyebut angka untuk bulan yang diminta.`,
        };
      }

      const totalUnit = rows.reduce((a, r) => a + Number(r.unit), 0);
      const totalRupiah = rows.reduce((a, r) => a + Number(r.rupiah), 0);

      let perMerek: { merek: string; unit: number; rupiah: number }[] | undefined;
      if (!namaProduk && !kataMerek && rows.length > 0) {
        const m = await poolPerusahaan().query<{ merek: string | null; unit: string; rupiah: string }>(
          `SELECT brand AS merek, sum(qty)::text AS unit, sum(value)::text AS rupiah
             FROM ${dataBulanan} WHERE ${where} GROUP BY 1 ORDER BY sum(value) DESC LIMIT ${MAKS_MEREK}`,
          nilai,
        );
        perMerek = m.rows.map((r) => ({
          merek: r.merek ?? "(tanpa merek)", unit: Math.round(Number(r.unit)), rupiah: Math.round(Number(r.rupiah)),
        }));
      }

      return {
        status: "siap",
        ...dasar,
        total_unit: Math.round(totalUnit),
        total_rupiah: Math.round(totalRupiah),
        bulan_berisi_data: rows.length,
        ...(belumAda.length > 0 ? { bulan_belum_ada_data: belumAda } : {}),
        ...(rows.length <= MAKS_RINCIAN_BULAN
          ? { per_bulan: rows.map((r) => ({ bulan: r.bulan, unit: Math.round(Number(r.unit)), rupiah: Math.round(Number(r.rupiah)) })) }
          : {}),
        ...(perMerek ? { per_merek_terbesar: perMerek } : {}),
        catatan:
          "Angka di atas hasil penjumlahan database, sampaikan apa adanya dan jangan menghitung ulang. " +
          "Sebut periode dan `sumber`, dan jangan menyebutnya total pendapatan perusahaan. " +
          (belumAda.length > 0
            ? "⚠️ Sebagian bulan belum ada datanya: sebut `bulan_belum_ada_data`, karena totalnya belum mencakup bulan itu. "
            : "") +
          (rows.length === 0 ? "Tidak ada penjualan tercatat untuk pilihan ini pada periode itu." : ""),
      };
    },
  });
}

/** Perubahan yang dianggap layak diperhatikan, dan penjualan minimal supaya tidak sekadar acak. */
export const AMBANG_GERAK_PERSEN = 20;
export const MIN_UNIT_PER_BULAN = 100;
const BATAS_LARIS = 1000;
// Tiap baris membawa petunjuk, dan batas model di server kantor hanya 8.192 token. Terlihat 5 Nov
// 2026: 10 turun + 10 naik membuat jawaban Gemma terpotong, sedangkan 10 satu arah aman.
const MAKS_SATU_ARAH = 10;
const MAKS_DUA_ARAH = 5;
const BULAN_PEMBANDING = 3;
/** Bulan berjalan yang datanya kurang dari ini terlalu sedikit untuk jadi pilihan bawaan. */
const MIN_HARI_BERJALAN = 7;

/** Selisih yang dianggap menonjol pada petunjuk. Di bawah ini wajar naik-turun. */
const BEDA_MENONJOL = 20;
const BEDA_HARGA_MENONJOL = 5;
const MIN_LAPORAN_KOSONG = 5;

type BarisPetunjuk = {
  kode: string; outlet: string | null; outlet_lalu: string | null;
  harga: string | null; harga_lalu: string | null; kosong: string; kosong_lalu: string;
};

const persen = (baru: number, lama: number) => (lama > 0 ? Math.round((baru / lama - 1) * 1000) / 10 : null);
const ribuan = (n: number) => Math.round(n).toLocaleString("id-ID");

/**
 * Hal lain yang berubah pada periode yang sama. Belum tentu penyebab, dan tidak disebut begitu.
 * Yang menonjol dihitung di sini, supaya model bahasa hanya menyampaikannya.
 */
export function susunPetunjuk(p: {
  unit: number; biasanyaUnit: number; outlet: number; outletLalu: number;
  harga: number | null; hargaLalu: number | null; kosong: number; kosongLalu: number;
}) {
  const perOutlet = p.outlet > 0 ? p.unit / p.outlet : 0;
  const perOutletLalu = p.outletLalu > 0 ? p.biasanyaUnit / p.outletLalu : 0;
  const bedaOutlet = persen(p.outlet, p.outletLalu);
  const bedaPerOutlet = persen(perOutlet, perOutletLalu);
  const bedaHarga = p.harga !== null && p.hargaLalu !== null ? persen(p.harga, p.hargaLalu) : null;

  const menonjol: string[] = [];
  const turunNaik = (x: number) => (x < 0 ? "berkurang" : "bertambah");
  if (p.unit === 0) menonjol.push("tidak ada penjualan tercatat pada periode ini");
  if (bedaOutlet !== null && Math.abs(bedaOutlet) >= BEDA_MENONJOL && p.unit > 0) {
    menonjol.push(`outlet yang menjual ${turunNaik(bedaOutlet)} ${Math.abs(bedaOutlet)}%`);
  }
  if (bedaPerOutlet !== null && Math.abs(bedaPerOutlet) >= BEDA_MENONJOL && p.unit > 0) {
    menonjol.push(`penjualan per outlet ${turunNaik(bedaPerOutlet)} ${Math.abs(bedaPerOutlet)}%`);
  }
  if (bedaHarga !== null && Math.abs(bedaHarga) >= BEDA_HARGA_MENONJOL) {
    menonjol.push(`harga rata-rata ${bedaHarga < 0 ? "turun" : "naik"} ${Math.abs(bedaHarga)}%`);
  }
  if (p.kosong >= MIN_LAPORAN_KOSONG && p.kosong >= 2 * Math.max(p.kosongLalu, 1)) {
    menonjol.push(`laporan stok kosong naik dari ${ribuan(p.kosongLalu)} ke ${ribuan(p.kosong)}`);
  }
  return {
    outlet: `${ribuan(p.outletLalu)} ke ${ribuan(p.outlet)}`,
    unit_per_outlet: `${ribuan(perOutletLalu)} ke ${ribuan(perOutlet)}`,
    harga_rata_rata: p.harga !== null && p.hargaLalu !== null ? `Rp${ribuan(p.hargaLalu)} ke Rp${ribuan(p.harga)}` : "tidak bisa dihitung",
    laporan_stok_kosong: `${ribuan(p.kosongLalu)} ke ${ribuan(p.kosong)}`,
    // Namanya sendiri membawa peringatannya: model sering menjadikan nama kunci judul kolom tabel,
    // sedangkan kalimat `wajib_ditulis` kadang dilewati (pertanyaan produk naik, 5 Nov 2026).
    berubah_bersamaan_belum_tentu_penyebab: menonjol.length > 0 ? menonjol : ["tidak ada yang menonjol dari data ini"],
  };
}

type BarisGerak = {
  kode: string; nama: string | null; merek: string | null;
  unit: string; pembanding_unit: string; rupiah: string; pembanding_rupiah: string;
};

const geserBulan = (bulan: string, n: number) => {
  const [y, m] = bulan.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/**
 * Produk yang penjualannya berubah jauh dari biasanya.
 *
 * Angka fakta, bukan ramalan: dibandingkan dengan rata-rata 3 bulan sebelumnya. Bulan yang belum
 * selesai dibandingkan hari-untuk-hari, karena kalau tidak, tiap awal bulan semua produk terlihat
 * anjlok. Penyebabnya tidak ditebak.
 *
 * ⚠️ TANGGAL DATA WAJIB TERBAWA. Data di server bisa berhenti diperbarui (terlihat 5 Nov 2026:
 * berhenti di 18 Okt), dan "bulan ini turun" dari data lama menyesatkan kalau tidak disebut.
 */
export function buatToolPergerakanPenjualan(sekarang: () => string = bulanIni) {
  return createTool({
    name: "pergerakan_penjualan",
    description:
      "Daftar produk yang penjualannya turun atau naik jauh dari biasanya, dibanding rata-rata 3 bulan " +
      "sebelumnya atau dibanding satu bulan tertentu. Pakai untuk pertanyaan seperti 'produk apa yang turun " +
      "bulan ini', 'produk apa yang lagi naik', atau 'yang turun dari Agustus ke September'. Untuk bulan ke depan pakai ramalan, untuk jumlah total pakai total penjualan. " +
      "⚠️ PANGGIL DULU. ⚠️ Sebut periode dan tanggal data terakhir. JANGAN menebak penyebabnya.",
    parameters: z.object({
      bulan: z.string().optional().describe("Bulan, format YYYY-MM. WAJIB diisi kalau user menyebut bulan; kosongkan HANYA untuk data terbaru."),
      relatif: z.enum(["bulan_ini", "bulan_lalu"]).optional().describe("Isi kalau user menyebut bulan ini atau bulan lalu."),
      dibanding_bulan: z.string().optional().describe(
        "Bulan pembanding, format YYYY-MM, kalau user menyebut dua bulan. 'dari Agustus ke September 2026' berarti bulan 2026-09 dan dibanding_bulan 2026-08. Kosongkan untuk rata-rata 3 bulan sebelumnya.",
      ),
      arah: z.enum(["turun", "naik", "semua"]).optional().describe("Kosongkan untuk keduanya."),
      merek: z.string().optional().describe("Nama merek. Kosongkan untuk semua merek."),
    }),
    execute: async ({ bulan, relatif, dibanding_bulan, arah, merek }: {
      bulan?: string; relatif?: "bulan_ini" | "bulan_lalu"; dibanding_bulan?: string;
      arah?: "turun" | "naik" | "semua"; merek?: string;
    }) => {
      const { rows: akhir } = await poolPerusahaan().query<{ d: string | null }>(
        `SELECT to_char(max(trx_date), 'YYYY-MM-DD') AS d FROM trx_ba_sales WHERE trx_date <= current_date AND item_code IS NOT NULL`);
      const terakhir = akhir[0]?.d;
      if (!terakhir) return { status: "tidak-bisa", pesan: "Data penjualan kosong." };

      const bulanData = terakhir.slice(0, 7);
      const hariData = Number(terakhir.slice(8));
      const akhirBulanData = new Date(Date.UTC(Number(bulanData.slice(0, 4)), Number(bulanData.slice(5)), 0)).getUTCDate();
      const dataPenuh = hariData === akhirBulanData;
      const sekarangBulan = sekarang();

      const pilihan = bulan?.trim() || undefined;
      let sasaran: string;
      if (relatif) sasaran = relatif === "bulan_ini" ? sekarangBulan : geserBulan(sekarangBulan, -1);
      else if (pilihan) sasaran = pilihan;
      else sasaran = !dataPenuh && hariData < MIN_HARI_BERJALAN ? geserBulan(bulanData, -1) : bulanData;

      const lawan = dibanding_bulan?.trim() || undefined;
      if (!FORMAT_BULAN.test(sasaran) || (lawan && !FORMAT_BULAN.test(lawan))) {
        return { status: "tidak-bisa", pesan: "Format bulan harus YYYY-MM, misalnya 2026-09." };
      }
      if (lawan && lawan >= sasaran) {
        return { status: "tidak-bisa", pesan: `Bulan pembanding ${lawan} harus sebelum ${sasaran}.` };
      }
      const dasar = { data_terakhir_tanggal: terakhir, sumber: "penjualan lewat BA, data harian" };
      if (sasaran > bulanData) {
        return {
          status: "data-belum-ada",
          pesan: `Data penjualan baru sampai ${terakhir}, jadi ${sasaran} belum bisa dibandingkan.`,
          ...dasar,
          catatan: `Tawarkan melihat ${bulanData} sebagai data terbaru. JANGAN menyebutnya tidak ada penjualan.`,
        };
      }

      // Bulan yang datanya belum penuh dibandingkan pada rentang tanggal yang sama.
      const sampaiHari = sasaran === bulanData && !dataPenuh ? hariData : null;
      const laluDari = `${lawan ?? geserBulan(sasaran, -BULAN_PEMBANDING)}-01`;
      const laluSebelum = `${lawan ? geserBulan(lawan, 1) : sasaran}-01`;
      const jumlahLalu = lawan ? 1 : BULAN_PEMBANDING;
      const nilai: unknown[] = [
        `${sasaran}-01`, `${geserBulan(sasaran, 1)}-01`, laluDari,
        sampaiHari, SUMBER, jumlahLalu, laluSebelum, Math.min(2, jumlahLalu),
        MIN_UNIT_PER_BULAN * (sampaiHari ? sampaiHari / 30 : 1),
      ];
      const kataMerek = merek?.trim();
      if (kataMerek) nilai.push(kataMerek);
      const { rows } = await poolPerusahaan().query<BarisGerak>(
        `WITH sasaran AS (
           SELECT item_code AS kode, sum(qty) AS q, sum(qty * price) AS v FROM trx_ba_sales
            WHERE item_code IS NOT NULL AND trx_date >= $1::date AND trx_date < $2::date GROUP BY 1),
         lalu AS (
           SELECT item_code AS kode, sum(qty) / $6::numeric AS q, sum(qty * price) / $6::numeric AS v
             FROM trx_ba_sales
            WHERE item_code IS NOT NULL AND trx_date >= $3::date AND trx_date < $7::date
              AND ($4::int IS NULL OR extract(day FROM trx_date) <= $4::int)
            GROUP BY 1
           -- Terjual di minimal 2 dari 3 bulan: produk yang baru hidup lagi bukan pembanding yang adil.
           HAVING count(DISTINCT date_trunc('month', trx_date)) FILTER (WHERE qty > 0) >= $8::int),
         katalog AS (
           SELECT sku_code, max(sku_name) AS nama, max(brand) AS merek FROM ai_forecast_sales_monthly
            WHERE source = $5 GROUP BY 1)
         SELECT l.kode, k.nama, k.merek, coalesce(s.q, 0)::text AS unit, l.q::text AS pembanding_unit,
                coalesce(s.v, 0)::text AS rupiah, l.v::text AS pembanding_rupiah
           FROM lalu l LEFT JOIN sasaran s USING (kode) LEFT JOIN katalog k ON k.sku_code = l.kode
          WHERE l.q >= $9::numeric ${kataMerek ? `AND k.merek ILIKE '%' || $10 || '%'` : ""}`,
        nilai,
      );

      const perProduk = rows.map((r) => {
        const unit = Number(r.unit);
        const pembanding = Number(r.pembanding_unit);
        return {
          kode: r.kode,
          nama: (r.nama ?? r.kode).replace(/\s+/g, " ").trim(),
          merek: r.merek,
          unit: Math.round(unit),
          biasanya_unit: Math.round(pembanding),
          perubahan_persen: Math.round((unit / pembanding - 1) * 1000) / 10,
          rupiah: Math.round(Number(r.rupiah)),
          biasanya_rupiah: Math.round(Number(r.pembanding_rupiah)),
          laris: pembanding >= BATAS_LARIS * (sampaiHari ? sampaiHari / 30 : 1),
        };
      });
      // Selisih terbesar dulu: turun 30% dari 20.000 unit lebih penting daripada 50% dari 100 unit.
      const urut = (a: { unit: number; biasanya_unit: number }, b: { unit: number; biasanya_unit: number }) =>
        Math.abs(b.unit - b.biasanya_unit) - Math.abs(a.unit - a.biasanya_unit);
      const turun = perProduk.filter((p) => p.perubahan_persen <= -AMBANG_GERAK_PERSEN).sort(urut);
      const naik = perProduk.filter((p) => p.perubahan_persen >= AMBANG_GERAK_PERSEN).sort(urut);
      const mau = arah ?? "semua";
      const maks = mau === "semua" ? MAKS_DUA_ARAH : MAKS_SATU_ARAH;

      const tampil = [...(mau !== "naik" ? turun.slice(0, maks) : []), ...(mau !== "turun" ? naik.slice(0, maks) : [])];
      const petunjuk = new Map<string, ReturnType<typeof susunPetunjuk>>();
      if (tampil.length > 0) {
        const { rows: bukti } = await poolPerusahaan().query<BarisPetunjuk>(
          `WITH jual AS (
             SELECT item_code AS kode, date_trunc('month', trx_date) AS b, count(DISTINCT id_customer) FILTER (WHERE qty > 0) AS o,
                    sum(qty) AS q, sum(qty * price) AS v
               FROM trx_ba_sales
              WHERE item_code = ANY($1) AND (trx_date >= $4::date AND trx_date < $3::date OR trx_date >= $2::date AND trx_date < $7::date)
                AND ($5::int IS NULL OR extract(day FROM trx_date) <= $5::int)
              GROUP BY 1, 2),
           -- Hanya outlet yang melapor stok kosong di SETIAP bulan kedua periode. Jumlah outlet pelapor melonjak
           -- dari sekitar 35 (Jul 2026) ke 169 (Agu 2026), jadi tanpa ini "laporan naik" sering
           -- berarti pelapornya yang bertambah, bukan barangnya yang makin sering habis (6 Nov 2026).
           pelapor AS (
             SELECT id_customer FROM trx_ba_oos
              WHERE (trx_date >= $4::date AND trx_date < $3::date OR trx_date >= $2::date AND trx_date < $7::date)
                AND ($5::int IS NULL OR extract(day FROM trx_date) <= $5::int)
              GROUP BY 1
             -- Tiap bulan pembanding, bukan salah satunya: outlet yang baru mulai melapor Agustus membuat
             -- rata-rata Jun-Agu terlalu kecil, jadi laporannya tetap terlihat naik.
             HAVING bool_or(trx_date >= $4::date)
                AND count(DISTINCT date_trunc('month', trx_date)) FILTER (WHERE trx_date < $4::date) = $6::int),
           kosong AS (
             SELECT item_code AS kode, count(*) FILTER (WHERE trx_date >= $4::date) AS k,
                    count(*) FILTER (WHERE trx_date < $4::date) / $6::numeric AS l
               FROM trx_ba_oos
              WHERE item_code = ANY($1) AND (trx_date >= $4::date AND trx_date < $3::date OR trx_date >= $2::date AND trx_date < $7::date)
                AND ($5::int IS NULL OR extract(day FROM trx_date) <= $5::int)
                AND id_customer IN (SELECT id_customer FROM pelapor)
              GROUP BY 1)
           SELECT d.kode,
                  (sum(j.o) FILTER (WHERE j.b >= $4::date))::text AS outlet,
                  (coalesce(sum(j.o) FILTER (WHERE j.b < $4::date), 0) / $6::numeric)::text AS outlet_lalu,
                  (sum(j.v) FILTER (WHERE j.b >= $4::date) / nullif(sum(j.q) FILTER (WHERE j.b >= $4::date), 0))::text AS harga,
                  (sum(j.v) FILTER (WHERE j.b < $4::date) / nullif(sum(j.q) FILTER (WHERE j.b < $4::date), 0))::text AS harga_lalu,
                  coalesce(max(o.k), 0)::text AS kosong, coalesce(max(o.l), 0)::text AS kosong_lalu
             FROM unnest($1::text[]) AS d(kode)
             LEFT JOIN jual j USING (kode) LEFT JOIN kosong o USING (kode)
            GROUP BY d.kode`,
          [tampil.map((p) => p.kode), laluDari, `${geserBulan(sasaran, 1)}-01`,
           `${sasaran}-01`, sampaiHari, jumlahLalu, laluSebelum],
        );
        const perKode = new Map(tampil.map((p) => [p.kode, p]));
        for (const b of bukti) {
          const p = perKode.get(b.kode);
          if (!p) continue;
          petunjuk.set(b.kode, susunPetunjuk({
            unit: p.unit, biasanyaUnit: p.biasanya_unit,
            outlet: Number(b.outlet ?? 0), outletLalu: Number(b.outlet_lalu ?? 0),
            harga: b.harga === null ? null : Number(b.harga), hargaLalu: b.harga_lalu === null ? null : Number(b.harga_lalu),
            kosong: Number(b.kosong), kosongLalu: Number(b.kosong_lalu),
          }));
        }
      }
      const denganPetunjuk = <T extends { kode: string }>(x: T) => ({ ...x, petunjuk: petunjuk.get(x.kode) });

      const { rows: pelapor } = await poolPerusahaan().query<{ sekarang: string; lalu: string; tetap: string }>(
        `WITH p AS (
           SELECT id_customer, bool_or(trx_date >= $3::date) AS s,
                  count(DISTINCT date_trunc('month', trx_date)) FILTER (WHERE trx_date < $3::date) = $6::int AS l FROM trx_ba_oos
            WHERE (trx_date >= $3::date AND trx_date < $2::date OR trx_date >= $1::date AND trx_date < $5::date)
              AND ($4::int IS NULL OR extract(day FROM trx_date) <= $4::int)
            GROUP BY 1)
         -- Pelapor periode pembanding dirata-rata PER BULAN: gabungan 3 bulan menyembunyikan lonjakannya.
         SELECT count(*) FILTER (WHERE s)::text AS sekarang,
                (SELECT count(DISTINCT (date_trunc('month', trx_date), id_customer)) / $6::numeric FROM trx_ba_oos
                  WHERE trx_date >= $1::date AND trx_date < $5::date
                    AND ($4::int IS NULL OR extract(day FROM trx_date) <= $4::int))::text AS lalu,
                count(*) FILTER (WHERE s AND l)::text AS tetap FROM p`,
        [laluDari, `${geserBulan(sasaran, 1)}-01`, `${sasaran}-01`, sampaiHari, laluSebelum, jumlahLalu],
      );
      const pl = pelapor[0];

      return {
        status: "siap",
        ...dasar,
        tabel_sumber: ["trx_ba_sales", "trx_ba_oos"],
        periode: sampaiHari ? `${sasaran} tanggal 1-${sampaiHari} (bulan belum penuh)` : sasaran,
        dibanding: (lawan ?? `rata-rata ${geserBulan(sasaran, -BULAN_PEMBANDING)} sampai ${geserBulan(sasaran, -1)}`) +
          (sampaiHari ? `, tanggal 1-${sampaiHari} saja` : ""),
        aturan: `perubahan minimal ${AMBANG_GERAK_PERSEN}%, produk minimal ${MIN_UNIT_PER_BULAN} unit per bulan`,
        ...(kataMerek ? { merek: kataMerek } : {}),
        laporan_stok_kosong_dihitung:
          `hanya dari ${ribuan(Number(pl?.tetap ?? 0))} outlet yang melapor stok kosong di setiap bulan kedua periode ` +
          `(outlet pelapor per bulan: ${ribuan(Number(pl?.lalu ?? 0))} di periode pembanding, ${ribuan(Number(pl?.sekarang ?? 0))} di periode ini)`,
        jumlah_produk_diperiksa: perProduk.length,
        jumlah_produk_laris: perProduk.filter((p) => p.laris).length,
        jumlah_turun: turun.length,
        jumlah_naik: naik.length,
        ...(mau !== "naik" ? { turun: turun.slice(0, maks).map(denganPetunjuk) } : {}),
        ...(mau !== "turun" ? { naik: naik.slice(0, maks).map(denganPetunjuk) } : {}),
        wajib_ditulis: "Petunjuk di atas adalah hal yang berubah bersamaan, belum tentu penyebabnya.",
        catatan:
"Daftar `turun` dan `naik` di atas adalah jawabannya: sampaikan, jangan bilang datanya tidak ada. Sampaikan periode, pembanding, dan `data_terakhir_tanggal`. Angka di atas fakta dari database, jangan " +
          "dihitung ulang. Kalau daftarnya terpotong, sebut jumlah produk sebenarnya. Sampaikan `petunjuk.berubah_bersamaan_belum_tentu_penyebab` tiap " +
          "produk, dan tulis kalimat `wajib_ditulis` apa adanya di akhir jawaban. Kalau menyebut stok kosong, sebut juga `laporan_stok_kosong_dihitung`. " +
          "JANGAN menulis 'karena' atau menebak alasan lain.",
      };
    },
  });
}
