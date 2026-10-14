/**
 * Uji logika kuota. `npm run test:kuota`
 *
 * Tanpa memanggil model sama sekali -- yang diuji hitungannya, bukan
 * jawabannya. Memakai akun hr2 (id 4) sebagai kelinci percobaan, dan
 * catatannya dibersihkan di awal DAN akhir supaya tidak mengotori angka
 * pemakaian sungguhan.
 */
import { cekKuota, catatPemakaian, catatToken, berbayar, KUOTA_JAM } from "../lib/pemakaian.ts";
import { cariModel, modelPilihan, simpanModelPilihan } from "../lib/preferensi-wa.ts";
import { MODEL_DEFAULT } from "../voltagent/models.ts";
import mysql from "mysql2/promise";
import { execSync } from "node:child_process";

const UJI = 4; // hr2
// Pembersihan pakai root: `portal_app` sengaja TIDAK punya izin DELETE di
// tabel ini, supaya celah di aplikasi tidak bisa menghapus catatan
// pemakaiannya sendiri untuk mereset kuota.
const bersihkan = () =>
  execSync(`mysql -u root portal -e "DELETE FROM pemakaian WHERE pengguna_id=${UJI}"`);

bersihkan();

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.PORTAL_APP_DB_USER, password: process.env.PORTAL_APP_DB_PASSWORD,
  database: process.env.PORTAL_DB_NAME,
});

let lolos = 0, gagal = 0;
const cek = (n: string, ok: boolean, k = "") => {
  if (ok) { lolos++; console.log(`  LOLOS  ${n}`); }
  else { gagal++; console.log(`  GAGAL  ${n}${k ? " — " + k : ""}`); }
};

cek("claude dihitung berbayar", berbayar("claude-sonnet-5") === true);
cek("model lokal TIDAK berbayar", berbayar("qwen2.5:latest") === false);
cek("kuota kosong -> boleh", (await cekKuota(UJI, "claude-sonnet-5")).boleh === true);

for (let i = 0; i < KUOTA_JAM; i++) await catatPemakaian(UJI, "web", "claude-sonnet-5");
const habis = await cekKuota(UJI, "claude-sonnet-5");
cek(`setelah ${KUOTA_JAM} pakai -> DITOLAK`, habis.boleh === false);
if (!habis.boleh) console.log(`         pesan: ${habis.pesan.slice(0, 85)}`);

cek(
  "model LOKAL tetap boleh walau kuota claude habis",
  (await cekKuota(UJI, "qwen2.5:latest")).boleh === true,
);

const hitung = async () => {
  const [r] = await c.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) n FROM pemakaian WHERE pengguna_id=? AND berbayar=1", [UJI]);
  return Number(r[0].n);
};
const sebelum = await hitung();
await catatPemakaian(UJI, "wa", "qwen2.5:latest");
cek("pemakaian lokal tidak menambah hitungan berbayar", (await hitung()) === sebelum);

const bacaToken = async (id: number) => {
  const [r] = await c.query<mysql.RowDataPacket[]>(
    "SELECT token_masuk, token_keluar, token_cache FROM pemakaian WHERE id=?", [id]);
  return r[0];
};

// Bentuk ASLI yang dikembalikan VoltAgent. Tipenya menjanjikan
// promptTokens/completionTokens, kenyataannya inputTokens/outputTokens --
// dan salah pakai bikin kolomnya NULL tanpa error apa pun.
const idAsli = await catatPemakaian(UJI, "web", "claude-sonnet-5");
await catatToken(idAsli, { inputTokens: 5209, outputTokens: 20, cachedInputTokens: 0 });
const asli = await bacaToken(idAsli);
cek(
  "token tercatat dari bentuk ASLI (inputTokens/outputTokens)",
  asli.token_masuk === 5209 && asli.token_keluar === 20,
  `dapat ${JSON.stringify(asli)}`,
);

// Bentuk yang dijanjikan tipe -- tetap didukung kalau suatu hari berubah.
const idTipe = await catatPemakaian(UJI, "web", "claude-sonnet-5");
await catatToken(idTipe, { promptTokens: 6000, completionTokens: 500, cachedInputTokens: 3400 });
const tipe = await bacaToken(idTipe);
cek(
  "token tercatat dari bentuk TIPE (promptTokens/completionTokens)",
  tipe.token_masuk === 6000 && tipe.token_keluar === 500 && tipe.token_cache === 3400,
  `dapat ${JSON.stringify(tipe)}`,
);

// portal_app tidak boleh bisa menghapus catatannya sendiri
let bisaHapus = false;
try { await c.query("DELETE FROM pemakaian WHERE pengguna_id=?", [UJI]); bisaHapus = true; } catch { /* diharapkan */ }
cek("portal_app TIDAK bisa menghapus catatan pemakaian", !bisaHapus);

console.log("\n--- pilihan model WhatsApp ---");

// Pencocokan longgar: user mengetik "haiku", bukan "claude-haiku-4-5".
cek("'haiku' -> claude-haiku-4-5", cariModel("haiku")?.id === "claude-haiku-4-5");
cek("'sonnet' -> claude-sonnet-5", cariModel("sonnet")?.id === "claude-sonnet-5");
cek("'lokal' -> model lokal", cariModel("lokal")?.penyedia === "lokal");
cek("id lengkap tetap jalan", cariModel("claude-sonnet-5")?.id === "claude-sonnet-5");
cek("besar-kecil huruf diabaikan", cariModel("HAIKU")?.id === "claude-haiku-4-5");
cek(
  "'claude' AMBIGU -> null",
  cariModel("claude") === null,
  "cocok ke dua model, harus minta user memperjelas",
);
cek("kata ngawur -> null", cariModel("gpt-5") === null);
cek("kosong -> null", cariModel("   ") === null);

execSync(`mysql -u root portal -e "DELETE FROM wa_preferensi WHERE pengguna_id=${UJI}"`);
cek("belum pernah memilih -> model bawaan", (await modelPilihan(UJI)).id === MODEL_DEFAULT);

await simpanModelPilihan(UJI, "claude-haiku-4-5");
cek("setelah dipilih -> tersimpan", (await modelPilihan(UJI)).id === "claude-haiku-4-5");

await simpanModelPilihan(UJI, "qwen2.5:latest");
cek("bisa diganti lagi", (await modelPilihan(UJI)).penyedia === "lokal");

// Nilai di luar whitelist harus jatuh ke bawaan, bukan diteruskan.
await simpanModelPilihan(UJI, "claude-opus-MAHAL-BANGET");
cek(
  "model di luar whitelist -> jatuh ke bawaan",
  (await modelPilihan(UJI)).id === MODEL_DEFAULT,
  "id dari user TIDAK boleh dipercaya mentah",
);

execSync(`mysql -u root portal -e "DELETE FROM wa_preferensi WHERE pengguna_id=${UJI}"`);
await c.end();
bersihkan();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
