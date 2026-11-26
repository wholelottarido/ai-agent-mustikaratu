"use client";

import { useState } from "react";
import { jawabanUntuk, teksPilihan } from "@/lib/cocok-pilihan";

export type PilihanProduk = {
  kode: string;
  nama: string;
  /**
   * Boleh tidak ada: `cari_tren_pasar` sebelum 2 Nov 2026 cuma mengirim kode
   * dan nama. Percakapan lama tetap harus bisa dibuka tanpa galat.
   */
  riwayat_bulan?: number;
  data_terakhir?: string;
};

export type Klarifikasi = { pesan: string; pilihan: PilihanProduk[]; alat?: string };

/**
 * Spasi dirapikan sebelum nama dikirim kembali.
 *
 * ⚠️ 34% nama di katalog memuat spasi ganda ("MINYAK CEMCEMAN    175 ML RJ").
 * Dikirim apa adanya, yang muncul di gelembung pertanyaan user adalah celah
 * lebar yang terlihat seperti kerusakan tampilan. Pencocokan di `cariSku()`
 * merapikan spasi di KEDUA sisi, jadi nama yang sudah dirapikan tetap menemukan
 * produk yang sama persis — ini aman, bukan sekadar lebih enak dilihat.
 */
function rapikan(nama: string): string {
  return nama.trim().replace(/\s+/g, " ");
}

/**
 * Daftar varian produk sebagai tombol, waktu nama yang diketik user ambigu.
 *
 * ============================================================
 * ⚠️ KENAPA INI ADA
 * ============================================================
 * Nama produk di katalog panjang dan penuh singkatan:
 * "MINYAK CEMCEMAN  175 ML RJ+M.ZAITUN 12ML". Waktu tiga varian ditawarkan,
 * satu-satunya cara menjawab dulu adalah MENGETIK ULANG salah satunya huruf
 * per huruf — nama yang baru saja ditampilkan di layar yang sama.
 *
 * Satu huruf salah berarti pertanyaannya terulang. Itu bukan kesalahan
 * pemakai; daftar yang bisa ditekan justru bentuk jawaban yang wajar untuk
 * pertanyaan pilihan ganda.
 *
 * ⚠️ TOMBOL INI CUMA MENGIRIM TEKS, tidak memanggil tool apa pun. Yang
 * dikirim nama dari DAFTAR — bukan dari ingatan model, bukan dari ketikan
 * user — jadi produk yang dirujuk pasti ada. Setelah itu jalannya sama persis
 * seperti kalau diketik: model memanggil tool, tool mencocokkan ke katalog.
 *
 * ⚠️ TIDAK ADA TOMBOL "SEMUANYA". Satu pertanyaan ramalan menyangkut satu
 * produk; menjawab "semuanya" berarti tiga ramalan dalam satu jawaban yang
 * angkanya bercampur — persis yang dihindari dengan bertanya.
 */
export function PilihProduk({
  data,
  jawabanBerikut,
  kirim,
  nonaktif,
}: {
  data: Klarifikasi;
  /** Pesan user sesudah daftar ini, kalau sudah ada. Untuk percakapan yang dibuka ulang. */
  jawabanBerikut?: string;
  /** Mengirim teks sebagai pertanyaan baru, sama seperti menekan Kirim. */
  kirim: (teks: string) => void;
  /** Model sedang menjawab — menekan tombol sekarang akan terbuang. */
  nonaktif: boolean;
}) {
  // ⚠️ Setelah ditekan, daftarnya tidak hilang tapi TERKUNCI, dan yang dipilih
  // ditandai. Kalau hilang, gelembung jawaban di atasnya jadi menyebut daftar
  // yang tidak ada lagi di layar. Kalau tetap bisa ditekan, satu klik ragu
  // mengirim pertanyaan kedua yang menumpuk jawabannya.
  const [ditekan, setDitekan] = useState<string | null>(null);
  // ⚠️ Pilihan juga dibaca dari pesan berikutnya, bukan cuma dari tekanan tombol.
  // Sesudah percakapan dibuka ulang keadaan tombol sudah hilang; tanpa ini, daftar
  // yang sudah dijawab terbuka lagi dan bisa memicu pertanyaan kedua. Berlaku juga
  // kalau namanya diketik sendiri.
  const dipilih = ditekan
    ?? (jawabanBerikut ? data.pilihan.find((p) => jawabanUntuk(p, jawabanBerikut, data.alat))?.kode : null)
    ?? null;

  function pilih(p: PilihanProduk) {
    if (dipilih || nonaktif) return;
    setDitekan(p.kode);
    kirim(teksPilihan(p, data.alat));
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-permukaan/60 shadow-kecil ring-1 ring-garis/60">
      <div className="border-b border-garis/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-tinta-lemah">
          Pilih produknya
        </p>
        <p className="mt-0.5 text-xs text-tinta-lemah">
          {data.pilihan.length} produk cocok &mdash; tekan salah satu, tidak perlu diketik ulang
        </p>
      </div>

      <ul className="divide-y divide-garis/40">
        {data.pilihan.map((p) => {
          const ini = dipilih === p.kode;
          return (
            <li key={p.kode}>
              <button
                onClick={() => pilih(p)}
                disabled={dipilih !== null || nonaktif}
                className={
                  "flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left transition-colors " +
                  (ini ? "bg-aksen/25 " : "hover:bg-kertas ") +
                  "disabled:cursor-default disabled:hover:bg-transparent " +
                  (dipilih !== null && !ini ? "opacity-40" : "")
                }
              >
                <span className="min-w-0">
                  {/* Nama dirapikan spasinya DI TAMPILAN JUGA, supaya yang
                      dilihat sama dengan yang nanti terkirim. */}
                  <span className="block text-sm font-medium">{rapikan(p.nama)}</span>
                  <span className="mt-0.5 block text-xs text-tinta-lemah">
                    {/* ⚠️ PANJANG RIWAYAT DISEBUT, dan itu yang paling
                        menentukan pilihan. Varian 86 bulan dan varian 28 bulan
                        namanya hampir sama, tapi ramalan dari 28 bulan jauh
                        lebih lemah — dan tanpa angka ini tidak ada cara
                        pemakai mengetahuinya. */}
                    <span className="font-mono">{p.kode}</span>
                    {p.riwayat_bulan !== undefined && <> &middot; riwayat {p.riwayat_bulan} bulan</>}
                    {p.data_terakhir && <> &middot; sampai {p.data_terakhir}</>}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-tinta-lemah">{ini ? "✓ dipilih" : "→"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {dipilih === null && (
        <p className="border-t border-garis/50 px-4 py-2.5 text-xs text-tinta-lemah">
          Bukan salah satu dari ini? Ketik nama yang lebih lengkap di kolom bawah.
        </p>
      )}
    </div>
  );
}
