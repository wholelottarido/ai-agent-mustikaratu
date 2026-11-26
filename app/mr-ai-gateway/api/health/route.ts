import { getHealth } from "@/lib/mr-gateway";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json(await getHealth(), { headers: { "Cache-Control": "no-store" } }); }
