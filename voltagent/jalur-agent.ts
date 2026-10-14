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
import type { Rancangan } from "./registry-tulis";
import type { Jejak } from "./tool-konfigurasi";

export type PilihanJalur = "lama" | "konfigurasi";

/** Jalur yang diminta environment. Nilai asing dianggap `lama`. */
export function jalurDiminta(): PilihanJalur {
  return process.env.JALUR_AGENT === "konfigurasi" ? "konfigurasi" : "lama";
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
      /** Tool mereka yang digantikan tool portal kita, per agent. */
      gantian: { agent: string; dipakai: string; menggantikan: string[] }[];
    }
  | { jalur: "lama"; sebab: string };

/**
 * Menyiapkan agent untuk satu permintaan.
 *
 * `idEmployee` datang dari SESI. Token lama dibuat sebelum kolom itu ada, jadi
 * bisa `null` — dan itu bukan galat, cuma berarti jalur konfigurasi belum bisa
 * dipakai sampai orangnya login ulang.
 */
export async function siapkanAgent(idEmployee: string | null): Promise<HasilJalur> {
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
  const catat = (j: Jejak) => {
    if (j.view && !sumber.includes(j.view)) sumber.push(j.view);
    if (!alat.includes(j.alat)) alat.push(j.alat);
  };

  // Rancangan yang tersusun selama permintaan ini. Alasannya sama dengan
  // `sumber` di atas: tool agent BAWAHAN tidak sampai ke klien, yang lewat
  // cuma `delegate_task`. Tanpa penampung ini, kartu konfirmasi tidak pernah
  // muncul walau rancangannya tersusun sempurna.
  const rancangan: Rancangan[] = [];
  const catatRancangan = (r: Rancangan) => {
    rancangan.push(r);
  };

  const router = await buatRouter(akses.sesi, akses.apps, catat, catatRancangan);
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
    gantian: (await muatKonfig()).gantian,
  };
}
