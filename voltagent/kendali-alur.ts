/**
 * Penyambung penjaga alur (lib/alur/penjaga-alur.ts) ke VoltAgent — Tahap 2, 24 Nov 2026.
 *
 * Dipisah dari `agent-konfig.ts` supaya uji offline bisa memasang hook yang SAMA PERSIS ke agent tiruan
 * tanpa memuat konfigurasi dari database (`scripts/test-alur-tahap2.mts`).
 *
 * Semua mekanisme di sini dibuktikan pada paket terpasang (@voltagent/core 2.10.0, ai 6.0.290) untuk
 * format OpenAI-compatible DAN Anthropic (`scripts/test-api-voltagent.mts`):
 *   A. delegasi/alat divalidasi SEBELUM dijalankan: `onToolStart` melempar `GalatPenjaga` → alat tidak
 *      dieksekusi → `onToolError` mengubahnya jadi hasil alat yang dibaca model;
 *   B. konteks klarifikasi ditempel ke tugas lewat `args` di `onToolStart`;
 *   C. perute berhenti TANPA panggilan LLM berikutnya saat menunggu pengguna (`stopWhen` kustom);
 *   D. langkah terakhir / sesudah berhenti dipaksa menulis teks (`prepareStep` → `toolChoice: "none"`).
 * `bail()` SENGAJA tidak dipakai: di stream web ia mengakhiri jawaban dengan potongan `abort` tanpa teks
 * apa pun (uji E), sehingga pertanyaan klarifikasi tidak pernah sampai ke pengguna.
 */
import type { AgentHooks } from "@voltagent/core";
import { stepCountIs } from "ai";
import { GalatPenjaga, type MetaAlat, type PemegangPenjaga } from "@/lib/alur/penjaga-alur";

type ArgsHook = {
  agent: { name: string }; tool: { name: string }; args?: unknown; output?: unknown; error?: unknown;
  originalError?: unknown; context?: { input?: unknown; operationId?: string }; options?: { toolContext?: { callId?: string } };
};

/**
 * Nama argumen & tag sebuah alat, dibaca dari DEFINISINYA (skema zod + `tags`), bukan dari daftar nama alat.
 * Jadi aturan periode (Tahap 4) dan pilihan-pengguna (Tahap 6) otomatis berlaku untuk alat baru — termasuk
 * alat yang dirakit dari setelan Kelola AI — selama nama argumennya mengikuti pola.
 */
export function metaAlat(tool: unknown): MetaAlat {
  const t = tool as { parameters?: { shape?: Record<string, unknown>; _def?: { shape?: () => Record<string, unknown> } }; tags?: unknown };
  const shape = t.parameters?.shape ?? t.parameters?._def?.shape?.();
  return {
    argumen: shape && typeof shape === "object" ? Object.keys(shape) : [],
    tag: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === "string") : [],
  };
}

/** Hook agent bawahan: idempotensi alat, larangan memilihkan, periode, dan pencatatan status AKTUAL hasil alat. */
export function hookBawahan(pp: PemegangPenjaga): AgentHooks {
  return {
    onToolStart: ({ agent, tool, args, context, options }: ArgsHook) => {
      // `args` diteruskan SEBAGAI OBJEK YANG SAMA ke `execute`, jadi pengosongan pilihan yang tidak berdasar
      // (Tahap 6) benar-benar sampai ke alat — mekanisme yang sama dengan uji API-B.
      const k = pp.ambil().periksaAlat(agent.name, tool.name, (args ?? {}) as Record<string, unknown>, context?.input, options?.toolContext?.callId, metaAlat(tool));
      if (!k.boleh) throw k.galat;
    },
    onToolError: ({ originalError }: ArgsHook) =>
      originalError instanceof GalatPenjaga ? { output: originalError.hasil } : undefined,
    onToolEnd: ({ agent, tool, output, error, options }: ArgsHook) => {
      if (error) {
        // Tahap 3: galat SUNGGUHAN dicatat sebagai status hasil handoff; penolakan penjaga bukan galat alat.
        const e = error as { message?: unknown; cause?: unknown };
        const dariPenjaga = error instanceof GalatPenjaga || e.cause instanceof GalatPenjaga || String(e.message ?? "").includes("penjaga-alur:");
        if (!dariPenjaga) pp.ambil().catatGalatAlat(agent.name);
        return undefined;
      }
      const pengganti = pp.ambil().catatHasilAlat(agent.name, tool.name, output, options?.toolContext?.callId, undefined, metaAlat(tool));
      return pengganti === undefined ? undefined : { output: pengganti };
    },
  } as unknown as AgentHooks;
}

/**
 * Jawaban sapaan / "bisa bantu apa" (Tahap 5), dari agent & nama alat yang TERPASANG untuk pemakai ini.
 * Bukan teks tetap: kalau setelan Kelola AI berubah, jawabannya ikut berubah.
 */
export function teksKemampuan(namaUmum: string, bawahan: { nama: string; bisa: string[] }[], maksPerAgent = 6): string {
  if (bawahan.length === 0) {
    return `Halo! Saya ${namaUmum}. Saat ini belum ada asisten aplikasi yang terbuka untuk akun Anda — ` +
      "hubungi administrator aplikasi untuk meminta akses.";
  }
  const baris = bawahan.map((b) => {
    const bisa = b.bisa.slice(0, maksPerAgent).join(", ");
    return `- **${b.nama}**${bisa ? ` — ${bisa}${b.bisa.length > maksPerAgent ? ", dan lainnya" : ""}` : ""}`;
  });
  return `Halo! Saya ${namaUmum}. Saya bisa membantu lewat asisten aplikasi berikut:\n\n${baris.join("\n")}\n\n` +
    "Silakan tulis pertanyaan atau kebutuhan Anda secara spesifik.";
}

/** Hook + kendali langkah perute. `maksLangkah` = `maxSteps` perute (TIDAK diturunkan oleh Tahap 2). */
export function kendaliPerute(pp: PemegangPenjaga, maksLangkah: number) {
  const p = () => pp.ambil();
  return {
    hooks: {
      // Operasi perute baru = permintaan baru: penjaga diganti kalau jalur ini dipakai ulang berurutan.
      // `mulai()` sekarang juga di sini (Tahap 5): penjaga perlu tahu pesan pengguna walau perute TIDAK
      // mendelegasikan — mis. sapaan yang dijawab dengan teks panggilan alat mentah (pola Q8).
      onStart: ({ context }: { context: { operationId: string; input?: unknown } }) => {
        pp.operasi(context.operationId);
        pp.ambil().mulai(context.input);
      },
      onToolStart: ({ tool, args, context }: ArgsHook) => {
        if (tool.name !== "delegate_task") return;
        const a = (args ?? {}) as { task?: unknown; targetAgents?: unknown };
        const k = p().periksaDelegasi(a, context?.input);
        if (!k.boleh) throw k.galat;
        if (k.tugasBaru) (a as { task: string }).task = k.tugasBaru;
        // Tahap 3: target pengganti (dialihkan ke agent yang terbukti mampu, atau target yang tidak mampu dibuang).
        // Objek `args` yang sama diteruskan ke `execute` (mekanisme uji API-B), jadi agent yang salah tidak jalan.
        if (k.targetBaru) (a as { targetAgents: string[] }).targetAgents = k.targetBaru;
      },
      onToolError: ({ tool, originalError }: ArgsHook) =>
        tool.name === "delegate_task" && originalError instanceof GalatPenjaga ? { output: originalError.hasil } : undefined,
      // Tahap 3: status terstruktur tiap handoff ditempel ke hasil delegate_task yang dibaca perute.
      onToolEnd: ({ tool, output, error }: ArgsHook) => {
        if (tool.name !== "delegate_task" || error) return undefined;
        const ganti = p().catatanDelegasi(output);
        return ganti === undefined ? undefined : { output: ganti };
      },
      onHandoffComplete: ({ agent, result }: { agent: { name: string }; result: string }) => {
        p().catatHandoff(agent.name, result ?? "");
      },
    } as unknown as AgentHooks,
    prepareStep: ({ stepNumber }: { stepNumber: number }) => {
      p().mulaiLangkah(stepNumber);
      // Langkah terakhir yang tersedia, atau alur sudah dihentikan: wajib menulis teks, bukan memanggil alat.
      return p().harusBerhenti() || stepNumber >= maksLangkah - 1 ? { toolChoice: "none" as const } : undefined;
    },
    stopWhen: [stepCountIs(maksLangkah), () => p().harusBerhenti()],
  };
}
