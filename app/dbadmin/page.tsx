"use client";

import Link from "next/link";
import { SumberData } from "./sumber-data";

/**
 * Halaman saklar sumber data — terpisah dari halaman pengajuan akun.
 *
 * ⚠️ Halaman ini TIDAK menjaga apa pun sendiri. Dua lapis yang menjaga:
 *   1. `proxy.ts` menyaring `/dbadmin` dari token (cepat, tapi token memuat
 *      `admin` yang baru berubah setelah 8 jam).
 *   2. `/api/admin/sumber` memeriksa ke DATABASE tiap permintaan, dan menolak
 *      siapa pun selain admin penuh — termasuk kepala departemen, yang lolos
 *      saringan pertama.
 *
 * Berbeda dengan `/admin`, kepala departemen TIDAK dilewatkan saringan
 * pertama — dia tidak punya urusan di sini sama sekali. Pesan "hanya
 * administrator" di komponennya tetap ada sebagai jaring kalau saringan
 * pertama suatu saat dilonggarkan.
 */
export default function HalamanSumber() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-kertas px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Sumber data agent</h1>
          <p className="mt-1 text-sm text-tinta-lemah">
            Agent membaca dari <span className="font-medium text-tinta">satu</span> sumber saja.
            Mengganti ini mengubah data yang dibaca seluruh departemen.
          </p>
        </div>
        <nav className="flex shrink-0 items-center gap-4 text-sm text-tinta-lemah">
          <Link href="/admin" className="underline-offset-2 hover:underline">
            Pengajuan akun
          </Link>
          <Link href="/" className="underline-offset-2 hover:underline">
            Kembali
          </Link>
        </nav>
      </header>

      <SumberData />
    </main>
  );
}
