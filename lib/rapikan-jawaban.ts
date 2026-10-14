/**
 * Rapikan jawaban model sebelum ditampilkan.
 *
 * ⚠️ MASALAHNYA NYATA, 7 Okt 2026. Model menjawab:
 *
 *     Pengecekan Data $\rightarrow$ Menunggu/Diproses $\rightarrow$ Disetujui
 *
 * dan yang terbaca user adalah `$\rightarrow$` apa adanya. `react-markdown`
 * tidak mengenal LaTeX, jadi teksnya lewat tanpa diubah.
 *
 * ============================================================
 * KENAPA BUKAN remark-math + KaTeX
 * ============================================================
 * Memasang penafsir LaTeX sungguhan terdengar lebih benar, tapi delimiter
 * math adalah `$` — dan jawaban portal ini penuh nominal:
 *
 *     "harganya $500 sampai $700"   -> `$500 sampai $` jadi satu span math
 *
 * Satu kalimat berisi dua nominal akan berubah jadi rumus. Dan imbalannya
 * nol: tidak ada pertanyaan tentang klaim, tiket, atau SOP yang butuh rumus.
 * Yang dikeluarkan model cuma panah dan tanda kali. Jadi yang dikerjakan di
 * sini MENERJEMAHKAN ke Unicode, bukan merender.
 *
 * ⚠️ TIGA PENJAGAAN YANG MEMBUATNYA AMAN:
 *
 *   1. `$...$` cuma dibuka kalau isinya mengandung `\perintah`. Nominal tidak
 *      punya backslash, jadi `$500 sampai $700` tidak tersentuh sama sekali;
 *   2. blok kode dan kode sebaris DILEWATI. `v_ai_mg_klaim` dan SQL yang
 *      dikutip jawaban tidak boleh ikut diubah;
 *   3. perintah yang TIDAK dikenal dibiarkan utuh beserta `$`-nya. Lebih baik
 *      terlihat ada yang belum tertangani daripada separuh rumus hilang
 *      diam-diam — `latexTakTerurus()` menyebut apa saja itu, dan uji
 *      memakainya.
 */

/** Perintah LaTeX -> Unicode. Yang tidak ada di sini dibiarkan apa adanya. */
const PERINTAH: Record<string, string> = {
  // Panah — ini yang sebenarnya dikeluarkan model.
  rightarrow: "→", to: "→", longrightarrow: "→",
  Rightarrow: "⇒", implies: "⇒",
  leftarrow: "←", gets: "←", longleftarrow: "←",
  Leftarrow: "⇐", leftrightarrow: "↔", Leftrightarrow: "⇔",
  uparrow: "↑", downarrow: "↓", mapsto: "↦",
  // Hitungan
  times: "×", div: "÷", cdot: "·", ast: "*",
  pm: "±", mp: "∓",
  // Perbandingan
  leq: "≤", le: "≤", geq: "≥", ge: "≥",
  neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
  sim: "~", propto: "∝",
  // Lain-lain yang masih masuk akal di jawaban bisnis
  ldots: "…", dots: "…", cdots: "⋯", bullet: "•",
  circ: "°", degree: "°", star: "★", checkmark: "✓",
  infty: "∞", surd: "√", therefore: "∴", because: "∵",
  sum: "Σ", prod: "Π", partial: "∂",
  // Huruf Yunani — jarang, tapi murah didukung
  alpha: "α", beta: "β", gamma: "γ", delta: "δ",
  Delta: "Δ", mu: "μ", pi: "π", sigma: "σ",
  Sigma: "Σ", omega: "ω", Omega: "Ω", lambda: "λ",
  rho: "ρ", theta: "θ", phi: "φ",
};

/** Perintah yang membungkus teks biasa: isinya diambil, pembungkusnya dibuang. */
const PEMBUNGKUS =
  "text|textbf|textit|textrm|textsf|texttt|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|emph|mbox|boldsymbol|overline|underline";

const ATAS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};
const BAWAH: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};

/**
 * Terjemahkan isi satu span math.
 *
 * Dipanggil HANYA untuk teks yang sudah dipastikan span math, jadi di sini
 * kurung kurawal selalu pengelompokan LaTeX — bukan kurung yang dimaksud user.
 */
function isiMath(s: string): string {
  let t = s;

  // Pembungkus diselesaikan dari dalam ke luar: regexnya tidak mengizinkan
  // `{` di dalam, jadi mengulang sampai berhenti berubah membereskan sarang
  // seperti \textbf{\text{x}} tanpa perlu parser kurung tersendiri.
  const bungkus = new RegExp(`\\\\(?:${PEMBUNGKUS})\\s*\\{([^{}]*)\\}`, "g");
  for (let putaran = 0; putaran < 6; putaran++) {
    const baru = t.replace(bungkus, "$1");
    if (baru === t) break;
    t = baru;
  }

  /**
   * Pecahan jadi `a/b`.
   *
   * ⚠️ DIKURUNG KALAU ADA OPERATOR DI DALAMNYA. `\frac{a+b}{c}` yang diratakan
   * jadi `a+b/c` BUKAN sekadar kurang rapi — artinya berubah, dan pembacanya
   * tidak punya petunjuk bahwa itu bukan yang dimaksud model.
   *
   * Pemicunya `+ * /` dan tanda minus yang berdiri sendiri, bukan tiap tanda
   * hubung — kalau tidak, "rata-rata" ikut dikurung tanpa alasan.
   */
  const kurung = (bagian: string) =>
    /[+*/]|\s-\s/.test(bagian) ? `(${bagian})` : bagian;

  for (let putaran = 0; putaran < 6; putaran++) {
    const baru = t
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a: string, b: string) =>
        `${kurung(a.trim())}/${kurung(b.trim())}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√$1");
    if (baru === t) break;
    t = baru;
  }

  // Pangkat dan indeks, selama isinya cuma angka. `^{n+1}` dibiarkan — tidak
  // ada Unicodenya, dan memaksakannya malah menyesatkan.
  t = t
    .replace(/\^\{?([0-9]+)\}?/g, (_, d: string) => [...d].map((c) => ATAS[c]).join(""))
    .replace(/_\{?([0-9]+)\}?/g, (_, d: string) => [...d].map((c) => BAWAH[c]).join(""));

  // Perintah yang dikenal. `\b` di ujung mencegah `\to` mencaplok `\total`.
  t = t.replace(/\\([A-Za-z]+)\b/g, (utuh, nama: string) => PERINTAH[nama] ?? utuh);

  // Escape LaTeX: `\%` memang berarti karakter `%`.
  t = t.replace(/\\([%$&_#{}])/g, "$1");
  // `\\` = ganti baris; `\,` `\;` `\:` `\!` dan `\ ` = pengatur spasi.
  t = t.replace(/\\\\/g, "\n").replace(/\\[,;:!]/g, " ").replace(/\\ /g, " ");
  t = t.replace(/\\(?:quad|qquad)\b/g, "  ");

  // Kurung kurawal sisa pengelompokan. Cuma dibuang kalau tidak ada lagi
  // perintah yang belum tertangani — kalau masih ada, seluruh span dipulangkan
  // utuh oleh pemanggil, dan kurawalnya bagian dari keutuhan itu.
  if (!t.includes("\\")) t = t.replace(/[{}]/g, "");

  return t;
}

/** Potong teks jadi bagian kode dan bukan-kode. Indeks ganjil = kode. */
function belahKode(teks: string): string[] {
  return teks.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
}

function perbaiki(bagian: string): string {
  let t = bagian;

  /**
   * Span yang dipulangkan utuh DITITIPKAN, bukan cuma dikembalikan.
   *
   * ⚠️ Tanpa penitipan, pass "perintah telanjang" di bawah masuk ke dalam span
   * yang baru saja diputuskan untuk tidak diubah, dan menerjemahkan separuh
   * isinya: `$\alpha \ganjil$` jadi `$α \ganjil$` — tepat keadaan setengah
   * jadi yang hendak dihindari.
   */
  const dititipkan: string[] = [];
  const titipkan = (s: string) => `\u0000${dititipkan.push(s) - 1}\u0000`;

  const olah = (utuh: string, isi: string, selaluBuka: boolean) => {
    if (!selaluBuka && !isi.includes("\\")) return utuh;
    const hasil = isiMath(isi).trim();
    // Masih ada perintah yang tidak dikenal -> pulangkan apa adanya supaya
    // KELIHATAN, bukan disajikan separuh jadi.
    return hasil.includes("\\") ? titipkan(utuh) : hasil;
  };

  // `\[...\]` dan `\(...\)`: delimiter ini tidak punya arti lain, jadi tidak
  // perlu syarat backslash seperti `$`.
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, (u, isi: string) => olah(u, isi, true));
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, (u, isi: string) => olah(u, isi, true));

  // `$$...$$` lalu `$...$`.
  //
  // ⚠️ SYARATNYA: isinya harus memuat `\`. Tanpa syarat ini, "$500 sampai
  // $700" ikut diproses dan nominalnya rusak. Harganya: `$m^2$` yang murni
  // tanpa perintah juga tidak dibuka — dan itu pertukaran yang disengaja,
  // karena nominal jauh lebih sering muncul di jawaban portal ini daripada
  // pangkat.
  t = t.replace(/\$\$([^$]+?)\$\$/g, (u, isi: string) => olah(u, isi, false));
  t = t.replace(/\$([^$\n]+?)\$/g, (u, isi: string) => olah(u, isi, false));

  // Perintah telanjang di luar span: model kadang menulis `\rightarrow` tanpa
  // `$` sama sekali. Yang diterjemahkan cuma yang ada di daftar.
  t = t.replace(/\\([A-Za-z]+)\b/g, (utuh, nama: string) => PERINTAH[nama] ?? utuh);

  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => dititipkan[Number(i)]);
}

/**
 * Jawaban model -> teks yang siap dirender markdown.
 *
 * Dipakai di titik TAMPILAN, bukan waktu menyimpan: yang tersimpan tetap
 * kata-kata asli model, dan jawaban lama yang sudah ada di database ikut
 * terbaca benar tanpa perlu migrasi.
 */
export function rapikanJawaban(teks: string): string {
  if (!teks || (!teks.includes("$") && !teks.includes("\\"))) return teks;
  const bagian = belahKode(teks);
  for (let i = 0; i < bagian.length; i += 2) bagian[i] = perbaiki(bagian[i]);
  return bagian.join("");
}

/**
 * Perintah LaTeX yang masih tertinggal sesudah dirapikan.
 *
 * Bukan hiasan: ini yang membuat "ada yang belum didukung" bisa DILIHAT,
 * bukan ditebak. Dipakai uji, dan dipakai peringatan di mode pengembangan.
 */
export function latexTakTerurus(teks: string): string[] {
  const sisa = new Set<string>();
  const bagian = belahKode(rapikanJawaban(teks));
  for (let i = 0; i < bagian.length; i += 2) {
    // ⚠️ TANPA `\b`, berbeda dari pass penerjemahan.
    //
    // Penerjemahan memakai `\b` supaya `\to` tidak mencaplok `\total`.
    // Pendeteksian tidak boleh begitu: `\sum_{i}` diikuti `_`, yang dihitung
    // regex sebagai huruf, jadi `\b` gagal dan perintah yang justru paling
    // perlu dilaporkan tidak pernah terlihat.
    //
    // Akibatnya `C:\total` ikut dilaporkan sebagai perintah tak dikenal. Itu
    // derau di konsol pengembangan, bukan kerusakan — dan arahnya benar:
    // kelebihan melapor bisa diabaikan manusia, kekurangan melapor tidak.
    //
    // ⚠️ TIDAK disaring dengan `PERINTAH`. Yang menentukan bukan "perintah ini
    // dikenal?" tapi "perintah ini MASIH ADA di hasil?" — dan `\sum_{i}` ada
    // di daftar namun tetap tidak tersentuh karena `_` sesudahnya. Menyaring
    // dengan daftar membuat justru kasus itu tak pernah dilaporkan.
    for (const c of bagian[i].matchAll(/\\([A-Za-z]+)/g)) sisa.add(c[1]);
  }
  return [...sisa].sort();
}
