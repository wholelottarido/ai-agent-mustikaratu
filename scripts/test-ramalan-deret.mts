/**
 * Uji pengambil deret penjualan bulanan.
 *
 *   npm run test:ramalan-deret
 *
 * HANYA MEMBACA. Tidak menulis ke database mana pun.
 *
 * ============================================================
 * YANG DIJAGA, DAN KENAPA
 * ============================================================
 * Satu hal yang kalau salah TIDAK menimbulkan galat sama sekali: bulan yang
 * hilang. Baris yang tidak ada di `ai_forecast_sales_monthly` berarti SKU itu
 * tidak terjual bulan itu — bukan "datanya belum masuk".
 *
 * Kalau titik-titik yang ada dirangkai begitu saja, jaraknya jadi bohong.
 * Diukur 26 Okt 2026: dari 420 SKU dengan >=26 bulan data, cuma 161 yang
 * deretnya utuh. `RH LEMONGGRASS ESS OIL` punya 27 bulan data di rentang 85
 * bulan — 58 lubang. Dirangkai tanpa diisi, model meramal pola yang tidak
 * pernah ada, dan hasilnya terlihat sah.
 *
 * ⚠️ SKU UJINYA DICARI DARI DATA, BUKAN DITULIS TANGAN. Katalog tim lain
 * berubah tanpa pemberitahuan — 263 dari 280 baris `ai_tool` pernah lahir
 * dalam satu hari (13 Okt 2026). Uji yang menanam kode SKU akan merah suatu
 * hari tanpa ada yang rusak.
 */
import { deretSku, cariSku, kodeDariTeks, bulanTerakhirData, MIN_ARIMA, MIN_MUSIMAN, batasSambung } from "../lib/ramalan/deret.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const db = poolPerusahaan();
const q = async <T,>(s: string) => (await db.query(s)).rows as T[];

try {
  // ============================================================
  console.log("=== 1. Keadaan sumber datanya ===");
  // ============================================================
  const terakhir = await bulanTerakhirData();
  cek("tabel sumber terbaca", Boolean(terakhir), `bulan terakhir ${terakhir}`);

  // ⚠️ Keterlambatan DILAPORKAN, bukan dijadikan kegagalan. Tabelnya milik tim
  // lain dan mereka yang menentukan kapan diisi; yang penting angkanya
  // kelihatan supaya tool bisa menyebutkannya apa adanya.
  if (terakhir) {
    const [sekarang] = await q<{ b: string }>(`SELECT to_char(CURRENT_DATE,'YYYY-MM') AS b`);
    console.log(`         bulan sekarang ${sekarang.b}; selisihnya disebut tool ke pemakai`);
  }

  // ============================================================
  console.log("\n=== 2. SKU dengan deret UTUH ===");
  // ============================================================
  const [utuh] = await q<{ sku_code: string; bulan: number }>(
    `WITH p AS (
       SELECT sku_code, count(*)::int AS bulan,
              (EXTRACT(year FROM age(max(period), min(period)))*12
               + EXTRACT(month FROM age(max(period), min(period))) + 1)::int AS rentang
         FROM ai_forecast_sales_monthly WHERE source='ba_sales'
        GROUP BY 1 HAVING count(*) >= 26)
     SELECT sku_code, bulan FROM p WHERE bulan = rentang ORDER BY bulan DESC LIMIT 1`);
  if (!utuh) {
    cek("ada SKU berderet utuh", false, "tidak ketemu — data berubah?");
  } else {
    const h = await deretSku(utuh.sku_code);
    cek("deret utuh terbaca", h.ok, h.ok ? `${h.deret.nama.slice(0, 34)} · ${h.deret.bulan.length} bulan` : h.pesan);
    if (h.ok) {
      const d = h.deret;
      cek("nol bulan diisi (memang utuh)", d.diisi === 0, `${d.diisi} diisi`);
      cek("qty & value sejajar dengan bulan",
        d.qty.length === d.bulan.length && d.value.length === d.bulan.length);
      cek("kelayakan `arima` untuk deret panjang", d.kelayakan === "arima", d.kelayakan);
      // ⚠️ Bulan harus BERURUTAN tanpa loncat. Ini inti berkas yang diuji.
      const loncat = d.bulan.filter((b, i) => {
        if (i === 0) return false;
        const [t1, b1] = d.bulan[i - 1].split("-").map(Number);
        const [t2, b2] = b.split("-").map(Number);
        return (t2 - t1) * 12 + (b2 - b1) !== 1;
      });
      cek("tidak ada bulan yang meloncat", loncat.length === 0, loncat.slice(0, 3).join(", ") || "berurutan");
    }
  }

  // ============================================================
  console.log("\n=== 3. ⚠️ SKU BERLUBANG — alasan berkas ini ada ===");
  // ============================================================
  const [bolong] = await q<{ sku_code: string; bulan: number; rentang: number }>(
    `WITH p AS (
       SELECT sku_code, count(*)::int AS bulan,
              (EXTRACT(year FROM age(max(period), min(period)))*12
               + EXTRACT(month FROM age(max(period), min(period))) + 1)::int AS rentang
         FROM ai_forecast_sales_monthly WHERE source='ba_sales' AND sku_code NOT IN (SELECT item_code FROM trx_ba_sales WHERE trx_date >= '2026-08-01' AND qty <> 0 AND item_code IS NOT NULL) GROUP BY 1)
     SELECT sku_code, bulan, rentang FROM p
      WHERE rentang - bulan > 20 ORDER BY rentang - bulan DESC LIMIT 1`);
  if (!bolong) {
    console.log("  (tidak ada SKU berlubang besar — lewat)");
  } else {
    const h = await deretSku(bolong.sku_code);
    cek("SKU berlubang terbaca", h.ok, h.ok ? h.deret.nama.slice(0, 40) : (h as { pesan: string }).pesan);
    if (h.ok) {
      const d = h.deret;
      console.log(`         tabel punya ${bolong.bulan} baris, rentangnya ${bolong.rentang} bulan`);
      // Inti pengujian: panjang deret = RENTANG, bukan jumlah baris.
      cek("panjang deret = rentang, bukan jumlah baris",
        d.bulan.length === bolong.rentang,
        `${d.bulan.length} titik (baris ${bolong.bulan})`);
      cek("jumlah yang diisi dilaporkan benar",
        d.diisi === bolong.rentang - bolong.bulan, `${d.diisi} diisi`);
      // ⚠️ Yang diisi harus 0, bukan diinterpolasi. 0 berarti tidak terjual —
      // menebak nilai di antaranya akan mengarang penjualan yang tidak pernah
      // terjadi, dan itu persis yang tidak boleh.
      cek("ada titik bernilai 0", d.qty.some((x) => x === 0));
      cek("tidak ada nilai negatif", d.qty.every((x) => x >= 0) && d.value.every((x) => x >= 0));
    }
  }

  // ============================================================
  console.log("\n=== 4. Batas kelayakan model ===");
  // ============================================================
  // Ambang ARIMA (26) BUKAN selera: paket `arima` menolak deret lebih pendek
  // dengan "Minimum length for these parameters is 26". Diukur 26 Okt 2026.
  for (const [nama, maks, harap] of [
    ["deret 12-25 bulan -> musiman", MIN_ARIMA - 1, "musiman"],
    ["deret <12 bulan -> naive", MIN_MUSIMAN - 1, "naive"],
  ] as const) {
    const [s] = await q<{ sku_code: string; bulan: number }>(
      `SELECT sku_code, count(*)::int AS bulan FROM ai_forecast_sales_monthly
        WHERE source='ba_sales' AND sku_code NOT IN (SELECT item_code FROM trx_ba_sales WHERE trx_date >= '2026-08-01' AND qty <> 0 AND item_code IS NOT NULL) GROUP BY 1
       HAVING count(*) BETWEEN 2 AND ${maks}
          AND count(*) = (EXTRACT(year FROM age(max(period), min(period)))*12
                        + EXTRACT(month FROM age(max(period), min(period))) + 1)::int
        ORDER BY count(*) DESC LIMIT 1`);
    if (!s) { console.log(`  (tidak ada SKU untuk "${nama}" — lewat)`); continue; }
    const h = await deretSku(s.sku_code);
    cek(nama, h.ok && h.deret.kelayakan === harap,
      h.ok ? `${h.deret.bulan.length} bulan -> ${h.deret.kelayakan}` : "gagal dibaca");
  }

  console.log("\n=== 4b. Bulan penuh dari data mentah ===");
  {
    const batas = await batasSambung();
    cek("ada bulan yang disambung", Boolean(batas), JSON.stringify(batas));
    if (batas) {
      cek("bulan terakhir data ikut data mentah", (await bulanTerakhirData()) === batas.akhirBulan);
      cek("bulan yang belum penuh tidak ikut", batas.sebelum.endsWith("-01") && batas.akhirBulan < batas.sebelum.slice(0, 7));
      const h = await deretSku("1006000");
      const [m] = await q<{ qty: string; nilai: string; bulan: string }>(
        `SELECT sum(qty)::text AS qty, sum(qty * price)::text AS nilai, to_char(max(trx_date), 'YYYY-MM') AS bulan FROM trx_ba_sales
          WHERE item_code = '1006000' AND trx_date >= '${batas.akhirBulan}-01'::date AND trx_date < '${batas.sebelum}'::date`);
      cek("deret sampai bulan penuh terakhir", h.ok && h.deret.bulanTerakhir === batas.akhirBulan, h.ok ? h.deret.bulanTerakhir : "gagal");
      if (h.ok) {
        cek("unit bulan sambungan sama dengan data mentah", h.deret.qty.at(-1) === Number(m.qty), `${h.deret.qty.at(-1)} unit`);
        cek("rupiah bulan sambungan sama dengan data mentah", h.deret.value.at(-1) === Number(m.nilai));
        cek("bulan tidak terlewat atau dobel", new Set(h.deret.bulan).size === h.deret.bulan.length && h.deret.diisi === 0);
      }
      const [beda] = await q<{ n: number }>(
        `WITH m AS (SELECT item_code s, to_char(trx_date, 'YYYY-MM') b, sum(qty) q, sum(qty * price) v FROM trx_ba_sales
           WHERE trx_date >= '2026-01-01' AND trx_date < '2026-08-01' AND item_code IS NOT NULL GROUP BY 1, 2 HAVING sum(qty) <> 0),
              t AS (SELECT sku_code s, to_char(period, 'YYYY-MM') b, qty q, value v FROM ai_forecast_sales_monthly
           WHERE source = 'ba_sales' AND period >= '2026-01-01' AND period < '2026-08-01')
         SELECT count(*)::int n FROM m FULL JOIN t USING (s, b) WHERE m.q IS DISTINCT FROM t.q OR m.v IS DISTINCT FROM t.v`);
      cek("data mentah sama dengan tabel pada bulan yang ada di keduanya", beda.n === 0, `${beda.n} beda`);
    }
  }

  // ============================================================
  console.log("\n=== 5. Yang harus DITOLAK ===");
  // ============================================================
  const takAda = await deretSku("SKU-YANG-TIDAK-PERNAH-ADA");
  cek("SKU karangan ditolak", !takAda.ok && takAda.sebab === "tidak-ketemu",
    takAda.ok ? "MALAH DIBACA" : takAda.pesan.slice(0, 50));

  // ⚠️ Deret satu titik ditolak, bukan dijadikan "ramalan" berisi satu angka
  // yang diulang. Angka tanpa dasar lebih buruk daripada penolakan.
  const [satu] = await q<{ sku_code: string }>(
    `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales' AND sku_code NOT IN (SELECT item_code FROM trx_ba_sales WHERE trx_date >= '2026-08-01' AND qty <> 0 AND item_code IS NOT NULL)
      GROUP BY 1 HAVING count(*) = 1 LIMIT 1`);
  if (satu) {
    const h = await deretSku(satu.sku_code);
    cek("deret 1 bulan ditolak", !h.ok && h.sebab === "terlalu-pendek",
      h.ok ? "MALAH DITERIMA" : h.pesan.slice(0, 54));
  } else {
    console.log("  (tidak ada SKU berdata 1 bulan — lewat)");
  }

  // ============================================================
  console.log("\n=== 6. Pencarian nama: menawarkan, bukan memilihkan ===");
  // ============================================================
  cek("kata terlalu pendek ditolak", (await cariSku("ab")).length === 0);

  const calon = await cariSku("MINYAK ZAITUN");
  cek("pencarian menemukan beberapa calon", calon.length > 1, `${calon.length} calon`);
  for (const c of calon.slice(0, 3)) {
    console.log(`         ${c.sku.padEnd(12)} ${c.nama.slice(0, 36).padEnd(38)} ${c.bulan} bulan`);
  }
  // ⚠️ Urutannya DITENTUKAN (riwayat terpanjang dulu), bukan urutan database.
  // Tanpa itu, hasil pencarian berubah sendiri tiap tim lain menambah baris.
  cek("urutannya menurun menurut panjang riwayat",
    calon.every((c, i) => i === 0 || calon[i - 1].bulan >= c.bulan));
  cek("tiap calon punya kode SKU", calon.every((c) => Boolean(c.sku)));

  const takKetemu = await cariSku("PRODUK-KARANGAN-XYZ");
  cek("pencarian tanpa hasil mengembalikan kosong", takKetemu.length === 0);

  // ============================================================
  console.log("\n=== ⚠️ Nama berspasi ganda tetap bisa dicari ===");
  // ============================================================
  // 589 dari 1737 nama produk (34%) memuat spasi ganda, dan justru yang
  // terbanyak di produk terlaris. Dengan pencocokan apa adanya, mengetik
  // nama produk secara normal TIDAK menemukannya -- yang ketemu varian lain
  // yang spasinya tunggal, tanpa gejala apa pun. Terlihat 2 Nov 2026:
  // "MINYAK CEMCEMAN 175 ML RJ" menjawab tentang varian "NF" yang riwayatnya
  // 28 bulan, bukan produk 86 bulan yang dimaksud.
  {
    const spasiGanda = await cariSku("MINYAK CEMCEMAN 175 ML RJ");
    const rapikan = (t: string) => t.replace(/\s+/g, " ").trim().toUpperCase();
    const persis = spasiGanda.find((x) => rapikan(x.nama) === "MINYAK CEMCEMAN 175 ML RJ");
    cek("nama berspasi ganda ikut ketemu", persis !== undefined,
      spasiGanda.map((x) => JSON.stringify(x.nama)).join(" | ").slice(0, 70));
    cek("yang ketemu memang berspasi ganda di database",
      persis !== undefined && persis.nama.includes("  "), JSON.stringify(persis?.nama));
    cek("riwayatnya yang panjang, bukan varian baru",
      (persis?.bulan ?? 0) > 60, `${persis?.bulan} bulan`);

    // ⚠️ Kebalikannya juga: mengetik DENGAN spasi ganda harus tetap ketemu.
    const sebaliknya = await cariSku("MINYAK   CEMCEMAN  175  ML  RJ");
    cek("ketikan berspasi ganda juga ketemu", sebaliknya.length > 0, `${sebaliknya.length} hasil`);

    // Pencarian yang dirapikan TIDAK boleh jadi menangkap segalanya.
    const ngawur = await cariSku("MINYAK ZAITUN 175 ML RJ");
    cek("yang tidak nyambung tetap tidak ikut",
      ngawur.every((x) => rapikan(x.nama).includes("MINYAK ZAITUN")),
      ngawur.map((x) => x.nama).join(" | ").slice(0, 60));
  }

  // ============================================================
  console.log("\n=== ⚠️ Nama yang PERSIS menutup pertanyaan (tombol pilihan) ===");
  // ============================================================
  // Daftar varian di layar sekarang bisa DITEKAN, dan yang dikirim tombol itu
  // nama penuh dari daftar. Kalau nama penuh masih dianggap ambigu, menekan
  // tombol memulangkan daftar yang sama -- selamanya, tanpa gejala selain
  // pemakai yang menekan terus.
  //
  // ⚠️ Yang diuji SIFATNYA, bukan satu nama contoh: tiap calon yang
  // ditawarkan, dikirim kembali, HARUS menyelesaikan pertanyaannya.
  {
    const rapikan = (t: string) => t.replace(/\s+/g, " ").trim();
    const ambigu = await cariSku("MINYAK CEMCEMAN");
    cek("\"MINYAK CEMCEMAN\" memang masih ambigu", ambigu.length > 1, `${ambigu.length} calon`);

    let tuntas = 0;
    const macet: string[] = [];
    for (const c of ambigu) {
      const ulang = await cariSku(rapikan(c.nama));
      if (ulang.length === 1 && ulang[0].sku === c.sku) tuntas++;
      else macet.push(`${rapikan(c.nama)} -> ${ulang.length}`);
    }
    cek("tiap pilihan yang ditekan menyelesaikan pertanyaannya",
      tuntas === ambigu.length, macet.join(" | ").slice(0, 90) || `${tuntas}/${ambigu.length}`);

    // ⚠️ Yang paling rawan: nama yang merupakan AWALAN nama lain. Sebelum
    // perbaikan ini, "MINYAK CEMCEMAN 175 ML RJ" ikut mencocoki
    // "... 175 ML RJ NF" dan hasilnya tidak pernah tunggal.
    const awalan = await cariSku("MINYAK CEMCEMAN 175 ML RJ");
    cek("nama yang jadi awalan nama lain tetap tunggal", awalan.length === 1,
      awalan.map((x) => rapikan(x.nama)).join(" | ").slice(0, 80));
    cek("yang tunggal itu produk riwayat panjang, bukan varian NF",
      (awalan[0]?.bulan ?? 0) > 60, `${awalan[0]?.bulan} bulan`);

    // ⚠️ Huruf besar-kecil tidak boleh membatalkan kecocokan persis: tombol
    // mengirim apa adanya, tapi orang mengetik huruf kecil.
    const kecil = await cariSku("minyak cemceman 175 ml rj");
    cek("huruf kecil tetap dianggap persis", kecil.length === 1,
      `${kecil.length} hasil`);

    // Dan yang sebagian HARUS tetap bertanya -- kalau perbaikan ini terlalu
    // rakus, pertanyaan yang memang perlu ditanyakan jadi ditebak.
    cek("potongan nama tetap memulangkan daftar", ambigu.length >= 2);
  }

  // ============================================================
  console.log("\n=== Mencari lewat kode SKU (§7.1) ===");
  // ============================================================
  {
    const lewatKode = await cariSku("1005998");
    cek("kode saja menemukan satu produk", lewatKode.length === 1 && lewatKode[0].sku === "1005998",
      lewatKode.map((x) => x.nama).join(" | "));
    const tombol = await cariSku("MINYAK CEMCEMAN 175 ML RJ (kode 1005998)");
    cek("nama dan kode dari tombol menemukan produk itu", tombol.length === 1 && tombol[0].sku === "1005998");
    // ⚠️ Kasus sungguhan 3 Nov 2026: nama yang ditulis ulang model tidak ketemu.
    const salahTulis = await cariSku("MINYAK CEMCEMAN 175 ML RJ + M.ZAITUN 12ML (kode: 1006695)");
    cek("nama salah tulis tetap ketemu lewat kodenya", salahTulis.length === 1 && salahTulis[0].sku === "1006695");
    // ⚠️ Tulisan persis dari log server: Haiku membuang kodenya sekaligus.
    for (const tulisan of [
      "MINYAK CEMCEMAN 175 ML RJ + M.ZAITUN 12 ML",
      "MINYAK CEMCEMAN 175 ML RJ + M.ZAITUN 12ML",
      "minyak cemceman 175ml rj+m.zaitun 12 ml",
    ]) {
      const tulis = await cariSku(tulisan);
      cek(`beda spasi tetap produk yang sama: ${tulisan}`, tulis.length === 1 && tulis[0].sku === "1006695",
        tulis.map((x) => x.sku).join(","));
    }
    // Membuang spasi tidak boleh menyatukan ukuran yang berbeda.
    const u75 = await cariSku("MINYAK CEMCEMAN 75 ML RJ");
    cek("75 ML tidak tertukar dengan 175 ML", u75.length === 1 && u75[0].sku === "1005997",
      u75.map((x) => `${x.sku}:${x.nama}`).join(" | ").slice(0, 80));
    cek("potongan kode tidak dianggap kode", (await cariSku("10059")).every((x) => x.sku !== "1005998"));
    const kodeKarangan = await cariSku("MINYAK CEMCEMAN (kode 9999999)");
    cek("kode karangan tidak memilihkan produk", kodeKarangan.length !== 1, `${kodeKarangan.length} hasil`);
    const satuKata = await cariSku("CEMCEMAN");
    cek("satu kata yang bukan kode tetap dicari sebagai nama", satuKata.length > 1, `${satuKata.length} hasil`);
    cek("kodeDariTeks: kalimat tanpa kode", kodeDariTeks("minyak zaitun 75 ml") === null);
    const kurung = await cariSku("MINYAK CEMCEMAN 175 ML RJ (1005998)");
    cek("kode dalam kurung tanpa kata kode", kurung.length === 1 && kurung[0].sku === "1005998",
      `${kurung.length} hasil`);
    cek("kurung tanpa angka bukan kode", kodeDariTeks("MINYAK ZAITUN (REFILL)") === null);
    cek("kodeDariTeks: tiga bentuk", kodeDariTeks("1005998") === "1005998"
      && kodeDariTeks("X (kode 1005998)") === "1005998" && kodeDariTeks("X kode: AB-12") === "AB-12");
  }
} finally {
  await db.end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (gagal > 0) process.exitCode = 1;
}
