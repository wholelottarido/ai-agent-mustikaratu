import { z } from "zod";
import { session } from "@/lib/mr-auth";
import { changeKey, GatewayError } from "@/lib/mr-gateway";
export async function POST(request: Request) {
  const current = await session(); if (!current) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  if (current.role !== "admin") return Response.json({ error: "Akses admin diperlukan." }, { status: 403 });
  if (new URL(request.url).origin !== request.headers.get("origin")) return Response.json({ error: "Origin tidak diizinkan." }, { status: 403 });
  try {
    const body = z.object({ action: z.enum(["block", "unblock", "delete"]), key: z.string().min(1).max(200) }).parse(await request.json());
    return Response.json(await changeKey(body.action, body.key), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : error instanceof z.ZodError ? 400 : 502;
    return Response.json({ error: error instanceof GatewayError ? error.message : status === 400 ? "Data permintaan tidak valid." : "Gateway tidak dapat memproses permintaan." }, { status });
  }
}
