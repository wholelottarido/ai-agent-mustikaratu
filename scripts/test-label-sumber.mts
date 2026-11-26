/**
 * Uji label sumber data di bawah jawaban.
 *
 *   npm run test:label-sumber
 *
 * ⚠️ MEMAKAI DATABASE PERUSAHAAN. Pencarian internet DIMATIKAN paksa di sini
 * (alasannya sama dengan `test-pasar-tool.mts`): yang diuji bagian database,
 * dan uji tidak boleh membelanjakan kuota Tavily.
 *
 * ============================================================
 * ⚠️ KENAPA UJI INI ADA, PADAHAL `tsc` SUDAH MENJAGA
 * ============================================================
 * `SUMBER_KODE` di `registry-kode.ts` bertipe `Record<keyof typeof PENANGAN,
 * ...>`, jadi penangan baru yang LUPA didaftarkan membuat `tsc` gagal.
 *
 * Yang TIDAK bisa dijaga `tsc` adalah isinya benar atau tidak:
 *
 *   - salah ketik nama tabel  -> `tsc` diam, labelnya menyebut tabel hantu
 *   - didaftarkan `null`      -> `tsc` diam, labelnya "tidak mengambil data
 *     padahal membaca tabel       dari database" padahal angkanya dari sana
 *   - alat berhenti membaca   -> `tsc` diam, labelnya mengaku sumber yang
 *     tabel tapi klaimnya tetap   sudah tidak dibaca lagi
 *
 * Karena itu uji ini TIDAK membandingkan daftar dengan daftar. Ia menyadap
 * `pool.query()` yang sungguhan, mencatat tabel apa yang BENAR-BENAR dibaca
 * tiap alat, lalu membandingkannya dengan yang diklaim.
 *
 * Label yang salah lebih buruk daripada tidak ada label: angka ramalan yang
 * berlabel "tidak mengambil data dari database" terbaca seperti karangan.
 * Kesalahan itu sudah terjadi EMPAT kali di proyek ini.
 */
process.env.MARKET_SEARCH_ENABLED = "false";

import { poolPerusahaan } from "@/lib/db-perusahaan";
import { buatToolKode, penanganDikenal } from "@/voltagent/registry-kode";
import type { Jejak } from "@/voltagent/tool-konfigurasi";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

/**
 * Harapan untuk tiap penangan, DINYATAKAN DI MUKA.
 *
 * ⚠️ Versi pertama uji ini memilih apa yang diperiksa dari apa yang
 * KEBETULAN terjadi: kalau alatnya tidak melakukan query, cabang pemeriksanya
 * tidak jalan dan ujinya tetap hijau dengan pernyataan LEBIH SEDIKIT.
 * Terlihat 2 Nov 2026 — jumlah pernyataannya berpindah antara 10 dan 11
 * tanpa satu pun merah.
 *
 * Itu pola yang sama dengan "uji yang tidak pernah jalan tapi terlihat lolos".
 * Sekarang harapannya ditulis di sini dan SELALU diperiksa: alat yang
 * diam-diam berhenti membaca database jadi MERAH, bukan jadi lebih sedikit.
 */
const HARAP: Record<
  string,
  { arg: unknown; bacaTabel: boolean; klaim: string | string[] | null; jalurDarurat?: string }
> = {
  // Membaca `ai_knowledge`, tapi dilaporkan lewat jalur lain sebagai
  // "dokumen SOP" di `chat.tsx` — jadi klaimnya di sini memang `null`.
  //
  // ⚠️ `jalurDarurat` ADA KARENA UJI INI PERNAH MERAH SEKALI DARI ENAM
  // JALAN, 2 Nov 2026, dengan keterangan "(tidak ada query)" saja.
  //
  // Sebabnya masih DUGAAN dari membaca kode, belum terlihat langsung: `cari_sop`
  // mengubah pertanyaan jadi vektor LEBIH DULU. Kalau panggilan itu gagal
  // sesaat, `tools-kb.ts` menangkapnya dan memulangkan pesan "tidak bisa
  // dibaca" — tanpa query, dan TANPA melempar. Kalau terulang, baris ⚠️ di
  // bawah mencetak sebab teknisnya. Kalau sebabnya lain, uji ini tetap MERAH.
  //
  // Dibedakan, bukan dimaafkan: jalur darurat yang terpakai TETAP dicetak
  // dengan ⚠️, dan alat yang berhenti membaca tabel tanpa MENGATAKANNYA tetap
  // MERAH. Yang hilang cuma merah yang tidak bisa dijelaskan siapa pun —
  // merah seperti itu mengajari orang mengabaikan merah.
  cari_sop: {
    arg: { pertanyaan: "bagaimana prosedur retur barang" },
    bacaTabel: true, klaim: null, jalurDarurat: "TIDAK BISA DIBACA",
  },
  daftar_sop: { arg: {}, bacaTabel: true, klaim: null },
  ramal_penjualan: {
    arg: { produk: "SHAMPO BAYAM 175 ML RJ", bulan: 3 },
    bacaTabel: true, klaim: ["ai_forecast_sales_monthly", "trx_ba_sales"],
  },
  pergerakan_penjualan: {
    arg: { bulan: "2026-09" },
    bacaTabel: true, klaim: ["trx_ba_sales", "trx_ba_oos"],
  },
  total_penjualan: {
    arg: { dari: "2026-06" },
    bacaTabel: true, klaim: "ai_forecast_sales_monthly",
  },
  cari_tren_pasar: {
    arg: { produk: "SHAMPO BAYAM 175 ML RJ" },
    bacaTabel: true, klaim: "ai_forecast_sales_monthly",
  },
  // Menerima `kategori` (teks bebas), bukan nama produk — tidak perlu katalog.
  riset_pesaing: { arg: { kategori: "perawatan rambut" }, bacaTabel: false, klaim: null },
  analisis_pasar_penjualan: {
    arg: { produk: "SHAMPO BAYAM 175 ML RJ", bulan: 3 },
    bacaTabel: true, klaim: ["ai_forecast_sales_monthly", "trx_ba_sales"],
  },
};

/** Nama tabel/view yang disebut sebuah SQL. */
function tabelDi(sql: string): string[] {
  const keluar = new Set<string>();
  for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi)) {
    keluar.add(m[1].toLowerCase());
  }
  return [...keluar];
}

// ⚠️ PENYADAP. Membungkus `query` milik pool YANG SUNGGUHAN, bukan pool palsu:
// pool palsu cuma membuktikan uji ini sepakat dengan dirinya sendiri.
const pool = poolPerusahaan();
const asli = pool.query.bind(pool);
let terbaca: string[] = [];
(pool as unknown as { query: unknown }).query = (...a: unknown[]) => {
  const sql = typeof a[0] === "string" ? a[0] : String((a[0] as { text?: string })?.text ?? "");
  terbaca.push(...tabelDi(sql));
  return (asli as (...x: unknown[]) => unknown)(...a);
};

const sesi = { departemen: "marketing" } as never;
const baris = (kode: string) =>
  ({ kode, penangan: kode, jenis: "kode", nama: kode, deskripsi: "" }) as never;

console.log("=== Tabel yang DIKLAIM vs yang BENAR-BENAR dibaca ===\n");

// ⚠️ Tiap penangan yang dikenal WAJIB punya harapan di atas.
for (const penangan of penanganDikenal()) {
  cek(`${penangan}: harapannya ditulis di uji ini`, penangan in HARAP);
}

for (const penangan of penanganDikenal()) {
  const h = HARAP[penangan];
  if (!h) continue;

  const jejak: Jejak[] = [];
  const alat = buatToolKode(baris(penangan), sesi, (j) => jejak.push(j)) as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  } | undefined;
  if (!alat) { cek(`${penangan}: bisa dirakit`, false, "tidak terbentuk"); continue; }

  terbaca = [];
  let lempar: string | null = null;
  let keluaran = "";
  try {
    const hasilAlat = await alat.execute(h.arg);
    keluaran = typeof hasilAlat === "string" ? hasilAlat : JSON.stringify(hasilAlat ?? "");
  } catch (e) {
    lempar = (e as Error).message.slice(0, 60);
  }

  // Jalur darurat: alat memulangkan pesan "tidak bisa dibaca" alih-alih hasil.
  // Bukan kegagalan uji, tapi JUGA bukan keberhasilan yang boleh lewat diam.
  const darurat = h.jalurDarurat !== undefined && keluaran.includes(h.jalurDarurat);

  const diklaim = jejak.map((j) => j.view).filter(Boolean).join(", ") || null;
  const klaimHarap = h.klaim === null ? null : [h.klaim].flat().join(", ");
  const nyata = [...new Set(terbaca)];
  console.log(`
  ${penangan}`);
  console.log(`    diklaim : ${diklaim ?? "(tidak membaca tabel)"}`);
  console.log(`    nyata   : ${nyata.length > 0 ? nyata.join(", ") : "(tidak ada query)"}`);

  if (darurat) {
    console.log(`    ⚠️ JALUR DARURAT terpakai — alatnya mengaku tidak bisa membaca.`);
    console.log(`       ${keluaran.split("\n").find((x) => x.startsWith("Sebab")) ?? ""}`);
  }

  // ⚠️ Melempar TIDAK dimaafkan diam-diam: alat yang jatuh sebelum membaca
  // apa pun akan terlihat sama dengan alat yang memang tidak membaca.
  cek(`${penangan}: tidak melempar`, lempar === null, lempar ?? "");
  cek(`${penangan}: tercatat dipanggil`, jejak.length > 0, `${jejak.length} jejak`);

  cek(`${penangan}: ${h.bacaTabel ? "membaca" : "TIDAK membaca"} tabel seperti diharapkan`,
    (nyata.length > 0) === h.bacaTabel || darurat,
    darurat ? "jalur darurat (lihat ⚠️ di atas)"
      : nyata.length > 0 ? nyata.join(", ") : "(tidak ada query)");

  cek(`${penangan}: klaimnya ${klaimHarap ?? "(tidak ada)"}`,
    diklaim === klaimHarap, `dapat ${diklaim ?? "(tidak ada)"}`);

  // Yang TIDAK bisa dijaga `tsc`: nama tabel salah ketik, atau sudah tidak
  // dibaca lagi tapi klaimnya tertinggal.
  for (const k of h.klaim === null ? [] : [h.klaim].flat()) {
    cek(`${penangan}: tabel ${k} BENAR-BENAR dibaca`,
      nyata.some((t: string) => t === k || t.endsWith(`.${k}`)),
      `cari "${k}" di [${nyata.join(", ")}]`);
  }
}

// Label mengikuti bulan yang ditanya, karena sumber angkanya memang berbeda (keluhan 4 Nov 2026).
for (const [judul, arg, harap] of [
  ["bulan di tabel", { dari: "2026-06" }, "ai_forecast_sales_monthly"],
  ["bulan dari data mentah", { dari: "2026-08" }, "trx_ba_sales"],
  ["rentang melewati keduanya", { dari: "2026-06", sampai: "2026-08" }, "ai_forecast_sales_monthly, trx_ba_sales"],
] as const) {
  const jejak: Jejak[] = [];
  const alat = buatToolKode(baris("total_penjualan"), sesi, (j) => jejak.push(j)) as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  };
  await alat.execute(arg);
  const dapat = jejak.map((j) => j.view).join(", ");
  cek(`total_penjualan, ${judul}: labelnya ${harap}`, dapat === harap, `dapat ${dapat}`);
}


// ============================================================
console.log("\n=== ⚠️ Daftar pilihan produk ikut sampai ke layar ===");
// ============================================================
// Tombol "pilih produk" di layar dibaca dari `Jejak.klarifikasi`, BUKAN dari
// part tool: tool ramalan dipegang agent pemasaran, dan pemanggilan tool agent
// bawahan tidak pernah sampai ke klien -- yang lewat cuma `delegate_task`.
//
// Itu persis kegagalan 8 Okt 2026 pada kartu tiket: rancangan tersusun
// sempurna, model menyuruh menekan Simpan, tombolnya tidak ada. Uji ini
// menjaga jalur yang sama untuk daftar pilihan.
for (const penangan of ["ramal_penjualan", "cari_tren_pasar"]) {
  const jejak: Jejak[] = [];
  const alat = buatToolKode(baris(penangan), sesi, (j) => jejak.push(j)) as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  };

  // Potongan nama yang memang ambigu. Dipakai nama yang sama untuk kedua alat
  // supaya bentuk daftarnya bisa dibandingkan.
  const hasil = (await alat.execute({ produk: "MINYAK CEMCEMAN" })) as {
    status?: string; pilihan?: { nama?: string }[];
  };
  const k = jejak[0]?.klarifikasi;

  cek(`${penangan}: hasilnya perlu-diperjelas`, hasil.status === "perlu-diperjelas",
    String(hasil.status));
  cek(`${penangan}: daftar pilihan tercatat di jejak`, k !== undefined,
    k ? `${k.pilihan.length} pilihan` : "tidak tercatat");
  // ⚠️ JUMLAHNYA SAMA. Daftar yang terpotong di tengah jalan lebih buruk
  // daripada tidak ada: pemakai menyangka varian yang tak kelihatan itu
  // tidak ada.
  cek(`${penangan}: jumlahnya sama dengan hasil tool`,
    k?.pilihan.length === hasil.pilihan?.length,
    `jejak ${k?.pilihan.length} vs tool ${hasil.pilihan?.length}`);
  cek(`${penangan}: tiap pilihan punya kode dan nama`,
    (k?.pilihan ?? []).every((p) => Boolean(p.kode) && Boolean(p.nama)));
  // Panjang riwayat yang membuat orang bisa memilih dengan sadar: varian 86
  // bulan dan varian 28 bulan namanya hampir sama.
  cek(`${penangan}: panjang riwayat ikut terkirim`,
    (k?.pilihan ?? []).every((p) => typeof p.riwayat_bulan === "number"),
    (k?.pilihan ?? []).map((p) => p.riwayat_bulan).join(","));
  cek(`${penangan}: pesannya terisi`, Boolean(k?.pesan), k?.pesan?.slice(0, 40) ?? "");

  // ⚠️ DAN SEBALIKNYA: nama yang sudah jelas TIDAK boleh membawa daftar.
  // Daftar tombol yang muncul di bawah jawaban yang sudah selesai menyuruh
  // orang memilih sesuatu yang sudah dipilih.
  const jejak2: Jejak[] = [];
  const alat2 = buatToolKode(baris(penangan), sesi, (j) => jejak2.push(j)) as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  };
  await alat2.execute({ produk: "MINYAK CEMCEMAN 175 ML RJ" });
  cek(`${penangan}: nama yang jelas tidak membawa daftar pilihan`,
    jejak2[0]?.klarifikasi === undefined,
    jejak2[0]?.klarifikasi ? `${jejak2[0].klarifikasi.pilihan.length} pilihan` : "kosong");
}

// ⚠️ `perlu-diperjelas` TANPA daftar produk juga ada -- jalur entri dan lembur,
// yang ambigunya pelanggan atau karyawan. Bentuknya lain, dan menebaknya
// berarti tombol yang mengirim kata yang salah. Dipastikan dilewati.
{
  const jejak: Jejak[] = [];
  const alat = buatToolKode(baris("riset_pesaing"), sesi, (j) => jejak.push(j)) as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  };
  await alat.execute({ kategori: "perawatan rambut" });
  cek("alat tanpa daftar produk tidak mencatat klarifikasi",
    jejak[0]?.klarifikasi === undefined);
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
process.exit(gagal > 0 ? 1 : 0);
