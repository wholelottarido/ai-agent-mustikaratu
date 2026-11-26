/**
 * Pola teks untuk penjaga alur agent (Tahap 2, 24 Nov 2026).
 *
 * ⚠️ SENGAJA TERPISAH dari `scripts/lib/evaluator-agent.mts`. Evaluator menilai hasil kerja penjaga ini;
 * kalau keduanya berbagi pola, salah deteksi di satu tempat ikut menyembunyikan dirinya di tempat lain —
 * penjaga meloloskan teks, evaluator pun ikut menganggapnya benar. Jadi penilai dan yang dinilai tidak
 * memakai kode yang sama.
 *
 * Semua fungsi murni: tanpa database, jaringan, atau state.
 */

export function normal(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const KATA_UMUM = new Set((
  "yang dan atau untuk dengan dari pada ini itu ada akan sudah telah saya anda kamu kami user pengguna pemakai " +
  "tolong mohon bisa dapat mau ingin apakah apa juga lagi saja dong ya iya oke ok boleh setuju lanjut " +
  "tawaran sebelumnya menyetujui memilih pilihan konteks giliran pertanyaan jawaban asisten sistem tugas " +
  "agent portal ratu buat buatkan siapkan menyiapkan membuat tidak belum jangan the and for"
).split(" "));

/** Kata isi (≥3 huruf, bukan kata umum). Dipakai untuk membandingkan tujuan, bukan susunan kata. */
export function kataIsi(s: string): string[] {
  return normal(s).split(" ").filter((w) => w.length >= 3 && !KATA_UMUM.has(w));
}

/** Kemiripan Jaccard atas kata isi. Dua teks tanpa kata isi dianggap sama (1). */
export function kemiripan(a: string, b: string): number {
  const A = new Set(kataIsi(a)), B = new Set(kataIsi(b));
  if (!A.size && !B.size) return 1;
  let sama = 0;
  for (const w of A) if (B.has(w)) sama++;
  return sama / (A.size + B.size - sama);
}

export function adaIrisan(a: string, b: string): boolean {
  const B = new Set(kataIsi(b));
  return kataIsi(a).some((w) => B.has(w));
}

/** Jawaban pengguna yang pendek: "ya", "LAN", "nomor 2", "boleh, lanjut". */
export function jawabanPendek(teks: string): boolean {
  const t = teks.trim();
  return t.length > 0 && t.length <= 80 && t.split(/\s+/).length <= 8;
}

const AWAL_SETUJU = /^\s*(ya+|iya+|y|yup|yes|ok(e|ey|ay)?|baik(lah)?|boleh|setuju|lanjut(kan)?|silak?h?an|betul|benar|tentu|gas|siap|mau|sip)\b/i;
const AWAL_TOLAK = /^\s*(tidak|tdk|nggak|ngga|gak|ga|enggak|engga|jangan|batal(kan)?|belum|no|bukan|nanti( saja)?)\b/i;
/** Permintaan tindakan yang ditulis pengguna sendiri — bukan sekadar "ya". */
const MINTA_TINDAKAN = /\b(tolong|mohon|bantu|minta)?\s*(buat(kan)?|siapkan|ajukan|catat(kan)?|ubah|ganti|batalkan|hapus|laporkan)\b/i;

export const persetujuan = (t: string) => AWAL_SETUJU.test(t) && !AWAL_TOLAK.test(t);
export const penolakan = (t: string) => AWAL_TOLAK.test(t);
export const mintaTindakan = (t: string) => MINTA_TINDAKAN.test(t);

/**
 * Isi tugas delegasi yang MENYATAKAN keputusan pengguna: "User menyetujui tawaran sebelumnya: …",
 * "Pengguna memilih LAN", "sudah dikonfirmasi". Ini persis bentuk yang dikarang perute pada Q5 (RCA §5).
 */
export function klaimPersetujuan(tugas: string): boolean {
  return /\b(user|pengguna|pemakai|penanya|karyawan)\b[^.\n]{0,40}?\b(menyetujui|setuju|mengonfirmasi|mengkonfirmasi|konfirmasi|memilih|menjawab|bersedia)\b/i.test(tugas)
    || /\b(disetujui|dikonfirmasi|sudah\s+setuju|telah\s+setuju|persetujuan\s+(user|pengguna))\b/i.test(tugas);
}

/** Nilai yang dinyatakan sebagai pilihan pengguna di dalam tugas ("memilih LAN" → "LAN"). */
export function pilihanDalamTugas(tugas: string): string | null {
  const m = /\b(memilih|pilih|pilihannya|menjawab)\s*[:"'«“]?\s*([^"'»”.,;\n]{1,50})/i.exec(tugas);
  return m ? m[2].trim() : null;
}

export type Tertunda = { jenis: "tawaran" | "klarifikasi"; kalimat: string; pilihan: string[] };

const POLA_TAWARAN = /\b(apakah|mau|ingin|perlu|bolehkah)\b[^?\n]{0,80}\b(saya|kami|aku)\b[^?\n]{0,40}\b(siapkan|buatkan|menyiapkan|membuat|membuatkan|ajukan|mengajukan|catat|mencatat|ubah|mengubah|batalkan|membatalkan|hapus|menghapus|teruskan|meneruskan)/i;
const POLA_TANYA_PILIH = /\b(pilih|memilih|yang mana|mana yang|sebutkan|tentukan|lengkapi|sub-?kategori|jenis apa)\b/i;

/** Tawaran tindakan yang menunggu jawaban ("Apakah Anda ingin saya menyiapkan tiket?"). */
export function tawaranTindakan(teks: string): boolean {
  return POLA_TAWARAN.test(teks);
}

/**
 * Apa yang sedang menunggu jawaban pengguna di sebuah jawaban asisten. Dibaca dari teks yang BENAR-BENAR
 * dilihat pengguna (pesan asisten terakhir di riwayat), karena itulah yang ia jawab.
 */
export function pertanyaanTertunda(teksAsisten: string): Tertunda | null {
  const t = teksAsisten.trim();
  if (!t) return null;
  const ekor = t.slice(-600);
  const kalimatTanya = (ekor.match(/[^.!?\n]*\?/g) ?? []).map((s) => s.trim()).filter(Boolean);
  const pilihan = [...t.matchAll(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, "").trim()).slice(0, 20);
  if (POLA_TAWARAN.test(ekor)) {
    const k = kalimatTanya.find((s) => POLA_TAWARAN.test(s)) ?? kalimatTanya.at(-1) ?? ekor;
    return { jenis: "tawaran", kalimat: k.slice(0, 300), pilihan };
  }
  if (kalimatTanya.length || POLA_TANYA_PILIH.test(ekor)) {
    return { jenis: "klarifikasi", kalimat: (kalimatTanya.at(-1) ?? ekor).slice(0, 300), pilihan };
  }
  return null;
}

/**
 * Teks yang sebenarnya panggilan alat atau contoh dari instruksi, bukan jawaban:
 * "delegate_task ke Portal, isinya …", JSON `{"task": …, "targetAgents": …}`, `<tool_call>`, kutipan contoh
 * "> Kamu: …". Ditemukan di 6 dari 34 jawaban Q8 yang tercatat (laporan Tahap 1 §4.3).
 */
export function teksAlatMentah(teks: string): boolean {
  return /\bdelegate_task\b/i.test(teks)
    || /"?targetAgents"?\s*:/.test(teks)
    || /<\/?tool_call>|<\|tool|<function=/i.test(teks)
    || /^\s*\{\s*"(name|task|tool|function|arguments|tool_name)"\s*:/m.test(teks)
    || /\bsiapkan_[a-z_]+\s*\(/i.test(teks)
    || /^\s*>\s*(kamu|pemakai|user|pengguna)\s*:/im.test(teks);
}

/** Kalimat yang berbicara ATAS NAMA pengguna: "User menyetujui tawaran sebelumnya: …". */
export function kalimatAtasNamaPengguna(kalimat: string): boolean {
  return /^\s*[>*_"“]*\s*(user|pengguna|pemakai)\s+(menyetujui|setuju|memilih|mengonfirmasi|mengkonfirmasi|meminta|ingin|menjawab)\b/i.test(kalimat);
}

/**
 * Klaim bahwa data SUDAH tersimpan / dibuat / diajukan. "Rancangan sudah disiapkan" sengaja tidak cocok
 * (itu klaim yang benar), dan bentuk ingkar ("belum tersimpan") juga tidak.
 */
export function klaimTersimpan(kalimat: string): boolean {
  const t = kalimat;
  const ingkar = /\b(belum|tidak|tak|bukan)\s+(\w+\s+){0,2}(ter(simpan|catat|kirim|daftar)|di(buat|simpan|kirim|ajukan|proses|catat|daftarkan))/i;
  if (ingkar.test(t)) return false;
  return /\b(telah|sudah|berhasil)\s+(di)?(buat|simpan|kirim|ajukan|masuk|proses|catat|terbit|daftar|rekam)\w*/i.test(t)
    || /\b(berhasil|sukses)\s+(ter)?(simpan|catat|kirim|buat)\w*/i.test(t)
    || /\b[Nn]omor\s+([Tt]iket|[Pp]engajuan|[Oo]rder|[Pp]ermohonan)\b[^.\n]{0,25}\b[A-Z]{2,6}[-/]\d{2,}/.test(t);
}

/**
 * Hasil alat yang meminta KEPUTUSAN PENGGUNA (bukan kesalahan yang bisa diperbaiki model sendiri).
 * Berlaku untuk semua alat penyusun rancangan dan alat baca yang mengembalikan pilihan — bukan khusus tiket.
 *   - `status: perlu-perbaikan` dengan masalah yang berisi daftar pilihan, atau informasi yang kurang;
 *   - `status: perlu-diperjelas` (pencocokan nama ambigu, mis. "produk yang mana?");
 *   - masalah konfigurasi SAJA bukan keputusan pengguna.
 */
export function butuhKeputusanPengguna(output: unknown): { pesan: string } | null {
  if (!output || typeof output !== "object") return null;
  const o = output as { status?: unknown; pesan?: unknown; masalah?: unknown; pilihan?: unknown; klarifikasi?: unknown };
  const status = typeof o.status === "string" ? o.status : "";
  const pesan = typeof o.pesan === "string" ? o.pesan : "";
  const masalah = Array.isArray(o.masalah) ? (o.masalah as { jenis?: string; pilihan?: unknown; boleh?: unknown }[]) : [];
  if (status === "perlu-diperjelas" || status === "ambigu") return { pesan };
  if (status === "perlu-perbaikan") {
    if (masalah.length > 0 && masalah.every((m) => m?.jenis === "konfigurasi")) return null;
    const adaPilihan = masalah.some((m) => (Array.isArray(m?.pilihan) && m.pilihan.length > 0) || (Array.isArray(m?.boleh) && m.boleh.length > 0))
      || (Array.isArray(o.pilihan) && o.pilihan.length > 0);
    const kurang = masalah.some((m) => m?.jenis === "kurang" || m?.jenis === "tidak-ketemu");
    return adaPilihan || kurang ? { pesan } : null;
  }
  if (o.klarifikasi && typeof o.klarifikasi === "object") return { pesan };
  return null;
}

/** Rancangan yang benar-benar terbentuk (status aktual dari alat, bukan dari teks model). */
export function rancanganTerbentuk(output: unknown): boolean {
  return !!output && typeof output === "object" && (output as { status?: unknown }).status === "siap"
    && "sidik" in (output as object);
}

/** Bentuk stabil argumen alat untuk sidik idempotensi: kunci urut, teks dinormalisasi. */
export function argumenStabil(args: unknown): string {
  const rapikan = (v: unknown): unknown =>
    typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase()
      : Array.isArray(v) ? v.map(rapikan)
      : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined && (v as Record<string, unknown>)[k] !== "")
        .map((k) => [k, rapikan((v as Record<string, unknown>)[k])]))
      : v;
  return JSON.stringify(rapikan(args ?? {}));
}

// ==================================================================== Tahap 5 (F.7): sapaan

const AWAL_SAPA = /^(halo+|hal+o|hai+|hi+|hello|hey|hei|helo|selamat\s+(pagi|siang|sore|malam)|assalamu'?alaikum(\s+wr\.?\s*wb\.?)?|permisi|tes(t|ting)?|pagi|siang|sore|malam)\b[\s,!.]*/i;
const PANGGILAN = /^(ratu(\s*ai)?|kak|min|mas|mbak|bot|asisten)\b[\s,!.]*/i;
const TERIMA_KASIH = /^(terima\s*kasih|makasih|makasi|trims|thanks|thank\s+you|thx|tq)\b[\s,!.]*((ya|yaa|banyak|sekali|ratu(\s*ai)?|kak|min)[\s,!.]*)*$/i;
/**
 * Pertanyaan UMUM tentang asisten itu sendiri — bukan tentang isi data. Sengaja sempit dan harus menutup
 * seluruh kalimat: "kamu bisa bantu apa saja?" cocok, tetapi "SOP apa saja yang ada?" dan "bisa bantu
 * cek stok?" TIDAK (keduanya butuh data dari agent; RCA F.7 mencatat kegagalan 26 Okt saat batas ini kabur).
 */
const KEMAMPUAN = new RegExp("^((kamu|anda|ratu(\\s*ai)?|kak|min)\\s+)?(itu\\s+|ini\\s+)?(" + [
  "siapa",
  "(bisa|dapat|bs)\\s+(bantu|membantu|ngapain|melakukan|apa)(\\s+(saya|aku|kami))?(\\s+(apa|apa\\s+saja|apa\\s+aja|aja|saja))?",
  "apa\\s+(saja\\s+|aja\\s+)?yang\\s+(bisa|dapat)\\s+(kamu|anda)\\s+(bantu|lakukan|kerjakan)",
  "(fitur|kemampuan|layanan)(mu|nya)?\\s+apa(\\s+saja|\\s+aja)?",
  "punya\\s+(fitur|kemampuan)\\s+apa(\\s+saja|\\s+aja)?",
  "(cara\\s+pakai|cara\\s+menggunakan)(mu|nya)?",
].join("|") + ")\\s*(ya|sih|dong)?\\s*[?.!]*$", "i");

/**
 * Sapaan, terima kasih, atau pertanyaan umum "bisa bantu apa" — yang dijawab tanpa data.
 * `null` untuk semua yang lain, termasuk sapaan yang diikuti permintaan ("halo, tiket saya gimana?").
 */
export function sapaanAtauKemampuan(teks: string): "sapaan" | "kemampuan" | "terima-kasih" | null {
  const t = teks.trim();
  if (!t || t.length > 120) return null;
  if (TERIMA_KASIH.test(t)) return "terima-kasih";
  const adaSapa = AWAL_SAPA.test(t);
  let sisa = t.replace(AWAL_SAPA, "").replace(PANGGILAN, "").trim();
  if (!sisa) return adaSapa ? "sapaan" : null;
  sisa = sisa.replace(/^[,.;:!\-–—]+\s*/, "");
  return KEMAMPUAN.test(sisa) ? "kemampuan" : null;
}

// ==================================================================== Tahap 4 (F.6): periode

const BULAN: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, pebruari: 2, maret: 3, mar: 3, april: 4, apr: 4, mei: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, agt: 8, ags: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, november: 11, nov: 11, nop: 11, desember: 12, des: 12, dec: 12,
};
const NAMA_BULAN = Object.keys(BULAN).sort((a, b) => b.length - a.length).join("|");
const dua = (n: number) => String(n).padStart(2, "0");

/** Nama argumen alat yang berarti periode waktu. Dipakai untuk SEMUA alat, bukan hanya total_penjualan. */
export const POLA_ARG_PERIODE = /^(relatif|dari|sampai|bulan|periode|tahun|tanggal|mulai|akhir|(tanggal|bulan|periode)_?(dari|sampai|mulai|akhir|awal)|(dari|sampai)_?(tanggal|bulan))$/i;

export type PeriodeTeks = { label: string; dari?: string; sampai?: string; relatif?: "bulan_ini" | "bulan_lalu" | "tahun_ini" | "tahun_lalu" };

/**
 * Periode yang DISEBUT dalam teks pengguna, dihitung kode (bukan model). `hariIni` = "YYYY-MM".
 * Bulan tanpa tahun = kemunculan terakhir yang sudah lewat atau sedang berjalan (aturan yang sama dengan
 * instruksi agent). `null` kalau tidak ada periode yang jelas — jangan menebak.
 */
export function periodeDalamTeks(teks: string, hariIni: string): PeriodeTeks | null {
  const t = ` ${teks.toLowerCase().replace(/\s+/g, " ")} `;
  const [thIni, blIni] = hariIni.split("-").map(Number);
  const relatif: [RegExp, PeriodeTeks["relatif"]][] = [
    [/\bbulan\s+(ini|sekarang)\b/, "bulan_ini"], [/\bbulan\s+(lalu|kemarin|kemaren|sebelumnya)\b/, "bulan_lalu"],
    [/\btahun\s+(ini|sekarang)\b/, "tahun_ini"], [/\btahun\s+(lalu|kemarin|kemaren|sebelumnya)\b/, "tahun_lalu"],
  ];
  for (const [re, r] of relatif) {
    const m = re.exec(t);
    if (m) return { label: m[0].trim(), relatif: r };
  }
  const iso = /\b(20\d{2})-(0[1-9]|1[0-2])\b/g;
  const isoAda = [...t.matchAll(iso)].map((m) => `${m[1]}-${m[2]}`);
  if (isoAda.length) return { label: isoAda.join(" s.d. "), dari: isoAda[0], sampai: isoAda.at(-1) };
  const reBulan = new RegExp(`\\b(${NAMA_BULAN})\\.?(?:\\s+(20\\d{2}))?\\b`, "g");
  const ketemu = [...t.matchAll(reBulan)];
  if (ketemu.length) {
    const tahunUmum = ketemu.map((m) => m[2]).filter(Boolean).at(-1);
    const jadi = ketemu.map((m) => {
      const bl = BULAN[m[1]];
      const th = m[2] ? Number(m[2]) : tahunUmum ? Number(tahunUmum) : bl <= blIni ? thIni : thIni - 1;
      return `${th}-${dua(bl)}`;
    });
    const urut = [...jadi].sort();
    return { label: ketemu.map((m) => m[0].trim()).join(" s.d. "), dari: urut[0], sampai: urut.at(-1) };
  }
  const tahun = /\btahun\s+(20\d{2})\b/.exec(t);
  if (tahun) return { label: tahun[0].trim(), dari: `${tahun[1]}-01`, sampai: `${tahun[1]}-12` };
  return null;
}

// ==================================================================== Tahap 6 (F.8): pilihan pengguna

const padat = (s: string) => normal(s).replace(/\s+/g, "");

/**
 * Apakah nilai pilihan yang dikirim model memang BERASAL dari kata-kata pengguna?
 * Cocok kalau labelnya (tanpa spasi/tanda baca) muncul di teks pengguna, atau semua kata isinya muncul.
 * Jawaban nomor ("2") dipetakan ke daftar pilihan yang terakhir ditampilkan.
 */
export function pilihanBerdasar(nilai: string, teksPengguna: string, pilihanTampil: string[] = [], jawabanTerakhir = ""): boolean {
  const v = nilai.trim();
  if (!v) return true;
  const isi = padat(teksPengguna);
  if (padat(v) && isi.includes(padat(v))) return true;
  const kata = normal(v).split(" ").filter((w) => w.length >= 3);
  if (kata.length && kata.every((w) => normal(teksPengguna).split(" ").includes(w))) return true;
  const nomor = /^\s*(nomor\s*|no\.?\s*)?(\d{1,2})\s*$/i.exec(jawabanTerakhir);
  const dariNomor = nomor ? pilihanTampil[Number(nomor[2]) - 1] : undefined;
  return !!dariNomor && padat(dariNomor).includes(padat(v));
}
