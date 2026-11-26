import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bacaToken, NAMA_COOKIE } from "@/lib/sesi";
import { bolehAturAi } from "@/lib/admin";
import {
  bacaRapor, masukRentang, meleset, ringkas, URUTAN_VOLUME,
  type JenisRapor, type ProdukRapor, type Ringkasan,
} from "@/lib/ramalan/rapor";

/**
 * Rapor ketepatan ramalan: ramalan yang dibuat seolah di masa lalu, dicocokkan dengan penjualan
 * yang sebenarnya terjadi.
 *
 * ⚠️ Isinya angka penjualan per produk, jadi hanya untuk departemen Marketing dan pengatur AI.
 * Datanya dari berkas yang dibuat `scripts/buat-rapor-ramalan.mts`, bukan dihitung di sini.
 */

const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const namaBulan = (b: string) => { const [t, m] = b.split("-"); return `${NAMA_BULAN[Number(m) - 1]} ${t}`; };
const angka = (n: number) => Math.round(n).toLocaleString("id-ID");
const persen = (n: number | null) => (n === null ? "–" : `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);

const LABEL_VOLUME: Record<string, string> = {
  laris: "Laris (≥1.000 unit/bulan)",
  sedang: "Sedang (100–999)",
  kecil: "Kecil (<100)",
};

const URUT = [
  { id: "laris", label: "Penjualan terbesar" },
  { id: "meleset", label: "Paling meleset" },
  { id: "tepat", label: "Paling tepat" },
] as const;

export default async function HalamanRaporRamalan({
  searchParams,
}: {
  searchParams: Promise<{ jarak?: string; urut?: string; cari?: string; volume?: string }>;
}) {
  const sesi = await bacaToken((await cookies()).get(NAMA_COOKIE)?.value);
  if (!sesi) redirect("/login");
  if (sesi.departemen !== "marketing" && !(await bolehAturAi(sesi.id))) redirect("/");

  const sp = await searchParams;
  const jenis: JenisRapor = sp.jarak === "dekat" ? "dekat" : "sekarang";
  const urut = URUT.some((u) => u.id === sp.urut) ? sp.urut! : "laris";
  const cari = (sp.cari ?? "").trim().toLowerCase();
  const volume = URUTAN_VOLUME.find((v) => v === sp.volume);
  const rapor = await bacaRapor(jenis);

  const tautan = (ubah: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const isi = { jarak: jenis, urut, cari: sp.cari, volume, ...ubah };
    for (const [k, v] of Object.entries(isi)) if (v) q.set(k, v);
    return `/rapor-ramalan?${q}`;
  };

  return (
    <main className="mx-auto min-h-dvh max-w-5xl bg-kertas px-4 py-8">
      <header className="mb-6">
        <Link href="/" className="text-xs text-tinta-lemah hover:text-tinta">&larr; Kembali ke chat</Link>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">Rapor ketepatan ramalan</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-tinta-lemah">
          Ramalan dibuat dengan cara yang sama seperti di chat, tetapi seolah-olah datanya hanya sampai bulan
          tertentu. Lalu angkanya dicocokkan dengan penjualan yang sebenarnya terjadi. Dari sini terlihat seberapa
          jauh ramalan biasanya meleset.
        </p>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Jarak ramalan">
        {([
          ["sekarang", "Jarak 3–5 bulan, seperti ramalan di chat sekarang"],
          ["dekat", "Jarak 1–3 bulan"],
        ] as const).map(([id, label]) => (
          <Link
            key={id}
            href={tautan({ jarak: id })}
            aria-current={jenis === id ? "page" : undefined}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
              jenis === id ? "border-utama bg-utama text-utama-teks" : "border-garis text-tinta-lemah hover:text-tinta"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {!rapor ? (
        <div className="rounded-2xl border border-garis bg-permukaan p-5 text-sm leading-relaxed">
          Rapor untuk jarak ini belum dibuat. Jalankan:
          <pre className="mt-2 overflow-x-auto rounded-lg bg-kertas p-3 text-xs">
            npx tsx --env-file=.env.local scripts/buat-rapor-ramalan.mts {jenis}
          </pre>
        </div>
      ) : (
        <Isi rapor={rapor} urut={urut} cari={cari} volume={volume} tautan={tautan} cariAwal={sp.cari ?? ""} />
      )}
    </main>
  );
}

function Isi({
  rapor, urut, cari, volume, tautan, cariAwal,
}: {
  rapor: NonNullable<Awaited<ReturnType<typeof bacaRapor>>>;
  urut: string;
  cari: string;
  volume: string | undefined;
  tautan: (u: Record<string, string | undefined>) => string;
  cariAwal: string;
}) {
  const semua = ringkas(rapor.produk);
  const perVolume = URUTAN_VOLUME.map((v) => ({ v, r: ringkas(rapor.produk.filter((p) => p.volume === v)) }));

  const total = (p: ProdukRapor) => p.unit.aktual.reduce((a, b) => a + b, 0);
  const mel = (p: ProdukRapor) => meleset(p.unit.ramalan, p.unit.aktual);
  let daftar = rapor.produk.filter((p) =>
    (!volume || p.volume === volume) &&
    (!cari || p.nama.toLowerCase().includes(cari) || p.sku.toLowerCase().includes(cari) || (p.merek ?? "").toLowerCase().includes(cari)));
  daftar = [...daftar].sort((a, b) => {
    if (urut === "laris") return total(b) - total(a);
    const ma = mel(a), mb = mel(b);
    if (ma === null) return 1;
    if (mb === null) return -1;
    return urut === "meleset" ? mb - ma : ma - mb;
  });
  const ditampilkan = daftar.slice(0, 100);

  return (
    <>
      <p className="mb-4 text-sm leading-relaxed">
        Data dipotong sampai <b>{namaBulan(rapor.dataSampai)}</b>, lalu diramal{" "}
        <b>{rapor.bulanDiuji.map(namaBulan).join(", ")}</b>. Ada {angka(rapor.jumlah.diramal)} produk yang diramal.{" "}
        {rapor.jumlah.berhenti > 0 && <>{angka(rapor.jumlah.berhenti)} produk lain dianggap sudah berhenti terjual, jadi tidak diramal.</>}
      </p>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ubin
          judul="Rata-rata meleset"
          nilai={persen(semua.meleset)}
          ket={`Kalau angka bulan terakhir diulang saja: ${persen(semua.melesetUlang)}`}
        />
        <Ubin
          judul="Masuk rentang"
          nilai={persen(semua.masukRentang)}
          ket="Target sekitar 80% dari bulan-produk"
        />
        <Ubin
          judul="Total semua produk"
          nilai={semua.selisihTotal === null ? "–" : `${semua.selisihTotal > 0 ? "+" : ""}${persen(semua.selisihTotal)}`}
          ket={`Ramalan ${angka(semua.totalRamalan)} unit, sebenarnya ${angka(semua.totalAktual)} unit`}
        />
        <Ubin
          judul="Meleset di bawah 25%"
          nilai={`${angka(semua.cukupTepat)} produk`}
          ket={`dari ${angka(semua.produk)} produk`}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Menurut besar penjualan produk</h2>
        <div className="overflow-x-auto rounded-2xl border border-garis">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-permukaan text-left text-xs text-tinta-lemah">
              <tr>
                <th className="px-3 py-2 font-medium">Kelompok</th>
                <th className="px-3 py-2 text-right font-medium">Produk</th>
                <th className="px-3 py-2 text-right font-medium">Meleset</th>
                <th className="px-3 py-2 text-right font-medium">Ulang bulan terakhir</th>
                <th className="px-3 py-2 text-right font-medium">Masuk rentang</th>
                <th className="px-3 py-2 text-right font-medium">Total ramalan vs sebenarnya</th>
              </tr>
            </thead>
            <tbody>
              {perVolume.map(({ v, r }) => <BarisVolume key={v} label={LABEL_VOLUME[v]} r={r} />)}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-tinta-lemah">
          &ldquo;Meleset&rdquo; adalah jumlah selisih ramalan dengan penjualan sebenarnya, dibagi penjualan sebenarnya.
          Kolom &ldquo;ulang bulan terakhir&rdquo; adalah pembanding: hasilnya kalau penjualan bulan terakhir diulang saja.
          Kalau ramalan tidak lebih kecil melesetnya daripada pembanding ini, ramalannya belum memberi nilai tambah.
        </p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-sm font-semibold">Per produk</h2>
          <form action="/rapor-ramalan" className="flex gap-2">
            <input type="hidden" name="jarak" value={rapor.jenis} />
            <input type="hidden" name="urut" value={urut} />
            {volume && <input type="hidden" name="volume" value={volume} />}
            <input
              name="cari"
              defaultValue={cariAwal}
              placeholder="Cari produk atau merek"
              className="w-48 rounded-xl border border-garis bg-kertas px-3 py-1.5 text-xs"
            />
            <button className="rounded-xl border border-garis px-3 py-1.5 text-xs">Cari</button>
          </form>
        </div>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {URUT.map((u) => (
            <Link key={u.id} href={tautan({ urut: u.id })}
              className={`rounded-lg px-2 py-1 ${urut === u.id ? "bg-permukaan font-medium text-tinta" : "text-tinta-lemah hover:text-tinta"}`}>
              {u.label}
            </Link>
          ))}
          <span className="mx-1 text-garis">|</span>
          <Link href={tautan({ volume: undefined })}
            className={`rounded-lg px-2 py-1 ${!volume ? "bg-permukaan font-medium text-tinta" : "text-tinta-lemah hover:text-tinta"}`}>
            Semua
          </Link>
          {URUTAN_VOLUME.map((v) => (
            <Link key={v} href={tautan({ volume: v })}
              className={`rounded-lg px-2 py-1 capitalize ${volume === v ? "bg-permukaan font-medium text-tinta" : "text-tinta-lemah hover:text-tinta"}`}>
              {v}
            </Link>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-garis">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-permukaan text-left text-xs text-tinta-lemah">
              <tr>
                <th className="px-3 py-2 font-medium">Produk</th>
                {rapor.bulanDiuji.map((b) => (
                  <th key={b} className="px-3 py-2 text-right font-medium">
                    {namaBulan(b)}
                    <span className="block font-normal">ramalan / sebenarnya</span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Meleset</th>
                <th className="px-3 py-2 text-right font-medium">Masuk rentang</th>
              </tr>
            </thead>
            <tbody>
              {ditampilkan.map((p) => <BarisProduk key={p.sku} p={p} />)}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-tinta-lemah">
          Menampilkan {angka(ditampilkan.length)} dari {angka(daftar.length)} produk.
          {daftar.length > ditampilkan.length && " Gunakan pencarian untuk produk lain."}
        </p>
      </section>

      <p className="mt-8 text-xs leading-relaxed text-tinta-lemah">
        Rapor dibuat {new Date(rapor.dibuat).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}. Angka yang
        diuji adalah jumlah unit. Pola bulanan dihitung hanya dari data sampai {namaBulan(rapor.dataSampai)}, jadi
        rapor ini tidak memakai bulan yang sedang diuji.
      </p>
    </>
  );
}

function Ubin({ judul, nilai, ket }: { judul: string; nilai: string; ket: string }) {
  return (
    <div className="rounded-2xl border border-garis bg-permukaan p-4">
      <p className="text-xs text-tinta-lemah">{judul}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{nilai}</p>
      <p className="mt-1 text-xs leading-snug text-tinta-lemah">{ket}</p>
    </div>
  );
}

function BarisVolume({ label, r }: { label: string; r: Ringkasan }) {
  const lebihBaik = r.meleset !== null && r.melesetUlang !== null && r.meleset < r.melesetUlang;
  return (
    <tr className="border-t border-garis">
      <td className="px-3 py-2">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{angka(r.produk)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{persen(r.meleset)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {persen(r.melesetUlang)}
        {r.meleset !== null && r.melesetUlang !== null && (
          <span className="ml-1 text-xs text-tinta-lemah">{lebihBaik ? "(ramalan lebih baik)" : "(ramalan tidak lebih baik)"}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{persen(r.masukRentang)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {r.selisihTotal === null ? "–" : `${r.selisihTotal > 0 ? "+" : ""}${persen(r.selisihTotal)}`}
      </td>
    </tr>
  );
}

function BarisProduk({ p }: { p: ProdukRapor }) {
  const m = meleset(p.unit.ramalan, p.unit.aktual);
  const rentang = masukRentang(p.unit);
  return (
    <tr className="border-t border-garis align-top">
      <td className="px-3 py-2">
        <p className="font-medium leading-snug">{p.nama}</p>
        <p className="text-xs text-tinta-lemah">{p.model}{p.polaBulanan ? " · ikut pola bulanan" : ""}</p>
      </td>
      {p.unit.ramalan.map((r, i) => (
        <td key={i} className="px-3 py-2 text-right tabular-nums"
          title={p.unit.bawah[i] !== undefined ? `Rentang ${angka(p.unit.bawah[i])}–${angka(p.unit.atas[i])}` : undefined}>
          {angka(r)} <span className="text-tinta-lemah">/ {angka(p.unit.aktual[i])}</span>
        </td>
      ))}
      <td className="px-3 py-2 text-right tabular-nums font-medium">{persen(m)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{rentang ? `${rentang.masuk} dari ${rentang.dari} bulan` : "–"}</td>
    </tr>
  );
}
