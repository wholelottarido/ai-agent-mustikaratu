/**
 * Uji pemilih model & penjaga kewajaran.
 *
 *   npm run test:ramalan-pilih
 *
 * Bagian 1-4 TANPA database — deretnya ditulis di sini, jadi yang merah
 * berarti logikanya rusak, bukan datanya berubah. Bagian 5 memakai data nyata
 * untuk membuktikan jalurnya tersambung.
 *
 * ============================================================
 * YANG PALING PENTING DIJAGA
 * ============================================================
 * Ditemukan 26 Okt 2026 waktu menyambungkan Tahap 1 dan 2: untuk
 * `MINYAK ZAITUN 75 ML`, AutoARIMA meramal 5.880 unit senilai Rp0.
 *
 * Dua ramalan yang MASING-MASING lolos pemeriksaan — tidak ada angka negatif,
 * semuanya bilangan bulat — tapi mustahil kalau disandingkan. Pemakai yang
 * membacanya tidak punya cara tahu itu salah.
 *
 * Jadi yang diuji di sini bukan "modelnya akurat", melainkan "yang mustahil
 * tidak lolos ke pemakai".
 */
import {
  pilihModel, ramalkan, hitungWape, sertakanLuar, BULAN_UJI, SERI_WAPE, WAPE_TAK_BERGUNA,
  hargaTerakhir, kandidatTurunan,
  type NilaiModel, type HasilPilih,
} from "../lib/ramalan/pilih.ts";
import type { DeretSku } from "../lib/ramalan/deret.ts";
import { deretSku, cariSku } from "../lib/ramalan/deret.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

try {
  // ============================================================
  console.log("=== 1. WAPE ===");
  // ============================================================
  cek("hitungan dasar benar", hitungWape([110, 90], [100, 100]) === 10);
  cek("tepat sekali -> 0%", hitungWape([100, 200], [100, 200]) === 0);
  // ============================================================
  // ⚠️ BULAN BERNILAI 0 IKUT DIHITUNG — DAN INILAH SEBAB PINDAH KE WAPE
  // ============================================================
  // MAPE membagi per bulan, jadi bulan nol harus DILEWATI (membaginya
  // menghasilkan tak hingga). Akibatnya, untuk produk yang jarang terjual,
  // "MAPE" bisa dihitung dari satu bulan saja dan nilainya jadi lotre.
  //
  // WAPE menjumlahkan dulu, baru membagi sekali. Bulan nol ikut sebagai
  // galat, bukan dibuang. Di contoh ini meleset 50 pada bulan yang sebenarnya
  // nol tetap dihukum — di MAPE kesalahan itu hilang tanpa jejak.
  cek("bulan bernilai 0 IKUT dihitung sebagai galat",
    hitungWape([50, 110], [0, 100]) === 60, String(hitungWape([50, 110], [0, 100])));
  // Satu-satunya keadaan tak terdefinisi yang tersisa: seluruh bulan uji nol.
  cek("semua bulan 0 -> null", hitungWape([5, 5], [0, 0]) === null);
  // Meramal nol menghasilkan tepat 100% — lantai yang dipakai `WAPE_TAK_BERGUNA`.
  cek("ramalan nol -> tepat 100%", hitungWape([0, 0, 0], [10, 20, 30]) === 100,
    String(hitungWape([0, 0, 0], [10, 20, 30])));

  // ============================================================
  console.log("\n=== 2. Pemilihan berdasarkan backtest ===");
  // ============================================================
  {
    // Deret musiman murni 36 bulan: Musiman HARUS menang telak.
    const pola = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 300];
    const d = [...pola, ...pola, ...pola];
    const h = pilihModel(d, 3);
    cek("deret musiman -> model musiman menang", h.ok && h.terpilih.kode === "musiman",
      h.ok ? `${h.terpilih.kode} (WAPE ${h.terpilih.wape?.toFixed(1)}%)` : h.sebab);
    cek("semua kandidat dilaporkan", h.kandidat.length >= 2,
      h.kandidat.map((k) => `${k.kode}:${k.wape === null ? "-" : k.wape.toFixed(0) + "%"}`).join(" "));
  }
  {
    // Deret datar: Naive sempurna, dan tidak boleh kalah oleh yang lebih rumit.
    const h = pilihModel(Array(30).fill(500), 3);
    cek("deret datar -> WAPE 0%", h.ok && h.terpilih.wape === 0,
      h.ok ? `${h.terpilih.kode} ${h.terpilih.wape}%` : h.sebab);
  }
  {
    // Deret pendek: tidak ada ruang backtest, Naive satu-satunya yang jujur.
    const h = pilihModel([10, 12, 11, 13], 2);
    cek("deret pendek tetap menghasilkan ramalan", h.ok, h.ok ? h.terpilih.kode : h.sebab);
    cek("deret pendek -> ses", h.ok && h.terpilih.kode === "ses");
  }

  // ============================================================
  console.log("\n=== 3a. Produk yang masih terjual tidak diramal sampai nol ===");
  {
    // Turun tajam tapi bulan terakhir masih terjual, seperti PEELING MUNDISARI 60 GR RJ.
    const curam = [...Array.from({ length: 30 }, () => 800), 700, 600, 500, 400, 300, 200];
    const h = pilihModel(curam, 6);
    const keNol = h.kandidat.filter((k) => k.ramalan.length > 0 && k.ramalan[k.ramalan.length - 1] <= 0);
    cek("model yang ramalannya berakhir di nol ditolak", keNol.every((k) => Boolean(k.ditolak)), keNol.map((k) => k.kode).join(",") || "tidak ada yang ke nol");
    cek("yang terpilih tidak nol semua", !h.ok || h.terpilih.ramalan.some((v) => v > 0), h.ok ? `${h.terpilih.kode}: ${h.terpilih.ramalan.join("/")}` : h.sebab);
    const mati = [...Array.from({ length: 30 }, () => 800), 0, 0, 0, 0, 0, 0];
    const hm = pilihModel(mati, 3);
    cek("produk yang sudah tidak terjual tidak terkena aturan ini",
      hm.kandidat.every((k) => !k.ditolak?.includes("masih terjual")));
  }

  console.log("\n=== 3. ⚠️ Penjaga pemangkasan ===");
  // ============================================================
  {
    // Deret menurun tajam menuju nol — ARIMA cenderung mengekstrapolasi
    // negatif, lalu seluruh hasilnya dipangkas ke 0.
    const turun = Array.from({ length: 40 }, (_, i) => Math.max(0, 4000 - i * 100));
    const h = pilihModel(turun, 6);
    const arima = h.kandidat.find((k) => k.kode === "arima");
    console.log(`         kandidat: ${h.kandidat.map((k) => `${k.kode}(dipangkas ${k.dipangkas})${k.ditolak ? " DITOLAK" : ""}`).join(", ")}`);
    // ⚠️ YANG DIUJI BUKAN "selalu ada jawaban".
    //
    // Versi pertama uji ini menuntut `h.ok` — selalu ada ramalan. Itu lolos
    // waktu satu-satunya penjaga adalah pemangkasan, karena Naive bertahan.
    // Sesudah `WAPE_TAK_BERGUNA` dipasang (27 Okt 2026) Naive ikut tertolak,
    // dan memang pantas: pada deret ini ia meleset 144% sambil menjanjikan
    // 400 unit untuk bulan yang sebenarnya menuju nol.
    //
    // Menuntut "selalu ada jawaban" berarti menuntut angka yang menyesatkan.
    // Yang benar-benar wajib dijaga: angka yang BUKAN NOL tidak boleh keluar
    // dari model yang kalah dari menebak nol.
    if (arima && arima.dipangkas / 6 > 0.5) {
      cek("model yang dipangkas berat DITOLAK", Boolean(arima.ditolak), arima.ditolak?.slice(0, 48));
    } else {
      console.log("  (ARIMA tidak dipangkas berat di deret ini — penjaga tidak tersentuh)");
    }
    cek("tidak menyodorkan angka bukan nol dari model yang gagal uji",
      !h.ok ||
        h.terpilih.wape === null ||
        h.terpilih.wape < WAPE_TAK_BERGUNA ||
        h.terpilih.ramalan.every((v) => v === 0),
      h.ok ? `${h.terpilih.kode} ${h.terpilih.wape?.toFixed(0)}% -> ${h.terpilih.ramalan.join(",")}` : h.sebab);
    cek("yang terpilih tidak pernah model yang ditolak",
      !h.ok || !h.terpilih.ditolak, h.ok ? h.terpilih.kode : "tidak ada yang terpilih");
    // Sebab penolakan WAJIB ada isinya: kandidat yang hilang tanpa alasan
    // membuat administrator mengira modelnya rusak.
    cek("tiap kandidat yang ditolak menyebut sebabnya",
      h.kandidat.filter((k) => k.ditolak).every((k) => (k.ditolak ?? "").length > 10));
  }

  // ============================================================
  console.log("\n=== 4. Peringatan ikut ke pemakai ===");
  // ============================================================
  {
    // ⚠️ BULANNYA HARUS SUNGGUHAN BERURUTAN DAN BERAKHIR DI `bulanTerakhir`.
    //
    // Versi sebelumnya mengisi `bulan` dengan "2024-01".."2024-12" berulang
    // sementara `bulanTerakhir` ditulis "2026-07". Itu lolos selama tidak ada
    // yang membaca isinya — lalu sejak `BULAN_BERHENTI` dipasang
    // (27 Okt 2026), penjualan terakhirnya terbaca "2024-05" dan produk uji
    // ini dinyatakan berhenti dijual 26 bulan lalu.
    //
    // Fixture yang tidak konsisten dengan dirinya sendiri akan menguji
    // keadaan yang tidak mungkin ada di produksi.
    const bulanBerurutan = (akhir: string, n: number) => {
      let [t, b] = akhir.split("-").map(Number);
      const keluar: string[] = [];
      for (let i = 0; i < n; i++) {
        keluar.unshift(`${t}-${String(b).padStart(2, "0")}`);
        b -= 1;
        if (b < 1) { b = 12; t -= 1; }
      }
      return keluar;
    };
    const palsu = {
      sku: "UJI-1", nama: "Produk Uji", merek: null,
      bulan: bulanBerurutan("2026-07", 30),
      // Bulan terakhir WAJIB terjual, kalau tidak produknya dianggap berhenti.
      qty: Array.from({ length: 30 }, (_, i) => (i % 4 === 1 ? 100 : 0)),
      value: Array.from({ length: 30 }, (_, i) => (i % 4 === 1 ? 5000 : 0)),
      diisi: 22, bulanTerakhir: "2026-07", kelayakan: "arima" as const,
    };
    const r = ramalkan(palsu, 3, "2026-10");
    cek("menyebut bulan terakhir data", r.peringatan.some((p) => p.includes("2026-07")),
      r.peringatan[0]?.slice(0, 54));
    cek("menyebut berapa bulan diisi 0", r.peringatan.some((p) => p.includes("22 dari 30")));
    cek("menandai riwayat terputus-putus", r.peringatan.some((p) => /terputus|kasar/.test(p)));
    // ⚠️ Data berhenti Jul, sekarang Okt — yang disajikan Nov/Des/Jan, BUKAN
    // Agu/Sep/Okt. Jedanya ditembus, bukan diperingatkan. Lihat §7.4.
    cek("bulan ramalan benar-benar BULAN KE DEPAN",
      r.bulanRamalan.join(",") === "2026-11,2026-12,2027-01", r.bulanRamalan.join(","));
    cek("tidak ada bulan ramalan yang sudah lewat", r.bulanLewat === 0, String(r.bulanLewat));
    cek("jeda data disebutkan apa adanya",
      r.peringatan.some((p) => /tertinggal 3 bulan/.test(p)),
      r.peringatan.find((p) => /tertinggal/.test(p))?.slice(0, 60));
  }
  {
    // ⚠️ INTI BAGIAN INI: qty > 0 tapi value = 0 harus DITANDAI.
    const timpang = {
      sku: "UJI-2", nama: "Timpang", merek: null,
      bulan: Array.from({ length: 30 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`),
      qty: Array(30).fill(500),
      value: Array(30).fill(0),
      diisi: 0, bulanTerakhir: "2026-07", kelayakan: "arima" as const,
    };
    const r = ramalkan(timpang, 3);
    const adaUnit = r.qty.ok && r.qty.terpilih.ramalan.some((v) => v > 0);
    const adaRupiah = r.value.ok && r.value.terpilih.ramalan.some((v) => v > 0);
    console.log(`         unit>0: ${adaUnit}  rupiah>0: ${adaRupiah}`);
    // ⚠️ YANG DIUJI AKIBATNYA, BUKAN MEKANISMENYA.
    //
    // Sejak `MIN_TITIK_UJI` dipasang (27 Okt 2026), deret rupiah yang
    // seluruhnya nol GAGAL lebih dulu — jendela ujinya tidak punya satu pun
    // bulan berisi, jadi ketepatannya tidak bisa diukur. Peringatan "tidak
    // sejalan" tidak sempat menyala, karena ia hanya menilai dua ramalan yang
    // sama-sama jadi.
    //
    // Perlindungannya tidak hilang, cuma pindah jalur: pemakai tetap tidak
    // mungkin menerima "500 unit senilai Rp0" sebagai pasangan angka yang
    // wajar. Maka yang diuji di sini keadaan akhirnya — rupiah nol tidak boleh
    // lewat tanpa penanda apa pun — supaya uji ini tetap berarti kalau
    // mekanismenya berubah lagi.
    const rupiahBerpenanda =
      !r.value.ok
        ? r.value.sebab.length > 10
        : r.peringatan.some((p) => /tidak sejalan/.test(p));
    cek("unit>0 tapi rupiah=0 tidak pernah lewat tanpa penanda",
      !adaUnit || adaRupiah || rupiahBerpenanda,
      r.value.ok
        ? (r.peringatan.find((p) => /tidak sejalan/.test(p))?.slice(0, 56) ?? "(tidak perlu)")
        : `rupiah gagal: ${r.value.sebab.slice(0, 56)}`);
  }

  // ============================================================
  console.log("\n=== 5. Data NYATA, jalur penuh ===");
  // ============================================================
  const calon = await cariSku("MINYAK ZAITUN", 2);
  cek("produk uji ketemu", calon.length > 0, `${calon.length} calon`);
  for (const c of calon) {
    const d = await deretSku(c.sku);
    if (!d.ok) { cek(`${c.nama}: deret terbaca`, false, d.pesan); continue; }
    const r = ramalkan(d.deret, 3);
    const q = r.qty.ok ? r.qty.terpilih : null;
    console.log(`\n  ${r.nama.slice(0, 40)}`);
    console.log(`    ${r.panjangDeret} bulan · model ${q?.kode ?? "-"} · WAPE ${q?.wape?.toFixed(1) ?? "-"}%`);
    console.log(`    qty   ${q?.ramalan.join(", ") ?? "-"}`);
    console.log(`    value ${r.value.ok ? r.value.terpilih.ramalan.map((v) => "Rp" + v.toLocaleString("id-ID")).join(", ") : "-"}`);
    cek(`${c.nama.slice(0, 26)}: ada ramalan qty`, r.qty.ok);
    cek(`${c.nama.slice(0, 26)}: ramalan tidak negatif`,
      !r.qty.ok || r.qty.terpilih.ramalan.every((v) => v >= 0));
    cek(`${c.nama.slice(0, 26)}: peringatan ikut`, r.peringatan.length > 0, `${r.peringatan.length} pesan`);
    cek(`${c.nama.slice(0, 26)}: kandidat lain ikut dilaporkan`,
      !r.qty.ok || r.qty.kandidat.length >= 2,
      r.qty.ok ? r.qty.kandidat.map((k) => k.kode).join(",") : "-");
  }
  // ============================================================
  console.log("\n=== 6. ⚠️ Produk berhenti vs laporan tertinggal ===");
  // ============================================================
  // Dua keadaan yang terlihat SAMA dari data — bulan terakhir produk jauh
  // dari sekarang — tapi jawabannya berlawanan:
  //
  //   laporan tertinggal : masih dijual, jedanya ditembus, pemakai dapat
  //                        bulan ke depan yang sungguhan
  //   produk berhenti    : tidak dijual lagi, TIDAK ADA angka yang keluar
  //
  // Bedanya diukur terhadap akhir data SELURUH tabel, bukan terhadap bulan
  // berjalan. Kalau diukur terhadap bulan berjalan, jeda pelaporan 3 bulan
  // akan membuat SETIAP produk terlihat berhenti.
  {
    const deretUji = (akhir: string, qtyAkhir: number[]): DeretSku => {
      const n = 30;
      const bulan: string[] = [];
      let [t, b] = akhir.split("-").map(Number);
      for (let i = 0; i < n; i++) {
        bulan.unshift(`${t}-${String(b).padStart(2, "0")}`);
        b -= 1;
        if (b < 1) { b = 12; t -= 1; }
      }
      const qty = Array.from({ length: n }, () => 100);
      qtyAkhir.forEach((v, k) => { qty[n - qtyAkhir.length + k] = v; });
      return {
        sku: "UJI", nama: "PRODUK UJI", merek: null, bulan, qty,
        value: qty.map((v) => v * 1000),
        diisi: 0, bulanTerakhir: akhir, kelayakan: "arima",
      };
    };

    const AKHIR = "2026-07";
    const SEKARANG = "2026-10";

    // (a) Masih terjual sampai bulan terakhir data -> diramal, jeda ditembus.
    const hidup = ramalkan(deretUji(AKHIR, [100, 100, 100]), 3, SEKARANG, AKHIR);
    cek("produk yang masih terjual TIDAK dinyatakan berhenti", hidup.berhenti === undefined,
      hidup.berhenti ? JSON.stringify(hidup.berhenti) : "lanjut diramal");
    cek("jeda pelaporan 3 bulan tidak dianggap berhenti", hidup.qty.ok,
      hidup.qty.ok ? hidup.qty.terpilih.kode : hidup.qty.sebab);
    cek("bulan yang disajikan ada di masa depan",
      hidup.bulanRamalan.every((b) => b > SEKARANG) && hidup.bulanRamalan.length === 3,
      hidup.bulanRamalan.join(","));

    // (b) Berhenti terjual 3 bulan SEBELUM akhir data -> tidak diramal.
    const mati = ramalkan(deretUji(AKHIR, [0, 0, 0]), 3, SEKARANG, AKHIR);
    cek("produk yang berhenti terjual DINYATAKAN berhenti", Boolean(mati.berhenti),
      mati.berhenti ? `terakhir ${mati.berhenti.bulanTerakhirTerjual}, diam ${mati.berhenti.diamBulan} bulan` : "-");
    // INTI BAGIAN INI: tidak ada satu angka pun yang keluar.
    cek("tidak ada ramalan sama sekali untuk produk berhenti",
      !mati.qty.ok && !mati.value.ok && mati.bulanRamalan.length === 0);
    cek("sebabnya menyebut bulan penjualan terakhir",
      mati.peringatan.some((p) => p.includes("2026-04")),
      mati.peringatan[0]?.slice(0, 70));
    cek("menyarankan koordinasi, bukan menebak",
      mati.peringatan.some((p) => /SCM/.test(p)));

    // (c) Berhenti 2 bulan -> MASIH di bawah ambang, tetap diramal.
    const nyaris = ramalkan(deretUji(AKHIR, [100, 0, 0]), 3, SEKARANG, AKHIR);
    cek("diam 2 bulan masih di bawah ambang", nyaris.berhenti === undefined,
      nyaris.berhenti ? "dinyatakan berhenti" : "tetap diramal");

    // (d) Tanpa `akhirData`, penilaian berhenti tidak boleh menyala sendiri.
    const tanpaAcuan = ramalkan(deretUji(AKHIR, [100, 100, 100]), 3, SEKARANG);
    cek("tanpa acuan akhir data, tidak ada yang dicap berhenti",
      tanpaAcuan.berhenti === undefined);
  }
  // ============================================================
  console.log("\n=== 7. ⚠️ Unit dan rupiah tidak boleh berlawanan ===");
  // ============================================================
  // Terlihat di layar 26 Okt 2026: unit naik +13% enam bulan sementara rupiah
  // DIAM di satu angka, karena qty dimenangkan AutoARIMA dan value
  // dimenangkan Naive — selisih 1,1 poin persen.
  //
  // ⚠️ Yang diuji SIFATNYA, bukan nama modelnya. Menuliskan "value harus
  // arima" membuat uji ini merah begitu datanya bergeser, padahal tidak ada
  // yang rusak — pelajaran yang sudah dua kali tercatat di Tahap 17.
  {
    const uji = await cariSku("MINYAK ZAITUN", 8);
    let diperiksa = 0;
    let melanggar: string[] = [];
    for (const c of uji) {
      const d = await deretSku(c.sku);
      if (!d.ok) continue;
      const r = ramalkan(d.deret, 6);
      if (!r.qty.ok || !r.value.ok) continue;
      const q = r.qty.terpilih;
      const v = r.value.terpilih;
      if (q.kode === v.kode) { diperiksa++; continue; }

      // Model berbeda hanya boleh kalau penggantinya memang jauh lebih buruk,
      // tidak sah, atau ketepatannya tidak terukur.
      const sama = r.value.kandidat.find((k) => k.kode === q.kode);
      const boleh =
        !sama || Boolean(sama.ditolak) || sama.wape === null || v.wape === null ||
        sama.wape - v.wape > SERI_WAPE;
      if (!boleh) melanggar.push(`${r.nama.slice(0, 24)} (qty ${q.kode}, value ${v.kode})`);
      diperiksa++;
    }
    cek("ada produk yang diperiksa", diperiksa > 0, `${diperiksa} produk`);
    cek(`beda model hanya kalau selisihnya > ${SERI_WAPE} poin`, melanggar.length === 0,
      melanggar.length ? melanggar.join(" | ") : `${diperiksa} produk patuh`);

    // \b supaya "175 ML RJ" tidak ikut tertangkap — yang dilaporkan 75 ML.
    const satu = uji.find((c) => /\b75 ML RJ/.test(c.nama));
    if (satu) {
      const d = await deretSku(satu.sku);
      if (d.ok) {
        const r = ramalkan(d.deret, 6);
        const rp = r.value.ok ? r.value.terpilih.ramalan : [];
        const datar = rp.length > 1 && rp.every((v) => v === rp[0]);
        const unitGerak = r.qty.ok && new Set(r.qty.terpilih.ramalan).size > 1;
        console.log(`    ${r.nama.slice(0, 34)} · qty ${r.qty.ok ? r.qty.terpilih.kode : "-"} · value ${r.value.ok ? r.value.terpilih.kode : "-"}`);
        // Inilah bentuk kegagalan yang dilaporkan: unit bergerak, rupiah diam.
        cek("kasus yang dilaporkan sudah tidak muncul", !(unitGerak && datar),
          unitGerak && datar ? "unit bergerak tapi rupiah datar" : "dua satuan sejalan");
        // ⚠️ Kalau model rupiah yang dipakai BUKAN pemenang backtest-nya,
        // pemakai harus diberitahu — kalau tidak, WAPE yang dia baca milik
        // model yang angkanya tidak dia lihat.
        if (r.value.ok) {
          const berMape = r.value.kandidat
            .filter((k) => !k.ditolak && k.wape !== null)
            .sort((a, b) => a.wape! - b.wape!);
          const ditukar = berMape.length > 0 && berMape[0].kode !== r.value.terpilih.kode;
          cek("penukaran model rupiah diberitahukan ke pemakai",
            !ditukar || r.peringatan.some((p) => /agar sejalan/.test(p)),
            ditukar ? `ditukar dari ${berMape[0].kode} ke ${r.value.terpilih.kode}` : "tidak ada penukaran");
        }
      }
    }
  }

  // ============================================================
  console.log("\n=== 8. Kandidat dari luar (LightGBM tim sebelah) ===");
  // ============================================================
  // ⚠️ Dia bersaing dengan aturan yang SAMA. Tidak ada bonus karena
  // "machine learning" — yang menentukan tetap WAPE pada jendela uji kita.
  {
    const buat = (wape: number | null, ditolak?: string): NilaiModel => ({
      kode: "lightgbm", nama: "LightGBM (model tim Super Tools)", wape,
      ramalan: [9, 9, 9], dipangkas: 0, galatUji: [1, 1, 1], lo: [8, 8, 8], hi: [10, 10, 10],
      ...(ditolak ? { ditolak } : {}),
    });
    const kita = (wape: number | null): HasilPilih => ({
      ok: true,
      terpilih: { kode: "naive", nama: "Naive", wape, ramalan: [5, 5, 5], dipangkas: 0, galatUji: [2, 2, 2], lo: [3, 3, 3], hi: [7, 7, 7] },
      kandidat: [{ kode: "naive", nama: "Naive", wape, ramalan: [5, 5, 5], dipangkas: 0, galatUji: [2, 2, 2], lo: [3, 3, 3], hi: [7, 7, 7] }],
    });

    const menang = sertakanLuar(kita(30), buat(12));
    cek("lebih tepat -> dipakai", menang.ok && menang.terpilih.kode === "lightgbm",
      menang.ok ? `${menang.terpilih.kode} ${menang.terpilih.wape}%` : "-");

    const kalah = sertakanLuar(kita(12), buat(30));
    cek("kurang tepat -> TIDAK dipakai", kalah.ok && kalah.terpilih.kode === "naive",
      kalah.ok ? kalah.terpilih.kode : "-");
    // ⚠️ Kalah bukan berarti hilang: pembaca hasil harus bisa melihat dia
    // sudah dicoba dan berapa melesetnya.
    cek("yang kalah tetap dilaporkan sebagai kandidat",
      kalah.kandidat.some((k) => k.kode === "lightgbm"),
      kalah.kandidat.map((k) => k.kode).join(","));

    // Yang tak terukur tidak bisa dibandingkan dengan yang terukur.
    const takUkur = sertakanLuar(kita(30), buat(null));
    cek("ketepatan tak terukur -> TIDAK pernah dipakai",
      takUkur.ok && takUkur.terpilih.kode === "naive", takUkur.ok ? takUkur.terpilih.kode : "-");

    const ditolak = sertakanLuar(kita(30), buat(5, "datanya tidak cocok"));
    cek("kandidat yang ditolak -> TIDAK dipakai walau WAPE-nya terkecil",
      ditolak.ok && ditolak.terpilih.kode === "naive", ditolak.ok ? ditolak.terpilih.kode : "-");

    // Kalau model kita semuanya gagal, kandidat luar yang sah menyelamatkan.
    const semuaGagal: HasilPilih = { ok: false, sebab: "tidak ada yang masuk akal", kandidat: [] };
    const tertolong = sertakanLuar(semuaGagal, buat(20));
    cek("model kita semua gagal -> kandidat luar dipakai",
      tertolong.ok && tertolong.terpilih.kode === "lightgbm",
      tertolong.ok ? tertolong.terpilih.kode : tertolong.sebab);
  }

  // ============================================================
  console.log("\n=== 9. Tidak terukur tidak boleh dipilih ===");
  // ============================================================
  {
    // ⚠️ DERET NYATA, disalin dari `BQ ULTRA MATTE LIP CR 03 FEARLESS STAR`
    // (27 Okt 2026). Dulu produk ini menyajikan "2, 2, 2" ke pemakai dari
    // Croston yang TIDAK PERNAH DIUKUR — bukan karena ada yang error, tapi
    // karena ia kebetulan kandidat pertama dalam array.
    //
    // Yang membuatnya mungkin: 17 bulan pertama TIDAK punya satu pun bulan
    // nol, jadi penjaga keterputusan menolak Croston waktu backtest; tiga
    // bulan terakhir punya dua, jadi ia diterima waktu meramal. Lulus di
    // deret penuh, gagal di deret latih.
    const nyata = [7, 8, 1, 4, 1, 4, 11, 3, 10, 5, 9, 5, 7, 6, 5, 6, 4, 0, 0, 2];
    const h = pilihModel(nyata, 3);
    // ⚠️ Asersinya DIUBAH 27 Okt 2026 sore, dan sebabnya penting. Dulu di sini
    // tertulis "semua model ditolak" — tapi itu kebetulan angka, bukan sifat
    // yang dijaga: dengan backtest beberapa jendela, Naive dinilai di 6 bulan
    // dan mencetak 76,5%, jadi ia menang dengan sah. Yang BENAR-BENAR dijaga
    // adalah pemenangnya selalu TERUKUR, dan itulah yang ditulis sekarang.
    // Menuliskan "harus gagal" akan membuat uji ini merah tiap kali datanya
    // membaik — pelajaran yang sudah tercatat di Tahap 17.
    cek("pemenangnya selalu punya angka ketepatan",
      !h.ok || h.terpilih.wape !== null,
      h.ok ? `${h.terpilih.kode} wape=${h.terpilih.wape?.toFixed(1)}` : h.sebab);
    cek("tidak ada kandidat tak terukur yang lolos",
      h.kandidat.every((k) => k.ditolak || k.wape !== null),
      h.kandidat.map((k) => `${k.kode}=${k.ditolak ? "tolak" : k.wape}`).join(" "));
    cek("alasannya menyebut ketepatannya tidak bisa diukur",
      h.kandidat.some((k) => (k.ditolak ?? "").includes("tidak bisa diukur")),
      h.kandidat.find((k) => (k.ditolak ?? "").includes("tidak bisa diukur"))?.kode ?? "-");

    // ⚠️ YANG TIDAK BOLEH IKUT BERUBAH: deret yang memang terlalu pendek untuk
    // diuji sama sekali. Di sana tidak ada yang terukur, dan Naive tetap
    // jawaban yang jujur — bukan penolakan.
    const pendek = pilihModel([120, 130, 125], 3);
    cek("deret terlalu pendek untuk diuji -> SES tetap dipakai",
      pendek.ok && pendek.terpilih.kode === "ses" && pendek.terpilih.wape === null,
      pendek.ok ? `${pendek.terpilih.kode} wape=${pendek.terpilih.wape}` : pendek.sebab);
  }

  // ============================================================
  console.log("\n=== 10. Satu satuan bergerak, satunya rata -> diberitahukan ===");
  // ============================================================
  {
    // ⚠️ Keadaan yang TIDAK bisa diselesaikan `seragamkanSatuan()`: unit
    // dimenangkan LightGBM, yang memang tidak punya pasangan untuk rupiah
    // (model tim sebelah hanya dilatih untuk unit). Tidak ada model yang bisa
    // disalin ke mana pun, jadi satu-satunya yang jujur adalah mengatakannya.
    // Terlihat 29 Okt 2026 di `MINYAK CEMCEMAN 75 ML RJ NF`: unit 3.680 ->
    // 3.944 sementara rupiah diam di satu angka.
    //
    // ⚠️ DIBUAT PASTI, bukan bergantung data hari ini. Versi pertama uji ini
    // memeriksa produk sungguhan dan lolos dengan catatan "tidak bentrok di
    // data hari ini" — asersi yang tidak menguji apa pun.
    //
    // ⚠️ Deretnya TIDAK boleh datar: pada deret datar Naive mencetak WAPE 0%
    // dan tidak mungkin dikalahkan, jadi LightGBM tidak akan pernah menang.
    // Unit dibuat naik-turun supaya Naive buruk di sana; rupiah dibuat datar
    // supaya pemenangnya menghasilkan angka yang rata.
    // ⚠️ 20 bulan, bukan 30: di bawah 26 AutoARIMA tidak ikut, jadi yang
    // bersaing cuma Naive dan Musiman dan hasilnya bisa diramalkan.
    // Angkanya ditulis tangan dan sengaja TIDAK berpola 12-bulanan — kalau
    // berpola, Musiman mencetak 0% dan tidak mungkin dikalahkan.
    const QTY = [97, 118, 83, 131, 102, 76, 124, 95, 140, 88,
                 109, 71, 133, 101, 92, 120, 80, 115, 99, 128];
    const n = QTY.length;
    const bulan: string[] = [];
    let [th, bl] = [2026, 7];
    for (let i = 0; i < n; i++) {
      bulan.unshift(`${th}-${String(bl).padStart(2, "0")}`);
      bl -= 1;
      if (bl < 1) { bl = 12; th -= 1; }
    }
    const bentukSku: DeretSku = {
      sku: "UJI-BENTUK", nama: "PRODUK UJI BENTUK", merek: null,
      bulan,
      qty: QTY,
      // Rupiah DATAR: pemenangnya pasti menghasilkan angka yang rata.
      value: Array.from({ length: n }, () => 100_000),
      diisi: 0, bulanTerakhir: "2026-07", kelayakan: "musiman",
    };
    const mlPalsu = {
      ramalan: [120, 140, 160],
      wape: 1,
      galatUji: [2, 3, 4, 2, 3, 4, 2, 3, 4],
      dilatih: "2026-10-20",
    };
    const rataA = (a: number[]) => a.length > 1 && new Set(a).size === 1;
    const BENTROK = /JANGAN membaca perubahan harga per unit/;

    const rb = ramalkan(bentukSku, 3, "2026-07", "2026-07", mlPalsu);
    cek("LightGBM menang untuk unit", rb.qty.ok && rb.qty.terpilih.kode === "lightgbm",
      rb.qty.ok ? `${rb.qty.terpilih.kode} (${rb.qty.terpilih.wape?.toFixed(1)}%)` : rb.qty.sebab);
    cek("unit bergerak, rupiah rata",
      rb.qty.ok && rb.value.ok && !rataA(rb.qty.terpilih.ramalan) && rataA(rb.value.terpilih.ramalan),
      rb.qty.ok && rb.value.ok
        ? `${rb.qty.terpilih.ramalan.join(",")} vs ${rb.value.terpilih.ramalan.join(",")}` : "-");
    cek("pemakai DIBERITAHU bentuknya bentrok", rb.peringatan.some((p) => BENTROK.test(p)),
      rb.peringatan.find((p) => BENTROK.test(p))?.slice(0, 46) ?? "tidak ada");

    // ⚠️ Sisi sebaliknya, dan ini yang menjaga peringatannya tidak jadi
    // kebisingan: TANPA kandidat LightGBM, kedua satuan dimenangkan model
    // yang sebentuk, dan peringatannya TIDAK BOLEH muncul.
    const rt = ramalkan(bentukSku, 3, "2026-07", "2026-07");
    // ⚠️ Yang diperiksa MODELNYA SAMA, bukan bentuknya sama. Deret uji ini
    // sengaja punya unit naik-turun dan rupiah datar, jadi satu model yang
    // sama pun menghasilkan dua bentuk berbeda — dan itu BUKAN keadaan yang
    // diperingatkan, karena bedanya datang dari data, bukan dari pilihan
    // model. Asersi pertama di sini sempat salah sasaran persis di situ.
    cek("tanpa LightGBM, kedua satuan memakai model yang sama",
      rt.qty.ok && rt.value.ok && rt.qty.terpilih.kode === rt.value.terpilih.kode,
      rt.qty.ok && rt.value.ok ? `${rt.qty.terpilih.kode} / ${rt.value.terpilih.kode}` : "-");
    cek("model sama -> peringatan bentrok TIDAK muncul walau bentuknya beda",
      !rt.peringatan.some((p) => BENTROK.test(p)),
      rt.qty.ok && rt.value.ok
        ? `${rataA(rt.qty.terpilih.ramalan) ? "rata" : "bergerak"} vs ${rataA(rt.value.terpilih.ramalan) ? "rata" : "bergerak"}`
        : "-");
  }


  // ============================================================
  console.log("\n=== 11. ⚠️ Kandidat rupiah 'unit x harga per unit' ===");
  // ============================================================
  {
    // Harga naik pelan dan teratur, unit bergerak -- keadaan yang membuat
    // cara ini masuk akal.
    const n = 30;
    const unit: number[] = [];
    const rupiah: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = 100 + ((i * 7) % 23) - 11;
      const harga = 10_000 + i * 200;
      unit.push(u);
      rupiah.push(u * harga);
    }

    cek("harga terakhir diambil dari bulan terakhir yang ada penjualannya",
      Math.round(hargaTerakhir(unit, rupiah, n) ?? 0) === 10_000 + (n - 1) * 200,
      String(Math.round(hargaTerakhir(unit, rupiah, n) ?? 0)));

    // ⚠️ Bulan nol DILEWATI, bukan memulangkan Infinity.
    cek("bulan tanpa penjualan dilewati",
      hargaTerakhir([5, 0], [50_000, 0], 2) === 10_000,
      String(hargaTerakhir([5, 0], [50_000, 0], 2)));
    cek("tidak ada penjualan sama sekali -> null",
      hargaTerakhir([0, 0], [0, 0], 2) === null);

    // ⚠️ INI PENJAGA YANG PALING MENENTUKAN: harga tiap jendela harus datang
    // dari dalam jendela LATIH. Kalau ia mengintip harga bulan yang sedang
    // diujikan, kandidat ini akan terlihat lebih tepat daripada yang
    // sebenarnya -- lalu menang dengan angka yang tidak pernah benar.
    const k = kandidatTurunan(unit, rupiah, "ses", [120, 120, 120], 3);
    cek("kandidat terbentuk", k !== null);
    cek("ketepatannya terukur", k?.wape !== null && k?.wape !== undefined, String(k?.wape?.toFixed(1)));
    cek("galat uji sepanjang seluruh jendela", k?.galatUji.length === 9, String(k?.galatUji.length));
    cek("tidak mengintip: harga naik terus, jadi tebakannya SELALU kurang",
      (k?.wape ?? 0) > 0, String(k?.wape?.toFixed(2)));
    cek("ramalannya = unit x harga terakhir",
      k?.ramalan[0] === Math.round(120 * (10_000 + (n - 1) * 200)), String(k?.ramalan[0]));

    // Kandidat yang tidak bisa diukur penuh TIDAK boleh ikut.
    cek("lightgbm tanpa ramalan per bulan uji -> null",
      kandidatTurunan(unit, rupiah, "lightgbm", [120, 120, 120], 3) === null);
    cek("lightgbm dengan panjang salah -> null",
      kandidatTurunan(unit, rupiah, "lightgbm", [120, 120, 120], 3, [1, 2, 3]) === null);
    cek("lightgbm dengan panjang benar -> terbentuk",
      kandidatTurunan(unit, rupiah, "lightgbm", [120, 120, 120], 3,
        Array.from({ length: 9 }, () => 100)) !== null);
    cek("tanpa jendela -> null", kandidatTurunan(unit, rupiah, "ses", [120], 0) === null);

    // ⚠️ Hanya menang kalau LEBIH TEPAT. `sertakanLuar()` yang memutuskan,
    // dan kandidat yang seri TIDAK menggeser yang sudah ada.
    const seri: NilaiModel = {
      kode: "naive", nama: "Naive", wape: 10, ramalan: [1], dipangkas: 0,
      galatUji: [1], lo: [0], hi: [2],
    };
    const lebihBaik: NilaiModel = { ...seri, kode: "turunan-harga", wape: 9.9 };
    const samaSaja: NilaiModel = { ...seri, kode: "turunan-harga", wape: 10 };
    const lebihBuruk: NilaiModel = { ...seri, kode: "turunan-harga", wape: 10.1 };
    const dasar = { ok: true as const, terpilih: seri, kandidat: [seri] };
    cek("lebih tepat -> menang",
      sertakanLuar(dasar, lebihBaik).ok &&
        (sertakanLuar(dasar, lebihBaik) as { terpilih: NilaiModel }).terpilih.kode === "turunan-harga");
    cek("seri -> TIDAK menggeser",
      (sertakanLuar(dasar, samaSaja) as { terpilih: NilaiModel }).terpilih.kode === "naive");
    cek("lebih buruk -> TIDAK menggeser",
      (sertakanLuar(dasar, lebihBuruk) as { terpilih: NilaiModel }).terpilih.kode === "naive");
    cek("yang kalah tetap tercantum sebagai kandidat",
      sertakanLuar(dasar, lebihBuruk).kandidat.some((x) => x.kode === "turunan-harga"));
  }

  void BULAN_UJI;
} finally {
  await poolPerusahaan().end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (gagal > 0) process.exitCode = 1;
}
