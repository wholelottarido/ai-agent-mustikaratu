/**
 * Mencoba jalur agent konfigurasi dengan model sungguhan.
 *
 *   npm run coba:konfig
 *   npm run coba:konfig -- "pertanyaan lain"
 *   npm run coba:konfig -- "pertanyaan" <id_employee>
 *
 * ⚠️ MEMANGGIL CLAUDE SUNGGUHAN. Berbiaya, walau kecil.
 *
 * Ini BUKAN uji regresi — tidak ada yang diasersi, dan hasilnya tidak selalu
 * sama. Gunanya satu: melihat jalur konfigurasi bekerja dari ujung ke ujung
 * dengan data sungguhan, sesuatu yang tidak bisa dibuktikan uji yang tidak
 * memanggil model.
 *
 * Yang dicetak di akhir bukan cuma jawaban, tapi juga TOOL YANG DIPANGGIL dan
 * pembandingnya dari query langsung. Jawaban yang kedengaran benar tapi tidak
 * memanggil tool apa pun adalah karangan, dan itu cuma kelihatan kalau
 * keduanya ditaruh bersebelahan.
 *
 * ⚠️ TIDAK LEWAT HTTP, jadi route, sesi, dan kuota TIDAK ikut teruji di sini.
 * Yang itu perlu MySQL portal hidup; lihat `scripts/test-dokumen-http.mts`
 * untuk polanya.
 */
import { siapkanAgent } from "../voltagent/jalur-agent.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";
import { KUNCI_MODEL, KUNCI_SALURAN } from "../voltagent/agents.ts";

const TANYA = process.argv[2] ?? "Tiket helpdesk saya yang belum selesai apa saja?";
const MODEL = process.env.COBA_MODEL ?? "claude-haiku-4-5";

// Saklarnya dinyalakan khusus untuk proses ini saja -- tidak menyentuh
// `.env.local`, jadi mencoba di sini tidak mengubah apa pun untuk orang lain.
process.env.JALUR_AGENT = "konfigurasi";

const pool = poolPerusahaan();

let idEmployee = process.argv[3];
if (!idEmployee) {
  // Orang yang punya tiket BELUM SELESAI, supaya jawabannya bisa dibandingkan.
  const [o] = (await pool.query<{ id_employee: string; n: number }>(
    `SELECT id_employee, count(*)::int n FROM v_ai_tiket_helpdesk
      WHERE status NOT IN ('CLOSED','RESOLVED','CANCELLED','REJECTED')
      GROUP BY 1 HAVING count(*) BETWEEN 2 AND 8 ORDER BY 2 DESC LIMIT 1`)).rows;
  if (!o) { console.log("Tidak ada karyawan dengan 2-8 tiket terbuka."); process.exit(1); }
  idEmployee = o.id_employee;
}

const [org] = (await pool.query<{ fullname: string; departemen: string | null }>(
  `SELECT e.fullname, d.name AS departemen FROM employee e
     LEFT JOIN department d ON d.id_department = e.id_department
    WHERE e.id_employee = $1`, [idEmployee])).rows;

const akses = await aksesUntukEmployee(idEmployee);
console.log(`orang   : ${org?.fullname} (${org?.departemen ?? "tanpa departemen"})`);
console.log(`akses   : ${akses?.apps.length ?? 0} aplikasi`);

const jalur = await siapkanAgent(idEmployee);
if (jalur.jalur !== "konfigurasi") {
  console.log(`\n⛔ Jatuh ke jalur lama: ${jalur.sebab}`);
  await pool.end();
  process.exit(1);
}
console.log(`agent   : ${jalur.bawahan.map((b) => `${b.kode}(${b.jumlahTool} tool)`).join(", ")}`);
if (jalur.dilewati.length) {
  console.log(`dilewati: ${jalur.dilewati.map((d) => d.kode).join(", ")}`);
}
console.log(`model   : ${MODEL}\n`);
console.log(`tanya   : ${TANYA}\n`);

const mulai = Date.now();
const r = (await jalur.agent.generateText(TANYA, {
  // Objek biasa, sama seperti `route.ts` dan `test-agent-routing.mts`.
  context: { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" },
})) as {
  text?: string;
  steps?: { toolCalls?: { toolName: string }[] }[];
  usage?: { inputTokens?: number; outputTokens?: number };
};

const dipakai = new Set<string>();
for (const s of r.steps ?? []) for (const c of s.toolCalls ?? []) dipakai.add(c.toolName);

console.log("─".repeat(70));
console.log(r.text ?? "(tidak ada teks)");
console.log("─".repeat(70));
// ⚠️ Yang terbaca di sini cuma langkah SUPERVISOR. Waktu router
// mendelegasikan, yang muncul `delegate_task` -- tool yang dipanggil agent
// aplikasi di bawahnya TIDAK ikut terekam di `steps` tingkat atas. Jadi
// "delegate_task" berarti pertanyaannya diteruskan, bukan berarti tidak ada
// tool data yang dipakai.
console.log(`\ntool dipanggil : ${[...dipakai].join(", ") || "⚠️ TIDAK ADA — jawaban di atas tidak bersumber data"}`);
console.log(`waktu          : ${((Date.now() - mulai) / 1000).toFixed(1)} detik`);
console.log(`token          : ${r.usage?.inputTokens ?? "?"} masuk, ${r.usage?.outputTokens ?? "?"} keluar`);

// Pembanding dari database, supaya jawaban model bisa dicocokkan dengan
// kenyataan alih-alih dipercaya.
const banding = (await pool.query<{ no_ticket: string; judul: string; status: string; dibuat: string }>(
  `SELECT no_ticket, judul, status, dibuat FROM v_ai_tiket_helpdesk
    WHERE id_employee = $1 AND status NOT IN ('CLOSED','RESOLVED','CANCELLED','REJECTED')
    ORDER BY dibuat DESC LIMIT 20`, [idEmployee])).rows;
console.log(`\npembanding dari database — ${banding.length} tiket belum selesai milik orang ini:`);
for (const b of banding) console.log(`  ${b.no_ticket}  ${b.status.padEnd(12)} ${b.judul}`);

await pool.end();

// VoltAgent menyisakan handle yang menahan event loop; tanpa ini prosesnya
// tidak pernah keluar walau semua sudah tercetak.
process.exit(0);
