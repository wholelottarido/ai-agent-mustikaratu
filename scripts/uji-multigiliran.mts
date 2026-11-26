/**
 * T2 uji live (24 Nov 2026) — percakapan MULTI-GILIRAN tiket, 10 sesi independen, lewat agent yang SAMA dengan
 * portal (`siapkanAgent` -> `streamText` -> penyaring penjaga). HARNESS UJI: aplikasi tidak diubah.
 *
 *   npx tsx --env-file=.env.local scripts/uji-multigiliran.mts --model mr-ai-gateway-4gpu --folder <dir> [--sesi S01,S05]
 *
 * Balasan pengguna ADAPTIF: pilihan diambil dari tombol klarifikasi (jalur.klarifikasi) atau daftar yang benar-benar
 * ditampilkan agent — tidak pernah dikarang skrip. Agent hanya menyusun RANCANGAN; tombol Simpan tidak pernah
 * ditekan. Jumlah tiket akun uji sejak awal uji diperiksa: harus 0.
 * Dicatat ke <folder>/multigiliran.jsonl: isi giliran (pertanyaan & jawaban), rancangan (kategori/sub saja),
 * pilihan, alat, ringkasan penjaga. Isinya data uji akun sendiri; folder data/ tidak ikut Git.
 */
import { appendFileSync, mkdirSync } from "node:fs";

const arg = (n: string, b: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : b; };
const MODEL = arg("model", "mr-ai-gateway-4gpu");
const DIR = arg("folder", `data/agent-workflow-latency/multigiliran-${Date.now()}`);
const HANYA = arg("sesi", "").split(",").filter(Boolean);
const AKUN = "ridho@mustika-ratu.co.id";
mkdirSync(DIR, { recursive: true });

const { siapkanAgent } = await import("../voltagent/jalur-agent.ts");
const { jagaPotongan } = await import("../lib/alur/jaga-stream.ts");
const { KUNCI_MODEL, KUNCI_SALURAN } = await import("../voltagent/agents.ts");
const { maksToolGatewayModel, pesanGalatGateway } = await import("../voltagent/models.ts");
const { poolPerusahaan } = await import("../lib/db-perusahaan.ts");
const { teksPilihan } = await import("../lib/cocok-pilihan.ts");
const { klaimTersimpan, pesanInternalAtauKarangan, menawarkan, mintaKlarifikasi } = await import("./lib/evaluator-agent.mts");

const db = poolPerusahaan();
const { rows: [akun] } = await db.query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users WHERE lower(u.username) = $1`, [AKUN]);
const mulaiUji = new Date();
const tiketAkun = async () => (await db.query<{ n: number }>(
  `SELECT count(*)::int n FROM portal_ticket WHERE id_employee = $1 AND created_at >= $2`, [akun.id_employee, mulaiUji])).rows[0].n;

type Pesan = { id: string; role: "user" | "assistant"; parts: { type: "text"; text: string }[] };
type Pilihan = { nama: string; kode?: string };
type Giliran = { kalimat: string; teks: string; galat: string | null; ms: number; rancangan: { kategori?: string; sub?: string }[];
  pilihan: Pilihan[]; alat: string[]; penjaga: Record<string, unknown> | null };

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pilihan yang DITAMPILKAN: tombol klarifikasi lebih dulu, kalau tidak ada dari daftar di teks jawaban. */
function pilihanTampil(teks: string, klar: { pilihan: { kode: string; nama: string }[] }[]): Pilihan[] {
  const k = klar.at(-1);
  if (k?.pilihan.length) return k.pilihan.map((p) => ({ nama: p.nama, kode: p.kode }));
  return [...teks.matchAll(/^\s*(?:[-*•]|\d{1,2}[.)])\s+\**([^\n*:]{2,40}?)\**\s*(?:[:—–-].*)?$/gm)].map((m) => ({ nama: m[1].trim() }));
}

async function sesi(id: string, langkah: (riw: Giliran[]) => string | null, maks = 4) {
  const riwayat: Pesan[] = [], giliran: Giliran[] = [];
  for (let i = 0; i < maks; i++) {
    const kalimat = langkah(giliran);
    if (kalimat === null) break;
    riwayat.push({ id: `u${riwayat.length}`, role: "user", parts: [{ type: "text", text: kalimat }] });
    const mulai = Date.now();
    const jalur = await siapkanAgent(akun.id_employee, maksToolGatewayModel(MODEL));
    if (jalur.jalur !== "konfigurasi") throw new Error(`jalur ${jalur.jalur}: ${jalur.sebab}`);
    let teks = "", galat: string | null = null;
    try {
      const h = await jalur.agent.streamText(riwayat as never, { context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" } });
      type Bagian = { type: string; text?: string; textDelta?: string; error?: unknown };
      const pj = jalur.penjaga();
      const aliran = (pj ? jagaPotongan(h.fullStream as AsyncIterable<Bagian>, pj, "full") : h.fullStream) as AsyncIterable<Bagian>;
      for await (const p of aliran) {
        if (p.type === "text-delta") teks += p.text ?? p.textDelta ?? "";
        if (p.type === "error") galat = pesanGalatGateway(p.error) ?? String((p.error as Error)?.message ?? p.error);
      }
    } catch (e) { galat = pesanGalatGateway(e) ?? (e as Error).message; }
    teks = teks.trim();
    riwayat.push({ id: `a${riwayat.length}`, role: "assistant", parts: [{ type: "text", text: teks || "(kosong)" }] });
    const pj = jalur.penjaga();
    const g: Giliran = { kalimat, teks, galat, ms: Date.now() - mulai,
      rancangan: jalur.rancangan.map((r) => r.jenis === "tiket" ? { kategori: r.draf.kategori.nama, sub: r.draf.subKategori.nama } : {}),
      pilihan: pilihanTampil(teks, jalur.klarifikasi as never), alat: [...jalur.alat],
      penjaga: pj ? (({ idPermintaan: _i, ...k }) => k)(pj.keadaan() as { idPermintaan?: unknown }) : null };
    giliran.push(g);
    console.log(`  [${id} #${i + 1}] ${(g.ms / 1000).toFixed(1)} dtk · rancangan ${g.rancangan.map((r) => `${r.kategori}/${r.sub}`).join(",") || "-"} · pilihan ${g.pilihan.length} · alat ${g.alat.join(",") || "-"}${g.galat ? ` · GALAT ${g.galat.slice(0, 60)}` : ""} | «${kalimat.slice(0, 50)}» → ${teks.replace(/\s+/g, " ").slice(0, 110)}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  return giliran;
}

// ---------------------------------------------------------------- langkah adaptif
const PERMINTAAN = "Buatkan tiket, komputer saya tidak ada akses internet";
/** Ikuti percakapan sampai rancangan terbentuk: tawaran → "ya"; pilihan → jawab sesuai `cara`. */
const ikuti = (pertama: string, cara: "label" | "nomor" | "kode") => (r: Giliran[]): string | null => {
  if (r.length === 0) return pertama;
  const g = r.at(-1)!;
  if (g.galat || g.rancangan.length) return null;
  if (g.pilihan.length >= 2) {
    if (cara === "nomor") return "2";
    const p = g.pilihan[0];
    return cara === "kode" && p.kode ? teksPilihan({ kode: p.kode, nama: p.nama }) : p.nama;
  }
  if (menawarkan(g.teks)) return "ya";
  return null;
};
const pilihanTerakhir = (r: Giliran[]) => [...r].reverse().find((g) => g.pilihan.length >= 2)?.pilihan ?? [];
const subAkhir = (r: Giliran[]) => r.flatMap((g) => g.rancangan).at(-1)?.sub ?? null;
const sama = (a?: string | null, b?: string | null) => !!a && !!b && normal(a) === normal(b);

type Hasil = { lulus: boolean | null; catatan: string };
const SKENARIO: { id: string; judul: string; langkah: (r: Giliran[]) => string | null; nilai: (r: Giliran[]) => Hasil }[] = [
  { id: "S01", judul: "Permintaan tiket tanpa sub-kategori", langkah: (r) => r.length ? null : PERMINTAAN,
    nilai: (r) => {
      const g = r[0], sub = g.rancangan.at(-1)?.sub;
      if (sub) return { lulus: normal(PERMINTAAN).includes(normal(sub)), catatan: `rancangan langsung, sub «${sub}» ${normal(PERMINTAAN).includes(normal(sub)) ? "disebut" : "TIDAK disebut"} pengguna` };
      return { lulus: g.pilihan.length >= 2 || mintaKlarifikasi(g.teks) || menawarkan(g.teks), catatan: `tanpa rancangan; pilihan ${g.pilihan.length}, ${menawarkan(g.teks) ? "tawaran" : mintaKlarifikasi(g.teks) ? "klarifikasi" : "lain"}` };
    } },
  { id: "S02", judul: "Memilih sub-kategori lewat LABEL", langkah: ikuti(PERMINTAAN, "label"),
    nilai: (r) => { const p = pilihanTerakhir(r); if (!p.length) return { lulus: null, catatan: "agent tidak menampilkan pilihan (skenario tidak teruji)" };
      return { lulus: sama(subAkhir(r), p[0].nama), catatan: `dipilih «${p[0].nama}», rancangan sub «${subAkhir(r)}»` }; } },
  { id: "S03", judul: "Memilih lewat NOMOR pilihan", langkah: ikuti(PERMINTAAN, "nomor"),
    nilai: (r) => { const p = pilihanTerakhir(r); if (p.length < 2) return { lulus: null, catatan: "pilihan < 2 (skenario tidak teruji)" };
      return { lulus: sama(subAkhir(r), p[1].nama), catatan: `"2" = «${p[1].nama}», rancangan sub «${subAkhir(r)}»` }; } },
  { id: "S04", judul: "Memilih lewat KODE pilihan (tombol web)", langkah: ikuti(PERMINTAAN, "kode"),
    nilai: (r) => { const p = pilihanTerakhir(r); if (!p.length) return { lulus: null, catatan: "tanpa pilihan (skenario tidak teruji)" };
      if (!p[0].kode) return { lulus: null, catatan: "pilihan tanpa kode tombol (hanya teks) — kode tidak teruji" };
      return { lulus: sama(subAkhir(r), p[0].nama), catatan: `«${teksPilihan({ kode: p[0].kode, nama: p[0].nama })}» → sub «${subAkhir(r)}»` }; } },
  { id: "S05", judul: "\"ya\" sesudah tawaran yang sah", langkah: (r) => r.length === 0 ? "Printer saya bergaris saat mencetak." : r.length === 1 && menawarkan(r[0].teks) ? "ya" : ikuti("", "label")(r),
    nilai: (r) => { if (!menawarkan(r[0].teks)) return { lulus: null, catatan: "giliran 1 tidak menawarkan tiket (skenario tidak teruji)" };
      const g = r[1]; return { lulus: !!g && (g.rancangan.length > 0 || g.pilihan.length >= 2 || mintaKlarifikasi(g.teks)), catatan: `sesudah "ya": rancangan ${g?.rancangan.length ?? 0}, pilihan ${g?.pilihan.length ?? 0}` }; } },
  { id: "S06", judul: "\"ya\" tanpa operasi yang menunggu", langkah: (r) => r.length ? null : "ya",
    nilai: (r) => ({ lulus: r[0].rancangan.length === 0, catatan: `rancangan ${r[0].rancangan.length}; ditolak penjaga: ${JSON.stringify((r[0].penjaga as { ditolak?: unknown })?.ditolak ?? [])}` }) },
  { id: "S07", judul: "Menolak tawaran", langkah: (r) => r.length === 0 ? "Laptop saya tidak bisa menyala." : r.length === 1 && menawarkan(r[0].teks) ? "tidak, terima kasih" : null,
    nilai: (r) => { if (!menawarkan(r[0].teks)) return { lulus: null, catatan: "giliran 1 tidak menawarkan tiket (skenario tidak teruji)" };
      return { lulus: (r[1]?.rancangan.length ?? 0) === 0, catatan: `sesudah menolak: rancangan ${r[1]?.rancangan.length ?? 0}` }; } },
  { id: "S08", judul: "Mengubah pilihan sesudah rancangan", langkah: (r) => {
      const dasar = ikuti(PERMINTAAN, "label")(r);
      if (dasar !== null) return dasar;
      const p = pilihanTerakhir(r);
      return r.at(-1)?.rancangan.length && p.length >= 2 && !r.some((g) => g.kalimat.startsWith("Ganti")) ? `Ganti sub-kategorinya jadi ${p[1].nama}` : null;
    }, nilai: (r) => { const p = pilihanTerakhir(r); const g = r.at(-1)!;
      if (p.length < 2 || !g.kalimat.startsWith("Ganti")) return { lulus: null, catatan: "rancangan pertama atau pilihan kedua tidak tercapai (tidak teruji)" };
      return { lulus: sama(g.rancangan.at(-1)?.sub, p[1].nama) || (g.rancangan.length === 0 && (g.pilihan.length >= 2 || mintaKlarifikasi(g.teks))),
        catatan: `minta ganti ke «${p[1].nama}» → rancangan ${g.rancangan.map((x) => x.sub).join(",") || "-"}` }; } },
  { id: "S09", judul: "Informasi lengkap sejak awal", langkah: (r) => r.length ? null : "Printer di ruangan saya bergaris saat mencetak, tolong buatkan tiket kategori HARDWARE sub-kategori PRINTER.",
    nilai: (r) => ({ lulus: sama(r[0].rancangan.at(-1)?.sub, "PRINTER"), catatan: `rancangan ${r[0].rancangan.map((x) => `${x.kategori}/${x.sub}`).join(",") || "-"} dalam 1 giliran` }) },
  { id: "S10", judul: "Ganti topik di tengah klarifikasi", langkah: (r) => r.length === 0 ? PERMINTAAN
      : r.length === 1 && (r[0].pilihan.length >= 2 || mintaKlarifikasi(r[0].teks) || menawarkan(r[0].teks)) ? "Berapa total penjualan September 2026?" : null,
    nilai: (r) => { if (r.length < 2) return { lulus: null, catatan: "giliran 1 tidak menunggu jawaban (tidak teruji)" };
      return { lulus: r[1].alat.includes("total_penjualan") && r[1].rancangan.length === 0, catatan: `giliran 2: alat ${r[1].alat.join(",") || "-"}, rancangan ${r[1].rancangan.length}` }; } },
];

console.log(`multi-giliran -> ${DIR} · model ${MODEL}`);
const tiketAwal = await tiketAkun();
let lolos = 0, gagal = 0, takTeruji = 0;
for (const s of SKENARIO.filter((x) => !HANYA.length || HANYA.includes(x.id))) {
  console.log(`\n${s.id} — ${s.judul}`);
  const r = await sesi(s.id, s.langkah);
  // Pemeriksaan umum tiap giliran: tanpa galat, tidak kosong, tanpa klaim tersimpan / pesan internal.
  const umum = r.filter((g) => g.galat || !g.teks || klaimTersimpan(g.teks) || pesanInternalAtauKarangan(g.teks))
    .map((g) => g.galat ? "galat" : !g.teks ? "kosong" : klaimTersimpan(g.teks) ? "klaim-tersimpan" : "pesan-internal");
  const h = s.nilai(r);
  const akhir: boolean | null = umum.length ? false : h.lulus;
  akhir === null ? takTeruji++ : akhir ? lolos++ : gagal++;
  console.log(`  => ${akhir === null ? "TIDAK TERUJI" : akhir ? "LULUS" : "GAGAL"} · ${h.catatan}${umum.length ? ` · umum: ${umum.join(",")}` : ""}`);
  appendFileSync(`${DIR}/multigiliran.jsonl`, JSON.stringify({ ts: Date.now(), sesi: s.id, judul: s.judul, hasil: akhir, catatan: h.catatan, umum, giliran: r }) + "\n");
}
const tiket = (await tiketAkun()) - tiketAwal;
console.log(`\n${lolos} lulus, ${gagal} gagal, ${takTeruji} tidak teruji · tiket tersimpan oleh uji: ${tiket} (harus 0)`);
appendFileSync(`${DIR}/multigiliran.jsonl`, JSON.stringify({ ts: Date.now(), ringkasan: { lolos, gagal, tidak_teruji: takTeruji, tiket_tersimpan: tiket } }) + "\n");
await db.end().catch(() => {});
process.exit(gagal || tiket ? 1 : 0);
