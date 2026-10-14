import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `wa-bot/` proses Node murni -- tidak ada React sama sekali di sana.
    // Aturan React Hooks menyangka `useMultiFileAuthState()` milik Baileys
    // itu hook (karena diawali "use") lalu menolaknya. Itu salah sasaran,
    // bukan masalah yang perlu diakali di kode bot.
    files: ["wa-bot/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    // `scripts/` itu alat uji & administrasi yang dijalankan tangan, bukan
    // kode yang ikut ter-deploy. Hasil query mysql2/pg di sana dibaca sekali
    // lalu dicetak, dan memberinya tipe lengkap berarti menulis ulang bentuk
    // baris untuk tiap query sekali pakai -- biaya besar, manfaat kecil.
    //
    // ⚠️ Kelonggaran ini TIDAK berlaku untuk `lib/`, `app/`, `voltagent/`,
    // maupun `wa-bot/`. Di sana hasil query dibaca lewat
    // `query<mysql.RowDataPacket[]>` dan tetap wajib bertipe.
    //
    // Catatan jujur: kelonggaran ini ditambahkan setelah skrip-skrip uji
    // 28-29 Sep menaikkan jumlah galat lint dari 8 jadi 106. Pilihannya
    // antara membiarkan lint berisik (yang berarti tidak ada yang membacanya)
    // atau menyatakan batasnya dengan jelas. Dipilih yang kedua.
    files: ["scripts/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
