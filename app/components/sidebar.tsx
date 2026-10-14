"use client";

import { useState } from "react";

export type RingkasPercakapan = {
  id: number;
  judul: string;
  diperbarui: string;
  /** Percakapan dari WhatsApp ikut muncul di daftar ini. Tanpa penanda, user
   *  melihat percakapan yang tidak pernah dia buka di browser dan bisa
   *  mengira itu kebocoran -- padahal itu chat WhatsApp-nya sendiri. */
  asal?: "web" | "wa";
};

/** "hari ini", "kemarin", atau tanggal singkat. */
function kapan(iso: string): string {
  const t = new Date(iso);
  const kini = new Date();
  const hariIni = new Date(kini.getFullYear(), kini.getMonth(), kini.getDate());
  const hariItu = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const beda = Math.round((hariIni.getTime() - hariItu.getTime()) / 86_400_000);

  if (beda === 0) return t.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (beda === 1) return "kemarin";
  if (beda < 7) return `${beda} hari lalu`;
  return t.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function Sidebar({
  daftar,
  aktif,
  onBaru,
  onBuka,
  onHapus,
}: {
  daftar: RingkasPercakapan[];
  aktif: number | null;
  onBaru: () => void;
  onBuka: (id: number) => void;
  onHapus: (id: number) => void;
}) {
  // Di layar kecil sidebar menutupi chat, jadi bawaannya tertutup.
  const [buka, setBuka] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState<number | null>(null);

  const isi = (
    <div className="flex h-full w-72 flex-col bg-permukaan/50">
      <div className="p-3">
        <button
          onClick={() => {
            onBaru();
            setBuka(false);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-utama px-3 py-2.5 text-sm font-medium text-utama-teks shadow-kecil transition-all hover:shadow-sedang hover:brightness-110 active:scale-[0.98]"
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden>
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Percakapan baru
        </button>
      </div>

      {daftar.length > 0 && (
        <p className="px-5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-tinta-lemah/80">
          Riwayat
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {daftar.length === 0 && (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-tinta-lemah">
            Belum ada percakapan.
            <br />
            Pertanyaan pertama kamu akan tersimpan di sini.
          </p>
        )}

        {daftar.map((p) => {
          const terpilih = p.id === aktif;
          return (
            <div
              key={p.id}
              className={`group relative mb-0.5 flex items-center gap-1 rounded-xl px-3 py-2 text-sm transition-colors ${
                terpilih ? "bg-kertas shadow-kecil" : "hover:bg-kertas/60"
              }`}
            >
              {/* Penanda kiri untuk item terpilih -- lebih halus daripada
                  mewarnai seluruh baris dengan hijau aksen. */}
              {terpilih && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-aksen" />
              )}

              <button
                onClick={() => {
                  onBuka(p.id);
                  setBuka(false);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className={`block truncate leading-snug ${terpilih ? "font-medium" : ""}`}>
                  {p.judul}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-tinta-lemah">
                  {p.asal === "wa" && (
                    <span
                      className="rounded bg-aksen px-1 py-px text-[10px] font-medium text-aksen-teks"
                      title="Percakapan ini dimulai dari WhatsApp"
                    >
                      WA
                    </span>
                  )}
                  {kapan(p.diperbarui)}
                </span>
              </button>

              {konfirmasi === p.id ? (
                <span className="flex shrink-0 gap-0.5">
                  <button
                    onClick={() => {
                      onHapus(p.id);
                      setKonfirmasi(null);
                    }}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-bahaya transition-colors hover:bg-bahaya-lemah"
                  >
                    hapus
                  </button>
                  <button
                    onClick={() => setKonfirmasi(null)}
                    className="rounded-lg px-2 py-1 text-[11px] text-tinta-lemah transition-colors hover:bg-permukaan"
                  >
                    batal
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setKonfirmasi(p.id)}
                  aria-label={`Hapus percakapan ${p.judul}`}
                  title="Hapus"
                  // Di layar sentuh tidak ada hover, jadi tombolnya selalu terlihat
                  // di layar kecil dan baru disembunyikan mulai ukuran sm.
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-tinta-lemah transition-all hover:bg-bahaya-lemah hover:text-bahaya sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="size-3.5" aria-hidden>
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Layar besar: sidebar menetap */}
      <aside className="hidden md:block">{isi}</aside>

      {/* Layar kecil: tombol mengambang + panel geser */}
      <button
        onClick={() => setBuka(true)}
        aria-label="Buka riwayat percakapan"
        className="fixed bottom-28 left-4 z-20 flex size-11 items-center justify-center rounded-2xl bg-permukaan text-tinta shadow-sedang ring-1 ring-garis/70 backdrop-blur transition-transform active:scale-95 md:hidden"
      >
        <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden>
          <path d="M3 5h14M3 10h14M3 15h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {buka && (
        <div className="fixed inset-0 z-30 flex md:hidden">
          <div className="h-full bg-kertas shadow-besar">{isi}</div>
          <button
            onClick={() => setBuka(false)}
            aria-label="Tutup riwayat"
            className="flex-1 bg-tinta/40 backdrop-blur-[2px]"
          />
        </div>
      )}
    </>
  );
}
