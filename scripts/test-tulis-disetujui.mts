/**
 * Uji gerbang persetujuan tool TULIS milik tim lain.
 *
 *   npm run test:tulis-setuju
 *
 * MENULIS, tapi hanya ke `ai_tulis_disetujui` DI DATABASE PORTAL KITA, dan
 * keadaan awalnya dipulihkan di `finally`. Tidak satu baris pun di schema tim
 * lain disentuh — tidak dibaca untuk diubah, tidak ditulis, tidak dihapus.
 *
 * ============================================================
 * KENAPA UJI INI ADA
 * ============================================================
 * Penjalan tulis umum merakit tool tulis dari BARIS KONFIGURASI, tanpa kode
 * khusus — itu yang membuat tim IT bisa menambah tool sendiri dari layar
 * Kelola AI. Tapi `ai_tool` diisi tim lain juga, jadi baris tulis MEREKA ikut
 * terakit begitu tabel sasarannya ada di daftar-boleh.
 *
 * Terjadi 13 Okt 2026. Tim lain membangun ulang katalognya dalam sehari (140
 * baris baru, `agent-portal` dari 9 jadi 21 tool), dan dua tool tulis ke
 * `portal_ticket` — `tutup_tiket` dan `batalkan_tiket` — langsung hidup di
 * portal ini tanpa ditinjau siapa pun. `batalkan_tiket` bahkan tool yang
 * MINGGU SEBELUMNYA dihapus dari portal ini atas permintaan tim IT; dia
 * kembali karena katalog sebelah berubah, bukan karena ada yang memutuskan.
 *
 * ⚠️ YANG DIJAGA DI SINI BUKAN KEAMANAN TEKNIS, TAPI KEPUTUSAN.
 *
 * Penjagaan teknisnya diuji di tempat lain dan tidak ikut dilonggarkan
 * persetujuan: daftar-boleh tabel (`test:tulis-umum`), hak per-kolom role
 * `ai_tulis`, penyaring pemilik yang selalu ikut, dan rancangan yang cuma bisa
 * disimpan tombol. Bagian 5 memastikan itu memang masih berlaku SESUDAH
 * sebuah tool disetujui — persetujuan yang diam-diam membuka penjagaan lain
 * jauh lebih buruk daripada tidak ada persetujuan.
 */
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { buatToolDariKonfig } from "../voltagent/tool-konfigurasi.ts";
import { tulisPerluPersetujuan } from "../voltagent/registry-tulis.ts";
import {
  daftarTulisDisetujui, setujuiTulis, cabutTulis,
} from "../lib/tulis-disetujui.ts";
import { poolPortalAdmin } from "../lib/db-portal.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

const OLEH = 0; // pengguna uji; kolomnya cuma catatan, tidak dipakai logika

// Keadaan awal, supaya apa pun yang terjadi di bawah bisa dipulihkan utuh.
const awal = await daftarTulisDisetujui();
console.log(`persetujuan yang sudah ada: ${awal.length || "(tidak ada)"}`);

try {
  // ============================================================
  console.log("\n=== 1. Siapa yang butuh persetujuan ===");
  // ============================================================
  lupakanKonfig();
  const k = await muatKonfig();
  const semua = [...k.agent.flatMap((a) => a.tool), ...k.lepas];
  const unik = [...new Map(semua.map((t) => [t.kode, t])).values()];

  const perlu = unik.filter((t) => tulisPerluPersetujuan(t));
  console.log(`  butuh persetujuan: ${perlu.map((t) => `${t.kode}(${t.operasi}->${t.tabelTarget})`).join(", ") || "(tidak ada)"}`);

  // ⚠️ SIFAT, BUKAN NAMA. Katalog tim lain berubah dalam sehari — uji yang
  // menyebut `tutup_tiket` akan merah atau, lebih buruk, HIJAU TANPA MENGUJI
  // APA PUN begitu nama itu hilang.
  cek("tool baca tidak pernah butuh persetujuan",
    unik.filter((t) => t.operasi === "baca").every((t) => !tulisPerluPersetujuan(t)));
  cek("tool tulis MILIK KITA tidak butuh persetujuan",
    unik.filter((t) => t.operasi !== "baca" && t.pemilik === "magang").every((t) => !tulisPerluPersetujuan(t)),
    unik.filter((t) => t.operasi !== "baca" && t.pemilik === "magang").map((t) => t.kode).join(", ") || "(tidak ada tool tulis kita)");
  cek("yang butuh persetujuan semuanya tool tulis tim lain",
    perlu.every((t) => t.operasi !== "baca" && t.pemilik !== "magang"));

  // ⚠️ `buat_tiket` baris MILIK TIM LAIN, tapi yang merakitnya kode kita
  // sendiri yang sudah ditinjau (`buatToolTiket`). Memintanya minta
  // persetujuan berarti mematikan jalur entri tiket yang sudah dipakai orang,
  // untuk kekhawatiran yang tidak berlaku di situ.
  const berpenjalanSendiri = unik.filter((t) => t.kode === "buat_tiket" || t.kode === "ubah_tiket");
  if (berpenjalanSendiri.length > 0) {
    cek("tool yang punya penjalan khusus kita tidak butuh persetujuan",
      berpenjalanSendiri.every((t) => !tulisPerluPersetujuan(t)),
      berpenjalanSendiri.map((t) => t.kode).join(", "));
  } else {
    console.log("  (lewat: tidak ada tool berpenjalan khusus di katalog saat ini)");
  }

  if (perlu.length === 0) {
    console.log("\n  Tidak ada tool tulis tim lain di katalog saat ini — bagian 2-5 dilewati.");
    console.log("  Itu keadaan yang SAH, bukan kegagalan: gerbangnya tetap terpasang.");
  } else {
    // Yang dipakai untuk uji: diurut supaya pilihannya tidak berubah tiap
    // kali katalog mereka berubah urutannya.
    const uji = [...perlu].sort((a, b) => a.kode.localeCompare(b.kode))[0];
    console.log(`\n  dipakai untuk uji: ${uji.kode} (${uji.operasi} -> ${uji.tabelTarget})`);

    // ============================================================
    console.log("\n=== 2. Belum disetujui = tidak dirakit, dan alasannya tercetak ===");
    // ============================================================
    await cabutTulis(uji.kode); // pastikan titik awalnya bersih
    lupakanKonfig();

    const sesiPenuh = await sesiBerizinPenuh();
    {
      const k2 = await muatKonfig();
      const semua2 = [...k2.agent.flatMap((a) => a.tool), ...k2.lepas];
      const t = semua2.find((x) => x.kode === uji.kode)!;
      const h = buatToolDariKonfig([t], sesiPenuh);
      cek("tidak dirakit", h.tool.length === 0, h.tool.map((x) => x.name).join(", "));
      // ⚠️ ALASANNYA, BUKAN CUMA KETIADAANNYA. Tool yang hilang tanpa alasan
      // membuat administrator mencari kerusakan yang tidak ada — dan itu
      // persis bentuk kegagalan yang portal ini hindari sejak awal.
      const sebab = h.dilewati.find((d) => d.kode === uji.kode)?.sebab ?? "";
      cek("alasannya menyebut persetujuan", sebab.includes("belum disetujui"), sebab.slice(0, 70));
      cek("alasannya menyebut operasi dan tabelnya",
        sebab.includes(uji.operasi) && sebab.includes(uji.tabelTarget ?? "?"));
      cek("alasannya menunjuk ke tempat menyetujuinya", sebab.includes("Kelola AI"));
    }

    // ============================================================
    console.log("\n=== 3. Sudah disetujui = dirakit ===");
    // ============================================================
    const setuju = await setujuiTulis(uji.kode, uji.operasi, uji.tabelTarget!, OLEH);
    cek("persetujuan tersimpan", setuju.ok, setuju.ok ? "" : setuju.sebab);
    lupakanKonfig();
    {
      const k2 = await muatKonfig();
      const semua2 = [...k2.agent.flatMap((a) => a.tool), ...k2.lepas];
      const t = semua2.find((x) => x.kode === uji.kode)!;
      cek("pembaca konfigurasi menandainya disetujui", t.tulisDisetujui);
      const h = buatToolDariKonfig([t], sesiPenuh);
      cek("dirakit sesudah disetujui", h.tool.length === 1, h.tool.map((x) => x.name).join(", "));
      // Namanya tetap berawalan `siapkan_` — persetujuan tidak mengubah
      // kenyataan bahwa tool ini cuma menyusun rancangan.
      cek("namanya tetap berawalan `siapkan_` — tetap rancangan, bukan penulisan",
        h.tool[0]?.name.startsWith("siapkan_"), h.tool[0]?.name ?? "-");
    }

    // ============================================================
    console.log("\n=== 4. Persetujuan terikat pada ISI barisnya ===");
    // ============================================================
    // ⚠️ INI YANG MEMBUAT PERSETUJUAN TIDAK JADI CEK KOSONG.
    //
    // Baris `ai_tool` mereka bisa berubah kapan saja tanpa kita tahu — itu
    // sudah terbukti. Persetujuan yang cuma menyimpan KODE akan tetap berlaku
    // untuk tool yang isinya sudah lain: `tutup_tiket` yang disetujui sebagai
    // `hapus` pada `portal_ticket` bisa jadi `ubah` pada tabel lain besok,
    // dengan kode yang sama dan persetujuan lama yang masih menempel.
    //
    // Dicoba dengan menyimpan persetujuan yang SENGAJA tidak cocok. Yang
    // diubah catatan persetujuan di database KITA — baris mereka tidak
    // disentuh sama sekali.
    for (const [nama, operasi, tabel] of [
      ["operasi berbeda", uji.operasi === "ubah" ? "hapus" : "ubah", uji.tabelTarget!],
      ["tabel berbeda", uji.operasi, "tabel_yang_lain"],
    ] as const) {
      await poolPortalAdmin().query(
        `UPDATE ai_tulis_disetujui SET operasi = ?, tabel = ? WHERE tool_kode = ?`,
        [operasi, tabel, uji.kode],
      );
      lupakanKonfig();
      const k2 = await muatKonfig();
      const t = [...k2.agent.flatMap((a) => a.tool), ...k2.lepas].find((x) => x.kode === uji.kode)!;
      const h = buatToolDariKonfig([t], sesiPenuh);
      cek(`persetujuan dengan ${nama} tidak berlaku`,
        !t.tulisDisetujui && h.tool.length === 0,
        t.tulisDisetujui ? "MASIH DIANGGAP DISETUJUI" : "ditolak");
    }

    // ============================================================
    console.log("\n=== 5. Persetujuan TIDAK melonggarkan penjagaan lain ===");
    // ============================================================
    // Persetujuan yang diam-diam membuka penjagaan lain lebih buruk daripada
    // tidak ada persetujuan: dia mengubah satu keputusan jadi banyak.
    await setujuiTulis(uji.kode, uji.operasi, uji.tabelTarget!, OLEH);
    lupakanKonfig();
    {
      const k2 = await muatKonfig();
      const t = [...k2.agent.flatMap((a) => a.tool), ...k2.lepas].find((x) => x.kode === uji.kode)!;

      // Gerbang IZIN tetap berlaku: sudah disetujui tim IT tidak berarti
      // pemakai tanpa izinnya ikut mendapatkannya.
      if (t.izin) {
        const tanpaIzin = buatToolDariKonfig([t], { ...sesiPenuh, izin: [] });
        cek("gerbang izin tetap berlaku sesudah disetujui",
          tanpaIzin.tool.length === 0 &&
            (tanpaIzin.dilewati[0]?.sebab.includes("butuh izin") ?? false),
          tanpaIzin.dilewati[0]?.sebab.slice(0, 50) ?? "-");
      } else {
        console.log("  (lewat: tool uji ini tidak punya syarat izin)");
      }

      // Dan yang paling penting: yang dirakit tetap PENYUSUN RANCANGAN.
      // Kalau ini pernah berubah jadi penulisan langsung, tidak ada galat yang
      // muncul — yang terjadi cuma baris berubah tanpa ada yang menekan tombol.
      const h = buatToolDariKonfig([t], sesiPenuh);
      const d = h.tool[0]?.description ?? "";
      cek("keterangannya tetap menyatakan TIDAK MENYIMPAN APA PUN",
        d.includes("TIDAK MENYIMPAN APA PUN"), d.slice(0, 60));
    }

    // ============================================================
    console.log("\n=== 6. Dicabut = berhenti dirakit ===");
    // ============================================================
    const cabut = await cabutTulis(uji.kode);
    cek("pencabutan tersimpan", cabut.ok, cabut.ok ? "" : cabut.sebab);
    cek("mencabut yang sudah tidak ada ditolak dengan alasan",
      !(await cabutTulis(uji.kode)).ok);
    lupakanKonfig();
    {
      const k2 = await muatKonfig();
      const t = [...k2.agent.flatMap((a) => a.tool), ...k2.lepas].find((x) => x.kode === uji.kode)!;
      cek("tidak dirakit lagi sesudah dicabut",
        buatToolDariKonfig([t], sesiPenuh).tool.length === 0);
    }
  }
} finally {
  // ============================================================
  // Pemulihan: persetujuan yang ada sebelum uji ini dikembalikan apa adanya,
  // dan yang dibuat uji ini dibuang. Uji yang meninggalkan persetujuan berarti
  // meninggalkan KEMAMPUAN MENULIS yang tidak pernah diputuskan siapa pun —
  // persis hal yang berkas ini ada untuk mencegah.
  // ============================================================
  const sekarang = await daftarTulisDisetujui();
  const awalKode = new Set(awal.map((x) => x.toolKode));
  for (const x of sekarang) {
    if (!awalKode.has(x.toolKode)) await cabutTulis(x.toolKode);
  }
  for (const x of awal) {
    await setujuiTulis(x.toolKode, x.operasi, x.tabel, x.oleh);
  }
  const akhir = await daftarTulisDisetujui();
  cek("keadaan persetujuan dipulihkan utuh",
    akhir.length === awal.length &&
      awal.every((a) => akhir.some((b) => b.toolKode === a.toolKode && b.operasi === a.operasi && b.tabel === a.tabel)),
    `${awal.length} -> ${akhir.length}`);
  lupakanKonfig();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  // `process.exit`, bukan `exitCode`: pool MySQL menahan event loop tetap
  // hidup, dan skripnya mencetak hasil lalu MENGGANTUNG.
  process.exit(gagal === 0 ? 0 : 1);
}

/**
 * Sesi dengan SELURUH izin yang dikenal, supaya gerbang izin tidak menyalip
 * gerbang persetujuan.
 *
 * ⚠️ PERNAH MENIPU SAYA. Sesi uji pertama saya punya `izin: undefined`, jadi
 * tiap tool berizin dilewati dengan alasan "izin pemakai belum ditelusuri" —
 * dan gerbang persetujuan, yang mau diuji, tidak pernah tercapai. Ujinya
 * hijau tanpa menguji apa pun.
 *
 * Identitasnya dari akun uji yang sudah ada, bukan karangan: `idEmployee`
 * harus benar-benar ada supaya penyaring pemilik punya nilai yang masuk akal.
 */
async function sesiBerizinPenuh() {
  const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
    `SELECT e.id_employee FROM employee e
       JOIN users u ON u.id_users = e.id_users
      WHERE lower(u.username) = 'dafi@mustika-ratu.co.id' LIMIT 1`,
  );
  if (rows.length === 0) throw new Error("akun uji dafi@mustika-ratu.co.id tidak ada");
  const akses = await aksesUntukEmployee(rows[0].id_employee);
  if (!akses) throw new Error("akses akun uji tidak terbaca");

  // Izin diambil dari SELURUH yang dipakai tool mana pun, bukan cuma yang
  // dipunyai akun uji — supaya uji ini tidak ikut merah kalau peran akun uji
  // diubah orang lain.
  const k = await muatKonfig();
  const semuaIzin = [
    ...new Set(
      [...k.agent.flatMap((a) => a.tool), ...k.lepas].map((t) => t.izin).filter(Boolean) as string[],
    ),
  ];
  return { ...akses.sesi, izin: semuaIzin };
}
