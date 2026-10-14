/**
 * Satu-satunya sumber kebenaran soal view database perusahaan.
 *
 * ⚠️ KENAPA BERKAS INI ADA.
 *
 * Daftar view dulu ditulis DUA KALI: sekali di `tool-query.ts` sebagai daftar
 * izin, sekali lagi di `kamus-data.ts` sebagai penjelasan untuk model. Dua
 * tulisan terpisah itu berbeda tanpa ada yang menyadari:
 *
 *   kamus BILANG    : 8 view   <- angkanya diketik tangan
 *   kamus DAFTARKAN : 6 view
 *   tool IZINKAN    : 5 view
 *
 * Akibatnya model diberi tahu `v_asisten_klaim` boleh dibaca, menulis query
 * yang sebenarnya benar, lalu ditolak tool-nya sendiri -- dan menjawab user
 * dengan "ada kendala teknis".
 *
 * Sekarang kamus dan tool membaca dari SINI, dan jumlahnya DIHITUNG dari
 * panjang daftar, tidak diketik.
 */

/**
 * Seberapa luas isi sebuah view untuk penanya.
 *
 *   "diri"   -> disaring per orang lewat CTE `id_employee = <yang login>`
 *   "lintas" -> TIDAK disaring; isinya data banyak orang
 */
export type Lingkup = "diri" | "lintas";

/**
 * Aturan dasar, berlaku untuk semua departemen.
 *
 * Semuanya "diri": tiap orang cuma melihat barisnya sendiri.
 */
const DASAR: Record<string, Lingkup> = {
  v_asisten_karyawan: "diri",
  v_asisten_pengajuan: "diri",
  v_asisten_tiket: "diri",
  v_asisten_aset: "diri",
  v_asisten_kunjungan: "diri",
};

/**
 * Tambahan & PENGECUALIAN per departemen.
 *
 * ⚠️ Perhatikan `it.v_asisten_tiket`: view yang SAMA punya aturan BERBEDA
 * tergantung departemen penanya. Ini satu-satunya tempat di kode ini yang
 * begitu, jadi baca alasannya sebelum mengubah.
 *
 * `portal_ticket.id_employee` itu PELAPOR, bukan teknisi -- teknisinya lewat
 * rantai terpisah (`portal_technician` -> `employee`). Jadi penyaring "diri"
 * memberi orang helpdesk tiket yang DIA LAPORKAN, bukan yang dia kerjakan:
 * persis kebalikan dari yang dia butuhkan.
 *
 * Untuk marketing & HR, "diri" tetap benar -- mereka memang cuma perlu tahu
 * tiket yang mereka ajukan sendiri.
 *
 * Untuk IT, tiket adalah pekerjaan tim: "tiket apa yang masih OPEN?" itu
 * pertanyaan wajar, dan menjawabnya per orang justru menyesatkan. Disepakati
 * 30 Sep 2026.
 *
 * `v_asisten_penjualan` & `v_asisten_klaim`: tidak punya `id_employee` yang
 * terisi, jadi TIDAK BISA disaring per orang sama sekali. Yang menjaganya
 * cuma gerbang departemen ini.
 */
const TAMBAHAN: Record<string, Record<string, Lingkup>> = {
  marketing: {
    v_asisten_penjualan: "lintas",
    v_asisten_klaim: "lintas",
  },
  it: {
    // ⚠️ MENIMPA aturan dasar. Lihat penjelasan di atas.
    v_asisten_tiket: "lintas",
  },
};

/** Semua view yang boleh dibaca departemen ini, beserta lingkupnya. */
export function viewUntuk(departemen: string): Record<string, Lingkup> {
  return { ...DASAR, ...(TAMBAHAN[departemen] ?? {}) };
}

/** Nama view yang boleh disebut departemen ini. Selain ini ditolak tool. */
export function viewBoleh(departemen: string): string[] {
  return Object.keys(viewUntuk(departemen));
}

/**
 * View yang HARUS dipasangi CTE penyaring untuk departemen ini.
 *
 * ⚠️ Dipakai `bungkusPenyaring()`. Kalau sebuah view ikut di sini padahal
 * seharusnya lintas, hasilnya kosong tanpa penjelasan; kalau TIDAK ikut
 * padahal seharusnya diri, data orang lain bocor. Dua-duanya diuji.
 */
export function viewDiri(departemen: string): string[] {
  const peta = viewUntuk(departemen);
  return Object.keys(peta).filter((v) => peta[v] === "diri");
}

/** Benar kalau view ini berisi data lintas orang BAGI departemen tersebut. */
export function viewLintasOrang(departemen: string, nama: string): boolean {
  return viewUntuk(departemen)[nama] === "lintas";
}
