import type { AgentTampil } from "@/lib/daftar-agent";

/**
 * Rail agent per aplikasi di tepi kiri.
 *
 * Mengikuti rail aplikasi di portal perusahaan: kolom sempit berisi kotak
 * ikon, satu per aplikasi. Bedanya di sini satu kotak = satu agent.
 *
 * ⚠️ TIDAK ADA `href` KE MANA PUN, dan itu disengaja.
 *
 * Agent dipilih AGENT UMUM dari isi pertanyaan, bukan oleh pemakai lewat
 * tombol — itu inti rancangannya. Kotak-kotak ini memberi tahu agent apa saja
 * yang ada dan mana yang terbuka; membuatnya bisa diklik akan menjanjikan
 * perpindahan yang belum ada. Judul (`title`) memuat keterangannya supaya
 * tetap bisa dibaca tanpa mengarang tautan.
 */

/**
 * Warna kotak per agent.
 *
 * ⚠️ DIPETAKAN DARI KODE AGENT, BUKAN DARI URUTAN. Daftar ini diurutkan ulang
 * (yang terbuka naik ke atas), jadi warna berdasarkan posisi akan berpindah
 * tiap kali akses seseorang berubah — dan orang yang sudah hafal "yang biru
 * itu Super Tools" jadi salah terus.
 *
 * Agent baru yang belum terdaftar di sini jatuh ke `--utama`, bukan ke warna
 * acak: lebih baik dua agent berbagi warna daripada warnanya berganti sendiri
 * setiap daftar berubah.
 */
const WARNA: Record<string, string> = {
  "agent-portal": "var(--agent-portal)",
  "agent-hr": "var(--agent-hr)",
  "agent-supertools": "var(--agent-supertools)",
  "agent-admin": "var(--agent-admin)",
  "agent-maps": "var(--agent-maps)",
  "agent-marketing": "var(--agent-marketing)",
  "agent-cmod": "var(--agent-cmod)",
  "agent-report": "var(--agent-report)",
};

/** Dua huruf dari nama agent, tanpa kata "Ratu AI" yang sama di semuanya. */
function inisial(nama: string): string {
  const inti = nama.replace(/^Ratu\s+AI\s*/i, "").trim() || nama;
  const kata = inti.split(/\s+/).filter(Boolean);
  const dua = kata.length >= 2 ? kata[0][0] + kata[1][0] : inti.slice(0, 2);
  return dua.toUpperCase();
}

export function RailAgent({ agent, terbuka }: { agent: AgentTampil[]; terbuka: number }) {
  if (agent.length === 0) return null;

  return (
    <aside
      className="hidden shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-garis bg-permukaan py-3 shadow-kecil md:flex"
      style={{ width: "4.25rem" }}
      aria-label={`Agent per aplikasi — ${terbuka} dari ${agent.length} terbuka`}
    >
      <span className="px-1 text-center text-[9px] font-semibold uppercase tracking-wider text-tinta-lemah">
        Agent
      </span>
      <span className="text-[10px] font-medium text-tinta-lemah">
        {terbuka}/{agent.length}
      </span>

      <span className="my-1 h-px w-7 bg-garis" />

      {agent.map((a) => {
        const ket = a.terbuka
          ? `${a.nama} — ${a.jumlahTool} tool. ${a.deskripsi ?? ""}`.trim()
          : `${a.nama} — perlu akses aplikasinya. ${a.deskripsi ?? ""}`.trim();
        return (
          <span
            key={a.kode}
            title={ket}
            className={
              a.terbuka
                ? "relative flex size-10 items-center justify-center rounded-xl text-[11px] font-bold"
                : "relative flex size-10 items-center justify-center rounded-xl border border-dashed border-garis text-[11px] font-bold text-tinta-lemah"
            }
            style={
              a.terbuka
                ? { background: WARNA[a.kode] ?? "var(--utama)", color: "var(--agent-teks)" }
                : undefined
            }
          >
            <span aria-hidden>{inisial(a.nama)}</span>
            <span className="sr-only">{ket}</span>

            {/* Agent yang terbuka tapi belum punya tool cuma bisa mengobrol.
                Ditandai supaya tidak terlihat sama dengan yang siap pakai. */}
            {a.terbuka && a.jumlahTool === 0 && (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-permukaan bg-bahaya"
              />
            )}

            {!a.terbuka && (
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden
                className="absolute -bottom-1 -right-1 size-4 rounded-full bg-permukaan p-0.5 text-tinta-lemah"
              >
                <path
                  d="M6 9V6.5a4 4 0 0 1 8 0V9M5.5 9h9A1.5 1.5 0 0 1 16 10.5v5A1.5 1.5 0 0 1 14.5 17h-9A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        );
      })}
    </aside>
  );
}
