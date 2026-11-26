"use client";

import type { AgentTampil } from "@/lib/daftar-agent";
import { useEffect, useState } from "react";

/**
 * Rail agent per aplikasi di tepi kiri.
 *
 * Mengikuti rail aplikasi di portal perusahaan: kolom sempit berisi kotak
 * ikon, satu per aplikasi. Bedanya di sini satu kotak = satu agent.
 *
 * ⚠️ TIDAK ADA `href` KE MANA PUN, dan itu disengaja.
 *
 * Agent dipilih AGENT UMUM dari isi pertanyaan, bukan oleh pemakai lewat
 * tombol — itu inti rancangannya. Kotak-kotak ini memberi tahu agent apa saja
 * yang ada dan mana yang terbuka; membuatnya bisa diklik akan menjanjikan
 * perpindahan yang belum ada. Judul (`title`) memuat keterangannya supaya
 * tetap bisa dibaca tanpa mengarang tautan.
 */

/**
 * Warna kotak per agent.
 *
 * ⚠️ DIPETAKAN DARI KODE AGENT, BUKAN DARI URUTAN. Daftar ini diurutkan ulang
 * (yang terbuka naik ke atas), jadi warna berdasarkan posisi akan berpindah
 * tiap kali akses seseorang berubah — dan orang yang sudah hafal "yang biru
 * itu Super Tools" jadi salah terus.
 *
 * Agent baru yang belum terdaftar di sini jatuh ke `--utama`, bukan ke warna
 * acak: lebih baik dua agent berbagi warna daripada warnanya berganti sendiri
 * setiap daftar berubah.
 */
const WARNA: Record<string, string> = {
  "agent-portal": "var(--agent-portal)",
  "agent-hr": "var(--agent-hr)",
  "agent-supertools": "var(--agent-supertools)",
  "agent-admin": "var(--agent-admin)",
  "agent-maps": "var(--agent-maps)",
  "agent-marketing": "var(--agent-marketing)",
  "agent-cmod": "var(--agent-cmod)",
  "agent-report": "var(--agent-report)",
};

/** Ikon aplikasi yang tetap mengikuti kode agent walau urutan rail berubah. */
function IkonAgent({ kode }: { kode: string }) {
  const umum = "currentColor";
  const properti = {
    viewBox: "0 0 24 24",
    fill: "none",
    className: "size-5",
    "aria-hidden": true,
  } as const;

  switch (kode) {
    case "agent-portal":
      return (
        <svg {...properti}>
          <rect x="4" y="4" width="6" height="6" rx="1.5" stroke={umum} strokeWidth="1.8" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" stroke={umum} strokeWidth="1.8" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" stroke={umum} strokeWidth="1.8" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" stroke={umum} strokeWidth="1.8" />
        </svg>
      );
    case "agent-hr":
      return (
        <svg {...properti}>
          <circle cx="9" cy="8" r="3" stroke={umum} strokeWidth="1.8" />
          <path d="M3.8 19c.5-3.4 2.2-5 5.2-5s4.7 1.6 5.2 5M15 6.2a3 3 0 0 1 0 5.6M16 14c2.4.3 3.7 1.9 4.1 5" stroke={umum} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "agent-supertools":
      return (
        <svg {...properti}>
          <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5v8A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-8Z" stroke={umum} strokeWidth="1.8" />
          <path d="M4 12h16M10 12v2h4v-2" stroke={umum} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "agent-admin":
      return (
        <svg {...properti}>
          <path d="M12 3.5 19 6v5.4c0 4.3-2.8 7.4-7 9.1-4.2-1.7-7-4.8-7-9.1V6l7-2.5Z" stroke={umum} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m8.8 12 2.1 2.1 4.4-4.5" stroke={umum} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "agent-maps":
      return (
        <svg {...properti}>
          <path d="M19 10c0 5-7 10.5-7 10.5S5 15 5 10a7 7 0 1 1 14 0Z" stroke={umum} strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="12" cy="10" r="2.3" stroke={umum} strokeWidth="1.8" />
        </svg>
      );
    case "agent-marketing":
      return (
        <svg {...properti}>
          <path d="M5 19V13M12 19V9M19 19V5M3.5 19.5h17" stroke={umum} strokeWidth="1.8" strokeLinecap="round" />
          <path d="m5 9 5-4 4 2 5-4" stroke={umum} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "agent-cmod":
      return (
        <svg {...properti}>
          <path d="M5.5 5h13A2.5 2.5 0 0 1 21 7.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-5 3v-3h-.5A2.5 2.5 0 0 1 3 15.5v-8A2.5 2.5 0 0 1 5.5 5Z" stroke={umum} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M7 9h10M7 13h6" stroke={umum} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "agent-report":
      return (
        <svg {...properti}>
          <path d="M7 3.5h7l4 4V20H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" stroke={umum} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M14 3.5V8h4M9 16v-3M12 16v-5M15 16v-2" stroke={umum} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...properti}>
          <path d="M12 3v3M5 12H2M22 12h-3M6.3 6.3 4.2 4.2M19.8 4.2l-2.1 2.1M7 18h10M9 21h6" stroke={umum} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M7 12a5 5 0 1 1 10 0c0 2-1 3-2.2 4H9.2C8 15 7 14 7 12Z" stroke={umum} strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function RailAgent({ agent, terbuka }: { agent: AgentTampil[]; terbuka: number }) {
  const [sedangMenjawab, setSedangMenjawab] = useState<string[]>([]);
  const [detailKode, setDetailKode] = useState<string | null>(null);

  useEffect(() => {
    function perbarui(event: Event) {
      const detail = (event as CustomEvent<{ nama?: unknown }>).detail;
      const berikut = Array.isArray(detail?.nama)
        ? detail.nama.filter((x): x is string => typeof x === "string")
        : [];
      setSedangMenjawab((sekarang) =>
        sekarang.length === berikut.length && sekarang.every((x, i) => x === berikut[i])
          ? sekarang
          : berikut,
      );
    }
    window.addEventListener("agent-proses", perbarui);
    return () => window.removeEventListener("agent-proses", perbarui);
  }, []);

  useEffect(() => {
    if (!detailKode) return;
    function tutupDenganEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDetailKode(null);
    }
    window.addEventListener("keydown", tutupDenganEscape);
    return () => window.removeEventListener("keydown", tutupDenganEscape);
  }, [detailKode]);

  if (agent.length === 0) return null;

  return (
    <aside
      className="relative hidden shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-garis bg-permukaan py-3 shadow-kecil md:flex"
      style={{ width: "4.75rem" }}
      aria-label={`Agen AI per aplikasi — ${terbuka} dari ${agent.length} tersedia`}
    >
      <span className="px-1 text-center text-[10px] font-semibold uppercase tracking-wider text-tinta-lemah">
        Agen AI
      </span>
      <span className="px-1 text-center text-[10px] leading-tight text-tinta-lemah">
        <strong className="block text-xs text-tinta">{terbuka} tersedia</strong>
        dari {agent.length}
      </span>

      <span className="my-1 h-px w-7 bg-garis" />

      {agent.map((a) => {
        const aktif = sedangMenjawab.some(
          (nama) => nama === a.nama || nama === a.kode,
        );
        const namaPendek = a.nama.replace(/^Ratu\s+AI\s*/i, "").trim() || a.nama;
        const ket = a.terbuka
          ? `${a.nama} — ${a.jumlahTool} kemampuan. ${a.deskripsi ?? ""}`.trim()
          : `${a.nama} — perlu akses aplikasinya. ${a.deskripsi ?? ""}`.trim();
        return (
          <button
            type="button"
            key={a.kode}
            title={ket}
            aria-label={`Lihat detail ${a.nama}`}
            aria-expanded={detailKode === a.kode}
            aria-controls={`detail-${a.kode}`}
            onClick={() => setDetailKode((kode) => kode === a.kode ? null : a.kode)}
            className={
              a.terbuka
                ? `relative flex size-10 items-center justify-center rounded-xl text-[11px] font-bold transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-utama ${aktif ? "agent-sedang-menjawab z-20" : ""} ${detailKode === a.kode ? "ring-2 ring-aksen ring-offset-2 ring-offset-permukaan" : ""}`
                : `relative flex size-10 items-center justify-center rounded-xl border border-dashed border-garis text-[11px] font-bold text-tinta-lemah transition-colors hover:bg-kertas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-utama ${detailKode === a.kode ? "bg-kertas ring-2 ring-aksen ring-offset-2 ring-offset-permukaan" : ""}`
            }
            style={
              a.terbuka
                ? { background: WARNA[a.kode] ?? "var(--utama)", color: "var(--agent-teks)" }
                : undefined
            }
          >
            <IkonAgent kode={a.kode} />
            <span className="sr-only">{ket}</span>

            {aktif && (
              <span className="label-agent-aktif" aria-hidden>
                <span className="size-1.5 animate-pulse rounded-full bg-aksen" />
                {namaPendek} sedang menjawab
              </span>
            )}

            {/* Agent yang terbuka tapi belum punya tool cuma bisa mengobrol.
                Ditandai supaya tidak terlihat sama dengan yang siap pakai. */}
            {a.terbuka && a.jumlahTool === 0 && (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-permukaan bg-bahaya"
              />
            )}

            {!a.terbuka && (
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden
                className="absolute -bottom-1 -right-1 size-4 rounded-full bg-permukaan p-0.5 text-tinta-lemah"
              >
                <path
                  d="M6 9V6.5a4 4 0 0 1 8 0V9M5.5 9h9A1.5 1.5 0 0 1 16 10.5v5A1.5 1.5 0 0 1 14.5 17h-9A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        );
      })}

      {detailKode && (() => {
        const dipilih = agent.find((a) => a.kode === detailKode);
        if (!dipilih) return null;
        const aktif = sedangMenjawab.some((nama) => nama === dipilih.nama || nama === dipilih.kode);
        return (
          <section
            id={`detail-${dipilih.kode}`}
            className="liquid-glass muncul absolute left-[calc(100%+0.75rem)] top-3 z-40 w-72 rounded-2xl p-4 text-left text-xs text-tinta"
            aria-label={`Detail ${dipilih.nama}`}
          >
            <div className="flex items-start gap-3">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                style={dipilih.terbuka
                  ? { background: WARNA[dipilih.kode] ?? "var(--utama)", color: "var(--agent-teks)" }
                  : undefined}
              >
                <IkonAgent kode={dipilih.kode} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{dipilih.nama}</p>
                <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${
                  aktif
                    ? "bg-aksen/45 text-tinta"
                    : dipilih.terbuka
                      ? "bg-permukaan/65 text-tinta-lemah ring-1 ring-garis/70"
                      : "bg-bahaya-lemah text-bahaya"
                }`}>
                  <span className={`size-1.5 rounded-full ${aktif ? "animate-pulse bg-utama" : dipilih.terbuka ? "bg-aksen" : "bg-bahaya"}`} aria-hidden />
                  {aktif ? "Sedang menjawab" : dipilih.terbuka ? "Tersedia" : "Akses diperlukan"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDetailKode(null)}
                aria-label="Tutup detail agen AI"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-tinta-lemah transition-colors hover:bg-permukaan/70 hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-utama"
              >
                <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
                  <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <p className="mt-3 leading-relaxed text-tinta-lemah">
              {dipilih.deskripsi || "Belum ada deskripsi kemampuan untuk agen AI ini."}
            </p>

            <div className="mt-3 border-t border-garis/70 pt-3">
              {dipilih.terbuka ? (
                <p><strong className="font-semibold text-tinta">{dipilih.jumlahTool}</strong> kemampuan siap digunakan</p>
              ) : (
                <p className="text-tinta-lemah">Hubungi administrator jika Anda memerlukan akses aplikasi ini.</p>
              )}
            </div>
          </section>
        );
      })()}
    </aside>
  );
}
