import { login } from "@/lib/mr-auth";
export async function POST(request: Request) {
  if (new URL(request.url).origin !== request.headers.get("origin")) return Response.json({ error: "Origin tidak diizinkan." }, { status: 403 });
  const form = await request.formData();
  const role = await login(String(form.get("password") ?? ""));
  if (!role) return Response.redirect(new URL("/mr-ai-gateway/login?error=1", request.url), 303);
  return Response.redirect(new URL("/mr-ai-gateway", request.url), 303);
}
