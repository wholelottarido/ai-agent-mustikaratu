"use client";

import { useState } from "react";

/**
 * Bentuknya mengikuti `DrafLembur` di `lib/entri/lembur.ts`, tapi ditulis
 * ulang di sini dengan sengaja: berkas itu mengimpor `mysql2`, dan komponen
 * klien tidak boleh menyeretnya ke bundel browser.
 */
export type DrafLemburEntri = {
  draf: {
    karyawan: { id: number; nik: string; nama: string; departemen: string; jabatan: string; level: string };
    tanggal: string;
    jam: number;
    alasan: string;
    status: string;
    nilaiRp: number;
  };
  sidik: string;
  permintaan: { karyawan: string; jam: number; alasan: string; tanggal?: string };
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Kartu konfirmasi entri lembur.
 *
 * ⚠️ Tombol ini yang memicu penyimpanan — BUKAN model. Agent cuma menyusun
 * draf; dia tidak punya tool yang bisa menulis ke database.
 *
 * ⚠️ Yang dikirim ke server cuma permintaan ASLI + `sidik`, bukan drafnya dan
 * terutama BUKAN nilai rupiahnya. Server menghitung ulang dari data gaji lalu
 * membandingkan sidiknya, jadi mengubah angka di sini tidak mengubah apa pun
 * yang tersimpan.
 */
export function KonfirmasiLembur({
  data,
  permintaanAsli,
}: {
  data: DrafLemburEntri;
  permintaanAsli?: string;
}) {
  const [status, setStatus] = useState<"siap" | "menyimpan" | "tersimpan" | "gagal" | "batal">("siap");
  const [pesan, setPesan] = useState("");

  async function simpan() {
    if (status !== "siap") return;
    setStatus("menyimpan");
    setPesan("");
    try {
      const r = await fetch("/api/entri/lembur", {
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
        <p className="font-medium">✓ Lembur tercatat</p>
        <p className="mt-1 text-tinta-lemah">
          {data.draf.karyawan.nama} · {data.draf.tanggal} · {data.draf.jam} jam ·{" "}
          {rp(data.draf.nilaiRp)} — menunggu persetujuan.
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

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-permukaan/60 shadow-kecil ring-1 ring-garis/60">
      <div className="border-b border-garis/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-tinta-lemah">
          Belum tersimpan — periksa dulu
        </p>
      </div>

      <div className="space-y-2 px-4 py-3 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Karyawan</span>
          <span className="text-right font-medium">
            {data.draf.karyawan.nama}{" "}
            <span className="font-mono text-xs text-tinta-lemah">{data.draf.karyawan.nik}</span>
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Bagian</span>
          <span className="text-right">
            {data.draf.karyawan.departemen} — {data.draf.karyawan.jabatan}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Tanggal</span>
          <span>{data.draf.tanggal}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Lama</span>
          <span>{data.draf.jam} jam</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Alasan</span>
          <span className="text-right">{data.draf.alasan}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Status</span>
          <span>{data.draf.status}</span>
        </div>

        {/* Nilainya DIHITUNG SERVER dari data gaji, tidak bisa diketik.
            Ditampilkan karena yang mengentri kepala HR, yang memang boleh
            melihat angka turunan gaji. */}
        <div className="flex justify-between gap-3 border-t border-garis/50 pt-2 font-semibold">
          <span>Nilai lembur</span>
          <span className="tabular-nums">{rp(data.draf.nilaiRp)}</span>
        </div>
        <p className="text-xs text-tinta-lemah">Dihitung dari data gaji — tidak bisa diubah di sini.</p>
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
