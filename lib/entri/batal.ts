/**
 * Pembatalan penjualan (Tahap 3b).
 *
 * ⚠️ MEMBATALKAN = MENGUBAH STATUS JADI `CANCELLED`, BUKAN MENGHAPUS.
 *
 * Barisnya tetap ada. Yang membuatnya hilang dari laporan adalah `v_penjualan`
 * yang memfilter `status = 'COMPLETED'`, dan semua view lain menarik dari situ.
 * Jadi satu flip status membersihkan seluruh laporan tanpa menyentuh view.
 *
 * ⚠️ ATURAN SIAPA & KAPAN ADA DI SINI, BUKAN DI MySQL.
 *
 * MySQL tidak tahu siapa yang login di aplikasi — yang dijaga `07_batal.sql`
 * cuma seberapa luas kerusakan yang mungkin (UPDATE satu kolom, tanpa DELETE).
 * Empat aturan di bawah ini yang menentukan boleh atau tidaknya:
 *
 *   1. cuma pengguna yang MENGENTRI yang boleh membatalkan
 *   2. paling lama 2 jam sejak `entri_log.dibuat`
 *   3. alasan wajib diisi USER — bukan dikarang model
 *   4. order yang sudah CANCELLED ditolak
 *
 * Aturan 1 sekaligus melindungi 1.783 order seed: mereka tidak punya baris
 * `entri_log`, jadi tidak ada pemiliknya dan tidak bisa dibatalkan di sini.
 */
import type mysql from "mysql2/promise";
import { rp } from "./penjualan";
import { poolEntri, type KonteksEntri } from "./simpan";

/** Yang dibutuhkan pemeriksaan kelayakan: cuma SIAPA-nya. */
type Pemeriksa = Pick<KonteksEntri, "penggunaId">;

/** Batas waktu pembatalan, dihitung dari kapan DIENTRI (bukan tanggal jual). */
export const MENIT_BATAL = 120;

/** Alasan sependek "a" sama saja dengan tidak ada alasan. */
const MIN_ALASAN = 5;
const MAKS_ALASAN = 255;

export type BarisOrder = { nama: string; qty: number; harga: number; subtotal: number };

export type OrderBatal = {
  orderId: number;
  noOrder: string;
  pelanggan: string;
  tanggal: string;
  status: string;
  baris: BarisOrder[];
  total: number;
  /** Siapa yang mengentri — ditampilkan supaya user tahu ini miliknya. */
  dientriOleh: string;
  umurMenit: number;
  sisaMenit: number;
};

export type SebabTolak =
  | "tidak-ketemu"
  | "bukan-lewat-aplikasi"
  | "bukan-milik-anda"
  | "sudah-dibatalkan"
  | "kedaluwarsa"
  | "alasan-kurang";

export type HasilDrafBatal =
  | { ok: true; order: OrderBatal }
  | { ok: false; sebab: SebabTolak; pesan: string };

export type HasilBatal =
  | { ok: true; orderId: number; noOrder: string; order: OrderBatal }
  | { ok: false; sebab: SebabTolak; pesan: string };

/**
 * Ambil order + siapa yang mengentri + umurnya.
 *
 * Umur dihitung MySQL lewat `TIMESTAMPDIFF`, bukan di Node. Kalau dihitung di
 * Node, selisih zona waktu antara proses dan server database bisa menggeser
 * batas 2 jam tanpa ada yang sadar.
 *
 * `aksi = 'ENTRI'` disebut eksplisit: setelah dibatalkan ada DUA baris log
 * untuk order yang sama, dan yang menentukan kepemilikan adalah baris entri.
 */
async function ambilOrder(
  c: mysql.PoolConnection,
  noOrder: string,
): Promise<mysql.RowDataPacket | undefined> {
  const [baris] = await c.query<mysql.RowDataPacket[]>(
    `SELECT o.id, o.no_order, o.status, DATE_FORMAT(o.tanggal, '%Y-%m-%d') AS tanggal,
            p.nama AS pelanggan,
            l.pengguna_id, l.username,
            TIMESTAMPDIFF(MINUTE, l.dibuat, NOW()) AS umur_menit
       FROM sales_order o
       JOIN customer p ON p.id = o.customer_id
       LEFT JOIN entri_log l
            ON l.entitas = 'sales_order' AND l.ref_id = o.id AND l.aksi = 'ENTRI'
      WHERE o.no_order = ?
      LIMIT 1`,
    [noOrder],
  );
  return baris[0];
}

async function ambilBaris(c: mysql.PoolConnection, orderId: number): Promise<BarisOrder[]> {
  const [baris] = await c.query<mysql.RowDataPacket[]>(
    `SELECT k.nama, b.qty, b.harga, b.subtotal
       FROM sales_order_line b
       JOIN produk k ON k.id = b.produk_id
      WHERE b.order_id = ?
      ORDER BY b.id`,
    [orderId],
  );
  // DECIMAL datang sebagai string (`decimalNumbers: false` di pool), jadi
  // harus dikonversi -- kalau tidak, `total` jadi hasil penggabungan teks.
  return baris.map((b) => ({
    nama: String(b.nama),
    qty: Number(b.qty),
    harga: Number(b.harga),
    subtotal: Number(b.subtotal),
  }));
}

/**
 * Semua pemeriksaan kelayakan, di satu tempat.
 *
 * ⚠️ Dipakai DUA KALI: waktu menyusun draf, dan sekali lagi DI DALAM transaksi
 * pembatalan. Tanpa pemeriksaan kedua, user bisa membuka draf di menit ke-119,
 * ditinggal, lalu menekan Batalkan di menit ke-125 dan tetap lolos.
 */
function periksa(
  baris: mysql.RowDataPacket | undefined,
  ctx: Pemeriksa,
): { sebab: SebabTolak; pesan: string } | null {
  if (!baris) {
    return { sebab: "tidak-ketemu", pesan: "Nomor order itu tidak ada." };
  }
  if (String(baris.status) === "CANCELLED") {
    return { sebab: "sudah-dibatalkan", pesan: "Order ini sudah dibatalkan sebelumnya." };
  }
  if (baris.pengguna_id === null) {
    return {
      sebab: "bukan-lewat-aplikasi",
      pesan:
        "Order ini tidak dibuat lewat aplikasi, jadi tidak bisa dibatalkan di sini. " +
        "Hubungi admin database.",
    };
  }
  if (Number(baris.pengguna_id) !== ctx.penggunaId) {
    return {
      sebab: "bukan-milik-anda",
      pesan:
        `Order ini dientri oleh ${baris.username}, bukan Anda. ` +
        "Yang bisa membatalkan cuma orang yang mengentrinya.",
    };
  }
  const umur = Number(baris.umur_menit);
  if (umur >= MENIT_BATAL) {
    const jam = Math.floor(umur / 60);
    return {
      sebab: "kedaluwarsa",
      pesan:
        `Batas pembatalan ${MENIT_BATAL / 60} jam sudah lewat ` +
        `(order ini dientri ${jam} jam lalu). Hubungi admin database.`,
    };
  }
  return null;
}

/** Alasan yang sah: sudah dipangkas, cukup panjang, tidak kepanjangan. */
export function periksaAlasan(
  alasan: unknown,
): { ok: true; nilai: string } | { ok: false; pesan: string } {
  const teks = typeof alasan === "string" ? alasan.trim() : "";
  if (teks.length < MIN_ALASAN) {
    return { ok: false, pesan: `Alasan pembatalan wajib diisi, minimal ${MIN_ALASAN} karakter.` };
  }
  return { ok: true, nilai: teks.slice(0, MAKS_ALASAN) };
}

function susunOrder(baris: mysql.RowDataPacket, isi: BarisOrder[]): OrderBatal {
  const umur = Number(baris.umur_menit);
  return {
    orderId: Number(baris.id),
    noOrder: String(baris.no_order),
    pelanggan: String(baris.pelanggan),
    tanggal: String(baris.tanggal),
    status: String(baris.status),
    baris: isi,
    total: isi.reduce((j, b) => j + b.subtotal, 0),
    dientriOleh: String(baris.username),
    umurMenit: umur,
    sisaMenit: Math.max(0, MENIT_BATAL - umur),
  };
}

/**
 * Susun draf pembatalan. TIDAK MENGUBAH APA PUN — cuma membaca.
 *
 * Dipakai tool agent supaya user melihat dulu order mana yang akan dibatalkan.
 */
export async function susunDrafBatal(
  noOrder: string,
  ctx: Pemeriksa,
): Promise<HasilDrafBatal> {
  const kode = String(noOrder ?? "").trim().toUpperCase();
  if (!kode) return { ok: false, sebab: "tidak-ketemu", pesan: "Nomor order belum disebut." };

  const c = await poolEntri().getConnection();
  try {
    const baris = await ambilOrder(c, kode);
    const tolak = periksa(baris, ctx);
    if (tolak) return { ok: false, ...tolak };

    const isi = await ambilBaris(c, Number(baris!.id));
    return { ok: true, order: susunOrder(baris!, isi) };
  } finally {
    c.release();
  }
}

/**
 * Batalkan penjualan. SATU-SATUNYA jalur yang mengubah status.
 *
 * Dipicu tombol/balasan user, bukan model — agent tidak punya tool yang
 * memanggil fungsi ini.
 */
export async function batalkanPenjualan(
  noOrder: string,
  alasan: string,
  ctx: KonteksEntri,
): Promise<HasilBatal> {
  // Diperiksa lebih dulu karena paling murah: tidak perlu menyentuh database
  // untuk tahu alasannya kosong.
  const cekAlasan = periksaAlasan(alasan);
  if (!cekAlasan.ok) return { ok: false, sebab: "alasan-kurang", pesan: cekAlasan.pesan };

  const kode = String(noOrder ?? "").trim().toUpperCase();
  const c = await poolEntri().getConnection();
  try {
    await c.beginTransaction();

    // Diperiksa ULANG di sini, bukan mengandalkan hasil waktu draf disusun.
    const baris = await ambilOrder(c, kode);
    const tolak = periksa(baris, ctx);
    if (tolak) {
      await c.rollback();
      return { ok: false, ...tolak };
    }

    const orderId = Number(baris!.id);
    const isi = await ambilBaris(c, orderId);
    const order = susunOrder(baris!, isi);

    // `AND status <> 'CANCELLED'` bukan hiasan: kalau ada pembatalan serentak
    // untuk order yang sama, yang kedua menyentuh 0 baris dan ditolak di sini
    // -- tanpa itu, jejak auditnya jadi dobel untuk satu pembatalan.
    const [hasil] = await c.query<mysql.ResultSetHeader>(
      "UPDATE sales_order SET status = 'CANCELLED' WHERE id = ? AND status <> 'CANCELLED'",
      [orderId],
    );
    if (hasil.affectedRows !== 1) {
      await c.rollback();
      return { ok: false, sebab: "sudah-dibatalkan", pesan: "Order ini baru saja dibatalkan." };
    }

    // Baris BARU, bukan menimpa baris ENTRI-nya. Jejaknya jadi berpasangan:
    // ENTRI lalu BATAL, dua-duanya utuh dan bisa dibandingkan.
    await c.query(
      `INSERT INTO entri_log
         (entitas, aksi, ref_id, ref_kode, pengguna_id, username, departemen, peran, asal, permintaan, alasan, ringkasan)
       VALUES ('sales_order', 'BATAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        order.noOrder,
        ctx.penggunaId,
        ctx.username,
        ctx.departemen,
        ctx.peran,
        ctx.asal,
        ctx.permintaan?.slice(0, 1000) ?? null,
        cekAlasan.nilai,
        JSON.stringify(order),
      ],
    );

    await c.commit();
    return { ok: true, orderId, noOrder: order.noOrder, order: { ...order, status: "CANCELLED" } };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

/** Order yang akan dibatalkan, sebagai teks — untuk agent dan WhatsApp. */
export function batalJadiTeks(o: OrderBatal): string {
  return [
    `Order     : ${o.noOrder}`,
    `Pelanggan : ${o.pelanggan}`,
    `Tanggal   : ${o.tanggal}`,
    "",
    ...o.baris.map((b) => `• ${b.nama}  ×${b.qty}  @${rp(b.harga)}  = ${rp(b.subtotal)}`),
    "",
    `TOTAL     : ${rp(o.total)}`,
    `Sisa waktu: ${o.sisaMenit} menit`,
  ].join("\n");
}
