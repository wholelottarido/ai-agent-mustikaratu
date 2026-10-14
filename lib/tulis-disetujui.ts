/**
 * Persetujuan tool TULIS milik tim lain.
 *
 * ============================================================
 * ⚠️ KENAPA INI ADA
 * ============================================================
 * Penjalan tulis umum merakit tool tulis dari BARIS KONFIGURASI, tanpa kode
 * khusus — itu yang membuat "tambah tool tanpa hardcode" jadi nyata. Tapi
 * `ai_tool` juga diisi tim lain, jadi baris tulis MEREKA ikut terakit begitu
 * tabel sasarannya ada di daftar-boleh.
 *
 * Terjadi 13 Okt 2026: tim lain membangun ulang katalognya (140 baris baru
 * dalam sehari, `agent-portal` dari 9 jadi 21 tool), dan dua tool tulis ke
 * `portal_ticket` langsung hidup di portal ini tanpa ditinjau siapa pun.
 * Salah satunya `batalkan_tiket` — tool yang MINGGU SEBELUMNYA dihapus dari
 * portal ini atas permintaan tim IT. Dia kembali bukan karena ada yang
 * memutuskan, tapi karena katalog sebelah berubah.
 *
 * Penjagaan teknis lain tidak bocor: daftar-boleh tabel menolak `jobdesk`,
 * hak per-kolom role `ai_tulis` tetap membatasi kolomnya, penyaring pemilik
 * selalu ikut, dan rancangan tetap cuma bisa disimpan tombol yang ditekan
 * manusia. Yang hilang satu hal: KEPUTUSAN. Modul ini yang memulihkannya.
 *
 * ============================================================
 * ⚠️ KODE SAJA TIDAK CUKUP — OPERASI DAN TABEL IKUT DICOCOKKAN
 * ============================================================
 * Baris `ai_tool` mereka bisa berubah kapan saja tanpa kita tahu. Persetujuan
 * yang cuma menyimpan kode akan tetap berlaku untuk tool yang isinya sudah
 * berbeda: `tutup_tiket` yang disetujui sebagai `hapus` pada `portal_ticket`
 * bisa jadi `ubah` pada tabel lain besok, dengan kode yang sama.
 *
 * Jadi yang disimpan tiga-tiganya, dan `disetujui()` mencocokkan ketiganya.
 * Yang berubah kembali jadi belum-disetujui — bukan galat, tapi juga bukan
 * diam: alasannya tercetak di `dilewati` seperti tool lain yang dilewati.
 */
import type mysql from "mysql2/promise";
import { poolPortalApp, poolPortalAdmin } from "./db-portal";
import { lupakanKonfig } from "./ai-konfig";

export type TulisDisetujui = {
  toolKode: string;
  operasi: string;
  tabel: string;
  oleh: number;
  dibuat: Date | null;
};

/**
 * Seluruh persetujuan yang tercatat.
 *
 * Tabelnya belum ada = belum ada persetujuan, BUKAN galat. Portal harus tetap
 * jalan sebelum `db/portal/21_tulis_disetujui.sql` dijalankan — dan arah
 * gagalnya benar: tanpa tabel itu, tidak ada tool tulis tim lain yang dirakit.
 */
export async function daftarTulisDisetujui(): Promise<TulisDisetujui[]> {
  try {
    const [baris] = await poolPortalApp().query<mysql.RowDataPacket[]>(
      "SELECT tool_kode, operasi, tabel, oleh, dibuat FROM ai_tulis_disetujui",
    );
    return baris.map((b) => ({
      toolKode: b.tool_kode as string,
      operasi: b.operasi as string,
      tabel: b.tabel as string,
      oleh: b.oleh as number,
      dibuat: (b.dibuat as Date | null) ?? null,
    }));
  } catch (e) {
    const kode = (e as { code?: string }).code;
    // ⚠️ DUA GALAT, SATU ARTI. Tabel yang belum ada dibalas `ER_NO_SUCH_TABLE`,
    // tapi kalau role-nya tidak punya SELECT, MySQL membalas
    // `ER_TABLEACCESS_DENIED_ERROR` untuk tabel yang belum ada MAUPUN yang
    // sudah ada — dia sengaja tidak membocorkan tabel mana yang eksis.
    if (kode === "ER_NO_SUCH_TABLE") return [];
    if (kode === "ER_TABLEACCESS_DENIED_ERROR") {
      console.warn(
        "[tulis-disetujui] tidak bisa membaca ai_tulis_disetujui — tabelnya belum " +
          "dipasang, atau role portal tidak diberi SELECT. Jalankan sebagai root: " +
          'mysql -u root portal -e "source db/portal/21_tulis_disetujui.sql"',
      );
      return [];
    }
    throw e;
  }
}

export type HasilSetuju = { ok: true } | { ok: false; sebab: string };

const BELUM_DIPASANG =
  "Tabel persetujuan belum dipasang. Jalankan sebagai root: " +
  'mysql -u root portal -e "source db/portal/21_tulis_disetujui.sql"';

/**
 * Menyetujui satu tool tulis milik tim lain.
 *
 * ⚠️ `operasi` dan `tabel` DATANG DARI PEMANGGIL, bukan dari badan permintaan.
 * Route membacanya dari konfigurasi yang sedang berlaku, supaya yang tercatat
 * adalah tool yang benar-benar ditinjau — bukan yang diakui peramban.
 */
export async function setujuiTulis(
  toolKode: string,
  operasi: string,
  tabel: string,
  oleh: number,
): Promise<HasilSetuju> {
  try {
    await poolPortalAdmin().query(
      `INSERT INTO ai_tulis_disetujui (tool_kode, operasi, tabel, oleh)
         VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE operasi = VALUES(operasi), tabel = VALUES(tabel),
                               oleh = VALUES(oleh), dibuat = CURRENT_TIMESTAMP`,
      [toolKode, operasi, tabel, oleh],
    );
  } catch (e) {
    const kode = (e as { code?: string }).code;
    if (kode === "ER_NO_SUCH_TABLE" || kode === "ER_TABLEACCESS_DENIED_ERROR") {
      return { ok: false, sebab: BELUM_DIPASANG };
    }
    throw e;
  }
  lupakanKonfig();
  return { ok: true };
}

/** Mencabut persetujuan. Tool-nya berhenti dirakit portal ini, tidak dihapus. */
export async function cabutTulis(toolKode: string): Promise<HasilSetuju> {
  let h: mysql.ResultSetHeader;
  try {
    [h] = await poolPortalAdmin().query<mysql.ResultSetHeader>(
      "DELETE FROM ai_tulis_disetujui WHERE tool_kode = ?",
      [toolKode],
    );
  } catch (e) {
    const kode = (e as { code?: string }).code;
    if (kode === "ER_NO_SUCH_TABLE" || kode === "ER_TABLEACCESS_DENIED_ERROR") {
      return { ok: false, sebab: BELUM_DIPASANG };
    }
    throw e;
  }
  lupakanKonfig();
  if (h.affectedRows === 0) return { ok: false, sebab: `"${toolKode}" memang belum disetujui` };
  return { ok: true };
}
