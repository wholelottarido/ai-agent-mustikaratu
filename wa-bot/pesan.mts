/**
 * Penyaring pesan masuk WhatsApp.
 *
 * DIPISAH dari `index.mts` supaya bisa diuji: berkas itu menyambung ke
 * WhatsApp begitu di-import, jadi apa pun yang ada di dalamnya tidak bisa
 * disentuh tes tanpa ikut menyalakan bot.
 *
 * ⚠️ Penyaring ini juga PENGAMAN, bukan cuma penyederhanaan.
 * `baileys@6.17.16` membawa celah infinite loop di parser media
 * (`music-metadata`, `file-type`). Selama pesan non-teks ditolak di sini dan
 * media tidak pernah diunduh, parser itu tidak pernah dijalankan.
 */
import type { proto } from "baileys";

/** Ambil teks dari pesan. `null` kalau ini bukan pesan teks. */
export function ambilTeks(pesan: proto.IWebMessageInfo): string | null {
  const m = pesan.message;
  if (!m) return null;

  // Dua bentuk pesan teks di WhatsApp: polos (`conversation`), dan yang punya
  // konteks seperti balasan atau link preview (`extendedTextMessage`).
  // Selain ini -- gambar, audio, stiker, dokumen, lokasi -- sengaja TIDAK
  // ditangani.
  const teks = m.conversation ?? m.extendedTextMessage?.text ?? null;
  return teks && teks.trim() !== "" ? teks.trim() : null;
}

/**
 * Pesan ini layak diproses?
 *
 * @returns alasan penolakan untuk dicatat, atau `null` kalau lolos.
 */
export function alasanDilewati(pesan: proto.IWebMessageInfo): string | null {
  const jid = pesan.key.remoteJid ?? "";

  if (pesan.key.fromMe) return "pesan dari bot sendiri";
  if (jid.endsWith("@g.us")) return "pesan grup";
  if (jid === "status@broadcast") return "status/story";
  if (jid.endsWith("@broadcast")) return "broadcast";
  if (!ambilTeks(pesan)) return "bukan pesan teks";

  return null;
}
