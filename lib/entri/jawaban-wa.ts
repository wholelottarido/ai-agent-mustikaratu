/**
 * Penguraian balasan konfirmasi di WhatsApp.
 *
 * Dipisah dari `wa-bot/index.mts` supaya bisa diuji tanpa menyalakan bot dan
 * tanpa nomor WhatsApp — bagian ini yang paling rawan salah tafsir, dan salah
 * tafsir di sini berarti mengubah data yang tidak dimaksud user.
 *
 * ⚠️ MASALAHNYA: "BATAL" PUNYA DUA ARTI.
 *
 * Untuk draf ENTRI, "BATAL" jelas: buang drafnya, jangan simpan.
 * Untuk draf PEMBATALAN, "BATAL" bisa berarti "ya, batalkan ordernya" ATAU
 * "jangan jadi membatalkan". Dua-duanya masuk akal.
 *
 * Karena itu untuk draf pembatalan kata "BATAL" TIDAK ditebak — user diminta
 * memperjelas. Konfirmasinya pakai "YA <alasan>" dan penolakannya "URUNG".
 */

const SETUJU = ["ya", "y", "iya", "ok", "oke", "batalkan"];
const URUNG = ["urung", "tidak", "no", "gak", "engga", "jangan"];
const AMBIGU = ["batal", "cancel"];

export type JawabanBatal =
  /** "YA salah pelanggan" — lanjutkan, alasannya sudah ada. */
  | { aksi: "batalkan"; alasan: string }
  /** "YA" polos — drafnya DIPERTAHANKAN, user tinggal mengulang dengan alasan. */
  | { aksi: "minta-alasan" }
  /** "URUNG" — buang drafnya, jangan ubah apa pun. */
  | { aksi: "urung" }
  /** "BATAL" — dua arti, minta user memperjelas. Draf dipertahankan. */
  | { aksi: "ambigu" }
  /** Bukan jawaban konfirmasi; perlakukan sebagai permintaan baru. */
  | { aksi: "bukan-jawaban" };

export function bacaJawabanBatal(teks: string): JawabanBatal {
  const utuh = teks.trim();
  const pendek = utuh.toLowerCase();

  // Dicek lebih dulu daripada daftar kata: "batalkan pesanan salah" harus
  // terbaca sebagai konfirmasi + alasan, bukan sebagai kata "batalkan" saja.
  const cocok = utuh.match(/^(ya|y|iya|ok|oke|batalkan)\s+(.+)$/i);
  if (cocok) {
    const alasan = cocok[2].trim();
    if (alasan !== "") return { aksi: "batalkan", alasan };
  }

  if (SETUJU.includes(pendek)) return { aksi: "minta-alasan" };
  if (URUNG.includes(pendek)) return { aksi: "urung" };
  if (AMBIGU.includes(pendek)) return { aksi: "ambigu" };
  return { aksi: "bukan-jawaban" };
}

/** Balasan untuk draf ENTRI — di sini "BATAL" tidak ambigu. */
export type JawabanEntri = "simpan" | "buang" | "bukan-jawaban";

export function bacaJawabanEntri(teks: string): JawabanEntri {
  const pendek = teks.trim().toLowerCase();
  if (["ya", "y", "iya", "ok", "oke", "simpan"].includes(pendek)) return "simpan";
  if (["batal", "tidak", "no", "gak", "engga"].includes(pendek)) return "buang";
  return "bukan-jawaban";
}

/**
 * Balasan untuk draf KEPUTUSAN lembur.
 *
 * ⚠️ "YA" sengaja TIDAK dipakai di sini.
 *
 * Yang menunggu bukan satu tindakan melainkan DUA pilihan (setujui / tolak),
 * jadi "YA" tidak punya arti tunggal — "ya" bisa berarti "ya setujui" atau
 * "ya benar, tolak saja". Kata kerjanya harus disebut.
 *
 * Alasan wajib untuk TOLAK, tidak untuk SETUJU: penolakan tanpa alasan tidak
 * berguna buat siapa pun yang membacanya nanti.
 */
export type JawabanKeputusan =
  | { aksi: "setujui" }
  | { aksi: "tolak"; alasan: string }
  | { aksi: "minta-alasan" }
  | { aksi: "urung" }
  | { aksi: "ambigu" }
  | { aksi: "bukan-jawaban" };

export function bacaJawabanKeputusan(teks: string): JawabanKeputusan {
  const utuh = teks.trim();
  const pendek = utuh.toLowerCase();

  const tolak = utuh.match(/^(tolak|reject)\s+(.+)$/i);
  if (tolak && tolak[2].trim() !== "") return { aksi: "tolak", alasan: tolak[2].trim() };

  if (["setuju", "setujui", "approve", "acc"].includes(pendek)) return { aksi: "setujui" };
  if (["tolak", "reject"].includes(pendek)) return { aksi: "minta-alasan" };
  if (["urung", "nanti", "skip", "lewati"].includes(pendek)) return { aksi: "urung" };

  // "YA"/"OK" tidak jelas menunjuk pilihan yang mana.
  if (["ya", "y", "iya", "ok", "oke", "batal", "tidak"].includes(pendek)) return { aksi: "ambigu" };
  return { aksi: "bukan-jawaban" };
}
