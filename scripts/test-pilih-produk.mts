/**
 * Uji alur tombol pilih produk, dari pertanyaan sampai jawaban.
 *
 *   npm run test:pilih-produk
 *
 * PRASYARAT: server hidup di localhost:3000. Memanggil model sungguhan.
 * HANYA MEMBACA data perusahaan; satu baris `pemakaian` tercatat per panggilan.
 *
 * ⚠️ KENAPA UJI INI ADA. `test:ramalan-router` lolos 12/12 sesudah aturan
 * perute diubah 2 Nov 2026, tapi tidak satu kasusnya pun mengirim nama produk
 * sebagai jawaban atas "yang mana?". Lolosnya hanya membuktikan aturan baru
 * tidak merusak yang lama, bukan bahwa tombolnya bekerja.
 *
 * Dua pertanyaan yang dijawab di sini:
 *   1. Lewat HTTP: daftar pilihan benar-benar sampai di metadata, dan nama
 *      yang dikirim tombol menghasilkan ramalan produk ITU.
 *   2. Lewat router: niat pertanyaan awal tetap dipakai. Tombolnya cuma
 *      mengirim nama, jadi yang bertanya soal tren pasar tidak boleh berakhir
 *      di ramalan penjualan.
 *
 * Kasus 2 tidak lewat HTTP karena server memakai setelan pencarian yang
 * menyala, dan uji tidak boleh membelanjakan kuota Tavily.
 */
process.env.MARKET_SEARCH_ENABLED = "false";

import { polaBulan } from "./lib/pola-bulan.mts";
import { bulanTerakhirData } from "../lib/ramalan/deret.ts";
import { buatRouter } from "../voltagent/agent-konfig.ts";
import { KUNCI_MODEL, KUNCI_SALURAN } from "../voltagent/agents.ts";
import { lupakanKonfig } from "../lib/ai-konfig.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { catatKlarifikasi } from "../voltagent/jalur-agent.ts";
import { menyebutSemuaPilihan, teksPilihan } from "../lib/cocok-pilihan.ts";
import { buatToolRamalan } from "../voltagent/tools-ramalan.ts";
import { usernamePortal } from "../lib/akun-perusahaan.ts";
import { cariPengguna } from "../lib/pengguna.ts";
import { buatToken, NAMA_COOKIE } from "../lib/sesi.ts";
import type { Jejak, Klarifikasi } from "../voltagent/tool-konfigurasi.ts";

const BASE = process.env.UJI_BASE ?? "http://localhost:3000";
// `UJI_MODEL=llama.cpp/gemma-4-12b-it-q8` untuk model lokal, tanpa kuota dan saldo.
const MODEL = process.env.UJI_MODEL ?? "claude-haiku-4-5";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const rapikan = (t: string) => t.replace(/\s+/g, " ").trim();

type Pesan = { id: string; role: "user" | "assistant"; parts: { type: "text"; text: string }[] };
const pesan = (i: number, role: Pesan["role"], text: string): Pesan =>
  ({ id: `uji-${i}`, role, parts: [{ type: "text", text }] });

type Meta = { alat?: string[]; sumber?: string[]; klarifikasi?: Klarifikasi };

/** Satu giliran lewat `/api/chat`, dibaca persis seperti aliran yang diterima browser. */
async function kirimHttp(kue: string, messages: Pesan[]): Promise<{ status: number; teks: string; meta: Meta }> {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kue },
    body: JSON.stringify({ messages, model: MODEL }),
  });
  const mentah = await r.text();
  let teks = "";
  let meta: Meta = {};
  for (const baris of mentah.split("\n")) {
    if (!baris.startsWith("data: ") || baris === "data: [DONE]") continue;
    try {
      const d = JSON.parse(baris.slice(6)) as { type?: string; delta?: string; messageMetadata?: Meta };
      if (d.type === "text-delta") teks += d.delta ?? "";
      if (d.messageMetadata) meta = { ...meta, ...d.messageMetadata };
    } catch { /* baris yang bukan JSON dilewati */ }
  }
  console.log(`  HTTP ${r.status} · alat: ${meta.alat?.join(", ") || "(TIDAK ADA)"}`);
  console.log(`  ${rapikan(teks).slice(0, 160)}\n`);
  return { status: r.status, teks, meta };
}

// ============================================================
console.log("=== 0. Percobaan yang berhasil menghapus pertanyaannya ===");
// ============================================================
// Tanpa model bahasa, supaya hasilnya tidak bergantung model kebetulan salah
// menulis nama seperti yang terjadi 3 Nov 2026.
{
  const t: Klarifikasi = { pesan: "Yang mana?", pilihan: [{ kode: "1", nama: "A" }, { kode: "2", nama: "B" }] };
  const d: Klarifikasi[] = [];
  catatKlarifikasi(d, { alat: "ramal_penjualan", view: null, klarifikasi: t });
  cek("alat yang bertanya tercatat", d.length === 1);
  catatKlarifikasi(d, { alat: "cari_sop", view: null });
  cek("alat lain tidak menghapus pertanyaannya", d.length === 1);
  catatKlarifikasi(d, { alat: "ramal_penjualan", view: null, klarifikasi: t });
  cek("pertanyaan alat yang sama tidak menumpuk", d.length === 1);
  catatKlarifikasi(d, { alat: "ramal_penjualan", view: null });
  cek("alat yang sama selesai tanpa bertanya -> daftar hilang", d.length === 0);
}

// ============================================================
console.log("\n=== 0b. Jawaban yang menyalin daftar dari riwayat tetap dapat tombol ===");
// ============================================================
{
  const nama = ["MINYAK CEMCEMAN    175 ML RJ", "MINYAK CEMCEMAN 175 ML RJ NF", "MINYAK CEMCEMAN  175 ML RJ+M.ZAITUN 12ML"];
  cek("daftar disalin lengkap -> cocok", menyebutSemuaPilihan(
    "Mohon perjelas:\n1. MINYAK CEMCEMAN 175 ML RJ\n2. MINYAK CEMCEMAN 175 ML RJ NF\n3. MINYAK CEMCEMAN 175 ML RJ+M.ZAITUN 12ML", nama));
  cek("spasi di sekitar + dan huruf kecil tetap cocok", menyebutSemuaPilihan(
    "minyak cemceman 175 ml rj nf, MINYAK CEMCEMAN 175 ML RJ + M.ZAITUN 12ML", nama));
  cek("jawaban ramalan satu varian -> tidak cocok", !menyebutSemuaPilihan(
    "Prediksi MINYAK CEMCEMAN 175 ML RJ: 2.158 unit per bulan", nama));
  cek("sebagian daftar -> tidak cocok", !menyebutSemuaPilihan(
    "1. MINYAK CEMCEMAN 175 ML RJ NF\n2. MINYAK CEMCEMAN 175 ML RJ+M.ZAITUN 12ML X", ["MINYAK CEMCEMAN 75 ML RJ", ...nama]));
  cek("tombol menyebut tujuan pertanyaan",
    teksPilihan({ kode: "1", nama: "A  B" }, "cari_tren_pasar") === "Tren pasar: A B (kode 1)");
  cek("alat yang tidak dikenal tidak menambah awalan", teksPilihan({ kode: "1", nama: "A" }, "lain") === "A (kode 1)");
  cek("daftar satu nama tidak pernah cocok", !menyebutSemuaPilihan("MINYAK CEMCEMAN 175 ML RJ", ["MINYAK CEMCEMAN 175 ML RJ"]));
}

try {
  try {
    await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(20000) });
  } catch {
    console.log(`⛔ Tidak ada server di ${BASE}. Jalankan \`npm run dev\` dulu.`);
    process.exit(1);
  }

  lupakanKonfig();
  const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
    `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
      WHERE lower(u.username) = 'ridho@mustika-ratu.co.id' LIMIT 1`);
  if (rows.length === 0) throw new Error("akun uji tidak ada");
  const idEmployee = rows[0].id_employee;
  const akses = await aksesUntukEmployee(idEmployee);
  if (!akses) throw new Error("akses akun uji tidak terbaca");

  const p = await cariPengguna(usernamePortal(idEmployee));
  if (!p) throw new Error("akun uji belum punya baris pengguna; login sekali lewat web dulu");
  const token = await buatToken({
    id: p.id, username: p.username, nama: p.nama, departemen: p.departemen, peran: p.peran,
    idEmployee, admin: false,
  });
  const kue = `${NAMA_COOKIE}=${token}`;

  // ============================================================
  console.log("=== 1. Daftar pilihan sampai ke layar (HTTP) ===");
  // ============================================================
  const tanya = "Prediksi penjualan MINYAK CEMCEMAN";
  const awal = await kirimHttp(kue, [pesan(1, "user", tanya)]);
  const k = awal.meta.klarifikasi;
  cek("HTTP 200", awal.status === 200, String(awal.status));
  cek("ramal_penjualan dipanggil", Boolean(awal.meta.alat?.includes("ramal_penjualan")));
  cek("daftar pilihan ada di metadata", Boolean(k && k.pilihan.length > 1), `${k?.pilihan.length ?? 0} pilihan`);
  cek("tiap pilihan membawa panjang riwayat",
    (k?.pilihan ?? []).every((x) => typeof x.riwayat_bulan === "number"));

  // ============================================================
  console.log("\n=== 2. Menekan tombol menghasilkan ramalan produk ITU (HTTP) ===");
  // ============================================================
  // ⚠️ Dua nama yang paling rawan: yang jadi awalan nama lain, dan yang memuat
  // tanda "+" (paling mudah diubah model waktu meneruskannya ke tool).
  const semua = (k?.pilihan ?? []).map((x) => rapikan(x.nama));
  const dicoba = [
    semua.find((n) => n === "MINYAK CEMCEMAN 175 ML RJ"),
    semua.find((n) => n.includes("+")),
  ].filter((n): n is string => Boolean(n));
  cek("dua nama uji tersedia di daftar", dicoba.length === 2, dicoba.join(" | "));

  for (const nama of dicoba) {
    console.log(`  tombol: ${nama}`);
    const h = await kirimHttp(kue, [
      pesan(1, "user", tanya),
      pesan(2, "assistant", awal.teks),
      // Persis yang dikirim `PilihProduk`.
      pesan(3, "user", teksPilihan(k!.pilihan.find((x) => rapikan(x.nama) === nama)!, k!.alat)),
    ]);
    cek(`[${nama}] ramal_penjualan dipanggil lagi`, Boolean(h.meta.alat?.includes("ramal_penjualan")),
      h.meta.alat?.join(", ") || "tidak ada alat");
    cek(`[${nama}] tidak bertanya lagi`, h.meta.klarifikasi === undefined,
      h.meta.klarifikasi ? `${h.meta.klarifikasi.pilihan.length} pilihan` : "");
    // Spasi diabaikan: model menulis "RJ + M.ZAITUN" untuk "RJ+M.ZAITUN". Yang
    // memastikan produknya sama adalah angkanya, yang diperiksa di bawah.
    const tanpaSpasi = (t: string) => t.replace(/\s+/g, "").toUpperCase();
    cek(`[${nama}] jawabannya menyebut nama produk yang ditekan`, tanpaSpasi(h.teks).includes(tanpaSpasi(nama)),
      rapikan(h.teks).slice(0, 80));
    // ⚠️ HARAPANNYA DARI ALAT, BUKAN DARI NAMA PRODUK. "RJ+M.ZAITUN" sudah berhenti
    // dijual, jadi jawaban yang benar justru TANPA angka. Angka untuk produk
    // seperti ini berarti bukan hasil ramalannya. Sekali terlihat 3 Nov 2026,
    // tidak terulang dalam 6 putaran; penjagaan ini supaya tertangkap kalau muncul.
    const alatLangsung = buatToolRamalan() as unknown as {
      execute: (a: { produk: string }) => Promise<{ status?: string; jumlah_unit?: { ramalan?: number[] } }>;
    };
    const langsung = await alatLangsung.execute({ produk: nama });
    const status = langsung.status;
    const adaAngka = /\b\d{1,3}(?:[.,]\d{3})+\b/.test(h.teks);
    if (status === "produk-berhenti") {
      cek(`[${nama}] berhenti dijual -> tidak ada angka ramalan`, !adaAngka, rapikan(h.teks).slice(0, 80));
      cek(`[${nama}] mengaku produknya berhenti`,
        /berhenti|tidak .*(terjual|dijual|penjualan)|sudah tidak/i.test(h.teks));
    } else {
      cek(`[${nama}] alat menghasilkan ramalan`, status === "siap", String(status));
      // ⚠️ Bukti produknya sama: angka di jawaban milik produk ITU. Kode SKU tidak
      // dipakai sebagai bukti karena model tidak selalu menuliskannya, dan nama
      // saja lolos juga untuk varian "... RJ NF".
      const unit = langsung.jumlah_unit?.ramalan?.[0];
      const bentuk = unit === undefined ? [] : [String(unit), unit.toLocaleString("id-ID"), unit.toLocaleString("en-US")];
      cek(`[${nama}] jawabannya menyebut arah tren`, /\b(naik|turun|stabil)\b/i.test(h.teks));
      cek(`[${nama}] jawabannya menyebut bulan aktual terakhir`, polaBulan((await bulanTerakhirData()) ?? "").test(h.teks));
      cek(`[${nama}] angka unit di jawaban sama dengan hasil alat`,
        bentuk.some((b) => h.teks.includes(b)), `alat ${unit}`);
    }
    cek(`[${nama}] label sumbernya menyebut tabel penjualan`,
      Boolean(h.meta.sumber?.includes("ai_forecast_sales_monthly")), h.meta.sumber?.join(", ") ?? "");
  }

  // ============================================================
  console.log("\n=== 3. Niat awal tetap dipakai: tren pasar tidak jadi ramalan ===");
  // ============================================================
  {
    let alat: string[] = [];
    let tanyaLagi: Klarifikasi | undefined;
    let alatTanya: string | undefined;
    const catat = (j: Jejak) => {
      if (!alat.includes(j.alat)) alat.push(j.alat);
      if (j.klarifikasi) { tanyaLagi = j.klarifikasi; alatTanya = j.alat; }
    };
    const router = await buatRouter(akses.sesi, akses.apps, catat);
    if (!router) throw new Error("router tidak terbentuk");
    const context = { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" };

    const q = "Cari tren pasar untuk MINYAK CEMCEMAN";
    const a = (await router.agent.generateText(q, { context })) as { text?: string };
    const alatAwal = [...alat];
    console.log(`  alat: ${alatAwal.join(", ") || "(TIDAK ADA)"}\n`);
    cek("alat pasar yang bertanya",
      alatAwal.includes("cari_tren_pasar") || alatAwal.includes("analisis_pasar_penjualan"), alatAwal.join(", "));
    cek("daftar pilihannya tercatat", Boolean(tanyaLagi), `${tanyaLagi?.pilihan.length ?? 0} pilihan`);

    const tanyaAwal: Klarifikasi | undefined = tanyaLagi;
    alat = [];
    tanyaLagi = undefined;
    const lanjut = (await router.agent.generateText(
      [
        pesan(1, "user", q),
        pesan(2, "assistant", String(a.text ?? "")),
        pesan(3, "user", teksPilihan(tanyaAwal!.pilihan.find((x) => rapikan(x.nama) === "MINYAK CEMCEMAN 175 ML RJ")!, alatTanya)),
      ] as never,
      { context },
    )) as { text?: string };
    console.log(`  alat: ${alat.join(", ") || "(TIDAK ADA)"}`);
    console.log(`  ${rapikan(String(lanjut.text ?? "")).slice(0, 160)}\n`);
    cek("alat yang sama dipanggil lagi", alatAwal.some((x) => alat.includes(x)), alat.join(", ") || "tidak ada alat");
    cek("tidak berbelok ke ramal_penjualan murni", !alat.includes("ramal_penjualan"), alat.join(", "));
    cek("tidak bertanya lagi", tanyaLagi === undefined);
  }
} finally {
  await poolPerusahaan().end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  // Pool `cariPengguna` milik modulnya dan tidak punya penutup.
  process.exit(gagal > 0 ? 1 : 0);
}
