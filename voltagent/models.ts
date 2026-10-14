/**
 * Daftar model yang boleh dipakai.
 *
 * KEAMANAN: ID model datang dari browser, jadi TIDAK BOLEH dipercaya mentah.
 * Route `/api/chat` wajib lewat `validasiModel()` sebelum meneruskannya ke agent.
 * Tanpa itu, siapa pun yang bisa menjangkau aplikasi ini bisa mengirim ID model
 * apa pun lewat curl -- termasuk yang jauh lebih mahal.
 *
 * Menambah model Claude? Cek dulu ID-nya ada di `@ai-sdk/anthropic`:
 *   grep -o "claude-[a-z0-9-]*" node_modules/@ai-sdk/anthropic/dist/index.d.ts | sort -u
 *
 * Menambah model lokal? Pastikan sudah di-pull DAN bisa tool calling:
 *   ollama list
 * Model yang tidak bisa tool calling akan diam saja -- agent ini bekerja
 * lewat tool, jadi model tanpa kemampuan itu tidak berguna di sini.
 */

/**
 * `lokal`  = Ollama di komputer yang menjalankan aplikasi ini.
 * `server` = gateway model di server kantor (llama.cpp lewat Bifrost).
 *
 * Keduanya TIDAK memakai kredit API, jadi tidak dihitung ke kuota. Bedanya
 * `server` tidak membebani memori laptop -- itu yang bikin model lokal gagal
 * dimuat waktu RAM sesak.
 */
export type Penyedia = "anthropic" | "lokal" | "server";

export type PilihanModel = {
  id: string;
  label: string;
  penyedia: Penyedia;
  /** Ditampilkan di dropdown supaya user paham trade-off-nya. */
  keterangan: string;
  /**
   * Harga per 1 JUTA token, dalam USD. `null` = gratis (model lokal).
   *
   * ⚠️ Harus dicek ulang kalau Anthropic mengubah harganya:
   * https://www.anthropic.com/pricing
   * Angka yang usang di sini tidak bikin apa pun error -- cuma perkiraan
   * biayanya yang diam-diam salah.
   */
  harga: { masuk: number; keluar: number } | null;
};

/**
 * Urutan & nama grup penyedia untuk ditampilkan.
 *
 * ⚠️ SATU SUMBER untuk web (dropdown) dan WhatsApp (perintah /model).
 * Sebelumnya daftar ini cuma ada di `pilih-model.tsx`, dan waktu penyedia
 * `server` ditambahkan, modelnya HILANG dari dropdown tanpa error apa pun.
 * Penyedia yang tidak terdaftar di sini tidak akan muncul di mana-mana --
 * `npm run test:biaya` menjaganya.
 */
export const URUTAN_PENYEDIA = ["anthropic", "server", "lokal"] as const;

export const NAMA_PENYEDIA: Record<Penyedia, string> = {
  anthropic: "Claude (cloud)",
  server: "Lokal server kantor",
  lokal: "Lokal (komputer ini)",
};

export const MODEL_TERSEDIA: PilihanModel[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    penyedia: "anthropic",
    keterangan: "Seimbang — paling bisa diandalkan untuk SQL rumit",
    harga: { masuk: 2, keluar: 10 },
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    penyedia: "anthropic",
    keterangan: "Paling cepat & murah — cocok untuk pertanyaan sederhana",
    harga: { masuk: 1, keluar: 5 },
  },
  {
    /**
     * HATI-HATI: sering salah. Diukur 24 Sep 2026 LEWAT AGENT ASLI
     * (instruksi penuh + 3 tool), pertanyaan "berapa omzet bulan agustus?"
     * diulang 6x: cuma 2/6 yang memanggil tool DAN menghasilkan angka benar.
     * Sisanya menulis SQL sebagai teks biasa, atau -- sekali -- menjawab
     * dalam bahasa Mandarin.
     *
     * Angka 3/3 yang tercatat di sini sebelumnya SALAH: diukur lewat skrip
     * terpisah dengan prompt pendek, bukan lewat aplikasi. Kesalahan yang
     * sama persis seperti pada llama3.2:3b di bawah. Pelajarannya sudah
     * dua kali: ukur lewat jalur yang dipakai user, bukan jalur tes.
     *
     * Tetap didaftarkan karena memang diminta ada pilihan lokal (data tidak
     * keluar dari komputer), tapi keterangannya wajib jujur supaya user tidak
     * mempercayai angkanya mentah-mentah.
     */
    id: "qwen2.5:latest",
    label: "Qwen2.5 7B (lokal)",
    penyedia: "lokal",
    keterangan: "Gratis & data tidak keluar dari komputer — tapi angkanya sering salah, selalu cek ulang",
    // Tidak memakai kredit API sama sekali. Listrik laptop tidak dihitung.
    harga: null,
  },
  {
    /**
     * Model non-Claude TERBAIK yang pernah diuji di sini. Diukur 28 Sep 2026
     * lewat agent asli (instruksi penuh + 3 tool), bukan skrip terpisah:
     *
     *   memanggil tool                6/6
     *   omzet Agustus benar           6/6   (qwen2.5 lokal: 2/6)
     *   patuh aturan COMPLETED        3/3   (llama3.2: 1/3)
     *   staf HR tolak pertanyaan gaji 3/3
     *   marketing tidak sentuh HR     3/3
     *   rata-rata 10 detik            (Claude Haiku 3,4 detik)
     *
     * TIDAK dibatasi satu tool seperti model lokal -- dia justru 6/6 dengan
     * ketiganya. Pembatasan itu diukur pada qwen2.5; menerapkannya ke sini
     * tanpa alasan sama saja menebak.
     *
     * Catatan: untuk pertanyaan ambigu ("produk paling laris" -- qty atau
     * omzet?) dia memilih salah satu dan pilihannya berubah-ubah. Itu
     * kelemahan INSTRUKSI kita, bukan modelnya; kamus data belum menjelaskan
     * ukuran mana yang dimaksud.
     */
    id: "llama.cpp/gemma-4-12b-it-q8",
    label: "Gemma 12B",
    penyedia: "server",
    keterangan: "Lokal di server kantor — gratis & teliti, tapi 3x lebih lambat dari Claude",
    harga: null,
  },
  // ---------------------------------------------------------------
  // Model yang SENGAJA TIDAK didaftarkan, beserta alasannya.
  // Jangan tambahkan tanpa mengukur ulang.
  // ---------------------------------------------------------------
  //
  // llama3.2:3b -- diuji 24 Sep 2026 lewat aplikasi ini:
  //   Patuh aturan wajib `status = 'COMPLETED'` cuma 1 dari 3 kali.
  //   Saat melewatkannya, dia menghitung order CANCELLED juga:
  //   Rp 515.676.490, padahal yang benar Rp 457.383.190 -- 12,7% terlalu
  //   tinggi, disajikan dengan yakin tanpa tanda apa pun.
  //   Angka salah yang terlihat masuk akal lebih berbahaya daripada
  //   agent yang lambat.
  //   (Di tes terpisah dengan prompt lebih pendek dia 3/3 benar -- jadi
  //   masalahnya muncul justru di kondisi nyata, bukan di tes sederhana.)
  //
  // qwen2.5:1.5b -- DIUKUR ULANG 24 Sep 2026 setelah bug num_ctx beres,
  //   jadi kali ini prompt-nya utuh (terbukti lewat proxy: 4.529 token
  //   terkirim, num_ctx 8192). Hasilnya tetap 0/6: TIDAK PERNAH memanggil
  //   tool sama sekali.
  //   Yang dia lakukan: menulis query dalam blok markdown sambil bercerita
  //   ("saya akan menggunakan view v_omzet_bulanan..."), mengarang kolom
  //   yang tidak ada (`WHERE tanggal = '2026-08'` -- view itu tidak punya
  //   kolom `tanggal`), lalu menyuruh user "pastikan view tersebut sudah
  //   terinstal".
  //   Ini lebih berbahaya daripada model yang lambat ATAU yang sekadar
  //   salah hitung: dia tidak pernah menyentuh database, jadi 100% isi
  //   jawabannya karangan -- tapi bentuknya meyakinkan.
  //   Sudah dicoba dua kali dengan dua sebab berbeda. Jangan diulang.
];

export const MODEL_DEFAULT = MODEL_TERSEDIA[0].id;

/** Kembalikan model kalau ada di whitelist; kalau tidak, pakai default. */
export function ambilModel(kandidat: unknown): PilihanModel {
  return (
    MODEL_TERSEDIA.find((m) => m.id === kandidat) ??
    MODEL_TERSEDIA.find((m) => m.id === MODEL_DEFAULT)!
  );
}

/** Versi ringkas untuk tempat yang cuma butuh id-nya. */
export function validasiModel(kandidat: unknown): string {
  return ambilModel(kandidat).id;
}

export function labelModel(id: string): string {
  return MODEL_TERSEDIA.find((m) => m.id === id)?.label ?? id;
}

/** Alamat server Ollama. Bawaannya sesuai resep VoltAgent. */
export function alamatOllama(): string {
  return process.env.OLLAMA_HOST ?? "http://localhost:11434/api";
}

/** Alamat gateway model server kantor. */
export function alamatBifrost(): string {
  return process.env.BIFROST_URL ?? "";
}

/**
 * Cek cepat apakah Ollama menyala.
 *
 * Ditaruh di sini, bukan di dalam route, karena DUA pemanggil membutuhkannya:
 * `/api/chat` dan bot WhatsApp. Tanpa pemeriksaan ini user yang memilih model
 * lokal saat Ollama mati cuma melihat "fetch failed" -- tidak ada petunjuk
 * apa yang harus dilakukan.
 *
 * Timeout 2 detik: kalau Ollama mati, koneksi ke localhost langsung ditolak,
 * jadi ini nyaris tidak menambah waktu saat semuanya normal.
 */
export async function ollamaHidup(): Promise<boolean> {
  try {
    const r = await fetch(alamatOllama().replace(/\/api$/, "") + "/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Ukuran context window untuk model lokal.
 *
 * WAJIB diset. Bawaan Ollama cuma 4096 token, sementara instruksi + kamus data
 * kita saja sudah ~3.600 token, ditambah 3 definisi tool jadi ~4.500 token --
 * jadi jatahnya habis SEBELUM percakapan dimulai. Ollama memotong kelebihannya
 * diam-diam: tidak ada error, tidak ada peringatan, riwayat percakapan hilang
 * begitu saja.
 *
 * Diukur 24 Sep 2026, pertanyaan giliran ke-3 yang merujuk dua jawaban
 * sebelumnya ("dari dua bulan itu..."), 3x per nilai:
 *   bawaan (4096) -> 0/3 ingat, model balik bertanya "dua bulan mana?"
 *   6144          -> 3/3 ingat
 *   8192          -> 3/3 ingat
 *
 * Dipilih 8192, bukan 6144, supaya percakapan masih muat setelah beberapa
 * giliran. Di RTX 3050 6GB masih aman: bobot qwen2.5:7b Q4 ~4,7GB + KV cache
 * 8192 token ~0,5GB. Menaikkan lagi ke 16K bikin KV cache ~1GB dan mulai
 * mepet.
 */
export const NUM_CTX_LOKAL = 8192;

/**
 * Terjemahkan kegagalan Ollama jadi pesan yang bisa ditindaklanjuti.
 *
 * ⚠️ `ollamaHidup()` TIDAK cukup. Dia cuma memastikan servernya menjawab --
 * bukan bahwa modelnya muat di memori. Di mesin 8GB, qwen2.5:7b (bobot 4,7GB)
 * gagal dimuat begitu VS Code dan browser sudah memakan jatahnya, dan yang
 * sampai ke user cuma stack trace:
 *
 *   llama-server reported out-of-memory during startup:
 *   ggml_backend_cpu_buffer_type_alloc_buffer: failed to allocate buffer
 *
 * Diverifikasi 25 Sep 2026: RAM bebas 0,4GB dari 7,3GB, sementara VRAM masih
 * lega 5,5GB dari 6GB. Jadi yang kurang RAM sistem, bukan GPU -- dan saran ke
 * user harus menyebut itu, bukan menyuruh ganti kartu grafis.
 *
 * @returns pesan untuk user, atau null kalau ini bukan kegagalan yang dikenali.
 */
export function pesanGalatOllama(galat: unknown): string | null {
  const teks = galat instanceof Error ? `${galat.message}` : String(galat);
  const isi = teks + JSON.stringify((galat as { responseBody?: string })?.responseBody ?? "");

  if (/out-of-memory|failed to allocate|unable to allocate/i.test(isi)) {
    return (
      "Model lokal tidak muat di memori komputer ini. " +
      "Tutup dulu aplikasi berat (VS Code, browser) lalu coba lagi, " +
      "atau pakai model Claude yang tidak butuh memori lokal."
    );
  }

  if (/model .* not found|no such model/i.test(isi)) {
    return "Model lokal itu belum diunduh di komputer ini. Jalankan `ollama pull` dulu.";
  }

  return null;
}

/**
 * Kurs USD ke Rupiah untuk memperkirakan biaya. Diatur di `.env.local`.
 *
 * ⚠️ AWALAN `NEXT_PUBLIC_` ITU WAJIB, bukan pilihan gaya.
 *
 * Nilai ini dipakai juga di komponen KLIEN (`sumber-jawaban.tsx`). Next.js
 * cuma menanamkan variabel berawalan `NEXT_PUBLIC_` ke bundel browser; yang
 * lain jadi `undefined` di sana dan diam-diam jatuh ke nilai cadangan.
 *
 * Diverifikasi 25 Sep 2026: dengan nama `KURS_USD` biasa, angka cadangan
 * 16500 tertanam di `.next/static/chunks/*.js` walaupun `.env.local` diisi
 * nilai lain. Akibatnya laporan terminal dan tampilan web menunjukkan angka
 * BERBEDA tanpa ada error apa pun.
 *
 * ⚠️ Nilainya ikut ter-bundel saat build, jadi mengubah `.env.local` TIDAK
 * berpengaruh sampai `npm run deploy` dijalankan lagi.
 *
 * Kursnya sendiri tetap perkiraan -- ini gambaran kasar "mahal atau murah",
 * BUKAN angka tagihan. Tagihan sebenarnya ada di dashboard Anthropic, USD.
 */
export const KURS_USD = Number(process.env.NEXT_PUBLIC_KURS_USD ?? 16_500);

/**
 * Perkiraan biaya satu jawaban, dalam Rupiah.
 *
 * @returns 0 untuk model lokal (memang gratis), atau null kalau tokennya
 *   tidak diketahui -- supaya pemanggil bisa membedakan "gratis" dari
 *   "tidak tahu". Menampilkan Rp 0 untuk yang tidak diketahui itu menyesatkan.
 */
export function hitungBiaya(
  modelId: string,
  tokenMasuk: number | null | undefined,
  tokenKeluar: number | null | undefined,
): number | null {
  const m = MODEL_TERSEDIA.find((x) => x.id === modelId);
  if (!m) return null;
  if (m.harga === null) return 0;
  if (tokenMasuk == null && tokenKeluar == null) return null;

  const usd =
    ((tokenMasuk ?? 0) / 1_000_000) * m.harga.masuk +
    ((tokenKeluar ?? 0) / 1_000_000) * m.harga.keluar;

  return usd * KURS_USD;
}

/**
 * Rupiah untuk ditampilkan.
 *
 * Di bawah Rp 1 ditulis "<Rp 1", bukan "Rp 0" -- jawaban murah tetap ada
 * biayanya, dan "Rp 0" bikin orang mengira gratis.
 */
export function formatRupiah(rp: number): string {
  if (rp === 0) return "gratis";
  if (rp < 1) return "<Rp 1";
  return `Rp ${Math.round(rp).toLocaleString("id-ID")}`;
}
