/**
 * Pabrik agent, satu per departemen.
 *
 * Instruksi dibagi dua: bagian UMUM (cara query, alur cari_teks, cara menjawab)
 * yang sama untuk semua departemen, dan bagian KHUSUS (konteks bisnis + kamus
 * data) yang datang dari konfigurasi departemen.
 *
 * Dipakai dua tempat:
 *   - app/api/chat/route.ts  (dipanggil dari UI web, departemen dari sesi login)
 *   - voltagent/server.ts    (server debug VoltOps, port 3141)
 */
import { Agent } from "@voltagent/core";
import { anthropic } from "@ai-sdk/anthropic";
import { buatTools } from "./tools-db";
import {
  bolehTiketSerupa,
  buatToolCariSop,
  buatToolDaftarSop,
  buatToolTiketSerupa,
} from "./tools-kb";
import type { Pengguna } from "./tools-entri";
import { adaEntri, bolehEntri, bolehSetujui } from "./departemen/tipe";
import { kamusPerusahaan } from "./perusahaan/kamus-data";
import { buatToolPerusahaan } from "./perusahaan/tool-query";
import { buatToolDokumen } from "./tools-dokumen";
import { MAX_ROWS } from "./db";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { simulateStreamingMiddleware, wrapLanguageModel } from "ai";
import {
  alamatOllama, alamatBifrost, alamatQwen, timeoutQwen,
  ambilModel, MODEL_DEFAULT, NUM_CTX_LOKAL,
} from "./models";
import { SEMUA_DEPARTEMEN, type KonfigDepartemen } from "./departemen";

/** Kunci context tempat route menaruh pilihan model user. */
export const KUNCI_MODEL = "model";

/**
 * Kunci context untuk SALURAN jawaban ini akan dikirim ke mana.
 *
 * Bukan kosmetik: WhatsApp tidak bisa menampilkan tabel markdown sama sekali,
 * padahal instruksi bawaan kita justru MENYURUH pakai tabel. Tanpa pembedaan
 * ini, jawaban di WA berbentuk pagar `|---|---|` yang tidak terbaca.
 */
export const KUNCI_SALURAN = "saluran";

/**
 * Pengguna yang sedang login, `{ id, username }`.
 *
 * Dipakai tool pembatalan untuk menentukan order mana yang boleh dia batalkan.
 * Agent di-cache per departemen+peran, jadi identitas TIDAK boleh ikut ke
 * dalam cache itu -- masuknya lewat context per request.
 */
export const KUNCI_PENGGUNA = "pengguna";

/**
 * Sumber data yang sedang dipilih administrator: `"dummy"` atau
 * `"perusahaan"`.
 *
 * ⚠️ PILIH SATU. Kalau `perusahaan`, agent TIDAK lagi menyentuh database
 * dummy -- tool MySQL-nya dilepas, dan kamus datanya diganti. Dua sumber
 * sekaligus berarti dua dialek SQL dalam satu prompt, dan model yang tidak
 * yakin akan menebak.
 */
export const KUNCI_SUMBER = "sumber";

export type Saluran = "web" | "wa";

/** Bagian instruksi yang dipakai kalau departemen punya kolom teks. */
function bagianCariTeks(dep: KonfigDepartemen): string {
  if (dep.kolomTeks.length === 0) return "";

  return `
## Pertanyaan tentang ISI TULISAN (keluhan, alasan, pendapat, masukan)

Untuk pertanyaan seperti ini, kata kuncinya TIDAK BISA ditebak. Contoh nyata:
"keluhan kemasan" tidak akan menemukan "Tutup botolnya rusak", "Jar retak",
atau "Segelnya kebuka" lewat LIKE, padahal ketiganya keluhan kemasan.

Alurnya WAJIB dua langkah:

1. \`cari_teks\` untuk menemukan ragam kalimatnya. Tulis kata KONKRET beserta
   sinonimnya, bukan pertanyaan abstrak:
   - Baik : "kemasan rusak bocor penyok tutup botol pecah"
   - Buruk: "keluhan soal kemasan"
2. \`query_db\` untuk MENGHITUNG. Caranya beda tergantung pertanyaannya:

   **Kalau user tanya CONTOH atau TEMA** ("keluhannya apa aja", "kasih contoh"):
   pakai kalimatnya langsung — \`WHERE <kolom> IN ('kalimat1','kalimat2',...)\`

   **Kalau user tanya JUMLAH** ("berapa banyak", "paling sering apa"):
   JANGAN pakai \`IN (kalimat)\`. Satu kalimat biasanya cuma muncul di ~1 baris,
   jadi \`IN\` dengan 30 kalimat paling banyak menjangkau 30 baris — padahal yang
   dicari bisa lebih banyak. Yang benar: baca kalimat hasil cari_teks, AMBIL
   KATA KUNCINYA, lalu bikin query LIKE dari kata-kata itu —
   \`WHERE (<kolom> LIKE '%kemasan%' OR <kolom> LIKE '%bocor%' OR ...)\`

   Jadi cari_teks dipakai untuk MENEMUKAN kosakatanya (yang tidak bisa kamu tebak
   sendiri), SQL yang menghitungnya dengan tepat.

Tiga hal yang wajib diingat:

- **cari_teks tidak menghitung.** Presisinya sekitar 66% — kira-kira 1 dari 3
  kalimat yang dikembalikan tidak relevan. Baca dulu, buang yang tidak nyambung,
  baru masukkan sisanya ke SQL.
- **cari_teks tidak bisa membedakan yang positif dari yang negatif.** "Sampai dalam
  kondisi sempurna" dan "sampai dalam kondisi rusak" dianggap mirip. Saring dengan
  kolom yang menyatakan positif/negatif secara eksplisit.
${dep.petunjukTeks ? `  ${dep.petunjukTeks}\n` : ""}- **Tampilkan kalimat yang kamu hitung ke user**, jangan cuma angkanya. User harus
  bisa menilai sendiri apakah kalimat itu memang relevan dengan pertanyaannya.

Untuk pertanyaan ANGKA jangan pakai cari_teks — langsung SQL saja.
`.trim();
}

/**
 * @param hanyaQuery Model cuma dikasih `query_db`, jadi instruksinya tidak
 *   boleh menyebut tool lain. Lihat `pilihTools()` di bawah untuk alasannya.
 */
/**
 * Aturan tambahan kalau jawaban dikirim lewat WhatsApp.
 *
 * Diletakkan SETELAH bagian "Cara menjawab" supaya menimpa aturan tabel di
 * sana -- instruksi yang datang belakangan lebih diperhatikan model.
 */
const FORMAT_WA = `
## ⚠️ Jawaban ini dikirim lewat WhatsApp — aturan format DIGANTI

WhatsApp tidak mengenal markdown. Yang di web bagus, di sini jadi sampah.

- **DILARANG pakai tabel** (\`| kolom | kolom |\`). WhatsApp menampilkannya
  apa adanya sebagai deretan garis tegak yang tidak terbaca. Pakai daftar:
  \`\`\`
  1. Masker Beras — 1.617 pcs, Rp 121.560.000
  2. Serum Vitamin C — 1.204 pcs, Rp 98.320.000
  \`\`\`
- Tebal pakai \*satu bintang\*, BUKAN dua. \`**begini**\` tampil beserta
  bintangnya.
- Jangan pakai judul \`##\`. Pakai baris tebal biasa.
- Maksimal sekitar 10 baris data. Kalau hasilnya lebih banyak, tampilkan yang
  teratas lalu sebutkan sisanya berapa — layar HP sempit.
- Satu emoji di awal boleh, jangan lebih.
`.trim();

/**
 * Aturan entri data. Ditambahkan hanya untuk departemen yang mendukungnya.
 *
 * ⚠️ ATURAN NAMA ITU LAHIR DARI KEGAGALAN NYATA (28 Sep 2026).
 *
 * Diminta "catat 5 lulur", model TIDAK memanggil tool dan malah mengarang
 * tiga produk: "Lulur Tradisional", "Lulur Beras", "Lulur Kopi". Tidak ada
 * satu pun yang nyata -- yang asli "Lulur Kuning 200g" dan "Lulur Bengkoang
 * 200g". User yang menjawab "yang kedua" akan memilih produk fiktif.
 *
 * Larangan mengarang ANGKA sudah ada sejak awal. Ini memperluasnya ke NAMA.
 */
const ATURAN_ENTRI = `
## Mencatat penjualan

Kalau user minta MENCATAT penjualan (bukan bertanya), panggil
\`siapkan_penjualan\`. Sebut nama pelanggan dan produk APA ADANYA seperti yang
dia ketik.

- **JANGAN PERNAH menyebut nama produk atau pelanggan yang tidak datang dari
  hasil tool.** Termasuk saat menawarkan pilihan waktu namanya ambigu — daftar
  pilihan itu HARUS berasal dari tool, bukan dari ingatan kamu. Kalau kamu
  belum memanggil tool, kamu belum tahu produk apa saja yang ada.
- Ambigu atau tidak ketemu? Sampaikan apa adanya dari hasil tool, lalu TUNGGU
  jawaban user. Jangan memilihkan.
- **Kamu tidak bisa menyimpan.** Tool itu cuma menyusun draf; user yang
  mengonfirmasi lewat tombol atau balasan.
- Harga selalu dari database. Kalau user menyebut harga sendiri, abaikan dan
  sebutkan bahwa yang dipakai harga dari data.
`.trim();

const ATURAN_LEMBUR = `
## Mencatat lembur

Kalau user minta MENCATAT lembur (bukan bertanya), panggil \`siapkan_lembur\`.
Sebut nama karyawan APA ADANYA seperti yang dia ketik.

- **JANGAN PERNAH menyebut nama karyawan yang tidak datang dari hasil tool.**
  Termasuk saat menawarkan pilihan waktu namanya ambigu — daftar pilihan itu
  HARUS berasal dari tool, bukan dari ingatan kamu.
- **Nama karyawan TIDAK unik.** Ada beberapa orang dengan nama yang sama
  persis, bahkan di departemen dan jabatan yang sama. Kalau tool mengembalikan
  daftar pilihan, sampaikan apa adanya BESERTA NIK-nya, lalu TUNGGU user
  memilih. Jangan memilihkan.
- **Nilai rupiahnya jangan kamu hitung atau tebak.** Selalu dihitung dari data
  gaji oleh tool. Kamu juga tidak boleh menyebut gaji karyawan.
- Tool bisa menolak dengan alasan tertentu (karyawan sudah tidak aktif, level
  jabatannya tidak berhak lembur, jam di luar batas, tanggal tidak wajar).
  Sampaikan alasan penolakannya APA ADANYA — jangan diperhalus, dan jangan
  mencoba mengakalinya.
- **Kamu tidak bisa menyimpan.** Tool itu cuma menyusun draf; user yang
  mengonfirmasi lewat tombol atau balasan.
`.trim();

const ATURAN_PELAMAR = `
## Memasukkan pelamar baru

Kalau user minta MEMASUKKAN data pelamar, panggil \`siapkan_pelamar\`.

- Pelamar adalah orang BARU. Namanya diketik apa adanya — jangan dicocokkan
  ke data karyawan, dan jangan dibetulkan ejaannya.
- **Jangan mengarang isian yang tidak disebut user.** Kalau pendidikan,
  sumber, email, atau lowongannya belum disebut, TANYAKAN. Menebak "S1" atau
  "JobStreet" karena itu yang paling sering, sama saja dengan mengarang data.
- Pendidikan dan sumber punya pilihan TERBATAS. Kalau user menyebut yang lain,
  tool akan menolak — sampaikan pilihan yang sah dari pesan penolakannya,
  jangan mencarikan padanan sendiri.
- Lowongan disebut dengan KODE (mis. LOW-2026-014). Kalau user tidak tahu
  kodenya, tool akan menyebutkan lowongan yang masih menerima pelamar —
  sampaikan daftar itu apa adanya.
- **Kamu tidak bisa menyimpan.** Tool itu cuma menyusun draf; user yang
  mengonfirmasi lewat tombol atau balasan.
`.trim();

const ATURAN_KEPUTUSAN = `
## Menyetujui lembur

Kalau user minta MENYETUJUI atau MENOLAK lembur, panggil
\`siapkan_keputusan_lembur\`.

- Tanpa nomor: panggil TANPA \`id\` untuk menampilkan daftar yang menunggu,
  sampaikan daftarnya, lalu TUNGGU user menyebut nomornya. Jangan memilihkan.
- Dengan nomor: panggil dengan \`id\` itu, tampilkan isinya, lalu minta user
  memutuskan lewat tombol.
- **Kamu tidak bisa memutuskan.** Tool itu cuma menampilkan.
- **Alasan penolakan JANGAN kamu karang.** Yang menolak harus menulis
  alasannya sendiri — itu yang masuk jejak audit.
- Jangan menyarankan setuju atau tolak. Kamu tidak tahu konteks di luar data,
  dan keputusannya bukan milikmu.
`.trim();

/**
 * Cara user mengonfirmasi draf berbeda per saluran, dan model HARUS tahu yang
 * mana -- kalau tidak, dia menjawab "sudah tersimpan" waktu user membalas "ya",
 * padahal balasan teks tidak menyimpan apa pun di web. Itu pernah terjadi:
 * model bilang datanya "masuk ke sistem untuk diproses", user percaya, dan
 * tidak ada satu baris pun yang tertulis.
 */
function aturanKonfirmasi(saluran: Saluran): string {
  const cara =
    saluran === "wa"
      ? "user membalas **YA** (atau BATAL untuk membatalkan)"
      : "user menekan tombol **Simpan** di kartu konfirmasi yang muncul di bawah jawaban kamu";

  return `
- Yang menyimpan: ${cara}. Bukan kamu, dan bukan kalimat balasan kamu.
- **JANGAN PERNAH mengatakan datanya sudah tersimpan, sudah dikonfirmasi, sudah
  masuk sistem, atau sedang diproses.** Kamu tidak punya cara untuk mengetahui
  itu — kamu tidak pernah menerima kabar bahwa penyimpanan berhasil.
- Kalau user membalas "ya", "benar", "oke", atau sejenisnya: ${
    saluran === "wa"
      ? "itu sudah ditangani sistem di luar kamu, jadi jangan mengklaim apa pun soal hasilnya."
      : "itu BELUM menyimpan. Ingatkan dia untuk menekan tombol Simpan di kartu konfirmasi."
  }
- **JANGAN menyesuaikan angka hasil query dengan hitunganmu sendiri.** Angka
  dari query SUDAH mencerminkan keadaan terkini: entri yang tersimpan sudah
  ikut terhitung, dan order yang dibatalkan sudah otomatis dikeluarkan. Kamu
  TIDAK tahu apakah konfirmasi tadi sudah ditekan atau belum, jadi jangan
  menambah atau mengurangi apa pun "kalau nanti jadi disimpan/dibatalkan" —
  kalau ternyata sudah, angkanya jadi terhitung dua kali. Sampaikan hasil
  query apa adanya.`.trim();
}

/**
 * Tanggal hari ini untuk system prompt.
 *
 * ⚠️ TANPA INI MODEL TIDAK TAHU HARI INI TANGGAL BERAPA.
 *
 * Akibatnya "kemarin", "bulan lalu", "minggu ini" tidak bisa diterjemahkan --
 * model menebak dari data latihannya, yang tahunnya bisa meleset jauh. Pernah
 * terlihat langsung: "catat lembur X 2 jam kemarin" TIDAK memanggil tool sama
 * sekali, model malah balik bertanya tanggalnya berapa.
 *
 * Dihitung per request (bukan konstanta modul) supaya proses yang hidup
 * berhari-hari tidak terus memakai tanggal waktu dia dinyalakan.
 */
function bagianTanggal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const panjang = d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return [
    `## Hari ini`,
    "",
    `**${panjang}** (\`${iso}\`).`,
    "",
    'Pakai ini untuk menerjemahkan kata waktu: "kemarin", "minggu ini",',
    '"bulan lalu", "tahun ini". Jangan menebak tanggal dari ingatanmu, dan',
    "jangan balik bertanya tanggalnya kalau user memakai kata-kata itu.",
  ].join("\n");
}

/**
 * Siapa yang sedang bertanya.
 *
 * ⚠️ DITAMBAHKAN 1 OKT 2026 KARENA AGENT MENANYAKAN IDENTITAS KE USER YANG
 * SUDAH LOGIN.
 *
 * Gejalanya: user IT bertanya "tiket saya ada berapa yang masih open", dan
 * agent menjawab "saya tidak tahu identitas kamu, sebutkan nama atau ID
 * karyawan". Tidak ada tool yang dipanggil sama sekali.
 *
 * Sebabnya bukan model yang bodoh, tapi lubang rancangan kita:
 *
 *   - Untuk view berlingkup "diri", penyaring `id_employee` dipasang OTOMATIS
 *     oleh `bungkusPenyaring()`, jadi agent tidak perlu tahu siapa penanyanya.
 *   - Untuk IT, `v_asisten_tiket` sengaja dibuat "lintas" (30 Sep) karena
 *     `portal_ticket.id_employee` itu PELAPOR, bukan teknisi. Begitu penyaring
 *     otomatis dilepas, "tiket SAYA" jadi tidak bisa dijawab -- dan agent
 *     memang TIDAK PERNAH diberi tahu siapa yang login.
 *
 * Jadi agent menyimpulkan dengan benar bahwa dia kurang informasi. Yang salah
 * adalah informasinya tidak pernah diberikan.
 *
 * ⚠️ Kenapa aman memberi `id_employee` sendiri ke dalam prompt: pada view
 * "lintas" agent MEMANG sudah boleh membaca semua baris, jadi menyebut id
 * miliknya sendiri tidak memperluas apa pun. Pada view "diri", pembungkus
 * tetap memaksa penyaring apa pun yang ditulis agent. Yang bertambah cuma
 * kemampuan menjawab "punya saya yang mana".
 */
function bagianIdentitas(pengguna: unknown): string {
  const p = (pengguna ?? {}) as { nama?: unknown; username?: unknown; idEmployee?: unknown };
  const nama =
    typeof p.nama === "string" && p.nama !== ""
      ? p.nama
      : typeof p.username === "string"
        ? p.username
        : "(tidak diketahui)";
  const idEmployee = typeof p.idEmployee === "string" && p.idEmployee !== "" ? p.idEmployee : null;

  if (!idEmployee) {
    return [
      "## Siapa yang sedang bertanya",
      "",
      `Nama: **${nama}**`,
      "",
      "⚠️ Akun ini BELUM DIPETAKAN ke karyawan di database perusahaan, jadi",
      "data pribadinya (tiket, pengajuan, aset) tidak bisa dibaca.",
      "",
      "- Kalau user menanyakan datanya sendiri, sampaikan bahwa akunnya belum",
      "  dipetakan dan mintakan admin menjalankan pemetaan akun.",
      "- **JANGAN menanyakan nama atau ID karyawan ke user.** Menyebutkannya",
      "  sendiri tidak membuat sistem jadi bisa membacanya.",
    ].join("\n");
  }

  return [
    "## Siapa yang sedang bertanya",
    "",
    `Nama: **${nama}**`,
    `\`id_employee\`: \`${idEmployee}\``,
    "",
    "- **JANGAN PERNAH menanyakan identitas ke user.** Kamu sudah tahu dari",
    "  sesi login di atas. Bertanya 'siapa kamu' ke orang yang sudah login itu",
    "  kesalahan, bukan kehati-hatian.",
    "- View yang disaring per orang SUDAH otomatis terbatas ke dia. Jangan",
    "  menambahkan penyaring sendiri di sana.",
    "- View yang berisi data SELURUH perusahaan TIDAK disaring otomatis. Kalau",
    "  user bertanya tentang DIRINYA di view seperti itu (mis. \"tiket saya\"),",
    `  tambahkan sendiri \`WHERE id_employee = '${idEmployee}'\`.`,
    "- Pakai `id_employee`, BUKAN nama, untuk menyaring. Nama tidak unik di",
    "  database ini.",
  ].join("\n");
}

/**
 * Panduan memilih antara tool database dan tool basis pengetahuan.
 *
 * ⚠️ BAGIAN TERPENTING DI SINI ADALAH IZIN UNTUK MENGAKU TIDAK TAHU.
 *
 * `cari_sop` tidak punya ambang skor, jadi dia SELALU mengembalikan dokumen --
 * juga untuk pertanyaan yang tidak ada SOP-nya. Terbukti: pertanyaan "cara
 * klaim asuransi gigi" mengembalikan SOP klaim promosi, aturan kata sandi, dan
 * SOP cuti, semuanya berskor 0,8-an. Model yang tidak diberi izin eksplisit
 * untuk bilang "tidak ada" akan merangkai jawaban dari ketiganya.
 *
 * Alasan ambangnya tidak dipasang ada di `lib/kb/cari.ts`: pada model embedding
 * ini, dua hal tak berhubungan bisa berskor 0,87 sementara dua sinonim 0,90.
 *
 * Kalau `hanyaQuery` (model lokal), bagian ini kosong -- model itu cuma dapat
 * `query_perusahaan`, dan menyebut tool yang tidak dia punya justru membuatnya
 * mencoba memanggilnya lalu gagal.
 */
function bagianKbPerusahaan(dep: KonfigDepartemen, hanyaQuery: boolean): string {
  if (hanyaQuery) return "";

  const tiket = bolehTiketSerupa(dep.id)
    ? [
        "",
        "### `cari_tiket_serupa` — tiket helpdesk lama",
        "",
        "Untuk tahu sebuah keluhan pernah terjadi atau belum, kategorinya apa,",
        "dan teknisi mana yang biasa menanganinya.",
        "",
        "- ⚠️ **Ini BUKAN sumber solusi.** Cuma 4% tiket punya catatan",
        "  penyelesaian, dan yang ada pun sering cuma beberapa kata.",
        "- ⚠️ **User mengeluh gejala = pertanyaan prosedur.** \"Printer saya",
        "  bergaris\", \"laptop tidak menyala\", \"tidak bisa ngeprint\" itu",
        "  pertanyaan `cari_sop`, BUKAN `cari_tiket_serupa`. Panggil `cari_sop`",
        "  LEBIH DULU. Tiket serupa cuma tambahan konteks sesudahnya, kalau",
        "  memang berguna.",
        "- ⚠️ **Catatan tiket yang pendek BUKAN izin untuk melengkapi sendiri.**",
        "  Kalau catatannya berbunyi \"CEK UNIT\", itu artinya ada yang",
        "  memeriksanya — bukan bahwa kamu tahu penyebabnya. JANGAN menyusun",
        "  daftar kemungkinan penyebab dari pengetahuan umummu.",
        "- Untuk MENGHITUNG jumlah tiket, pakai `query_perusahaan`. Tool ini",
        "  mengurutkan kemiripan, bukan menghitung.",
      ]
    : [];

  return [
    "## Memilih tool: angka vs prosedur",
    "",
    "Dua jenis pertanyaan, dua tool berbeda. Salah pilih berarti salah jawab.",
    "",
    "| Pertanyaan user | Tool |",
    "| --- | --- |",
    "| Berapa, kapan, siapa, daftar data | `query_perusahaan` |",
    "| Bagaimana cara, apa syaratnya, siapa yang menyetujui | `cari_sop` |",
    "| **Mengeluhkan gejala** (\"printer bergaris\", \"laptop mati\") | **`cari_sop`** |",
    "",
    "Pertanyaan bisa butuh keduanya: \"tiket saya kenapa belum ditutup\" =",
    "`query_perusahaan` untuk status tiketnya, `cari_sop` untuk aturan",
    "penutupannya. Panggil dua-duanya, jangan pilih salah satu.",
    "",
    "### `cari_sop` — prosedur dan panduan",
    "",
    "Hasil `cari_sop` dan `daftar_sop` sudah disaring otomatis sesuai departemen",
    "akun ini. Dokumen dengan `access_menus` kosong adalah dokumen umum;",
    "dokumen yang ditandai departemen lain tidak ada di rakmu. Jangan mencoba",
    "menebak atau meminta dokumen yang tidak muncul.",
    "",
    "⚠️ **Basis pengetahuan ini mencakup SELURUH APLIKASI PERUSAHAAN, bukan",
    "hanya bidang departemenmu.** Isinya panduan MAPS, Supertools, CWOD,",
    "budget, approval, kepegawaian, dan lainnya.",
    "",
    "Karena itu: **JANGAN menyimpulkan sebuah pertanyaan di luar cakupan",
    "sebelum mencarinya.** Kamu tidak tahu isi rak tanpa melihat. Pertanyaan",
    "yang terdengar seperti urusan Keuangan atau HR sering ADA panduannya di",
    "sini — pernah terjadi: pertanyaan soal memindahkan budget ditolak sebagai",
    "“bukan urusan IT”, padahal dokumen “Transfer Budget” ada di rak.",
    "",
    "**Aturannya mutlak: untuk SETIAP pertanyaan prosedur, panggil `cari_sop`",
    "lebih dulu — tanpa kecuali.** Walaupun kamu yakin tidak ada panduannya.",
    "Satu pencarian cuma ±40 ms, sementara menolak pertanyaan yang sebenarnya",
    "ada jawabannya membuat user mengira sistemnya tidak berguna.",
    "",
    "Baru setelah melihat hasilnya kamu boleh menyimpulkan. Kalau memang tidak",
    "menjawab, katakan belum ada panduannya — dan itu kesimpulan dari HASIL,",
    "bukan dari dugaan.",
    "",
    "- Tanyakan dengan kalimat user apa adanya. Pencarian ini mengerti makna:",
    "  \"mau libur\" tetap menemukan dokumen yang menulis \"cuti\".",
    "- ⚠️ **Tool ini SELALU memberi hasil, termasuk kalau tidak ada yang cocok.**",
    "  Angka kemiripannya TIDAK bisa dipakai menilai relevansi — dua hal yang",
    "  tak berhubungan bisa berskor setinggi dua sinonim. Baca isinya dulu.",
    "- ⚠️ **Kalau tidak ada yang benar-benar menjawab, KATAKAN belum ada SOP-nya",
    "  — LANGSUNG, di jawaban itu juga.** Itu jawaban yang benar dan user lebih",
    "  tertolong olehnya daripada ditambal dari dokumen yang tidak nyambung.",
    "- ⚠️ **SATU KALI `cari_sop` SUDAH CUKUP. Jangan mencari lagi dengan kata",
    "  lain.** Pencarian ini berbasis makna, jadi mengulang pertanyaan yang sama",
    "  dengan susunan berbeda akan memberi hasil yang hampir sama. Kalau hasil",
    "  pertama tidak menjawab, hasil kedua juga tidak — berhenti dan katakan apa",
    "  adanya. Boleh menyebut `daftar_sop` dalam kalimat sebagai tawaran, tapi",
    "  TIDAK perlu memanggilnya kecuali user memintanya.",
    "- Dokumen bertanda `[contoh-uji]` ditulis untuk pengujian, BUKAN SOP resmi.",
    "  Kalau mengutip angka darinya (lama proses, batas hari), sebutkan itu dari",
    "  dokumen contoh dan perlu dipastikan ke pihak terkait.",
    "",
    "**Selalu sebut sumbernya.** Tiap hasil `cari_sop` membawa judul dokumen",
    "dan nama bagiannya. Sertakan itu waktu menjawab, dalam bentuk:",
    "",
    "> Alur CWOD End-to-End, bagian “Langkah 4: Distributor mengisi order”",
    "",
    "Menyebut judul dokumen saja tidak cukup kalau dokumennya panjang — nama",
    "bagian itu yang membuat user bisa membuka dan mencocokkan sendiri. Jangan",
    "menyebut bagian yang tidak tertulis di hasil tool.",
    "",
    "**Kalau hasil tool mencantumkan tautan, SERTAKAN tautannya.** Bukan",
    "opsional: tautan itu yang membuat user bisa membuka dokumennya sendiri,",
    "dan tanpa itu rujukanmu cuma nama yang harus dia cari manual. 35 dari 53",
    "dokumen punya tautan.",
    "",
    "Bentuknya: judul dokumen, nama bagian, lalu tautannya. Untuk dokumen yang",
    "TIDAK mencantumkan tautan, cukup judul dan bagiannya — **jangan mengarang",
    "alamat**, dan jangan memakai tautan dokumen lain.",
    ...tiket,
  ].join("\n");
}

export function buatInstruksi(
  dep: KonfigDepartemen,
  peran: string,
  hanyaQuery: boolean,
  saluran: Saluran,
  sumber: unknown,
  /**
   * Identitas penanya dari sesi login. Opsional supaya pemanggil lama
   * (termasuk `test:sumber-agent`) tetap jalan; tanpa ini bagian identitas
   * menjelaskan akunnya belum dipetakan, bukan diam-diam hilang.
   */
  pengguna?: unknown,
): string {
  // ⚠️ Sumber perusahaan: instruksi yang BERBEDA SAMA SEKALI, bukan kamus
  // data yang ditambahkan.
  //
  // Dua kamus sekaligus berarti dua dialek SQL dalam satu prompt, dan prompt
  // yang membengkak menurunkan mutu jawaban. Aturan entri/persetujuan dan
  // `cari_teks` juga tidak berlaku di sini -- menyebutnya cuma menyuruh model
  // memanggil tool yang tidak dia punya.
  //
  // ⚠️ Komentar di sini DULU berbunyi "agent cuma punya satu tool
  // (query_perusahaan)". Itu sudah tidak benar sejak `baca_dokumen` ada, dan
  // makin tidak benar sejak tool basis pengetahuan ditambah 1 Okt 2026.
  // Daftar tool yang sebenarnya ditentukan `pilihTools()` di bawah.
  if (sumber === "perusahaan") {
    return [
      dep.konteks,
      "",
      bagianTanggal(),
      "",
      bagianIdentitas(pengguna),
      "",
      kamusPerusahaan(dep.id),
      "",
      bagianKbPerusahaan(dep, hanyaQuery),
      "",
      "## Cara menjawab",
      "",
      "- Bahasa Indonesia yang santai dan gampang dimengerti.",
      "- Ringkas: pakai tabel atau list pendek, hindari paragraf panjang.",
      "- Format angka gaya Indonesia (Rp 3.950.747.690, bukan 3950747690).",
      // ⚠️ Perintah LaTeX-nya TIDAK dikutip di sini. Aturan ini hidup di dalam
      // string TypeScript, dan backslash di situ punya arti sendiri — menulis
      // contohnya pernah menyelipkan carriage return ke instruksi.
      "- JANGAN memakai LaTeX: tanpa tanda dolar, tanpa perintah berawalan",
      "  backslash. Panah ditulis langsung sebagai → atau kata \"lalu\", tanda",
      "  kali sebagai ×. Portal ini tidak merender rumus, jadi yang terbaca",
      "  user adalah tulisannya mentah.",
      "- **JANGAN PERNAH mengarang angka.** Setiap angka harus datang dari",
      "  hasil query. Kalau query tidak mengembalikan baris, bilang datanya",
      "  tidak ada.",
      "- View data pribadi (karyawan, pengajuan, tiket, aset, kunjungan)",
      "  SUDAH disaring ke data milik user yang bertanya. Jangan menambahkan",
      "  penyaring sendiri, dan jangan bilang itu data semua orang.",
      "- View lain yang disebut di kamus berisi data SELURUH perusahaan.",
      "  Sebut angkanya sebagai angka perusahaan, bukan angka milik user.",
      saluran === "wa" ? `\n${FORMAT_WA}` : "",
    ].join("\n");
  }

  const cariTeks = hanyaQuery ? "" : bagianCariTeks(dep);
  const tambahan = dep.kamusDataPeran?.[peran] ?? "";

  return `
${dep.konteks}

${bagianTanggal()}

## Cara kerja

Kamu punya akses BACA ke database MySQL \`${dep.db?.nama ?? "-"}\`. Alurnya:
1. Pahami maksud pertanyaan user.
2. Tulis SATU query SELECT yang tepat, jalankan lewat tool \`query_db\`.
3. Rangkum hasilnya jadi jawaban bahasa manusia.

Daftar tabel dan aturannya sudah ada di bawah — **langsung tulis SQL**.${
    hanyaQuery
      ? ""
      : `
Jangan buang waktu memanggil tool skema dulu. Panggil \`jelaskan_skema\` HANYA
kalau kamu butuh nama kolom yang persis dan belum yakin, atau kalau query kamu
error soal nama kolom.`
  }

Kamu HANYA punya akses ke data departemen ${dep.label}. Kalau user menanyakan data
departemen lain, jelaskan bahwa itu di luar jangkauan kamu — jangan coba mencarinya.
${cariTeks ? `\n${cariTeks}\n` : ""}
## Aturan query

- Kerjakan agregasi (SUM, COUNT, AVG, GROUP BY) di SQL, jangan tarik semua baris
  lalu hitung sendiri. Hasil query dibatasi ${MAX_ROWS} baris.
- Satu pertanyaan idealnya cukup 1 query. Kalau memang butuh 2 sudut pandang,
  boleh 2 query.
- Database ini read-only. Kalau user minta ubah/hapus data, jelaskan bahwa kamu
  hanya bisa membaca.

## Cara menjawab

- Bahasa Indonesia yang santai dan gampang dimengerti.
- Ringkas: pakai tabel atau list pendek, hindari paragraf panjang.
- Format angka gaya Indonesia (Rp 3.950.747.690, bukan 3950747690).
- JANGAN memakai LaTeX: tanpa tanda dolar, tanpa perintah berawalan backslash.
  Panah ditulis langsung sebagai → atau kata "lalu", tanda kali sebagai ×.
  Portal ini tidak merender rumus, jadi yang terbaca user tulisannya mentah.
- **JANGAN PERNAH mengarang angka.** Setiap angka di jawaban kamu harus datang
  dari hasil query. Kalau query tidak mengembalikan baris, bilang datanya tidak ada.
- Kalau ada keterbatasan data yang bikin angka bisa menyesatkan, sebutkan di jawaban.
${(adaEntri(dep, peran) || bolehSetujui(dep, peran, "lembur")) && !hanyaQuery ? `
${bolehEntri(dep, peran, "penjualan") ? ATURAN_ENTRI : ""}
${bolehEntri(dep, peran, "lembur") ? ATURAN_LEMBUR : ""}
${bolehEntri(dep, peran, "pelamar") ? ATURAN_PELAMAR : ""}
${bolehSetujui(dep, peran, "lembur") ? ATURAN_KEPUTUSAN : ""}
${aturanKonfirmasi(saluran)}
` : ""}
${saluran === "wa" ? `
${FORMAT_WA}
` : ""}
${dep.kamusData}
${tambahan}
`.trim();
}

/**
 * Klien Ollama dibuat sekali -- membuatnya per request itu mubazir.
 *
 * baseURL menunjuk ke `/api` (endpoint NATIVE Ollama), BUKAN `/v1`
 * (yang kompatibel OpenAI). Ini bukan selera: diukur 24 Sep 2026,
 * tool calling lewat `/v1` cuma berhasil 2 dari 5 kali untuk qwen2.5:7b,
 * sementara lewat `/api` 5 dari 5. Kegagalannya pun senyap -- model
 * mengembalikan teks sampah, bukan error.
 */
const ollama = createOllama({
  baseURL: alamatOllama(),

  /**
   * num_ctx disuntikkan di sini, BUKAN lewat `providerOptions` di pemanggil.
   *
   * Dua alasan:
   * 1. Tidak bisa lewat `ollama.chat(id, { options })`. Tipenya memang
   *    menerima argumen kedua, tapi implementasinya membuangnya --
   *    `provider.chat = createLanguageModel` dan fungsi itu cuma punya
   *    satu parameter (cek node_modules/ollama-ai-provider-v2/dist/index.mjs).
   *    Dipasang di sana: lolos TypeScript, tidak pernah sampai ke Ollama.
   * 2. Kalau ditaruh di `streamText()`, tiap pemanggil harus ingat
   *    menambahkannya. Yang lupa tidak dapat error -- cuma agent yang
   *    pikun. Persis bug yang bikin setelan ini ada.
   */
  fetch: async (url, init) => {
    if (init?.body && typeof init.body === "string") {
      const b = JSON.parse(init.body);
      b.options = { num_ctx: NUM_CTX_LOKAL, ...b.options };
      init = { ...init, body: JSON.stringify(b) };
    }
    return fetch(url, init);
  },
});

/**
 * Gateway model di server kantor. Endpoint-nya kompatibel OpenAI, jadi tidak
 * butuh paket khusus seperti Ollama.
 */
const bifrost = createOpenAICompatible({
  name: "bifrost",
  baseURL: alamatBifrost(),
  apiKey: process.env.BIFROST_API_KEY,
});

/**
 * Qwen 14B di Google Colab, lewat tunnel Cloudflare.
 *
 * Endpoint-nya OpenAI-compatible, jadi memakai klien yang sama dengan
 * Bifrost — tapi instance TERPISAH, karena URL, kunci, dan batas waktunya
 * sendiri. Menumpang `bifrost` berarti satu `.env` yang salah menyeret
 * dua-duanya.
 */
const qwen = createOpenAICompatible({
  name: "qwen-colab",
  baseURL: alamatQwen(),
  apiKey: process.env.QWEN_API_KEY,
  /**
   * ⚠️ Batas waktu dipasang DI SINI, bukan di pemanggil.
   *
   * Alasannya sama dengan `num_ctx` pada Ollama di atas: kalau ditaruh di
   * `streamText()`, tiap pemanggil harus ingat menambahkannya, dan yang lupa
   * tidak dapat galat — cuma permintaan yang terpotong di tengah waktu Colab
   * sedang memuat bobotnya.
   */
  fetch: (url, init) =>
    fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutQwen()) }),
});

/**
 * Pilih model sesuai penyedianya.
 *
 * `kandidat` berasal dari browser, jadi selalu lewat `ambilModel()` yang
 * mengembalikan default kalau id-nya di luar whitelist.
 */
export function pilihModel(kandidat: unknown) {
  const m = ambilModel(kandidat ?? MODEL_DEFAULT);
  if (m.penyedia === "lokal") return ollama(m.id);
  if (m.penyedia === "server") return bifrost(m.id);
  /**
   * ⚠️ QWEN DI COLAB TIDAK MENDUKUNG STREAMING — dan gagalnya keras.
   *
   * Diuji 21 Okt 2026 lewat portal: permintaan dengan `stream: true` dibalas
   *
   *     HTTP 400  {"detail":"Streaming unsupported"}
   *
   * Seluruh portal memanggil `streamText()`, jadi tanpa pembungkus ini model
   * itu TIDAK PERNAH bisa menjawab satu pertanyaan pun.
   *
   * `simulateStreamingMiddleware` memanggil `doGenerate` (non-streaming) lalu
   * memancarkan hasilnya sebagai satu potongan. Kontrak ke pemanggil tidak
   * berubah sama sekali — `streamText()`, metadata token, kartu konfirmasi,
   * dan riwayat percakapan tetap lewat jalur yang sama.
   *
   * ⚠️ AKIBAT SAMPINGAN YANG PENTING: untuk model ini jawaban utuh sudah ada
   * di server SEBELUM sepotong pun sampai ke browser. Itu persis yang
   * dibutuhkan penahan jawaban palsu versi server-side — tidak perlu menahan
   * stream secara khusus, karena di jalur ini memang tidak ada stream.
   *
   * Penyedia lain TIDAK disentuh: Claude dan Bifrost tetap streaming asli.
   */
  if (m.penyedia === "qwen") {
    return wrapLanguageModel({
      model: qwen(m.id),
      middleware: simulateStreamingMiddleware(),
    });
  }
  return anthropic(m.id);
}

/** Model lokal cuma boleh punya SATU tool. Lihat `pilihTools()`. */
function hanyaQuery(kandidat: unknown): boolean {
  return ambilModel(kandidat ?? MODEL_DEFAULT).penyedia === "lokal";
}
// Catatan: `server` sengaja TIDAK ikut dibatasi satu tool dulu. Pembatasan itu
// diukur pada qwen2.5; menerapkannya ke model lain tanpa mengukur sama saja
// menebak. Diputuskan setelah ada angkanya.

/**
 * ⚠️ Model lokal cuma dikasih `query_db`. Bukan karena tool lain tidak cocok
 * untuknya, tapi karena qwen2.5:7b tidak bisa MEMILIH antar tool.
 *
 * Diukur 24 Sep 2026, 2 pertanyaan x 3 kali = 6 percobaan per baris,
 * dihitung berapa kali `query_db` benar-benar dipanggil:
 *
 *   query_db + cari_teks + jelaskan_skema   2/6
 *   query_db + cari_teks                    2/6
 *   query_db + jelaskan_skema               2/6
 *   query_db saja                           5/6   (diulang: 10/12)
 *
 * Jadi yang menentukan bukan tool MANA, tapi BERAPA BANYAK. Tool kedua apa
 * pun langsung menjatuhkannya. Diberi satu pilihan, dia memakainya; diberi
 * dua, dia malah bercerita dan membacakan ulang kamus data di system prompt
 * tanpa menyentuh database sama sekali.
 *
 * Harganya: model lokal kehilangan `cari_teks`, jadi pertanyaan soal isi
 * tulisan (keluhan, alasan) tidak jalan di situ -- arahkan ke Claude. Itu
 * bukan kerugian nyata: dengan cari_teks terpasang pun cuma 2/6 yang jalan.
 *
 * Claude tidak terpengaruh -- tetap dapat ketiganya.
 */
/**
 * Baca `KUNCI_PENGGUNA` dari context.
 *
 * Isinya diletakkan route/bot, bukan user, tapi tetap diperiksa: context
 * bertipe `unknown` dan kalau bentuknya meleset, tool pembatalan akan memakai
 * `id` yang salah -- artinya user bisa membatalkan order orang lain. Lebih
 * baik tool-nya hilang daripada memakai identitas yang tidak jelas.
 */
function bacaPengguna(nilai: unknown): Pengguna | undefined {
  if (!nilai || typeof nilai !== "object") return undefined;
  const { id, username } = nilai as { id?: unknown; username?: unknown };
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return undefined;
  if (typeof username !== "string" || username === "") return undefined;
  return { id, username };
}

/**
 * Diekspor supaya bisa diuji langsung (`npm run test:sumber-agent`).
 *
 * `agent.tools` itu DynamicValue yang disimpan VoltAgent di dalam, tidak bisa
 * dibaca dari luar -- jadi satu-satunya cara memeriksa "sumber X memberi tool
 * apa" adalah memanggil fungsinya sendiri. Dan itu justru yang paling perlu
 * diuji: kalau tool MySQL ikut terpasang waktu sumbernya perusahaan, model
 * punya dua dialek sekaligus.
 */
export function pilihTools(
  dep: KonfigDepartemen,
  peran: string,
  kandidat: unknown,
  pengguna: unknown,
  sumber: unknown,
) {
  const orang = bacaPengguna(pengguna);

  // ⚠️ `baca_dokumen` berlaku di KEDUA sumber.
  //
  // Dokumen yang diunggah user itu data portal, bukan data perusahaan --
  // tidak ada hubungannya dengan saklar sumber di /dbadmin. Orang marketing
  // yang sedang membaca database dummy tetap boleh mengunggah PDF.
  //
  // Tapi tetap butuh identitas pengguna: dokumen diambil dengan
  // `pengguna_id` di WHERE, supaya tidak ada yang membaca punya orang lain.
  const tools_dokumen = orang ? [buatToolDokumen(orang)] : [];

  // ⚠️ Sumber perusahaan: TIDAK ADA tool entri.
  //
  // Tool entri menulis ke MySQL dummy. Kalau agent membaca dari PostgreSQL
  // perusahaan tapi tombol Simpan menulis ke dummy, itu tidak nyambung --
  // dan `ai_readonly` memang tidak bisa menulis ke sana. Jadi waktu sumbernya
  // perusahaan, agent jadi baca-saja (plus membaca dokumen unggahan).
  if (sumber === "perusahaan") {
    // Tanpa identitas pengguna, penyaring baris tidak bisa dipasang -- dan
    // tanpa penyaring, satu user melihat data 1.954 orang lain. Lebih baik
    // tidak ada tool daripada tool yang bocor.
    if (!orang) return [];

    const tools_pg = [
      buatToolPerusahaan({
        ...orang,
        idEmployee: bacaIdEmployee(pengguna),
        // Gerbang view lingkup marketing. Departemen pengguna yang
        // menentukan daftar view, bukan perannya.
        departemen: dep.id,
      }),
      // Dokumen umum (access_menus NULL) berlaku untuk semua departemen.
      // Dokumen dengan access_menus terisi hanya terlihat oleh departemen
      // yang sama dengan sesi login. Penyaring dilakukan di SQL, bukan oleh
      // model, supaya data penjualan tidak bocor ke HR atau IT.
      buatToolCariSop(dep.id),
      buatToolDaftarSop(dep.id),
      // ⚠️ Tiket lintas orang: digerbangi aturan view, bukan `dep.id`.
      //
      // Untuk departemen berlingkup "diri" tool-nya TIDAK dipasang, bukan
      // dipasang lalu kosong. Alasan lengkapnya di `tools-kb.ts`.
      ...(bolehTiketSerupa(dep.id) ? [buatToolTiketSerupa({ departemen: dep.id })] : []),
      ...tools_dokumen,
    ];

    // ⚠️ Model lokal tetap CUMA satu tool, sama seperti jalur dummy di bawah.
    //
    // Dulu cabang ini `return` lebih awal sehingga penyaring model lokal
    // terlewat -- waktu itu tidak terasa karena tool-nya cuma dua. Dengan
    // tool KB, jumlahnya jadi lima, dan JUMLAH tool itulah yang terukur
    // menjatuhkan qwen2.5 (lihat catatan di atas `bacaPengguna`): diberi satu
    // pilihan dia memakainya, diberi lebih dia malah bercerita.
    if (hanyaQuery(kandidat)) {
      return tools_pg.filter((t) => t.name === "query_perusahaan");
    }
    return tools_pg;
  }

  const semua = [...buatTools(dep, peran, orang), ...tools_dokumen];

  // ⚠️ Model lokal tetap CUMA `query_db`, termasuk tanpa `baca_dokumen`.
  //
  // Bukan karena tool ini tidak cocok untuknya, tapi karena yang menjatuhkan
  // qwen2.5 adalah JUMLAH tool, bukan tool mana (lihat pengukuran di bawah).
  // Menambah pengecualian di sini akan membatalkan hasil pengukuran itu.
  if (!hanyaQuery(kandidat)) return semua;
  return semua.filter((t) => t.name === "query_db");
}

/** `idEmployee` dari context. Terpisah dari `bacaPengguna` karena boleh null. */
function bacaIdEmployee(nilai: unknown): string | null {
  if (!nilai || typeof nilai !== "object") return null;
  const { idEmployee } = nilai as { idEmployee?: unknown };
  return typeof idEmployee === "string" && idEmployee !== "" ? idEmployee : null;
}

export function buatAgent(dep: KonfigDepartemen, peran: string): Agent {
  return new Agent({
    name: `Asisten ${dep.label} (${peran})`,
    purpose: dep.tujuan,
    // Model ditentukan PER REQUEST, bukan sekali di sini -- user bisa ganti
    // lewat dropdown di UI. Satu instance agent cukup untuk semua model.
    //
    // validasiModel() dipanggil lagi di sini (route juga memanggilnya) supaya
    // server debug VoltOps -- yang tidak lewat route -- tetap dapat model sah.
    // `anthropic()` baca ANTHROPIC_API_KEY dari environment.
    model: ({ context }) => pilihModel(context.get(KUNCI_MODEL)),
    // Instruksi dan tool ikut berubah per request, sama seperti `model` di
    // atas: keduanya bergantung pada model yang dipilih user. Kalau tool-nya
    // dipangkas tapi instruksinya tidak, agent disuruh memanggil tool yang
    // tidak dia punya.
    instructions: ({ context }) =>
      buatInstruksi(
        dep,
        peran,
        hanyaQuery(context.get(KUNCI_MODEL)),
        context.get(KUNCI_SALURAN) === "wa" ? "wa" : "web",
        context.get(KUNCI_SUMBER),
        context.get(KUNCI_PENGGUNA),
      ),
    tools: ({ context }) =>
      pilihTools(
        dep,
        peran,
        context.get(KUNCI_MODEL),
        context.get(KUNCI_PENGGUNA),
        context.get(KUNCI_SUMBER),
      ),
    /**
     * Default VoltAgent cuma 5 (`defaultMaxSteps = this.workspace ? 100 : 5`),
     * dan alur hybrid melebihinya: cari_teks -> 2-3 query -> jawaban, ditambah
     * ruang untuk memperbaiki query yang error.
     *
     * Kalau jatahnya habis, stream berakhir dengan finishReason "tool-calls" dan
     * user melihat balasan KOSONG -- tanpa pesan error apa pun. Itu yang terjadi
     * sebelum angka ini dinaikkan.
     *
     * 12 cukup longgar tapi tetap jadi rem kalau agent nyangkut di loop.
     */
    maxSteps: 12,
  });
}

/**
 * Agent dibuat sekali lalu dipakai ulang. Disimpan di globalThis supaya
 * hot-reload Next.js tidak membuat instance baru tiap kali file berubah.
 */
const KUNCI = Symbol.for("portal.agents");
type Global = typeof globalThis & { [KUNCI]?: Map<string, Agent> };

export function ambilAgent(dep: KonfigDepartemen, peran: string): Agent {
  const g = globalThis as Global;
  g[KUNCI] ??= new Map();

  // Peran ikut jadi kunci: agent staf dan kepala punya kamus data berbeda
  // DAN memakai user MySQL berbeda.
  const kunci = `${dep.id}:${peran}`;
  let agent = g[KUNCI].get(kunci);
  if (!agent) {
    agent = buatAgent(dep, peran);
    g[KUNCI].set(kunci, agent);
  }
  return agent;
}

/**
 * Semua agent untuk server debug VoltOps: satu per (departemen, peran)
 * supaya perbedaan akses antar peran bisa dicoba langsung dari console.
 */
export function semuaAgent(): Record<string, Agent> {
  const hasil: Record<string, Agent> = {};
  for (const d of SEMUA_DEPARTEMEN) {
    const peranSet = new Set(["staf", ...Object.keys(d.db?.awalanEnvPeran ?? {}), ...Object.keys(d.kamusDataPeran ?? {})]);
    for (const peran of peranSet) hasil[`${d.id}-${peran}`] = ambilAgent(d, peran);
  }
  return hasil;
}
