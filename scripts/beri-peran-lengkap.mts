/**
 * Memberi akun ridho peran terlengkap di tiap aplikasi yang punya alat AI,
 * supaya semua alat lolos gerbang izin portal.
 *
 *   npx tsx --env-file=.env.local scripts/beri-peran-lengkap.mts --coba        (uji coba, tidak menyimpan)
 *   npx tsx --env-file=.env.local scripts/beri-peran-lengkap.mts               (menyimpan)
 *   npx tsx --env-file=.env.local scripts/beri-peran-lengkap.mts --batal <berkas-cadangan>
 *
 * ⚠️ MENULIS KE DATABASE PERUSAHAAN (`users_config`) memakai `DEMO_PG_ADMIN_*`.
 * Diizinkan eksplisit oleh user 26 Nov 2026 ("Tahap 1": peran per tabel di bawah,
 * termasuk menambah aplikasi Upload DIS dan PickPack).
 *
 * ⚠️ Peran ini berlaku di aplikasi perusahaan yang SUNGGUHAN, bukan cuma di
 * gerbang izin portal: Super Admin membawa hak hapus di aplikasinya.
 *
 * Cara aman yang dipakai:
 * - Satu transaksi, baris dikunci (`FOR UPDATE`).
 * - Isi lama disalin ke `data/peran-lengkap-cadangan-ridho-<waktu>.json`, tidak pernah ditimpa.
 * - Hanya MENAMBAH peran / entri aplikasi. Entri lain dibandingkan sebelum-sesudah;
 *   kalau ada yang berubah selain sasaran, transaksi dibatalkan.
 * - Peran & aplikasi dicari lewat NAMA ke tabel `roles`/`apps` dan harus tepat satu
 *   yang aktif; kalau tidak, berhenti tanpa menulis.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

const USERNAME = "ridho@mustika-ratu.co.id";
const SASARAN: { app: string; peran: string }[] = [
  { app: "Approval", peran: "Super Admin" },
  { app: "Confirm Weekly Order Distributor", peran: "Super Admin" },
  { app: "MAPS", peran: "MAPS - Budget Control" },
  { app: "Marketing", peran: "Super Admin" },
  { app: "Report", peran: "Super Admin" },
  { app: "Super Tools", peran: "Super Admin" },
  { app: "Upload DIS", peran: "Super Admin" },
  { app: "PickPack", peran: "Super Admin" },
];

const coba = process.argv.includes("--coba");
const iBatal = process.argv.indexOf("--batal");
const berkasBatal = iBatal >= 0 ? process.argv[iBatal + 1] : undefined;

type Entri = Record<string, unknown> & { app_id?: string; apps_name?: string; roles?: { role_id: string; role_name?: string }[] };

const c = new Client({
  host: process.env.DEMO_PG_HOST,
  port: Number(process.env.DEMO_PG_PORT ?? 5432),
  database: process.env.DEMO_PG_DATABASE,
  user: process.env.DEMO_PG_ADMIN_USER,
  password: process.env.DEMO_PG_ADMIN_PASSWORD,
});
await c.connect();

async function selesai(kode: number): Promise<never> {
  await c.end();
  process.exit(kode);
}

const { rows: u } = await c.query<{ id_users: string }>(
  `SELECT u.id_users FROM users u JOIN users_config uc ON uc.id_users = u.id_users WHERE lower(u.username) = $1`,
  [USERNAME],
);
if (u.length !== 1) {
  console.error(`DITOLAK: ${USERNAME} punya ${u.length} baris users_config (harus tepat 1).`);
  await selesai(1);
}
const idUsers = u[0].id_users;

if (berkasBatal) {
  const cad = JSON.parse(await readFile(berkasBatal, "utf8")) as { idUsers: string; apps_config: unknown };
  if (cad.idUsers !== idUsers) {
    console.error("DITOLAK: cadangan ini milik akun lain.");
    await selesai(1);
  }
  await c.query(`UPDATE users_config SET apps_config = $2::jsonb, updated_at = now() WHERE id_users = $1`,
    [idUsers, JSON.stringify(cad.apps_config)]);
  console.log(`${USERNAME}: apps_config dikembalikan dari ${berkasBatal}.`);
  await selesai(0);
}

await c.query("BEGIN");
try {
  const { rows: kini } = await c.query<{ apps_config: { apps?: Entri[] } }>(
    `SELECT apps_config FROM users_config WHERE id_users = $1 FOR UPDATE`, [idUsers]);
  const asli = kini[0].apps_config ?? { apps: [] };
  const konfig = JSON.parse(JSON.stringify(asli)) as { apps: Entri[] };
  if (!Array.isArray(konfig.apps)) konfig.apps = [];

  const catatan: string[] = [];
  const disentuh = new Set<string>();

  for (const s of SASARAN) {
    const { rows: app } = await c.query<{ id_apps: string; apps_name: string; apps_path: string | null; apps_image: string | null; apps_description: string | null }>(
      `SELECT id_apps, apps_name, apps_path, apps_image, apps_description FROM apps WHERE apps_name = $1 AND is_active`, [s.app]);
    if (app.length !== 1) throw new Error(`aplikasi "${s.app}": ${app.length} baris aktif (harus 1)`);
    const a = app[0];
    const { rows: rl } = await c.query<{ id_roles: string; hapus: number }>(
      `SELECT r.id_roles,
              (SELECT count(DISTINCT k) FROM role_menu rm, unnest(rm.permissions) k WHERE rm.id_roles = r.id_roles AND k LIKE '%:delete')::int AS hapus
         FROM roles r WHERE r.id_apps = $1 AND r.roles = $2 AND r.is_active`, [a.id_apps, s.peran]);
    if (rl.length !== 1) throw new Error(`peran "${s.peran}" di ${s.app}: ${rl.length} baris aktif (harus 1)`);
    const peran = { role_id: rl[0].id_roles, role_name: s.peran };

    // Entri yang sudah ada dicocokkan lewat app_id; kalau ada lebih dari satu, semuanya diberi peran
    // (bentuk lama `{app_id, roles}` bisa berdampingan dengan bentuk lengkap).
    const cocok = konfig.apps.filter((e) => e.app_id === a.id_apps);
    if (cocok.length === 0) {
      konfig.apps.push({
        app_id: a.id_apps,
        apps_name: a.apps_name,
        apps_path: a.apps_path ?? "",
        apps_image: a.apps_image ?? "",
        apps_description: a.apps_description ?? "",
        roles: [peran],
      });
      catatan.push(`+ aplikasi baru ${s.app} dengan peran "${s.peran}" (${rl[0].hapus} hak hapus)`);
    } else {
      for (const e of cocok) {
        const lama = Array.isArray(e.roles) ? e.roles : [];
        if (lama.some((r) => r.role_id === peran.role_id)) {
          catatan.push(`= ${s.app}: sudah punya "${s.peran}", dilewati`);
          continue;
        }
        e.roles = [...lama, peran];
        catatan.push(`+ ${s.app}: tambah peran "${s.peran}" (${rl[0].hapus} hak hapus)`);
      }
    }
    disentuh.add(a.id_apps);
  }

  // Penjaga: entri yang bukan sasaran harus persis sama seperti sebelumnya.
  const lainSebelum = JSON.stringify((asli.apps ?? []).filter((e) => !disentuh.has(e.app_id ?? "")));
  const lainSesudah = JSON.stringify(konfig.apps.filter((e) => !disentuh.has(e.app_id ?? "")));
  if (lainSebelum !== lainSesudah) throw new Error("entri aplikasi lain ikut berubah — dibatalkan");
  // Penjaga: tidak ada peran lama yang hilang.
  const peranSebelum = (asli.apps ?? []).flatMap((e) => (e.roles ?? []).map((r) => `${e.app_id}|${r.role_id}`));
  const peranSesudah = new Set(konfig.apps.flatMap((e) => (e.roles ?? []).map((r) => `${e.app_id}|${r.role_id}`)));
  if (peranSebelum.some((x) => !peranSesudah.has(x))) throw new Error("ada peran lama yang hilang — dibatalkan");

  console.log(catatan.join("\n"));
  console.log(`\nEntri aplikasi: ${(asli.apps ?? []).length} -> ${konfig.apps.length}`);

  if (coba) {
    await c.query("ROLLBACK");
    console.log("\nUJI COBA: tidak ada yang disimpan.");
    await selesai(0);
  }

  await mkdir(join(process.cwd(), "data"), { recursive: true });
  const waktu = new Date().toISOString().replace(/[:.]/g, "-");
  const cadangan = join(process.cwd(), "data", `peran-lengkap-cadangan-ridho-${waktu}.json`);
  await writeFile(cadangan, JSON.stringify({ idUsers, username: USERNAME, apps_config: asli }, null, 2), { flag: "wx" });

  await c.query(`UPDATE users_config SET apps_config = $2::jsonb, updated_at = now() WHERE id_users = $1`,
    [idUsers, JSON.stringify(konfig)]);
  await c.query("COMMIT");
  console.log(`\nDISIMPAN. Cadangan: ${cadangan}`);

  const { rows: izin } = await c.query<{ n: number }>(
    `SELECT count(DISTINCT k)::int n
       FROM users_config uc
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(uc.apps_config->'apps','[]'::jsonb)) ap
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ap->'roles','[]'::jsonb)) rr
       JOIN role_menu rm ON rm.id_roles = (rr->>'role_id')::uuid
       CROSS JOIN LATERAL unnest(COALESCE(rm.permissions,'{}')) AS k
      WHERE uc.id_users = $1`, [idUsers]);
  console.log(`Jumlah izin akun sekarang: ${izin[0].n}`);
  console.log(`Untuk mengembalikan: npx tsx --env-file=.env.local scripts/beri-peran-lengkap.mts --batal "${cadangan}"`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error("DIBATALKAN, tidak ada yang disimpan:", (e as Error).message);
  await selesai(1);
}
await selesai(0);
