/**
 * Tahap 3 (F.4) dengan KONFIGURASI SUNGGUHAN — HANYA MEMBACA (setelan ai_agent/ai_tool), tanpa model.
 *   npm run test:tahap3-data
 *
 * Sesi tiruan (tanpa data pribadi); kombinasi akses & izin diambil dari setelan, bukan ditulis tangan.
 * Yang dibuktikan: registri kemampuan = persis alat yang terpasang untuk pemakai itu (sesudah akses & izin),
 * keputusan Q4 pada setelan hari ini, tidak ada penolakan palsu untuk pertanyaan data/ambigu, dan saklar
 * RUTE_KEMAMPUAN=mati mengembalikan perilaku sebelum Tahap 3.
 */
import { muatKonfig } from "../lib/ai-konfig.ts";
import { buatRouter } from "../voltagent/agent-konfig.ts";
import { buatPemegangPenjaga } from "../lib/alur/penjaga-alur.ts";
import { cocokkan, jenisAgent } from "../lib/alur/kemampuan.ts";
import type { SesiPemakai } from "../voltagent/tool-konfigurasi.ts";

let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };
const ctx = { context: new Map([["saluran", "web"]]) } as never;
const instruksi = (a: { instructions: unknown }) => typeof a.instructions === "function" ? String((a.instructions as (x: unknown) => string)(ctx)) : String(a.instructions);

const k = await muatKonfig();
const aplikasi = k.agent.filter((a) => !a.umum && a.aktif);
const semuaApps = [...new Set(aplikasi.flatMap((a) => [a.idApps, ...a.appsLain]).filter(Boolean) as string[])];
const semuaIzin = [...new Set(aplikasi.flatMap((a) => a.tool.map((t) => t.izin)).filter(Boolean).flatMap((s) => String(s).split(",").map((x) => x.trim())))];
const sesi = (izin: string[]): SesiPemakai => ({ idEmployee: "11111111-1111-1111-1111-111111111111", idDepartment: null, idCompany: null, idUsers: null, departemen: null, izin });
const appsAgent = (pred: (a: (typeof aplikasi)[number]) => boolean) => aplikasi.filter(pred).flatMap((a) => [a.idApps, ...a.appsLain]).filter(Boolean) as string[];
const punyaDokumen = (a: (typeof aplikasi)[number]) => a.tool.some((t) => t.jenis === "kode" && (t.penangan === "cari_sop" || t.penangan === "daftar_sop"));
const namaSuper = aplikasi.find((a) => /super\s*tools/i.test(a.nama))?.nama;

async function rakit(apps: string[], izin: string[]) {
  const pp = buatPemegangPenjaga();
  const r = await buatRouter(sesi(izin), apps, undefined, undefined, undefined, undefined, pp);
  return { r: r!, pp, reg: pp.registri() };
}

console.log("— 1. registri = alat terpasang untuk pemakai ini");
const penuh = await rakit(semuaApps, semuaIzin);
const denganAlat = penuh.r.bawahan.filter((b) => b.jumlahTool > 0);
cek("agent di registri = bawahan yang punya alat (bukan seluruh setelan)",
  JSON.stringify(penuh.reg?.agent.map((a) => a.nama).sort()) === JSON.stringify(denganAlat.map((b) => b.nama).sort()),
  `${penuh.reg?.agent.length} agent: ${penuh.reg?.agent.map((a) => `${a.nama.replace("Ratu AI ", "")}(${a.alat.length})`).join(", ")}`);
cek("jumlah alat per agent di registri = jumlah alat terpasang", denganAlat.every((b) => penuh.reg?.agent.find((a) => a.nama === b.nama)?.alat.length === b.jumlahTool));
const pemegangDok = penuh.reg?.agent.filter((a) => jenisAgent(a).includes("dokumen")).map((a) => a.nama) ?? [];
cek("pemegang alat dokumen dihitung dari alat (bukan nama agent)", pemegangDok.length > 0, pemegangDok.join(", "));
cek("agent tanpa alat terpasang tidak masuk registri", penuh.r.bawahan.filter((b) => b.jumlahTool === 0).every((b) => !penuh.reg?.agent.some((a) => a.nama === b.nama)),
  penuh.r.bawahan.filter((b) => b.jumlahTool === 0).map((b) => b.nama).join(", ") || "(tidak ada)");
const tanpaIzin = await rakit(semuaApps, []);
cek("izin dicabut → alat yang butuh izin hilang dari registri juga", (tanpaIzin.reg?.agent.reduce((n, a) => n + a.alat.length, 0) ?? 0) < (penuh.reg?.agent.reduce((n, a) => n + a.alat.length, 0) ?? 0),
  `${tanpaIzin.reg?.agent.reduce((n, a) => n + a.alat.length, 0)} vs ${penuh.reg?.agent.reduce((n, a) => n + a.alat.length, 0)} alat`);

console.log("— 2. keputusan Q4 pada setelan hari ini");
if (namaSuper && penuh.reg) {
  const pj = penuh.pp.ambil();
  const r = pj.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [namaSuper] }, "Bagaimana prosedur pengajuan cuti?");
  const tujuan = r.boleh ? r.targetBaru ?? [] : ((r.galat.hasil as { saran_agent?: string[] }).saran_agent ?? []);
  cek(`prosedur cuti → ${namaSuper} TIDAK dijalankan; diarahkan ke pemegang dokumen`,
    (r.boleh ? !!r.targetBaru && !r.targetBaru.includes(namaSuper) : r.galat.kode === "kemampuan-tidak-cocok") && tujuan.length > 0 && tujuan.every((n) => pemegangDok.includes(n)),
    r.boleh ? `dialihkan → ${r.targetBaru?.join(", ")}` : `ditolak terstruktur, saran: ${tujuan.join(", ")}`);
  const tanpaDok = await rakit(appsAgent((a) => !punyaDokumen(a)), semuaIzin);
  const r2 = tanpaDok.pp.ambil().periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [namaSuper] }, "Bagaimana prosedur pengajuan cuti?");
  cek("pemakai TANPA akses ke pemegang dokumen → tidak dialihkan ke agent di luar aksesnya", r2.boleh && !r2.targetBaru
    && (tanpaDok.reg?.agent.every((a) => !pemegangDok.includes(a.nama)) ?? false));
} else cek("agent Super Tools ada di setelan", false, "setelan berubah — periksa ulang skenario Q4");

console.log("— 3. tidak ada penolakan palsu (setelan sungguhan, akses penuh)");
if (penuh.reg) {
  const reg = penuh.reg;
  const pemilik = (pola: RegExp) => reg.agent.filter((a) => a.alat.some((t) => pola.test(`${t.nama} ${t.label} ${t.deskripsi}`))).map((a) => a.nama);
  const harap: [string, RegExp][] = [
    ["Apakah cuti saya sudah disetujui?", /cuti/i], ["Berapa sisa cuti saya?", /cuti/i], ["Bagaimana status pengajuan izin saya?", /izin/i],
    ["Apakah tiket saya sudah selesai?", /tiket/i], ["Berapa total penjualan September?", /total penjualan|total_penjualan/i],
    ["Buatkan tiket komputer rusak.", /tiket/i], ["tolong ajukan cuti tanggal 5 Desember", /cuti/i],
  ];
  for (const [q, pola] of harap) {
    const calon = pemilik(pola);
    const salah = calon.filter((n) => cocokkan(reg, n, q).tingkat === "tidak-cocok");
    cek(`"${q}" → pemilik alat bidangnya tidak pernah ditolak`, calon.length > 0 && salah.length === 0, `pemilik: ${calon.map((n) => n.replace("Ratu AI ", "")).join(", ")}${salah.length ? ` · DITOLAK: ${salah.join(", ")}` : ""}`);
  }
  for (const q of ["Cuti saya bagaimana?", "Bisa bantu masalah laptop?", "Saya mau mengurus izin.", "Produk apa saja yang stoknya kosong?"]) {
    const ditolak = reg.agent.filter((a) => cocokkan(reg, a.nama, q).tingkat === "tidak-cocok").map((a) => a.nama);
    cek(`ambigu "${q}" → tidak ada agent yang ditolak`, ditolak.length === 0, ditolak.join(", "));
  }
  const matriks = ["Bagaimana prosedur pengajuan cuti?", "Berapa total penjualan September?", "Apakah tiket saya sudah selesai?"].map((q) =>
    `${q.slice(0, 34).padEnd(34)} ${reg.agent.map((a) => `${a.nama.replace("Ratu AI ", "")}=${cocokkan(reg, a.nama, q).tingkat.replace("tidak-diketahui", "?")}`).join(" ")}`);
  console.log(matriks.map((m) => `        ${m}`).join("\n"));
}

console.log("— 4. instruksi perute & saklar");
const teks = instruksi(penuh.r.agent);
cek("daftar agent memuat 'Jenis kemampuan' dari alat", (teks.match(/Jenis kemampuan:/g) ?? []).length === penuh.reg?.agent.length);
cek("aturan lama yang menyebut nama agent sudah tidak ada", !teks.includes("utamakan Ratu AI Portal") && !teks.includes("jangan mengarahkannya ke Super Tools"));
const lama = process.env.RUTE_KEMAMPUAN;
process.env.RUTE_KEMAMPUAN = "mati";
const mati = await rakit(semuaApps, semuaIzin);
const teksMati = instruksi(mati.r.agent);
if (lama === undefined) delete process.env.RUTE_KEMAMPUAN; else process.env.RUTE_KEMAMPUAN = lama;
cek("RUTE_KEMAMPUAN=mati → tanpa registri, instruksi kembali ke versi sebelum Tahap 3", mati.reg === undefined && teksMati.includes("utamakan Ratu AI Portal") && !teksMati.includes("Jenis kemampuan:"));
cek("RUTE_KEMAMPUAN=mati TIDAK mematikan penjaga Tahap 2/5 (kemampuan sapaan tetap dipasang)",
  !mati.pp.ambil().periksaDelegasi({ task: "halo", targetAgents: ["x"] }, "halo").boleh);
const ukuranReg = JSON.stringify(penuh.reg ?? {}).length;
console.log(`        ukuran: instruksi perute ${teks.length} kar (mati: ${teksMati.length}, selisih ${teks.length - teksMati.length}); registri di memori ${ukuranReg} kar (tidak dikirim ke model)`);

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
