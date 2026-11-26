/**
 * Menjalankan riset pasar: kueri -> penyedia -> saring -> bukti.
 *
 * ============================================================
 * ⚠️ KEGAGALAN DI SINI TIDAK BOLEH MENJATUHKAN RAMALAN
 * ============================================================
 * §3 dan §16 Skenario A dokumen Phase 2: "Failure of the web search provider
 * must not prevent the user from receiving an available internal forecasting
 * result." Jadi tidak ada satu pun jalur di berkas ini yang melempar galat
 * ke pemanggil — semuanya pulang sebagai hasil yang menyebutkan sebabnya.
 *
 * ============================================================
 * ⚠️ SINGGAHAN HANYA BERISI YANG MEMANG PUBLIK
 * ============================================================
 * §15: "Separate public research cache from internal forecast data. Avoid
 * caching confidential company information in shared storage."
 *
 * Yang disinggahkan: teks kueri (sudah lewat `kueri.ts`, jadi tidak memuat
 * apa pun dari basis data) dan hasil dari internet. Tidak ada angka
 * penjualan, tidak ada hasil ramalan, tidak ada kode SKU. Singgahannya di
 * memori proses, bukan di basis data bersama — mati bersama prosesnya, dan
 * tidak pernah ikut tersimpan ke mana pun.
 */
import { susunKueri, tolakKueri, istilahPasar, MAKS_KUERI, type JenisRiset, type KonteksPublik } from "./kueri";
import { penyediaTerpilih } from "./tavily";
import type { HasilMentah, PenyediaCari } from "./penyedia";
import { cukupBukti, saringSumber, sumberKedaluwarsa, type SumberPasar } from "./saring";

export const TTL_DETIK = Number(process.env.MARKET_SEARCH_CACHE_TTL ?? 21_600);
export const MAKS_HASIL = Number(process.env.MARKET_SEARCH_MAX_RESULTS ?? 5);
export const MAKS_KUERI_PERMINTAAN = Number(process.env.MARKET_SEARCH_MAX_QUERIES ?? MAKS_KUERI);
/** Berapa hari ke belakang hasil pencarian masih diminta. */
export const HARI_KE_BELAKANG = 540;

type Singgah = { pada: number; hasil: HasilMentah[]; diambilPada: string };
const singgahan = new Map<string, Singgah>();

/** Dipakai uji untuk memastikan singgahannya memang bekerja. */
export function kosongkanSinggahan(): void {
  singgahan.clear();
}

/** Angka pemakaian, untuk §15 "Track API usage". Tidak memuat isi kueri. */
export const pemakaian = { panggilan: 0, dariSinggahan: 0, gagal: 0 };

export type HasilRiset = {
  /** Kueri yang BENAR-BENAR dikirim keluar. Ikut supaya bisa diperiksa. */
  kueri: string[];
  sumber: SumberPasar[];
  cukup: boolean;
  /** Kenapa cukup atau tidak. Selalu diisi. */
  catatan: string;
  /** Sumber yang terlalu tua untuk periode yang ditanya. §16 Skenario C. */
  kedaluwarsa: SumberPasar[];
  /** Diisi kalau pencariannya sendiri gagal. Ramalan tetap jalan. */
  galat?: string;
};

/**
 * Riset pasar untuk satu produk.
 *
 * ⚠️ `konteks` bertipe `KonteksPublik` — tiga ruas, semuanya publik. Itulah
 * penjagaannya: fungsi ini TIDAK BISA menerima angka penjualan atau kode SKU
 * walaupun pemanggilnya ingin mengirimkannya.
 */
export async function risetPasar(
  konteks: KonteksPublik,
  jenis: JenisRiset = "tren",
  penyedia: PenyediaCari | null = penyediaTerpilih(),
  sekarang = new Date(),
): Promise<HasilRiset> {
  const kosong = { kueri: [], sumber: [], cukup: false, kedaluwarsa: [] };

  if (!penyedia) {
    return {
      ...kosong,
      catatan: "riset pasar dimatikan",
      galat:
        "Pencarian pasar sedang tidak aktif (MARKET_SEARCH_ENABLED belum true). " +
        "Ini BUKAN berarti tidak ada berita tentang produk ini.",
    };
  }

  const kueri = susunKueri(konteks, jenis, sekarang).slice(0, MAKS_KUERI_PERMINTAAN);
  if (kueri.length === 0) {
    return { ...kosong, catatan: "nama produknya tidak menyisakan kata yang bisa dicari" };
  }

  // ⚠️ Penjaga lapis kedua, tepat sebelum keluar. Lihat `tolakKueri()`.
  for (const q of kueri) {
    const tolak = tolakKueri(q);
    if (tolak) {
      return {
        ...kosong,
        kueri: [],
        catatan: "kueri ditolak penjaga",
        galat: `Pencarian dibatalkan: ${tolak}. Tidak ada yang dikirim ke penyedia.`,
      };
    }
  }

  const mentah: HasilMentah[] = [];
  let diambilPada = new Date().toISOString();
  const gagal: string[] = [];

  for (const q of kueri) {
    const kunci = `${penyedia.nama}|${jenis}|${q}`;
    const ada = singgahan.get(kunci);
    if (ada && (Date.now() - ada.pada) / 1000 < TTL_DETIK) {
      pemakaian.dariSinggahan += 1;
      mentah.push(...ada.hasil);
      diambilPada = ada.diambilPada;
      continue;
    }

    pemakaian.panggilan += 1;
    const h = await penyedia.cari({ kueri: q, maksHasil: MAKS_HASIL, hariKeBelakang: HARI_KE_BELAKANG });
    if (!h.ok) {
      pemakaian.gagal += 1;
      gagal.push(h.sebab);
      continue;
    }
    singgahan.set(kunci, { pada: Date.now(), hasil: h.hasil, diambilPada: h.diambilPada });
    diambilPada = h.diambilPada;
    mentah.push(...h.hasil);
  }

  // Semua kueri gagal = pencariannya yang gagal, bukan pasarnya yang sepi.
  // Bedanya penting dan disebut apa adanya.
  if (mentah.length === 0 && gagal.length > 0) {
    return {
      ...kosong,
      kueri,
      catatan: "pencarian gagal",
      galat:
        `Informasi pasar terkini tidak bisa diambil (${gagal[0]}). ` +
        "Ini BUKAN berarti tidak ada tren yang relevan — datanya memang tidak sampai ke kita.",
    };
  }

  const kataKunci = istilahPasar(konteks.nama).split(" ").filter((k) => k.length > 2);
  const sumber = saringSumber(mentah, kataKunci, diambilPada, sekarang);
  const bukti = cukupBukti(sumber);

  return {
    kueri,
    sumber,
    cukup: bukti.cukup,
    catatan: bukti.sebab,
    kedaluwarsa: sumberKedaluwarsa(sumber, sekarang),
    ...(gagal.length > 0 ? { galat: `${gagal.length} dari ${kueri.length} pencarian gagal: ${gagal[0]}` } : {}),
  };
}
