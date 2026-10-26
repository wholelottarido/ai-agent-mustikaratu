/**
 * Uji: model lokal DITOLAK di jalur konfigurasi, dan alasannya sampai ke user.
 *
 *   npm run test:lokal-jalur
 *
 * HANYA MEMBACA. Tidak menulis ke database mana pun.
 *
 * ============================================================
 * KENAPA UJI INI ADA
 * ============================================================
 * Aturan "model lokal cuma boleh satu tool" diukur 24 Sep 2026 lewat agent
 * sungguhan: qwen2.5:7b benar 10/12 dengan SATU tool, 2/6 dengan DUA. Aturan
 * itu dipasang di `pilihTools()` — milik jalur LAMA.
 *
 * Waktu jalur konfigurasi dibuat, pembatas itu TIDAK ikut. Tidak ada galat,
 * tidak ada gejala: model lokal cuma mulai menerima 34-127 tool sekaligus dan
 * mulai mengarang. Diukur 21 Okt 2026 lewat `npm run ukur:qwen`.
 *
 * Yang dijaga uji ini bukan "ada kode penolak", melainkan dua hal yang
 * gampang lepas diam-diam:
 *
 *   1. Penolakannya TIDAK BOLEH jatuh ke jalur lama. Jalur lama membaca
 *      database dummy MySQL — pemakai yang bertanya soal tiket perusahaan
 *      lalu dijawab dari data dummy mendapat angka yang terlihat wajar dan
 *      salah, tanpa satu pun tanda.
 *   2. Penolakannya harus menyebut APA YANG HARUS DILAKUKAN. "Model lokal
 *      tidak didukung" membuat orang mengira aplikasinya rusak.
 *
 * ⚠️ Diuji lewat HTTP, bukan dengan memanggil fungsinya. Yang paling mungkin
 * salah di sebuah route adalah proxy, cookie, dan urutan pemeriksaan — dan
 * ketiganya terlewat kalau fungsinya dipanggil langsung. Sudah pernah terjadi
 * 30 Sep 2026: route login dikira jalan padahal proxy menolaknya.
 */
import { MODEL_TERSEDIA } from "../voltagent/models.ts";

const ASAL = process.env.UJI_ASAL ?? "http://localhost:3018";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const lokal = MODEL_TERSEDIA.filter((m) => m.penyedia === "lokal");
const awan = MODEL_TERSEDIA.filter((m) => m.penyedia !== "lokal");
console.log(`model lokal: ${lokal.map((m) => m.id).join(", ") || "(tidak ada)"}`);
console.log(`model lain : ${awan.map((m) => m.id).join(", ")}`);

if (lokal.length === 0) {
  console.log("\nTidak ada model lokal di whitelist — tidak ada yang bisa diuji.");
  process.exitCode = 0;
} else {
  // ⚠️ Login dulu, karena tanpa cookie yang menjawab `proxy.ts` dengan 401 —
  // dan 401 itu TIDAK memberi tahu apa pun soal isi route-nya. Jebakan ini
  // sudah menipu sekali (28 Sep 2026, `test:batal-http`).
  const akun = process.env.UJI_AKUN ?? "marketing1";
  const sandi = process.env.UJI_SANDI ?? "marketing1";
  const masuk = await fetch(`${ASAL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: akun, password: sandi }),
  }).catch(() => null);

  if (!masuk) {
    console.log(`\n⚠️ Server tidak bisa dihubungi di ${ASAL}.`);
    console.log("   Jalankan `npm run deploy` dulu, atau setel UJI_ASAL.");
    process.exitCode = 1;
  } else if (!masuk.ok) {
    console.log(`\n⚠️ Login ${akun} gagal (HTTP ${masuk.status}). Setel UJI_AKUN/UJI_SANDI.`);
    process.exitCode = 1;
  } else {
    const kuki = masuk.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

    const tanya = (model: string) =>
      fetch(`${ASAL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: kuki },
        body: JSON.stringify({
          model,
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "halo" }] }],
        }),
      });

    console.log("\n=== Model lokal ===");
    for (const m of lokal) {
      const r = await tanya(m.id);
      const teks = await r.text();
      let pesan = "";
      try { pesan = (JSON.parse(teks) as { error?: string }).error ?? ""; } catch { pesan = teks.slice(0, 120); }

      // ⚠️ 503, bukan 500. 500 terbaca sebagai aplikasi rusak; 503 berarti
      // "ada syarat yang belum terpenuhi" — dan itu yang benar di sini.
      cek(`${m.id} ditolak dengan 503`, r.status === 503, `HTTP ${r.status}`);

      // Pesannya harus bisa ditindaklanjuti. Tanpa ini, penolakan yang benar
      // tetap membuat orang mengira portalnya rusak.
      cek(`${m.id}: pesannya menyebut jalan keluarnya`,
        /claude|gemma|dropdown/i.test(pesan), pesan.slice(0, 70));

      // ⚠️ DAN TIDAK BOLEH ADA JAWABAN. Yang dijaga di sini bukan status
      // kodenya, tapi bahwa tidak ada satu pun teks model yang lolos — kalau
      // suatu hari penolakannya dipindah ke tempat yang salah, status bisa
      // tetap 503 sementara stream-nya sudah terlanjur jalan.
      cek(`${m.id}: tidak ada isi jawaban yang ikut terkirim`,
        !teks.includes("data:") && !teks.includes("text-delta"),
        `${teks.length} huruf`);
    }

    // ============================================================
    console.log("\n=== Model lain TIDAK boleh ikut tertolak ===");
    // ============================================================
    // Penyeimbang. Penolakan yang kelewat lebar akan mematikan Claude juga,
    // dan gejalanya persis sama dari sisi user.
    for (const m of awan) {
      const r = await tanya(m.id);
      const teks = r.status === 503 ? await r.text() : "";
      cek(`${m.id} TIDAK ditolak sebagai model lokal`,
        !/model lokal/i.test(teks), `HTTP ${r.status}`);
      // Stream-nya tidak ikut dibaca sampai habis: yang diuji di sini cuma
      // bahwa ia tidak tertolak, bukan isi jawabannya.
      await r.body?.cancel();
    }
  }
}

console.log(`\n${lolos} lolos, ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
