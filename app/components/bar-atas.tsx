"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PilihTema } from "./pilih-tema";

export function BarAtas({
  nama,
  departemen,
  peran,
  admin,
}: {
  nama: string;
  departemen: string;
  peran: string;
  admin: boolean;
}) {
  const router = useRouter();
  const [keluar, setKeluar] = useState(false);

  async function logout() {
    setKeluar(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  // Inisial dipakai sebagai avatar sederhana -- tidak perlu unggah foto.
  const inisial = nama
    .split(/\s+/)
    .slice(0, 2)
    .map((k) => k[0])
    .join("")
    .toUpperCase();

  return (
    /* Kartu mengambang, bukan bar menempel — mengikuti portal perusahaan.
       `sticky` dipertahankan supaya tetap terlihat waktu percakapan panjang;
       jarak kiri-kanan ikut badan halaman supaya sudut membulatnya kelihatan. */
    <header className="sticky top-0 z-10 shrink-0 px-3 pt-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-garis bg-permukaan px-4 py-2.5 shadow-kecil">
        {/* Identitas produk di kiri — di portal perusahaan posisi ini dipegang
            logo Portal, dan di sini dipegang Ratu AI. Cokelatnya satu-satunya
            warna hangat di layar yang sudah netral, jadi dia yang menandai
            "ini bagian AI". */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-utama text-[11px] font-bold tracking-tight text-utama-teks">
            AI
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-bold tracking-tight">
              Ratu AI
            </p>
            <p className="truncate text-[11px] text-tinta-lemah">
              PT Mustika Ratubuana Int
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Cuma tautan. Penjagaan sebenarnya ada di `proxy.ts` (dari token)
            dan di route API (ke database) -- menyembunyikan tombol saja tidak
            menjaga apa pun. */}
          {/* Kepala juga bisa meninjau -- terbatas ke departemennya sendiri. */}
          {(admin || peran === "kepala") && (
            <Link
              href="/admin"
              className="rounded-xl px-2.5 py-2 text-xs font-medium text-tinta-lemah transition-colors hover:bg-permukaan hover:text-tinta"
            >
              Pengajuan
            </Link>
          )}

          <Link
            href="/whatsapp"
            title="Hubungkan WhatsApp"
            className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-tinta-lemah transition-colors hover:bg-permukaan hover:text-tinta"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-4"
              aria-hidden
            >
              <path d="M17.5 14.4c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5 0-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5 4.5.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.5-.4z" />
              <path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1112 20.2z" />
            </svg>
            <span className="hidden md:inline">WhatsApp</span>
          </Link>

          <PilihTema />

          <button
            onClick={logout}
            disabled={keluar}
            className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-tinta-lemah transition-colors hover:bg-permukaan hover:text-tinta disabled:opacity-40"
          >
            <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden>
              <path
                d="M12 14l4-4-4-4M16 10H7M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="hidden sm:inline">
              {keluar ? "Keluar..." : "Keluar"}
            </span>
          </button>

          {/* Chip pemakai di kanan, seperti portal perusahaan. Dipisah garis
            supaya tidak terbaca sebagai tombol keempat. */}
          <div className="ml-1 flex min-w-0 items-center gap-2.5 border-l border-garis pl-3">
            <div className="hidden min-w-0 text-right leading-tight sm:block">
              <p className="truncate text-[13px] font-semibold tracking-tight">
                {nama}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-tinta-lemah">
                {departemen}
                {/* Peran kepala ditandai karena aksesnya memang berbeda
                  (bisa melihat data gaji). Staf tidak perlu ditandai. */}
                {peran === "kepala" && " · Kepala"}
              </p>
            </div>
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-aksen text-[11px] font-bold text-aksen-teks"
              title={`${nama} — ${departemen}`}
            >
              {inisial}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
