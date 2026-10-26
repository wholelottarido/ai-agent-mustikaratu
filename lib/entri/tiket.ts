/**
 * Menyusun RANCANGAN tiket helpdesk. Berkas ini tidak menulis apa pun.
 *
 * ⚠️ MODEL TIDAK PERNAH MENYIMPAN. Ia cuma memanggil tool yang memulangkan
 * rancangan; yang menyimpan adalah tombol yang ditekan manusia, lewat
 * `simpan-tiket.ts`. Salah tafsir paling buruk pun hanya menghasilkan
 * rancangan keliru yang bisa ditolak — persis pola entri penjualan.
 *
 * ============================================================
 * KENAPA VALIDASINYA KETAT DI SINI
 * ============================================================
 * `portal_ticket` punya **NOL foreign key**. Database akan menerima
 * `id_category` karangan, `id_sub_category` milik kategori lain, dan
 * `id_employee` yang tidak ada — tanpa protes sedikit pun. Jadi satu-satunya
 * yang berdiri antara model yang salah tebak dan baris sampah di antrean
 * helpdesk sungguhan adalah berkas ini.
 *
 * ⚠️ TABELNYA HIDUP: 10.089 tiket, dan teknisi IT mengerjakan antreannya.
 * Baris sampah di sana bukan kotoran data, melainkan pekerjaan orang.
 *
 * ============================================================
 * DIGERAKKAN KONFIGURASI, BUKAN DITULIS DI KODE
 * ============================================================
 * Kolom yang boleh diisi, mana yang wajib, batas panjangnya, dan pilihan
 * prioritas semuanya dibaca dari `ai_tool.kolom_isian`. Menambah satu kolom
 * isian tidak perlu menyentuh berkas ini.
 */
import { createHash } from "node:crypto";
import { poolPerusahaan } from "../db-perusahaan";
import { cocokkan, pilihanRelasi, rapat, type Pilihan } from "./pilihan";

/** Kode tool di `ai_tool`. Satu-satunya nama yang ditulis tetap di sini. */
export const KODE_TOOL = "buat_tiket";

export type Permintaan = {
  kategori?: string;
  subKategori?: string;
  judul?: string;
  deskripsi?: string;
  prioritas?: string;
};

// `Pilihan` sekarang milik `pilihan.ts`; diekspor ulang supaya pemanggil lama tetap jalan.
export type { Pilihan } from "./pilihan";

export type Masalah =
  | { jenis: "kurang"; kolom: string; label: string }
  | { jenis: "kepanjangan"; kolom: string; label: string; maks: number; panjang: number }
  | { jenis: "tidak-dikenal"; kolom: string; label: string; diberi: string; pilihan: Pilihan[] }
  | { jenis: "bukan-milik-kategori"; diberi: string; kategori: string; pilihan: Pilihan[] }
  | { jenis: "konfigurasi"; sebab: string };

export type Draf = {
  idEmployee: string;
  kategori: { id: string; nama: string };
  subKategori: { id: string; nama: string };
  judul: string;
  deskripsi: string;
  prioritas: { nilai: string; label: string };
};

export type Hasil = { ok: true; draf: Draf } | { ok: false; masalah: Masalah[] };

/** Satu baris `kolom_isian` di `ai_tool`. */
type Isian = {
  kolom: string;
  label: string;
  wajib?: boolean;
  maks?: number;
  bawaan?: unknown;
  pilihan?: {
    jenis: "tetap" | "relasi";
    opsi?: { nilai: string; label: string }[];
    tabel?: string;
    kolom_nilai?: string;
    kolom_label?: string;
    saring_tetap?: { kolom: string; nilai: string }[];
    induk?: { isian: string; kolom_relasi: string };
  };
};

export type KonfigTiket = { isian: Isian[]; tabelTarget: string | null; aktif: boolean };

/**
 * Konfigurasi tool `buat_tiket`, dibaca LANGSUNG dari Postgres.
 *
 * Sengaja tidak lewat `muatKonfig()`: pembaca itu ikut membaca tabel sambungan
 * di MySQL portal, dan jalur penyimpanan tiket tidak punya alasan ikut mati
 * waktu MySQL mati. Yang dibutuhkan di sini cuma satu baris.
 */
export async function konfigTiket(): Promise<KonfigTiket | null> {
  const { rows } = await poolPerusahaan().query<{
    kolom_isian: Isian[] | null;
    tabel_target: string | null;
    is_active: boolean;
    operasi: string;
  }>(
    `SELECT kolom_isian, tabel_target, is_active, operasi
       FROM ai_tool WHERE kode = $1`,
    [KODE_TOOL],
  );
  const r = rows[0];
  if (!r) return null;
  // Tool yang berubah jadi bukan-tambah tidak boleh dipakai jalur ini: yang
  // dirakit di sini INSERT, dan menjalankannya untuk tool `ubah` akan
  // menggandakan baris, bukan mengubahnya.
  if (r.operasi !== "tambah") return null;
  return { isian: r.kolom_isian ?? [], tabelTarget: r.tabel_target, aktif: r.is_active };
}

/**
 * ⚠️ `rapat`, `cocokkan`, dan `pilihanRelasi` PINDAH ke `pilihan.ts`
 * (21 Okt 2026) supaya penjalan tulis umum memakai yang sama persis.
 *
 * Logikanya tidak berubah sedikit pun — termasuk aturan satu-arah pada
 * `cocokkan()` yang menolak "tidak mendesak" jadi URGENT. Catatan panjangnya
 * ikut pindah ke sana; baca dulu sebelum mengubahnya.
 */

/**
 * Susun rancangan tiket.
 *
 * `idEmployee` datang dari SESI, tidak pernah dari permintaan — kolom
 * `id_employee` ditandai `sumber: "karyawan"` di konfigurasi, dan membiarkan
 * model mengisinya berarti ia bisa melaporkan tiket atas nama orang lain.
 */
export async function susunDraf(idEmployee: string | null, minta: Permintaan): Promise<Hasil> {
  const masalah: Masalah[] = [];
  if (!idEmployee) {
    return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: "Sesi tidak terhubung ke data karyawan." }] };
  }

  const k = await konfigTiket();
  if (!k) return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: `Tool ${KODE_TOOL} tidak ada atau bukan operasi tambah.` }] };
  if (!k.aktif) return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: `Tool ${KODE_TOOL} sedang tidak aktif.` }] };

  const cari = (kolom: string) => k.isian.find((x) => x.kolom === kolom);
  const diminta: Record<string, string | undefined> = {
    id_category: minta.kategori,
    id_sub_category: minta.subKategori,
    subject: minta.judul,
    description: minta.deskripsi,
    priority: minta.prioritas,
  };

  // ---- teks biasa ----
  const teks: Record<string, string> = {};
  for (const kolom of ["subject", "description"]) {
    const i = cari(kolom);
    if (!i) continue;
    const v = (diminta[kolom] ?? "").trim();
    if (!v) {
      if (i.wajib) masalah.push({ jenis: "kurang", kolom, label: i.label });
      continue;
    }
    if (i.maks && v.length > i.maks) {
      masalah.push({ jenis: "kepanjangan", kolom, label: i.label, maks: i.maks, panjang: v.length });
      continue;
    }
    teks[kolom] = v;
  }

  // ---- kategori, lalu sub-kategori DI DALAM kategori itu ----
  let kategori: Pilihan | undefined;
  const iKat = cari("id_category");
  if (iKat) {
    const daftar = await pilihanRelasi(iKat.pilihan!);
    const v = (diminta.id_category ?? "").trim();
    if (!v) {
      if (iKat.wajib) masalah.push({ jenis: "kurang", kolom: "id_category", label: iKat.label });
    } else {
      const c = cocokkan(v, daftar);
      if (Array.isArray(c)) {
        masalah.push({ jenis: "tidak-dikenal", kolom: "id_category", label: iKat.label, diberi: v, pilihan: c });
      } else kategori = c;
    }
  }

  let sub: Pilihan | undefined;
  const iSub = cari("id_sub_category");
  if (iSub) {
    const v = (diminta.id_sub_category ?? "").trim();
    // ⚠️ Daftarnya disempitkan ke kategori yang terpilih. Tanpa itu, "OTHERS"
    // bisa terambil dari kategori mana pun — dan tiketnya masuk ke antrean
    // yang salah tanpa satu pun pesan galat.
    if (!kategori) {
      if (v && iSub.wajib) {
        masalah.push({ jenis: "konfigurasi", sebab: "Sub-kategori tidak bisa dipastikan sebelum kategorinya jelas." });
      } else if (iSub.wajib && !masalah.some((m) => "kolom" in m && m.kolom === "id_category")) {
        masalah.push({ jenis: "kurang", kolom: "id_sub_category", label: iSub.label });
      }
    } else {
      const daftar = await pilihanRelasi(iSub.pilihan!, kategori.nilai);
      if (!v) {
        if (iSub.wajib) masalah.push({ jenis: "kurang", kolom: "id_sub_category", label: iSub.label });
      } else {
        const c = cocokkan(v, daftar);
        if (Array.isArray(c)) {
          masalah.push({ jenis: "bukan-milik-kategori", diberi: v, kategori: kategori.label, pilihan: daftar });
        } else sub = c;
      }
    }
  }

  // ---- prioritas: pilihan tetap, boleh kosong -> nilai bawaan ----
  let prioritas: Pilihan | undefined;
  const iPri = cari("priority");
  if (iPri) {
    const opsi: Pilihan[] = (iPri.pilihan?.opsi ?? []).map((o) => ({ nilai: o.nilai, label: o.label }));
    const v = (diminta.priority ?? "").trim();
    if (!v) {
      const b = String(iPri.bawaan ?? "NORMAL");
      prioritas =
        opsi.find((o) => rapat(o.nilai) === rapat(b)) ??
        opsi.find((o) => rapat(o.label) === rapat(b)) ?? { nilai: b, label: b };
    } else {
      const c = cocokkan(v, opsi) as Pilihan | Pilihan[];
      // Nilai mentah ("URGENT") juga diterima, bukan cuma labelnya ("Mendesak").
      const lewatNilai = opsi.find((o) => rapat(o.nilai) === rapat(v));
      if (lewatNilai) prioritas = lewatNilai;
      else if (Array.isArray(c)) {
        masalah.push({ jenis: "tidak-dikenal", kolom: "priority", label: iPri.label, diberi: v, pilihan: opsi });
      } else prioritas = c;
    }
  }

  if (masalah.length > 0) return { ok: false, masalah };
  if (!kategori || !sub || !teks.subject || !teks.description || !prioritas) {
    // Tidak seharusnya tercapai: tiap kekurangan sudah jadi `masalah` di atas.
    // Diperiksa lagi karena kalau lolos, yang lahir adalah INSERT setengah isi.
    return { ok: false, masalah: [{ jenis: "konfigurasi", sebab: "Rancangan tidak lengkap." }] };
  }

  return {
    ok: true,
    draf: {
      idEmployee,
      kategori: { id: kategori.nilai, nama: kategori.label },
      subKategori: { id: sub.nilai, nama: sub.label },
      judul: teks.subject,
      deskripsi: teks.description,
      prioritas,
    },
  };
}

/**
 * Sidik rancangan — memastikan yang disimpan sama dengan yang DILIHAT user.
 *
 * Ikut dihitung: id dan namanya sekaligus. Kalau nama kategori berubah di
 * antara "lihat rancangan" dan "tekan simpan", user menyetujui tulisan yang
 * sudah tidak berlaku, dan itu harus tertangkap.
 */
export function sidikDraf(d: Draf): string {
  const inti = JSON.stringify({
    e: d.idEmployee,
    k: [d.kategori.id, d.kategori.nama],
    s: [d.subKategori.id, d.subKategori.nama],
    j: d.judul,
    d: d.deskripsi,
    p: d.prioritas.nilai,
  });
  return createHash("sha256").update(inti).digest("hex").slice(0, 16);
}

/** Rancangan jadi teks — dipakai WhatsApp, yang tidak punya kartu konfirmasi. */
export function drafJadiTeks(d: Draf): string {
  return [
    "*Rancangan tiket* (belum tersimpan)",
    `Kategori : ${d.kategori.nama} / ${d.subKategori.nama}`,
    `Prioritas: ${d.prioritas.label}`,
    `Judul    : ${d.judul}`,
    "",
    d.deskripsi,
  ].join("\n");
}

export function masalahJadiTeks(m: Masalah[]): string {
  return m
    .map((x) => {
      switch (x.jenis) {
        case "kurang":
          return `${x.label} belum diisi.`;
        case "kepanjangan":
          return `${x.label} kepanjangan: ${x.panjang} huruf, maksimal ${x.maks}.`;
        case "tidak-dikenal":
          return `${x.label} "${x.diberi}" tidak dikenali. Pilihannya: ${x.pilihan.map((p) => p.label).join(", ")}.`;
        case "bukan-milik-kategori":
          return `Sub-kategori "${x.diberi}" tidak ada di kategori ${x.kategori}. Pilihannya: ${x.pilihan.map((p) => p.label).join(", ")}.`;
        case "konfigurasi":
          return x.sebab;
      }
    })
    .join(" ");
}
