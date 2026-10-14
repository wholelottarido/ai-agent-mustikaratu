"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Status =
  | { tertaut: true; nomor: string | null; sejak: string }
  | { tertaut: false };

/**
 * Hubungkan WhatsApp ke akun ini.
 *
 * Kodenya membuktikan DUA hal sekaligus: user memegang akun ini (bisa login
 * untuk membuka halaman ini) dan memegang WhatsApp itu (bisa mengirim dari
 * sana). Mencocokkan nomor yang diketik sendiri tidak membuktikan apa pun.
 */
export default function WhatsAppTaut() {
  const [status, setStatus] = useState<Status | null>(null);
  const [nomorBot, setNomorBot] = useState<string | null>(null);
  const [menit, setMenit] = useState(10);
  const [kode, setKode] = useState("");
  const [sisa, setSisa] = useState(0);
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    try {
      const r = await fetch("/api/wa/kode");
      if (!r.ok) return;
      const d = await r.json();
      setStatus(d.status);
      setNomorBot(d.nomorBot);
      setMenit(d.menitBerlaku ?? 10);
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(muat);
  }, [muat]);

  // Hitung mundur supaya user tahu kodenya masih berlaku atau tidak. Tanpa
  // ini dia mengetik kode kedaluwarsa dan cuma dapat "kode tidak cocok".
  useEffect(() => {
    if (sisa <= 0) return;
    const t = setTimeout(() => setSisa(sisa - 1), 1000);
    return () => clearTimeout(t);
  }, [sisa]);

  async function minta() {
    if (sibuk) return;
    setGalat("");
    setSibuk(true);
    try {
      const r = await fetch("/api/wa/kode", { method: "POST" });
      const d = await r.json();
      if (!r.ok) {
        setGalat(d.error ?? "Gagal membuat kode.");
        return;
      }
      setKode(d.kode);
      setSisa((d.menitBerlaku ?? 10) * 60);
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(false);
    }
  }

  const menitDetik = `${Math.floor(sisa / 60)}:${String(sisa % 60).padStart(2, "0")}`;

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-kertas px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Hubungkan WhatsApp</h1>
        <Link href="/" className="text-sm text-tinta-lemah underline-offset-2 hover:underline">
          Kembali
        </Link>
      </header>

      {galat && (
        <p className="mb-4 rounded-xl bg-bahaya-lemah px-3.5 py-2.5 text-sm text-bahaya ring-1 ring-bahaya/20">
          {galat}
        </p>
      )}

      {status === null ? (
        <p className="text-sm text-tinta-lemah">Memuat...</p>
      ) : status.tertaut ? (
        <div className="rounded-2xl bg-permukaan/50 p-6 text-center shadow-kecil ring-1 ring-garis/60">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-aksen text-lg text-aksen-teks">
            ✓
          </span>
          <p className="mt-4 font-medium">WhatsApp sudah tertaut</p>
          <p className="mt-1.5 text-sm text-tinta-lemah">
            {status.nomor ? `Nomor ${status.nomor}. ` : ""}
            Sejak {new Date(status.sejak).toLocaleDateString("id-ID")}.
          </p>
          <p className="mt-4 text-xs text-tinta-lemah">
            Ganti HP? Hubungi admin untuk memutus tautannya dulu — kamu tidak bisa
            memutus sendiri.
          </p>
        </div>
      ) : kode ? (
        <div className="rounded-2xl bg-permukaan/50 p-6 text-center shadow-kecil ring-1 ring-garis/60">
          <p className="text-sm text-tinta-lemah">Kirim kode ini dari WhatsApp kamu</p>

          <p className="my-4 font-mono text-4xl font-semibold tracking-[0.25em]">{kode}</p>

          {nomorBot ? (
            <p className="text-sm">
              ke nomor <span className="font-medium">{nomorBot}</span>
            </p>
          ) : (
            <p className="text-sm text-tinta-lemah">ke nomor bot WhatsApp kantor</p>
          )}

          <p className="mt-3 text-xs text-tinta-lemah">
            {sisa > 0 ? (
              <>
                Berlaku <span className="font-medium">{menitDetik}</span> lagi. Ketik angkanya
                saja, tanpa tambahan apa pun.
              </>
            ) : (
              "Kode sudah kedaluwarsa. Minta yang baru."
            )}
          </p>

          <button
            onClick={minta}
            disabled={sibuk}
            className="mt-4 text-xs text-tinta-lemah underline underline-offset-2 hover:text-tinta disabled:opacity-40"
          >
            Minta kode baru
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-permukaan/50 p-6 shadow-kecil ring-1 ring-garis/60">
          <p className="text-sm text-tinta-lemah">
            Setelah tertaut, kamu bisa bertanya soal data departemenmu langsung lewat
            WhatsApp — tidak perlu buka portal ini.
          </p>
          <ol className="mt-4 space-y-1.5 text-sm">
            <li>1. Tekan tombol di bawah, muncul kode 6 angka.</li>
            <li>2. Kirim angka itu ke nomor bot dari WhatsApp kamu.</li>
            <li>3. Bot membalas kalau sudah tertaut.</li>
          </ol>
          <p className="mt-4 text-xs text-tinta-lemah">
            Kode berlaku {menit} menit dan cuma bisa dipakai sekali.
          </p>

          <button
            onClick={minta}
            disabled={sibuk}
            className="mt-5 w-full rounded-xl bg-utama px-4 py-2.5 text-sm font-medium text-utama-teks shadow-kecil transition-all hover:shadow-sedang hover:brightness-110 active:scale-[0.98] disabled:opacity-30"
          >
            {sibuk ? "Membuat..." : "Buat kode"}
          </button>
        </div>
      )}
    </main>
  );
}
