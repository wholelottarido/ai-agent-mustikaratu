/**
 * Membuat PDF dari teks dokumen, dan membacanya kembali per halaman.
 *
 * ⚠️ KENAPA PERLU MEMBUAT PDF PADAHAL TEKSNYA SUDAH ADA.
 *
 * Supaya rujukan "halaman sekian baris sekian" punya arti. Nomor halaman cuma
 * ada kalau dokumennya memang berhalaman; selama isinya cuma kolom `text` di
 * database, angka halaman apa pun adalah karangan.
 *
 * ⚠️ DAN SATU ATURAN YANG TIDAK BOLEH DILANGGAR.
 *
 * Potongan serta vektornya WAJIB dihitung dari teks yang dibaca BALIK dari
 * PDF, bukan dari teks asli yang dipakai menggambarnya. Kalau dari teks asli,
 * nomor baris yang disimpan belum tentu cocok dengan yang dilihat user waktu
 * membuka PDF-nya -- dan rujukan yang meleset lebih berbahaya daripada tidak
 * ada rujukan, karena user percaya begitu saja.
 *
 * Diminta pemilik proyek 1 Okt 2026: "pastikan data yang di store di database
 * merupakan hasil pdf yang sudah di vector".
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

/** Satu baris yang BENAR-BENAR digambar ke PDF, beserta letaknya. */
export type BarisPdf = {
  /** 1-based. */
  halaman: number;
  /** 1-based, dihitung ulang tiap halaman. Baris VISUAL, bukan paragraf. */
  baris: number;
  teks: string;
  /** Paragraf asal di teks sumber, 0-based. Dipakai menentukan batas potongan. */
  paragraf: number;
};

/**
 * Hasil penggambaran: berkasnya, dan peta tiap baris yang digambar.
 *
 * ⚠️ `tataLetak` ADA KARENA BATAS PARAGRAF HILANG WAKTU PDF DIBACA BALIK.
 *
 * Baris kosong antar-paragraf tidak digambar apa pun, jadi waktu diekstrak
 * ulang yang kembali cuma deretan baris berisi -- tanpa penanda di mana satu
 * gagasan berakhir dan gagasan berikutnya mulai. Memotong tanpa itu berarti
 * memotong di tengah kalimat.
 *
 * Peta ini merekam batas paragraf PADA SAAT MENGGAMBAR, lalu dipakai untuk
 * mengelompokkan baris hasil BACA BALIK. Jadi strukturnya dari render, tapi
 * ISI potongannya tetap dari PDF -- yang memang jadi syaratnya.
 */
export type HasilPdf = {
  bita: Uint8Array;
  tataLetak: BarisPdf[];
};

/** A4 dalam titik, ukuran kertas yang dipakai dokumen kantor. */
const LEBAR_HAL = 595;
const TINGGI_HAL = 842;
const MARGIN = 56;
const UKURAN_HURUF = 11;
const TINGGI_BARIS = 15;

/**
 * Font bawaan pdf-lib memakai penyandian WinAnsi yang tidak mengenal semua
 * huruf Unicode. Tanda kutip melengkung dan tanda pisah panjang sering ikut
 * terbawa dari teks yang disusun di editor, dan satu huruf yang tidak dikenal
 * membuat seluruh penulisan PDF GAGAL -- bukan cuma huruf itu yang hilang.
 *
 * Diganti ke padanan ASCII-nya, bukan dibuang, supaya kalimatnya tetap utuh.
 */
function amanWinAnsi(teks: string): string {
  return teks
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/[^\x00-\xFF]/g, "?");
}

/** Pecah paragraf jadi baris selebar area cetak, sambil menahan nomor paragrafnya. */
function bungkusBaris(
  teks: string,
  font: { widthOfTextAtSize: (t: string, u: number) => number },
): { teks: string; paragraf: number }[] {
  const lebarIsi = LEBAR_HAL - MARGIN * 2;
  const keluar: { teks: string; paragraf: number }[] = [];
  const paragrafs = teks.split("\n");

  for (let i = 0; i < paragrafs.length; i++) {
    const paragraf = paragrafs[i];
    if (!paragraf.trim()) {
      // Baris kosong: tetap memakan tinggi di halaman, tapi tidak digambar
      // dan TIDAK masuk peta -- karena nanti juga tidak terbaca balik.
      keluar.push({ teks: "", paragraf: i });
      continue;
    }
    let baris = "";
    for (const kata of paragraf.split(/\s+/)) {
      const coba = baris ? `${baris} ${kata}` : kata;
      if (font.widthOfTextAtSize(coba, UKURAN_HURUF) > lebarIsi) {
        if (baris) keluar.push({ teks: baris, paragraf: i });
        baris = kata;
      } else {
        baris = coba;
      }
    }
    if (baris) keluar.push({ teks: baris, paragraf: i });
  }
  return keluar;
}

/**
 * Gambar teks jadi PDF A4, sambil merekam letak tiap baris.
 *
 * ⚠️ `judul` DIGAMBAR SEBAGAI BARIS PERTAMA, dan itu bukan hiasan.
 *
 * Dua alasan, keduanya terukur:
 *
 * 1. PDF yang akan diunduh user harus berjudul. Dokumen tanpa judul yang
 *    tersimpan di komputer orang tidak bisa dikenali lagi seminggu kemudian.
 *
 * 2. Judul adalah PEMBEDA antara dokumen yang bertetangga topik. Waktu judul
 *    belum ikut, `test:kb` turun dari 12/12 ke 9/12, dan ketiga yang meleset
 *    polanya sama persis: "Penghapusan Akun Karyawan yang KELUAR" tertukar
 *    dengan "Permintaan Email BARU", "Pengajuan KLAIM" tertukar dengan
 *    "ANGGARAN Program". Isi badan dokumennya memang mirip; yang memisahkan
 *    cuma judulnya.
 */
export async function buatPdf(judul: string, isi: string): Promise<HasilPdf> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontJudul = await pdf.embedFont(StandardFonts.HelveticaBold);

  let halaman = pdf.addPage([LEBAR_HAL, TINGGI_HAL]);
  let nomorHal = 1;
  let barisDiHal = 0;
  let y = TINGGI_HAL - MARGIN;
  const tataLetak: BarisPdf[] = [];

  // Judul: huruf tebal, sedikit lebih besar, lalu jarak sebelum isi.
  // Paragraf -1 supaya tidak pernah tergabung ke paragraf isi mana pun --
  // judul selalu jadi awal potongan pertama, bukan ekor sesuatu.
  const judulBersih = amanWinAnsi(judul);
  halaman.drawText(judulBersih, {
    x: MARGIN,
    y,
    size: UKURAN_HURUF + 3,
    font: fontJudul,
    color: rgb(0, 0, 0),
  });
  barisDiHal++;
  tataLetak.push({ halaman: nomorHal, baris: barisDiHal, teks: judulBersih, paragraf: -1 });
  y -= TINGGI_BARIS * 2;

  for (const b of bungkusBaris(amanWinAnsi(isi), font)) {
    if (y < MARGIN) {
      halaman = pdf.addPage([LEBAR_HAL, TINGGI_HAL]);
      nomorHal++;
      barisDiHal = 0;
      y = TINGGI_HAL - MARGIN;
    }
    if (b.teks) {
      halaman.drawText(b.teks, {
        x: MARGIN,
        y,
        size: UKURAN_HURUF,
        font,
        color: rgb(0, 0, 0),
      });
      barisDiHal++;
      tataLetak.push({
        halaman: nomorHal,
        baris: barisDiHal,
        teks: b.teks,
        paragraf: b.paragraf,
      });
    }
    y -= TINGGI_BARIS;
  }
  return { bita: await pdf.save(), tataLetak };
}

/**
 * Baca PDF kembali, satu string per halaman.
 *
 * ⚠️ `mergePages: false`, berbeda dari `lib/dokumen/baca.ts` yang memakai
 * `true`. Di sana yang dibutuhkan cuma isinya untuk dibaca model; di sini
 * batas halamannya justru yang jadi barang utama.
 */
export async function bacaPdfPerHalaman(bita: Uint8Array): Promise<string[]> {
  // ⚠️ SALIN DULU. pdf.js MENGOSONGKAN array yang dioper ke sini.
  //
  // `getDocumentProxy` mengambil alih ArrayBuffer-nya (detach), jadi sesudah
  // dipanggil, array milik PEMANGGIL jadi panjang 0. Gejalanya jauh dari
  // sebabnya: di `isi-kb-dari-pdf.mts`, PDF 2.140 bita dibaca dulu lalu
  // disimpan — dan yang masuk database 0 bita, tanpa galat apa pun.
  //
  // Disalin di SINI, bukan di pemanggil, supaya pemanggil berikutnya tidak
  // perlu tahu jebakan ini. Salinannya ~2 KB per dokumen.
  const proxy = await getDocumentProxy(new Uint8Array(bita));
  const hasil = await extractText(proxy, { mergePages: false });
  const teks = hasil.text as unknown as string[];
  return Array.isArray(teks) ? teks : [String(teks)];
}
