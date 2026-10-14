/**
 * Menyusun RANCANGAN penyuntingan tiket. Berkas ini tidak menulis apa pun.
 *
 * ⚠️ BEDA POKOK DARI `tiket.ts`: ini menyunting baris yang SUDAH ADA.
 *
 * Membuat tiket cuma perlu memeriksa masukannya. Menyunting perlu membaca
 * tiketnya dulu, lalu memeriksa tiga hal yang semuanya bisa salah:
 *
 *   1. tiketnya ada;
 *   2. pelapornya penanya sendiri — bukan tiket orang lain;
 *   3. statusnya masih boleh disunting (`syarat` di konfigurasi: OPEN).
 *
 * ⚠️ NOMOR 2 TIDAK DIJAMIN DATABASE, dan itu harus dibaca apa adanya.
 *
 * Pada pembuatan tiket, "tidak bisa lahir sudah selesai" dijamin kolomnya:
 * role `ai_tulis` memang tidak boleh mengisi `status`. Pada penyuntingan,
 * "hanya tiket milik penanya" tidak bisa dijamin begitu — PostgreSQL tidak
 * punya "UPDATE hanya baris milik X" tanpa RLS, dan menyalakan RLS di tabel
 * tim lain akan mengubah perilaku aplikasi mereka.
 *
 * Jadi batas itu ditegakkan di sini dan di `WHERE` penyimpannya. Yang TETAP
 * dijamin database cuma kolom mana yang boleh berubah: bug di kode kita
 * berarti judul tiket orang lain bisa berubah — tidak bisa jadi tiket orang
 * lain tertutup, ditugaskan ulang, atau terhapus.
 */
import { createHash } from "node:crypto";
import { poolPerusahaan } from "../db-perusahaan";

export const KODE_TOOL = "ubah_tiket";

export type Permintaan = {
  noTiket?: string;
  judul?: string;
  deskripsi?: string;
  prioritas?: string;
};

export type Pilihan = { nilai: string; label: string };

export type Masalah =
  | { jenis: "kurang"; label: string }
  | { jenis: "tidak-ketemu"; noTiket: string }
  | { jenis: "bukan-milik-anda"; noTiket: string }
  | { jenis: "status-tidak-boleh"; noTiket: string; status: string; boleh: string[] }
  | { jenis: "kepanjangan"; label: string; maks: number; panjang: number }
  | { jenis: "tidak-dikenal"; label: string; diberi: string; pilihan: Pilihan[] }
  | { jenis: "tanpa-perubahan" }
  | { jenis: "konfigurasi"; sebab: string };

/** Satu kolom yang berubah, beserta nilai sebelumnya. */
export type Perubahan = { kolom: string; label: string; dari: string; jadi: string };

export type Draf = {
  noTiket: string;
  /** Untuk ditampilkan di kartu, supaya user tahu tiket mana yang disunting. */
  judulSekarang: string;
  status: string;
  perubahan: Perubahan[];
};

export type Hasil = { ok: true; draf: Draf } | { ok: false; masalah: Masalah[] };

type Isian = {
  kolom: string;
  label: string;
  maks?: number;
  pilihan?: { jenis: string; opsi?: { nilai: string; label: string }[] };
};
type Syarat = { kolom: string; boleh: string[] };

export type KonfigUbah = {
  isian: Isian[];
  kunci: string[];
  syarat: Syarat[];
  aktif: boolean;
};

/**
 * Konfigurasi `ubah_tiket`, dibaca langsung dari Postgres.
 *
 * Sama alasannya dengan `tiket.ts`: jalur penyuntingan tidak punya alasan ikut
 * mati waktu MySQL portal mati.
 */
export async function konfigUbah(): Promise<KonfigUbah | null> {
  const { rows } = await poolPerusahaan().query<{
    kolom_isian: Isian[] | null;
    kolom_kunci: { kolom: string }[] | null;
    syarat: Syarat[] | null;
    is_active: boolean;
    operasi: string;
    tabel_target: string | null;
  }>(
    `SELECT kolom_isian, kolom_kunci, syarat, is_active, operasi, tabel_target
       FROM ai_tool WHERE kode = $1`,
    [KODE_TOOL],
  );
  const r = rows[0];
  if (!r) return null;
  // Tool yang berubah jadi bukan-ubah tidak boleh lewat jalur ini: yang
  // dirakit di sini UPDATE, dan menjalankannya untuk tool `tambah` akan
  // mengubah baris lama alih-alih membuat yang baru.
  if (r.operasi !== "ubah" || r.tabel_target !== "portal_ticket") return null;
  return {
    isian: r.kolom_isian ?? [],
    kunci: (r.kolom_kunci ?? []).map((k) => k.kolom),
    syarat: r.syarat ?? [],
    aktif: r.is_active,
  };
}

function rapat(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Cocokkan satu arah saja — label memuat ketikan, bukan sebaliknya.
 *
 * Alasannya sama dengan di `tiket.ts`: arah sebaliknya memetakan "tidak
 * mendesak" ke Mendesak, kebalikan maksudnya, tanpa pesan galat.
 */
function cocokkan(diberi: string, daftar: Pilihan[]): Pilihan | Pilihan[] {
  const q = rapat(diberi);
  const persis = daftar.filter((p) => rapat(p.label) === q || rapat(p.nilai) === q);
  if (persis.length === 1) return persis[0];
  const penggalan = daftar.filter((p) => rapat(p.label).includes(q));
  if (penggalan.length === 1) return penggalan[0];
  return penggalan.length > 0 ? penggalan : daftar;
}

/**
 * Susun rancangan penyuntingan.
 *
 * `idEmployee` dari SESI, dan dipakai sebagai syarat kepemilikan — bukan
 * sekadar untuk dicatat.
 */
export async function susunDrafUbah(
  idEmployee: string | null,
  minta: Permintaan,
): Promise<Hasil> {
  if (!idEmployee) {
    return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: "Sesi tidak terhubung ke data karyawan." }] };
  }
  const k = await konfigUbah();
  if (!k) return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: `Tool ${KODE_TOOL} tidak ada atau bukan operasi ubah.` }] };
  if (!k.aktif) return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: `Tool ${KODE_TOOL} sedang tidak aktif.` }] };

  const no = (minta.noTiket ?? "").trim();
  if (!no) return { ok: false, masalah: [{ jenis: "kurang", label: "No. tiket" }] };

  // ⚠️ Dibaca dengan pool BACA, bukan pool penulis. Yang memeriksa boleh atau
  // tidak tidak perlu — dan tidak boleh — memegang hak tulis.
  const { rows } = await poolPerusahaan().query<{
    no_ticket: string; subject: string; description: string | null;
    priority: string; status: string; id_employee: string | null;
  }>(
    `SELECT no_ticket, subject, description, priority, status, id_employee
       FROM portal_ticket WHERE no_ticket = $1`,
    [no],
  );
  const t = rows[0];
  if (!t) return { ok: false, masalah: [{ jenis: "tidak-ketemu", noTiket: no }] };

  // ⚠️ PEMERIKSAAN PALING PENTING DI BERKAS INI.
  //
  // Pesannya SENGAJA sama dengan "tidak ketemu" dari sisi pemakai? Tidak —
  // dibedakan, karena user yang salah ketik nomor dan user yang menyebut tiket
  // orang lain butuh pertolongan yang berbeda. Yang TIDAK boleh bocor adalah
  // isi tiketnya, dan itu memang tidak ikut dipulangkan.
  if (t.id_employee !== idEmployee) {
    return { ok: false, masalah: [{ jenis: "bukan-milik-anda", noTiket: t.no_ticket }] };
  }

  for (const s of k.syarat) {
    const nilai = s.kolom === "status" ? t.status : undefined;
    if (nilai !== undefined && !s.boleh.includes(nilai)) {
      return { ok: false, masalah: [{ jenis: "status-tidak-boleh", noTiket: t.no_ticket, status: t.status, boleh: s.boleh }] };
    }
  }

  const masalah: Masalah[] = [];
  const perubahan: Perubahan[] = [];
  const cari = (kolom: string) => k.isian.find((x) => x.kolom === kolom);
  const sekarang: Record<string, string> = {
    subject: t.subject,
    description: t.description ?? "",
    priority: t.priority,
  };

  for (const [kolom, diminta] of [
    ["subject", minta.judul],
    ["description", minta.deskripsi],
  ] as const) {
    const i = cari(kolom);
    if (!i || diminta === undefined) continue;
    const v = diminta.trim();
    if (!v) continue; // tidak disebut = tidak diubah, bukan dikosongkan
    if (i.maks && v.length > i.maks) {
      masalah.push({ jenis: "kepanjangan", label: i.label, maks: i.maks, panjang: v.length });
      continue;
    }
    if (v !== sekarang[kolom]) {
      perubahan.push({ kolom, label: i.label, dari: sekarang[kolom], jadi: v });
    }
  }

  const iPri = cari("priority");
  if (iPri && minta.prioritas !== undefined && minta.prioritas.trim()) {
    const opsi: Pilihan[] = (iPri.pilihan?.opsi ?? []).map((o) => ({ nilai: o.nilai, label: o.label }));
    const c = cocokkan(minta.prioritas.trim(), opsi);
    if (Array.isArray(c)) {
      masalah.push({ jenis: "tidak-dikenal", label: iPri.label, diberi: minta.prioritas.trim(), pilihan: opsi });
    } else if (c.nilai !== t.priority) {
      const lama = opsi.find((o) => o.nilai === t.priority);
      perubahan.push({ kolom: "priority", label: iPri.label, dari: lama?.label ?? t.priority, jadi: c.label });
    }
  }

  if (masalah.length > 0) return { ok: false, masalah };
  // ⚠️ Nol perubahan BUKAN keberhasilan. Tanpa ini, kartu konfirmasi muncul
  // dengan daftar kosong dan tombol Simpan yang tidak mengubah apa pun —
  // user menekan tombol lalu mengira sesuatu terjadi.
  if (perubahan.length === 0) return { ok: false, masalah: [{ jenis: "tanpa-perubahan" }] };

  return {
    ok: true,
    draf: { noTiket: t.no_ticket, judulSekarang: t.subject, status: t.status, perubahan },
  };
}

/**
 * Sidik rancangan.
 *
 * ⚠️ NILAI LAMA IKUT DIHITUNG, bukan cuma nilai barunya. Kalau tiketnya
 * berubah di antara "lihat rancangan" dan "tekan Simpan" — misalnya teknisi
 * sudah menyunting judulnya — maka "dari" tidak lagi cocok, sidiknya berbeda,
 * dan user diminta melihat ulang. Tanpa itu, penyuntingan menimpa perubahan
 * orang lain tanpa ada yang tahu.
 */
export function sidikDrafUbah(d: Draf): string {
  const inti = JSON.stringify({
    n: d.noTiket,
    s: d.status,
    p: d.perubahan.map((x) => [x.kolom, x.dari, x.jadi]),
  });
  return createHash("sha256").update(inti).digest("hex").slice(0, 16);
}

export function drafUbahJadiTeks(d: Draf): string {
  return [
    `*Rancangan perubahan tiket ${d.noTiket}* (belum tersimpan)`,
    ...d.perubahan.map((p) => `${p.label}: ${p.dari} -> ${p.jadi}`),
  ].join("\n");
}

export function masalahUbahJadiTeks(m: Masalah[]): string {
  return m
    .map((x) => {
      switch (x.jenis) {
        case "kurang":
          return `${x.label} belum disebut.`;
        case "tidak-ketemu":
          return `Tiket ${x.noTiket} tidak ada.`;
        case "bukan-milik-anda":
          return `Tiket ${x.noTiket} bukan tiket yang kamu laporkan, jadi tidak bisa kamu ubah.`;
        case "status-tidak-boleh":
          return `Tiket ${x.noTiket} berstatus ${x.status} dan hanya bisa diubah saat ${x.boleh.join(" atau ")}.`;
        case "kepanjangan":
          return `${x.label} kepanjangan: ${x.panjang} huruf, maksimal ${x.maks}.`;
        case "tidak-dikenal":
          return `${x.label} "${x.diberi}" tidak dikenali. Pilihannya: ${x.pilihan.map((p) => p.label).join(", ")}.`;
        case "tanpa-perubahan":
          return "Tidak ada yang berubah — isinya sama dengan yang sekarang.";
        case "konfigurasi":
          return x.sebab;
      }
    })
    .join(" ");
}
