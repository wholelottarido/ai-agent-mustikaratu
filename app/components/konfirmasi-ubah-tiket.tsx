"use client";

import { useState } from "react";

type Perubahan = { kolom: string; label: string; dari: string; jadi: string };

export type DrafUbahTiket = {
  draf: { noTiket: string; judulSekarang: string; status: string; perubahan: Perubahan[] };
  sidik: string;
  permintaan: { noTiket?: string; judul?: string; deskripsi?: string; prioritas?: string };
};

/**
 * Kartu konfirmasi penyuntingan tiket.
 *
 * ⚠️ MENAMPILKAN PERUBAHANNYA, BUKAN ISI BARUNYA.
 *
 * Kartu pembuatan tiket menunjukkan isi lengkap karena belum ada apa-apa
 * sebelumnya. Di sini sudah ada, dan yang perlu diperiksa user adalah APA YANG
 * BERUBAH — menampilkan isi baru saja membuat ia harus mengingat sendiri
 * yang lama untuk tahu apa yang ia setujui.
 *
 * ⚠️ Tombol ini yang menyimpan, bukan model.
 */
export function KonfirmasiUbahTiket({ data }: { data: DrafUbahTiket }) {
  const [status, setStatus] = useState<"siap" | "menyimpan" | "tersimpan" | "gagal" | "batal">("siap");
  const [pesan, setPesan] = useState("");

  async function simpan() {
    if (status !== "siap") return;
    setStatus("menyimpan");
    setPesan("");
    try {
      const r = await fetch("/api/entri/tiket", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data.permintaan, sidik: data.sidik }),
      });
      const d = (await r.json()) as { error?: string };
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
        <p className="font-medium">✓ Tiket {data.draf.noTiket} diperbarui</p>
        <ul className="mt-1 text-tinta-lemah">
          {data.draf.perubahan.map((p) => (
            <li key={p.kolom}>
              {p.label}: {p.jadi}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (status === "batal") {
    return (
      <div className="mt-3 rounded-2xl bg-permukaan/60 p-4 text-sm text-tinta-lemah ring-1 ring-garis/60">
        Dibatalkan &mdash; tiketnya tidak berubah.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-permukaan/60 shadow-kecil ring-1 ring-garis/60">
      <div className="border-b border-garis/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-tinta-lemah">
          Belum tersimpan &mdash; periksa perubahannya
        </p>
        <p className="mt-0.5 text-xs text-tinta-lemah">
          Tiket <span className="font-mono text-tinta">{data.draf.noTiket}</span> &middot;{" "}
          {data.draf.status} &middot; {data.draf.judulSekarang}
        </p>
      </div>

      <div className="space-y-3 px-4 py-3 text-sm">
        {data.draf.perubahan.map((p) => (
          <div key={p.kolom}>
            <p className="text-xs font-medium text-tinta-lemah">{p.label}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-tinta-lemah line-through decoration-garis">
              {p.dari || "(kosong)"}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap font-medium">{p.jadi}</p>
          </div>
        ))}
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
          {status === "menyimpan" ? "Menyimpan…" : "Simpan perubahan"}
        </button>
        <button
          onClick={() => setStatus("batal")}
          disabled={status === "menyimpan"}
          className="rounded-xl px-4 py-2 text-sm text-tinta-lemah transition-colors hover:bg-kertas disabled:opacity-40"
        >
          Batal
        </button>
      </div>
    </div>
  );
}
