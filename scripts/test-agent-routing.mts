/**
 * Uji regresi PEMILIHAN TOOL — apakah agent mengambil ke RAG atau ke database.
 *
 *   npm run test:routing
 *   npm run test:routing -- --model claude-sonnet-5
 *
 * ⚠️ MEMANGGIL CLAUDE SUNGGUHAN. Lambat (~1 menit per kasus) dan berbiaya.
 * Jalankan sebelum merilis perubahan pada instruksi atau deskripsi tool,
 * bukan terus-menerus.
 *
 * ============================================================
 * KENAPA BERKAS INI ADA
 * ============================================================
 * Pemilihan tool ditentukan EMPAT lapis, dan cuma lapis pertama yang
 * deterministik:
 *
 *   0. Tool apa yang terpasang      -> kode, per departemen
 *   1. Deskripsi tiap tool          -> teks
 *   2. Tabel aturan di system prompt-> teks
 *   3. Peringatan di keluaran tool  -> teks
 *
 * Tiga lapis terakhir ditafsirkan model, jadi bisa meleset -- dan pada
 * 1 Okt 2026 memang meleset: user mengeluh "hasil cetakan bergaris", agent
 * memilih tool tiket, tidak menemukan catatan penyelesaian, lalu MENGARANG
 * daftar penyebab ("driver printer usang") yang tidak ada di dokumen mana pun.
 *
 * Perbaikannya lahir dari SATU screenshot. Tanpa berkas ini, perubahan satu
 * kalimat instruksi besok bisa mengembalikan kegagalan itu tanpa ada yang
 * tahu. Tiap kasus di bawah adalah kegagalan yang pernah nyata atau yang
 * sengaja dijaga.
 *
 * ⚠️ Default model HAIKU, bukan Sonnet. Haiku yang paling sering gagal
 * menuruti instruksi panjang, jadi dia batas bawah yang jujur. Lolos di Haiku
 * berarti lolos di model yang lebih kuat; sebaliknya belum tentu.
 */
import { buatAgent, KUNCI_MODEL, KUNCI_PENGGUNA, KUNCI_SUMBER } from "../voltagent/agents.ts";
import { ambilDepartemen } from "../voltagent/departemen/index.ts";

const iModel = process.argv.indexOf("--model");
const MODEL = iModel !== -1 ? process.argv[iModel + 1] : "claude-haiku-4-5";

/**
 * Jalankan sebagian kasus saja: `npm run test:routing -- --hanya gejala`
 *
 * ⚠️ ADA KARENA SELURUHNYA TIDAK MUAT DALAM SATU KALI JALAN.
 *
 * Lima kasus ternyata melewati 10 menit (2 Okt 2026) -- tiap kasus memanggil
 * agent lengkap yang bisa memakai beberapa langkah tool, dan tiap langkah itu
 * satu bolak-balik ke Claude. Dengan saringan ini, uji bisa dijalankan
 * sepotong-sepotong dan tetap memberi hasil.
 */
const iHanya = process.argv.indexOf("--hanya");
const HANYA = iHanya !== -1 ? (process.argv[iHanya + 1] ?? "").toLowerCase() : "";

/** Akun uji yang sudah dipetakan ke karyawan di database perusahaan. */
const PENGGUNA = {
  id: 1,
  username: "ridho@mustika-ratu.co.id",
  nama: "Ridho",
  idEmployee: "c8a9ca7a-9650-4694-a02f-ef45cdd35226",
};

type Kasus = {
  nama: string;
  tanya: string;
  /** Tool yang WAJIB dipanggil. */
  wajibTool?: string[];
  /**
   * Batas jumlah tool berbeda yang boleh dipanggil.
   *
   * ⚠️ MENJAGA PERBAIKAN 2 OKT 2026.
   *
   * Untuk pertanyaan yang tidak ada jawabannya di korpus, agent dulu TIDAK
   * BERHENTI mencari: dia mencoba susunan kata lain, lalu tool lain, sampai
   * jatah 12 langkah habis. Satu pertanyaan memakan lebih dari 5 menit,
   * sementara kasus lain selesai 3-13 detik. Yang paling tidak bernilai buat
   * user justru yang paling mahal.
   *
   * Diperbaiki lewat instruksi "satu kali cari_sop sudah cukup". Batas ini
   * yang memastikan perbaikan itu tidak hilang diam-diam — dan tidak
   * bergantung pada susunan kalimat jawaban sama sekali.
   */
  maksTool?: number;
  /** Pola yang WAJIB ada di jawaban. */
  wajibAda?: { nama: string; pola: RegExp }[];
  /** Pola yang TIDAK BOLEH ada di jawaban. */
  tidakBoleh?: { nama: string; pola: RegExp }[];
};

const KASUS: Kasus[] = [
  {
    // ⚠️ KASUS UTAMA. Ini kegagalan 1 Okt yang sebenarnya terjadi.
    nama: "keluhan gejala -> RAG, bukan tiket",
    tanya: "hasil cetakan saya bergaris dan warnanya pudar",
    wajibTool: ["cari_sop"],
    wajibAda: [
      { nama: "menyebut SOP-IT-005", pola: /SOP-IT-005/ },
      { nama: "menyebut halaman & baris", pola: /halaman\s*\d+.{0,16}baris\s*\d+/i },
      { nama: "isinya dari dokumen (tinta/head)", pola: /tinta|head|kepala cetak/i },
    ],
    tidakBoleh: [
      {
        // Penyebab yang DIKARANG model waktu kegagalan itu terjadi.
        nama: "mengarang 'driver usang'",
        pola: /driver.{0,30}(usang|lama|kedaluwarsa|perlu diperbarui)/i,
      },
    ],
  },
  {
    nama: "tidak ada SOP-nya -> mengaku, bukan mengarang",
    tanya: "bagaimana cara klaim asuransi gigi untuk anak saya?",
    // Satu pencarian cukup. Lebih dari itu artinya agent mulai meraba-raba.
    maksTool: 1,
    tidakBoleh: [
      /**
       * ⚠️ DUA PENANDA DIBUANG DARI SINI, DAN ALASANNYA PANTAS DICATAT.
       *
       * Percobaan 1 — mencocokkan kalimat penolakan ("belum ada", "tidak
       * menemukan"). Model menyusun penolakan dengan kata berbeda tiap kali
       * dijalankan: "di luar cakupan sistem helpdesk IT", lalu "bukan bagian
       * dari sistem IT", lalu "soal benefit/HR perusahaan". Polanya sempat
       * dilebarkan dua kali supaya cocok — dan itu arah yang salah, karena
       * melebarkan pola sampai hijau menghasilkan uji yang tidak menguji apa
       * pun.
       *
       * Percobaan 2 — melarang daftar bernomor, dengan alasan kegagalan 1 Okt
       * bentuknya daftar penyebab karangan. Ternyata salah sasaran: agent
       * juga memakai daftar untuk hal yang WAJAR ("aku bisa bantu untuk: ...").
       * Yang membedakan kegagalan dari jawaban baik bukan BENTUK daftarnya,
       * tapi TOPIK-nya.
       *
       * Yang tersisa di bawah terikat topik, dan itu memang penjaga yang
       * sebenarnya. Mutu susunan kalimat penolakan bukan urusan uji regresi.
       */
      {
        // cari_sop SELALU mengembalikan 5 dokumen berskor 0,8-an, termasuk
        // untuk pertanyaan ini. Yang diuji: model tidak merangkai jawaban
        // dari dokumen klaim promosi yang kebetulan ikut terambil.
        nama: "mengarang prosedur asuransi",
        pola: /asuransi gigi.{0,120}(langkah|prosedur|diajukan|formulir)/i,
      },
    ],
  },
  {
    /**
     * ⚠️ PENYEIMBANG kasus "tidak ada SOP-nya" di atas.
     *
     * Setelah agent diperintahkan berhenti setelah satu pencarian, dia mulai
     * menolak pertanyaan di luar bidang TANPA mencari sama sekali. Untuk
     * pertanyaan asuransi gigi itu kebetulan benar — tapi menilai isi korpus
     * dari dugaan sendiri itu rapuh.
     *
     * Kasus ini menangkap bahayanya: agent IT ditanya soal CUTI, yang
     * terdengar urusan HR, padahal SOP-HR-001 ADA di korpus dan boleh dibaca
     * semua departemen. Kalau ini ditolak sebagai "di luar cakupan", berarti
     * agent menebak, bukan memeriksa.
     */
    nama: "lintas departemen -> tetap dicari, bukan ditolak",
    tanya: "saya mau mengajukan cuti, bagaimana prosedurnya?",
    wajibTool: ["cari_sop"],
    wajibAda: [{ nama: "menemukan SOP cuti", pola: /SOP-HR-001|cuti/i }],
    tidakBoleh: [
      {
        nama: "menolak sebagai di luar bidang",
        pola: /di luar (cakupan|kewenangan|bidang)|bukan urusan (IT|helpdesk)/i,
      },
    ],
  },
  {
    nama: "pertanyaan angka -> database",
    tanya: "ada berapa tiket helpdesk yang statusnya masih OPEN?",
    wajibTool: ["query_perusahaan"],
  },
  {
    // Menguji dua hal sekaligus: pemanggilan dua tool, DAN agent tidak
    // menanyakan identitas ke orang yang sudah login (kegagalan 1 Okt juga).
    nama: "campuran -> dua tool, tanpa menanyakan identitas",
    tanya: "tiket saya ada berapa yang masih open, dan apa aturan penutupannya?",
    wajibTool: ["query_perusahaan", "cari_sop"],
    tidakBoleh: [
      {
        nama: "menanyakan identitas user",
        pola: /(siapa|sebutkan).{0,40}(nama|identitas)|ID karyawan|nomor karyawan/i,
      },
    ],
  },
  {
    nama: "pertanyaan prosedur -> RAG + rujukan",
    tanya: "berapa lama proses pembuatan email baru untuk karyawan?",
    wajibTool: ["cari_sop"],
    wajibAda: [{ nama: "menyebut halaman & baris", pola: /halaman\s*\d+.{0,16}baris\s*\d+/i }],
  },
];

const dep = ambilDepartemen("it");
if (!dep) {
  console.error("Departemen 'it' tidak ada.");
  process.exitCode = 1;
} else {
  const agent = buatAgent(dep, "staf");
  const context = {
    [KUNCI_MODEL]: MODEL,
    [KUNCI_PENGGUNA]: PENGGUNA,
    [KUNCI_SUMBER]: "perusahaan",
  };

  const jalan = HANYA ? KASUS.filter((k) => k.nama.toLowerCase().includes(HANYA)) : KASUS;
  if (jalan.length === 0) {
    console.error(`Tidak ada kasus yang cocok "${HANYA}". Yang ada:`);
    for (const k of KASUS) console.error(`  - ${k.nama}`);
    process.exitCode = 1;
  }

  console.log(
    `model: ${MODEL} · ${jalan.length} dari ${KASUS.length} kasus` +
      (HANYA ? ` (saringan "${HANYA}")` : "") +
      ` · perkiraan ${jalan.length * 2} menit\n`,
  );

  let lolos = 0;
  let gagal = 0;
  const rusak: string[] = [];

  for (const k of jalan) {
    const mulai = Date.now();
    let teks = "";
    const dipakai = new Set<string>();
    try {
      const r = (await agent.generateText(k.tanya, { context })) as {
        text?: string;
        steps?: { toolCalls?: { toolName: string }[] }[];
      };
      teks = String(r.text ?? "");
      for (const s of r.steps ?? []) {
        for (const c of s.toolCalls ?? []) dipakai.add(c.toolName);
      }
    } catch (e) {
      console.log(`\n### ${k.nama}\n  GALAT ${(e as Error).message.slice(0, 120)}`);
      gagal++;
      rusak.push(k.nama);
      continue;
    }

    const detik = ((Date.now() - mulai) / 1000).toFixed(0);
    console.log(`\n### ${k.nama}  (${detik} dtk)`);
    console.log(`  tanya : "${k.tanya}"`);
    console.log(`  tool  : ${[...dipakai].join(", ") || "(tidak ada)"}`);

    const nilai = (nama: string, ok: boolean) => {
      if (ok) lolos++;
      else {
        gagal++;
        rusak.push(`${k.nama} / ${nama}`);
      }
      console.log(`  ${ok ? "LOLOS " : "GAGAL "} ${nama}`);
    };

    for (const t of k.wajibTool ?? []) nilai(`memanggil ${t}`, dipakai.has(t));
    if (k.maksTool !== undefined) {
      nilai(
        `tidak meraba-raba (maks ${k.maksTool} tool, dipakai ${dipakai.size})`,
        dipakai.size <= k.maksTool,
      );
    }
    for (const a of k.wajibAda ?? []) nilai(a.nama, a.pola.test(teks));
    for (const t of k.tidakBoleh ?? []) nilai(`TIDAK ${t.nama}`, !t.pola.test(teks));

    // Cuplikan jawaban ikut dicetak: kalau nanti ada yang gagal, yang pertama
    // ditanyakan selalu "memang dia jawab apa".
    console.log(`  jawab : ${teks.slice(0, 150).replace(/\s+/g, " ")}…`);
  }

  console.log(`\n${"=".repeat(58)}`);
  console.log(`${lolos} lolos, ${gagal} gagal  (model ${MODEL})`);
  if (rusak.length) {
    console.log("\nyang gagal:");
    for (const r of rusak) console.log(`  - ${r}`);
  }
  console.log("=".repeat(58));

  // ⚠️ `process.exitCode`, BUKAN `process.exit()` -- mematikan proses saat
  // koneksi Anthropic masih menutup membuat libuv melempar assertion dan
  // exit code jadi 127 walau semua lolos. Terjadi di `test:dokumen` 30 Sep.
  process.exitCode = gagal === 0 ? 0 : 1;
}
