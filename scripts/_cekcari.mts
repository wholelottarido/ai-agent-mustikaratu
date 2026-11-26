import { cariSku } from "@/lib/ramalan/deret";
for (const kata of ["MINYAK CEMCEMAN 175 ML RJ", "SHAMPO BAYAM 175 ML RJ"]) {
  console.log(`\ncari: "${kata}"`);
  const c = await cariSku(kata);
  for (const x of c) {
    const persis = x.nama.trim().toUpperCase() === kata.trim().toUpperCase() ? "  <== PERSIS SAMA" : "";
    console.log(`  ${x.sku}  ${x.nama.padEnd(34)} ${String(x.bulan).padStart(3)} bln  ${persis}`);
  }
  console.log(`  -> yang DIPAKAI alat: ${c[0]?.sku} (${c[0]?.nama})`);
}
process.exit(0);
