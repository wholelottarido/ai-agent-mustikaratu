/**
 * Membuat tool TULIS dari layar pengaturan.
 *
 * ⚠️ TERPISAH DARI `ubah-tool.ts`, dan bukan cuma soal panjang berkas. Tool
 * baca dan tool tulis dinilai dengan pertanyaan yang berbeda: yang satu "kolom
 * mana yang boleh DIBACA dan disaring untuk siapa", yang lain "baris mana yang
 * boleh DISENTUH dan dengan syarat apa". Menyatukannya membuat satu fungsi
 * panjang yang separuh pemeriksaannya tidak berlaku di separuh kasusnya.
 *
 * ============================================================
 * YANG BERUBAH DAN YANG TIDAK
 * ============================================================
 * Sampai 9 Okt 2026, tool buatan layar SELALU beroperasi `baca` — dijamin
 * DATABASE, karena role `ai_konfig` tidak punya cara mengisi kolom yang
 * menentukan sebaliknya. Jaminan itu kini dilepas supaya administrator bisa
 * membuat tool tulis sendiri.
 *
 * Yang TIDAK berubah, dan itu yang membuatnya tidak jadi lubang:
 *
 *   `jenis` dan `penangan` tetap di luar jangkauan role itu. Tool buatan layar
 *   tidak akan pernah bisa menunjuk fungsi mana pun untuk dijalankan, berapa
 *   pun bug di berkas ini.
 *
 * Dan pemeriksaan di sini BUKAN penjagaan utamanya. Yang menjaga sungguhan
 * `lib/entri/tulis-umum.ts`, dan ia memeriksa ULANG tiap kali tool dipakai:
 * daftar-boleh tabel, hak kolom role penulis, penyaring pemilik yang selalu
 * ikut, dan kunci yang wajib ada. Baris konfigurasi yang lolos dari sini tapi
 * melanggar di sana akan ditolak waktu dipakai — tersimpan, tapi tidak pernah
 * jalan.
 *
 * Yang dikerjakan di sini cuma membuat penolakan itu terbaca SEKARANG, waktu
 * administrator masih di depan borangnya, bukan nanti waktu seseorang bertanya
 * ke AI.
 */
import { poolKonfig } from "./db-konfig";
import { poolPerusahaan } from "./db-perusahaan";
import { muatKonfig, lupakanKonfig } from "./ai-konfig";
import { TABEL_BOLEH } from "./entri/tulis-umum";
import { izinAda, type HasilUbah } from "./ubah-tool";

const PEMILIK = "magang";

/** Satu kolom tabel sasaran, untuk ditawarkan di borang. */
export type KolomTarget = { nama: string; tipe: string; bisaTulis: boolean };

export type TargetTulis = {
  /** Sumber data yang mengarah ke tabel ini — penentu tabel sasarannya. */
  sumber: string;
  namaSumber: string;
  tabel: string;
  kolom: KolomTarget[];
};

/**
 * Tabel yang boleh ditulis dari layar, beserta kolomnya.
 *
 * ⚠️ DAFTARNYA DARI `TABEL_BOLEH` MILIK PENJALAN, bukan dari apa pun yang
 * terlihat di konfigurasi. Borang yang menawarkan tabel yang penjalannya tolak
 * akan membuat administrator menyimpan tool yang rapi lalu tidak pernah jalan
 * — kegagalan yang baru ketahuan waktu dipakai orang.
 *
 * ⚠️ `bisaTulis` DIBACA DARI HAK ROLE PENULIS saat itu juga, lewat
 * `has_column_privilege` dan bukan `information_schema.column_privileges`.
 * Tampilan itu hanya memperlihatkan hak yang boleh dilihat penanya; dibaca
 * dari pool `ai_readonly` hasilnya kosong, dan borang akan menyimpulkan tidak
 * ada kolom yang boleh ditulis. Jebakan yang sama sudah dua kali menipu di
 * proyek ini.
 */
export async function targetTulis(): Promise<TargetTulis[]> {
  const k = await muatKonfig();

  // ⚠️ SATU TABEL BISA PUNYA BEBERAPA SUMBER, DAN PILIHANNYA BUKAN SEMBARANG.
  //
  // Versi pertama memakai sumber PERTAMA yang kebetulan ketemu. Itu berjalan
  // selama `portal_ticket` cuma punya satu sumber — lalu 13 Okt 2026 tim lain
  // menambah `tiket_admin`, dan dialah yang kebetulan lebih dulu.
  //
  // `tiket_admin` tidak punya `kolom_employee`. Tool tulis yang lahir darinya
  // tersimpan rapi, lolos seluruh pemeriksaan borang, lalu DITOLAK pembaca
  // konfigurasi tiap kali dimuat: `cakupan "diri" tapi tiket_admin tidak punya
  // kolom penyaringnya`. Baris tulis selalu lahir bercakupan `diri`, jadi
  // sumber tanpa kolom pemilik tidak akan pernah bisa dipakai.
  //
  // Persis kegagalan yang berkas ini ada untuk mencegah: tool yang rapi di
  // layar, tidak pernah jalan di tangan orang.
  const kandidat = new Map<string, { kode: string; nama: string; punyaKita: boolean }[]>();
  const ditolak = new Map<string, string>();
  for (const t of [...k.agent.flatMap((a) => a.tool), ...k.lepas]) {
    const s = t.sumber;
    if (!s?.tabelAsal || !(s.tabelAsal in TABEL_BOLEH)) continue;
    const daftar = kandidat.get(s.tabelAsal) ?? [];
    if (daftar.some((x) => x.kode === s.kode)) continue;
    if (!s.penyaring.employee) {
      // Dicatat, bukan dibuang diam-diam: kalau suatu hari SELURUH sumber
      // sebuah tabel tidak punya kolom pemilik, tabelnya hilang dari borang
      // dan alasannya harus bisa dibaca.
      ditolak.set(s.kode, `sumber "${s.kode}" (${s.tabelAsal}) tidak punya kolom pemilik`);
      continue;
    }
    daftar.push({ kode: s.kode, nama: s.nama, punyaKita: t.pemilik === PEMILIK });
    kandidat.set(s.tabelAsal, daftar);
  }

  // Sumber milik kita lebih dulu, lalu urut kode. Urutan yang DITENTUKAN, bukan
  // urutan kedatangan — kalau tidak, pilihan borang berubah sendiri tiap kali
  // katalog tim lain berubah, dan tidak ada yang tahu kapan.
  const perTabel = new Map<string, { kode: string; nama: string }>();
  for (const [tabel, daftar] of kandidat) {
    daftar.sort((a, b) => Number(b.punyaKita) - Number(a.punyaKita) || a.kode.localeCompare(b.kode));
    perTabel.set(tabel, { kode: daftar[0].kode, nama: daftar[0].nama });
  }
  for (const [tabel] of Object.entries(TABEL_BOLEH)) {
    if (perTabel.has(tabel)) continue;
    const sebab = [...ditolak.values()].filter((x) => x.includes(`(${tabel})`));
    if (sebab.length > 0) {
      console.warn(
        `[tool-tulis-baru] "${tabel}" tidak ditawarkan borang: ${sebab.join("; ")}. ` +
          `Baris tulis selalu bercakupan "diri", jadi sumbernya harus punya kolom pemilik.`,
      );
    }
  }

  const user = process.env.DEMO_PG_TULIS_USER ?? "ai_tulis";
  const hasil: TargetTulis[] = [];
  for (const [tabel, s] of perTabel) {
    const { rows } = await poolPerusahaan().query<{ nama: string; tipe: string; tulis: boolean }>(
      `SELECT a.attname AS nama, format_type(a.atttypid, a.atttypmod) AS tipe,
              has_column_privilege($2, a.attrelid, a.attname, 'UPDATE') AS tulis
         FROM pg_attribute a
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [tabel, user],
    );
    hasil.push({
      sumber: s.kode,
      namaSumber: s.nama,
      tabel,
      kolom: rows.map((r) => ({ nama: r.nama, tipe: r.tipe, bisaTulis: r.tulis })),
    });
  }
  return hasil;
}

export type ToolTulisBaru = {
  kode: string;
  nama: string;
  deskripsi: string;
  /** Sumber data yang mengarah ke tabel sasaran. */
  sumber: string;
  /** `tambah` belum punya penjalan umum — lihat `tulis-umum.ts`. */
  operasi: "ubah" | "hapus";
  kunci: { kolom: string; label: string }[];
  isian: { kolom: string; label: string; maks?: number }[];
  otomatis: { kolom: string; label: string; nilai: string }[];
  syarat: { kolom: string; boleh: string[] }[];
  izin?: string | null;
  contoh: string | null;
  idApps?: string | null;
};

export async function buatToolTulisBaru(b: ToolTulisBaru): Promise<HasilUbah> {
  if (!/^[a-z][a-z0-9_]{2,59}$/.test(b.kode)) {
    return { ok: false, sebab: "kode hanya huruf kecil, angka, dan garis bawah; 3–60 huruf, diawali huruf" };
  }
  if (!b.nama.trim()) return { ok: false, sebab: "nama wajib diisi" };
  if (b.deskripsi.trim().length < 15) {
    return { ok: false, sebab: "deskripsi untuk model minimal 15 huruf — ini satu-satunya dasar model memilih tool" };
  }
  if (b.operasi !== "ubah" && b.operasi !== "hapus") {
    return { ok: false, sebab: `operasi "${b.operasi}" belum punya penjalan umum; yang bisa: ubah, hapus` };
  }

  const semua = await targetTulis();
  const target = semua.find((t) => t.sumber === b.sumber);
  if (!target) {
    return {
      ok: false,
      sebab:
        `sumber "${b.sumber}" tidak mengarah ke tabel yang boleh ditulis. ` +
        `Yang bisa: ${semua.map((t) => `${t.sumber} (${t.tabel})`).join(", ") || "(tidak ada)"}`,
    };
  }

  // ⚠️ KUNCI WAJIB. Tanpa kunci, yang dirangkai penjalan adalah UPDATE tanpa
  // WHERE — satu perintah menyentuh seluruh tabel.
  if (b.kunci.length === 0) {
    return { ok: false, sebab: "minimal satu kolom kunci — tanpa itu perintahnya menyentuh seluruh tabel" };
  }
  if (b.isian.length === 0 && b.otomatis.length === 0) {
    return { ok: false, sebab: "tidak ada yang diubah: isi minimal satu kolom isian atau satu nilai tetap" };
  }

  const kolom = new Map(target.kolom.map((k) => [k.nama, k]));
  for (const [daftar, perluTulis, label] of [
    [b.kunci, false, "kunci"],
    [b.syarat, false, "syarat"],
    [b.isian, true, "isian"],
    [b.otomatis, true, "nilai tetap"],
  ] as const) {
    for (const x of daftar) {
      const k = kolom.get(x.kolom);
      if (!k) return { ok: false, sebab: `kolom "${x.kolom}" tidak ada di ${target.tabel} (${label})` };
      if (perluTulis && !k.bisaTulis) {
        return {
          ok: false,
          sebab:
            `kolom "${x.kolom}" tidak boleh ditulis role database — hak UPDATE-nya belum diberikan (${label}). ` +
            `Tambahkan ke KOLOM_UBAH di scripts/buat-pg-tulis.mts lalu jalankan ulang skripnya.`,
        };
      }
    }
  }

  // ⚠️ Kolom kunci yang JUGA diubah berarti model bisa memindahkan barisnya ke
  // kunci lain — bukan menyunting baris yang dimaksud, tapi menimpa baris lain
  // yang kebetulan bernomor itu.
  const bentrok = b.kunci
    .filter((k) => b.isian.some((i) => i.kolom === k.kolom) || b.otomatis.some((o) => o.kolom === k.kolom))
    .map((k) => k.kolom);
  if (bentrok.length > 0) {
    return { ok: false, sebab: `kolom kunci tidak boleh ikut diubah: ${bentrok.join(", ")}` };
  }

  if (b.izin) {
    const p = await izinAda(b.izin);
    if (!p.ok) return p;
  }

  const [ada] = (await poolKonfig().query(`SELECT 1 FROM ai_tool WHERE kode = $1`, [b.kode])).rows;
  if (ada) return { ok: false, sebab: `kode "${b.kode}" sudah dipakai tool lain` };

  // `kolom` dan `filter` diisi kosong: keduanya milik tool BACA. `cakupan_bawaan`
  // diisi `diri` supaya lolos CHECK kolomnya — penjalan tulis tidak memakainya,
  // karena penyaring pemiliknya selalu ikut tanpa melihat setelan ini.
  await poolKonfig().query(
    `INSERT INTO ai_tool
       (kode, nama, deskripsi, id_ai_sumber_data, id_apps, operasi, tabel_target,
        kolom_isian, kolom_otomatis, kolom_kunci, syarat, kolom, filter,
        cakupan_bawaan, contoh_pertanyaan, izin, is_active, updated_by)
     SELECT $1, $2, $3, s.id_ai_sumber_data, COALESCE($12::uuid, s.id_apps), $4, $5,
            $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, '{}', '[]'::jsonb,
            'diri', $10, $11, false, $13
       FROM ai_sumber_data s WHERE s.kode = $14`,
    [
      b.kode, b.nama.trim(), b.deskripsi.trim(), b.operasi, target.tabel,
      JSON.stringify(b.isian), JSON.stringify(b.otomatis),
      JSON.stringify(b.kunci), JSON.stringify(b.syarat),
      b.contoh?.trim() || null, b.izin ?? null, b.idApps ?? null, PEMILIK, b.sumber,
    ],
  );

  lupakanKonfig();
  return { ok: true, kode: b.kode };
}
