"use client";

import { useState } from "react";

/**
 * Bentuknya mengikuti `DrafPelamar` di `lib/entri/pelamar.ts`, ditulis ulang
 * di sini: berkas itu mengimpor `mysql2`, dan komponen klien tidak boleh
 * menyeretnya ke bundel browser.
 */
export type DrafPelamarEntri = {
  draf: {
    lowongan: { id: number; kode: string; jabatan: string; departemen: string; tanggalTutup: string };
    nama: string;
    email: string;
    telepon: string | null;
    pendidikan: string;
    pengalaman: number;
    sumber: string;
    tanggalLamar: string;
    status: string;
  };
  sidik: string;
  permintaan: {
    lowongan: string;
    nama: string;
    email: string;
    pendidikan: string;
    pengalaman: number;
    sumber: string;
    telepon?: string;
    tanggal?: string;
  };
};

/**
 * Kartu konfirmasi entri pelamar.
 *
 * ⚠️ Tombol ini yang memicu penyimpanan — BUKAN model. Agent cuma menyusun
 * draf; dia tidak punya tool yang bisa menulis ke database.
 */
export function KonfirmasiPelamar({
  data,
  permintaanAsli,
}: {
  data: DrafPelamarEntri;
  permintaanAsli?: string;
}) {
  const [status, setStatus] = useState<"siap" | "menyimpan" | "tersimpan" | "gagal" | "batal">("siap");
  const [pesan, setPesan] = useState("");

  async function simpan() {
    if (status !== "siap") return;
    setStatus("menyimpan");
    setPesan("");
    try {
      const r = await fetch("/api/entri/pelamar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data.permintaan, sidik: data.sidik, permintaan: permintaanAsli }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus("gagal");
        setPesan(d.error ?? "Gagal menyimpan.");
        return;
      }
      setStatus("tersimpan");
    } catch {
      setStatus("gagal");
      setPesan("Tidak bisa menghubungi server.");
    }
  }

  if (status === "tersimpan") {
    return (
      <div className="mt-3 rounded-2xl bg-aksen/25 p-4 text-sm ring-1 ring-aksen/50">
        <p className="font-medium">✓ Pelamar tercatat</p>
        <p className="mt-1 text-tinta-lemah">
          {data.draf.nama} · {data.draf.lowongan.kode} — {data.draf.lowongan.jabatan} · masuk tahap{" "}
          {data.draf.status}.
        </p>
      </div>
    );
  }

  if (status === "batal") {
    return (
      <div className="mt-3 rounded-2xl bg-permukaan/60 p-4 text-sm text-tinta-lemah ring-1 ring-garis/60">
        Dibatalkan — tidak ada yang tersimpan.
      </div>
    );
  }

  const baris: [string, string][] = [
    ["Nama", data.draf.nama],
    ["Email", data.draf.email],
    ["Telepon", data.draf.telepon ?? "—"],
    ["Pendidikan", data.draf.pendidikan],
    ["Pengalaman", `${data.draf.pengalaman} tahun`],
    ["Sumber", data.draf.sumber],
  ];

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-permukaan/60 shadow-kecil ring-1 ring-garis/60">
      <div className="border-b border-garis/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-tinta-lemah">
          Belum tersimpan — periksa dulu
        </p>
      </div>

      <div className="space-y-2 px-4 py-3 text-sm">
        {baris.map(([label, nilai]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-tinta-lemah">{label}</span>
            <span className="text-right">{nilai}</span>
          </div>
        ))}

        <div className="space-y-2 border-t border-garis/50 pt-2">
          <div className="flex justify-between gap-3">
            <span className="text-tinta-lemah">Lowongan</span>
            <span className="text-right font-medium">
              <span className="font-mono text-xs">{data.draf.lowongan.kode}</span> —{" "}
              {data.draf.lowongan.jabatan}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-tinta-lemah">Bagian</span>
            <span className="text-right">{data.draf.lowongan.departemen}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-tinta-lemah">Tanggal lamar</span>
            <span>{data.draf.tanggalLamar}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-tinta-lemah">Tahap</span>
            <span>{data.draf.status}</span>
          </div>
        </div>
      </div>

      {pesan && (
        <p className="mx-4 mb-3 rounded-xl bg-bahaya-lemah px-3 py-2 text-xs text-bahaya ring-1 ring-bahaya/20">
          {pesan}
        </p>
      )}

      <div className="flex gap-2 border-t border-garis/50 px-4 py-3">
        <button
          onClick={simpan}
          disabled={status === "menyimpan"}
          className="rounded-xl bg-utama px-4 py-2 text-sm font-medium text-utama-teks shadow-kecil transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {status === "menyimpan" ? "Menyimpan..." : "Simpan"}
        </button>
        <button
          onClick={() => setStatus("batal")}
          disabled={status === "menyimpan"}
          className="rounded-xl px-4 py-2 text-sm font-medium text-tinta-lemah ring-1 ring-garis/70 transition-colors hover:bg-kertas disabled:opacity-40"
        >
          Batal
        </button>
      </div>
    </div>
  );
}
