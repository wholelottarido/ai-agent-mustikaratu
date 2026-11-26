/**
 * Tahap 3 (F.4, 24 Nov 2026) — daftar kemampuan agent & pencocokan kebutuhan tugas sebelum delegasi.
 *
 * Murni: tanpa VoltAgent, database, jaringan, atau state global. Daftarnya dirakit `buatRouter()` dari tool
 * yang BENAR-BENAR terpasang untuk pemakai yang sedang bertanya (sesudah izin & akses aplikasi disaring), lalu
 * dipegang penjaga permintaan itu saja. Agent atau tool yang tidak boleh dipakai pemakai tidak pernah masuk.
 *
 * ⚠️ TIDAK ADA NAMA AGENT DI SINI. Yang dicocokkan adalah JENIS kemampuan tool (cari dokumen / baca data /
 * siapkan tindakan) dan kata isi dari nama & deskripsi tool. Agent baru, nama baru, atau tool yang dipindah
 * lewat Kelola AI langsung ikut terbaca tanpa mengubah kode ini.
 *
 * ⚠️ HANYA MENOLAK KALAU PASTI. Tiga tingkat keyakinan:
 *   cocok           — target memegang kemampuan yang dibutuhkan
 *   tidak-cocok     — target TERBUKTI tidak memegangnya, dan agent lain yang tersedia memegangnya
 *   tidak-diketahui — metadata tidak cukup; keputusan dikembalikan ke perute
 * Pertanyaan yang tujuannya belum jelas, campuran yang sudah tercakup, dan jawaban singkat atas pertanyaan
 * sebelumnya SELALU "tidak-diketahui" — penjaga tidak menebak.
 */
import { kataIsi, normal } from "./pola-teks";

/** Jenis kemampuan satu tool. Dibaca dari metadata tool, bukan dari namanya. */
export type JenisKemampuan = "dokumen" | "data" | "tindakan";

export type AlatKemampuan = { nama: string; label: string; deskripsi: string; jenis: JenisKemampuan };
export type AgentKemampuan = { nama: string; deskripsi: string; alat: AlatKemampuan[] };
export type RegistriKemampuan = { agent: AgentKemampuan[] };

/** Kebutuhan sebuah tugas delegasi, dibaca dari TUJUAN kalimatnya (bukan kata bendanya). */
export type Kebutuhan = JenisKemampuan | "campuran" | "tidak-jelas";
export type TingkatCocok = "cocok" | "tidak-cocok" | "tidak-diketahui";

export const LABEL_JENIS: Record<JenisKemampuan, string> = {
  dokumen: "cari dokumen/SOP/panduan",
  data: "baca data",
  tindakan: "siapkan tindakan (rancangan)",
};

// ------------------------------------------------------------------ tujuan kalimat

/**
 * Menanyakan CARA / SYARAT / ATURAN sebuah proses — jawabannya ada di dokumen, bukan di baris data.
 * "berapa lama prosesnya" & "siapa yang menyetujui" juga prosedur (sesuai aturan perute sejak Okt 2026).
 */
const POLA_PROSEDUR = new RegExp(
  "\\b(prosedur|sop|panduan|pedoman|tata\\s*cara|petunjuk|langkah(\\s*-?\\s*langkah)?|syarat|persyaratan|ketentuan|aturan|" +
    "kebijakan|regulasi|mekanisme|alur\\s+(pengajuan|permintaan|proses|pelaporan|persetujuan)|bagaimana\\s+cara|cara\\s+\\w+|" +
    "berapa\\s+lama\\s+(proses|prosesnya|pengajuan|persetujuan)|siapa\\s+yang\\s+(menyetujui|berwenang|harus)|" +
    "apa\\s+saja\\s+yang\\s+(perlu|harus)\\s+(disiapkan|dilampirkan|dilakukan)|" +
    "bagaimana\\s+(mengajukan|mengurus|meminta|membuat|melaporkan|mendaftar|memproses|melakukan)|" +
    "bagaimana\\s+(saya\\s+)?(bisa\\s+)?(mengajukan|mengurus|meminta|membuat|melaporkan))(nya)?\\b",
  "i",
);

/** Menanyakan KEADAAN data yang sudah ada: status, sisa, jumlah, milik saya. */
const POLA_DATA = new RegExp(
  "\\b(status|sisa|saldo|sudah\\s+(di)?(setujui|tolak|proses|selesai)|disetujui|ditolak|sudah\\s+selesai|" +
    "berapa(?!\\s+lama)|total|jumlah|daftar\\s+\\w+\\s+saya|tampilkan|lihat(kan)?|cek|riwayat|rekap|" +
    "bandingkan|perbandingan|tren|grafik|laporan|ringkasan|terbaru|terakhir|bulan\\s+(ini|lalu)|" +
    "(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|20\\d\\d|" +
    "(milik|punya)\\s+saya|\\w+\\s+saya\\s+(sudah|belum))\\b",
  "i",
);

/** Meminta TINDAKAN: membuat, mengajukan, mengubah, membatalkan. Hanya bentuk permintaan, bukan "cara membuat". */
const POLA_TINDAKAN = new RegExp(
  "(^|[.,;!?]\\s*|\\b(tolong|mohon|bantu|minta|saya\\s+(ingin|mau|perlu|hendak)|aku\\s+(ingin|mau))\\s+)" +
    "(buat(kan)?|bikin(kan)?|siapkan|ajukan|mengajukan|catat(kan)?|ubah|ganti|batalkan|hapus|laporkan|tutup|" +
    "beri(kan)?\\s+rating|setujui|tolak|buka(kan)?)\\b",
  "i",
);

/** Pecah kalimat majemuk jadi klausa: "X dan bagaimana Y", "X; Y", "X? Y". */
function klausa(teks: string): string[] {
  return teks
    .split(/[?;\n]+|\s+(?:dan|serta|lalu|kemudian|sekaligus|juga)\s+(?=(?:bagaimana|apa|berapa|apakah|siapa|kapan|tolong|mohon|buat|bikin|siapkan|ajukan|tampilkan|jelaskan|lihat|cek|sebutkan|bandingkan)\b)/i)
    .map((s) => s.trim())
    .filter((s) => kataIsi(s).length > 0);
}

function kebutuhanKlausa(s: string): Kebutuhan {
  const prosedur = POLA_PROSEDUR.test(s);
  const tindakan = POLA_TINDAKAN.test(s);
  // "prosedur membuat tiket" = prosedur; "buatkan tiket" = tindakan. Prosedur menang kalau kalimatnya MENANYA cara.
  if (prosedur && !tindakan) return "dokumen";
  if (tindakan && !prosedur) return "tindakan";
  if (tindakan && prosedur) return "campuran";
  return POLA_DATA.test(s) ? "data" : "tidak-jelas";
}

/** Kebutuhan sebuah tugas, beserta kebutuhan tiap klausanya (untuk tugas majemuk). */
export function kebutuhanTugas(teks: string): { kebutuhan: Kebutuhan; bagian: { teks: string; kebutuhan: Kebutuhan }[] } {
  const bagian = klausa(teks).map((t) => ({ teks: t, kebutuhan: kebutuhanKlausa(t) }));
  const jelas = [...new Set(bagian.map((b) => b.kebutuhan).filter((k) => k !== "tidak-jelas"))];
  if (bagian.some((b) => b.kebutuhan === "campuran") || jelas.length > 1) return { kebutuhan: "campuran", bagian };
  return { kebutuhan: (jelas[0] as Kebutuhan | undefined) ?? "tidak-jelas", bagian };
}

// ------------------------------------------------------------------ kata isi bidang

/** Kata yang muncul di hampir semua deskripsi tool, jadi tidak membedakan bidang. */
const KATA_LEMAH = new Set((
  "total jumlah berapa daftar data baca lihat cek status semua milik bulan tahun hari minggu tanggal periode " +
  "nama sendiri bagaimana kenapa mengapa kapan dimana mana siapa info informasi tentang terkait mengenai masih " +
  "karyawan pegawai bertanya penanya prosedur sop panduan cara syarat aturan kebijakan sesuai berdasarkan " +
  "satu dua tiga baru lama terbaru terakhir hasil proses alur langkah detail rincian ringkasan laporan " +
  "minta meminta mengajukan ajukan pengajuan permintaan tolong mohon jelaskan sebutkan tampilkan apa saja " +
  // Nama bulan adalah PERIODE, bukan bidang: tidak boleh membuat dua agent tampak sebidang.
  "januari februari maret april mei juni juli agustus september oktober november desember"
).split(" "));

/** Akar kata kasar (imbuhan umum dibuang) supaya "pengajuan" ~ "ajukan", "tiketnya" ~ "tiket". */
export function akar(w: string): string {
  let k = w;
  if (k.length > 5) k = k.replace(/(nya|kan|lah)$/, "");
  if (k.length > 6) k = k.replace(/an$/, "");
  const p = /^(meng|meny|mem|men|me|peng|peny|pem|pen|per|pe|di|ber|ter|ke)(?=[a-z]{3,})/.exec(k);
  return p ? k.slice(p[1].length) : k;
}

function akarIsi(teks: string): Set<string> {
  return new Set(kataIsi(teks).filter((w) => !KATA_LEMAH.has(w)).map(akar).filter((w) => w.length >= 3 && !KATA_LEMAH.has(w)));
}
const beririsan = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));

// ------------------------------------------------------------------ registri

export function buatRegistri(agent: AgentKemampuan[]): RegistriKemampuan {
  return { agent: agent.filter((a) => a.alat.length > 0) };
}

/** Jenis kemampuan yang dipegang sebuah agent, untuk ditulis ringkas di daftar agent perute. */
export function jenisAgent(a: AgentKemampuan): JenisKemampuan[] {
  return (["dokumen", "data", "tindakan"] as const).filter((j) => a.alat.some((t) => t.jenis === j));
}

export const cariAgent = (r: RegistriKemampuan, nama: string) =>
  r.agent.find((a) => a.nama === nama) ?? r.agent.find((a) => normal(a.nama) === normal(nama));

/**
 * Agent yang bisa memenuhi kebutuhan `jenis` untuk tugas ini. Untuk dokumen cukup memegang alat pencari dokumen;
 * untuk data/tindakan, alat sejenisnya harus BERIRISAN kata isi dengan tugas (bidang yang sama).
 */
export function pemilikKemampuan(r: RegistriKemampuan, jenis: JenisKemampuan, tugas: string): string[] {
  const kata = akarIsi(tugas);
  return r.agent.filter((a) => a.alat.some((t) => t.jenis === jenis &&
    (jenis === "dokumen" || beririsan(kata, akarIsi(`${t.nama.replace(/_/g, " ")} ${t.label} ${t.deskripsi}`)))))
    .map((a) => a.nama);
}

export type HasilCocok = {
  tingkat: TingkatCocok;
  kebutuhan: Kebutuhan;
  /** Agent tersedia yang memegang kemampuan itu (tidak pernah memuat agent di luar registri pemakai). */
  saran: string[];
  alasan: string;
};

/**
 * Apakah `target` mampu mengerjakan `tugas`?
 *
 * ⚠️ "tidak-cocok" hanya kalau BUKTINYA ada di metadata:
 *   dokumen         → target tidak memegang alat pencari dokumen satu pun, padahal agent lain memegangnya;
 *   data / tindakan → tidak satu pun kata isi tugas muncul di deskripsi agent maupun di alat target mana pun,
 *                     padahal alat sejenis milik agent lain memuatnya.
 * Selebihnya "tidak-diketahui" dan perute yang memutuskan.
 */
export function cocokkan(r: RegistriKemampuan, target: string, tugas: string): HasilCocok {
  const { kebutuhan, bagian } = kebutuhanTugas(tugas);
  const a = cariAgent(r, target);
  const tahu = (alasan: string): HasilCocok => ({ tingkat: "tidak-diketahui", kebutuhan, saran: [], alasan });
  if (!a) return tahu("target tidak ada di daftar kemampuan");

  const satu = (jenis: JenisKemampuan, teks: string): HasilCocok => {
    const pemilik = pemilikKemampuan(r, jenis, teks);
    if (pemilik.includes(a.nama)) return { tingkat: "cocok", kebutuhan: jenis, saran: [], alasan: `memegang alat ${LABEL_JENIS[jenis]}` };
    const lain = pemilik.filter((n) => n !== a.nama);
    if (lain.length === 0) return { ...tahu(`tidak ada agent tersedia yang terbukti memegang alat ${LABEL_JENIS[jenis]} untuk tugas ini`), kebutuhan: jenis };
    if (jenis === "dokumen") {
      return a.alat.some((t) => t.jenis === "dokumen")
        ? { ...tahu("memegang alat dokumen"), kebutuhan: jenis }
        : { tingkat: "tidak-cocok", kebutuhan: jenis, saran: lain, alasan: `tidak memegang alat ${LABEL_JENIS.dokumen}` };
    }
    // Bidang: target tidak menyinggung satu pun kata isi tugas di deskripsi agent & SEMUA alatnya.
    const kata = akarIsi(teks);
    const teksTarget = akarIsi(`${a.nama} ${a.deskripsi} ${a.alat.map((t) => `${t.nama.replace(/_/g, " ")} ${t.label} ${t.deskripsi}`).join(" ")}`);
    if (kata.size === 0 || beririsan(kata, teksTarget)) return { ...tahu("bidang target menyinggung tugas ini"), kebutuhan: jenis };
    return { tingkat: "tidak-cocok", kebutuhan: jenis, saran: lain, alasan: `tidak satu pun alat atau deskripsinya menyangkut bidang tugas ini (${LABEL_JENIS[jenis]})` };
  };

  if (kebutuhan === "dokumen" || kebutuhan === "data" || kebutuhan === "tindakan") return satu(kebutuhan, tugas);
  if (kebutuhan === "campuran") {
    // Tugas majemuk ke satu agent: ditolak hanya kalau ADA bagian yang pasti tidak bisa ia kerjakan.
    const hasil = bagian.filter((b) => b.kebutuhan !== "tidak-jelas" && b.kebutuhan !== "campuran")
      .map((b) => ({ b, h: satu(b.kebutuhan as JenisKemampuan, b.teks) }));
    const gagal = hasil.filter((x) => x.h.tingkat === "tidak-cocok");
    if (gagal.length === 0) return tahu("tugas majemuk; tidak ada bagian yang terbukti di luar kemampuan target");
    return { tingkat: "tidak-cocok", kebutuhan, saran: [...new Set(gagal.flatMap((x) => x.h.saran))],
      alasan: `bagian «${gagal.map((x) => x.b.teks.slice(0, 60)).join("», «")}» di luar kemampuan target — pisahkan tugasnya` };
  }
  return tahu("tujuan tugas belum jelas");
}

// ------------------------------------------------------------------ hasil agent bawahan

/**
 * Status terstruktur hasil satu handoff, dari BUKTI eksekusi alat (bukan dari kalimat "tidak bisa"):
 *   berhasil · tidak-ditemukan · akses-ditolak · galat-alat · tidak-bisa · perlu-pengguna · tanpa-alat
 */
export type StatusHandoff = "berhasil" | "tidak-ditemukan" | "akses-ditolak" | "galat-alat" | "tidak-bisa" | "perlu-pengguna" | "tanpa-alat" | "galat-model";

/**
 * Jawaban agent bawahan yang sebenarnya GAGAL di panggilan model, bukan jawaban.
 *
 * ⚠️ LAHIR DARI KEGAGALAN NYATA, 26 Nov 2026 (Gemma 12B, kapasitas 8.192 token).
 * Alat agent CMOD berhasil, lalu panggilan model berikutnya ditolak server
 * ("exceeds the available context size"). Status handoff dihitung dari hasil
 * ALAT, jadi tetap "berhasil" — dan perute menjawab "tidak memberikan data",
 * seolah datanya kosong. VoltAgent memulangkan teks kosong atau
 * "Error in delegating task to …" pada keadaan itu.
 */
export function jawabanGagalModel(teks: string): boolean {
  const t = (teks ?? "").trim();
  return t === "" || /^Error in delegating task to /i.test(t) || /exceed(s|ed)? the available context|context[_ ]length|maximum context/i.test(t);
}

const STATUS_KOSONG = /^(tidak-ketemu|tidak-ditemukan|data-belum-ada|kosong)$/;
const POLA_AKSES = /\b(izin|akses|berhak|wewenang|belum terhubung|tidak diizinkan|dilarang)\b/i;

/** Ringkas satu hasil alat jadi status. `undefined` = hasil penjaga (bukan hasil alat sungguhan). */
export function statusHasilAlat(output: unknown): Exclude<StatusHandoff, "tanpa-alat" | "perlu-pengguna"> | undefined {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "berhasil";
  const o = output as Record<string, unknown>;
  const st = String(o.status ?? "");
  if (/^(ditolak-penjaga|perlu-periode)$/.test(st) || "catatan_sistem" in o) return undefined;
  if (typeof o.galat === "string") return POLA_AKSES.test(o.galat) ? "akses-ditolak" : "galat-alat";
  if (st === "ditolak" && POLA_AKSES.test(String(o.pesan ?? o.alasan ?? ""))) return "akses-ditolak";
  if (STATUS_KOSONG.test(st)) return "tidak-ditemukan";
  if (st === "tidak-bisa") return "tidak-bisa";
  const nol = (v: unknown) => v === 0;
  if (nol(o.total) || (nol(o.jumlah) && o.total === undefined)) return "tidak-ditemukan";
  for (const k of ["hasil", "baris", "data", "dokumen"]) {
    if (Array.isArray(o[k]) && (o[k] as unknown[]).length === 0 && !("total" in o)) return "tidak-ditemukan";
  }
  return "berhasil";
}

/** Gabungan status semua alat dalam satu handoff. Yang paling bermakna menang. */
export function statusHandoff(alat: { status: ReturnType<typeof statusHasilAlat> | "galat-alat" }[], perluPengguna: boolean): StatusHandoff {
  if (perluPengguna) return "perlu-pengguna";
  const s = alat.map((x) => x.status).filter((x): x is NonNullable<typeof x> => !!x);
  if (alat.length === 0) return "tanpa-alat";
  if (s.length === 0) return "tidak-bisa";
  for (const k of ["berhasil", "akses-ditolak", "tidak-ditemukan", "tidak-bisa", "galat-alat"] as const) if (s.includes(k)) return k;
  return "berhasil";
}
