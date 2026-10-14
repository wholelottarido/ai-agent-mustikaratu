/**
 * Hash & verifikasi password.
 *
 * Pakai `scrypt` bawaan Node -- tidak perlu dependency tambahan, dan lebih
 * tahan serangan GPU dibanding bcrypt karena butuh memori besar.
 *
 * HANYA untuk runtime Node (route handler). JANGAN di-import dari middleware:
 * middleware Next.js jalan di edge runtime yang tidak punya `node:crypto`.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const PANJANG_KUNCI = 64;

/**
 * Format yang disimpan: `scrypt:<salt hex>:<hash hex>`.
 * Diawali nama algoritma supaya kalau nanti ganti ke yang lain,
 * hash lama tetap bisa dikenali dan diverifikasi.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, PANJANG_KUNCI);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function cekPassword(password: string, tersimpan: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = tersimpan.split(":");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;

  const hashTersimpan = Buffer.from(hashHex, "hex");
  if (hashTersimpan.length !== PANJANG_KUNCI) return false;

  const hashBaru = await scryptAsync(password, Buffer.from(saltHex, "hex"), PANJANG_KUNCI);

  // timingSafeEqual, bukan ===. Perbandingan string biasa berhenti di byte
  // pertama yang beda, jadi lama-perbandingannya membocorkan berapa banyak
  // karakter awal yang sudah benar.
  return timingSafeEqual(hashBaru, hashTersimpan);
}
