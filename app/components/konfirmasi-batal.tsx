"use client";

import { useState } from "react";

type Baris = { nama: string; qty: number; harga: number; subtotal: number };

/**
 * Bentuknya mengikuti `OrderBatal` di `lib/entri/batal.ts`, tapi ditulis ulang
 * di sini dengan sengaja: berkas itu mengimpor `mysql2`, dan komponen klien
 * tidak boleh menyeretnya ke dalam bundel browser.
 */
export type DrafBatal = {
  order: {
    orderId: number;
    noOrder: string;
    pelanggan: string;
    tanggal: string;
    status: string;
    baris: Baris[];
    total: number;
    dientriOleh: string;
    sisaMenit: number;
  };
  permintaan: { noOrder: string };
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/** Sama dengan MIN_ALASAN di `lib/entri/batal.ts`. Server tetap memeriksanya. */
const MIN_ALASAN = 5;

/**
 * Kartu konfirmasi pembatalan penjualan.
 *
 * ⚠️ Tombolnya yang membatalkan, BUKAN model. Agent cuma menampilkan isi
 * order; dia tidak punya tool yang bisa mengubah status.
 *
 * ⚠️ Alasan diketik DI SINI, tidak lewat model.
 *
 * Kalau alasan disusun model dari kalimat user, yang tercatat di jejak audit
 * jadi tafsiran model — bukan alasan yang user tulis sadar. Karena itu
 * `siapkan_pembatalan` tidak punya parameter `alasan` sama sekali.
 */
export function KonfirmasiBatal({
  data,
  permintaanAsli,
}: {
  data: DrafBatal;
  permintaanAsli?: string;
}) {
  const [status, setStatus] = useState<"siap" | "mengirim" | "dibatalkan" | "gagal" | "urung">(
    "siap",
  );
  const [alasan, setAlasan] = useState("");
  const [pesan, setPesan] = useState("");

  const alasanCukup = alasan.trim().length >= MIN_ALASAN;

  async function kirim() {
    if (status !== "siap" || !alasanCukup) return;
    setStatus("mengirim");
    setPesan("");
    try {
      const r = await fetch("/api/entri/batal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noOrder: data.permintaan.noOrder,
          alasan: alasan.trim(),
          permintaan: permintaanAsli,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus("gagal");
        setPesan(d.error ?? "Gagal membatalkan.");
        return;
      }
      setStatus("dibatalkan");
    } catch {
      setStatus("gagal");
      setPesan("Tidak bisa menghubungi server.");
    }
  }

  if (status === "dibatalkan") {
    return (
      <div className="mt-3 rounded-2xl bg-bahaya-lemah p-4 text-sm ring-1 ring-bahaya/30">
        <p className="font-medium text-bahaya">Penjualan dibatalkan</p>
        <p className="mt-1 text-tinta-lemah">
          <span className="font-mono font-medium text-tinta">{data.order.noOrder}</span> ·{" "}
          {data.order.pelanggan} · {rp(data.order.total)} — tidak lagi dihitung sebagai omzet.
        </p>
      </div>
    );
  }

  if (status === "urung") {
    return (
      <div className="mt-3 rounded-2xl bg-permukaan/60 p-4 text-sm text-tinta-lemah ring-1 ring-garis/60">
        Tidak jadi dibatalkan — {data.order.noOrder} tetap seperti semula.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-permukaan/60 shadow-kecil ring-1 ring-bahaya/30">
      <div className="border-b border-bahaya/20 bg-bahaya-lemah/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-bahaya">
          Akan dibatalkan — belum terjadi
        </p>
      </div>

      <div className="space-y-2 px-4 py-3 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Order</span>
          <span className="font-mono font-medium">{data.order.noOrder}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Pelanggan</span>
          <span className="text-right font-medium">{data.order.pelanggan}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Tanggal</span>
          <span>{data.order.tanggal}</span>
        </div>

        <div className="border-t border-garis/50 pt-2">
          {data.order.baris.map((b, i) => (
            <div key={i} className="flex justify-between gap-3 py-0.5">
              <span className="min-w-0">
                {b.nama} <span className="text-tinta-lemah">×{b.qty} @{rp(b.harga)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{rp(b.subtotal)}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between gap-3 border-t border-garis/50 pt-2 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{rp(data.order.total)}</span>
        </div>

        {/* Batas waktunya nyata: lewat 2 jam, order ini tidak bisa dibatalkan
            lewat aplikasi lagi dan harus lewat admin database. */}
        <p className="pt-1 text-xs text-tinta-lemah">
          Sisa waktu pembatalan: <span className="font-medium">{data.order.sisaMenit} menit</span>
        </p>
      </div>

      <div className="border-t border-garis/50 px-4 py-3">
        <label htmlFor={`alasan-${data.order.orderId}`} className="block text-xs font-medium text-tinta-lemah">
          Alasan pembatalan <span className="text-bahaya">*</span>
        </label>
        <input
          id={`alasan-${data.order.orderId}`}
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          disabled={status === "mengirim"}
          maxLength={255}
          placeholder="mis. salah pelanggan, harusnya CV Makmur"
          className="mt-1.5 w-full rounded-xl bg-kertas px-3 py-2 text-sm ring-1 ring-garis/70 outline-none transition-shadow placeholder:text-tinta-lemah/70 focus:ring-2 focus:ring-bahaya/40 disabled:opacity-40"
        />
        <p className="mt-1 text-xs text-tinta-lemah">
          Ikut tercatat di jejak audit — tulis yang sebenarnya, minimal {MIN_ALASAN} karakter.
        </p>
      </div>

      {pesan && (
        <p className="mx-4 mb-3 rounded-xl bg-bahaya-lemah px-3 py-2 text-xs text-bahaya ring-1 ring-bahaya/20">
          {pesan}
        </p>
      )}

      <div className="flex gap-2 border-t border-garis/50 px-4 py-3">
        {/* Warna dibalik (latar lemah + teks bahaya), bukan merah pekat:
            `--bahaya` berubah jadi warna TERANG di mode gelap, jadi teks putih
            di atasnya tidak terbaca. Pasangan lemah/pekat ini aman di dua mode. */}
        <button
          onClick={kirim}
          disabled={status === "mengirim" || !alasanCukup}
          className="rounded-xl bg-bahaya-lemah px-4 py-2 text-sm font-medium text-bahaya ring-1 ring-bahaya/40 shadow-kecil transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-40"
        >
          {status === "mengirim" ? "Membatalkan..." : "Batalkan penjualan"}
        </button>
        <button
          onClick={() => setStatus("urung")}
          disabled={status === "mengirim"}
          className="rounded-xl px-4 py-2 text-sm font-medium text-tinta-lemah ring-1 ring-garis/70 transition-colors hover:bg-kertas disabled:opacity-40"
        >
          Jangan jadi
        </button>
      </div>
    </div>
  );
}
