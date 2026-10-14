import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bacaToken, NAMA_COOKIE } from "@/lib/sesi";
import { bolehAturAi } from "@/lib/admin";
import { ringkasTool, sumberPilihan, izinPilihan } from "@/lib/ubah-tool";
import { targetTulis } from "@/lib/tool-tulis-baru";
import { ringkasAgent, ringkasSumber, rincianAgent, rincianSumber } from "@/lib/kelola-ai";
import { Sambungan } from "./sambungan";
import { ToolBaru } from "./tool-baru";
import { DiagramRelasi } from "./diagram";
import { diagramRelasi } from "@/lib/diagram-relasi";
import { AturTool } from "./atur-tool";

/**
 * Pengaturan AI: agent, tool, dan sumber data.
 *
 * ⚠️ HALAMAN INI TIDAK MENJAGA APA PUN SENDIRI. Empat lapis yang menjaga:
 *   1. `proxy.ts` menyaring `/kelola-ai` dari token — cepat, tapi token memuat
 *      `departemen` yang baru berubah setelah 8 jam;
 *   2. pemeriksaan di bawah, ke database;
 *   3. `/api/admin/ai-tool` memeriksa lagi tiap permintaan — halaman ini cuma
 *      tampilan, dan route-nya bisa dipanggil langsung lewat curl;
 *   4. role `ai_konfig` cuma punya UPDATE pada kolom setelan `ai_tool`.
 *
 * ⚠️ DUA TAB HANYA TAMPILAN, dan itu disengaja. Role kita tidak punya hak
 * mengubah `ai_agent` maupun `ai_sumber_data` — mengubah agent berarti
 * mengubah perilaku sistem tim lain juga. Jadi tidak ada saklar yang digambar
 * di situ: keadaan ditampilkan sebagai keadaan, dengan keterangan di mana
 * mengubahnya.
 */

const TAB = [
  { id: "agent", label: "Agent" },
  { id: "tool", label: "Tool" },
  { id: "sumber", label: "Sumber data" },
] as const;

export default async function HalamanKelolaAi({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; agent?: string; sumber?: string }>;
}) {
  const sesi = await bacaToken((await cookies()).get(NAMA_COOKIE)?.value);
  if (!sesi) redirect("/login");
  if (!(await bolehAturAi(sesi.id))) redirect("/");

  const sp = await searchParams;
  const tab = TAB.some((t) => t.id === sp.tab) ? sp.tab! : "agent";

  return (
    <main className="mx-auto min-h-dvh max-w-5xl bg-kertas px-4 py-8">
      <header className="mb-5">
        <Link href="/" className="text-xs text-tinta-lemah hover:text-tinta">
          &larr; Kembali ke chat
        </Link>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">Kelola AI</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-tinta-lemah">
          Setelan di sini berlaku untuk{" "}
          <strong className="font-medium text-tinta">semua pemakai</strong>, bukan untuk akun kamu
          sendiri. Menaikkan cakupan sebuah tool berarti setiap orang yang memakai agent itu ikut
          melihat lebih banyak baris.
        </p>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-garis" aria-label="Bagian pengaturan">
        {TAB.map((t) => (
          <Link
            key={t.id}
            href={`/kelola-ai?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={
              tab === t.id
                ? "-mb-px border-b-2 border-utama px-3 py-2 text-sm font-semibold text-tinta"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-tinta-lemah hover:text-tinta"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "agent" && (sp.agent ? <RincianAgent kode={sp.agent} /> : <TabAgent />)}
      {tab === "tool" && (
        <div className="flex flex-col gap-4">
          <ToolBaru sumber={await sumberPilihan()} target={await targetTulis()} izin={await izinPilihan()} />
          <AturTool awal={await ringkasTool()} izin={await izinPilihan()} />
        </div>
      )}
      {tab === "sumber" && (sp.sumber ? <RincianSumber kode={sp.sumber} /> : <TabSumber />)}
    </main>
  );
}

async function TabAgent() {
  const agent = await ringkasAgent();

  return (
    <section>
      <h2 className="text-sm font-semibold tracking-tight">Agent</h2>
      <p className="mb-3 mt-1 text-sm text-tinta-lemah">
        Satu agent per aplikasi. Semuanya dibaca dari tabel konfigurasi saat portal dijalankan.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-garis bg-permukaan">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-garis text-left text-xs text-tinta-lemah">
              <th scope="col" className="px-4 py-2.5 font-medium">Agent</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Aplikasi</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Tool</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Aktif</th>
            </tr>
          </thead>
          <tbody>
            {agent.map((a) => (
              <tr key={a.kode} className="border-b border-garis align-top last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/kelola-ai?tab=agent&agent=${a.kode}`}
                    className="font-medium underline decoration-garis underline-offset-2 hover:decoration-tinta"
                  >
                    {a.nama}
                  </Link>
                  <p className="mt-0.5 text-xs text-tinta-lemah">{a.deskripsi}</p>
                </td>
                <td className="px-4 py-3">
                  {a.umum ? (
                    <span className="rounded-full bg-aksen px-2 py-0.5 text-[11px] text-aksen-teks">
                      lintas aplikasi
                    </span>
                  ) : (
                    <>
                      <span>{a.aplikasi}</span>
                      {a.aplikasiLain.length > 0 && (
                        <p className="mt-0.5 text-xs text-tinta-lemah">
                          + {a.aplikasiLain.join(", ")}
                        </p>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  {a.jumlahTool === 0 ? (
                    <span className="text-xs text-bahaya">belum ada</span>
                  ) : (
                    <>
                      <span className="rounded-full bg-kertas px-2 py-0.5 text-xs">
                        {a.jumlahTool}
                      </span>
                      {a.toolKita > 0 && (
                        <Link
                          href="/kelola-ai?tab=tool"
                          className="ml-2 text-xs text-tinta-lemah underline hover:text-tinta"
                        >
                          {a.toolKita} bisa diatur
                        </Link>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  {/* ⚠️ Keadaan, BUKAN saklar. Role kita tidak punya hak UPDATE
                      pada `ai_agent`; centang yang tidak mengubah apa pun lebih
                      buruk daripada tidak ada centang. */}
                  <span className={a.aktif ? "text-xs" : "text-xs text-tinta-lemah"}>
                    {a.aktif ? "aktif" : "dimatikan"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 border-l-2 border-garis pl-3 text-xs leading-relaxed text-tinta-lemah">
        Agent yang <strong className="text-tinta">belum punya tool</strong> ditandai
        terang-terangan. Agent tanpa tool tetap bisa dipanggil, tapi cuma bisa mengobrol &mdash; dia
        tidak punya cara mengambil data. Lebih baik kelihatan daripada user menemukannya sendiri
        setelah bertanya.
        <br />
        <br />
        Menyalakan, mematikan, atau menambah agent dilakukan di Admin Console sistem perusahaan.
        Portal ini sengaja tidak diberi hak mengubah <code>ai_agent</code>: agent yang sama dipakai
        sistem mereka, dan mengubahnya dari sini berarti mengubah perilaku mereka tanpa mereka tahu.
      </p>
    </section>
  );
}

async function TabSumber() {
  const sumber = await ringkasSumber();

  return (
    <section>
      <h2 className="text-sm font-semibold tracking-tight">Sumber data</h2>
      <p className="mb-3 mt-1 text-sm text-tinta-lemah">
        Tool tidak pernah menyentuh tabel asli &mdash; selalu lewat view yang terdaftar di sini.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-garis bg-permukaan">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-garis text-left text-xs text-tinta-lemah">
              <th scope="col" className="px-4 py-2.5 font-medium">Sumber</th>
              <th scope="col" className="px-4 py-2.5 font-medium">View</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Penyaring per-orang</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Dipakai</th>
            </tr>
          </thead>
          <tbody>
            {sumber.map((s) => (
              <tr key={s.kode} className="border-b border-garis align-top last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/kelola-ai?tab=sumber&sumber=${s.kode}`}
                    className="font-medium underline decoration-garis underline-offset-2 hover:decoration-tinta"
                  >
                    {s.nama}
                  </Link>
                  <p className="mt-0.5 font-mono text-xs text-tinta-lemah">{s.kode}</p>
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs">{s.view}</code>
                  {s.tabelAsal && (
                    <p className="mt-0.5 text-xs text-tinta-lemah">dari {s.tabelAsal}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {/* Inilah yang menentukan cakupan mana yang mungkin — dan
                      satu-satunya sebab tool tertentu tidak bisa disaring. */}
                  {s.penyaring.employee || s.penyaring.departemen || s.penyaring.perusahaan ? (
                    <div className="flex flex-wrap gap-1">
                      {s.penyaring.employee && (
                        <code className="rounded bg-aksen px-1.5 py-0.5 text-[11px] text-aksen-teks">
                          {s.penyaring.employee}
                        </code>
                      )}
                      {s.penyaring.departemen && (
                        <code className="rounded bg-kertas px-1.5 py-0.5 text-[11px]">
                          {s.penyaring.departemen}
                        </code>
                      )}
                      {s.penyaring.perusahaan && (
                        <code className="rounded bg-kertas px-1.5 py-0.5 text-[11px]">
                          {s.penyaring.perusahaan}
                        </code>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-bahaya">tidak ada</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-tinta-lemah">
                  {s.dipakai} tool
                  {s.milikKita && <span className="ml-1 text-tinta">&middot; portal ini</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 border-l-2 border-garis pl-3 text-xs leading-relaxed text-tinta-lemah">
        Sumber tanpa penyaring per-orang <strong className="text-tinta">tidak bisa</strong> dipakai
        tool bercakupan &ldquo;diri sendiri&rdquo; atau &ldquo;satu departemen&rdquo; &mdash;
        pilihannya tidak akan muncul di tab Tool. Itu bukan kelalaian: view-nya memang tidak membawa
        kolom yang menunjukkan baris itu milik siapa.
        <br />
        <br />
        Mendaftarkan view baru dilakukan lewat <code>npm run daftar:sumber-ai</code> untuk view
        portal ini, atau Admin Console untuk view sistem perusahaan.
      </p>
    </section>
  );
}

async function RincianAgent({ kode }: { kode: string }) {
  const r = await rincianAgent(kode);
  if (!r) {
    return (
      <p className="rounded-xl bg-bahaya-lemah p-4 text-sm text-bahaya">
        Agent <code>{kode}</code> tidak ada di konfigurasi.
      </p>
    );
  }

  return (
    <section>
      <Link href="/kelola-ai?tab=agent" className="text-xs text-tinta-lemah hover:text-tinta">
        &larr; Semua agent
      </Link>

      <h2 className="mt-3 text-base font-semibold tracking-tight">{r.agent.nama}</h2>
      <p className="mt-1 text-sm text-tinta-lemah">{r.agent.deskripsi}</p>
      <p className="mt-1 text-xs text-tinta-lemah">
        {r.agent.umum ? "Lintas aplikasi" : `Aplikasi: ${r.agent.aplikasi}`}
        {r.agent.aplikasiLain.length > 0 && ` + ${r.agent.aplikasiLain.join(", ")}`}
        {" · "}
        {r.agent.aktif ? "aktif" : "dimatikan"}
      </p>

      <h3 className="mt-5 text-sm font-semibold tracking-tight">
        Tool yang dipakai agent ini{" "}
        <span className="font-normal text-tinta-lemah">({r.tool.length})</span>
      </h3>
      {r.tool.length === 0 ? (
        <p className="mt-2 rounded-xl border border-garis bg-permukaan p-4 text-sm text-tinta-lemah">
          Agent ini belum punya tool. Dia tetap bisa dipanggil, tapi cuma bisa mengobrol &mdash;
          tidak punya cara mengambil data.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {r.tool.map((t) => (
            <li
              key={t.kode}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-garis bg-permukaan px-3 py-2 text-sm"
            >
              <span className="font-medium">{t.nama}</span>
              <code className="rounded bg-kertas px-1.5 py-0.5 text-[11px] text-tinta-lemah">
                {t.kode}
              </code>
              <span className="text-xs text-tinta-lemah">
                {t.jenis === "kode" ? `penangan ${t.penangan}` : `${t.operasi} · cakupan ${t.cakupan}`}
              </span>
              {/* ⚠️ Izin disebut DI SEBELAH cakupan, bukan cuma di tab Tool.
                  Daftar ini yang dibaca orang waktu bertanya "agent ini bisa
                  apa", dan "cakupan semua" tanpa keterangan izin terbaca
                  sebagai "terbuka untuk siapa saja" — yang kadang benar dan
                  kadang justru kebalikannya. */}
              {t.izin ? (
                <span className="rounded-lg bg-aksen px-1.5 py-0.5 text-[11px] text-aksen-teks">
                  butuh izin {t.izin}
                </span>
              ) : (
                t.cakupan === "semua" && (
                  <span className="rounded-lg bg-bahaya-lemah px-1.5 py-0.5 text-[11px] text-bahaya">
                    terbuka untuk semua
                  </span>
                )
              )}
              {t.sumberKode && (
                <Link
                  href={`/kelola-ai?tab=sumber&sumber=${t.sumberKode}`}
                  className="text-xs text-tinta-lemah underline decoration-garis underline-offset-2 hover:text-tinta"
                >
                  {t.view}
                </Link>
              )}
              {/* Dari mana tool ini menempel — pertanyaan pertama orang yang
                  melihat daftar ini dan bertanya "kenapa yang ini ada di sini". */}
              <span className="ml-auto text-[11px] text-tinta-lemah">
                {!t.milikKita
                  ? "bawaan sistem"
                  : r.manual.includes(t.kode)
                    ? "disambungkan dari sini"
                    : "menempel lewat aplikasi"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!r.agent.umum && (
        <div className="mt-4">
          <ToolBaru
            sumber={await sumberPilihan()}
            target={await targetTulis()}
            izin={await izinPilihan()}
            agent={r.agent.kode}
            namaAgent={r.agent.nama}
          />
        </div>
      )}

      {!r.agent.umum && (
        <Sambungan
          agent={r.agent.kode}
          bisaDitambah={r.bisaDitambah}
          manual={r.manual}
          terpasang={r.tool.map((t) => ({ kode: t.kode, nama: t.nama, milikKita: t.milikKita }))}
          bisaDipasangLagi={r.dilepas.map((k) => ({ kode: k, nama: k }))}
        />
      )}

      {r.agent.umum && (
        <p className="mt-4 border-l-2 border-garis pl-3 text-xs leading-relaxed text-tinta-lemah">
          Agent umum sengaja tidak boleh punya tool: dia perute, bukan penjawab. Memberinya tool
          membuat dia menjawab langsung, dan penyaring per-aplikasi jadi bisa dilewati.
        </p>
      )}
    </section>
  );
}

async function RincianSumber({ kode }: { kode: string }) {
  const r = await rincianSumber(kode);
  if (!r) {
    return (
      <p className="rounded-xl bg-bahaya-lemah p-4 text-sm text-bahaya">
        Sumber <code>{kode}</code> tidak terdaftar.
      </p>
    );
  }

  const tabel = r.asal.filter((a) => a.jenis === "tabel");
  const tanpaFk = tabel.filter((a) => a.foreignKey === 0);
  // Nama tabel datang dari penelusuran katalog, bukan dari masukan pemakai.
  const diagram = await diagramRelasi(tabel.map((a) => a.nama), r.sumber.tabelAsal);

  return (
    <section>
      <Link href="/kelola-ai?tab=sumber" className="text-xs text-tinta-lemah hover:text-tinta">
        &larr; Semua sumber data
      </Link>

      <h2 className="mt-3 text-base font-semibold tracking-tight">{r.sumber.nama}</h2>
      <p className="mt-1 text-sm text-tinta-lemah">
        View <code>{r.sumber.view}</code>
        {r.sumber.tabelAsal && <> &middot; tabel pokok {r.sumber.tabelAsal}</>}
      </p>

      {diagram && (
        <div className="mt-5">
          <DiagramRelasi d={diagram} judul={r.sumber.kode} />
        </div>
      )}

      <h3 className="mt-5 text-sm font-semibold tracking-tight">Dibaca dari</h3>
      <p className="mt-1 text-xs text-tinta-lemah">
        Ditelusuri dari katalog database lewat <code>pg_rewrite</code>, bukan ditulis tangan.
        Bertingkat, karena view pembungkus membaca view lain sebelum sampai ke tabelnya.
      </p>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-garis bg-permukaan">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-garis text-left text-xs text-tinta-lemah">
              <th scope="col" className="px-4 py-2.5 font-medium">Relasi</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Jenis</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Perkiraan baris</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Foreign key</th>
            </tr>
          </thead>
          <tbody>
            {r.asal.map((a) => (
              <tr key={a.nama} className="border-b border-garis last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs">{a.nama}</td>
                <td className="px-4 py-2.5 text-xs text-tinta-lemah">{a.jenis}</td>
                <td className="px-4 py-2.5 text-xs text-tinta-lemah">
                  {a.jenis === "view"
                    ? "—"
                    : a.perkiraanBaris === null
                      ? "belum pernah dianalisis"
                      : a.perkiraanBaris.toLocaleString("id-ID")}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {a.jenis === "view" ? (
                    <span className="text-tinta-lemah">&mdash;</span>
                  ) : a.foreignKey === 0 ? (
                    <span className="text-bahaya">0</span>
                  ) : (
                    a.foreignKey
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tanpaFk.length > 0 && (
        <p className="mt-3 border-l-2 border-bahaya pl-3 text-xs leading-relaxed text-tinta-lemah">
          <strong className="text-tinta">
            {tanpaFk.length} dari {tabel.length} tabel di atas punya NOL foreign key
          </strong>{" "}
          ({tanpaFk.map((a) => a.nama).join(", ")}). Artinya hubungan antar-tabelnya tidak
          ditegakkan database: kolom rujukan yang isinya karangan akan diterima tanpa protes.
          Itu sebabnya tool yang memvalidasi, bukan database &mdash; dan sebabnya kolom rujukan
          harus dipilih dari daftar, tidak boleh diketik model.
        </p>
      )}

      <h3 className="mt-5 text-sm font-semibold tracking-tight">
        Kolom yang tersedia{" "}
        <span className="font-normal text-tinta-lemah">({r.kolom.length})</span>
      </h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {r.kolom.map((k) => (
          <span key={k.nama} className="rounded-lg border border-garis px-2.5 py-1 text-xs">
            <span className="font-mono">{k.nama}</span>
            <span className="ml-1.5 text-tinta-lemah">{k.tipe}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-tinta-lemah">
        Penyaring per-orang:{" "}
        {r.sumber.penyaring.employee ?? r.sumber.penyaring.departemen ?? "tidak ada"}
        {r.sumber.penyaring.employee === null && r.sumber.penyaring.departemen === null && (
          <> &mdash; jadi tool dari sumber ini hanya bisa bercakupan seluruh perusahaan.</>
        )}
      </p>

      <h3 className="mt-5 text-sm font-semibold tracking-tight">
        Dipakai {r.dipakai.length} tool
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {r.dipakai.map((t) => (
          <li
            key={`${t.agent}:${t.kode}`}
            className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-garis bg-permukaan px-3 py-2 text-sm"
          >
            <span className="font-medium">{t.nama}</span>
            <code className="rounded bg-kertas px-1.5 py-0.5 text-[11px] text-tinta-lemah">
              {t.kode}
            </code>
            <span className="text-xs text-tinta-lemah">cakupan {t.cakupan}</span>
            {t.agent && <span className="ml-auto text-xs text-tinta-lemah">{t.agent}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
