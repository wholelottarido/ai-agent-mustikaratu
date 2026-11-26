/**
 * Tool baru tim lain menunggu persetujuan sebelum dipakai portal.
 *
 *   npm run test:tinjau-tool
 *
 * Tidak memakai model bahasa. Mengubah `ai_tool_tinjau` sementara di database portal lokal dan
 * memulihkannya di akhir. Tabel `ai_tool` bersama tidak disentuh.
 */
import type mysql from "mysql2/promise";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { poolPortalAdmin } from "../lib/db-portal.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { batalkanTolak, putuskanTool, statusTool } from "../lib/tinjau-tool.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

console.log("=== 1. Aturan ===");
cek("peta kosong berarti penjaga belum dipasang", statusTool(new Map(), "apa") === "dikenal");
const peta = new Map([["a", "dikenal"], ["b", "disetujui"], ["c", "ditolak"]] as const);
cek("yang dikenal tetap dikenal", statusTool(new Map(peta), "a") === "dikenal");
cek("yang tidak tercatat menunggu", statusTool(new Map(peta), "baru") === "menunggu");
cek("yang ditolak tetap ditolak", statusTool(new Map(peta), "c") === "ditolak");

const admin = poolPortalAdmin();
const [simpan] = await admin.query<mysql.RowDataPacket[]>("SELECT tool_kode, status, oleh FROM ai_tool_tinjau");
const pulihkan = async () => {
  await admin.query("DELETE FROM ai_tool_tinjau");
  for (let i = 0; i < simpan.length; i += 200) {
    await admin.query("INSERT INTO ai_tool_tinjau (tool_kode, status, oleh) VALUES ?",
      [simpan.slice(i, i + 200).map((r) => [r.tool_kode, r.status, r.oleh])]);
  }
  lupakanKonfig();
};

try {
  console.log("\n=== 2. Keadaan awal ===");
  lupakanKonfig();
  const awal = await muatKonfig();
  const { rows: semua } = await poolPerusahaan().query<{ n: number }>(
    `SELECT count(*)::int n FROM ai_tool WHERE coalesce(updated_by, '') <> 'magang'`);
  cek("daftar awal sudah terisi", simpan.length > 0, `${simpan.length} baris, tim lain ${semua[0].n}`);
  const jumlahAwal = new Map(awal.agent.map((a) => [a.kode, a.tool.length]));

  const pilihan = awal.agent.flatMap((a) => a.tool.filter((t) => t.pemilik !== "magang" && t.operasi === "baca").map((t) => ({ t, a: a.kode })))[0];
  cek("ada tool tim lain untuk dicoba", Boolean(pilihan), pilihan?.t.kode);
  if (!pilihan) throw new Error("tidak ada tool untuk diuji");
  const kode = pilihan.t.kode;
  const pakai = async () => {
    lupakanKonfig();
    const k = await muatKonfig();
    return {
      dipakai: k.agent.some((a) => a.tool.some((t) => t.kode === kode)),
      tinjau: k.tinjauan.find((t) => t.kode === kode),
      k,
    };
  };

  console.log("\n=== 3. Tool baru ===");
  await admin.query("DELETE FROM ai_tool_tinjau WHERE tool_kode = ?", [kode]);
  let h = await pakai();
  cek("tool baru tidak dipakai agent", !h.dipakai);
  cek("tool baru tampil menunggu, dengan agentnya", h.tinjau?.status === "menunggu" && h.tinjau.agent.length > 0, h.tinjau?.agent.join(", "));
  const pemegang = new Set(awal.agent.filter((a) => a.tool.some((t) => t.kode === kode)).map((a) => a.kode));
  cek("agent lain tidak terganggu",
    h.k.agent.every((a) => a.tool.length === (jumlahAwal.get(a.kode) ?? 0) - (pemegang.has(a.kode) ? 1 : 0)),
    `${pemegang.size} agent memegang tool ini`);

  console.log("\n=== 4. Keputusan ===");
  await putuskanTool(kode, "ditolak", 1);
  h = await pakai();
  cek("ditolak: tidak dipakai", !h.dipakai);
  cek("ditolak: tetap terlihat", h.tinjau?.status === "ditolak");
  await batalkanTolak(kode);
  h = await pakai();
  cek("batal tolak: kembali menunggu", !h.dipakai && h.tinjau?.status === "menunggu");
  await putuskanTool(kode, "disetujui", 1);
  h = await pakai();
  cek("disetujui: dipakai lagi", h.dipakai);
  cek("disetujui: keluar dari daftar tinjauan", h.tinjau === undefined);

  console.log("\n=== 5. Tool milik portal tidak ikut ditahan ===");
  const milikKita = awal.agent.flatMap((a) => a.tool).filter((t) => t.pemilik === "magang");
  cek("tool milik portal tetap terpasang", h.k.agent.flatMap((a) => a.tool).filter((t) => t.pemilik === "magang").length === milikKita.length, `${milikKita.length} alat`);
} finally {
  await pulihkan();
  lupakanKonfig();
  const akhir = await muatKonfig();
  cek("daftar dipulihkan, tidak ada yang menunggu", akhir.tinjauan.filter((t) => t.status === "menunggu").length === 0,
    `${akhir.tinjauan.length} dalam tinjauan`);
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  await poolPerusahaan().end();
  process.stdout.write("", () => process.exit(gagal > 0 ? 1 : 0));
}
