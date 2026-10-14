"use client";

import { useCallback, useEffect, useState } from "react";

type Sumber = {
  kode: string;
  nama: string;
  jenis: "mysql" | "postgres";
  keterangan: string | null;
  tersedia: boolean;
  aktif: boolean;
  diubahOleh: string | null;
  diubah: string | null;
};

/**
 * Saklar sumber data agent.
 *
 * ⚠️ PILIH SATU, bukan nyala-bersama. Dua sumber aktif berarti dua dialek SQL
 * dalam satu prompt, dan model yang tidak yakin akan menebak.
 *
 * ⚠️ Halaman ini TIDAK menjaga apa pun. Yang menjaga `/api/admin/sumber`, yang
 * memeriksa ke database tiap permintaan dan menolak siapa pun selain admin
 * penuh — termasuk kepala departemen. Penjagaan di klien selalu bisa dilewati.
 */
export function SumberData() {
  const [daftar, setDaftar] = useState<Sumber[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [galat, setGalat] = useState("");
  /** null = belum tahu; false = bukan admin penuh, bagian ini disembunyikan. */
  const [boleh, setBoleh] = useState<boolean | null>(null);

  const muat = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/sumber");
      if (r.status === 404 || r.status === 401) {
        // Bukan admin penuh. Bukan galat — bagiannya memang tidak untuk dia.
        setBoleh(false);
        return;
      }
      if (!r.ok) {
        setBoleh(true);
        setGalat("Gagal memuat sumber data.");
        return;
      }
      const d = await r.json();
      setBoleh(true);
      setDaftar(d.sumber ?? []);
    } catch {
      setBoleh(true);
      setGalat("Tidak bisa menghubungi server.");
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    // Ditunda satu microtask, sama seperti di `page.tsx`: setState yang jalan
    // serentak di dalam efek memicu render berantai, dan aturan lint
    // menolaknya.
    void Promise.resolve().then(muat);
  }, [muat]);

  async function pilih(kode: string) {
    if (sibuk) return;
    setSibuk(kode);
    setGalat("");
    try {
      const r = await fetch("/api/admin/sumber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kode }),
      });
      const d = await r.json();
      if (!r.ok) {
        setGalat(d.error ?? "Gagal mengganti sumber.");
        return;
      }
      await muat();
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(null);
    }
  }

  // Dulu komponen ini menyembunyikan diri (return null) karena menumpang di
  // halaman pengajuan. Sekarang dia halaman sendiri -- diam berarti halaman
  // kosong tanpa penjelasan, dan itu terlihat seperti aplikasi rusak.
  if (boleh === false) {
    return (
      <p className="rounded-2xl bg-permukaan/50 px-4 py-8 text-center text-sm text-tinta-lemah ring-1 ring-garis/60">
        Hanya administrator yang bisa mengganti sumber data.
        <br />
        Kepala departemen boleh meninjau pengajuan akun, tapi tidak mengubah
        sumber data — karena itu berlaku untuk seluruh departemen.
      </p>
    );
  }

  const aktif = daftar.find((s) => s.aktif);

  return (
    <section>
      {galat && (
        <p className="mb-3 rounded-xl bg-bahaya-lemah px-3.5 py-2.5 text-sm text-bahaya ring-1 ring-bahaya/20">
          {galat}
        </p>
      )}

      {memuat ? (
        <p className="text-sm text-tinta-lemah">Memuat...</p>
      ) : (
        <ul className="space-y-2">
          {daftar.map((s) => {
            const terkunci = !s.tersedia;
            return (
              <li key={s.kode}>
                <button
                  onClick={() => !terkunci && !s.aktif && pilih(s.kode)}
                  disabled={terkunci || s.aktif || sibuk !== null}
                  aria-pressed={s.aktif}
                  className={`w-full rounded-2xl px-4 py-3 text-left transition-all ring-1 ${
                    s.aktif
                      ? "bg-aksen/25 ring-aksen/50"
                      : terkunci
                        ? "bg-permukaan/40 ring-garis/50 opacity-60"
                        : "bg-permukaan/60 ring-garis/60 hover:bg-permukaan hover:ring-garis active:scale-[0.99]"
                  } disabled:cursor-default`}
                >
                  <span className="flex items-start gap-3">
                    {/* Penanda bulat: terisi = aktif. Bentuknya mengikuti
                        radio, karena pilihannya memang satu dari sekian. */}
                    <span
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ${
                        s.aktif ? "bg-utama ring-utama" : "ring-garis/70"
                      }`}
                    >
                      {s.aktif && <span className="size-1.5 rounded-full bg-utama-teks" />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{s.nama}</span>
                        <span className="rounded-md bg-kertas px-1.5 py-0.5 font-mono text-[10px] uppercase text-tinta-lemah ring-1 ring-garis/60">
                          {s.jenis}
                        </span>
                        {terkunci && (
                          <span className="rounded-md bg-bahaya-lemah px-1.5 py-0.5 text-[10px] font-medium text-bahaya">
                            belum tersedia
                          </span>
                        )}
                        {sibuk === s.kode && (
                          <span className="text-xs text-tinta-lemah">mengganti...</span>
                        )}
                      </span>
                      {s.keterangan && (
                        <span className="mt-0.5 block text-xs text-tinta-lemah">{s.keterangan}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {aktif?.diubahOleh && (
        <p className="mt-2 text-xs text-tinta-lemah">
          Terakhir diubah oleh {aktif.diubahOleh}
          {aktif.diubah ? ` · ${new Date(aktif.diubah).toLocaleString("id-ID")}` : ""}
        </p>
      )}

      {daftar.some((s) => !s.tersedia) && (
        <p className="mt-2 text-xs text-tinta-lemah">
          Sumber bertanda <span className="text-bahaya">belum tersedia</span> tidak bisa dipilih
          karena tool dan kamus datanya belum ada — memilihnya akan membuat agent kehilangan
          seluruh kemampuan membaca data.
        </p>
      )}

    </section>
  );
}
