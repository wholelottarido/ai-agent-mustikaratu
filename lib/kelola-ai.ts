/**
 * Ringkasan untuk layar pengaturan AI: agent dan sumber data.
 *
 * Tool-nya ada di `ubah-tool.ts` karena yang itu ikut bisa diubah; dua ini
 * MURNI TAMPILAN. Role `ai_konfig` sengaja tidak punya hak `UPDATE` pada
 * `ai_agent` maupun `ai_sumber_data` — mengubah agent berarti mengubah
 * perilaku sistem tim lain juga, dan mengubah sumber data berarti mengganti
 * view yang dibaca tool mereka.
 *
 * ⚠️ KARENA ITU LAYARNYA TIDAK BOLEH MENGGAMBAR SAKLAR. Centang yang tidak
 * mengubah apa pun lebih buruk daripada tidak ada centang: administrator
 * menekannya, tidak terjadi apa-apa, dan dia tidak punya cara tahu kenapa.
 * Keadaan ditampilkan sebagai keadaan, dengan keterangan di mana mengubahnya.
 */
import { poolPerusahaan } from "./db-perusahaan";
import { muatKonfig } from "./ai-konfig";
import { ringkasTool, type ToolTampil } from "./ubah-tool";
import { sambunganTool } from "./sambung-tool";

export type AgentTampil = {
  kode: string;
  nama: string;
  deskripsi: string | null;
  /** Nama aplikasi yang dipegang. `null` untuk agent lintas aplikasi. */
  aplikasi: string | null;
  /** Aplikasi tambahan lewat `apps_lain`, mis. Supertools Mobile. */
  aplikasiLain: string[];
  umum: boolean;
  aktif: boolean;
  jumlahTool: number;
  /** Berapa di antaranya yang bisa diubah dari layar ini. */
  toolKita: number;
};

export async function ringkasAgent(): Promise<AgentTampil[]> {
  const k = await muatKonfig();

  // Nama aplikasi tidak ada di `ai_agent` — cuma `id_apps`. Diambil sekali
  // untuk semuanya, bukan satu query per agent.
  const { rows } = await poolPerusahaan().query<{ id_apps: string; apps_name: string }>(
    `SELECT id_apps, apps_name FROM apps`,
  );
  const nama = new Map(rows.map((r) => [r.id_apps, r.apps_name]));

  return k.agent.map((a) => ({
    kode: a.kode,
    nama: a.nama,
    deskripsi: a.deskripsi,
    aplikasi: a.idApps ? (nama.get(a.idApps) ?? "(aplikasi tidak dikenal)") : null,
    aplikasiLain: a.appsLain.map((id) => nama.get(id) ?? "(tidak dikenal)"),
    umum: a.umum,
    aktif: a.aktif,
    jumlahTool: a.tool.length,
    toolKita: a.tool.filter((t) => t.pemilik === "magang").length,
  }));
}

export type SumberTampil = {
  kode: string;
  nama: string;
  view: string;
  tabelAsal: string | null;
  /** Cakupan yang mungkin, dari kolom penyaring yang ada. */
  penyaring: { employee: string | null; departemen: string | null; perusahaan: string | null };
  jumlahKolom: number;
  /** Berapa tool memakainya. */
  dipakai: number;
  milikKita: boolean;
};

export async function ringkasSumber(): Promise<SumberTampil[]> {
  const k = await muatKonfig();
  const semua = [...k.agent.flatMap((a) => a.tool), ...k.lepas];

  // Satu baris per sumber, bukan per tool yang memakainya.
  const sumber = new Map<string, SumberTampil>();
  for (const t of semua) {
    if (!t.sumber) continue;
    const ada = sumber.get(t.sumber.kode);
    if (ada) {
      ada.dipakai += 1;
      continue;
    }
    sumber.set(t.sumber.kode, {
      kode: t.sumber.kode,
      nama: t.sumber.nama,
      view: t.sumber.view,
      tabelAsal: t.sumber.tabelAsal,
      penyaring: {
        employee: t.sumber.penyaring.employee,
        departemen: t.sumber.penyaring.departemen,
        perusahaan: t.sumber.penyaring.perusahaan,
      },
      jumlahKolom: t.sumber.kolom.length,
      dipakai: 1,
      milikKita: t.pemilik === "magang",
    });
  }

  return [...sumber.values()].sort((a, b) => a.kode.localeCompare(b.kode));
}

export type RincianAgent = {
  agent: AgentTampil;
  tool: ToolTampil[];
  /**
   * Tool milik portal ini yang BELUM dipakai agent ini, jadi bisa disambungkan.
   *
   * Tool milik tim lain tidak pernah masuk daftar: menyambungkannya ke agent
   * lain berarti memindahkan kemampuan antar-sistem lewat tabel yang mereka
   * tidak tahu ada.
   */
  bisaDitambah: { kode: string; nama: string; view: string | null }[];
  /** Tool yang menempel lewat sambungan manual, bukan lewat kecocokan aplikasi. */
  manual: string[];
  /**
   * Tool MEREKA yang dilepas dari agent ini.
   *
   * ⚠️ Ditampilkan, bukan disembunyikan. Tool yang hilang tanpa keterangan
   * membuat administrator mengira ia tidak pernah ada — padahal barisnya masih
   * utuh di database tim lain dan sistem mereka masih memakainya.
   */
  dilepas: string[];
};

export async function rincianAgent(kode: string): Promise<RincianAgent | undefined> {
  const [semuaAgent, semuaTool, sambungan] = await Promise.all([
    ringkasAgent(),
    ringkasTool(),
    sambunganTool(),
  ]);

  const agent = semuaAgent.find((a) => a.kode === kode);
  if (!agent) return undefined;

  const tool = semuaTool.filter((t) => t.agent === agent.nama);
  const dipakai = new Set(tool.map((t) => t.kode));

  return {
    agent,
    tool,
    bisaDitambah: semuaTool
      .filter((t) => t.milikKita && !dipakai.has(t.kode))
      .map((t) => ({ kode: t.kode, nama: t.nama, view: t.view })),
    manual: sambungan.pasang.filter((s) => s.agentKode === kode).map((s) => s.toolKode),
    // Tool tim lain yang dilepas dari agent ini. Ditampilkan supaya pelepasan
    // terlihat sebagai keputusan, bukan tool yang hilang entah ke mana.
    dilepas: sambungan.lepas.filter((s) => s.agentKode === kode).map((s) => s.toolKode),
  };
}

export type AsalData = {
  nama: string;
  jenis: "tabel" | "view";
  /** Perkiraan jumlah baris dari statistik PostgreSQL, bukan COUNT(*). */
  perkiraanBaris: number | null;
  /** Berapa foreign key yang ditegakkan database pada tabel ini. */
  foreignKey: number;
};

export type RincianSumber = {
  sumber: SumberTampil;
  kolom: { nama: string; label: string; tipe: string }[];
  /** Tabel dan view yang benar-benar dibaca, ditelusuri dari katalog. */
  asal: AsalData[];
  /** Tool yang memakai sumber ini. */
  dipakai: { kode: string; nama: string; cakupan: string; agent: string | null }[];
};

/**
 * Dari mana sebuah sumber data mengambil isinya.
 *
 * ⚠️ DITELUSURI DARI KATALOG DATABASE, BUKAN DITULIS TANGAN.
 *
 * `information_schema.view_table_usage` cuma menampilkan view milik sendiri,
 * jadi tidak berguna untuk kita yang membaca view orang lain. Yang dipakai
 * `pg_rewrite` + `pg_depend`: aturan penulisan ulang sebuah view menyimpan
 * ketergantungannya ke relasi lain, dan itu bisa dibaca siapa pun yang boleh
 * membaca katalog.
 *
 * Ditelusuri BERTINGKAT karena pembungkus `v_ai_mg_*` membaca view
 * `v_asisten_*`, yang baru membaca tabelnya — satu tingkat saja akan berhenti
 * di view dan tidak pernah menyebut satu tabel pun.
 */
export async function rincianSumber(kode: string): Promise<RincianSumber | undefined> {
  const semuaSumber = await ringkasSumber();
  const sumber = semuaSumber.find((s) => s.kode === kode);
  if (!sumber) return undefined;

  const k = await muatKonfig();
  const semua = [...k.agent.flatMap((a) => a.tool), ...k.lepas];
  const contoh = semua.find((t) => t.sumber?.kode === kode)?.sumber;

  const { rows } = await poolPerusahaan().query<{
    nama: string; jenis: string; perkiraan: string | null; fk: number;
  }>(
    // `COLLATE "C"` di suku bukan-rekursif: `pg_class.relname` bertipe `name`
    // yang memakai collation "C", dan PostgreSQL menolak CTE rekursif yang
    // kedua sukunya berbeda collation.
    `WITH RECURSIVE jejak(nama, jenis, tingkat) AS (
       SELECT ($1::text COLLATE "C"), 'v'::"char", 0
       UNION
       SELECT cl.relname, cl.relkind, j.tingkat + 1
         FROM jejak j
         JOIN pg_class v   ON v.relname = j.nama AND v.relkind = 'v'
         JOIN pg_rewrite rw ON rw.ev_class = v.oid
         JOIN pg_depend d   ON d.objid = rw.oid AND d.classid = 'pg_rewrite'::regclass
         JOIN pg_class cl   ON cl.oid = d.refobjid AND cl.relkind IN ('r','v')
        WHERE cl.relname <> j.nama AND j.tingkat < 4
     )
     SELECT DISTINCT j.nama, j.jenis::text AS jenis,
            CASE WHEN j.jenis = 'r' THEN c.reltuples::bigint::text END AS perkiraan,
            COALESCE((SELECT count(*)::int FROM pg_constraint k
                       WHERE k.conrelid = c.oid AND k.contype = 'f'), 0) AS fk
       FROM jejak j
       LEFT JOIN pg_class c ON c.relname = j.nama
      WHERE j.tingkat > 0
      ORDER BY jenis, nama`,
    [sumber.view],
  );

  return {
    sumber,
    kolom: (contoh?.kolom ?? []).map((x) => ({ nama: x.nama, label: x.label, tipe: x.tipe })),
    asal: rows.map((r) => ({
      nama: r.nama,
      jenis: r.jenis === "r" ? "tabel" : "view",
      // reltuples -1 berarti tabelnya belum pernah di-ANALYZE.
      perkiraanBaris: r.perkiraan && Number(r.perkiraan) >= 0 ? Number(r.perkiraan) : null,
      foreignKey: r.fk,
    })),
    dipakai: semua
      .filter((t) => t.sumber?.kode === kode)
      .map((t) => ({
        kode: t.kode,
        nama: t.nama,
        cakupan: t.cakupan,
        agent: k.agent.find((a) => a.tool.some((x) => x.kode === t.kode))?.nama ?? null,
      })),
  };
}
