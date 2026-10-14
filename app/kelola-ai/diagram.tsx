import type { Diagram, Lambang } from "@/lib/diagram-relasi";
import { UKURAN } from "@/lib/diagram-relasi";

/**
 * Diagram relasi tabel, digambar SVG dari koordinat yang dihitung server.
 *
 * ⚠️ SVG, bukan kotak HTML + garis. Garis penghubung butuh koordinat dua
 * titik yang pasti; dengan tata letak HTML, posisinya baru diketahui setelah
 * peramban menggambar — dan garisnya akan meleset di lebar layar yang berbeda.
 *
 * Warna kotak memakai token tema, jadi diagramnya ikut mode gelap tanpa versi
 * kedua.
 */

const WARNA: Record<Lambang, { latar: string; teks: string }> = {
  PK: { latar: "var(--utama)", teks: "var(--utama-teks)" },
  id: { latar: "var(--aksen)", teks: "var(--aksen-teks)" },
  AZ: { latar: "var(--kertas)", teks: "var(--tinta-lemah)" },
  tgl: { latar: "var(--kertas)", teks: "var(--tinta-lemah)" },
  "y/n": { latar: "var(--kertas)", teks: "var(--tinta-lemah)" },
  "{}": { latar: "var(--kertas)", teks: "var(--tinta-lemah)" },
  "123": { latar: "var(--kertas)", teks: "var(--tinta-lemah)" },
};

export function DiagramRelasi({ d, judul }: { d: Diagram; judul: string }) {
  const { BARIS, KEPALA } = UKURAN;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-lemah">
        <span>Relasi tabel &mdash; {judul}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {(["PK", "id", "AZ", "tgl"] as Lambang[]).map((l) => (
            <span key={l} className="flex items-center gap-1">
              <span
                className="rounded px-1 py-0.5 text-[9px] font-semibold"
                style={{ background: WARNA[l].latar, color: WARNA[l].teks }}
              >
                {l}
              </span>
              {l === "PK" ? "kunci utama" : l === "id" ? "rujukan" : l === "AZ" ? "teks" : "waktu"}
            </span>
          ))}
        </span>
      </figcaption>

      <div className="overflow-x-auto rounded-2xl border border-garis bg-permukaan p-3">
        <svg
          viewBox={`-2 -2 ${d.lebar + 4} ${d.tinggi + 4}`}
          width={d.lebar + 4}
          style={{ maxWidth: "100%", height: "auto" }}
          role="img"
          aria-label={`Diagram relasi ${d.kotak.length} tabel di balik ${judul}`}
        >
          <defs>
            <marker id="panah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--utama)" />
            </marker>
          </defs>

          {/* Garis digambar DULU supaya lewat di belakang kotak. */}
          {d.garis.map((g, i) => {
            const dx = Math.max(28, Math.abs(g.ke.x - g.dari.x) / 2);
            const arah = g.ke.x >= g.dari.x ? 1 : -1;
            return (
              <path
                key={i}
                d={`M ${g.dari.x} ${g.dari.y} C ${g.dari.x + dx * arah} ${g.dari.y}, ${g.ke.x - dx * arah} ${g.ke.y}, ${g.ke.x} ${g.ke.y}`}
                fill="none"
                stroke="var(--utama)"
                strokeWidth={1.3}
                /* Garis putus-putus = relasi yang cuma DISIMPULKAN dari
                   kesamaan nama kolom, bukan foreign key yang ditegakkan. */
                strokeDasharray={g.foreignKey ? undefined : "4 3"}
                opacity={0.55}
                markerEnd="url(#panah)"
              />
            );
          })}

          {d.kotak.map((k) => (
            <g key={k.tabel}>
              <rect
                x={k.x}
                y={k.y}
                width={k.lebar}
                height={k.tinggi}
                rx={10}
                fill="var(--permukaan)"
                stroke={k.pokok ? "var(--utama)" : "var(--garis)"}
                strokeWidth={k.pokok ? 1.6 : 1}
              />
              <rect
                x={k.x}
                y={k.y}
                width={k.lebar}
                height={KEPALA}
                rx={10}
                fill={k.pokok ? "var(--aksen)" : "var(--kertas)"}
              />
              <rect
                x={k.x}
                y={k.y + KEPALA - 10}
                width={k.lebar}
                height={10}
                fill={k.pokok ? "var(--aksen)" : "var(--kertas)"}
              />
              <text
                x={k.x + 10}
                y={k.y + 20}
                fontSize={11.5}
                fontWeight={600}
                fill={k.pokok ? "var(--aksen-teks)" : "var(--tinta)"}
              >
                {k.tabel}
                {k.perkiraanBaris !== null && (
                  <tspan fontWeight={400} opacity={0.7}>
                    {" "}
                    &middot; ~{k.perkiraanBaris.toLocaleString("id-ID")}
                  </tspan>
                )}
              </text>

              {k.kolom.map((c, i) => {
                const y = k.y + KEPALA + i * BARIS;
                const w = WARNA[c.lambang];
                return (
                  <g key={c.nama}>
                    <rect x={k.x + 8} y={y + 3.5} width={20} height={12} rx={3} fill={w.latar} />
                    <text
                      x={k.x + 18}
                      y={y + 12.5}
                      fontSize={7.5}
                      fontWeight={600}
                      textAnchor="middle"
                      fill={w.teks}
                    >
                      {c.lambang}
                    </text>
                    <text
                      x={k.x + 33}
                      y={y + 13}
                      fontSize={10}
                      fontFamily="var(--font-mono)"
                      fill={c.lambang === "PK" || c.lambang === "id" ? "var(--tinta)" : "var(--tinta-lemah)"}
                    >
                      {c.nama.length > 22 ? `${c.nama.slice(0, 21)}…` : c.nama}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      {d.tanpaFk.length > 0 && (
        <p className="mt-2 border-l-2 border-bahaya pl-3 text-xs leading-relaxed text-tinta-lemah">
          Garis putus-putus di diagram ini <strong className="text-tinta">bukan foreign key</strong>
          &nbsp;&mdash; {d.tanpaFk.join(", ")} punya nol foreign key. Relasinya disimpulkan dari
          kesamaan nama kolom dengan kunci utama tabel lain, dan itulah sebabnya tool yang harus
          memvalidasi: database akan menerima id karangan tanpa protes.
        </p>
      )}
    </figure>
  );
}
