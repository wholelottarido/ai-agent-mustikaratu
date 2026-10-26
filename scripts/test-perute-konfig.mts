/**
 * Uji PERUTE jalur konfigurasi — apakah dia meneruskan, atau menjawab sendiri.
 *
 *   npm run test:perute
 *   npm run test:perute -- --model claude-sonnet-5
 *
 * HANYA MEMBACA. Memanggil model sungguhan, jadi ~30 detik per kasus.
 *
 * ============================================================
 * ⚠️ KENAPA TERPISAH DARI `test:routing`
 * ============================================================
 * `test:routing` menguji jalur LAMA: satu agent departemen yang memegang
 * `query_perusahaan` dan `cari_sop` langsung. Tidak ada perute di sana.
 *
 * Jalur konfigurasi punya lapisan yang tidak dimiliki jalur lama: agent UMUM
 * yang tidak punya tool apa pun dan harus memilih MENDELEGASIKAN. Lapisan itu
 * tidak pernah diuji — dan di situlah bug 21 Okt 2026 bersembunyi.
 *
 * ============================================================
 * BUG YANG DIJAGA BERKAS INI (21 Okt 2026)
 * ============================================================
 * Pertanyaan "Bagaimana cara mengajukan cuti?" dijawab perute sendiri:
 * "tidak dapat didelegasikan ke agent yang ada". `cari_sop` tidak pernah
 * dipanggil, padahal dokumennya ADA — `cariSop()` langsung menemukannya di
 * peringkat 1 dengan skor 0,846.
 *
 * Sebabnya aturan perute cuma menyebut "pertanyaan tentang DATA". Pertanyaan
 * PROSEDUR tidak disebut sama sekali, jadi perute menyimpulkan sendiri — dan
 * menyimpulkan salah.
 *
 * ⚠️ QWEN **DAN** HAIKU GAGAL SAMA PERSIS. Itu yang membuktikan ini lubang
 * instruksi, bukan kelemahan model. Karena itu uji ini default-nya Haiku:
 * kalau model yang lebih kuat pun lolos, model lain belum tentu — tapi kalau
 * Haiku GAGAL, pasti instruksinya yang salah.
 *
 * ============================================================
 * ⚠️ YANG DIPERIKSA: DELEGASINYA, BUKAN SUSUNAN KALIMATNYA
 * ============================================================
 * Penanda yang mencocokkan kalimat penolakan sudah dua kali terbukti rapuh di
 * proyek ini (lihat catatan `test:routing` 2 Okt). Model menyusun penolakan
 * dengan kata berbeda tiap kali dijalankan.
 *
 * Yang dipakai di sini penanda STRUKTURAL: apakah `delegate_task` dipanggil.
 * Itu tidak bergantung pada susunan kalimat sama sekali.
 */
import { siapkanAgent } from "../voltagent/jalur-agent.ts";
import { KUNCI_MODEL, KUNCI_SALURAN } from "../voltagent/agents.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

const argModel = process.argv.indexOf("--model");
const MODEL = argModel > -1 ? process.argv[argModel + 1] : "claude-haiku-4-5";

type Kasus = {
  nama: string;
  tanya: string;
  /** `true` = WAJIB mendelegasikan. `false` = boleh dijawab sendiri. */
  wajibDelegasi: boolean;
};

const KASUS: Kasus[] = [
  {
    // ⚠️ KASUS UTAMA — kegagalan 21 Okt 2026 yang sebenarnya terjadi.
    nama: "prosedur: cara mengajukan cuti",
    tanya: "Bagaimana cara mengajukan cuti?",
    wajibDelegasi: true,
  },
  {
    nama: "prosedur: syarat lembur",
    tanya: "Apa syaratnya mengajukan lembur?",
    wajibDelegasi: true,
  },
  {
    // Bentuk lain dari pertanyaan prosedur. Ditambahkan supaya perbaikannya
    // tidak cuma menghafal dua kalimat di atas.
    nama: "prosedur: berapa lama prosesnya",
    tanya: "Berapa lama proses pembuatan email baru untuk karyawan?",
    wajibDelegasi: true,
  },
  {
    // Pertanyaan DATA — ini sudah benar sebelum perbaikan. Ada sebagai
    // penyeimbang: perbaikan yang membuat perute mendelegasikan SEGALANYA
    // tidak lebih baik daripada yang tidak mendelegasikan apa pun.
    nama: "data: tiket saya",
    tanya: "Tiket helpdesk saya ada berapa?",
    wajibDelegasi: true,
  },
  {
    // ⚠️ PENYEIMBANG YANG SEBENARNYA. Sapaan tidak perlu didelegasikan —
    // kalau ini pun didelegasikan, berarti perute berhenti menilai sama
    // sekali, dan tiap "halo" membangunkan agent aplikasi beserta
    // belasan tool-nya.
    nama: "sapaan: tidak perlu delegasi",
    tanya: "Halo, kamu bisa bantu apa saja?",
    wajibDelegasi: false,
  },
];

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

// Akun uji yang sudah ada. `idEmployee` harus NYATA — jalur konfigurasi jatuh
// ke jalur lama kalau sesinya tidak terpetakan, dan ujinya jadi menguji yang
// salah tanpa ada tanda apa pun.
const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
  `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
    WHERE lower(u.username) = 'dafi@mustika-ratu.co.id' LIMIT 1`);
if (rows.length === 0) throw new Error("akun uji dafi@mustika-ratu.co.id tidak ada");

const jalur = await siapkanAgent(rows[0].id_employee);
if (jalur.jalur !== "konfigurasi") {
  console.log(`JALUR KONFIGURASI TIDAK AKTIF — ${jalur.sebab}`);
  console.log("Uji ini khusus perute jalur konfigurasi; tidak ada yang bisa diuji.");
  await poolPerusahaan().end();
  process.exit(1);
}

console.log(`model: ${MODEL} · ${jalur.bawahan.length} agent aplikasi · ${KASUS.length} kasus\n`);

for (const k of KASUS) {
  const mulai = Date.now();
  let alat = new Set<string>();
  let teks = "";
  try {
    const r = (await jalur.agent.generateText(k.tanya, {
      context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" },
    })) as { text?: string; steps?: { toolCalls?: { toolName: string }[] }[] };
    teks = String(r.text ?? "");
    for (const s of r.steps ?? []) for (const c of s.toolCalls ?? []) alat.add(c.toolName);
  } catch (e) {
    console.log(`\n### ${k.nama}\n  GALAT ${(e as Error).message.slice(0, 140)}`);
    gagal++;
    continue;
  }

  const detik = ((Date.now() - mulai) / 1000).toFixed(0);
  const delegasi = alat.has("delegate_task");
  console.log(`\n### ${k.nama}  (${detik} dtk)`);
  console.log(`  tanya : "${k.tanya}"`);
  console.log(`  alat  : ${[...alat].join(", ") || "(tidak ada)"}`);
  console.log(`  jawab : ${teks.replace(/\s+/g, " ").slice(0, 110)}`);

  cek(
    k.wajibDelegasi ? `${k.nama}: MENDELEGASIKAN` : `${k.nama}: tidak perlu delegasi`,
    delegasi === k.wajibDelegasi,
    delegasi ? "delegate_task dipanggil" : "dijawab sendiri",
  );
}

await poolPerusahaan().end();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
