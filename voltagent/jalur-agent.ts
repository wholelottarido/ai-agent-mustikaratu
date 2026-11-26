/**
 * Saklar antara dua jalur agent.
 *
 *   `lama`        — agent per DEPARTEMEN, ditulis tangan di
 *                   `voltagent/departemen/*` dan dirangkai `agents.ts`.
 *                   Model menulis SQL, lalu diperiksa `sql-guard`.
 *
 *   `konfigurasi` — agent per APLIKASI, dibaca dari `ai_agent`/`ai_tool` di
 *                   database perusahaan. Model tidak menulis SQL sama sekali;
 *                   query dirakit server dari baris konfigurasi.
 *
 * Dipilih lewat environment `JALUR_AGENT`. Bawaannya `lama`.
 *
 * ⚠️ BAWAANNYA JALUR LAMA, DAN ITU DISENGAJA.
 *
 * Jalur konfigurasi sudah diuji (65 pemeriksaan di empat berkas uji), tapi
 * belum pernah dipakai orang sungguhan. Saklar yang bawaannya menyala berarti
 * sekali `git pull`, semua pemakai pindah jalur tanpa ada yang memutuskannya.
 *
 * ⚠️ JATUH KE JALUR LAMA SELALU BERSUARA.
 *
 * Kalau `JALUR_AGENT=konfigurasi` tapi jalurnya tidak bisa dipakai — sesi
 * tanpa `id_employee`, karyawan tidak ketemu, agent umum dimatikan — hasilnya
 * BUKAN diam-diam balik ke jalur lama. Sebabnya dikembalikan supaya route
 * bisa mencatatnya. Saklar yang menyala tapi tidak berefek, tanpa ada yang
 * tahu, lebih buruk daripada saklar yang mati.
 */
import type { Agent } from "@voltagent/core";
import { aksesUntukEmployee } from "@/lib/akses-aplikasi";
import { muatKonfig } from "@/lib/ai-konfig";
import { buatRouter } from "./agent-konfig";
import { buatPemegangPenjaga, type PenjagaAlur } from "@/lib/alur/penjaga-alur";
import type { Rancangan } from "./registry-tulis";
import type { Jejak, Klarifikasi, LaporProgres, RujukanSop } from "./tool-konfigurasi";

export type PilihanJalur = "lama" | "konfigurasi";

/**
 * Mencatat hasil satu panggilan alat ke daftar pertanyaan "produk yang mana?".
 *
 * ⚠️ ALAT YANG SELESAI TANPA BERTANYA MENGHAPUS PERTANYAANNYA SENDIRI.
 *
 * Model bisa salah menulis nama, dapat daftar pilihan, lalu mencoba lagi dan
 * berhasil dalam satu jawaban. Tanpa penghapusan ini, daftar dari percobaan
 * pertama ikut terkirim, dan tombol pilihan muncul di bawah jawaban yang sudah
 * selesai. Tertangkap `test:pilih-produk` 3 Nov 2026 pada nama bertanda "+".
 */
export function catatKlarifikasi(daftar: Klarifikasi[], j: Jejak): void {
  for (let i = daftar.length - 1; i >= 0; i--) {
    if (daftar[i].alat === j.alat) daftar.splice(i, 1);
  }
  if (j.klarifikasi) daftar.push({ ...j.klarifikasi, alat: j.alat });
}

/** Jalur yang diminta environment. Nilai asing dianggap `lama`. */
export function jalurDiminta(): PilihanJalur {
  return process.env.JALUR_AGENT === "konfigurasi" ? "konfigurasi" : "lama";
}

/** Penjaga alur Tahap 2 menyala kecuali `PENJAGA_ALUR=mati`. */
export function penjagaDinyalakan(): boolean {
  return process.env.PENJAGA_ALUR !== "mati";
}

export type HasilJalur =
  | {
      jalur: "konfigurasi";
      agent: Agent;
      bawahan: { kode: string; nama: string; jumlahTool: number }[];
      dilewati: { kode: string; sebab: string }[];
      /** Aplikasi yang terbuka untuk pemakai ini. */
      apps: string[];
      /**
       * View yang BENAR-BENAR dibaca selama permintaan ini, diisi tool waktu
       * dipanggil. Kosong waktu dikembalikan — baru terisi setelah stream
       * selesai, jadi hanya berguna dibaca di `messageMetadata`.
       */
      sumber: string[];
      /** Kode alat yang benar-benar dipanggil selama permintaan ini. */
      alat: string[];
      /** Rancangan yang menunggu konfirmasi manusia. Dikirim lewat metadata. */
      rancangan: Rancangan[];
      /**
       * Pertanyaan "produk yang mana?" beserta daftar pilihannya, diisi tool
       * waktu nama produknya ambigu. Alasan ikut lewat metadata sama dengan
       * `rancangan` di bawahnya — tool agent bawahan tidak sampai ke klien.
       */
      klarifikasi: Klarifikasi[];
      /** Dokumen dan bagian yang benar-benar dikembalikan pencarian SOP. */
      sop: RujukanSop[];
      /** Tool mereka yang digantikan tool portal kita, per agent. */
      gantian: { agent: string; dipakai: string; menggantikan: string[] }[];
      /**
       * Penjaga alur permintaan ini (Tahap 2). Panggil SESUDAH `streamText()` dan bungkus stream jawabannya
       * dengan `jagaStream(…, penjaga(), "ui" | "full")` — tanpa pembungkus itu teks penutup (pertanyaan
       * agent bawahan saat alur berhenti, atau pesan jujur saat jawaban kosong) tidak pernah terkirim.
       */
      penjaga: () => PenjagaAlur | null;
    }
  | { jalur: "lama"; sebab: string };

/**
 * Menyiapkan agent untuk satu permintaan.
 *
 * `idEmployee` datang dari SESI. Token lama dibuat sebelum kolom itu ada, jadi
 * bisa `null` — dan itu bukan galat, cuma berarti jalur konfigurasi belum bisa
 * dipakai sampai orangnya login ulang.
 */
export async function siapkanAgent(
  idEmployee: string | null,
  maksTool?: number,
  laporProgres?: LaporProgres,
  /** Batas baris hasil alat baca, hanya untuk model berkapasitas kecil. Lihat `maksBarisServer()`. */
  maksBaris?: number,
): Promise<HasilJalur> {
  if (jalurDiminta() !== "konfigurasi") {
    return { jalur: "lama", sebab: "JALUR_AGENT bukan 'konfigurasi'" };
  }
  if (!idEmployee) {
    return { jalur: "lama", sebab: "sesi tidak punya idEmployee (token lama — perlu login ulang)" };
  }

  const akses = await aksesUntukEmployee(idEmployee);
  if (!akses) {
    return { jalur: "lama", sebab: `id_employee ${idEmployee} tidak ada di tabel employee` };
  }

  // Satu array per permintaan, ditutup ke dalam tiap tool. Tidak boleh jadi
  // variabel modul: dua permintaan yang berjalan bersamaan akan saling
  // menuliskan sumber ke jawaban orang lain.
  const sumber: string[] = [];
  // Alat yang BENAR-BENAR dipanggil, bukan yang terpasang. Dua hal berbeda:
  // agent bisa memegang tujuh alat dan memakai satu.
  const alat: string[] = [];
  // Pertanyaan "produk yang mana?" yang tersusun selama permintaan ini.
  // Sebabnya sama dengan `rancangan` di bawah: tanpa penampung ini tombol
  // pilihannya tidak pernah muncul, dan user harus mengetik ulang nama panjang
  // yang baru saja ditampilkan kepadanya.
  const klarifikasi: Klarifikasi[] = [];
  const sop: RujukanSop[] = [];
  const catat = (j: Jejak) => {
    if (j.view && !sumber.includes(j.view)) sumber.push(j.view);
    if (!alat.includes(j.alat)) alat.push(j.alat);
    catatKlarifikasi(klarifikasi, j);
    for (const r of j.sop ?? []) {
      if (!sop.some((x) => x.judul === r.judul && x.bagian === r.bagian)) sop.push(r);
    }
    // Ikut dikirim saat tool selesai agar footer klien tetap punya sumber
    // meskipun jawaban melewati agent bawahan dan stream komposit.
    laporProgres?.({
      alat: j.alat,
      tahap: "selesai",
      ...(j.view ? { view: j.view } : {}),
    });
  };

  // Rancangan yang tersusun selama permintaan ini. Alasannya sama dengan
  // `sumber` di atas: tool agent BAWAHAN tidak sampai ke klien, yang lewat
  // cuma `delegate_task`. Tanpa penampung ini, kartu konfirmasi tidak pernah
  // muncul walau rancangannya tersusun sempurna.
  const rancangan: Rancangan[] = [];
  const catatRancangan = (r: Rancangan) => {
    rancangan.push(r);
  };

  // Penjaga alur (Tahap 2): SATU per permintaan, sama seperti penampung di atas — tidak pernah variabel
  // modul. `PENJAGA_ALUR=mati` mematikannya tanpa mengubah kode (rollback cepat / perbandingan A-B);
  // saklar yang dimatikan DICATAT, bukan diam-diam.
  const pemegang = penjagaDinyalakan() ? buatPemegangPenjaga({ idSesi: idEmployee }) : undefined;
  if (!pemegang) console.warn("[jalur-agent] PENJAGA_ALUR=mati — penjaga alur Tahap 2 tidak dipasang");
  const sesi = maksBaris ? { ...akses.sesi, maksBaris } : akses.sesi;
  const router = await buatRouter(sesi, akses.apps, catat, catatRancangan, maksTool, laporProgres, pemegang);
  if (!router) {
    return { jalur: "lama", sebab: "agent umum tidak ada atau sedang dimatikan di ai_agent" };
  }

  return {
    jalur: "konfigurasi",
    agent: router.agent,
    bawahan: router.bawahan,
    dilewati: router.dilewati,
    apps: akses.apps,
    sumber,
    alat,
    rancangan,
    klarifikasi,
    sop,
    gantian: (await muatKonfig()).gantian,
    penjaga: () => pemegang?.ambil() ?? null,
  };
}
