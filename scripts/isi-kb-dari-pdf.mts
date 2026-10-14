/**
 * Membangun ulang basis pengetahuan DARI PDF.
 *
 *   npm run pasang:kb-pdf
 *   npm run pasang:kb-pdf -- --hapus      (bersihkan berkas + potongan)
 *
 * PRASYARAT: `npm run pasang:kb` sudah pernah dijalankan (dokumennya ada),
 * dan `db/demo-pg/05_kb_berkas.sql` sudah dipasang.
 *
 * ============================================================
 * ⚠️ URUTANNYA ADALAH INTINYA, BUKAN DETAIL
 * ============================================================
 *
 *   teks dokumen -> GAMBAR PDF -> simpan berkas -> BACA BALIK dari berkas
 *   -> potong -> embed -> simpan
 *
 * Yang disimpan sebagai `teks` potongan dan yang dihitung jadi vektor adalah
 * hasil BACA BALIK, bukan teks sumbernya. Syarat dari pemilik proyek
 * (1 Okt 2026): "pastikan data yang di store di database merupakan hasil pdf
 * yang sudah di vector".
 *
 * Itu bukan formalitas. Nomor baris yang kita simpan dipakai user untuk
 * membuka PDF dan memeriksa sendiri. Kalau potongannya dihitung dari teks
 * sumber sementara user membaca PDF, dua-duanya bisa bergeser tanpa ada yang
 * tahu -- dan rujukan yang meleset lebih berbahaya daripada tidak ada
 * rujukan, karena user percaya begitu saja.
 *
 * ============================================================
 * ⚠️ JUDUL TIDAK LAGI DISEMATKAN DI TIAP POTONGAN
 * ============================================================
 * Versi lama (`isi-kb-contoh.mts`) menempelkan judul dokumen di depan tiap
 * potongan supaya potongan pendek punya konteks. Itu tidak bisa diteruskan di
 * sini: teks yang disimpan harus bisa dicocokkan kata-per-kata dengan isi PDF,
 * dan judul tempelan tidak ada di PDF-nya.
 *
 * Dampaknya ke mutu pencarian DIUKUR, bukan ditebak -- `npm run test:kb` dan
 * `npm run test:kb-beda` punya angka pembanding sebelum perubahan ini
 * (12/12 dan 9/10).
 */
import { createHash } from "node:crypto";
import { Client } from "pg";
import { buatPdf, bacaPdfPerHalaman, type BarisPdf } from "../lib/kb/pdf.ts";
import { teksUntukVektor } from "../lib/kb/cari.ts";
import { embed, awalanPassage, DIMENSI, MODEL_EMBEDDING } from "../voltagent/embedding.ts";

/**
 * Panjang minimum satu potongan.
 *
 * Sama dengan versi lama supaya hasilnya bisa dibandingkan. Potongan sependek
 * satu kalimat hampir selalu kalah di pencarian karena konteksnya terlalu
 * sedikit.
 */
const MIN_POTONGAN = 220;

type Potongan = {
  teks: string;
  halaman: number;
  barisAwal: number;
  barisAkhir: number;
};

/**
 * Kelompokkan baris hasil BACA BALIK jadi potongan.
 *
 * Batas paragraf diambil dari `tataLetak` (direkam saat menggambar), karena
 * baris kosong antar-paragraf TIDAK ikut terbaca waktu PDF diekstrak. Tanpa
 * itu, potongan akan terpotong di tengah kalimat.
 *
 * ⚠️ Potongan TIDAK PERNAH melintasi halaman. Kalau melintas, rujukan
 * "halaman sekian" jadi ambigu -- dan ambigu di sini artinya user membuka
 * halaman yang salah.
 */
function potongPerHalaman(baris: { halaman: number; baris: number; teks: string; paragraf: number }[]): Potongan[] {
  const hasil: Potongan[] = [];
  let buf: typeof baris = [];

  const tutup = () => {
    if (buf.length === 0) return;
    hasil.push({
      teks: buf.map((b) => b.teks).join("\n"),
      halaman: buf[0].halaman,
      barisAwal: buf[0].baris,
      barisAkhir: buf[buf.length - 1].baris,
    });
    buf = [];
  };

  for (let i = 0; i < baris.length; i++) {
    const b = baris[i];
    const sebelum = buf[buf.length - 1];

    // Ganti halaman -> tutup paksa, apa pun panjangnya.
    if (sebelum && sebelum.halaman !== b.halaman) tutup();

    buf.push(b);

    const panjang = buf.reduce((n, x) => n + x.teks.length + 1, 0);
    const berikut = baris[i + 1];
    const batasParagraf = !berikut || berikut.paragraf !== b.paragraf;

    if (panjang >= MIN_POTONGAN && batasParagraf) tutup();
  }
  tutup();

  // Sisa pendek di akhir digabung ke potongan sebelumnya -- SELAMA masih satu
  // halaman. Kalau beda halaman, dibiarkan pendek; rujukan yang benar lebih
  // penting daripada potongan yang rata panjangnya.
  if (hasil.length >= 2) {
    const akhir = hasil[hasil.length - 1];
    const sebelum = hasil[hasil.length - 2];
    if (akhir.teks.length < MIN_POTONGAN / 2 && akhir.halaman === sebelum.halaman) {
      sebelum.teks = `${sebelum.teks}\n${akhir.teks}`;
      sebelum.barisAkhir = akhir.barisAkhir;
      hasil.pop();
    }
  }
  return hasil;
}

// ============================================================
const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  statement_timeout: 120_000,
});
await c.connect();

if (process.argv.includes("--hapus")) {
  const b = await c.query("DELETE FROM ai_kb_berkas");
  const p = await c.query(
    "UPDATE ai_kb_potongan SET halaman = NULL, baris_awal = NULL, baris_akhir = NULL",
  );
  console.log(`${b.rowCount} berkas dihapus, ${p.rowCount} potongan dilepas rujukannya.`);
  console.log("Potongan & vektornya TIDAK dihapus — jalankan `npm run pasang:kb -- --hapus` untuk itu.");
  await c.end();
  process.exitCode = 0;
} else {
  console.log(`model embedding: ${MODEL_EMBEDDING} (${DIMENSI} dimensi)\n`);

  const dok = await c.query(
    "SELECT id_dokumen, kode, judul, isi FROM ai_kb_dokumen ORDER BY kode",
  );
  if (dok.rows.length === 0) {
    console.error("Tidak ada dokumen. Jalankan `npm run pasang:kb` dulu.");
    await c.end();
    process.exitCode = 1;
  } else {
    let totalPotongan = 0;
    let totalHalaman = 0;

    for (const d of dok.rows as { id_dokumen: string; kode: string; judul: string; isi: string }[]) {
      // 1. Gambar PDF, sambil merekam letak tiap baris.
      const { bita, tataLetak } = await buatPdf(d.judul, d.isi);
      const sha = createHash("sha256").update(bita).digest("hex");

      // 2. Baca BALIK dari berkas itu juga.
      const perHalaman = await bacaPdfPerHalaman(bita);
      const terbaca = perHalaman.flatMap((t, i) =>
        t
          .split("\n")
          .filter((x) => x.trim() !== "")
          .map((teks) => ({ halaman: i + 1, teks })),
      );

      // 3. ⚠️ GAGAL-TERTUTUP. Kalau yang terbaca tidak sama persis dengan yang
      //    digambar, seluruh dasar rujukan baris runtuh -- lebih baik berhenti
      //    daripada menyimpan nomor baris yang menunjuk ke tempat lain.
      if (terbaca.length !== tataLetak.length) {
        console.error(
          `GAGAL ${d.kode}: digambar ${tataLetak.length} baris, terbaca ${terbaca.length}. ` +
            "Rujukan baris tidak bisa dijamin. Dihentikan.",
        );
        await c.end();
        process.exitCode = 1;
        break;
      }
      const beda = tataLetak.findIndex(
        (x: BarisPdf, i: number) =>
          x.teks.trim() !== terbaca[i].teks.trim() || x.halaman !== terbaca[i].halaman,
      );
      if (beda !== -1) {
        console.error(
          `GAGAL ${d.kode}: baris ${beda + 1} berbeda antara yang digambar dan yang dibaca.\n` +
            `  gambar: ${tataLetak[beda].teks}\n  baca  : ${terbaca[beda].teks}`,
        );
        await c.end();
        process.exitCode = 1;
        break;
      }

      // 4. Potong dari teks HASIL BACA BALIK, strukturnya dari tataLetak.
      const gabung = terbaca.map((t, i) => ({
        halaman: t.halaman,
        baris: tataLetak[i].baris,
        teks: t.teks,
        paragraf: tataLetak[i].paragraf,
      }));
      const potongan = potongPerHalaman(gabung);

      // 5. Embed. ATURANNYA DITULIS SEKALI DI SINI DAN DIUJI DI
      //    `uji-kb-berkas.mts`:
      //
      //        vektor = embed("passage: " + judul + newline + teks)
      //        teks   = baris PDF apa adanya
      //
      //    Judul ikut sebagai KONTEKS, bukan sebagai isi. Tanpa itu `test:kb`
      //    turun 12/12 -> 9/12, dan ketiga yang meleset adalah dokumen yang
      //    badan teksnya mirip dan cuma judulnya yang membedakan.
      //
      //    Judulnya sendiri ADA di PDF (digambar sebagai baris pertama), jadi
      //    ini mengulang kepala dokumennya sendiri -- bukan menyuntikkan
      //    keterangan dari luar berkas.
      const vektor = await embed(
        potongan.map((p) => awalanPassage(teksUntukVektor(d.judul, p.teks))),
      );

      // 6. Simpan. Potongan lama dibuang seluruhnya -- yang lama berasal dari
      //    teks mentah dan tidak punya rujukan halaman.
      await c.query("BEGIN");
      try {
        await c.query("DELETE FROM ai_kb_potongan WHERE id_dokumen = $1", [d.id_dokumen]);
        for (let i = 0; i < potongan.length; i++) {
          const p = potongan[i];
          await c.query(
            `INSERT INTO ai_kb_potongan
               (id_dokumen, urutan, teks, vektor, halaman, baris_awal, baris_akhir)
             VALUES ($1, $2, $3, $4::vector, $5, $6, $7)`,
            [d.id_dokumen, i, p.teks, `[${vektor[i].join(",")}]`, p.halaman, p.barisAwal, p.barisAkhir],
          );
        }
        await c.query(
          `INSERT INTO ai_kb_berkas (id_dokumen, nama_berkas, jenis, bita, sha256, halaman)
           VALUES ($1, $2, 'application/pdf', $3, $4, $5)
           ON CONFLICT (id_dokumen) DO UPDATE
             SET nama_berkas = EXCLUDED.nama_berkas, bita = EXCLUDED.bita,
                 sha256 = EXCLUDED.sha256, halaman = EXCLUDED.halaman, dibuat = now()`,
          [d.id_dokumen, `${d.kode}.pdf`, Buffer.from(bita), sha, perHalaman.length],
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }

      totalPotongan += potongan.length;
      totalHalaman += perHalaman.length;
      console.log(
        `  ${d.kode.padEnd(13)} ${String(Math.round(bita.length / 1024)).padStart(2)} KB · ` +
          `${perHalaman.length} hal · ${String(potongan.length).padStart(2)} potongan · ` +
          `baris ${potongan[0]?.barisAwal}-${potongan[potongan.length - 1]?.barisAkhir}`,
      );
    }

    if (process.exitCode !== 1) {
      console.log(
        `\n${dok.rows.length} dokumen, ${totalHalaman} halaman, ${totalPotongan} potongan — ` +
          "semuanya dari teks yang dibaca balik dari PDF.",
      );
      console.log("Periksa dengan: npm run uji:kb-berkas");
    }
    await c.end();
  }
}
