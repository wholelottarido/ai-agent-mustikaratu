/**
 * Uji penyaringan dokumen per departemen di `ai_knowledge`.
 *
 *   npm run test:akses
 *   npm run test:akses -- --agent    (+ uji apakah agent membocorkan keberadaannya)
 *
 * ⚠️ MENULIS SEMENTARA KE SCHEMA MILIK TIM LAIN.
 *
 * Untuk menguji penyaringnya, satu dokumen harus benar-benar bertanda. Yang
 * dipakai dokumen DUMMY milik mereka sendiri (`Absensi-Dummy-*`), tandanya
 * dipasang di awal dan DIBUANG di `finally` -- termasuk kalau ujinya gagal
 * atau dihentikan di tengah.
 *
 * Tabel `ai_kb_*` kita pernah dihapus pihak lain tanpa pemberitahuan (2 Okt).
 * Kita tidak boleh melakukan hal setara: meninggalkan data uji di schema
 * mereka. Karena itu pembersihannya dipaksa, lalu diperiksa ulang di akhir.
 *
 * ============================================================
 * KENAPA UJI INI ADA
 * ============================================================
 * `cariSop` dan `daftarSop` sudah menyaring
 * `(access_menus IS NULL OR access_menus = $n)`, dan `agents.ts` meneruskan
 * `dep.id`. Tapi tidak ada satu pun uji yang menjaganya.
 *
 * Satu `WHERE` yang hilang waktu refactor tidak menimbulkan galat apa pun --
 * yang terjadi cuma orang IT mulai menemukan dokumen penjualan marketing,
 * dan tidak ada yang menyadarinya sampai ada yang mengeluh.
 */
import pg from "pg";
import { cariSop, daftarSop } from "../lib/kb/cari.ts";

const UJI_AGENT = process.argv.includes("--agent");

/** Dokumen dummy milik mereka; isinya data absensi karangan, bukan data nyata. */
const JUDUL_UJI = "Absensi-Dummy-Scan-Rapi";

/**
 * Pola untuk menandai SELURUH dokumen kembar, bukan satu saja.
 *
 * ⚠️ PERCOBAAN PERTAMA UJI INI LOLOS PADAHAL KONTROLNYA BOCOR.
 *
 * Mula-mula cuma `Absensi-Dummy-Scan-Rapi` yang ditandai. Semua penanda
 * hijau -- agent IT tidak menyebut judulnya, tidak menyinggung pembatasan.
 * Tapi jawabannya BERISI isi dokumen itu, karena ada kembarannya
 * (`Absensi-Dummy-Scan-Miring`) yang isinya IDENTIK (md5 sama) dan tidak
 * ditandai.
 *
 * Pelajarannya melampaui uji ini: penanda per DOKUMEN tidak melindungi
 * INFORMASI yang ada di lebih dari satu dokumen. Kalau rekap penjualan yang
 * sama diunggah dua kali -- sekali bertanda, sekali tidak -- kontrolnya
 * batal, tanpa gejala.
 */
const POLA_ISI = "KETENTUAN ABSENSI KARYAWAN|08\.00 sampai 17\.00";

/** Kalimat khas yang HANYA ada di dokumen uji. Ini penanda yang sebenarnya. */
const KALIMAT_KHAS = /08\.00 sampai 17\.00|KETENTUAN ABSENSI KARYAWAN/i;
const TANDA = "marketing";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) {
    lolos++;
    console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`);
  }
}

const adm = new pg.Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
});
await adm.connect();

/** Pertanyaan yang isinya memang ada di dokumen uji itu. */
const TANYA = "aturan jam kerja dan keterlambatan absensi";

/**
 * Dokumen yang SUDAH bertanda sebelum uji ini jalan -- milik orang lain.
 *
 * ⚠️ UJI INI PERNAH GAGAL JUSTRU KARENA FITURNYA BERHASIL DIPAKAI.
 *
 * Versi pertama menghitung `COUNT(*) WHERE access_menus IS NOT NULL` dan
 * menuntut hasilnya 0 di akhir. Itu benar selama belum ada seorang pun yang
 * mengunggah dokumen sungguhan: semua 60 dokumen waktu itu tidak bertanda,
 * jadi "tanda milik uji ini" dan "semua tanda yang ada" kebetulan sama
 * angkanya.
 *
 * Begitu ada karyawan marketing mengunggah data penjualan -- yang OTOMATIS
 * bertanda `marketing`, persis seperti yang dirancang -- angkanya jadi 1 dan
 * uji ini merah. Padahal tidak ada yang bocor, tidak ada yang tertinggal.
 *
 * Pelajarannya: uji kebersihan harus mengukur SELISIH sebelum/sesudah, bukan
 * keadaan mutlak schema. Schema ini dipakai bersama; menuntutnya kosong
 * berarti uji kita rusak tiap kali orang lain bekerja dengan benar.
 */
const sudahBertanda = new Set(
  (
    await adm.query<{ id_document: string }>(
      "SELECT id_document FROM ai_knowledge.documents WHERE access_menus IS NOT NULL",
    )
  ).rows.map((x) => x.id_document),
);
console.log(
  sudahBertanda.size > 0
    ? `${sudahBertanda.size} dokumen SUDAH bertanda sebelum uji (milik orang lain, tidak disentuh)\n`
    : "belum ada dokumen bertanda sebelum uji\n",
);

try {
  // ---- pasang tanda ----
  const pasang = await adm.query(
    `UPDATE ai_knowledge.documents SET access_menus = $2
      WHERE access_menus IS NULL
        AND id_document IN (
          SELECT id_document FROM ai_knowledge.chunks
           WHERE content ~* $1
        )
      RETURNING id_document, title`,
    [POLA_ISI, TANDA],
  );
  if (pasang.rowCount === 0) {
    console.error(
      `⛔ Dokumen uji "${JUDUL_UJI}" tidak ditemukan, atau access_menus-nya\n` +
        "   sudah terisi. Uji dibatalkan supaya tidak menimpa tanda yang asli.",
    );
    gagal++;
  } else {
    console.log(`dokumen uji ditandai "${TANDA}" sementara\n`);

    // ============================================================
    console.log("=== 1. Pencarian per departemen ===");
    // ============================================================
    const punyaUji = (h: { judul: string }[]) => h.some((x) => x.judul === JUDUL_UJI);

    const mkt = await cariSop(TANYA, { batas: 8, departemen: "marketing" });
    cek("marketing MENEMUKAN dokumen bertanda marketing", punyaUji(mkt));

    for (const dep of ["it", "hrd"]) {
      const h = await cariSop(TANYA, { batas: 8, departemen: dep });
      cek(`${dep} TIDAK menemukannya`, !punyaUji(h));
      // Yang penting bukan cuma "tidak ketemu" -- dia harus tetap dapat
      // hasil lain, bukan kosong melompong. Kalau kosong, user mengira
      // sistemnya rusak.
      cek(`   ${dep} tetap dapat hasil lain`, h.length > 0, `${h.length} potongan`);
    }

    // ============================================================
    console.log("\n=== 2. Dokumen tanpa tanda tetap terbuka untuk semua ===");
    // ============================================================
    // `access_menus IS NULL` = terbuka. Kalau ini rusak, 58 panduan yang ada
    // sekarang menghilang dari semua orang sekaligus.
    for (const dep of ["marketing", "it", "hrd"]) {
      const h = await cariSop("cara menyetujui dokumen approval", {
        batas: 3,
        departemen: dep,
      });
      cek(`${dep} masih menemukan panduan umum`, h.length > 0, `${h.length} potongan`);
    }

    // ============================================================
    console.log("\n=== 3. daftar_sop ikut tersaring ===");
    // ============================================================
    const rakMkt = await daftarSop("marketing");
    const rakIt = await daftarSop("it");
    cek("daftar marketing memuat dokumen bertanda", rakMkt.some((x) => x.judul === JUDUL_UJI));
    cek("daftar IT TIDAK memuatnya", !rakIt.some((x) => x.judul === JUDUL_UJI));
    // Selisihnya = tanda milik uji ini DITAMBAH tanda milik orang lain yang
    // kebetulan juga "marketing". Dua-duanya hilang dari daftar IT, jadi
    // membandingkan dengan `pasang.rowCount` saja akan meleset tiap kali ada
    // karyawan marketing mengunggah dokumen -- yang justru kejadian normal.
    const bertandaMarketing = (
      await adm.query<{ n: number }>(
        "SELECT count(*)::int n FROM ai_knowledge.documents WHERE access_menus = $1 AND is_active AND chunk_count > 0",
        [TANDA],
      )
    ).rows[0].n;
    cek(
      "selisih daftar = seluruh dokumen bertanda marketing",
      rakMkt.length - rakIt.length === bertandaMarketing,
      `marketing ${rakMkt.length}, it ${rakIt.length}, bertanda ${bertandaMarketing} (${pasang.rowCount} dari uji ini)`,
    );

    // ============================================================
    if (UJI_AGENT) {
      console.log("\n=== 4. Agent IT tidak membocorkan keberadaannya ===");
      // Penyaring SQL sudah benar, tapi yang dilihat user adalah KALIMAT
      // agent. Kalau dia bilang "ada dokumen tapi kamu tidak boleh lihat",
      // keberadaannya sudah bocor walau isinya tidak.
      const { buatAgent, KUNCI_MODEL, KUNCI_PENGGUNA, KUNCI_SUMBER } = await import(
        "../voltagent/agents.ts"
      );
      const { ambilDepartemen } = await import("../voltagent/departemen/index.ts");
      const dep = ambilDepartemen("it");
      if (!dep) {
        cek("departemen it ada", false);
      } else {
        const r = (await buatAgent(dep, "staf").generateText(TANYA, {
          context: {
            [KUNCI_MODEL]: "claude-haiku-4-5",
            [KUNCI_PENGGUNA]: { id: 1, username: "u", nama: "U", idEmployee: null },
            [KUNCI_SUMBER]: "perusahaan",
          },
        })) as { text?: string };
        const teks = String(r.text ?? "");
        console.log(`  jawaban: ${teks.slice(0, 160).replace(/\s+/g, " ")}…`);
        cek("tidak menyebut judul dokumen marketing", !teks.includes(JUDUL_UJI));
        // Penanda yang sebenarnya: ISI-nya tidak boleh sampai, bukan cuma
        // judulnya. Percobaan pertama uji ini lolos di penanda judul padahal
        // isinya bocor lewat dokumen kembar.
        cek("ISI dokumen marketing tidak sampai ke agent IT", !KALIMAT_KHAS.test(teks));
        cek(
          "tidak menyinggung adanya dokumen yang tidak boleh diakses",
          !/tidak (boleh|punya|berhak) (akses|melihat)|dibatasi|departemen lain/i.test(teks),
        );
      }
    } else {
      console.log("\n(uji kebocoran lewat agent dilewati — tambahkan `-- --agent`)");
    }
  }
} finally {
  // ⚠️ SELALU dibersihkan, apa pun yang terjadi di atas.
  //
  // `NOT (id_document = ANY($3))` menjaga tanda milik ORANG LAIN. Tanpa itu,
  // uji ini akan mencabut `access_menus` dokumen sungguhan yang kebetulan
  // isinya cocok dengan POLA_ISI -- artinya uji keamanan kita sendiri yang
  // MEMBUKA akses dokumen orang. Kerusakannya diam: tidak ada galat, dokumen
  // itu cuma pelan-pelan terlihat oleh semua departemen.
  const milikOrangLain = [...sudahBertanda];
  const bersih = await adm.query(
    `UPDATE ai_knowledge.documents SET access_menus = NULL
      WHERE access_menus = $2
        AND NOT (id_document = ANY($3::uuid[]))
        AND id_document IN (
          SELECT id_document FROM ai_knowledge.chunks WHERE content ~* $1
        )
      RETURNING id_document`,
    [POLA_ISI, TANDA, milikOrangLain],
  );
  // Yang diperiksa: tidak ada tanda BARU yang tertinggal. Bukan "schema harus
  // kosong dari tanda" -- schema ini dipakai bersama, dan dokumen bertanda
  // milik orang lain justru tanda fiturnya bekerja.
  const sisa = await adm.query<{ id_document: string }>(
    "SELECT id_document FROM ai_knowledge.documents WHERE access_menus IS NOT NULL",
  );
  const baru = sisa.rows.map((x) => x.id_document).filter((id) => !sudahBertanda.has(id));
  console.log(`\ntanda dibuang: ${bersih.rowCount} baris`);
  cek(
    "tidak ada tanda uji yang tertinggal di schema mereka",
    baru.length === 0,
    `${baru.length} tanda baru${sudahBertanda.size ? `, ${sudahBertanda.size} tanda milik orang lain dibiarkan utuh` : ""}`,
  );
  // Tanda orang lain harus UTUH -- bukan cuma "tidak kita tambahi".
  cek(
    "tanda milik orang lain tidak ikut terhapus",
    [...sudahBertanda].every((id) => sisa.rows.some((x) => x.id_document === id)),
    `${sudahBertanda.size} dokumen diperiksa`,
  );
  await adm.end();
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exitCode = gagal === 0 ? 0 : 1;
