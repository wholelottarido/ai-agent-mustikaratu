/**
 * Ubah jawaban agent jadi bentuk yang terbaca di WhatsApp.
 *
 * ⚠️ INI JARING PENGAMAN, BUKAN ANDALAN.
 *
 * Pertahanan utamanya ada di instruksi agent (`FORMAT_WA` di
 * `voltagent/agents.ts`) yang melarang tabel sejak awal. Tapi model tidak
 * selalu menurut -- dan kalau sekali saja dia mengeluarkan tabel, yang sampai
 * ke HP user adalah deretan `|---|---|` yang tidak terbaca sama sekali.
 * Lebih murah mengubahnya di sini daripada berharap.
 *
 * WhatsApp cuma mengenal: *tebal*, _miring_, ~coret~, ```monospace```.
 * Tidak ada tabel, tidak ada judul, tidak ada tautan berlabel.
 */
import { rapikanJawaban } from "../lib/rapikan-jawaban.ts";

/**
 * Batas aman satu pesan WhatsApp.
 *
 * Batas resminya jauh lebih besar, tapi pesan panjang di HP jadi menyiksa
 * dibaca dan rawan terpotong di sebagian klien. 3.500 memberi ruang untuk
 * imbuhan sumber data di akhir.
 */
const BATAS_PESAN = 3500;

/** Baris pemisah tabel markdown: `|---|:--:|` dan variasinya. */
const PEMISAH_TABEL = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

function selPadaBaris(baris: string): string[] {
  return baris
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((s) => s.trim());
}

/**
 * Satu tabel markdown -> daftar.
 *
 * Dua kolom jadi satu baris (`• Januari: Rp 123`), tiga kolom atau lebih
 * jadi blok bertingkat -- memaksa 4 kolom ke satu baris malah tidak terbaca
 * di layar HP yang sempit.
 */
function tabelJadiDaftar(kepala: string[], isi: string[][]): string {
  if (kepala.length === 2) {
    return isi.map((b) => `• ${b[0]}: ${b[1] ?? ""}`).join("\n");
  }

  return isi
    .map((b) => {
      const judul = `*${b[0]}*`;
      const rinci = kepala
        .slice(1)
        .map((k, i) => `   ${k}: ${b[i + 1] ?? "-"}`)
        .join("\n");
      return `${judul}\n${rinci}`;
    })
    .join("\n\n");
}

/** Ganti semua tabel markdown di teks dengan daftar. */
function buangTabel(teks: string): string {
  const baris = teks.split("\n");
  const hasil: string[] = [];

  for (let i = 0; i < baris.length; i++) {
    const sekarang = baris[i];
    const berikut = baris[i + 1];

    // Tabel dikenali dari POLA DUA BARIS: baris berisi `|`, diikuti baris
    // pemisah. Kalau cuma mengecek adanya `|`, kalimat biasa yang kebetulan
    // memuat garis tegak ikut terpotong.
    const awalTabel = sekarang?.includes("|") && berikut && PEMISAH_TABEL.test(berikut);
    if (!awalTabel) {
      hasil.push(sekarang);
      continue;
    }

    const kepala = selPadaBaris(sekarang);
    const isi: string[][] = [];
    i += 2; // lewati baris kepala & pemisah
    while (i < baris.length && baris[i].includes("|")) {
      isi.push(selPadaBaris(baris[i]));
      i++;
    }
    i--; // kembalikan satu, karena for-loop akan menambah lagi

    hasil.push(tabelJadiDaftar(kepala, isi));
  }

  return hasil.join("\n");
}

/** Markdown -> format WhatsApp. */
export function keWhatsApp(teks: string): string {
  // LaTeX dirapikan DULU. WhatsApp sama tidak kenalnya dengan react-markdown,
  // jadi `$\rightarrow$` sampai ke HP apa adanya — dan di sana user tidak
  // punya cara menebak maksudnya. Panah Unicode terbaca di semua klien.
  let t = buangTabel(rapikanJawaban(teks));

  // Judul `## Omzet` -> baris tebal. Dilakukan sebelum penanganan bintang,
  // supaya hasilnya tidak diproses dua kali.
  t = t.replace(/^#{1,6}\s+(.+)$/gm, (_, isi) => `*${String(isi).trim()}*`);

  // **tebal** -> *tebal*. WhatsApp memakai SATU bintang; dua bintang tampil
  // apa adanya beserta bintangnya.
  // `[\s\S]` dipakai, bukan flag `s` (dotAll): target TypeScript project ini
  // di bawah es2018 dan menolak flag itu saat compile.
  t = t.replace(/\*\*([\s\S]+?)\*\*/g, "*$1*");

  // Penanda daftar `- ` dan `* ` -> `• `. Bintang di awal baris berbahaya:
  // WhatsApp bisa menganggapnya awal teks tebal dan menebalkan separuh pesan.
  t = t.replace(/^[ \t]*[-*][ \t]+/gm, "• ");

  // Tautan berlabel `[teks](url)` -> `teks (url)`. WhatsApp tidak mengenal
  // sintaksnya dan akan menampilkan kurung siku mentah.
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");

  // Rapikan baris kosong beruntun.
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

/**
 * Pecah pesan panjang jadi beberapa bagian.
 *
 * Dipotong di batas BARIS, bukan di tengah kalimat -- dan tidak pernah di
 * tengah blok monospace, karena penutup ``` yang tertinggal di bagian lain
 * membuat sisa pesan tampil sebagai kode.
 */
export function pecah(teks: string, batas = BATAS_PESAN): string[] {
  if (teks.length <= batas) return [teks];

  const bagian: string[] = [];
  let sekarang = "";

  for (const baris of teks.split("\n")) {
    if (sekarang && sekarang.length + baris.length + 1 > batas) {
      bagian.push(sekarang);
      sekarang = "";
    }
    // Satu baris saja sudah melewati batas (jarang, tapi mungkin kalau model
    // menulis satu paragraf panjang tanpa enter): potong paksa.
    if (baris.length > batas) {
      for (let i = 0; i < baris.length; i += batas) bagian.push(baris.slice(i, i + batas));
      continue;
    }
    sekarang = sekarang ? `${sekarang}\n${baris}` : baris;
  }

  if (sekarang) bagian.push(sekarang);
  return bagian;
}
