/**
 * Sambungan tool -> agent milik portal ini.
 *
 * ⚠️ DISIMPAN DI DATABASE KITA, BUKAN DI `ai_agent_tool` MEREKA.
 *
 * Tabel itu dibaca juga oleh sistem AI tim lain yang sedang dipakai orang;
 * menambah baris di sana berarti mengubah tool agent mereka dari sisi kita,
 * tanpa mereka tahu. Pembaca konfigurasi menggabungkan dua sumber; sistem
 * mereka tidak melihat tabel ini sama sekali.
 *
 * ⚠️ HANYA TOOL MILIK KITA yang boleh disambungkan. Menyambungkan tool mereka
 * ke agent lain berarti memindahkan kemampuan antar-sistem lewat tabel yang
 * mereka tidak tahu ada — persis hal yang kita hindari sejak awal.
 */
import mysql from "mysql2/promise";
import { poolPortalApp, poolPortalAdmin } from "./db-portal";
import { muatKonfig, lupakanKonfig } from "./ai-konfig";

const PEMILIK = "magang";

/**
 * Pool admin — menyambung/memutus menulis, dan `portal_app` cuma punya SELECT.
 * Pola yang sama dengan `sumber-db.ts`: jalur chat tidak boleh punya kuasa
 * mengubah sambungan tool.
 *
 * ⚠️ Definisinya pindah ke `db-portal.ts` (13 Okt 2026) supaya `tulis-disetujui.ts`
 * memakai pool YANG SAMA. Dua pool untuk satu user MySQL berarti jatah
 * koneksinya dijumlahkan terhadap `MAX_USER_CONNECTIONS` — kekeliruan yang
 * sudah pernah terjadi pada `portal_app`.
 */

export type Sambungan = { agentKode: string; toolKode: string };

/**
 * Dua daftar, berlawanan arah.
 *
 *   `pasang` -> tool KITA yang ditambahkan ke sebuah agent.
 *   `lepas`  -> tool MEREKA yang TIDAK dipasang portal ini.
 *
 * ⚠️ Yang `lepas` tidak menghapus apa pun di database mereka. `ai_tool` dan
 * `ai_agent_tool` di PostgreSQL perusahaan tetap utuh, dan sistem AI tim lain
 * tetap memakainya. Yang berubah cuma apa yang dirakit portal ini.
 */
export type DaftarSambungan = { pasang: Sambungan[]; lepas: Sambungan[] };

/**
 * Semua sambungan tambahan. Dibaca tiap `muatKonfig()`, jadi lewat pool baca.
 *
 * Tabelnya belum ada = belum ada sambungan, BUKAN galat. Portal harus tetap
 * jalan sebelum `db/portal/19_tool_agent.sql` dijalankan — fitur yang belum
 * dipasang tidak boleh mematikan chat.
 */
export async function sambunganTool(): Promise<DaftarSambungan> {
  try {
    // ⚠️ `COALESCE(mode,'pasang')` supaya baris lama -- yang dibuat sebelum
    // kolom `mode` ada -- tetap berarti "dipasang", persis artinya selama ini.
    const [baris] = await poolPortalApp().query<mysql.RowDataPacket[]>(
      "SELECT agent_kode, tool_kode, COALESCE(mode, 'pasang') AS mode FROM ai_tool_agent",
    );
    const pasang: Sambungan[] = [];
    const lepas: Sambungan[] = [];
    for (const b of baris) {
      const s = { agentKode: b.agent_kode as string, toolKode: b.tool_kode as string };
      (b.mode === "lepas" ? lepas : pasang).push(s);
    }
    return { pasang, lepas };
  } catch (e) {
    const kode = (e as { code?: string }).code;
    // ⚠️ DUA GALAT, SATU ARTI — dan itu jebakan.
    //
    // Tabel yang belum ada dibalas `ER_NO_SUCH_TABLE`. TAPI kalau role-nya
    // tidak punya hak SELECT, MySQL membalas `ER_TABLEACCESS_DENIED_ERROR`
    // untuk tabel yang belum ada MAUPUN yang sudah ada — dia sengaja tidak
    // membocorkan tabel mana yang eksis.
    //
    // Keduanya dianggap "belum ada sambungan" supaya chat tetap jalan, tapi
    // yang kedua DICATAT: kalau hak itu hilang setelah tabelnya dipasang,
    // sambungan manual berhenti bekerja tanpa satu pun tanda.
    if (kode === "ER_NO_SUCH_TABLE") return { pasang: [], lepas: [] };
    if (kode === "ER_TABLEACCESS_DENIED_ERROR") {
      console.warn(
        "[sambung-tool] tidak bisa membaca ai_tool_agent — tabelnya belum dipasang, " +
          "atau role portal tidak diberi SELECT. Jalankan db/portal/19_tool_agent.sql sebagai root.",
      );
      return { pasang: [], lepas: [] };
    }
    // Kolom `mode` belum ada -> `db/portal/20_tool_lepas.sql` belum dijalankan.
    // Sambungan lama tetap dibaca; yang hilang cuma kemampuan melepas.
    if (kode === "ER_BAD_FIELD_ERROR") {
      console.warn(
        "[sambung-tool] kolom `mode` belum ada di ai_tool_agent. " +
          "Jalankan db/portal/20_tool_lepas.sql sebagai root supaya tool bisa dilepas dari layar.",
      );
      const [lama] = await poolPortalApp().query<mysql.RowDataPacket[]>(
        "SELECT agent_kode, tool_kode FROM ai_tool_agent",
      );
      return {
        pasang: lama.map((b) => ({ agentKode: b.agent_kode as string, toolKode: b.tool_kode as string })),
        lepas: [],
      };
    }
    throw e;
  }
}

export type HasilSambung = { ok: true } | { ok: false; sebab: string };

export async function sambungTool(
  agentKode: string,
  toolKode: string,
  oleh: number,
): Promise<HasilSambung> {
  const k = await muatKonfig();

  const agent = k.agent.find((a) => a.kode === agentKode);
  if (!agent) return { ok: false, sebab: `agent "${agentKode}" tidak ada` };
  if (agent.umum) {
    // Agent umum adalah perute: dia memilih agent aplikasi, tidak mengambil
    // data sendiri. Memberinya tool membuat dia menjawab langsung, dan
    // penyaring per-aplikasi jadi bisa dilewati.
    return { ok: false, sebab: "agent umum tidak boleh punya tool — dia perute, bukan penjawab" };
  }

  const semua = [...k.agent.flatMap((a) => a.tool), ...k.lepas];
  const tool = semua.find((t) => t.kode === toolKode);
  if (!tool) return { ok: false, sebab: `tool "${toolKode}" tidak ada` };
  if (tool.pemilik !== PEMILIK) {
    return { ok: false, sebab: `tool "${toolKode}" bukan milik portal ini — tidak bisa disambungkan dari sini` };
  }

  if (agent.tool.some((t) => t.kode === toolKode)) {
    return { ok: false, sebab: `${agentKode} sudah memakai ${toolKode}` };
  }

  try {
    await poolPortalAdmin().query(
      "INSERT IGNORE INTO ai_tool_agent (agent_kode, tool_kode, oleh) VALUES (?, ?, ?)",
      [agentKode, toolKode, oleh],
    );
  } catch (e) {
    // Tabelnya belum dipasang adalah keadaan yang WAJAR sebelum migrasinya
    // dijalankan -- dan balasan 500 tanpa pesan membuat administrator mengira
    // fiturnya rusak. MySQL menyembunyikan tabel yang belum ada di balik galat
    // izin, jadi dua kode galat berarti hal yang sama di sini.
    const kode = (e as { code?: string }).code;
    if (kode === "ER_NO_SUCH_TABLE" || kode === "ER_TABLEACCESS_DENIED_ERROR") {
      return {
        ok: false,
        sebab:
          "Tabel sambungan belum dipasang. Jalankan sebagai root: " +
          'mysql -u root portal -e "source db/portal/19_tool_agent.sql"',
      };
    }
    throw e;
  }
  lupakanKonfig();
  return { ok: true };
}

export async function putusTool(agentKode: string, toolKode: string): Promise<HasilSambung> {
  // ⚠️ Sengaja TIDAK memeriksa apakah tool-nya masih ada: sambungan ke tool
  // yang sudah dihapus justru yang paling perlu bisa dibersihkan.
  let h: mysql.ResultSetHeader;
  try {
    [h] = await poolPortalAdmin().query<mysql.ResultSetHeader>(
      "DELETE FROM ai_tool_agent WHERE agent_kode = ? AND tool_kode = ?",
      [agentKode, toolKode],
    );
  } catch (e) {
    const kode = (e as { code?: string }).code;
    if (kode === "ER_NO_SUCH_TABLE" || kode === "ER_TABLEACCESS_DENIED_ERROR") {
      return { ok: false, sebab: "Tabel sambungan belum dipasang." };
    }
    throw e;
  }
  lupakanKonfig();
  if (h.affectedRows === 0) {
    return { ok: false, sebab: "sambungan itu tidak ada — mungkin tool ini menempel lewat aturan aplikasi, bukan dari sini" };
  }
  return { ok: true };
}

/**
 * Melepas tool MILIK TIM LAIN dari sebuah agent portal ini.
 *
 * ⚠️ TIDAK MENGHAPUS APA PUN DI DATABASE MEREKA. Baris `ai_tool` dan
 * `ai_agent_tool` di PostgreSQL perusahaan tetap utuh, dan sistem AI tim lain
 * tetap memakainya seperti biasa. Yang berubah cuma apa yang dirakit portal
 * ini — dan itu dicatat di database kita sendiri.
 *
 * ⚠️ HANYA UNTUK TOOL MEREKA. Tool kita sendiri dilepas dengan `putusTool`
 * (menghapus sambungannya) atau dimatikan lewat setelan `aktif`. Memakai
 * jalur ini untuk tool kita akan menyimpan baris "lepas" yang tidak pernah
 * berpengaruh, karena tool kita menempel lewat `id_apps`, bukan lewat tabel
 * mereka — gagal yang diam, dan itu yang dihindari di sini.
 */
export async function lepasTool(
  agentKode: string,
  toolKode: string,
  oleh: number,
): Promise<HasilSambung> {
  const k = await muatKonfig();
  const agent = k.agent.find((a) => a.kode === agentKode);
  if (!agent) return { ok: false, sebab: `agent "${agentKode}" tidak ada` };

  const t = agent.tool.find((x) => x.kode === toolKode);
  if (!t) {
    return { ok: false, sebab: `tool "${toolKode}" tidak sedang dipasang di ${agentKode}` };
  }
  if (t.pemilik === PEMILIK) {
    return {
      ok: false,
      sebab:
        `tool "${toolKode}" milik portal ini — lepaskan lewat sambungannya, ` +
        `atau matikan lewat setelan aktif. Jalur ini untuk tool tim lain.`,
    };
  }

  try {
    await poolPortalAdmin().query(
      "INSERT IGNORE INTO ai_tool_agent (agent_kode, tool_kode, mode, oleh) VALUES (?, ?, 'lepas', ?)",
      [agentKode, toolKode, oleh],
    );
  } catch (e) {
    const kode = (e as { code?: string }).code;
    if (kode === "ER_NO_SUCH_TABLE" || kode === "ER_TABLEACCESS_DENIED_ERROR") {
      return { ok: false, sebab: "Tabel sambungan belum dipasang." };
    }
    if (kode === "ER_BAD_FIELD_ERROR") {
      return {
        ok: false,
        sebab:
          "Kolom `mode` belum ada. Jalankan sebagai root: " +
          'mysql -u root portal -e "source db/portal/20_tool_lepas.sql"',
      };
    }
    throw e;
  }
  lupakanKonfig();
  return { ok: true };
}

/** Memasang kembali tool tim lain yang sebelumnya dilepas. */
export async function pasangLagiTool(agentKode: string, toolKode: string): Promise<HasilSambung> {
  let h: mysql.ResultSetHeader;
  try {
    [h] = await poolPortalAdmin().query<mysql.ResultSetHeader>(
      "DELETE FROM ai_tool_agent WHERE agent_kode = ? AND tool_kode = ? AND mode = 'lepas'",
      [agentKode, toolKode],
    );
  } catch (e) {
    const kode = (e as { code?: string }).code;
    if (kode === "ER_NO_SUCH_TABLE" || kode === "ER_TABLEACCESS_DENIED_ERROR") {
      return { ok: false, sebab: "Tabel sambungan belum dipasang." };
    }
    if (kode === "ER_BAD_FIELD_ERROR") return { ok: false, sebab: "Kolom `mode` belum ada." };
    throw e;
  }
  lupakanKonfig();
  if (h.affectedRows === 0) return { ok: false, sebab: `"${toolKode}" memang tidak sedang dilepas dari ${agentKode}` };
  return { ok: true };
}
