/**
 * Penyaring stream jawaban perute (Tahap 2, 24 Nov 2026).
 *
 * ⚠️ KENAPA BUKAN `outputGuardrails` VOLTAGENT: diuji di paket terpasang (`test-api-voltagent.mts` F).
 * Handler non-stream baru mengubah teks akhir SESUDAH potongan mentahnya terkirim ke pembaca stream, dan
 * `streamHandler` hanya bisa mengganti satu potongan dengan satu potongan — tidak bisa melepas teks yang
 * ditahan di ujung bagian teks. Pada uji yang sama `text` bahkan tidak selesai dalam 10 dtk.
 *
 * Yang dilakukan di sini:
 *   - teks ditahan PER KALIMAT (atau per baris), disaring `penjaga.saring()`, baru diteruskan. Jadi panggilan
 *     alat mentah / kalimat atas nama pengguna / klaim tersimpan tidak pernah sampai ke pengguna;
 *   - di `text-end`, sisa yang ditahan dilepas (setelah disaring) SEBELUM `text-end` diteruskan;
 *   - sebelum `finish`, teks penutup dari penjaga disisipkan: pertanyaan agent bawahan saat alur dihentikan
 *     untuk menunggu pengguna, atau — kalau tidak ada teks sama sekali — hasil valid terakhir / pesan jujur.
 *
 * Bekerja untuk dua bentuk potongan AI SDK 6:
 *   "ui"   — `toUIMessageStream()`   (text-delta membawa `delta`) → route web
 *   "full" — `fullStream`            (text-delta membawa `text`)  → skrip benchmark & konsumen lain
 */
import type { PenjagaAlur } from "./penjaga-alur";

type Potongan = { type: string; id?: string; delta?: string; text?: string };
export type BentukStream = "ui" | "full";

/** Batas kalimat: baris baru, atau .!? yang diikuti spasi. "156.770" bukan batas. */
function potongDiBatas(buf: string): { lepas: string; sisa: string } {
  let i = -1;
  for (const m of buf.matchAll(/\n|[.!?](?=\s)/g)) i = (m.index ?? 0) + m[0].length;
  if (i < 0) return buf.length > 600 ? { lepas: buf, sisa: "" } : { lepas: "", sisa: buf };
  const spasi = /^\s*/.exec(buf.slice(i))?.[0].length ?? 0;
  return { lepas: buf.slice(0, i + spasi), sisa: buf.slice(i + spasi) };
}

async function* bacaSemua<T>(sumber: AsyncIterable<T> | ReadableStream<T>): AsyncGenerator<T> {
  if (Symbol.asyncIterator in (sumber as object)) { yield* sumber as AsyncIterable<T>; return; }
  const r = (sumber as ReadableStream<T>).getReader();
  try { for (;;) { const { done, value } = await r.read(); if (done) return; yield value; } } finally { r.releaseLock(); }
}

export async function* jagaPotongan<T extends Potongan>(
  sumber: AsyncIterable<T> | ReadableStream<T>, penjaga: PenjagaAlur, bentuk: BentukStream,
  /** Dipanggil sekali saat stream berakhir (selesai normal, dibatalkan, atau galat). */
  saatSelesai?: () => void,
): AsyncGenerator<T> {
  try {
    yield* jagaInti(sumber, penjaga, bentuk);
  } finally {
    try { saatSelesai?.(); } catch { /* pencatat tidak boleh merusak jawaban */ }
  }
}

async function* jagaInti<T extends Potongan>(
  sumber: AsyncIterable<T> | ReadableStream<T>, penjaga: PenjagaAlur, bentuk: BentukStream,
): AsyncGenerator<T> {
  const medan = bentuk === "ui" ? "delta" : "text";
  const tahan = new Map<string, string>();
  const buang = new Set<string>();
  let terkirim = "";
  let contoh: T | undefined;

  // Potongan UI divalidasi skema ketat AI SDK: hanya type/id/delta(/providerMetadata), tanpa kunci lain.
  const delta = (dasar: T | undefined, id: string, isi: string): T => {
    const meta = (dasar as { providerMetadata?: unknown } | undefined)?.providerMetadata;
    if (medan === "delta") return { type: "text-delta", id, delta: isi, ...(meta ? { providerMetadata: meta } : {}) } as unknown as T;
    const o = { ...(dasar ?? {}), type: "text-delta", id, text: isi } as Record<string, unknown>;
    delete o.delta;
    return o as unknown as T;
  };
  const lepaskan = (id: string, isi: string): string => {
    if (!isi || buang.has(id)) return "";
    const s = penjaga.saring(isi);
    if (s.buangSisa) buang.add(id);
    terkirim += s.teks;
    return s.teks;
  };
  function* sisipPenutup(): Generator<T> {
    const akhir = penjaga.teksPenutup(terkirim);
    if (!akhir) return;
    const id = `penjaga-${penjaga.idPermintaan}`;
    terkirim += akhir;
    yield { type: "text-start", id } as unknown as T;
    yield delta(undefined, id, akhir);
    yield { type: "text-end", id } as unknown as T;
  }

  for await (const p of bacaSemua(sumber)) {
    if (p.type === "text-delta") {
      const id = p.id ?? "_";
      contoh ??= p;
      const { lepas, sisa } = potongDiBatas((tahan.get(id) ?? "") + String((medan === "delta" ? p.delta : p.text) ?? p.delta ?? p.text ?? ""));
      tahan.set(id, sisa);
      const keluar = lepaskan(id, lepas);
      if (keluar) yield delta(p, id, keluar);
      continue;
    }
    if (p.type === "text-end") {
      const id = p.id ?? "_";
      const keluar = lepaskan(id, tahan.get(id) ?? "");
      tahan.delete(id);
      if (keluar) yield delta(contoh, id, keluar);
      yield p;
      continue;
    }
    if (p.type === "finish") {
      for (const [id, isi] of tahan) { const keluar = lepaskan(id, isi); if (keluar) yield delta(contoh, id, keluar); }
      tahan.clear();
      yield* sisipPenutup();
      yield p;
      continue;
    }
    yield p;
  }
  // Stream berakhir tanpa `finish` (dibatalkan / galat): lepas yang tersisa, tanpa penutup.
  for (const [id, isi] of tahan) { const keluar = lepaskan(id, isi); if (keluar) yield delta(contoh, id, keluar); }
}

/** Versi ReadableStream, untuk `writer.merge()` di route web. */
export function jagaStream<T extends Potongan>(
  sumber: AsyncIterable<T> | ReadableStream<T>, penjaga: PenjagaAlur, bentuk: BentukStream, saatSelesai?: () => void,
): ReadableStream<T> {
  const it = jagaPotongan(sumber, penjaga, bentuk, saatSelesai);
  return new ReadableStream<T>({
    async pull(c) {
      try { const { done, value } = await it.next(); if (done) c.close(); else c.enqueue(value); } catch (e) { c.error(e); }
    },
    async cancel(alasan) { await it.return?.(alasan as never); },
  });
}
