"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PilihTema } from "../components/pilih-tema";

/**
 * Halaman login harus dibungkus Suspense karena useSearchParams() bikin
 * komponennya butuh dirender di klien.
 */
export default function Login() {
  return (
    <Suspense>
      <FormLogin />
    </Suspense>
  );
}

/**
 * Hanya izinkan tujuan berupa path relatif di aplikasi ini.
 *
 * Tanpa penjagaan ini, `/login?lanjut=https://situs-jahat.com` akan melempar
 * user ke situs luar setelah login -- pola phishing klasik (open redirect).
 * `//situs.com` juga ditolak: browser menganggapnya URL absolut.
 */
function tujuanAman(lanjut: string | null): string {
  if (!lanjut) return "/";
  if (!lanjut.startsWith("/") || lanjut.startsWith("//")) return "/";
  return lanjut;
}

type Jenis = "portal" | "perusahaan";

type Profil = {
  idEmployee: string;
  nama: string;
  jabatan: string;
  departemen: string;
  peran: string;
};

const KOTAK =
  "mt-1.5 w-full rounded-xl bg-kertas/80 px-3.5 py-2.5 text-sm outline-none ring-1 ring-garis/70 transition-shadow placeholder:text-tinta-lemah/60 focus:ring-2 focus:ring-utama/50";
const TOMBOL =
  "w-full rounded-xl bg-utama px-4 py-2.5 text-sm font-medium text-utama-teks shadow-kecil transition-all hover:shadow-sedang hover:brightness-110 active:scale-[0.98] disabled:opacity-30 disabled:hover:brightness-100 disabled:hover:shadow-kecil";

function FormLogin() {
  const router = useRouter();
  const lanjut = tujuanAman(useSearchParams().get("lanjut"));

  const [jenis, setJenis] = useState<Jenis>("portal");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);

  // Langkah pemilihan profil. Kosong = belum sampai situ.
  const [tokenPilih, setTokenPilih] = useState("");
  const [profil, setProfil] = useState<Profil[]>([]);
  const [dipilih, setDipilih] = useState("");

  function selesai() {
    // refresh() supaya komponen server membaca ulang cookie sesi yang
    // baru dipasang; push() saja bisa menampilkan halaman versi lama.
    router.replace(lanjut);
    router.refresh();
  }

  async function kirim(url: string, isi: unknown) {
    setGalat("");
    setSibuk(true);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isi),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setGalat(data.error || "Gagal masuk. Coba lagi.");
        return null;
      }
      return data;
    } catch {
      setGalat("Tidak bisa menghubungi server.");
      return null;
    } finally {
      setSibuk(false);
    }
  }

  async function masuk(e: React.FormEvent) {
    e.preventDefault();
    if (sibuk) return;

    if (jenis === "portal") {
      const d = await kirim("/api/auth/login", { username, password });
      if (d) selesai();
      return;
    }

    const d = await kirim("/api/auth/login-perusahaan", { username, password });
    if (!d) return;
    if (d.perluPilih) {
      // Satu akun email dipakai beberapa karyawan -- bawaan sistem
      // perusahaan. Orangnya yang menentukan dia sedang bekerja sebagai siapa.
      setTokenPilih(d.token);
      setProfil(d.profil);
      setDipilih(d.profil[0]?.idEmployee ?? "");
      return;
    }
    selesai();
  }

  async function pakaiProfil(e: React.FormEvent) {
    e.preventDefault();
    if (sibuk || !dipilih) return;
    const d = await kirim("/api/auth/login-perusahaan", {
      token: tokenPilih,
      idEmployee: dipilih,
    });
    if (d) selesai();
  }

  function batalPilih() {
    setTokenPilih("");
    setProfil([]);
    setDipilih("");
    setPassword("");
    setGalat("");
  }

  const pesanGalat = galat && (
    <p className="rounded-xl bg-bahaya-lemah px-3.5 py-2.5 text-sm text-bahaya ring-1 ring-bahaya/20">
      {galat}
    </p>
  );

  // ============================================================
  // Layar pemilih profil
  // ============================================================
  if (profil.length > 0) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-kertas px-4 py-10">
        <form
          onSubmit={pakaiProfil}
          className="w-full max-w-sm space-y-5 rounded-3xl bg-permukaan/50 p-7 shadow-besar ring-1 ring-garis/60 backdrop-blur"
        >
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Pilih profil</h1>
            <p className="mt-1.5 text-sm text-tinta-lemah">
              Akun ini dipakai {profil.length} karyawan. Pilih profil kamu untuk sesi ini.
            </p>
          </div>

          <div className="space-y-2">
            {profil.map((p) => (
              <label
                key={p.idEmployee}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-3 ring-1 transition-shadow ${
                  dipilih === p.idEmployee
                    ? "bg-kertas ring-2 ring-utama/50"
                    : "bg-kertas/60 ring-garis/70 hover:ring-garis"
                }`}
              >
                <input
                  type="radio"
                  name="profil"
                  value={p.idEmployee}
                  checked={dipilih === p.idEmployee}
                  onChange={() => setDipilih(p.idEmployee)}
                  className="sr-only"
                />
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-utama/10 text-xs font-semibold text-utama">
                  {p.nama.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.nama || "(tanpa nama)"}</span>
                  <span className="block truncate text-xs text-tinta-lemah">
                    {[p.jabatan, p.departemen].filter(Boolean).join(" · ") || "tanpa jabatan"}
                  </span>
                </span>
                {p.peran === "kepala" && (
                  <span className="shrink-0 rounded-lg bg-utama/10 px-2 py-0.5 text-[10px] font-medium text-utama">
                    kepala
                  </span>
                )}
              </label>
            ))}
          </div>

          {pesanGalat}

          <button type="submit" disabled={sibuk || !dipilih} className={TOMBOL}>
            {sibuk ? "Memproses..." : "Gunakan profil ini"}
          </button>

          <button
            type="button"
            onClick={batalPilih}
            className="w-full text-center text-xs text-tinta-lemah underline-offset-2 hover:underline"
          >
            Kembali
          </button>
        </form>
      </main>
    );
  }

  // ============================================================
  // Layar login
  // ============================================================
  return (
    <main className="flex min-h-dvh items-center justify-center bg-kertas px-4 py-10">
      <form
        onSubmit={masuk}
        className="w-full max-w-sm space-y-5 rounded-3xl bg-permukaan/50 p-7 shadow-besar ring-1 ring-garis/60 backdrop-blur"
      >
        <div className="text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-utama text-lg font-semibold text-utama-teks shadow-sedang">
            AI
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Portal AI Assistant</h1>
          <p className="mt-1.5 text-sm text-tinta-lemah">
            {jenis === "portal"
              ? "Masuk dengan akun departemen kamu."
              : "Masuk dengan akun sistem perusahaan."}
          </p>
        </div>

        {/* Dipilih tegas, bukan ditebak dari bentuk username: menebak akan
            salah untuk orang yang usernamenya kebetulan mirip email. */}
        <div className="flex gap-1 rounded-xl bg-kertas/60 p-1 ring-1 ring-garis/70">
          {(
            [
              ["portal", "Akun portal"],
              ["perusahaan", "Akun perusahaan"],
            ] as const
          ).map(([nilai, label]) => (
            <button
              key={nilai}
              type="button"
              onClick={() => {
                setJenis(nilai);
                setGalat("");
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                jenis === nilai
                  ? "bg-utama text-utama-teks shadow-kecil"
                  : "text-tinta-lemah hover:text-tinta"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">
            {jenis === "portal" ? "Username" : "Username perusahaan"}
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            // Mayoritas akun perusahaan BUKAN email (526 dari 1.266 aktif), jadi
            // jangan menuliskan contoh email sebagai satu-satunya bentuk --
            // 526 orang akan mengira mereka tidak punya akun.
            placeholder={jenis === "perusahaan" ? "email atau username kantor" : undefined}
            className={KOTAK}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-tinta-lemah">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className={KOTAK}
          />
        </label>

        {pesanGalat}

        <button type="submit" disabled={sibuk || !username || !password} className={TOMBOL}>
          {sibuk ? "Memeriksa..." : "Masuk"}
        </button>

        <div className="flex items-center justify-between pt-1">
          <Link
            href="/daftar"
            className="text-xs text-tinta-lemah underline-offset-2 hover:underline"
          >
            Belum punya akun
          </Link>
          <PilihTema />
        </div>
      </form>
    </main>
  );
}
