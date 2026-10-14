/**
 * Uji isolasi bot WhatsApp. `npm run test:wa-isolasi`
 *
 * Pertanyaan yang dijawab berkas ini: lewat WhatsApp, apakah batas antar
 * departemen & peran TETAP berlaku?
 *
 * Dijawab di TIGA lapis, karena satu lapis saja tidak cukup:
 *   1. Penyaring pesan  -- grup, media, pesan bot sendiri harus ditolak
 *   2. Identitas        -- wa_id tak dikenal tidak boleh dapat agent apa pun
 *   3. MySQL            -- lapis terakhir; walau prompt ditembus, database
 *                          tetap menolak
 *
 * Lapis 3 yang paling penting. Prompt bisa dibujuk, izin MySQL tidak.
 */
import type { proto } from "baileys";
import { alasanDilewati, ambilTeks } from "../wa-bot/pesan.mts";
import { cariIdentitas, tutupPool } from "../wa-bot/identitas.mts";
import { ambilDepartemen } from "../voltagent/departemen/index.ts";
import { ambilPool } from "../voltagent/db.ts";

let lolos = 0;
let gagal = 0;

function cek(nama: string, benar: boolean, kenapa = "") {
  if (benar) {
    lolos++;
    console.log(`  LOLOS  ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}${kenapa ? ` — ${kenapa}` : ""}`);
  }
}

/** Pesan palsu secukupnya untuk menguji penyaring. */
function pesanPalsu(o: {
  jid?: string;
  fromMe?: boolean;
  teks?: string;
  media?: boolean;
}): proto.IWebMessageInfo {
  return {
    key: { remoteJid: o.jid ?? "628111@s.whatsapp.net", fromMe: o.fromMe ?? false, id: "X" },
    message: o.media
      ? ({ imageMessage: { caption: "foto" } } as proto.IMessage)
      : o.teks === undefined
        ? undefined
        : ({ conversation: o.teks } as proto.IMessage),
  } as proto.IWebMessageInfo;
}

console.log("\n=== 1. Penyaring pesan ===");
cek("pesan teks biasa diterima", alasanDilewati(pesanPalsu({ teks: "halo" })) === null);
cek("pesan grup ditolak", alasanDilewati(pesanPalsu({ jid: "123@g.us", teks: "halo" })) === "pesan grup");
cek(
  "status/story ditolak",
  alasanDilewati(pesanPalsu({ jid: "status@broadcast", teks: "halo" })) === "status/story",
);
cek("pesan bot sendiri ditolak", alasanDilewati(pesanPalsu({ teks: "halo", fromMe: true })) !== null);
cek(
  "gambar ditolak (parser media tidak boleh tersentuh)",
  alasanDilewati(pesanPalsu({ media: true })) === "bukan pesan teks",
);
cek("pesan kosong ditolak", alasanDilewati(pesanPalsu({ teks: "   " })) === "bukan pesan teks");
cek("teks diambil & dirapikan", ambilTeks(pesanPalsu({ teks: "  halo  " })) === "halo");

console.log("\n=== 2. Identitas dari wa_id ===");
const terdaftar = await cariIdentitas("11111111111111@lid");
cek(
  "wa_id terdaftar -> hr/kepala",
  terdaftar?.departemen === "hr" && terdaftar?.peran === "kepala",
  `dapat ${JSON.stringify(terdaftar)}`,
);
cek("wa_id ngawur -> tidak dikenal", (await cariIdentitas("6289999999999@s.whatsapp.net")) === null);
cek(
  "angka sama, domain beda -> tidak dikenal",
  (await cariIdentitas("11111111111111@s.whatsapp.net")) === null,
  "LID dan nomor telepon TIDAK boleh saling menggantikan",
);
cek("wa_id kosong -> tidak dikenal", (await cariIdentitas("")) === null);

console.log("\n=== 3. MySQL: lapis terakhir ===");
console.log("    (memakai pool YANG SAMA dengan yang dipakai bot)");

async function coba(dep: string, peran: string, sql: string): Promise<string> {
  try {
    await ambilPool(ambilDepartemen(dep)!, peran).query(sql);
    return "TEMBUS";
  } catch (e) {
    return (e as { code?: string }).code ?? "DITOLAK";
  }
}

// Pengirim WA kita adalah hr2 = kepala HR. Yang BOLEH:
cek(
  "hr/kepala boleh baca gaji",
  (await coba("hr", "kepala", "SELECT gaji_pokok FROM karyawan LIMIT 1")) === "TEMBUS",
);

// Yang TIDAK BOLEH -- ini inti ujinya:
for (const [dep, peran, sql, nama] of [
  ["hr", "kepala", "SELECT nama FROM marketing.produk LIMIT 1", "hr/kepala TIDAK bisa baca marketing"],
  ["hr", "staf", "SELECT gaji_pokok FROM karyawan LIMIT 1", "hr/staf TIDAK bisa baca gaji"],
  ["hr", "staf", "SELECT thp FROM payroll LIMIT 1", "hr/staf TIDAK bisa baca payroll"],
  ["marketing", "staf", "SELECT nama FROM hr.karyawan LIMIT 1", "marketing TIDAK bisa baca hr"],
  ["hr", "kepala", "UPDATE karyawan SET nama='x' WHERE id=0", "hr/kepala TIDAK bisa menulis"],
] as const) {
  const hasil = await coba(dep, peran, sql);
  cek(nama, hasil !== "TEMBUS", `hasil: ${hasil}`);
}

await tutupPool();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
