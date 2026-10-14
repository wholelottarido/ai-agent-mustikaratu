import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kunci root project. Tanpa ini Turbopack ikut membaca package-lock.json
  // nyasar di C:\Users\ridho dan salah menebak root.
  turbopack: {
    root: __dirname,
  },
  // Paket yang jangan di-bundle -- dipakai apa adanya di server.
  //   mysql2                     : punya dynamic require yang bikin bundler bingung
  //   @huggingface/transformers  : menyeret binary ONNX; kalau ikut di-bundle,
  //                                `next build` gagal "memory allocation of 470 MB failed"
  //   onnxruntime-node           : binary native, memang tidak bisa di-bundle
  serverExternalPackages: ["mysql2", "@huggingface/transformers", "onnxruntime-node"],

  /**
   * ⚠️ Pemeriksaan tipe DIPINDAH, BUKAN DIMATIKAN.
   *
   * `next build` menjalankan type-check di worker TERPISAH yang jalan
   * BERSAMAAN dengan kompilasi. Di mesin 8GB yang sudah sesak, worker itu mati:
   *
   *   FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed
   *   - JavaScript heap out of memory
   *   ⨯ Next.js build worker exited with code: 3221226505
   *
   * Diukur 25 Sep 2026: RAM bebas 0,12 GB dari 7,3 GB, dan `npx tsc --noEmit`
   * yang dijalankan SENDIRI justru lolos -- jadi yang kurang memori, bukan
   * kodenya.
   *
   * `npm run deploy` sekarang menjalankan `tsc --noEmit` DULU, baru build.
   * Berurutan, bukan bersamaan: puncak memorinya jauh lebih rendah, dan
   * jaminan tipenya tetap sama.
   *
   * ⚠️ Konsekuensinya: `next build` sendirian TIDAK lagi menangkap galat tipe.
   * Selalu lewat `npm run deploy`, atau jalankan `npx tsc --noEmit` manual.
   */
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
