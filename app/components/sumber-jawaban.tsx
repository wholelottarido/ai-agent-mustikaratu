"use client";

import { useState } from "react";
import { hitungBiaya, formatRupiah, KURS_USD } from "@/voltagent/models";
import type { RujukanSop } from "@/voltagent/tool-konfigurasi";

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
  /** Dokumen dan bagian yang benar-benar dikembalikan pencarian SOP. */
  sop?: RujukanSop[];
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
  if (kb && kb > 0) lain.push(sop.length > 0 ? `${new Set(sop.map((x) => x.judul)).size} dokumen SOP` : "dokumen SOP");
  // Tiket DIPISAH dari SOP: satu prosedur resmi, satu catatan bebas teknisi.
  if (tiket && tiket > 0) lain.push("tiket helpdesk lama");
  if (dokumen > 0) {
    lain.push(dokumen > 1 ? `${dokumen} dokumen terlampir` : "dokumen terlampir");
  }
  const adaSumber = sumber.length > 0 || lain.length > 0;

  const ringkasanSumber: string[] = [];
  if (sumber.length > 0) ringkasanSumber.push("data perusahaan");
  if (kb > 0) {
    const judul = [...new Set(sop.map((x) => x.judul))];
    ringkasanSumber.push(judul.length === 1 ? `SOP “${judul[0]}”` : judul.length > 1 ? `${judul.length} dokumen SOP` : "dokumen SOP");
  }
  if (tiket > 0) ringkasanSumber.push("riwayat helpdesk");
  if (dokumen > 0) ringkasanSumber.push(dokumen > 1 ? `${dokumen} dokumen terlampir` : "dokumen terlampir");

  const dasarJawaban = ringkasanSumber.length > 0
    ? `Berdasarkan ${ringkasanSumber.join(" dan ")}`
    : "Jawaban umum";

  // Dihitung dari token + harga model, tidak disimpan. Kalau harganya berubah,
  // jawaban lama ikut dihitung ulang -- untuk perkiraan itu justru benar.
  const biaya = hitungBiaya(modelId, token?.masuk, token?.keluar);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-tinta-lemah">
        <span>{dasarJawaban}</span>

        <button
          type="button"
          onClick={() => setBuka((b) => !b)}
          aria-expanded={buka}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-tinta transition-colors hover:bg-permukaan/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-utama"
        >
          Detail proses
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
            className={`size-3.5 transition-transform ${buka ? "rotate-180" : ""}`}
          >
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {buka && (
        <section className="liquid-glass muncul mt-2.5 rounded-2xl p-3.5 text-xs text-tinta" aria-label="Detail proses jawaban">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-semibold">Proses AI</p>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-tinta-lemah">
                <dt>Model</dt>
                <dd className="text-tinta">{model}</dd>
                {agent.length > 0 && (
                  <>
                    <dt>Agen AI</dt>
                    <dd className="text-tinta">{agent.join(" + ")}</dd>
                  </>
                )}
                {detik > 0 && (
                  <>
                    <dt>Durasi</dt>
                    <dd className="text-tinta">{detik.toFixed(1)} detik</dd>
                  </>
                )}
                {token && (token.masuk !== null || token.keluar !== null) && (
                  <>
                    <dt>Token</dt>
                    <dd className="text-tinta">
                      {(token.masuk ?? 0).toLocaleString("id-ID")} masuk · {(token.keluar ?? 0).toLocaleString("id-ID")} keluar
                    </dd>
                  </>
                )}
                {biaya !== null && (
                  <>
                    <dt>Biaya</dt>
                    <dd className="text-tinta" title={biaya === 0 ? "Model lokal tidak memakai kredit API" : `Perkiraan, bukan tagihan. Kurs dipatok Rp ${KURS_USD.toLocaleString("id-ID")}/USD.`}>
                      {formatRupiah(biaya)}
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <div>
              <p className="font-semibold">Dasar jawaban</p>
              <div className="mt-1.5 space-y-2 text-tinta-lemah">
                <p>{dasarJawaban}</p>
                {alat.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Alat</span>
                    {alat.map((a) => (
                      <code key={a} className="rounded-md bg-permukaan/65 px-1.5 py-0.5 font-mono text-[11px] text-tinta ring-1 ring-garis/70">
                        {a}
                      </code>
                    ))}
                  </div>
                )}
                {adaSumber && sumber.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Sumber data</span>
                    {sumber.map((t) => (
                      <code key={t} className="rounded-md bg-aksen/25 px-1.5 py-0.5 font-mono text-[11px] text-tinta">
                        {t}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {sql.length > 0 && (
            <div className="mt-3 border-t border-garis/70 pt-3">
              <p className="font-semibold">{query === 1 ? "Query database" : `${query} query database`}</p>
              <div className="mt-2 space-y-2">
                {sql.map((q, i) => (
                  <pre key={i} className="overflow-x-auto rounded-xl bg-permukaan/65 p-3 font-mono text-[11px] leading-relaxed ring-1 ring-garis/60">
                    {q.trim()}
                  </pre>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Dokumen yang benar-benar dikembalikan pencarian SOP. */}
      {sop.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-tinta-lemah">Sumber SOP yang ditemukan</p>
          <div className="flex flex-wrap gap-1.5">
            {sop.map((rujukan, i) => {
              const isi = (
                <>
                  <svg viewBox="0 0 16 16" aria-hidden className="mt-0.5 h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5z" />
                    <path d="M9 1.5V5.5H13" />
                  </svg>
                  <span>
                    <strong className="font-semibold">{rujukan.judul}</strong>
                    {rujukan.bagian && <span className="text-tinta-lemah"> · {rujukan.bagian}</span>}
                  </span>
                </>
              );
              const kelas = "inline-flex max-w-full items-start gap-1.5 rounded-xl bg-permukaan px-2.5 py-1.5 text-[11px] text-tinta ring-1 ring-garis/60";
              const kunci = `${rujukan.judul}-${rujukan.bagian ?? i}`;
              return rujukan.url ? (
                <a key={kunci} href={rujukan.url} target="_blank" rel="noopener noreferrer" className={`${kelas} transition-colors hover:bg-aksen/25`} title="Buka sumber asli di tab baru">
                  {isi}
                </a>
              ) : (
                <span key={kunci} className={kelas}>{isi}</span>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
