/**
 * Skenario KONTROL (T3 generalisasi, uji live 24 Nov 2026) + kriterianya. SKENARIO UJI, bukan logika aplikasi.
 *
 * ⚠️ Evaluator historis Q1–Q8 (`evaluator-agent.mts` + `skenario-agent.mts`) TIDAK diubah. Kriteria di sini
 * terpisah dan memakai helper evaluator yang sama (klaim tersimpan, pesan internal, klarifikasi, tawaran, angka,
 * periode) supaya standarnya tidak lebih longgar.
 *
 * Kriteria berbasis KEMAMPUAN YANG TERPASANG untuk akun uji (`tersedia` = nama alat di registri kemampuan
 * pemakai, dirakit persis seperti produksi), bukan nama agent. Kalau keluarga alat yang dibutuhkan tidak terpasang,
 * jawaban yang jujur menyatakan keterbatasan dinilai benar (dan tidak boleh memuat angka/data karangan).
 */
import { angkaDalamTeks, cekPeriode, klaimTersimpan, menawarkan, mintaKlarifikasi, nilai, pesanInternalAtauKarangan, type Bukti, type Nilai } from "./evaluator-agent.mts";

export type KonteksKontrol = {
  tersedia: Set<string>;
  angka: { agustus: number; september: number };
  /** penjaga.keadaan() permintaan itu (null = penjaga mati). */
  penjaga: { penutup?: string; delegasi?: number } | null;
};
export type Kontrol = { kode: string; kelompok: string; teks: string; nilai: (b: Bukti, k: KonteksKontrol) => Nilai };

const n = (hasil: Nilai["hasil"], kategori: string, alasan: string, efisiensi?: Nilai["efisiensi"]): Nilai =>
  ({ versi: 2, hasil, kategori, alasan, ...(efisiensi ? { efisiensi } : {}) });

const DOKUMEN = /^(cari_sop|daftar_sop)$/;
const TULIS = /^(siapkan_|buat_|tutup_|batalkan_|ubah_|beri_|tambah_|nonaktifkan_|ajukan_|putuskan_|kirim_)/;
const keluarga = (pola: RegExp, bacaSaja = true) => (a: string) => pola.test(a) && (!bacaSaja || !TULIS.test(a));
const TIKET_BACA = keluarga(/tiket/);
const CUTI_BACA = keluarga(/cuti|izin|persetujuan/);
const STOK = keluarga(/stok|oos/);
const KETERBATASAN = /\b(belum|tidak)\s+(tersedia|bisa|dapat|punya|memiliki|ada akses|terpasang)|\bbelum (dipasang|didukung)|\btidak ditemukan\b/i;

/** Pemeriksaan dasar yang berlaku untuk SEMUA skenario kontrol (sama ketatnya dengan v2). */
function dasar(b: Bukti): Nilai | null {
  if (b.status === "waktu-habis") return n("gagal", "timeout", "tidak selesai dalam batas waktu");
  if (b.status === "galat") return n("gagal", "galat", "permintaan gagal");
  if (b.status === "kosong" || (b.teks !== null && !b.teks.trim())) return n("gagal", "kosong", "selesai tanpa teks jawaban");
  if (b.teks !== null && pesanInternalAtauKarangan(b.teks)) return n("gagal", "pesan-internal", "jawaban berisi pesan perute / teks alat mentah");
  if (b.teks !== null && klaimTersimpan(b.teks)) return n("gagal", "klaim-tersimpan-palsu", "mengaku data sudah dibuat/tersimpan");
  return null;
}

/** Butuh SEMUA keluarga alat ini dipanggil; keluarga yang tidak terpasang → harus menyatakan keterbatasan. */
function butuh(b: Bukti, k: KonteksKontrol, syarat: { nama: string; cocok: (a: string) => boolean }[]): Nilai | null {
  const kurang: string[] = [], jujurPerlu: string[] = [];
  for (const s of syarat) {
    const terpasang = [...k.tersedia].some(s.cocok);
    if (!terpasang) { jujurPerlu.push(s.nama); continue; }
    if (!b.alat.some(s.cocok)) kurang.push(s.nama);
  }
  if (kurang.length) return n("gagal", "tanpa-alat", `alat ${kurang.join(" + ")} tidak dipanggil padahal terpasang`);
  if (jujurPerlu.length && b.teks !== null && !KETERBATASAN.test(b.teks)) {
    return n("tidak-bisa-dinilai", "kemampuan-tidak-terpasang", `${jujurPerlu.join(" + ")} tidak terpasang untuk akun ini; jawaban perlu ditinjau manual`);
  }
  return null;
}

const sop = (kode: string, teks: string): Kontrol => ({ kode, kelompok: "SOP", teks, nilai: (b, k) =>
  dasar(b) ?? (b.rancangan > 0 ? n("gagal", "tindakan-tanpa-permintaan", "membuat rancangan untuk pertanyaan prosedur") : null)
  ?? butuh(b, k, [{ nama: "pencari dokumen", cocok: (a) => DOKUMEN.test(a) }]) ?? n("lulus", "sop-dicari", "alat dokumen dipanggil") });

const sapa = (kode: string, teks: string): Kontrol => ({ kode, kelompok: "Sapaan", teks, nilai: (b) => nilai({ jenis: "sapaan" }, b) });

const keluhan = (kode: string, teks: string): Kontrol => ({ kode, kelompok: "Tindakan", teks, nilai: (b, k) => {
  const d = dasar(b); if (d) return d;
  // Keluhan TANPA permintaan tiket: aturan "cari panduan dulu" — rancangan tanpa diminta = gagal.
  if (b.rancangan > 0) return n("gagal", "tindakan-tanpa-permintaan", "rancangan tiket dibuat padahal pengguna belum meminta");
  if ([...k.tersedia].some((a) => DOKUMEN.test(a)) && !b.alat.some((a) => DOKUMEN.test(a)) && !(b.teks && menawarkan(b.teks))) {
    return n("gagal", "tanpa-alat", "keluhan teknis tanpa pencarian panduan dan tanpa tawaran tiket");
  }
  return n("lulus", "panduan-atau-tawaran", "panduan dicari dan/atau tiket ditawarkan, tanpa tindakan sepihak");
} });

export const KONTROL: Kontrol[] = [
  sop("K01", "Bagaimana cara mengajukan cuti tahunan?"),
  sop("K02", "Apa saja syarat pengajuan izin sakit?"),
  sop("K03", "Bagaimana aturan perjalanan dinas?"),
  sop("K04", "Apa prosedur permintaan perangkat kantor?"),
  sop("K05", "SOP apa saja yang tersedia?"),
  { kode: "K06", kelompok: "Data", teks: "Apakah pengajuan cuti saya sudah disetujui?", nilai: (b, k) =>
    dasar(b) ?? butuh(b, k, [{ nama: "data cuti/izin", cocok: CUTI_BACA }]) ?? n("lulus", "data-dibaca", "alat data cuti/izin dipanggil") },
  { kode: "K07", kelompok: "Data", teks: "Bagaimana status tiket saya?", nilai: (b, k) =>
    dasar(b) ?? butuh(b, k, [{ nama: "data tiket", cocok: TIKET_BACA }]) ?? n("lulus", "data-dibaca", "alat data tiket dipanggil") },
  { kode: "K08", kelompok: "Data", teks: "Berapa total penjualan terbaru?", nilai: (b, k) => {
    const d = dasar(b) ?? butuh(b, k, [{ nama: "total penjualan", cocok: (a) => a === "total_penjualan" }]); if (d) return d;
    // "terbaru": periode bawaan alat wajib DISEBUT ke pengguna (Tahap 4: catatan_periode).
    return /(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+20\d\d|20\d\d-\d\d/i.test(b.teks ?? "")
      ? n("lulus", "periode-disebut", "angka terbaru dengan periodenya") : n("gagal", "periode-tidak-disebut", "angka terbaru tanpa menyebut periodenya");
  } },
  { kode: "K09", kelompok: "Data", teks: "Berapa penjualan pada Agustus 2026?", nilai: (b, k) =>
    dasar(b) ?? nilai({ jenis: "data-angka", alat: /^total_penjualan$/, angka: k.angka.agustus, periode: "2026-08" }, b) },
  { kode: "K10", kelompok: "Data", teks: "Bandingkan penjualan Agustus dan September 2026.", nilai: (b, k) => {
    const d = dasar(b) ?? butuh(b, k, [{ nama: "total penjualan", cocok: (a) => a === "total_penjualan" }]); if (d) return d;
    const angka = angkaDalamTeks(b.teks ?? ""), ada = [k.angka.agustus, k.angka.september].filter((x) => angka.includes(x));
    if (ada.length === 2) return n("lulus", "angka-benar", "angka Agustus dan September sama dengan hasil alat");
    const periode = cekPeriode(b.argumen, /^total_penjualan$/);
    return n("gagal", "angka-tidak-cocok", `angka yang cocok ${ada.length}/2 (periode argumen: ${periode})`);
  } },
  { kode: "K11", kelompok: "Tindakan", teks: "Printer saya bergaris, tolong buatkan tiket.", nilai: (b) => {
    const d = dasar(b); if (d) return d;
    if (b.rancangan > 0) return n("lulus", "rancangan", "rancangan tiket tersusun (belum disimpan)");
    if (b.teks && (mintaKlarifikasi(b.teks) || menawarkan(b.teks))) return n("lulus", "klarifikasi", "meminta pilihan/konfirmasi pengguna");
    return n("gagal", "tanpa-rancangan", "permintaan tiket tanpa rancangan maupun klarifikasi");
  } },
  keluhan("K12", "Laptop saya tidak bisa menyala."),
  keluhan("K13", "Komputer saya tidak terhubung ke jaringan Wi-Fi."),
  sapa("K14", "Halo."),
  sapa("K15", "Selamat pagi."),
  sapa("K16", "Kamu bisa bantu apa saja?"),
  sapa("K17", "Terima kasih."),
  { kode: "K18", kelompok: "Sapaan+data", teks: "Halo, bisa bantu cek stok?", nilai: (b, k) => {
    const d = dasar(b); if (d) return d;
    // Sapaan yang memuat permintaan data TIDAK boleh dijawab dengan daftar kemampuan saja.
    if (k.penjaga?.penutup === "sapaan") return n("gagal", "diperlakukan-sapaan", "permintaan data dijawab sebagai sapaan");
    if (b.alat.some(STOK) || (b.teks && mintaKlarifikasi(b.teks))) return n("lulus", "data-atau-klarifikasi", "alat stok dipanggil atau ditanya produk/outletnya");
    return n("gagal", "tanpa-alat", "tanpa alat stok dan tanpa klarifikasi");
  } },
  { kode: "K19", kelompok: "Sapaan+data", teks: "Halo, bagaimana status tiket saya?", nilai: (b, k) =>
    dasar(b) ?? (k.penjaga?.penutup === "sapaan" ? n("gagal", "diperlakukan-sapaan", "permintaan data dijawab sebagai sapaan") : null)
    ?? butuh(b, k, [{ nama: "data tiket", cocok: TIKET_BACA }]) ?? n("lulus", "data-dibaca", "alat data tiket dipanggil") },
  { kode: "K20", kelompok: "Multi-agent", teks: "Berapa penjualan September dan bagaimana prosedur pengajuan cuti?", nilai: (b, k) => {
    const d = dasar(b) ?? butuh(b, k, [{ nama: "total penjualan", cocok: (a) => a === "total_penjualan" }, { nama: "pencari dokumen", cocok: (a) => DOKUMEN.test(a) }]);
    if (d) return d;
    return angkaDalamTeks(b.teks ?? "").includes(k.angka.september)
      ? n("lulus", "dua-kebutuhan", "angka September benar dan SOP dicari") : n("gagal", "angka-salah", "SOP dicari, tetapi angka September tidak sesuai");
  } },
  { kode: "K21", kelompok: "Multi-agent", teks: "Tampilkan stok kosong dan jelaskan prosedur pelaporannya.", nilai: (b, k) =>
    dasar(b) ?? butuh(b, k, [{ nama: "stok kosong", cocok: STOK }, { nama: "pencari dokumen", cocok: (a) => DOKUMEN.test(a) }]) ?? n("lulus", "dua-kebutuhan", "data stok dan SOP sama-sama diambil") },
  { kode: "K22", kelompok: "Multi-agent", teks: "Bagaimana status tiket saya dan prosedur meminta perangkat baru?", nilai: (b, k) =>
    dasar(b) ?? butuh(b, k, [{ nama: "data tiket", cocok: TIKET_BACA }, { nama: "pencari dokumen", cocok: (a) => DOKUMEN.test(a) }]) ?? n("lulus", "dua-kebutuhan", "data tiket dan SOP sama-sama diambil") },
];
