/**
 * Pilihan isian yang datang dari TABEL LAIN — kategori, sub-kategori, dan
 * kawan-kawannya.
 *
 * ============================================================
 * ⚠️ KENAPA DIPINDAH KE SINI (21 Okt 2026)
 * ============================================================
 * Logikanya sudah digerakkan setelan sejak awal, tapi ia tinggal di
 * `tiket.ts` — berkas yang ditulis khusus untuk satu tool. Operasi `tambah`
 * lewat penjalan umum membutuhkannya juga, dan menyalinnya berarti dua
 * salinan yang pelan-pelan berbeda.
 *
 * ============================================================
 * ⚠️ DAFTAR-BOLEH TABEL, DAN KENAPA BARU SEKARANG DIPERLUKAN
 * ============================================================
 * `pilihanRelasi()` membaca tabel yang DISEBUT SETELAN. Selama yang
 * memakainya cuma satu baris yang kita tulis sendiri, itu aman.
 *
 * Begitu jalurnya umum, tidak lagi. `ai_tool.kolom_isian` bisa ditulis role
 * `ai_konfig` dari layar, dan tabel itu dibagi dengan tim lain. Satu baris
 * setelan yang menyebut `employee` atau `users` akan memuntahkan isinya ke
 * layar sebagai "pilihan" — dan tidak ada galat apa pun, karena query-nya sah.
 *
 * Jadi tabel yang boleh dibaca untuk pilihan ditulis DI SINI, dan kolom yang
 * boleh diambil ikut disebut. Menambah satu adalah keputusan yang ditinjau,
 * bukan isian borang.
 *
 * ⚠️ BEDA DARI `TABEL_BOLEH` di `tulis-umum.ts`. Yang itu tabel yang boleh
 * DITULIS; yang ini tabel yang boleh DIBACA untuk menyusun daftar pilihan.
 * Dua pertanyaan berbeda, dan menyamakannya berarti tabel rujukan yang
 * read-only jadi ikut bisa ditulis.
 */
import { poolPerusahaan } from "../db-perusahaan";

export type Pilihan = { nilai: string; label: string };

export type IsianPilihan = {
  jenis: "tetap" | "relasi" | string;
  opsi?: { nilai: string; label: string }[];
  tabel?: string;
  kolom_nilai?: string;
  kolom_label?: string;
  saring_tetap?: { kolom: string; nilai: string }[];
  induk?: { isian: string; kolom_relasi: string };
};

/**
 * Tabel yang boleh dibaca untuk menyusun pilihan, beserta kolom yang boleh
 * diambil darinya.
 *
 * Kolomnya ikut dibatasi supaya `kolom_label` tidak bisa diarahkan ke kolom
 * lain di tabel yang sama — "nama kategori" dan "catatan internal" sama-sama
 * kolom teks di mata query.
 */
export const TABEL_PILIHAN: Record<string, string[]> = {
  // Dibaca dari setelan `buat_tiket` yang sudah berjalan, bukan dikarang:
  // kategori disaring `category_type = 'ticket'`, dan sub-kategori ditautkan
  // ke kategori terpilih lewat `id_category`.
  category: ["id_category", "category_name", "category_type"],
  sub_category: ["id_sub_category", "id_category", "sub_category_name"],
};

export type HasilPilihan =
  | { ok: true; opsi: Pilihan[] }
  | { ok: false; sebab: string };

function amanNama(s: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`nama tidak sah: ${s}`);
  return `"${s}"`;
}

/**
 * Memeriksa sebuah definisi pilihan dari setelan, tanpa menjalankan query.
 *
 * Dipisah supaya `bacaKonfigTulis()` bisa menolak baris yang keliru SEBELUM
 * tool-nya dirakit — administrator melihat sebabnya di layar, bukan pemakai
 * yang melihat galat waktu bertanya.
 */
export function periksaPilihan(p: IsianPilihan, kolom: string): { ok: true } | { ok: false; sebab: string } {
  if (p.jenis === "tetap") {
    if (!Array.isArray(p.opsi) || p.opsi.length === 0) {
      return { ok: false, sebab: `pilihan "tetap" pada "${kolom}" tanpa daftar opsi` };
    }
    return { ok: true };
  }
  if (p.jenis !== "relasi") {
    return { ok: false, sebab: `jenis pilihan "${p.jenis}" pada "${kolom}" tidak dikenal; yang ada: tetap, relasi` };
  }
  if (!p.tabel || !p.kolom_nilai || !p.kolom_label) {
    return { ok: false, sebab: `pilihan "relasi" pada "${kolom}" kurang tabel/kolom_nilai/kolom_label` };
  }
  const bolehKolom = TABEL_PILIHAN[p.tabel];
  if (!bolehKolom) {
    return {
      ok: false,
      sebab:
        `tabel pilihan "${p.tabel}" tidak ada di daftar-boleh ` +
        `(${Object.keys(TABEL_PILIHAN).join(", ")})`,
    };
  }
  // Tiap kolom yang ikut ke SQL diperiksa, bukan cuma yang ditampilkan:
  // `saring_tetap` dan `induk.kolom_relasi` juga masuk ke `WHERE`.
  const dipakai = [
    p.kolom_nilai,
    p.kolom_label,
    ...(p.saring_tetap ?? []).map((s) => s.kolom),
    ...(p.induk ? [p.induk.kolom_relasi] : []),
  ];
  for (const k of dipakai) {
    if (!bolehKolom.includes(k)) {
      return { ok: false, sebab: `kolom "${k}" tidak boleh dibaca dari "${p.tabel}" (boleh: ${bolehKolom.join(", ")})` };
    }
  }
  return { ok: true };
}

/**
 * Daftar pilihan untuk satu isian.
 *
 * `indukNilai` diisi kalau pilihannya bertingkat — sub-kategori yang harus
 * milik kategori terpilih. Tanpa itu, daftar yang keluar adalah SELURUH
 * sub-kategori, dan pasangan mustahil ikut lolos.
 */
export async function pilihanRelasi(p: IsianPilihan, indukNilai?: string): Promise<Pilihan[]> {
  if (p.jenis === "tetap") return (p.opsi ?? []).map((o) => ({ nilai: o.nilai, label: o.label }));
  if (!p.tabel || !p.kolom_nilai || !p.kolom_label) return [];

  // ⚠️ DIPERIKSA LAGI DI SINI, bukan cuma waktu setelan dibaca. Pemanggil bisa
  // saja melewatkan `periksaPilihan()`, dan yang dirangkai di bawah ini SQL.
  const periksa = periksaPilihan(p, p.kolom_nilai);
  if (!periksa.ok) throw new Error(periksa.sebab);

  const syarat: string[] = [];
  const nilai: unknown[] = [];
  for (const s of p.saring_tetap ?? []) {
    nilai.push(s.nilai);
    syarat.push(`${amanNama(s.kolom)} = $${nilai.length}`);
  }
  if (p.induk && indukNilai) {
    nilai.push(indukNilai);
    syarat.push(`${amanNama(p.induk.kolom_relasi)} = $${nilai.length}`);
  }
  const { rows } = await poolPerusahaan().query<{ nilai: string; label: string }>(
    `SELECT ${amanNama(p.kolom_nilai)}::text AS nilai, ${amanNama(p.kolom_label)}::text AS label
       FROM ${amanNama(p.tabel)}
      ${syarat.length ? `WHERE ${syarat.join(" AND ")}` : ""}
      ORDER BY 2`,
    nilai,
  );
  return rows;
}

/** Samakan bentuk teks sebelum dibandingkan: beda spasi & huruf besar bukan beda maksud. */
export function rapat(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Cocokkan yang diketik user dengan daftar pilihan.
 *
 * Dicoba persis dulu, baru penggalan. ⚠️ Yang cocok sebagian hanya diterima
 * kalau HANYA SATU yang cocok — "printer" yang cocok dengan dua sub-kategori
 * tidak boleh dipilihkan diam-diam, karena tiket yang masuk ke antrean salah
 * akan dikerjakan orang yang salah.
 *
 * ⚠️ HANYA SATU ARAH: label yang memuat ketikan user, BUKAN sebaliknya.
 *
 * Arah sebaliknya ("ketikan user memuat label") sempat ada, dan ia menerima
 * `"SANGAT MENDESAK SEKALI"` sebagai Mendesak. Kedengarannya membantu — sampai
 * disadari kalimat `"tidak mendesak"` juga memuat kata "mendesak", dan akan
 * dipetakan ke URGENT: kebalikan dari maksudnya, tanpa satu pun pesan galat.
 *
 * Tidak ada cara memisahkan keduanya tanpa benar-benar memahami kalimatnya.
 * Jadi frasa panjang dipulangkan sebagai daftar pilihan, dan model memilih
 * dari daftar itu — gagal yang terlihat, bukan tebakan yang diam.
 *
 * ⚠️ Disalin APA ADANYA dari `tiket.ts` waktu dijadikan milik bersama
 * (21 Okt 2026). Versi pertama yang saya tulis di sini sempat memakai dua arah
 * — persis bug yang sudah ditutup 8 Okt. Kalau logika ini perlu diubah, baca
 * dulu paragraf di atas.
 */
export function cocokkan(diberi: string, daftar: Pilihan[]): Pilihan | Pilihan[] {
  const q = rapat(diberi);
  const persis = daftar.filter((p) => rapat(p.label) === q);
  if (persis.length === 1) return persis[0];
  const penggalan = daftar.filter((p) => rapat(p.label).includes(q));
  if (penggalan.length === 1) return penggalan[0];
  return penggalan.length > 0 ? penggalan : daftar;
}
