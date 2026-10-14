/**
 * Diagram relasi tabel di balik sebuah sumber data.
 *
 * ⚠️ DIBACA DARI SKEMA, BUKAN DIGAMBAR TANGAN. Kolom, tipe, dan kunci utama
 * datang dari katalog PostgreSQL; posisi kotak dihitung di sini supaya
 * garisnya bisa digambar SVG dengan koordinat yang pasti.
 *
 * ⚠️ GARISNYA BUKAN FOREIGN KEY.
 *
 * `portal_ticket` punya NOL foreign key — begitu juga sebagian besar tabel di
 * database ini. Jadi relasinya DISIMPULKAN dari kesamaan nama kolom: kolom
 * `id_category` di tabel mana pun dianggap menunjuk `category.id_category`
 * karena itu kunci utamanya.
 *
 * Kesimpulan itu bisa salah, dan justru itu yang perlu terbaca: database
 * menerima `id_category` karangan tanpa protes, jadi yang memvalidasi harus
 * tool-nya. Foreign key yang BENAR-BENAR ada ditandai berbeda.
 */
import { poolPerusahaan } from "./db-perusahaan";

/** Lambang tipe, mengikuti kebiasaan diagram skema. */
export type Lambang = "PK" | "id" | "AZ" | "tgl" | "y/n" | "{}" | "123";

export type KolomDiagram = { nama: string; tipe: string; lambang: Lambang };

export type KotakDiagram = {
  tabel: string;
  kolom: KolomDiagram[];
  perkiraanBaris: number | null;
  /** Tabel pokok sumber ini — digambar di tengah dan ditonjolkan. */
  pokok: boolean;
  x: number;
  y: number;
  lebar: number;
  tinggi: number;
};

export type GarisDiagram = {
  dari: { tabel: string; kolom: string; x: number; y: number };
  ke: { tabel: string; kolom: string; x: number; y: number };
  /** Ditegakkan database, atau cuma disimpulkan dari kesamaan nama? */
  foreignKey: boolean;
};

export type Diagram = {
  kotak: KotakDiagram[];
  garis: GarisDiagram[];
  lebar: number;
  tinggi: number;
  /** Berapa tabel di diagram ini yang tidak punya foreign key sama sekali. */
  tanpaFk: string[];
};

// Geometri. Semuanya tetap supaya tinggi kotak bisa dihitung dari jumlah kolom.
const LEBAR = 200;
const BARIS = 19;
const KEPALA = 30;
const JARAK_X = 90;
const JARAK_Y = 26;
const PAD = 8;

function lambangDari(tipe: string, pk: boolean, nama: string): Lambang {
  if (pk) return "PK";
  if (/^(uuid)$/.test(tipe) && /(^id_|_id$)/.test(nama)) return "id";
  if (/json/.test(tipe)) return "{}";
  if (/bool/.test(tipe)) return "y/n";
  if (/(timestamp|date|time)/.test(tipe)) return "tgl";
  if (/(int|numeric|double|real|decimal)/.test(tipe)) return "123";
  return "AZ";
}

type Baris = { tabel: string; kolom: string; tipe: string; pk: boolean; perkiraan: string | null };

/**
 * `tabel` diambil dari penelusuran katalog (`rincianSumber`), jadi isinya nama
 * relasi yang benar-benar ada — bukan dari masukan pemakai.
 */
export async function diagramRelasi(tabel: string[], pokok: string | null): Promise<Diagram | null> {
  if (tabel.length === 0) return null;
  const pool = poolPerusahaan();

  const { rows } = await pool.query<Baris>(
    `SELECT c.relname AS tabel, a.attname AS kolom,
            format_type(a.atttypid, a.atttypmod) AS tipe,
            COALESCE(i.indisprimary, false) AS pk,
            c.reltuples::bigint::text AS perkiraan
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
      WHERE c.relname = ANY($1::text[]) AND c.relkind = 'r'
      ORDER BY c.relname, a.attnum`,
    [tabel],
  );
  if (rows.length === 0) return null;

  // Foreign key yang BENAR-BENAR ditegakkan, supaya bisa dibedakan dari yang
  // cuma disimpulkan.
  const { rows: fk } = await pool.query<{ dari: string; kolom: string; ke: string }>(
    `SELECT t.relname AS dari, a.attname AS kolom, f.relname AS ke
       FROM pg_constraint k
       JOIN pg_class t ON t.oid = k.conrelid
       JOIN pg_class f ON f.oid = k.confrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND t.relname = ANY($1::text[])`,
    [tabel],
  );
  const fkSet = new Set(fk.map((x) => `${x.dari}.${x.kolom}`));

  // ---- kotak ----
  const perTabel = new Map<string, KolomDiagram[]>();
  const perkiraan = new Map<string, number | null>();
  for (const r of rows) {
    const d = perTabel.get(r.tabel) ?? [];
    d.push({ nama: r.kolom, tipe: r.tipe, lambang: lambangDari(r.tipe, r.pk, r.kolom) });
    perTabel.set(r.tabel, d);
    const n = r.perkiraan === null ? null : Number(r.perkiraan);
    perkiraan.set(r.tabel, n !== null && n >= 0 ? n : null);
  }

  // Kunci utama per tabel — dasar menyimpulkan relasi.
  const pk = new Map<string, string>();
  for (const r of rows) if (r.pk && !pk.has(r.tabel)) pk.set(r.tabel, r.kolom);

  const utama = pokok && perTabel.has(pokok) ? pokok : [...perTabel.keys()][0];
  const lain = [...perTabel.keys()].filter((t) => t !== utama).sort();

  // Tata letak tiga kolom: yang DIRUJUK tabel pokok di kanan, yang MERUJUK ke
  // tabel pokok di kiri. Itu membuat arah panah tidak saling menyilang.
  const kolomUtama = new Set((perTabel.get(utama) ?? []).map((k) => k.nama));
  const kanan = lain.filter((t) => pk.has(t) && kolomUtama.has(pk.get(t)!));
  const kiri = lain.filter((t) => !kanan.includes(t));

  const tinggiKotak = (t: string) => KEPALA + (perTabel.get(t)?.length ?? 0) * BARIS + PAD;
  const kotak: KotakDiagram[] = [];
  const taruh = (daftar: string[], x: number) => {
    let y = 0;
    for (const t of daftar) {
      const h = tinggiKotak(t);
      kotak.push({
        tabel: t,
        kolom: perTabel.get(t) ?? [],
        perkiraanBaris: perkiraan.get(t) ?? null,
        pokok: t === utama,
        x,
        y,
        lebar: LEBAR,
        tinggi: h,
      });
      y += h + JARAK_Y;
    }
    return y;
  };

  const tKiri = taruh(kiri, 0);
  const tTengah = taruh([utama], LEBAR + JARAK_X);
  const tKanan = taruh(kanan, (LEBAR + JARAK_X) * 2);

  // Kotak tengah diturunkan supaya sejajar dengan tumpukan tertinggi.
  const tertinggi = Math.max(tKiri, tTengah, tKanan);
  const tengah = kotak.find((k) => k.tabel === utama)!;
  tengah.y = Math.max(0, (tertinggi - tengah.tinggi - JARAK_Y) / 2);

  const posisi = new Map(kotak.map((k) => [k.tabel, k]));
  const yKolom = (t: string, nama: string) => {
    const k = posisi.get(t)!;
    const i = k.kolom.findIndex((x) => x.nama === nama);
    return k.y + KEPALA + i * BARIS + BARIS / 2;
  };

  // ---- garis ----
  const garis: GarisDiagram[] = [];
  for (const [tabelA, kolomA] of perTabel) {
    for (const k of kolomA) {
      for (const [tabelB, pkB] of pk) {
        if (tabelA === tabelB || k.nama !== pkB) continue;
        if (!posisi.has(tabelA) || !posisi.has(tabelB)) continue;
        const a = posisi.get(tabelA)!;
        const b = posisi.get(tabelB)!;
        // Garis keluar dari sisi yang menghadap tujuannya.
        const kananA = b.x >= a.x;
        garis.push({
          dari: { tabel: tabelA, kolom: k.nama, x: kananA ? a.x + a.lebar : a.x, y: yKolom(tabelA, k.nama) },
          ke: { tabel: tabelB, kolom: pkB, x: kananA ? b.x : b.x + b.lebar, y: yKolom(tabelB, pkB) },
          foreignKey: fkSet.has(`${tabelA}.${k.nama}`),
        });
      }
    }
  }

  // Kanvas dirapatkan ke isi sebenarnya. Tanpa ini, diagram satu tabel tetap
  // selebar tiga kolom dan kotaknya mengambang di tengah ruang kosong.
  const kiriX = Math.min(...kotak.map((k) => k.x));
  if (kiriX > 0) {
    for (const k of kotak) k.x -= kiriX;
    for (const g of garis) {
      g.dari.x -= kiriX;
      g.ke.x -= kiriX;
    }
  }

  return {
    kotak,
    garis,
    lebar: Math.max(...kotak.map((k) => k.x + k.lebar)),
    tinggi: Math.max(...kotak.map((k) => k.y + k.tinggi)) + PAD,
    tanpaFk: [...perTabel.keys()].filter((t) => !fk.some((x) => x.dari === t)).sort(),
  };
}

export const UKURAN = { LEBAR, BARIS, KEPALA, PAD };
