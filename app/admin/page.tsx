"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Pengajuan = {
  id: number;
  username: string;
  nama: string;
  nomor_wa: string | null;
  departemen_diminta: string;
  alasan: string | null;
  dibuat: string;
  bentrok: boolean;
};

type Departemen = { id: string; label: string };

const PERAN = ["staf", "kepala"];

/**
 * Halaman tinjau pengajuan akun.
 *
 * ⚠️ Departemen & peran DIPILIH ADMIN di sini, bukan diambil dari pengajuan.
 * Yang diminta pendaftar cuma usulan — peran menentukan user MySQL yang
 * dipakai agent, dan itu yang memisahkan siapa boleh melihat gaji.
 *
 * Penjaganya ada di `proxy.ts` (dari token) DAN di route API (ke database).
 * Halaman ini tidak menjaga apa pun sendiri — yang di klien selalu bisa
 * dilewati.
 */
export default function Admin() {
  const [daftar, setDaftar] = useState<Pengajuan[]>([]);
  const [departemen, setDepartemen] = useState<Departemen[]>([]);
  const [pilihan, setPilihan] = useState<Record<number, { dep: string; peran: string }>>({});
  /** null = admin (semua departemen). String = kepala, departemennya saja. */
  const [cakupan, setCakupan] = useState<string | null>(null);
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState<number | null>(null);
  const [memuat, setMemuat] = useState(true);

  // Tidak ada setState SEBELUM `await` di sini: dipanggil dari useEffect, dan
  // setState yang jalan serentak di dalam efek memicu render berantai.
  // Pembersihan pesan galat dilakukan di `putuskan()`, satu-satunya pemanggil
  // lain.
  const muat = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/pendaftaran");
      if (!r.ok) {
        setGalat(r.status === 404 ? "Kamu tidak punya akses ke halaman ini." : "Gagal memuat.");
        return;
      }
      const d = await r.json();
      setDaftar(d.pengajuan ?? []);
      setCakupan(d.cakupan ?? null);
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    // Ditunda satu microtask, bukan dipanggil langsung: apa pun yang
    // memanggil setState serentak di dalam efek memicu render berantai, dan
    // aturan lint menolaknya. Fetch di bawah lolos karena memang sudah async.
    void Promise.resolve().then(muat);
    fetch("/api/daftar")
      .then((r) => r.json())
      .then((d: { departemen?: Departemen[] }) => setDepartemen(d.departemen ?? []))
      .catch(() => {});
  }, [muat]);

  async function putuskan(p: Pengajuan, aksi: "setujui" | "tolak") {
    if (sibuk) return;
    const pil = pilihan[p.id] ?? { dep: p.departemen_diminta, peran: "staf" };
    const dep = cakupan ?? pil.dep;

    let catatan = "";
    if (aksi === "tolak") {
      catatan = window.prompt(`Alasan menolak "${p.username}"?`) ?? "";
      if (!catatan.trim()) return;
    }

    setSibuk(p.id);
    setGalat("");
    try {
      const r = await fetch("/api/admin/pendaftaran", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, aksi, departemen: dep, peran: pil.peran, catatan }),
      });
      const d = await r.json();
      if (!r.ok) {
        setGalat(d.error ?? "Gagal memproses.");
        return;
      }
      await muat();
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(null);
    }
  }

  const kelas =
    "rounded-lg bg-kertas/80 px-2.5 py-1.5 text-xs outline-none ring-1 ring-garis/70 focus:ring-2 focus:ring-utama/50";

  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-kertas px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pengajuan akun</h1>
          <p className="mt-1 text-sm text-tinta-lemah">
            {cakupan
              ? `Kamu menentukan perannya. Terbatas ke departemen ${cakupan}.`
              : "Kamu yang menentukan departemen & perannya, bukan pendaftar."}
          </p>
        </div>
        <nav className="flex shrink-0 items-center gap-4 text-sm text-tinta-lemah">
          {/* Cuma admin penuh yang bisa membukanya; kepala dapat pesan jelas
              di sana, bukan halaman kosong. */}
          <Link href="/dbadmin" className="underline-offset-2 hover:underline">
            Sumber data
          </Link>
          <Link href="/" className="underline-offset-2 hover:underline">
            Kembali
          </Link>
        </nav>
      </header>

      {galat && (
        <p className="mb-4 rounded-xl bg-bahaya-lemah px-3.5 py-2.5 text-sm text-bahaya ring-1 ring-bahaya/20">
          {galat}
        </p>
      )}

      {memuat ? (
        <p className="text-sm text-tinta-lemah">Memuat...</p>
      ) : daftar.length === 0 ? (
        <p className="rounded-2xl bg-permukaan/50 px-4 py-8 text-center text-sm text-tinta-lemah ring-1 ring-garis/60">
          {cakupan
            ? `Tidak ada pengajuan ${cakupan} yang menunggu.`
            : "Tidak ada pengajuan yang menunggu."}
        </p>
      ) : (
        <ul className="space-y-3">
          {daftar.map((p) => {
            const pil = pilihan[p.id] ?? { dep: p.departemen_diminta, peran: "staf" };
            return (
              <li
                key={p.id}
                className="rounded-2xl bg-permukaan/50 p-4 shadow-kecil ring-1 ring-garis/60"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{p.nama}</span>
                  <span className="text-sm text-tinta-lemah">@{p.username}</span>
                  {p.bentrok && (
                    <span className="rounded bg-bahaya-lemah px-1.5 py-px text-[11px] font-medium text-bahaya">
                      username sudah dipakai
                    </span>
                  )}
                </div>

                <p className="mt-1 text-xs text-tinta-lemah">
                  minta <span className="font-medium">{p.departemen_diminta}</span>
                  {p.nomor_wa && ` · WA ${p.nomor_wa}`}
                  {` · ${new Date(p.dibuat).toLocaleString("id-ID")}`}
                </p>
                {p.alasan && <p className="mt-1.5 text-sm">{p.alasan}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/* Kepala tidak memilih departemen -- cuma satu yang boleh.
                      Ini semata tampilan; penolakan sebenarnya ada di server,
                      karena curl tidak peduli dropdown. */}
                  {cakupan ? (
                    <span className="rounded-lg bg-aksen px-2.5 py-1.5 text-xs font-medium text-aksen-teks">
                      {departemen.find((d) => d.id === cakupan)?.label ?? cakupan}
                    </span>
                  ) : (
                    <select
                      value={pil.dep}
                      onChange={(e) =>
                        setPilihan({ ...pilihan, [p.id]: { ...pil, dep: e.target.value } })
                      }
                      className={kelas}
                    >
                      {departemen.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    value={pil.peran}
                    onChange={(e) =>
                      setPilihan({ ...pilihan, [p.id]: { ...pil, peran: e.target.value } })
                    }
                    className={kelas}
                  >
                    {PERAN.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => putuskan(p, "setujui")}
                    disabled={sibuk === p.id || p.bentrok}
                    title={p.bentrok ? "Username sudah dipakai — tolak dulu" : undefined}
                    className="rounded-lg bg-utama px-3 py-1.5 text-xs font-medium text-utama-teks shadow-kecil transition-all hover:brightness-110 active:scale-95 disabled:opacity-30"
                  >
                    {sibuk === p.id ? "..." : "Setujui"}
                  </button>

                  <button
                    onClick={() => putuskan(p, "tolak")}
                    disabled={sibuk === p.id}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-bahaya ring-1 ring-bahaya/30 transition-colors hover:bg-bahaya-lemah disabled:opacity-30"
                  >
                    Tolak
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
