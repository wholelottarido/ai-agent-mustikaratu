import { z } from "zod";
import { session } from "@/lib/mr-auth";
import { changeKey, createVirtualKey, GatewayError } from "@/lib/mr-gateway";
export async function GET() {
  const current = await session(); if (!current) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  return Response.json({ error: "Gunakan tampilan server untuk metadata key." }, { status: 405 });
}
export async function POST(request: Request) {
  const current = await session(); if (!current) return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
  if (current.role !== "admin") return Response.json({ error: "Akses admin diperlukan." }, { status: 403 });
  if (new URL(request.url).origin !== request.headers.get("origin")) return Response.json({ error: "Origin tidak diizinkan." }, { status: 403 });
  try {
    const body = await request.json();
    const parsed = z.object({ action: z.enum(["create", "block", "unblock", "delete"]), user_id: z.string().optional(), key_alias: z.string().optional(), models: z.array(z.string()).optional(), duration: z.string().optional(), rpm_limit: z.number().optional(), tpm_limit: z.number().optional(), max_parallel_requests: z.number().optional(), max_budget: z.number().optional(), key: z.string().optional() }).parse(body);
    if (parsed.action === "create") {
      const key = await createVirtualKey({ user_id: parsed.user_id ?? "", key_alias: parsed.key_alias ?? "", models: parsed.models ?? [], duration: parsed.duration, rpm_limit: parsed.rpm_limit, tpm_limit: parsed.tpm_limit, max_parallel_requests: parsed.max_parallel_requests, max_budget: parsed.max_budget });
      return Response.json({ key: key.key }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const result = await changeKey(parsed.action, parsed.key ?? "");
    return Response.json(result);
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : error instanceof z.ZodError ? 400 : 502;
    return Response.json({ error: error instanceof GatewayError ? error.message : status === 400 ? "Data permintaan tidak valid." : "Gateway tidak dapat memproses permintaan." }, { status });
  }
}
