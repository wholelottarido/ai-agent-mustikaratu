/**
 * Pabrik agent dari tabel konfigurasi.
 *
 * Satu baris `ai_agent` jadi satu Agent VoltAgent, tool-nya dirakit
 * `tool-konfigurasi.ts`, dan `agent-general` jadi atasan yang meneruskan ke
 * agent aplikasi.
 *
 * ⚠️ INSTRUKSI TETAP DI KODE, BUKAN DI DATABASE. Dan itu disengaja.
 *
 * `ai_agent` cuma punya `deskripsi` satu kalimat. Isi instruksi yang panjang
 * -- cara menjawab, larangan mengarang, format untuk WhatsApp -- adalah aturan
 * keselamatan, bukan setelan yang enak diubah lewat borang. Kalau dia pindah
 * ke kolom teks, satu salah ketik administrator bisa membuat seluruh agent
 * berhenti menyebut sumber, atau mulai menebak angka, tanpa satu pun uji yang
 * gagal.
 *
 * Yang datang dari database: agent apa saja yang ada, tool apa saja yang dia
 * punya, dan data apa yang boleh dibacanya. Yang tetap di kode: bagaimana dia
 * harus berperilaku.
 *
 * ⚠️ AGENT DI SINI TIDAK BOLEH DI-CACHE ANTAR PENGGUNA.
 *
 * Tool-nya terikat `SesiPemakai` -- `id_employee` yang jadi penyaring baris
 * ada di dalamnya. Satu instance yang dipakai ulang berarti penyaring orang
 * pertama ikut dipakai orang kedua. Jalur lama menyimpan agent di globalThis
 * karena agent-nya cuma bergantung pada departemen; yang ini tidak boleh.
 */
import { Agent } from "@voltagent/core";
import type { KonfigAgent, KonfigTool } from "@/lib/ai-konfig";
import { muatKonfig } from "@/lib/ai-konfig";
import { buatToolDariKonfig, type CatatSumber, type SesiPemakai } from "./tool-konfigurasi";
import { namaUntukModel, type CatatRancangan } from "./registry-tulis";
import { pilihModel, KUNCI_MODEL, KUNCI_SALURAN } from "./agents";

export type Saluran = "web" | "wa";

/** Sama dengan jalur lama: 5 langkah bawaan VoltAgent terlalu sedikit. */
const MAKS_LANGKAH = 12;

function daftarTool(tool: KonfigTool[]): string {
  if (tool.length === 0) return "Kamu TIDAK punya tool apa pun. Lihat aturan di bawah.";
  return tool
    .map((t) => {
      const contoh = t.contoh ? `\n  Contoh pertanyaan: "${t.contoh}"` : "";
      const cakupan =
        t.cakupan === "semua"
          ? "seluruh perusahaan"
          : t.cakupan === "diri"
            ? "HANYA data penanya sendiri"
            : `tingkat ${t.cakupan}`;
      // ⚠️ Nama yang DILIHAT MODEL, bukan kode barisnya. Tool tulis dipegang
      // model dengan nama lain (`buat_tiket` -> `siapkan_tiket`), dan menyebut
      // kode barisnya membuat model memanggil nama yang tidak ada.
      return `- \`${namaUntukModel(t)}\` — ${t.deskripsi}\n  Cakupan: ${cakupan}.${contoh}`;
    })
    .join("\n");
}

function instruksi(k: KonfigAgent, tool: KonfigTool[], saluran: Saluran): string {
  const tabel =
    saluran === "wa"
      ? "JANGAN memakai tabel markdown — WhatsApp tidak bisa menampilkannya, dan yang sampai ke user cuma pagar `|---|`. Pakai daftar bernomor."
      : "Boleh memakai tabel markdown untuk hasil yang berkolom.";

  return `Kamu ${k.nama}. ${k.deskripsi ?? ""}

## Tool yang kamu punya

${daftarTool(tool)}

## Aturan menjawab

1. Jawab HANYA dari hasil tool. Kalau tidak ada tool yang cocok, katakan kamu
   belum bisa mengambil data itu — jangan mengarang angka, nama, atau tanggal.
2. Hasil tool sudah disaring untuk penanya. Kamu TIDAK bisa, dan tidak boleh
   mencoba, melihat data orang lain. Tiap hasil menyebut \`milik\` — itulah
   pemilik barisnya yang sebenarnya.
   ⚠️ Kalau yang ditanya ORANG atau DEPARTEMEN LAIN daripada yang disebut
   \`milik\`, jawab bahwa kamu tidak bisa melihat data itu. JANGAN menyajikan
   baris yang kamu terima sebagai milik mereka — menamai data Trade Marketing
   sebagai "klaim departemen HR" itu salah yang lebih berbahaya daripada
   menolak menjawab, karena pembacanya tidak punya cara mengetahuinya.
3. Kalau tool mengembalikan \`galat\`, sampaikan isinya apa adanya. Itu bukan
   kegagalan yang perlu kamu tutupi atau tebak jalan keluarnya.
4. Tiap hasil membawa \`jumlah\` (yang kamu baca) dan \`total\` (yang cocok
   seluruhnya). Kalau \`terpotong: true\`, keduanya BERBEDA.
   ⚠️ Pertanyaan "ada berapa" dijawab dengan \`total\`, BUKAN dengan menghitung
   baris yang kamu terima. Sebutkan juga bahwa yang ditampilkan baru sebagian,
   mis. "6 dari 22 aset". JANGAN pernah mengatakan tidak ada data lain,
   tidak ada tambahan, atau sudah semuanya — \`terpotong: true\` artinya
   justru sebaliknya.
5. Kode atau angka status yang tidak jelas artinya disebut apa adanya. Jangan
   diterjemahkan jadi kata yang kedengarannya masuk akal.
6. Sebutkan dari mana datanya waktu relevan, memakai nama yang ada di hasil
   tool.
7. ${tabel}
8. JANGAN memakai LaTeX. Tulis panah sebagai "→" atau kata "lalu", bukan
   \`$\\rightarrow$\`; tanda kali sebagai "×", bukan \`$\\times$\`. Portal ini
   tidak merender rumus, jadi yang terbaca user adalah tulisannya mentah.
9. Jawab dalam bahasa Indonesia, ringkas, tanpa basa-basi pembuka.${
    tool.some((t) => t.operasi !== "baca") ? ATURAN_RANCANGAN : ""
  }`;
}

/**
 * Aturan tambahan kalau agent punya tool penyusun rancangan.
 *
 * ⚠️ LAHIR DARI KEGAGALAN NYATA (28 Sep 2026, jalur entri penjualan): model
 * menjawab "data telah dikonfirmasi dan masuk ke sistem" padahal tidak ada
 * satu baris pun tersimpan. Aturan lama cuma melarangnya MENYIMPAN -- ternyata
 * itu tidak melarangnya MENGAKU sudah menyimpan.
 */
const ATURAN_RANCANGAN = `

## Tool yang diawali \`siapkan_\`

Tool ini TIDAK menyimpan apa pun. Ia memulangkan rancangan yang ditampilkan
ke user beserta tombol konfirmasi, dan TOMBOL ITU yang menyimpan.

- JANGAN katakan datanya sudah dibuat, sudah masuk, sudah tersimpan, atau
  sudah diproses. Belum. Katakan rancangannya sudah disiapkan dan minta user
  memeriksanya lalu menekan Simpan.
- JANGAN menyebutkan nomor apa pun. Nomornya baru ada saat penyimpanan.
- JANGAN mengulang isi rancangan panjang-panjang dalam jawaban — kartunya
  sudah menampilkan semuanya. Cukup satu kalimat.
- Kalau hasilnya \`perlu-perbaikan\`, sebutkan pilihan yang ditawarkan APA
  ADANYA dan tanyakan mana yang dimaksud. Jangan memilihkan.
- Kalau user bilang "ya" atau "simpan" lewat teks, ingatkan bahwa yang
  menyimpan adalah tombol di kartu — kamu tidak bisa menekannya untuk dia.`;

const TANPA_TOOL = `

## ⚠️ Kamu belum punya tool

Agent ini aktif tapi belum diberi satu pun tool, jadi kamu TIDAK punya cara
mengambil data. Jangan berpura-pura bisa. Kalau ditanya data, katakan terus
terang bahwa agent untuk aplikasi ini belum dipasangi sumber data, dan sarankan
menghubungi administrator aplikasinya.`;

export type HasilRakit = {
  agent: Agent;
  /**
   * Tool yang benar-benar terpasang. Dikeluarkan supaya bisa diperiksa dari
   * luar -- `Agent.tools` tidak terbaca dari instance-nya, jadi tanpa ini
   * tidak ada cara menguji bahwa dua pemakai memang dapat tool berbeda.
   */
  tool: ReturnType<typeof buatToolDariKonfig>["tool"];
  /** Tool yang tidak bisa dirakit, beserta sebabnya. Untuk log, bukan untuk model. */
  dilewati: { kode: string; sebab: string }[];
};

/**
 * Membuat satu agent aplikasi.
 *
 * Dibuat ulang tiap request. Lihat peringatan cache di kepala berkas.
 */
export function buatAgentDariKonfig(k: KonfigAgent, sesi: SesiPemakai, catat?: CatatSumber, catatRancangan?: CatatRancangan): HasilRakit {
  const { tool, dilewati } = buatToolDariKonfig(k.tool, sesi, catat, catatRancangan);

  // Tool yang BISA dirakit -- bukan semua tool yang terdaftar. Instruksi yang
  // menyebut tool yang tidak terpasang membuat model memanggil nama yang tidak
  // ada, lalu gagal dan mencoba lagi sampai jatah langkahnya habis.
  const terpasang = k.tool.filter((t) => tool.some((x) => x.name === namaUntukModel(t)));

  const agent = new Agent({
    name: k.nama,
    purpose: k.deskripsi ?? k.nama,
    model: ({ context }) => pilihModel(context.get(KUNCI_MODEL)),
    instructions: ({ context }) => {
      const saluran: Saluran = context.get(KUNCI_SALURAN) === "wa" ? "wa" : "web";
      const dasar = instruksi(k, terpasang, saluran);
      return terpasang.length === 0 ? dasar + TANPA_TOOL : dasar;
    },
    tools: tool,
    maxSteps: MAKS_LANGKAH,
  });

  return { agent, tool, dilewati };
}

/**
 * Agent untuk sebuah aplikasi, langsung dari konfigurasi.
 *
 * `undefined` kalau aplikasinya belum punya agent atau agent-nya dimatikan --
 * dua keadaan yang berbeda bagi administrator, tapi sama saja bagi pemakai:
 * tidak ada yang bisa menjawab.
 */
export async function agentAplikasi(idApps: string, sesi: SesiPemakai, catat?: CatatSumber, catatRancangan?: CatatRancangan): Promise<HasilRakit | undefined> {
  const konf = await muatKonfig();
  const k = konf.agent.find((a) => a.aktif && !a.umum && (a.idApps === idApps || a.appsLain.includes(idApps)));
  return k ? buatAgentDariKonfig(k, sesi, catat, catatRancangan) : undefined;
}

export type HasilRouter = {
  agent: Agent;
  /** Agent aplikasi yang ikut jadi bawahan, untuk ditampilkan di UI. */
  bawahan: { kode: string; nama: string; jumlahTool: number; bisa: string[] }[];
  dilewati: { kode: string; sebab: string }[];
};

/**
 * Agent pintu masuk, dengan agent aplikasi sebagai bawahan.
 *
 * ⚠️ `aksesApps` DATANG DARI SESI, BUKAN DARI MODEL, dan bukan dari daftar
 * seluruh aplikasi. Agent aplikasi yang tidak boleh diakses pemakai TIDAK
 * dijadikan bawahan sama sekali -- bukan dijadikan bawahan lalu dilarang lewat
 * kalimat di prompt. Larangan yang cuma kalimat bisa dibujuk; yang tidak
 * dipasang tidak bisa dipanggil.
 *
 * Kalau pemakai tidak punya akses aplikasi apa pun, router tetap dibuat tanpa
 * bawahan — dia masih bisa menjelaskan keadaan itu, dan itu lebih baik
 * daripada layar yang diam.
 */
export async function buatRouter(sesi: SesiPemakai, aksesApps: string[], catat?: CatatSumber, catatRancangan?: CatatRancangan): Promise<HasilRouter | undefined> {
  const konf = await muatKonfig();
  const umum = konf.agent.find((a) => a.umum && a.aktif);
  if (!umum) return undefined;

  const boleh = new Set(aksesApps);
  const anak: Agent[] = [];
  const bawahan: HasilRouter["bawahan"] = [];
  const dilewati: HasilRouter["dilewati"] = [];

  for (const a of konf.agent) {
    if (a.umum || !a.aktif) continue;
    const dipegang = [a.idApps, ...a.appsLain].filter(Boolean) as string[];
    if (!dipegang.some((id) => boleh.has(id))) continue;

    const r = buatAgentDariKonfig(a, sesi, catat, catatRancangan);
    anak.push(r.agent);
    // Nama tool yang BENAR-BENAR terpasang, bukan semua yang terdaftar.
    const bisa = a.tool.filter((t) => r.tool.some((x) => x.name === namaUntukModel(t))).map((t) => t.nama);
    bawahan.push({ kode: a.kode, nama: a.nama, jumlahTool: a.tool.length, bisa });
    dilewati.push(...r.dilewati);
  }

  // ⚠️ KEMAMPUAN TIAP AGENT IKUT DISEBUT, bukan cuma deskripsinya.
  //
  // Versi pertama cuma menuliskan `ai_agent.deskripsi` -- satu kalimat seperti
  // "Tiket helpdesk, aset, profil, dan pengajuan karyawan". Akibatnya router
  // menolak "SOP apa saja yang ada?" dengan alasan tidak ada agent yang
  // menanganinya, PADAHAL `cari_sop` dan `daftar_sop` terpasang di agent
  // Portal. Router tidak bisa mengarahkan ke kemampuan yang tidak dia ketahui.
  const daftar = bawahan.length
    ? bawahan
        .map((b) => {
          const d = konf.agent.find((a) => a.kode === b.kode)?.deskripsi ?? "";
          const bisa =
            b.bisa.length > 0
              ? `\n  Bisa: ${b.bisa.join("; ")}.`
              : `\n  Belum punya tool -- cuma bisa mengobrol.`;
          return `- **${b.nama}** -- ${d}${bisa}`;
        })
        .join("\n")
    : "(belum ada agent aplikasi yang terbuka untuk akun ini)";

  const agent = new Agent({
    name: umum.nama,
    purpose: umum.deskripsi ?? "Pintu masuk; mengarahkan ke agent aplikasi.",
    model: ({ context }) => pilihModel(context.get(KUNCI_MODEL)),
    instructions: () => `Kamu ${umum.nama}, pintu masuk asisten portal.

Tugasmu MENERUSKAN pertanyaan ke agent aplikasi yang tepat, bukan menjawab
pertanyaan data sendiri. Kamu tidak punya tool data apa pun.

## Agent yang bisa kamu mintai

${daftar}

## Aturan

1. Pertanyaan tentang data — tiket, aset, cuti, program, kunjungan, order,
   laporan — SELALU diteruskan ke agent yang memegang aplikasinya. Jangan
   dijawab sendiri walau kamu merasa tahu jawabannya.
2. Satu pertanyaan boleh menyentuh dua aplikasi. Mintakan ke dua-duanya, lalu
   gabungkan jawabannya.
3. Kalau tidak ada agent yang cocok, katakan terus terang aplikasi itu belum
   punya asisten atau belum terbuka untuk akun ini, dan sarankan meminta akses
   ke administrator aplikasinya. Jangan mengarang jawaban sebagai gantinya.
4. Sebutkan agent mana yang menjawab, supaya penanya tahu harus bertanya ke
   mana lain kali.
5. Jawab dalam bahasa Indonesia, ringkas.`,
    subAgents: anak,
    maxSteps: MAKS_LANGKAH,
  });

  return { agent, bawahan, dilewati };
}
