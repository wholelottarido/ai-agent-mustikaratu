"use client";

import { useState } from "react";

export type DrafKeputusan = {
  lembur: {
    id: number;
    karyawan: { nik: string; nama: string; departemen: string; jabatan: string };
    tanggal: string;
    jam: number;
    alasan: string;
    status: string;
    nilaiRp: number;
  };
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/** Sama dengan batas di `lib/entri/persetujuan.ts`. Server tetap memeriksanya. */
const MIN_CATATAN = 5;

/**
 * Kartu keputusan lembur — dua tombol, bukan satu.
 *
 * ⚠️ Tombol ini yang memutuskan, BUKAN model. Agent cuma menampilkan isinya.
 *
 * ⚠️ Alasan penolakan diketik DI SINI dan wajib; menyetujui tidak butuh
 * catatan. Penolakan tanpa alasan tidak berguna buat siapa pun yang
 * membacanya nanti, dan alasan yang disusun model bukan alasan yang ditulis
 * sadar oleh yang memutuskan.
 */
export function KonfirmasiKeputusan({
  data,
  permintaanAsli,
}: {
  data: DrafKeputusan;
  permintaanAsli?: string;
}) {
  const [status, setStatus] = useState<"siap" | "mengirim" | "selesai" | "gagal" | "urung">("siap");
  const [hasil, setHasil] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [catatan, setCatatan] = useState("");
  const [pesan, setPesan] = useState("");

  const catatanCukup = catatan.trim().length >= MIN_CATATAN;

  async function putuskan(keputusan: "APPROVED" | "REJECTED") {
    if (status !== "siap") return;
    if (keputusan === "REJECTED" && !catatanCukup) return;
    setStatus("mengirim");
    setPesan("");
    try {
      const r = await fetch("/api/entri/lembur/putuskan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: data.lembur.id,
          keputusan,
          catatan: catatan.trim() || undefined,
          permintaan: permintaanAsli,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus("gagal");
        setPesan(d.error ?? "Gagal menyimpan keputusan.");
        return;
      }
      setHasil(keputusan);
      setStatus("selesai");
    } catch {
      setStatus("gagal");
      setPesan("Tidak bisa menghubungi server.");
    }
  }

  if (status === "selesai") {
    const setuju = hasil === "APPROVED";
    return (
      <div
        className={`mt-3 rounded-2xl p-4 text-sm ring-1 ${
          setuju ? "bg-aksen/25 ring-aksen/50" : "bg-bahaya-lemah ring-bahaya/30"
        }`}
      >
        <p className={`font-medium ${setuju ? "" : "text-bahaya"}`}>
          {setuju ? "✓ Lembur disetujui" : "Lembur ditolak"}
        </p>
        <p className="mt-1 text-tinta-lemah">
          #{data.lembur.id} · {data.lembur.karyawan.nama} · {data.lembur.jam} jam ·{" "}
          {rp(data.lembur.nilaiRp)}
          {!setuju && catatan.trim() ? ` — ${catatan.trim()}` : ""}
        </p>
      </div>
    );
  }

  if (status === "urung") {
    return (
      <div className="mt-3 rounded-2xl bg-permukaan/60 p-4 text-sm text-tinta-lemah ring-1 ring-garis/60">
        Belum diputuskan — #{data.lembur.id} tetap menunggu.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-permukaan/60 shadow-kecil ring-1 ring-garis/60">
      <div className="border-b border-garis/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-tinta-lemah">
          Menunggu keputusan — belum diputuskan
        </p>
      </div>

      <div className="space-y-2 px-4 py-3 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Karyawan</span>
          <span className="text-right font-medium">
            {data.lembur.karyawan.nama}{" "}
            <span className="font-mono text-xs text-tinta-lemah">{data.lembur.karyawan.nik}</span>
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Bagian</span>
          <span className="text-right">
            {data.lembur.karyawan.departemen} — {data.lembur.karyawan.jabatan}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Tanggal</span>
          <span>{data.lembur.tanggal}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Lama</span>
          <span>{data.lembur.jam} jam</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tinta-lemah">Alasan</span>
          <span className="text-right">{data.lembur.alasan}</span>
        </div>
        <div className="flex justify-between gap-3 border-t border-garis/50 pt-2 font-semibold">
          <span>Nilai lembur</span>
          <span className="tabular-nums">{rp(data.lembur.nilaiRp)}</span>
        </div>
      </div>

      <div className="border-t border-garis/50 px-4 py-3">
        <label htmlFor={`catatan-${data.lembur.id}`} className="block text-xs font-medium text-tinta-lemah">
          Alasan penolakan <span className="text-tinta-lemah">(wajib kalau menolak)</span>
        </label>
        <input
          id={`catatan-${data.lembur.id}`}
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
          disabled={status === "mengirim"}
          maxLength={255}
          placeholder="mis. jam tidak sesuai absensi"
          className="mt-1.5 w-full rounded-xl bg-kertas px-3 py-2 text-sm ring-1 ring-garis/70 outline-none transition-shadow placeholder:text-tinta-lemah/70 focus:ring-2 focus:ring-utama/40 disabled:opacity-40"
        />
      </div>

      {pesan && (
        <p className="mx-4 mb-3 rounded-xl bg-bahaya-lemah px-3 py-2 text-xs text-bahaya ring-1 ring-bahaya/20">
          {pesan}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-garis/50 px-4 py-3">
        <button
          onClick={() => putuskan("APPROVED")}
          disabled={status === "mengirim"}
          className="rounded-xl bg-utama px-4 py-2 text-sm font-medium text-utama-teks shadow-kecil transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {status === "mengirim" ? "Menyimpan..." : "Setujui"}
        </button>
        {/* Warna dibalik, bukan merah pekat: `--bahaya` jadi warna TERANG di
            mode gelap, jadi teks putih di atasnya tidak terbaca. */}
        <button
          onClick={() => putuskan("REJECTED")}
          disabled={status === "mengirim" || !catatanCukup}
          title={catatanCukup ? undefined : "Isi alasan penolakan dulu"}
          className="rounded-xl bg-bahaya-lemah px-4 py-2 text-sm font-medium text-bahaya ring-1 ring-bahaya/40 transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-40"
        >
          Tolak
        </button>
        <button
          onClick={() => setStatus("urung")}
          disabled={status === "mengirim"}
          className="rounded-xl px-4 py-2 text-sm font-medium text-tinta-lemah ring-1 ring-garis/70 transition-colors hover:bg-kertas disabled:opacity-40"
        >
          Nanti saja
        </button>
      </div>
    </div>
  );
}
