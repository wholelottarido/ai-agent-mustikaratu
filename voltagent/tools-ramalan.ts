/**
 * Tool peramalan penjualan.
 *
 * ============================================================
 * ⚠️ MODEL MENJELASKAN, BUKAN MENGHITUNG
 * ============================================================
 * Angka ramalan dihitung `lib/ramalan/*` — Naive, Seasonal Naive, atau
 * AutoARIMA, dipilih lewat backtest. LLM hanya merangkai hasilnya jadi
 * kalimat.
 *
 * Itu syarat dari `docs/fitur/sales-forecasting.md`: "The forecasting must be
 * calculated by a statistical model rather than estimated by the LLM itself."
 * Dan itu juga aturan yang sudah dipegang seluruh proyek ini sejak Tahap 3 —
 * angka tidak pernah datang dari model bahasa.
 *
 * ============================================================
 * ⚠️ HASILNYA MEMBAWA KETIDAKPASTIANNYA
 * ============================================================
 * Yang dipulangkan bukan cuma angka. Ikut juga: model mana yang dipakai,
 * WAPE-nya, model apa saja yang kalah, berapa bulan yang diisi nol, dan
 * bulan terakhir data yang sebenarnya.
 *
 * Tanpa itu pemakai menerima angka tanpa dasar untuk menilainya — dan
 * ramalan penjualan adalah jenis angka yang dipakai orang mengambil
 * keputusan. Diukur 26 Okt 2026: WAPE berkisar 15,6% sampai 32%, dan model
 * yang menang berbeda-beda per produk.
 *
 * ⚠️ DATA TERTINGGAL. Riwayat berakhir di bulan penuh terakhir data mentah (lihat
 * `batasSambung`), jadi tool ini wajib menyebutkan bulan terakhirnya, dan instruksinya
 * melarang model mengarang "bulan depan" tanpa menyebut dari mana hitungannya dimulai.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { batasSambung, cariSku, deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { BULAN_PEMBANDING, ringkasTren } from "@/lib/ramalan/tren";
import { keteranganKalender } from "@/lib/ramalan/kalender";
import { polaBulanan } from "@/lib/ramalan/pola";
import {
  ramalkan, bulanSetelah, selisihBulan, bulanIni, BULAN_UJI, MAKS_HORIZON_INTERNAL,
  jumlahJendela, minimalTerbesar, JENDELA_DENGAN_ML,
  type NilaiModel, type HasilPilih,
} from "@/lib/ramalan/pilih";
import { ambilMl } from "@/lib/ramalan/ml";
import { MODEL_JARANG } from "@/lib/ramalan/jarang";
import { poolPerusahaan } from "@/lib/db-perusahaan";

/**
 * Batas horizon.
 *
 * ⚠️ 6 BULAN, dan itu bukan angka bulat yang dipilih asal. Backtest menilai
 * model pada 3 bulan; meramal 12 bulan ke depan dari penilaian 3 bulan berarti
 * menyodorkan angka yang ketepatannya tidak pernah diuji pada jarak itu.
 */
const MAKS_HORIZON = 6;

/** Satu kolom hasil ramalan beserta arahnya dibanding penjualan terakhir. */
function denganTren(n: NilaiModel, aktual: number[], bulan: string[], bulanNol: number) {
  return { ...ringkasModel(n, bulanNol), tren: ringkasTren(aktual, bulan, n.ramalan, n.kode === "rata-rata") };
}

/** Kandidat selain yang terpilih. Kosong kalau tidak ada ramalan sama sekali. */
function modelLain(h: HasilPilih, bulanNol = 0) {
  if (!h.ok) return [];
  // ⚠️ `.map(ringkasModel)` akan mengirim INDEKS array sebagai `bulanNol` —
  // argumen kedua yang diberikan `Array.map` ke pemanggilnya. Ditulis
  // eksplisit supaya kalimat `cara_membacanya` tidak ditentukan urutan
  // kandidat.
  return h.kandidat.filter((k) => k.kode !== h.terpilih.kode).map((k) => ringkasModel(k, bulanNol));
}

/** Kode model permintaan terputus — hasilnya rata, jadi perlu keterangan tambahan. */
const KODE_JARANG = new Set<string>(MODEL_JARANG.map((m) => m.kode));

/**
 * Bentuk satu model untuk dibaca model bahasa — ringkas, tanpa istilah teknis.
 *
 * `bulanNol` = berapa bulan dalam riwayat yang tidak ada penjualannya. Dipakai
 * hanya untuk memilih kalimat `cara_membacanya` yang BENAR.
 */
function ringkasModel(n: NilaiModel, bulanNol = 0) {
  return {
    model: n.nama,
    ramalan: n.ramalan,
    // ⚠️ Rentang ikut, dan WAJIB disampaikan. Satu angka ramalan membuat
    // pembacanya mengira kita tahu persis; rentang menyatakan ketidakpastian
    // yang memang ada. Kosong berarti tidak bisa dihitung — bukan nol.
    ...(n.lo.length === n.ramalan.length && n.lo.length > 0
      ? { paling_rendah: n.lo, paling_tinggi: n.hi }
      : {}),
    ...(n.polaBulanan
      ? {
          cara_membacanya:
            "Perbedaan antar bulan berasal dari pola musiman umum semua produk, bukan kepastian untuk produk " +
            "ini. Pada uji data lama, arah naik-turun antar bulan hanya benar sekitar 52%, jadi jangan dipakai " +
            "untuk memastikan bulan mana yang lebih tinggi.",
        }
      : {}),
    // Angka yang sama tiap bulan mudah terbaca sebagai janji. Yang dikatakan model hanya
    // tingkat penjualannya; tidak ada yang menebak bulan mana yang lebih tinggi.
    ...(n.ramalan.length > 1 && new Set(n.ramalan).size === 1 && !KODE_JARANG.has(n.kode) && n.kode !== "rata-rata"
      ? {
          cara_membacanya:
            "Angkanya sama tiap bulan karena ini perkiraan tingkat penjualan per bulan, bukan angka pasti " +
            "tiap bulan. Penjualan aslinya tetap akan naik-turun. Pakai total beberapa bulan untuk keputusan.",
        }
      : {}),
    ...(n.kode === "rata-rata"
      ? { ini_bukan_hasil_model: "rata-rata 3 bulan terakhir, dipakai karena penjualannya tidak stabil" }
      : {}),
    // ⚠️ Angka yang SAMA untuk tiap bulan mudah disalahbaca sebagai "kami
    // yakin tiap bulan persis sebanyak ini". Yang sebenarnya dikatakan model
    // permintaan terputus justru kebalikannya: produk ini tidak terjual tiap
    // bulan, dan tidak ada keterangan apa pun tentang bulan MANA. Tanpa
    // kalimat ini, tabel 41/41/41 terbaca sebagai kepastian.
    // ⚠️ DUA KALIMAT BERBEDA, dan bedanya penting. ADIDA dan IMAPA dipakai
    // untuk DUA keadaan: produk yang bulannya bolong, DAN produk yang terjual
    // tiap bulan tapi jumlahnya berayun lebar. Kalimat "tidak terjual setiap
    // bulan" BENAR untuk yang pertama dan BOHONG untuk yang kedua — dan
    // terukur 27 Okt 2026, sepuluh produk terlaris yang diselamatkan model ini
    // SEMUANYA jenis kedua (nol bulan kosong). Satu kalimat untuk keduanya
    // berarti memberi tahu pemakai hal yang tidak benar tentang produknya.
    ...(KODE_JARANG.has(n.kode)
      ? {
          cara_membacanya:
            (bulanNol > 0
              ? `Produk ini tidak terjual setiap bulan (${bulanNol} bulan tanpa penjualan di riwayatnya), ` +
                "jadi angkanya laju rata-rata per bulan — bukan ramalan bahwa bulan itu pasti " +
                "terjual sebanyak itu. Model ini sengaja tidak menebak bulan mana yang ada penjualan."
              : "Penjualan produk ini naik-turun tajam dari bulan ke bulan, jadi angkanya laju " +
                "rata-rata per bulan — bukan ramalan bahwa bulan itu persis sebanyak itu. Model " +
                "ini sengaja tidak menebak bulan mana yang tinggi dan mana yang rendah.") +
            " Yang paling bisa dipakai adalah JUMLAH beberapa bulan, bukan angka satu bulannya.",
        }
      : {}),
    ketepatan_wape_persen: n.wape === null ? null : Math.round(n.wape * 10) / 10,
    ...(n.dipangkas > 0 ? { nilai_dipangkas_ke_nol: n.dipangkas } : {}),
    ...(n.ditolak ? { tidak_dipakai_karena: n.ditolak } : {}),
  };
}

export function buatToolRamalan() {
  return createTool({
    name: "ramal_penjualan",
    description:
      // ⚠️ KALIMAT PERTAMA DIJAGA TETAP PENDEK. 27 Okt 2026 kalimat ini pernah
      // diperpanjang dengan daftar model yang dipakai (AutoARIMA, permintaan
      // terputus, LightGBM). Akibatnya DUA uji lewat model bahasa yang tadinya
      // 12/12 jatuh ke 11/12 — dan keduanya gagal dengan cara yang sama:
      // modelnya bertanya "berapa bulan ke depan?" lebih dulu, padahal
      // parameternya sudah punya nilai bawaan 3.
      //
      // Sebabnya bukan isi kalimatnya salah, tapi POSISINYA: aturan "PANGGIL
      // DULU" terdorong ke bawah dan ikut melemah. Pelajaran yang sama dengan
      // Tahap 28, dan terulang karena dilupakan.
      //
      // Nama model yang dipakai TETAP sampai ke pemakai — lewat `jumlah_unit.model`
      // di hasil tool, tempat yang tidak bersaing dengan aturan apa pun.
      "Meramal penjualan sebuah produk beberapa bulan ke depan, dari riwayat penjualan bulanan " +
      "perusahaan, memakai model statistik yang dipilih lewat uji ketepatan — BUKAN perkiraan " +
      "kamu sendiri. " +
      "⚠️ PANGGIL TOOL INI DULU, SEKALIPUN NAMA PRODUKNYA BELUM LENGKAP. Sebut apa adanya " +
      "dari kata user — 'minyak zaitun' saja sudah cukup. Tool ini yang mencocokkan ke daftar " +
      "produk yang NYATA ADA di database. JANGAN menanyakan varian, ukuran, kemasan, MAUPUN " +
      "BERAPA BULAN lebih dulu: varian yang kamu sebut dari ingatan berarti mengarang nama " +
      "produk, dan jumlah bulannya sudah ada nilai bawaannya (3) kalau user tidak menyebut. " +
      "Kalau user meminta ramalan MEREK, tetap panggil dengan nama merek itu apa adanya. Tool akan " +
      "mengenalinya dan menjelaskan bahwa ramalan gabungan per merek belum tersedia; JANGAN meminta " +
      "konfirmasi ulang dan JANGAN menjumlahkan ramalan produk sendiri. " +
      "⚠️ Kalau hasilnya `perlu-diperjelas`, BARU tanyakan — dan sampaikan daftar `pilihan` dari " +
      "hasil tool APA ADANYA. Jangan memilihkan, jangan menambah varian yang tidak ada di daftar itu. " +
      "⚠️ Hasilnya membawa `ketepatan_wape_persen`, rentang `paling_rendah`-`paling_tinggi`, dan " +
      "`peringatan`: WAJIB kamu sampaikan, karena angka ramalan tanpa itu tidak bisa dinilai " +
      "pembacanya. Kalau ada `ini_bukan_hasil_model`, katakan terus terang bahwa angkanya rata-rata " +
      "3 bulan terakhir, bukan ramalan model. " +
      "⚠️ Kalau hasilnya `produk-berhenti`, produk itu sudah tidak dijual: sampaikan apa adanya " +
      "dan JANGAN menyebut angka ramalan apa pun. " +
      "Kalau ada `cara_membacanya`, sampaikan juga: angkanya laju rata-rata per bulan untuk " +
      "produk yang penjualannya tidak merata, bukan ramalan bahwa bulan itu persis sebanyak itu.",
    parameters: z.object({
      produk: z.string().min(3).describe("Nama produk atau kode SKU dari kata user, apa adanya. Minimal 3 huruf."),
      bulan: z
        .number()
        .int()
        .min(1)
        .max(MAKS_HORIZON)
        .optional()
        .describe(`Berapa bulan ke depan, 1 sampai ${MAKS_HORIZON}. Kosongkan untuk 3.`),
    }),
    execute: async ({ produk, bulan }: { produk: string; bulan?: number }) => {
      const horizon = bulan ?? 3;
      const permintaan = produk.trim();
      // Model biasanya mengirim "MRPC", tetapi model lain kadang meneruskan
      // seluruh frasa "merek MRPC untuk 3 bulan". Ambil nama mereknya tanpa
      // mematok merek tertentu, agar penjagaan ini berlaku untuk seluruh katalog.
      const disebutMerek = permintaan.match(
        /\b(?:merek|brand)\s+(.+?)(?=\s+(?:untuk|selama)\b|\s+\d+\s+bulan\b|\s+ke\s+depan\b|$)/i,
      );
      const calonNamaMerek = (disebutMerek?.[1] ?? permintaan).trim();

      const calon = await cariSku(permintaan, 8);
      if (calon.length === 0) {
        // Nama merek seperti "MRPC" bukan nama produk. Sebelumnya hasil
        // `tidak-ketemu` membuat model meminta konfirmasi bahwa MRPC memang
        // merek, walau user sudah menulis "merek MRPC" dengan jelas.
        //
        // Ramalan merek sengaja belum dibuat: backtest Jul-Sep 2026 menunjukkan
        // jumlah ramalan SKU per merek belum konsisten mengalahkan pembanding
        // bulan terakhir. Kenali maksudnya, lalu tolak angka yang belum layak.
        const { rows: merek } = await poolPerusahaan().query<{
          merek: string;
          jumlah_produk: number;
        }>(
          `SELECT brand AS merek, count(DISTINCT sku_code)::int AS jumlah_produk
             FROM ai_forecast_sales_monthly
            WHERE source = 'ba_sales' AND brand IS NOT NULL
              AND brand ILIKE '%' || $1 || '%'
            GROUP BY brand ORDER BY count(DISTINCT sku_code) DESC, brand LIMIT 8`,
          [calonNamaMerek],
        );
        if (merek.length > 0) {
          const akhirData = await bulanTerakhirData();
          const sambung = await batasSambung();
          const { rows: produkAktif } = akhirData
            ? await poolPerusahaan().query<{
                kode: string; nama: string; merek: string;
                unit_3_bulan: string; total_aktif: number;
              }>(
                `WITH katalog AS (
                   SELECT sku_code, max(sku_name) AS nama, max(brand) AS merek
                     FROM ai_forecast_sales_monthly
                    WHERE source = 'ba_sales' AND brand ILIKE '%' || $1 || '%'
                    GROUP BY sku_code
                 ), jual AS (
                   SELECT sku_code, sum(qty) AS qty
                     FROM ai_forecast_sales_monthly
                    WHERE source = 'ba_sales'
                      AND period >= date_trunc('month', $2::date) - interval '2 months'
                      AND period <= date_trunc('month', $2::date)
                    GROUP BY sku_code
                   ${sambung ? `UNION ALL
                   SELECT item_code AS sku_code, sum(qty) AS qty
                     FROM trx_ba_sales
                    WHERE item_code IS NOT NULL
                      AND trx_date >= greatest($3::date, date_trunc('month', $2::date) - interval '2 months')
                      AND trx_date < $4::date
                    GROUP BY item_code` : ""}
                 ), aktif AS (
                   SELECT k.sku_code AS kode, k.nama, k.merek, sum(j.qty) AS unit_3_bulan
                     FROM katalog k JOIN jual j ON j.sku_code = k.sku_code
                    GROUP BY k.sku_code, k.nama, k.merek HAVING sum(j.qty) > 0
                 )
                 SELECT kode, nama, merek, unit_3_bulan::text,
                        count(*) OVER ()::int AS total_aktif
                   FROM aktif ORDER BY unit_3_bulan DESC, nama LIMIT 10`,
                sambung
                  ? [calonNamaMerek, `${akhirData}-01`, sambung.dari, sambung.sebelum]
                  : [calonNamaMerek, `${akhirData}-01`],
              )
            : { rows: [] };
          return {
            status: "merek-belum-didukung",
            pesan:
              `"${calonNamaMerek}" dikenali sebagai merek, tetapi ramalan gabungan per merek belum tersedia. ` +
              "Saat ini ramalan hanya dapat dibuat untuk satu produk atau SKU.",
            merek_ditemukan: merek.map((m) => ({
              nama: m.merek,
              jumlah_produk_dalam_riwayat: m.jumlah_produk,
            })),
            ...(produkAktif.length > 0
              ? {
                  jumlah_produk_aktif_3_bulan_terakhir: produkAktif[0].total_aktif,
                  data_produk_aktif_sampai: akhirData,
                  contoh_produk_aktif_terlaris: produkAktif.map((p) => ({
                    kode: p.kode,
                    nama: p.nama.replace(/\s+/g, " ").trim(),
                    merek: p.merek,
                  })),
                }
              : {}),
            alasan:
              "Backtest ramalan per merek belum menunjukkan hasil yang konsisten lebih baik daripada " +
              "mengulang penjualan bulan terakhir, sehingga angkanya belum layak ditampilkan di chat.",
            catatan:
              "Sampaikan keterbatasan ini apa adanya. JANGAN meminta user mengonfirmasi lagi bahwa ini " +
              "merek, JANGAN memilih produk, dan JANGAN menjumlahkan ramalan produk sendiri. Kalau ada " +
              "`contoh_produk_aktif_terlaris`, tampilkan sebagai pilihan produk yang bisa diramal. Jelaskan " +
              "bahwa itu hanya 10 produk terlaris, bukan seluruh daftar.",
          };
        }
        return {
          status: "tidak-ketemu",
          pesan: `Produk "${produk}" tidak ada di data penjualan bulanan.`,
        };
      }
      // ⚠️ AMBIGU BERARTI BERHENTI, BUKAN MENEBAK. "Minyak Zaitun" cocok ke 8
      // SKU dengan ukuran kemasan berbeda; meramal salah satunya menghasilkan
      // angka yang terlihat sah untuk produk yang bukan dimaksud. Pola yang
      // sama dengan `cocokkan()` di jalur entri tiket.
      if (calon.length > 1) {
        return {
          status: "perlu-diperjelas",
          pesan: `Ada ${calon.length} produk yang cocok dengan "${produk}". Yang mana?`,
          pilihan: calon.map((c) => ({
            kode: c.sku, nama: c.nama, riwayat_bulan: c.bulan, data_terakhir: c.terakhir,
          })),
        };
      }

      const d = await deretSku(calon[0].sku);
      if (!d.ok) return { status: "tidak-bisa", pesan: d.pesan };

      // ⚠️ Akhir data SELURUH tabel, bukan milik produk ini — itu yang
      // membedakan "produk berhenti dijual" dari "laporan belum masuk".
      // Tanpa ini setiap produk terlihat mutakhir menurut datanya sendiri.
      const akhir = (await bulanTerakhirData()) ?? d.deret.bulanTerakhir;
      const sambung = await batasSambung();

      // ⚠️ BULANNYA DIHITUNG DI SINI DENGAN RUMUS YANG SAMA PERSIS seperti di
      // `ramalkan()`. Kalau berbeda satu bulan saja, LightGBM akan dimintai
      // ramalan untuk bulan yang tidak jadi disajikan — dan tabelnya bergeser
      // tanpa ada yang terlihat salah.
      const sekarang = bulanIni();
      const jeda = Math.max(0, selisihBulan(d.deret.bulanTerakhir, sekarang));
      const horizonInternal = Math.min(jeda + horizon, MAKS_HORIZON_INTERNAL);
      const bulanRamalan = bulanSetelah(d.deret.bulanTerakhir, horizonInternal).slice(jeda);
      // ⚠️ JENDELA UJINYA HARUS SAMA PERSIS DENGAN MILIK MODEL KITA.
      // `pilihModel()` menilai di `kJendela` jendela @ `BULAN_UJI` bulan; kalau
      // LightGBM di sini cuma dimintai tiga bulan terakhir sementara model
      // kita dinilai di sembilan, yang dibandingkan bukan ketepatan melainkan
      // panjang ujiannya. Itu persis kekeliruan yang sudah ditangkap di Tahap
      // B — dan di sana selisihnya lebih dari dua kali lipat jumlah kemenangan.
      //
      // Dihitung dengan fungsi yang SAMA, bukan dengan angka yang disalin.
      // ⚠️ `JENDELA_DENGAN_ML`, bukan `MAKS_JENDELA`. Kalau LightGBM ikut,
      // seluruh penilaian turun ke 3 jendela — dan `ramalkan()` memakai batas
      // yang sama begitu kandidat ini diteruskan ke sana. Kalau ternyata
      // LightGBM tidak punya datanya, `ramalkan()` dipanggil tanpa kandidat
      // itu dan naik sendiri ke 4 jendela.
      const kJendela = jumlahJendela(
        d.deret.qty.length, minimalTerbesar(d.deret.qty.length), JENDELA_DENGAN_ML);
      const bulanDiuji = kJendela * BULAN_UJI;
      const bulanUji = bulanDiuji > 0 ? d.deret.bulan.slice(-bulanDiuji) : [];
      const asliUji = bulanDiuji > 0 ? d.deret.qty.slice(-bulanDiuji) : [];

      // Kegagalannya TIDAK menggagalkan ramalan — model kita tetap jalan.
      // Prinsip yang sama dipegang tim sebelah (§23.3).
      const hMl = await ambilMl(calon[0].sku, bulanUji, asliUji, bulanRamalan);

      const r = ramalkan(d.deret, horizon, sekarang, akhir, hMl.ok ? hMl.ml : undefined, await polaBulanan());
      const bulanNolQty = d.deret.qty.filter((v) => v === 0).length;

      if (r.berhenti) {
        return {
          status: "produk-berhenti",
          pesan: r.peringatan[0],
          produk: { kode: r.sku, nama: r.nama, merek: r.merek },
          penjualan_terakhir: r.berhenti.bulanTerakhirTerjual,
          sudah_diam_bulan: r.berhenti.diamBulan,
          data_perusahaan_sampai: akhir,
          catatan:
            "Sampaikan terus terang bahwa produk ini sudah tidak tercatat terjual dan ramalannya " +
            "TIDAK dibuat. JANGAN menyebut angka ramalan apa pun. Kalau produknya akan dijual lagi, " +
            "sarankan koordinasi dengan tim SCM.",
        };
      }

      // Kedua satuan gagal = tidak ada yang pantas disampaikan. Mengaku gagal,
      // bukan memulangkan angka pengganti.
      if (!r.qty.ok && !r.value.ok) {
        return {
          status: "tidak-bisa",
          pesan: `Tidak ada model yang menghasilkan ramalan masuk akal untuk ${r.nama}.`,
          sebab: r.qty.ok ? "" : r.qty.sebab,
          // ⚠️ ALASAN TIAP MODEL IKUT. "Tidak bisa" tanpa sebab terdengar
          // seperti alatnya rusak, padahal yang terjadi justru sebaliknya:
          // penjagaannya bekerja. Pemakai berhak tahu bedanya, dan alasannya
          // sering berisi jawaban yang sebenarnya dia cari — "semua model
          // meleset di atas 100%" artinya produk ini tidak bisa diramal, dan
          // itu informasi, bukan kegagalan.
          kenapa_tiap_model_gagal: r.qty.kandidat.map((k) => ({
            model: k.nama,
            ketepatan_wape_persen: k.wape === null ? null : Math.round(k.wape * 10) / 10,
            sebab: k.ditolak ?? "(tidak ditolak)",
          })),
          riwayat: {
            panjang_bulan: r.panjangDeret,
            bulan_diisi_nol: r.diisi,
            data_terakhir: r.bulanTerakhir,
          },
          peringatan: r.peringatan,
          catatan:
            "Sampaikan terus terang bahwa ramalannya TIDAK BISA dibuat, beserta alasannya. " +
            "JANGAN menggantinya dengan perkiraanmu sendiri dan JANGAN menyebut angka apa pun " +
            "dari riwayat seolah itu ramalan.",
        };
      }

      return {
        status: "siap",
        // Riwayatnya dari tabel bulanan, disambung data mentah kalau deret ini memang sampai ke sana.
        tabel_sumber: [
          "ai_forecast_sales_monthly",
          ...(sambung && d.deret.bulanTerakhir >= sambung.dari.slice(0, 7) ? ["trx_ba_sales"] : []),
        ],
        produk: { kode: r.sku, nama: r.nama, merek: r.merek },
        riwayat: {
          panjang_bulan: r.panjangDeret,
          bulan_diisi_nol: r.diisi,
          data_terakhir: r.bulanTerakhir,
        },
        bulan_diramal: r.bulanRamalan,
        bulan_sama_tahun_lalu: r.bulanRamalan.flatMap((bulan) => {
          const tahunLalu = `${Number(bulan.slice(0, 4)) - 1}${bulan.slice(4)}`;
          const i = d.deret.bulan.indexOf(tahunLalu);
          return i < 0 ? [] : [{ bulan, tahun_lalu: tahunLalu, unit: d.deret.qty[i], rupiah: d.deret.value[i] }];
        }),
        keterangan_kalender: r.bulanRamalan.flatMap((bulan) => {
          const keterangan = keteranganKalender(bulan);
          return keterangan ? [{ bulan, keterangan }] : [];
        }),
        data_perusahaan_sampai: akhir,
        // ⚠️ STRUKTURAL, bukan cuma kalimat di `peringatan`. Peringatan bisa
        // tidak disampaikan model; angka di field sendiri lebih sulit
        // diabaikan, dan bisa diperiksa uji tanpa membaca kalimat.
        ...(r.bulanLewat > 0 ? { bulan_yang_sudah_lewat: r.bulanLewat } : {}),
        // Bulan pembanding untuk `tren`, supaya persennya bisa diperiksa pembaca.
        // Di sini, bukan di `peringatan`: sebagai kalimat di daftar itu Haiku melewatkannya.
        ...(r.jarak ? { perkiraan_meleset_menurut_jarak: r.jarak } : {}),
        aktual_3_bulan_terakhir: d.deret.bulan.slice(-BULAN_PEMBANDING).map((bulan, i) => ({
          bulan,
          unit: d.deret.qty.slice(-BULAN_PEMBANDING)[i],
          rupiah: d.deret.value.slice(-BULAN_PEMBANDING)[i],
        })),
        jumlah_unit: r.qty.ok
          ? denganTren(r.qty.terpilih, d.deret.qty, d.deret.bulan, bulanNolQty)
          : { galat: r.qty.sebab },
        nilai_rupiah: r.value.ok
          ? denganTren(r.value.terpilih, d.deret.value, d.deret.bulan, d.deret.value.filter((v) => v === 0).length)
          : { galat: r.value.sebab },
        // Kandidat yang kalah ikut: itu yang membuat pemilihan modelnya bisa
        // diperiksa, bukan dipercaya begitu saja.
        model_lain: modelLain(r.qty, bulanNolQty),
        // Disebut apa adanya supaya administrator bisa tahu kenapa kandidat
        // LightGBM tidak muncul, tanpa harus menebak.
        ...(hMl.ok ? {} : { lightgbm_dilewati: hMl.sebab }),
        peringatan: r.peringatan,
        catatan:
          "Angka di atas hasil hitungan model statistik, bukan perkiraanmu. Sampaikan apa adanya " +
          "beserta nama `model`, ketepatan (WAPE), dan peringatannya. JANGAN membulatkan jadi 'kira-kira sekian' " +
          "dan JANGAN menambah angka yang tidak ada di sini. Sampaikan juga `tren` (arah dan persennya, " +
          "dibanding apa) dan `aktual_3_bulan_terakhir`; kalau arahnya `tidak-dinilai`, jangan menyebut naik atau turun. " +
          "Tampilkan `bulan_sama_tahun_lalu` di samping tiap bulan ramalan sebagai pembanding. Kalau ada `cara_membacanya`, sampaikan juga. " +
          "Sebut `keterangan_kalender` pada bulannya sebagai keterangan waktu saja: angka ramalan tidak dihitung dari " +
          "kalender, jadi JANGAN menyatakan Ramadan atau Lebaran sebagai penyebab naik-turunnya penjualan. " +
          "WAJIB sebut juga `perkiraan_meleset_menurut_jarak` tepat sesudah angka ketepatan, karena angka ketepatan " +
          "sendirian terlihat lebih baik daripada kenyataan pada jarak sejauh ini." +
          (r.bulanLewat > 0
            ? " ⚠️ PERIODENYA SEBAGIAN ATAU SELURUHNYA SUDAH LEWAT — baca `peringatan` dan " +
              "sebutkan bulannya apa adanya. Dilarang menulis 'ke depan' untuk bulan yang sudah terjadi."
            : ""),
      };
    },
  });
}
