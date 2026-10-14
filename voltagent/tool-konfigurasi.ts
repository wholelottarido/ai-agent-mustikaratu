/**
 * Merakit satu baris `ai_tool` jadi tool VoltAgent yang bisa dipanggil model.
 *
 * ⚠️ MODEL TIDAK PERNAH MENULIS SQL DI JALUR INI.
 *
 * Ini kebalikan dari `voltagent/perusahaan/tool-query.ts`, yang membiarkan
 * model menulis SELECT lalu memeriksanya. Di sini model cuma mengisi beberapa
 * kotak -- nilai filter -- dan query-nya dirakit server dari baris konfigurasi.
 * Tidak ada teks dari model yang pernah jadi bagian dari perintah SQL.
 *
 * ============================================================
 * DUA JENIS NILAI, DAN KENAPA DIBEDAKAN KERAS
 * ============================================================
 * NAMA (view, kolom) tidak bisa jadi parameter SQL -- dia harus masuk sebagai
 * teks. Jadi tiap nama diperiksa dua kali: harus ada di daftar-boleh milik
 * tool itu sendiri, DAN harus berbentuk pengenal yang aman. Yang tidak lolos
 * membuat perakitan berhenti, bukan menghasilkan query yang "kira-kira".
 *
 * NILAI (isi filter, id dari sesi) SELALU jadi `$1`, `$2`, ... tanpa kecuali.
 *
 * ============================================================
 * PENYARING CAKUPAN TIDAK PERNAH BOLEH HILANG DIAM-DIAM
 * ============================================================
 * Kalau cakupan `diri` tapi sesi tidak punya `id_employee`, tool ini MENOLAK
 * menjawab. Yang terlarang adalah menjalankan query tanpa `WHERE`-nya:
 * hasilnya bukan galat, tapi data semua orang.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { poolPerusahaan } from "@/lib/db-perusahaan";
import type { Cakupan, KonfigTool, FilterTool } from "@/lib/ai-konfig";
import { buatToolKode, penanganDikenal } from "./registry-kode";
import {
  buatToolTulis, tulisDikenal, tulisPerluPersetujuan, type CatatRancangan,
} from "./registry-tulis";

/** Batas atas mutlak, berapa pun isi `ai_tool.batas`. */
const MAKS_BARIS = 200;

/**
 * Identitas pemakai untuk sesi ini.
 *
 * ⚠️ DATANG DARI SESI LOGIN, TIDAK PERNAH DARI MODEL. Kalau model yang
 * mengisinya, satu kalimat yang disusun rapi bisa membaca data orang lain.
 */
export type SesiPemakai = {
  idEmployee: string | null;
  /**
   * Slug departemen portal (`it`, `marketing`, `hr`) — BUKAN `id_department`.
   *
   * Dipakai tool berjenis `kode` yang menyaring lewat `access_menus` di
   * `ai_knowledge.documents`, yang isinya slug, bukan uuid. Dua-duanya perlu:
   * `idDepartment` untuk penyaring baris di view, slug ini untuk dokumen.
   *
   * `null` kalau departemen karyawannya kosong atau di luar lingkup portal —
   * dan itu berarti dia cuma melihat dokumen yang terbuka untuk semua.
   */
  departemen: string | null;
  idDepartment: string | null;
  /**
   * Nama departemen seperti tertulis di tabel perusahaan ("Trade Marketing"),
   * bukan slug portal.
   *
   * ⚠️ ADA KARENA KEGAGALAN NYATA, 7 Okt 2026. Hasil tool cuma menyebut
   * `cakupan: "departemen"` tanpa menyebut departemen YANG MANA. Ditanya
   * "klaim departemen HR apa saja?", Gemma 12B membaca baris Trade Marketing
   * yang sudah tersaring benar lalu menyajikannya sebagai "daftar klaim untuk
   * departemen HR".
   *
   * Datanya tidak bocor — labelnya yang berbohong, dan label yang salah lebih
   * berbahaya daripada menolak menjawab: pembacanya tidak punya cara tahu.
   */
  namaDepartemen?: string | null;
  /**
   * Kode izin yang dipunyai pemakai, mis. `ticket:read`, dari peran di
   * `users_config` -> `role_menu.permissions`.
   *
   * ⚠️ `undefined` berbeda dari `[]`, dan bedanya menentukan.
   *
   *   `[]`        -> sudah ditelusuri, pemakai memang tidak punya izin apa pun
   *   `undefined` -> belum ditelusuri (mis. sesi buatan skrip uji)
   *
   * Tool yang mensyaratkan izin ditolak pada keduanya. Yang membuat pembedaan
   * ini penting adalah ALASAN yang dicetak: "tidak punya izin" dan "izin belum
   * ditelusuri" perlu ditangani manusia dengan cara yang berbeda.
   */
  izin?: string[];
  idCompany: string | null;
  idUsers: string | null;
};

const PENGENAL = /^[a-z_][a-z0-9_]*$/;
/** Sama dengan CHECK di `ai_sumber_data.nama_view`. */
const NAMA_VIEW = /^v_ai_[a-z0-9_]+$/;

/** Mengutip pengenal yang SUDAH lolos daftar-boleh. Bukan pengganti periksa. */
function kutip(nama: string): string {
  return `"${nama}"`;
}

export class KonfigTidakSah extends Error {}

/** Batas baris yang sudah dijepit, dipakai perakit DAN pratinjau. */
function batasAman(t: KonfigTool): number {
  return Math.min(Math.max(t.batas || 20, 1), MAKS_BARIS);
}

function arah(t: KonfigTool): string {
  return t.urut.arah === "asc" ? "ASC" : "DESC";
}

/**
 * Merangkai potongan query jadi satu teks.
 *
 * ⚠️ DIPAKAI BERSAMA perakit yang benar-benar menjalankan query DAN pratinjau
 * yang ditampilkan di layar pengaturan. Kalau pratinjau disusun terpisah,
 * suatu hari keduanya berbeda -- dan yang dilihat administrator bukan lagi
 * query yang sebenarnya dijalankan. Pratinjau yang berbohong lebih buruk
 * daripada tidak ada pratinjau.
 */
function rangkai(a: {
  pilih: string;
  view: string;
  syarat: string[];
  urut: string | null;
  batas: number;
}): string {
  return (
    `SELECT ${a.pilih} FROM ${a.view}` +
    (a.syarat.length > 0 ? ` WHERE ${a.syarat.join(" AND ")}` : "") +
    (a.urut ? ` ORDER BY ${a.urut}` : "") +
    ` LIMIT ${a.batas}`
  );
}

/**
 * Query yang AKAN dijalankan tool ini, untuk ditampilkan ke administrator.
 *
 * Nilai `$1` diisi server dari sesi login, bukan dari jawaban model -- itu
 * yang paling penting terbaca dari pratinjau ini.
 *
 * Filter dari model TIDAK ikut: isinya baru ada waktu model memanggilnya, dan
 * menampilkan filter karangan akan membuat pratinjau ini tidak cocok dengan
 * query mana pun yang benar-benar jalan.
 */
export function pratinjauSql(t: KonfigTool): string | null {
  if (t.jenis !== "konfigurasi" || !t.sumber || t.operasi !== "baca") return null;
  if (t.kolom.length === 0) return null;

  const p = t.sumber.penyaring;
  const kolomSaring =
    t.cakupan === "semua"
      ? null
      : t.cakupan === "departemen"
        ? p.departemen
        : t.cakupan === "perusahaan"
          ? p.perusahaan
          : p.employee;

  const syarat = kolomSaring
    ? [
        t.cakupan === "bawahan"
          ? `"${kolomSaring}" IN (SELECT e.id_employee FROM employee e\n                        WHERE e.id_manager = $1 OR e.id_employee = $1)`
          : `"${kolomSaring}" = $1`,
      ]
    : [];

  const sql = rangkai({
    pilih: t.kolom.map((k) => `"${k}"`).join(", "),
    view: `"${t.sumber.view}"`,
    syarat,
    urut: t.urut.kolom ? `"${t.urut.kolom}" ${arah(t)}` : null,
    batas: batasAman(t),
  });

  // Dipenggal per klausa supaya terbaca di layar sempit.
  return sql
    .replace(" FROM ", `\n  FROM `)
    .replace(" WHERE ", `\n WHERE `)
    .replace(" ORDER BY ", `\n ORDER BY `)
    .replace(" LIMIT ", `\n LIMIT `) +
    (kolomSaring ? `\n-- $1 diisi server dari sesi login, bukan dari jawaban model` : "");
}

function pastikanNama(nama: string, boleh: Set<string>, untuk: string): string {
  if (!boleh.has(nama)) throw new KonfigTidakSah(`${untuk}: "${nama}" di luar daftar-boleh tool ini`);
  if (!PENGENAL.test(nama)) throw new KonfigTidakSah(`${untuk}: "${nama}" bukan pengenal yang aman`);
  return kutip(nama);
}

/** Kolom penyaring + nilai dari sesi untuk sebuah cakupan. */
function penyaringUntuk(t: KonfigTool, sesi: SesiPemakai):
  | { perlu: false }
  | { perlu: true; kolom: string; nilai: string; bawahan: boolean }
  | { perlu: true; kurang: string } {
  if (t.cakupan === "semua") return { perlu: false };
  const p = t.sumber?.penyaring;
  if (!p) throw new KonfigTidakSah(`cakupan ${t.cakupan} tapi tool tidak punya sumber data`);

  const peta: Record<Exclude<Cakupan, "semua">, { kolom: string | null; nilai: string | null; label: string }> = {
    diri: { kolom: p.employee, nilai: sesi.idEmployee, label: "karyawan" },
    bawahan: { kolom: p.employee, nilai: sesi.idEmployee, label: "karyawan" },
    departemen: { kolom: p.departemen, nilai: sesi.idDepartment, label: "departemen" },
    perusahaan: { kolom: p.perusahaan, nilai: sesi.idCompany, label: "perusahaan" },
  };
  const { kolom, nilai, label } = peta[t.cakupan];

  // Konfigurasi yang salah -> berhenti. Ini seharusnya sudah ditangkap
  // `lib/ai-konfig.ts`, dan diperiksa lagi di sini justru karena kalau lolos
  // akibatnya query tanpa WHERE.
  if (!kolom) throw new KonfigTidakSah(`cakupan ${t.cakupan} tapi sumbernya tidak punya kolom penyaring`);

  // Sesi yang tidak lengkap -> menolak menjawab, BUKAN melepas penyaringnya.
  if (!nilai) return { perlu: true, kurang: label };

  return { perlu: true, kolom, nilai, bawahan: t.cakupan === "bawahan" };
}

export type HasilTool = {
  baris: Record<string, unknown>[];
  /** Berapa baris yang BENAR-BENAR dibaca model. Dibatasi `batas`. */
  jumlah: number;
  /**
   * Berapa baris yang COCOK seluruhnya, tanpa batas.
   *
   * ⚠️ Sama dengan `jumlah` kalau tidak terpotong. Bedanya yang menjawab
   * "ada berapa": tanpa ini model cuma tahu hasilnya terpotong, tidak tahu
   * terpotong dari berapa — lalu mengarang kesimpulan.
   */
  total: number;
  terpotong: boolean;
  sumber: string;
  cakupan: Cakupan;
  /** Pemilik baris ini, dengan nama. Lihat `milikSiapa()`. */
  milik: string;
  /** Peringatan untuk model, diletakkan tepat di sebelah barisnya. */
  catatan?: string;
};

/**
 * Siapa pemilik baris yang dikembalikan tool ini, dalam kata yang dikenal
 * manusia.
 *
 * ⚠️ "departemen" saja TIDAK CUKUP, dan itu terbukti: model yang membaca
 * `cakupan: "departemen"` sambil ditanya soal HR menyimpulkan barisnya milik
 * HR. Yang menutup celah itu bukan aturan tambahan di instruksi — melainkan
 * menyebut namanya di tempat yang tidak bisa dilewatkan, yaitu di dalam hasil
 * tool itu sendiri.
 */
export function milikSiapa(cakupan: Cakupan, sesi: SesiPemakai): string {
  switch (cakupan) {
    case "semua":
      return "seluruh perusahaan";
    case "diri":
      return "karyawan yang bertanya";
    case "bawahan":
      return "karyawan yang bertanya dan bawahan langsungnya";
    case "departemen":
      return sesi.namaDepartemen
        ? `departemen ${sesi.namaDepartemen}`
        : "departemen karyawan yang bertanya";
    case "perusahaan":
      return "perusahaan karyawan yang bertanya";
  }
}

/**
 * Membuat tool baca dari satu baris konfigurasi.
 *
 * Dibuat ULANG tiap request karena terikat pada sesi yang sedang login.
 * Jangan ditaruh di agent yang di-cache.
 */
/**
 * Dipanggil tiap kali sebuah tool benar-benar membaca sumbernya.
 *
 * ⚠️ Ini satu-satunya cara nama view sampai ke layar. Waktu router
 * mendelegasikan, pemanggilan tool agent bawahan TIDAK ikut ke klien --
 * yang sampai cuma `delegate_task`. Tanpa pencatat ini, jawaban yang jelas
 * mengambil data dari database akan berlabel "tidak mengambil data dari
 * database": persis kesalahan yang sudah terjadi tiga kali di
 * `app/components/chat.tsx`, dan label yang salah lebih buruk daripada tidak
 * ada label.
 */
/**
 * Satu pemakaian tool: alat apa, dan dari view mana datanya.
 *
 * ⚠️ `view` boleh `null`, dan itu bukan kekurangan. Tool berjenis kode
 * (`cari_sop`) tidak membaca satu view pun — ia mencari lewat kedekatan makna.
 * Tool tulis juga tidak. Memaksakan nama view untuk keduanya berarti mengarang
 * sumber yang tidak pernah dibaca.
 */
export type Jejak = { alat: string; view: string | null };

export type CatatSumber = (j: Jejak) => void;

/** Keterangan arah operator, supaya model tahu `dari` itu batas bawah. */
const KET_OPERATOR: Record<string, string> = {
  dari: "batas AWAL (tanggal paling lama), format YYYY-MM-DD",
  sampai: "batas AKHIR (tanggal paling baru), format YYYY-MM-DD",
  berisi: "cocok sebagian, tidak harus persis",
  sama: "harus persis sama",
};

/**
 * Nama parameter untuk sebuah filter.
 *
 * ⚠️ IKUT OPERATOR KALAU KOLOMNYA DIPAKAI LEBIH DARI SEKALI.
 *
 * Versi pertama memakai nama kolom saja. Selama tiap kolom cuma punya satu
 * filter itu aman — dan memang begitu keadaannya sampai 13 Okt 2026, waktu
 * `jatuh_tempo` diberi `dari` DAN `sampai` dari layar pengaturan.
 *
 * Akibatnya: keduanya jadi SATU parameter bernama `jatuh_tempo`, dan nilai
 * yang sama dipasang ke `>=` sekaligus `<=`. Tidak ada galat — rentang
 * tanggal apa pun cuma tidak pernah menyaring, dan jawabannya terlihat wajar.
 *
 * Nama tetap pendek kalau kolomnya cuma punya satu filter, supaya tool yang
 * sudah ada tidak berubah nama parameternya.
 */
function namaParam(semua: FilterTool[], f: FilterTool): string {
  const berapa = semua.filter((x) => x.kolom === f.kolom).length;
  return berapa > 1 ? `${f.kolom}_${f.operator}` : f.kolom;
}

export function buatToolBaca(t: KonfigTool, sesi: SesiPemakai, catat?: CatatSumber) {
  if (t.operasi !== "baca") throw new KonfigTidakSah(`${t.kode}: bukan operasi baca`);
  if (!t.sumber) throw new KonfigTidakSah(`${t.kode}: tidak punya sumber data`);
  if (!NAMA_VIEW.test(t.sumber.view)) throw new KonfigTidakSah(`${t.kode}: nama view "${t.sumber.view}" tidak sah`);

  // Daftar-boleh kolom untuk tool INI. Kolom yang ada di view tapi tidak
  // dicentang administrator tidak boleh ikut, termasuk lewat filter.
  const bolehBaca = new Set(t.kolom);
  const bolehFilter = new Set(t.filter.map((f) => f.kolom));
  const bolehUrut = new Set([...(t.urut.kolom ? [t.urut.kolom] : [])]);

  const pilih = t.kolom.map((k) => pastikanNama(k, bolehBaca, `${t.kode} kolom`)).join(", ");
  const view = kutip(t.sumber.view);

  // Tiap filter jadi satu parameter opsional. Labelnya ikut ke deskripsi
  // supaya model tahu format yang diharapkan tanpa harus menebak.
  const bentuk: Record<string, z.ZodTypeAny> = {};
  for (const f of t.filter) {
    bentuk[namaParam(t.filter, f)] = z
      .string()
      .optional()
      .describe(KET_OPERATOR[f.operator] ? `${f.label} — ${KET_OPERATOR[f.operator]}` : f.label);
  }

  const contoh = t.contoh ? ` Contoh pertanyaan: "${t.contoh}"` : "";
  const milik = milikSiapa(t.cakupan, sesi);
  // ⚠️ Menyebut PEMILIKNYA, bukan cuma nama cakupannya. "disaring ke
  // departemen" membiarkan model mengira departemen mana pun yang sedang
  // ditanya; "disaring ke departemen Trade Marketing" tidak.
  const catatanCakupan =
    t.cakupan === "semua"
      ? ""
      : ` Hasilnya SELALU dari ${milik}, dan tidak bisa diarahkan ke orang,` +
        ` departemen, atau perusahaan lain.`;

  return createTool({
    name: t.kode,
    description: `${t.deskripsi}${catatanCakupan}${contoh}`,
    parameters: z.object(bentuk),
    execute: async (args: Record<string, unknown>): Promise<HasilTool | { galat: string }> => {
      const saring = penyaringUntuk(t, sesi);
      if (saring.perlu && "kurang" in saring) {
        return {
          galat:
            `Tidak bisa dijawab: akun kamu belum terhubung ke ${saring.kurang}, ` +
            `padahal data ini disaring per ${saring.kurang}. Minta admin melengkapinya.`,
        };
      }

      const syarat: string[] = [];
      const nilai: unknown[] = [];

      if (saring.perlu && "kolom" in saring) {
        const kol = kutip(saring.kolom);
        nilai.push(saring.nilai);
        if (saring.bawahan) {
          // Diri sendiri + orang yang manajernya saya. Satu tingkat, bukan
          // seluruh pohon: "bawahan" yang berarti cucu buah juga perlu
          // disepakati dulu, bukan diputuskan di sini.
          syarat.push(
            `${kol} IN (SELECT e.id_employee FROM employee e ` +
              `WHERE e.id_manager = $${nilai.length} OR e.id_employee = $${nilai.length})`,
          );
        } else {
          syarat.push(`${kol} = $${nilai.length}`);
        }
      }

      for (const f of t.filter) {
        const v = args[namaParam(t.filter, f)];
        if (v === undefined || v === null || v === "") continue;
        const kol = pastikanNama(f.kolom, bolehFilter, `${t.kode} filter`);
        nilai.push(String(v));
        const n = `$${nilai.length}`;
        // Operator ikut dari konfigurasi, bukan dari model. Nilainya selalu
        // parameter -- termasuk untuk `berisi`, yang digabung di SQL, bukan
        // ditempel ke teks query.
        if (f.operator === "berisi") syarat.push(`${kol}::text ILIKE '%' || ${n} || '%'`);
        else if (f.operator === "sama") syarat.push(`${kol}::text = ${n}`);
        else if (f.operator === "dari") syarat.push(`${kol} >= ${n}::date`);
        else if (f.operator === "sampai") syarat.push(`${kol} <= ${n}::date`);
        else throw new KonfigTidakSah(`${t.kode}: operator "${f.operator}" tidak dikenal`);
      }

      const batas = batasAman(t);
      // +1 baris untuk tahu hasilnya terpotong atau tidak, tanpa COUNT kedua.
      const sql = rangkai({
        pilih,
        view,
        syarat,
        urut: t.urut.kolom ? `${pastikanNama(t.urut.kolom, bolehUrut, `${t.kode} urut`)} ${arah(t)}` : null,
        batas: batas + 1,
      });

      const hasil = await poolPerusahaan().query(sql, nilai);
      // Dicatat SESUDAH query berhasil: view yang gagal dibaca bukan sumber
      // jawaban, dan menyebutnya akan membuat label berbohong ke arah lain.
      catat?.({ alat: t.kode, view: t.sumber!.view });
      const terpotong = hasil.rows.length > batas;
      const baris = terpotong ? hasil.rows.slice(0, batas) : hasil.rows;

      /**
       * Jumlah SEBENARNYA, bukan jumlah yang terbaca.
       *
       * ⚠️ LAHIR DARI KEGAGALAN NYATA, 9 Okt 2026. Tool aset departemen
       * berbatas 6 baris dipakai di departemen yang punya 22. Hasilnya
       * bertanda `terpotong: true` dengan benar — lalu model menjawab
       * "6 baris data ini ... belum ada data tambahan yang bisa ditarik lebih
       * lanjut". Pembacanya menyimpulkan departemen itu memang punya 6 aset.
       *
       * Sebabnya: `terpotong` memberi tahu BAHWA ada lagi, tapi tidak
       * memberi tahu BERAPA. Tanpa angka pembanding, model mengisi
       * kekosongan itu dengan kesimpulan — persis pola yang berulang di
       * proyek ini.
       *
       * ⚠️ COUNT HANYA DIJALANKAN KALAU MEMANG TERPOTONG. Kalau tidak,
       * jumlah yang terbaca SUDAH totalnya, dan query kedua cuma beban: tiap
       * pemanggilan tool jadi dua kali menyentuh view yang bisa mahal.
       */
      let total = baris.length;
      if (terpotong) {
        const sqlHitung =
          `SELECT count(*)::int AS n FROM ${view}` +
          (syarat.length > 0 ? ` WHERE ${syarat.join(" AND ")}` : "");
        const h = await poolPerusahaan().query<{ n: number }>(sqlHitung, nilai);
        total = h.rows[0]?.n ?? baris.length;
      }

      return {
        baris: baris as Record<string, unknown>[],
        jumlah: baris.length,
        total,
        terpotong,
        sumber: t.sumber!.view,
        cakupan: t.cakupan,
        // ⚠️ Pemiliknya ikut DI DALAM hasil, bukan cuma di deskripsi tool.
        // Deskripsi dibaca sekali waktu memilih tool; yang ada di sebelah
        // barisnya terbaca lagi waktu menyusun jawaban — dan di situlah
        // labelnya dulu jadi salah.
        milik,
        ...(t.cakupan === "semua"
          ? {}
          : {
              catatan:
                `Baris di atas SELURUHNYA milik ${milik}. Kalau pertanyaannya ` +
                `menyebut orang, departemen, atau perusahaan LAIN, baris ini ` +
                `bukan jawabannya: katakan kamu tidak bisa melihat data itu. ` +
                `JANGAN menyajikan baris ini sebagai milik mereka.`,
            }),
      };
    },
  });
}

/**
 * Merakit semua tool sebuah agent yang bisa dirakit sekarang.
 *
 * Yang belum bisa dirakit TIDAK dibuat diam-diam dan tidak membuat seluruh
 * agent gagal -- alasannya dikembalikan di `dilewati` supaya kelihatan:
 *
 *   - `jenis = "kode"`  -> dibuat `registry-kode.ts`. Yang penanganya belum
 *     terdaftar di situ dilewati dengan menyebut penangan yang ada, bukan
 *     hilang diam-diam.
 *   - operasi tulis     -> `buat_tiket` dan kawan-kawan perlu kartu konfirmasi
 *     dan penulisan ke tabel perusahaan. Itu pekerjaan tersendiri, dan
 *     setengah-setengah di sini berarti model bisa menulis baris tanpa
 *     manusia menekan Simpan.
 */
export function buatToolDariKonfig(
  daftar: KonfigTool[],
  sesi: SesiPemakai,
  catat?: CatatSumber,
  catatRancangan?: CatatRancangan,
): { tool: ReturnType<typeof buatToolBaca>[]; dilewati: { kode: string; sebab: string }[] } {
  const tool: ReturnType<typeof buatToolBaca>[] = [];
  const dilewati: { kode: string; sebab: string }[] = [];

  for (const t of daftar) {
    // ⚠️ GERBANG IZIN, DIPERIKSA SEBELUM APA PUN DIRAKIT.
    //
    // `ai_tool.izin` diisi tim lain (`ticket:read` pada tool tiket) dan selama
    // ini TIDAK PERNAH kita baca. Akibatnya satu-satunya pembatas sebuah tool
    // adalah cakupannya — dan tool bercakupan `semua` terlihat oleh SEMUA
    // pemegang aplikasinya. Untuk antrean tiket itu berarti keluhan siapa pun
    // terbaca siapa pun.
    //
    // `izin` yang `null` berarti tidak ada syarat, bukan "belum diisi":
    // seluruh tool yang kita daftarkan sendiri bernilai null.
    if (t.izin) {
      const punya = sesi.izin;
      if (!punya) {
        dilewati.push({ kode: t.kode, sebab: `butuh izin "${t.izin}", tapi izin pemakai belum ditelusuri` });
        continue;
      }
      if (!punya.includes(t.izin)) {
        dilewati.push({
          kode: t.kode,
          sebab: `butuh izin "${t.izin}"; pemakai punya ${punya.length === 0 ? "(tidak satu pun)" : punya.join(", ")}`,
        });
        continue;
      }
    }

    if (t.jenis === "kode") {
      const k = buatToolKode(t, sesi, catat);
      if (k) tool.push(k as unknown as ReturnType<typeof buatToolBaca>);
      else {
        dilewati.push({
          kode: t.kode,
          sebab: `penangan "${t.penangan ?? "(kosong)"}" tidak dikenal; yang ada: ${penanganDikenal().join(", ")}`,
        });
      }
      continue;
    }
    if (t.operasi !== "baca") {
      // ⚠️ GERBANG PERSETUJUAN, SEBELUM TOOL TULIS TIM LAIN DIRAKIT.
      //
      // Penjalan umum merakit tool tulis dari baris konfigurasi tanpa kode
      // khusus, dan `ai_tool` diisi tim lain juga — jadi baris tulis MEREKA
      // ikut terakit begitu tabel sasarannya ada di daftar-boleh. Terjadi
      // 13 Okt 2026: `tutup_tiket` dan `batalkan_tiket` hidup di portal ini
      // tanpa ditinjau siapa pun, dan yang kedua tool yang minggu sebelumnya
      // DIHAPUS atas permintaan tim IT.
      //
      // Alasannya tercetak, bukan hilang diam-diam — layar Kelola AI yang
      // menawarkan tombol setujuinya. Lihat `lib/tulis-disetujui.ts`.
      if (tulisPerluPersetujuan(t) && !t.tulisDisetujui) {
        dilewati.push({
          kode: t.kode,
          sebab:
            `tool tulis milik ${t.pemilik ?? "(tanpa pemilik)"} dan belum disetujui tim IT portal ini — ` +
            `operasi "${t.operasi}" pada tabel "${t.tabelTarget ?? "(tidak disebut)"}". ` +
            `Setujui dari halaman Kelola AI kalau memang mau dipakai.`,
        });
        continue;
      }
      // ⚠️ Yang dirakit di sini tetap TIDAK MENULIS. `registry-tulis.ts`
      // memulangkan tool penyusun rancangan; penyimpanannya dipicu tombol.
      // Yang belum terdaftar di situ tetap dilewati dengan alasan tercetak.
      const w = buatToolTulis(t, sesi, catatRancangan, catat);
      if (w) tool.push(w as unknown as ReturnType<typeof buatToolBaca>);
      else {
        dilewati.push({
          kode: t.kode,
          sebab: `operasi "${t.operasi}" belum dirakit; yang sudah ada: ${tulisDikenal().join(", ") || "(belum ada)"}`,
        });
      }
      continue;
    }
    try {
      tool.push(buatToolBaca(t, sesi, catat));
    } catch (e) {
      dilewati.push({ kode: t.kode, sebab: e instanceof KonfigTidakSah ? e.message : String(e) });
    }
  }
  return { tool, dilewati };
}
