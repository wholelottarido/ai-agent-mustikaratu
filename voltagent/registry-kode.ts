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
import type { SesiPemakai, CatatSumber } from "./tool-konfigurasi";
import { buatToolCariSop, buatToolDaftarSop } from "./tools-kb";

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
const PENANGAN: Record<string, PembuatKode> = {
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
};

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
  const buat = PENANGAN[t.penangan];
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
  // `view: null` karena tool kode memang tidak membaca satu view pun:
  // `cari_sop` mencari lewat kedekatan makna, bukan lewat SELECT dari view.
  const asli = alat.execute?.bind(alat);
  if (!asli) return alat;
  return Object.assign(alat, {
    execute: async (a: never) => {
      const hasil = await asli(a);
      catat({ alat: t.kode, view: null });
      return hasil;
    },
  }) as ToolKode;
}
