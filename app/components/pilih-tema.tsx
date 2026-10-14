"use client";

import { useEffect, useState } from "react";

type Tema = "terang" | "gelap" | "sistem";

const PILIHAN: { nilai: Tema; label: string; judul: string }[] = [
  { nilai: "terang", label: "Terang", judul: "Selalu mode terang" },
  { nilai: "gelap", label: "Gelap", judul: "Selalu mode gelap" },
  { nilai: "sistem", label: "Sistem", judul: "Ikut setelan Windows" },
];

/** Pasang/lepas atribut di <html>. "sistem" = lepas, biar @media yang menentukan. */
function terapkan(t: Tema) {
  const html = document.documentElement;
  if (t === "sistem") html.removeAttribute("data-tema");
  else html.setAttribute("data-tema", t);
}

export function PilihTema() {
  // Bawaannya "sistem" supaya render pertama di server & klien sama.
  // Nilai sebenarnya dibaca setelah komponen terpasang.
  const [tema, setTema] = useState<Tema>("sistem");

  useEffect(() => {
    try {
      const t = localStorage.getItem("tema");
      if (t === "terang" || t === "gelap") setTema(t);
    } catch {
      // localStorage bisa diblokir (mode penyamaran, setelan privasi).
      // Bukan alasan untuk merusak halaman -- cukup pakai setelan sistem.
    }
  }, []);

  function pilih(t: Tema) {
    setTema(t);
    terapkan(t);
    try {
      if (t === "sistem") localStorage.removeItem("tema");
      else localStorage.setItem("tema", t);
    } catch {
      // Tema tetap berlaku untuk sesi ini walau tidak bisa disimpan.
    }
  }

  return (
    <div
      role="group"
      aria-label="Mode tampilan"
      className="flex shrink-0 items-center gap-0.5 rounded-xl bg-permukaan/70 p-0.5 ring-1 ring-garis/60"
    >
      {PILIHAN.map((p) => {
        const aktif = tema === p.nilai;
        return (
          <button
            key={p.nilai}
            onClick={() => pilih(p.nilai)}
            title={p.judul}
            aria-pressed={aktif}
            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
              aktif
                ? "bg-kertas text-tinta shadow-kecil"
                : "text-tinta-lemah hover:text-tinta"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
