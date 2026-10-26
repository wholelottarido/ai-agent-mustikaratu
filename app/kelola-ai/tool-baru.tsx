"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SumberPilihan, IzinPilihan } from "@/lib/ubah-tool";
import type { TargetTulis } from "@/lib/tool-tulis-baru";

/**
 * Borang tool baru — SATU borang untuk semua operasi.
 *
 * ⚠️ TIDAK ADA SQL YANG DIKETIK, dan tidak ada nama tabel yang diisi tangan.
 * Yang masuk cuma pilihan dari daftar; query atau perintahnya dirakit server.
 *
 * ⚠️ DIGABUNG DARI DUA BORANG (9 Okt 2026). Sebelumnya tool baca dan tool
 * tulis punya borang terpisah, dan administrator harus tahu lebih dulu jenis
 * apa yang ia butuhkan sebelum menemukan tombol yang benar. Yang membedakan
 * keduanya cuma satu pilihan — operasinya — jadi itu yang dijadikan pilihan
 * pertama, bukan dua tombol yang berbeda.
 *
 * ⚠️ TOOL TULIS TIDAK MENULIS SENDIRI. Ia menyusun rancangan; penyimpanannya
 * dipicu tombol konfirmasi yang ditekan manusia. AI tidak pernah punya jalan
 * menulis langsung, apa pun yang diisi di borang ini.
 */

const LABEL: Record<string, string> = {
  diri: "Diri sendiri",
  bawahan: "Diri + bawahan",
  departemen: "Satu departemen",
  perusahaan: "Satu perusahaan",
  semua: "Seluruh perusahaan",
};

type Operasi = "baca" | "tambah" | "ubah" | "hapus";

const LABEL_OPERASI: { nilai: Operasi; judul: string; ket: string }[] = [
  { nilai: "baca", judul: "Baca", ket: "menjawab pertanyaan dari satu sumber data" },
  { nilai: "ubah", judul: "Ubah", ket: "pengguna menyebut nilai barunya" },
  { nilai: "hapus", judul: "Batalkan", ket: "nilainya tetap, dari setelan di borang" },
  { nilai: "tambah", judul: "Tambah", ket: "membuat baris baru atas nama pengguna" },
];

/**
 * Deretan kolom yang bisa dicentang.
 *
 * ⚠️ DI LUAR komponen borang, bukan di dalamnya. Didefinisikan di dalam, ia
 * jadi komponen BARU tiap kali borang dirender — React membuang seluruh isinya
 * lalu memasangnya ulang pada tiap ketikan, dan centang yang sedang difokuskan
 * kehilangan fokusnya.
 */
function Centang({
  daftar,
  dipilih,
  ubah,
}: {
  daftar: { nama: string; label?: string; tipe?: string }[];
  dipilih: string[];
  ubah: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {daftar.map((k) => {
        const ada = dipilih.includes(k.nama);
        return (
          <label
            key={k.nama}
            title={k.tipe}
            className={
              ada
                ? "flex items-center gap-1.5 rounded-lg bg-aksen px-2.5 py-1 text-xs text-aksen-teks"
                : "flex items-center gap-1.5 rounded-lg border border-garis px-2.5 py-1 text-xs text-tinta-lemah"
            }
          >
            <input
              type="checkbox"
              checked={ada}
              onChange={(e) => ubah(e.target.checked ? [...dipilih, k.nama] : dipilih.filter((x) => x !== k.nama))}
              className="size-3.5"
            />
            {k.label ?? k.nama}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Pemilih izin.
 *
 * ⚠️ DROPDOWN, BUKAN KETIKAN BEBAS. Versi pertama memakai kotak ketik dengan
 * saran — dan sarannya bahkan tidak pernah muncul, karena `list` menunjuk id
 * datalist yang berbeda. Lebih dari itu: izin yang salah ketik tidak
 * menghasilkan galat apa pun saat disimpan, tool-nya cuma berhenti muncul
 * untuk semua orang. Pilihan tertutup membuat kesalahan itu mustahil.
 */
function PilihIzin({
  nilai,
  ubah,
  izin,
}: {
  nilai: string;
  ubah: (v: string) => void;
  izin: IzinPilihan[];
}) {
  return (
    <select
      value={nilai}
      onChange={(e) => ubah(e.target.value)}
      className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
    >
      <option value="">(tanpa syarat &mdash; semua pemegang aplikasinya)</option>
      {izin.map((i) => (
        <option key={i.kode} value={i.kode}>
          {i.kode} &middot; {i.peran} peran
        </option>
      ))}
    </select>
  );
}

export function ToolBaru({
  sumber,
  target,
  izin,
  agent,
  namaAgent,
}: {
  sumber: SumberPilihan[];
  /** Tabel yang boleh ditulis. Kosong = operasi tulis tidak ditawarkan. */
  target: TargetTulis[];
  izin: IzinPilihan[];
  /**
   * Kalau borang ini dibuka dari halaman sebuah agent, tool yang dibuat
   * langsung disambungkan ke agent itu.
   */
  agent?: string;
  namaAgent?: string;
}) {
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const [operasi, setOperasi] = useState<Operasi>("baca");
  const [izinDipilih, setIzinDipilih] = useState("");

  // --- baca ---
  const [kodeSumber, setKodeSumber] = useState(sumber[0]?.kode ?? "");
  const [kolom, setKolom] = useState<string[]>([]);
  const [cakupan, setCakupan] = useState("");

  // --- tulis ---
  const [sumberTulis, setSumberTulis] = useState(target[0]?.sumber ?? "");
  const [kunci, setKunci] = useState<string[]>([]);
  const [isian, setIsian] = useState<string[]>([]);
  const [tetapKolom, setTetapKolom] = useState("");
  const [tetapNilai, setTetapNilai] = useState("");
  const [bangkitKolom, setBangkitKolom] = useState("");
  const [bangkitNama, setBangkitNama] = useState("");
  const [syaratKolom, setSyaratKolom] = useState("");
  const [syaratNilai, setSyaratNilai] = useState("");

  const menulis = operasi !== "baca";
  const dipilih = sumber.find((s) => s.kode === kodeSumber);
  const t = target.find((x) => x.sumber === sumberTulis);
  // ⚠️ Hak ISI dan hak UBAH daftarnya BERBEDA. `no_ticket` boleh diisi saat
  // tiket lahir tapi tidak boleh diubah sesudahnya; menawarkan daftar yang
  // keliru berarti borang menjanjikan kolom yang nanti ditolak database.
  const bisaTulis = t?.kolom.filter((k) => (operasi === "tambah" ? k.bisaIsi : k.bisaUbah)) ?? [];

  function gantiSumber(k: string) {
    setKodeSumber(k);
    // Kolom dan cakupan milik sumber LAMA tidak berlaku di sumber baru.
    setKolom([]);
    setCakupan("");
  }
  function gantiSumberTulis(k: string) {
    setSumberTulis(k);
    setKunci([]);
    setIsian([]);
    setTetapKolom("");
    setBangkitKolom("");
    setBangkitNama("");
    setSyaratKolom("");
  }

  async function kirim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSibuk(true);
    setGalat(null);
    const umum = {
      kode: f.get("kode"),
      nama: f.get("nama"),
      deskripsi: f.get("deskripsi"),
      izin: izinDipilih || null,
      contoh: f.get("contoh") || null,
      ...(agent ? { agent } : {}),
    };
    try {
      const r = await fetch("/api/admin/ai-tool", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          menulis
            ? {
                ...umum,
                tulis: true,
                sumber: sumberTulis,
                operasi,
                kunci: operasi === "tambah" ? [] : kunci.map((k) => ({ kolom: k, label: k })),
                isian:
                  operasi === "ubah" || operasi === "tambah"
                    ? isian.map((k) => ({ kolom: k, label: k }))
                    : [],
                otomatis: [
                  ...(tetapKolom && tetapNilai
                    ? [{ kolom: tetapKolom, label: tetapKolom, nilai: tetapNilai }]
                    : []),
                  ...(operasi === "tambah" && bangkitKolom && bangkitNama
                    ? [{ kolom: bangkitKolom, label: bangkitKolom, pembangkit: bangkitNama }]
                    : []),
                ],
                syarat:
                  operasi !== "tambah" && syaratKolom && syaratNilai
                    ? [{ kolom: syaratKolom, boleh: syaratNilai.split(",").map((x) => x.trim()).filter(Boolean) }]
                    : [],
              }
            : {
                ...umum,
                sumber: kodeSumber,
                kolom,
                cakupan: cakupan || dipilih?.cakupanBisa[0],
                batas: Number(f.get("batas")),
                urut: f.get("urut") || null,
              },
        ),
      });
      const d = (await r.json()) as { error?: string };
      if (r.ok) {
        setBuka(false);
        setKolom([]);
        setKunci([]);
        setIsian([]);
        router.refresh();
      } else {
        // Pesan server ditampilkan apa adanya — dia menyebut sebabnya.
        setGalat(d.error ?? `Gagal (${r.status}).`);
      }
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(false);
    }
  }

  if (!buka) {
    return (
      <button
        type="button"
        onClick={() => setBuka(true)}
        className="self-start rounded-xl bg-utama px-4 py-2 text-sm font-medium text-utama-teks"
      >
        + Tambah tool{namaAgent ? ` untuk ${namaAgent}` : ""}
      </button>
    );
  }

  const belumLengkap = menulis
    ? kunci.length === 0 || (isian.length === 0 && !tetapKolom)
    : kolom.length === 0;

  return (
    <form onSubmit={kirim} className="rounded-2xl border border-garis bg-permukaan p-4">
      <h3 className="text-sm font-semibold tracking-tight">
        Tool baru{namaAgent ? ` untuk ${namaAgent}` : ""}
      </h3>

      {galat && (
        <p role="alert" className="mt-3 rounded-xl bg-bahaya-lemah p-2.5 text-xs text-bahaya">
          {galat}
        </p>
      )}

      {/* ⚠️ PILIHAN PERTAMA, karena ia menentukan sisa borangnya. */}
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Operasi</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {LABEL_OPERASI.map((o) => {
            const mati = o.nilai !== "baca" && target.length === 0;
            const aktif = operasi === o.nilai;
            return (
              <label
                key={o.nilai}
                className={
                  mati
                    ? "flex cursor-not-allowed flex-col gap-0.5 rounded-xl border border-garis px-3 py-2 text-xs opacity-40"
                    : aktif
                      ? "flex cursor-pointer flex-col gap-0.5 rounded-xl bg-aksen px-3 py-2 text-xs text-aksen-teks"
                      : "flex cursor-pointer flex-col gap-0.5 rounded-xl border border-garis px-3 py-2 text-xs"
                }
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <input
                    type="radio"
                    name="operasi"
                    disabled={mati}
                    checked={aktif}
                    onChange={() => setOperasi(o.nilai)}
                    className="size-3.5"
                  />
                  {o.judul}
                </span>
                <span className={aktif ? "" : "text-tinta-lemah"}>{o.ket}</span>
              </label>
            );
          })}
        </div>
        {/* ⚠️ "Tambah" DIBUKA 21 Okt 2026. Sebelumnya sengaja tidak ada karena
            baris baru sering perlu nilai yang dibangkitkan — nomor tiket —
            dan borang tidak boleh menyatakan aturannya. Yang berubah: aturan
            itu sekarang tinggal di kode (`lib/entri/pembangkit.ts`), dan
            borang cuma MEMILIH dari daftar yang ada di sana. */}
        {operasi === "tambah" && (
          <p className="mt-2 text-xs leading-relaxed text-tinta-lemah">
            Baris yang dibuat selalu <strong className="text-tinta">atas nama pengguna yang
            bertanya</strong>. Kolom pemiliknya tidak muncul di bawah karena bukan isian &mdash;
            sistem yang mengisinya dari sesi, dan tidak ada setelan yang bisa mengubahnya.
          </p>
        )}
      </fieldset>

      {menulis && (
        <p className="mt-3 border-l-2 border-garis pl-3 text-xs leading-relaxed text-tinta-lemah">
          Tool tulis <strong className="text-tinta">tidak menulis sendiri</strong>: ia menyusun
          rancangan, dan tombol konfirmasi yang ditekan pengguna yang menyimpan. Empat hal dijaga
          sistem, bukan oleh isian Anda &mdash; tabel sasaran hanya dari daftar yang diizinkan,
          kolom hanya yang boleh ditulis database, penyaring &ldquo;hanya milik penanya&rdquo;
          selalu ikut, dan kunci wajib ada.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Kode</span>
          <input
            name="kode"
            required
            pattern="[a-z][a-z0-9_]{2,59}"
            placeholder={menulis ? "tutup_tiket" : "aset_departemen"}
            className="rounded-xl border border-garis bg-kertas px-3 py-2 font-mono text-sm"
          />
          <span className="text-xs text-tinta-lemah">
            Huruf kecil, angka, garis bawah. Tidak bisa diubah setelah dibuat.
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Nama</span>
          <input
            name="nama"
            required
            className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
          />
          <span className="text-xs text-tinta-lemah">Yang ditampilkan ke administrator.</span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Deskripsi untuk model</span>
          <textarea
            name="deskripsi"
            required
            minLength={15}
            rows={2}
            className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
          />
          <span className="text-xs text-tinta-lemah">
            Ini satu-satunya dasar model memutuskan kapan memakai tool ini. Deskripsi yang kabur
            membuat tool dipanggil di saat yang salah &mdash; atau tidak dipanggil sama sekali.
          </span>
        </label>

        {/* ---------------- BACA ---------------- */}
        {!menulis && (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Sumber data</span>
              <select
                value={kodeSumber}
                onChange={(e) => gantiSumber(e.target.value)}
                className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
              >
                {sumber.map((s) => (
                  <option key={s.kode} value={s.kode}>
                    {s.nama} &rarr; {s.view}
                  </option>
                ))}
              </select>
              <span className="text-xs text-tinta-lemah">
                {namaAgent
                  ? `Tool ini akan langsung dipakai ${namaAgent}, apa pun aplikasi sumbernya.`
                  : "Agent yang memakainya ikut aplikasi sumber ini."}
              </span>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Batas baris</span>
              <input
                name="batas"
                type="number"
                min={1}
                max={200}
                defaultValue={20}
                className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
              />
              <span className="text-xs text-tinta-lemah">
                Model hanya melihat sebanyak ini. Jumlah sebenarnya tetap disebutkan terpisah.
              </span>
            </label>

            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">Kolom yang boleh dibaca</legend>
              <p className="mb-2 text-xs text-tinta-lemah">
                Yang tidak dicentang tidak pernah sampai ke model.
              </p>
              <Centang
                daftar={(dipilih?.kolom ?? []).map((k) => ({ nama: k.nama, label: k.label }))}
                dipilih={kolom}
                ubah={setKolom}
              />
            </fieldset>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Urutkan menurut</span>
              <select name="urut" className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm">
                <option value="">(tanpa urutan)</option>
                {/* Hanya kolom yang dicentang: mengurutkan menurut kolom yang
                    tidak dibaca membuat query gagal waktu dipanggil. */}
                {kolom.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Cakupan &mdash; siapa yang barisnya terlihat</span>
              <select
                value={cakupan || (dipilih?.cakupanBisa[0] ?? "")}
                onChange={(e) => setCakupan(e.target.value)}
                className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
              >
                {dipilih?.cakupanBisa.map((c) => (
                  <option key={c} value={c}>
                    {LABEL[c] ?? c}
                  </option>
                ))}
              </select>
              <span className="text-xs text-tinta-lemah">
                {dipilih && dipilih.cakupanBisa.length === 1
                  ? "Sumber ini tidak punya kolom penyaring orang, jadi hanya bisa seluruh perusahaan."
                  : "Yang tidak tersedia tidak ditampilkan: sumbernya tidak punya kolom penyaringnya."}
              </span>
              {(cakupan || dipilih?.cakupanBisa[0]) === "semua" && !izinDipilih && (
                <span className="border-l-2 border-bahaya pl-3 text-xs leading-relaxed text-tinta-lemah">
                  <strong className="text-tinta">Tool ini akan terbuka untuk semua orang</strong>{" "}
                  yang bisa membuka aplikasi sumbernya. Aman untuk data umum seperti SOP; untuk data
                  pribadi, isi <strong className="text-tinta">Syarat izin</strong> di bawah.
                </span>
              )}
            </label>
          </>
        )}

        {/* ---------------- TULIS ---------------- */}
        {menulis && t && (
          <>
            <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="font-medium">Sumber data &mdash; penentu tabel sasaran</span>
              <select
                value={sumberTulis}
                onChange={(e) => gantiSumberTulis(e.target.value)}
                className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
              >
                {target.map((x) => (
                  <option key={x.sumber} value={x.sumber}>
                    {x.namaSumber} &rarr; {x.tabel}
                  </option>
                ))}
              </select>
              <span className="text-xs text-tinta-lemah">
                Hanya tabel yang penjalannya izinkan yang muncul di sini.
              </span>
            </label>

            {/* Kunci TIDAK ADA untuk `tambah`: barisnya belum lahir, jadi
                tidak ada yang bisa ditunjuk. */}
            {operasi !== "tambah" && (
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Kolom kunci &mdash; penunjuk barisnya</legend>
                <p className="mb-2 text-xs text-tinta-lemah">
                  Wajib minimal satu. Tanpa kunci, perintahnya menyentuh seluruh tabel.
                </p>
                <Centang daftar={t.kolom} dipilih={kunci} ubah={setKunci} />
              </fieldset>
            )}

            {(operasi === "ubah" || operasi === "tambah") && (
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">
                  {operasi === "tambah" ? "Kolom yang diisi pengguna" : "Kolom yang boleh diubah pengguna"}
                </legend>
                <p className="mb-2 text-xs text-tinta-lemah">
                  Hanya kolom yang role database memang boleh tulis yang muncul
                  {operasi === "tambah"
                    ? " — hak ISI, yang daftarnya berbeda dari hak ubah."
                    : "."}
                </p>
                <Centang daftar={bisaTulis} dipilih={isian} ubah={setIsian} />
              </fieldset>
            )}

            {/* ⚠️ Pembangkit DIPILIH, tidak diketik. Daftarnya dari
                `lib/entri/pembangkit.ts`; kalau tabel ini tidak punya
                pembangkit, pilihannya memang tidak muncul. */}
            {operasi === "tambah" && t.pembangkit.length > 0 && (
              <>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Kolom yang dibuat otomatis</span>
                  <select
                    value={bangkitKolom}
                    onChange={(e) => setBangkitKolom(e.target.value)}
                    className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
                  >
                    <option value="">&mdash; tidak ada &mdash;</option>
                    {t.kolom.filter((k) => k.bisaIsi).map((k) => (
                      <option key={k.nama} value={k.nama}>{k.nama}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Cara membuatnya</span>
                  <select
                    value={bangkitNama}
                    onChange={(e) => setBangkitNama(e.target.value)}
                    className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
                  >
                    <option value="">&mdash; pilih &mdash;</option>
                    {t.pembangkit.map((p) => (
                      <option key={p.kode} value={p.kode}>{p.nama}</option>
                    ))}
                  </select>
                  <span className="text-xs text-tinta-lemah">
                    Nilainya baru dibuat saat pengguna menekan Simpan, bukan saat rancangan
                    ditampilkan &mdash; supaya dua orang yang membuka kartu bersamaan tidak
                    mendapat nilai yang sama.
                  </span>
                </label>
              </>
            )}

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Nilai tetap &mdash; kolom</span>
              <select
                value={tetapKolom}
                onChange={(e) => setTetapKolom(e.target.value)}
                className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
              >
                <option value="">(tidak ada)</option>
                {bisaTulis.map((k) => (
                  <option key={k.nama} value={k.nama}>
                    {k.nama}
                  </option>
                ))}
              </select>
              <span className="text-xs text-tinta-lemah">
                Nilainya dari setelan ini, bukan dari AI &mdash; jadi AI tidak bisa memilihnya.
              </span>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Nilai tetap &mdash; isinya</span>
              <input
                value={tetapNilai}
                onChange={(e) => setTetapNilai(e.target.value)}
                placeholder="CANCELLED"
                className="rounded-xl border border-garis bg-kertas px-3 py-2 font-mono text-sm"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Syarat &mdash; kolom</span>
              <select
                value={syaratKolom}
                onChange={(e) => setSyaratKolom(e.target.value)}
                className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
              >
                <option value="">(tanpa syarat)</option>
                {t.kolom.map((k) => (
                  <option key={k.nama} value={k.nama}>
                    {k.nama}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Syarat &mdash; nilai yang diizinkan</span>
              <input
                value={syaratNilai}
                onChange={(e) => setSyaratNilai(e.target.value)}
                placeholder="OPEN"
                className="rounded-xl border border-garis bg-kertas px-3 py-2 font-mono text-sm"
              />
              <span className="text-xs text-tinta-lemah">
                Pisahkan dengan koma kalau lebih dari satu. Baris di luar ini ditolak.
              </span>
            </label>
          </>
        )}

        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Syarat izin &mdash; siapa yang DAPAT tool ini</span>
          <PilihIzin nilai={izinDipilih} ubah={setIzinDipilih} izin={izin} />
          <span className="text-xs text-tinta-lemah">
            Yang tidak punya izin ini tidak mendapat tool-nya sama sekali. Angka di sebelah kode =
            berapa peran yang memilikinya.
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Contoh pertanyaan</span>
          <input
            name="contoh"
            placeholder={menulis ? "Tolong batalkan tiket T2026..." : "Aset apa saja yang dipegang departemen saya?"}
            className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={sibuk || belumLengkap}
          className="rounded-xl bg-utama px-4 py-2 text-sm font-medium text-utama-teks disabled:opacity-40"
        >
          {sibuk ? "Menyimpan…" : "Simpan tool"}
        </button>
        <button
          type="button"
          onClick={() => setBuka(false)}
          className="rounded-xl border border-garis px-4 py-2 text-sm"
        >
          Batal
        </button>
        {belumLengkap && (
          <span className="self-center text-xs text-tinta-lemah">
            {menulis
              ? "Pilih minimal satu kolom kunci, dan satu kolom isian atau nilai tetap."
              : "Centang minimal satu kolom."}
          </span>
        )}
      </div>
    </form>
  );
}
