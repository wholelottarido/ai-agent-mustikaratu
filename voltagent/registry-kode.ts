/**
 * Registry tool `jenis = "kode"`.
 *
 * `ai_tool` membedakan dua jenis, dan CHECK di tabelnya sudah menyiapkan
 * tempat untuk yang kedua:
 *
 *   `konfigurasi` — query dirakit dari baris: kolom, filter, urut, batas.
 *   `kode`        — ditulis tangan, dan `id_ai_sumber_data` boleh kosong.
 *
 * Berkas ini yang memetakan `ai_tool.penangan` ke fungsi pembuatnya.
 *
 * ============================================================
 * KENAPA PENCARIAN SOP TIDAK BISA JADI TOOL `konfigurasi`
 * ============================================================
 * Perakit borang menghasilkan `SELECT kolom FROM view WHERE filter ORDER BY
 * kolom LIMIT n`. Pencarian SOP bukan bentuk itu: pertanyaannya lebih dulu
 * diubah jadi vektor, lalu dicari potongan yang paling dekat maknanya.
 *
 * Tidak ada susunan borang yang bisa menyatakan "urutkan berdasarkan kedekatan
 * makna dengan kalimat yang baru diketik user". Jadi bukan soal kolomnya belum
 * didaftarkan — bentuknya memang beda, dan `jenis = "kode"` ada untuk itu.
 *
 * ============================================================
 * ⚠️ DESKRIPSI DI KODE YANG BERLAKU, BUKAN DI BARIS `ai_tool`
 * ============================================================
 * Untuk tool `konfigurasi`, `ai_tool.deskripsi` adalah satu-satunya dasar
 * model memutuskan kapan memakainya. Untuk tool `kode` TIDAK: deskripsinya
 * ikut pembuatnya di `tools-kb.ts`, lengkap dengan peringatan yang lahir dari
 * kegagalan nyata ("tool ini SELALU memberi hasil walau tidak ada yang cocok",
 * "BUKAN sumber solusi").
 *
 * Kalau baris di database yang menang, satu penyuntingan di layar admin bisa
 * menghapus peringatan itu tanpa ada yang sadar. Jadi `deskripsi` di baris
 * `ai_tool` untuk tool `kode` berlaku sebagai CATATAN untuk administrator,
 * bukan sebagai instruksi untuk model — dan itu harus kelihatan di layar
 * pengaturannya nanti, bukan jadi kejutan.
 */
import type { KonfigTool } from "@/lib/ai-konfig";
import type {
  SesiPemakai, CatatSumber, Klarifikasi, PilihanProduk, RujukanSop,
} from "./tool-konfigurasi";
import { buatToolCariSop, buatToolDaftarSop } from "./tools-kb";
import { buatToolRamalan } from "./tools-ramalan";
import { buatToolPergerakanPenjualan, buatToolTotalPenjualan } from "./tools-penjualan";
import { buatToolStokKosong } from "./tools-stok";
import {
  buatToolTrenPasar, buatToolRisetPesaing, buatToolAnalisisPasar,
} from "./tools-pasar";

/**
 * Bentuk tool yang dikembalikan pembuat mana pun di registry ini.
 *
 * Gabungan, bukan satu tipe: tiap tool punya bentuk parameter sendiri
 * (`cari_sop` menerima `{ pertanyaan }`, `daftar_sop` tidak menerima apa pun),
 * dan TypeScript memperlakukan perbedaan itu sebagai tipe yang tidak
 * bertukaran. Menambah penangan baru = menambahkannya ke gabungan ini.
 */
export type ToolKode =
  | ReturnType<typeof buatToolCariSop>
  | ReturnType<typeof buatToolDaftarSop>;

export type PembuatKode = (t: KonfigTool, sesi: SesiPemakai) => ToolKode;

/**
 * Penangan yang dikenal. Kuncinya dicocokkan ke `ai_tool.penangan`.
 *
 * ⚠️ DAFTAR-BOLEH. `penangan` datang dari baris database yang bisa diubah
 * administrator; nilai yang tidak ada di sini TIDAK dicari ke mana-mana dan
 * tool-nya dilewati dengan alasan tercetak. Memanggil fungsi berdasarkan
 * nama bebas dari database adalah cara paling mudah membuat baris konfigurasi
 * menjalankan kode yang tidak pernah dimaksudkan.
 */
const PENANGAN = {
  /**
   * Pencarian SOP berdasarkan makna.
   *
   * Penyaringnya slug departemen, bukan `id_department`: `access_menus` di
   * `ai_knowledge.documents` berisi `marketing` / `it` / `hrd`, bukan uuid.
   * Sesi tanpa departemen yang terpetakan dapat `undefined` — artinya hanya
   * dokumen yang terbuka untuk semua, bukan dokumen semua departemen.
   */
  cari_sop: (_t, sesi) => buatToolCariSop(sesi.departemen ?? undefined),

  /** Daftar seluruh dokumen SOP yang terlihat untuk departemen itu. */
  daftar_sop: (_t, sesi) => buatToolDaftarSop(sesi.departemen ?? undefined),

  /**
   * Peramalan penjualan produk.
   *
   * ⚠️ TIDAK MENYARING PER ORANG, dan itu disengaja. Yang dibaca penjualan
   * SELURUH perusahaan per SKU (`ai_forecast_sales_monthly`), bukan
   * penjualan si penanya — tidak ada kolom pemilik di situ, dan memang
   * bukan data pribadi. Yang membatasi siapa boleh memakainya adalah
   * pemasangan tool ini ke agent mana, plus `ai_tool.izin` kalau diisi.
   *
   * Jenis `kode`, bukan `konfigurasi`: hasilnya bukan `SELECT ... WHERE`
   * melainkan deret waktu yang dilewatkan tiga model lalu dipilih lewat
   * backtest. Tidak ada susunan borang yang bisa menyatakan itu.
   */
  ramal_penjualan: () => buatToolRamalan(),

  /** Penjumlahan penjualan seluruh perusahaan. Pembatasnya sama dengan ramalan. */
  total_penjualan: () => buatToolTotalPenjualan(),

  /** Produk yang penjualannya berubah jauh dari biasanya. Pembatasnya sama dengan ramalan. */
  pergerakan_penjualan: () => buatToolPergerakanPenjualan(),

  /**
   * Produk dan outlet yang paling sering kehabisan barang. Pembatasnya sama dengan ramalan.
   * Nama outlet ikut, nama BA tidak.
   */
  stok_kosong: () => buatToolStokKosong(),

  /**
   * Tiga tool riset pasar (Phase 2).
   *
   * ⚠️ Jenis `kode` dengan sebab yang sama seperti `ramal_penjualan`:
   * hasilnya bukan `SELECT ... WHERE` melainkan panggilan HTTP ke penyedia
   * pencarian, lalu penyaringan sumber. Tidak ada susunan borang di layar
   * Kelola AI yang bisa menyatakan itu.
   *
   * ⚠️ Ketiganya TIDAK menyentuh basis data perusahaan untuk mengirim apa pun
   * keluar. Yang menyeberang ke internet cuma nama dan kategori produk, lewat
   * `lib/pasar/kueri.ts` — satu pintu, bertipe sempit.
   */
  cari_tren_pasar: () => buatToolTrenPasar(),
  riset_pesaing: () => buatToolRisetPesaing(),
  analisis_pasar_penjualan: () => buatToolAnalisisPasar(),
} satisfies Record<string, PembuatKode>;

/**
 * Tabel yang BENAR-BENAR dibaca tiap penangan. `null` = tidak satu pun.
 *
 * ============================================================
 * ⚠️ INI MENENTUKAN LABEL SUMBER DI BAWAH JAWABAN
 * ============================================================
 * Dulu `buatToolKode()` menulis `view: null` untuk SEMUA tool kode. Itu benar
 * untuk `cari_sop` (mencari lewat kedekatan makna, bukan SELECT dari view),
 * tapi SALAH untuk `ramal_penjualan` dan tiga tool pasar — ketiganya membaca
 * `ai_forecast_sales_monthly` untuk mencari produknya.
 *
 * Akibatnya jawaban ramalan yang angkanya jelas dari database perusahaan
 * berlabel "tidak mengambil data dari database". Terlihat di layar 2 Nov 2026.
 *
 * Ini PENGULANGAN KEEMPAT dari pola yang sama — tiga sebelumnya tercatat di
 * `app/components/chat.tsx`. Tiap kali tool baru yang membawa data ditambah,
 * label ini tidak ikut diberi tahu.
 *
 * ⚠️ Karena itu tipenya `Record<keyof typeof PENANGAN, ...>`, bukan
 * `Record<string, ...>`: penangan baru yang lupa didaftarkan di sini membuat
 * `tsc` GAGAL, bukan diam-diam berlabel salah. Lupa jadi tidak mungkin,
 * sama seperti pembungkus `catat` di bawah.
 */
const SUMBER_KODE: Record<keyof typeof PENANGAN, string | null> = {
  // Mencari lewat kedekatan makna di `ai_knowledge`, bukan SELECT dari view.
  // Dihitung terpisah sebagai "dokumen SOP" di `chat.tsx`.
  cari_sop: null,
  daftar_sop: null,
  // Membaca riwayat penjualan bulanan per SKU.
  // Keduanya bisa juga memakai `trx_ba_sales`: tabel sebenarnya disebut `tabel_sumber` di hasilnya.
  ramal_penjualan: "ai_forecast_sales_monthly",
  total_penjualan: "ai_forecast_sales_monthly",
  // Daftarnya dari penjualan mentah; petunjuknya juga membaca `trx_ba_oos`, lewat `tabel_sumber`.
  pergerakan_penjualan: "trx_ba_sales",
  // Juga membaca `trx_ba_sales` untuk perkiraan kerugian, lewat `tabel_sumber`.
  stok_kosong: "trx_ba_oos",
  // Keduanya mencari produknya dulu lewat `cariSku()` sebelum ke internet.
  cari_tren_pasar: "ai_forecast_sales_monthly",
  analisis_pasar_penjualan: "ai_forecast_sales_monthly",
  // ⚠️ `riset_pesaing` TIDAK membaca tabel apa pun, dan itu bukan kelalaian:
  // yang dia terima `kategori` (teks bebas dari user), bukan nama produk yang
  // perlu dicocokkan ke katalog. Langsung ke internet.
  //
  // Klaim awal saya di sini "ai_forecast_sales_monthly" — salah, dan `tsc`
  // tidak bisa melihatnya karena tipenya benar. Yang menangkapnya
  // `test:label-sumber`, dengan menyadap query yang sungguhan.
  riset_pesaing: null,
};

/**
 * Jenis kemampuan tiap penangan, untuk rute berbasis kemampuan (Tahap 3, 24 Nov 2026).
 *
 * ⚠️ `Record<keyof typeof PENANGAN, ...>` dengan alasan yang sama seperti `SUMBER_KODE`: penangan baru yang lupa
 * menyatakan kemampuannya membuat `tsc` GAGAL. Yang ditulis di sini SIFAT kodenya (mencari dokumen lewat makna vs
 * membaca data), bukan agent mana yang memakainya — agent mana pun yang dipasangi `cari_sop` dari layar Kelola AI
 * otomatis dianggap mampu mencari dokumen, tanpa mengubah kode rute.
 */
const KEMAMPUAN_KODE: Record<keyof typeof PENANGAN, "dokumen" | "data"> = {
  cari_sop: "dokumen",
  daftar_sop: "dokumen",
  ramal_penjualan: "data",
  total_penjualan: "data",
  pergerakan_penjualan: "data",
  stok_kosong: "data",
  cari_tren_pasar: "data",
  riset_pesaing: "data",
  analisis_pasar_penjualan: "data",
};

/** Jenis kemampuan tool kode; `undefined` kalau penanganya tidak dikenal (tool-nya memang tidak dirakit). */
export function kemampuanKode(penangan: string | null): "dokumen" | "data" | undefined {
  return penangan ? (KEMAMPUAN_KODE as Record<string, "dokumen" | "data">)[penangan] : undefined;
}

/**
 * Daftar pilihan produk dari hasil tool yang berhenti di `perlu-diperjelas`.
 *
 * ============================================================
 * ⚠️ DIAMBIL DI SINI SUPAYA TOMBOLNYA BISA MUNCUL DI LAYAR
 * ============================================================
 * `ramal_penjualan` dan `cari_tren_pasar` memulangkan daftar varian waktu nama
 * produknya ambigu — dan itu sering, karena banyak produk punya beberapa
 * varian kemasan. Sebelum ini daftar itu cuma sampai sebagai teks: user harus
 * MENGETIK ULANG nama panjang yang baru saja ditampilkan kepadanya.
 *
 * ⚠️ MEMBACA, BUKAN MENGUBAH. Hasil tool diteruskan apa adanya ke model;
 * yang diambil cuma salinan untuk tombol. Kalau bentuknya tidak dikenali,
 * jawabannya `undefined` dan layar kembali seperti sebelumnya — bukan galat.
 *
 * ⚠️ `perlu-diperjelas` TANPA `pilihan` juga ada (jalur entri dan lembur,
 * yang ambigunya pelanggan atau karyawan, bukan produk). Itu dilewati di sini
 * dengan sengaja: bentuk daftarnya lain, dan menebaknya berarti tombol yang
 * mengirim kata yang salah.
 */
function klarifikasiDari(hasil: unknown): Klarifikasi | undefined {
  const h = hasil as { status?: unknown; pesan?: unknown; pilihan?: unknown } | null;
  if (!h || h.status !== "perlu-diperjelas") return undefined;
  if (!Array.isArray(h.pilihan) || h.pilihan.length === 0) return undefined;

  const pilihan: PilihanProduk[] = [];
  for (const p of h.pilihan) {
    const o = p as Record<string, unknown> | null;
    // Satu baris tanpa kode atau nama membuat SELURUH daftar dibatalkan, bukan
    // dilewati: tombol yang separuh daftarnya hilang justru menyesatkan —
    // user menyangka varian yang tidak kelihatan itu tidak ada.
    if (typeof o?.kode !== "string" || typeof o?.nama !== "string") return undefined;
    pilihan.push({
      kode: o.kode,
      nama: o.nama,
      riwayat_bulan: typeof o.riwayat_bulan === "number" ? o.riwayat_bulan : undefined,
      data_terakhir: typeof o.data_terakhir === "string" ? o.data_terakhir : undefined,
    });
  }
  return {
    pesan: typeof h.pesan === "string" ? h.pesan : "Produk mana yang Anda maksud?",
    pilihan,
  };
}

/** Nama penangan yang dikenal, untuk pesan galat dan layar pengaturan. */
export function penanganDikenal(): string[] {
  return Object.keys(PENANGAN);
}

/**
 * Membuat tool `jenis = "kode"` dari satu baris konfigurasi.
 *
 * Mengembalikan `undefined` kalau penanganya tidak dikenal — pemanggil yang
 * mencatat alasannya, supaya baris yang salah ketik kelihatan alih-alih
 * menghilang diam-diam.
 */
export function buatToolKode(
  t: KonfigTool,
  sesi: SesiPemakai,
  catat?: CatatSumber,
): ToolKode | undefined {
  if (!t.penangan) return undefined;
  const buat = (PENANGAN as Record<string, PembuatKode>)[t.penangan];
  if (!buat) return undefined;
  const alat = buat(t, sesi);
  if (!catat) return alat;

  // ⚠️ DIBUNGKUS DI SINI, bukan di dalam tiap penangan.
  //
  // Penangan ditulis tangan dan jumlahnya akan bertambah; menitipkan
  // pencatatan ke masing-masing berarti penangan berikutnya yang lupa
  // memanggilnya jadi tidak terlihat di label jawaban — tanpa ada yang tahu.
  // Dibungkus sekali di sini, lupa itu tidak mungkin.
  //
  // ⚠️ View-nya dibaca dari `SUMBER_KODE`, BUKAN dipatok `null`. Lihat
  // catatan panjang di atas peta itu: mematoknya null membuat jawaban ramalan
  // berlabel "tidak mengambil data dari database" padahal angkanya dari
  // `ai_forecast_sales_monthly`.
  const view = SUMBER_KODE[t.penangan as keyof typeof PENANGAN] ?? null;
  const asli = alat.execute?.bind(alat);
  if (!asli) return alat;
  return Object.assign(alat, {
    execute: async (a: never) => {
      const hasil = await asli(a);
      // Alat yang datanya bisa dari dua tabel menyebut sendiri yang benar-benar terpakai,
      // supaya angka Agustus dari data mentah tidak berlabel tabel yang berhenti di Juli.
      const h = hasil as { tabel_sumber?: unknown; ramalan?: { tabel_sumber?: unknown } } | null;
      const disebut = h?.tabel_sumber ?? h?.ramalan?.tabel_sumber;
      const daftar = Array.isArray(disebut) && disebut.length > 0 ? (disebut as string[]) : [view];
      const klarifikasi = klarifikasiDari(hasil);
      const sop = t.penangan === "cari_sop" ? rujukanSopDariHasil(hasil) : undefined;
      for (const v of daftar) catat({ alat: t.kode, view: v, klarifikasi, sop });
      return hasil;
    },
  }) as ToolKode;
}

function rujukanSopDariHasil(hasil: unknown): RujukanSop[] | undefined {
  if (typeof hasil !== "string") return undefined;

  const daftar: RujukanSop[] = [];
  let terakhir: RujukanSop | undefined;
  for (const baris of hasil.split("\n")) {
    const kepala = baris.match(/^\d+\.\s+(.+?)(?:\s+-\s+bagian\s+"([^"]+)")?(?:\s+-\s+halaman\s+\d+.*)?$/);
    if (kepala) {
      terakhir = {
        judul: kepala[1].trim(),
        ...(kepala[2] ? { bagian: kepala[2].trim() } : {}),
      };
      daftar.push(terakhir);
      continue;
    }
    const tautan = baris.match(/^\s+tautan:\s+(\S+)\s*$/);
    if (tautan && terakhir && /^https?:\/\//i.test(tautan[1])) terakhir.url = tautan[1];
  }

  const unik = new Map<string, RujukanSop>();
  for (const r of daftar) unik.set(`${r.judul}\u0000${r.bagian ?? ""}`, r);
  return unik.size > 0 ? [...unik.values()] : undefined;
}
