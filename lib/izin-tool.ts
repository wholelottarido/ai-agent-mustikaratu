/**
 * Gerbang izin dan cakupan per peran untuk satu alat, disamakan dengan sistem
 * AI tim lain yang membaca tabel `ai_tool` yang sama (26 Nov 2026).
 *
 * Dipakai DUA tempat, dan harus sama di keduanya:
 *   - `voltagent/tool-konfigurasi.ts` -> waktu alat dirakit untuk agent;
 *   - `app/api/entri/umum/route.ts`   -> waktu tombol Simpan menulis.
 *
 * Tanpa akses database: semua yang dibutuhkan sudah ada di sesi dan di baris
 * konfigurasi.
 */
import type { Cakupan, KonfigTool } from "./ai-konfig";
import type { SesiPemakai } from "@/voltagent/tool-konfigurasi";

/**
 * Arti koma di `ai_tool.izin`, mis. `"claim:read,approval:read"`.
 *
 * ⚠️ BELUM DIPASTIKAN KE TIM LAIN. Di `ai_tool_log` semua pemanggilan sukses
 * alat ber-izin ganda kebetulan datang dari orang yang punya semua izinnya,
 * jadi datanya tidak membedakan. Bawaan `semua` (lebih ketat). Ganti lewat
 * `IZIN_GANDA=salah-satu` di `.env.local` kalau tim lain menjawab sebaliknya.
 *
 * Sebelum ini, teks izinnya dibandingkan UTUH dengan satu kode izin — alat
 * ber-izin ganda tidak pernah lolos untuk siapa pun.
 */
export function modeIzinGanda(): "semua" | "salah-satu" {
  return process.env.IZIN_GANDA === "salah-satu" ? "salah-satu" : "semua";
}

/** Memecah `"a,b"` jadi `["a","b"]`. Spasi dan butir kosong dibuang. */
export function pecahIzin(izin: string): string[] {
  return izin.split(",").map((s) => s.trim()).filter(Boolean);
}

export type HasilIzin = { ok: true } | { ok: false; sebab: string };

/**
 * Apakah pemakai lolos syarat izin alat ini.
 *
 * Izin diambil dari peran DI APLIKASI PEMILIK ALAT (`t.idApps`), seperti
 * sistem tim lain. Alat tanpa `id_apps`, atau sesi yang belum membawa
 * `izinPerApp`, memakai izin gabungan.
 *
 * ⚠️ ALAT MILIK KITA (`pemilik = "magang"`) TETAP MEMAKAI IZIN GABUNGAN.
 * Aturan per aplikasi meniru sistem tim lain, dan sistem mereka tidak memakai
 * alat kita. Pasangan izin–aplikasi alat kita disusun sadar dan bisa lintas
 * aplikasi: `asisten_antrean_tiket` tercatat di Portal tapi izinnya
 * (`assignment-ticket:read`) hanya ada di peran Admin Console. Dengan aturan
 * per aplikasi, alat itu hilang untuk semua orang (terukur 26 Nov 2026).
 */
export function cekIzin(t: Pick<KonfigTool, "izin" | "idApps"> & { pemilik?: string | null }, sesi: SesiPemakai): HasilIzin {
  if (!t.izin) return { ok: true };
  const syarat = pecahIzin(t.izin);
  if (syarat.length === 0) return { ok: true };

  const perApp = t.idApps && sesi.izinPerApp && t.pemilik !== "magang" ? sesi.izinPerApp : undefined;
  const punya = perApp ? (perApp[t.idApps as string] ?? []) : sesi.izin;
  if (!punya) return { ok: false, sebab: `butuh izin "${t.izin}", tapi izin pemakai belum ditelusuri` };

  const mode = modeIzinGanda();
  const lolos = mode === "semua" ? syarat.every((k) => punya.includes(k)) : syarat.some((k) => punya.includes(k));
  if (lolos) return { ok: true };

  const kurang = syarat.filter((k) => !punya.includes(k));
  const tempat = perApp
    ? `Peran Anda di aplikasi ${sesi.namaApp?.[t.idApps as string] ?? "pemilik alat ini"}`
    : "Peran Anda";
  // Diawali "butuh izin" seperti sebelumnya: uji dan skrip diagnosis mencari frasa itu.
  return {
    ok: false,
    sebab:
      `butuh izin "${t.izin}"${syarat.length > 1 ? ` (dibaca ${mode === "semua" ? "harus semua" : "cukup salah satu"})` : ""}: ` +
      `${tempat} tidak punya akses ke menu yang dibutuhkan (${kurang.join(", ")})`,
  };
}

/** Urutan keluasan cakupan, dari yang paling sempit. */
const LUAS: Cakupan[] = ["diri", "bawahan", "departemen", "perusahaan", "semua"];

/**
 * Cakupan yang berlaku untuk pemakai ini.
 *
 * `ai_tool_cakupan` milik tim lain memberi cakupan khusus per peran (mis.
 * Super Admin Super Tools melihat `semua`, bukan `bawahan`). Pemakai yang
 * memegang peran tercantum mendapat cakupan itu; kalau beberapa, yang paling
 * luas. Selain itu tetap `cakupan_bawaan`.
 *
 * Cakupan per peran yang kolom penyaringnya tidak ada di sumber sudah dibuang
 * waktu konfigurasi dibaca (`lib/ai-konfig.ts`), jadi di sini tinggal memilih.
 */
export function cakupanUntuk(t: Pick<KonfigTool, "cakupan" | "cakupanPeran">, sesi: SesiPemakai): Cakupan {
  const peran = sesi.peran ?? [];
  const cocok = (t.cakupanPeran ?? []).filter((c) => peran.includes(c.idRoles)).map((c) => c.cakupan);
  if (cocok.length === 0) return t.cakupan;
  return cocok.reduce((a, b) => (LUAS.indexOf(b) > LUAS.indexOf(a) ? b : a));
}
