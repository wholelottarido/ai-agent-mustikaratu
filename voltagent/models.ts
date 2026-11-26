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
/**
 * `qwen` sengaja DIPISAH dari `server`, walau dua-duanya endpoint
 * OpenAI-compatible.
 *
 * ⚠️ BUKAN KERAPIAN. `server` berarti "jalan di server kantor" — itu yang
 * tertulis di dropdown, dan itu yang dipakai orang untuk memutuskan boleh
 * tidaknya sebuah pertanyaan dikirim ke sana. Qwen 14B jalan di Google Colab
 * lewat tunnel Cloudflare: alamat publik, pihak ketiga, di luar jaringan
 * kantor. Menumpangkannya ke `server` membuat labelnya berbohong tentang ke
 * mana data karyawan pergi.
 *
 * Konsekuensi teknisnya juga beda: `alamatBifrost()` menunjuk gateway kantor,
 * sedangkan Qwen punya URL, kunci, dan timeout sendiri di `.env.local`.
 */
export type Penyedia = "anthropic" | "lokal" | "server" | "gateway" | "qwen";

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
export const URUTAN_PENYEDIA = ["anthropic", "gateway", "server", "qwen", "lokal"] as const;

export const NAMA_PENYEDIA: Record<Penyedia, string> = {
  anthropic: "Claude (cloud)",
  gateway: "MR AI Gateway",
  server: "Lokal server kantor",
  // ⚠️ TIDAK ditulis "lokal". Qwen 14B jalan di Google Colab lewat tunnel
  // Cloudflare — pertanyaan dan hasil query perusahaan melewati pihak ketiga.
  // Nama grup di dropdown adalah satu-satunya tempat pemakai bisa tahu itu
  // sebelum menekan kirim.
  qwen: "Qwen di Colab (luar kantor)",
  lokal: "Lokal (komputer ini)",
};

export const MODEL_TERSEDIA: PilihanModel[] = [
  {
    // ID ini sengaja berupa alias portal. Nama deployment sebenarnya dibaca
    // dari AI_MODEL hanya di server agar konfigurasi gateway tidak masuk ke browser.
    id: "mr-ai-gateway",
    label: "Qwen3 14B (Gateway)",
    penyedia: "gateway",
    keterangan: "Melalui MR AI Gateway lokal — gratis dan tidak membebani komputer pengguna",
    harga: null,
  },
  {
    // Model kedua di gateway yang sama, dengan key sendiri (11 Nov 2026).
    // Konteksnya 16.384 token, dua kali Qwen3 14B, jadi boleh membawa lebih banyak tool.
    id: "mr-ai-gateway-qwen35",
    label: "Qwen3.5 35B (Gateway)",
    penyedia: "gateway",
    keterangan: "Melalui MR AI Gateway — model lebih besar, konteks 16K, gratis",
    harga: null,
  },
  {
    // Model yang SAMA dengan "mr-ai-gateway" (Qwen3 14B), di mesin 4 GPU (17 Nov 2026).
    // Alamat, nama deployment, dan key dibaca dari AI_BASE_URL_2 / AI_MODEL_2 / AI_API_KEY_2,
    // hanya di server. Untuk pengujian 1 GPU vs 4 GPU; pilihan lama tidak berubah.
    id: "mr-ai-gateway-4gpu",
    label: "Qwen3 14B (4 GPU)",
    penyedia: "gateway",
    keterangan: "Qwen3 14B yang sama di AWS g5.12xlarge (4x A10G, 4 replika) — untuk pengujian, gratis",
    harga: null,
  },
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
  {
    /**
     * Qwen2.5 14B Instruct, jalan di Google Colab, diakses lewat tunnel
     * Cloudflare. Endpoint OpenAI-compatible, disetel pemilik proyek di
     * `.env.local` (`QWEN_API_URL`, `QWEN_API_KEY`, `QWEN_MODEL`).
     *
     * ============================================================
     * YANG SUDAH DIUJI (21 Okt 2026, langsung ke endpoint-nya)
     * ============================================================
     *   GET /v1/models                HTTP 200, 1,1 dtk
     *   tanya biasa (bahasa Indonesia) HTTP 200, 2,3 dtk — jawabannya benar
     *   tool calling                   HTTP 200, 3,5 dtk
     *     -> memilih `asisten_tiket` DAN mengisi {"status":"OPEN"} sendiri,
     *        `finish_reason: "tool_calls"`
     *
     * Itu jauh di atas qwen2.5 7B lokal (2/6 memanggil tool dengan benar).
     *
     * ⚠️ BELUM DIUKUR lewat agent sungguhan di portal ini — jadi belum ada
     * angka untuk "berapa tool sebelum dia mulai mengarang". Karena itu ia
     * TIDAK dibatasi satu tool seperti penyedia `lokal`: pembatasan itu
     * diukur pada qwen2.5 7B, dan memindahkannya ke sini tanpa mengukur sama
     * saja menebak. Keputusan yang sama pernah diambil untuk Gemma 12B.
     *
     * ⚠️ URL TUNNEL BERGANTI TIAP COLAB DIMULAI ULANG. `trycloudflare.com`
     * memang quick tunnel. Kalau model ini tiba-tiba gagal, periksa
     * `QWEN_API_URL` dulu sebelum mencurigai kode — `qwenHidup()` di bawah
     * menerjemahkannya jadi pesan yang menyebut itu.
     */
    id: "Qwen/Qwen2.5-14B-Instruct",
    label: "Qwen2.5 14B",
    penyedia: "qwen",
    keterangan:
      "Google Colab T4 · Eksperimental — gratis & bisa pakai tool, tapi datanya keluar dari jaringan kantor",
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

export const MODEL_DEFAULT = "claude-sonnet-5";

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
 * Endpoint OpenAI-compatible gateway untuk model itu (bawaan: MR AI Gateway, `AI_BASE_URL`).
 * Kalau alamatnya tanpa path (mis. `https://host`), `/v1` ditambahkan: LiteLLM melayani API
 * OpenAI di `/v1`, dan `AI_BASE_URL_2` ditulis tanpa path.
 */
export function alamatGateway(id?: string): string {
  const mentah = (process.env[envGateway(id).url] ?? "").trim().replace(/\/+$/, "");
  if (!mentah) return "";
  try {
    return new URL(mentah).pathname === "/" ? `${mentah}/v1` : mentah;
  } catch {
    return mentah;
  }
}

/**
 * Tiap model gateway membawa ALAMAT, nama deployment, dan key SENDIRI.
 *
 * ⚠️ Key per model, bukan satu key bersama: virtual key LiteLLM dibatasi ke model tertentu
 * (key Qwen3.5 hanya melihat `qwen35-35b`), jadi memakai key yang salah ditolak gateway.
 * Yang disimpan di sini NAMA variabel env, bukan isinya, supaya tidak ada nilai rahasia
 * yang bisa ikut ke bundel browser.
 *
 * `mr-ai-gateway-4gpu` (17 Nov 2026): model yang SAMA (Qwen3 14B AWQ) di mesin lain —
 * AWS g5.12xlarge, 4x A10G, 4 replika vLLM di belakang LiteLLM (`simple-shuffle`). Dipisah
 * sebagai pilihan sendiri supaya `mr-ai-gateway` (1 GPU) tetap bisa dipakai sebagai pembanding.
 */
const ENV_GATEWAY: Record<string, { url: string; model: string; key: string; maksTool: string; bawaanTool: number }> = {
  "mr-ai-gateway": { url: "AI_BASE_URL", model: "AI_MODEL", key: "AI_API_KEY", maksTool: "MAKS_TOOL_GATEWAY", bawaanTool: 10 },
  "mr-ai-gateway-qwen35": {
    url: "AI_BASE_URL", model: "AI_MODEL_QWEN35", key: "AI_API_KEY_QWEN35", maksTool: "MAKS_TOOL_GATEWAY_QWEN35", bawaanTool: 15,
  },
  "mr-ai-gateway-4gpu": { url: "AI_BASE_URL_2", model: "AI_MODEL_2", key: "AI_API_KEY_2", maksTool: "MAKS_TOOL_GATEWAY_2", bawaanTool: 10 },
};
const MODEL_GATEWAY_BAWAAN = "mr-ai-gateway";
const envGateway = (id?: string) => ENV_GATEWAY[id ?? MODEL_GATEWAY_BAWAAN] ?? ENV_GATEWAY[MODEL_GATEWAY_BAWAAN];

/** Nama deployment model di balik alias pilihan portal. */
export function modelGateway(id?: string): string {
  return process.env[envGateway(id).model]?.trim() || "qwen3-14b";
}

/** Key gateway untuk model itu. Hanya dibaca di server. */
export function kunciGateway(id?: string): string {
  return process.env[envGateway(id).key] ?? "";
}

/**
 * Batas jumlah tool per model gateway, supaya instruksi, tool, dan hasil RAG muat di konteksnya.
 * Qwen3 14B (8.192 token) bawaannya 10, Qwen3.5 35B (16.384 token) 15.
 */
export function maksToolGatewayModel(id?: string): number {
  const e = envGateway(id);
  const n = Number(process.env[e.maksTool]);
  return Number.isInteger(n) && n > 0 ? n : e.bawaanTool;
}

/** Gateway hanya ditawarkan jika URL, kunci, dan nama model tersedia. */
export function gatewayDisetel(id?: string): boolean {
  const url = alamatGateway(id);
  const e = envGateway(id);
  if (!url || !process.env[e.key] || !process.env[e.model]) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Pemeriksaan ringan sebelum permintaan agent dijalankan. */
export async function gatewayHidup(id?: string): Promise<boolean> {
  if (!gatewayDisetel(id)) return false;
  try {
    const r = await fetch(`${alamatGateway(id)}/models`, {
      headers: { Authorization: `Bearer ${kunciGateway(id)}` },
      signal: AbortSignal.timeout(5_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Terjemahkan kegagalan kemampuan tool pada model di MR AI Gateway. */
export function pesanGalatGateway(galat: unknown): string | null {
  const teks = galat instanceof Error ? galat.message : String(galat);
  const isi = teks + JSON.stringify((galat as { responseBody?: unknown })?.responseBody ?? "");
  if (/enable-auto-tool-choice|tool-call-parser|auto.*tool choice/i.test(isi)) {
    return (
      "Model gateway sudah terhubung, tetapi server model belum mengaktifkan pemanggilan tool otomatis. " +
      "Ratu AI memerlukan kemampuan ini untuk meneruskan pertanyaan ke agen aplikasi. " +
      "Aktifkan auto tool choice dan tool call parser pada inference server, lalu coba kembali."
    );
  }
  // Sambungan ke gateway putus sebelum ada balasan, dan retry sekali di `lib/gateway-fetch.ts`
  // juga gagal. Hanya untuk permintaan ke alamat gateway: galat sambungan ke penyedia lain
  // punya penyebab dan sarannya sendiri.
  const url = (galat as { url?: unknown })?.url;
  const alamatSemua = [...new Set(Object.keys(ENV_GATEWAY).map((id) => alamatGateway(id)).filter(Boolean))];
  const keGateway = typeof url === "string" && alamatSemua.some((a) => url.startsWith(a));
  const kode = /\b(ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|UND_ERR_SOCKET)\b/.exec(isi)?.[1];
  if (keGateway && kode) {
    return (
      `Sambungan ke MR AI Gateway terputus (${kode}) dan percobaan ulang otomatis juga gagal. ` +
      "Kirim ulang pertanyaannya. Kalau berulang, periksa tunnel SSH ke gateway masih berjalan. " +
      "Rancangan yang belum disimpan tidak ikut tersimpan, jadi tidak ada data yang dobel."
    );
  }
  return null;
}

/** Alamat endpoint Qwen di Colab. Kosong kalau belum disetel. */
export function alamatQwen(): string {
  return process.env.QWEN_API_URL ?? "";
}

/**
 * Apakah Qwen BOLEH dan BISA dipakai — dari setelan saja, tanpa menyentuh
 * jaringan.
 *
 * ⚠️ BEDA DARI `qwenHidup()`, dan keduanya perlu. Yang ini menjawab "sudah
 * disetel belum"; yang itu menjawab "Colab-nya sedang hidup atau tidak".
 * Menggabungkannya berarti dropdown harus menunggu panggilan jaringan cuma
 * untuk tahu apakah sebuah pilihan pantas ditampilkan.
 *
 * ⚠️ HTTPS DIWAJIBKAN. Endpoint ini di luar jaringan kantor dan memakai
 * Bearer key; lewat `http://` kunci itu terkirim polos. Alamat yang bukan
 * HTTPS diperlakukan sebagai belum disetel — bukan dipakai sambil diberi
 * peringatan, karena peringatan tidak menghentikan apa pun.
 *
 * `localhost` dikecualikan supaya pengembangan dengan server di komputer
 * sendiri tetap bisa jalan.
 */
export function qwenDisetel(): boolean {
  if (process.env.QWEN_ENABLED === "false") return false;
  const url = alamatQwen();
  if (!url || !process.env.QWEN_API_KEY) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Model yang pantas ditawarkan ke pemakai saat ini.
 *
 * `MODEL_TERSEDIA` sengaja TETAP memuat semuanya: `labelModel()` dan
 * perhitungan biaya membacanya untuk jawaban LAMA, dan jawaban yang dibuat
 * waktu sebuah model masih aktif tidak boleh kehilangan namanya hanya karena
 * model itu kini dimatikan.
 */
export function modelDitawarkan(): PilihanModel[] {
  return MODEL_TERSEDIA.filter((m) =>
    (m.penyedia !== "qwen" || qwenDisetel()) &&
    (m.penyedia !== "gateway" || gatewayDisetel(m.id)),
  );
}

/**
 * Batas waktu Qwen, dari `QWEN_TIMEOUT_MS`.
 *
 * Bawaannya 180 detik, jauh lebih longgar daripada model lain: Colab bisa
 * sedang memuat bobotnya, dan tunnel Cloudflare menambah satu lompatan lagi.
 * Angka yang terlalu ketat membuat permintaan yang sebenarnya akan berhasil
 * terpotong di tengah — dan gejalanya terlihat seperti model yang rusak.
 */
export function timeoutQwen(): number {
  const n = Number(process.env.QWEN_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 180_000;
}

/**
 * Cek apakah endpoint Qwen menjawab.
 *
 * ⚠️ ADA KARENA URL-NYA MEMANG BERUBAH-UBAH. `trycloudflare.com` quick tunnel
 * memberi alamat acak baru tiap kali dijalankan, jadi `QWEN_API_URL` di
 * `.env.local` menjadi usang setiap Colab dimulai ulang — bukan kasus langka,
 * tapi kejadian rutin.
 *
 * Tanpa pemeriksaan ini pemakai cuma melihat "fetch failed" dan menyangka
 * portalnya rusak. Pola dan alasannya sama persis dengan `ollamaHidup()`.
 *
 * Timeout 5 detik: lebih longgar dari Ollama (yang di localhost) karena ini
 * melewati internet, tapi tetap cukup pendek supaya pemakai tidak menunggu
 * lama hanya untuk diberi tahu bahwa modelnya tidak ada. `/health` di sisi
 * Colab tidak menjalankan inferensi, jadi pemeriksaan ini tidak memakai GPU.
 */
export async function qwenHidup(): Promise<boolean> {
  const url = alamatQwen();
  if (!url) return false;
  try {
    const r = await fetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${process.env.QWEN_API_KEY ?? ""}` },
      signal: AbortSignal.timeout(5_000),
    });
    return r.ok;
  } catch {
    return false;
  }
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
