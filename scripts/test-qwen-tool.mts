/**
 * Uji Qwen 14B (Colab) terhadap SKEMA TOOL ASLI portal, dengan HASIL TOOL
 * SINTETIS.
 *
 *   npm run test:qwen-tool
 *
 * ============================================================
 * ⚠️ KENAPA HASIL TOOL-NYA SINTETIS, BUKAN DARI DATABASE
 * ============================================================
 * Syarat yang diberikan pemilik proyek (21 Okt 2026): "Jangan mengirim data
 * sensitif perusahaan ke Google Colab."
 *
 * Qwen 14B jalan di Colab lewat tunnel Cloudflare — pihak ketiga, di luar
 * jaringan kantor. Uji ujung-ke-ujung lewat agent sungguhan akan mengirim
 * HASIL tool ke sana: nomor tiket, nomor seri aset, nama atasan, NIK. Akun
 * `marketing1` pun tertaut ke `id_employee` nyata, jadi "akun demo" tidak
 * membuat datanya jadi demo.
 *
 * Jadi yang dikirim ke Colab di berkas ini:
 *   - skema tool ASLI (nama, deskripsi, parameter) — ini bukan data karyawan
 *   - pertanyaan sintetis
 *   - hasil tool SINTETIS yang dikarang di sini
 *
 * Yang TIDAK pernah dikirim: satu baris pun dari PostgreSQL perusahaan.
 *
 * ============================================================
 * YANG DIUJI, DAN KENAPA ITU YANG PENTING
 * ============================================================
 * 1. Prompt muat (tidak ada lagi `Prompt too long`), TERMASUK dengan riwayat.
 * 2. Qwen memilih tool yang BENAR untuk tiap pertanyaan.
 * 3. Argumennya sah terhadap skema zod tool itu — bukan cuma "JSON valid".
 * 4. Sesudah diberi hasil tool, jawabannya memakai angka DARI hasil itu.
 * 5. ⚠️ Waktu tool GAGAL atau KOSONG, dia tidak mengarang penggantinya.
 *
 * Nomor 5 yang paling menentukan: qwen2.5 7B lokal gagal persis di situ —
 * menulis jawaban yang bentuknya meyakinkan tanpa menyentuh data.
 */
import { buatToolDariKonfig } from "../voltagent/tool-konfigurasi.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { alamatQwen, timeoutQwen } from "../voltagent/models.ts";
import { z } from "zod";

const MODEL = process.env.QWEN_MODEL ?? "Qwen/Qwen2.5-14B-Instruct";
const KEY = process.env.QWEN_API_KEY ?? "";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

type Panggil = { nama: string; argumen: Record<string, unknown> };
type Balasan = {
  ok: boolean; status: number; sebab: string;
  teks: string; panggil: Panggil[];
  masuk: number; keluar: number; detik: number;
};

async function tanyaQwen(
  pesan: { role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string }[],
  tools?: unknown[],
): Promise<Balasan> {
  const mulai = Date.now();
  const r = await fetch(`${alamatQwen()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: pesan, ...(tools ? { tools, tool_choice: "auto" } : {}), max_tokens: 400 }),
    signal: AbortSignal.timeout(timeoutQwen()),
  });
  const detik = (Date.now() - mulai) / 1000;
  const teksMentah = await r.text();
  if (!r.ok) {
    let sebab = teksMentah.slice(0, 80);
    try { sebab = (JSON.parse(teksMentah) as { detail?: string }).detail ?? sebab; } catch { /* biarkan mentah */ }
    return { ok: false, status: r.status, sebab, teks: "", panggil: [], masuk: 0, keluar: 0, detik };
  }
  const d = JSON.parse(teksMentah) as {
    choices: { message: { content: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const m = d.choices[0]?.message;
  const panggil: Panggil[] = (m?.tool_calls ?? []).map((t) => {
    let argumen: Record<string, unknown> = {};
    // ⚠️ Argumen datang sebagai STRING. JSON rusak di sini bukan hal teoretis —
    // itu bentuk kegagalan paling umum model kecil waktu memanggil tool.
    try { argumen = JSON.parse(t.function.arguments) as Record<string, unknown>; } catch { argumen = { __rusak: t.function.arguments }; }
    return { nama: t.function.name, argumen };
  });
  return {
    ok: true, status: r.status, sebab: "",
    teks: m?.content ?? "", panggil,
    masuk: d.usage?.prompt_tokens ?? 0, keluar: d.usage?.completion_tokens ?? 0, detik,
  };
}

// ============================================================
// Skema tool ASLI, diambil dari agent portal yang sungguhan.
// ============================================================
lupakanKonfig();
const k = await muatKonfig();
const portal = k.agent.find((a) => a.kode === "agent-portal");
if (!portal) throw new Error("agent-portal tidak ada di konfigurasi");

const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
    WHERE lower(u.username) = 'dafi@mustika-ratu.co.id' LIMIT 1`);
const akses = await aksesUntukEmployee(rows[0].id_employee);
if (!akses) throw new Error("akses akun uji tidak terbaca");

const { tool } = buatToolDariKonfig(portal.tool, akses.sesi);
console.log(`tool agent-portal yang terpasang: ${tool.length}`);
for (const t of tool) console.log(`  ${t.name}`);

const skema = tool.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    // ⚠️ `z.toJSONSchema` bawaan zod 4, bukan paket `zod-to-json-schema`
    // (yang itu untuk zod 3 dan tipenya tidak cocok di sini).
    parameters: z.toJSONSchema(t.parameters as z.ZodType, { io: "input" }),
  },
}));

// Instruksi agent portal yang sebenarnya — dipakai apa adanya supaya ukuran
// prompt yang diuji sama dengan yang dipakai sehari-hari.
const SISTEM =
  "Kamu Ratu AI Portal. Tiket helpdesk, aset, profil & job scope, dan induction karyawan.\n\n" +
  "## Aturan menjawab\n" +
  "1. Jawab HANYA dari hasil tool. Kalau tidak ada tool yang cocok, katakan kamu belum bisa\n" +
  "   mengambil data itu — jangan mengarang angka, nama, atau tanggal.\n" +
  "2. Kalau tool mengembalikan `galat`, sampaikan isinya apa adanya.\n" +
  "3. Pertanyaan \"ada berapa\" dijawab dengan `total`, bukan dengan menghitung baris yang kamu terima.\n" +
  "4. Jawab dalam bahasa Indonesia, ringkas.";

try {
  // ============================================================
  console.log("\n=== 1. Ukuran prompt & batas context ===");
  // ============================================================
  const besar = JSON.stringify(skema).length + SISTEM.length;
  console.log(`  skema ${JSON.stringify(skema).length} huruf + instruksi ${SISTEM.length} = ${besar} (~${Math.round(besar / 3.3)} token)`);

  {
    const h = await tanyaQwen([{ role: "system", content: SISTEM }, { role: "user", content: "halo" }], skema);
    cek("prompt dengan 8 tool diterima", h.ok, h.ok ? `${h.masuk} token masuk, ${h.detik.toFixed(1)} dtk` : `HTTP ${h.status}: ${h.sebab}`);
  }

  {
    // ⚠️ Riwayat panjang itu kasus yang DULU GAGAL BELAKANGAN. Prompt pertama
    // muat, lalu giliran ketiga menabrak batas — dan gejalanya muncul jauh
    // dari sebabnya.
    const riwayat = Array.from({ length: 6 }, (_, i) => [
      { role: "user", content: `Pertanyaan ke-${i + 1} tentang tiket helpdesk dan aset yang saya pegang di kantor.` },
      { role: "assistant", content: `Jawaban ke-${i + 1}. Silakan sebutkan nomor tiketnya supaya saya bisa memeriksanya lebih lanjut untuk Anda.` },
    ]).flat();
    const h = await tanyaQwen(
      [{ role: "system", content: SISTEM }, ...riwayat, { role: "user", content: "aset saya apa saja?" }],
      skema,
    );
    cek("prompt + riwayat 6 giliran diterima", h.ok,
      h.ok ? `${h.masuk} token masuk` : `HTTP ${h.status}: ${h.sebab}`);
  }

  // ============================================================
  console.log("\n=== 2. Pemilihan tool & kesahan argumen ===");
  // ============================================================
  // ⚠️ Argumen diperiksa terhadap SKEMA ZOD TOOL-nya, bukan sekadar "JSON
  // valid". Model kecil sering memulangkan JSON rapi yang isinya tidak cocok
  // — field karangan, tipe salah — dan itu baru meledak waktu tool dijalankan.
  const kasus: { tanya: string; harap: string }[] = [
    { tanya: "Tiket helpdesk saya ada berapa yang masih open?", harap: "asisten_tiket" },
    { tanya: "Aset apa saja yang saya pegang sekarang?", harap: "asisten_aset" },
    { tanya: "Siapa atasan saya dan sejak kapan saya bekerja?", harap: "data_diri" },
    { tanya: "Job scope saya apa saja?", harap: "jobdesk_saya" },
    { tanya: "Bagaimana cara mengajukan cuti?", harap: "cari_sop" },
    { tanya: "SOP apa saja yang ada di perusahaan?", harap: "daftar_sop" },
    { tanya: "Siapa saja yang memegang laptop di departemen saya?", harap: "aset_departemen" },
    { tanya: "Ubah judul tiket T202610091109 jadi 'printer lantai 2 rusak'", harap: "siapkan_ubah_tiket_saya" },
  ];

  let totalMasuk = 0, totalKeluar = 0, totalDetik = 0;
  const benarPilih: string[] = [];
  for (const kk of kasus) {
    const h = await tanyaQwen([{ role: "system", content: SISTEM }, { role: "user", content: kk.tanya }], skema);
    totalMasuk += h.masuk; totalKeluar += h.keluar; totalDetik += h.detik;
    if (!h.ok) { cek(`${kk.harap}`, false, `HTTP ${h.status}: ${h.sebab}`); continue; }

    const p = h.panggil[0];
    const cocok = p?.nama === kk.harap;
    if (cocok) benarPilih.push(kk.harap);

    // Argumen divalidasi ke skema zod tool yang bersangkutan.
    let argSah = true;
    let sebabArg = "";
    if (p) {
      const t = tool.find((x) => x.name === p.nama);
      const hasil = (t?.parameters as z.ZodTypeAny | undefined)?.safeParse(p.argumen);
      argSah = hasil?.success ?? false;
      if (!argSah) sebabArg = JSON.stringify(p.argumen).slice(0, 50);
    }
    cek(`${kk.harap.padEnd(24)} dipilih`, cocok,
      `${p ? p.nama : "TIDAK memanggil tool"} · ${h.detik.toFixed(1)} dtk · ${h.masuk}↓${h.keluar}↑`);
    if (p) cek(`${kk.harap.padEnd(24)} argumennya sah`, argSah, argSah ? JSON.stringify(p.argumen) : `DITOLAK zod: ${sebabArg}`);
  }
  console.log(`\n  rata-rata: ${(totalDetik / kasus.length).toFixed(1)} dtk · ${Math.round(totalMasuk / kasus.length)}↓ ${Math.round(totalKeluar / kasus.length)}↑ token`);

  // ============================================================
  console.log("\n=== 3. Jawaban akhir memakai hasil tool ===");
  // ============================================================
  // Hasil tool SINTETIS — angka yang tidak ada di database mana pun, jadi
  // kalau angka itu muncul di jawaban, pasti datang dari sini.
  {
    const hasilSintetis = JSON.stringify({
      jumlah: 2, total: 7, terpotong: true, milik: "karyawan uji",
      baris: [
        { no_ticket: "T-SINTETIS-0001", subject: "Uji satu", status: "OPEN" },
        { no_ticket: "T-SINTETIS-0002", subject: "Uji dua", status: "OPEN" },
      ],
    });
    const h = await tanyaQwen([
      { role: "system", content: SISTEM },
      { role: "user", content: "Tiket helpdesk saya ada berapa?" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "asisten_tiket", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: hasilSintetis },
    ]);
    cek("menjawab sesudah hasil tool", h.ok, h.ok ? `${h.detik.toFixed(1)} dtk` : `HTTP ${h.status}: ${h.sebab}`);
    if (h.ok) {
      // ⚠️ Aturan 3 di instruksi: "ada berapa" dijawab `total`, bukan jumlah
      // baris yang diterima. Model yang menghitung baris akan menjawab 2.
      cek("memakai `total` (7), bukan jumlah baris (2)", /\b7\b/.test(h.teks), h.teks.slice(0, 90));
      cek("tidak mengarang nomor tiket di luar hasil tool",
        !/T20\d{10}/.test(h.teks), h.teks.slice(0, 90));
    }
  }

  // ============================================================
  console.log("\n=== 4. ⚠️ Tool GAGAL — apakah dia mengarang penggantinya? ===");
  // ============================================================
  // Bentuk kegagalan paling berbahaya, dan yang membuat qwen2.5 7B ditolak:
  // menulis jawaban yang meyakinkan padahal tidak punya data.
  for (const [nama, isi] of [
    ["tool mengembalikan galat", JSON.stringify({ galat: "Koneksi database terputus." })],
    ["tool mengembalikan kosong", JSON.stringify({ jumlah: 0, total: 0, baris: [] })],
  ] as const) {
    const h = await tanyaQwen([
      { role: "system", content: SISTEM },
      { role: "user", content: "Tiket helpdesk saya ada berapa?" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "asisten_tiket", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: isi },
    ]);
    if (!h.ok) { cek(nama, false, `HTTP ${h.status}: ${h.sebab}`); continue; }
    // Angka tiket apa pun selain 0 berarti dia mengarang.
    const mengarang = /\b([1-9]\d*)\s*(tiket|buah|item)/i.test(h.teks) || /T20\d{10}/.test(h.teks);
    cek(`${nama}: TIDAK mengarang data`, !mengarang, h.teks.slice(0, 100));
  }
} finally {
  await poolPerusahaan().end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (gagal > 0) process.exitCode = 1;
}
