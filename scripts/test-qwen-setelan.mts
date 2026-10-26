/**
 * Uji setelan penyedia Qwen — TANPA menyentuh jaringan sama sekali.
 *
 *   npm run test:qwen-setelan
 *
 * ============================================================
 * ⚠️ KENAPA TERPISAH DARI `test:qwen-tool`
 * ============================================================
 * Spesifikasi §12: "Use mocks for automated testing. Do not require a live
 * Colab session to run the test suite."
 *
 * `test:qwen-tool` memanggil Colab sungguhan — berguna, tapi TIDAK boleh jadi
 * bagian suite: Colab mati = uji merah padahal tidak ada yang rusak, dan
 * endpoint-nya memproses satu permintaan pada satu waktu, jadi menjalankannya
 * bersamaan dengan orang yang sedang memakai portal membuat keduanya lambat.
 *
 * Yang di sini murni logika setelan. Nol panggilan jaringan, nol database.
 */
import {
  qwenDisetel, modelDitawarkan, alamatQwen, timeoutQwen,
  MODEL_TERSEDIA, URUTAN_PENYEDIA, NAMA_PENYEDIA,
} from "../voltagent/models.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

/** Jalankan `f` dengan env yang disetel sementara, lalu pulihkan. */
function dengan(env: Record<string, string | undefined>, f: () => void) {
  const asli: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    asli[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { f(); } finally {
    for (const [k, v] of Object.entries(asli)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const SAH = { QWEN_API_URL: "https://contoh.trycloudflare.com/v1", QWEN_API_KEY: "kunci-uji", QWEN_ENABLED: "true" };

// ============================================================
console.log("=== 1. Setelan yang sah ===");
// ============================================================
dengan(SAH, () => {
  cek("URL + kunci + enabled -> disetel", qwenDisetel());
  cek("Qwen ikut ditawarkan", modelDitawarkan().some((m) => m.penyedia === "qwen"));
});

// ============================================================
console.log("\n=== 2. Setelan yang TIDAK sah ditolak ===");
// ============================================================
// ⚠️ Yang diuji di sini bukan kerapian. Tiap baris adalah keadaan yang, kalau
// lolos, membuat kunci Bearer terkirim polos atau pemakai memilih model yang
// pasti gagal.
const buruk: [string, Record<string, string | undefined>][] = [
  ["tanpa URL", { ...SAH, QWEN_API_URL: undefined }],
  ["tanpa kunci", { ...SAH, QWEN_API_KEY: undefined }],
  ["URL kosong", { ...SAH, QWEN_API_URL: "" }],
  ["URL bukan URL", { ...SAH, QWEN_API_URL: "bukan-url" }],
  // ⚠️ HTTP polos DITOLAK. Endpoint ini di luar jaringan kantor dan memakai
  // Bearer key; lewat http:// kunci itu terkirim terbuka. Ditolak, bukan
  // dipakai sambil diberi peringatan — peringatan tidak menghentikan apa pun.
  ["http:// (bukan https)", { ...SAH, QWEN_API_URL: "http://contoh.com/v1" }],
  ["QWEN_ENABLED=false", { ...SAH, QWEN_ENABLED: "false" }],
];
for (const [nama, env] of buruk) {
  dengan(env, () => {
    cek(`${nama} -> tidak disetel`, !qwenDisetel());
    cek(`${nama} -> hilang dari dropdown`, !modelDitawarkan().some((m) => m.penyedia === "qwen"));
  });
}

// localhost dikecualikan supaya pengembangan dengan server di komputer sendiri
// tetap jalan — di situ tidak ada jaringan yang bisa menyadap.
dengan({ ...SAH, QWEN_API_URL: "http://localhost:8000/v1" }, () => {
  cek("http://localhost DIKECUALIKAN", qwenDisetel());
});

// ============================================================
console.log("\n=== 3. Penyedia lain TIDAK terpengaruh ===");
// ============================================================
// Syarat §13: "Keep existing providers functional." Qwen yang dimatikan tidak
// boleh ikut menjatuhkan Claude/Ollama/Bifrost.
dengan({ QWEN_API_URL: undefined, QWEN_API_KEY: undefined }, () => {
  const sisa = modelDitawarkan();
  for (const p of ["anthropic", "lokal", "server"] as const) {
    cek(`penyedia ${p} tetap ada waktu Qwen mati`, sisa.some((m) => m.penyedia === p));
  }
  cek("daftar tidak kosong", sisa.length >= 3, `${sisa.length} model`);
});

// ============================================================
console.log("\n=== 4. Pendaftaran di satu sumber ===");
// ============================================================
// ⚠️ Penyedia yang tidak terdaftar di `URUTAN_PENYEDIA` HILANG dari dropdown
// tanpa galat apa pun. Sudah terjadi waktu penyedia `server` ditambahkan.
cek("`qwen` ada di URUTAN_PENYEDIA", (URUTAN_PENYEDIA as readonly string[]).includes("qwen"));
cek("`qwen` punya nama tampilan", Boolean(NAMA_PENYEDIA.qwen), NAMA_PENYEDIA.qwen);
// ⚠️ Namanya tidak boleh MENGAKU model ini lokal atau di dalam kantor —
// modelnya jalan di Google Colab, dan nama grup itu satu-satunya tempat
// pemakai bisa tahu sebelum menekan kirim.
//
// Yang diperiksa KLAIMNYA, bukan kata-katanya. Versi pertama uji ini menolak
// kata "kantor" di mana pun, lalu menandai "Qwen di Colab (luar kantor)"
// sebagai salah — padahal frasa itu menyatakan persis kebalikannya. Penanda
// yang mencocokkan kata gampang hijau tanpa arti DAN gampang merah tanpa
// sebab; pelajaran yang sama sudah muncul di `test:routing` (2 Okt 2026).
{
  const nama = NAMA_PENYEDIA.qwen;
  const mengakuLokal = /\blokal\b/i.test(nama);
  // "kantor" hanya bermasalah kalau TIDAK didahului "luar".
  const mengakuKantor = /\bkantor\b/i.test(nama) && !/luar\s+kantor/i.test(nama);
  cek("namanya tidak mengaku lokal / di dalam kantor", !mengakuLokal && !mengakuKantor, nama);
  // Dan harus menyebut di mana dia sebenarnya jalan.
  cek("namanya menyebut Colab", /colab/i.test(nama), nama);
}

const q = MODEL_TERSEDIA.find((m) => m.penyedia === "qwen");
cek("model Qwen terdaftar di whitelist", Boolean(q), q?.id);
cek("id-nya cocok dengan QWEN_MODEL di env",
  q?.id === (process.env.QWEN_MODEL ?? q?.id), `${q?.id} vs ${process.env.QWEN_MODEL}`);
cek("harganya null (gratis)", q?.harga === null);
cek("keterangannya menyebut Colab", /colab/i.test(q?.keterangan ?? ""), q?.keterangan?.slice(0, 50));

// ============================================================
console.log("\n=== 5. Rahasia tidak bocor ===");
// ============================================================
// §2.9: "Do not expose the real API key in logs, tests, commits, or
// documentation." Yang diperiksa: tidak ada fungsi yang memulangkan kuncinya.
dengan(SAH, () => {
  cek("alamatQwen() tidak memuat kunci", !alamatQwen().includes("kunci-uji"), alamatQwen());
  const sebagaiTeks = JSON.stringify(MODEL_TERSEDIA);
  cek("whitelist model tidak memuat kunci", !sebagaiTeks.includes("kunci-uji"));
});
cek("timeout terbaca dari env", timeoutQwen() > 0, `${timeoutQwen()} ms`);
dengan({ QWEN_TIMEOUT_MS: "bukan-angka" }, () => {
  cek("timeout ngawur jatuh ke bawaan", timeoutQwen() === 180_000, `${timeoutQwen()} ms`);
});

console.log(`\n${lolos} lolos, ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
