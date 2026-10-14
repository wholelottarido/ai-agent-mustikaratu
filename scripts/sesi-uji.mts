/**
 * Mengambil cookie sesi untuk akun uji, supaya halaman di balik login bisa
 * diperiksa tanpa membuka browser.
 *
 *   npm run sesi:uji
 *
 * Cookie-nya ditulis ke direktori sementara, BUKAN ke repo — isinya token
 * sesi yang sah, setara password selama belum kedaluwarsa.
 *
 * Password dibaca dari `UJI_AKUN_IT_PASSWORD` dan tidak pernah dicetak.
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.UJI_BASE ?? "http://localhost:3018";
const AKUN = "ridho@mustika-ratu.co.id";
/** Employee yang dipilih kalau akunnya punya lebih dari satu profil. */
const EMPLOYEE = process.argv[2] ?? "c8a9ca7a-9650-4694-a02f-ef45cdd35226";
const SIMPAN = join(tmpdir(), "sesi-uji-portal.txt");

const sandi = process.env.UJI_AKUN_IT_PASSWORD;
if (!sandi) { console.error("UJI_AKUN_IT_PASSWORD belum diisi di .env.local."); process.exit(1); }

const kirim = (body: unknown) =>
  fetch(`${BASE}/api/auth/login-perusahaan`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

let r: Response;
try { r = await kirim({ username: AKUN, password: sandi }); }
catch { console.error(`Tidak ada server di ${BASE}. Jalankan \`npx next dev -p 3018\` dulu.`); process.exit(1); }

let hasil = (await r.json()) as { selesai?: boolean; perluPilih?: boolean; token?: string; profil?: { idEmployee: string; nama: string; jabatan?: string }[]; error?: string };
if (!r.ok) { console.error(`Login gagal (${r.status}): ${hasil.error ?? "tanpa pesan"}`); process.exit(1); }

let kue = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

if (hasil.perluPilih) {
  console.log(`akun punya ${hasil.profil?.length ?? 0} profil:`);
  for (const p of hasil.profil ?? []) console.log(`  ${p.idEmployee}  ${p.nama}${p.jabatan ? ` — ${p.jabatan}` : ""}`);
  const r2 = await kirim({ token: hasil.token, idEmployee: EMPLOYEE });
  hasil = (await r2.json()) as typeof hasil;
  if (!r2.ok) { console.error(`Pilih profil gagal (${r2.status}): ${hasil.error ?? "tanpa pesan"}`); process.exit(1); }
  kue = (r2.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  console.log(`dipilih: ${EMPLOYEE}`);
}

if (!kue) { console.error("Login berhasil tapi tidak ada cookie sesi."); process.exit(1); }
await writeFile(SIMPAN, kue, "utf8");
console.log(`\ncookie sesi disimpan: ${SIMPAN}`);

const beranda = await fetch(`${BASE}/`, { headers: { cookie: kue }, redirect: "manual" });
console.log(`GET /  -> ${beranda.status}`);
