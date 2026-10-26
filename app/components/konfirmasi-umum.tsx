"use client";

import { useState } from "react";

type Perubahan = { kolom: string; label: string; dari: string; jadi: string };
type Keterangan = { kolom: string; label: string; nilai: string };

export type DrafUmum = {
  kode: string;
  draf: {
    kode: string;
    operasi: string;
    tabel: string;
    kunci: Record<string, string>;
    judulBaris: string;
    /**
     * Keterangan baris yang disentuh. Bisa KOSONG atau tidak ada sama sekali
     * pada rancangan yang tersimpan sebelum 13 Okt 2026 — dibaca dengan `?? []`
     * supaya riwayat percakapan lama tetap bisa dibuka.
     */
    keterangan?: Keterangan[];
    /** Kolom yang nilainya baru dibuat saat menyimpan (mis. nomor tiket). */
    dibangkitkan?: { kolom: string; label: string }[];
    perubahan: Perubahan[];
  };
  sidik: string;
  permintaan: Record<string, string | undefined>;
};

/**
 * Kartu konfirmasi untuk tool tulis buatan layar Kelola AI.
 *
 * ⚠️ SATU KARTU UNTUK SEMUANYA, dan itu memang bisa karena yang ditampilkan
 * selalu bentuk yang sama: baris mana yang disentuh, dan apa yang berubah
 * padanya. Kartu khusus tiket menampilkan kategori dan prioritas karena ia
 * tahu bentuk tiket; kartu ini tidak tahu, jadi ia menampilkan `dari → jadi`
 * apa adanya — yang justru lebih jujur untuk operasi yang belum pernah dilihat
 * siapa pun sebelumnya.
 *
 * ⚠️ Tombol ini yang menyimpan, bukan model.
 */
export function KonfirmasiUmum({ data }: { data: DrafUmum }) {
  const [status, setStatus] = useState<"siap" | "menyimpan" | "tersimpan" | "gagal" | "batal">("siap");
  const [pesan, setPesan] = useState("");
  // Satu pertanyaan, dipakai di empat tempat: ini baris BARU atau baris lama?
  const baru = data.draf.operasi === "tambah";

  async function simpan() {
    if (status !== "siap") return;
    setStatus("menyimpan");
    setPesan("");
    try {
      const r = await fetch("/api/entri/umum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kode: data.kode, masukan: data.permintaan, sidik: data.sidik }),
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
        <p className="font-medium">✓ {data.draf.judulBaris} {baru ? "disimpan" : "diperbarui"}</p>
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
        Dibatalkan &mdash; tidak ada yang berubah.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-permukaan/60 shadow-kecil ring-1 ring-garis/60">
      <div className="border-b border-garis/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-tinta-lemah">
          {baru ? "Belum tersimpan — periksa isiannya" : "Belum tersimpan — periksa perubahannya"}
        </p>
        <p className="mt-0.5 text-xs text-tinta-lemah">
          <span className="font-mono text-tinta">{data.draf.judulBaris}</span> &middot;{" "}
          {data.draf.tabel}
        </p>
      </div>

      {/* ⚠️ KETERANGAN DULU, BARU PERUBAHAN — urutannya bukan selera.
          Orang perlu tahu baris INI yang mana sebelum memutuskan apa yang
          boleh terjadi padanya. Kartu pertama (13 Okt 2026) cuma menampilkan
          nomor tiket dan `OPEN -> CANCELLED`: benar, tapi menyuruh orang
          membatalkan sesuatu tanpa memberi tahu sesuatu itu apa. */}
      {(data.draf.keterangan ?? []).length > 0 && (
        <dl className="space-y-2 border-b border-garis/50 bg-kertas/40 px-4 py-3 text-sm">
          {(data.draf.keterangan ?? []).map((k) => (
            <div key={k.kolom}>
              <dt className="text-xs font-medium text-tinta-lemah">{k.label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{k.nilai}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-3 px-4 py-3 text-sm">
        {/* ⚠️ `tambah` TIDAK menampilkan nilai lama yang dicoret. Belum ada baris
            lama, jadi coretan di atas "(kosong)" cuma mengaku sesuatu diganti
            padahal tidak ada yang diganti. Untuk `ubah`, coretan itu justru
            inti kartunya. */}
        {data.draf.perubahan.map((p) => (
          <div key={p.kolom}>
            <p className="text-xs font-medium text-tinta-lemah">{p.label}</p>
            {!baru && (
              <p className="mt-0.5 whitespace-pre-wrap text-tinta-lemah line-through decoration-garis">
                {p.dari || "(kosong)"}
              </p>
            )}
            <p className="mt-0.5 whitespace-pre-wrap font-medium">{p.jadi}</p>
          </div>
        ))}

        {/* Kolom yang nilainya baru lahir saat disimpan. Disebutkan supaya
            tidak terlihat seperti ada yang terlewat diisi — dan supaya tidak
            ada yang menunggu nomornya muncul di kartu. */}
        {(data.draf.dibangkitkan ?? []).map((b) => (
          <div key={b.kolom}>
            <p className="text-xs font-medium text-tinta-lemah">{b.label}</p>
            <p className="mt-0.5 italic text-tinta-lemah">dibuat otomatis saat disimpan</p>
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
