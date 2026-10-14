import { cookies } from "next/headers";
import { opsiCookie, lewatHttps, NAMA_COOKIE } from "@/lib/sesi";

export async function POST(req: Request) {
  // maxAge 0 -- opsi lainnya harus sama persis dengan waktu dibuat,
  // kalau beda browser tidak menganggapnya cookie yang sama.
  (await cookies()).set(NAMA_COOKIE, "", opsiCookie(true, lewatHttps(req)));
  return Response.json({ ok: true });
}
