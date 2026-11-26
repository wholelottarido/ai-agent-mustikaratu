/**
 * Tool baru milik tim lain baru dipakai portal sesudah disetujui.
 *
 * `ai_tool` dibagi dengan tim lain, jadi tool baca mereka ikut terpasang begitu didaftarkan.
 * Persetujuan tool TULIS ada di `tulis-disetujui.ts` dan tetap berlaku sesudah tinjauan ini:
 * tool tulis yang baru perlu dua-duanya.
 *
 * ⚠️ DAFTAR KOSONG BERARTI PENJAGA BELUM DIPASANG, BUKAN SEMUA BARU. Kalau kosong dianggap semua
 * menunggu, satu tabel yang belum diisi membuat seluruh agent kehilangan toolnya sekaligus.
 */
import type mysql from "mysql2/promise";
import { poolPortalAdmin, poolPortalApp } from "./db-portal";
import { lupakanKonfig } from "./ai-konfig";

export type StatusTinjau = "dikenal" | "disetujui" | "ditolak";
export type PetaTinjau = Map<string, StatusTinjau>;
export type HasilTinjau = { ok: true } | { ok: false; sebab: string };

const BELUM_DIPASANG =
  "Tabel tinjauan belum dipasang. Jalankan sebagai root: " +
  'mysql -u root portal -e "source db/portal/23_tool_tinjau.sql", lalu npm run tinjau:isi-awal';

const belumAda = (e: unknown) => {
  const kode = (e as { code?: string }).code;
  return kode === "ER_NO_SUCH_TABLE" || kode === "ER_TABLEACCESS_DENIED_ERROR";
};

export async function bacaTinjauan(): Promise<PetaTinjau> {
  try {
    const [baris] = await poolPortalApp().query<mysql.RowDataPacket[]>(
      "SELECT tool_kode, status FROM ai_tool_tinjau",
    );
    return new Map(baris.map((b) => [b.tool_kode as string, b.status as StatusTinjau]));
  } catch (e) {
    if (belumAda(e)) {
      console.warn(`[tinjau-tool] ${BELUM_DIPASANG}`);
      return new Map();
    }
    throw e;
  }
}

/** `null` = belum ada keputusan, jadi menunggu. Peta kosong = penjaga belum dipasang. */
export function statusTool(peta: PetaTinjau, kode: string): StatusTinjau | "menunggu" {
  if (peta.size === 0) return "dikenal";
  return peta.get(kode) ?? "menunggu";
}

export async function putuskanTool(kode: string, status: "disetujui" | "ditolak", oleh: number): Promise<HasilTinjau> {
  try {
    await poolPortalAdmin().query(
      `INSERT INTO ai_tool_tinjau (tool_kode, status, oleh) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), oleh = VALUES(oleh), dibuat = CURRENT_TIMESTAMP`,
      [kode, status, oleh],
    );
  } catch (e) {
    if (belumAda(e)) return { ok: false, sebab: BELUM_DIPASANG };
    throw e;
  }
  lupakanKonfig();
  return { ok: true };
}

/** Membatalkan penolakan: tool kembali menunggu keputusan. */
export async function batalkanTolak(kode: string): Promise<HasilTinjau> {
  try {
    await poolPortalAdmin().query("DELETE FROM ai_tool_tinjau WHERE tool_kode = ? AND status = 'ditolak'", [kode]);
  } catch (e) {
    if (belumAda(e)) return { ok: false, sebab: BELUM_DIPASANG };
    throw e;
  }
  lupakanKonfig();
  return { ok: true };
}
