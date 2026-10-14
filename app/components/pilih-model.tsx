"use client";

import { useEffect, useRef, useState } from "react";
import {
  MODEL_TERSEDIA,
  URUTAN_PENYEDIA,
  NAMA_PENYEDIA,
  type PilihanModel,
} from "@/voltagent/models";

/**
 * Pemilih model.
 *
 * ⚠️ BUKAN `<select>` bawaan. Browser merender `<select>` dengan warna SISTEM
 * operasi — putih-biru di Windows — dan tidak bisa ditata. Di atas palet
 * cokelat hangat kita, hasilnya terlihat seperti tempelan dari aplikasi lain.
 * `<optgroup>` juga tidak bisa memuat keterangan per model.
 *
 * Konsekuensi memakai div: aksesibilitas harus ditulis sendiri — peran ARIA,
 * navigasi panah, Escape, dan klik di luar. Itu semua gratis di `<select>`.
 */

/** Urutan grup dipatok, bukan mengikuti urutan kemunculan di whitelist. */
// Urutan & nama grup datang dari `voltagent/models.ts` -- satu sumber
// dengan perintah /model di WhatsApp.
const URUTAN = URUTAN_PENYEDIA;

export function PilihModel({
  nilai,
  onPilih,
}: {
  nilai: string;
  onPilih: (id: string) => void;
}) {
  const [buka, setBuka] = useState(false);
  const [sorot, setSorot] = useState(0);
  const kotak = useRef<HTMLDivElement>(null);

  const terpilih = MODEL_TERSEDIA.find((m) => m.id === nilai) ?? MODEL_TERSEDIA[0];
  // Daftar rata untuk navigasi panah -- grup cuma pembatas visual.
  const rata = URUTAN.flatMap((g) => MODEL_TERSEDIA.filter((m) => m.penyedia === g));

  // Tutup kalau diklik di luar. Tanpa ini menu menggantung waktu user
  // mengetik di kolom pertanyaan.
  useEffect(() => {
    if (!buka) return;
    const klik = (e: MouseEvent) => {
      if (!kotak.current?.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener("mousedown", klik);
    return () => document.removeEventListener("mousedown", klik);
  }, [buka]);

  function pilih(m: PilihanModel) {
    onPilih(m.id);
    setBuka(false);
  }

  function tombol(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setBuka(false);
      return;
    }
    if (!buka && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setSorot(Math.max(0, rata.findIndex((m) => m.id === nilai)));
      setBuka(true);
      return;
    }
    if (!buka) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSorot((s) => (s + 1) % rata.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSorot((s) => (s - 1 + rata.length) % rata.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pilih(rata[sorot]);
    }
  }

  return (
    <div ref={kotak} className="relative">
      <button
        type="button"
        onClick={() => setBuka(!buka)}
        onKeyDown={tombol}
        aria-haspopup="listbox"
        aria-expanded={buka}
        aria-label={`Model: ${terpilih.label}`}
        className="flex items-center gap-1.5 rounded-full bg-kertas/70 px-2.5 py-1 text-[11px] font-medium outline-none ring-1 ring-garis/70 transition-colors hover:ring-utama/40 focus-visible:ring-2 focus-visible:ring-utama/50"
      >
        {terpilih.penyedia !== "anthropic" && (
          <span className="size-1.5 shrink-0 rounded-full bg-aksen" aria-hidden />
        )}
        <span className="truncate">{terpilih.label}</span>
        <svg
          viewBox="0 0 12 12"
          className={`size-2.5 shrink-0 transition-transform ${buka ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {buka && (
        <div
          role="listbox"
          aria-label="Pilih model"
          className="absolute bottom-full left-0 z-20 mb-1.5 w-72 overflow-hidden rounded-2xl bg-permukaan shadow-besar ring-1 ring-garis/60"
        >
          {URUTAN.map((grup) => {
            const isi = MODEL_TERSEDIA.filter((m) => m.penyedia === grup);
            if (isi.length === 0) return null;

            return (
              <div key={grup} className="border-b border-garis/40 last:border-0">
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-tinta-lemah/80">
                  {NAMA_PENYEDIA[grup] ?? grup}
                </p>

                {isi.map((m) => {
                  const ini = m.id === nilai;
                  const disorot = rata[sorot]?.id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={ini}
                      onClick={() => pilih(m)}
                      onMouseEnter={() => setSorot(rata.findIndex((x) => x.id === m.id))}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
                        disorot ? "bg-aksen/40" : ""
                      }`}
                    >
                      {/* Tanda centang menempati ruang tetap, jadi teksnya
                          tidak bergeser waktu pilihan berubah. */}
                      <span className="mt-0.5 w-3 shrink-0 text-[11px] text-utama">
                        {ini ? "✓" : ""}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-xs ${ini ? "font-semibold" : "font-medium"}`}>
                          {m.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-tinta-lemah">
                          {m.keterangan}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}

          <p className="bg-kertas/50 px-3 py-2 text-[10px] leading-snug text-tinta-lemah">
            Model lokal tidak memakai kuota sama sekali. Yang di server kantor
            tidak membebani komputer ini; yang &quot;komputer ini&quot; butuh
            Ollama menyala.
          </p>
        </div>
      )}
    </div>
  );
}
