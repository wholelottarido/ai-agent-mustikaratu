/**
 * Tahap 6 (F.8) dengan DATA SUNGGUHAN — HANYA MEMBACA (SELECT setelan & tabel pilihan).
 *   npm run test:pilihan-tiket
 *
 * Tidak menyusun apa pun ke `portal_ticket` (jumlah barisnya diperiksa sebelum & sesudah).
 * Yang dibuktikan: sub-kategori yang dikosongkan memulangkan daftar SAH dari database (bukan karangan),
 * daftar itu bisa jadi tombol, dan jawaban dari tombol ("Label (kode X)") dikenali.
 */
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { susunDraf, masalahJadiTeks } from "../lib/entri/tiket.ts";
import { cocokkan } from "../lib/entri/pilihan.ts";
import { teksPilihan } from "../lib/cocok-pilihan.ts";
import { klarifikasiTulis } from "../voltagent/registry-tulis.ts";

let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };
const p = poolPerusahaan();
const hitung = async () => (await p.query<{ n: number }>("SELECT count(*)::int n FROM portal_ticket")).rows[0].n;
const sebelum = await hitung();
const [kar] = (await p.query<{ id_employee: string }>("SELECT id_employee FROM employee WHERE is_active = true LIMIT 1")).rows;

const dasar = { kategori: "HARDWARE", judul: "Printer tidak mencetak", deskripsi: "Printer menyala tapi dokumen tidak keluar." };

const kosong = await susunDraf(kar.id_employee, { ...dasar, subKategori: "" });
const m = !kosong.ok ? kosong.masalah.find((x) => x.jenis === "kurang" && "kolom" in x && x.kolom === "id_sub_category") : undefined;
const pilihan = m && "pilihan" in m ? m.pilihan ?? [] : [];
cek("sub-kategori kosong → 'kurang' + daftar sub-kategori SAH dari database", !kosong.ok && pilihan.length > 0, `${pilihan.length} pilihan: ${pilihan.slice(0, 5).map((x) => x.label).join(", ")}…`);
cek("pesan ke model menyebut pilihannya", !kosong.ok && masalahJadiTeks(kosong.masalah).includes("Pilihannya:"));
const kl = !kosong.ok ? klarifikasiTulis({ status: "perlu-perbaikan", masalah: kosong.masalah }) : undefined;
cek("daftar itu menjadi tombol klarifikasi (2–20 pilihan)", pilihan.length > 20 ? !kl : (pilihan.length >= 2 ? kl?.pilihan.length === pilihan.length : true),
  kl ? `${kl.pilihan.length} tombol` : `tidak ada tombol (${pilihan.length} pilihan)`);

if (pilihan.length) {
  const pertama = pilihan[0];
  const tombol = teksPilihan({ kode: pertama.nilai, nama: pertama.label });
  const c = cocokkan(tombol, pilihan);
  cek(`jawaban tombol "${tombol}" dikenali sebagai pilihan yang tepat`, !Array.isArray(c) && c.nilai === pertama.nilai);
  const lewat = await susunDraf(kar.id_employee, { ...dasar, subKategori: tombol });
  cek("rancangan tersusun dari jawaban tombol", lewat.ok && lewat.draf.subKategori.id === pertama.nilai);
  const ngawur = cocokkan("Bukan Pilihan (kode 999999999)", pilihan);
  cek("kode tidak dikenal TIDAK dipilihkan (dikembalikan sebagai daftar)", Array.isArray(ngawur));
}
const kat = await susunDraf(kar.id_employee, { ...dasar, kategori: "", subKategori: "" });
const mk = !kat.ok ? kat.masalah.find((x) => x.jenis === "kurang" && "kolom" in x && x.kolom === "id_category") : undefined;
cek("kategori kosong → daftar kategori SAH dari database", !!mk && "pilihan" in mk && (mk.pilihan?.length ?? 0) > 0);

cek("tidak ada baris baru di portal_ticket", (await hitung()) === sebelum);
await p.end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
