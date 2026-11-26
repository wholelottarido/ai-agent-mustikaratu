/**
 * Uji gerbang izin per aplikasi, izin ganda, dan cakupan per peran (`lib/izin-tool.ts`).
 * Tanpa database, tanpa model.
 *
 *   npm run test:izin-tool
 */
import { cekIzin, cakupanUntuk, pecahIzin } from "../lib/izin-tool";
import type { SesiPemakai } from "../voltagent/tool-konfigurasi";

let lolos = 0;
let gagal = 0;
function cek(nama: string, ok: boolean, info = "") {
  if (ok) lolos++;
  else gagal++;
  console.log(`  ${ok ? "LOLOS" : "GAGAL"}  ${nama}${info ? ` — ${info}` : ""}`);
}

const APP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const APP_B = "bbbbbbbb-0000-0000-0000-000000000002";
const sesi = (s: Partial<SesiPemakai>): SesiPemakai => ({
  idEmployee: "e", idUsers: "u", idDepartment: null, idCompany: null, departemen: null, ...s,
});

console.log("=== pecahIzin");
cek("koma & spasi dipecah", JSON.stringify(pecahIzin(" a:read , b:read,,")) === JSON.stringify(["a:read", "b:read"]));

console.log("=== izin per aplikasi");
const orang = sesi({
  izin: ["dashboard:read", "claim:read"],
  izinPerApp: { [APP_A]: ["dashboard:read"], [APP_B]: ["claim:read"] },
  namaApp: { [APP_A]: "Marketing", [APP_B]: "MAPS" },
});
cek("izin dari aplikasi pemilik alat lolos", cekIzin({ izin: "dashboard:read", idApps: APP_A }, orang).ok);
{
  const h = cekIzin({ izin: "dashboard:read", idApps: APP_B }, orang);
  cek("izin yang hanya ada di aplikasi LAIN ditolak", !h.ok);
  cek("pesan menyebut nama aplikasi & frasa 'butuh izin'", !h.ok && h.sebab.includes("MAPS") && h.sebab.startsWith("butuh izin"), h.ok ? "" : h.sebab);
}
cek("alat tanpa id_apps memakai izin gabungan", cekIzin({ izin: "claim:read", idApps: null }, orang).ok);
cek("alat MILIK KITA memakai izin gabungan walau punya id_apps", cekIzin({ izin: "claim:read", idApps: APP_A, pemilik: "magang" }, orang).ok);
cek("alat tim lain dengan id_apps sama tetap per aplikasi", !cekIzin({ izin: "claim:read", idApps: APP_A, pemilik: "sql-katalog" }, orang).ok);
cek("aplikasi yang tidak dimiliki -> ditolak", !cekIzin({ izin: "dashboard:read", idApps: "cccccccc-0000-0000-0000-000000000003" }, orang).ok);
cek("sesi lama tanpa izinPerApp jatuh ke gabungan", cekIzin({ izin: "claim:read", idApps: APP_A }, sesi({ izin: ["claim:read"] })).ok);
cek("izin belum ditelusuri -> ditolak dengan alasan berbeda", (() => {
  const h = cekIzin({ izin: "x:read", idApps: null }, sesi({}));
  return !h.ok && h.sebab.includes("belum ditelusuri");
})());
cek("tanpa syarat izin selalu lolos", cekIzin({ izin: null, idApps: APP_B }, sesi({ izin: [] })).ok);
cek("izin mirip tidak lolos", !cekIzin({ izin: "ticket:read", idApps: null }, sesi({ izin: ["ticket:read:all", "ticket"] })).ok);

console.log("=== izin ganda");
const dua = sesi({ izin: ["a:read"], izinPerApp: { [APP_A]: ["a:read"] } });
const lengkap = sesi({ izin: ["a:read", "b:read"], izinPerApp: { [APP_A]: ["a:read", "b:read"] } });
delete process.env.IZIN_GANDA;
cek("bawaan 'semua': punya sebagian -> ditolak", !cekIzin({ izin: "a:read,b:read", idApps: APP_A }, dua).ok);
cek("bawaan 'semua': punya semua -> lolos", cekIzin({ izin: "a:read, b:read", idApps: APP_A }, lengkap).ok);
{
  const h = cekIzin({ izin: "a:read,b:read", idApps: APP_A }, dua);
  cek("pesan menyebut izin yang kurang saja", !h.ok && h.sebab.includes("(b:read)"), h.ok ? "" : h.sebab);
}
process.env.IZIN_GANDA = "salah-satu";
cek("'salah-satu': punya sebagian -> lolos", cekIzin({ izin: "a:read,b:read", idApps: APP_A }, dua).ok);
cek("'salah-satu': tidak punya satu pun -> ditolak", !cekIzin({ izin: "c:read,d:read", idApps: APP_A }, dua).ok);
delete process.env.IZIN_GANDA;

console.log("=== cakupan per peran");
const alat = { cakupan: "bawahan" as const, cakupanPeran: [{ idRoles: "r-super", cakupan: "semua" as const }, { idRoles: "r-dept", cakupan: "departemen" as const }] };
cek("tanpa peran tercantum -> cakupan bawaan", cakupanUntuk(alat, sesi({ peran: ["r-lain"] })) === "bawahan");
cek("peran tercantum -> cakupan perannya", cakupanUntuk(alat, sesi({ peran: ["r-dept"] })) === "departemen");
cek("beberapa peran -> yang paling luas", cakupanUntuk(alat, sesi({ peran: ["r-dept", "r-super"] })) === "semua");
cek("sesi tanpa daftar peran -> cakupan bawaan", cakupanUntuk(alat, sesi({})) === "bawahan");
cek("alat tanpa cakupanPeran -> cakupan bawaan", cakupanUntuk({ cakupan: "diri", cakupanPeran: [] }, sesi({ peran: ["r-super"] })) === "diri");

console.log("=== jawaban agent bawahan yang sebenarnya galat model");
{
  const { jawabanGagalModel } = await import("../lib/alur/kemampuan");
  cek("teks kosong = galat model", jawabanGagalModel("  "));
  cek("teks galat VoltAgent = galat model", jawabanGagalModel("Error in delegating task to Ratu AI CMOD: request exceeds"));
  cek("pesan kapasitas = galat model", jawabanGagalModel("request (9028 tokens) exceeds the available context size (8192 tokens)"));
  cek("jawaban 'tidak ada data' biasa BUKAN galat model", !jawabanGagalModel("Tidak ada tiket helpdesk yang belum selesai."));
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
