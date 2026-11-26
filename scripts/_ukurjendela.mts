/**
 * Sekali pakai: berapa jendela backtest yang membuat pilihan model STABIL?
 *
 * Untuk tiap produk, tiap model dilatih sekali per jendela (j = 0..MAKS), lalu
 * galatnya disimpan. Dari galat yang sama itu dihitung WAPE gabungan untuk
 * K jendela mana pun — jadi AutoARIMA cuma dilatih sekali per jendela, bukan
 * sekali per nilai K.
 *
 * Ukurannya: pemenang dengan jendela j=0..K-1 vs pemenang dengan jendela
 * j=1..K. Data yang sama, titik penilaiannya digeser 3 bulan. Kalau
 * pemenangnya berganti, pilihan modelnya ditentukan jendela, bukan datanya.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku } from "@/lib/ramalan/deret";
import { BULAN_UJI, WAPE_TAK_BERGUNA } from "@/lib/ramalan/pilih";
import { modelYangMungkin } from "@/lib/ramalan/model";

const MAKS = 5;
const BATAS = Number(process.argv[2] ?? 60);

const db = poolPerusahaan();
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales'
    GROUP BY sku_code HAVING count(*) >= 40 ORDER BY sum(qty) DESC LIMIT $1`,
  [BATAS],
);

type Jendela = { galat: number; asli: number; nol: boolean } | null;

/** WAPE gabungan untuk jendela ke-`dari` sampai `dari+k-1`. `null` = tak terukur. */
function gabung(j: Jendela[], dari: number, k: number) {
  let galat = 0;
  let asli = 0;
  let nol = true;
  for (let i = dari; i < dari + k; i++) {
    const w = j[i];
    if (!w) return null;
    galat += w.galat;
    asli += w.asli;
    if (!w.nol) nol = false;
  }
  if (asli === 0) return null;
  return { wape: (galat / asli) * 100, nol };
}

const setuju: Record<number, number> = {};
const total: Record<number, number> = {};
const pemenang: Record<number, Record<string, number>> = {};
for (let k = 1; k <= MAKS; k++) { setuju[k] = 0; total[k] = 0; pemenang[k] = {}; }
let n = 0;

for (const r of rows) {
  const h = await deretSku(r.sku_code);
  if (!h.ok) continue;
  const d = h.deret.qty;
  if (d.length < (MAKS + 1) * BULAN_UJI + 26) continue;
  n++;

  const calon = modelYangMungkin(d.length);
  const perModel = new Map<string, Jendela[]>();
  for (const m of calon) {
    const j: Jendela[] = [];
    for (let i = 0; i <= MAKS; i++) {
      const akhirLatih = d.length - (i + 1) * BULAN_UJI;
      const latih = d.slice(0, akhirLatih);
      const asli = d.slice(akhirLatih, akhirLatih + BULAN_UJI);
      if (latih.length < m.minimal) { j.push(null); continue; }
      const u = m.ramal(latih, BULAN_UJI);
      if (!u.ok) { j.push(null); continue; }
      j.push({
        galat: asli.reduce((t, a, x) => t + Math.abs((u.nilai[x] ?? 0) - a), 0),
        asli: asli.reduce((t, a) => t + Math.abs(a), 0),
        nol: u.nilai.every((v) => v === 0),
      });
    }
    perModel.set(m.kode, j);
  }

  /** Pemenang menurut aturan yang sama dengan `pilihModel()`. */
  const menang = (dari: number, k: number): string | null => {
    let terbaik: { kode: string; wape: number } | null = null;
    for (const [kode, j] of perModel) {
      const g = gabung(j, dari, k);
      if (!g) continue;
      if (g.wape >= WAPE_TAK_BERGUNA && !g.nol) continue;
      if (!terbaik || g.wape < terbaik.wape) terbaik = { kode, wape: g.wape };
    }
    return terbaik?.kode ?? null;
  };

  for (let k = 1; k <= MAKS; k++) {
    const a = menang(0, k);
    const b = menang(1, k);
    if (a === null || b === null) continue;
    total[k]++;
    if (a === b) setuju[k]++;
    pemenang[k][a] = (pemenang[k][a] ?? 0) + 1;
  }
  if (n % 10 === 0) console.log(`  ...${n}`);
}

console.log(`\n=== ${n} produk (>= ${(MAKS + 1) * BULAN_UJI + 26} bulan), satuan unit ===`);
console.log("K  = jumlah jendela backtest, tiap jendela 3 bulan");
console.log("sama = pemenangnya TETAP waktu seluruh penilaian digeser 3 bulan\n");
for (let k = 1; k <= MAKS; k++) {
  const persen = total[k] ? Math.round((setuju[k] / total[k]) * 100) : 0;
  console.log(
    `K=${k} (${k * BULAN_UJI} bulan uji)  sama ${String(setuju[k]).padStart(3)}/${total[k]}  ${String(persen).padStart(3)}%   ` +
      `pemenang: ${Object.entries(pemenang[k]).sort((a, b) => b[1] - a[1]).map(([x, y]) => `${x} ${y}`).join(", ")}`,
  );
}
await db.end();
