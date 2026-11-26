import { muatKonfig, lupakanKonfig } from "@/lib/ai-konfig";
import { buatToolDariKonfig } from "@/voltagent/tool-konfigurasi";
import { aksesUntukEmployee } from "@/lib/akses-aplikasi";
import { poolPerusahaan } from "@/lib/db-perusahaan";

lupakanKonfig();
const k = await muatKonfig();

const mkt = k.agent.find((a) => a.kode === "agent-marketing");
console.log(`agent-marketing: ${mkt ? `${mkt.tool.length} tool terdaftar` : "TIDAK ADA"}`);
const baris = mkt?.tool.find((t) => t.kode === "ramal_penjualan");
console.log(`baris ramal_penjualan di agent: ${baris ? `ADA (jenis ${baris.jenis}, penangan ${baris.penangan})` : "TIDAK ADA"}`);

const salah = k.masalah.find((m) => m.tool === "ramal_penjualan");
console.log(`ditolak pemeriksa? ${salah ? "YA — " + salah.sebab : "tidak"}`);

// Dirakit untuk sesi nyata — ini yang menentukan model memegangnya atau tidak.
const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
    WHERE lower(u.username) = 'ridho@mustika-ratu.co.id' LIMIT 1`);
const akses = await aksesUntukEmployee(rows[0].id_employee);
if (mkt && akses) {
  const { tool, dilewati } = buatToolDariKonfig(mkt.tool, akses.sesi);
  const ada = tool.find((t) => t.name === "ramal_penjualan");
  console.log(`\nDIRAKIT untuk sesi nyata: ${ada ? "YA — model memegangnya" : "TIDAK"}`);
  const lewat = dilewati.find((d) => d.kode === "ramal_penjualan");
  if (lewat) console.log(`  dilewati: ${lewat.sebab}`);
}
process.exitCode = 0;
await poolPerusahaan().end();
