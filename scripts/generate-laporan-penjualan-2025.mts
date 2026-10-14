import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";

type Baris = { bulan: string; kode_produk: string; produk: string; kategori: string; qty: string; harga_rata: string; omzet: string };
type Ringkasan = { bulan: string; qty: string; omzet: string; produk: string };

const c = new Client({
  host: process.env.DEMO_PG_HOST, port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE, user: process.env.DEMO_PG_USER, password: process.env.DEMO_PG_PASSWORD,
  statement_timeout: 120_000,
});
await c.connect();
const detail = (await c.query<Baris>(`
  SELECT to_char(tanggal, 'YYYY-MM') AS bulan, kode_produk, produk, kategori,
         SUM(qty)::bigint AS qty,
         ROUND(SUM(nilai) / NULLIF(SUM(qty), 0), 2) AS harga_rata,
         ROUND(SUM(nilai), 2) AS omzet
    FROM v_asisten_penjualan
   WHERE tanggal >= DATE '2025-01-01' AND tanggal < DATE '2026-01-01'
   GROUP BY to_char(tanggal, 'YYYY-MM'), kode_produk, produk, kategori
   ORDER BY bulan, SUM(nilai) DESC`)).rows;
const ringkasan = (await c.query<Ringkasan>(`
  SELECT to_char(tanggal, 'YYYY-MM') AS bulan, SUM(qty)::bigint AS qty,
         ROUND(SUM(nilai), 2) AS omzet, COUNT(DISTINCT kode_produk)::bigint AS produk
    FROM v_asisten_penjualan
   WHERE tanggal >= DATE '2025-01-01' AND tanggal < DATE '2026-01-01'
   GROUP BY to_char(tanggal, 'YYYY-MM') ORDER BY bulan`)).rows;
await c.end();
if (!detail.length) throw new Error("Tidak ada data penjualan pada 2025.");

const pdf = await PDFDocument.create();
const regular = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const halamanLebar = 842;
const halamanTinggi = 595;
const perHalaman = 75;
const jumlahDetail = Math.ceil(detail.length / perHalaman);
const totalHalaman = 1 + 1 + jumlahDetail;
const uang = (n: string) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
const bulan = (x: string) => new Date(`${x}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
const teks = (page: PDFPage, value: string | null | undefined, x: number, y: number, size = 7, font = regular) => page.drawText(String(value ?? "").slice(0, 72), { x, y, size, font, color: rgb(0.12, 0.16, 0.22) });
const footer = (page: PDFPage, nomor: number) => {
  page.drawLine({ start: { x: 36, y: 25 }, end: { x: 806, y: 25 }, thickness: 0.5, color: rgb(0.75, 0.78, 0.82) });
  teks(page, `Laporan penjualan 2025 · Sumber: v_asisten_penjualan · Halaman ${nomor}/${totalHalaman}`, 36, 13, 6);
};

// Sampul
{
  const p = pdf.addPage([halamanLebar, halamanTinggi]);
  p.drawRectangle({ x: 0, y: 0, width: halamanLebar, height: halamanTinggi, color: rgb(0.04, 0.18, 0.28) });
  p.drawRectangle({ x: 54, y: 54, width: 734, height: 487, borderColor: rgb(0.35, 0.75, 0.78), borderWidth: 2 });
  p.drawText("LAPORAN PENJUALAN", { x: 86, y: 392, size: 30, font: bold, color: rgb(0.82, 0.95, 0.94) });
  p.drawText("Januari - Desember 2025", { x: 88, y: 348, size: 22, font: regular, color: rgb(1, 1, 1) });
  p.drawText("Rekap produk, harga, kuantitas, dan omzet", { x: 90, y: 298, size: 13, font: regular, color: rgb(0.78, 0.86, 0.9) });
  p.drawText(`${detail.length.toLocaleString("id-ID")} baris agregat produk-bulan · ${ringkasan.length} bulan`, { x: 90, y: 245, size: 11, font: regular, color: rgb(0.78, 0.86, 0.9) });
  footer(p, 1);
}

// Ringkasan bulanan
{
  const p = pdf.addPage([halamanLebar, halamanTinggi]);
  teks(p, "Ringkasan bulanan", 36, 548, 18, bold);
  teks(p, "Nilai mengikuti kolom nilai pada v_asisten_penjualan; harga rata-rata dihitung dari omzet dibagi qty.", 36, 527, 8);
  let y = 490;
  teks(p, "BULAN", 42, y, 8, bold); teks(p, "QTY", 230, y, 8, bold); teks(p, "PRODUK", 330, y, 8, bold); teks(p, "OMZET", 455, y, 8, bold);
  y -= 20;
  for (const r of ringkasan) {
    teks(p, bulan(r.bulan), 42, y); teks(p, Number(r.qty).toLocaleString("id-ID"), 230, y); teks(p, Number(r.produk).toLocaleString("id-ID"), 330, y); teks(p, uang(r.omzet), 455, y); y -= 24;
  }
  const totalQty = ringkasan.reduce((n, r) => n + Number(r.qty), 0);
  const totalOmzet = ringkasan.reduce((n, r) => n + Number(r.omzet), 0);
  p.drawLine({ start: { x: 38, y: y + 12 }, end: { x: 760, y: y + 12 }, thickness: 1, color: rgb(0.1, 0.3, 0.4) });
  teks(p, "TOTAL 2025", 42, y - 8, 9, bold); teks(p, totalQty.toLocaleString("id-ID"), 230, y - 8, 9, bold); teks(p, uang(String(totalOmzet)), 455, y - 8, 9, bold);
  footer(p, 2);
}

// Detail produk per bulan, 120 baris per halaman agar semua agregat tercantum.
for (let offset = 0; offset < detail.length; offset += perHalaman) {
  const nomor = 3 + Math.floor(offset / perHalaman);
  const p = pdf.addPage([halamanLebar, halamanTinggi]);
  teks(p, "Detail penjualan produk-bulan", 36, 558, 15, bold);
  teks(p, `Baris ${offset + 1}-${Math.min(offset + perHalaman, detail.length)} dari ${detail.length.toLocaleString("id-ID")}`, 36, 540, 8);
  const headerY = 516;
  teks(p, "BULAN", 36, headerY, 7, bold); teks(p, "KODE", 104, headerY, 7, bold); teks(p, "PRODUK", 166, headerY, 7, bold); teks(p, "KATEGORI", 398, headerY, 7, bold); teks(p, "QTY", 610, headerY, 7, bold); teks(p, "HARGA RATA2", 655, headerY, 7, bold); teks(p, "OMZET", 735, headerY, 7, bold);
  let y = headerY - 13;
  for (const r of detail.slice(offset, offset + perHalaman)) {
    teks(p, r.bulan, 36, y, 6.3); teks(p, r.kode_produk, 104, y, 6.3); teks(p, r.produk, 166, y, 6.3); teks(p, r.kategori, 398, y, 6.3); teks(p, Number(r.qty).toLocaleString("id-ID"), 610, y, 6.3); teks(p, uang(r.harga_rata), 655, y, 6.3); teks(p, uang(r.omzet), 735, y, 6.3); y -= 4.45;
  }
  footer(p, nomor);
}

const lokasi = join(process.cwd(), "data", "laporan-penjualan-2025.pdf");
await mkdir(join(process.cwd(), "data"), { recursive: true });
await writeFile(lokasi, await pdf.save());
console.log(`PDF dibuat: ${lokasi}`);
console.log(`Halaman: ${pdf.getPageCount()} | Agregat: ${detail.length} | Bulan: ${ringkasan.length}`);
