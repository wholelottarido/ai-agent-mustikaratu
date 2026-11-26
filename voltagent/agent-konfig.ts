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
import type { PemegangPenjaga } from "@/lib/alur/penjaga-alur";
import { hookBawahan, kendaliPerute, teksKemampuan } from "./kendali-alur";
import { muatKonfig } from "@/lib/ai-konfig";
import { buatToolDariKonfig, type CatatSumber, type LaporProgres, type SesiPemakai } from "./tool-konfigurasi";
import { namaUntukModel, type CatatRancangan } from "./registry-tulis";
import { pilihModel, KUNCI_MODEL, KUNCI_SALURAN } from "./agents";
import { kemampuanKode } from "./registry-kode";
import { buatRegistri, jenisAgent, LABEL_JENIS, type AgentKemampuan, type JenisKemampuan } from "@/lib/alur/kemampuan";

export type Saluran = "web" | "wa";

/**
 * Tahap 3 (rute berdasarkan kemampuan) menyala kecuali `RUTE_KEMAMPUAN=mati`. Saklar ini HANYA mematikan
 * perubahan Tahap 3 (daftar kemampuan, validasi sebelum delegasi, status hasil handoff, aturan perute versi
 * kemampuan); penjaga Tahap 2/4/5/6 tetap menyala (mereka punya saklar sendiri: `PENJAGA_ALUR`).
 */
export function ruteKemampuanDinyalakan(): boolean {
  return process.env.RUTE_KEMAMPUAN !== "mati";
}

/**
 * Jenis kemampuan satu tool, dari METADATANYA: tool kode → sifat penangannya (`registry-kode.ts`, dijaga tsc);
 * tool setelan → `operasi` (baca = data, selain itu = tindakan yang menyusun rancangan).
 */
export function kemampuanTool(t: KonfigTool): JenisKemampuan {
  if (t.jenis === "kode") return kemampuanKode(t.penangan) ?? "data";
  return t.operasi === "baca" ? "data" : "tindakan";
}

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

  // Tanpa tanggal, model mengisi tahun dari ingatannya: "September" jadi 2024 (terlihat 5 Nov 2026).
  const hariIni = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const punyaRamalan = tool.some((t) => t.kode === "ramal_penjualan");
  const punyaCariSop = tool.some((t) => t.kode === "cari_sop");
  const punyaTiket = tool.some((t) =>
    ["buat_tiket", "siapkan_tiket", "cari_tiket_serupa"].includes(t.kode),
  );

  return `Kamu ${k.nama}. ${k.deskripsi ?? ""}

Hari ini ${hariIni}. Kalau user menyebut bulan tanpa tahun, artinya bulan itu yang terakhir sudah lewat.

## Tool yang kamu punya

${daftarTool(tool)}

## Aturan menjawab

1. Jawab HANYA dari hasil tool. Kalau tidak ada tool yang cocok, katakan kamu
   belum bisa mengambil data itu — jangan mengarang angka, nama, atau tanggal.
   ⚠️ Kalau ada tool yang cocok, PANGGIL DULU dengan kata user apa adanya,
   sekalipun terdengar umum atau belum lengkap. Jangan bertanya balik lebih
   dulu: tool yang mencocokkan ke data yang nyata, dan kamu bertanya hanya
   kalau hasil tool memintanya.
   ⚠️ Permintaan daftar umum ("tampilkan 5 …", "… terbaru apa saja",
   "daftar …") = panggil tool yang cocok TANPA filter; isi \`batas_baris\`
   kalau user menyebut angka. Keterangan tiap tool menyebut urutan hasilnya.
   "Terbaru" artinya urutan paling baru, BUKAN filter tanggal hari ini —
   isi filter tanggal hanya kalau user menyebut tanggal atau periode. Kalau
   tool tidak berurutan menurut waktu, tetap tampilkan hasilnya dan sebut
   urutannya, jangan menolak atau bertanya balik.
2. Hasil tool sudah disaring untuk penanya. Kamu TIDAK bisa, dan tidak boleh
   mencoba, melihat data orang lain. Tiap hasil menyebut \`milik\` — itulah
   pemilik barisnya yang sebenarnya.
   ⚠️ Kalau yang ditanya ORANG atau DEPARTEMEN LAIN daripada yang disebut
   \`milik\`, jawab bahwa kamu tidak bisa melihat data itu. JANGAN menyajikan
   baris yang kamu terima sebagai milik mereka — menamai data Trade Marketing
   sebagai "klaim departemen HR" itu salah yang lebih berbahaya daripada
   menolak menjawab, karena pembacanya tidak punya cara mengetahuinya.
   ⚠️ JANGAN pernah menanyakan nama departemen pemakai. Identitas dan
   departemennya sudah berasal dari akun login dan tertanam pada penyaring
   tool. Kalau pemakai berkata "departemen saya", panggil tool apa adanya.
3. Kalau tool mengembalikan \`galat\`, sampaikan isinya apa adanya. Itu bukan
   kegagalan yang perlu kamu tutupi atau tebak jalan keluarnya.
4. Tiap hasil membawa \`jumlah\` (yang kamu baca) dan \`total\` (yang cocok
   seluruhnya). Kalau \`terpotong: true\`, keduanya BERBEDA.
   ⚠️ Pertanyaan "ada berapa" dijawab dengan \`total\`, BUKAN dengan menghitung
   baris yang kamu terima. Sebutkan juga bahwa yang ditampilkan baru sebagian,
   memakai nama objek tool yang sedang dipanggil, mis. "6 dari total 22 klaim".
   JANGAN menyalin nama objek dari contoh ke tool lain. JANGAN pernah mengatakan tidak ada data lain,
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
  }${punyaCariSop ? ATURAN_CARI_SOP : ""}${
    punyaCariSop && punyaTiket ? ATURAN_SOP_SEBELUM_TIKET : ""
  }${punyaRamalan ? ATURAN_METODOLOGI_RAMALAN : ""}`;
}

const ATURAN_CARI_SOP = `

## Pertanyaan prosedur dan keluhan teknis

Untuk pertanyaan cara melakukan sesuatu, syarat, alur, atau keluhan berupa
gejala aplikasi/perangkat, panggil \`cari_sop\` lebih dulu. Keluhan seperti
"aplikasi tidak jalan karena sinyal hilang", "printer bergaris", dan "laptop
tidak menyala" juga termasuk pencarian panduan, walaupun user tidak menyebut
kata SOP. Saat memanggil tool, JANGAN menulis kesimpulan atau jawaban awal.
Tunggu hasil \`cari_sop\`, lalu jawab dari isi dokumen yang ditemukan dan
sebutkan judul sumbernya.
Kalau hasilnya tidak benar-benar menjawab, katakan bahwa panduan yang sesuai
belum ditemukan; jangan merangkai solusi dari dokumen yang tidak relevan dan
jangan menambahkan prosedur perusahaan dari pengetahuanmu sendiri.`;

const ATURAN_SOP_SEBELUM_TIKET = `

## Urutan panduan dan tiket helpdesk

Jangan langsung membuat atau menyiapkan tiket hanya karena user menyampaikan
keluhan. Cari panduannya dengan \`cari_sop\` dan berikan langkah penanganannya
lebih dulu. Tawarkan tiket sebagai langkah lanjutan jika panduan tidak tersedia,
langkah panduan sudah dicoba tetapi masalah tetap terjadi, atau user memang
meminta dibuatkan tiket. Jangan memanggil tool pembuatan tiket sebelum salah
satu kondisi itu terpenuhi.

Kalau tidak ada hasil SOP yang relevan, jawaban WAJIB mengikuti pola ini:
"Panduan khusus untuk [masalah user] belum ditemukan dalam basis pengetahuan
SOP. Apakah Anda ingin saya menyiapkan tiket helpdesk untuk tim terkait?"
Jangan menawarkan \`daftar_sop\` untuk keluhan teknis dan jangan mengarang
langkah penanganan. Menawarkan tiket belum berarti memanggil tool tiket; tunggu
user menyetujuinya terlebih dahulu.`;

/**
 * Fakta metodologi yang sudah diukur dan boleh dijawab tanpa memanggil tool.
 * Tool ramalan menghitung angka produk; bagian ini mencegah model mengarang
 * cara kerja sistem saat user bertanya tentang pengaruh jumlah outlet.
 */
const ATURAN_METODOLOGI_RAMALAN = `

## Penjelasan metodologi ramalan, outlet, dan distribusi

Kalau user bertanya tentang pengaruh jumlah outlet, pembukaan/penutupan outlet,
perubahan wilayah, perluasan distribusi, coverage, atau jangkauan penjualan terhadap
ramalan, jelaskan fakta berikut:

- Jumlah outlet TIDAK dipakai sebagai variabel langsung oleh model saat ini.
- Riwayat penjualan secara tidak langsung mencerminkan jangkauan outlet pada masa lalu.
- Perubahan outlet, wilayah, atau distribusi setelah periode data tidak diketahui model.
  Backtest Juli-September
  2026 menunjukkan produk dengan outlet bertambah cenderung diramal terlalu rendah, sedangkan
  produk dengan outlet berkurang cenderung diramal terlalu tinggi.
- JANGAN mengatakan kondisi seluruh jaringan outlet sudah tercermin untuk masa depan.
- JANGAN mengubah angka ramalan otomatis berdasarkan pertumbuhan outlet. Penyesuaian sederhana
  yang diuji belum konsisten: hampir tidak membantu pada jarak 3-5 bulan dan memperburuk hasil
  pada jarak 1-3 bulan.

Ini adalah penjelasan cara kerja sistem yang sudah diukur, jadi boleh dijawab langsung untuk
semua pertanyaan serupa. Jangan mengarang angka lain dan jangan menyebutnya sebagai hubungan
sebab-akibat yang sudah terbukti.`;

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

- Klaim "rancangan sudah disiapkan" HANYA boleh ditulis sesudah tool
  \`siapkan_...\` benar-benar dipanggil dan mengembalikan rancangan. Kalau
  belum ada hasil tool pada giliran ini, klaim itu PALSU.
- Kalau user menjawab "ya", "boleh", "setuju", "lanjut", atau memberi pilihan
  terhadap TAWARAN tindakan, panggil tool \`siapkan_...\` yang sesuai saat itu
  juga. Ini berlaku untuk membuat, mengajukan, mencatat, mengubah, membatalkan,
  menghapus, menyetujui, dan menolak data — termasuk tiket, penjualan, lembur,
  pelamar, serta tindakan lain yang tersedia. Jangan menjawab seolah-olah tool
  sudah dijalankan.
- Bawa semua konteks yang sudah diberikan user ke parameter tool: objek yang
  ditindak, perubahan yang diminta, alasan, dan pilihan hasil klarifikasi.
  Jangan meminta ulang informasi yang sudah ada di percakapan.
- JANGAN katakan datanya sudah dibuat, sudah masuk, sudah tersimpan, atau
  sudah diproses. Belum. Katakan rancangannya sudah disiapkan dan minta user
  memeriksanya lalu menekan Simpan.
- JANGAN menyebutkan nomor apa pun. Nomornya baru ada saat penyimpanan.
- JANGAN mengulang isi rancangan panjang-panjang dalam jawaban — kartunya
  sudah menampilkan semuanya. Cukup satu kalimat.
- Kalau hasilnya \`perlu-perbaikan\`, sebutkan pilihan yang ditawarkan APA
  ADANYA dan tanyakan mana yang dimaksud. Jangan memilihkan.
- HANYA jika kartu rancangan sudah tampil lalu user meminta MENYIMPAN lewat
  teks, ingatkan bahwa yang menyimpan adalah tombol pada kartu. Persetujuan
  atas tawaran membuat rancangan atau jawaban atas klarifikasi bukan permintaan
  menekan tombol Simpan.`;

/**
 * Tahap 3 (F.4): cara perute memilih agent — tujuan pemakai dulu, lalu kemampuan alat.
 *
 * ⚠️ RCA Q4 (24 Nov 2026): aturan "utamakan Portal untuk SOP" sudah ada, tapi kalah oleh deskripsi agent lain
 * yang memuat frasa sama persis ("pengajuan cuti") — 21/58 delegasi pertama salah. Aturan di sini TIDAK menyebut
 * nama agent; yang dirujuk adalah "Jenis kemampuan" di daftar agent, yang dihitung dari alat terpasang.
 * Contohnya konseptual (tanpa nama alat/agent/JSON) supaya tidak tersalin sebagai jawaban atau panggilan mentah.
 * Penegaknya bukan kalimat ini, tetapi penjaga (`periksaKemampuan`) — kalimat ini mengurangi panggilan yang ditolak.
 */
const ATURAN_PILIH_AGENT = `

## Memilih agent: tujuan dulu, baru kemampuan

Tentukan APA yang diminta, lalu pilih agent yang ALATNYA bisa memenuhinya
("Jenis kemampuan" di daftar agent). Kemiripan kata dengan deskripsi agent
bukan dasar memilih.
- Cara, syarat, alur, aturan, kebijakan → kemampuan "cari dokumen/SOP/panduan".
- Keadaan data yang sudah ada (status, sisa, jumlah, riwayat, milik penanya) →
  agent yang alat baca datanya menyangkut bidang itu.
- Dibuatkan, diajukan, diubah, dibatalkan → alat "siapkan tindakan" bidang itu.
  Prosedur dan tindakan atas proses yang sama adalah dua kebutuhan berbeda.
- Beberapa kebutuhan dalam satu pesan → pisahkan ke agent masing-masing, lalu
  gabungkan. Sapaan yang disertai pertanyaan data = pertanyaan data.
- Kalau tujuannya bisa dua-duanya (tahu prosedurnya atau mengajukannya) dan
  riwayat tidak membantu, boleh SATU pertanyaan singkat tentang TUJUANNYA —
  bukan tentang isi data (untuk itu Aturan Nomor Satu tetap berlaku).`;

/** Tahap 3: arti status terstruktur yang ditempel penjaga ke hasil delegate_task. */
const ATURAN_STATUS_RUTE = `
- Hasil delegate_task bisa membawa \`status_rute\` dan \`catatan_rute\` dari
  sistem — ikuti catatannya. "tanpa-alat": agent itu tidak memeriksa data apa
  pun, jadi jawabannya BUKAN bukti informasinya tidak ada. "galat-model":
  agent itu gagal menyusun jawaban — katakan permintaannya gagal diproses,
  JANGAN katakan datanya tidak ada. "tidak-ditemukan":
  sudah dicari dan memang tidak ada. "akses-ditolak": batas hak akses pemakai —
  jangan mencarinya lewat agent lain.`;

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
/**
 * Berapa tool yang boleh dipegang model LOKAL di jalur ini.
 *
 * ============================================================
 * ⚠️ ANGKA INI SETENGAH TERUKUR, DAN ITU HARUS DIKETAHUI
 * ============================================================
 * Yang TERUKUR (24 Sep 2026, lewat agent sungguhan di jalur LAMA):
 * qwen2.5:7b benar 10/12 dengan SATU tool, 2/6 dengan DUA. Di atas dua tool
 * ia berhenti memanggil tool sama sekali dan mulai menulis jawaban yang
 * bentuknya meyakinkan tanpa menyentuh database.
 *
 * Yang BELUM terukur: berapa angka yang benar untuk JALUR INI. Tool-nya
 * berbeda, instruksinya berbeda, dan ada perute + `delegate_task` di depannya
 * — jadi memindahkan angka "1" ke sini adalah pemindahan, bukan pengukuran.
 *
 * Bawaannya 1 karena itu satu-satunya nilai yang pernah terbukti. Naikkan
 * lewat `MAKS_TOOL_LOKAL` di `.env.local`, lalu UKUR — menaikkannya tanpa
 * mengukur sama saja menebak, dan kegagalannya tidak menimbulkan galat apa
 * pun: jawabannya cuma mulai salah sambil tetap terlihat wajar.
 *
 * Diukur 21 Okt 2026 (`npm run ukur:qwen`): tanpa pembatas ini model lokal
 * menerima 34 tool (akun dafi) sampai 127 tool (akun ridho, super admin).
 */
export function maksToolLokal(): number {
  const n = Number(process.env.MAKS_TOOL_LOKAL);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Batas tool per agent untuk model di server kantor.
 *
 * Gemma di sana hanya menampung 8.192 token. Diukur 3 Nov 2026: Admin dengan 37
 * tool butuh 8.374 token dan selalu ditolak. Dengan 20 tool, hasil 20 baris masih
 * menembus batas (8.238 token); dengan 15 tool sisanya cukup. Naikkan lewat
 * `MAKS_TOOL_SERVER` kalau batas server dinaikkan.
 */
export function maksToolServer(): number {
  const n = Number(process.env.MAKS_TOOL_SERVER);
  return Number.isInteger(n) && n > 0 ? n : 15;
}

/**
 * Batas baris hasil alat baca untuk model di server kantor (Gemma, 8.192 token).
 *
 * Diukur 26 Nov 2026, akun ridho: dengan batas bawaan alat (30–100 baris),
 * `akun_medsos`, `data_outlet`, dan `harga_cmod` membuat permintaan sesudah
 * alat menjadi 9.000–12.000 token dan ditolak server. Menurunkan jumlah alat
 * ke 8 hanya menolong Marketing; dua lainnya gagal karena HASIL alatnya.
 * Naikkan lewat `MAKS_BARIS_SERVER` kalau kapasitas server dinaikkan.
 */
export function maksBarisServer(): number {
  const n = Number(process.env.MAKS_BARIS_SERVER);
  return Number.isInteger(n) && n > 0 ? n : 10;
}

// Batas tool MR AI Gateway sekarang per model: `maksToolGatewayModel()` di `models.ts` (11 Nov 2026).

/**
 * Memangkas daftar tool ke `maks`, dengan URUTAN YANG DITENTUKAN.
 *
 * ⚠️ BUKAN "ambil yang pertama ketemu". Urutan kedatangan ditentukan isi tabel
 * `ai_tool` milik tim lain, yang berubah tanpa pemberitahuan — 263 dari 280
 * barisnya pernah lahir dalam satu hari. Pemangkasan yang mengikuti urutan itu
 * akan memberi model lokal tool yang berbeda-beda tiap kali katalog sebelah
 * bergerak, dan tidak ada yang tahu kapan.
 *
 * Jebakan yang sama sudah menggigit di `targetTulis()` (13 Okt 2026): borang
 * memakai sumber "yang pertama ketemu", lalu tim lain menambah satu sumber dan
 * borangnya mulai menawarkan pilihan yang mustahil.
 *
 * Urutannya: tool MILIK KITA dulu (sudah ditinjau), lalu urut kode.
 */
function pangkasTool(
  daftar: KonfigAgent["tool"],
  terpasang: ReturnType<typeof buatToolDariKonfig>["tool"],
  maks: number,
): { tool: typeof terpasang; dibuang: string[] } {
  if (terpasang.length <= maks) return { tool: terpasang, dibuang: [] };

  const urut = [...daftar].sort(
    (a, b) =>
      Number(b.pemilik === "magang") - Number(a.pemilik === "magang") ||
      a.kode.localeCompare(b.kode),
  );
  const pilih: typeof terpasang = [];
  const dibuang: string[] = [];
  for (const k of urut) {
    const t = terpasang.find((x) => x.name === namaUntukModel(k));
    if (!t) continue;
    if (pilih.length < maks) pilih.push(t);
    else dibuang.push(k.kode);
  }
  return { tool: pilih, dibuang };
}

export function buatAgentDariKonfig(
  k: KonfigAgent,
  sesi: SesiPemakai,
  catat?: CatatSumber,
  catatRancangan?: CatatRancangan,
  /**
   * Batas jumlah tool. Diisi hanya untuk model lokal — lihat
   * `maksToolLokal()`. `undefined` berarti tanpa batas, seperti sebelumnya.
   */
  maks?: number,
  laporProgres?: LaporProgres,
  /** Penjaga alur permintaan ini (Tahap 2). Tanpa penjaga, agent berperilaku seperti sebelumnya. */
  penjaga?: PemegangPenjaga,
): HasilRakit {
  const rakit = buatToolDariKonfig(k.tool, sesi, catat, catatRancangan, laporProgres);
  const dilewati = rakit.dilewati;
  let tool = rakit.tool;

  if (maks !== undefined) {
    const p = pangkasTool(k.tool, tool, maks);
    tool = p.tool;
    // ⚠️ Yang dibuang MASUK KE `dilewati`, bukan hilang diam-diam. Tool yang
    // menghilang tanpa alasan membuat administrator mengira setelannya rusak
    // — dan di sini yang membuangnya justru keputusan yang disengaja.
    for (const kode of p.dibuang) {
      dilewati.push({
        kode,
        sebab: `dipangkas: model ini dibatasi ${maks} tool per agent`,
      });
    }
  }

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
    ...(penjaga ? { hooks: hookBawahan(penjaga) } : {}),
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
export async function buatRouter(
  sesi: SesiPemakai,
  aksesApps: string[],
  catat?: CatatSumber,
  catatRancangan?: CatatRancangan,
  /** Batas tool per agent bawahan. Diisi hanya untuk model lokal. */
  maks?: number,
  laporProgres?: LaporProgres,
  /** Penjaga alur permintaan ini (Tahap 2). Dibuat per permintaan oleh `siapkanAgent()`. */
  penjaga?: PemegangPenjaga,
): Promise<HasilRouter | undefined> {
  const konf = await muatKonfig();
  const umum = konf.agent.find((a) => a.umum && a.aktif);
  if (!umum) return undefined;

  const boleh = new Set(aksesApps);
  const anak: Agent[] = [];
  const bawahan: HasilRouter["bawahan"] = [];
  const dilewati: HasilRouter["dilewati"] = [];
  // Tahap 3: kemampuan per agent, dari tool yang SAMA dengan yang dipasang ke agent itu untuk pemakai ini —
  // jadi sudah lewat penyaringan akses aplikasi, izin tool, dan pemangkasan model lokal. Tanpa query tambahan.
  const kemampuan: AgentKemampuan[] = [];
  const rute = ruteKemampuanDinyalakan();

  for (const a of konf.agent) {
    if (a.umum || !a.aktif) continue;
    const dipegang = [a.idApps, ...a.appsLain].filter(Boolean) as string[];
    if (!dipegang.some((id) => boleh.has(id))) continue;

    const r = buatAgentDariKonfig(a, sesi, catat, catatRancangan, maks, laporProgres, penjaga);
    // Agent tanpa tool tidak dijadikan bawahan. Dulu ia ikut ditanyai dan jawabannya
    // "belum dipasangi sumber data" tertempel di depan jawaban agent lain (5 Nov 2026).
    // Tetap masuk `bawahan`, supaya perute bisa menyebutnya kalau memang dia yang dimaksud.
    if (r.tool.length > 0) anak.push(r.agent);
    // Nama tool yang BENAR-BENAR terpasang, bukan semua yang terdaftar.
    const dipasang = a.tool.filter((t) => r.tool.some((x) => x.name === namaUntukModel(t)));
    const bisa = dipasang.map((t) => t.nama);
    if (r.tool.length > 0) {
      kemampuan.push({ nama: a.nama, deskripsi: a.deskripsi ?? "",
        alat: dipasang.map((t) => ({ nama: namaUntukModel(t), label: t.nama, deskripsi: t.deskripsi, jenis: kemampuanTool(t) })) });
    }
    // ⚠️ Yang dilaporkan jumlah tool YANG TERPASANG, bukan yang terdaftar di
    // setelan. Dulu keduanya hampir sama; sejak ada pemangkasan model lokal,
    // memakai `a.tool.length` akan melaporkan 34 untuk agent yang sebenarnya
    // cuma memegang 1 — dan angka itu dipakai log serta `npm run ukur:qwen`.
    bawahan.push({ kode: a.kode, nama: a.nama, jumlahTool: r.tool.length, bisa });
    dilewati.push(...r.dilewati);
  }

  // ⚠️ KEMAMPUAN TIAP AGENT IKUT DISEBUT, bukan cuma deskripsinya.
  //
  // Versi pertama cuma menuliskan `ai_agent.deskripsi` -- satu kalimat seperti
  // "Tiket helpdesk, aset, profil, dan pengajuan karyawan". Akibatnya router
  // menolak "SOP apa saja yang ada?" dengan alasan tidak ada agent yang
  // menanganinya, PADAHAL `cari_sop` dan `daftar_sop` terpasang di agent
  // Portal. Router tidak bisa mengarahkan ke kemampuan yang tidak dia ketahui.
  const registri = buatRegistri(kemampuan);
  const daftar = bawahan.length
    ? bawahan
        .map((b) => {
          const d = konf.agent.find((a) => a.kode === b.kode)?.deskripsi ?? "";
          const bisa =
            b.bisa.length > 0
              ? `\n  Bisa: ${b.bisa.join("; ")}.`
              : `\n  Belum punya sumber data, jadi TIDAK bisa diteruskan. Kalau pertanyaan hanya bisa dijawab agent ini, katakan sumber datanya belum dipasang.`;
          // Tahap 3: jenis kemampuan (dihitung dari alatnya) — satu baris pendek, bukan salinan deskripsi alat.
          const ak = rute ? registri.agent.find((x) => x.nama === b.nama) : undefined;
          const jenis = ak ? `\n  Jenis kemampuan: ${jenisAgent(ak).map((j) => LABEL_JENIS[j]).join("; ")}.` : "";
          return `- **${b.nama}** -- ${d}${bisa}${jenis}`;
        })
        .join("\n")
    : "(belum ada agent aplikasi yang terbuka untuk akun ini)";
  if (rute) penjaga?.pakaiRegistri(registri);

  // Tahap 5 (F.7): jawaban sapaan / "bisa bantu apa", disusun dari agent & alat yang BENAR-BENAR terpasang
  // untuk pemakai ini — jadi ikut berubah kalau setelan Kelola AI berubah, dan tidak menjanjikan kemampuan
  // yang tidak ada. Dipakai penjaga saat perute mencoba mendelegasikan sapaan (RCA D.4: 19/58 diserahkan).
  penjaga?.pakaiKemampuan(teksKemampuan(umum.nama, bawahan.filter((b) => b.jumlahTool > 0)));

  // ============================================================
  // ⚠️ ROUTER YANG BERTANYA BALIK = ROUTER YANG MENGARANG
  // ============================================================
  // Aturan 3 ada karena kegagalan nyata (26 Okt 2026). Ditanya "prediksi
  // penjualan minyak zaitun", router TIDAK meneruskan ke Marketing. Ia
  // bertanya balik minta ukuran kemasan — dan menyebutkan contohnya sendiri,
  // "misalnya 75 ML, 175 ML, dll". Router tidak punya tool satu pun; angka
  // itu datang dari ingatan model, bukan dari database.
  //
  // Yang membuatnya berbahaya: pertanyaan balik TERLIHAT seperti kehati-
  // hatian. Tidak ada angka ramalan yang keluar, tidak ada galat, dan
  // pemakai justru merasa dilayani dengan teliti — sambil menerima daftar
  // varian karangan. Tool `ramal_penjualan` sendiri sudah dijaga untuk hal
  // ini; penjagaannya tidak berguna kalau tool-nya tidak pernah dipanggil.
  //
  // Pola yang sama sudah menggigit di pertanyaan SOP (26 Okt 2026): router
  // menyimpulkan sendiri bahwa tidak ada yang menangani, padahal `cari_sop`
  // terpasang di bawahannya. Dua-duanya satu sebab — router menjawab tentang
  // isi data yang tidak bisa ia lihat.
  // ============================================================
  // ⚠️ PESAN SISTEM PERUTE DIAMBIL ALIH SEPENUHNYA
  // ============================================================
  // VoltAgent membungkus instruksi kita di dalam <instructions> lalu
  // MENAMBAHKAN <guidelines> bawaannya sendiri. Dua di antaranya membatalkan
  // apa yang kita minta di sini:
  //
  //   "Never assume any parameter values while invoking a function."
  //   "Always refer to the function calling schema when asking followup
  //    questions. Prefer to ask for all the missing information at once."
  //
  // Panduan kedua itu MENYURUH perute bertanya balik waktu ada keterangan
  // yang kurang — persis kegagalan yang dilaporkan 26 Okt 2026, dan persis
  // bentuknya: ditanya "prediksi penjualan minyak zaitun", perute menanyakan
  // varian DAN periode sekaligus ("all the missing information at once")
  // tanpa memanggil tool apa pun.
  //
  // ⚠️ DUA KALI PERBAIKAN KATA-KATA GAGAL sebelum sebabnya ini ketahuan
  // (27 Okt 2026): menambah aturan, lalu memindahkannya ke paling atas
  // dengan contoh. Dua-duanya kalah, karena instruksi kita dan panduan
  // bawaan ada di BLOK YANG BERBEDA dan panduan bawaan lebih spesifik.
  //
  // `supervisorConfig.systemMessage` mengganti seluruh pesan bawaan, panduan
  // itu ikut hilang. Harganya: daftar bawahan dan panduan yang BERGUNA tidak
  // lagi disisipkan otomatis, jadi dua-duanya ditulis sendiri di bawah.
  // Kalau VoltAgent menambah panduan baru yang berguna, kita tidak akan
  // mendapatkannya — itu konsekuensi yang diterima sadar.
  const instruksiPerute = `Kamu ${umum.nama}, pintu masuk asisten portal.

Tugasmu MENERUSKAN pertanyaan ke agent aplikasi yang tepat, bukan menjawab
pertanyaan data sendiri. Kamu tidak punya tool data apa pun.

## ATURAN NOMOR SATU: TERUSKAN DULU, JANGAN BERTANYA DULU

Pertanyaan yang kurang lengkap BUKAN alasan bertanya balik. Itu justru alasan
meneruskan — karena kamu TIDAK BISA tahu apa yang ada di dalam data, dan
mereka bisa.

Kalau pertanyaannya tentang data, panggil "delegate_task" SEKARANG dengan
kalimat pemakai APA ADANYA. Jangan disaring, jangan dilengkapi, jangan
diperjelas dulu.

Contoh yang SALAH, dan ini pernah benar-benar terjadi:

> Pemakai: "prediksi penjualan minyak zaitun"
> Kamu: "Sebutkan nama produk yang lebih spesifik, misalnya ukuran atau
>        variannya."

Salah, karena kamu tidak tahu ukuran apa saja yang ada. ${rute
    ? "Agent yang memegang alat ramalan punya\nalat yang mencocokkan ke daftar produk SUNGGUHAN"
    : "Agent Marketing punya\nalat yang mencocokkan ke daftar produk SUNGGUHAN"}; dia akan memulangkan 8
varian yang benar-benar ada, lalu BARU kamu tanyakan pemakai mau yang mana.

Yang BENAR: panggil alat delegate_task dengan agent tujuan ${rute ? "yang memegang alat itu" : "Marketing"} dan tugas
berisi kalimat pemakai apa adanya. Itu PEMANGGILAN ALAT, bukan teks jawaban —
jangan pernah menuliskan nama alat, argumennya, atau JSON-nya sebagai jawaban.

Bertanya balik hanya boleh SESUDAH agent aplikasi menjawab dan dia sendiri
yang meminta diperjelas. Pakai daftar dari dia, apa adanya.${rute ? ATURAN_PILIH_AGENT : ""}

## Agent yang bisa kamu mintai

${daftar}

## Aturan

1. Pertanyaan tentang data — tiket, aset, cuti, program, kunjungan, order,
   laporan, ramalan/prediksi penjualan — SELALU diteruskan ke agent yang
   memegang aplikasinya. Jangan dijawab sendiri walau kamu merasa tahu
   jawabannya.
2. Pertanyaan PROSEDUR juga SELALU diteruskan: "bagaimana cara...", "apa
   syaratnya", "berapa lama prosesnya", "siapa yang menyetujui". Agent
   aplikasi punya alat pencari SOP; kamu tidak punya alat apa pun. Kamu TIDAK
   BISA tahu sebuah prosedur ada atau tidak tanpa bertanya ke mereka — jadi
   jangan menyimpulkannya sendiri.
${rute
    ? `   Kirim ke agent yang jenis kemampuannya mencakup "cari dokumen/SOP/panduan".
   Jangan memilih agent hanya karena nama prosesnya muncul di deskripsinya:
   memegang DATA pengajuan tidak sama dengan memegang DOKUMEN prosedurnya.`
    : `   Khusus pertanyaan SOP, panduan, atau cara melakukan proses perusahaan,
   utamakan Ratu AI Portal yang memegang \`cari_sop\`/\`daftar_sop\`. Jangan
   memilih agent hanya karena nama prosesnya, misalnya kata "cuti".`}
3. ⚠️ Lihat ATURAN NOMOR SATU di atas: nama yang belum lengkap diteruskan
   APA ADANYA, tidak ditanyakan dulu. Menyebutkan contoh varian atau ukuran
   dari ingatanmu berarti mengarang, dan pemakai akan mengira daftar itu
   nyata.

4. Satu pertanyaan boleh menyentuh dua aplikasi. Mintakan ke dua-duanya, lalu
   gabungkan jawabannya.
5. Kalau tidak ada agent yang cocok, katakan terus terang aplikasi itu belum
   punya asisten atau belum terbuka untuk akun ini, dan sarankan meminta akses
   ke administrator aplikasinya. Jangan mengarang jawaban sebagai gantinya.
   ⚠️ Aturan ini berlaku SESUDAH kamu bertanya, bukan sebagai ganti bertanya.
   Untuk pertanyaan prosedur, "tidak ada yang cocok" baru boleh disimpulkan
   kalau agent yang kamu mintai sudah menjawab bahwa dokumennya tidak ada.
${rute
    ? `   Cocokkan kemampuan dari alat yang tercantum di daftar agent, bukan dari
   kemiripan kata. Kemampuan yang mirip tidak boleh dianggap sama. Kalau tidak
   ada alat yang menyangkut permintaan itu, katakan kemampuan itu belum
   tersedia; jangan mengarahkannya ke agent yang hanya memegang data berdekatan.
   Bedakan "agent itu tidak punya alatnya" dari "datanya sudah dicari dan tidak
   ada" — yang pertama bukan bukti datanya tidak ada.`
    : `   Cocokkan kemampuan secara harfiah dari daftar agent. Kemampuan yang mirip
   tidak boleh dianggap sama: pengajuan cuti/izin/sakit/dinas BUKAN pengajuan
   lembur. Kalau daftar agent tidak menyebut lembur atau tool lembur, katakan
   bahwa pengajuan lembur belum tersedia; jangan mengarahkannya ke Super Tools
   hanya karena aplikasi itu memiliki data jam kerja.`}
5a. Sapaan ("halo", "selamat pagi"), ucapan terima kasih, dan pertanyaan UMUM
   tentang dirimu ("kamu bisa bantu apa saja?", "kamu siapa?") dijawab SENDIRI
   dari daftar agent di atas, TANPA delegate_task. Ini satu-satunya
   pengecualian untuk aturan meneruskan. Pertanyaan tentang ISI data atau
   dokumen tetap diteruskan, walau bentuknya mirip: "SOP apa saja yang ada?",
   "tiket saya apa saja?", "produk apa saja yang dijual?" butuh alat agent.
6. Sebutkan agent mana yang menjawab, supaya penanya tahu harus bertanya ke
   mana lain kali.
7. Jawab dalam bahasa Indonesia, ringkas.

## Panduan kerja

Panduan ini dulu disisipkan VoltAgent sendiri. Sejak pesan sistemnya diambil
alih, yang berguna ditulis di sini — dan DUA yang dulu ada sengaja TIDAK
dibawa, karena keduanya menyuruhmu bertanya balik waktu ada keterangan yang
kurang. Untuk perute yang tidak punya tool, bertanya balik berarti menebak.

- Beri jawaban akhir ke pemakai SESUDAH semua agent yang kamu mintai menjawab.
- JANGAN meringkas jawaban agent. Sampaikan isinya apa adanya, terutama angka,
  nama produk, dan peringatan — meringkas adalah cara paling halus menghapus
  keterangan yang justru menentukan.
- Kalau jawabannya sudah ada di riwayat percakapan ini, pakai lagi; jangan
  meminta ulang ke agent yang sama.
- Pertanyaan lanjutan yang merujuk jawaban agent sebelumnya tetap diteruskan
  ke agent yang sama. Contoh: sesudah Marketing menjelaskan merek MRPC,
  pertanyaan "produknya apa saja?" tetap ke Marketing, BUKAN ke Admin hanya
  karena memuat kata "produk". Pertahankan topik dan agent dari giliran
  sebelumnya selama user belum mengganti topik dengan jelas.
- Jawaban pemakai yang pendek — "ya", "boleh", "setuju", "lanjut", "tidak",
  sebuah angka, sebuah nomor pilihan, ATAU satu nama dari daftar pilihan yang
  baru ditawarkan —
  TERUSKAN LANGSUNG ke agent terakhir yang bertanya, dengan menyebut apa yang
  sedang dijawab — misalnya tugas berisi tindakan yang ditawarkan beserta
  jawaban pemakai. Sistem otomatis melampirkan pertanyaan sebelumnya dan
  jawaban asli pemakai ke tugas itu, jadi agent bawahan tetap mendapat
  konteksnya. Ini berlaku untuk tawaran membuat, mengubah, membatalkan,
  menghapus, mengajukan, menyetujui, atau menolak data.
- ⚠️ JANGAN PERNAH menyatakan persetujuan, konfirmasi, atau pilihan yang tidak
  DITULIS pemakai pada pesan terakhirnya. Kalau agent bawahan bertanya atau
  menawarkan sesuatu, pertanyaan itu untuk PEMAKAI — sampaikan kepadanya dan
  berhenti. Jangan menjawabnya sendiri, jangan memilihkan, dan jangan
  meneruskannya lagi ke agent yang sama. Sistem menolak delegasi seperti itu.
- Persetujuan untuk MENYIAPKAN rancangan bukan persetujuan untuk MENYIMPAN.
  Yang menyimpan hanya tombol Simpan pada kartu. Jangan pernah menulis bahwa
  data sudah dibuat, dikirim, diajukan, atau tersimpan.
- Agent aplikasi sudah menerima identitas akun. Kalau pemakai berkata
  "departemen saya", teruskan frasa itu apa adanya. Jangan meminta nama
  departemennya dan jangan menebaknya dari percakapan.
- Jangan menuliskan proses berpikirmu sebelum atau sesudah memanggil tool.
- Kalau hasil delegate_task berstatus "ditolak-penjaga", ikuti isi pesannya.
  Jangan mencoba lagi dengan kata lain, kecuali pesan itu memintamu
  meneruskan kalimat pemakai APA ADANYA${rute ? " atau meneruskan tugas yang sama ke agent di\n  `saran_agent`" : ""}.${rute ? ATURAN_STATUS_RUTE : ""}`;

  const agent = new Agent({
    name: umum.nama,
    purpose: umum.deskripsi ?? "Pintu masuk; mengarahkan ke agent aplikasi.",
    model: ({ context }) => pilihModel(context.get(KUNCI_MODEL)),
    instructions: () => instruksiPerute,
    subAgents: anak,
    // Lihat catatan panjang di atas: ini yang mematikan panduan bawaan.
    supervisorConfig: { systemMessage: instruksiPerute, customGuidelines: [] },
    maxSteps: MAKS_LANGKAH,
    // ⚠️ maxSteps TIDAK diturunkan. Batasnya per agent tujuan & per tugas yang sama (penjaga), jadi alur
    // multi-agent yang sah tetap punya 12 langkah, sementara putaran ke agent yang sama berhenti di ≤3.
    ...(penjaga ? kendaliPerute(penjaga, MAKS_LANGKAH) : {}),
  });

  return { agent, bawahan, dilewati };
}
