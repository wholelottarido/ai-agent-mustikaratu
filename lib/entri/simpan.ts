/**
 * Menyimpan penjualan. SATU-SATUNYA berkas yang bisa menulis ke `marketing`.
 *
 * ⚠️ Jangan pakai pool ini dari tempat lain, dan jangan berikan ke agent.
 * Model tidak punya tool apa pun yang menyentuh berkas ini — penyimpanan
 * dipicu user lewat tombol/balasan, bukan oleh model.
 *
 * ⚠️ DRAF DARI KLIEN TIDAK DIPERCAYA.
 *
 * Yang dikirim klien cuma permintaan aslinya (nama pelanggan, nama produk,
 * jumlah) plus SIDIK draf yang dia lihat. Server menyusun ulang drafnya
 * sendiri, lalu membandingkan sidiknya. Kalau klien mengirim draf jadi dan
 * server mempercayainya, siapa pun bisa mengirim harga karangan lewat curl.
 *
 * Sidik juga menangkap kasus data berubah di antara "lihat draf" dan "tekan
 * simpan" — mis. harga produk diperbarui. Yang tersimpan tidak boleh berbeda
 * dari yang dikonfirmasi user.
 */
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { susunDraf, type Draf, type Permintaan, type Masalah } from "./penjualan";

/** Berapa kali mencoba lagi kalau nomor order bentrok dengan entri serentak. */
const MAKS_COBA = 3;

let kolam: mysql.Pool | undefined;

/**
 * Pool `mkt_entry`, DIPAKAI BERSAMA oleh semua penulis (`simpan.ts`,
 * `batal.ts`).
 *
 * ⚠️ Jangan bikin pool kedua untuk user ini. `mkt_entry` dibatasi
 * `MAX_USER_CONNECTIONS 6`, dan bot WhatsApp adalah proses TERPISAH yang
 * memegang salinan pool-nya sendiri. Dua pool × 3 koneksi × 2 proses = 12,
 * lewat batas. Gejalanya `ER_USER_LIMIT_REACHED` yang muncul belakangan dan
 * tidak menunjuk ke penyebabnya — persis yang pernah terjadi pada
 * `portal_app`.
 */
export function poolEntri(): mysql.Pool {
  if (!kolam) {
    const user = process.env.MARKETING_ENTRY_DB_USER;
    if (!user) {
      throw new Error(
        "MARKETING_ENTRY_DB_USER belum diisi di .env.local. " +
          "Jalankan dulu db/06_entri.sql sebagai root.",
      );
    }
    kolam = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user,
      password: process.env.MARKETING_ENTRY_DB_PASSWORD,
      database: process.env.MARKETING_DB_NAME ?? "marketing",
      connectionLimit: 3,
      multipleStatements: false,
      decimalNumbers: false,
    });
  }
  return kolam;
}

/**
 * Sidik draf — dipakai memastikan yang disimpan sama dengan yang dilihat user.
 *
 * Hanya field yang BERPENGARUH pada data tersimpan yang ikut dihitung. Nama
 * produk & pelanggan ikut supaya perubahan nama juga terdeteksi, bukan cuma
 * angkanya.
 */
export function sidikDraf(d: Draf): string {
  const inti = JSON.stringify({
    p: d.pelanggan.id,
    pn: d.pelanggan.nama,
    t: d.tanggal,
    s: d.status,
    b: d.baris.map((x) => [x.produk_id, x.nama, x.qty, x.harga, x.subtotal]),
    tot: d.total,
  });
  return createHash("sha256").update(inti).digest("hex").slice(0, 16);
}

export type KonteksEntri = {
  penggunaId: number;
  username: string;
  departemen: string;
  peran: string;
  asal: "web" | "wa";
  /** Kalimat asli user, disimpan di jejak audit. */
  permintaan?: string;
};

export type HasilSimpan =
  | { ok: true; orderId: number; noOrder: string; draf: Draf }
  | { ok: false; sebab: "draf-berubah" | "tidak-sah"; pesan: string; masalah?: Masalah[] };

/** Nomor order berikutnya: `SO-YYMM-NNNNN`, mengikuti format yang sudah ada. */
async function nomorBerikutnya(c: mysql.PoolConnection, tanggal: string): Promise<string> {
  const [baris] = await c.query<mysql.RowDataPacket[]>(
    "SELECT MAX(CAST(SUBSTRING_INDEX(no_order, '-', -1) AS UNSIGNED)) AS maks FROM sales_order",
  );
  const urut = Number(baris[0]?.maks ?? 0) + 1;
  const [thn, bln] = tanggal.split("-");
  return `SO-${thn.slice(2)}${bln}-${String(urut).padStart(5, "0")}`;
}

/**
 * Simpan satu penjualan.
 *
 * @param sidikHarapan Sidik draf yang DILIHAT user. Wajib cocok dengan draf
 *   yang disusun ulang server.
 */
export async function simpanPenjualan(
  permintaan: Permintaan,
  sidikHarapan: string,
  ctx: KonteksEntri,
): Promise<HasilSimpan> {
  // Disusun ULANG di server, bukan diterima dari klien.
  const hasil = await susunDraf(ctx.departemen, ctx.peran, permintaan);
  if (!hasil.ok) {
    return { ok: false, sebab: "tidak-sah", pesan: "Draf tidak bisa disusun.", masalah: hasil.masalah };
  }

  const draf = hasil.draf;
  if (sidikDraf(draf) !== sidikHarapan) {
    return {
      ok: false,
      sebab: "draf-berubah",
      pesan:
        "Data berubah sejak draf ditampilkan (mis. harga produk diperbarui). " +
        "Lihat drafnya sekali lagi sebelum menyimpan.",
    };
  }

  for (let coba = 1; coba <= MAKS_COBA; coba++) {
    const c = await poolEntri().getConnection();
    try {
      await c.beginTransaction();
      const noOrder = await nomorBerikutnya(c, draf.tanggal);

      const [order] = await c.query<mysql.ResultSetHeader>(
        `INSERT INTO sales_order (no_order, customer_id, tanggal, status)
         VALUES (?, ?, ?, ?)`,
        [noOrder, draf.pelanggan.id, draf.tanggal, draf.status],
      );
      const orderId = order.insertId;

      for (const b of draf.baris) {
        await c.query(
          `INSERT INTO sales_order_line (order_id, produk_id, qty, harga, diskon, subtotal)
           VALUES (?, ?, ?, ?, 0, ?)`,
          [orderId, b.produk_id, b.qty, b.harga, b.subtotal],
        );
      }

      // Jejak audit di transaksi yang SAMA. Kalau ini gagal, seluruh
      // penjualannya ikut dibatalkan -- data tanpa jejak lebih buruk daripada
      // tidak ada data.
      await c.query(
        `INSERT INTO entri_log
           (entitas, ref_id, ref_kode, pengguna_id, username, departemen, peran, asal, permintaan, ringkasan)
         VALUES ('sales_order', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          noOrder,
          ctx.penggunaId,
          ctx.username,
          ctx.departemen,
          ctx.peran,
          ctx.asal,
          ctx.permintaan?.slice(0, 1000) ?? null,
          JSON.stringify(draf),
        ],
      );

      await c.commit();
      return { ok: true, orderId, noOrder, draf };
    } catch (e) {
      await c.rollback();

      // Nomor order bentrok = ada entri lain yang serentak. Coba lagi dengan
      // nomor berikutnya; bukan kesalahan yang perlu dilaporkan ke user.
      const dup = (e as { code?: string }).code === "ER_DUP_ENTRY";
      if (dup && coba < MAKS_COBA) continue;
      throw e;
    } finally {
      c.release();
    }
  }

  return { ok: false, sebab: "tidak-sah", pesan: "Gagal membuat nomor order setelah beberapa percobaan." };
}
