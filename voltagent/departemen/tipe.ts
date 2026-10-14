/**
 * Bentuk konfigurasi sebuah departemen.
 *
 * Satu departemen = satu database MySQL + satu user read-only + satu kamus data
 * + satu indeks teks + satu agent. Tidak ada yang dibagi pakai bersama, dan itu
 * disengaja: kalau HR dan Marketing berbagi koneksi, satu-satunya yang memisahkan
 * data gaji dari orang marketing cuma kalimat di prompt -- dan itu bisa ditembus.
 */

/**
 * Hal yang bisa dientri. Sengaja daftar tertutup, bukan `string`: tiap entitas
 * punya berkas penyusun draf, penulis, tool, dan endpoint sendiri, jadi nilai
 * yang tidak dikenal TIDAK punya arti apa pun dan harus ditolak compiler.
 */
export type EntitasEntri = "penjualan" | "lembur" | "pelamar";

/** Satu entitas, plus peran mana saja yang boleh mengentrinya. */
export type IzinEntri = {
  entitas: EntitasEntri;
  /** Peran yang boleh. Kosong = tidak ada yang boleh (bukan "semua boleh"). */
  peran: string[];
};

/** Kolom teks bebas yang ikut di-index untuk pencarian makna. */
export type KolomTeks = {
  tabel: string;
  kolom: string;
};

export type KonfigDepartemen = {
  /** Dipakai di URL, nama berkas, dan kolom `departemen` di tabel pengguna. */
  id: string;

  /** Nama yang ditampilkan ke user. */
  label: string;

  /** Satu kalimat: agent ini untuk apa. Masuk ke `purpose` agent. */
  tujuan: string;

  /**
   * Database MySQL dummy milik departemen ini.
   *
   * ⚠️ OPSIONAL sejak 30 Sep 2026, dan itu bukan kelonggaran.
   *
   * Departemen IT tidak punya database dummy sama sekali -- datanya (tiket
   * helpdesk) cuma ada di PostgreSQL perusahaan. Waktu sumber data =
   * `perusahaan`, agent cuma dapat `query_perusahaan` dan field ini memang
   * TIDAK PERNAH disentuh; yang memaksa mengisinya cuma tipe datanya.
   *
   * Alternatifnya membuat database MySQL `it` yang kosong supaya tipenya
   * terpenuhi. Ditolak: agent akan diberi tahu dia punya database yang isinya
   * tidak ada, dan itu mengundangnya query ke situ lalu gagal.
   *
   * Departemen tanpa `db` HANYA berfungsi waktu sumber `perusahaan`. Waktu
   * sumbernya `dummy`, agent-nya menjelaskan itu apa adanya -- bukan mencoba
   * menyambung lalu error.
   */
  db?: {
    /** Nama database MySQL. */
    nama: string;
    /**
     * Awalan variabel environment untuk kredensialnya.
     * "MARKETING" -> MARKETING_DB_USER, MARKETING_DB_PASSWORD.
     *
     * Host & port dipakai bersama (MYSQL_HOST, MYSQL_PORT) karena semua
     * database ada di server MySQL yang sama; yang membedakan USER-nya.
     */
    awalanEnv: string;
    /**
     * User MySQL khusus untuk peran tertentu. Peran yang tidak disebut
     * di sini memakai `awalanEnv` biasa.
     *
     * Contoh HR: { kepala: "HR_KEPALA" } -- kepala HR memakai user yang
     * boleh membaca kolom gaji, staf memakai user yang tidak boleh.
     * Pembatasannya ada di GRANT MySQL, bukan di prompt.
     */
    awalanEnvPeran?: Record<string, string>;
  };

  /**
   * Kamus data: daftar tabel, aturan query, istilah, jebakan.
   * Ditempel ke instruksi agent, bukan diambil lewat tool -- itu yang bikin
   * pertanyaan sederhana cukup 1 tool call (lihat Tahap 3 di CLAUDE.md).
   */
  kamusData: string;

  /**
   * Kalimat pembuka instruksi agent -- menjelaskan konteks bisnis departemen ini.
   * Aturan umum (cara query, cara menjawab, alur cari_teks) dibuat sekali di
   * `buatInstruksi()` dan dipakai semua departemen.
   */
  konteks: string;

  /**
   * Tambahan kamus data untuk peran tertentu, disambung setelah `kamusData`.
   *
   * Dipakai supaya agent staf tidak tahu-menahu soal tabel yang memang tidak
   * boleh dia baca -- lebih baik tidak pernah mencoba daripada mencoba lalu
   * ditolak MySQL berkali-kali.
   */
  kamusDataPeran?: Record<string, string>;

  /**
   * Contoh pertanyaan yang ditampilkan saat percakapan masih kosong.
   * User baru biasanya tidak tahu agent-nya bisa apa; ini jauh lebih
   * membantu daripada kolom input kosong.
   */
  contohPertanyaan: string[];

  /** Kolom teks yang di-index untuk `cari_teks`. Kosongkan kalau tidak ada. */
  /**
   * Apa saja yang boleh dientri di departemen ini, DAN oleh peran mana.
   *
   * Dinyatakan di konfigurasi, bukan dengan memeriksa `dep.id === "marketing"`
   * di dalam kode -- pemeriksaan seperti itu tersebar ke banyak tempat dan
   * pasti ada yang terlewat waktu departemen baru ditambah.
   *
   * ⚠️ DULUNYA INI `bolehEntri: boolean`, DAN ITU SALAH BENTUK.
   *
   * `buatTools()` memasang tool entri begitu boolean itu true, tanpa melihat
   * departemen apa. Jadi menyalakannya di HR akan memberi HR tool
   * `siapkan_penjualan` -- tool yang menyusun draf dari database MARKETING.
   * Bukan cuma fitur nyasar, tapi kebocoran lintas departemen.
   *
   * Peran ikut di sini karena di HR keduanya berbeda: kepala yang mencatat
   * lembur (butuh baca gaji), staf yang mencatat pelamar (tidak boleh).
   */
  entri?: IzinEntri[];

  /**
   * Siapa yang boleh MENYETUJUI, dipisah dari siapa yang boleh mengentri.
   *
   * ⚠️ Sengaja TIDAK menumpang `entri`. Menyetujui dan mengentri itu dua
   * kekuasaan berbeda: menggabungkannya berarti siapa pun yang boleh mencatat
   * otomatis boleh mengesahkan catatannya sendiri, dan pemisahan tugas yang
   * jadi alasan adanya kolom `status` langsung hilang.
   *
   * Di HR keduanya kebetulan sama-sama `kepala` untuk `lembur`, tapi itu
   * kebetulan — bukan alasan untuk menyatukan bentuknya.
   */
  persetujuan?: IzinEntri[];

  kolomTeks: KolomTeks[];

  /**
   * Petunjuk khusus departemen ini soal penggunaan cari_teks -- mis. kolom
   * mana yang dipakai untuk menyaring keluhan. Boleh kosong.
   */
  petunjukTeks?: string;
};

/**
 * Entitas apa saja yang boleh dientri peran ini.
 *
 * SATU tempat pemeriksaan, dipakai tool, route, prompt, dan bot. Kalau
 * pemeriksaannya ditulis ulang di tiap tempat, cepat atau lambat ada satu yang
 * ketinggalan waktu entitas baru ditambah -- dan yang ketinggalan itu jadi
 * lubang izin, bukan sekadar fitur yang hilang.
 */
export function entitasEntri(dep: KonfigDepartemen, peran: string): EntitasEntri[] {
  return (dep.entri ?? []).filter((i) => i.peran.includes(peran)).map((i) => i.entitas);
}

/** Peran ini boleh mengentri entitas itu? */
export function bolehEntri(
  dep: KonfigDepartemen,
  peran: string,
  entitas: EntitasEntri,
): boolean {
  return entitasEntri(dep, peran).includes(entitas);
}

/** Peran ini boleh mengentri APA PUN? Dipakai untuk memutuskan blok instruksi. */
export function adaEntri(dep: KonfigDepartemen, peran: string): boolean {
  return entitasEntri(dep, peran).length > 0;
}

/** Peran ini boleh MENYETUJUI entitas itu? */
export function bolehSetujui(
  dep: KonfigDepartemen,
  peran: string,
  entitas: EntitasEntri,
): boolean {
  return (dep.persetujuan ?? []).some(
    (i) => i.entitas === entitas && i.peran.includes(peran),
  );
}
