/**
 * Identitas dan akses aplikasi seorang karyawan, untuk menentukan agent mana
 * yang boleh dipanggilnya.
 *
 * Sesi portal kita cuma menyimpan `idEmployee`. Yang dibutuhkan jalur
 * konfigurasi lebih dari itu: `id_department` dan `id_company` untuk penyaring
 * cakupan, `id_users` untuk membaca daftar aplikasi.
 *
 * ============================================================
 * DARI MANA DAFTAR APLIKASINYA
 * ============================================================
 * `users_config.apps_config` — jsonb berbentuk
 * `{"apps":[{"app_id":"...","apps_name":"...","roles":[...],"menus":[...]}]}`.
 * Itu satu-satunya pemberian akses aplikasi per orang yang ada di database.
 * `roles` dan `role_menu` menentukan izin DI DALAM aplikasi, bukan aplikasi
 * mana yang terbuka. `users_app_activity` cuma catatan pemakaian.
 *
 * ⚠️ DIBACA LEWAT `id_users` DARI BARIS `employee`, BUKAN LEWAT USERNAME.
 *
 * `users` TIDAK punya batasan unik pada `username`: tiga username punya dua
 * baris (`magangit@`, `puji.lestari@`, `bilqis.shyalimar@`), dan untuk
 * `magangit@` kedua barisnya aktif — yang satu punya 2 karyawan, yang satu
 * tidak punya karyawan sama sekali. Mencari akses lewat username berarti
 * memilih salah satu dari dua baris itu secara untung-untungan.
 *
 * ============================================================
 * DITAMPILKAN ≠ BISA DIAKSES
 * ============================================================
 * Layar Apps portal menampilkan SEMUA aplikasi, termasuk yang tidak bisa
 * dibuka pemakainya. Yang menentukan bisa-tidaknya adalah role dan akun —
 * yaitu `apps_config` ini. Jadi 8 kartu di layar bukan 8 aplikasi yang
 * terbuka; kartu yang bukan haknya tetap terlihat supaya pemakai tahu
 * fiturnya ada dan bisa memintanya.
 *
 * Ditegaskan pemilik portal, 7 Okt 2026. Pola yang sama dipakai di daftar
 * agent: agent aplikasi yang terkunci tetap ditampilkan, tidak disembunyikan.
 *
 * ⚠️ PORTAL SELALU TERBUKA, dan itu bukan kelonggaran.
 *
 * Siapa pun yang bisa login ada DI DALAM Portal — itu gerbangnya. Jadi agent
 * Portal (tiket helpdesk, aset, profil) terbuka untuk semua, apa pun isi
 * `apps_config`-nya.
 *
 * Tanpa aturan ini, 1.133 dari 1.958 karyawan — 58%, yang tidak punya baris
 * `users_config` sama sekali — tidak akan punya satu pun agent, termasuk yang
 * paling berguna buat mereka. Dan itu salah: mereka memang bisa membuka
 * Portal.
 */
import { poolPerusahaan } from "./db-perusahaan";
import { petakanDepartemen } from "./login-perusahaan";
import type { SesiPemakai } from "@/voltagent/tool-konfigurasi";

/** Bentuk uuid, diperiksa sebelum di-cast supaya nilai sampah tidak melempar. */
const UUID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

/**
 * `apps.id_apps` milik Portal — gerbang yang dipakai semua orang.
 *
 * Ditulis sebagai tetapan, bukan dicari lewat nama: "Portal" sebagai teks bisa
 * diubah administrator kapan saja, dan aturan "selalu terbuka" tidak boleh
 * ikut berpindah ke aplikasi lain cuma karena ada yang mengganti nama.
 *
 * Kalau baris ini hilang atau dinonaktifkan, dia TIDAK diam-diam diberikan —
 * alasannya masuk ke `diabaikan`.
 */
export const APP_PORTAL = "b1952feb-2114-4892-a8f9-fab1ccc17469";

export type AksesPemakai = {
  sesi: SesiPemakai;
  /**
   * `id_apps` yang benar-benar ada di tabel `apps` DAN masih aktif.
   * Portal selalu ada di urutan pertama — lihat `APP_PORTAL`.
   */
  apps: string[];
  /**
   * Yang disebut `apps_config` tapi tidak dipakai, beserta sebabnya.
   *
   * Bukan hiasan log: 433 baris konfigurasi menunjuk satu `app_id` yang sudah
   * tidak ada di tabel `apps`, dan enam di antaranya menamainya "Portal".
   * Besar kemungkinan itu id Portal yang lama. Dibuang di sini — menebak
   * bahwa id lama berarti Portal yang sekarang adalah memberi akses yang
   * tidak pernah ditulis siapa pun.
   */
  diabaikan: { id: string; nama: string | null; sebab: string }[];
};

type Baris = {
  id_employee: string;
  id_users: string | null;
  id_department: string | null;
  nama_departemen: string | null;
  id_company: string | null;
  app_id: string | null;
  app_nama: string | null;
  dikenal: boolean | null;
  aktif: boolean | null;
  portal_aktif: boolean | null;
};

/**
 * Identitas + aplikasi yang terbuka untuk satu karyawan.
 *
 * `undefined` kalau `id_employee`-nya tidak ada. Karyawan yang ada tapi tanpa
 * pemberian aplikasi TETAP mengembalikan hasil, dengan `apps` kosong — itu
 * keadaan yang sah dan harus bisa dibedakan dari "orangnya tidak ada".
 */
export async function aksesUntukEmployee(idEmployee: string): Promise<AksesPemakai | undefined> {
  if (!new RegExp(UUID).test(idEmployee)) return undefined;

  const { rows } = await poolPerusahaan().query<Baris>(
    `SELECT e.id_employee, e.id_users, e.id_department, e.id_company,
            dep.name AS nama_departemen,
            x->>'app_id'    AS app_id,
            x->>'apps_name' AS app_nama,
            (a.id_apps IS NOT NULL) AS dikenal,
            a.is_active             AS aktif,
            (SELECT p.is_active FROM apps p WHERE p.id_apps = $3::uuid) AS portal_aktif
       FROM employee e
       LEFT JOIN department dep ON dep.id_department = e.id_department
       LEFT JOIN users_config uc ON uc.id_users = e.id_users
       LEFT JOIN LATERAL jsonb_array_elements(COALESCE(uc.apps_config->'apps', '[]'::jsonb)) x ON true
       LEFT JOIN apps a ON x->>'app_id' ~ $2 AND a.id_apps = (x->>'app_id')::uuid
      WHERE e.id_employee = $1`,
    [idEmployee, UUID, APP_PORTAL],
  );

  if (rows.length === 0) return undefined;
  const r = rows[0];

  // ⚠️ IZIN DIAMBIL DARI PERAN DI `users_config`, BUKAN DARI DEPARTEMEN.
  //
  // Departemen menjawab "orang ini bagian apa"; izin menjawab "orang ini boleh
  // apa". Dua pertanyaan berbeda, dan menyamakannya berarti setiap orang IT
  // otomatis boleh segalanya di Portal.
  //
  // Ditarik terpisah karena `role_menu.permissions` bertipe `text[]`, bukan
  // jsonb seperti `apps_config` -- menggabungkannya ke query di atas sempat
  // gagal justru karena pencampuran dua tipe itu.
  const { rows: barisIzin } = await poolPerusahaan().query<{ kode: string }>(
    `SELECT DISTINCT k AS kode
       FROM employee e
       JOIN users_config uc ON uc.id_users = e.id_users
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(uc.apps_config->'apps', '[]'::jsonb)) ap
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ap->'roles', '[]'::jsonb)) rr
       JOIN role_menu rm ON rr->>'role_id' ~ $2 AND rm.id_roles = (rr->>'role_id')::uuid
       CROSS JOIN LATERAL unnest(COALESCE(rm.permissions, '{}')) AS k
      WHERE e.id_employee = $1`,
    [idEmployee, UUID],
  );
  const izin = barisIzin.map((x) => x.kode).sort();

  const apps: string[] = [];
  const diabaikan: AksesPemakai["diabaikan"] = [];

  // Portal lebih dulu: dia gerbangnya, dan urutan ini yang dilihat pemakai
  // waktu daftar agent ditampilkan.
  if (r.portal_aktif) apps.push(APP_PORTAL);
  else diabaikan.push({ id: APP_PORTAL, nama: "Portal", sebab: r.portal_aktif === null ? "baris Portal tidak ada di tabel apps" : "Portal tidak aktif" });
  for (const b of rows) {
    if (!b.app_id) continue; // LEFT JOIN tanpa satu pun aplikasi
    if (!b.dikenal) { diabaikan.push({ id: b.app_id, nama: b.app_nama, sebab: "app_id tidak ada di tabel apps" }); continue; }
    if (!b.aktif) { diabaikan.push({ id: b.app_id, nama: b.app_nama, sebab: "aplikasinya tidak aktif" }); continue; }
    if (!apps.includes(b.app_id)) apps.push(b.app_id);
  }

  return {
    sesi: {
      idEmployee: r.id_employee,
      idUsers: r.id_users,
      idDepartment: r.id_department,
      idCompany: r.id_company,
      // Nama departemen perusahaan dipetakan ke slug portal. Yang di luar
      // lingkup jadi `null` -- bukan dipaksa ke salah satu slug, karena itu
      // akan membuka dokumen departemen yang bukan miliknya.
      departemen: r.nama_departemen ? petakanDepartemen(r.nama_departemen) : null,
      // Nama aslinya ikut, TANPA dipetakan: ini dipakai memberi tahu model
      // data siapa yang sedang dia pegang, dan untuk itu yang berguna nama
      // yang dikenal manusia ("Trade Marketing"), bukan slug portal.
      namaDepartemen: r.nama_departemen,
      izin,
    },
    apps,
    diabaikan,
  };
}
