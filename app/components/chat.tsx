"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MODEL_TERSEDIA, MODEL_DEFAULT, labelModel } from "@/voltagent/models";
import { Sidebar, type RingkasPercakapan } from "./sidebar";
import { tabelDariSql } from "@/lib/sumber-data";
import { rapikanJawaban, latexTakTerurus } from "@/lib/rapikan-jawaban";
import { SumberJawaban } from "./sumber-jawaban";
import { PilihModel } from "./pilih-model";
import type { PilihanModel } from "@/voltagent/models";
import { KonfirmasiEntri, type DrafEntri } from "./konfirmasi-entri";
import { KonfirmasiBatal, type DrafBatal } from "./konfirmasi-batal";
import { KonfirmasiLembur, type DrafLemburEntri } from "./konfirmasi-lembur";
import { KonfirmasiPelamar, type DrafPelamarEntri } from "./konfirmasi-pelamar";
import { KonfirmasiKeputusan, type DrafKeputusan } from "./konfirmasi-keputusan";
import { KonfirmasiTiket, type DrafTiket } from "./konfirmasi-tiket";
import { KonfirmasiUbahTiket, type DrafUbahTiket } from "./konfirmasi-ubah-tiket";
import { KonfirmasiUmum, type DrafUmum } from "./konfirmasi-umum";
import type { UIMessage } from "ai";

/**
 * Pisahkan penanda lampiran dari pertanyaan aslinya.
 *
 * Yang dikirim ke model berbentuk:
 *   "apa isi dokumen ini?\n\n[Dokumen terlampir: a.pdf, b.png]"
 *
 * Penandanya WAJIB ada di teks -- tanpa itu model tidak tahu ada dokumen
 * yang menunggu dan tidak akan memanggil `baca_dokumen`. Tapi user tidak
 * pernah mengetiknya, jadi di layar ditampilkan sebagai chip, bukan teks
 * mentah yang terlihat seperti bug.
 */
function pisahLampiran(teks: string): { pertanyaan: string; berkas: string[] } {
  const m = teks.match(/\n*\[Dokumen terlampir: ([^\]]+)\]\s*$/);
  if (!m) return { pertanyaan: teks, berkas: [] };
  return {
    pertanyaan: teks.slice(0, m.index).trim(),
    berkas: m[1].split(",").map((x) => x.trim()).filter(Boolean),
  };
}

/**
 * Gabungkan semua bagian teks dari sebuah pesan jadi satu string.
 *
 * ⚠️ Dipisah BARIS KOSONG, bukan digabung langsung.
 *
 * Model menulis teks, memanggil tool, lalu menulis lagi -- itu jadi DUA
 * bagian teks terpisah. Digabung tanpa pemisah, kalimat terakhir bagian
 * pertama menempel ke bagian kedua:
 *
 *   "...yang Anda lampirkan.## Ringkasan Dokumen"
 *
 * dan `##` yang seharusnya jadi judul malah terbaca sebagai teks biasa.
 */
function ambilTeks(parts: { type: string }[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text.trim())
    .filter((t) => t !== "")
    .join("\n\n");
}

/**
 * Kumpulkan SQL yang dijalankan untuk sebuah jawaban.
 *
 * Tool call muncul di parts dengan type `tool-<nama tool>`, dan argumennya
 * ada di `input`. Dari sinilah sumber data diambil -- bukan dari klaim agent
 * di teks jawaban, yang bisa salah sebut.
 */
/**
 * Draf entri dari hasil tool `siapkan_penjualan`.
 *
 * Diambil dari `output` tool, bukan dari teks jawaban model. Teks bisa salah
 * tulis; `sidik` di dalam output inilah yang dipakai server untuk memastikan
 * yang disimpan sama dengan yang dilihat user.
 */
function ambilDrafEntri(parts: { type: string }[]): DrafEntri | null {
  for (const p of parts) {
    if (p.type !== "tool-siapkan_penjualan") continue;
    const out = (p as { output?: unknown }).output as DrafEntri & { status?: string };
    if (out?.status === "siap" && out.draf && out.sidik) return out;
  }
  return null;
}

/**
 * Draf pembatalan dari hasil tool `siapkan_pembatalan`.
 *
 * Sama seperti `ambilDrafEntri`: diambil dari `output` tool, bukan dari teks
 * jawaban model. Yang ditampilkan kartu harus persis yang dibaca server.
 */
function ambilDrafBatal(parts: { type: string }[]): DrafBatal | null {
  for (const p of parts) {
    if (p.type !== "tool-siapkan_pembatalan") continue;
    const out = (p as { output?: unknown }).output as DrafBatal & { status?: string };
    if (out?.status === "siap-batal" && out.order && out.permintaan) return out;
  }
  return null;
}

/** Draf lembur dari hasil tool `siapkan_lembur`. */
function ambilDrafLembur(parts: { type: string }[]): DrafLemburEntri | null {
  for (const p of parts) {
    if (p.type !== "tool-siapkan_lembur") continue;
    const out = (p as { output?: unknown }).output as DrafLemburEntri & { status?: string };
    if (out?.status === "siap" && out.draf && out.sidik) return out;
  }
  return null;
}

/**
 * Draf tiket — dari METADATA pesan lebih dulu, baru dari part tool.
 *
 * ⚠️ URUTANNYA PENTING, DAN LAHIR DARI KEGAGALAN NYATA (8 Okt 2026).
 *
 * Waktu router mendelegasikan ke agent aplikasi, pemanggilan tool agent
 * bawahan TIDAK sampai ke klien — yang lewat cuma `delegate_task`. Jadi part
 * `tool-siapkan_tiket` tidak pernah ada, dan kartunya tidak pernah muncul:
 * rancangan tersusun sempurna, model bahkan menyuruh menekan Simpan, tapi
 * tombolnya tidak ada. Server yang mengirimkannya lewat metadata, persis
 * seperti daftar sumber.
 *
 * Pembacaan dari part tetap dipertahankan untuk jawaban yang TIDAK
 * didelegasikan — di situ metadatanya tidak terisi.
 */
function ambilDrafTiket(m: { parts: { type: string }[]; metadata?: unknown }): DrafTiket | null {
  const meta = m.metadata as { rancangan?: DrafTiket & { jenis?: string } } | undefined;
  const r = meta?.rancangan;
  if (r?.jenis === "tiket" && r.draf && r.sidik && r.permintaan) return r;

  for (const p of m.parts) {
    if (p.type !== "tool-siapkan_tiket") continue;
    const out = (p as { output?: unknown }).output as DrafTiket & { status?: string };
    if (out?.status === "siap" && out.draf && out.sidik && out.permintaan) return out;
  }
  return null;
}

/**
 * Draf dari tool tulis BUATAN LAYAR, yang tidak punya penjalan khusus.
 *
 * Bentuknya sama untuk operasi apa pun — baris mana yang disentuh dan apa yang
 * berubah — jadi satu kartu cukup. Dibedakan dari dua di bawah lewat `jenis`.
 */
function ambilDrafUmum(m: { parts: { type: string }[]; metadata?: unknown }): DrafUmum | null {
  const meta = m.metadata as { rancangan?: DrafUmum & { jenis?: string } } | undefined;
  const r = meta?.rancangan;
  if (r?.jenis === "umum" && r.draf && r.sidik && r.kode) return r;

  for (const p of m.parts) {
    if (!p.type.startsWith("tool-siapkan_")) continue;
    const out = (p as { output?: unknown }).output as DrafUmum & { status?: string };
    if (out?.status === "siap" && out.draf?.tabel && out.sidik) {
      return { ...out, kode: out.draf.kode };
    }
  }
  return null;
}

/**
 * Draf PENYUNTINGAN tiket. Dibedakan dari pembuatan lewat `jenis`.
 *
 * ⚠️ Dua kartu yang berbeda, bukan satu kartu yang pintar. Yang satu
 * menampilkan isi lengkap tiket yang belum ada; yang lain menampilkan APA YANG
 * BERUBAH pada tiket yang sudah ada. Menggabungkannya berarti salah satu dari
 * keduanya menampilkan hal yang salah.
 */
function ambilDrafUbahTiket(m: { parts: { type: string }[]; metadata?: unknown }): DrafUbahTiket | null {
  const meta = m.metadata as { rancangan?: DrafUbahTiket & { jenis?: string } } | undefined;
  const r = meta?.rancangan;
  if (r?.jenis === "ubah-tiket" && r.draf && r.sidik && r.permintaan) return r;

  for (const p of m.parts) {
    if (p.type !== "tool-siapkan_ubah_tiket") continue;
    const out = (p as { output?: unknown }).output as DrafUbahTiket & { status?: string };
    if (out?.status === "siap" && out.draf && out.sidik && out.permintaan) return out;
  }
  return null;
}

/** Draf pelamar dari hasil tool `siapkan_pelamar`. */
function ambilDrafPelamar(parts: { type: string }[]): DrafPelamarEntri | null {
  for (const p of parts) {
    if (p.type !== "tool-siapkan_pelamar") continue;
    const out = (p as { output?: unknown }).output as DrafPelamarEntri & { status?: string };
    if (out?.status === "siap" && out.draf && out.sidik) return out;
  }
  return null;
}

/**
 * Draf keputusan lembur dari tool `siapkan_keputusan_lembur`.
 *
 * Tool yang sama juga mengembalikan DAFTAR (`status: "daftar"`); yang itu
 * sengaja tidak memunculkan kartu — model cukup menampilkannya sebagai teks
 * dan user menyebut nomornya.
 */
function ambilDrafKeputusan(parts: { type: string }[]): DrafKeputusan | null {
  for (const p of parts) {
    if (p.type !== "tool-siapkan_keputusan_lembur") continue;
    const out = (p as { output?: unknown }).output as DrafKeputusan & { status?: string };
    if (out?.status === "siap" && out.lembur) return out;
  }
  return null;
}

/**
 * SQL yang BENAR-BENAR dijalankan, untuk baris "sumber" di bawah jawaban.
 *
 * ⚠️ DUA nama tool, bukan satu. Waktu sumber data dipindah ke perusahaan,
 * tool-nya `query_perusahaan` -- dan sempat terlewat di sini, sehingga jawaban
 * yang jelas-jelas berisi data nyata tetap diberi label "tidak mengambil data
 * dari database". Label yang salah lebih buruk daripada tidak ada label:
 * user jadi meragukan angka yang sebenarnya benar.
 */
/**
 * Berapa kali dokumen terlampir dibaca untuk jawaban ini.
 *
 * ⚠️ Perlu supaya label di bawah jawaban tidak berbohong. Jawaban yang
 * seluruhnya berasal dari dokumen tetap diberi label "tidak mengambil data
 * dari database" -- benar secara harfiah, tapi membuat user mengira angkanya
 * dikarang. Ini kesalahan yang sama seperti waktu `query_perusahaan` terlewat.
 */
/**
 * Agent aplikasi yang menjawab, dari hasil `delegate_task`.
 *
 * ⚠️ Waktu router mendelegasikan, pemanggilan tool agent bawahan TIDAK sampai
 * ke klien — yang sampai cuma `delegate_task`, dan isinya `agentName` plus
 * teks jawabannya. Jadi inilah satu-satunya tempat nama agent bisa diambil
 * tanpa mengarang dari teks jawaban.
 */
function agentPenjawab(parts: { type: string }[]): string[] {
  const nama: string[] = [];
  for (const p of parts) {
    if (p.type !== "tool-delegate_task") continue;
    const out = (p as { output?: unknown }).output;
    if (!Array.isArray(out)) continue;
    for (const x of out as { agentName?: unknown }[]) {
      if (typeof x?.agentName === "string" && !nama.includes(x.agentName)) nama.push(x.agentName);
    }
  }
  return nama;
}

function hitungDokumen(parts: { type: string }[]): number {
  return parts.filter((p) => p.type === "tool-baca_dokumen").length;
}

/**
 * Berapa kali basis pengetahuan (SOP / tiket lama) dibaca untuk jawaban ini.
 *
 * ⚠️ KESALAHAN YANG SAMA, KETIGA KALINYA.
 *
 * Label di bawah jawaban punya tiga kemungkinan: nama tabel dari SQL, "dari
 * dokumen terlampir", atau "tidak mengambil data dari database". Tool
 * `cari_sop` tidak menjalankan SQL lewat tool query dan tidak membaca dokumen
 * unggahan, jadi jawaban yang SELURUHNYA bersumber dari SOP akan jatuh ke
 * kemungkinan ketiga -- berlabel seolah angkanya tidak dari mana pun.
 *
 * Ini pengulangan ketiga dari pola yang sama: pertama waktu
 * `query_perusahaan` terlewat di `ambilSql`, kedua waktu `baca_dokumen`
 * belum dihitung. Tiap kali tool baru yang membawa data ditambahkan, label
 * ini harus ikut tahu.
 */
function hitungKb(parts: { type: string }[]): number {
  return parts.filter((p) => p.type === "tool-cari_sop" || p.type === "tool-daftar_sop").length;
}

/**
 * Berapa kali tiket helpdesk lama dicari.
 *
 * ⚠️ DIPISAH dari `hitungKb`, bukan digabung.
 *
 * Sempat digabung, dan akibatnya langsung kelihatan: jawaban yang SELURUHNYA
 * berasal dari pencarian tiket diberi label "Sumber: basis pengetahuan SOP".
 * Dokumen SOP dan tiket helpdesk itu dua hal yang sangat berbeda — satu
 * prosedur yang ditulis sengaja, satu lagi catatan bebas teknisi — dan user
 * yang membaca "SOP" akan menganggap jawabannya punya dasar resmi padahal
 * tidak.
 */
function hitungTiket(parts: { type: string }[]): number {
  return parts.filter((p) => p.type === "tool-cari_tiket_serupa").length;
}

/**
 * Kode dokumen SOP yang BENAR-BENAR dikembalikan tool, untuk tombol unduh.
 *
 * ⚠️ DIURAI DARI HASIL TOOL, BUKAN DARI TEKS JAWABAN.
 *
 * Aturan yang sama dengan nama tabel di bawah jawaban: yang ditampilkan harus
 * berasal dari apa yang dijalankan, bukan dari klaim model. Kalau tautannya
 * diambil dari teks jawaban, satu kode yang salah ketik (atau dikarang)
 * berubah jadi tombol unduh yang rusak — dan user akan menyalahkan sistemnya,
 * bukan jawabannya.
 *
 * `daftar_sop` SENGAJA tidak ikut: dia mengembalikan seluruh 24 dokumen, dan
 * 24 tombol unduh di bawah satu jawaban bukan membantu.
 */
/**
 * Bentuk pendek sebuah URL untuk ditampilkan di dalam jawaban.
 *
 * ⚠️ NAMA DOMAIN SELALU DIPERTAHANKAN, dan itu bukan soal estetika.
 *
 * Tautan panduan berbentuk `https://maps.mustika-ratu.com/guideline/` plus
 * uuid 36 huruf. Ditulis utuh di tengah kalimat, dia memenuhi dua baris dan
 * membuat jawabannya sulit dibaca.
 *
 * Yang dipotong hanya ekor path-nya. Menyembunyikan domain di balik teks
 * seperti "buka panduan" memang lebih rapi, tapi user kehilangan satu-satunya
 * petunjuk ke mana dia akan dibawa -- dan tautan dalam jawaban AI justru yang
 * paling pantas bisa diperiksa sebelum diklik. Alamat lengkapnya tetap ada di
 * atribut `title`, jadi tidak ada yang hilang.
 */
function ringkasUrl(href: string): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  const jalur = u.pathname.replace(/\/+$/, "");
  const penuh = u.host + jalur;
  if (penuh.length <= 46) return penuh;

  const bagian = jalur.split("/").filter(Boolean);
  const ekor = bagian[bagian.length - 1] ?? "";
  const awal = bagian.slice(0, -1).join("/");
  return `${u.host}/${awal ? `${awal}/` : ""}${ekor.slice(0, 8)}…`;
}

function dokumenSop(parts: { type: string }[]): string[] {
  const kode = new Set<string>();
  for (const p of parts) {
    if (p.type !== "tool-cari_sop") continue;
    const keluaran = (p as { output?: unknown }).output;
    if (typeof keluaran !== "string") continue;
    for (const m of keluaran.matchAll(/\b(SOP-[A-Z0-9]+-\d+)\b/g)) kode.add(m[1]);
  }
  return [...kode];
}

function ambilSql(parts: { type: string }[]): string[] {
  return parts
    .filter((p) => p.type === "tool-query_db" || p.type === "tool-query_perusahaan")
    .map((p) => (p as { input?: { sql?: string } }).input?.sql)
    .filter((sql): sql is string => typeof sql === "string" && sql.trim() !== "");
}

/** Info per jawaban: model, lama proses, dan dari tabel mana datanya. */
type Info = {
  model: string;
  detik: number;
  query: number;
  /** Token yang dipakai. `null` untuk jawaban lama yang belum mencatatnya. */
  token: { masuk: number | null; keluar: number | null } | null;
  /** Nama tabel yang dipakai. */
  sumber: string[];
  /** Agent aplikasi yang menjawab, kalau pertanyaannya didelegasikan. */
  agent?: string[];
  /** Berapa dokumen terlampir yang dibaca. */
  dokumen: number;
  /** Berapa kali basis pengetahuan SOP dibaca. */
  kb: number;
  /** Berapa kali tiket helpdesk lama dicari. */
  tiket: number;
  /**
   * Alat yang BENAR-BENAR dipanggil, bukan yang terpasang.
   *
   * Tidak bisa diturunkan dari daftar sumber: satu view bisa dibaca beberapa
   * alat dengan cakupan berbeda, dan alat berjenis kode tidak membaca view
   * sama sekali.
   */
  alat: string[];
  /** Kode dokumen SOP yang dikembalikan tool, untuk tombol unduh. */
  sop: string[];
  /** SQL lengkapnya, untuk user yang mau memeriksa sendiri. */
  sql: string[];
};

/** Ringkasan dokumen dari `/api/dokumen`. Teks lengkapnya TIDAK ada di sini. */
type Lampiran = {
  id: string;
  nama: string;
  cara: "teks-tertanam" | "ocr-claude" | "ocr-lokal";
  halaman: number | null;
  panjangTeks: number;
  sudahAda: boolean;
  kosong: boolean;
};

export function Chat({
  departemen,
  contoh,
  agent,
  modelDitawarkan,
}: {
  departemen: string;
  contoh: string[];
  /**
   * Ringkasan agent per aplikasi. `undefined` kalau jalur konfigurasi belum
   * dipakai (atau sesinya token lama) -- waktu itu layar kosongnya kembali ke
   * bingkai departemen yang lama, bukan kosong sama sekali.
   */
  agent?: { nama: string; terbuka: boolean; jumlahTool: number }[];
  /**
   * Model yang pantas ditawarkan, dari server. Qwen cuma muncul kalau
   * `QWEN_API_URL`/`QWEN_API_KEY` terisi — dan itu tidak terbaca dari klien.
   */
  modelDitawarkan?: PilihanModel[];
}) {
  const [input, setInput] = useState("");

  // Dokumen yang sudah terunggah dan siap ditanyakan. Isinya TIDAK ada di
  // sini -- cuma penanda; teksnya tinggal di server dan diambil agent lewat
  // tool `baca_dokumen`.
  const [lampiran, setLampiran] = useState<Lampiran[]>([]);
  const [unggahan, setUnggahan] = useState<string>("");
  const [galatUnggah, setGalatUnggah] = useState("");
  const kolomBerkas = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState(MODEL_DEFAULT);
  const [info, setInfo] = useState<Record<string, Info>>({});

  const [daftar, setDaftar] = useState<RingkasPercakapan[]>([]);
  const [aktif, setAktif] = useState<number | null>(null);
  const [memuat, setMemuat] = useState(false);

  // Dicatat saat kirim, dibaca saat selesai. Pakai ref supaya perubahan
  // dropdown di tengah jalan tidak mengubah catatan jawaban yang sedang jalan.
  const mulai = useRef(0);
  const modelTerkirim = useRef(MODEL_DEFAULT);
  // Id percakapan yang sedang berjalan. Ref, bukan state: dibaca di dalam
  // onFinish yang menutup nilai lama kalau pakai state.
  const idAktif = useRef<number | null>(null);

  const muatDaftar = useCallback(async () => {
    try {
      const r = await fetch("/api/percakapan");
      if (r.ok) setDaftar(await r.json());
    } catch {
      // Daftar gagal dimuat bukan alasan untuk memblokir chat.
    }
  }, []);

  const { messages, setMessages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onFinish: async ({ message }) => {
      const detik = (Date.now() - mulai.current) / 1000;
      const sql = ambilSql(message.parts);
      const sumber = tabelDariSql(sql);

      // Jumlah token datang lewat metadata pesan, disisipkan `/api/chat` di
      // part `finish` -- stream bawaan tidak membawanya.
      const meta = message.metadata as {
        token?: { masuk: number | null; keluar: number | null };
        /** View yang dibaca jalur konfigurasi — lihat `app/api/chat/route.ts`. */
        sumber?: string[];
        /** Kode alat yang benar-benar dipanggil. Sumbernya sama: metadata. */
        alat?: string[];
      };
      const token = meta?.token ?? null;

      // ⚠️ Sumber jalur konfigurasi TIDAK bisa diurai dari SQL seperti jalur
      // lama: model tidak menulis SQL, dan tool agent bawahan tidak sampai ke
      // klien. Server yang mengirimkannya lewat metadata. Tanpa penggabungan
      // ini, jawaban yang jelas membaca database akan berlabel "tidak
      // mengambil data dari database" — kesalahan yang sudah terjadi tiga kali
      // di berkas ini.
      const semuaSumber = [...new Set([...sumber, ...(meta?.sumber ?? [])])];
      const agent = agentPenjawab(message.parts);

      setInfo((s) => ({
        ...s,
        [message.id]: {
          model: modelTerkirim.current,
          detik,
          query: sql.length,
          token,
          sumber: semuaSumber,
          alat: meta?.alat ?? [],
          agent,
          sql,
          dokumen: hitungDokumen(message.parts),
          kb: hitungKb(message.parts),
          tiket: hitungTiket(message.parts),
          sop: dokumenSop(message.parts),
        },
      }));

      // Simpan jawaban dari sisi klien: teksnya persis yang dilihat user,
      // lengkap dengan metadata yang cuma diketahui di sini.
      const id = idAktif.current;
      const teks = ambilTeks(message.parts);
      if (!id || !teks.trim()) return;

      // ⚠️ Perintah LaTeX yang BELUM didukung disebut di konsol waktu
      // pengembangan. Tanpa ini, satu-satunya cara mengetahuinya adalah
      // user melihat `$\sum_{i}$` di layar dan melaporkannya.
      if (process.env.NODE_ENV !== "production") {
        const sisa = latexTakTerurus(teks);
        if (sisa.length > 0) {
          console.warn(
            `LaTeX belum didukung di jawaban: ${sisa.map((s) => `\\${s}`).join(", ")}` +
              ` — tambahkan ke PERINTAH di lib/rapikan-jawaban.ts`,
          );
        }
      }
      try {
        await fetch(`/api/percakapan/${id}/pesan`, {
          method: "POST",
          // ⚠️ `keepalive` supaya permintaan ini SELESAI walau user
          // meninggalkan halaman tepat sesudah jawaban muncul.
          //
          // Tanpa itu, navigasi membatalkan simpanannya dan jawaban hilang
          // permanen — tinggal pertanyaannya di riwayat. Terjadi 2 Okt 2026
          // waktu user mengklik tautan sumber di dalam jawaban (percakapan
          // 84). Tautannya sudah dibuat buka-tab-baru, tapi ini lapis kedua:
          // user bisa saja menutup tab, menekan tombol kembali, atau
          // mengklik tautan lain.
          //
          // Batas badan permintaan untuk `keepalive` 64 KB. Jawaban + SQL
          // kita jauh di bawah itu; kalau suatu saat melebihi, browser
          // menolaknya dan jatuh ke `catch` di bawah — gagal menyimpan, tapi
          // tidak merusak apa pun di layar.
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teks,
            model: modelTerkirim.current,
            detik,
            jumlahQuery: sql.length,
            tokenMasuk: token?.masuk ?? null,
            tokenKeluar: token?.keluar ?? null,
            // Rujukan sumber ikut disimpan, kalau tidak percakapan yang
            // dimuat ulang kehilangan label DAN tombol PDF-nya.
            jumlahDokumen: hitungDokumen(message.parts),
            jumlahKb: hitungKb(message.parts),
            jumlahTiket: hitungTiket(message.parts),
            sopDipakai: dokumenSop(message.parts).join(","),
            sumber: semuaSumber.join(", "),
            // Beberapa query dipisah baris kosong supaya bisa dipecah lagi
            // saat percakapan dibuka ulang.
            sqlDipakai: sql.join("\n\n"),
          }),
        });
        muatDaftar();
      } catch {
        // Gagal menyimpan tidak boleh menghapus jawaban dari layar.
      }
    },
  });

  const sibuk = status === "submitted" || status === "streaming";
  const bawah = useRef<HTMLDivElement>(null);
  const kolom = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    muatDaftar();
  }, [muatDaftar]);

  useEffect(() => {
    // "auto" saat memuat percakapan lama -- kalau "smooth", layar terlihat
    // menggulung panjang dari atas ke bawah setiap kali percakapan dibuka.
    bawah.current?.scrollIntoView({ behavior: memuat ? "auto" : "smooth" });
  }, [messages, memuat]);

  // Tinggi textarea mengikuti isinya, dibatasi lewat max-h di className.
  useEffect(() => {
    const el = kolom.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  function percakapanBaru() {
    if (sibuk) return;
    idAktif.current = null;
    setAktif(null);
    setMessages([]);
    setInfo({});
    setInput("");
  }

  async function bukaPercakapan(id: number) {
    if (sibuk) return;
    setMemuat(true);
    try {
      const r = await fetch(`/api/percakapan/${id}`);
      if (!r.ok) return;
      const { pesan } = (await r.json()) as {
        pesan: {
          id: number; peran: "user" | "assistant"; teks: string;
          model: string | null; detik: number | null; jumlah_query: number | null;
          token_masuk: number | null; token_keluar: number | null;
          sumber: string | null; sql_dipakai: string | null;
          jumlah_dokumen: number | null; jumlah_kb: number | null;
          jumlah_tiket: number | null; sop_dipakai: string | null;
        }[];
      };

      const infoBaru: Record<string, Info> = {};
      const pesanUI = pesan.map((p) => {
        const idPesan = `db-${p.id}`;
        if (p.peran === "assistant" && p.model) {
          infoBaru[idPesan] = {
            // ⚠️ Kosong untuk jawaban LAMA, bukan karena tidak ada alat yang
            // dipakai. Daftar alat baru dikirim lewat metadata sejak 9 Okt
            // 2026 dan tidak ikut tersimpan di `pesan`. Menampilkan daftar
            // kosong lebih jujur daripada menebak dari nama view.
            alat: [],
            model: p.model,
            token:
              p.token_masuk === null && p.token_keluar === null
                ? null
                : { masuk: p.token_masuk, keluar: p.token_keluar },
            detik: Number(p.detik ?? 0),
            query: Number(p.jumlah_query ?? 0),
            sumber: p.sumber ? p.sumber.split(",").map((t) => t.trim()).filter(Boolean) : [],
            // Keempatnya ikut tersimpan sejak Tahap 16D. Sebelum itu, jawaban
            // yang bersumber dari dokumen unggahan atau SOP kehilangan
            // labelnya begitu percakapan dimuat ulang, dan tombol PDF-nya
            // hilang.
            //
            // `null` berarti TIDAK TERCATAT (pesan lama, atau migrasi belum
            // dijalankan) -- dijadikan 0 supaya tampilannya tidak rusak.
            dokumen: p.jumlah_dokumen ?? 0,
            kb: p.jumlah_kb ?? 0,
            tiket: p.jumlah_tiket ?? 0,
            sop: p.sop_dipakai ? p.sop_dipakai.split(",").filter(Boolean) : [],
            // Dipisah baris kosong waktu disimpan.
            sql: p.sql_dipakai ? p.sql_dipakai.split("\n\n") : [],
          };
        }
        return {
          id: idPesan,
          role: p.peran,
          parts: [{ type: "text", text: p.teks }],
        } as UIMessage;
      });

      idAktif.current = id;
      setAktif(id);
      setMessages(pesanUI);
      setInfo(infoBaru);
    } finally {
      setMemuat(false);
    }
  }

  async function hapusPercakapan(id: number) {
    try {
      const r = await fetch(`/api/percakapan/${id}`, { method: "DELETE" });
      if (!r.ok) return;
      if (idAktif.current === id) percakapanBaru();
      muatDaftar();
    } catch {
      /* diamkan */
    }
  }

  async function unggah(berkas: File | null) {
    if (!berkas) return;
    setGalatUnggah("");
    setUnggahan(berkas.name);
    try {
      const judul = window.prompt("Judul dokumen pengetahuan ini apa?\nJudul akan dipakai agent saat mencari dokumen.", berkas.name.replace(/\.[^.]+$/, ""))?.trim();
      if (!judul) {
        setGalatUnggah("Unggah dibatalkan karena judul belum diisi.");
        return;
      }
      const isi = new FormData();
      isi.append("berkas", berkas);
      isi.append("judul", judul);
      const r = await fetch("/api/knowledge/documents", { method: "POST", body: isi });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setGalatUnggah(d.error || "Gagal mengunggah dokumen.");
        return;
      }
      setGalatUnggah(`Dokumen pengetahuan “${d.judul}” tersimpan dan siap dicari agent (${d.jumlahPotongan} potongan).`);
    } catch {
      setGalatUnggah("Tidak bisa menghubungi server.");
    } finally {
      setUnggahan("");
      if (kolomBerkas.current) kolomBerkas.current.value = "";
    }
  }

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    const teks = input.trim();
    if (!teks || sibuk) return;

    // Percakapan baru dibuat lebih dulu supaya id-nya sudah ada saat
    // pesan pertama dikirim -- kalau tidak, pesan itu tidak punya tempat.
    let id = idAktif.current;
    if (!id) {
      try {
        const r = await fetch("/api/percakapan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pertanyaan: teks }),
        });
        if (r.ok) {
          id = (await r.json()).id as number;
          idAktif.current = id;
          setAktif(id);
        }
      } catch {
        // Kalau gagal, chat tetap jalan -- cuma tidak tersimpan.
      }
    }

    mulai.current = Date.now();
    modelTerkirim.current = model;

    // ⚠️ Nama dokumennya DISEBUT di teks pesan, bukan cuma diunggah.
    //
    // Tanpa ini model tidak punya alasan memanggil `baca_dokumen` -- dia tidak
    // tahu ada dokumen yang menunggu. Yang dikirim cuma NAMANYA; isinya tetap
    // diambil lewat tool, supaya PDF panjang tidak membengkakkan tiap pesan.
    const catatan = lampiran.length
      ? `

[Dokumen terlampir: ${lampiran.map((d) => d.nama).join(", ")}]`
      : "";

    sendMessage({ text: teks + catatan }, { body: { model, percakapanId: id } });
    setInput("");
    setLampiran([]);
    muatDaftar();
  }

  /**
   * Kalimat user tepat sebelum jawaban ke-`i`. Ikut disimpan di jejak audit
   * supaya nanti bisa ditelusuri: entri ini berasal dari permintaan yang mana.
   */
  const pertanyaanSebelum = (i: number): string | undefined => {
    for (let k = i - 1; k >= 0; k--) {
      if (messages[k].role === "user") return ambilTeks(messages[k].parts);
    }
    return undefined;
  };

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar
        daftar={daftar}
        aktif={aktif}
        onBaru={percakapanBaru}
        onBuka={bukaPercakapan}
        onHapus={hapusPercakapan}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {memuat && (
            <p className="py-10 text-center text-sm text-tinta-lemah">Memuat percakapan...</p>
          )}

          {!memuat && messages.length === 0 && (
            <div className="mx-auto flex max-w-xl flex-col items-center px-2 pt-16 pb-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-utama text-lg font-semibold text-utama-teks shadow-sedang">
                {agent ? "AI" : departemen.slice(0, 2).toUpperCase()}
              </span>
              <h2 className="mt-4 text-xl font-semibold tracking-tight">
                {agent ? "Ratu AI" : `Asisten ${departemen}`}
              </h2>
              <p className="mt-1.5 text-sm text-tinta-lemah">
                {agent
                  ? "Agent Umum menjawab langsung, atau meneruskan ke agent aplikasi."
                  : "Tanya apa saja soal data departemen kamu."}
              </p>

              {/* Aplikasi yang terkunci TETAP ditampilkan -- menyembunyikannya
                  membuat orang mengira fiturnya belum dibuat, lalu tidak pernah
                  memintanya. Pola yang sama dipakai layar Apps portal. */}
              {agent && agent.length > 0 && (
                <div className="mt-6 flex w-full flex-wrap justify-center gap-1.5">
                  {agent.map((a) => (
                    <span
                      key={a.nama}
                      title={
                        a.terbuka
                          ? `${a.jumlahTool} tool`
                          : "Perlu akses — minta ke admin aplikasinya"
                      }
                      className={
                        a.terbuka
                          ? "rounded-full bg-permukaan px-2.5 py-1 text-[11px] font-medium text-tinta ring-1 ring-garis"
                          : "rounded-full px-2.5 py-1 text-[11px] font-medium text-tinta-lemah ring-1 ring-dashed ring-garis"
                      }
                    >
                      {a.nama.replace(/^Ratu\s+AI\s*/i, "")}
                      {a.terbuka && a.jumlahTool === 0 && " · belum ada tool"}
                      {!a.terbuka && " · terkunci"}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2">
                {contoh.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setInput(c);
                      kolom.current?.focus();
                    }}
                    className="group rounded-2xl bg-permukaan/60 p-3.5 text-left text-sm text-tinta shadow-kecil ring-1 ring-garis/60 transition-all hover:-translate-y-0.5 hover:bg-permukaan hover:shadow-sedang hover:ring-utama/40"
                  >
                    <span className="block leading-snug">{c}</span>
                    <span className="mt-1.5 block text-xs text-tinta-lemah opacity-0 transition-opacity group-hover:opacity-100">
                      Tanyakan ini &rarr;
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const ini = info[m.id];
            const teks = ambilTeks(m.parts);

            // Pertanyaan user: gelembung berwarna, rata kanan.
            if (m.role === "user") {
              // ⚠️ Penanda lampiran DIPISAH dari teks, tidak ditampilkan
              // mentah. Model butuh baris "[Dokumen terlampir: ...]" supaya tahu
              // ada dokumen menunggu, tapi user yang menuliskannya tidak pernah
              // mengetik itu -- menampilkannya apa adanya terlihat seperti bug.
              const { pertanyaan, berkas } = pisahLampiran(teks);
              return (
                <div key={m.id} className="muncul flex justify-end">
                  <div className="flex max-w-[85%] flex-col items-end gap-1.5">
                    {pertanyaan && (
                      <div className="whitespace-pre-wrap rounded-3xl rounded-br-lg bg-utama px-4 py-2.5 text-sm leading-relaxed text-utama-teks shadow-kecil">
                        {pertanyaan}
                      </div>
                    )}
                    {berkas.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {berkas.map((nama) => (
                          <span
                            key={nama}
                            className="flex max-w-full items-center gap-1.5 rounded-xl bg-utama/15 px-2.5 py-1 text-[11px] text-tinta-lemah ring-1 ring-utama/20"
                          >
                            <svg viewBox="0 0 20 20" fill="none" className="size-3 shrink-0" aria-hidden>
                              <path
                                d="M13.5 6.5 8 12a2 2 0 1 0 2.8 2.8l5.2-5.2a3.5 3.5 0 0 0-5-5L5.2 10.4a5 5 0 0 0 7 7l4.3-4.3"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span className="truncate">{nama}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // Jawaban agent: TANPA gelembung, cukup avatar + teks selebar kolom.
            // Jawaban di sini sering berisi tabel panjang; dibungkus gelembung
            // justru jadi sempit dan sulit dibaca.
            return (
              <div key={m.id} className="muncul flex gap-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-xl bg-utama text-[10px] font-semibold text-utama-teks">
                  AI
                </span>
                <div className="min-w-0 flex-1">
                  {teks.trim() === "" ? (
                    // Agent memanggil tool sampai jatah langkahnya habis tanpa
                    // sempat menulis jawaban. Tanpa pesan ini, user cuma melihat
                    // ruang kosong dan mengira aplikasinya rusak.
                    <p className="text-sm text-tinta-lemah">
                      Pertanyaannya perlu terlalu banyak langkah, jadi terpotong sebelum
                      selesai. Coba persempit &mdash; misalnya sebutkan satu produk atau satu bulan.
                    </p>
                  ) : (
                    // remark-gfm untuk dukungan tabel hasil query.
                    <div className="prose-chat text-sm leading-relaxed">
                      {/* ⚠️ TAUTAN HARUS BUKA DI TAB BARU.
                          Tanpa `target="_blank"`, mengklik tautan sumber
                          membawa SELURUH halaman keluar dari chat. Dan karena
                          jawaban disimpan dari browser SETELAH stream selesai,
                          navigasi itu membatalkan permintaan simpannya di
                          tengah jalan -- waktu user kembali, jawabannya hilang
                          dan tinggal pertanyaannya.
                          Terjadi 2 Okt 2026, percakapan 84. */}
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => {
                            // Tautan "telanjang": teksnya sama dengan
                            // alamatnya, hasil autolink remark-gfm. Cuma yang
                            // seperti ini yang diringkas — kalau model sudah
                            // memberi teks sendiri ("lihat panduan"), teks itu
                            // yang dipakai apa adanya.
                            const anak = Array.isArray(children) ? children[0] : children;
                            const telanjang = typeof anak === "string" && anak === href;
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={href}
                                className="tautan-sumber"
                              >
                                {telanjang && href ? ringkasUrl(href) : children}
                              </a>
                            );
                          },
                        }}
                      >
                        {/* ⚠️ DIRAPIKAN DI SINI, BUKAN WAKTU DISIMPAN.
                            Model kadang mengeluarkan LaTeX (`$\rightarrow$`)
                            yang tidak dikenal react-markdown dan tampil apa
                            adanya. Merapikannya di titik tampilan berarti
                            jawaban yang SUDAH tersimpan ikut terbaca benar,
                            dan yang di database tetap kata-kata asli model. */}
                        {rapikanJawaban(teks)}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Kartu konfirmasi. Tombolnya yang menyimpan -- model
                      tidak punya tool yang bisa menulis ke database. */}
                  {m.role === "assistant" && (() => {
                    const entri = ambilDrafEntri(m.parts);
                    return entri ? (
                      <KonfirmasiEntri data={entri} permintaanAsli={pertanyaanSebelum(i)} />
                    ) : null;
                  })()}

                  {/* Kartu konfirmasi tiket helpdesk. Tombolnya yang
                      menyimpan -- model tidak punya tool yang menulis ke
                      portal_ticket, dan tiket yang tersimpan masuk antrean
                      teknisi sungguhan. */}
                  {m.role === "assistant" && (() => {
                    const tiket = ambilDrafTiket(m);
                    return tiket ? <KonfirmasiTiket data={tiket} /> : null;
                  })()}

                  {/* Kartu penyuntingan tiket. Menampilkan perubahannya, bukan
                      isi barunya -- lihat catatan di komponennya. */}
                  {m.role === "assistant" && (() => {
                    const ubah = ambilDrafUbahTiket(m);
                    return ubah ? <KonfirmasiUbahTiket data={ubah} /> : null;
                  })()}

                  {/* Kartu untuk tool tulis buatan layar Kelola AI. Bentuknya
                      sama untuk operasi apa pun, jadi satu kartu cukup. */}
                  {m.role === "assistant" && (() => {
                    const umum = ambilDrafUmum(m);
                    return umum ? <KonfirmasiUmum data={umum} /> : null;
                  })()}

                  {/* Kartu keputusan lembur (HR, kepala). Dua tombol. */}
                  {m.role === "assistant" && (() => {
                    const keputusan = ambilDrafKeputusan(m.parts);
                    return keputusan ? (
                      <KonfirmasiKeputusan data={keputusan} permintaanAsli={pertanyaanSebelum(i)} />
                    ) : null;
                  })()}

                  {/* Kartu pelamar (HR, staf). */}
                  {m.role === "assistant" && (() => {
                    const pelamar = ambilDrafPelamar(m.parts);
                    return pelamar ? (
                      <KonfirmasiPelamar data={pelamar} permintaanAsli={pertanyaanSebelum(i)} />
                    ) : null;
                  })()}

                  {/* Kartu lembur (HR). Nilai rupiahnya dihitung server dari
                      data gaji, tidak pernah datang dari klien. */}
                  {m.role === "assistant" && (() => {
                    const lembur = ambilDrafLembur(m.parts);
                    return lembur ? (
                      <KonfirmasiLembur data={lembur} permintaanAsli={pertanyaanSebelum(i)} />
                    ) : null;
                  })()}

                  {/* Kartu pembatalan. Alasannya diketik di kartu ini, tidak
                      lewat model -- lihat komentar di konfirmasi-batal.tsx. */}
                  {m.role === "assistant" && (() => {
                    const batal = ambilDrafBatal(m.parts);
                    return batal ? (
                      <KonfirmasiBatal data={batal} permintaanAsli={pertanyaanSebelum(i)} />
                    ) : null;
                  })()}

                  {ini && (
                    <SumberJawaban
                      model={labelModel(ini.model)}
                      modelId={ini.model}
                      detik={ini.detik}
                      query={ini.query}
                      token={ini.token}
                      sumber={ini.sumber}
                      alat={ini.alat}
                      agent={ini.agent}
                      dokumen={ini.dokumen}
                      kb={ini.kb}
                      tiket={ini.tiket}
                      sop={ini.sop}
                      sql={ini.sql}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {sibuk && (
            <div className="muncul flex gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-xl bg-utama text-[10px] font-semibold text-utama-teks">
                AI
              </span>
              <span className="flex items-center gap-1.5 pt-1.5">
                <span className="size-1.5 animate-bounce rounded-full bg-utama/60 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-utama/60 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-utama/60" />
              </span>
            </div>
          )}

          {error && (
            <p className="rounded-2xl bg-bahaya-lemah px-4 py-3 text-sm text-bahaya ring-1 ring-bahaya/20">
              Gagal: {error.message}
            </p>
          )}

            <div ref={bawah} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4">
          <form
            onSubmit={kirim}
            // Komposer "mengambang": kartu dengan bayangan, bukan kotak bergaris
            // yang menempel di tepi. Ring menegas saat kolom difokuskan.
            className="mx-auto max-w-3xl rounded-3xl bg-permukaan/70 p-2 shadow-sedang ring-1 ring-garis/70 backdrop-blur transition-shadow focus-within:shadow-besar focus-within:ring-utama/40"
          >
            {(lampiran.length > 0 || unggahan || galatUnggah) && (
              <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5 pb-0.5">
                {lampiran.map((d) => (
                  <span
                    key={d.id}
                    className="flex max-w-full items-center gap-1.5 rounded-lg bg-utama/10 py-1 pr-1 pl-2 text-[11px] text-utama"
                  >
                    <span className="truncate">{d.nama}</span>
                    <span className="shrink-0 text-utama/60">
                      {d.kosong
                        ? "tanpa teks"
                        : d.halaman
                          ? `${d.halaman} hlm`
                          : `${d.panjangTeks} huruf`}
                      {/* ⚠️ Dibaca di mana DISEBUT, bukan disembunyikan.
                          Gambar yang lewat cloud keluar dari laptop, dan user
                          berhak tahu itu tanpa harus bertanya. */}
                      {d.cara === "ocr-claude" && " · dibaca di cloud"}
                      {d.cara === "ocr-lokal" && " · dibaca lokal"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLampiran((x) => x.filter((y) => y.id !== d.id))}
                      aria-label={`Lepas ${d.nama}`}
                      className="shrink-0 rounded px-1 text-utama/60 hover:bg-utama/10 hover:text-utama"
                    >
                      &times;
                    </button>
                  </span>
                ))}

                {unggahan && (
                  <span className="rounded-lg bg-kertas/70 px-2 py-1 text-[11px] text-tinta-lemah">
                    Membaca {unggahan}
                    {/* Gambar lewat OCR bisa ~1 menit. Tanpa keterangan ini
                        user akan mengira aplikasinya hang. */}
                    {/\.(png|jpe?g|webp)$/i.test(unggahan) && " (gambar bisa sampai 1 menit)"}
                    &hellip;
                  </span>
                )}

                {galatUnggah && (
                  <span className="rounded-lg bg-bahaya-lemah px-2 py-1 text-[11px] text-bahaya">
                    {galatUnggah}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={kolomBerkas}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => unggah(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => kolomBerkas.current?.click()}
                disabled={sibuk || unggahan !== ""}
                aria-label="Lampirkan dokumen"
                title="Lampirkan PDF atau gambar"
                className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl text-tinta-lemah transition-colors hover:bg-kertas/70 hover:text-tinta disabled:opacity-30"
              >
                {/* Klip kertas */}
                <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden>
                  <path
                    d="M13.5 6.5 8 12a2 2 0 1 0 2.8 2.8l5.2-5.2a3.5 3.5 0 0 0-5-5L5.2 10.4a5 5 0 0 0 7 7l4.3-4.3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <textarea
                ref={kolom}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter mengirim, Shift+Enter baris baru -- kebiasaan aplikasi chat.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    kirim(e);
                  }
                }}
                disabled={sibuk}
                rows={1}
                placeholder="Tulis pertanyaan..."
                className="max-h-44 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-tinta-lemah/70 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={sibuk || !input.trim()}
                aria-label="Kirim"
                className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-utama text-utama-teks transition-all hover:brightness-110 active:scale-95 disabled:opacity-25 disabled:hover:brightness-100"
              >
                {/* Panah ke atas -- lebih ringkas daripada tulisan "Kirim" */}
                <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden>
                  <path
                    d="M10 16V4M10 4L5 9M10 4l5 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-0.5">
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-tinta-lemah">
                <PilihModel nilai={model} onPilih={setModel} daftar={modelDitawarkan} />
                {/* Keterangan tetap di luar dropdown supaya terbaca tanpa
                    membukanya dulu. */}
                <span className="truncate">
                  {MODEL_TERSEDIA.find((m) => m.id === model)?.keterangan}
                </span>
              </div>

              <span className="hidden shrink-0 text-[11px] text-tinta-lemah/70 sm:block">
                Enter kirim &middot; Shift+Enter baris baru
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
