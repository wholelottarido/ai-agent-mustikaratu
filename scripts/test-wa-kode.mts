/**
 * Uji alur kode verifikasi WhatsApp. `npm run test:kode`
 *
 * Tanpa WhatsApp: yang diuji logikanya -- kode dibuat, ditukar, kedaluwarsa,
 * sekali pakai, dan bentrokan ditolak dengan sebab yang benar.
 *
 * Memakai hr1 (id 3) yang belum tertaut. Dibersihkan di awal DAN akhir.
 */
import { buatKode, tukarKode, statusTaut } from "../lib/wa-kode.ts";
import { execSync } from "node:child_process";

const UJI = 3;       // hr1, belum tertaut
const SUDAH = 4;     // hr2, sudah tertaut ke 11111111111111@lid
const WA_UJI = "99900011122233@lid";

const bersihkan = () =>
  execSync(`mysql -u root portal -e "DELETE FROM wa_kode; DELETE FROM wa_tautan WHERE pengguna_id=${UJI}"`);

bersihkan();

let lolos = 0, gagal = 0;
const cek = (n: string, ok: boolean, k = "") => {
  if (ok) { lolos++; console.log(`  LOLOS  ${n}`); }
  else { gagal++; console.log(`  GAGAL  ${n}${k ? " — " + k : ""}`); }
};

cek("hr1 belum tertaut", (await statusTaut(UJI)).tertaut === false);
cek("hr2 sudah tertaut", (await statusTaut(SUDAH)).tertaut === true);

const kode = await buatKode(UJI);
cek("kode 6 digit", /^\d{6}$/.test(kode), `dapat "${kode}"`);

cek("kode ngawur ditolak", (await tukarKode("000000" === kode ? "111111" : "000000", WA_UJI)).ok === false);

const hasil = await tukarKode(kode, WA_UJI);
cek("kode benar -> tertaut", hasil.ok === true, JSON.stringify(hasil));
cek("status berubah jadi tertaut", (await statusTaut(UJI)).tertaut === true);

// Sekali pakai: kode yang sama tidak boleh jalan lagi.
cek("kode SEKALI PAKAI", (await tukarKode(kode, "88800011122233@lid")).ok === false);

// WhatsApp yang sudah dipakai akun lain.
const kode2 = await buatKode(SUDAH);
const bentrokWa = await tukarKode(kode2, WA_UJI);
cek(
  "WhatsApp sudah dipakai akun lain -> ditolak",
  !bentrokWa.ok && bentrokWa.sebab === "wa-dipakai",
  JSON.stringify(bentrokWa),
);

// Akun yang sudah punya WhatsApp lain.
const bentrokAkun = await tukarKode(kode2, "77700011122233@lid");
cek(
  "akun sudah punya WhatsApp lain -> ditolak",
  !bentrokAkun.ok && bentrokAkun.sebab === "sudah-tertaut",
  JSON.stringify(bentrokAkun),
);

// Kedaluwarsa: dipaksa lewat SQL supaya tidak perlu menunggu 10 menit.
execSync(`mysql -u root portal -e "DELETE FROM wa_tautan WHERE pengguna_id=${UJI}"`);
const kode3 = await buatKode(UJI);
execSync(`mysql -u root portal -e "UPDATE wa_kode SET kedaluwarsa = NOW() - INTERVAL 1 MINUTE WHERE kode='${kode3}'"`);
cek("kode kedaluwarsa ditolak", (await tukarKode(kode3, WA_UJI)).ok === false);

// Minta kode baru harus mematikan yang lama.
const lama = await buatKode(UJI);
const baru = await buatKode(UJI);
cek("kode baru mematikan yang lama", lama !== baru && (await tukarKode(lama, WA_UJI)).ok === false);
cek("kode terbaru tetap jalan", (await tukarKode(baru, WA_UJI)).ok === true);

bersihkan();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
