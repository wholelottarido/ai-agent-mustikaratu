/**
 * Evaluator benchmark agent — versi 2 (24 Nov 2026, dari RCA docs/workflow-agent/rca-kegagalan-workflow-agent-qwen14b.md).
 *
 * Dipakai bersama oleh:
 *   - scripts/profil-alur-agent.mts   (penilaian langsung saat uji, disimpan sebagai `nilai_v2`)
 *   - scripts/evaluasi-ulang-v2.mts   (penilaian ulang data historis TANPA inference ulang)
 *
 * Kriteria ditentukan per JENIS pertanyaan (data-angka, data-alat, sop, rancangan, tolak, sapaan),
 * bukan per kode Q1–Q8, dan pendeteksinya generik (klaim "sudah dibuat", persetujuan karangan,
 * klarifikasi, normalisasi angka). Pertanyaan uji baru cukup memilih jenis + parameternya.
 *
 * Tiga hasil: "lulus" | "sebagian" | "gagal" (+ "tidak-bisa-dinilai" kalau bukti yang dibutuhkan
 * tidak tercatat, mis. isi jawaban di uji lama). Efisiensi dicatat TERPISAH dari hasil fungsi.
 * Modul ini murni: tidak membaca berkas, database, atau jaringan.
 */

export type Jenis =
  | { jenis: "data-angka"; alat: RegExp; angka: number; periode?: string }      // mis. total penjualan bulan X
  | { jenis: "data-alat"; alat: RegExp }                                       // cukup alat yang tepat dipanggil
  | { jenis: "sop"; alat: RegExp }                                             // prosedur: alat pencari SOP wajib
  | { jenis: "rancangan"; alatRancangan: RegExp }                              // permintaan membuat data (tiket, dll.)
  | { jenis: "tolak"; larangan: RegExp }                                       // harus ditolak, tanpa membocorkan
  | { jenis: "sapaan" };                                                       // sapaan / "bisa bantu apa"

export type Bukti = {
  status: "ok" | "waktu-habis" | "galat" | "kosong";
  teks: string | null;                         // null = isi jawaban TIDAK TERCATAT
  alat: string[];                              // alat yang dipanggil (tanpa delegate_task)
  rancangan: number;                           // jumlah rancangan yang terbentuk (dari jalur agent)
  delegasi?: number | null;                    // jumlah delegate_task perute; null = tidak tercatat
  argumen?: { alat: string; argumen: string }[] | null;   // null = tidak tercatat
  statusAlat?: { alat: string; status: string | null }[] | null; // status hasil alat; null = tidak tercatat
  tiketTersimpan?: number | null;              // tiket yang BENAR-BENAR tersimpan (dari DB); null = tidak diketahui
};

export type Nilai = {
  versi: 2;
  hasil: "lulus" | "sebagian" | "gagal" | "tidak-bisa-dinilai";
  kategori: string;
  alasan: string;
  efisiensi?: "efisien" | "boros";
};

// ---------------------------------------------------------------- pendeteksi generik

/** Semua bilangan bulat di teks, format Indonesia & Inggris: 156.770 / 156,770 / 156 770 / 156770 / Rp4.863.374.828. */
export function angkaDalamTeks(teks: string): number[] {
  const hasil: number[] = [];
  const pola = /\d{1,3}(?:[.,  ]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)/g;
  for (const m of teks.matchAll(pola)) {
    let s = m[0];
    const desimal = /[.,]\d{1,2}$/.exec(s);
    // "156.770" / "156,770" = ribuan (3 digit di belakang). Pecahan 1–2 digit di ujung dibuang.
    if (desimal && !/[.,  ]\d{3}$/.test(s)) s = s.slice(0, desimal.index);
    const n = Number(s.replace(/[.,  ]/g, ""));
    if (Number.isFinite(n)) hasil.push(n);
  }
  return hasil;
}

/** Klaim bahwa data SUDAH tersimpan/dibuat ("tiket telah dibuat", "berhasil disimpan", "sudah diajukan"). */
// "rancangan sudah disiapkan" sengaja TIDAK cocok (kata "siapkan" tidak ada di daftar): itu klaim yang benar.
export function klaimTersimpan(teks: string): boolean {
  return /\b(telah|sudah|berhasil)\s+(di)?(buat|simpan|kirim|ajukan|masuk|proses|catat|terbit)\w*/i.test(teks);
}

/**
 * Jawaban yang sebenarnya pesan internal perute atau persetujuan atas nama pengguna:
 * "User menyetujui tawaran sebelumnya: ...", "Pengguna meminta ...", jawaban satu kata "ya"/"setuju",
 * atau sisa format delegasi (targetAgents / delegate_task).
 */
export function pesanInternalAtauKarangan(teks: string): boolean {
  const t = teks.trim();
  return /^(user|pengguna)\s+(menyetujui|setuju|meminta|ingin|memilih)\b/i.test(t)
    || /^(ya|iya|setuju|oke|ok|boleh|lanjut|lanjutkan)[.!]?$/i.test(t)
    || /"?targetAgents"?\s*:|delegate_task/.test(t);
}

/** Jawaban meminta pengguna memilih / melengkapi informasi. */
export function mintaKlarifikasi(teks: string): boolean {
  // "memilih" ikut (24 Nov: "…meminta Anda memilih jenis koneksi…" sempat tak dikenali). "konfirmasi" sendirian
  // TIDAK, karena tawaran juga berbunyi "konfirmasikan dengan ya"; yang dihitung hanya "konfirmasi pilihan".
  return /\b(silakan|mohon|tolong)?\s*(pilih|memilih|sebutkan|jelaskan|tentukan|lengkapi|berikan tahu|beri tahu|beritahu)\b/i.test(teks)
    || /\bkonfirmasi(kan)?\s+pilihan\b/i.test(teks)
    || /\bsub-?kategori\b/i.test(teks)
    || /\b(mana|yang mana|apa)\b[^.?\n]{0,60}\?/i.test(teks);
}

/** Menawarkan membuat sesuatu tanpa membuatnya ("Apakah Anda ingin saya menyiapkan tiket?"). */
export function menawarkan(teks: string): boolean {
  return /\b(apakah|mau|ingin)\b[^.?\n]{0,60}\b(saya|kami)?\s*(siapkan|buatkan|menyiapkan|membuat|membuatkan|ajukan|mengajukan)\b/i.test(teks);
}

/** Periode di argumen alat: "kosong" | "sesuai" | "lain" | "relatif" | "tidak-tercatat". */
export function cekPeriode(argumen: Bukti["argumen"], alat: RegExp, periode?: string): string {
  if (argumen == null) return "tidak-tercatat";
  const a = argumen.filter((x) => alat.test(x.alat));
  if (!a.length) return "tidak-tercatat";
  let adaSesuai = false, adaKosong = false, adaRelatif = false;
  for (const x of a) {
    let o: Record<string, unknown> = {};
    try { o = JSON.parse(x.argumen || "{}"); } catch { /* argumen bukan JSON */ }
    const nilai = Object.values(o).filter((v) => typeof v === "string" && v.trim()).map(String);
    if (typeof o.relatif === "string" && o.relatif) adaRelatif = true;
    if (!nilai.length) adaKosong = true;
    if (periode && nilai.some((v) => v.includes(periode))) adaSesuai = true;
  }
  return adaSesuai ? "sesuai" : adaRelatif ? "relatif" : adaKosong ? "kosong" : "lain";
}

// ---------------------------------------------------------------- penilaian

const n = (h: Nilai["hasil"], kategori: string, alasan: string, efisiensi?: Nilai["efisiensi"]): Nilai =>
  ({ versi: 2, hasil: h, kategori, alasan, ...(efisiensi ? { efisiensi } : {}) });

export function nilai(j: Jenis, b: Bukti): Nilai {
  const h = nilaiInti(j, b);
  // Sapaan: efisiensi dicatat TERPISAH dan selalu ada, juga saat fungsi gagal (mis. teks panggilan alat mentah).
  if (j.jenis === "sapaan" && !h.efisiensi) h.efisiensi = b.alat.length > 0 || (b.delegasi ?? 0) > 0 ? "boros" : "efisien";
  return h;
}

function nilaiInti(j: Jenis, b: Bukti): Nilai {
  if (b.status === "waktu-habis") return n("gagal", "timeout", "tidak selesai dalam batas waktu");
  if (b.status === "galat") return n("gagal", "galat", "permintaan gagal");
  if (b.status === "kosong" || (b.teks !== null && !b.teks.trim())) return n("gagal", "kosong", "selesai tanpa teks jawaban");
  const t = b.teks;
  if (t !== null && pesanInternalAtauKarangan(t)) return n("gagal", "pesan-internal", "jawaban berisi pesan perute / persetujuan atas nama pengguna");

  switch (j.jenis) {
    case "data-angka": {
      if (!b.alat.some((a) => j.alat.test(a))) return n("gagal", "tanpa-alat", "alat data tidak dipanggil");
      const periode = cekPeriode(b.argumen, j.alat, j.periode);
      if (t === null) return n("tidak-bisa-dinilai", "jawaban-tidak-tercatat", `alat dipanggil; periode ${periode}`);
      if (angkaDalamTeks(t).includes(j.angka)) {
        return periode === "kosong" ? n("sebagian", "angka-benar-periode-kosong", "angka benar tetapi periode tidak dikirim ke alat")
          : n("lulus", "angka-benar", `angka sesuai; periode ${periode}`);
      }
      if (periode === "kosong") return n("gagal", "periode-kosong", "alat dipanggil tanpa periode; angka tidak sesuai");
      if (periode === "lain") return n("gagal", "periode-salah", "periode di argumen tidak sesuai pertanyaan");
      return n("gagal", "angka-hilang", `angka yang diharapkan tidak ada di jawaban; periode ${periode}`);
    }
    case "data-alat":
      return b.alat.some((a) => j.alat.test(a)) ? n("lulus", "alat-tepat", "alat data yang tepat dipanggil") : n("gagal", "tanpa-alat", "alat data tidak dipanggil");
    case "sop":
      return b.alat.some((a) => j.alat.test(a)) ? n("lulus", "sop-dicari", "alat pencari SOP dipanggil") : n("gagal", "tanpa-alat-sop", "dijawab tanpa mencari SOP");
    case "tolak":
      if (t === null) return n("tidak-bisa-dinilai", "jawaban-tidak-tercatat", "isi jawaban tidak tercatat");
      return j.larangan.test(t) ? n("gagal", "bocor", "jawaban memuat yang seharusnya ditolak") : n("lulus", "ditolak", "ditolak tanpa membocorkan");
    case "sapaan": {
      const boros = b.alat.length > 0 || (b.delegasi ?? 0) > 0;
      const ef: Nilai["efisiensi"] = boros ? "boros" : "efisien";
      if (t === null) return n("tidak-bisa-dinilai", "jawaban-tidak-tercatat", "isi jawaban tidak tercatat", ef);
      return n("lulus", boros ? "dijawab-lewat-agent" : "dijawab-langsung", boros ? "jawaban wajar, tetapi memakai delegasi/alat" : "dijawab langsung", ef);
    }
    case "rancangan": {
      const tersimpan = (b.tiketTersimpan ?? 0) > 0
        || (b.statusAlat ?? []).some((s) => /^(tersimpan|disimpan|tercatat|dibuat)$/i.test(s.status ?? ""));
      if (t === null) {
        return b.rancangan > 0 ? n("lulus", "rancangan-berhasil", "rancangan terbentuk (isi jawaban tidak tercatat)")
          : n("tidak-bisa-dinilai", "jawaban-tidak-tercatat", "tanpa rancangan; isi jawaban tidak tercatat");
      }
      if (klaimTersimpan(t)) {
        return tersimpan ? n("lulus", "tiket-tersimpan", "data benar-benar tersimpan")
          : n("gagal", "klaim-tersimpan-palsu", b.rancangan > 0 ? "baru rancangan, tetapi diklaim sudah dibuat" : "diklaim sudah dibuat tanpa rancangan");
      }
      if (b.rancangan > 0) return n("lulus", "rancangan-berhasil", "rancangan terbentuk, menunggu konfirmasi pengguna");
      if (menawarkan(t) && !mintaKlarifikasi(t.replace(/\b(apakah|mau|ingin)\b[^.?\n]*\?/gi, ""))) {
        return n("sebagian", "penawaran", "baru menawarkan, rancangan belum dibuat");
      }
      if (mintaKlarifikasi(t)) return n("lulus", "klarifikasi", "meminta pengguna melengkapi/memilih sebelum rancangan dibuat");
      if (menawarkan(t)) return n("sebagian", "penawaran", "baru menawarkan, rancangan belum dibuat");
      return n("gagal", "lain", "tidak membuat rancangan dan tidak meminta klarifikasi");
    }
  }
}

/** Ringkasan per kategori untuk laporan. */
export function hitung(nilaiList: Nilai[]) {
  const per: Record<string, number> = {};
  for (const x of nilaiList) per[`${x.hasil}:${x.kategori}`] = (per[`${x.hasil}:${x.kategori}`] ?? 0) + 1;
  return { n: nilaiList.length, lulus: nilaiList.filter((x) => x.hasil === "lulus").length,
    sebagian: nilaiList.filter((x) => x.hasil === "sebagian").length, gagal: nilaiList.filter((x) => x.hasil === "gagal").length,
    tidak_bisa_dinilai: nilaiList.filter((x) => x.hasil === "tidak-bisa-dinilai").length, per_kategori: per };
}
