/**
 * Apakah sebuah jawaban menyebut SELURUH nama di daftar pilihan produk?
 *
 * ⚠️ ADA KARENA MODEL BOLEH MENJAWAB DARI RIWAYAT. Pertanyaan yang sama diulang
 * dalam satu percakapan sering dijawab dengan menyalin daftar lama tanpa
 * memanggil alat, jadi metadata pilihannya kosong dan tombolnya tidak muncul
 * walau daftarnya tampil di layar. Terlihat 3 Nov 2026.
 *
 * Wajib SEMUA nama, bukan sebagian: jawaban ramalan yang menyebut satu varian
 * tidak boleh tiba-tiba memunculkan tombol. Spasi dan huruf besar-kecil
 * diabaikan, karena model kadang menulis "RJ + M.ZAITUN" untuk "RJ+M.ZAITUN".
 */
export function menyebutSemuaPilihan(teks: string, nama: string[]): boolean {
  if (nama.length < 2) return false;
  const padat = (t: string) => t.replace(/\s+/g, "").toUpperCase();
  const isi = padat(teks);
  return nama.every((n) => isi.includes(padat(n)));
}

export type PilihanTersimpan = {
  kode: string;
  nama: string;
  riwayat_bulan?: number;
  data_terakhir?: string;
};
export type KlarifikasiTersimpan = { pesan: string; pilihan: PilihanTersimpan[]; alat?: string };

const MAKS_PILIHAN = 20;

/**
 * Tujuan pertanyaan awal, ditulis di depan pesan yang dikirim tombol.
 *
 * ⚠️ Tanpa ini model harus mengingat sendiri pertanyaan awalnya. Gemma pernah
 * lupa (3 Nov 2026): sesudah tombol ditekan pada pertanyaan tren pasar, ia tidak
 * memanggil alat apa pun dan malah bertanya lagi.
 */
const TUJUAN_ALAT: Record<string, string> = {
  ramal_penjualan: "Ramalan penjualan",
  total_penjualan: "Total penjualan",
  stok_kosong: "Stok kosong",
  cari_tren_pasar: "Tren pasar",
  analisis_pasar_penjualan: "Analisis pasar dan penjualan",
};

/**
 * Memeriksa bentuk daftar pilihan yang datang dari browser atau dari database.
 *
 * Datanya melewati klien sebelum disimpan, dan nanti jadi tombol yang mengirim
 * teks ke model, jadi bentuk dan panjangnya dibatasi. Satu baris rusak membuat
 * seluruh daftar ditolak: daftar yang separuh hilang menyesatkan pemakai.
 */
export function bersihkanKlarifikasi(x: unknown): KlarifikasiTersimpan | null {
  const k = x as { pesan?: unknown; pilihan?: unknown } | null;
  if (!k || typeof k !== "object" || !Array.isArray(k.pilihan)) return null;
  if (k.pilihan.length < 2 || k.pilihan.length > MAKS_PILIHAN) return null;

  const pilihan: PilihanTersimpan[] = [];
  for (const p of k.pilihan) {
    const o = p as Record<string, unknown> | null;
    if (typeof o?.kode !== "string" || typeof o?.nama !== "string" || !o.kode || !o.nama) return null;
    if (o.kode.length > 40 || o.nama.length > 200) return null;
    pilihan.push({
      kode: o.kode,
      nama: o.nama,
      ...(typeof o.riwayat_bulan === "number" ? { riwayat_bulan: o.riwayat_bulan } : {}),
      ...(typeof o.data_terakhir === "string" ? { data_terakhir: o.data_terakhir.slice(0, 10) } : {}),
    });
  }
  const alat = (k as { alat?: unknown }).alat;
  return {
    pesan: typeof k.pesan === "string" ? k.pesan.slice(0, 300) : "Produk mana yang Anda maksud?",
    pilihan,
    // Daftar-boleh, bukan apa adanya: nilai ini menentukan awalan pesan ke model.
    ...(typeof alat === "string" && alat in TUJUAN_ALAT ? { alat } : {}),
  };
}

/** Membaca kolom `pesan.klarifikasi`. Isi yang rusak berarti tidak ada tombol, bukan galat. */
export function bacaKlarifikasi(teks: string | null | undefined): KlarifikasiTersimpan | null {
  if (!teks) return null;
  try {
    return bersihkanKlarifikasi(JSON.parse(teks));
  } catch {
    return null;
  }
}

/**
 * Teks yang dikirim tombol pilih produk: nama supaya terbaca, kode supaya pasti.
 */
export function teksPilihan(p: { kode: string; nama: string }, alat?: string): string {
  const tujuan = alat ? TUJUAN_ALAT[alat] : undefined;
  return `${tujuan ? `${tujuan}: ` : ""}${p.nama.trim().replace(/\s+/g, " ")} (kode ${p.kode})`;
}

/** Apakah pesan user ini jawaban untuk pilihan tersebut, ditekan atau diketik? */
export function jawabanUntuk(p: { kode: string; nama: string }, jawaban: string, alat?: string): boolean {
  const seragam = (t: string) => t.trim().replace(/\s+/g, " ").toUpperCase();
  const j = seragam(jawaban);
  return j === seragam(p.nama) || j === seragam(p.kode)
    || j === seragam(teksPilihan(p)) || j === seragam(teksPilihan(p, alat));
}
