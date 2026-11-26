/**
 * Uji lima model permintaan terputus.
 *
 *   npm run test:ramalan-jarang
 *
 * TIDAK menyentuh database. Deretnya ditulis di sini supaya yang merah berarti
 * rumusnya rusak, bukan datanya berubah.
 *
 * ============================================================
 * YANG DIJAGA
 * ============================================================
 * 1. LAJUNYA BENAR. Deret 0,0,120 berulang punya laju 40/bulan. Model yang
 *    memulangkan 0 (seperti Naive) atau 120 dua-duanya salah, dan dua-duanya
 *    terlihat sah. Angka 40 itulah yang membedakan model yang bekerja dari
 *    model yang kebetulan.
 *
 * 2. TIDAK IKUT KALAU TIDAK TERPUTUS. Model-model ini menolak sendiri pada
 *    deret yang hampir selalu terjual. Kalau penjagaan itu lepas, delapan
 *    kandidat bersaing di backtest tiga bulan dan yang menang bisa menang
 *    karena kebetulan — kegagalan yang TIDAK menimbulkan galat apa pun dan
 *    tidak terlihat di layar.
 *
 * 3. TSB MELURUH, CROSTON TIDAK. Untuk produk yang penjualannya baru berhenti
 *    beberapa bulan, Croston menahan laju lamanya tanpa batas waktu. Kalau
 *    TSB ikut menahan, perbedaannya tidak ada dan salah satu dari dua model
 *    ini cuma menambah peluang menang secara kebetulan.
 */
import {
  croston, sba, tsb, adida, imapa, MODEL_JARANG,
  ciriJarang, tolakJarang, tolakAgregasi, emberkan,
  MIN_JARANG, MIN_BULAN_NOL, MIN_PENJUALAN,
} from "../lib/ramalan/jarang.ts";
import { pilihModel } from "../lib/ramalan/pilih.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}
function nilai(h: ReturnType<typeof croston.ramal>): number[] {
  return h.ok ? h.nilai : [];
}

/** 36 bulan, terjual 120 tiap tiga bulan. Laju sebenarnya 40/bulan. */
const TERATUR = Array.from({ length: 36 }, (_, i) => (i % 3 === 0 ? 120 : 0));
/** 36 bulan, selalu terjual, ragamnya sempit. Model di berkas ini tidak boleh ikut. */
const PADAT = Array.from({ length: 36 }, (_, i) => 500 + ((i * 37) % 90));
/** 36 bulan, selalu terjual tapi berayun lebar (CV² ~0,64). Golongan "tak teratur". */
const BERAYUN = Array.from({ length: 36 }, (_, i) => (i % 2 === 0 ? 100 : 900));

// ============================================================
console.log("=== 1. Ciri keterputusan ===");
// ============================================================
{
  const c = ciriJarang(TERATUR);
  cek("ADI deret 3-bulanan = 3", c !== null && Math.abs(c.adi - 3) < 0.01, `${c?.adi.toFixed(2)}`);
  cek("CV² deret berukuran sama = 0", c !== null && c.cv2 < 1e-9, `${c?.cv2}`);
  cek("digolongkan terputus", c?.golongan === "terputus", c?.golongan);
  cek("jumlah bulan nol dihitung", c?.nol === 24, `${c?.nol}`);

  const p = ciriJarang(PADAT);
  cek("deret padat -> ADI 1", p !== null && Math.abs(p.adi - 1) < 0.01, `${p?.adi.toFixed(2)}`);
  cek("deret padat -> halus", p?.golongan === "halus", p?.golongan);

  cek("deret semua nol -> null", ciriJarang(Array(36).fill(0)) === null);

  // Ukuran yang berayun lebar dengan jarak lebar = bergumpal, golongan yang
  // paling sulit diramal dan satu-satunya yang disarankan ke TSB.
  const gumpal = [0, 0, 5, 0, 0, 0, 900, 0, 0, 12, 0, 0, 0, 1500, 0, 0, 30, 0];
  cek("ukuran berayun + jarak lebar -> bergumpal",
    ciriJarang(gumpal)?.golongan === "bergumpal", ciriJarang(gumpal)?.golongan);
}

// ============================================================
console.log("\n=== 2. Penjaga: tidak ikut kalau tidak terputus ===");
// ============================================================
{
  cek("deret padat ditolak", tolakJarang(PADAT) !== null, tolakJarang(PADAT)?.slice(0, 60));
  cek("alasannya menyebut 'tidak terputus'",
    (tolakJarang(PADAT) ?? "").includes("tidak terputus"));
  cek(`deret <${MIN_JARANG} bulan ditolak`, tolakJarang([0, 5, 0, 7, 0]) !== null,
    tolakJarang([0, 5, 0, 7, 0])?.slice(0, 50));
  cek(`<${MIN_PENJUALAN} bulan terjual ditolak`,
    (tolakJarang([0, 0, 0, 0, 0, 0, 0, 90, 0, 0, 0, 70]) ?? "").includes("terlalu sedikit"),
    tolakJarang([0, 0, 0, 0, 0, 0, 0, 90, 0, 0, 0, 70])?.slice(0, 60));
  cek("deret terputus DITERIMA", tolakJarang(TERATUR) === null);
  cek("semua nol ditolak", tolakJarang(Array(36).fill(0)) !== null);

  // ⚠️ Yang dijaga di sini BUKAN satu model, tapi kelimanya. Satu model yang
  // lupa memanggil penjaganya cukup untuk membatalkan gunanya.
  for (const m of MODEL_JARANG) {
    cek(`${m.kode.padEnd(8)} menolak deret padat`, !m.ramal(PADAT, 3).ok,
      (m.ramal(PADAT, 3) as { sebab?: string }).sebab?.slice(0, 40));
  }
}

// ============================================================
console.log("\n=== 2b. Penjaga agregasi: ADIDA/IMAPA ikut di deret berayun ===");
// ============================================================
{
  // ⚠️ INILAH golongan yang sebenarnya jatuh ke rata-rata di data kita:
  // terjual tiap bulan, tapi ragamnya lebar. Diukur 27 Okt 2026 pada 150
  // produk terlaris: 72 halus, 78 tak teratur, dan NOL yang terputus — jadi
  // Croston/SBA/TSB memang tidak menjawab persoalan yang kita punya.
  const c = ciriJarang(BERAYUN);
  cek("deret berayun -> tak teratur", c?.golongan === "tak teratur",
    `ADI ${c?.adi.toFixed(2)} CV² ${c?.cv2.toFixed(2)}`);
  cek("tidak ada bulan nol", c?.nol === 0);

  cek("Croston/SBA/TSB TETAP menolak", tolakJarang(BERAYUN) !== null,
    tolakJarang(BERAYUN)?.slice(0, 44));
  cek("ADIDA/IMAPA diterima", tolakAgregasi(BERAYUN) === null);
  for (const m of MODEL_JARANG) {
    const boleh = m.kode === "adida" || m.kode === "imapa";
    cek(`${m.kode.padEnd(8)} ${boleh ? "ikut" : "tidak ikut"} di deret berayun`,
      m.ramal(BERAYUN, 3).ok === boleh);
  }

  // ⚠️ Kelonggarannya TIDAK berlaku untuk deret yang ragamnya sempit. Kalau
  // berlaku, ADIDA dan IMAPA ikut di hampir semua produk dan penjaga undian
  // kehilangan gunanya sama sekali.
  cek("deret padat ragam sempit tetap ditolak ADIDA/IMAPA",
    tolakAgregasi(PADAT) !== null, tolakAgregasi(PADAT)?.slice(0, 48));
  cek("alasannya menyebut ragamnya", (tolakAgregasi(PADAT) ?? "").includes("CV²"));
  cek("deret terputus tetap diterima ADIDA/IMAPA", tolakAgregasi(TERATUR) === null);
  cek(`deret <${MIN_JARANG} bulan ditolak juga di sini`,
    tolakAgregasi([0, 5, 0, 7, 0]) !== null);
}

// ============================================================
console.log("\n=== 3. Lajunya benar: 0,0,120 berulang -> 40/bulan ===");
// ============================================================
{
  for (const m of MODEL_JARANG) {
    const v = nilai(m.ramal(TERATUR, 3));
    const dekat = v.length === 3 && Math.abs(v[0] - 40) <= 8;
    cek(`${m.kode.padEnd(8)} laju ~40`, dekat, v.join(","));
  }
  // Pembanding: inilah yang dijawab model biasa untuk deret yang sama.
  console.log("         (pembanding: naive menjawab 0,0,0 — lihat test:ramalan-model)");
}

// ============================================================
console.log("\n=== 4. Hasilnya rata, dan itu disengaja ===");
// ============================================================
{
  for (const m of MODEL_JARANG) {
    const v = nilai(m.ramal(TERATUR, 6));
    cek(`${m.kode.padEnd(8)} 6 bulan, satu angka`,
      v.length === 6 && new Set(v).size === 1, v.join(","));
  }
}

// ============================================================
console.log("\n=== 5. Ember ADIDA diratakan DARI UJUNG ===");
// ============================================================
{
  // 8 bulan, ember 3 -> dua ember: bulan 2-4 dan bulan 5-7. Bulan 0-1 dibuang.
  const d = [1, 2, 3, 4, 5, 6, 7, 8];
  const e = emberkan(d, 3);
  cek("dua ember dari 8 bulan", e.length === 2, e.join(","));
  cek("ember terakhir berakhir di bulan terakhir", e[e.length - 1] === 6 + 7 + 8, `${e[e.length - 1]}`);
  // ⚠️ Kalau diratakan dari AWAL, ember terakhirnya cuma berisi 2 bulan (7+8=15)
  // dan terlihat seperti penjualan yang turun — penurunan yang tidak pernah
  // terjadi, cuma akibat embernya belum penuh.
  // Tiap ember berisi TEPAT 3 bulan: jumlah seluruh ember harus sama dengan
  // jumlah 6 bulan terakhir, dan sisa 2 bulan paling awal memang dibuang.
  cek("tidak ada ember separuh terisi",
    e.reduce((a, b) => a + b, 0) === d.slice(d.length - e.length * 3).reduce((a, b) => a + b, 0)
      && e.length * 3 === d.length - (d.length % 3),
    `jumlah ember ${e.reduce((a, b) => a + b, 0)} = jumlah ${e.length * 3} bulan terakhir`);
  cek("ember 1 = deret apa adanya", emberkan(d, 1).join(",") === d.join(","));
  cek("ember lebih panjang dari deret -> kosong", emberkan([1, 2], 5).length === 0);
  // ⚠️ k = 0 dulu membuat perulangannya tidak pernah berhenti. Di permintaan
  // web itu bukan galat, itu halaman yang menggantung selamanya.
  cek("ember 0 -> kosong, bukan menggantung", emberkan([1, 2, 3], 0).length === 0);
  cek("ember negatif -> kosong", emberkan([1, 2, 3], -2).length === 0);
  cek("ember pecahan -> kosong", emberkan([1, 2, 3], 1.5).length === 0);
}

// ============================================================
console.log("\n=== 6. TSB meluruh, Croston tidak ===");
// ============================================================
{
  // 20 bulan terjual 60 tiap dua bulan (laju 30), lalu 5 bulan diam.
  const pola = Array.from({ length: 20 }, (_, i) => (i % 2 === 1 ? 60 : 0));
  const berhenti = [...pola, 0, 0, 0, 0, 0];
  const c = nilai(croston.ramal(berhenti, 3))[0];
  const t = nilai(tsb.ramal(berhenti, 3))[0];
  cek("Croston menahan laju lamanya", c >= 20, `croston ${c}`);
  cek("TSB lebih rendah sesudah 5 bulan diam", t < c, `tsb ${t} < croston ${c}`);

  // Pada deret yang penjualannya TIDAK berhenti, keduanya seharusnya dekat.
  const cc = nilai(croston.ramal(pola, 3))[0];
  const tt = nilai(tsb.ramal(pola, 3))[0];
  cek("tanpa jeda di ujung, keduanya berdekatan", Math.abs(cc - tt) <= Math.max(4, cc * 0.25),
    `croston ${cc} vs tsb ${tt}`);
}

// ============================================================
console.log("\n=== 7. SBA mengoreksi bias Croston ke bawah ===");
// ============================================================
{
  const c = nilai(croston.ramal(TERATUR, 3))[0];
  const s = nilai(sba.ramal(TERATUR, 3))[0];
  // ⚠️ BUKAN jaminan umum: alfa dipilih sendiri-sendiri, jadi secara prinsip
  // SBA bisa memakai alfa yang berbeda dan hasilnya melewati Croston. Yang
  // dijaga di sini cuma arah koreksinya pada deret yang kita tahu bentuknya.
  cek("SBA <= Croston pada deret teratur", s <= c, `sba ${s} <= croston ${c}`);
  cek("SBA tidak menjadi nol", s > 0, `${s}`);
}

// ============================================================
console.log("\n=== 8. Lewat pemilih: ikut bersaing dan bisa menang ===");
// ============================================================
{
  // Deret terputus 30 bulan: ARIMA pun boleh ikut (minimal 26).
  const d = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 100 + (i % 2) * 20 : 0));
  const h = pilihModel(d, 3);
  cek("pemilih menghasilkan jawaban", h.ok, h.ok ? h.terpilih.kode : h.sebab);
  const kode = new Set(h.kandidat.map((k) => k.kode));
  for (const m of MODEL_JARANG) {
    cek(`${m.kode.padEnd(8)} muncul di daftar kandidat`, kode.has(m.kode));
  }
  // ⚠️ DIBEDAKAN: "tidak boleh ikut" vs "ikut lalu kalah". Keduanya muncul
  // sebagai `ditolak` di daftar kandidat, tapi artinya berlawanan — yang
  // pertama berarti penjaganya bekerja, yang kedua berarti modelnya memang
  // kurang tepat di deret ini. Kalau uji ini cuma memeriksa `ditolak`, kedua
  // keadaan itu tidak terbedakan dan penjaganya bisa lepas tanpa terlihat.
  const jarangKandidat = h.kandidat.filter((k) => MODEL_JARANG.some((m) => m.kode === k.kode));
  cek("tidak ada yang ditolak karena dianggap tidak terputus",
    jarangKandidat.every((k) => !(k.ditolak ?? "").includes("tidak terputus")),
    jarangKandidat.map((k) => k.kode + (k.ditolak ? ":tolak" : ":ikut")).join(" "));

  // ⚠️ PENEMUAN 27 Okt 2026, dan ini BUKAN bug — dipaku di sini supaya tidak
  // ada yang "memperbaikinya" nanti.
  //
  // Deret ini terjual TEPAT tiap tiga bulan. Jendela uji tiga bulan terakhirnya
  // berisi 100, 0, 0. Ramalan rata 40,40,40 mencetak galat 60+40+40 = 140 atas
  // penyebut 100 — WAPE 140%, jadi ditolak `WAPE_TAK_BERGUNA` sebagai "lebih
  // buruk daripada menebak tidak ada penjualan".
  //
  // Lajunya BENAR (40/bulan, dan setahun memang terjual 480), tapi untuk deret
  // yang waktunya setepat ini, Musiman memang jawaban yang lebih baik — dia
  // tahu bulan MANA. Yang diukur WAPE per bulan adalah ketepatan waktu, dan
  // model rata dengan sengaja tidak menebak waktu.
  cek("di deret yang waktunya tepat, Musiman menang",
    h.ok && h.terpilih.kode === "musiman", h.ok ? h.terpilih.kode : "-");
  cek("model rata ditolak karena ketepatan, bukan karena kelayakan",
    jarangKandidat.every((k) => !k.ditolak || k.ditolak.includes("meleset")),
    jarangKandidat.map((k) => (k.ditolak ?? "ikut").slice(0, 18)).join(" | "));
  if (h.ok) {
    console.log(`         terpilih: ${h.terpilih.kode} (${h.terpilih.wape?.toFixed(1)}%)`);
    console.log(`         semua: ${h.kandidat.map((k) =>
      `${k.kode}=${k.ditolak ? "tolak" : k.wape === null ? "-" : k.wape.toFixed(0) + "%"}`).join(" ")}`);
  }

  // ⚠️ Dan pada deret PADAT, kelimanya harus ditolak oleh pemilih — bukan
  // sekadar kalah. Kalah berarti mereka ikut diundi.
  const hp = pilihModel(PADAT, 3);
  const jarangDiPadat = hp.kandidat.filter(
    (k) => MODEL_JARANG.some((m) => m.kode === k.kode));
  cek("di deret padat, kelimanya ditolak pemilih",
    jarangDiPadat.length === MODEL_JARANG.length && jarangDiPadat.every((k) => !!k.ditolak),
    `${jarangDiPadat.filter((k) => k.ditolak).length}/${jarangDiPadat.length} ditolak`);
  cek("di deret padat yang menang tetap model biasa",
    hp.ok && !MODEL_JARANG.some((m) => m.kode === hp.terpilih.kode),
    hp.ok ? hp.terpilih.kode : hp.sebab);
}

// ============================================================
console.log("\n=== 9. Deret aneh tidak pernah menghasilkan angka tak sah ===");
// ============================================================
{
  const aneh: [string, number[]][] = [
    ["semua nol", Array(36).fill(0)],
    ["satu lonjakan saja", [...Array(35).fill(0), 9999]],
    ["nol di ujung saja", [...Array(30).fill(50), 0, 0, 0, 0, 0, 0]],
    ["terjual sekali lalu diam", [0, 0, 700, ...Array(30).fill(0)]],
    [`tepat ${MIN_BULAN_NOL} bulan nol`, [0, 0, ...Array(34).fill(80)]],
  ];
  for (const [nama, d] of aneh) {
    for (const m of MODEL_JARANG) {
      const h = m.ramal(d, 3);
      const aman = h.ok
        ? h.nilai.length === 3 && h.nilai.every((v) => Number.isInteger(v) && v >= 0)
        : typeof h.sebab === "string" && h.sebab.length > 0;
      cek(`${nama.padEnd(26)} ${m.kode.padEnd(8)} ${h.ok ? "berhasil" : "mengaku gagal"}`,
        aman, h.ok ? h.nilai.join(",") : h.sebab.slice(0, 36));
    }
  }
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
