"use client";

import { useState } from "react";
import { hitungBiaya, formatRupiah, KURS_USD } from "@/voltagent/models";

/**
 * Baris kecil di bawah tiap jawaban: model, lama proses, dan TABEL APA SAJA
 * yang datanya dipakai.
 *
 * Nama tabelnya diurai dari SQL yang benar-benar dijalankan, bukan dari klaim
 * agent di teks jawaban. SQL lengkapnya bisa dibuka supaya user yang ragu
 * bisa memeriksa sendiri angkanya dari mana.
 */
export function SumberJawaban({
  model,
  modelId,
  detik,
  query,
  token,
  sumber,
  alat = [],
  dokumen = 0,
  kb = 0,
  tiket = 0,
  sop = [],
  sql,
  agent = [],
}: {
  model: string;
  /** Id asli model, untuk menghitung biaya. Label saja tidak cukup. */
  modelId: string;
  detik: number;
  query: number;
  /** Jumlah token yang dipakai. `null` untuk jawaban lama yang belum dicatat. */
  token?: { masuk: number | null; keluar: number | null } | null;
  sumber: string[];
  /**
   * Alat yang BENAR-BENAR dipanggil, bukan yang terpasang di agent.
   *
   * ⚠️ TIDAK SAMA DENGAN DAFTAR SUMBER, dan itu sebabnya ditampilkan terpisah.
   * Satu view bisa dibaca beberapa alat dengan cakupan berbeda —
   * `asisten_tiket` (tiket penanya) dan `asisten_antrean_tiket` (seluruh
   * perusahaan) membaca `v_ai_mg_tiket` yang sama. Menyebut view-nya saja
   * membuat keduanya tidak terbedakan, padahal bedanya justru siapa yang
   * barisnya terlihat.
   *
   * Kosong untuk jawaban lama: daftar ini baru dikirim sejak 9 Okt 2026 dan
   * tidak ikut tersimpan di riwayat.
   */
  alat?: string[];
  /**
   * Agent aplikasi yang menjawab, kalau Agent Umum mendelegasikannya.
   *
   * Diambil dari hasil `delegate_task`, bukan dari teks jawaban — user perlu
   * tahu agent mana yang bicara supaya kalau jawabannya meleset dia tahu harus
   * bertanya ke mana lain kali.
   */
  agent?: string[];
  /** Berapa dokumen terlampir yang dibaca untuk jawaban ini. */
  dokumen?: number;
  /** Berapa kali basis pengetahuan SOP/tiket dibaca untuk jawaban ini. */
  kb?: number;
  /** Berapa kali tiket helpdesk lama dicari untuk jawaban ini. */
  tiket?: number;
  /** Kode dokumen SOP yang dipakai, untuk tombol buka PDF-nya. */
  sop?: string[];
  sql: string[];
}) {
  const [buka, setBuka] = useState(false);

  /**
   * Sumber yang bukan nama tabel.
   *
   * ⚠️ TIDAK diberi keterangan "bukan database".
   *
   * Label lama berbunyi "dari dokumen terlampir, bukan database" karena waktu
   * itu pilihannya cuma dua: dari tabel, atau bukan dari mana-mana. Frasa itu
   * SALAH kalau dipakai untuk SOP -- korpus SOP justru disimpan DI database
   * (`ai_kb_dokumen` di PostgreSQL perusahaan). Sekarang sumbernya disebut
   * namanya, jadi keterangan penyangkalan itu tidak diperlukan lagi.
   */
  const lain: string[] = [];
  if (kb && kb > 0) lain.push("dokumen SOP");
  // Tiket DIPISAH dari SOP: satu prosedur resmi, satu catatan bebas teknisi.
  if (tiket && tiket > 0) lain.push("tiket helpdesk lama");
  if (dokumen > 0) {
    lain.push(dokumen > 1 ? `${dokumen} dokumen terlampir` : "dokumen terlampir");
  }
  const adaSumber = sumber.length > 0 || lain.length > 0;

  // Dihitung dari token + harga model, tidak disimpan. Kalau harganya berubah,
  // jawaban lama ikut dihitung ulang -- untuk perkiraan itu justru benar.
  const biaya = hitungBiaya(modelId, token?.masuk, token?.keluar);

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-tinta-lemah">
        <span className="rounded-full bg-permukaan px-2 py-0.5 font-medium">{model}</span>
        {detik > 0 && <span>{detik.toFixed(1)} detik</span>}

        {/* Token ditampilkan untuk SEMUA model, termasuk lokal -- yang lokal
            gratis, tapi angkanya tetap berguna untuk tahu seberapa berat
            pertanyaannya. Jawaban lama (sebelum kolom ini ada) tidak punya
            angkanya, jadi barisnya sengaja dilewati, bukan ditulis "0". */}
        {token && (token.masuk !== null || token.keluar !== null) && (
          <>
            <span aria-hidden>&middot;</span>
            <span
              title={`${token.masuk ?? 0} token masuk (pertanyaan + instruksi + hasil query), ${token.keluar ?? 0} token keluar (jawaban)`}
            >
              {(token.masuk ?? 0).toLocaleString("id-ID")}&nbsp;&#8595;{" "}
              {(token.keluar ?? 0).toLocaleString("id-ID")}&nbsp;&#8593; token
            </span>
            {biaya !== null && (
              <span
                className={biaya === 0 ? "text-tinta-lemah/80" : ""}
                title={
                  biaya === 0
                    ? "Model lokal tidak memakai kredit API"
                    : `Perkiraan, bukan tagihan. Kurs dipatok Rp ${KURS_USD.toLocaleString("id-ID")}/USD.`
                }
              >
                &middot; {formatRupiah(biaya)}
              </span>
            )}
          </>
        )}

        {/* Agent yang menjawab, kalau pertanyaannya didelegasikan. Ditaruh
            SEBELUM sumber: yang pertama ingin diketahui user bukan nama view,
            tapi siapa yang bicara. */}
        {agent.length > 0 && (
          <>
            <span aria-hidden>&middot;</span>
            <span className="flex flex-wrap items-center gap-1">
              <span>Dijawab</span>
              {agent.map((a) => (
                <code
                  key={a}
                  className="rounded bg-aksen px-1.5 py-0.5 text-[10.5px] text-aksen-teks"
                >
                  {a}
                </code>
              ))}
            </span>
          </>
        )}

        {alat.length > 0 && (
          <>
            <span aria-hidden>&middot;</span>
            <span className="flex flex-wrap items-center gap-1">
              <span>Alat:</span>
              {alat.map((a) => (
                <code
                  key={a}
                  className="rounded-md bg-permukaan px-1.5 py-0.5 font-mono text-[10.5px] text-tinta ring-1 ring-garis"
                >
                  {a}
                </code>
              ))}
            </span>
          </>
        )}

        {adaSumber ? (
          <>
            <span aria-hidden>&middot;</span>
            <span className="flex flex-wrap items-center gap-1">
              <span>Sumber:</span>
              {/* Nama tabel jadi chip karena itu pengenal yang bisa dicocokkan
                  ke SQL di bawah; sumber lain prosa biasa. */}
              {sumber.map((t) => (
                <code
                  key={t}
                  className="rounded-md bg-aksen/25 px-1.5 py-0.5 font-mono text-[10.5px] text-tinta"
                >
                  {t}
                </code>
              ))}
              {lain.length > 0 && (
                <span>
                  {sumber.length > 0 ? "+ " : ""}
                  {lain.join(" + ")}
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <span aria-hidden>&middot;</span>
            {/* Jawaban tanpa query, tanpa dokumen, DAN tanpa basis pengetahuan
                -- mis. agent menolak atau menjelaskan keterbatasan. Perlu
                disebut supaya user tahu angkanya (kalau ada) TIDAK berasal
                dari mana pun. */}
            <span>tidak mengambil data dari database</span>
          </>
        )}

        {sql.length > 0 && (
          <>
            <span aria-hidden>&middot;</span>
            <button
              onClick={() => setBuka((b) => !b)}
              aria-expanded={buka}
              className="rounded-md px-1.5 py-0.5 font-medium underline decoration-dotted underline-offset-2 transition-colors hover:bg-permukaan hover:text-tinta"
            >
              {buka ? "sembunyikan" : `lihat ${query === 1 ? "query" : `${query} query`}`}
            </button>
          </>
        )}
      </div>

      {/* ⚠️ Dokumen yang BENAR-BENAR dikembalikan tool, bukan yang disebut
          model di teks jawaban. Tautan dirakit dari kodenya, jadi tidak ada
          jalan bagi kode karangan untuk jadi tombol di sini — `dokumenSop()`
          di chat.tsx cuma mengambil dari keluaran `cari_sop`.

          Dibuka di tab baru: user sedang membandingkan jawaban dengan
          dokumennya, jadi percakapannya tidak boleh hilang. */}
      {sop.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-tinta-lemah">Buka dokumennya:</span>
          {sop.map((kode) => (
            <a
              key={kode}
              href={`/api/sop/${encodeURIComponent(kode)}/berkas`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Buka ${kode}.pdf — cocokkan sendiri halaman dan barisnya`}
              className="inline-flex items-center gap-1 rounded-full bg-permukaan px-2 py-0.5 text-[11px] font-medium text-tinta ring-1 ring-garis/60 transition-colors hover:bg-aksen/25"
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="h-3 w-3 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5z" />
                <path d="M9 1.5V5.5H13" />
              </svg>
              {kode}.pdf
            </a>
          ))}
        </div>
      )}

      {buka && (
        <div className="muncul mt-2 space-y-2">
          {sql.map((q, i) => (
            <pre
              key={i}
              className="overflow-x-auto rounded-xl bg-permukaan/60 p-3 font-mono text-[11px] leading-relaxed ring-1 ring-garis/60"
            >
              {q.trim()}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
