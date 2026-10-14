/**
 * Uji beban: berapa lama model menjawab kalau banyak orang bertanya bersamaan.
 *
 *   npm run uji:beban                    # 10, 20, 30 pengguna, model server
 *   npm run uji:beban -- 5,10 <model>    # tingkat & model sendiri
 *
 * ⚠️ LEWAT AGENT ASLI, bukan langsung ke model.
 * Yang diukur pengalaman pengguna sebenarnya: instruksi penuh, panggilan tool,
 * query database, sampai jawaban jadi. Mengukur langsung ke model memberi
 * angka yang terlalu bagus -- itu bukan yang dirasakan user.
 *
 * ⚠️ MENGIRIM BEBAN NYATA ke server. 10+20+30 = 60 permintaan.
 *
 * Hasilnya ditulis ke `docs/uji-beban/hasil.json` untuk dibuat grafik.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ambilAgent, ambilDepartemen, KUNCI_MODEL } from "../voltagent/index.ts";

const TINGKAT = (process.argv[2] ?? "10,20,30").split(",").map(Number);
const MODEL = process.argv[3] ?? "llama.cpp/gemma-4-12b-it-q8";
const PERTANYAAN = "berapa omzet bulan agustus?";
const BENAR = "457383190";

const dep = ambilDepartemen("marketing")!;
const agent = ambilAgent(dep, "staf");

type Hasil = { detik: number; benar: boolean; galat: string | null };

async function satuPermintaan(): Promise<Hasil> {
  const t0 = Date.now();
  try {
    const h = await agent.streamText(
      [{ id: `u${Math.random()}`, role: "user" as const, parts: [{ type: "text" as const, text: PERTANYAAN }] }],
      { context: { [KUNCI_MODEL]: MODEL } },
    );
    let teks = "";
    for await (const b of h.textStream) teks += b;
    return {
      detik: (Date.now() - t0) / 1000,
      benar: teks.replace(/[.,\s]/g, "").includes(BENAR),
      galat: null,
    };
  } catch (e) {
    return {
      detik: (Date.now() - t0) / 1000,
      benar: false,
      galat: (e instanceof Error ? e.message : String(e)).slice(0, 120),
    };
  }
}

/** Persentil dari daftar yang SUDAH diurutkan. */
function persentil(urut: number[], p: number): number {
  if (urut.length === 0) return 0;
  const i = Math.min(urut.length - 1, Math.floor((p / 100) * urut.length));
  return urut[i];
}

console.log(`Model      : ${MODEL}`);
console.log(`Pertanyaan : "${PERTANYAAN}"`);
console.log(`Tingkat    : ${TINGKAT.join(", ")} pengguna bersamaan\n`);

// Pemanasan: permintaan pertama menanggung waktu muat model, dan itu bukan
// yang mau diukur. Tanpa ini, tingkat pertama selalu terlihat paling lambat.
process.stdout.write("pemanasan... ");
const panas = await satuPermintaan();
console.log(`${panas.detik.toFixed(1)} dtk${panas.galat ? ` (${panas.galat})` : ""}\n`);

const semua: {
  pengguna: number;
  totalDetik: number;
  min: number;
  median: number;
  p95: number;
  maks: number;
  berhasil: number;
  benar: number;
  galat: string[];
}[] = [];

for (const n of TINGKAT) {
  process.stdout.write(`${String(n).padStart(2)} pengguna bersamaan... `);
  const mulai = Date.now();

  // Semua dilepas BERSAMAAN, bukan berurutan -- itu inti ujinya.
  const hasil = await Promise.all(Array.from({ length: n }, () => satuPermintaan()));
  const totalDetik = (Date.now() - mulai) / 1000;

  const sukses = hasil.filter((h) => h.galat === null);
  const urut = sukses.map((h) => h.detik).sort((a, b) => a - b);
  const galat = [...new Set(hasil.filter((h) => h.galat).map((h) => h.galat!))];

  const baris = {
    pengguna: n,
    totalDetik,
    min: urut[0] ?? 0,
    median: persentil(urut, 50),
    p95: persentil(urut, 95),
    maks: urut[urut.length - 1] ?? 0,
    berhasil: sukses.length,
    benar: hasil.filter((h) => h.benar).length,
    galat,
  };
  semua.push(baris);

  console.log(
    `selesai ${totalDetik.toFixed(1)} dtk | ` +
      `per orang: tercepat ${baris.min.toFixed(1)} / tengah ${baris.median.toFixed(1)} / ` +
      `p95 ${baris.p95.toFixed(1)} / terlama ${baris.maks.toFixed(1)} dtk | ` +
      `berhasil ${baris.berhasil}/${n}, benar ${baris.benar}/${n}`,
  );
  if (galat.length) console.log(`     galat: ${galat.join(" | ")}`);
}

const folder = join(process.cwd(), "docs", "uji-beban");
mkdirSync(folder, { recursive: true });
writeFileSync(
  join(folder, "hasil.json"),
  JSON.stringify({ model: MODEL, pertanyaan: PERTANYAAN, waktu: new Date().toISOString(), tingkat: semua }, null, 2),
);
console.log(`\nHasil ditulis ke docs/uji-beban/hasil.json`);
process.exit(0);
