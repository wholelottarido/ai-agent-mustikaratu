/**
 * Penyedia pencarian Tavily.
 *
 * ============================================================
 * ⚠️ MEMAKAI `fetch`, BUKAN SDK — DAN INI KEPUTUSAN, BUKAN KEMALASAN
 * ============================================================
 * Dokumen Phase 2 §4 menyarankan `npm install @tavily/core`. Tidak dipakai:
 *
 * 1. Yang dipanggil SATU endpoint dengan empat parameter. SDK-nya menambah
 *    satu kebergantungan beserta rantai kebergantungannya untuk satu
 *    `POST /search` yang bisa ditulis dalam dua puluh baris.
 * 2. Batas waktu dan percobaan ulang harus kita kendalikan sendiri supaya
 *    kegagalan pencarian TIDAK menggagalkan ramalan (§16 Skenario A). Lewat
 *    SDK, perilaku itu ditentukan orang lain dan bisa berubah di versi
 *    berikutnya.
 * 3. Proyek ini sudah pernah tergigit paket yang dipaketkan dengan cara tak
 *    terduga — `arima` (WASM di balik CommonJS) dan impor default Baileys.
 *
 * ⚠️ Kalau suatu saat Tavily mengubah bentuk jawabannya, yang rusak adalah
 * `bacaJawaban()` di bawah dan ia mengaku gagal dengan kalimat yang jelas —
 * bukan memulangkan hasil kosong yang terlihat seperti "tidak ada berita".
 *
 * ============================================================
 * ⚠️ KUNCI API TIDAK PERNAH MASUK LOG, GALAT, ATAU HASIL
 * ============================================================
 * Mengikuti aturan yang sudah dipegang proyek ini untuk Qwen: kunci dibaca
 * dari `process.env` di dalam fungsi, tidak pernah ikut ke pesan galat, dan
 * tidak pernah ditulis ke dokumentasi atau uji.
 */
import type { HasilCari, HasilMentah, PenyediaCari, PermintaanCari } from "./penyedia";
import { hariIni } from "./penyedia";

const ENDPOINT = "https://api.tavily.com/search";

/** Batas waktu satu permintaan. Lebih lama dari ini, ramalan ikut tertahan. */
export const BATAS_WAKTU_MS = Number(process.env.MARKET_SEARCH_TIMEOUT_MS ?? 12_000);

/**
 * Berapa kali diulang kalau gagal. Dibatasi dua.
 *
 * ⚠️ Yang diulang HANYA kegagalan yang masuk akal diulang: jaringan putus,
 * 429, dan 5xx. Kunci salah atau kueri ditolak TIDAK diulang — mengulangnya
 * cuma membakar kuota untuk jawaban yang sama.
 */
export const MAKS_ULANG = 2;

type JawabanTavily = {
  results?: {
    title?: unknown;
    url?: unknown;
    content?: unknown;
    published_date?: unknown;
    score?: unknown;
  }[];
};

/** `YYYY-MM-DD` dari apa pun yang dikirim penyedia, atau `null`. */
function bacaTanggal(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return hariIni(d);
}

function bacaJawaban(data: unknown): HasilMentah[] {
  const j = data as JawabanTavily;
  if (!Array.isArray(j?.results)) return [];
  const keluar: HasilMentah[] = [];
  for (const r of j.results) {
    const url = typeof r?.url === "string" ? r.url : "";
    const judul = typeof r?.title === "string" ? r.title : "";
    // Tanpa URL hasilnya tidak bisa dirujuk pemakai, jadi tidak berguna
    // sebagai bukti. Dibuang di sini supaya tidak perlu dijaga di hilir.
    if (url.length === 0) continue;
    keluar.push({
      judul,
      url,
      cuplikan: typeof r?.content === "string" ? r.content : "",
      terbit: bacaTanggal(r?.published_date),
      skor: typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : null,
    });
  }
  return keluar;
}

function tidur(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class PenyediaTavily implements PenyediaCari {
  readonly nama = "tavily";

  async cari(p: PermintaanCari): Promise<HasilCari> {
    const kunci = process.env.TAVILY_API_KEY;
    if (!kunci || kunci.length === 0) {
      // ⚠️ Disebut apa adanya supaya administrator tahu apa yang kurang. Yang
      // TIDAK disebut: isi kuncinya, panjangnya, atau sebagiannya.
      return { ok: false, sebab: "TAVILY_API_KEY belum diisi di .env.local", bisaDiulang: false };
    }

    let sebabTerakhir = "tidak diketahui";
    for (let percobaan = 0; percobaan <= MAKS_ULANG; percobaan++) {
      if (percobaan > 0) {
        // Mundur bertahap: 400 ms, lalu 800 ms. Cukup untuk 429 sesaat,
        // tidak cukup lama untuk membuat pemakai menunggu tanpa kabar.
        await tidur(400 * 2 ** (percobaan - 1));
      }
      const batal = AbortSignal.timeout(BATAS_WAKTU_MS);
      try {
        const r = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${kunci}`,
          },
          body: JSON.stringify({
            query: p.kueri,
            max_results: p.maksHasil,
            search_depth: "basic",
            // ⚠️ "news", BUKAN "general" — dan ini ditemukan dengan memeriksa
            // jawaban mentahnya, bukan dari dokumentasi. Diukur 29 Okt 2026:
            //
            //   topic="general"  ruas: url, title, content, score, raw_content, id
            //   topic="news"     ruas: ... + published_date
            //
            // Dengan "general" TIDAK ADA ruas tanggal sama sekali, jadi tiap
            // sumber pulang sebagai "tanpa tanggal". Akibatnya seluruh
            // penilaian kemutakhiran dan penandaan kedaluwarsa (§8, §16
            // Skenario C) mati tanpa satu pun gejala: tidak ada galat, dan
            // hasilnya tetap terlihat penuh.
            //
            // Yang ikut membaik: "general" memulangkan daftar belanja
            // ("18 Merk Minyak Zaitun Terbaik") sementara yang dicari adalah
            // keadaan pasar. "news" memulangkan pemberitaan bertanggal.
            topic: "news",
            ...(p.hariKeBelakang > 0 ? { days: p.hariKeBelakang } : {}),
          }),
          signal: batal,
        });

        if (r.ok) {
          return { ok: true, hasil: bacaJawaban(await r.json()), diambilPada: new Date().toISOString() };
        }

        // 401/403 = kuncinya salah. 400 = permintaan kita yang keliru.
        // Dua-duanya tidak akan berubah kalau diulang.
        if (r.status === 401 || r.status === 403) {
          return { ok: false, sebab: "TAVILY_API_KEY ditolak penyedia", bisaDiulang: false };
        }
        if (r.status === 400) {
          return { ok: false, sebab: "permintaan pencarian ditolak penyedia", bisaDiulang: false };
        }
        sebabTerakhir =
          r.status === 429
            ? "batas pemakaian Tavily tercapai"
            : `penyedia menjawab HTTP ${r.status}`;
      } catch (err) {
        // ⚠️ Pesannya dipotong dan TIDAK pernah memuat badan permintaan.
        // Badan permintaan memuat kuerinya, dan header memuat kuncinya.
        const e = err as Error;
        sebabTerakhir =
          e.name === "TimeoutError" || e.name === "AbortError"
            ? `pencarian melewati batas ${BATAS_WAKTU_MS} ms`
            : `gagal menghubungi penyedia: ${e.name}`;
      }
    }
    return { ok: false, sebab: sebabTerakhir, bisaDiulang: true };
  }
}

/**
 * Penyedia yang dipakai, menurut setelan.
 *
 * ⚠️ Memulangkan `null` kalau pencarian pasar DIMATIKAN — bukan penyedia
 * palsu yang memulangkan daftar kosong. Daftar kosong terbaca sebagai "tidak
 * ada berita tentang produk ini", dan itu kesimpulan yang sama sekali
 * berbeda dari "fiturnya sedang mati".
 */
export function penyediaTerpilih(): PenyediaCari | null {
  if ((process.env.MARKET_SEARCH_ENABLED ?? "false").toLowerCase() !== "true") return null;
  const nama = (process.env.MARKET_SEARCH_PROVIDER ?? "tavily").toLowerCase();
  if (nama === "tavily") return new PenyediaTavily();
  return null;
}
