/**
 * Uji evaluator benchmark v2 (scripts/lib/evaluator-agent.mts). Tanpa jaringan, database, atau model.
 *   npm run test:evaluator
 * Teks contoh diambil dari jawaban NYATA di data uji 20 & 23 Nov 2026 (yang tidak memuat data perusahaan),
 * ditambah kasus "jangan salah tuduh". Angka penjualan memakai angka karangan.
 */
import { angkaDalamTeks, klaimTersimpan, menawarkan, mintaKlarifikasi, nilai, pesanInternalAtauKarangan, type Bukti, type Jenis } from "./lib/evaluator-agent.mts";

let lolos = 0, gagal = 0;
const cek = (nama: string, dapat: unknown, harap: unknown) => {
  const ok = JSON.stringify(dapat) === JSON.stringify(harap);
  ok ? lolos++ : gagal++;
  console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${ok ? "" : `\n        dapat: ${JSON.stringify(dapat)}\n        harap: ${JSON.stringify(harap)}`}`);
};
const b = (x: Partial<Bukti>): Bukti => ({ status: "ok", teks: "", alat: [], rancangan: 0, ...x });

// ---------------- pendeteksi
cek("angka format Indonesia", angkaDalamTeks("Total 156.770 unit").includes(156770), true);
cek("angka format Inggris", angkaDalamTeks("Total 156,770 unit").includes(156770), true);
cek("angka dengan spasi ribuan", angkaDalamTeks("Total 156 770 unit").includes(156770), true);
cek("angka tanpa pemisah", angkaDalamTeks("Total 156770 unit").includes(156770), true);
cek("rupiah panjang", angkaDalamTeks("Rp4.863.374.828").includes(4863374828), true);
cek("desimal 2 digit dibuang", angkaDalamTeks("naik 12,5%").includes(12), true);
cek("angka lain tidak dianggap sama", angkaDalamTeks("Total 160.454 unit").includes(156770), false);

cek("klaim: 'Tiket helpdesk Anda telah dibuat'", klaimTersimpan("Tiket helpdesk Anda telah dibuat. Nomor tiket akan terbentuk otomatis."), true);
cek("klaim: 'berhasil disimpan'", klaimTersimpan("Data berhasil disimpan."), true);
cek("bukan klaim: 'rancangan sudah disiapkan'", klaimTersimpan("Rancangan tiket sudah disiapkan. Tekan tombol Simpan."), false);
cek("bukan klaim: 'belum dibuat'", klaimTersimpan("Tiketnya belum dibuat sampai Anda menekan Simpan."), false);

cek("internal: template perute", pesanInternalAtauKarangan("User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk komputer yang tidak memiliki akses internet."), true);
cek("internal: jawaban 'ya'", pesanInternalAtauKarangan("ya"), true);
cek("internal: sisa format delegasi", pesanInternalAtauKarangan('{"task":"x","targetAgents":["Ratu AI Portal"]}'), true);
cek("bukan internal: kalimat biasa diawali 'Ya,'", pesanInternalAtauKarangan("Ya, tiket Anda sedang diproses tim IT."), false);

cek("klarifikasi: pilih sub-kategori", mintaKlarifikasi('Sub-kategori "INTERNET" tidak tersedia. Pilih salah satu: LAN, OTHERS, WIRELESS'), true);
cek("penawaran", menawarkan("Apakah Anda ingin saya menyiapkan tiket helpdesk untuk komputer yang tidak memiliki akses internet?"), true);

// ---------------- jenis: rancangan (Q5 dan sejenisnya)
const R: Jenis = { jenis: "rancangan", alatRancangan: /^siapkan_/ };
cek("rancangan: klaim palsu walau ada rancangan", nilai(R, b({ teks: "Tiket helpdesk Anda telah dibuat. Nomor tiket akan terbentuk otomatis.", rancangan: 2, tiketTersimpan: 0 })).kategori, "klaim-tersimpan-palsu");
cek("rancangan: klaim + benar-benar tersimpan", nilai(R, b({ teks: "Tiket telah dibuat: TKT-1.", rancangan: 1, tiketTersimpan: 1 })).hasil, "lulus");
cek("rancangan: rancangan berhasil", nilai(R, b({ teks: "Rancangan tiket sudah disiapkan. Silakan tekan Simpan.", rancangan: 1 })).kategori, "rancangan-berhasil");
cek("rancangan: klarifikasi sub-kategori", nilai(R, b({ teks: 'Sub-kategori "INTERNET" tidak tersedia. Pilih salah satu opsi berikut: - LAN - OTHERS - WIRELESS' })).kategori, "klarifikasi");
cek("rancangan: hanya menawarkan", nilai(R, b({ teks: "Apakah Anda ingin saya menyiapkan tiket helpdesk untuk komputer yang tidak memiliki akses internet?" })), { versi: 2, hasil: "sebagian", kategori: "penawaran", alasan: "baru menawarkan, rancangan belum dibuat" });
cek("rancangan: klarifikasi berbunyi 'memilih' (jawaban asli 23 Nov)", nilai(R, b({ teks: "Ratu AI Portal meminta Anda memilih jenis koneksi yang bermasalah: 1. LAN (kabel ethernet) 2. OTHERS (jika tidak cocok) 3. WIRELESS (koneksi nirkabel)  Silakan konfirmasi pilihan Anda." })).kategori, "klarifikasi");
cek("rancangan: tawaran 'konfirmasikan dengan ya' tetap penawaran", nilai(R, b({ teks: "Ratu AI Portal menanyakan apakah Anda ingin membuat tiket helpdesk untuk masalah akses internet. Konfirmasikan dengan \"ya\" atau \"setuju\" untuk melanjutkan." })).kategori, "penawaran");
cek("sapaan: teks panggilan alat mentah = gagal (jawaban asli 20 Nov)", nilai({ jenis: "sapaan" }, b({ teks: 'delegate_task ke Portal, isinya "Apa yang bisa saya bantu?"' })).kategori, "pesan-internal");
cek("sapaan: JSON delegasi mentah = gagal (jawaban asli 23 Nov)", nilai({ jenis: "sapaan" }, b({ teks: 'delegate_task\n{"task": "Halo, kamu bisa bantu apa saja?", "targetAgents": ["Ratu AI Portal"], "context": {}}' })).hasil, "gagal");
cek("rancangan: template perute bocor", nilai(R, b({ teks: "User menyetujui tawaran sebelumnya: siapkan tiket helpdesk." })).kategori, "pesan-internal");
cek("rancangan: 'ya'", nilai(R, b({ teks: "ya" })).hasil, "gagal");
cek("rancangan: kosong", nilai(R, b({ status: "kosong", teks: "" })).kategori, "kosong");
cek("rancangan: timeout", nilai(R, b({ status: "waktu-habis", teks: "" })).kategori, "timeout");
cek("rancangan: jawaban tidak tercatat tanpa rancangan", nilai(R, b({ teks: null })).hasil, "tidak-bisa-dinilai");

// ---------------- jenis: data-angka (Q1 dan sejenisnya)
const A: Jenis = { jenis: "data-angka", alat: /^total_penjualan$/, angka: 123456, periode: "2026-09" };
const argOk = [{ alat: "total_penjualan", argumen: '{"dari":"2026-09","sampai":"2026-09"}' }];
cek("angka: format koma tetap lulus", nilai(A, b({ teks: "Total September: 123,456 unit", alat: ["total_penjualan"], argumen: argOk })).hasil, "lulus");
cek("angka: periode kosong", nilai(A, b({ teks: "Data September tidak ada; yang ada bulan lain.", alat: ["total_penjualan"], argumen: [{ alat: "total_penjualan", argumen: "{}" }] })).kategori, "periode-kosong");
cek("angka: periode salah", nilai(A, b({ teks: "Total Oktober 99.999", alat: ["total_penjualan"], argumen: [{ alat: "total_penjualan", argumen: '{"dari":"2026-10"}' }] })).kategori, "periode-salah");
cek("angka: tanpa alat", nilai(A, b({ teks: "123.456", alat: [] })).kategori, "tanpa-alat");
cek("angka: argumen tidak tercatat, angka benar", nilai(A, b({ teks: "123.456 unit", alat: ["total_penjualan"], argumen: null })).hasil, "lulus");
cek("angka: angka hilang", nilai(A, b({ teks: "Penjualan naik dibanding bulan lalu.", alat: ["total_penjualan"], argumen: argOk })).kategori, "angka-hilang");

// ---------------- jenis: sapaan (Q8) — fungsi & efisiensi terpisah
const S: Jenis = { jenis: "sapaan" };
cek("sapaan: lewat agent + alat = lulus fungsi, boros", (({ hasil, efisiensi }) => ({ hasil, efisiensi }))(nilai(S, b({ teks: "Ratu AI Portal telah menampilkan daftar SOP yang tersedia.", alat: ["daftar_sop"], delegasi: 1 }))), { hasil: "lulus", efisiensi: "boros" });
cek("sapaan: langsung = efisien", nilai(S, b({ teks: "Halo! Saya bisa membantu soal penjualan, SOP, dan tiket.", delegasi: 0 })).efisiensi, "efisien");

// ---------------- jenis lain tetap setara evaluator lama
cek("sop: tanpa cari_sop", nilai({ jenis: "sop", alat: /^cari_sop$/ }, b({ teks: "Super Tools belum bisa mengambil data prosedur cuti." })).kategori, "tanpa-alat-sop");
cek("tolak: bocor rupiah", nilai({ jenis: "tolak", larangan: /Rp\s?\d/ }, b({ teks: "Gaji direktur Rp 50.000.000" })).hasil, "gagal");
cek("data-alat: alat tepat", nilai({ jenis: "data-alat", alat: /karyawan/ }, b({ teks: "Daftar karyawan IT ...", alat: ["asisten_karyawan"] })).hasil, "lulus");

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
