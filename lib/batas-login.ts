/**
 * Pembatas percobaan login.
 *
 * KENAPA ADA: password demo sengaja dibuat simple (`marketing1`/`marketing1`).
 * Selama aplikasi cuma hidup di localhost itu tidak masalah. Begitu dipasang
 * di balik tunnel dan punya URL publik, password sependek itu bisa ditebak
 * skrip dalam hitungan detik. Ini yang menahannya.
 *
 * ⚠️ BATASANNYA -- baca sebelum mengandalkan ini:
 *
 * 1. Disimpan di MEMORI PROSES. Restart server = semua hitungan hilang.
 *    Cukup untuk satu laptop; TIDAK cukup kalau nanti jalan multi-instance.
 * 2. Kuncinya alamat IP. Orang yang punya banyak IP tetap bisa mencoba lagi.
 *    Ini memperlambat, bukan menutup.
 * 3. Di balik Cloudflare, IP asli datang dari header `cf-connecting-ip`.
 *    Kalau aplikasi juga bisa dijangkau LANGSUNG (mis. lewat LAN), header itu
 *    bisa dipalsukan penyerang untuk mendapat kunci baru tiap percobaan.
 *    Jadi ini berguna justru karena aksesnya lewat tunnel.
 *
 * Perlindungan sebenarnya tetap: password yang layak. Ini lapis kedua.
 */

/** Gagal sebanyak ini berturut-turut, lalu diblokir. */
const BATAS_GAGAL = 5;

/** Lama blokir setelah batas terlampaui. */
const BLOKIR_MS = 15 * 60 * 1000;

/** Hitungan gagal dilupakan kalau sudah selama ini tidak ada percobaan. */
const LUPA_MS = 60 * 60 * 1000;

/**
 * Batas jumlah IP yang diingat. Tanpa ini, penyerang yang memalsukan IP tiap
 * percobaan bisa membuat map-nya tumbuh terus sampai memori habis -- jadi
 * pengamanan ini malah berubah jadi cara mematikan aplikasi.
 */
const MAKS_IP = 10_000;

type Catatan = { gagal: number; terakhir: number };

/**
 * Disimpan di globalThis supaya hot-reload Next.js tidak mengosongkannya
 * tiap kali file berubah -- sama pola dengan pool database dan agent.
 */
const KUNCI = Symbol.for("portal.batas-login");
type Global = typeof globalThis & { [KUNCI]?: Map<string, Catatan> };

function catatan(): Map<string, Catatan> {
  const g = globalThis as Global;
  g[KUNCI] ??= new Map();
  return g[KUNCI];
}

/** Buang catatan yang sudah basi, dan paksa turun kalau map-nya kebesaran. */
function bersihkan(map: Map<string, Catatan>, sekarang: number) {
  for (const [ip, c] of map) {
    if (sekarang - c.terakhir > LUPA_MS) map.delete(ip);
  }
  // Masih kebesaran? Buang yang paling lama tidak aktif. Map di JS menjaga
  // urutan penyisipan, tapi itu bukan urutan aktivitas -- jadi diurutkan.
  if (map.size > MAKS_IP) {
    const urut = [...map.entries()].sort((a, b) => a[1].terakhir - b[1].terakhir);
    for (const [ip] of urut.slice(0, map.size - MAKS_IP)) map.delete(ip);
  }
}

/**
 * Ambil IP pemanggil.
 *
 * `cf-connecting-ip` didahulukan: Cloudflare menulisnya sendiri dan menimpa
 * apa pun yang dikirim klien. `x-forwarded-for` bisa berisi rantai, yang
 * pertama adalah klien asli.
 */
export function ambilIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  return "tidak-diketahui";
}

/**
 * Cek apakah IP ini sedang diblokir.
 *
 * @returns sisa detik blokir, atau 0 kalau boleh mencoba.
 */
export function sisaBlokir(ip: string): number {
  const c = catatan().get(ip);
  if (!c || c.gagal < BATAS_GAGAL) return 0;

  const lewat = Date.now() - c.terakhir;
  if (lewat >= BLOKIR_MS) {
    // Masa blokir habis -- beri kesempatan lagi dari nol.
    catatan().delete(ip);
    return 0;
  }
  return Math.ceil((BLOKIR_MS - lewat) / 1000);
}

/** Dipanggil setiap login GAGAL. */
export function catatGagal(ip: string): void {
  const map = catatan();
  const sekarang = Date.now();
  bersihkan(map, sekarang);

  const c = map.get(ip);
  map.set(ip, { gagal: (c?.gagal ?? 0) + 1, terakhir: sekarang });
}

/** Dipanggil setiap login BERHASIL -- hitungan direset. */
export function catatBerhasil(ip: string): void {
  catatan().delete(ip);
}
