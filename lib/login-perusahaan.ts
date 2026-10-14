/**
 * Login memakai akun database perusahaan (Tahap 10B).
 *
 * ⚠️ POOL-NYA SENGAJA TERPISAH dari `poolPerusahaan()`.
 *
 * `poolPerusahaan()` memakai `ai_readonly` -- role yang menjalankan SQL
 * tulisan model. Role login (`portal_login`) punya hak yang berbeda dan lebih
 * berbahaya kalau bocor: dia boleh memanggil `cek_login_perusahaan()`.
 *
 * Kalau keduanya memakai satu koneksi, agent bisa menulis
 * `SELECT cek_login_perusahaan('budi@...','tebakan1')` -- dan penjaga SQL kita
 * TIDAK menangkapnya, karena penjaga itu memeriksa nama tabel di FROM/JOIN
 * sedangkan query tadi tidak punya FROM. Tool baca-data berubah jadi alat
 * menebak password.
 *
 * Pemisahan ini diuji `npm run uji:pg-login`.
 *
 * ⚠️ PORTAL TIDAK PERNAH MENYIMPAN PASSWORD PERUSAHAAN.
 *
 * Verifikasinya selalu balik ke fungsi di PostgreSQL, yang mengembalikan uuid
 * atau kosong. Hash-nya tidak pernah keluar dari database. Akibat bagusnya:
 * kalau karyawan ganti password di sistem mereka, portal ikut otomatis.
 */
import { Pool } from "pg";

const KUNCI = Symbol.for("portal.db.login-perusahaan");
type Global = typeof globalThis & { [KUNCI]?: Pool };

export function poolLoginPerusahaan(): Pool {
  const g = globalThis as Global;
  if (!g[KUNCI]) {
    const host = process.env.DEMO_PG_HOST;
    const sandi = process.env.DEMO_PG_LOGIN_PASSWORD;
    if (!host || !sandi) {
      throw new Error(
        "DEMO_PG_HOST / DEMO_PG_LOGIN_PASSWORD belum diisi di .env.local. " +
          "Login akun perusahaan tidak bisa dipakai tanpa itu. " +
          "Jalankan `npm run buat:pg-login` lebih dulu.",
      );
    }
    const p = new Pool({
      host,
      port: Number(process.env.DEMO_PG_PORT ?? 5432),
      database: process.env.DEMO_PG_DATABASE,
      user: process.env.DEMO_PG_LOGIN_USER ?? "portal_login",
      password: sandi,
      // Kecil: jalur ini cuma dipakai saat login, bukan tiap permintaan.
      // Role-nya juga dibatasi 5 koneksi di sisi PostgreSQL.
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      // bcrypt memang lambat (itu gunanya), tapi 15 detik sudah kelewatan.
      statement_timeout: 15_000,
    });
    p.on("error", (e) => console.error("[login-perusahaan] pool error:", e.message));
    g[KUNCI] = p;
  }
  return g[KUNCI];
}

export type ProfilPerusahaan = {
  idEmployee: string;
  nama: string;
  jabatan: string;
  departemen: string;
};

/**
 * Verifikasi password ke database perusahaan.
 *
 * Mengembalikan `id_users` kalau cocok, `null` kalau tidak. `null` juga
 * dikembalikan waktu username-nya kembar -- lihat `buat-pg-login.mts`.
 */
export async function cekPasswordPerusahaan(
  username: string,
  password: string,
): Promise<string | null> {
  const h = await poolLoginPerusahaan().query<{ id: string | null }>(
    "SELECT cek_login_perusahaan($1, $2) AS id",
    [username, password],
  );
  return h.rows[0]?.id ?? null;
}

/** Semua profil karyawan yang menempel pada satu akun. Bisa lebih dari satu. */
export async function profilAkun(idUsers: string): Promise<ProfilPerusahaan[]> {
  const h = await poolLoginPerusahaan().query<{
    id_employee: string;
    nama: string;
    jabatan: string;
    departemen: string;
  }>(
    `SELECT id_employee, nama, jabatan, departemen
       FROM v_login_profil WHERE id_users = $1`,
    [idUsers],
  );
  return h.rows
    .map((r) => ({
      idEmployee: r.id_employee,
      nama: r.nama,
      jabatan: r.jabatan,
      departemen: r.departemen,
    }))
    // ⚠️ Diurutkan DI SINI, bukan lewat ORDER BY.
    //
    // `ORDER BY nama` memakai collation database, yang aturannya berbeda
    // dengan perbandingan teks JavaScript -- dan bisa berubah kalau setelan
    // server berubah. Untuk daftar yang dibaca orang di layar pemilih profil,
    // lebih baik urutannya ditentukan kode kita dan sama di mana pun.
    .sort((x, y) => x.nama.localeCompare(y.nama, "id"));
}

// ============================================================
// Pemetaan ke departemen & peran portal
// ============================================================

/**
 * Samakan bentuk teks sebelum dicocokkan.
 *
 * ⚠️ Perlu, bukan hiasan. Di database perusahaan ada dua baris `department`
 * untuk hal yang sama: `"HRD"` dan `"HRD "` (berspasi di belakang). Jabatan
 * juga: `"Recruitment Asst. Manager "`. Tanpa perapian, satu orang lolos dan
 * satu lagi tidak, tergantung apakah kita ingat TRIM().
 */
function rapikan(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Departemen perusahaan -> departemen portal.
 *
 * ⚠️ DAFTAR TETAP, BUKAN POLA.
 *
 * Pencocokan `ILIKE '%hr%'` akan ikut menyeret departemen lain yang kebetulan
 * mengandung "hr", dan `'%marketing%'` menyeret "Trade Marketing" tanpa ada
 * yang memutuskan. Di sini tiap pemetaan ditulis sadar dan bisa diperiksa.
 *
 * Lingkup yang disepakati 30 Sep 2026 (opsi A): 45 orang.
 * Departemen di luar daftar ini DITOLAK login -- bukan dianggap staf biasa.
 */
const DEPARTEMEN: Record<string, "marketing" | "hr" | "it"> = {
  marketing: "marketing",
  "trade marketing": "marketing",
  hrd: "hr",
  "hrd & ga": "hr",
  it: "it",
};

export function petakanDepartemen(namaDepartemen: string): "marketing" | "hr" | "it" | null {
  return DEPARTEMEN[rapikan(namaDepartemen)] ?? null;
}

/**
 * Jabatan yang berhak jadi `kepala`.
 *
 * ⚠️ DAFTAR-BOLEH, DAN INI YANG MENENTUKAN SIAPA BISA MENYETUJUI LEMBUR.
 *
 * Godaannya memakai regex `/(manager|head|kepala|spv)/i`. Jangan: ada 156
 * judul jabatan berbeda di database yang mengandung kata-kata itu, dan
 * sebagian bukan atasan sungguhan. Salah menaikkan satu orang berarti dia
 * bisa menyetujui lembur orang lain.
 *
 * Daftar ini disusun dari 45 orang yang benar-benar masuk lingkup, lalu
 * disetujui satu per satu (30 Sep 2026).
 *
 * Yang TIDAK masuk walau kedengaran seperti pimpinan, dan itu disengaja:
 *   "Team Leader Makassar" / "TL Makassar" -- dua orang, jabatan sama ditulis
 *      dua cara. Memimpin tim belum tentu berwenang menyetujui lembur.
 *   "Web Devlp. Maint. & Design Sptd." -- `Sptd` mungkin Superintendent, tapi
 *      menaikkan orang berdasarkan tebakan singkatan itu ceroboh.
 * Kalau ternyata mereka memang atasan, pindahkan ke daftar ini.
 */
const JABATAN_KEPALA = new Set<string>(
  [
    // HR
    "GM HRD",
    "Senior HR Manager",
    "Recruitment Asst. Manager",
    // IT / helpdesk
    "Head of IT & SCM",
    "IT Manager",
    "IT Helpdesk Lead",
    "Progamer Mgr",
    // Marketing
    "Head of Marketing",
    "Head of Promotion",
    "Brand Manager",
    "Group Brand Manager",
    "E Commerce Manager",
    "Corp. PR. Manager",
    "Busdes & YPI Manager",
    "Kontrol Budget Marketing Manager",
    "Manager Event & Design",
    "Asst. Sales & Distribution Export Mgr.",
  ].map(rapikan),
);

/** Jabatan -> peran portal. Yang tidak dikenal jadi `staf`, bukan `kepala`. */
export function petakanPeran(jabatan: string): "staf" | "kepala" {
  return JABATAN_KEPALA.has(rapikan(jabatan)) ? "kepala" : "staf";
}

export type HasilProfil =
  | { ok: true; departemen: "marketing" | "hr" | "it"; peran: "staf" | "kepala" }
  | { ok: false; sebab: "departemen-di-luar-lingkup"; departemen: string };

/**
 * Apakah profil ini boleh masuk portal, dan sebagai apa.
 *
 * Gagal-menolak: departemen yang tidak ada di daftar TIDAK diloloskan sebagai
 * staf. Portal memilih agent, user database, dan daftar view berdasarkan
 * departemen -- menebaknya berarti memberi orang akses yang salah.
 */
export function nilaiProfil(p: ProfilPerusahaan): HasilProfil {
  const dep = petakanDepartemen(p.departemen);
  if (!dep) {
    return { ok: false, sebab: "departemen-di-luar-lingkup", departemen: p.departemen };
  }
  return { ok: true, departemen: dep, peran: petakanPeran(p.jabatan) };
}
