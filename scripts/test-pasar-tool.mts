/**
 * Uji jalur riset pasar dari katalog sampai ke kawat, dan tool-nya.
 *
 *   npm run test:pasar-tool
 *
 * Memakai database perusahaan (nama produk nyata) tapi TIDAK menyentuh
 * internet: penyedianya palsu, dan ia MENCATAT setiap kueri yang diterimanya.
 *
 * ============================================================
 * ⚠️ JANJI "TIDAK MENYENTUH INTERNET" DIPAKSAKAN DI SINI, BUKAN DITITIPKAN
 * ============================================================
 * `risetPasar()` mengambil penyedianya dari `MARKET_SEARCH_ENABLED` kalau
 * tidak disuntik (lihat `lib/pasar/cari.ts`). Bagian 7 memanggil tool-nya
 * langsung, jadi dulu ia bergantung pada kebetulan: selama setelan itu
 * masih `false` di `.env.local` penyedianya null, dan ujinya hijau.
 *
 * Begitu fiturnya dinyalakan di portal (2 Nov 2026), kebetulan itu habis:
 * bagian 7 BENAR-BENAR memanggil Tavily. Yang terlihat cuma dua baris merah
 * yang terbaca seperti fiturnya rusak — bukan seperti uji unit yang mulai
 * membelanjakan kuota ke pihak ketiga setiap kali dijalankan.
 *
 * Karena itu setelannya dimatikan di baris pertama di bawah. Uji yang
 * menjanjikan tidak menyentuh internet harus menjamin sendiri, bukan
 * bergantung pada isi `.env.local` orang yang menjalankannya.
 *
 * ============================================================
 * ⚠️ BAGIAN 2 ADALAH ALASAN UJI INI ADA
 * ============================================================
 * Semua penjagaan privasi di `kueri.ts` diuji terpisah di `test:pasar-kueri`
 * dengan data buatan. Yang TIDAK bisa dijamin uji itu: apakah jalur
 * sesungguhnya — katalog PostgreSQL -> `KonteksPublik` -> kueri -> penyedia —
 * benar-benar tidak membawa apa pun yang rahasia.
 *
 * Di sini penyedianya menyimpan apa yang diterimanya, lalu diperiksa terhadap
 * nilai NYATA dari database: kode SKU produk itu, dan angka penjualannya.
 * Kalau salah satu muncul di kueri, uji ini merah.
 *
 * Kebocoran data perusahaan TIDAK menimbulkan galat apa pun. Kalau tidak
 * diperiksa begini, yang terjadi cuma angka penjualan Mustika Ratu tercatat
 * di log pihak ketiga tanpa ada yang pernah tahu.
 */
// ⚠️ WAJIB sebelum impor apa pun dipakai: lihat alasannya di kepala berkas.
// Yang butuh penyedia menyuntikkannya sendiri (`PenyediaPalsu`).
process.env.MARKET_SEARCH_ENABLED = "false";

import { poolPerusahaan } from "@/lib/db-perusahaan";
import { cariSku, deretSku } from "@/lib/ramalan/deret";
import { risetPasar, kosongkanSinggahan, pemakaian } from "@/lib/pasar/cari";
import { tebakKategori, type KonteksPublik } from "@/lib/pasar/kueri";
import type { HasilCari, PenyediaCari, PermintaanCari } from "@/lib/pasar/penyedia";
import { buatToolTrenPasar, buatToolAnalisisPasar } from "@/voltagent/tools-pasar";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

/** Penyedia palsu yang MENCATAT apa yang diterimanya. */
class PenyediaPalsu implements PenyediaCari {
  readonly nama = "palsu";
  diterima: string[] = [];
  gagalkan: string | null = null;
  async cari(p: PermintaanCari): Promise<HasilCari> {
    this.diterima.push(p.kueri);
    if (this.gagalkan) return { ok: false, sebab: this.gagalkan, bisaDiulang: true };
    return {
      ok: true,
      diambilPada: new Date().toISOString(),
      hasil: [
        {
          judul: "Tren minyak zaitun Indonesia naik",
          url: `https://kompas.com/${encodeURIComponent(p.kueri).slice(0, 12)}`,
          cuplikan: "Pasar minyak zaitun dan perawatan tubuh di Indonesia tumbuh tahun ini.",
          terbit: "2026-09-15",
          skor: 0.9,
        },
        {
          judul: "Industri kosmetik Indonesia 2026",
          url: `https://bisnis.com/${encodeURIComponent(p.kueri).slice(0, 12)}`,
          cuplikan: "Minyak zaitun jadi bahan yang diminati konsumen Indonesia.",
          terbit: "2026-08-02",
          skor: 0.8,
        },
      ],
    };
  }
}

try {
  // ============================================================
  console.log("=== 1. Konteks publik dibentuk dari katalog nyata ===");
  // ============================================================
  const calon = await cariSku("MINYAK ZAITUN 175 ML RJ", 2);
  if (calon.length !== 1) throw new Error(`produk uji tidak tunggal: ${calon.length} cocok`);
  const produk = calon[0];
  const deret = await deretSku(produk.sku);
  if (!deret.ok) throw new Error("deret produk uji tidak terbaca");

  const konteks: KonteksPublik = {
    nama: produk.nama,
    merek: produk.merek ?? null,
    kategori: tebakKategori(produk.nama),
  };
  console.log(`    produk uji: ${produk.nama} (SKU ${produk.sku})`);
  cek("nama dari katalog, bukan dari kata user", konteks.nama === produk.nama);
  cek("kategori ditebak dari nama", konteks.kategori !== null, String(konteks.kategori));

  // ============================================================
  console.log("\n=== 2. ⚠️ Yang sampai ke kawat TIDAK memuat data perusahaan ===");
  // ============================================================
  kosongkanSinggahan();
  const palsu = new PenyediaPalsu();
  for (const jenis of ["tren", "pesaing", "musiman", "industri"] as const) {
    await risetPasar(konteks, jenis, palsu);
  }
  const kawat = palsu.diterima.join(" || ");
  console.log(`    ${palsu.diterima.length} kueri dikirim`);
  for (const q of palsu.diterima.slice(0, 4)) console.log(`      "${q}"`);

  cek("ada kueri yang terkirim", palsu.diterima.length > 0, `${palsu.diterima.length}`);
  // Nilai NYATA dari database, bukan contoh buatan.
  cek(`kode SKU ${produk.sku} TIDAK ikut`, !kawat.includes(produk.sku));
  const angkaNyata = deret.deret.qty.filter((v) => v > 999).slice(0, 25).map(String);
  const bocor = angkaNyata.filter((a) => kawat.includes(a));
  cek("angka penjualan nyata TIDAK ikut", bocor.length === 0, bocor.join(", ") || "tidak ada yang bocor");
  cek("tidak ada angka 5 digit sama sekali", !/\d{5,}/.test(kawat));
  cek("tidak ada nilai rupiah", !/\brp\s*\d/i.test(kawat));
  cek("tidak ada tata nama internal (N.PACK/RJ/KB)",
    !/\b(n\.?pack|rj|kb|bt)\b/i.test(kawat), kawat.slice(0, 60));
  cek("semua kueri menyebut produk atau kategorinya",
    palsu.diterima.every((q) => /zaitun|minyak|kosmetik|kecantikan|perawatan/i.test(q)));

  // ============================================================
  console.log("\n=== 3. Singgahan menghemat panggilan ===");
  // ============================================================
  kosongkanSinggahan();
  const p2 = new PenyediaPalsu();
  await risetPasar(konteks, "tren", p2);
  const pertama = p2.diterima.length;
  await risetPasar(konteks, "tren", p2);
  cek("panggilan kedua tidak menambah permintaan", p2.diterima.length === pertama,
    `${pertama} lalu ${p2.diterima.length}`);
  cek("pemakaian dicatat", pemakaian.panggilan > 0 && pemakaian.dariSinggahan > 0,
    `panggilan ${pemakaian.panggilan}, dari singgahan ${pemakaian.dariSinggahan}`);

  // ============================================================
  console.log("\n=== 4. Kegagalan penyedia mengaku, tidak mengarang ===");
  // ============================================================
  kosongkanSinggahan();
  const rusak = new PenyediaPalsu();
  rusak.gagalkan = "penyedia menjawab HTTP 503";
  const h = await risetPasar(konteks, "tren", rusak);
  cek("tidak ada sumber yang dikarang", h.sumber.length === 0, `${h.sumber.length}`);
  cek("sebabnya disebut", Boolean(h.galat) && h.galat!.includes("503"), h.galat?.slice(0, 60));
  // ⚠️ Beda yang menentukan: "pencarian gagal" BUKAN "tidak ada tren".
  cek("dibedakan dari 'pasarnya sepi'", /BUKAN berarti/.test(h.galat ?? ""), h.galat?.slice(0, 70));

  // ============================================================
  console.log("\n=== 5. Riset dimatikan -> dibedakan dari hasil kosong ===");
  // ============================================================
  const mati = await risetPasar(konteks, "tren", null);
  cek("mengaku dimatikan", /tidak aktif/.test(mati.galat ?? ""), mati.galat?.slice(0, 60));
  cek("tidak ada kueri yang disusun", mati.kueri.length === 0);
  cek("bukti dinyatakan tidak cukup", mati.cukup === false);

  // ============================================================
  console.log("\n=== 6. Tool: ambigu BERHENTI, tidak menebak ===");
  // ============================================================
  const alatTren = buatToolTrenPasar() as unknown as {
    execute: (a: { produk: string; jenis?: string }) => Promise<Record<string, unknown>>;
  };
  const ambigu = await alatTren.execute({ produk: "minyak zaitun" });
  cek("nama ambigu -> perlu diperjelas", ambigu.status === "perlu-diperjelas", String(ambigu.status));
  cek("pilihannya dari katalog nyata",
    Array.isArray(ambigu.pilihan) && (ambigu.pilihan as unknown[]).length > 1,
    `${(ambigu.pilihan as unknown[])?.length} pilihan`);

  // ============================================================
  console.log("\n=== 7. ⚠️ Riset pasar gagal, RAMALAN TETAP SAMPAI ===");
  // ============================================================
  // Penyedianya null karena setelannya DIPAKSA mati di kepala berkas ini —
  // persis keadaan Skenario A §16: pencarian tidak tersedia. Jangan ganti
  // ini jadi bergantung pada `.env.local`: begitu fiturnya nyala di portal,
  // bagian ini memanggil Tavily sungguhan.
  const alatGabung = buatToolAnalisisPasar() as unknown as {
    execute: (a: { produk: string; bulan?: number }) => Promise<Record<string, unknown>>;
  };
  const gabung = await alatGabung.execute({ produk: "MINYAK ZAITUN 175 ML RJ", bulan: 3 });
  cek("status siap walau pencarian mati", gabung.status === "siap", String(gabung.status));
  const ram = gabung.ramalan as Record<string, unknown> | undefined;
  cek("bagian ramalan ikut utuh", ram?.status === "siap", String(ram?.status));
  const unit = ram?.jumlah_unit as { ramalan?: number[]; ketepatan_wape_persen?: number } | undefined;
  cek("angka ramalan ada", Array.isArray(unit?.ramalan) && unit!.ramalan!.length === 3,
    JSON.stringify(unit?.ramalan));
  cek("ketepatan ikut", typeof unit?.ketepatan_wape_persen === "number",
    String(unit?.ketepatan_wape_persen));
  const pasar = gabung.pasar as { pencarian_gagal?: string; bukti_cukup?: boolean } | undefined;
  cek("bagian pasar mengaku gagal", Boolean(pasar?.pencarian_gagal), pasar?.pencarian_gagal?.slice(0, 50));
  cek("bukti dinyatakan tidak cukup", pasar?.bukti_cukup === false);
  // ⚠️ Instruksi anti-penyesuaian WAJIB ikut. Tanpa itu, model bahasa yang
  // membaca berita "penjualan naik 20%" akan menaikkan angkanya sendiri.
  cek("ada larangan mengubah angka ramalan",
    /DILARANG KERAS mengubah angka ramalan/.test(String(gabung.catatan)));

  // ============================================================
  console.log("\n=== 8. Produk berhenti dijual -> riset pasar tidak dijalankan ===");
  // ============================================================
  const berhenti = await alatGabung.execute({ produk: "BODY S ROSE MANGO 135 ML RJ", bulan: 3 });
  cek("status dari tool ramalan diteruskan apa adanya",
    berhenti.status === "produk-berhenti" || berhenti.status === "perlu-diperjelas",
    String(berhenti.status));
  cek("riset pasar dilewati, dan disebut",
    typeof berhenti.riset_pasar_dilewati === "string",
    String(berhenti.riset_pasar_dilewati ?? "").slice(0, 50));
  cek("tidak ada bagian pasar sama sekali", berhenti.pasar === undefined);
} finally {
  await poolPerusahaan().end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (gagal > 0) process.exitCode = 1;
}
