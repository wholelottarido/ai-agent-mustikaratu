"use client";

import { useState } from "react";
import type { ToolTampil, IzinPilihan } from "@/lib/ubah-tool";

/**
 * Daftar dan penyunting setelan tool AI.
 *
 * ⚠️ Pilihan cakupan yang TIDAK MUNGKIN tidak ditampilkan sama sekali.
 *
 * `cakupanBisa` datang dari server, dihitung dari kolom penyaring sumbernya.
 * Menampilkan "Diri sendiri" untuk sumber yang tidak punya `kolom_employee`
 * lalu menolaknya waktu Simpan berarti membiarkan administrator menyangka
 * pilihan itu ada. Yang tidak mungkin, tidak ditawarkan.
 */

const LABEL: Record<string, string> = {
  diri: "Diri sendiri",
  bawahan: "Diri + bawahan",
  departemen: "Satu departemen",
  perusahaan: "Satu perusahaan",
  semua: "Seluruh perusahaan",
};

/**
 * Baris izin sebuah tool.
 *
 * ⚠️ ADA KARENA LAYAR INI SEMPAT MENYESATKAN. Sebelum ini, administrator
 * melihat `asisten_antrean_tiket` bercakupan "Seluruh perusahaan" tanpa
 * petunjuk apa pun bahwa ada izin yang menjaganya — dan sebaliknya, tool
 * bercakupan sama TANPA izin terlihat persis serupa.
 *
 * Yang kedua itu yang berbahaya: cakupan "Seluruh perusahaan" tanpa izin
 * berarti tool itu terpasang untuk SETIAP orang yang bisa membuka aplikasinya.
 * Untuk data pribadi — tiket, pengajuan, aset — itu kebocoran, bukan setelan.
 */
function Izin({ t }: { t: ToolTampil }) {
  if (t.izin) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-tinta-lemah">
        <span className="rounded-lg bg-aksen px-2 py-0.5 font-medium text-aksen-teks">Butuh izin</span>
        <code className="font-mono text-tinta">{t.izin}</code>
        <span>&mdash; yang tidak punya izin ini tidak mendapat tool-nya sama sekali.</span>
      </p>
    );
  }
  if (t.cakupan !== "semua") return null;
  return (
    <p className="mt-2 border-l-2 border-bahaya pl-3 text-xs leading-relaxed text-tinta-lemah">
      <strong className="text-tinta">Tanpa syarat izin.</strong> Cakupannya seluruh perusahaan dan
      tidak ada izin yang menjaganya, jadi tool ini terpasang untuk{" "}
      <strong className="text-tinta">setiap orang</strong> yang bisa membuka aplikasinya. Itu wajar
      untuk data umum seperti SOP atau direktori karyawan, tapi bukan untuk data pribadi.
    </p>
  );
}

/**
 * Kotak persetujuan tool TULIS milik tim lain.
 *
 * ⚠️ ADA KARENA KEMAMPUAN MENULIS PERNAH DATANG SENDIRI.
 *
 * Penjalan tulis umum merakit tool tulis dari baris konfigurasi tanpa kode
 * khusus — itu yang membuat tim IT bisa menambah tool sendiri dari layar ini.
 * Tapi `ai_tool` diisi tim lain juga, jadi baris tulis MEREKA ikut terakit.
 *
 * 13 Okt 2026 tim lain membangun ulang katalognya dalam sehari, dan dua tool
 * tulis ke tabel tiket langsung hidup di portal ini tanpa ditinjau siapa pun.
 * Salah satunya tool yang minggu sebelumnya DIHAPUS dari sini atas permintaan
 * tim IT; dia kembali karena katalog sebelah berubah.
 *
 * Yang ditampilkan di sini bukan saklar aktif/mati, tapi keputusan: operasi
 * apa, ke tabel apa, milik siapa.
 */
function Persetujuan({
  t,
  sibuk,
  atur,
}: {
  t: ToolTampil;
  sibuk: boolean;
  atur: (kode: string, setuju: boolean) => void;
}) {
  if (!t.perluPersetujuan) return null;
  const operasi: Record<string, string> = {
    ubah: "mengubah baris yang sudah ada",
    hapus: "menandai baris terhapus atau selesai",
    tambah: "menambah baris baru",
  };
  return (
    <div
      className={`mt-3 rounded-xl border p-3 text-xs leading-relaxed ${
        t.disetujui ? "border-garis bg-kertas" : "border-bahaya bg-bahaya-lemah"
      }`}
    >
      <p className="text-tinta">
        <strong>
          {t.disetujui ? "Tool tulis tim lain — sudah disetujui." : "Tool tulis tim lain — belum disetujui."}
        </strong>{" "}
        Baris ini bisa <strong>{operasi[t.operasi] ?? t.operasi}</strong> di tabel{" "}
        <code className="rounded bg-permukaan px-1 py-0.5 font-mono">{t.tabelTarget ?? "?"}</code>, dan
        yang mendaftarkannya bukan portal ini.
      </p>
      <p className="mt-1.5 text-tinta-lemah">
        {t.disetujui ? (
          <>
            Model memegangnya sekarang. Mencabut persetujuan membuat portal ini berhenti
            merakitnya &mdash; baris aslinya tidak dihapus, dan sistem AI tim lain tetap
            memakainya seperti biasa.
          </>
        ) : (
          <>
            Portal ini <strong className="text-tinta">tidak merakitnya</strong>, jadi model tidak
            memegangnya. Setujui hanya kalau operasi dan tabel di atas memang yang Anda maksud.
            Penjagaan lain tetap berlaku sesudah disetujui: hanya baris milik penanya, hanya kolom
            yang diizinkan database, dan penyimpanannya tetap perlu tombol yang ditekan manusia.
          </>
        )}
      </p>
      <button
        type="button"
        disabled={sibuk}
        onClick={() => atur(t.kode, !t.disetujui)}
        className={`mt-2.5 rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
          t.disetujui
            ? "border border-garis bg-permukaan text-tinta"
            : "bg-tinta text-permukaan"
        }`}
      >
        {sibuk ? "Menyimpan…" : t.disetujui ? "Cabut persetujuan" : "Setujui tool tulis ini"}
      </button>
      {/* ⚠️ Persetujuan BERLAKU PER TOOL, bukan per agent. Yang disetujui
          kemampuan mengubah baris di sebuah tabel, dan tabelnya sama dari
          agent mana pun. */}
      {t.agentLain.length > 0 && (
        <p className="mt-2 text-tinta-lemah">
          Berlaku untuk semua agent yang memakainya &mdash; termasuk{" "}
          <strong className="text-tinta">{t.agentLain.join(", ")}</strong>.
        </p>
      )}
    </div>
  );
}

/**
 * Daftar awal datang dari HALAMAN (server component), bukan dari `useEffect`.
 *
 * Versi pertama memuatnya di effect, dan itu berarti layar sempat kosong lalu
 * terisi — padahal halamannya sudah memeriksa hak ke database, jadi datanya
 * sebenarnya sudah ada di server. Memuat ulang cuma dilakukan SESUDAH
 * menyimpan, karena saat itu memang ada yang berubah.
 */
export function AturTool({ awal, izin }: { awal: ToolTampil[]; izin: IzinPilihan[] }) {
  const [tool, setTool] = useState<ToolTampil[] | null>(awal);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);

  async function muat() {
    try {
      const r = await fetch("/api/admin/ai-tool");
      if (!r.ok) {
        setGalat(r.status === 404 ? "Halaman ini hanya untuk tim IT." : `Gagal memuat (${r.status}).`);
        return;
      }
      const d = (await r.json()) as { tool: ToolTampil[] };
      setTool(d.tool);
      setGalat(null);
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    }
  }

  async function simpan(kode: string, ubahan: Record<string, unknown>) {
    setSibuk(kode);
    setPesan(null);
    try {
      const r = await fetch("/api/admin/ai-tool", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kode, ubahan }),
      });
      const d = (await r.json()) as { error?: string };
      // Pesan penolakan dari server ditampilkan APA ADANYA. Dia menyebut
      // sebabnya ("sumbernya tidak punya kolom penyaringnya") -- menggantinya
      // dengan "Gagal menyimpan" membuang satu-satunya petunjuk yang berguna.
      setPesan(r.ok ? `${kode} disimpan.` : (d.error ?? `Gagal (${r.status}).`));
      if (r.ok) await muat();
    } catch {
      setPesan("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(null);
    }
  }

  /**
   * Menyetujui / mencabut tool tulis milik tim lain.
   *
   * ⚠️ Yang dikirim cuma KODENYA. Operasi dan tabelnya dibaca server dari
   * konfigurasi yang sedang berlaku — kalau peramban yang menyebutkan isinya,
   * persetujuan bisa tercatat untuk operasi/tabel yang berbeda dari yang
   * benar-benar terpasang.
   */
  async function aturPersetujuan(kode: string, setuju: boolean) {
    setSibuk(kode);
    setPesan(null);
    try {
      const r = await fetch("/api/admin/ai-tool", {
        method: setuju ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: kode, mode: setuju ? "setujui-tulis" : "cabut-tulis" }),
      });
      const d = (await r.json()) as { error?: string };
      setPesan(
        r.ok
          ? setuju
            ? `${kode} disetujui — model sekarang memegangnya.`
            : `Persetujuan ${kode} dicabut — portal ini berhenti merakitnya.`
          : (d.error ?? `Gagal (${r.status}).`),
      );
      if (r.ok) await muat();
    } catch {
      setPesan("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(null);
    }
  }

  if (galat) return <p className="rounded-xl bg-bahaya-lemah p-4 text-sm text-bahaya">{galat}</p>;
  if (!tool) return <p className="text-sm text-tinta-lemah">Memuat&hellip;</p>;
  if (tool.length === 0) {
    return (
      <p className="rounded-xl border border-garis bg-permukaan p-4 text-sm text-tinta-lemah">
        Portal ini belum mendaftarkan tool apa pun. Jalankan{" "}
        <code className="rounded bg-kertas px-1.5 py-0.5">npm run daftar:sumber-ai</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Dirender SEKALI untuk seluruh daftar tool. Lihat catatan di kolom izin. */}
      <datalist id="daftar-izin">
        {izin.map((i) => (
          <option key={i.kode} value={i.kode}>
            {i.peran} peran
          </option>
        ))}
      </datalist>
      {pesan && (
        <p
          role="status"
          className="rounded-xl border border-garis bg-permukaan p-3 text-sm text-tinta"
        >
          {pesan}
        </p>
      )}

      {Object.entries(
        tool.reduce<Record<string, ToolTampil[]>>((p, t) => {
          const k = t.agent ?? "Belum tersambung ke agent mana pun";
          (p[k] ??= []).push(t);
          return p;
        }, {}),
      ).map(([agent, daftar]) => (
        <div key={agent} className="flex flex-col gap-2">
          <h2 className="mt-2 flex items-baseline gap-2 text-sm font-semibold tracking-tight">
            {agent}
            <span className="text-xs font-normal text-tinta-lemah">
              {daftar.length} tool &middot; {daftar.filter((t) => t.milikKita).length} bisa diubah
              di sini
            </span>
          </h2>
          {daftar.map((t) => (
        /* Kunci memuat agent-nya: satu tool bisa dipakai beberapa agent,
           dan kodenya saja tidak unik di daftar ini. */
        <section key={`${t.agent}:${t.kode}`} className="rounded-2xl border border-garis bg-permukaan p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="font-semibold tracking-tight">{t.nama}</h3>
            {t.agentLain.length > 0 && (
              <span className="rounded-full bg-kertas px-2 py-0.5 text-[11px] text-tinta-lemah">
                dipakai juga {t.agentLain.join(", ")}
              </span>
            )}
            {!t.milikKita && (
              <span className="rounded-full border border-garis px-2 py-0.5 text-[11px] text-tinta-lemah">
                bawaan sistem &mdash; tidak bisa diubah di sini
              </span>
            )}
            <code className="rounded bg-kertas px-1.5 py-0.5 text-xs text-tinta-lemah">{t.kode}</code>
            {t.agent && <span className="text-xs text-tinta-lemah">dipakai {t.agent}</span>}
            {/* ⚠️ LABELNYA DIPERBAIKI 9 Okt 2026, dan ini bukan soal kata.
                Sebelumnya tertulis "belum dinyalakan" untuk SETIAP tool milik
                portal ini -- padahal ketigabelasnya jalan sehari-hari. Pada
                baris milik kita `is_active = false` berarti "sistem AI tim
                lain tidak mengambilnya", BUKAN "dimatikan"; pembaca
                konfigurasi memang sengaja mengabaikannya untuk tool kita.
                Label lama membuat administrator mencari saklar yang tidak
                pernah mematikan apa pun, dan membuat satu route menolak
                penyimpanan dengan alasan yang keliru. */}
            {t.milikKita ? (
              !t.aktif && (
                <span
                  title="Tool ini tetap dipakai portal. Tandanya menahannya dari sistem AI tim lain."
                  className="rounded-full bg-kertas px-2 py-0.5 text-[11px] text-tinta-lemah"
                >
                  tidak dibagikan ke sistem tim lain
                </span>
              )
            ) : (
              !t.aktif && (
                <span className="rounded-full bg-kertas px-2 py-0.5 text-[11px] text-tinta-lemah">
                  dimatikan
                </span>
              )
            )}
          </div>

          <p className="mt-1 text-xs text-tinta-lemah">
            {t.jenis === "kode" ? (
              <>
                Tool berjenis <strong>kode</strong>, penanganya{" "}
                <code className="rounded bg-kertas px-1 py-0.5">{t.penangan}</code>. Kolom dan
                cakupannya ditentukan penanganya, bukan setelan di sini &mdash; begitu juga
                keterangan yang dibaca model.
              </>
            ) : (
              <>
                Membaca <code className="rounded bg-kertas px-1 py-0.5">{t.view}</code>, operasi{" "}
                {t.operasi}.{" "}
                {t.sumberKode && (
                  <a
                    href={`/kelola-ai?tab=sumber&sumber=${t.sumberKode}`}
                    className="underline decoration-garis underline-offset-2 hover:decoration-tinta"
                  >
                    Lihat asal datanya &rarr;
                  </a>
                )}
              </>
            )}
          </p>

          <Izin t={t} />

          <Persetujuan t={t} sibuk={sibuk === t.kode} atur={(k, v) => void aturPersetujuan(k, v)} />

          {t.jenis === "konfigurasi" && !t.milikKita && (
            /* Setelannya ditampilkan tapi mati. Menyembunyikannya membuat
               administrator mengira tool ini tidak punya cakupan sama sekali;
               yang benar adalah dia punya, dan nilainya ditentukan di tempat
               lain. */
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-kertas px-3 py-2 text-xs text-tinta-lemah">
              <span>
                Cakupan: <strong className="font-medium text-tinta">{LABEL[t.cakupan] ?? t.cakupan}</strong>
              </span>
              <span>Batas {t.batas} baris</span>
              <span>{t.kolom.length} kolom dibaca</span>
            </div>
          )}

          {t.milikKita && t.agentLain.length > 0 && (
            <p className="mt-3 rounded-xl bg-kertas p-2.5 text-xs leading-relaxed text-tinta-lemah">
              Setelan ini satu baris yang sama dengan yang dipakai{" "}
              <strong className="text-tinta">{t.agentLain.join(", ")}</strong>. Mengubahnya di sini
              mengubahnya di sana juga &mdash; bukan salinan terpisah.
            </p>
          )}

          {t.jenis === "konfigurasi" && t.milikKita && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Cakupan &mdash; siapa yang barisnya terlihat</span>
                <select
                  defaultValue={t.cakupan}
                  disabled={sibuk === t.kode}
                  onChange={(e) => void simpan(t.kode, { cakupan: e.target.value })}
                  className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
                >
                  {t.cakupanBisa.map((c) => (
                    <option key={c} value={c}>
                      {LABEL[c] ?? c}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-tinta-lemah">
                  {t.cakupanBisa.length === 1
                    ? "Sumber ini tidak punya kolom penyaring orang, jadi tidak ada pilihan lain."
                    : `Yang tidak tersedia tidak ditampilkan: sumbernya tidak punya kolom penyaringnya.`}
                </span>
              </label>

              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium">Syarat izin &mdash; siapa yang DAPAT tool ini</span>
                {/* ⚠️ `datalist` BERSAMA, bukan `select` per tool.
                    Versi pertama merender 472 pilihan di dalam tiap kartu
                    tool — sekitar 9.400 elemen, dan halamannya membengkak
                    dari 114 KB jadi 573 KB. Daftarnya dirender SEKALI di
                    bawah, dan tiap kartu cuma menunjuk ke sana. */}
                <input
                  list="daftar-izin"
                  defaultValue={t.izin ?? ""}
                  disabled={sibuk === t.kode}
                  placeholder="(tanpa syarat — semua pemegang aplikasinya)"
                  // `onBlur`, bukan `onChange`: mengetik "ticket:read" lewat
                  // sepuluh keadaan setengah jadi, dan tiap satunya akan jadi
                  // satu permintaan simpan yang ditolak.
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (t.izin ?? "")) void simpan(t.kode, { izin: v || null });
                  }}
                  className="rounded-xl border border-garis bg-kertas px-3 py-2 font-mono text-sm"
                />
                {/* ⚠️ Angka peran ikut ditampilkan, dan itu bukan hiasan.
                    Izin yang tidak dimiliki peran mana pun membuat tool-nya
                    HILANG untuk semua orang tanpa satu pesan galat. Daftar ini
                    cuma memuat izin yang benar-benar diberikan ke peran, tapi
                    jumlahnya tetap disebut supaya yang kecil terlihat. */}
                <span className="text-xs text-tinta-lemah">
                  {t.cakupan === "semua" && !t.izin
                    ? "Cakupannya seluruh perusahaan dan belum ada syarat izin — tool ini terbuka untuk semua orang yang bisa membuka aplikasinya."
                    : "Yang tidak punya izin ini tidak mendapat tool-nya sama sekali. Angka di sebelah kode = berapa peran yang memilikinya."}
                </span>
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Batas baris</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  defaultValue={t.batas}
                  disabled={sibuk === t.kode}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (n !== t.batas) void simpan(t.kode, { batas: n });
                  }}
                  className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
                />
                <span className="text-xs text-tinta-lemah">1&ndash;200.</span>
              </label>

              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Kolom yang boleh dibaca</legend>
                <p className="mb-2 text-xs text-tinta-lemah">
                  Yang tidak dicentang tidak pernah sampai ke model.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {t.katalog.map((k) => {
                    const dipakai = t.kolom.includes(k.nama);
                    return (
                      <label
                        key={k.nama}
                        className={
                          dipakai
                            ? "flex items-center gap-1.5 rounded-lg bg-aksen px-2.5 py-1 text-xs text-aksen-teks"
                            : "flex items-center gap-1.5 rounded-lg border border-garis px-2.5 py-1 text-xs text-tinta-lemah"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={dipakai}
                          disabled={sibuk === t.kode}
                          onChange={(e) =>
                            void simpan(t.kode, {
                              kolom: e.target.checked
                                ? [...t.kolom, k.nama]
                                : t.kolom.filter((x) => x !== k.nama),
                            })
                          }
                          className="size-3.5"
                        />
                        {k.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Penyaring yang bisa dipakai model</legend>
                {/* ⚠️ INI YANG MENENTUKAN PERTANYAAN APA YANG BISA DIJAWAB.
                    Tanpa penyaring, model cuma bisa mengambil N baris teratas
                    menurut urutan — dan pertanyaan seperti "yang jatuh tempo
                    bulan ini" tidak akan pernah menemukan barisnya kalau yang
                    dicari ada di luar jendela itu. Terjadi pada klaim MAPS:
                    26.061 baris punya jatuh tempo, tapi 20 baris teratas
                    menurut tanggal dibuat tidak satu pun punya. */}
                <p className="mb-2 text-xs leading-relaxed text-tinta-lemah">
                  Tanpa penyaring, model cuma bisa mengambil {t.batas} baris teratas menurut
                  urutannya. Penyaring membuat ia bisa mencari baris yang ada di luar jendela itu.
                  <strong className="text-tinta"> Dari</strong> dan{" "}
                  <strong className="text-tinta">sampai</strong> hanya untuk kolom tanggal.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {t.katalog.flatMap((k) =>
                    (k.tipe === "tanggal"
                      ? (["dari", "sampai"] as const)
                      : (["berisi", "sama"] as const)
                    ).map((op) => {
                      const ada = t.filter.some((f) => f.kolom === k.nama && f.operator === op);
                      return (
                        <label
                          key={`${k.nama}:${op}`}
                          className={
                            ada
                              ? "flex items-center gap-1.5 rounded-lg bg-aksen px-2.5 py-1 text-xs text-aksen-teks"
                              : "flex items-center gap-1.5 rounded-lg border border-garis px-2.5 py-1 text-xs text-tinta-lemah"
                          }
                        >
                          <input
                            type="checkbox"
                            checked={ada}
                            disabled={sibuk === t.kode}
                            onChange={(e) =>
                              void simpan(t.kode, {
                                filter: e.target.checked
                                  ? [...t.filter, { kolom: k.nama, label: k.label, operator: op }]
                                  : t.filter.filter((f) => !(f.kolom === k.nama && f.operator === op)),
                              })
                            }
                            className="size-3.5"
                          />
                          {k.label} <span className="opacity-70">{op}</span>
                        </label>
                      );
                    }),
                  )}
                </div>
              </fieldset>
            </div>
          )}

          {/* ⚠️ Pratinjau query. Dirangkai perakit yang SAMA dengan yang
              menjalankannya, jadi tidak bisa berbeda dari yang sebenarnya
              jalan. Inilah intinya: administrator melihat PERSIS query yang
              akan dijalankan, termasuk dari mana `$1` diisi. Tanpa ini,
              "tool tanpa SQL yang diketik tangan" berarti mempercayai sesuatu
              yang tidak kelihatan. */}
          {t.sql && (
            <details className="mt-4 rounded-xl bg-kertas p-3">
              <summary className="cursor-pointer text-xs font-medium text-tinta-lemah">
                Query yang akan dijalankan
              </summary>
              <pre className="mt-2 overflow-x-auto text-[11px] leading-relaxed">{t.sql}</pre>
            </details>
          )}

          {!t.milikKita ? (
            t.contoh && (
              <p className="mt-3 text-xs text-tinta-lemah">
                Contoh pertanyaan: &ldquo;{t.contoh}&rdquo;
              </p>
            )
          ) : (
          <label className="mt-4 flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Contoh pertanyaan</span>
            <input
              type="text"
              defaultValue={t.contoh ?? ""}
              disabled={sibuk === t.kode}
              onBlur={(e) => {
                if (e.target.value !== (t.contoh ?? "")) void simpan(t.kode, { contoh: e.target.value });
              }}
              className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
            />
            <span className="text-xs text-tinta-lemah">
              Ditampilkan sebagai saran di layar chat, dan membantu model mengenali kapan tool
              ini cocok.
            </span>
          </label>
          )}
        </section>
          ))}
        </div>
      ))}
    </div>
  );
}
