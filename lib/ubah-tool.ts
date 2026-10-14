/**
 * Mengubah setelan tool AI milik portal kita.
 *
 * ⚠️ TIGA LAPIS PENJAGAAN, DAN KETIGANYA PERLU.
 *
 *   1. DATABASE — role `ai_konfig` cuma punya `UPDATE (kolom, filter, urut,
 *      batas, cakupan, …)`. Kolom yang menentukan APA yang dikerjakan tool
 *      (`penangan`, `jenis`, `id_ai_sumber_data`, `tabel_target`) tidak bisa
 *      disentuhnya sama sekali — walau berkas ini salah.
 *   2. BARIS — `WHERE updated_by = 'magang'`. PostgreSQL tidak bisa membatasi
 *      UPDATE ke baris tertentu tanpa RLS, dan menyalakan RLS di tabel milik
 *      tim lain akan mengubah perilaku sistem mereka. Jadi batas baris dijaga
 *      di sini, dan diuji.
 *   3. ISI — cakupan yang kolom penyaringnya tidak ada DITOLAK. Ini yang
 *      paling mudah lolos: menaikkan cakupan jadi `semua` tidak menimbulkan
 *      galat apa pun, cuma membuat tiap pemakai melihat data semua orang.
 */
import { poolKonfig } from "./db-konfig";
// Dibaca lewat pool BACA: daftar izin itu milik sistem mereka, dan role
// penulis setelan tidak punya urusan menyentuh tabel peran.
import { poolPerusahaan } from "./db-perusahaan";
import { muatKonfig, lupakanKonfig, type Cakupan, type KonfigTool } from "./ai-konfig";
import { pratinjauSql } from "@/voltagent/tool-konfigurasi";
import { tulisPerluPersetujuan } from "@/voltagent/registry-tulis";

/** Penanda baris milik kita, sama dengan `scripts/daftar-sumber-ai.mts`. */
const PEMILIK = "magang";

const MAKS_BARIS = 200;
const CAKUPAN: Cakupan[] = ["diri", "bawahan", "departemen", "perusahaan", "semua"];

export type UbahanTool = {
  kolom?: string[];
  batas?: number;
  cakupan?: Cakupan;
  contoh?: string | null;
  aktif?: boolean;
  /** Penyaring baru. Menggantikan seluruh daftar, bukan menambah. */
  filter?: { kolom: string; label: string; operator: string }[];
  /** `null` mencabut syarat izin; string menetapkannya. */
  izin?: string | null;
};

/** Satu pilihan izin beserta berapa peran yang benar-benar memilikinya. */
export type IzinPilihan = { kode: string; peran: number };

export type HasilUbah = { ok: true; kode: string } | { ok: false; sebab: string };

/**
 * Cakupan yang benar-benar tersedia untuk sebuah tool, dari kolom penyaring
 * sumbernya. Dipakai layar pengaturan supaya pilihan yang tidak mungkin
 * TIDAK ditampilkan — bukan ditampilkan lalu ditolak waktu disimpan.
 */
export function cakupanTersedia(t: KonfigTool): Cakupan[] {
  const p = t.sumber?.penyaring;
  if (!p) return ["semua"];
  const ada: Cakupan[] = ["semua"];
  if (p.employee) ada.unshift("diri", "bawahan");
  if (p.departemen) ada.push("departemen");
  if (p.perusahaan) ada.push("perusahaan");
  return ada;
}

export type ToolTampil = {
  /**
   * Bisa diubah dari layar pengaturan portal ini?
   *
   * `false` untuk tool bawaan sistem perusahaan. TETAP DITAMPILKAN, dan itu
   * inti halamannya: yang menentukan apa yang didapat pemakai bukan cuma tool
   * kita, tapi SELURUH tool yang terpasang di tiap agent. Menyembunyikan
   * separuhnya membuat layar itu berbohong tentang keadaan yang sebenarnya.
   */
  milikKita: boolean;
  kode: string;
  nama: string;
  jenis: "konfigurasi" | "kode";
  operasi: string;
  aktif: boolean;
  batas: number;
  cakupan: Cakupan;
  cakupanBisa: Cakupan[];
  /**
   * Izin yang wajib dipunyai pemakai, mis. `assignment-ticket:read`.
   *
   * ⚠️ HARUS TERLIHAT DI LAYAR, bukan cuma dipakai diam-diam. Tanpa ini,
   * administrator melihat tool bercakupan "Seluruh perusahaan" dan menyimpulkan
   * tool itu terbuka untuk siapa saja — padahal dijaga izin. Atau sebaliknya,
   * dan itu yang berbahaya: ia menyimpulkan ada penjaganya padahal tidak.
   *
   * `null` berarti TIDAK ADA SYARAT. Untuk tool bercakupan `semua`, itu berarti
   * tool tersebut terpasang untuk SETIAP pemegang aplikasinya.
   */
  izin: string | null;
  contoh: string | null;
  kolom: string[];
  /**
   * Kolom sumbernya. `tipe` ikut karena menentukan operator penyaring mana
   * yang sah: `dari`/`sampai` di-cast ke tanggal oleh perakit query, jadi di
   * kolom teks ia GAGAL WAKTU DIPANGGIL — bukan waktu disimpan.
   */
  katalog: { nama: string; label: string; tipe: string }[];
  /** Penyaring yang bisa diisi model saat memanggil tool ini. */
  filter: { kolom: string; label: string; operator: string }[];
  view: string | null;
  /** Kode sumbernya, untuk menautkan ke halaman asal datanya. */
  sumberKode: string | null;
  penangan: string | null;
  /** Agent yang memakainya pada baris ini. `null` = belum dipakai agent mana pun. */
  agent: string | null;
  /**
   * Agent LAIN yang memakai tool yang sama.
   *
   * Sejak tool bisa disambungkan ke lebih dari satu agent, satu baris `ai_tool`
   * bisa muncul di beberapa tempat — dan menyuntingnya di salah satu tempat
   * mengubahnya di semua. Itu harus dikatakan, bukan ditemukan sendiri.
   */
  agentLain: string[];
  /**
   * Query yang AKAN dijalankan tool ini. `null` untuk tool berjenis kode dan
   * operasi tulis.
   *
   * Dirangkai perakit yang SAMA dengan yang menjalankannya — bukan disusun
   * ulang untuk tampilan. Pratinjau yang berbeda dari query aslinya lebih
   * buruk daripada tidak ada pratinjau.
   */
  sql: string | null;

  /** Tabel yang ditulis. `null` untuk tool baca. */
  tabelTarget: string | null;
  /**
   * Tool tulis tim lain yang butuh persetujuan tim IT sebelum dirakit portal ini.
   *
   * Ikut dikirim ke layar supaya tombol setujui/cabut cuma muncul di baris yang
   * memang bisa — bukan di semua tool, lalu ditolak waktu diklik.
   */
  perluPersetujuan: boolean;
  /** Sudah disetujui. Selalu `false` kalau `perluPersetujuan` juga `false`. */
  disetujui: boolean;
};

/**
 * SELURUH tool yang menentukan apa yang didapat pemakai, per agent.
 *
 * Dipakai halaman (server) DAN route GET. Dua salinan bentuk yang sama berarti
 * suatu hari salah satunya menambah field dan yang lain tidak, lalu layarnya
 * menampilkan kolom kosong tanpa ada yang tahu kenapa.
 *
 * ⚠️ TOOL MILIK TIM LAIN IKUT DITAMPILKAN, ditandai `milikKita: false`.
 *
 * Versi pertama menyaringnya keluar "supaya tidak ada yang mencoba mengubahnya
 * lalu bingung". Itu keliru: halaman ini mengatur agent yang dipakai SEMUA
 * ORANG, dan separuh tool yang tidak kelihatan membuatnya berbohong tentang
 * keadaan yang sebenarnya. Administrator yang melihat `agent-cmod` cuma punya
 * satu tool akan mengambil keputusan dari gambar yang salah.
 *
 * Yang dijaga tetap sama: `ubahTool()` menolak baris yang bukan milik kita,
 * dan role database tidak punya hak mengubahnya. Menampilkan bukan mengizinkan.
 */
export async function ringkasTool(): Promise<ToolTampil[]> {
  const k = await muatKonfig();

  // ⚠️ SATU ENTRI PER PASANGAN agent-tool, bukan per tool.
  //
  // Versi pertama mengambil nama agent lewat `find()` — yang mengembalikan
  // agent PERTAMA yang memakainya. Begitu sebuah tool disambungkan ke dua
  // agent, dua salinannya sama-sama diberi nama agent pertama: muncul dua kali
  // di satu kelompok, dan tidak muncul sama sekali di kelompok yang lain.
  // React menandainya sebagai kunci ganda, tapi yang rusak datanya.
  const pakai = new Map<string, string[]>();
  for (const a of k.agent) {
    for (const t of a.tool) pakai.set(t.kode, [...(pakai.get(t.kode) ?? []), a.nama]);
  }

  const pasangan: { t: KonfigTool; agent: string | null }[] = [
    ...k.agent.flatMap((a) => a.tool.map((t) => ({ t, agent: a.nama }))),
    ...k.lepas.map((t) => ({ t, agent: null })),
  ];

  return pasangan
    .map(({ t, agent }) => ({
      milikKita: t.pemilik === PEMILIK,
      kode: t.kode,
      nama: t.nama,
      jenis: t.jenis,
      operasi: t.operasi,
      aktif: t.aktif,
      batas: t.batas,
      cakupan: t.cakupan,
      cakupanBisa: cakupanTersedia(t),
      izin: t.izin,
      contoh: t.contoh,
      kolom: t.kolom,
      katalog: (t.sumber?.kolom ?? []).map((x) => ({ nama: x.nama, label: x.label, tipe: x.tipe })),
      filter: t.filter.map((f) => ({ kolom: f.kolom, label: f.label, operator: f.operator })),
      view: t.sumber?.view ?? null,
      sumberKode: t.sumber?.kode ?? null,
      penangan: t.penangan,
      agent,
      agentLain: (pakai.get(t.kode) ?? []).filter((n) => n !== agent),
      sql: pratinjauSql(t),
      tabelTarget: t.tabelTarget,
      // ⚠️ Dihitung PERAKIT TOOL-nya sendiri (`tulisPerluPersetujuan`), bukan
      // disusun ulang di sini. Layar yang memakai aturan sendiri akan pelan-
      // pelan berbeda dari yang benar-benar dirakit — dan yang terlihat di
      // layar bukan yang dipegang model. Kekeliruan "satu hal dihitung di dua
      // tempat" sudah dua kali terjadi di proyek ini (lihat `namaUntukModel`).
      perluPersetujuan: tulisPerluPersetujuan(t),
      disetujui: tulisPerluPersetujuan(t) && t.tulisDisetujui,
    }))
    // Diurutkan per agent supaya layarnya bisa mengelompokkan tanpa menyusun
    // ulang; yang belum tersambung ke agent mana pun jatuh ke paling bawah.
    .sort(
      (x, y) =>
        (x.agent ?? "zzz").localeCompare(y.agent ?? "zzz") || x.kode.localeCompare(y.kode),
    );
}

export async function ubahTool(kode: string, ubahan: UbahanTool): Promise<HasilUbah> {
  const konf = await muatKonfig();
  const t = [...konf.agent.flatMap((a) => a.tool), ...konf.lepas].find((x) => x.kode === kode);
  if (!t) {
    // ⚠️ Tidak ketemu di konfigurasi yang terpasang BUKAN berarti tidak ada.
    // Tool mereka yang digantikan tool kita hilang dari daftar agent DAN dari
    // `lepas`, jadi pesan "tidak ada" akan berbohong ke administrator yang
    // jelas melihatnya di Admin Console. Satu query tambahan, dan hanya di
    // jalur galat, untuk menyebut sebab yang sebenarnya.
    const r = await poolKonfig().query<{ updated_by: string | null }>(
      `SELECT updated_by FROM ai_tool WHERE kode = $1`, [kode]);
    if (r.rowCount === 0) return { ok: false, sebab: `tool "${kode}" tidak ada di ai_tool` };
    return {
      ok: false,
      sebab: `tool "${kode}" milik ${r.rows[0].updated_by ?? "pihak lain"} — diurus lewat Admin Console, bukan dari sini`,
    };
  }
  if (t.pemilik !== PEMILIK) {
    return { ok: false, sebab: `tool "${kode}" bukan milik portal ini — diurus lewat Admin Console` };
  }

  const set: string[] = [];
  const nilai: unknown[] = [kode, PEMILIK];
  const tambah = (sql: string, v: unknown) => {
    nilai.push(v);
    set.push(`${sql} = $${nilai.length}`);
  };

  if (ubahan.kolom) {
    if (t.jenis === "kode") {
      return { ok: false, sebab: `"${kode}" tool berjenis kode — kolomnya ditentukan penanganya, bukan setelan` };
    }
    if (ubahan.kolom.length === 0) return { ok: false, sebab: "minimal satu kolom harus dibaca" };
    // Daftar-boleh dari KATALOG sumbernya, bukan dari apa pun yang dikirim
    // peramban. Kolom asing di sini akan jadi teks di dalam SELECT.
    const katalog = new Set((t.sumber?.kolom ?? []).map((k) => k.nama));
    const asing = ubahan.kolom.filter((k) => !katalog.has(k));
    if (asing.length > 0) return { ok: false, sebab: `kolom tidak ada di sumbernya: ${asing.join(", ")}` };
    tambah("kolom", ubahan.kolom);

    // Kolom urut yang ikut terbuang membuat query gagal waktu dipanggil, bukan
    // waktu disimpan — jadi ditolak di sini.
    if (t.urut.kolom && !ubahan.kolom.includes(t.urut.kolom)) {
      return { ok: false, sebab: `kolom urut "${t.urut.kolom}" ikut dibuang; pilih urutan lain dulu` };
    }
  }

  if (ubahan.batas !== undefined) {
    if (!Number.isInteger(ubahan.batas) || ubahan.batas < 1 || ubahan.batas > MAKS_BARIS) {
      return { ok: false, sebab: `batas harus bilangan 1..${MAKS_BARIS}` };
    }
    tambah("batas", ubahan.batas);
  }

  if (ubahan.cakupan !== undefined) {
    if (!CAKUPAN.includes(ubahan.cakupan)) return { ok: false, sebab: `cakupan "${ubahan.cakupan}" tidak dikenal` };
    // ⚠️ PEMERIKSAAN PALING PENTING DI BERKAS INI.
    const bisa = cakupanTersedia(t);
    if (!bisa.includes(ubahan.cakupan)) {
      return {
        ok: false,
        sebab:
          `cakupan "${ubahan.cakupan}" tidak tersedia untuk ${kode}: sumbernya tidak punya kolom penyaringnya. ` +
          `Yang bisa: ${bisa.join(", ")}`,
      };
    }
    tambah("cakupan_bawaan", ubahan.cakupan);
  }

  if (ubahan.filter !== undefined) {
    if (t.jenis === "kode") {
      return { ok: false, sebab: `"${kode}" tool berjenis kode — penyaringnya ditentukan penanganya` };
    }
    const katalog = new Map((t.sumber?.kolom ?? []).map((k) => [k.nama, k]));
    const OPERATOR = ["berisi", "sama", "dari", "sampai"];
    const dipakai = new Set<string>();
    for (const f of ubahan.filter) {
      const k = katalog.get(f.kolom);
      if (!k) return { ok: false, sebab: `kolom penyaring "${f.kolom}" tidak ada di sumbernya` };
      if (!OPERATOR.includes(f.operator)) {
        return { ok: false, sebab: `operator "${f.operator}" tidak dikenal; yang ada: ${OPERATOR.join(", ")}` };
      }
      // ⚠️ `dari`/`sampai` DI-CAST KE TANGGAL oleh perakit query. Dipasang di
      // kolom teks, query-nya meledak WAKTU DIPANGGIL — bukan waktu disimpan,
      // jadi administrator baru tahu setelah seseorang bertanya.
      if ((f.operator === "dari" || f.operator === "sampai") && k.tipe !== "tanggal") {
        return {
          ok: false,
          sebab: `operator "${f.operator}" cuma untuk kolom tanggal; "${f.kolom}" bertipe ${k.tipe}`,
        };
      }
      // Dua penyaring dengan kolom DAN operator sama jadi dua parameter
      // bernama sama di tool — yang kedua menimpa yang pertama diam-diam.
      const kunci = `${f.kolom}:${f.operator}`;
      if (dipakai.has(kunci)) {
        return { ok: false, sebab: `penyaring "${f.kolom}" dengan operator "${f.operator}" disebut dua kali` };
      }
      dipakai.add(kunci);
    }
    tambah("filter", JSON.stringify(ubahan.filter.map((f) => ({
      kolom: f.kolom, label: f.label.trim() || f.kolom, operator: f.operator,
    }))));
  }

  if (ubahan.izin !== undefined) {
    const p = await izinAda(ubahan.izin);
    if (!p.ok) return p;
    tambah("izin", ubahan.izin);
  }

  if (ubahan.contoh !== undefined) tambah("contoh_pertanyaan", ubahan.contoh);
  if (ubahan.aktif !== undefined) tambah("is_active", ubahan.aktif);

  if (set.length === 0) return { ok: false, sebab: "tidak ada yang diubah" };

  const r = await poolKonfig().query<{ kode: string }>(
    `UPDATE ai_tool SET ${set.join(", ")}, updated_at = now()
      WHERE kode = $1 AND updated_by = $2
      RETURNING kode`,
    nilai,
  );
  if (r.rowCount === 0) {
    return { ok: false, sebab: `tidak ada baris milik portal ini dengan kode "${kode}"` };
  }

  // Tanpa ini perubahan baru terasa setelah singgahan 10 detik habis, dan
  // administrator mengira simpanannya gagal lalu menekan Simpan berkali-kali.
  lupakanKonfig();
  return { ok: true, kode };
}

/**
 * Sumber data yang bisa dipakai membuat tool baru, beserta pilihan yang masuk
 * akal untuk masing-masing.
 *
 * Cakupan yang kolom penyaringnya tidak ada TIDAK ditawarkan — sama seperti di
 * penyunting: yang tidak mungkin, tidak ditampilkan.
 */
export type SumberPilihan = {
  kode: string;
  nama: string;
  view: string;
  kolom: { nama: string; label: string }[];
  cakupanBisa: Cakupan[];
};

/**
 * Daftar izin yang bisa dipilih administrator.
 *
 * ⚠️ DIAMBIL DARI IZIN YANG BENAR-BENAR DIBERIKAN PERAN, bukan dari katalog
 * `permission_section`. Bedanya penting: 62 kode terdaftar di katalog tidak
 * dimiliki satu peran pun, dan tool yang memakai salah satunya **tidak akan
 * pernah terpasang untuk siapa pun** — hilang dari semua agent tanpa satu
 * pesan galat. Jumlah perannya ikut dibawa supaya keadaan itu terbaca di
 * layar, bukan ditemukan belakangan.
 */
export async function izinPilihan(): Promise<IzinPilihan[]> {
  const { rows } = await poolPerusahaan().query<{ kode: string; peran: string }>(
    `SELECT k AS kode, count(DISTINCT rm.id_roles)::text AS peran
       FROM role_menu rm, LATERAL unnest(rm.permissions) AS k
      GROUP BY k ORDER BY k`,
  );
  return rows.map((r: { kode: string; peran: string }) => ({ kode: r.kode, peran: Number(r.peran) }));
}

/**
 * Izin yang dikirim layar harus BENAR-BENAR ADA.
 *
 * Salah ketik satu huruf tidak menghasilkan galat apa pun waktu disimpan —
 * tool-nya cuma berhenti muncul untuk semua orang, selamanya. Itu bentuk
 * kegagalan yang paling sulit dilacak, jadi ditolak di sini.
 */
export async function izinAda(izin: string | null): Promise<{ ok: true; kode: string } | { ok: false; sebab: string }> {
  if (izin === null) return { ok: true, kode: "" };
  if (typeof izin !== "string" || !/^[a-z0-9][a-z0-9:-]{2,79}$/.test(izin)) {
    return { ok: false, sebab: `kode izin "${izin}" tidak berbentuk sah (contoh: ticket:read)` };
  }
  const { rows } = await poolPerusahaan().query<{ ada: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM role_menu rm, LATERAL unnest(rm.permissions) AS k WHERE k = $1
       UNION ALL
       SELECT 1 FROM permission_section WHERE code = $1
     ) AS ada`,
    [izin],
  );
  if (!rows[0].ada) {
    return { ok: false, sebab: `izin "${izin}" tidak ada di sistem izin perusahaan — tool-nya tidak akan pernah terpasang` };
  }
  return { ok: true, kode: izin };
}

export async function sumberPilihan(): Promise<SumberPilihan[]> {
  const k = await muatKonfig();
  const semua = [...k.agent.flatMap((a) => a.tool), ...k.lepas];

  const peta = new Map<string, SumberPilihan>();
  for (const t of semua) {
    const s = t.sumber;
    if (!s || peta.has(s.kode)) continue;
    const p = s.penyaring;
    const cakupanBisa: Cakupan[] = ["semua"];
    if (p.employee) cakupanBisa.unshift("diri", "bawahan");
    if (p.departemen) cakupanBisa.push("departemen");
    if (p.perusahaan) cakupanBisa.push("perusahaan");
    peta.set(s.kode, {
      kode: s.kode,
      nama: s.nama,
      view: s.view,
      kolom: s.kolom.map((x) => ({ nama: x.nama, label: x.label })),
      cakupanBisa,
    });
  }
  return [...peta.values()].sort((a, b) => a.nama.localeCompare(b.nama));
}

export type ToolBaru = {
  kode: string;
  nama: string;
  deskripsi: string;
  sumber: string;
  kolom: string[];
  cakupan: Cakupan;
  batas: number;
  urut: string | null;
  contoh: string | null;
  /**
   * Syarat izin, mis. `assignment-ticket:read`. Kosong = tidak ada syarat.
   *
   * ⚠️ Untuk cakupan `semua` ini SATU-SATUNYA pembatas. Tanpa izin, tool
   * bercakupan seluruh perusahaan terpasang untuk SETIAP pemegang aplikasinya.
   */
  izin?: string | null;
  /**
   * Aplikasi pemilik tool ini — yang menentukan agent mana memakainya.
   *
   * Kosong = ikut aplikasi sumbernya, dan itu bawaannya. Diisi waktu tool
   * dibuat dari halaman sebuah agent: yang diminta "tool untuk Ratu AI MAPS",
   * jadi dia harus menempel di MAPS saja — bukan juga di agent pemegang
   * aplikasi sumbernya, yang akan mengejutkan.
   */
  idApps?: string | null;
};

/**
 * Membuat tool baca baru dari sebuah sumber data terdaftar.
 *
 * ⚠️ TIDAK ADA SQL YANG DIKETIK, dan tidak ada nama tabel yang diisi tangan.
 * Yang masuk cuma pilihan dari daftar: sumber mana, kolom mana, cakupan mana.
 *
 * ⚠️ TIGA HAL DITENTUKAN SERVER, BUKAN PENGIRIM:
 *   - `jenis` dan `operasi` tidak dikirim sama sekali — role database tidak
 *     punya hak mengisinya, jadi keduanya selalu `konfigurasi` + `baca`;
 *   - `id_apps` diambil dari sumbernya, bukan dari borang: itu yang menentukan
 *     agent mana memakainya, dan membiarkan pengirim memilihnya berarti tool
 *     bisa ditempelkan ke agent mana pun lewat satu permintaan;
 *   - `is_active` selalu `false`, supaya sistem tim lain tidak ikut
 *     mengambilnya.
 */
export async function buatTool(b: ToolBaru): Promise<HasilUbah> {
  // CHECK di tabelnya: `^[a-z][a-z0-9_]{2,59}$`. Diperiksa di sini juga supaya
  // pesannya bisa dibaca orang, bukan galat constraint.
  if (!/^[a-z][a-z0-9_]{2,59}$/.test(b.kode)) {
    return { ok: false, sebab: "kode hanya huruf kecil, angka, dan garis bawah; 3–60 huruf, diawali huruf" };
  }
  if (!b.nama.trim()) return { ok: false, sebab: "nama wajib diisi" };
  if (b.deskripsi.trim().length < 15) {
    // Deskripsi adalah SATU-SATUNYA dasar model memutuskan kapan memakai tool
    // ini. Yang kabur membuatnya dipanggil di saat yang salah — atau tidak
    // dipanggil sama sekali.
    return { ok: false, sebab: "deskripsi untuk model minimal 15 huruf — ini satu-satunya dasar model memilih tool" };
  }

  const k = await muatKonfig();
  const semua = [...k.agent.flatMap((a) => a.tool), ...k.lepas];
  if (semua.some((t) => t.kode === b.kode)) {
    return { ok: false, sebab: `kode "${b.kode}" sudah dipakai tool lain` };
  }

  const sumber = semua.find((t) => t.sumber?.kode === b.sumber)?.sumber;
  if (!sumber) return { ok: false, sebab: `sumber data "${b.sumber}" tidak terdaftar` };

  if (b.kolom.length === 0) return { ok: false, sebab: "minimal satu kolom harus dibaca" };
  const katalog = new Set(sumber.kolom.map((x) => x.nama));
  const asing = b.kolom.filter((x) => !katalog.has(x));
  if (asing.length > 0) return { ok: false, sebab: `kolom tidak ada di sumbernya: ${asing.join(", ")}` };
  if (b.urut && !b.kolom.includes(b.urut)) {
    return { ok: false, sebab: `kolom urut "${b.urut}" harus termasuk kolom yang dibaca` };
  }
  if (!Number.isInteger(b.batas) || b.batas < 1 || b.batas > MAKS_BARIS) {
    return { ok: false, sebab: `batas harus bilangan 1..${MAKS_BARIS}` };
  }

  const p = sumber.penyaring;
  const bisa: Cakupan[] = ["semua"];
  if (p.employee) bisa.unshift("diri", "bawahan");
  if (p.departemen) bisa.push("departemen");
  if (p.perusahaan) bisa.push("perusahaan");
  if (!bisa.includes(b.cakupan)) {
    return { ok: false, sebab: `cakupan "${b.cakupan}" tidak tersedia untuk ${b.sumber}. Yang bisa: ${bisa.join(", ")}` };
  }

  if (b.izin !== undefined && b.izin !== null) {
    const pi = await izinAda(b.izin);
    if (!pi.ok) return pi;
  }

  // `COALESCE($11, s.id_apps)`: aplikasi yang diminta kalau ada, kalau tidak
  // ikut sumbernya. Keduanya dari server — borang tidak pernah mengirim uuid.
  await poolKonfig().query(
    `INSERT INTO ai_tool
       (kode, nama, deskripsi, id_ai_sumber_data, id_apps, kolom, filter,
        urut_kolom, urut_arah, batas, cakupan_bawaan, contoh_pertanyaan,
        izin, is_active, updated_by)
     SELECT $1, $2, $3, s.id_ai_sumber_data, COALESCE($11::uuid, s.id_apps), $4, '[]'::jsonb,
            $5, 'desc', $6, $7, $8, $12, false, $9
       FROM ai_sumber_data s WHERE s.kode = $10`,
    [b.kode, b.nama.trim(), b.deskripsi.trim(), b.kolom, b.urut, b.batas, b.cakupan,
     b.contoh?.trim() || null, PEMILIK, b.sumber, b.idApps ?? null, b.izin ?? null],
  );

  lupakanKonfig();
  return { ok: true, kode: b.kode };
}
