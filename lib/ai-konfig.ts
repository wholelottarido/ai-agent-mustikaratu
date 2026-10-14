/**
 * Pembaca konfigurasi agent & tool dari database perusahaan.
 *
 * Menggantikan daftar departemen yang ditulis tangan di
 * `voltagent/departemen/index.ts`: agent, tool, dan sumber datanya sekarang
 * dibaca dari `ai_agent`, `ai_agent_tool`, `ai_tool`, dan `ai_sumber_data`.
 *
 * ⚠️ BERKAS INI TIDAK MERAKIT SQL DAN TIDAK MEMBUAT AGENT.
 *
 * Tugasnya cuma membaca, memvalidasi, dan menyimpan sebentar. Perakit query
 * dan pabrik agent dibuat terpisah supaya yang satu bisa diuji tanpa yang
 * lain -- dan supaya jelas di mana nama kolom berubah jadi teks SQL, karena
 * di situlah satu-satunya tempat yang bisa bocor.
 *
 * ============================================================
 * KENAPA KONFIGURASI DARI DATABASE PERLU DIVALIDASI
 * ============================================================
 * Isi tabel ini ditulis Admin Console tim lain, dan kita cuma punya hak
 * SELECT. Artinya baris di sana bisa berubah kapan saja tanpa kita tahu:
 * view diganti namanya, kolom dihapus, cakupan dinaikkan jadi `semua`.
 *
 * Nilai yang tidak valid di sini berakhir jadi dua hal, dan dua-duanya buruk:
 * nama kolom yang tidak ada jadi query gagal di depan user, dan cakupan yang
 * kolom penyaringnya tidak ada jadi query yang MEMBACA SEMUA BARIS. Yang
 * kedua tidak menimbulkan galat apa pun -- itu sebabnya diperiksa di sini,
 * bukan dipercaya.
 *
 * Tool yang tidak lolos DIBUANG dari hasil, tapi alasannya disimpan di
 * `masalah` supaya kelihatan. Membuang lebih aman daripada memakai; dua-duanya
 * lebih buruk daripada kelihatan.
 */
import { poolPerusahaan } from "./db-perusahaan";
import { sambunganTool } from "./sambung-tool";
import { daftarTulisDisetujui } from "./tulis-disetujui";

/**
 * Cakupan baris yang boleh dilihat. Daftarnya mengikuti CHECK di
 * `ai_tool.cakupan_bawaan` -- jangan ditambah di sini saja.
 */
export type Cakupan = "diri" | "bawahan" | "departemen" | "perusahaan" | "semua";

export type Operasi = "baca" | "tambah" | "ubah" | "hapus";

export type OperatorFilter = "berisi" | "sama" | "dari" | "sampai";

export type KolomSumber = { nama: string; tipe: string; label: string };

export type KonfigSumber = {
  kode: string;
  nama: string;
  deskripsi: string | null;
  /** Nama view PostgreSQL. Selalu `v_ai_*` -- dipaksa CHECK di tabelnya. */
  view: string;
  /**
   * Tabel operasional pokok di balik view ini (`ai_sumber_data.tabel_asal`).
   * Dipakai mencocokkan tool kita dengan tool mereka yang membaca data sama.
   */
  tabelAsal: string | null;
  kolom: KolomSumber[];
  /**
   * Kolom penyaring per cakupan. `null` berarti cakupan itu TIDAK TERSEDIA
   * untuk sumber ini -- bukan "tidak disaring".
   *
   * Pembedaan itu yang menjaga semuanya: sumber tanpa `diri` lalu dipakai
   * tool bercakupan `diri` akan membaca seluruh tabel, diam-diam.
   */
  penyaring: {
    employee: string | null;
    user: string | null;
    departemen: string | null;
    perusahaan: string | null;
  };
};

export type FilterTool = { kolom: string; label: string; operator: OperatorFilter };

/** Kolom yang diisi model lewat borang, untuk operasi tulis. */
export type KolomIsian = { kolom: string; label: string; wajib?: boolean; maks?: number; bawaan?: unknown; pilihan?: unknown };
/** Kolom yang TIDAK pernah datang dari model: sesi login, nilai tetap, now(). */
export type KolomOtomatis = { kolom: string; label?: string; sumber?: string; nilai?: unknown };
/** Kolom penunjuk baris mana yang diubah/dibatalkan, mis. `no_ticket`. */
export type KolomKunci = { kolom: string; label?: string };

export type KonfigTool = {
  kode: string;
  nama: string;
  /** Satu-satunya dasar model memutuskan kapan memakai tool ini. */
  deskripsi: string;
  jenis: "konfigurasi" | "kode";
  /** Untuk `jenis = "kode"`: nama penangan yang dicari di registry kode. */
  penangan: string | null;
  operasi: Operasi;
  /** `null` hanya sah waktu `jenis = "kode"` (dijamin CHECK di tabelnya). */
  sumber: KonfigSumber | null;
  /** Kolom yang boleh dibaca. Kosong untuk operasi tulis -- itu wajar. */
  kolom: string[];
  filter: FilterTool[];
  urut: { kolom: string | null; arah: "asc" | "desc" };
  batas: number;
  cakupan: Cakupan;
  /**
   * Kode izin yang harus dipunyai pemakai, mis. `ticket:read`.
   *
   * ⚠️ `null` berarti TIDAK ADA SYARAT, bukan "belum diisi". Seluruh tool yang
   * kita daftarkan sendiri bernilai null, dan menafsirkannya sebagai "butuh
   * izin yang belum ditentukan" akan mematikan semuanya sekaligus.
   *
   * Yang terisi datang dari tim lain (`ticket:read` pada tool tiket). Kodenya
   * dicocokkan dengan izin pemakai yang disusun `lib/akses-aplikasi.ts` dari
   * peran di `users_config` -> `role_menu.permissions`.
   */
  izin: string | null;
  contoh: string | null;
  idApps: string | null;
  aktif: boolean;
  /** Isi `ai_tool.updated_by`. `"magang"` = baris yang kita daftarkan sendiri. */
  pemilik: string | null;

  /**
   * Tool tulis MILIK TIM LAIN yang sudah ditinjau tim IT portal ini.
   *
   * ⚠️ Selalu `false` untuk tool baca dan untuk tool kita sendiri — bukan
   * karena ditolak, tapi karena pertanyaannya tidak berlaku. Yang membaca
   * medan ini (`tulisPerluPersetujuan()`) menanyakannya hanya untuk baris
   * tulis milik orang lain yang dirakit penjalan umum.
   *
   * Lihat `lib/tulis-disetujui.ts` untuk kenapa persetujuan itu perlu.
   */
  tulisDisetujui: boolean;

  /** Tabel yang ditulis. Wajib ada untuk operasi selain `baca`. */
  tabelTarget: string | null;
  isian: KolomIsian[];
  otomatis: KolomOtomatis[];
  kunci: KolomKunci[];
  /** Syarat yang harus dipenuhi baris sebelum boleh diubah/dibatalkan. */
  syarat: unknown[];
};

export type KonfigAgent = {
  kode: string;
  nama: string;
  deskripsi: string | null;
  /** Agent pintu masuk yang meneruskan ke agent aplikasi. */
  umum: boolean;
  idApps: string | null;
  /** Aplikasi lain yang ikut dipegang agent ini (mis. Supertools Mobile). */
  appsLain: string[];
  aktif: boolean;
  tool: KonfigTool[];
};

export type Masalah = { tool: string; sebab: string };

export type Konfig = {
  agent: KonfigAgent[];
  /**
   * Tool yang terdaftar tapi TIDAK tersambung ke agent mana pun.
   *
   * Sengaja dikeluarkan, bukan disembunyikan atau ditempelkan diam-diam ke
   * agent lewat kecocokan `id_apps`. Enam tool `asisten_*` milik kita ada di
   * sini: sudah siap, belum disambungkan, dan penyambungannya keputusan
   * sadar -- bukan efek samping pembaca konfigurasi.
   */
  lepas: KonfigTool[];
  /** Tool yang dibuang karena tidak lolos periksa, beserta sebabnya. */
  masalah: Masalah[];
  /**
   * Tool mereka yang digantikan tool kita, per agent.
   *
   * Ada supaya penggantian itu bisa dilihat, bukan disimpulkan. Dicatat route
   * ke log tiap permintaan; kalau suatu hari daftar ini kosong padahal
   * seharusnya tidak, berarti aturannya lepas tanpa ada galat apa pun.
   */
  gantian: { agent: string; dipakai: string; menggantikan: string[] }[];
  dibacaPada: number;
};

/**
 * Umur singgahan. 10 detik: cukup untuk menahan satu percakapan ramai, cukup
 * pendek supaya administrator yang mengubah tool tidak perlu deploy ulang
 * atau menunggu lama untuk melihat akibatnya.
 */
const UMUR_MS = 10_000;

let singgahan: Konfig | undefined;
/** Permintaan yang sedang berjalan, supaya 20 request tidak jadi 20 query. */
let sedangDibaca: Promise<Konfig> | undefined;

/** Membuang singgahan. Dipakai uji, dan setelah administrator menyimpan tool. */
export function lupakanKonfig(): void {
  singgahan = undefined;
  sedangDibaca = undefined;
}

export async function muatKonfig(): Promise<Konfig> {
  if (singgahan && Date.now() - singgahan.dibacaPada < UMUR_MS) return singgahan;
  if (sedangDibaca) return sedangDibaca;

  sedangDibaca = baca()
    .then((k) => {
      singgahan = k;
      return k;
    })
    .finally(() => {
      sedangDibaca = undefined;
    });
  return sedangDibaca;
}

type BarisAgent = {
  kode: string; nama: string; deskripsi: string | null;
  is_general: boolean; is_active: boolean;
  id_apps: string | null; apps_lain: string[] | null;
  id_ai_agent: string;
};
type BarisTool = {
  id_ai_tool: string; kode: string; nama: string; deskripsi: string;
  jenis: string; penangan: string | null; operasi: string;
  id_ai_sumber_data: string | null; id_apps: string | null;
  kolom: string[] | null; filter: unknown; urut_kolom: string | null;
  urut_arah: string; batas: number; cakupan_bawaan: string; izin: string | null;
  contoh_pertanyaan: string | null; is_active: boolean; updated_by: string | null;
  tabel_target: string | null; kolom_isian: unknown; kolom_otomatis: unknown;
  kolom_kunci: unknown; syarat: unknown;
};
type BarisSumber = {
  id_ai_sumber_data: string; kode: string; nama: string; deskripsi: string | null;
  nama_view: string; kolom: unknown; tabel_asal: string | null;
  kolom_employee: string | null; kolom_user: string | null;
  kolom_departemen: string | null; kolom_perusahaan: string | null;
  is_active: boolean;
};

/**
 * Penanda baris tool yang kita daftarkan sendiri (`ai_tool.updated_by`).
 * Lihat `scripts/daftar-sumber-ai.mts`.
 */
const MILIK_KITA = "magang";

/**
 * Tool milik kita menempel ke agent pemegang aplikasinya, lewat `id_apps`.
 *
 * ⚠️ PERNAH SAYA TOLAK, DAN ALASAN MENOLAKNYA MASIH BENAR -- aturan yang tidak
 * tertulis di tabel mana pun memang berbahaya. Yang berubah: aturannya
 * sekarang TIDAK disembunyikan. Tiap penggantian masuk ke `gantian`, dicatat
 * route ke log tiap permintaan, dan jumlah tool tiap agent kelihatan di layar.
 *
 * Kenapa tidak disambungkan lewat `ai_agent_tool` saja: tabel itu dibaca juga
 * oleh sistem mereka yang sedang dipakai orang. Menambah baris di sana berarti
 * mengubah tool agent mereka dari sisi kita, tanpa mereka tahu.
 *
 * ⚠️ YANG DIGANTI HANYA TOOL BACA ATAS TABEL YANG SAMA, dicocokkan lewat
 * `ai_sumber_data.tabel_asal`.
 *
 * Versi pertama membuang SEMUA tool baca mereka begitu kita punya satu tool
 * untuk agent itu. Akibatnya `agent-hr` kehilangan `sim_permintaan_rekrutmen`
 * dan `agent-admin` kehilangan `sim_departemen` — kemampuan yang kita tidak
 * punya penggantinya, hilang tanpa ada yang meminta. Mencocokkan lewat tabel
 * asal membuat penggantian jadi satu lawan satu.
 *
 * Tool tulis mereka (`buat_tiket` dan kawan-kawan) juga dibiarkan: kita belum
 * punya penggantinya, dan membuangnya dari daftar akan menyembunyikan bahwa
 * agent itu sebenarnya bisa menulis.
 */
function pasangTool(
  k: BarisAgent,
  terpaut: KonfigTool[],
  punyaKita: KonfigTool[],
  disambung: string[],
  dilepas: string[],
): { tool: KonfigTool[]; gantian: { dipakai: string; menggantikan: string[] } | null } {
  // ⚠️ DILEPAS LEBIH DULU, SEBELUM APA PUN DIRAKIT.
  //
  // Tool tim lain yang dilepas dari layar pengaturan tidak ikut dipasang
  // portal ini. Barisnya di `ai_tool` dan `ai_agent_tool` TETAP UTUH dan
  // sistem mereka tetap memakainya — yang berubah cuma apa yang dirakit di
  // sini.
  if (dilepas.length > 0) terpaut = terpaut.filter((t) => !dilepas.includes(t.kode));
  const dipegang = new Set([k.id_apps, ...(k.apps_lain ?? [])].filter(Boolean) as string[]);
  // Dua jalan menempel, dan keduanya perlu:
  //   - kecocokan `id_apps`  -> bawaan, supaya tool baru langsung dipakai
  //                             agent pemegang aplikasinya;
  //   - `ai_tool_agent`      -> disambungkan sadar dari layar pengaturan,
  //                             untuk tool yang berguna di lebih dari satu
  //                             agent (mis. SOP) atau di agent yang
  //                             aplikasinya berbeda.
  const kita = punyaKita.filter(
    (t) => (t.idApps && dipegang.has(t.idApps)) || disambung.includes(t.kode),
  );
  if (kita.length === 0) return { tool: terpaut, gantian: null };

  // Tabel yang sudah dibaca tool kita. Sumber tanpa `tabel_asal` tidak pernah
  // cocok — lebih baik tool mereka bertahan daripada dibuang karena tebakan.
  const tabelKita = new Set(kita.map((t) => t.sumber?.tabelAsal).filter(Boolean) as string[]);
  const diganti = terpaut.filter(
    (t) => t.operasi === "baca" && t.sumber?.tabelAsal && tabelKita.has(t.sumber.tabelAsal),
  );
  const kodeDiganti = new Set(diganti.map((t) => t.kode));
  const sisanya = terpaut.filter((t) => !kodeDiganti.has(t.kode));
  return {
    tool: [...kita, ...sisanya],
    gantian: {
      dipakai: kita.map((t) => t.kode).join(", "),
      menggantikan: diganti.map((t) => t.kode),
    },
  };
}

async function baca(): Promise<Konfig> {
  const pool = poolPerusahaan();

  const [agentQ, toolQ, sumberQ, pautQ] = await Promise.all([
    pool.query<BarisAgent>(
      `SELECT id_ai_agent, kode, nama, deskripsi, is_general, is_active, id_apps, apps_lain
         FROM ai_agent ORDER BY is_general DESC, kode`),
    pool.query<BarisTool>(
      `SELECT id_ai_tool, kode, nama, deskripsi, jenis, penangan, operasi,
              id_ai_sumber_data, id_apps, kolom, filter, urut_kolom, urut_arah,
              batas, cakupan_bawaan, izin, contoh_pertanyaan, is_active, updated_by,
              tabel_target, kolom_isian, kolom_otomatis, kolom_kunci, syarat
         FROM ai_tool ORDER BY kode`),
    pool.query<BarisSumber>(
      `SELECT id_ai_sumber_data, kode, nama, deskripsi, nama_view, kolom, tabel_asal,
              kolom_employee, kolom_user, kolom_departemen, kolom_perusahaan, is_active
         FROM ai_sumber_data`),
    pool.query<{ id_ai_agent: string; id_ai_tool: string }>(
      `SELECT id_ai_agent, id_ai_tool FROM ai_agent_tool`),
  ]);

  // Persetujuan tool tulis tim lain, dari database portal KITA. Dibaca di sini
  // supaya tiap baris `ai_tool` bisa membawa jawabannya sendiri — yang merakit
  // tool tidak punya akses database dan tidak boleh menunggu query.
  //
  // Tabelnya belum ada = daftarnya kosong = tidak ada tool tulis tim lain yang
  // dirakit. Arah gagalnya memang itu.
  const setuju = new Map(
    (await daftarTulisDisetujui()).map((d) => [d.toolKode, d]),
  );

  // ⚠️ KOLOM VIEW DIBACA DARI DATABASE, BUKAN DARI `ai_sumber_data.kolom`.
  //
  // Dua-duanya mengaku tahu kolom apa yang ada. Yang satu catatan, yang satu
  // kenyataan. Kalau administrator menghapus kolom dari view tapi lupa
  // memperbarui katalognya, yang bohong adalah katalognya -- dan query yang
  // dirakit dari katalog itu akan gagal di depan user.
  const namaView = [...new Set(sumberQ.rows.filter((s) => s.is_active).map((s) => s.nama_view))];
  const kolomView = new Map<string, Set<string>>();
  if (namaView.length > 0) {
    const k = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)`, [namaView]);
    for (const r of k.rows) {
      const s = kolomView.get(r.table_name) ?? new Set<string>();
      s.add(r.column_name);
      kolomView.set(r.table_name, s);
    }
  }

  const sumberById = new Map<string, KonfigSumber>();
  for (const s of sumberQ.rows) {
    if (!s.is_active) continue;
    sumberById.set(s.id_ai_sumber_data, {
      kode: s.kode,
      nama: s.nama,
      deskripsi: s.deskripsi,
      view: s.nama_view,
      tabelAsal: s.tabel_asal,
      kolom: Array.isArray(s.kolom) ? (s.kolom as KolomSumber[]) : [],
      penyaring: {
        employee: s.kolom_employee,
        user: s.kolom_user,
        departemen: s.kolom_departemen,
        perusahaan: s.kolom_perusahaan,
      },
    });
  }

  const masalah: Masalah[] = [];
  const toolById = new Map<string, KonfigTool>();

  for (const t of toolQ.rows) {
    const sumber = t.id_ai_sumber_data ? sumberById.get(t.id_ai_sumber_data) ?? null : null;
    const tolak = (sebab: string) => masalah.push({ tool: t.kode, sebab });

    const jenis = t.jenis === "kode" ? "kode" : "konfigurasi";
    const cakupan = t.cakupan_bawaan as Cakupan;

    if (jenis === "konfigurasi") {
      if (!sumber) { tolak(`sumber datanya tidak ada atau tidak aktif`); continue; }

      const ada = kolomView.get(sumber.view);
      if (!ada || ada.size === 0) { tolak(`view ${sumber.view} tidak ada di database`); continue; }

      const kolom = Array.isArray(t.kolom) ? t.kolom : [];

      // ⚠️ `kolom` KOSONG ITU WAJAR UNTUK OPERASI TULIS, dan menolaknya di
      // sini sempat membuang `buat_tiket`, `ubah_tiket`, dan `batalkan_tiket`
      // dari agent Portal tanpa satu pun galat. Tool tulis tidak membaca
      // kolom; dia memakai `kolom_isian`, `kolom_otomatis`, dan `kolom_kunci`.
      if (t.operasi === "baca" && kolom.length === 0) {
        tolak(`operasi baca tapi tidak ada kolom yang boleh dibaca`); continue;
      }
      if (t.operasi !== "baca" && !t.tabel_target) {
        tolak(`operasi ${t.operasi} tapi tidak menyebut tabel_target`); continue;
      }

      // Kolom baca, filter, urut, dan kunci semuanya menunjuk ke VIEW sumber:
      // kunci dipakai mencari baris mana yang dimaksud sebelum ditulis.
      const kunciArr = Array.isArray(t.kolom_kunci) ? (t.kolom_kunci as KolomKunci[]) : [];
      const dipakai = [
        ...kolom,
        ...(Array.isArray(t.filter) ? (t.filter as FilterTool[]).map((f) => f.kolom) : []),
        ...kunciArr.map((x) => x.kolom),
        t.urut_kolom,
      ].filter((x): x is string => Boolean(x));

      const hilang = [...new Set(dipakai)].filter((k) => !ada.has(k));
      if (hilang.length > 0) { tolak(`kolom tidak ada di ${sumber.view}: ${hilang.join(", ")}`); continue; }

      // ⚠️ INI PEMERIKSAAN YANG PALING PENTING DI BERKAS INI.
      //
      // Cakupan yang kolom penyaringnya tidak ada tidak akan menghasilkan
      // galat -- dia menghasilkan query TANPA WHERE, yang membaca seluruh
      // tabel untuk semua orang. Satu-satunya saat kesalahan itu bisa
      // ditangkap adalah sekarang, sebelum tool-nya dipakai.
      const perlu: Partial<Record<Cakupan, string | null>> = {
        diri: sumber.penyaring.employee,
        bawahan: sumber.penyaring.employee,
        departemen: sumber.penyaring.departemen,
        perusahaan: sumber.penyaring.perusahaan,
      };
      if (cakupan !== "semua") {
        const kol = perlu[cakupan];
        if (!kol) { tolak(`cakupan "${cakupan}" tapi ${sumber.kode} tidak punya kolom penyaringnya`); continue; }
        if (!ada.has(kol)) { tolak(`kolom penyaring "${kol}" tidak ada di ${sumber.view}`); continue; }
      }
    } else if (!t.penangan) {
      tolak(`jenis "kode" tapi tidak menyebut penangan`); continue;
    }

    toolById.set(t.id_ai_tool, {
      kode: t.kode,
      nama: t.nama,
      deskripsi: t.deskripsi,
      jenis,
      penangan: t.penangan,
      operasi: t.operasi as Operasi,
      sumber,
      kolom: Array.isArray(t.kolom) ? t.kolom : [],
      filter: Array.isArray(t.filter) ? (t.filter as FilterTool[]) : [],
      urut: { kolom: t.urut_kolom, arah: t.urut_arah === "asc" ? "asc" : "desc" },
      batas: t.batas,
      cakupan,
      izin: t.izin,
      contoh: t.contoh_pertanyaan,
      idApps: t.id_apps,
      aktif: t.is_active,
      pemilik: t.updated_by,
      // ⚠️ KODE, OPERASI, DAN TABEL DICOCOKKAN SEKALIGUS. Persetujuan diberikan
      // untuk satu tool dengan isi tertentu; baris mereka bisa berubah tanpa
      // kita tahu, dan persetujuan lama tidak boleh ikut ke isi yang baru.
      tulisDisetujui: (() => {
        const d = setuju.get(t.kode);
        return Boolean(d && d.operasi === t.operasi && d.tabel === t.tabel_target);
      })(),
      tabelTarget: t.tabel_target,
      isian: Array.isArray(t.kolom_isian) ? (t.kolom_isian as KolomIsian[]) : [],
      otomatis: Array.isArray(t.kolom_otomatis) ? (t.kolom_otomatis as KolomOtomatis[]) : [],
      kunci: Array.isArray(t.kolom_kunci) ? (t.kolom_kunci as KolomKunci[]) : [],
      syarat: Array.isArray(t.syarat) ? (t.syarat as unknown[]) : [],
    });
  }

  const toolAgent = new Map<string, string[]>();
  const tersambung = new Set<string>();
  for (const p of pautQ.rows) {
    tersambung.add(p.id_ai_tool);
    toolAgent.set(p.id_ai_agent, [...(toolAgent.get(p.id_ai_agent) ?? []), p.id_ai_tool]);
  }

  // Tool milik kita TIDAK tersambung di `ai_agent_tool` -- sengaja, supaya
  // sistem mereka tidak ikut berubah. Dia dipasang di sini lewat `id_apps`.
  const punyaKita = [...toolById.values()].filter((t) => t.pemilik === MILIK_KITA);
  const gantian: Konfig["gantian"] = [];

  // Sambungan tambahan dari database portal kita. Kalau tabelnya belum ada,
  // hasilnya kosong — portal tetap jalan, cuma tanpa sambungan manual.
  const sambungan = await sambunganTool();
  const perAgent = new Map<string, string[]>();
  for (const s of sambungan.pasang) {
    perAgent.set(s.agentKode, [...(perAgent.get(s.agentKode) ?? []), s.toolKode]);
  }
  const lepasPerAgent = new Map<string, string[]>();
  for (const s of sambungan.lepas) {
    lepasPerAgent.set(s.agentKode, [...(lepasPerAgent.get(s.agentKode) ?? []), s.toolKode]);
  }

  const agent: KonfigAgent[] = agentQ.rows.map((a) => {
    const terpaut = (toolAgent.get(a.id_ai_agent) ?? [])
      .map((id) => toolById.get(id))
      .filter((t): t is KonfigTool => Boolean(t) && t!.aktif);
    const hasil = pasangTool(a, terpaut, punyaKita, perAgent.get(a.kode) ?? [], lepasPerAgent.get(a.kode) ?? []);
    if (hasil.gantian) gantian.push({ agent: a.kode, ...hasil.gantian });
    return {
      kode: a.kode,
      nama: a.nama,
      deskripsi: a.deskripsi,
      umum: a.is_general,
      idApps: a.id_apps,
      appsLain: a.apps_lain ?? [],
      aktif: a.is_active,
      tool: hasil.tool,
    };
  });

  // "Lepas" sekarang berarti benar-benar tidak dipakai agent mana pun --
  // tool kita yang sudah menempel lewat `id_apps` tidak lagi terhitung lepas.
  const dipakai = new Set(agent.flatMap((a) => a.tool.map((t) => t.kode)));
  const lepas = [...toolById.entries()]
    .filter(([id, t]) => !tersambung.has(id) && !dipakai.has(t.kode))
    .map(([, t]) => t);

  return { agent, lepas, masalah, gantian, dibacaPada: Date.now() };
}

/** Agent pintu masuk. `undefined` kalau belum ada atau sedang dimatikan. */
export async function agentUmum(): Promise<KonfigAgent | undefined> {
  const k = await muatKonfig();
  return k.agent.find((a) => a.umum && a.aktif);
}

/**
 * Agent yang memegang sebuah aplikasi, lewat `id_apps` maupun `apps_lain`.
 *
 * `apps_lain` ikut diperiksa supaya Supertools Mobile menemukan agent Super
 * Tools, bukan tidak menemukan apa-apa.
 */
export async function agentUntukApp(idApps: string): Promise<KonfigAgent | undefined> {
  const k = await muatKonfig();
  return k.agent.find((a) => a.aktif && !a.umum && (a.idApps === idApps || a.appsLain.includes(idApps)));
}

export async function agentDenganKode(kode: string): Promise<KonfigAgent | undefined> {
  const k = await muatKonfig();
  return k.agent.find((a) => a.kode === kode);
}
