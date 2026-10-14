/**
 * Pencarian di basis pengetahuan: dokumen SOP dan tiket lama.
 *
 * ⚠️ BERKAS INI SENGAJA TIDAK MENGENAL VOLTAGENT.
 *
 * Tidak ada `createTool`, tidak ada `z.object`, tidak ada prompt. Isinya cuma
 * fungsi yang menerima teks dan mengembalikan baris. Alasannya supaya mutu
 * pencariannya bisa diukur tanpa menjalankan model bahasa sama sekali --
 * `npm run test:kb` memanggil fungsi di sini langsung. Kalau query-nya
 * bercampur dengan prompt, satu-satunya cara mengujinya adalah lewat agent,
 * dan hasilnya jadi tidak bisa dibedakan: pencariannya yang jelek atau
 * modelnya yang salah pakai.
 *
 * ============================================================
 * DUA CARA PENCARIAN, DIPILIH LEWAT PENGUKURAN
 * ============================================================
 * Dokumen SOP  -> VEKTOR.  12/12 tepat di peringkat-1, trigram cuma 9/12.
 * Judul tiket  -> TRIGRAM. 5/6 tepat, vektor cuma 2/10.
 *
 * Bukan soal selera: pertanyaan ke SOP sering tidak berbagi satu kata pun
 * dengan jawabannya ("libur" vs "cuti" -> trigram 0,00), sedangkan judul tiket
 * itu pendek dan penanyanya cenderung memakai kata yang sama ("printer").
 */
import { poolPerusahaan } from "@/lib/db-perusahaan";
import { embed, awalanQuery } from "@/voltagent/embedding";

// ============================================================
// Dokumen SOP -- vektor
// ============================================================

export type PotonganSop = {
  /** `documents.title` -- identitas dokumen; korpus ini tidak punya kode. */
  judul: string;
  /**
   * `chunks.section_title` -- nama bagian di dalam dokumen.
   *
   * Ini unit rujukan korpus baru, menggantikan halaman/baris yang dipakai
   * korpus PDF lama. Lebih berguna juga: "Langkah 4: Distributor mengisi
   * order" memberi tahu pembaca di mana dia berada, sementara "halaman 1
   * baris 19" cuma koordinat.
   *
   * Terisi 90/90 di korpus `ai_knowledge` dengan 87 ragam berbeda.
   */
  bagian: string | null;
  /** `documents.kind` -- 'guide' atau 'faq'. */
  jenis: string;
  /** Tautan ke halaman aslinya kalau ada. 35 dari 53 dokumen punya. */
  url: string | null;
  /**
   * Letak di berkas aslinya -- HANYA untuk dokumen yang memang berhalaman
   * (PDF dan gambar yang lewat OCR). Panduan yang disinkronkan dari tabel
   * tidak punya halaman, dan nilainya `null`.
   *
   * Diisi tim pemilik schema sejak 2 Okt 2026 bersama dukungan OCR. Terisi
   * untuk 7 dari 98 potongan -- sedikit, tapi justru di dokumen yang paling
   * butuh: hasil pindaian, yang tidak punya tautan web untuk dibuka.
   */
  halaman: number | null;
  barisAwal: number | null;
  barisAkhir: number | null;
  teks: string;
  urutan: number;
  /** 0..1. (TIDAK berarti "serelevan ini" -- lihat peringatan di bawah.) */
  skor: number;
};

/**
 * Cari potongan SOP yang paling dekat maknanya.
 *
 * ⚠️ TIDAK ADA AMBANG SKOR DI SINI, DAN ITU DISENGAJA.
 *
 * Menambahkan `WHERE skor > 0.8` itu refleks yang wajar dan di sini SALAH.
 * Pada model yang kita pakai (multilingual-e5-base), pasangan kata yang sama
 * sekali tidak berhubungan tetap dapat skor tinggi:
 *
 *     libur    / cuti      -> 0,90      (bersinonim)
 *     printer  / kucing    -> 0,87      (tidak ada hubungannya)
 *
 * Bedanya 0,03. Ambang apa pun yang meloloskan yang pertama juga meloloskan
 * yang kedua. Skor vektor cuma berarti UNTUK MENGURUTKAN di dalam satu
 * kumpulan hasil, tidak untuk menilai relevansi secara mutlak.
 *
 * Akibatnya fungsi ini SELALU mengembalikan `batas` baris selama korpusnya
 * tidak kosong -- termasuk untuk pertanyaan yang tidak ada SOP-nya. Yang
 * memutuskan "tidak ada yang menjawab" harus model, setelah membaca isinya;
 * bukan angka di sini.
 */
export async function cariSop(
  tanya: string,
  opsi: { batas?: number; maksPerDokumen?: number; departemen?: string } = {},
): Promise<PotonganSop[]> {
  const { batas = 5, maksPerDokumen = 2, departemen = null } = opsi;
  const [v] = await embed([awalanQuery(tanya)]);

  // `maksPerDokumen` ada karena masalah yang terukur: satu dokumen panjang
  // bisa memborong seluruh hasil dan mendesak keluar dokumen lain yang juga
  // relevan, tanpa model punya cara tahu ada yang hilang.
  //
  // ROW_NUMBER() memaksa PostgreSQL menghitung jarak untuk SEMUA baris,
  // jadi indeks vektor tidak terpakai. Pada 90 potongan itu tidak terasa;
  // kalau korpusnya nanti puluhan ribu, bagian ini yang harus diubah dulu.
  const sql = `
    WITH berskor AS (
      SELECT d.title, c.section_title, d.kind, COALESCE(d.url, d.file_path) AS url, c.content, c.position,
             c.page_start, c.line_start, c.line_end,
             c.embedding <=> $1::vector AS jarak,
             ROW_NUMBER() OVER (
               PARTITION BY d.id_document ORDER BY c.embedding <=> $1::vector
             ) AS urut_dalam_dokumen
        FROM ai_knowledge.chunks    c
        JOIN ai_knowledge.documents d USING (id_document)
       WHERE c.embedding IS NOT NULL
         AND d.is_active
         AND (d.access_menus IS NULL OR d.access_menus = $4)
    )
    SELECT title, section_title, kind, url, content, position,
           page_start, line_start, line_end, 1 - jarak AS skor
      FROM berskor
     WHERE urut_dalam_dokumen <= $3
     ORDER BY jarak
     LIMIT $2`;

  const r = await poolPerusahaan().query(sql, [
    `[${v.join(",")}]`,
    batas,
    maksPerDokumen,
    departemen,
  ]);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    judul: String(x.title),
    bagian: x.section_title === null ? null : String(x.section_title),
    jenis: String(x.kind),
    url: x.url === null ? null : String(x.url),
    halaman: x.page_start === null ? null : Number(x.page_start),
    barisAwal: x.line_start === null ? null : Number(x.line_start),
    barisAkhir: x.line_end === null ? null : Number(x.line_end),
    teks: String(x.content),
    urutan: Number(x.position),
    skor: Number(x.skor),
  }));
}

/**
 * Teks yang di-embed untuk sebuah potongan.
 *
 * ⚠️ SATU-SATUNYA tempat aturan ini ditulis.
 *
 * Dipakai oleh YANG MENULIS (`scripts/isi-kb-dari-pdf.mts`) dan oleh YANG
 * MENGUJI (`scripts/uji-kb-berkas.mts`). Kalau aturannya diketik dua kali,
 * ujinya berhenti berarti: dia cuma akan membuktikan bahwa dua salinan yang
 * sama menghasilkan hal yang sama, bukan bahwa vektor di database benar.
 *
 * Judul ikut sebagai KONTEKS, isinya tetap teks PDF apa adanya. Tanpa judul,
 * `test:kb` turun 12/12 -> 9/12: dokumen yang badan teksnya mirip jadi
 * tertukar ("Penghapusan Akun Karyawan yang KELUAR" vs "Permintaan Email
 * BARU"). Judulnya sendiri ADA di PDF sebagai baris pertama, jadi ini
 * mengulang kepala dokumennya, bukan menyuntikkan keterangan dari luar.
 */
export function teksUntukVektor(judul: string, teks: string): string {
  return `${judul}\n${teks}`;
}

export type RingkasSop = {
  judul: string;
  jenis: string;
  url: string | null;
  potongan: number;
};

/**
 * Daftar seluruh dokumen yang ada di rak -- tanpa pencarian.
 *
 * ADA KARENA `cariSop` TIDAK PUNYA AMBANG: dia selalu mengembalikan hasil,
 * termasuk untuk pertanyaan yang memang tidak ada panduannya. Tanpa fungsi
 * ini, model tidak punya cara menunjukkan isi rak yang sebenarnya -- dia cuma
 * bisa bilang "tidak ada", yang tidak menolong siapa pun.
 *
 * Dokumen tanpa potongan dikecualikan: ada 1 dokumen berstatus `failed`
 * ("Tidak ada teks yang bisa dibaca") yang tidak punya isi untuk dicari.
 */
export async function daftarSop(departemen: string | null = null): Promise<RingkasSop[]> {
  const r = await poolPerusahaan().query(
    `SELECT title, kind, COALESCE(url, file_path) AS url, chunk_count
       FROM ai_knowledge.documents
      WHERE is_active AND chunk_count > 0
        AND (access_menus IS NULL OR access_menus = $1)
      ORDER BY title`,
    [departemen],
  );
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    judul: String(x.title),
    jenis: String(x.kind),
    url: x.url === null ? null : String(x.url),
    potongan: Number(x.chunk_count),
  }));
}

// ============================================================
// Tiket lama -- trigram
// ============================================================

/**
 * Catatan yang muncul lebih dari sekian kali dianggap boilerplate.
 *
 * ⚠️ ATURANNYA DIUKUR, BUKAN DAFTAR KATA YANG DIKETIK TANGAN.
 *
 * `portal_ticket_tracking` punya 48.953 baris, dan hampir semuanya jejak ganti
 * status dengan teks yang identik berulang ribuan kali:
 *
 *     "Created Ticket"      10.035 baris, 1 teks unik
 *     "Ticket disetujui"     9.362 baris, 1 teks unik
 *     "Pemilihan Teknisi"    9.322 baris, 1 teks unik
 *
 * Menyaringnya dengan daftar kalimat yang diketik di sini akan basi begitu
 * aplikasi mereka menambah satu status baru -- dan basinya tidak kelihatan,
 * cuma muncul sebagai hasil pencarian yang isinya sampah. Ambang kemunculan
 * ikut berubah sendiri waktu datanya berubah.
 */
const AMBANG_BOILERPLATE = 20;

/** Catatan lebih pendek dari ini tidak pernah berisi keterangan teknis. */
const MIN_HURUF_CATATAN = 25;

export type TiketSerupa = {
  noTiket: string;
  judul: string;
  status: string;
  kategori: string | null;
  teknisi: string | null;
  dibuat: string | null;
  /** 0..1 dari `word_similarity`. Beda sifat dari skor vektor: ini terbaca. */
  skor: number;
  /**
   * Catatan penyelesaian, kalau ada.
   *
   * ⚠️ KOSONG DI 96% TIKET. Terukur 30 Sep 2026: dari 10.087 tiket, cuma 423
   * (4,2%) punya catatan yang bukan boilerplate. Pemanggil WAJIB menangani
   * array kosong sebagai keadaan normal, bukan kegagalan.
   */
  catatan: string[];
};

/**
 * Cari tiket lama yang judulnya mirip.
 *
 * ⚠️ `word_similarity`, BUKAN `similarity`.
 *
 * `similarity` membandingkan dua teks UTUH, jadi pertanyaan 40 huruf melawan
 * judul 80 huruf selalu dapat skor rendah walau isinya persis. Yang kita mau
 * adalah "apakah kata-kata pertanyaan ini muncul di dalam judul itu", dan itu
 * `word_similarity`.
 *
 * ⚠️ TIDAK ADA INDEKS GIN, DAN ITU PILIHAN SADAR.
 *
 * 10.087 baris dipindai habis dalam 34 ms -- indeks belum terasa gunanya. Yang
 * lebih penting: memasang indeks berarti MENULIS ke database perusahaan yang
 * dipakai tim lain. Selama pemindaian penuh masih secepat ini, menahan diri
 * lebih murah daripada menambah objek di schema orang.
 *
 * @param idEmployee Kalau diisi, hasilnya DIBATASI tiket milik orang ini.
 *   Wajib diisi untuk departemen yang `v_asisten_tiket`-nya berlingkup "diri"
 *   -- tanpa itu, satu orang marketing bisa membaca tiket 1.954 orang lain,
 *   memutari gerbang di `voltagent/perusahaan/view-perusahaan.ts`.
 */
export async function cariTiketSerupa(
  tanya: string,
  opsi: {
    idEmployee?: string | null;
    batas?: number;
    /**
     * Cocokkan juga ke kolom `description`, ambil skor yang lebih tinggi.
     *
     * ⚠️ DEFAULT MATI, menunggu pengukuran.
     *
     * Alasan menyalakannya: `description` terisi di 10.059 dari 10.087 tiket,
     * dan banyak judul tiket tidak informatif ("MOHON BANTUAN") sehingga
     * masalah sebenarnya cuma ada di deskripsi.
     *
     * Alasan belum dinyalakan: deskripsi jauh lebih panjang, jadi peluang satu
     * kata nyasar ikut cocok juga lebih besar -- dan titik buta trigram sudah
     * terbukti nyata di sini ("printer" cocok ke "INTERNET"). Dinyalakan hanya
     * kalau `test:kb-tool` menunjukkan recall-nya naik tanpa presisinya jatuh.
     */
    pakaiDeskripsi?: boolean;
  } = {},
): Promise<TiketSerupa[]> {
  const { idEmployee = null, batas = 5, pakaiDeskripsi = false } = opsi;

  // Dirangkai sebagai dua cabang tetap, bukan dari input: isinya SQL, dan
  // satu-satunya yang menentukan cabang mana adalah boolean di atas.
  const ekspresiSkor = pakaiDeskripsi
    ? `GREATEST(word_similarity($1, LOWER(t.subject)),
                word_similarity($1, LOWER(COALESCE(t.description, ''))))`
    : `word_similarity($1, LOWER(t.subject))`;

  // `$3::uuid IS NULL` membuat penyaring per-orang hidup/mati dari satu
  // parameter, tanpa merangkai dua versi SQL. Dua versi berarti dua tempat
  // yang bisa berbeda, dan yang berbeda nanti adalah yang ada penyaringnya.
  const sql = `
    WITH sering AS (
      SELECT note FROM portal_ticket_tracking
       GROUP BY note HAVING COUNT(*) > ${AMBANG_BOILERPLATE}
    ), cocok AS (
      SELECT t.id_ticket, t.no_ticket, t.subject, t.status, t.created_at,
             k.category_name, tek.fullname AS teknisi,
             ${ekspresiSkor} AS skor
        FROM portal_ticket t
        LEFT JOIN category k ON k.id_category = t.id_category
        LEFT JOIN portal_technician pt ON pt.id_technician = t.id_technician
        LEFT JOIN employee tek ON tek.id_employee = pt.id_employee
       WHERE ($3::uuid IS NULL OR t.id_employee = $3::uuid)
       ORDER BY skor DESC, t.created_at DESC
       LIMIT $2
    )
    SELECT c.*,
           COALESCE(
             ARRAY_AGG(tr.note ORDER BY tr.created_at)
               FILTER (WHERE tr.note IS NOT NULL),
             '{}'
           ) AS catatan
      FROM cocok c
      LEFT JOIN portal_ticket_tracking tr
             ON tr.id_ticket = c.id_ticket
            AND LENGTH(TRIM(tr.note)) >= ${MIN_HURUF_CATATAN}
            AND tr.note NOT IN (SELECT note FROM sering)
     GROUP BY c.id_ticket, c.no_ticket, c.subject, c.status, c.created_at,
              c.category_name, c.teknisi, c.skor
     ORDER BY c.skor DESC, c.created_at DESC`;

  const r = await poolPerusahaan().query(sql, [
    tanya.toLowerCase(),
    batas,
    idEmployee,
  ]);

  return (r.rows as Record<string, unknown>[]).map((x) => ({
    noTiket: String(x.no_ticket),
    judul: String(x.subject),
    status: String(x.status),
    kategori: x.category_name === null ? null : String(x.category_name),
    teknisi: x.teknisi === null ? null : String(x.teknisi),
    // Parser tanggal di `db-perusahaan.ts` sudah membuat ini teks apa adanya.
    dibuat: x.created_at === null ? null : String(x.created_at),
    skor: Number(x.skor),
    catatan: (x.catatan as string[] | null) ?? [],
  }));
}

/**
 * ============================================================
 * ⚠️ TIDAK ADA FUNGSI PENGHITUNG DI SINI, DAN ITU HASIL PENGUKURAN
 * ============================================================
 *
 * Sempat ada `hitungTiketSerupa()` yang mengembalikan "pernah terjadi N kali".
 * Dicabut 1 Okt 2026 karena angkanya tidak bisa dibuat benar.
 *
 * Menghitung menuntut AMBANG ("mirip" itu dari skor berapa), dan untuk trigram
 * tidak ada ambang yang sah. Hasil pengukuran untuk kata "printer":
 *
 *     ambang   jumlah   yang ikut terhitung
 *     ------   ------   ----------------------------------------
 *     0,3       2.335   + "INTERNET MATI IDUP2", "PROBLEM INTERNET"  <- salah
 *     0,7       1.313   - "LAPTOP TIDAK BISA NGEPRINT"               <- hilang
 *     ILIKE     1.301   (pembanding: pencocokan teks biasa)
 *
 * Sebabnya struktural, bukan kurang disetel. Trigram "printer" =
 * {pri, rin, int, nte, ter}. "INTERNET" berbagi {int, nte, ter} -- tiga buah.
 * "NGEPRINT" berbagi {pri, rin, int} -- juga tiga buah. Yang SALAH dan yang
 * BENAR berskor sama, jadi tidak ada satu garis yang memisahkan keduanya.
 *
 * Ini sejajar dengan temuan di sisi vektor (printer/kucing = 0,87, cuma 0,03
 * di bawah libur/cuti). Kesimpulannya sama untuk kedua metode:
 *
 *     PERINGKAT bisa dipercaya. AMBANG tidak bisa.
 *
 * Yang salah tetap ikut tersaring, tapi TENGGELAM di urutan bawah -- terbukti
 * di uji asap: 4 hasil teratas untuk "printer tidak bisa print" semuanya tiket
 * printer sungguhan (1,00 / 1,00 / 1,00 / 0,95). Karena itu `cariTiketSerupa`
 * yang mengambil top-N aman, sedangkan menghitung tidak.
 *
 * Kalau user memang menanyakan JUMLAH, itu urusan `query_perusahaan`: di sana
 * agent menulis `ILIKE` sendiri dan SQL-nya terlihat, jadi angkanya bisa
 * ditelusuri -- bukan keluar dari ambang tersembunyi di berkas ini.
 */
