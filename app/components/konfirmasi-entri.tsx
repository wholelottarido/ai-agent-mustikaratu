"use client";

import { useState } from "react";

type Baris = { produk_id: number; nama: string; qty: number; harga: number; subtotal: number };
type Draf = {
  pelanggan: { id: number; nama: string };
  baris: Baris[];
  total: number;
  tanggal: string;
  status: string;
};

export type DrafEntri = {
  draf: Draf;
  sidik: string;
  permintaan: { pelanggan: string; barang: { produk: string; qty: number }[]; tanggal?: string };
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Kartu konfirmasi entri penjualan.
 *
 * ⚠️ Tombol ini yang memicu penyimpanan — BUKAN model. Agent cuma menyusun
 * draf; dia tidak punya tool yang bisa menulis ke database.
 *
 * Yang dikirim ke server cuma permintaan ASLI + `sidik`, bukan drafnya.
 * Server menyusun ulang drafnya sendiri lalu membandingkan sidiknya, jadi
 * mengubah angka di sini tidak mengubah apa pun yang tersimpan.
 */
export function KonfirmasiEntri({ data, permintaanAsli }: { data: DrafEntri; permintaanAsli?: string }) {
  const [status, setStatus] = useState<"siap" | "menyimpan" | "tersimpan" | "gagal" | "batal">("siap");
  const [pesan, setPesan] = useState("");
  const [noOrder, setNoOrder] = useState("");

  async function simpan() {
    if (status !== "siap") return;
    setStatus("menyimpan");
    setPesan("");
    try {
      const r = await fetch("/api/entri/penjualan", {
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
      setNoOrder(d.noOrder);
      setStatus("tersimpan");
    } catch {
      setStatus("gagal");
      setPesan("Tidak bisa menghubungi server.");
    }
  }

  if (status === "tersimpan") {
    return (
      <div className="mt-3 rounded-2xl bg-aksen/25 p-4 text-sm ring-1 ring-aksen/50">
        <p className="font-medium">✓ Penjualan tersimpan</p>
        <p className="mt-1 text-tinta-lemah">
          Nomor order <span className="font-mono font-medium text-tinta">{noOrder}</span> ·{" "}
          {data.draf.pelanggan.nama} · {rp(data.draf.total)}
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
          <span className="text-tinta-lemah">Pelanggan</span>
          <span className="text-right font-medium">{data.draf.pelanggan.nama}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Tanggal</span>
          <span>{data.draf.tanggal}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Status</span>
          <span>{data.draf.status}</span>
        </div>

        <div className="border-t border-garis/50 pt-2">
          {data.draf.baris.map((b) => (
            <div key={b.produk_id} className="flex justify-between gap-3 py-0.5">
              <span className="min-w-0">
                {b.nama} <span className="text-tinta-lemah">×{b.qty} @{rp(b.harga)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{rp(b.subtotal)}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between gap-3 border-t border-garis/50 pt-2 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{rp(data.draf.total)}</span>
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
