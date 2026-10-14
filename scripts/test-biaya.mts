/**
 * Uji perhitungan biaya. `npm run test:biaya`
 *
 * Yang dijaga bukan cuma angkanya benar, tapi juga BEDA antara "gratis",
 * "tidak tahu", dan "murah sekali" -- ketiganya gampang tertukar jadi Rp 0,
 * dan Rp 0 bikin orang mengira tidak ada biayanya.
 */
import {
  hitungBiaya,
  formatRupiah,
  KURS_USD,
  MODEL_TERSEDIA,
  URUTAN_PENYEDIA,
  NAMA_PENYEDIA,
} from "../voltagent/models.ts";

let lolos = 0, gagal = 0;
const cek = (n: string, ok: boolean, k = "") => {
  if (ok) { lolos++; console.log(`  LOLOS  ${n}`); }
  else { gagal++; console.log(`  GAGAL  ${n}${k ? " — " + k : ""}`); }
};

// Haiku $1/$5 per 1jt. 10.173 masuk + 175 keluar:
//   (10173/1e6)*1 + (175/1e6)*5 = 0,011048 USD
const haiku = hitungBiaya("claude-haiku-4-5", 10173, 175);
cek(
  "Haiku 10.173/175 ~ Rp 182",
  haiku !== null && Math.abs(haiku - 0.011048 * KURS_USD) < 1,
  `dapat ${haiku}`,
);

// Sonnet $2/$10 -- harus dua kali lipat Haiku untuk token yang sama.
const sonnet = hitungBiaya("claude-sonnet-5", 10173, 175);
cek(
  "Sonnet tepat 2x Haiku (harganya memang 2x)",
  sonnet !== null && haiku !== null && Math.abs(sonnet - haiku * 2) < 0.01,
  `sonnet ${sonnet}, haiku ${haiku}`,
);

cek("model lokal -> 0 (gratis)", hitungBiaya("qwen2.5:latest", 9999, 9999) === 0);
cek(
  "token tidak diketahui -> null, BUKAN 0",
  hitungBiaya("claude-sonnet-5", null, null) === null,
  "null = tidak tahu; 0 = gratis. Beda arti",
);
cek("model tak dikenal -> null", hitungBiaya("gpt-5", 100, 100) === null);
cek("salah satu token null tetap dihitung", (hitungBiaya("claude-haiku-4-5", 1000, null) ?? 0) > 0);

// --- format ---
cek("0 -> 'gratis'", formatRupiah(0) === "gratis");
cek("di bawah Rp 1 -> '<Rp 1', bukan 'Rp 0'", formatRupiah(0.4) === "<Rp 1");
cek("dibulatkan & dipisah titik", formatRupiah(182.6) === "Rp 183");
cek("angka besar pakai pemisah ribuan", formatRupiah(1234567) === "Rp 1.234.567");

// --- tiap model di whitelist harus punya harga yang jelas ---
const tanpaHarga = MODEL_TERSEDIA.filter((m) => m.harga === undefined);
cek(
  "semua model punya harga (atau null untuk lokal)",
  tanpaHarga.length === 0,
  tanpaHarga.map((m) => m.id).join(","),
);
const lokalBerbayar = MODEL_TERSEDIA.filter((m) => m.penyedia !== "anthropic" && m.harga !== null);
cek(
  "semua model non-Claude harganya null (gratis)",
  lokalBerbayar.length === 0,
  lokalBerbayar.map((m) => m.id).join(","),
);

// Dropdown cuma menampilkan penyedia yang terdaftar di URUTAN-nya. Model
// dengan penyedia baru hilang diam-diam kalau daftar itu lupa diperbarui.
const takTampil = MODEL_TERSEDIA.filter(
  (m) => !(URUTAN_PENYEDIA as readonly string[]).includes(m.penyedia),
);
cek(
  "semua penyedia punya nama tampilan",
  URUTAN_PENYEDIA.every((g) => typeof NAMA_PENYEDIA[g] === "string" && NAMA_PENYEDIA[g].length > 0),
);
cek(
  "semua model muncul di dropdown & /model",
  takTampil.length === 0,
  takTampil.map((m) => m.id + " (" + m.penyedia + ")").join(","),
);

// --- kurs benar-benar terbaca dari .env.local? ---
//
// Menutup bug nyata: `KURS_USD` tanpa awalan `NEXT_PUBLIC_` tidak pernah
// sampai ke bundel browser, jadi web diam-diam memakai nilai cadangan
// sementara terminal memakai nilai env. Tidak ada error, cuma dua angka beda.
const dariEnv = process.env.NEXT_PUBLIC_KURS_USD;
cek(
  "kurs terbaca dari .env.local",
  dariEnv !== undefined && KURS_USD === Number(dariEnv),
  `env=${dariEnv ?? "(tidak diset)"} vs KURS_USD=${KURS_USD}`,
);
cek("kurs masuk akal (> 10.000)", KURS_USD > 10_000, `dapat ${KURS_USD}`);

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
