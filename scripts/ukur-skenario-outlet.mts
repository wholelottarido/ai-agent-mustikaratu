/**
 * Evaluates whether changes in selling outlets explain forecast underestimation.
 * Read-only analysis of the existing Jul-Sep 2026 report and trx_ba_sales.
 * Outlet-adjusted baseline uses actual test-period outlet counts and is an
 * explanatory oracle, not a forecast available at prediction time.
 */
import { readFile } from "node:fs/promises";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import type { BerkasRapor, ProdukRapor } from "@/lib/ramalan/rapor";

type Jendela = { awal: string; akhir: string; sebelum: string };
type AngkaDb = { sku: string; qtyDasar: string; outletDasar: number; outletSebelum: number; qtyUji: string; outletUji: number };
type Baris = { p: ProdukRapor; growth: number | null; dasar: number; outletDasar: number; outletSebelum: number; outletUji: number; aktual: number };
const db = poolPerusahaan();
const jendela: Record<string, Jendela> = {
  sekarang: { awal: "2026-02-01", akhir: "2026-05-01", sebelum: "2025-11-01" }, // titik potong April
  dekat: { awal: "2026-04-01", akhir: "2026-07-01", sebelum: "2026-01-01" }, // titik potong Juni
};
const jendelaUji: Jendela = { awal: "2026-07-01", akhir: "2026-10-01" };
try {
  for (const jenis of ["sekarang", "dekat"] as const) {
    const rapor = JSON.parse(await readFile(`data/rapor-ramalan-${jenis}.json`, "utf8")) as BerkasRapor;
    if (rapor.bulanDiuji.join() !== "2026-07,2026-08,2026-09") throw new Error(`${jenis}: periode rapor bukan Jul-Sep 2026`);
    const daftar = rapor.produk;
    const { awal, akhir, sebelum } = jendela[jenis];
    const { rows } = await db.query<AngkaDb>(
      `SELECT item_code AS sku,
              coalesce(sum(qty) FILTER (WHERE trx_date >= $2::date AND trx_date < $3::date), 0)::text AS "qtyDasar",
              count(DISTINCT id_customer) FILTER (WHERE trx_date >= $2::date AND trx_date < $3::date AND qty > 0 AND id_customer IS NOT NULL)::int AS "outletDasar",
              count(DISTINCT id_customer) FILTER (WHERE trx_date >= $6::date AND trx_date < $2::date AND qty > 0 AND id_customer IS NOT NULL)::int AS "outletSebelum",
              coalesce(sum(qty) FILTER (WHERE trx_date >= $4::date AND trx_date < $5::date), 0)::text AS "qtyUji",
              count(DISTINCT id_customer) FILTER (WHERE trx_date >= $4::date AND trx_date < $5::date AND qty > 0 AND id_customer IS NOT NULL)::int AS "outletUji"
         FROM trx_ba_sales
        WHERE item_code = ANY($1::text[]) AND trx_date >= $6::date AND trx_date < $5::date
        GROUP BY item_code`,
      [daftar.map((p) => p.sku), awal, akhir, jendelaUji.awal, jendelaUji.akhir, sebelum],
    );
    const bySku = new Map(rows.map((r) => [r.sku, r]));
    const data: Baris[] = daftar.map((p) => {
      const d = bySku.get(p.sku);
      const outletDasar = d?.outletDasar ?? 0;
      const outletUji = d?.outletUji ?? 0;
      return {
        p,
        growth: outletDasar > 0 ? (outletUji - outletDasar) / outletDasar : null,
        dasar: Number(d?.qtyDasar ?? 0), outletDasar, outletSebelum: d?.outletSebelum ?? 0, outletUji,
        aktual: p.unit.aktual.reduce((a, b) => a + b, 0),
      };
    });
    console.log(`\n=== ${jenis}: data sampai ${rapor.dataSampai}, diuji Jul-Sep 2026 (${daftar.length} SKU) ===`);
    const total = { ramal: 0, aktual: 0, outletDasar: 0, outletUji: 0, dasar: 0, ramalAbs: 0, naiveAbs: 0, adjustedAbs: 0, actualSql: 0 };
    for (const x of data) {
      total.ramal += x.p.unit.ramalan.reduce((a, b) => a + b, 0);
      total.aktual += x.aktual;
      total.ramalAbs += x.p.unit.ramalan.reduce((a, b, i) => a + Math.abs(b - x.p.unit.aktual[i]), 0);
      total.naiveAbs += x.p.unit.aktual.reduce((a, b) => a + Math.abs(x.p.unit.ulangBulanTerakhir - b), 0);
      const adj = x.outletDasar > 0 ? (x.dasar / 3) * (x.outletUji / x.outletDasar) : 0;
      total.adjustedAbs += x.p.unit.aktual.reduce((a, b) => a + Math.abs(adj - b), 0);
      total.outletDasar += x.outletDasar;
      total.outletUji += x.outletUji;
      total.dasar += x.dasar;
      total.actualSql += Number(bySku.get(x.p.sku)?.qtyUji ?? 0);
    }
    console.log(JSON.stringify({
      group: "all",
      sku: data.length,
      forecastWape: +(100 * total.ramalAbs / total.aktual).toFixed(1),
      repeatLastWape: +(100 * total.naiveAbs / total.aktual).toFixed(1),
      outletAdjustedBaselineWapeOracle: +(100 * total.adjustedAbs / total.aktual).toFixed(1),
      forecastBiasPct: +(100 * (total.ramal - total.aktual) / total.aktual).toFixed(1),
      baselineOutletsSumPerSku: total.outletDasar,
      testOutletsSumPerSku: total.outletUji,
      outletCoverageChangeRatioOfSums: +(total.outletUji / total.outletDasar).toFixed(3),
      baselineSales: total.dasar,
      testActualFromReport: total.aktual,
      testActualFromTransactions: total.actualSql,
      transactionMatchPct: +(100 * (1 - Math.abs(total.actualSql - total.aktual) / total.aktual)).toFixed(2),
    }));
    const scenario = data.filter((x) => x.outletSebelum > 0 && x.outletDasar > 0);
    let scenarioActual = 0, scenarioModelAbs = 0, scenarioGrowthAbs = 0, scenarioModelUnits = 0, scenarioUnits = 0;
    let outletsGrowing = 0, outletsShrinking = 0;
    for (const x of scenario) {
      const factor = x.outletDasar / x.outletSebelum;
      const forecast = x.p.unit.ramalan;
      const adjusted = forecast.map((v) => v * factor);
      scenarioActual += x.aktual;
      scenarioModelUnits += forecast.reduce((a, b) => a + b, 0);
      scenarioUnits += adjusted.reduce((a, b) => a + b, 0);
      scenarioModelAbs += forecast.reduce((a, b, i) => a + Math.abs(b - x.p.unit.aktual[i]), 0);
      scenarioGrowthAbs += adjusted.reduce((a, b, i) => a + Math.abs(b - x.p.unit.aktual[i]), 0);
      if (factor > 1.1) outletsGrowing++;
      if (factor < 0.9) outletsShrinking++;
    }
    console.log(JSON.stringify({
      group: "outlet-growth scenario from history",
      skuWithCountsInBothPrecutoffWindows: scenario.length,
      factor: "scale each SKU's forecast by outlets in latest 3 months / outlets in prior 3 months",
      growingSkuOver10Pct: outletsGrowing,
      shrinkingSkuOver10Pct: outletsShrinking,
      unadjustedForecastWapeSameSkuSet: +(100 * scenarioModelAbs / scenarioActual).toFixed(1),
      outletTrendScenarioWape: +(100 * scenarioGrowthAbs / scenarioActual).toFixed(1),
      unadjustedForecastBiasPct: +(100 * (scenarioModelUnits - scenarioActual) / scenarioActual).toFixed(1),
      outletTrendScenarioBiasPct: +(100 * (scenarioUnits - scenarioActual) / scenarioActual).toFixed(1),
      note: "Uses outlet trend known by forecast cutoff. Retrospective only; assumes recent outlet growth persists and is not validated for deployment.",
    }));
    const buckets: [string, (x: Baris) => boolean][] = [
      ["outlets down >10%", (x) => x.growth !== null && x.growth < -0.1],
      ["outlets stable +/-10%", (x) => x.growth !== null && x.growth >= -0.1 && x.growth <= 0.1],
      ["outlets up >10%", (x) => x.growth !== null && x.growth > 0.1],
      ["no baseline outlets", (x) => x.growth === null],
    ];
    for (const [label, inBucket] of buckets) {
      const group = data.filter(inBucket);
      if (!group.length) continue;
      let a = 0, forecastError = 0, naiveError = 0, adjustedError = 0, f = 0, growthNet = 0, positiveUnder = 0;
      for (const x of group) {
        a += x.aktual;
        f += x.p.unit.ramalan.reduce((sum, v) => sum + v, 0);
        forecastError += x.p.unit.ramalan.reduce((sum, v, i) => sum + Math.abs(v - x.p.unit.aktual[i]), 0);
        naiveError += x.p.unit.aktual.reduce((sum, v) => sum + Math.abs(x.p.unit.ulangBulanTerakhir - v), 0);
        const adj = x.outletDasar > 0 ? (x.dasar / 3) * (x.outletUji / x.outletDasar) : 0;
        adjustedError += x.p.unit.aktual.reduce((sum, v) => sum + Math.abs(adj - v), 0);
        positiveUnder += x.p.unit.aktual.reduce((sum, v, i) => sum + Math.max(v - x.p.unit.ramalan[i], 0), 0);
        if (x.growth !== null) growthNet += x.growth;
      }
      console.log(JSON.stringify({
        group: label, sku: group.length,
        meanSkuOutletGrowthPct: +(100 * growthNet / Math.max(1, group.filter((x) => x.growth !== null).length)).toFixed(1),
        forecastWape: a ? +(100 * forecastError / a).toFixed(1) : null,
        repeatLastWape: a ? +(100 * naiveError / a).toFixed(1) : null,
        outletAdjustedBaselineWapeOracle: a ? +(100 * adjustedError / a).toFixed(1) : null,
        forecastBiasPct: a ? +(100 * (f - a) / a).toFixed(1) : null,
        shareOfActualInUnderforecastErrorsPct: a ? +(100 * positiveUnder / a).toFixed(1) : null,
        actualUnits: a,
      }));
    }
  }
} finally {
  await db.end();
}
