/**
 * Pembantu kecil: ambil sesi yang sah di route handler, atau balas 401.
 *
 * Dipakai supaya tiap route tidak mengulang pola yang sama -- dan supaya
 * tidak ada route yang lupa memeriksa sesi.
 */
import { cookies } from "next/headers";
import { bacaToken, NAMA_COOKIE, type Sesi } from "@/lib/sesi";

export async function sesiAtau401(): Promise<
  { sesi: Sesi; balas?: never } | { sesi?: never; balas: Response }
> {
  const sesi = await bacaToken((await cookies()).get(NAMA_COOKIE)?.value);
  if (!sesi) {
    return {
      balas: Response.json(
        { error: "Belum login atau sesi sudah habis. Silakan masuk lagi." },
        { status: 401 },
      ),
    };
  }
  return { sesi };
}
