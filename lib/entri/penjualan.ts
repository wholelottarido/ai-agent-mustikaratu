/**
 * Menyusun DRAF penjualan dari maksud user. Tidak menulis apa pun.
 *
 * ⚠️ TAHAP 1a: SELURUH berkas ini CUMA MEMBACA.
 *
 * Dia memakai pool departemen yang sudah ada (`mkt_readonly`) — user MySQL
 * yang izinnya `SELECT` saja. Jadi berapa pun salahnya kode di sini, database
 * tidak bisa berubah. Itu disengaja: pencocokan nama dan perhitungannya harus
 * terbukti benar DULU, sebelum ada apa pun yang boleh menulis.
 *
 * ⚠️ AI TIDAK MENGHITUNG DAN TIDAK MENENTUKAN HARGA.
 *
 * Model cuma menyebut nama dan jumlah. Harga diambil dari tabel `produk`,
 * subtotal dihitung di sini. Kalau user menulis "jual 10 masker harga 5.000",
 * harga yang dipakai tetap dari database — harga khusus & diskon punya
 * aturannya sendiri dan belum masuk tahap ini.
 *
 * ⚠️ AMBIGU BERARTI BERHENTI, BUKAN MENEBAK.
 *
 * "lulur" cocok ke dua produk. Kalau model yang memutuskan, salah satunya
 * dipilih diam-diam dan baru ketahuan waktu laporan bulanan janggal. Di sini
 * pencocokan ganda dikembalikan sebagai pertanyaan.
 */
import type { RowDataPacket } from "mysql2/promise";
import { ambilPool, namaDb } from "@/voltagent/db";
import { ambilDepartemen } from "@/voltagent/departemen";

/** Jumlah maksimal per baris. Menangkap salah ketik seperti 10000000. */
const QTY_MAKS = 100_000;

export type BarangDiminta = { produk: string; qty: number };

export type Permintaan = {
  pelanggan: string;
  barang: BarangDiminta[];
  /** `YYYY-MM-DD`. Kosong = hari ini. */
  tanggal?: string;
};

export type Pilihan = { id: number; nama: string; harga?: number; kode?: string };

export type Masalah =
  | { jenis: "ambigu"; apa: "pelanggan" | "produk"; dicari: string; pilihan: Pilihan[] }
  | { jenis: "tidak-ketemu"; apa: "pelanggan" | "produk"; dicari: string }
  | { jenis: "tidak-sah"; pesan: string };

export type BarisDraf = {
  produk_id: number;
  nama: string;
  qty: number;
  harga: number;
  subtotal: number;
};

export type Draf = {
  pelanggan: { id: number; nama: string };
  baris: BarisDraf[];
  total: number;
  tanggal: string;
  /** Dipatok COMPLETED di tahap ini. Seluruh laporan omzet memfilter kolom ini. */
  status: "COMPLETED";
};

export type Hasil = { ok: true; draf: Draf } | { ok: false; masalah: Masalah[] };

/** Tanggal hari ini dalam `YYYY-MM-DD`, waktu lokal. */
function hariIni(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Cari satu baris dari nama yang diketik user.
 *
 * Cocok PERSIS menang duluan: kalau ada produk bernama tepat "Lulur Kuning
 * 200g", itu yang dipakai walau pencarian longgar juga menemukan yang lain.
 *
 * Nilai pencariannya SELALU lewat parameter, tidak pernah disambung ke string
 * SQL — teks ini datang dari model, dan model bisa dibujuk user.
 */
async function cari(
  dep: ReturnType<typeof ambilDepartemen>,
  peran: string,
  tabel: "customer" | "produk",
  teks: string,
): Promise<{ tepat: Pilihan } | { banyak: Pilihan[] } | { kosong: true }> {
  const db = ambilPool(dep!, peran);
  // `kode` ikut diambil untuk pelanggan: data nyata punya nama yang PERSIS
  // sama ("Anisa Hidayat" dua kali). Tanpa kode, daftar pilihannya jadi dua
  // baris identik yang mustahil dibedakan user.
  const kolom = tabel === "produk" ? "id, nama, harga" : "id, kode, nama";

  const [persis] = await db.query<RowDataPacket[]>(
    `SELECT ${kolom} FROM \`${namaDb(dep!)}\`.\`${tabel}\` WHERE LOWER(nama) = LOWER(?) LIMIT 2`,
    [teks.trim()],
  );
  if (persis.length === 1) return { tepat: persis[0] as Pilihan };

  const [longgar] = await db.query<RowDataPacket[]>(
    `SELECT ${kolom} FROM \`${namaDb(dep!)}\`.\`${tabel}\` WHERE nama LIKE ? ORDER BY nama LIMIT 6`,
    [`%${teks.trim()}%`],
  );

  if (longgar.length === 0) return { kosong: true };
  if (longgar.length === 1) return { tepat: longgar[0] as Pilihan };
  return { banyak: longgar as Pilihan[] };
}

/** Periksa bentuk masukan sebelum menyentuh database sama sekali. */
function periksa(p: Permintaan): Masalah[] {
  const m: Masalah[] = [];

  if (!p.pelanggan?.trim()) {
    m.push({ jenis: "tidak-sah", pesan: "Nama pelanggan belum disebut." });
  }
  if (!Array.isArray(p.barang) || p.barang.length === 0) {
    m.push({ jenis: "tidak-sah", pesan: "Belum ada barang yang dicatat." });
  }

  for (const b of p.barang ?? []) {
    if (!b.produk?.trim()) {
      m.push({ jenis: "tidak-sah", pesan: "Ada barang tanpa nama produk." });
    }
    if (!Number.isInteger(b.qty) || b.qty <= 0) {
      m.push({ jenis: "tidak-sah", pesan: `Jumlah untuk "${b.produk}" harus bilangan bulat di atas 0.` });
    } else if (b.qty > QTY_MAKS) {
      // Bukan aturan bisnis, tapi jaring salah ketik. Angka sebesar ini
      // hampir pasti kelebihan nol.
      m.push({ jenis: "tidak-sah", pesan: `Jumlah ${b.qty} untuk "${b.produk}" tidak masuk akal — cek lagi.` });
    }
  }

  if (p.tanggal && !/^\d{4}-\d{2}-\d{2}$/.test(p.tanggal)) {
    m.push({ jenis: "tidak-sah", pesan: `Tanggal "${p.tanggal}" harus berbentuk YYYY-MM-DD.` });
  }
  if (p.tanggal && p.tanggal > hariIni()) {
    m.push({ jenis: "tidak-sah", pesan: "Tanggal penjualan tidak boleh di masa depan." });
  }

  return m;
}

/**
 * Susun draf. `ok: false` berarti ada yang harus diperjelas user — BUKAN
 * kegagalan sistem.
 *
 * SEMUA masalah dikumpulkan, tidak berhenti di yang pertama. Kalau berhenti,
 * user memperbaiki satu hal lalu menemukan masalah berikutnya, satu per satu.
 */
export async function susunDraf(
  departemen: string,
  peran: string,
  p: Permintaan,
): Promise<Hasil> {
  const dep = ambilDepartemen(departemen);
  if (!dep) {
    return { ok: false, masalah: [{ jenis: "tidak-sah", pesan: "Departemen tidak dikenal." }] };
  }

  const masalah = periksa(p);
  if (masalah.length > 0) return { ok: false, masalah };

  const hasilPelanggan = await cari(dep, peran, "customer", p.pelanggan);
  if ("kosong" in hasilPelanggan) {
    masalah.push({ jenis: "tidak-ketemu", apa: "pelanggan", dicari: p.pelanggan });
  } else if ("banyak" in hasilPelanggan) {
    masalah.push({
      jenis: "ambigu",
      apa: "pelanggan",
      dicari: p.pelanggan,
      pilihan: hasilPelanggan.banyak,
    });
  }

  const baris: BarisDraf[] = [];
  for (const b of p.barang) {
    const hasilProduk = await cari(dep, peran, "produk", b.produk);

    if ("kosong" in hasilProduk) {
      masalah.push({ jenis: "tidak-ketemu", apa: "produk", dicari: b.produk });
      continue;
    }
    if ("banyak" in hasilProduk) {
      masalah.push({ jenis: "ambigu", apa: "produk", dicari: b.produk, pilihan: hasilProduk.banyak });
      continue;
    }

    // `harga` datang sebagai string dari mysql2 (`decimalNumbers: false`)
    // supaya rupiah tidak kehilangan presisi — diubah di sini, sekali.
    const harga = Number(hasilProduk.tepat.harga ?? 0);
    if (!(harga > 0)) {
      masalah.push({
        jenis: "tidak-sah",
        pesan: `Produk "${hasilProduk.tepat.nama}" belum punya harga di database.`,
      });
      continue;
    }

    baris.push({
      produk_id: hasilProduk.tepat.id,
      nama: hasilProduk.tepat.nama,
      qty: b.qty,
      harga,
      subtotal: harga * b.qty,
    });
  }

  if (masalah.length > 0) return { ok: false, masalah };

  return {
    ok: true,
    draf: {
      pelanggan: {
        id: (hasilPelanggan as { tepat: Pilihan }).tepat.id,
        nama: (hasilPelanggan as { tepat: Pilihan }).tepat.nama,
      },
      baris,
      total: baris.reduce((j, b) => j + b.subtotal, 0),
      tanggal: p.tanggal ?? hariIni(),
      status: "COMPLETED",
    },
  };
}

/** Rupiah untuk ditampilkan di draf. */
export function rp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Draf sebagai teks — dipakai tool agent, dan nanti oleh bot WhatsApp. */
export function drafJadiTeks(d: Draf): string {
  const baris = d.baris.map(
    (b) => `• ${b.nama}  ×${b.qty}  @${rp(b.harga)}  = ${rp(b.subtotal)}`,
  );
  return [
    `Pelanggan : ${d.pelanggan.nama}`,
    `Tanggal   : ${d.tanggal}`,
    `Status    : ${d.status}`,
    "",
    ...baris,
    "",
    `TOTAL     : ${rp(d.total)}`,
  ].join("\n");
}

/** Masalah sebagai teks yang bisa ditindaklanjuti user. */
export function masalahJadiTeks(m: Masalah[]): string {
  return m
    .map((x) => {
      if (x.jenis === "tidak-sah") return `• ${x.pesan}`;
      if (x.jenis === "tidak-ketemu") {
        return `• ${x.apa === "produk" ? "Produk" : "Pelanggan"} "${x.dicari}" tidak ditemukan.`;
      }
      const daftar = x.pilihan
        .map((p, i) => {
          const tambahan = p.harga
            ? ` — ${rp(Number(p.harga))}`
            : p.kode
              ? ` (${p.kode})`
              : "";
          return `   ${i + 1}. ${p.nama}${tambahan}`;
        })
        .join("\n");
      return `• "${x.dicari}" cocok ke beberapa ${x.apa}. Maksudnya yang mana?\n${daftar}`;
    })
    .join("\n");
}
