/**
 * Penjalan tulis UMUM — merakit operasi dari baris konfigurasi, bukan dari
 * kode per tool.
 *
 * ⚠️ INI YANG MENGHAPUS HARDCODE. `tiket.ts` dan `tiket-ubah.ts` ditulis
 * khusus untuk satu tool masing-masing. Berkas ini merakit operasinya dari
 * `kolom_isian`, `kolom_otomatis`, `kolom_kunci`, dan `syarat` — persis seperti
 * `tool-konfigurasi.ts` merakit SELECT dari `kolom`/`filter`/`urut`. Tool tulis
 * baru yang dibuat dari layar Kelola AI jalan di sini tanpa kode baru.
 *
 * ============================================================
 * EMPAT PENJAGAAN YANG TIDAK BISA DIMATIKAN DARI KONFIGURASI
 * ============================================================
 * Borang yang bisa membuat tool tulis adalah borang yang bisa membuat
 * "UPDATE tabel apa pun, kolom apa pun". Itu tidak boleh. Yang membatasinya:
 *
 *   1. TABEL SASARAN dari daftar-boleh di berkas ini. Baris konfigurasi yang
 *      menyebut tabel lain ditolak, bukan dijalankan.
 *   2. KOLOM yang boleh ditulis diambil dari HAK ROLE DATABASE, dibaca saat
 *      itu juga. Konfigurasi tidak bisa memperluas apa yang database sendiri
 *      tolak — paling jauh ia mempersempit.
 *   3. PENYARING PEMILIK SELALU ikut di `WHERE`, dan tidak datang dari
 *      konfigurasi. Tidak ada setelan yang bisa menghilangkannya.
 *   4. KUNCI WAJIB ADA untuk operasi ubah/hapus. Tanpa kunci, `UPDATE` tanpa
 *      `WHERE` akan menyentuh seluruh tabel.
 */
import { createHash } from "node:crypto";
import { poolPerusahaan } from "../db-perusahaan";
import { poolTulis } from "./simpan-tiket";

/**
 * Tabel yang boleh ditulis, dan kolom mana yang menyatakan pemiliknya.
 *
 * ⚠️ DAFTAR INI DI KODE, BUKAN DI KONFIGURASI, dan itu disengaja. Kalau tabel
 * sasaran bisa diisi dari layar, satu baris konfigurasi bisa mengarahkan
 * penulisan ke `employee` atau `users`. Menambah tabel di sini adalah
 * keputusan yang ditinjau, bukan isian borang.
 *
 * Nilainya kolom pemilik — dasar penyaring "hanya baris milik penanya", yang
 * SELALU ditambahkan dan tidak bisa dimatikan konfigurasi.
 */
export const TABEL_BOLEH: Record<string, string> = {
  portal_ticket: "id_employee",
};

/**
 * Kolom yang MENJELASKAN baris, untuk ditampilkan di kartu konfirmasi.
 *
 * ⚠️ DIMINTA TIM IT 13 Okt 2026, SESUDAH MELIHAT KARTUNYA YANG PERTAMA.
 *
 * Kartu pembatalan tiket saat itu cuma menampilkan nomor tiket, nama tabel,
 * dan `OPEN -> CANCELLED`. Semuanya benar, dan semuanya tidak cukup: orang
 * diminta menekan "Simpan" untuk membatalkan sesuatu tanpa diberi tahu
 * sesuatu itu apa. Nomor tiket bukan bahasa manusia, dan satu angka salah
 * ketik membatalkan keluhan yang keliru tanpa ada yang menyadarinya.
 *
 * ⚠️ DI KODE, BUKAN DI KONFIGURASI — alasannya sama dengan `TABEL_BOLEH` di
 * atas. Kolom yang ditampilkan ikut dibaca dari tabel sasaran, jadi daftar
 * yang bisa diisi dari layar berarti satu baris konfigurasi bisa menarik
 * kolom mana pun ke layar orang — termasuk yang seharusnya tidak dilihat.
 *
 * Tabel tanpa entri di sini tidak rusak: kartunya cuma kembali menampilkan
 * kunci dan perubahannya, persis seperti sebelumnya.
 */
export const KOLOM_KETERANGAN: Record<string, { kolom: string; label: string; maks?: number }[]> = {
  portal_ticket: [
    { kolom: "subject", label: "Judul", maks: 140 },
    { kolom: "description", label: "Keterangan", maks: 400 },
    { kolom: "status", label: "Status sekarang" },
    { kolom: "priority", label: "Prioritas" },
    { kolom: "created_at", label: "Dibuat" },
  ],
};

/** Satu baris keterangan yang sudah siap ditampilkan. */
export type Keterangan = { kolom: string; label: string; nilai: string };

/**
 * ⚠️ Waktu dipendekkan sampai MENIT, bukan ditampilkan apa adanya.
 * `2026-10-08 11:22:30.551121` tidak membantu siapa pun memutuskan, dan
 * panjangnya mendorong kolom lain keluar layar di ponsel.
 */
function rapikanNilai(v: unknown, maks?: number): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  let t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t)) t = t.slice(0, 16).replace("T", " ");
  if (maks && t.length > maks) t = `${t.slice(0, maks).trimEnd()}…`;
  return t;
}

export type Isian = {
  kolom: string;
  label: string;
  wajib?: boolean;
  maks?: number;
  bawaan?: unknown;
  pilihan?: { jenis: string; opsi?: { nilai: string; label: string }[] };
};
export type Otomatis = { kolom: string; label?: string; nilai?: unknown; sumber?: string };
export type Kunci = { kolom: string; label?: string };
export type Syarat = { kolom: string; boleh: string[] };

export type KonfigTulis = {
  kode: string;
  operasi: "tambah" | "ubah" | "hapus";
  tabel: string;
  isian: Isian[];
  otomatis: Otomatis[];
  kunci: Kunci[];
  syarat: Syarat[];
};

export type Perubahan = { kolom: string; label: string; dari: string; jadi: string };

export type Draf = {
  kode: string;
  operasi: KonfigTulis["operasi"];
  tabel: string;
  /** Nilai kunci yang menunjuk barisnya, mis. `{ no_ticket: "T2026..." }`. */
  kunci: Record<string, string>;
  /** Ringkasan baris yang disentuh, untuk ditampilkan di kartu. */
  judulBaris: string;
  /**
   * Keterangan baris yang disentuh — judul tiketnya, statusnya, kapan dibuat.
   *
   * ⚠️ TIDAK IKUT SIDIK, dan itu disengaja. Sidik ada untuk menangkap baris
   * yang BERUBAH DI TENGAH antara menyusun rancangan dan menyimpannya; yang
   * perlu ditangkap cuma perubahan yang mengenai operasinya. Kalau judul
   * tiketnya kebetulan disunting orang lain sedetik sebelum Simpan ditekan,
   * pembatalannya tetap sah — menolaknya cuma memaksa orang mengulang tanpa
   * alasan.
   */
  keterangan: Keterangan[];
  perubahan: Perubahan[];
};

export type Masalah =
  | { jenis: "konfigurasi"; sebab: string }
  | { jenis: "kurang"; label: string }
  | { jenis: "tidak-ketemu"; nilai: string }
  | { jenis: "bukan-milik-anda"; nilai: string }
  | { jenis: "syarat"; kolom: string; sekarang: string; boleh: string[] }
  | { jenis: "kepanjangan"; label: string; maks: number; panjang: number }
  | { jenis: "tidak-dikenal"; label: string; diberi: string; pilihan: string[] }
  | { jenis: "tanpa-perubahan" };

export type Hasil = { ok: true; draf: Draf } | { ok: false; masalah: Masalah[] };

function nama(x: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(x)) throw new Error(`nama kolom tidak sah: ${x}`);
  return `"${x}"`;
}

/**
 * Kolom yang BOLEH ditulis role penulis pada sebuah tabel, dibaca dari
 * database saat itu juga.
 *
 * ⚠️ Inilah penjagaan yang tidak bisa dilewati konfigurasi. Kalau administrator
 * membuat tool yang menulis `status` sementara role-nya tidak punya hak di
 * kolom itu, tool-nya ditolak DI SINI dengan alasan yang jelas — bukan gagal
 * belakangan dengan pesan PostgreSQL yang tidak menunjuk sebabnya.
 */
async function kolomBolehTulis(tabel: string, jenis: "INSERT" | "UPDATE"): Promise<Set<string>> {
  const user = process.env.DEMO_PG_TULIS_USER ?? "ai_tulis";
  // ⚠️ `has_column_privilege`, BUKAN `information_schema.column_privileges`.
  //
  // Tampilan `column_privileges` cuma memperlihatkan hak yang BOLEH DILIHAT
  // oleh pengguna yang bertanya. Pool ini `ai_readonly`, yang bukan grantor
  // maupun anggota `ai_tulis` — jadi hasilnya KOSONG, bukan karena haknya
  // tidak ada. Versi pertama memakainya dan menolak setiap penulisan dengan
  // alasan "hak UPDATE belum diberikan", padahal sudah (8 Okt 2026).
  //
  // `has_column_privilege` menjawab pertanyaannya langsung dan bisa ditanyakan
  // tentang role lain.
  const { rows } = await poolPerusahaan().query<{ kolom: string }>(
    `SELECT a.attname AS kolom
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege($2, a.attrelid, a.attname, $3)`,
    [tabel, user, jenis],
  );
  return new Set(rows.map((r) => r.kolom));
}

/** Baris `ai_tool` -> konfigurasi tulis, atau alasan kenapa tidak bisa dipakai. */
export function bacaKonfigTulis(t: {
  kode: string; operasi: string; tabelTarget: string | null;
  isian: unknown; otomatis: unknown; kunci: unknown; syarat: unknown;
}): { ok: true; konfig: KonfigTulis } | { ok: false; sebab: string } {
  if (t.operasi === "baca") return { ok: false, sebab: "bukan operasi tulis" };
  if (!t.tabelTarget) return { ok: false, sebab: "tabel_target kosong" };
  if (!(t.tabelTarget in TABEL_BOLEH)) {
    return {
      ok: false,
      sebab: `tabel "${t.tabelTarget}" tidak ada di daftar-boleh penulisan (${Object.keys(TABEL_BOLEH).join(", ")})`,
    };
  }
  const kunci = (Array.isArray(t.kunci) ? t.kunci : []) as Kunci[];
  // ⚠️ Operasi ubah/hapus TANPA kunci akan jadi UPDATE tanpa WHERE.
  if (t.operasi !== "tambah" && kunci.length === 0) {
    return { ok: false, sebab: `operasi "${t.operasi}" tanpa kolom_kunci — akan menyentuh seluruh tabel` };
  }
  return {
    ok: true,
    konfig: {
      kode: t.kode,
      operasi: t.operasi as KonfigTulis["operasi"],
      tabel: t.tabelTarget,
      isian: (Array.isArray(t.isian) ? t.isian : []) as Isian[],
      otomatis: (Array.isArray(t.otomatis) ? t.otomatis : []) as Otomatis[],
      kunci,
      syarat: (Array.isArray(t.syarat) ? t.syarat : []) as Syarat[],
    },
  };
}

function rapat(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Susun rancangan untuk operasi ubah/hapus.
 *
 * `tambah` belum lewat sini — ia punya penjalan sendiri yang sudah teruji di
 * `tiket.ts`, dan menggabungkannya sekarang berarti mengganti jalur yang
 * berjalan dengan jalur yang baru ditulis.
 */
export async function susunDrafUmum(
  k: KonfigTulis,
  idEmployee: string | null,
  masukan: Record<string, string | undefined>,
): Promise<Hasil> {
  if (!idEmployee) {
    return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: "Sesi tidak terhubung ke data karyawan." }] };
  }
  if (k.operasi === "tambah") {
    return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: "Operasi tambah belum lewat penjalan umum." }] };
  }

  const kolomPemilik = TABEL_BOLEH[k.tabel];
  const boleh = await kolomBolehTulis(k.tabel, "UPDATE");

  // ---- nilai kunci ----
  const kunci: Record<string, string> = {};
  for (const kc of k.kunci) {
    const v = (masukan[kc.kolom] ?? "").trim();
    if (!v) return { ok: false, masalah: [{ jenis: "kurang", label: kc.label ?? kc.kolom }] };
    kunci[kc.kolom] = v;
  }

  // ---- baris yang disentuh, dibaca lewat pool BACA ----
  const kolomBaca = [
    ...new Set([
      ...k.kunci.map((x) => x.kolom),
      ...k.syarat.map((x) => x.kolom),
      ...k.isian.map((x) => x.kolom),
      ...k.otomatis.map((x) => x.kolom),
      ...(KOLOM_KETERANGAN[k.tabel] ?? []).map((x) => x.kolom),
      kolomPemilik,
    ]),
  ];
  const syaratKunci = k.kunci.map((x, i) => `${nama(x.kolom)} = $${i + 1}`).join(" AND ");
  const { rows } = await poolPerusahaan().query<Record<string, unknown>>(
    `SELECT ${kolomBaca.map(nama).join(", ")} FROM ${nama(k.tabel)} WHERE ${syaratKunci}`,
    k.kunci.map((x) => kunci[x.kolom]),
  );
  const baris = rows[0];
  const nilaiKunci = Object.values(kunci).join(", ");
  if (!baris) return { ok: false, masalah: [{ jenis: "tidak-ketemu", nilai: nilaiKunci }] };

  // ⚠️ PENJAGAAN YANG TIDAK BISA DIMATIKAN KONFIGURASI.
  if (String(baris[kolomPemilik] ?? "") !== idEmployee) {
    return { ok: false, masalah: [{ jenis: "bukan-milik-anda", nilai: nilaiKunci }] };
  }

  for (const s of k.syarat) {
    const sekarang = String(baris[s.kolom] ?? "");
    if (!s.boleh.includes(sekarang)) {
      return { ok: false, masalah: [{ jenis: "syarat", kolom: s.kolom, sekarang, boleh: s.boleh }] };
    }
  }

  // ---- perubahan ----
  const masalah: Masalah[] = [];
  const perubahan: Perubahan[] = [];
  const tolakKolom = (kolom: string) =>
    masalah.push({
      jenis: "konfigurasi",
      sebab: `kolom "${kolom}" tidak boleh ditulis role database — hak UPDATE-nya belum diberikan`,
    });

  for (const o of k.otomatis) {
    if (o.nilai === undefined || o.nilai === null) continue;
    if (!boleh.has(o.kolom)) { tolakKolom(o.kolom); continue; }
    const jadi = String(o.nilai);
    const dari = String(baris[o.kolom] ?? "");
    if (dari !== jadi) perubahan.push({ kolom: o.kolom, label: o.label ?? o.kolom, dari, jadi });
  }

  for (const i of k.isian) {
    const diminta = masukan[i.kolom];
    if (diminta === undefined || !diminta.trim()) continue;
    if (!boleh.has(i.kolom)) { tolakKolom(i.kolom); continue; }
    let v = diminta.trim();
    if (i.maks && v.length > i.maks) {
      masalah.push({ jenis: "kepanjangan", label: i.label, maks: i.maks, panjang: v.length });
      continue;
    }
    const opsi = i.pilihan?.opsi ?? [];
    if (opsi.length > 0) {
      const cocok = opsi.find((o) => rapat(o.nilai) === rapat(v) || rapat(o.label) === rapat(v));
      if (!cocok) {
        masalah.push({ jenis: "tidak-dikenal", label: i.label, diberi: v, pilihan: opsi.map((o) => o.label) });
        continue;
      }
      v = cocok.nilai;
    }
    const dari = String(baris[i.kolom] ?? "");
    if (dari !== v) perubahan.push({ kolom: i.kolom, label: i.label, dari, jadi: v });
  }

  if (masalah.length > 0) return { ok: false, masalah };
  if (perubahan.length === 0) return { ok: false, masalah: [{ jenis: "tanpa-perubahan" }] };

  // ⚠️ Kolom yang SUDAH tampil sebagai perubahan tidak diulang di keterangan.
  // Tanpa ini kartu pembatalan menampilkan "Status sekarang: OPEN" tepat di
  // atas "Status baru: OPEN -> CANCELLED" — dua baris untuk satu hal, dan
  // pembaca harus memastikan sendiri keduanya tidak saling bertentangan.
  const sudahTampil = new Set(perubahan.map((x) => x.kolom));
  const keterangan: Keterangan[] = [];
  for (const kt of KOLOM_KETERANGAN[k.tabel] ?? []) {
    if (sudahTampil.has(kt.kolom)) continue;
    const nilai = rapikanNilai(baris[kt.kolom], kt.maks);
    // Kolom kosong DILEWATI, bukan ditampilkan sebagai "(kosong)". Di kartu
    // konfirmasi, baris kosong cuma menambah yang harus dibaca tanpa menambah
    // yang perlu diketahui.
    if (!nilai) continue;
    keterangan.push({ kolom: kt.kolom, label: kt.label, nilai });
  }

  return {
    ok: true,
    draf: {
      kode: k.kode,
      operasi: k.operasi,
      tabel: k.tabel,
      kunci,
      judulBaris: nilaiKunci,
      keterangan,
      perubahan,
    },
  };
}

/** Sidik rancangan — nilai LAMA ikut, supaya baris yang berubah di tengah tertangkap. */
export function sidikUmum(d: Draf): string {
  const inti = JSON.stringify({
    k: d.kode, t: d.tabel, u: d.kunci,
    p: d.perubahan.map((x) => [x.kolom, x.dari, x.jadi]),
  });
  return createHash("sha256").update(inti).digest("hex").slice(0, 16);
}

export type HasilSimpan =
  | { ok: true; draf: Draf }
  | { ok: false; sebab: "draf-berubah" | "tidak-sah" | "gagal"; pesan: string; masalah?: Masalah[] };

/**
 * Jalankan rancangannya.
 *
 * ⚠️ `WHERE` memuat KUNCI + PEMILIK + SELURUH SYARAT, dan ketiganya diperiksa
 * lagi di database — bukan cuma waktu menyusun rancangan. Di antara memeriksa
 * dan menyimpan ada jeda, dan dalam jeda itu teknisi bisa mengambil tiketnya.
 */
export async function jalankanUmum(
  k: KonfigTulis,
  idEmployee: string | null,
  masukan: Record<string, string | undefined>,
  sidikHarapan: string,
): Promise<HasilSimpan> {
  const h = await susunDrafUmum(k, idEmployee, masukan);
  if (!h.ok) return { ok: false, sebab: "tidak-sah", pesan: "Rancangan tidak bisa disusun.", masalah: h.masalah };
  const draf = h.draf;
  if (sidikUmum(draf) !== sidikHarapan) {
    return {
      ok: false,
      sebab: "draf-berubah",
      pesan: "Barisnya berubah sejak rancangan ditampilkan. Lihat sekali lagi sebelum menyimpan.",
    };
  }

  const boleh = await kolomBolehTulis(k.tabel, "UPDATE");
  const set: string[] = [];
  const nilai: unknown[] = [];
  for (const p of draf.perubahan) {
    if (!boleh.has(p.kolom)) return { ok: false, sebab: "gagal", pesan: `kolom "${p.kolom}" tidak boleh ditulis` };
    nilai.push(p.jadi);
    set.push(`${nama(p.kolom)} = $${nilai.length}`);
  }

  const syarat: string[] = [];
  for (const kc of k.kunci) {
    nilai.push(draf.kunci[kc.kolom]);
    syarat.push(`${nama(kc.kolom)} = $${nilai.length}`);
  }
  nilai.push(idEmployee);
  syarat.push(`${nama(TABEL_BOLEH[k.tabel])} = $${nilai.length}::uuid`);
  for (const s of k.syarat) {
    nilai.push(s.boleh);
    syarat.push(`${nama(s.kolom)} = ANY($${nilai.length}::text[])`);
  }

  try {
    const { rowCount } = await poolTulis().query(
      `UPDATE ${nama(k.tabel)} SET ${set.join(", ")}, updated_at = now() WHERE ${syarat.join(" AND ")}`,
      nilai,
    );
    if (rowCount === 0) {
      return { ok: false, sebab: "draf-berubah", pesan: "Barisnya berubah tepat sebelum disimpan. Coba lihat ulang." };
    }
    return { ok: true, draf };
  } catch (e) {
    return { ok: false, sebab: "gagal", pesan: `Gagal menyimpan: ${(e as Error).message}` };
  }
}

export function masalahUmumJadiTeks(m: Masalah[]): string {
  return m
    .map((x) => {
      switch (x.jenis) {
        case "konfigurasi": return x.sebab;
        case "kurang": return `${x.label} belum disebut.`;
        case "tidak-ketemu": return `Data "${x.nilai}" tidak ada.`;
        case "bukan-milik-anda": return `"${x.nilai}" bukan milik kamu, jadi tidak bisa kamu ubah.`;
        case "syarat": return `Sekarang ${x.kolom} = ${x.sekarang}; hanya bisa saat ${x.boleh.join(" atau ")}.`;
        case "kepanjangan": return `${x.label} kepanjangan: ${x.panjang} huruf, maksimal ${x.maks}.`;
        case "tidak-dikenal": return `${x.label} "${x.diberi}" tidak dikenali. Pilihannya: ${x.pilihan.join(", ")}.`;
        case "tanpa-perubahan": return "Tidak ada yang berubah — isinya sama dengan yang sekarang.";
      }
    })
    .join(" ");
}
