import { readFile } from "node:fs/promises";
import { sesiAtau401 } from "@/lib/sesi-server";
import { poolKnowledgeIngest } from "@/lib/db-knowledge-ingest";
import { lokasiBerkas } from "@/lib/kb/unggah";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sesi, balas } = await sesiAtau401();
  if (balas) return balas;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Berkas tidak ditemukan." }, { status: 404 });
  const r = await poolKnowledgeIngest().query<{ file_name: string; file_type: string; access_menus: string | null }>(
    `SELECT file_name, file_type, access_menus FROM ai_knowledge.documents
     WHERE id_document = $1 AND is_active = true AND (access_menus IS NULL OR access_menus = $2)`, [id, sesi.departemen]);
  if (!r.rowCount) return Response.json({ error: "Berkas tidak ditemukan." }, { status: 404 });
  try {
    const isi = await readFile(lokasiBerkas(id, r.rows[0].file_type));
    return new Response(isi, { headers: { "Content-Type": r.rows[0].file_type, "Content-Disposition": `inline; filename="${r.rows[0].file_name.replace(/[\"\r\n]/g, "_")}"` } });
  } catch { return Response.json({ error: "Berkas tidak ditemukan." }, { status: 404 }); }
}
