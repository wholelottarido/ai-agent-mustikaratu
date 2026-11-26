/**
 * Mengambil deret penjualan bulanan per SKU, siap diramal.
 *
 * ============================================================
 * SUMBERNYA TABEL TIM LAIN, DAN ITU KEPUTUSAN SADAR
 * ============================================================
 * `ai_knowledge`-nya peramalan: `ai_forecast_sales_monthly` sudah ada, sudah
 * terisi 34.431 baris dari `ba_sales`, dan `ai_readonly` boleh membacanya.
 *
 * Membangun agregasi sendiri di sampingnya berarti DUA angka penjualan
 * bulanan yang pelan-pelan berbeda, dan tidak ada yang tahu mana yang benar.
 * Diputuskan pemilik proyek 26 Okt 2026: pakai yang sudah ada.
 *
 * ⚠️ TABELNYA TERTINGGAL. Agregasi bulanannya berhenti di 1 Jul 2026, sedangkan
 * `trx_ba_sales` sampai 18 Okt 2026. Keputusan 26 Okt 2026 untuk tidak melengkapi
 * diubah pemilik proyek 4 Nov 2026: bulan yang belum ada di tabel dihitung saat dibaca
 * dari data mentah, hanya kalau bulannya sudah PENUH. Tabel bersama itu tetap tidak
 * disentuh. Diperiksa 4 Nov 2026: Jan-Jul 2026 keduanya sama persis, unit maupun rupiah.
 *
 * ============================================================
 * ⚠️ BULAN YANG HILANG DIISI 0, BUKAN DILEWATI
 * ============================================================
 * Ini keputusan yang paling menentukan di berkas ini.
 *
 * Baris yang tidak ada di tabel berarti SKU itu tidak terjual bulan itu —
 * bukan "datanya belum masuk". Jadi nilainya 0, dan 0 itu informasi.
 *
 * Kalau titik-titik yang ada dirangkai begitu saja jadi deret berurutan,
 * jaraknya jadi bohong: `RH LEMONGGRASS ESS OIL` punya 27 bulan data yang
 * tersebar di rentang 85 bulan. Dirangkai tanpa mengisi lubangnya, model akan
 * melihat 27 bulan berurutan yang tidak pernah ada, lalu meramal pola yang
 * tidak pernah terjadi — tanpa satu pun galat.
 *
 * Diukur 26 Okt 2026: dari 420 SKU yang punya >=26 bulan data, cuma **161**
 * yang deretnya utuh. Jadi ini bukan kasus tepi, ini mayoritas.
 *
 * `diisi` dipulangkan supaya pemanggil tahu seberapa banyak deret itu
 * sebenarnya tebakan. Deret 85 bulan yang 58 di antaranya nol tidak pantas
 * diperlakukan sama dengan deret 85 bulan yang terisi penuh.
 */
import { poolPerusahaan } from "../db-perusahaan";

/** Sumber yang dipakai. Tabelnya juga memuat `dummy`; itu bukan data nyata. */
const SUMBER = "ba_sales";

/**
 * Berapa titik minimal untuk tiap model.
 *
 * ⚠️ ANGKA ARIMA BUKAN SELERA — diukur 26 Okt 2026. Paket `arima` menolak
 * deret pendek dengan `Series too short (24 values). Minimum length for these
 * parameters is 26`. Jadi 26 itu batas kerasnya, bukan anjuran.
 *
 * Musiman butuh 12 supaya ada "bulan yang sama tahun lalu" untuk disalin.
 */
export const MIN_ARIMA = 26;
export const MIN_MUSIMAN = 12;

/**
 * Model terjauh yang MUNGKIN untuk sebuah deret.
 *
 * ⚠️ "Mungkin", bukan "terbaik". Yang menentukan model mana yang dipakai
 * adalah backtest di tahap berikutnya — dan dari pengukuran 26 Okt 2026,
 * AutoARIMA KALAH dari Naive di 2 dari 3 produk yang diuji. Kelayakan di sini
 * cuma menyaring yang mustahil.
 */
export type Kelayakan = "naive" | "musiman" | "arima";

export type DeretSku = {
  sku: string;
  nama: string;
  merek: string | null;
  /** Bulan berurutan tanpa lubang, `YYYY-MM`. */
  bulan: string[];
  /** Jumlah terjual per bulan. Sejajar dengan `bulan`. */
  qty: number[];
  /** Nilai rupiah per bulan. Sejajar dengan `bulan`. */
  value: number[];
  /** Berapa bulan yang TIDAK ada barisnya lalu diisi 0. */
  diisi: number;
  /** Bulan terakhir yang ada datanya. Untuk disebut apa adanya ke pemakai. */
  bulanTerakhir: string;
  kelayakan: Kelayakan;
};

export type HasilDeret =
  | { ok: true; deret: DeretSku }
  | { ok: false; sebab: "tidak-ketemu" | "terlalu-pendek"; pesan: string };

type Baris = { period: string; qty: string; value: string; sku_name: string; brand: string | null };

/** `YYYY-MM` dari sebuah `Date` UTC, tanpa bergantung zona waktu mesin. */
function kunciBulan(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Daftar bulan berurutan dari `awal` sampai `akhir`, inklusif. */
function rentangBulan(awal: string, akhir: string): string[] {
  const [ta, ba] = awal.split("-").map(Number);
  const [tz, bz] = akhir.split("-").map(Number);
  const keluar: string[] = [];
  for (let t = ta, b = ba; t < tz || (t === tz && b <= bz); ) {
    keluar.push(`${t}-${String(b).padStart(2, "0")}`);
    b += 1;
    if (b > 12) { b = 1; t += 1; }
  }
  return keluar;
}

function nilaiKelayakan(panjang: number): Kelayakan {
  if (panjang >= MIN_ARIMA) return "arima";
  if (panjang >= MIN_MUSIMAN) return "musiman";
  return "naive";
}

/**
 * Deret bulanan satu SKU, lubangnya sudah diisi 0.
 *
 * `sku` dicocokkan PERSIS dengan `sku_code`. Pencarian berdasarkan nama ada
 * di `cariSku()` di bawah — dipisah supaya yang satu bisa diuji tanpa yang
 * lain, dan supaya pemanggil yang sudah punya kodenya tidak membayar
 * pencarian teks.
 */
export async function deretSku(sku: string): Promise<HasilDeret> {
  const [{ rows: dariTabel }, sambung] = await Promise.all([
    poolPerusahaan().query<Baris>(
      `SELECT to_char(period, 'YYYY-MM') AS period,
              qty::text, value::text, sku_name, brand
         FROM ai_forecast_sales_monthly
        WHERE source = $1 AND sku_code = $2
        ORDER BY period`,
      [SUMBER, sku],
    ),
    batasSambung(),
  ]);
  const rows = dariTabel;
  if (rows.length > 0 && sambung) {
    const { rows: mentah } = await poolPerusahaan().query<{ period: string; qty: string; value: string }>(
      `SELECT to_char(trx_date, 'YYYY-MM') AS period, sum(qty)::text AS qty, sum(qty * price)::text AS value
         FROM trx_ba_sales
        WHERE item_code = $1 AND trx_date >= $2::date AND trx_date < $3::date
        GROUP BY 1 ORDER BY 1`,
      [sku, sambung.dari, sambung.sebelum],
    );
    for (const m of mentah) {
      // Bulan tanpa jumlah bukan penjualan: isinya hanya laporan alasan BA seperti cuti.
      if (Number(m.qty) === 0 && Number(m.value) === 0) continue;
      rows.push({ ...rows[0], ...m });
    }
  }
  if (rows.length === 0) {
    return { ok: false, sebab: "tidak-ketemu", pesan: `SKU "${sku}" tidak ada di data penjualan bulanan.` };
  }

  // ⚠️ Deret SATU titik tidak bisa diramal model mana pun — Naive sekalipun
  // cuma akan mengulang satu angka tanpa dasar apa pun. Ditolak di sini,
  // bukan dibiarkan jadi "ramalan" yang isinya satu angka yang sama.
  if (rows.length < 2) {
    return {
      ok: false,
      sebab: "terlalu-pendek",
      pesan:
        `SKU "${sku}" baru memiliki ${rows.length} bulan riwayat penjualan. ` +
        "Datanya belum cukup untuk membuat ramalan yang dapat dipercaya; ini bukan kerusakan sistem.",
    };
  }

  const ada = new Map(rows.map((r) => [r.period, r]));
  const bulan = rentangBulan(rows[0].period, rows[rows.length - 1].period);

  const qty: number[] = [];
  const value: number[] = [];
  let diisi = 0;
  for (const b of bulan) {
    const r = ada.get(b);
    if (r) {
      qty.push(Number(r.qty));
      value.push(Number(r.value));
    } else {
      // Tidak ada baris = tidak terjual bulan itu. Lihat catatan di kepala berkas.
      qty.push(0);
      value.push(0);
      diisi += 1;
    }
  }

  return {
    ok: true,
    deret: {
      sku,
      nama: rows[0].sku_name,
      merek: rows[0].brand,
      bulan,
      qty,
      value,
      diisi,
      bulanTerakhir: rows[rows.length - 1].period,
      kelayakan: nilaiKelayakan(bulan.length),
    },
  };
}

/** Spasi dibuang dan huruf diseragamkan, untuk membandingkan dua nama. */
function samakan(nama: string): string {
  return nama.replace(/\s+/g, "").toUpperCase();
}

/**
 * Kode SKU di dalam teks, kalau ada: "1005998", atau "NAMA (kode 1005998)".
 *
 * ⚠️ Bentuk kedua yang dikirim tombol pilih produk. Model bisa menulis ulang
 * nama produknya (tertangkap 3 Nov 2026: "RJ+M.ZAITUN" jadi "RJ + M.ZAITUN",
 * yang tidak ketemu), tapi kodenya tetap menunjuk produk yang sama.
 *
 * Teks satu kata cuma CALON kode. `cariSku` yang memastikannya ke database.
 */
export function kodeDariTeks(teks: string): string | null {
  const bersih = teks.trim();
  const m = bersih.match(/\bkode\s*:?\s*([A-Za-z0-9][A-Za-z0-9._-]*)/i);
  if (m) return m[1];
  // Model kadang membuang kata "kode": "NAMA (1005998)". Wajib memuat angka,
  // supaya "NAMA (REFILL)" tetap dicari sebagai nama.
  const kurung = bersih.match(/\(\s*([A-Za-z0-9._-]*\d[A-Za-z0-9._-]*)\s*\)\s*$/);
  if (kurung) return kurung[1];
  return /\s/.test(bersih) ? null : bersih;
}

export type CalonSku = { sku: string; nama: string; merek: string | null; bulan: number; terakhir: string };

/**
 * Mencari SKU dari potongan nama.
 *
 * ⚠️ MEMULANGKAN DAFTAR, BUKAN MEMILIHKAN. Pola yang sama dengan `cocokkan()`
 * di jalur tiket: yang ambigu dikembalikan sebagai pilihan, bukan ditebak.
 * "Minyak Zaitun" cocok ke beberapa ukuran kemasan, dan meramal yang salah
 * menghasilkan angka yang terlihat sah untuk produk yang bukan dimaksud.
 *
 * ⚠️ KECUALI kalau namanya PERSIS SAMA dengan salah satu calon — lihat
 * catatan di dalam kueri. Itu yang membuat tombol pilihan di layar bisa
 * selesai, dan membuat mengetik nama penuh berarti sesuatu.
 *
 * Diurutkan: yang persis dulu, lalu panjang riwayat, lalu nama. Bukan menurut
 * urutan database — urutan yang ditentukan supaya hasilnya tidak berubah
 * sendiri waktu tim lain menambah baris.
 */
export async function cariSku(kata: string, batas = 8): Promise<CalonSku[]> {
  const bersih = kata.trim();
  if (bersih.length < 3) return [];

  // ⚠️ KODE DIPERIKSA DULU, karena itu satu-satunya rujukan yang pasti (§7.1
  // spesifikasi tim sebelah). Tidak ketemu berarti lanjut ke pencarian nama:
  // "SHAMPO" juga satu kata, tapi itu nama, bukan kode yang salah.
  const kode = kodeDariTeks(bersih);
  if (kode) {
    const persis = await poolPerusahaan().query<{
      sku_code: string; sku_name: string; brand: string | null; bulan: number; terakhir: string;
    }>(
      `SELECT sku_code, max(sku_name) AS sku_name, max(brand) AS brand,
              count(*)::int AS bulan, to_char(max(period), 'YYYY-MM') AS terakhir
         FROM ai_forecast_sales_monthly
        WHERE source = $1 AND lower(sku_code) = lower($2)
        GROUP BY sku_code`,
      [SUMBER, kode],
    );
    if (persis.rows.length === 1) {
      const r = persis.rows[0];
      return lengkapiCalon([{ sku: r.sku_code, nama: r.sku_name, merek: r.brand, bulan: r.bulan, terakhir: r.terakhir }]);
    }
  }

  const { rows } = await poolPerusahaan().query<{
    sku_code: string; sku_name: string; brand: string | null; bulan: number; terakhir: string;
  }>(
    // ⚠️ SPASI DIBUANG DI KEDUA SISI SEBELUM DICOCOKKAN, bukan cuma dirapikan.
    //
    // Merapikan saja tidak cukup. Model bahasa menulis ulang nama yang dikirim
    // tombol: "RJ+M.ZAITUN 12ML" jadi "RJ + M.ZAITUN 12 ML" (4 dari 9 panggilan
    // Haiku, 3 Nov 2026), sering sambil membuang kodenya. Hasilnya "tidak
    // ditemukan", dan sekali model lalu mencoba produk LAIN. Membuang spasi tidak
    // menambah nama kembar: diukur tetap 1 grup dari 1737 produk.
    //
    // Sebelumnya, yang pertama ditemukan:
    //
    // 589 dari 1737 nama produk (34%) memuat spasi ganda -- warisan tata nama
    // lama, dan justru yang terbanyak di produk terlaris:
    //
    //     "MINYAK CEMCEMAN    175 ML RJ"     86 bulan
    //     "RAMUAN P.RAMBUT   175 ML RJ"      86 bulan
    //     "SHAMPO BAYAM  175 ML RJ"          86 bulan
    //
    // Dengan pencocokan apa adanya, mengetik "MINYAK CEMCEMAN 175 ML RJ"
    // TIDAK menemukan produk itu. Yang ketemu cuma varian "... RJ NF" yang
    // spasinya tunggal dan riwayatnya 28 bulan, bukan 86.
    //
    // ⚠️ Yang membuat ini berbahaya: TIDAK ADA GEJALA. Pencariannya berhasil,
    // tabelnya penuh, namanya mirip. Pemakai mengira sedang melihat ramalan
    // produk yang dia sebut, padahal produk lain. Terlihat 2 Nov 2026.
    //
    // `[[:space:]]` dipakai, BUKAN `\s`: di dalam template literal JavaScript
    // `\s` ciut jadi huruf `s` begitu saja, dan kueri yang dihasilkan diam-diam
    // mencocokkan hal lain. Itu sudah terjadi sekali waktu mengukur ini.
    `SELECT sku_code, max(sku_name) AS sku_name, max(brand) AS brand,
            count(*)::int AS bulan, to_char(max(period), 'YYYY-MM') AS terakhir
       FROM ai_forecast_sales_monthly
      WHERE source = $1
        AND regexp_replace(sku_name, '[[:space:]]+', '', 'g')
            ILIKE '%' || regexp_replace($2, '[[:space:]]+', '', 'g') || '%'
      GROUP BY sku_code
      -- ⚠️ NAMA YANG PERSIS SAMA DILETAKKAN PALING DEPAN, dan itu bukan soal
      -- kerapian urutan: tanpanya tombol pilihan di layar tidak pernah selesai.
      --
      -- Daftar varian ditampilkan, user menekan "MINYAK CEMCEMAN 175 ML RJ",
      -- namanya dikirim kembali ke tool ini -- dan nama itu MASIH cocok ke
      -- "... RJ NF" karena pencocokannya sebagian. Hasilnya "perlu-diperjelas"
      -- lagi, dengan daftar yang sama, selamanya.
      --
      -- ⚠️ TANPA BACKTICK di komentar ini: kueri ini ada di dalam template
      -- literal JavaScript, dan satu backtick memutusnya di tengah. Sudah
      -- terjadi sekali waktu menulis catatan ini.
      --
      -- Diurutkan di SQL walau penyaringnya di JavaScript: LIMIT dihitung
      -- server, jadi baris yang persis bisa terbuang di luar batas sebelum
      -- JavaScript melihatnya. Diukur 2 Nov 2026 itu belum pernah terjadi --
      -- nama penuh yang paling ambigu cocok ke 4 SKU dari 1737, jauh di bawah
      -- batas 8 -- tapi batasnya akan tetap 8 waktu katalognya bertambah.
      ORDER BY (regexp_replace(upper(max(sku_name)), '[[:space:]]+', '', 'g')
                = regexp_replace(upper($2), '[[:space:]]+', '', 'g')) DESC,
               count(*) DESC, max(sku_name)
      LIMIT $3`,
    [SUMBER, bersih, batas],
  );
  const calon = rows.map((r) => ({
    sku: r.sku_code, nama: r.sku_name, merek: r.brand, bulan: r.bulan, terakhir: r.terakhir,
  }));
  // ⚠️ YANG PERSIS SAMA MENUTUP PERTANYAAN. Nama penuh yang diketik -- atau
  // ditekan dari daftar pilihan -- berarti user sudah memilih; menanyakannya
  // lagi cuma karena nama itu kebetulan awalan nama lain adalah pertanyaan
  // yang tidak punya jawaban baru.
  const diminta = samakan(bersih);
  const persis = calon.filter((c) => samakan(c.nama) === diminta);
  return lengkapiCalon(persis.length === 1 ? persis : calon);
}

/**
 * Rentang tanggal data mentah yang disambung ke tabel bulanan. `null` kalau tidak ada.
 *
 * ⚠️ HANYA BULAN PENUH. Oktober sampai tanggal 18 berjumlah kira-kira setengah bulan penuh,
 * dan kalau ikut, model membacanya sebagai penjualan yang anjlok setengah.
 */
export async function batasSambung(): Promise<{ dari: string; sebelum: string; akhirBulan: string } | null> {
  const { rows } = await poolPerusahaan().query<{ dari: string; sebelum: string; akhir: string }>(
    `WITH t AS (SELECT max(period) AS p FROM ai_forecast_sales_monthly WHERE source = $1),
          m AS (SELECT max(trx_date)::date AS d FROM trx_ba_sales WHERE trx_date <= current_date)
     SELECT to_char(t.p + interval '1 month', 'YYYY-MM-DD') AS dari,
            -- Hari sesudah data terakhir: kalau ia tanggal 1, bulan sebelumnya penuh.
            to_char(date_trunc('month', m.d + 1), 'YYYY-MM-DD') AS sebelum,
            to_char(date_trunc('month', m.d + 1) - interval '1 month', 'YYYY-MM') AS akhir
       FROM t, m`,
    [SUMBER],
  );
  const r = rows[0];
  return r && r.dari < r.sebelum ? { dari: r.dari, sebelum: r.sebelum, akhirBulan: r.akhir } : null;
}

/** Bulan penuh terakhir, dari tabel atau data mentah. Untuk menyebut keterlambatannya apa adanya. */
export async function bulanTerakhirData(): Promise<string | null> {
  const sambung = await batasSambung();
  if (sambung) return sambung.akhirBulan;
  const { rows } = await poolPerusahaan().query<{ b: string | null }>(
    `SELECT to_char(max(period), 'YYYY-MM') AS b FROM ai_forecast_sales_monthly WHERE source = $1`,
    [SUMBER],
  );
  return rows[0]?.b ?? null;
}

/** Riwayat tombol pilihan ikut bulan yang disambung, supaya tidak menyebut data lama. */
async function lengkapiCalon(calon: CalonSku[]): Promise<CalonSku[]> {
  const sambung = calon.length > 0 ? await batasSambung() : null;
  if (!sambung) return calon;
  const { rows } = await poolPerusahaan().query<{ sku: string; n: number; akhir: string }>(
    `SELECT item_code AS sku, count(DISTINCT to_char(trx_date, 'YYYY-MM'))::int AS n, to_char(max(trx_date), 'YYYY-MM') AS akhir
       FROM trx_ba_sales
      WHERE item_code = ANY($1) AND trx_date >= $2::date AND trx_date < $3::date AND qty <> 0
      GROUP BY 1`,
    [calon.map((c) => c.sku), sambung.dari, sambung.sebelum],
  );
  const per = new Map(rows.map((r) => [r.sku, r]));
  return calon.map((c) => {
    const r = per.get(c.sku);
    return r ? { ...c, bulan: c.bulan + r.n, terakhir: r.akhir } : c;
  });
}

export { kunciBulan, rentangBulan };
