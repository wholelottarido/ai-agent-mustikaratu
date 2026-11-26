/**
 * Seberapa lebar rentang ramalan supaya penjualan asli masuk sekitar 80% dari waktu?
 * HANYA MEMBACA, tanpa model bahasa.
 *
 *   npx tsx --env-file=.env.local scripts/ukur-rentang.mts
 *
 * Pengali lebar per jarak dan volume dihitung dari titik potong lama, lalu DIUJI pada titik
 * potong yang lebih baru. Tanpa pemisahan itu, 80% hanya benar di data yang dipakai
 * menghitungnya. Angka yang dipasang di `pilih.ts` dihitung ulang dari semua titik potong.
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { deretSku, bulanTerakhirData } from "@/lib/ramalan/deret";
import { modelYangMungkin, type Model } from "@/lib/ramalan/model";
import {
  BATAS_TIDAK_STABIL, BULAN_BERHENTI, TINGKAT_RENTANG, WAPE_TAK_BERGUNA,
} from "@/lib/ramalan/pilih";
import { volumePenjualan } from "@/lib/ramalan/jarak";

const POTONG_LAMA = [24, 21, 18];
const POTONG_BARU = [15, 12];
const MIN_LATIH = 12;
const MAKS_JENDELA = 4;
const LANGKAH = 3;
const BULAN_UJI = 3;
const JARAK = 12;
const EMBER: [string, number, number][] = [["1-3", 1, 3], ["4-6", 4, 6], ["7-8", 7, 8], ["9-12", 9, 12]];
const TARGET = 0.8;

const keAngka = (b: string) => { const [y, m] = b.split("-").map(Number); return y * 12 + m - 1; };
const lebarDari = (g: number[]) => {
  if (g.length === 0) return null;
  const u = [...g].sort((a, b) => a - b);
  return u[Math.max(0, Math.min(u.length - 1, Math.ceil((TINGKAT_RENTANG / 100) * u.length) - 1))];
};

function pilih(deret: number[]) {
  const n = deret.length;
  let k = 0;
  while (k < MAKS_JENDELA && n - BULAN_UJI - k * LANGKAH >= MIN_LATIH) k++;
  let terbaik: { m: Model; wape: number; galat: number[] } | null = null;
  if (k > 0) {
    const batasLatih = n - BULAN_UJI - (k - 1) * LANGKAH;
    for (const m of modelYangMungkin(n)) {
      if (m.minimal > batasLatih) continue;
      let t = 0, lengkap = true;
      const galat: number[] = [];
      for (let j = 0; j < k; j++) {
        const akhir = n - BULAN_UJI - j * LANGKAH;
        const f = m.ramal(deret.slice(0, akhir), BULAN_UJI);
        if (!f.ok) { lengkap = false; break; }
        for (let d = 0; d < BULAN_UJI; d++) {
          galat.push(Math.abs(f.nilai[d] - deret[akhir + d]));
          t += Math.abs(deret[akhir + d]);
        }
      }
      if (!lengkap || t === 0) continue;
      const wape = (galat.reduce((a, b) => a + b, 0) / t) * 100;
      if (wape < WAPE_TAK_BERGUNA && (!terbaik || wape < terbaik.wape)) terbaik = { m, wape, galat };
    }
  }
  if (!terbaik || terbaik.wape > BATAS_TIDAK_STABIL) return null;
  const f = terbaik.m.ramal(deret, JARAK);
  const lebar = lebarDari(terbaik.galat);
  return f.ok && lebar !== null ? { nilai: f.nilai, lebar } : null;
}

type Titik = { potong: number; vol: string; ember: string; nilai: number; lebar: number; aktual: number };
const titikan: Titik[] = [];

const db = poolPerusahaan();
const akhir = keAngka((await bulanTerakhirData())!);
const { rows } = await db.query<{ sku_code: string }>(
  `SELECT sku_code FROM ai_forecast_sales_monthly WHERE source='ba_sales' GROUP BY 1 HAVING count(*) >= 24`);
let selesai = 0;
const mulai = Date.now();
for (const { sku_code: sku } of rows) {
  if (++selesai % 50 === 0) console.log(`  ${selesai}/${rows.length} (${Math.round((Date.now() - mulai) / 1000)} dtk)`);
  const h = await deretSku(sku);
  if (!h.ok) continue;
  const awal = keAngka(h.deret.bulan[0]);
  const qty = h.deret.qty;
  for (const potong of [...POTONG_LAMA, ...POTONG_BARU]) {
    const titik = akhir - potong;
    const i = titik - awal;
    if (i < MIN_LATIH - 1 || i >= qty.length) continue;
    const latih = qty.slice(0, i + 1);
    let jual = -1;
    for (let j = i; j >= 0; j--) if (latih[j] > 0) { jual = j; break; }
    if (jual < 0 || i - jual >= BULAN_BERHENTI) continue;
    const r = pilih(latih);
    if (!r) continue;
    const vol = volumePenjualan(latih);
    for (const [e, a, b] of EMBER) {
      for (let d = a; d <= b; d++) {
        titikan.push({ potong, vol, ember: e, nilai: r.nilai[d - 1], lebar: r.lebar, aktual: qty[i + d] ?? 0 });
      }
    }
  }
}

/** Pengali terkecil yang membuat `TARGET` titik masuk rentang. */
function pengali(t: Titik[]) {
  const rasio = t.filter((x) => x.lebar > 0).map((x) => Math.abs(x.aktual - x.nilai) / x.lebar).sort((a, b) => a - b);
  return rasio.length === 0 ? 1 : rasio[Math.min(rasio.length - 1, Math.ceil(TARGET * rasio.length) - 1)];
}
const masuk = (t: Titik[], k: number) => {
  const ber = t.filter((x) => x.lebar > 0);
  const n = ber.filter((x) => x.aktual >= Math.max(0, x.nilai - k * x.lebar) && x.aktual <= x.nilai + k * x.lebar).length;
  return { persen: ber.length ? (n / ber.length) * 100 : NaN, n: ber.length };
};
const lama = titikan.filter((x) => POTONG_LAMA.includes(x.potong));
const baru = titikan.filter((x) => POTONG_BARU.includes(x.potong));

console.log(`\ntitik: ${lama.length} untuk menghitung, ${baru.length} untuk menguji`);
console.log("DIUJI PADA PERIODE BARU: masuk rentang sekarang lawan sesudah dilebarkan");
for (const v of ["laris", "sedang", "kecil"]) {
  for (const [e] of EMBER) {
    const pilihan = (t: Titik[]) => t.filter((x) => x.vol === v && x.ember === e);
    const k = pengali(pilihan(lama));
    const a = masuk(pilihan(baru), 1), b = masuk(pilihan(baru), k);
    console.log(`  ${v.padEnd(7)} ${e.padEnd(5)} pengali ${k.toFixed(2).padStart(5)}  sekarang ${a.persen.toFixed(1).padStart(5)}%  sesudah ${b.persen.toFixed(1).padStart(5)}%  n=${b.n}`);
  }
}
for (const p of POTONG_BARU) {
  let dalam = 0, semua = 0, dalamSkrg = 0;
  for (const v of ["laris", "sedang", "kecil"]) for (const [e] of EMBER) {
    const pilihan = (t: Titik[]) => t.filter((x) => x.vol === v && x.ember === e);
    const k = pengali(pilihan(lama));
    const uji = pilihan(baru).filter((x) => x.potong === p);
    const hit = masuk(uji, k);
    dalam += (hit.persen / 100) * hit.n; semua += hit.n;
    dalamSkrg += (masuk(uji, 1).persen / 100) * hit.n;
  }
  console.log(`  potong ${p}: sekarang ${((dalamSkrg / semua) * 100).toFixed(1)}%  sesudah ${((dalam / semua) * 100).toFixed(1)}%`);
}
console.log("\nPENGALI DARI SEMUA TITIK (untuk dipasang)");
for (const v of ["laris", "sedang", "kecil"]) {
  console.log(`  ${v}: ${EMBER.map(([e]) => `${e}=${pengali(titikan.filter((x) => x.vol === v && x.ember === e)).toFixed(2)}`).join("  ")}`);
}
console.log(`selesai ${Math.round((Date.now() - mulai) / 1000)} dtk`);
await db.end();
process.stdout.write("", () => process.exit());
