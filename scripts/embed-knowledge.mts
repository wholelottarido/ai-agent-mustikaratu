/**
 * Mengisi vektor untuk `ai_knowledge.chunks` di database perusahaan.
 *
 *   npm run embed:knowledge -- --kering    lihat dulu, TIDAK menulis apa pun
 *   npm run embed:knowledge                jalankan sungguhan
 *
 * ============================================================
 * ⚠️ MENULIS KE SCHEMA MILIK TIM LAIN
 * ============================================================
 * `ai_knowledge` dibangun tim lain dan SEDANG aktif diubah -- pada 2 Okt 2026
 * kolomnya bertambah dari 7 jadi 15 dalam hitungan jam, dan ada unggahan baru
 * masuk sementara kita memeriksanya.
 *
 * Karena itu skrip ini menahan diri di tiga tempat:
 *
 *   1. HANYA menyentuh baris yang `embedding IS NULL`. Baris yang sudah
 *      berisi tidak pernah ditimpa, jadi aman dijalankan berulang kali dan
 *      aman kalau ada unggahan baru masuk di tengah jalan.
 *   2. TIDAK MENGUBAH `documents.status`. Itu mesin-keadaan milik mereka;
 *      ada indeks `documents_status_idx`, jadi aplikasi mereka menyaring
 *      dengan kolom itu. Menulis nilai yang tidak mereka kenal akan membuat
 *      53 dokumen hilang dari aplikasi mereka TANPA galat apa pun.
 *      `embed_model` + `embedded_at` sudah cukup mencatat pekerjaan ini.
 *   3. UPDATE per baris, bukan satu perintah untuk seluruh tabel -- supaya
 *      baris yang masuk sesudah kita membaca tidak ikut tersentuh.
 *
 * ============================================================
 * ⚠️ NAMA MODEL YANG DICATAT BERBEDA DARI YANG ADA DI KODE
 * ============================================================
 * Kode kita memakai `Xenova/multilingual-e5-base` -- awalan `Xenova/` itu
 * nama pengemas untuk JavaScript, bukan nama modelnya. Yang dicatat ke
 * database `multilingual-e5-base`, sesuai kesepakatan 2 Okt 2026.
 *
 * Kalau suatu saat ada yang membandingkan dua nama itu lalu bingung: mereka
 * model yang sama.
 */
import pg from "pg";
import { embed, awalanPassage, MODEL_EMBEDDING, LABEL_MODEL_EMBEDDING, DIMENSI } from "../voltagent/embedding.ts";

/**
 * Nama yang dicatat ke `embed_model` -- HARUS sama dengan pola milik tim lain
 * ("multilingual-e5-base@q8"), bukan pola kita. Lihat
 * `LABEL_MODEL_EMBEDDING` di voltagent/embedding.ts.
 */
const NAMA_MODEL = LABEL_MODEL_EMBEDDING;

/** Diisi ke `processing_logs.actor` supaya jejaknya bisa ditelusuri. */
const PELAKU = "embed-portal-magang";

const KERING = process.argv.includes("--kering");

const c = new pg.Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  // ⚠️ Akun admin, bukan `ai_readonly` -- yang itu tidak punya USAGE di
  // schema `ai_knowledge` sama sekali.
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  statement_timeout: 120_000,
});
await c.connect();

console.log(`database : ${process.env.DEMO_PG_DATABASE}`);
console.log(`model    : ${MODEL_EMBEDDING} (${DIMENSI} dimensi)`);
console.log(`dicatat  : "${NAMA_MODEL}"`);
console.log(KERING ? "mode     : KERING — tidak menulis apa pun\n" : "mode     : MENULIS\n");

// ============================================================
// 1. Dimensi kolom harus cocok dengan model. Diperiksa SEBELUM apa pun.
// ============================================================
// Kalau tidak cocok, tiap UPDATE akan ditolak satu per satu -- 90 galat
// yang membingungkan, padahal sebabnya satu. Lebih baik berhenti di sini.
const tipe = await c.query(
  `SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
    WHERE attrelid = 'ai_knowledge.chunks'::regclass AND attname = 'embedding'`,
);
const tipeKolom = (tipe.rows[0] as { t: string } | undefined)?.t ?? "(tidak ada)";
console.log(`kolom embedding bertipe: ${tipeKolom}`);

if (tipeKolom !== `vector(${DIMENSI})`) {
  console.error(
    `\n⛔ DIHENTIKAN. Kolomnya ${tipeKolom}, model kita ${DIMENSI} dimensi.\n` +
      `   Kalau kolomnya masih \`vector\` tanpa dimensi, patok dulu:\n` +
      `   ALTER TABLE ai_knowledge.chunks ALTER COLUMN embedding TYPE vector(${DIMENSI});`,
  );
  await c.end();
  process.exitCode = 1;
} else {
  // ============================================================
  // 2. Ambil yang belum punya vektor.
  // ============================================================
  const antre = await c.query(
    `SELECT c.id_chunk, c.id_document, c.content, d.title
       FROM ai_knowledge.chunks c
       JOIN ai_knowledge.documents d USING (id_document)
      WHERE c.embedding IS NULL
      ORDER BY c.id_chunk`,
  );
  type Baris = { id_chunk: string; id_document: string; content: string; title: string };
  const baris = antre.rows as Baris[];

  const sudah = await c.query(
    "SELECT COUNT(*)::int n FROM ai_knowledge.chunks WHERE embedding IS NOT NULL",
  );
  console.log(
    `antrean  : ${baris.length} potongan belum punya vektor ` +
      `(${(sudah.rows[0] as { n: number }).n} sudah ada)\n`,
  );

  if (baris.length === 0) {
    console.log("Tidak ada yang perlu dikerjakan.");
    await c.end();
    process.exitCode = 0;
  } else {
    const kosong = baris.filter((b) => b.content.trim() === "").length;
    if (kosong > 0) console.log(`⚠️ ${kosong} potongan isinya kosong, dilewati.\n`);

    const mulai = Date.now();
    let selesai = 0;
    let gagal = 0;
    const dokTersentuh = new Set<string>();

    for (const b of baris) {
      if (b.content.trim() === "") continue;

      // ⚠️ Awalan `passage:` WAJIB untuk keluarga e5. Tanpa itu mutu
      // pencarian turun jauh dan TIDAK ADA GEJALANYA -- vektornya tetap
      // terbentuk, cuma hasil pencariannya lebih buruk tanpa ada yang tahu.
      const [v] = await embed([awalanPassage(b.content)]);

      if (v.length !== DIMENSI) {
        console.error(`  GAGAL id_chunk=${b.id_chunk}: dapat ${v.length} dimensi`);
        gagal++;
        continue;
      }

      if (!KERING) {
        // Tanpa transaksi besar: tiap baris berdiri sendiri, jadi kalau
        // prosesnya mati di tengah (laptop ini sering kehabisan memori),
        // yang sudah selesai tetap tersimpan dan tinggal dijalankan lagi.
        await c.query(
          `UPDATE ai_knowledge.chunks
              SET embedding = $2::vector, embed_model = $3, embedded_at = now()
            WHERE id_chunk = $1 AND embedding IS NULL`,
          [b.id_chunk, `[${v.join(",")}]`, NAMA_MODEL],
        );
      }

      dokTersentuh.add(b.id_document);
      selesai++;
      if (selesai % 20 === 0 || selesai === baris.length) {
        const detik = ((Date.now() - mulai) / 1000).toFixed(1);
        console.log(`  ${selesai}/${baris.length} potongan · ${detik} dtk`);
      }
    }

    // ============================================================
    // 3. Catat di `documents` — HANYA yang seluruh potongannya sudah selesai.
    // ============================================================
    // Dokumen yang baru separuh jadi tidak boleh mengaku sudah di-embed.
    let dokSelesai = 0;
    if (!KERING) {
      for (const id of dokTersentuh) {
        const sisa = await c.query(
          "SELECT COUNT(*)::int n FROM ai_knowledge.chunks WHERE id_document = $1 AND embedding IS NULL",
          [id],
        );
        if ((sisa.rows[0] as { n: number }).n > 0) continue;

        const n = await c.query(
          "SELECT COUNT(*)::int n FROM ai_knowledge.chunks WHERE id_document = $1",
          [id],
        );
        const jumlah = (n.rows[0] as { n: number }).n;

        // ⚠️ `status` SENGAJA tidak ikut di-SET. Lihat alasannya di atas.
        await c.query(
          `UPDATE ai_knowledge.documents
              SET embed_model = $2, embedded_at = now(), updated_at = now()
            WHERE id_document = $1`,
          [id, NAMA_MODEL],
        );
        await c.query(
          `INSERT INTO ai_knowledge.processing_logs (id_document, kind, status, message, actor, created_at)
           VALUES ($1, 'embed', 'success', $2, $3, now())`,
          [id, `${jumlah} potongan · ${NAMA_MODEL}`, PELAKU],
        );
        dokSelesai++;
      }
    }

    const detik = ((Date.now() - mulai) / 1000).toFixed(1);
    console.log(`\n${"=".repeat(56)}`);
    console.log(`  ${selesai} potongan diproses dalam ${detik} detik`);
    if (gagal > 0) console.log(`  ${gagal} gagal`);
    if (KERING) {
      console.log(`  MODE KERING — tidak ada yang ditulis ke database.`);
      console.log(`  Yang AKAN ditulis: embedding, embed_model, embedded_at`);
      console.log(`  pada ${selesai} baris chunks, dan catatan di ${dokTersentuh.size} dokumen.`);
      console.log(`  documents.status TIDAK akan diubah.`);
    } else {
      console.log(`  ${dokSelesai} dokumen dicatat selesai (dari ${dokTersentuh.size} tersentuh)`);
    }
    console.log("=".repeat(56));
    console.log("\nPeriksa: npm run embed:knowledge -- --kering  (harusnya 0 antrean)");

    await c.end();
    process.exitCode = gagal === 0 ? 0 : 1;
  }
}
