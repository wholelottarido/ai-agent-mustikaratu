/**
 * Cara meramal yang masih dicoba. BELUM dipakai portal.
 *
 * Masuk `SEMUA_MODEL` hanya kalau menang di `scripts/ukur-cara-baru.mts` pada produk
 * yang belum pernah dipakai untuk memilihnya.
 *
 * Pola musiman selalu dirapatkan ke 1. Pola dari 2-3 tahun data rawan mengikuti kejadian
 * sekali lewat, dan tebakan naik-turun yang salah lebih buruk daripada angka yang rata.
 */
import { sahkan, type Model } from "./model";
import { bulanLebaran } from "./kalender";

const rata = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const KODE = (k: string) => k as Model["kode"];

function rataAkhir(kode: string, nama: string, n: number): Model {
  return {
    kode: KODE(kode), nama, minimal: n,
    ramal(deret, h) {
      if (deret.length < n) return { ok: false, sebab: `butuh minimal ${n} bulan` };
      return sahkan(Array(h).fill(rata(deret.slice(-n))), h);
    },
  };
}

export const rata3 = rataAkhir("rata3", "Rata-rata 3 bulan terakhir", 3);
export const rata6 = rataAkhir("rata6", "Rata-rata 6 bulan terakhir", 6);

export { ses } from "./model";

const ALFA = [0.1, 0.2, 0.3, 0.5, 0.7];

/** Arah diredam: makin jauh, makin kecil pengaruhnya, supaya tidak lari ke nol atau melambung. */
const REDAM = 0.85;

export const holt: Model = {
  kode: KODE("holt"), nama: "Holt (mengikuti arah, diredam)", minimal: 12,
  ramal(deret, h) {
    if (deret.length < 12) return { ok: false, sebab: "butuh minimal 12 bulan" };
    let terbaik = Infinity;
    let hasil: number[] = [];
    for (const a of ALFA) {
      for (const b of [0.05, 0.1, 0.2, 0.3]) {
        let l = deret[0];
        let t = deret[1] - deret[0];
        let galat = 0;
        for (let i = 1; i < deret.length; i++) {
          const f = l + REDAM * t;
          galat += (deret[i] - f) ** 2;
          const lBaru = a * deret[i] + (1 - a) * f;
          t = b * (lBaru - l) + (1 - b) * REDAM * t;
          l = lBaru;
        }
        if (galat < terbaik) {
          terbaik = galat;
          let redam = 0;
          hasil = Array.from({ length: h }, (_, k) => {
            redam += REDAM ** (k + 1);
            return l + redam * t;
          });
        }
      }
    }
    return sahkan(hasil, h);
  },
};

/**
 * Tingkat penjualan terbaru dikali pola bulanan.
 *
 * Posisi dihitung dari ujung deret, jadi posisi yang sama berarti bulan kalender yang
 * sama tanpa perlu tahu tanggalnya.
 */
export const musimanTingkat: Model = {
  kode: KODE("musiman_tingkat"), nama: "Tingkat terbaru dikali pola bulanan", minimal: 24,
  ramal(deret, h) {
    if (deret.length < 24) return { ok: false, sebab: "butuh minimal 24 bulan" };
    const pakai = deret.slice(-Math.floor(deret.length / 12) * 12).slice(-36);
    const dasar = rata(pakai);
    if (!(dasar > 0)) return { ok: false, sebab: "tidak ada penjualan" };
    const pola = Array.from({ length: 12 }, (_, p) => {
      const nilai = pakai.filter((_, i) => (pakai.length - 1 - i) % 12 === p);
      return 1 + 0.5 * (rata(nilai) / dasar - 1);
    });
    const polaDi = (dariUjung: number) => pola[((dariUjung % 12) + 12) % 12];
    const akhir = deret.slice(-3);
    const tingkat = rata(akhir.map((v, i) => v / Math.max(polaDi(akhir.length - 1 - i), 0.2)));
    return sahkan(Array.from({ length: h }, (_, k) => tingkat * polaDi(-(k + 1))), h);
  },
};

/** Berjarak berapa bulan dari bulan Lebaran di tahunnya. Di luar -2..+1 dianggap biasa. */
function posisiLebaran(tahun: number, bulan: number): number | null {
  const beda = bulan - bulanLebaran(tahun);
  return beda >= -2 && beda <= 1 ? beda : null;
}

/**
 * Tingkat penjualan terbaru dikali pola di sekitar Lebaran.
 *
 * Mengikuti bulan Lebaran yang bergeser tiap tahun, bukan bulan kalender. Butuh tahu bulan
 * terakhir deret, jadi dibuat per pemanggilan; kalau menang, bentuk `Model` perlu menerima
 * tanggal. Spesifikasi: ini sinyal kalender, bukan bukti penyebab.
 */
export function buatLebaran(bulanAkhir: string): Model {
  return {
    kode: KODE("lebaran"), nama: "Tingkat terbaru dikali pola sekitar Lebaran", minimal: 24,
    ramal(deret, h) {
      if (deret.length < 24) return { ok: false, sebab: "butuh minimal 24 bulan" };
      const [ya, ma] = bulanAkhir.split("-").map(Number);
      const tanggalKe = (i: number) => {
        const t = ya * 12 + (ma - 1) + (i - (deret.length - 1));
        return { y: Math.floor(t / 12), m: (t % 12) + 1 };
      };
      const mulai = Math.max(0, deret.length - 48);
      const biasa: number[] = [];
      const kumpul = new Map<number, number[]>();
      for (let i = mulai; i < deret.length; i++) {
        const { y, m } = tanggalKe(i);
        const p = posisiLebaran(y, m);
        if (p === null) biasa.push(deret[i]);
        else kumpul.set(p, [...(kumpul.get(p) ?? []), deret[i]]);
      }
      const dasar = biasa.length > 0 ? rata(biasa) : 0;
      if (!(dasar > 0)) return { ok: false, sebab: "tidak ada penjualan di bulan biasa" };
      const faktor = (p: number | null) => {
        const n = p === null ? undefined : kumpul.get(p);
        return n && n.length >= 2 ? 1 + 0.5 * (rata(n) / dasar - 1) : 1;
      };
      const akhir = Array.from({ length: 3 }, (_, k) => {
        const i = deret.length - 3 + k;
        const { y, m } = tanggalKe(i);
        return deret[i] / Math.max(faktor(posisiLebaran(y, m)), 0.2);
      });
      const tingkat = rata(akhir);
      return sahkan(Array.from({ length: h }, (_, k) => {
        const { y, m } = tanggalKe(deret.length + k);
        return tingkat * faktor(posisiLebaran(y, m));
      }), h);
    },
  };
}
