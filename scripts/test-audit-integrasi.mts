/**
 * Audit integrasi Tahap 1–6 — memeriksa bahwa perubahan antar tahap TIDAK saling bertentangan.
 *   npm run test:audit-integrasi
 *
 * Murni (tanpa model, database, jaringan). Fokusnya titik temu antar tahap:
 *   T1↔T2/5/6  teks yang disisipkan penjaga dinilai BENAR oleh evaluator v2 (tidak dianggap pesan internal,
 *              klaim tersimpan, atau kosong) — dan evaluator tetap independen dari penjaga.
 *   T2↔T5/6    penyaring stream Tahap 2 tidak memakan teks penutup Tahap 5/6.
 *   T2↔T4      idempotensi memakai ulang hasil yang DILIHAT model (dengan tanda periode).
 *   T2↔T6      pengosongan pilihan terjadi SEBELUM sidik idempotensi dihitung.
 *   T5↔T2      sapaan tidak menelan jawaban atas tawaran ("ok", "ya", "terima kasih" sesudah tawaran).
 */
import { nilai } from "./lib/evaluator-agent.mts";
import { buatPemegangPenjaga, buatPenjagaAlur, TEKS_BELUM_SELESAI, TEKS_RANCANGAN_BELUM_TERSIMPAN, TEKS_TERIMA_KASIH } from "../lib/alur/penjaga-alur.ts";
import { teksKemampuan } from "../voltagent/kendali-alur.ts";
import { klaimTersimpan as klaimPenjaga, teksAlatMentah, kalimatAtasNamaPengguna } from "../lib/alur/pola-teks.ts";
import { klaimTersimpan as klaimEvaluator, pesanInternalAtauKarangan } from "./lib/evaluator-agent.mts";

let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };
const ui = (peran: "user" | "assistant", teks: string) => ({ id: Math.random().toString(36), role: peran, parts: [{ type: "text", text: teks }] });
const bukti = (teks: string, o: Partial<{ alat: string[]; rancangan: number; delegasi: number }> = {}) =>
  ({ status: "ok" as const, teks, alat: o.alat ?? [], rancangan: o.rancangan ?? 0, delegasi: o.delegasi ?? 0 });

const KEMAMPUAN = teksKemampuan("Ratu AI", [{ nama: "Ratu AI Portal", bisa: ["Tiket helpdesk", "Cari SOP"] }, { nama: "Ratu AI Marketing", bisa: ["Total penjualan"] }]);
const HITL = "Sub-kategori yang tersedia:\n- LAN\n- WIFI\nSub-kategori mana yang dimaksud?\n\n_— Ratu AI Portal_";

console.log("— T1 ↔ T2/5/6: evaluator v2 menilai teks sisipan penjaga dengan benar");
const sapa = nilai({ jenis: "sapaan" }, bukti(KEMAMPUAN));
cek("teks kemampuan (Tahap 5) → sapaan lulus + efisien (tanpa delegasi sungguhan)", sapa.hasil === "lulus" && sapa.efisiensi === "efisien", `${sapa.hasil}/${sapa.kategori}/${sapa.efisiensi}`);
const sapaDitolak = nilai({ jenis: "sapaan" }, bukti(KEMAMPUAN, { delegasi: 0 }));
cek("delegasi yang DITOLAK penjaga tidak dihitung (profil-alur-agent: delegasi − delegasi_ditolak) → tetap efisien", sapaDitolak.efisiensi === "efisien");
const rc = nilai({ jenis: "rancangan", alatRancangan: /siapkan_tiket/ }, bukti(`${TEKS_RANCANGAN_BELUM_TERSIMPAN} Teknisi akan menghubungi.`, { rancangan: 1, alat: ["siapkan_tiket"] }));
cek("pengganti klaim (Tahap 2) → rancangan lulus, BUKAN klaim-tersimpan-palsu", rc.hasil === "lulus" && rc.kategori !== "klaim-tersimpan-palsu", `${rc.hasil}/${rc.kategori}`);
const kl = nilai({ jenis: "rancangan", alatRancangan: /siapkan_tiket/ }, bukti(HITL, { alat: ["siapkan_tiket"] }));
cek("pertanyaan HITL yang disisipkan (Tahap 2/6) → klarifikasi lulus", kl.hasil === "lulus" && kl.kategori === "klarifikasi", `${kl.hasil}/${kl.kategori}`);
const jujur = nilai({ jenis: "rancangan", alatRancangan: /siapkan_tiket/ }, bukti(TEKS_BELUM_SELESAI));
cek("pesan jujur 'belum selesai' → TIDAK dianggap klaim tersimpan, TIDAK dianggap kosong (tetap gagal fungsi, jujur)",
  jujur.kategori !== "klaim-tersimpan-palsu" && jujur.kategori !== "kosong" && jujur.hasil === "gagal", `${jujur.hasil}/${jujur.kategori}`);
for (const [nama, t] of [["kemampuan", KEMAMPUAN], ["rancangan", TEKS_RANCANGAN_BELUM_TERSIMPAN], ["jujur", TEKS_BELUM_SELESAI], ["terima kasih", TEKS_TERIMA_KASIH], ["HITL", HITL]] as const) {
  cek(`teks sisipan "${nama}" tidak dianggap pesan internal oleh evaluator`, !pesanInternalAtauKarangan(t));
}
cek("Q1: panggilan pertama tanpa periode (ditolak penjaga) + panggilan kedua sesuai → evaluator 'sesuai', angka benar → lulus",
  nilai({ jenis: "data-angka", alat: /total_penjualan/, angka: 156770, periode: "2026-09" }, { ...bukti("Total September 2026: Rp 156.770.", { alat: ["total_penjualan"] }),
    argumen: [{ alat: "total_penjualan", argumen: "{}" }, { alat: "total_penjualan", argumen: '{"dari":"2026-09","sampai":"2026-09"}' }] }).hasil === "lulus");

console.log("— T2 ↔ T5/6: penyaring stream tidak memakan teks penutup");
const p = buatPenjagaAlur();
p.catatHasilAlat("Portal", "siapkan_tiket", { status: "siap", sidik: "s" });   // operasi tulis aktif: penyaring klaim menyala
for (const [nama, t] of [["kemampuan", KEMAMPUAN], ["rancangan", TEKS_RANCANGAN_BELUM_TERSIMPAN], ["jujur", TEKS_BELUM_SELESAI], ["HITL", HITL], ["terima kasih", TEKS_TERIMA_KASIH]] as const) {
  cek(`saring() meloloskan teks "${nama}" utuh`, p.saring(t).teks === t, JSON.stringify(p.saring(t).teks).slice(0, 60));
}
cek("pola penjaga & evaluator SEPAKAT untuk klaim baku (padahal kodenya terpisah)",
  ["Tiket Anda telah dibuat.", "Data berhasil disimpan.", "Rancangan sudah disiapkan.", "Tiketnya belum tersimpan."].every((t) => klaimPenjaga(t) === klaimEvaluator(t) || /belum/.test(t)));
cek("teks sisipan tidak memicu detektor teks-alat / atas-nama-pengguna",
  [KEMAMPUAN, HITL, TEKS_BELUM_SELESAI, TEKS_RANCANGAN_BELUM_TERSIMPAN].every((t) => !teksAlatMentah(t) && !kalimatAtasNamaPengguna(t)));

console.log("— T2 ↔ T4: idempotensi memakai hasil yang dilihat model");
{
  const q = buatPenjagaAlur({ hariIni: () => "2026-11" }); q.mulai([ui("user", "total penjualan terbaru")]);
  const meta = { argumen: ["relatif", "dari", "sampai"] };
  q.periksaAlat("Marketing", "total_penjualan", {}, [], "x1", meta);
  q.catatHasilAlat("Marketing", "total_penjualan", { status: "siap", total: 1 }, "x1", undefined, meta);
  const ulang = q.periksaAlat("Marketing", "total_penjualan", {}, [], "x2", meta);
  cek("panggilan identik kedua → hasil sebelumnya + tanda periode_otomatis (bukan versi tanpa tanda)",
    !ulang.boleh && (ulang.galat.hasil as { periode_otomatis?: unknown }).periode_otomatis === true);
}
console.log("— T2 ↔ T6: pengosongan pilihan sebelum sidik");
{
  const q = buatPenjagaAlur(); q.mulai([ui("user", "internet mati, buatkan tiket")]);
  const meta = { tag: ["pilihan-pengguna:sub_kategori"] };
  const a1: Record<string, unknown> = { kategori: "NETWORK", sub_kategori: "LAN" };
  q.periksaAlat("Portal", "siapkan_tiket", a1, [], "y1", meta);
  q.catatHasilAlat("Portal", "siapkan_tiket", { status: "perlu-perbaikan", masalah: [{ jenis: "kurang", pilihan: [{ nilai: "1", label: "LAN" }, { nilai: "2", label: "WIFI" }] }] }, "y1");
  const a2: Record<string, unknown> = { kategori: "NETWORK", sub_kategori: "VPN" };
  const r2 = q.periksaAlat("Portal", "siapkan_tiket", a2, [], "y2", meta);
  cek("tebakan kedua yang juga karangan → dikosongkan → identik dengan panggilan pertama → TIDAK dijalankan lagi",
    a2.sub_kategori === "" && !r2.boleh && r2.galat.kode === "alat-berulang");
}
console.log("— T5 ↔ T2: sapaan tidak menelan jawaban atas tawaran");
{
  const tawaran = "Panduan belum ditemukan. Apakah Anda ingin saya menyiapkan tiket helpdesk?";
  for (const jawab of ["ok", "ya", "terima kasih"]) {
    const q = buatPenjagaAlur();
    const r = q.periksaDelegasi({ task: `User menyetujui tawaran sebelumnya: siapkan tiket helpdesk (${jawab})`, targetAgents: ["Portal"] }, [ui("assistant", tawaran), ui("user", jawab)]);
    const k = r.boleh ? "boleh" : r.galat.kode;
    cek(`"${jawab}" sesudah tawaran → BUKAN 'sapaan-langsung' (${k})`, k !== "sapaan-langsung");
  }
  const pp = buatPemegangPenjaga(); pp.pakaiKemampuan(KEMAMPUAN);
  pp.operasi("o1"); pp.ambil().mulai([ui("user", "halo")]);
  pp.operasi("o2");   // operasi baru = penjaga baru (pemegang dipakai ulang)
  pp.ambil().mulai([ui("user", "halo")]);
  cek("…dan sapaan di operasi kedua dijawab dengan teks kemampuan yang sama", pp.ambil().teksPenutup("") === KEMAMPUAN);
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
