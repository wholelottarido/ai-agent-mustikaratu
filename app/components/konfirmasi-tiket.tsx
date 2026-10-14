"use client";

import { useState } from "react";

type Draf = {
  idEmployee: string;
  kategori: { id: string; nama: string };
  subKategori: { id: string; nama: string };
  judul: string;
  deskripsi: string;
  prioritas: { nilai: string; label: string };
};

export type DrafTiket = {
  draf: Draf;
  sidik: string;
  permintaan: {
    kategori?: string;
    subKategori?: string;
    judul?: string;
    deskripsi?: string;
    prioritas?: string;
  };
};

/**
 * Kartu konfirmasi tiket helpdesk.
 *
 * ⚠️ TOMBOL INI YANG MENYIMPAN — bukan model. Agent cuma menyusun rancangan;
 * ia tidak punya satu pun tool yang menulis ke `portal_ticket`.
 *
 * ⚠️ Yang dikirim ke server cuma permintaan ASLI + `sidik`, bukan rancangannya.
 * Server menyusun ulang rancangannya sendiri lalu membandingkan sidiknya, jadi
 * mengubah apa pun di sini tidak mengubah yang tersimpan.
 *
 * ⚠️ Tiket yang tersimpan MASUK ANTREAN HELPDESK SUNGGUHAN dan jadi pekerjaan
 * teknisi. Itu sebabnya kartunya menyebut keadaan sebenarnya di dua tempat —
 * sebelum disimpan ("belum tersimpan") dan sesudah ("teknisi IT akan
 * menanganinya") — bukan sekadar tanda centang.
 */
export function KonfirmasiTiket({ data }: { data: DrafTiket }) {
  const [status, setStatus] = useState<"siap" | "menyimpan" | "tersimpan" | "gagal" | "batal">("siap");
  const [pesan, setPesan] = useState("");
  const [noTicket, setNoTicket] = useState("");

  async function simpan() {
    if (status !== "siap") return;
    setStatus("menyimpan");
    setPesan("");
    try {
      const r = await fetch("/api/entri/tiket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data.permintaan, sidik: data.sidik }),
      });
      const d = (await r.json()) as { error?: string; noTicket?: string };
      if (!r.ok) {
        setStatus("gagal");
        setPesan(d.error ?? "Gagal menyimpan.");
        return;
      }
      setNoTicket(d.noTicket ?? "");
      setStatus("tersimpan");
    } catch {
      setStatus("gagal");
      setPesan("Tidak bisa menghubungi server.");
    }
  }

  if (status === "tersimpan") {
    return (
      <div className="mt-3 rounded-2xl bg-aksen/25 p-4 text-sm ring-1 ring-aksen/50">
        <p className="font-medium">✓ Tiket tersimpan</p>
        <p className="mt-1 text-tinta-lemah">
          Nomor <span className="font-mono font-medium text-tinta">{noTicket}</span> ·{" "}
          {data.draf.kategori.nama} / {data.draf.subKategori.nama} · {data.draf.prioritas.label}
        </p>
        <p className="mt-1.5 text-xs text-tinta-lemah">
          Tiket ini masuk antrean helpdesk dan akan ditangani teknisi IT.
        </p>
      </div>
    );
  }

  if (status === "batal") {
    return (
      <div className="mt-3 rounded-2xl bg-permukaan/60 p-4 text-sm text-tinta-lemah ring-1 ring-garis/60">
        Dibatalkan — tidak ada tiket yang dibuat.
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
          <span className="text-tinta-lemah">Kategori</span>
          <span className="text-right font-medium">
            {data.draf.kategori.nama} / {data.draf.subKategori.nama}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Prioritas</span>
          <span>{data.draf.prioritas.label}</span>
        </div>
        <div className="border-t border-garis/50 pt-2">
          <p className="font-medium">{data.draf.judul}</p>
          <p className="mt-1 whitespace-pre-wrap text-tinta-lemah">{data.draf.deskripsi}</p>
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
          {status === "menyimpan" ? "Menyimpan…" : "Simpan tiket"}
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
