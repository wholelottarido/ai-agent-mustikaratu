/**
 * Membandingkan cara memilih model dan cara meramal baru. HANYA MEMBACA, tanpa model bahasa.
 *
 *   npx tsx --env-file=.env.local scripts/ukur-cara-baru.mts lama [terlaris] [lainnya]
 *   npx tsx --env-file=.env.local scripts/ukur-cara-baru.mts baru [terlaris] [lainnya]
 *
 * `lama` = produk yang sudah dipakai `ukur-horizon.mts`. `baru` = produk yang belum pernah
 * dipakai, jadi tidak ikut membentuk ide cara baru. Keputusan memakai hasil `baru`.
 *
 * Tiap skema memilih model hanya dari data sebelum titik potong, lalu dinilai pada penjualan
 * sesudahnya. Dinilai pada jarak 1-3 (data mutakhir) dan 5-7 (keadaan portal sekarang).
 * Yang tertinggal penjualannya sebelum titik potong tidak diramal, sama dengan `ramalkan()`.
 * LightGBM tidak ikut: tabelnya hanya memuat uji 3 bulan.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { modelYangMungkin, type Model } from "@/lib/ramalan/model";
import { BULAN_BERHENTI, WAPE_TAK_BERGUNA, BATAS_TIDAK_STABIL, selisihBulan } from "@/lib/ramalan/pilih";
import { rata3, rata6, ses, holt, musimanTingkat, buatLebaran } from "@/lib/ramalan/model-coba";

const KELOMPOK = process.argv[2] === "baru" ? "baru" : "lama";
const N_ATAS = Number(process.argv[3] ?? 60);
const N_BAWAH = Number(process.argv[4] ?? 40);
const POTONG = [12, 18, 24];
const MIN_LATIH = 12;
const MAKS_JENDELA = 4;
const LANGKAH = 3;
const DEKAT: [number, number] = [1, 3];
const JAUH: [number, number] = [5, 7];

type Ukur = { galat: number; aktual: number; ramal: number; n: number; rata: number; skor: Map<string, number[]> };
const tabel = new Map<string, Ukur>();
function tambah(kunci: string, sku: string, f: number, a: number) {
  const u = tabel.get(kunci) ?? { galat: 0, aktual: 0, ramal: 0, n: 0, rata: 0, skor: new Map() };
  u.galat += Math.abs(f - a); u.aktual += a; u.ramal += f; u.n++;
  const s = u.skor.get(sku) ?? [0, 0];
  s[0] += Math.abs(f - a); s[1] += a;
  u.skor.set(sku, s);
  tabel.set(kunci, u);
}
const pemenang = new Map<string, Record<string, number>>();
const ratakah = new Map<string, [number, number]>();

function mundur(bulan: string, n: number): string {
  const [y, m] = bulan.split("-").map(Number);
  const t = y * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Ramalan satu model pada data sampai `akhir`, disimpan supaya tiap fit hanya sekali. */
function peramal(deret: number[], bulanIdx: (i: number) => string) {
  const simpan = new Map<string, number[] | null>();
  return (m: Model, akhir: number, h: number): number[] | null => {
    const kunci = `${m.kode}|${akhir}|${h}`;
    if (simpan.has(kunci)) return simpan.get(kunci)!;
    const model = m.kode === ("lebaran" as Model["kode"]) ? buatLebaran(bulanIdx(akhir - 1)) : m;
    const r = model.ramal(deret.slice(0, akhir), h);
    const nilai = r.ok ? r.nilai : null;
    simpan.set(kunci, nilai);
    return nilai;
  };
}

/** Memilih model dari data `deret[0..n)` memakai uji pada jarak `[a,b]`. Sama aturannya dengan `pilihModel`. */
function pilih(calon: Model[], ramal: ReturnType<typeof peramal>, deret: number[], n: number, [a, b]: [number, number]) {
  let k = 0;
  while (k < MAKS_JENDELA && n - b - k * LANGKAH >= MIN_LATIH) k++;
  if (k === 0) return { kode: "tanpa-uji", wape: null as number | null };
  const batasLatih = n - b - (k - 1) * LANGKAH;
  let terbaik: { kode: string; m: Model; wape: number } | null = null;
  for (const m of calon) {
    if (m.minimal > batasLatih) continue;
    let g = 0, t = 0, lengkap = true;
    for (let j = 0; j < k && lengkap; j++) {
      const akhir = n - b - j * LANGKAH;
      const f = ramal(m, akhir, b);
      if (!f) { lengkap = false; break; }
      for (let d = a; d <= b; d++) {
        g += Math.abs(f[d - 1] - deret[akhir + d - 1]);
        t += Math.abs(deret[akhir + d - 1]);
      }
    }
    if (!lengkap || t === 0) continue;
    const w = (g / t) * 100;
    if (w >= WAPE_TAK_BERGUNA) continue;
    if (!terbaik || w < terbaik.wape) terbaik = { kode: m.kode, m, wape: w };
  }
  return terbaik ? { kode: terbaik.kode, m: terbaik.m, wape: terbaik.wape } : { kode: "tanpa-uji", wape: null as number | null };
}

const db = poolPerusahaan();
const akhirData = (await bulanTerakhirData())!;
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales'
    GROUP BY sku_code HAVING count(*) >= $1 ORDER BY sum(qty) DESC`, [MIN_LATIH + POTONG[0]]);

// Harus sama dengan pemilihan `ukur-horizon.mts 60 40`.
const langkahLama = Math.floor((rows.length - 60) / 40);
const dipakai = (i: number) => i < 60 || ((i - 60) % langkahLama === 0 && (i - 60) / langkahLama < 40);
const sisa = rows.filter((_, i) => !dipakai(i));
const contoh = KELOMPOK === "lama"
  ? rows.filter((_, i) => dipakai(i))
  : [...sisa.slice(0, N_ATAS), ...sisa.slice(N_ATAS).filter((_, i, a) =>
      i % Math.max(1, Math.floor(a.length / N_BAWAH)) === 0).slice(0, N_BAWAH)];
console.log(`kelompok ${KELOMPOK}: ${contoh.length} dari ${rows.length} produk; data sampai ${akhirData}`);

const BARU: Model[] = [rata3, rata6, ses, holt, musimanTingkat, { ...musimanTingkat, kode: "lebaran" as Model["kode"], nama: "Lebaran" }];
const mulai = Date.now();
let selesai = 0;

for (const { sku_code: sku } of contoh) {
  if (++selesai % 10 === 0) console.log(`  ${selesai}/${contoh.length} (${Math.round((Date.now() - mulai) / 1000)} dtk)`);
  const h = await deretSku(sku);
  if (!h.ok) continue;
  const { bulan, qty } = h.deret;

  for (const potong of POTONG) {
    const titik = mundur(akhirData, potong);
    const idx = bulan.indexOf(titik);
    if (idx < MIN_LATIH - 1) continue;
    const n = idx + 1;
    let terakhirJual = -1;
    for (let i = idx; i >= 0; i--) if (qty[i] > 0) { terakhirJual = i; break; }
    if (terakhirJual < 0 || selisihBulan(bulan[terakhirJual], titik) >= BULAN_BERHENTI) continue;

    const ramal = peramal(qty, (i) => bulan[i]);
    const lama = modelYangMungkin(n);
    const semua = [...lama, ...BARU.filter((m) => n >= m.minimal)];
    const aktual = (d: number) => qty[idx + d] ?? 0;
    const cadangan = (w: { kode: string; wape: number | null; m?: Model }) =>
      w.wape === null || w.wape > BATAS_TIDAK_STABIL ? rata3 : w.m!;

    const skema: [string, Model[], [number, number], [number, number]][] = [
      ["A sekarang", lama, DEKAT, JAUH],
      ["B uji jarak sebenarnya", lama, JAUH, JAUH],
      ["C cara baru, uji lama", semua, DEKAT, JAUH],
      ["D cara baru + uji jarak", semua, JAUH, JAUH],
      ["A sekarang (jarak dekat)", lama, DEKAT, DEKAT],
      ["D cara baru (jarak dekat)", semua, DEKAT, DEKAT],
    ];
    for (const [nama, calon, uji, nilai] of skema) {
      const dipilih = pilih(calon, ramal, qty, n, uji);
      const m = cadangan(dipilih as { kode: string; wape: number | null; m?: Model });
      const f = ramal(m, n, nilai[1]);
      if (!f) continue;
      const hit = pemenang.get(nama) ?? {};
      hit[m.kode] = (hit[m.kode] ?? 0) + 1;
      pemenang.set(nama, hit);
      const bagian = f.slice(nilai[0] - 1, nilai[1]);
      const r = ratakah.get(nama) ?? [0, 0];
      r[0] += new Set(bagian).size === 1 ? 1 : 0; r[1]++;
      ratakah.set(nama, r);
      for (let d = nilai[0]; d <= nilai[1]; d++) {
        tambah(nama, sku, f[d - 1], aktual(d));
        tambah(`${nama}|potong${potong}`, sku, f[d - 1], aktual(d));
      }
    }
    for (const m of [...lama.filter((x) => ["naive", "musiman", "arima"].includes(x.kode)), ...BARU.filter((x) => n >= x.minimal)]) {
      const f = ramal(m, n, 7);
      if (!f) continue;
      for (const [nama, [a, b]] of [["jauh", JAUH], ["dekat", DEKAT]] as const) {
        for (let d = a; d <= b; d++) tambah(`selalu ${m.kode}|${nama}`, sku, f[d - 1], aktual(d));
      }
    }
  }
}

const pct = (x: number) => `${x.toFixed(1)}%`.padStart(7);
const median = (x: number[]) => {
  const s = [...x].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const baris = (k: string) => {
  const u = tabel.get(k);
  if (!u || u.aktual === 0) return "(kosong)";
  const perProduk = [...u.skor.values()].filter(([, a]) => a > 0).map(([g, a]) => (g / a) * 100);
  return `meleset ${pct((u.galat / u.aktual) * 100)}  median ${pct(median(perProduk))}  arah ${pct(((u.ramal - u.aktual) / u.aktual) * 100)}  n=${u.n}`;
};

console.log("\nSKEMA, dinilai pada jarak 5-7");
for (const n of ["A sekarang", "B uji jarak sebenarnya", "C cara baru, uji lama", "D cara baru + uji jarak"]) {
  const r = ratakah.get(n) ?? [0, 1];
  console.log(`  ${n.padEnd(26)} ${baris(n)}  rata ${Math.round((r[0] / r[1]) * 100)}%`);
  for (const p of POTONG) console.log(`    potong ${p}${" ".repeat(14)} ${baris(`${n}|potong${p}`)}`);
  console.log(`    pemenang ${JSON.stringify(pemenang.get(n))}`);
}
console.log("\nSKEMA, dinilai pada jarak 1-3");
for (const n of ["A sekarang (jarak dekat)", "D cara baru (jarak dekat)"]) {
  const r = ratakah.get(n) ?? [0, 1];
  console.log(`  ${n.padEnd(26)} ${baris(n)}  rata ${Math.round((r[0] / r[1]) * 100)}%`);
  console.log(`    pemenang ${JSON.stringify(pemenang.get(n))}`);
}
console.log("\nSATU CARA UNTUK SEMUA");
for (const k of ["naive", "musiman", "arima", "rata3", "rata6", "ses", "holt", "musiman_tingkat", "lebaran"]) {
  console.log(`  ${k.padEnd(16)} jauh  ${baris(`selalu ${k}|jauh`)}`);
  console.log(`  ${" ".repeat(16)} dekat ${baris(`selalu ${k}|dekat`)}`);
}
// Dua skema dibanding per produk: lebih bermakna daripada selisih satu angka gabungan.
const a = tabel.get("A sekarang");
const d = tabel.get("D cara baru + uji jarak");
if (a && d) {
  let lebih = 0, kurang = 0;
  for (const [sku, [gd, ad]] of d.skor) {
    const s = a.skor.get(sku);
    if (!s || ad === 0) continue;
    if (gd < s[0]) lebih++; else if (gd > s[0]) kurang++;
  }
  console.log(`\nD lawan A per produk: D lebih tepat ${lebih}, lebih meleset ${kurang}`);
}
console.log(`selesai ${Math.round((Date.now() - mulai) / 1000)} dtk`);
await db.end();
process.stdout.write("", () => process.exit());
