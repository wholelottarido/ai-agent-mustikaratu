import { logout } from "@/lib/mr-auth";
export async function POST(request: Request) { if (new URL(request.url).origin !== request.headers.get("origin")) return Response.json({ error: "Origin tidak diizinkan." }, { status: 403 }); await logout(); return Response.redirect(new URL("/login", request.url), 303); }
