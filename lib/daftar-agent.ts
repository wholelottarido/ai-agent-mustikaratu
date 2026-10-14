/**
 * Daftar agent untuk ditampilkan ke pemakai.
 *
 * Menggabungkan dua hal yang sudah ada: agent beserta tool-nya dari
 * `muatKonfig()`, dan aplikasi yang terbuka untuk orang itu dari
 * `aksesUntukEmployee()`.
 *
 * ⚠️ YANG TERKUNCI TETAP DITAMPILKAN.
 *
 * Aplikasi yang tidak bisa diakses tetap muncul di layar Apps portal
 * perusahaan, dan daftar ini mengikuti pola yang sama. Menyembunyikannya
 * membuat orang mengira fiturnya belum dibuat, lalu tidak pernah memintanya.
 *
 * Ini SOAL TAMPILAN SAJA, bukan penjagaan. Yang menjaga ada di
 * `voltagent/agent-konfig.ts`: agent yang tidak boleh diakses tidak pernah
 * dipasang sebagai bawahan router, jadi tidak ada yang bisa dibujuk
 * memanggilnya. Kalau suatu hari daftar ini salah menandai sesuatu sebagai
 * terbuka, yang terjadi cuma kartu yang menyesatkan — bukan data yang bocor.
 */
import { muatKonfig } from "./ai-konfig";
import { aksesUntukEmployee } from "./akses-aplikasi";

export type AgentTampil = {
  kode: string;
  nama: string;
  deskripsi: string | null;
  /** Tool yang benar-benar tersambung dan aktif. */
  jumlahTool: number;
  /** Boleh dipakai orang ini? */
  terbuka: boolean;
};

export type DaftarAgent = {
  agent: AgentTampil[];
  /** Berapa yang terbuka, untuk "2 dari 9 terbuka untuk akun kamu". */
  terbuka: number;
  /**
   * Contoh pertanyaan, diambil dari `ai_tool.contoh_pertanyaan` milik tool
   * yang BENAR-BENAR terpasang untuk orang ini.
   *
   * Bukan daftar yang ditulis di kode: contoh yang menjanjikan sesuatu yang
   * tool-nya tidak ada akan dijawab "saya tidak bisa" — dan itu kesan pertama
   * yang paling buruk untuk fitur yang sebetulnya bekerja.
   */
  contoh: string[];
  /** `false` kalau sesi belum punya `idEmployee` (token lama). */
  siap: boolean;
};

const KOSONG: DaftarAgent = { agent: [], terbuka: 0, contoh: [], siap: false };

export async function daftarAgent(idEmployee: string | null): Promise<DaftarAgent> {
  if (!idEmployee) return KOSONG;

  const akses = await aksesUntukEmployee(idEmployee);
  if (!akses) return KOSONG;

  const konf = await muatKonfig();
  const boleh = new Set(akses.apps);

  const agent = konf.agent
    // Agent umum adalah pintu masuknya, bukan salah satu pilihan di daftar.
    .filter((a) => a.aktif && !a.umum)
    .map((a) => {
      const dipegang = [a.idApps, ...a.appsLain].filter(Boolean) as string[];
      return {
        kode: a.kode,
        nama: a.nama,
        deskripsi: a.deskripsi,
        jumlahTool: a.tool.length,
        terbuka: dipegang.some((id) => boleh.has(id)),
      };
    })
    // Yang terbuka di atas; selebihnya urut nama supaya posisinya tidak
    // berpindah-pindah tiap kali jumlah tool berubah.
    .sort((x, y) => Number(y.terbuka) - Number(x.terbuka) || x.nama.localeCompare(y.nama));

  // Satu contoh per agent lebih dulu, baru sisanya — supaya empat kotak yang
  // tampil tidak semuanya milik agent yang kebetulan punya banyak tool.
  const perAgent = konf.agent
    .filter((a) => a.aktif && !a.umum)
    .filter((a) => [a.idApps, ...a.appsLain].filter(Boolean).some((id) => boleh.has(id as string)))
    .map((a) => a.tool.map((t) => t.contoh).filter((x): x is string => Boolean(x)));
  const contoh: string[] = [];
  for (let i = 0; contoh.length < 4; i++) {
    const putaran = perAgent.map((d) => d[i]).filter((x): x is string => Boolean(x));
    if (putaran.length === 0) break;
    for (const c of putaran) if (contoh.length < 4 && !contoh.includes(c)) contoh.push(c);
  }

  return { agent, terbuka: agent.filter((a) => a.terbuka).length, contoh, siap: true };
}
