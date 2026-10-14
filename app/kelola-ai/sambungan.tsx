"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Menyambung / memutus tool pada sebuah agent.
 *
 * ⚠️ TOMBOL "PUTUS" HANYA MUNCUL untuk tool yang memang disambungkan dari
 * sini. Tool yang menempel lewat kecocokan `id_apps` tidak bisa diputus di
 * layar ini — tombol yang ditekan lalu membalas "sambungan itu tidak ada"
 * adalah tombol yang berbohong. Keterangannya ditulis apa adanya.
 */
export function Sambungan({
  agent,
  bisaDitambah,
  manual,
  terpasang,
  bisaDipasangLagi,
}: {
  agent: string;
  bisaDitambah: { kode: string; nama: string; view: string | null }[];
  manual: string[];
  terpasang: { kode: string; nama: string; milikKita: boolean }[];
  /** Tool tim lain yang pernah dilepas, untuk ditawarkan dipasang lagi. */
  bisaDipasangLagi: { kode: string; nama: string }[];
}) {
  const router = useRouter();
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const [pilih, setPilih] = useState(bisaDitambah[0]?.kode ?? "");

  async function kirim(cara: "POST" | "DELETE", tool: string, mode?: "lepas" | "pasang-lagi") {
    setSibuk(true);
    setPesan(null);
    try {
      const r = await fetch("/api/admin/ai-tool", {
        method: cara,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, tool, ...(mode ? { mode } : {}) }),
      });
      const d = (await r.json()) as { error?: string };
      // Pesan penolakan ditampilkan apa adanya — dia menyebut sebabnya.
      setPesan(r.ok ? null : (d.error ?? `Gagal (${r.status}).`));
      if (r.ok) router.refresh();
    } catch {
      setPesan("Tidak bisa menghubungi server.");
    } finally {
      setSibuk(false);
    }
  }

  const bisaDiputus = terpasang.filter((t) => manual.includes(t.kode));
  // Tool tim lain yang sedang dipasang di agent ini — satu-satunya yang boleh
  // dilepas lewat jalur ini. Tool kita sendiri diputus lewat sambungannya.
  const bisaDilepas = terpasang.filter((t) => !t.milikKita);

  return (
    <div className="mt-4 rounded-2xl border border-garis bg-permukaan p-4">
      <h3 className="text-sm font-semibold tracking-tight">Sambungkan tool</h3>
      <p className="mt-1 text-xs leading-relaxed text-tinta-lemah">
        Hanya tool milik portal ini yang bisa disambungkan. Sambungannya disimpan di database
        portal, bukan di tabel konfigurasi sistem perusahaan &mdash; jadi agent yang sama di sistem
        mereka tidak ikut berubah.
      </p>

      {pesan && (
        <p role="status" className="mt-3 rounded-xl bg-bahaya-lemah p-2.5 text-xs text-bahaya">
          {pesan}
        </p>
      )}

      {bisaDitambah.length === 0 ? (
        <p className="mt-3 text-xs text-tinta-lemah">
          Semua tool milik portal ini sudah dipakai agent ini.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="sr-only">Tool yang akan disambungkan</span>
            <select
              value={pilih}
              disabled={sibuk}
              onChange={(e) => setPilih(e.target.value)}
              className="rounded-xl border border-garis bg-kertas px-3 py-2 text-sm"
            >
              {bisaDitambah.map((t) => (
                <option key={t.kode} value={t.kode}>
                  {t.nama} ({t.kode})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={sibuk || !pilih}
            onClick={() => void kirim("POST", pilih)}
            className="rounded-xl bg-utama px-4 py-2 text-sm font-medium text-utama-teks disabled:opacity-40"
          >
            {sibuk ? "Menyambungkan…" : "Sambungkan"}
          </button>
        </div>
      )}

      {bisaDilepas.length > 0 && (
        <div className="mt-4 border-t border-garis pt-3">
          <p className="text-xs font-medium">Tool tim lain yang dipasang di sini</p>
          {/* ⚠️ KALIMAT INI PENTING. "Lepas" terbaca seperti "hapus", dan kalau
              administrator mengira ia menghapus tool tim lain, ia akan ragu
              memakainya — atau lebih buruk, memakainya dengan keyakinan yang
              salah. Yang terjadi cuma portal ini berhenti memasangnya. */}
          <p className="mt-1 text-xs leading-relaxed text-tinta-lemah">
            Melepas <strong className="text-tinta">tidak menghapus apa pun</strong> di sistem
            mereka &mdash; barisnya tetap utuh dan sistem AI tim lain tetap memakainya. Yang
            berubah cuma apa yang dipasang portal ini, dan itu dicatat di database portal.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bisaDilepas.map((t) => (
              <span key={t.kode} className="flex items-center gap-2 rounded-lg bg-kertas px-2.5 py-1 text-xs">
                {t.nama}
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() => void kirim("DELETE", t.kode, "lepas")}
                  aria-label={`Lepas ${t.nama} dari agent ini`}
                  className="text-tinta-lemah hover:text-bahaya disabled:opacity-40"
                >
                  lepas
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {bisaDipasangLagi.length > 0 && (
        <div className="mt-4 border-t border-garis pt-3">
          <p className="text-xs font-medium">Dilepas dari agent ini</p>
          <p className="mt-1 text-xs text-tinta-lemah">
            Tool tim lain yang sengaja tidak dipasang portal ini. Ditampilkan supaya pelepasannya
            terbaca sebagai keputusan, bukan tool yang hilang entah ke mana.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bisaDipasangLagi.map((t) => (
              <span key={t.kode} className="flex items-center gap-2 rounded-lg border border-garis px-2.5 py-1 text-xs text-tinta-lemah">
                {t.nama}
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() => void kirim("POST", t.kode, "pasang-lagi")}
                  className="text-utama hover:brightness-110 disabled:opacity-40"
                >
                  pasang lagi
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {bisaDiputus.length > 0 && (
        <div className="mt-4 border-t border-garis pt-3">
          <p className="text-xs font-medium">Disambungkan dari sini</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bisaDiputus.map((t) => (
              <span
                key={t.kode}
                className="flex items-center gap-2 rounded-lg bg-kertas px-2.5 py-1 text-xs"
              >
                {t.nama}
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() => void kirim("DELETE", t.kode)}
                  aria-label={`Putus ${t.nama} dari agent ini`}
                  className="text-tinta-lemah hover:text-bahaya disabled:opacity-40"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {terpasang.some((t) => t.milikKita && !manual.includes(t.kode)) && (
        <p className="mt-3 text-xs leading-relaxed text-tinta-lemah">
          Tool lain milik portal ini menempel otomatis karena aplikasinya cocok dengan agent ini.
          Yang itu tidak bisa diputus dari sini &mdash; ubah aplikasinya lewat{" "}
          <code>npm run daftar:sumber-ai</code>.
        </p>
      )}
    </div>
  );
}
