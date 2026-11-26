/**
 * `fetch` untuk MR AI Gateway (LiteLLM): retry sekali untuk sambungan yang putus SEBELUM ada
 * balasan, plus log ringkas per permintaan.
 *
 * ============================================================
 * KENAPA DI SINI, BUKAN DI AGENT
 * ============================================================
 * VoltAgent sudah punya retry (maks 3), tapi hanya kalau putaran agent BELUM menghasilkan apa
 * pun. Terlihat 11 Nov 2026: Ratu AI Umum sudah memanggil `delegate_task`, lalu permintaan
 * berikutnya ke gateway putus dengan `ECONNRESET`, dan log mencatat `attempt 1 dari 3` tanpa
 * percobaan kedua. Mengulang SELURUH putaran memang tidak aman: alat di dalamnya bisa ikut
 * terulang.
 *
 * Yang diulang di sini cuma SATU permintaan HTTP ke model. Permintaan itu tidak punya efek
 * samping: model hanya mengembalikan teks atau RENCANA pemanggilan alat. Alatnya sendiri
 * dijalankan portal SESUDAH balasan diterima, jadi alat tidak pernah ikut terulang. Penyimpanan
 * tiket dan data lain pun hanya terjadi lewat kartu konfirmasi, bukan di jalur ini.
 *
 * ============================================================
 * KAPAN DIULANG, KAPAN TIDAK
 * ============================================================
 * Diulang (maks 1 kali): `fetch` gagal SEBELUM header balasan datang, dengan kode sambungan
 * sementara (`ECONNRESET`, `EPIPE`, `ECONNREFUSED`, `ETIMEDOUT` koneksi, `UND_ERR_SOCKET`, ...).
 *
 * TIDAK diulang:
 *  - permintaan dibatalkan pemakai (sinyal abort);
 *  - server sudah membalas, apa pun status HTTP-nya (429, 500, 400 konteks kepanjangan);
 *  - sambungan putus di TENGAH stream. Sebagian jawaban sudah sampai ke pemakai, dan
 *    mengulangnya akan menempelkan jawaban kedua di belakang yang pertama.
 *
 * ⚠️ Penyebab putusnya 11 Nov 2026 BELUM terbukti. Dugaan "koneksi keep-alive basi" diuji dengan
 * 18 permintaan berjeda 0-65 detik lewat `fetch` Node yang sama, dan tidak satu pun gagal. Jadi
 * retry ini menahan gejala putus sesaat, bukan memperbaiki penyebab yang sudah diketahui.
 *
 * Log TIDAK memuat key, header, isi prompt, maupun jawaban.
 */
import { bungkusFetchProfil } from "./profil-agent";

/** Kode sambungan yang aman diulang karena belum ada balasan dari server. */
const KODE_SEMENTARA = new Set([
  "ECONNRESET", "EPIPE", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_CLOSED",
]);

export const MAKS_ULANG_GATEWAY = 1;
const JEDA_ULANG_MS = 400;

/** Kode galat sambungan dari `fetch` undici, yang menaruhnya di `cause`. */
export function kodeGalatSambungan(e: unknown): string | null {
  let x: unknown = e;
  for (let i = 0; i < 4 && x; i++) {
    const kode = (x as { code?: unknown }).code;
    if (typeof kode === "string") return kode;
    x = (x as { cause?: unknown }).cause;
  }
  return null;
}

/** Galat sambungan sementara yang terjadi sebelum ada balasan, dan bukan pembatalan. */
export function bolehDiulang(e: unknown, sinyal?: AbortSignal | null): boolean {
  if (sinyal?.aborted) return false;
  if ((e as { name?: string })?.name === "AbortError") return false;
  const kode = kodeGalatSambungan(e);
  return kode !== null && KODE_SEMENTARA.has(kode);
}

/**
 * Tahap agent dibaca dari isi permintaan, hanya bentuknya:
 *  - nama agent dari kalimat pembuka instruksi ("Kamu Ratu AI Umum, ...");
 *  - jumlah pesan, dan apakah pesan terakhir hasil alat (berarti putaran lanjutan).
 * Isi pesan tidak dicatat.
 */
export function ringkasPermintaan(badan: unknown): { agent: string; pesan: number; lanjutan: boolean; stream: boolean } {
  try {
    const b = JSON.parse(typeof badan === "string" ? badan : "") as {
      messages?: { role?: string; content?: unknown }[];
      stream?: boolean;
    };
    const daftar = Array.isArray(b.messages) ? b.messages : [];
    const sistem = daftar.find((m) => m.role === "system");
    const pembuka = typeof sistem?.content === "string" ? sistem.content.slice(0, 80) : "";
    const nama = /Kamu\s+([^,.\n]{2,40})/.exec(pembuka)?.[1]?.trim() ?? "tidak diketahui";
    return {
      agent: nama,
      pesan: daftar.length,
      lanjutan: daftar.at(-1)?.role === "tool",
      stream: b.stream === true,
    };
  } catch {
    return { agent: "tidak diketahui", pesan: 0, lanjutan: false, stream: false };
  }
}

type Catat = (baris: Record<string, unknown>) => void;
const catatBawaan: Catat = (b) => console.info(`[gateway] ${JSON.stringify(b)}`);

/**
 * Pembungkus `fetch` untuk satu model gateway.
 *
 * `fetchAsli` dan `catat` bisa diganti oleh uji. `alias` adalah id pilihan portal, `model`
 * nama deployment di LiteLLM; keduanya bukan rahasia.
 */
export function buatFetchGateway(
  alias: string,
  model: string,
  opsi: { fetchAsli?: typeof fetch; catat?: Catat; jedaMs?: number } = {},
): typeof fetch {
  // Profiling (mati bawaan, AGENT_PROFILING_ENABLED=1): span per percobaan HTTP. Saat mati,
  // pembungkus ini langsung memanggil fetch asli. Lihat lib/profil-agent.ts.
  const fetchAsli = bungkusFetchProfil(opsi.fetchAsli ?? fetch, ringkasPermintaan, { alias, model });
  const catat = opsi.catat ?? catatBawaan;
  const jedaMs = opsi.jedaMs ?? JEDA_ULANG_MS;

  return async (input, init) => {
    const mulai = Date.now();
    const ringkas = ringkasPermintaan(init?.body);
    const dasar = { alias, model, agent: ringkas.agent, pesan: ringkas.pesan, lanjutan: ringkas.lanjutan };
    let ulang = 0;

    for (;;) {
      try {
        const r = await fetchAsli(input, init);
        const sampaiHeader = Date.now() - mulai;
        if (!r.ok || !r.body || !ringkas.stream) {
          catat({ ...dasar, status: r.status, ms: sampaiHeader, ulang });
          return r;
        }
        // Potongan stream diteruskan apa adanya; yang ditambahkan hanya log waktu stream
        // selesai, putus di tengah (TIDAK diulang, lihat catatan di atas), atau dibatalkan.
        const pembaca = r.body.getReader();
        const badan = new ReadableStream<Uint8Array>({
          async pull(kendali) {
            try {
              const { done, value } = await pembaca.read();
              if (done) {
                catat({ ...dasar, status: r.status, msHeader: sampaiHeader, ms: Date.now() - mulai, ulang });
                kendali.close();
              } else {
                kendali.enqueue(value);
              }
            } catch (e) {
              catat({
                ...dasar, galat: kodeGalatSambungan(e) ?? (e as Error)?.name ?? "tidak diketahui",
                tahap: "tengah-stream", ms: Date.now() - mulai, ulang, diulang: false,
              });
              kendali.error(e);
            }
          },
          cancel(alasan) {
            catat({ ...dasar, status: r.status, tahap: "dibatalkan", ms: Date.now() - mulai, ulang });
            return pembaca.cancel(alasan);
          },
        });
        return new Response(badan, { status: r.status, statusText: r.statusText, headers: r.headers });
      } catch (e) {
        const kode = kodeGalatSambungan(e) ?? (e as Error)?.name ?? "tidak diketahui";
        const coba = ulang < MAKS_ULANG_GATEWAY && bolehDiulang(e, init?.signal);
        catat({ ...dasar, galat: kode, tahap: "sebelum-balasan", ms: Date.now() - mulai, ulang, diulang: coba });
        if (!coba) throw e;
        ulang++;
        await new Promise((r) => setTimeout(r, jedaMs));
      }
    }
  };
}
