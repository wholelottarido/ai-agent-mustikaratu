/**
 * Registry tool operasi TULIS — yang dirakit di sini menyusun RANCANGAN,
 * bukan menulis.
 *
 * ============================================================
 * ⚠️ TIDAK ADA TOOL DI SINI YANG MENYENTUH DATABASE UNTUK MENULIS
 * ============================================================
 * `ai_tool` menyimpan `operasi = "tambah"` untuk `buat_tiket`, dan nama itu
 * menggambarkan maksud barisnya — bukan yang dikerjakan model. Yang dibuat di
 * sini memulangkan rancangan; penyimpanannya dipicu tombol yang ditekan
 * manusia lewat `/api/entri/tiket`.
 *
 * Model secara harfiah tidak punya jalan menulis: `lib/entri/simpan-tiket.ts`
 * tidak pernah diimpor dari berkas mana pun yang dipegang agent.
 *
 * ============================================================
 * KENAPA NAMANYA `siapkan_`, BUKAN `buat_`
 * ============================================================
 * Nama tool ikut terbaca model, dan `buat_tiket` yang memulangkan `status:
 * "siap"` mengundangnya menjawab "tiket sudah dibuat" — padahal belum ada
 * baris sama sekali. Kekeliruan persis itu pernah terjadi di jalur entri
 * penjualan (28 Sep 2026): model mengaku sudah menyimpan padahal belum.
 *
 * Jadi nama yang sampai ke model adalah `siapkan_tiket`. Kode barisnya di
 * database tetap `buat_tiket` — itu nama milik tim lain, dan bukan kita yang
 * mengubahnya.
 *
 * ============================================================
 * KENAPA REGISTRY, BUKAN PERAKIT UMUM
 * ============================================================
 * Perakit umum untuk semua tool `tambah` perlu memahami bentuk tiap `pilihan`
 * di `kolom_isian` — termasuk relasi bertingkat seperti sub-kategori yang
 * harus milik kategori terpilih. Itu pekerjaan tersendiri, dan setengah jadi
 * di sini berarti rancangan yang lolos dengan pasangan mustahil.
 *
 * Yang tidak terdaftar di sini tetap DILEWATI dengan alasan yang tercetak.
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import type {
  KonfigTool, KolomIsian, KolomOtomatis, KolomKunci,
} from "@/lib/ai-konfig";
import type { SesiPemakai, CatatSumber } from "./tool-konfigurasi";
import {
  susunDraf, sidikDraf, masalahJadiTeks, KODE_TOOL as KODE_TIKET,
  type Draf, type Permintaan,
} from "@/lib/entri/tiket";
import {
  susunDrafUbah, sidikDrafUbah, masalahUbahJadiTeks, KODE_TOOL as KODE_UBAH,
  type Draf as DrafUbah, type Permintaan as PermintaanUbah,
} from "@/lib/entri/tiket-ubah";
import {
  bacaKonfigTulis, susunDrafUmum, sidikUmum, masalahUmumJadiTeks,
  type Draf as DrafUmum,
} from "@/lib/entri/tulis-umum";

/** Rancangan yang perlu sampai ke layar sebagai kartu konfirmasi. */
export type Rancangan =
  | { jenis: "tiket"; draf: Draf; sidik: string; permintaan: Permintaan }
  | { jenis: "ubah-tiket"; draf: DrafUbah; sidik: string; permintaan: PermintaanUbah }
  | { jenis: "umum"; kode: string; draf: DrafUmum; sidik: string; permintaan: Record<string, string | undefined> };

/**
 * Dipanggil tiap kali sebuah rancangan selesai disusun.
 *
 * ⚠️ TANPA INI KARTUNYA TIDAK PERNAH MUNCUL. Waktu router mendelegasikan ke
 * agent aplikasi, pemanggilan tool agent bawahan TIDAK ikut ke klien -- yang
 * sampai cuma `delegate_task`. Jadi klien tidak akan pernah melihat part
 * `tool-siapkan_tiket`, dan rancangannya harus dikirim lewat metadata pesan.
 *
 * Persis mekanisme yang sudah dipakai `CatatSumber` untuk nama view, dan
 * sebabnya sama. Terjadi 8 Okt 2026: rancangan tersusun benar, model bahkan
 * menyuruh user menekan Simpan, tapi tombolnya tidak ada.
 */
export type CatatRancangan = (r: Rancangan) => void;

/**
 * Kode baris `ai_tool` -> nama tool yang SAMPAI KE MODEL.
 *
 * ⚠️ SATU SUMBER KEBENARAN, dan itu perlu. Instruksi agent menyusun daftar
 * "tool yang kamu punya" dari baris konfigurasi, sedangkan tool yang benar-
 * benar dipegang model bernama lain. Waktu keduanya dihitung terpisah,
 * `buat_tiket` hilang dari daftar instruksi -- model memegang `siapkan_tiket`
 * tanpa pernah diberi tahu tool itu ada. Terjadi 8 Okt 2026.
 */
export const NAMA_MODEL: Record<string, string> = {
  [KODE_TIKET]: "siapkan_tiket",
  [KODE_UBAH]: "siapkan_ubah_tiket",
};

/**
 * Nama yang dilihat model untuk satu baris konfigurasi.
 *
 * ⚠️ MENERIMA BARISNYA, BUKAN KODENYA SAJA. Versi pertama cuma menerima kode,
 * jadi ia tidak bisa tahu bahwa baris tulis tanpa penjalan khusus dirakit
 * dengan nama `siapkan_<kode>`. Akibatnya instruksi agent menyebut
 * `batalkan_tiket` sementara model memegang `siapkan_batalkan_tiket` — nama
 * yang tidak ada. Kekeliruan yang sama persis pernah terjadi pada `buat_tiket`
 * (8 Okt 2026), dan sebabnya sama: satu hal dihitung di dua tempat.
 */
export function namaUntukModel(t: { kode: string; operasi: string }): string {
  if (NAMA_MODEL[t.kode]) return NAMA_MODEL[t.kode];
  return t.operasi === "baca" ? t.kode : `siapkan_${t.kode}`;
}

function buatToolTiket(sesi: SesiPemakai, catat?: CatatRancangan) {
  return createTool({
    name: NAMA_MODEL[KODE_TIKET],
    description:
      "Menyiapkan RANCANGAN tiket helpdesk IT atas nama karyawan yang bertanya. " +
      "⚠️ TOOL INI TIDAK MENYIMPAN APA PUN. Hasilnya cuma rancangan yang " +
      "ditampilkan ke user beserta tombol konfirmasi; yang menyimpan adalah " +
      "tombol itu. JANGAN katakan tiketnya sudah dibuat, sudah masuk, atau " +
      "sudah diproses — belum ada satu baris pun. Katakan rancangannya sudah " +
      "disiapkan dan minta user menekan tombol Simpan. " +
      "Kalau hasilnya `status: \"perlu-perbaikan\"`, sampaikan pilihan yang " +
      "ditawarkan apa adanya dan tanyakan mana yang dimaksud — jangan menebak.",
    parameters: z.object({
      kategori: z.string().describe("Kategori tiket, mis. HARDWARE, NETWORK, SOFTWARE."),
      sub_kategori: z.string().describe("Sub-kategori di dalam kategori itu, mis. PRINTER, LAPTOP."),
      judul: z.string().describe("Ringkasan satu baris masalahnya."),
      deskripsi: z.string().describe("Penjelasan masalahnya, apa adanya dari kata-kata user."),
      prioritas: z.string().optional().describe("Rendah, Normal, atau Mendesak. Kosongkan kalau user tidak menyebut."),
    }),
    execute: async (a: {
      kategori: string; sub_kategori: string; judul: string; deskripsi: string; prioritas?: string;
    }) => {
      const minta = {
        kategori: a.kategori,
        subKategori: a.sub_kategori,
        judul: a.judul,
        deskripsi: a.deskripsi,
        prioritas: a.prioritas,
      };
      const h = await susunDraf(sesi.idEmployee, minta);
      if (!h.ok) {
        // ⚠️ Pilihan ikut dipulangkan, bukan cuma pesan galat. Tanpa daftar
        // pilihannya, model akan menebak lagi dengan kata yang sedikit beda —
        // dan tebakan kedua tidak lebih baik dari yang pertama.
        return {
          status: "perlu-perbaikan",
          pesan: masalahJadiTeks(h.masalah),
          masalah: h.masalah,
        };
      }
      const sidik = sidikDraf(h.draf);
      // Dicatat SESUDAH rancangannya sah. Rancangan yang gagal disusun bukan
      // rancangan, dan memunculkan kartunya akan menawarkan tombol Simpan
      // untuk sesuatu yang tidak lengkap.
      catat?.({ jenis: "tiket", draf: h.draf, sidik, permintaan: minta });
      return {
        status: "siap",
        draf: h.draf,
        sidik,
        // Dipulangkan supaya kartu konfirmasi bisa mengirim ULANG permintaan
        // aslinya. Server menyusun rancangannya sendiri dari sini — yang
        // dikirim klien tidak pernah dipercaya sebagai rancangan jadi.
        permintaan: minta,
        catatan:
          "BELUM TERSIMPAN. Tiket baru ada setelah user menekan tombol Simpan " +
          "pada kartu konfirmasi. Jangan menyebutkan nomor tiket — nomornya " +
          "baru dibuat saat penyimpanan.",
      };
    },
  });
}

function buatToolUbahTiket(sesi: SesiPemakai, catat?: CatatRancangan) {
  return createTool({
    name: NAMA_MODEL[KODE_UBAH],
    description:
      "Menyiapkan RANCANGAN perubahan tiket helpdesk yang SUDAH ADA, milik karyawan " +
      "yang bertanya. ⚠️ TOOL INI TIDAK MENYIMPAN APA PUN — hasilnya rancangan yang " +
      "ditampilkan beserta tombol konfirmasi, dan tombol itu yang menyimpan. JANGAN " +
      "katakan tiketnya sudah diubah. " +
      "Yang bisa diubah hanya judul, deskripsi, dan prioritas. Kategori TIDAK bisa " +
      "diubah, dan tiket yang sudah dikerjakan teknisi juga tidak. " +
      "Nomor tiketnya wajib — kalau user tidak menyebutnya, tanyakan dulu atau pakai " +
      "`asisten_tiket` untuk melihat daftar tiketnya.",
    parameters: z.object({
      no_tiket: z.string().describe("Nomor tiket, mis. T202610081108."),
      judul: z.string().optional().describe("Judul baru. Kosongkan kalau tidak diubah."),
      deskripsi: z.string().optional().describe("Deskripsi baru. Kosongkan kalau tidak diubah."),
      prioritas: z.string().optional().describe("Rendah, Normal, atau Mendesak. Kosongkan kalau tidak diubah."),
    }),
    execute: async (a: { no_tiket: string; judul?: string; deskripsi?: string; prioritas?: string }) => {
      const minta: PermintaanUbah = {
        noTiket: a.no_tiket, judul: a.judul, deskripsi: a.deskripsi, prioritas: a.prioritas,
      };
      const h = await susunDrafUbah(sesi.idEmployee, minta);
      if (!h.ok) {
        return { status: "perlu-perbaikan", pesan: masalahUbahJadiTeks(h.masalah), masalah: h.masalah };
      }
      const sidik = sidikDrafUbah(h.draf);
      catat?.({ jenis: "ubah-tiket", draf: h.draf, sidik, permintaan: minta });
      return {
        status: "siap",
        draf: h.draf,
        sidik,
        permintaan: minta,
        catatan:
          "BELUM TERSIMPAN. Perubahan baru berlaku setelah user menekan tombol Simpan " +
          "pada kartu konfirmasi.",
      };
    },
  });
}

/** Penanda baris milik portal ini di `ai_tool.updated_by`. */
const MILIK_KITA = "magang";

/**
 * Apakah baris tulis ini perlu persetujuan tim IT sebelum dirakit.
 *
 * ============================================================
 * ⚠️ KENAPA GERBANG INI ADA
 * ============================================================
 * `buatToolUmum()` merakit tool tulis dari baris konfigurasi tanpa kode
 * khusus — itu yang membuat "tambah tool tanpa hardcode" jadi nyata. Tapi
 * `ai_tool` juga diisi tim lain, jadi baris tulis MEREKA ikut terakit begitu
 * tabel sasarannya ada di daftar-boleh `TABEL_BOLEH`.
 *
 * Terjadi 13 Okt 2026. Tim lain membangun ulang katalognya dalam sehari, dan
 * `tutup_tiket` serta `batalkan_tiket` — dua tool tulis ke `portal_ticket` —
 * langsung hidup di portal ini tanpa ditinjau siapa pun. `batalkan_tiket`
 * bahkan tool yang MINGGU SEBELUMNYA dihapus dari portal ini atas permintaan
 * tim IT; dia kembali karena katalog sebelah berubah, bukan karena ada yang
 * memutuskan.
 *
 * ============================================================
 * ⚠️ YANG TIDAK DIJAGA GERBANG INI
 * ============================================================
 * Gerbang ini soal KEPUTUSAN, bukan soal keamanan teknis. Yang menjaga
 * teknisnya tetap: daftar-boleh tabel, hak per-kolom role `ai_tulis`,
 * penyaring pemilik yang selalu ikut, dan rancangan yang cuma bisa disimpan
 * tombol yang ditekan manusia. Semuanya tetap berlaku untuk tool yang SUDAH
 * disetujui — persetujuan tidak melonggarkan satu pun di antaranya.
 *
 * ============================================================
 * ⚠️ TOOL YANG PUNYA ENTRI `DAFTAR` TIDAK LEWAT SINI
 * ============================================================
 * `buat_tiket` dan `ubah_tiket` baris milik tim lain, tapi yang merakitnya
 * kode kita sendiri yang sudah ditinjau (`buatToolTiket`, `buatToolUbahTiket`).
 * Memintanya minta persetujuan berarti mematikan jalur entri tiket yang sudah
 * dipakai, untuk kekhawatiran yang tidak berlaku di situ.
 *
 * ============================================================
 * ⚠️ YANG TETAP TIDAK BISA DIRAKIT JUGA TIDAK DIMINTAI PERSETUJUAN
 * ============================================================
 * `bacaKonfigTulis()` yang memutuskan sebuah baris tulis bisa dijalankan sama
 * sekali: tabelnya harus ada di daftar-boleh, kuncinya harus ada, operasinya
 * harus punya penjalan. Baris yang gagal di situ akan tetap dilewati SESUDAH
 * disetujui — dan layar yang menawarkan tombol "Setujui" untuk sesuatu yang
 * tetap tidak jalan menyuruh orang mengambil keputusan yang tidak berakibat
 * apa pun.
 *
 * Tiga tool `*_jobdesk` tim lain contohnya: `jobdesk` di luar daftar-boleh,
 * jadi menyetujuinya tidak mengubah apa pun. Alasan dilewatinya tetap tercetak
 * — cuma alasan yang BENAR ("operasi belum dirakit"), bukan "belum disetujui".
 */
export function tulisPerluPersetujuan(t: {
  kode: string;
  operasi: string;
  pemilik: string | null;
  tabelTarget: string | null;
  isian: KolomIsian[];
  otomatis: KolomOtomatis[];
  kunci: KolomKunci[];
  syarat: unknown[];
}): boolean {
  if (t.operasi === "baca") return false;
  if (DAFTAR[t.kode]) return false;
  if (t.pemilik === MILIK_KITA) return false;
  // Kalau penjalan umum tidak akan menerimanya, persetujuan tidak ada gunanya.
  const baca = bacaKonfigTulis({
    kode: t.kode, operasi: t.operasi, tabelTarget: t.tabelTarget,
    isian: t.isian, otomatis: t.otomatis, kunci: t.kunci, syarat: t.syarat,
  });
  if (!baca.ok) return false;
  return true;
}

/** Kode baris `ai_tool` -> pembuat tool rancangannya. */
const DAFTAR: Record<
  string,
  (sesi: SesiPemakai, catat?: CatatRancangan) => ReturnType<typeof buatToolTiket>
> = {
  [KODE_TIKET]: buatToolTiket,
  [KODE_UBAH]: buatToolUbahTiket as unknown as typeof buatToolTiket,
};

/**
 * Tool tulis dari baris konfigurasi mana pun, tanpa kode khusus.
 *
 * ⚠️ INI YANG MEMBUAT "TANPA HARDCODE" JADI NYATA. Tool tulis yang dibuat dari
 * layar Kelola AI tidak punya entri di `DAFTAR`, dan dirakit di sini dari
 * `kolom_isian`/`kolom_otomatis`/`kolom_kunci`/`syarat` barisnya.
 *
 * Namanya diturunkan dari kodenya: `batalkan_tiket` -> `siapkan_batalkan_tiket`.
 * Awalan `siapkan_` dipakai konsisten supaya model tidak pernah mengira
 * pemanggilan tool berarti sesuatu sudah tersimpan.
 */
function buatToolUmum(t: KonfigTool, sesi: SesiPemakai, catat?: CatatRancangan) {
  const baca = bacaKonfigTulis({
    kode: t.kode, operasi: t.operasi, tabelTarget: t.tabelTarget,
    isian: t.isian, otomatis: t.otomatis, kunci: t.kunci, syarat: t.syarat,
  });
  if (!baca.ok) return null;
  const k = baca.konfig;
  // ⚠️ `buat_tiket` TIDAK sampai ke sini — ia punya entri di `DAFTAR`, jadi
  // `buatToolTulis()` memilih `buatToolTiket` lebih dulu. Yang lewat sini cuma
  // baris `tambah` yang tidak punya penjalan khusus, mis. yang dibuat tim IT
  // sendiri dari layar Kelola AI (21 Okt 2026).
  const bentuk: Record<string, z.ZodTypeAny> = {};
  for (const kc of k.kunci) {
    bentuk[kc.kolom] = z.string().describe(kc.label ?? kc.kolom);
  }
  for (const i of k.isian) {
    // ⚠️ Pilihan RELASI tidak disebutkan isinya di keterangan parameter.
    // Daftarnya datang dari tabel lain, bisa ratusan baris, dan isinya berubah
    // tanpa tool-nya dirakit ulang. Model mengirim apa yang dikatakan user;
    // `susunDrafTambah` yang mencocokkannya, dan kalau meleset ia memulangkan
    // daftar pilihan yang sah sebagai `perlu-perbaikan`.
    const opsi = i.pilihan?.jenis === "tetap" ? (i.pilihan.opsi ?? []) : [];
    let ket = opsi.length > 0 ? `${i.label}. Pilihan: ${opsi.map((o) => o.label).join(", ")}` : i.label;
    if (i.pilihan?.jenis === "relasi") ket = `${i.label}. Isi apa adanya dari kata user; nanti dicocokkan.`;
    bentuk[i.kolom] = i.wajib ? z.string().describe(ket) : z.string().optional().describe(ket);
  }
  // Nilai otomatis TIDAK jadi parameter: ia datang dari konfigurasi, bukan
  // dari model. Membiarkan model mengisinya berarti ia bisa memilih status.
  const tetap = k.otomatis
    .filter((o) => o.nilai !== undefined && o.nilai !== null)
    .map((o) => `${o.label ?? o.kolom} selalu "${String(o.nilai)}"`);

  return createTool({
    name: namaUntukModel(t),
    // ⚠️ KALIMAT KITA DULU, BARU DESKRIPSI BARISNYA.
    //
    // Deskripsi di `ai_tool` milik tim lain kadang teks template yang belum
    // terisi — `batalkan_tiket` berbunyi "Menandai terhapus data Batalkan
    // tiket helpdesk.", dan membacanya membuat model menyimpulkan ia tidak
    // punya akses lalu menolak permintaan yang sebenarnya bisa ia layani
    // (terjadi 8 Okt 2026). `nama` jauh lebih bersih, jadi itu yang memimpin.
    description:
      `${t.nama}, untuk data milik penanya sendiri. ` +
      // ⚠️ `tambah` tidak punya kunci, dan kalimat "Butuh  dari user" dengan
      // daftar kosong di tengahnya pernah membuat model menanyakan sesuatu
      // yang tidak ada namanya. Yang wajib disebut untuk `tambah` adalah
      // isiannya.
      (k.operasi === "tambah"
        ? `Wajib: ${k.isian.filter((x) => x.wajib).map((x) => x.label).join(", ") || "(tidak ada)"} — ` +
          `kalau belum disebut user, tanyakan dulu.`
        : `Butuh ${k.kunci.map((x) => x.label ?? x.kolom).join(" dan ")} dari user — ` +
          `kalau tidak disebut, tanyakan dulu.`) +
      (tetap.length > 0 ? ` ${tetap.join("; ")}.` : "") +
      ` ⚠️ TOOL INI TIDAK MENYIMPAN APA PUN — hasilnya rancangan yang ditampilkan ` +
      `beserta tombol konfirmasi, dan tombol itu yang menyimpan. JANGAN katakan ` +
      `datanya sudah berubah, dan JANGAN menolak dengan alasan tidak punya akses: ` +
      `tool ini ada di tanganmu, jalankan saja dan biarkan hasilnya yang bicara.` +
      (t.deskripsi ? ` Catatan konfigurasi: ${t.deskripsi}` : ""),
    parameters: z.object(bentuk),
    execute: async (a: Record<string, unknown>) => {
      const masukan: Record<string, string | undefined> = {};
      for (const [kunci, nilai] of Object.entries(a)) {
        if (typeof nilai === "string") masukan[kunci] = nilai;
      }
      const h = await susunDrafUmum(k, sesi.idEmployee, masukan);
      if (!h.ok) {
        return { status: "perlu-perbaikan", pesan: masalahUmumJadiTeks(h.masalah), masalah: h.masalah };
      }
      const sidik = sidikUmum(h.draf);
      catat?.({ jenis: "umum", kode: t.kode, draf: h.draf, sidik, permintaan: masukan });
      return {
        status: "siap",
        draf: h.draf,
        sidik,
        permintaan: masukan,
        catatan:
          k.operasi === "tambah"
            ? "BELUM TERSIMPAN. Barisnya baru ada setelah user menekan tombol Simpan. " +
              "JANGAN menyebutkan nomor atau ID — nilainya baru dibuat saat penyimpanan."
            : "BELUM TERSIMPAN. Perubahan baru berlaku setelah user menekan tombol Simpan.",
      };
    },
  });
}

export function buatToolTulis(
  t: KonfigTool,
  sesi: SesiPemakai,
  catat?: CatatRancangan,
  jejak?: CatatSumber,
) {
  const f = DAFTAR[t.kode];
  const alat = f ? f(sesi, catat) : (buatToolUmum(t, sesi, catat) as unknown as ReturnType<typeof buatToolTiket> | null);
  if (!alat || !jejak) return alat;

  // Tool tulis juga dicatat: pertanyaan "alat apa yang dipakai" tidak berhenti
  // di tool baca. `view: null` -- yang dirangkai UPDATE/INSERT, bukan SELECT
  // dari view.
  const asli = alat.execute?.bind(alat);
  if (!asli) return alat;
  return Object.assign(alat, {
    execute: async (a: never) => {
      const hasil = await asli(a);
      jejak({ alat: t.kode, view: null });
      return hasil;
    },
  });
}

export function tulisDikenal(): string[] {
  return Object.keys(DAFTAR);
}


