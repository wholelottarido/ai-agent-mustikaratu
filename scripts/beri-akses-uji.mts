/**
 * Memberi akun UJI akses ke aplikasi internal, supaya agent per aplikasi bisa
 * dicoba sungguhan.
 *
 *   npm run akses:uji            -> beri akses ke semua aplikasi internal aktif
 *   npm run akses:uji -- --maps  -> MAPS saja (plus Portal)
 *   npm run akses:uji -- --batal -> kembalikan persis seperti semula
 *
 * ⚠️ MENULIS KE `users_config` DI DATABASE PERUSAHAAN — konfigurasi akun
 * SUNGGUHAN, bukan data uji.
 *
 * ============================================================
 * KENAPA `roles` DIBIARKAN KOSONG
 * ============================================================
 * Yang dibutuhkan agent cuma `app_id`: `lib/akses-aplikasi.ts` membaca itu
 * saja untuk menentukan agent mana yang dipasang. `roles` menentukan hak di
 * APLIKASI SUNGGUHAN-nya — menu apa yang terbuka, tombol apa yang bisa
 * ditekan.
 *
 * Kalau role ikut diberikan, akun ini bukan cuma bisa bertanya ke agent MAPS,
 * tapi juga bisa membuka MAPS sungguhan dan menekan tombolnya. Untuk dua
 * aplikasi malah tidak ada pilihan yang ringan: Admin Console dan Report cuma
 * punya role `Super Admin` (CRUD). Jadi "beri akses supaya agent-nya bisa
 * dicoba" akan diam-diam berarti "beri hak Super Admin di panel konfigurasi".
 *
 * Itu jauh lebih besar daripada yang diminta. Jadi di sini `roles: []`:
 * agent-nya terbuka, hak di aplikasi aslinya TIDAK diberikan. Kalau memang
 * perlu bisa membuka aplikasinya juga, itu permintaan ke admin aplikasi
 * masing-masing, bukan sesuatu yang pantas ditulis skrip ini.
 *
 * ============================================================
 * CARA MEMBATALKAN
 * ============================================================
 * Isi `apps_config` sebelum diubah disalin ke `data/akses-uji-cadangan.json`.
 * `--batal` mengembalikannya persis, termasuk menghapus barisnya lagi kalau
 * memang sebelumnya tidak ada.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client, type QueryResultRow } from "pg";

/**
 * Daftar-boleh akun yang boleh disentuh skrip ini.
 *
 * Tetap daftar-boleh, bukan argumen bebas: skrip yang menulis pemberian akses
 * tidak boleh bisa diarahkan ke akun sungguhan mana pun cuma dengan mengganti
 * argumen. Yang ada di sini keduanya akun uji buatan
 * `npm run uji:akun`.
 */
const AKUN_BOLEH: Record<string, string> = {
  ridho: "ridho@mustika-ratu.co.id",
  dafi: "dafi@mustika-ratu.co.id",
};
const kunciAkun = process.argv.slice(2).find((x) => !x.startsWith("--")) ?? "ridho";
const AKUN = AKUN_BOLEH[kunciAkun];
if (!AKUN) {
  console.error(`DITOLAK: akun "${kunciAkun}" di luar daftar-boleh (${Object.keys(AKUN_BOLEH).join(", ")}).`);
  process.exit(1);
}

// Cadangan per akun -- satu berkas bersama berarti memulihkan akun kedua
// akan menimpa jalan pulang akun pertama.
const CADANGAN = join(process.cwd(), "data", `akses-uji-cadangan-${kunciAkun}.json`);
const APP_PORTAL = "b1952feb-2114-4892-a8f9-fab1ccc17469";
const APP_MAPS = "84480b32-4c93-46da-96c4-59ddf2308a5a";

const batal = process.argv.includes("--batal");
const hanyaMaps = process.argv.includes("--maps");

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
  connectionTimeoutMillis: 15_000,
});
await c.connect();
// `<T,>` bukan salah ketik: di berkas .mts, `<T>` terbaca sebagai awalan JSX.
const q = async <T extends QueryResultRow,>(s: string, p: unknown[] = []) =>
  (await c.query<T>(s, p)).rows;
console.log(`tersambung sebagai: ${(await q<{ current_user: string }>("SELECT current_user"))[0].current_user}`);

const pengguna = await q<{ id_users: string }>(
  `SELECT id_users FROM users WHERE lower(username) = $1`, [AKUN]);
if (pengguna.length === 0) { console.error(`DITOLAK: akun ${AKUN} tidak ada.`); await c.end(); process.exit(1); }
if (pengguna.length > 1) {
  // `users` tidak punya batasan unik pada username -- tiga akun punya dua
  // baris. Menebak salah satunya berarti memberi akses ke baris yang salah.
  console.error(`DITOLAK: ${AKUN} punya ${pengguna.length} baris di users. Sebutkan id_users-nya manual.`);
  await c.end(); process.exit(1);
}
const idUsers = pengguna[0].id_users;
console.log(`akun     : ${AKUN} (${idUsers})`);

const sebelum = await q<{ apps_config: unknown }>(
  `SELECT apps_config FROM users_config WHERE id_users = $1`, [idUsers]);
const adaSebelumnya = sebelum.length > 0;
const jumlahSebelum = adaSebelumnya
  ? (((sebelum[0].apps_config as { apps?: unknown[] } | null)?.apps ?? []).length)
  : 0;
console.log(`sekarang : ${adaSebelumnya ? `${jumlahSebelum} aplikasi` : "belum punya baris users_config"}`);

try {
  if (batal) {
    if (!existsSync(CADANGAN)) {
      console.error(`DITOLAK: ${CADANGAN} tidak ada — tidak tahu harus dikembalikan ke apa.`);
      await c.end(); process.exit(1);
    }
    const cad = JSON.parse(await readFile(CADANGAN, "utf8")) as { idUsers: string; ada: boolean; apps_config: unknown };
    if (cad.idUsers !== idUsers) {
      console.error(`DITOLAK: cadangan ini milik id_users lain (${cad.idUsers}).`);
      await c.end(); process.exit(1);
    }
    if (cad.ada) {
      await q(`UPDATE users_config SET apps_config = $2::jsonb, updated_at = now() WHERE id_users = $1`,
        [idUsers, JSON.stringify(cad.apps_config)]);
      console.log(`dikembalikan ke isi semula (${((cad.apps_config as { apps?: unknown[] })?.apps ?? []).length} aplikasi)`);
    } else {
      await q(`DELETE FROM users_config WHERE id_users = $1`, [idUsers]);
      console.log("baris users_config dihapus lagi — sebelumnya memang tidak ada");
    }
    await rm(CADANGAN, { force: true });
  } else {
    // Cadangan ditulis SEBELUM apa pun diubah. Kalau langkah berikutnya gagal,
    // yang hilang bukan jalan pulangnya.
    await mkdir(join(process.cwd(), "data"), { recursive: true });
    await writeFile(CADANGAN, JSON.stringify(
      { akun: AKUN, idUsers, ada: adaSebelumnya, apps_config: adaSebelumnya ? sebelum[0].apps_config : null, pada: new Date().toISOString() },
      null, 2), "utf8");
    console.log(`cadangan : ${CADANGAN}`);

    const daftar = await q<{ id_apps: string; apps_name: string; apps_path: string | null; apps_description: string | null; apps_image: string | null }>(
      `SELECT id_apps, apps_name, apps_path, apps_description, apps_image
         FROM apps WHERE is_active AND is_internal
          AND ($1::boolean IS NOT TRUE OR id_apps IN ($2::uuid, $3::uuid))
        ORDER BY apps_name`, [hanyaMaps, APP_PORTAL, APP_MAPS]);

    const apps = daftar.map((a) => ({
      app_id: a.id_apps,
      apps_name: a.apps_name,
      apps_path: a.apps_path ?? "",
      apps_image: a.apps_image ?? "",
      apps_description: a.apps_description ?? "",
      // ⚠️ SENGAJA KOSONG. Lihat catatan panjang di kepala berkas.
      roles: [] as unknown[],
    }));

    await q(
      `INSERT INTO users_config (id_users, apps_config, created_at, updated_at)
       VALUES ($1, $2::jsonb, now(), now())
       ON CONFLICT (id_users) DO UPDATE SET apps_config = EXCLUDED.apps_config, updated_at = now()`,
      [idUsers, JSON.stringify({ apps })]);

    console.log(`\ndiberikan: ${apps.length} aplikasi (roles kosong — agent terbuka, hak di aplikasinya tidak)`);
    for (const a of apps) console.log(`  ${a.apps_name}`);
  }
} catch (e) {
  console.error(`\nGAGAL: ${(e as Error).message}`);
  await c.end();
  process.exit(1);
}

const sesudah = await q<{ n: number }>(
  `SELECT jsonb_array_length(COALESCE(apps_config->'apps','[]'::jsonb))::int n
     FROM users_config WHERE id_users = $1`, [idUsers]);
console.log(`\nsesudah  : ${sesudah.length ? `${sesudah[0].n} aplikasi` : "tidak punya baris users_config"}`);
await c.end();
