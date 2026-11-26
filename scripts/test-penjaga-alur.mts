/**
 * Uji unit penjaga alur Tahap 2 — murni, tanpa model, tanpa database, tanpa jaringan.
 *   npm run test:penjaga-alur
 *
 * Contoh teks diambil dari bentuk kegagalan nyata di RCA & laporan Tahap 1 (Q5, Q8), tetapi aturannya
 * diuji sebagai SIFAT umum — tidak ada aturan yang mengenali kode pertanyaan Q1–Q8.
 */
import {
  argumenStabil, butuhKeputusanPengguna, kemiripan, klaimPersetujuan, klaimTersimpan, pertanyaanTertunda,
  teksAlatMentah, kalimatAtasNamaPengguna, pilihanDalamTugas,
} from "../lib/alur/pola-teks.ts";
import {
  buatPemegangPenjaga, buatPenjagaAlur, GalatPenjaga, TEKS_BELUM_SELESAI, TEKS_RANCANGAN_BELUM_TERSIMPAN,
} from "../lib/alur/penjaga-alur.ts";
import { jagaPotongan } from "../lib/alur/jaga-stream.ts";

let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };
const ui = (peran: "user" | "assistant", teks: string) => ({ id: Math.random().toString(36), role: peran, parts: [{ type: "text", text: teks }] });

const TAWARAN = "Panduan khusus untuk komputer mengeluarkan asap belum ditemukan dalam basis pengetahuan SOP. Apakah Anda ingin saya menyiapkan tiket helpdesk untuk tim terkait?";
const KLARIFIKASI = "Sub-kategori yang tersedia untuk NETWORK:\n- LAN\n- WIFI\n- VPN\nSub-kategori mana yang dimaksud?";

console.log("— pola teks");
cek("klaimPersetujuan: bentuk Q5 'User menyetujui tawaran sebelumnya'", klaimPersetujuan("User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk internet mati"));
cek("klaimPersetujuan: 'Pengguna memilih LAN'", klaimPersetujuan("Pengguna memilih LAN untuk sub-kategori"));
cek("klaimPersetujuan: permintaan biasa TIDAK", !klaimPersetujuan("internet di ruangan saya mati, tolong buatkan tiket"));
cek("pilihanDalamTugas: 'memilih LAN untuk …' → LAN", pilihanDalamTugas("Pengguna memilih LAN untuk sub-kategori") === "LAN untuk sub-kategori");
cek("pertanyaanTertunda: tawaran", pertanyaanTertunda(TAWARAN)?.jenis === "tawaran");
const kl = pertanyaanTertunda(KLARIFIKASI);
cek("pertanyaanTertunda: klarifikasi + daftar pilihan", kl?.jenis === "klarifikasi" && kl.pilihan.join(",") === "LAN,WIFI,VPN", JSON.stringify(kl?.pilihan));
cek("pertanyaanTertunda: jawaban data biasa → tidak ada", pertanyaanTertunda("Total penjualan September 2026: Rp 156.770.") === null);
cek("teksAlatMentah: Q8 bentuk 1", teksAlatMentah('delegate_task ke Portal, isinya "Apa yang bisa saya bantu?"'));
cek("teksAlatMentah: Q8 bentuk 2 (JSON)", teksAlatMentah('delegate_task {"task": "Halo, kamu bisa bantu apa saja?", "targetAgents": ["Ratu AI Portal"]}'));
cek("teksAlatMentah: JSON tanpa nama alat", teksAlatMentah('{"task": "halo", "targetAgents": ["Portal"]}'));
cek("teksAlatMentah: jawaban wajar TIDAK", !teksAlatMentah("Saya bisa membantu tiket helpdesk, SOP, dan data penjualan."));
cek("kalimatAtasNamaPengguna", kalimatAtasNamaPengguna("User menyetujui tawaran sebelumnya: siapkan tiket.") && !kalimatAtasNamaPengguna("Silakan pilih sub-kategori."));
cek("klaimTersimpan: 'Tiket telah dibuat'", klaimTersimpan("Tiket helpdesk Anda telah dibuat."));
cek("klaimTersimpan: nomor tiket karangan", klaimTersimpan("Nomor tiket Anda TKT-00123."));
cek("klaimTersimpan: 'rancangan sudah disiapkan' TIDAK", !klaimTersimpan("Rancangan tiket sudah disiapkan."));
cek("klaimTersimpan: bentuk ingkar TIDAK", !klaimTersimpan("Tiketnya belum tersimpan.") && !klaimTersimpan("Data ini belum dibuat sampai Anda menekan Simpan."));
cek("butuhKeputusanPengguna: perlu-perbaikan + pilihan", !!butuhKeputusanPengguna({ status: "perlu-perbaikan", pesan: "pilih", masalah: [{ jenis: "tidak-dikenal", pilihan: [{ label: "LAN" }] }] }));
cek("butuhKeputusanPengguna: informasi kurang", !!butuhKeputusanPengguna({ status: "perlu-perbaikan", masalah: [{ jenis: "kurang", label: "Lokasi" }] }));
cek("butuhKeputusanPengguna: perlu-diperjelas (pencocokan ambigu)", !!butuhKeputusanPengguna({ status: "perlu-diperjelas", pesan: "produk yang mana?" }));
cek("butuhKeputusanPengguna: konfigurasi saja TIDAK", !butuhKeputusanPengguna({ status: "perlu-perbaikan", masalah: [{ jenis: "konfigurasi", sebab: "x" }] }));
cek("butuhKeputusanPengguna: kepanjangan (bisa diperbaiki model) TIDAK", !butuhKeputusanPengguna({ status: "perlu-perbaikan", masalah: [{ jenis: "kepanjangan", label: "Judul", maks: 10, panjang: 20 }] }));
cek("butuhKeputusanPengguna: siap TIDAK", !butuhKeputusanPengguna({ status: "siap", sidik: "x" }));
cek("argumenStabil: urutan kunci, huruf besar, spasi diabaikan",
  argumenStabil({ b: " LAN ", a: "Internet  mati" }) === argumenStabil({ a: "internet mati", b: "lan" }));
cek("kemiripan: tugas yang sama beda susunan ≥ 0.75",
  kemiripan("siapkan tiket internet mati di ruangan rapat", "internet di ruangan rapat mati, siapkan tiket") >= 0.75);
cek("kemiripan: tugas berbeda < 0.75", kemiripan("omzet penjualan agustus", "tiket helpdesk printer rusak") < 0.75);

console.log("— penjaga: persetujuan");
{
  const p = buatPenjagaAlur();
  const r1 = p.periksaDelegasi({ task: "User menyetujui tawaran sebelumnya: siapkan tiket untuk komputer berasap", targetAgents: ["Portal"] },
    [ui("user", "komputer saya mengeluarkan asap, bagaimana ini?")]);
  cek("persetujuan karangan tanpa tawaran → ditolak", !r1.boleh && r1.galat.kode === "persetujuan-karangan");
  cek("…teguran pertama belum menghentikan alur (perute boleh memperbaiki tugasnya)", !p.harusBerhenti());
  const r2 = p.periksaDelegasi({ task: "komputer saya mengeluarkan asap, bagaimana ini?", targetAgents: ["Portal"] }, []);
  cek("…tugas yang diperbaiki (kalimat pengguna apa adanya) → boleh", r2.boleh);
  const r3 = p.periksaDelegasi({ task: "User menyetujui pembuatan tiket", targetAgents: ["Admin"] }, []);
  cek("…persetujuan karangan berikutnya → ditolak DAN berhenti", !r3.boleh && p.harusBerhenti());
}
{
  const p = buatPenjagaAlur();
  const r = p.periksaDelegasi({ task: "User menyetujui tawaran sebelumnya: siapkan tiket helpdesk untuk komputer yang mengeluarkan asap", targetAgents: ["Portal"] },
    [ui("user", "komputer saya mengeluarkan asap"), ui("assistant", TAWARAN), ui("user", "ya setuju")]);
  cek("'ya setuju' sesudah tawaran yang sah → boleh", r.boleh);
  cek("…dan konteks tawaran + jawaban asli ditempel ke tugas", r.boleh && !!r.tugasBaru && r.tugasBaru.includes("menyiapkan tiket helpdesk") && r.tugasBaru.includes("«ya setuju»"));
}
{
  const p = buatPenjagaAlur();
  const r = p.periksaDelegasi({ task: "User menyetujui pembuatan tiket helpdesk", targetAgents: ["Portal"] },
    [ui("user", "berapa omzet agustus?"), ui("assistant", "Omzet Agustus 2026 Rp 457.383.190."), ui("user", "ya setuju")]);
  cek("'ya setuju' TANPA operasi yang menunggu → ditolak", !r.boleh && r.galat.kode === "persetujuan-karangan");
}
{
  const p = buatPenjagaAlur();
  const r = p.periksaDelegasi({ task: "User menyetujui tawaran sebelumnya: siapkan tiket helpdesk", targetAgents: ["Portal"] },
    [ui("assistant", TAWARAN), ui("user", "tidak usah")]);
  cek("penolakan dianggap persetujuan → ditolak", !r.boleh);
}
{
  const p = buatPenjagaAlur();
  const r = p.periksaDelegasi({ task: "User menyetujui tawaran sebelumnya: buat laporan omzet bulanan", targetAgents: ["Marketing"] },
    [ui("assistant", TAWARAN), ui("user", "ya")]);
  cek("'ya' dipakai untuk operasi LAIN dari yang ditawarkan → ditolak", !r.boleh, r.boleh ? "" : String((r.galat.hasil as { pesan: string }).pesan).slice(0, 90));
}
{
  const ok = buatPenjagaAlur().periksaDelegasi({ task: "Pengguna memilih LAN untuk tiket internet mati", targetAgents: ["Portal"] },
    [ui("assistant", KLARIFIKASI), ui("user", "LAN")]);
  cek("pilihan 'LAN' pada giliran berikutnya → boleh + konteks klarifikasi ditempel", ok.boleh && !!ok.tugasBaru?.includes("Sub-kategori mana"));
  const salah = buatPenjagaAlur().periksaDelegasi({ task: "Pengguna memilih WIFI untuk tiket internet mati", targetAgents: ["Portal"] },
    [ui("assistant", KLARIFIKASI), ui("user", "LAN")]);
  cek("pilihan yang TIDAK ditulis pengguna (WIFI ≠ LAN) → ditolak", !salah.boleh);
  const nomor = buatPenjagaAlur().periksaDelegasi({ task: "Pengguna memilih WIFI", targetAgents: ["Portal"] },
    [ui("assistant", KLARIFIKASI), ui("user", "2")]);
  cek("jawaban nomor '2' dipetakan ke pilihan kedua (WIFI) → boleh", nomor.boleh);
  const polos = buatPenjagaAlur().periksaDelegasi({ task: "LAN", targetAgents: ["Portal"] }, [ui("assistant", KLARIFIKASI), ui("user", "LAN")]);
  cek("jawaban pendek diteruskan apa adanya → boleh, konteks ditempel", polos.boleh && !!polos.tugasBaru?.includes("«LAN»"));
}

console.log("— penjaga: human-in-the-loop, loop, idempotensi");
{
  const p = buatPenjagaAlur();
  const masuk = [ui("user", "internet di ruangan saya mati, tolong buatkan tiket")];
  p.mulaiLangkah(0);
  cek("delegasi pertama → boleh", p.periksaDelegasi({ task: "internet di ruangan saya mati, tolong buatkan tiket", targetAgents: ["Portal"] }, masuk).boleh);
  p.periksaAlat("Portal", "siapkan_tiket", { kategori: "NETWORK", sub_kategori: "INTERNET" }, [ui("user", "internet mati")], "c1");
  p.catatHasilAlat("Portal", "siapkan_tiket", { status: "perlu-perbaikan", pesan: "Sub-kategori INTERNET tidak dikenal. Pilihan: LAN, WIFI, VPN.",
    masalah: [{ jenis: "tidak-dikenal", pilihan: [{ label: "LAN" }, { label: "WIFI" }] }] }, "c1");
  p.catatHandoff("Portal", KLARIFIKASI);
  cek("status alat 'perlu keputusan pengguna' → alur berhenti (klarifikasi)", p.harusBerhenti() && p.keadaan().berhenti?.kode === "klarifikasi");
  const lagi = p.periksaDelegasi({ task: "Pengguna memilih LAN", targetAgents: ["Portal"] }, masuk);
  cek("perute mencoba menjawab sendiri → ditolak", !lagi.boleh);
  const tutup = p.teksPenutup("");
  cek("teks penutup = pertanyaan agent bawahan apa adanya + nama agent", !!tutup && tutup.includes("Sub-kategori mana yang dimaksud?") && tutup.includes("Portal"));
  cek("tidak ada klaim tersimpan / rancangan", p.keadaan().rancangan === 0);
}
{
  const p = buatPenjagaAlur();
  p.periksaDelegasi({ task: "buatkan tiket internet mati", targetAgents: ["Portal"] }, [ui("user", "buatkan tiket internet mati")]);
  p.catatHasilAlat("Portal", "siapkan_tiket", { status: "perlu-perbaikan", pesan: "Pilih sub-kategori: LAN, WIFI.", masalah: [{ jenis: "tidak-dikenal", pilihan: [{ label: "LAN" }] }] });
  p.catatHandoff("Portal", "");
  cek("jawaban agent kosong saat menunggu pengguna → pesan dari HASIL ALAT dipakai", (p.teksPenutup("") ?? "").includes("Pilih sub-kategori: LAN, WIFI."));
}
{
  const p = buatPenjagaAlur();
  p.periksaDelegasi({ task: "cek sop internet", targetAgents: ["Portal"] }, [ui("user", "internet mati gimana?")]);
  p.catatHandoff("Portal", TAWARAN);
  cek("agent bawahan menawarkan tindakan → alur berhenti (tawaran)", p.keadaan().berhenti?.kode === "tawaran");
}
{
  const p = buatPenjagaAlur({ maksDelegasiPerAgent: 3, maksDelegasiTotal: 6 });
  const m = [ui("user", "berapa omzet agustus dan bagaimana tiket saya?")];
  cek("delegasi ke Marketing → boleh", p.periksaDelegasi({ task: "omzet penjualan agustus 2026", targetAgents: ["Marketing"] }, m).boleh);
  p.catatHandoff("Marketing", "Omzet Agustus Rp 457.383.190.");
  cek("delegasi BERBEDA ke Portal → boleh (multi-agent sah)", p.periksaDelegasi({ task: "status tiket helpdesk saya", targetAgents: ["Portal"] }, m).boleh);
  p.catatHandoff("Portal", "Anda punya 2 tiket terbuka.");
  cek("tugas berbeda ke Marketing lagi → boleh", p.periksaDelegasi({ task: "produk terlaris agustus", targetAgents: ["Marketing"] }, m).boleh);
  const ulang = p.periksaDelegasi({ task: "Omzet penjualan Agustus 2026?", targetAgents: ["Marketing"] }, m);
  cek("tugas sama (beda tanda baca/huruf) → delegasi-berulang + berhenti", !ulang.boleh && ulang.galat.kode === "delegasi-berulang" && p.harusBerhenti());
  cek("teks penutup = hasil valid terakhir", (p.teksPenutup("") ?? "").includes("2 tiket terbuka") || (p.teksPenutup("") ?? "").includes("457.383.190"));
}
{
  const p = buatPenjagaAlur({ maksDelegasiPerAgent: 3 });
  const m = [ui("user", "x")];
  ["a satu", "b dua", "c tiga"].forEach((t) => p.periksaDelegasi({ task: `tugas ${t} berbeda sekali`, targetAgents: ["Portal"] }, m));
  const ke4 = p.periksaDelegasi({ task: "tugas keempat lain lagi", targetAgents: ["Portal"] }, m);
  cek("batas 3 delegasi per agent → yang ke-4 ditolak", !ke4.boleh && ke4.galat.kode === "batas-delegasi-agent");
}
{
  const p = buatPenjagaAlur({ idSesi: "E1" });
  const a = { kategori: "NETWORK", sub_kategori: "LAN", judul: "Internet mati" };
  cek("rancangan pertama → boleh", p.periksaAlat("Portal", "siapkan_tiket", a, [], "k1").boleh);
  p.catatHasilAlat("Portal", "siapkan_tiket", { status: "siap", sidik: "abc", draf: {} }, "k1");
  const dua = p.periksaAlat("Portal", "siapkan_tiket", { judul: "internet  MATI", sub_kategori: "lan", kategori: "network" }, [], "k2");
  cek("rancangan identik (beda susunan/huruf) → TIDAK dijalankan, hasil sebelumnya dipakai", !dua.boleh && dua.galat.kode === "alat-berulang"
    && (dua.galat.hasil as { sidik?: string }).sidik === "abc");
  cek("rancangan tetap dihitung SEKALI", p.keadaan().rancangan === 1);
  cek("rancangan berbeda → boleh", p.periksaAlat("Portal", "siapkan_tiket", { ...a, sub_kategori: "WIFI" }, [], "k3").boleh);
}
{
  const p = buatPenjagaAlur();
  const masukBawahan = [ui("user", "internet di ruangan saya mati, tolong buatkan tiket")];
  p.periksaAlat("Portal", "siapkan_tiket", { kategori: "NETWORK", sub_kategori: "INTERNET" }, masukBawahan, "m1");
  p.catatHasilAlat("Portal", "siapkan_tiket", { status: "perlu-perbaikan", masalah: [{ jenis: "tidak-dikenal", pilihan: [{ label: "LAN" }] }] }, "m1");
  const pilihSendiri = p.periksaAlat("Portal", "siapkan_tiket", { kategori: "NETWORK", sub_kategori: "LAN" }, masukBawahan, "m2");
  cek("agent bawahan memilihkan nilai yang tidak ditulis pengguna → ditolak (menunggu-pengguna)", !pilihSendiri.boleh && pilihSendiri.galat.kode === "menunggu-pengguna");
  const p2 = buatPenjagaAlur();
  const masuk2 = [ui("user", "wifi kantor mati, buatkan tiket")];
  p2.periksaAlat("Portal", "siapkan_tiket", { kategori: "NETWORK", sub_kategori: "WIFI KANTOR" }, masuk2, "n1");
  p2.catatHasilAlat("Portal", "siapkan_tiket", { status: "perlu-perbaikan", masalah: [{ jenis: "tidak-dikenal", pilihan: [{ label: "WIFI" }] }] }, "n1");
  cek("…tetapi nilai yang memang ditulis pengguna (WIFI) → boleh", p2.periksaAlat("Portal", "siapkan_tiket", { kategori: "NETWORK", sub_kategori: "WIFI" }, masuk2, "n2").boleh);
}

console.log("— penjaga: teks akhir");
{
  const p = buatPenjagaAlur();
  cek("panggilan alat mentah → dibuang seluruhnya", p.saring('delegate_task ke Portal, isinya "halo"').teks === "" && p.saring("delegate_task x").buangSisa);
  cek("kalimat atas nama pengguna dibuang, sisanya tetap", p.saring("User menyetujui tawaran sebelumnya. Rancangan siap diperiksa.").teks.trim() === "Rancangan siap diperiksa.");
  cek("tanpa operasi tulis: 'tiket yang sudah dibuat minggu lalu' TIDAK diubah", p.saring("Tiket yang sudah dibuat minggu lalu ada 2.").teks.includes("sudah dibuat"));
  p.catatHasilAlat("Portal", "siapkan_tiket", { status: "siap", sidik: "s" });
  const k = p.saring("Tiket Anda telah dibuat dengan nomor TKT-0001. Teknisi akan datang.").teks;
  cek("dengan rancangan: klaim tersimpan diganti status sebenarnya", k.includes("belum tersimpan") && !k.includes("telah dibuat") && k.includes("Teknisi akan datang."), JSON.stringify(k));
}
{
  cek("tanpa teks & tanpa jawaban agent → pesan jujur", buatPenjagaAlur().teksPenutup("") === TEKS_BELUM_SELESAI);
  const p = buatPenjagaAlur(); p.catatHasilAlat("Portal", "siapkan_tiket", { status: "siap", sidik: "s" });
  cek("tanpa teks, ada rancangan → 'rancangan sudah disiapkan, belum tersimpan'", p.teksPenutup("") === TEKS_RANCANGAN_BELUM_TERSIMPAN);
  const q = buatPenjagaAlur(); q.periksaDelegasi({ task: "x", targetAgents: ["Marketing"] }, []); q.catatHandoff("Marketing", "Omzet Agustus Rp 457.383.190.");
  cek("tanpa teks, ada jawaban agent → hasil valid terakhir", (q.teksPenutup("") ?? "").startsWith("Omzet Agustus Rp 457.383.190."));
  cek("ada teks & tidak berhenti → tidak ada tambahan", q.teksPenutup("Omzet Agustus Rp 457.383.190.") === null);
}
{
  const a = buatPenjagaAlur(), b = buatPenjagaAlur();
  a.periksaDelegasi({ task: "x", targetAgents: ["Portal"] }, []); a.catatHandoff("Portal", TAWARAN);
  cek("dua penjaga (dua sesi) tidak berbagi state", a.harusBerhenti() && !b.harusBerhenti() && a.idPermintaan !== b.idPermintaan);
  const pp = buatPemegangPenjaga();
  pp.operasi("op1"); const p1 = pp.ambil(); p1.periksaDelegasi({ task: "x", targetAgents: ["Portal"] }, []); p1.catatHandoff("Portal", TAWARAN);
  pp.operasi("op1"); const samaOp = pp.ambil() === p1;
  pp.operasi("op2");
  cek("pemegang: operasi yang sama memakai penjaga yang sama; operasi baru → penjaga bersih", samaOp && pp.ambil() !== p1 && !pp.ambil().harusBerhenti());
}
cek("GalatPenjaga membawa hasil pengganti", new GalatPenjaga("tawaran", { status: "x" }).hasil.status === "x");

console.log("— penyaring stream");
async function kumpul<T>(it: AsyncIterable<T>): Promise<T[]> { const o: T[] = []; for await (const x of it) o.push(x); return o; }
async function* dari<T>(xs: T[]) { for (const x of xs) yield x; }
const potongUI = (teks: string, id = "t1") => [{ type: "text-start", id }, ...(teks.match(/[\s\S]{1,5}/g) ?? []).map((d) => ({ type: "text-delta", id, delta: d })), { type: "text-end", id }];
{
  const p = buatPenjagaAlur();
  const keluar = await kumpul(jagaPotongan(dari([{ type: "start" }, ...potongUI('delegate_task ke Portal, isinya "Apa yang bisa saya bantu?"'), { type: "finish" }]), p, "ui"));
  const teks = keluar.filter((x) => x.type === "text-delta").map((x) => (x as unknown as { delta: string }).delta).join("");
  cek("stream UI: panggilan alat mentah TIDAK pernah dikirim (tidak ada satu potongan pun)", !keluar.some((x) => JSON.stringify(x).includes("delegate_task")));
  cek("stream UI: teks penutup disisipkan SEBELUM finish", keluar.at(-1)?.type === "finish" && teks === TEKS_BELUM_SELESAI, JSON.stringify(teks).slice(0, 60));
  cek("stream UI: potongan sisipan berpasangan start/delta/end", keluar.filter((x) => x.type === "text-start").length === keluar.filter((x) => x.type === "text-end").length);
}
{
  const p = buatPenjagaAlur();
  const asli = "Total penjualan September 2026: **Rp 156.770**.\n\n| Bulan | Omzet |\n|---|---:|\n| Sep | 156.770 |\nSumber: penjualan bulanan.";
  const keluar = await kumpul(jagaPotongan(dari([...potongUI(asli), { type: "finish" }]), p, "ui"));
  const teks = keluar.filter((x) => x.type === "text-delta").map((x) => (x as unknown as { delta: string }).delta).join("");
  const iAkhir = keluar.findIndex((x) => x.type === "text-end"), iDelta = keluar.map((x) => x.type).lastIndexOf("text-delta");
  cek("stream UI: jawaban wajar sampai UTUH (angka 156.770, tabel)", teks === asli, JSON.stringify(teks).slice(0, 60));
  cek("stream UI: urutan dijaga (delta terakhir sebelum text-end)", iDelta < iAkhir);
  cek("stream UI: dilepas per kalimat/baris, bukan ditahan sampai akhir", keluar.filter((x) => x.type === "text-delta").length >= 4);
}
{
  const p = buatPenjagaAlur(); p.catatHasilAlat("Portal", "siapkan_tiket", { status: "siap", sidik: "s" });
  const keluar = await kumpul(jagaPotongan(dari([...potongUI("Tiket Anda telah dibuat dan masuk ke sistem. Silakan cek kartu."), { type: "finish" }]), p, "ui"));
  const teks = keluar.filter((x) => x.type === "text-delta").map((x) => (x as unknown as { delta: string }).delta).join("");
  cek("stream UI: klaim tersimpan diganti SEBELUM terkirim", !teks.includes("telah dibuat") && teks.includes("belum tersimpan"), JSON.stringify(teks).slice(0, 80));
}
{
  const p = buatPenjagaAlur();
  const full = [{ type: "text-start", id: "a" }, { type: "text-delta", id: "a", text: "Halo. " }, { type: "text-delta", id: "a", text: "Ada yang bisa dibantu?" }, { type: "text-end", id: "a" }, { type: "finish" }];
  const keluar = await kumpul(jagaPotongan(dari(full), p, "full"));
  cek("bentuk fullStream: medan `text` dipakai, teks utuh", keluar.filter((x) => x.type === "text-delta").map((x) => (x as { text: string }).text).join("") === "Halo. Ada yang bisa dibantu?");
}
{
  const p = buatPenjagaAlur();
  const keluar = await kumpul(jagaPotongan(dari([{ type: "text-start", id: "a" }, { type: "text-delta", id: "a", delta: "Sebagian jawaban" }, { type: "abort" }]), p, "ui"));
  cek("stream dibatalkan (tanpa finish): sisa dilepas, TANPA teks penutup", keluar.some((x) => (x as { delta?: string }).delta === "Sebagian jawaban") && !keluar.some((x) => (x as { delta?: string }).delta === TEKS_BELUM_SELESAI));
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
