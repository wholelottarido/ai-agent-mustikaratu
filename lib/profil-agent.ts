/**
 * Profiling latensi alur agent: trace + span bertingkat, MATI secara bawaan.
 *
 *   AGENT_PROFILING_ENABLED=1            nyalakan
 *   AGENT_PROFILING_FILE=path.jsonl      tujuan span (bawaan: console.info "[profil] {...}")
 *
 * ============================================================
 * JAMINAN SAAT MATI
 * ============================================================
 * Setiap pembungkus memeriksa flag SAAT DIPANGGIL dan langsung menjalankan fungsi aslinya kalau
 * mati. Tidak ada stream yang disalin, tidak ada berkas yang ditulis, tidak ada objek yang dibuat.
 *
 * ============================================================
 * YANG DICATAT (dan yang TIDAK)
 * ============================================================
 * Per span: trace_id, span_id, parent_span_id, jenis, nama, status, jam dinding mulai (untuk
 * mengaitkan dengan log lain), dan durasi dari jam MONOTONIC (`performance.now()`).
 * Untuk panggilan model: kapan potongan pertama, bagian berpikir, rencana alat, dan teks datang,
 * jumlah potongannya, nama alat yang direncanakan, dan `finish_reason`.
 *
 * TIDAK dicatat: isi prompt, jawaban, argumen alat, teks SQL, hasil query, isi dokumen, header,
 * kunci. Nama agent dibaca dari kalimat pembuka instruksi oleh `ringkasPermintaan()` yang memang
 * sudah ada untuk log gateway.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export const profilAktif = (): boolean => process.env.AGENT_PROFILING_ENABLED === "1";

type Konteks = { trace: string | null; span: string | null };
const ALS = new AsyncLocalStorage<Konteks>();
const idBaru = () => randomUUID().replace(/-/g, "").slice(0, 16);

// Baris dikumpulkan lalu ditulis sekaligus tiap 250 ms (dan saat proses berakhir), supaya
// penulisan disk tidak menahan pembacaan stream di jalur permintaan. Terukur 17 Nov 2026:
// tulis langsung per span ±1 ms, tertunda beberapa mikrodetik.
let antrean: string[] = [];
let jadwal: ReturnType<typeof setTimeout> | null = null;
/** Tulis semua baris yang tertunda. Dipanggil otomatis; skrip boleh memanggilnya sebelum keluar. */
export function siramProfil(): void {
  if (jadwal) { clearTimeout(jadwal); jadwal = null; }
  if (!antrean.length) return;
  const isi = antrean.join("\n") + "\n"; antrean = [];
  try {
    const f = process.env.AGENT_PROFILING_FILE;
    if (f) appendFileSync(f, isi);
    else for (const s of isi.trimEnd().split("\n")) console.info(`[profil] ${s}`);
  } catch { /* abaikan */ }
}
let pasangKeluar = false;
/** Tulis satu baris profil. Galat penulisan ditelan: profiling tidak boleh menjatuhkan permintaan. */
export function catatProfil(o: Record<string, unknown>): void {
  if (!profilAktif()) return;
  try { antrean.push(JSON.stringify(o)); } catch { return; }
  if (!pasangKeluar) { pasangKeluar = true; process.once("exit", siramProfil); }
  if (!jadwal) { jadwal = setTimeout(siramProfil, 250); jadwal.unref?.(); }
}

/** Trace & span yang sedang aktif di konteks async ini (null kalau tidak ada). */
export function konteksProfil(): Konteks {
  return ALS.getStore() ?? { trace: null, span: null };
}

/** Jalankan `fn` di dalam trace baru. Trace ID dipakai untuk mengaitkan semua span satu permintaan. */
export function denganTrace<T>(trace: string, fn: () => T): T {
  if (!profilAktif()) return fn();
  return ALS.run({ trace, span: null }, fn);
}

/** Span manual: dipakai kalau akhir pekerjaan tidak sama dengan saat fungsi kembali (mis. stream). */
export function bukaSpan(jenis: string, nama: string, atribut: Record<string, unknown> = {}) {
  const induk = konteksProfil();
  const span = idBaru(), mono0 = performance.now(), dinding0 = Date.now();
  let tutup = false;
  return {
    span, trace: induk.trace,
    /** Jalankan pekerjaan anak di bawah span ini. */
    di<T>(fn: () => T): T { return ALS.run({ trace: induk.trace, span }, fn); },
    selesai(status: "ok" | "galat" | "batal", tambahan: Record<string, unknown> = {}) {
      if (tutup) return; tutup = true;
      catatProfil({ t: "span", trace: induk.trace, span, parent: induk.span, jenis, nama, status,
        mulai: dinding0, mulai_mono: mono0, durasi_ms: performance.now() - mono0, ...atribut, ...tambahan });
    },
  };
}

/**
 * Ringkasan hasil alat untuk span — TANPA isi data (24 Nov 2026, RCA Q1/Q5).
 * Yang dicatat: label `status` kalau alat mengembalikannya (mis. "perlu-perbaikan", "data-belum-ada"),
 * nama-nama kunci tingkat atas, jumlah elemen kalau berupa daftar, dan panjang hasil dalam karakter.
 * Nilai apa pun (angka penjualan, nama karyawan, isi SOP) TIDAK ikut. Kunci yang tidak berbentuk
 * nama field biasa dibuang, supaya data yang kebetulan dipakai sebagai kunci tidak bocor.
 */
export function ringkasHasilAlat(hasil: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let o: unknown = hasil;
  if (typeof hasil === "string") { try { o = JSON.parse(hasil); } catch { o = null; } }
  if (Array.isArray(o)) { out.hasil_status = "daftar"; out.hasil_n = o.length; }
  else if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    if (typeof r.status === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(r.status)) out.hasil_status = r.status;
    else if (r.galat || r.error) out.hasil_status = "galat";
    out.hasil_kunci = Object.keys(r).filter((k) => /^[a-z_][a-z0-9_]{0,30}$/i.test(k)).slice(0, 12);
  }
  try { out.hasil_kar = typeof hasil === "string" ? hasil.length : (JSON.stringify(hasil) ?? "").length; } catch { /* tak bisa diserialkan */ }
  return out;
}

/** Bungkus satu pekerjaan async sebagai span. Saat profiling mati: `fn()` apa adanya. */
export async function rentang<T>(jenis: string, nama: string, fn: () => Promise<T> | T, atribut: Record<string, unknown> = {},
  ringkasHasil?: (hasil: T) => Record<string, unknown>): Promise<T> {
  if (!profilAktif()) return fn();
  const s = bukaSpan(jenis, nama, atribut);
  try {
    const r = await s.di(fn);
    let tambahan: Record<string, unknown> = {};
    if (ringkasHasil) { try { tambahan = ringkasHasil(r); } catch { /* ringkasan gagal: span tetap dicatat */ } }
    s.selesai("ok", tambahan);
    return r;
  } catch (e) {
    s.selesai((e as Error)?.name === "AbortError" ? "batal" : "galat", { galat: (e as Error)?.name ?? "galat" });
    throw e;
  }
}

/**
 * Pembungkus `fetch` untuk panggilan model. Saat aktif: span per percobaan HTTP, dan stream balasan
 * disalin (`tee`) supaya waktunya bisa dibaca. Salinan untuk pemanggil diteruskan APA ADANYA.
 * `ringkas` membaca nama agent & jumlah pesan dari badan permintaan (tanpa isinya).
 */
export function bungkusFetchProfil(
  fetchAsli: typeof fetch,
  ringkas: (badan: unknown) => { agent: string; pesan: number; lanjutan: boolean },
  label: Record<string, unknown> = {},
): typeof fetch {
  return async (input, init) => {
    if (!profilAktif()) return fetchAsli(input, init);
    const r0 = ringkas(init?.body);
    let nAlat = 0;
    try { nAlat = (JSON.parse(String(init?.body)).tools ?? []).length; } catch { /* abaikan */ }
    const s = bukaSpan("llm", r0.agent, { ...label, pesan: r0.pesan, lanjutan: r0.lanjutan, alat_tersedia: nAlat });
    const m0 = performance.now();
    let r: Response;
    try { r = await fetchAsli(input, init); } catch (e) {
      s.selesai((e as Error)?.name === "AbortError" ? "batal" : "galat", { galat: (e as Error)?.name ?? "galat", tahap: "sebelum-balasan" });
      throw e;
    }
    const header_ms = performance.now() - m0;
    // Replika yang melayani (LiteLLM: x-litellm-model-api-base, mis. http://qwen14-gpu2:8000/v1).
    // Hanya nama host internal, bukan rahasia; dipakai untuk membuktikan pembagian beban antar GPU.
    const replika = (r.headers.get("x-litellm-model-api-base") ?? "").replace(/^https?:\/\//, "").split(/[:/]/)[0] || null;
    const ulang_litellm = r.headers.has("x-litellm-attempted-retries") ? Number(r.headers.get("x-litellm-attempted-retries")) : null;
    if (!r.ok || !r.body) { s.selesai("galat", { http: r.status, header_ms, replika, ulang_litellm }); return r; }
    const [kirim, baca] = r.body.tee();
    (async () => {
      const w: Record<string, number> = {}, n: Record<string, number> = {};
      const tandai = (k: string, t: number) => { w[`${k}_awal_ms`] ??= t; w[`${k}_akhir_ms`] = t; n[`${k}_n`] = (n[`${k}_n`] ?? 0) + 1; };
      const alat: string[] = []; let finish: string | null = null, potongan1: number | null = null, sisa = "";
      const dek = new TextDecoder();
      try {
        for (const p = baca.getReader(); ;) {
          const { done, value } = await p.read();
          const t = performance.now() - m0;
          if (done) break;
          potongan1 ??= t;
          sisa += dek.decode(value, { stream: true });
          const baris = sisa.split("\n"); sisa = baris.pop() ?? "";
          for (const b of baris) {
            if (!b.startsWith("data:")) continue;
            const isi = b.slice(5).trim();
            if (!isi || isi === "[DONE]") continue;
            let j: { choices?: { delta?: Record<string, unknown>; finish_reason?: string }[] };
            try { j = JSON.parse(isi); } catch { continue; }
            const ch = j.choices?.[0], d = ch?.delta ?? {};
            if (d.reasoning_content || d.reasoning) tandai("pikir", t);
            if (typeof d.content === "string" && d.content) tandai("teks", t);
            if (Array.isArray(d.tool_calls) && d.tool_calls.length) {
              tandai("rencana", t);
              for (const c of d.tool_calls as { function?: { name?: string } }[]) if (c.function?.name) alat.push(c.function.name);
            }
            if (ch?.finish_reason) finish = ch.finish_reason;
          }
        }
        const awal = ["pikir", "teks", "rencana"].map((k) => w[`${k}_awal_ms`]).filter((x) => x != null);
        s.selesai("ok", { http: r.status, header_ms, replika, ulang_litellm, potongan1_ms: potongan1, ttft_ms: awal.length ? Math.min(...awal) : null,
          ...w, ...n, alat_dipilih: alat, finish });
      } catch (e) {
        s.selesai((e as Error)?.name === "AbortError" ? "batal" : "galat", { http: r.status, header_ms, replika, ulang_litellm, galat: (e as Error)?.name ?? "galat", tahap: "tengah-stream" });
      }
    })();
    return new Response(kirim, { status: r.status, statusText: r.statusText, headers: r.headers });
  };
}
