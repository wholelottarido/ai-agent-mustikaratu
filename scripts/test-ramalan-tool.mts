/**
 * Uji tool `ramal_penjualan` — bentuk hasilnya, bukan kalimat modelnya.
 *
 *   npm run test:ramalan-tool
 *
 * HANYA MEMBACA. Tidak memanggil model bahasa sama sekali: yang diuji di sini
 * apa yang DITERIMA model, bukan apa yang dia tulis. Kalimatnya berubah tiap
 * kali dijalankan; bentuk hasilnya tidak, dan itu yang bisa dijaga.
 *
 * ============================================================
 * YANG DIJAGA
 * ============================================================
 * 1. Nama produk ambigu BERHENTI, bukan ditebak. "Minyak Zaitun" cocok ke 8
 *    SKU berukuran berbeda; meramal salah satunya menghasilkan angka yang
 *    terlihat sah untuk produk yang bukan dimaksud.
 * 2. Ketidakpastian IKUT. WAPE dan peringatan harus ada di hasil — angka
 *    ramalan tanpa keduanya tidak bisa dinilai pembacanya.
 * 3. Gagal MENGAKU gagal. Tidak pernah ada angka pengganti.
 * 4. Horizon dibatasi. Backtest menilai pada 3 bulan; meramal 12 bulan dari
 *    penilaian 3 bulan berarti menyodorkan ketepatan yang tidak pernah diuji.
 */
import { BATAS_TREN, ringkasTren } from "../lib/ramalan/tren.ts";
import { pengaliRentang, ukurJarak, volumePenjualan } from "../lib/ramalan/jarak.ts";
import { faktorBulan, hitungPola } from "../lib/ramalan/pola.ts";
import { ramalkan } from "../lib/ramalan/pilih.ts";
import { keteranganKalender } from "../lib/ramalan/kalender.ts";
import { buatToolRamalan } from "../voltagent/tools-ramalan.ts";
import { cariSku, deretSku } from "../lib/ramalan/deret.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const alat = buatToolRamalan();
type Hasil = Record<string, unknown>;
const jalankan = (a: Record<string, unknown>) => alat.execute!(a as never) as Promise<Hasil>;

try {
  // ============================================================
  console.log("=== 1. Bentuk tool ===");
  // ============================================================
  cek("namanya ramal_penjualan", alat.name === "ramal_penjualan");
  const bentuk = Object.keys(
    (alat as unknown as { parameters?: { shape?: Record<string, unknown> } }).parameters?.shape ?? {});
  cek("parameternya produk + bulan", bentuk.sort().join(",") === "bulan,produk", bentuk.join(","));
  // Deskripsi adalah satu-satunya dasar model memutuskan kapan memakai tool.
  cek("deskripsinya melarang model menghitung sendiri",
    /BUKAN perkiraan kamu sendiri/i.test(alat.description ?? ""));
  cek("deskripsinya menyuruh menyampaikan ketepatan & peringatan",
    /wape/i.test(alat.description ?? "") && /peringatan/i.test(alat.description ?? ""));

  // ============================================================
  console.log("\n=== 2. ⚠️ Ambigu BERHENTI, bukan menebak ===");
  // ============================================================
  {
    const h = await jalankan({ produk: "MINYAK ZAITUN" });
    const pilihan = (h.pilihan ?? []) as unknown[];
    cek("nama ambigu -> perlu-diperjelas", h.status === "perlu-diperjelas", String(h.status));
    cek("daftar pilihannya ikut", pilihan.length > 1, `${pilihan.length} pilihan`);
    cek("TIDAK ada angka ramalan waktu ambigu",
      h.jumlah_unit === undefined && h.bulan_diramal === undefined);
    const satu = pilihan[0] as Record<string, unknown>;
    cek("tiap pilihan menyebut kode & riwayat",
      Boolean(satu?.kode) && typeof satu?.riwayat_bulan === "number",
      `${satu?.kode} · ${satu?.riwayat_bulan} bulan`);
  }

  // ============================================================
  console.log("\n=== 3. Ramalan yang sah ===");
  // ============================================================
  const calon = await cariSku("MINYAK ZAITUN", 1);
  if (calon.length === 0) {
    cek("ada produk untuk diuji", false, "tidak ketemu");
  } else {
    // Nama persis -> satu hasil -> langsung meramal.
    const h = await jalankan({ produk: calon[0].nama, bulan: 3 });
    cek("nama persis -> langsung meramal", h.status === "siap", String(h.status));
    if (h.status === "siap") {
      const unit = h.jumlah_unit as Record<string, unknown>;
      const rupiah = h.nilai_rupiah as Record<string, unknown>;
      const ramal = (unit.ramalan ?? []) as number[];
      console.log(`         ${(h.produk as Record<string, string>).nama}`);
      console.log(`         ${unit.model} · WAPE ${unit.ketepatan_wape_persen}% · ${ramal.join(", ")}`);

      cek("3 angka untuk horizon 3", ramal.length === 3);
      cek("tidak ada angka negatif", ramal.every((v) => v >= 0));
      cek("semuanya bilangan bulat", ramal.every(Number.isInteger));
      cek("bulan yang diramal disebut", Array.isArray(h.bulan_diramal) && (h.bulan_diramal as string[]).length === 3,
        (h.bulan_diramal as string[])?.join(", "));
      // ⚠️ Ketidakpastian WAJIB ikut.
      cek("model yang dipakai disebut", typeof unit.model === "string" && (unit.model as string).length > 0);
      cek("WAPE ikut", unit.ketepatan_wape_persen !== undefined);
      cek("rupiah ikut diramal", Array.isArray(rupiah.ramalan));
      cek("peringatan ikut", Array.isArray(h.peringatan) && (h.peringatan as string[]).length > 0,
        (h.peringatan as string[])?.[0]?.slice(0, 50));
      // ⚠️ Bulan terakhir data disebut — tabelnya tertinggal ~3 bulan, dan
      // pemakai harus tahu ramalan "bulan depan" itu dari kapan.
      const riwayat = h.riwayat as Record<string, unknown>;
      cek("bulan terakhir data disebut", typeof riwayat.data_terakhir === "string",
        String(riwayat.data_terakhir));
      cek("model yang kalah ikut dilaporkan",
        Array.isArray(h.model_lain) && (h.model_lain as unknown[]).length >= 1,
        `${(h.model_lain as unknown[])?.length} model lain`);
      cek("catatan melarang model menambah angka",
        /JANGAN menambah angka/i.test(String(h.catatan)));
    }
  }

  // ============================================================
  console.log("\n=== 4. Yang harus DITOLAK ===");
  // ============================================================
  {
    const h = await jalankan({ produk: "PRODUK-KARANGAN-TIDAK-ADA" });
    cek("produk karangan -> tidak-ketemu", h.status === "tidak-ketemu", String(h.pesan).slice(0, 48));
    cek("tidak ada angka waktu produk tidak ada", h.jumlah_unit === undefined);
  }
  {
    // Horizon di luar batas ditolak SKEMA, sebelum sampai ke kode.
    const skema = (alat as unknown as { parameters: { safeParse(v: unknown): { success: boolean } } }).parameters;
    cek("horizon 12 ditolak skema", !skema.safeParse({ produk: "abc", bulan: 12 }).success);
    cek("horizon 0 ditolak skema", !skema.safeParse({ produk: "abc", bulan: 0 }).success);
    cek("horizon 6 diterima", skema.safeParse({ produk: "abc", bulan: 6 }).success);
    cek("nama produk 2 huruf ditolak", !skema.safeParse({ produk: "ab" }).success);
    cek("bulan boleh kosong", skema.safeParse({ produk: "minyak zaitun" }).success);
  }
  // ============================================================
  console.log("\n=== 5. ⚠️ Angka tidak terpercaya tidak pernah polos ===");
  // ============================================================
  // Terukur 27 Okt 2026: dari 300 produk terlaris, seperempatnya punya galat
  // uji lebih besar daripada total penjualannya sendiri — dan semuanya dulu
  // DISAJIKAN sebagai ramalan biasa. Contoh terburuk: MINUMAN BERAS KENCUR B
  // 200 ML, disodorkan 21 unit/bulan dengan galat 449%.
  //
  // ⚠️ YANG DIUJI SIFATNYA, BUKAN BENTUK JAWABANNYA. Dalam sehari jawabannya
  // sudah berubah dua kali: mula-mula "tidak-bisa", lalu rata-rata 3 bulan
  // yang diberi label. Yang TIDAK boleh berubah: angka yang tidak terpercaya
  // tidak pernah keluar sebagai ramalan model tanpa penanda apa pun.
  {
    const calon = await cariSku("MINUMAN", 8);
    let diperiksa = 0;
    let adaPenanda = 0;
    const telanjang: string[] = [];
    for (const c of calon) {
      const h = (await jalankan({ produk: c.nama })) as unknown as Record<string, unknown>;
      if (h.status === "produk-berhenti" || h.status === "tidak-bisa") {
        diperiksa++;
        adaPenanda++;
        if (h.jumlah_unit !== undefined || h.nilai_rupiah !== undefined) {
          telanjang.push(`${c.nama.slice(0, 22)}: ${h.status} tapi tetap ada angka`);
        }
        continue;
      }
      if (h.status !== "siap") continue;
      diperiksa++;
      const unit = h.jumlah_unit as { ketepatan_wape_persen: number | null; ini_bukan_hasil_model?: string };
      const bertanda = Boolean(unit.ini_bukan_hasil_model);
      if (bertanda) adaPenanda++;
      const w = unit.ketepatan_wape_persen;
      if (w !== null && w > 50 && !bertanda) telanjang.push(`${c.nama.slice(0, 22)}: WAPE ${w}% tanpa penanda`);
    }
    cek("ada produk yang diperiksa", diperiksa > 0, `${diperiksa} produk`);
    cek("angka tidak terpercaya tidak pernah keluar tanpa penanda", telanjang.length === 0,
      telanjang.length ? telanjang.slice(0, 2).join(" | ") : `${adaPenanda} dari ${diperiksa} diberi penanda`);
  }

  // ============================================================
  console.log("\n=== 6. Rentang prediksi ikut ===");
  // ============================================================
  // Satu angka ramalan membuat pembacanya mengira kita tahu persis.
  {
    const calon = await cariSku("MINYAK ZAITUN 175 ML RJ", 1);
    cek("produk acuan ketemu", calon.length === 1, `${calon.length} calon`);
    if (calon.length === 1) {
      const h = (await jalankan({ produk: calon[0].nama, bulan: 3 })) as unknown as Record<string, unknown>;
      cek("ramalan siap", h.status === "siap", String(h.status));
      if (h.status === "siap") {
        const u = h.jumlah_unit as { ramalan: number[]; paling_rendah?: number[]; paling_tinggi?: number[] };
        cek("rentang ikut dipulangkan", Array.isArray(u.paling_rendah) && Array.isArray(u.paling_tinggi),
          u.paling_rendah ? `${u.paling_rendah[0]} - ${u.paling_tinggi?.[0]}` : "tidak ada");
        cek("panjang rentang sama dengan panjang ramalan",
          u.paling_rendah?.length === u.ramalan.length && u.paling_tinggi?.length === u.ramalan.length,
          `${u.paling_rendah?.length} vs ${u.ramalan.length}`);
        cek("batas bawah tidak negatif", (u.paling_rendah ?? []).every((v) => v >= 0));
        cek("ramalan ada di dalam rentangnya",
          u.ramalan.every((v, i) => v >= (u.paling_rendah ?? [])[i] && v <= (u.paling_tinggi ?? [])[i]),
          `${u.paling_rendah?.[0]} <= ${u.ramalan[0]} <= ${u.paling_tinggi?.[0]}`);
      }
    }
  }
  // ============================================================
  console.log("\n=== 7. LightGBM tim sebelah ikut bersaing ===");
  // ============================================================
  // Diukur 27 Okt 2026 pada 60 produk terlaris, jendela uji disamakan:
  // LightGBM menang 16 dari 56. Yang diuji di sini BUKAN "dia menang",
  // melainkan "dia benar-benar ikut dipertimbangkan, dan kalau dilewati
  // alasannya disebutkan".
  {
    const calon = await cariSku("MINYAK", 6);
    let siap = 0, ikut = 0, beralasan = 0, menang = 0;
    const sunyi: string[] = [];
    for (const c of calon) {
      const h = (await jalankan({ produk: c.nama, bulan: 3 })) as unknown as Record<string, unknown>;
      if (h.status !== "siap") continue;
      siap++;
      const unit = h.jumlah_unit as { model: string };
      const lain = (h.model_lain ?? []) as { model: string }[];
      const dilewati = h.lightgbm_dilewati as string | undefined;
      const adaDiDaftar = /lightgbm/i.test(unit.model) || lain.some((m) => /lightgbm/i.test(m.model));
      if (/lightgbm/i.test(unit.model)) menang++;
      if (adaDiDaftar) ikut++;
      else if (dilewati && dilewati.length > 10) beralasan++;
      // Hilang tanpa muncul DAN tanpa alasan = kegagalan yang tidak terlihat.
      else sunyi.push(`${c.nama.slice(0, 24)}`);
    }
    cek("ada produk yang diramal", siap > 0, `${siap} produk`);
    cek("LightGBM tidak pernah hilang diam-diam", sunyi.length === 0,
      sunyi.length ? sunyi.slice(0, 3).join(" | ") : `${ikut} ikut bersaing, ${beralasan} dilewati dengan alasan`);
    console.log(`         LightGBM menang di ${menang} dari ${siap} produk`);
  }

  // ============================================================
  console.log("\n=== 8. Rupiah TIDAK pernah memakai LightGBM ===");
  // ============================================================
  // LightGBM mereka hanya dilatih untuk jumlah unit (§12.1 dokumen mereka).
  // Memakainya untuk rupiah berarti memakai model di luar yang dilatihnya.
  {
    const calon = await cariSku("MINYAK", 6);
    const salah: string[] = [];
    for (const c of calon) {
      const h = (await jalankan({ produk: c.nama, bulan: 3 })) as unknown as Record<string, unknown>;
      if (h.status !== "siap") continue;
      const rp = h.nilai_rupiah as { model?: string };
      if (rp?.model && /lightgbm/i.test(rp.model)) salah.push(c.nama.slice(0, 24));
    }
    cek("ramalan rupiah tidak pernah dari LightGBM", salah.length === 0,
      salah.length ? salah.join(", ") : "semua rupiah dari model kita");
  }


  // ============================================================
  console.log("\n=== 9. Tren dan 3 bulan aktual terakhir (§22) ===");
  // ============================================================
  {
    const B = ["2026-05", "2026-06", "2026-07"];
    const T = (r: number[], bukan = false) => ringkasTren([100, 100, 100], B, r, bukan);
    cek("naik di atas batas", T([120]).arah === "naik" && T([120]).perubahan_persen === 20);
    cek("turun di bawah batas", T([80]).arah === "turun" && T([80]).perubahan_persen === -20);
    cek("persis di batas masih stabil", T([100 + BATAS_TREN]).arah === "stabil" && T([100 - BATAS_TREN]).arah === "stabil");
    cek("sedikit di atas batas sudah naik", T([105.1]).arah === "naik");
    cek("memakai rata-rata seluruh bulan ramalan", T([100, 140]).perubahan_persen === 20);
    cek("hanya 3 bulan terakhir yang jadi pembanding",
      ringkasTren([9999, 100, 100, 100], ["a", ...B], [100]).perubahan_persen === 0);
    cek("menyebut bulan pembanding", T([100]).dibanding.includes("2026-05 sampai 2026-07"), T([100]).dibanding);
    cek("riwayat pendek memakai bulan yang ada", ringkasTren([100], ["2026-07"], [110]).perubahan_persen === 10);
    const nol = ringkasTren([0, 0, 0], B, [10]);
    cek("pembanding nol tidak jadi tak terhingga", nol.arah === "tidak-dinilai" && nol.perubahan_persen === null);
    cek("kosong tidak melempar", ringkasTren([], [], []).arah === "tidak-dinilai");
    const pengganti = T([100], true);
    cek("angka pengganti rata-rata tidak dinilai", pengganti.arah === "tidak-dinilai" && pengganti.perubahan_persen === null);

    const h = await jalankan({ produk: "1005998" });
    const aktual = h.aktual_3_bulan_terakhir as { bulan: string; unit: number; rupiah: number }[];
    const unit = h.jumlah_unit as { ramalan: number[]; tren: { arah: string; perubahan_persen: number } };
    const rupiah = h.nilai_rupiah as { ramalan: number[]; tren: { arah: string; perubahan_persen: number } };
    cek("hasil alat membawa 3 bulan aktual", aktual?.length === 3, JSON.stringify(aktual?.[2]));
    cek("bulan aktual terakhir sama dengan data terakhir",
      aktual?.[2]?.bulan === (h.riwayat as { data_terakhir: string }).data_terakhir);
    const hitung = (a: number[], b: number[]) =>
      Math.round(((a.reduce((x, y) => x + y, 0) / a.length) / (b.reduce((x, y) => x + y, 0) / b.length) - 1) * 1000) / 10;
    cek("persen unit bisa dihitung ulang dari angka yang tampil",
      unit.tren.perubahan_persen === hitung(unit.ramalan, aktual.map((x) => x.unit)),
      `${unit.tren.arah} ${unit.tren.perubahan_persen}%`);
    cek("persen rupiah bisa dihitung ulang dari angka yang tampil",
      rupiah.tren.perubahan_persen === hitung(rupiah.ramalan, aktual.map((x) => x.rupiah)),
      `${rupiah.tren.arah} ${rupiah.tren.perubahan_persen}%`);
    const jauh = ukurJarak(5, 7, "laris");
    cek("jarak 5-7 memakai dua ukuran",
      jauh?.jarak_dari_data_terakhir === "5 sampai 7 bulan" && jauh?.biasanya_meleset === "30-48%");
    cek("jarak satu ember tidak menulis rentang", ukurJarak(1, 3, "laris")?.biasanya_meleset === "25%");
    cek("jarak di luar ukuran tidak mengarang", ukurJarak(13, 14, "laris") === null);
    cek("produk kecil memakai angkanya sendiri", ukurJarak(5, 7, "kecil")?.biasanya_meleset === "105-122%");
    cek("produk kecil diberi peringatan", Boolean(ukurJarak(5, 7, "kecil")?.peringatan));
    cek("produk laris tanpa peringatan tambahan", ukurJarak(5, 7, "laris")?.peringatan === undefined);
    cek("volume dari rata-rata 12 bulan terakhir",
      volumePenjualan([9999, ...Array(12).fill(99)]) === "kecil" && volumePenjualan(Array(12).fill(100)) === "sedang" && volumePenjualan(Array(12).fill(1000)) === "laris");
    cek("riwayat kosong tidak melempar", volumePenjualan([]) === "kecil");
    cek("hasil alat membawa ukuran jarak", Boolean((h.perkiraan_meleset_menurut_jarak as { biasanya_meleset?: string })?.biasanya_meleset));
    // Tanggal resmi Indonesia sebagai pembanding yang tidak berasal dari kalender yang diuji.
    const RESMI: [string, number][] = [["2019-06", 5], ["2020-05", 24], ["2021-05", 13], ["2022-05", 2],
      ["2023-04", 22], ["2024-04", 10], ["2025-03", 31], ["2026-03", 21]];
    for (const [bulan, tanggal] of RESMI) {
      const hitung = Number(keteranganKalender(bulan)?.match(/sekitar (\d+)/)?.[1]);
      cek(`Lebaran ${bulan} selisih paling banyak sehari`, Math.abs(hitung - tanggal) <= 1, `${hitung} lawan ${tanggal}`);
    }
    cek("bulan sebelum Ramadan diberi keterangan", keteranganKalender("2027-01") === "menjelang Ramadan");
    cek("bulan awal Ramadan menyebut tanggal", /^Ramadan mulai sekitar \d+ Feb$/.test(keteranganKalender("2027-02") ?? ""));
    cek("bulan biasa tanpa keterangan", keteranganKalender("2026-11") === null);
    cek("bulan rusak tidak melempar", keteranganKalender("x") === null);
    const bulanRamal = h.bulan_diramal as string[];
    const kal = h.keterangan_kalender as { bulan: string; keterangan: string }[];
    cek("hasil alat hanya membawa keterangan untuk bulan yang diramal",
      Array.isArray(kal) && kal.every((x) => bulanRamal.includes(x.bulan)),
      JSON.stringify(kal));
    cek("keterangan di hasil alat sama dengan kalender",
      kal.length === bulanRamal.filter((x) => keteranganKalender(x) !== null).length);
    const rataNya = (x: { ramalan: number[]; cara_membacanya?: string }) => new Set(x.ramalan).size === 1;
    const kolom = [h.jumlah_unit, h.nilai_rupiah] as { ramalan: number[]; cara_membacanya?: string; ini_bukan_hasil_model?: string }[];
    cek("angka rata diberi cara membacanya", kolom.every((x) => !rataNya(x) || x.ini_bukan_hasil_model || Boolean(x.cara_membacanya)));
    cek("angka yang berbeda tiap bulan tidak diberi kalimat itu",
      kolom.every((x) => rataNya(x) || !x.cara_membacanya?.startsWith("Angkanya sama tiap bulan")));
    // --- Rentang menurut jarak
    cek("pengali rentang naik dengan jarak", pengaliRentang(1, "laris") < pengaliRentang(5, "laris") && pengaliRentang(5, "laris") < pengaliRentang(12, "laris"));
    cek("pengali mengikuti volume", pengaliRentang(12, "laris") > pengaliRentang(12, "kecil"));
    const u1 = h.jumlah_unit as { ramalan: number[]; paling_rendah: number[]; paling_tinggi: number[] };
    cek("rentang tidak negatif dan memuat ramalan",
      u1.ramalan.every((v, i) => u1.paling_rendah[i] >= 0 && u1.paling_rendah[i] <= v && u1.paling_tinggi[i] >= v));

    // --- Pola bulanan
    const totalBuatan = new Map<string, number>();
    for (let y = 2022; y <= 2025; y++) for (let m = 1; m <= 12; m++) totalBuatan.set(`${y}-${String(m).padStart(2, "0")}`, m === 3 ? 200 : 100);
    const pb = hitungPola(totalBuatan);
    cek("bulan ramai terbaca lebih tinggi", pb[2] > 1.2 && pb.every((v, i) => i === 2 || v < 1), pb.map((v) => v.toFixed(2)).join(" "));
    cek("data kosong tidak melempar", hitungPola(new Map([["2025-01", 10]])).every((v) => v === 1));
    cek("faktor mengikuti bulan kalender", faktorBulan(pb, "2027-03") === pb[2]);
    // Riwayat di bawah 12 bulan: SES satu-satunya model yang mungkin, jadi uji ini tidak bergantung pemenang.
    const sesi = Array.from({ length: 11 }, (_, i) => 1000 + ((i * 7919) % 97));
    const bln = Array.from({ length: 11 }, (_, i) => `2025-${String(i + 2).padStart(2, "0")}`);
    const deretBuatan = { sku: "x", nama: "x", merek: null, bulan: bln, qty: sesi, value: sesi.map((v) => v * 10), diisi: 0, bulanTerakhir: "2025-12", kelayakan: "naive" as const };
    const tanpaPola = ramalkan(deretBuatan, 3, "2025-12", "2025-12");
    const denganPola = ramalkan(deretBuatan, 3, "2025-12", "2025-12", undefined, pb);
    if (tanpaPola.qty.ok && denganPola.qty.ok && tanpaPola.qty.terpilih.kode === "ses") {
      cek("tanpa pola SES tetap rata", new Set(tanpaPola.qty.terpilih.ramalan).size === 1);
      cek("dengan pola Maret lebih tinggi", denganPola.qty.terpilih.ramalan[2] > denganPola.qty.terpilih.ramalan[0], denganPola.qty.terpilih.ramalan.join(","));
      cek("hasilnya ditandai", denganPola.qty.terpilih.polaBulanan === true && /pola bulanan/.test(denganPola.qty.terpilih.nama));
    } else cek("deret buatan memilih SES", false, tanpaPola.qty.ok ? tanpaPola.qty.terpilih.kode : "gagal");
    const kecilDeret = { ...deretBuatan, qty: sesi.map(() => 10), value: sesi.map(() => 100) };
    const kecil = ramalkan(kecilDeret, 3, "2025-12", "2025-12", undefined, pb);
    cek("produk kecil tidak dikali pola", kecil.qty.ok && kecil.qty.terpilih.polaBulanan !== true);
    if (denganPola.qty.ok && denganPola.value.ok) {
      cek("unit dan rupiah sejalan: rupiah tidak berpola kalau unitnya tidak",
        denganPola.qty.terpilih.polaBulanan === true || denganPola.value.terpilih.kode !== "turunan-harga" || denganPola.value.terpilih.polaBulanan !== true);
    }
    const cemNyata = await jalankan({ produk: "1005997" });
    const cemU = cemNyata.jumlah_unit as { ramalan: number[] }, cemR = cemNyata.nilai_rupiah as { ramalan: number[]; model: string };
    if (new Set(cemU.ramalan).size === 1 && /x harga/.test(cemR.model)) {
      cek("produk nyata: unit rata berarti rupiah unit x harga juga rata", new Set(cemR.ramalan).size === 1, cemR.ramalan.join(","));
    }

    // --- Bulan yang sama tahun lalu
    const lalu = h.bulan_sama_tahun_lalu as { bulan: string; tahun_lalu: string; unit: number }[];
    cek("hasil alat membawa bulan yang sama tahun lalu", Array.isArray(lalu) && lalu.length > 0, JSON.stringify(lalu?.[0]));
    if (lalu?.length) {
      const dd = await deretSku("1005998");
      cek("angka tahun lalu sama dengan riwayat", dd.ok && dd.deret.qty[dd.deret.bulan.indexOf(lalu[0].tahun_lalu)] === lalu[0].unit);
      cek("tahun lalu tepat 12 bulan sebelumnya", lalu.every((x) => Number(x.bulan.slice(0, 4)) - 1 === Number(x.tahun_lalu.slice(0, 4)) && x.bulan.slice(5) === x.tahun_lalu.slice(5)));
    }
    // Kasus nyata 6 Nov 2026: masih terjual, tapi pernah diramal 0 untuk tiap bulan.
    const peeling = await jalankan({ produk: "PEELING MUNDISARI 60 GR RJ" });
    const pu = peeling.jumlah_unit as { model: string; ramalan: number[] };
    cek("produk yang masih terjual tidak diramal nol", peeling.status !== "siap" || pu.ramalan.some((v) => v > 0), `${pu?.model}: ${pu?.ramalan?.join("/")}`);
    const b = await jalankan({ produk: "1006695" });
    cek("produk berhenti tidak membawa tren", b.status === "produk-berhenti" && b.jumlah_unit === undefined && b.aktual_3_bulan_terakhir === undefined);
  }

} finally {
  await poolPerusahaan().end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (gagal > 0) process.exitCode = 1;
}
