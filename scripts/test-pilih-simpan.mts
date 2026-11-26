/**
 * Tombol pilih produk tetap ada sesudah percakapan dibuka ulang.
 *
 *   npm run test:pilih-simpan
 *
 * PRASYARAT: server hidup di localhost:3000. TIDAK memanggil model bahasa, jadi
 * tidak memakai kuota. Percakapan uji dihapus lagi di akhir.
 *
 * Lewat HTTP karena yang hilang 3 Nov 2026 justru rantainya: simpan, baca
 * ulang, lalu tampil. Memanggil fungsinya satu per satu tidak membuktikan itu.
 */
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { usernamePortal } from "../lib/akun-perusahaan.ts";
import { cariPengguna } from "../lib/pengguna.ts";
import { buatPercakapan, hapusPercakapan } from "../lib/percakapan.ts";
import { bacaKlarifikasi, bersihkanKlarifikasi } from "../lib/cocok-pilihan.ts";
import { buatToken, NAMA_COOKIE } from "../lib/sesi.ts";

const BASE = process.env.UJI_BASE ?? "http://localhost:3000";
let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const DAFTAR = {
  pesan: "Ada 2 produk. Yang mana?",
  alat: "cari_tren_pasar",
  pilihan: [
    { kode: "1005998", nama: "MINYAK CEMCEMAN    175 ML RJ", riwayat_bulan: 86, data_terakhir: "2026-07" },
    { kode: "1006732", nama: "MINYAK CEMCEMAN 175 ML RJ NF", riwayat_bulan: 28, data_terakhir: "2026-07" },
  ],
};

console.log("=== 1. Bentuk daftar diperiksa ===");
cek("daftar sah diterima", bersihkanKlarifikasi(DAFTAR)?.pilihan.length === 2);
cek("bukan objek ditolak", bersihkanKlarifikasi("x") === null && bersihkanKlarifikasi(null) === null);
cek("satu pilihan ditolak", bersihkanKlarifikasi({ pilihan: [DAFTAR.pilihan[0]] }) === null);
cek("baris tanpa nama membatalkan seluruh daftar",
  bersihkanKlarifikasi({ pilihan: [DAFTAR.pilihan[0], { kode: "2" }] }) === null);
cek("daftar raksasa ditolak", bersihkanKlarifikasi({
  pilihan: Array.from({ length: 21 }, (_, i) => ({ kode: String(i), nama: `P${i}` })),
}) === null);
cek("nama terlalu panjang ditolak",
  bersihkanKlarifikasi({ pilihan: [DAFTAR.pilihan[0], { kode: "2", nama: "x".repeat(201) }] }) === null);
cek("kunci asing dibuang", !("skrip" in (bersihkanKlarifikasi({
  pilihan: [{ ...DAFTAR.pilihan[0], skrip: "x" }, DAFTAR.pilihan[1]],
})?.pilihan[0] ?? {})));
cek("JSON rusak dari database tidak melempar", bacaKlarifikasi("{rusak") === null);
cek("kolom kosong berarti tidak ada", bacaKlarifikasi(null) === null);

const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
    WHERE lower(u.username) = 'ridho@mustika-ratu.co.id' LIMIT 1`);
const idEmployee = rows[0].id_employee;
const p = await cariPengguna(usernamePortal(idEmployee));
if (!p) throw new Error("akun uji belum punya baris pengguna");
const kue = `${NAMA_COOKIE}=${await buatToken({
  id: p.id, username: p.username, nama: p.nama, departemen: p.departemen, peran: p.peran, idEmployee, admin: false,
})}`;

const id = await buatPercakapan(p.id, p.departemen, "UJI OTOMATIS tombol pilih produk");
try {
  console.log("\n=== 2. Simpan lalu buka ulang lewat HTTP ===");
  const kirim = (isi: unknown) => fetch(`${BASE}/api/percakapan/${id}/pesan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kue },
    body: JSON.stringify(isi),
  });
  const a = await kirim({ teks: "Yang mana?", model: "llama.cpp/gemma-4-12b-it-q8", klarifikasi: DAFTAR });
  const b = await kirim({ teks: "Jawaban biasa", model: "llama.cpp/gemma-4-12b-it-q8" });
  const c = await kirim({ teks: "Daftar palsu", model: "llama.cpp/gemma-4-12b-it-q8", klarifikasi: { pilihan: "bukan daftar" } });
  cek("ketiganya tersimpan", a.ok && b.ok && c.ok, `${a.status}/${b.status}/${c.status}`);

  const r = await fetch(`${BASE}/api/percakapan/${id}`, { headers: { Cookie: kue } });
  const { pesan } = (await r.json()) as { pesan: { teks: string; klarifikasi: string | null }[] };
  cek("ketiganya terbaca ulang", pesan.length === 3, `${pesan.length} pesan`);

  const k = bacaKlarifikasi(pesan[0]?.klarifikasi);
  cek("daftar pilihan kembali utuh", k?.pilihan.length === 2, `${k?.pilihan.length ?? 0} pilihan`);
  cek("nama, kode, dan riwayat sama persis",
    JSON.stringify(k?.pilihan) === JSON.stringify(DAFTAR.pilihan));
  cek("alat yang bertanya ikut tersimpan", k?.alat === "cari_tren_pasar", String(k?.alat));
  cek("alat yang tidak dikenal dibuang",
    bersihkanKlarifikasi({ ...DAFTAR, alat: "hapus_semua" })?.alat === undefined);
  cek("jawaban biasa tidak membawa daftar", bacaKlarifikasi(pesan[1]?.klarifikasi) === null);
  cek("daftar rusak dari browser tidak tersimpan", pesan[2]?.klarifikasi === null);

  const asing = await fetch(`${BASE}/api/percakapan/${id}`, { redirect: "manual" });
  cek("tanpa login tidak bisa membaca", asing.status === 401 || asing.status === 307, String(asing.status));
} finally {
  await hapusPercakapan(id, p.id);
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.exit(gagal > 0 ? 1 : 0);
}
