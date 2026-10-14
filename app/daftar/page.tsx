"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PilihTema } from "../components/pilih-tema";

type Departemen = { id: string; label: string };

/**
 * Halaman pengajuan akun.
 *
 * ⚠️ Tidak memberi tahu kalau username sudah dipakai. Login sengaja dibuat
 * tidak membocorkan username mana yang terdaftar; kalau halaman ini
 * membocorkannya, usaha itu jadi sia-sia. Bentrokan ditampilkan ke ADMIN saat
 * meninjau.
 *
 * Yang dikirim dari sini TIDAK langsung jadi akun — dia antre sampai admin
 * menyetujui dan menetapkan perannya.
 */
export default function Daftar() {
  const [departemen, setDepartemen] = useState<Departemen[]>([]);
  const [form, setForm] = useState({
    username: "",
    password: "",
    nama: "",
    nomorWa: "",
    departemen: "",
    alasan: "",
  });
  const [galat, setGalat] = useState("");
  const [terkirim, setTerkirim] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  // Daftar departemen diambil dari server, bukan ditulis ulang di sini --
  // departemen baru otomatis muncul tanpa menyentuh halaman ini.
  useEffect(() => {
    fetch("/api/daftar")
      .then((r) => r.json())
      .then((d: { departemen?: Departemen[] }) => {
        setDepartemen(d.departemen ?? []);
        setForm((f) => (f.departemen ? f : { ...f, departemen: d.departemen?.[0]?.id ?? "" }));
      })
      .catch(() => setGalat("Tidak bisa memuat daftar departemen."));
  }, []);

  const ubah = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const kelas =
    "mt-1.5 w-full rounded-xl bg-kertas/80 px-3.5 py-2.5 text-sm outline-none ring-1 ring-garis/70 transition-shadow placeholder:text-tinta-lemah/60 focus:ring-2 focus:ring-utama/50";

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (sibuk) return;
    setGalat("");
    setSibuk(true);
    try {
      const r = await fetch("/api/daftar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) {
        setGalat(d.error ?? "Gagal mengirim pengajuan.");
        return;
      }
      setTerkirim(true);
    } catch {
      setGalat("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(false);
    }
  }

  if (terkirim) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-kertas px-4 py-10">
        <div className="w-full max-w-sm space-y-4 rounded-3xl bg-permukaan/50 p-7 text-center shadow-besar ring-1 ring-garis/60 backdrop-blur">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-aksen text-lg text-aksen-teks shadow-sedang">
            ✓
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Pengajuan terkirim</h1>
          <p className="text-sm text-tinta-lemah">
            Akun kamu belum aktif. Admin akan meninjau dan menentukan aksesnya dulu — kamu
            baru bisa masuk setelah disetujui.
          </p>
          <Link
            href="/login"
            className="inline-block rounded-xl bg-utama px-4 py-2.5 text-sm font-medium text-utama-teks shadow-kecil transition-all hover:shadow-sedang hover:brightness-110"
          >
            Ke halaman masuk
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-kertas px-4 py-10">
      <form
        onSubmit={kirim}
        className="w-full max-w-sm space-y-4 rounded-3xl bg-permukaan/50 p-7 shadow-besar ring-1 ring-garis/60 backdrop-blur"
      >
        <div className="text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-utama text-lg font-semibold text-utama-teks shadow-sedang">
            AI
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Ajukan akun</h1>
          <p className="mt-1.5 text-sm text-tinta-lemah">
            Akses ditentukan admin setelah pengajuan ditinjau.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">Nama lengkap</span>
          <input value={form.nama} onChange={ubah("nama")} required className={kelas} />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">Username</span>
          <input
            value={form.username}
            onChange={ubah("username")}
            autoComplete="username"
            required
            className={kelas}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">Password</span>
          <input
            type="password"
            value={form.password}
            onChange={ubah("password")}
            autoComplete="new-password"
            required
            minLength={6}
            className={kelas}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">Departemen yang diminta</span>
          <select value={form.departemen} onChange={ubah("departemen")} required className={kelas}>
            {departemen.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">
            Nomor WhatsApp <span className="opacity-60">(opsional)</span>
          </span>
          <input
            value={form.nomorWa}
            onChange={ubah("nomorWa")}
            inputMode="tel"
            placeholder="08xxxxxxxxxx"
            className={kelas}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">
            Keperluan <span className="opacity-60">(opsional)</span>
          </span>
          <input
            value={form.alasan}
            onChange={ubah("alasan")}
            placeholder="Biar admin tahu kamu siapa"
            className={kelas}
          />
        </label>

        {galat && (
          <p className="rounded-xl bg-bahaya-lemah px-3.5 py-2.5 text-sm text-bahaya ring-1 ring-bahaya/20">
            {galat}
          </p>
        )}

        <button
          type="submit"
          disabled={sibuk || !form.username || !form.password || !form.nama}
          className="w-full rounded-xl bg-utama px-4 py-2.5 text-sm font-medium text-utama-teks shadow-kecil transition-all hover:shadow-sedang hover:brightness-110 active:scale-[0.98] disabled:opacity-30"
        >
          {sibuk ? "Mengirim..." : "Ajukan"}
        </button>

        <div className="flex items-center justify-between pt-1">
          <Link href="/login" className="text-xs text-tinta-lemah underline-offset-2 hover:underline">
            Sudah punya akun
          </Link>
          <PilihTema />
        </div>
      </form>
    </main>
  );
}
