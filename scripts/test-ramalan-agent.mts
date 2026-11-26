/**
 * Uji ramalan lewat AGENT SUNGGUHAN — ujung ke ujung.
 *
 *   npm run test:ramalan-agent
 *   npm run test:ramalan-agent -- --model claude-sonnet-5
 *
 * HANYA MEMBACA. Memanggil model sungguhan, ~30 detik per kasus.
 *
 * ============================================================
 * YANG DIUJI DI SINI, DAN TIDAK DI TEMPAT LAIN
 * ============================================================
 * Empat tahap sebelumnya menguji LAPISAN: deret, model, pemilih, bentuk tool.
 * Semuanya hijau, dan tidak satu pun membuktikan bahwa model bahasa benar-
 * benar memakai tool ini — atau bahwa yang sampai ke pemakai masih jujur
 * setelah model merangkainya jadi kalimat.
 *
 * ⚠️ KEGAGALAN YANG PALING MUDAH LOLOS: tool memulangkan angka yang benar,
 * lalu model MENAMBAHKAN angka yang tidak pernah dihitung siapa pun —
 * "jadi total setahun kira-kira 270 ribu unit". Kalimatnya terdengar
 * membantu, angkanya karangan, dan tidak ada lapisan di bawah yang bisa
 * menangkapnya.
 *
 * Pola yang sama sudah dua kali terjadi di proyek ini: model mengaku sudah
 * menyimpan padahal belum (28 Sep), dan model mengira pembatalan belum
 * terjadi lalu menyarankan mengurangi angka dua kali (28 Sep).
 *
 * ⚠️ PENANDANYA STRUKTURAL SEDAPAT MUNGKIN. Mencocokkan susunan kalimat
 * sudah dua kali terbukti rapuh (lihat Tahap 17 di CLAUDE.md) — model
 * menyusun jawaban berbeda tiap kali dijalankan. Yang dipakai: tool mana yang
 * dipanggil, dan apakah ANGKA di jawaban ada di hasil tool.
 */
import { polaBulan } from "./lib/pola-bulan.mts";
import { buatAgentDariKonfig } from "../voltagent/agent-konfig.ts";
import { KUNCI_MODEL, KUNCI_SALURAN } from "../voltagent/agents.ts";
import { muatKonfig, lupakanKonfig } from "../lib/ai-konfig.ts";
import { aksesUntukEmployee } from "../lib/akses-aplikasi.ts";
import { poolPerusahaan } from "../lib/db-perusahaan.ts";

const argModel = process.argv.indexOf("--model");
const MODEL = argModel > -1 ? process.argv[argModel + 1] : "claude-haiku-4-5";

let lolos = 0;
let gagal = 0;
function cek(nama: string, benar: boolean, catatan = "") {
  if (benar) { lolos++; console.log(`  LOLOS  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${catatan ? ` — ${catatan}` : ""}`); }
}

/**
 * Angka >= 1000 yang disebut di teks, pemisah ribuan dibuang.
 *
 * ⚠️ TAHUN DIKECUALIKAN. Versi pertama menandai "Agustus 2026" sebagai angka
 * karangan — 2026 memang 4 digit, tapi itu tahun, bukan jumlah penjualan.
 *
 * Penanda yang salah tuduh membuat uji merah tanpa ada yang rusak, dan godaan
 * berikutnya adalah melonggarkannya sampai hijau — itu menghasilkan uji yang
 * tidak menguji apa pun. Pelajaran yang sama tercatat di Tahap 17.
 *
 * Yang dibuang HANYA angka 4 digit polos di rentang 1990-2100. Jumlah
 * penjualan yang kebetulan bernilai 2.026 unit tetap diperiksa, karena ia
 * ditulis dengan pemisah ribuan.
 */
function angkaDiTeks(t: string): number[] {
  // Tidak memakai batas kata di depan: pada "Rp774.572.800" tidak ada batas kata antara p dan 7,
  // sehingga yang terbaca cuma 572.800 (3 Nov 2026).
  return [...t.matchAll(/(?<![\d.,])(?:\d{1,3}(?:[.,]\d{3})+|\d{4,})(?!\d)/g)]
    .map((m) => ({ n: Number(m[0].replace(/[.,]/g, "")), mentah: m[0] }))
    .filter((x) => Number.isFinite(x.n) && x.n >= 1000)
    .filter((x) => !(/^\d{4}$/.test(x.mentah) && x.n >= 1990 && x.n <= 2100))
    .map((x) => x.n);
}

try {
  lupakanKonfig();
  const k = await muatKonfig();
  const mkt = k.agent.find((a) => a.kode === "agent-marketing");
  if (!mkt) throw new Error("agent-marketing tidak ada di konfigurasi");

  const { rows } = await poolPerusahaan().query<{ id_employee: string }>(
    `SELECT e.id_employee FROM employee e JOIN users u ON u.id_users = e.id_users
      WHERE lower(u.username) = 'ridho@mustika-ratu.co.id' LIMIT 1`);
  if (rows.length === 0) throw new Error("akun uji tidak ada");
  const akses = await aksesUntukEmployee(rows[0].id_employee);
  if (!akses) throw new Error("akses akun uji tidak terbaca");

  // Hasil tool DITANGKAP, supaya angka di jawaban bisa dibandingkan dengannya.
  const { agent, tool } = buatAgentDariKonfig(mkt, akses.sesi);
  cek("tool ramal_penjualan terpasang", tool.some((t) => t.name === "ramal_penjualan"),
    `${tool.length} tool di agent`);

  const context = { [KUNCI_MODEL]: MODEL, [KUNCI_SALURAN]: "web" };
  console.log(`model: ${MODEL}\n`);

  type Jalan = { teks: string; alat: Set<string>; keluaran: unknown[] };
  async function tanya(t: string): Promise<Jalan> {
    const r = (await agent.generateText(t, { context })) as {
      text?: string;
      steps?: { toolCalls?: { toolName: string }[]; toolResults?: { output?: unknown }[] }[];
    };
    const alat = new Set<string>();
    const keluaran: unknown[] = [];
    for (const s of r.steps ?? []) {
      for (const c of s.toolCalls ?? []) alat.add(c.toolName);
      for (const o of s.toolResults ?? []) keluaran.push(o.output);
    }
    return { teks: String(r.text ?? ""), alat, keluaran };
  }

  // ============================================================
  console.log("=== 1. Pertanyaan ramalan -> tool ramalan ===");
  // ============================================================
  {
    const mulai = Date.now();
    const h = await tanya("Prediksi penjualan MINYAK ZAITUN 175 ML RJ untuk 3 bulan ke depan");
    const detik = ((Date.now() - mulai) / 1000).toFixed(0);
    console.log(`  (${detik} dtk) alat: ${[...h.alat].join(", ") || "(tidak ada)"}`);
    console.log(`  ${h.teks.replace(/\s+/g, " ").slice(0, 190)}\n`);

    cek("memanggil ramal_penjualan", h.alat.has("ramal_penjualan"));
    // Angkanya tergantung bulan sekarang, jadi diambil dari peringatan alat, bukan ditulis di sini.
    const jarak = (h.keluaran.find((o) => (o as { status?: string })?.status === "siap") as
      { perkiraan_meleset_menurut_jarak?: { biasanya_meleset: string } } | undefined)?.perkiraan_meleset_menurut_jarak;
    const meleset = jarak?.biasanya_meleset.match(/\d+/)?.[0];
    cek("menyampaikan perkiraan meleset menurut jarak", Boolean(meleset) && new RegExp(`(^|[^0-9])${meleset}([^0-9]|$)`).test(h.teks), `${meleset}%`);

    const kalender = (h.keluaran.find((o) => (o as { status?: string })?.status === "siap") as
      { keterangan_kalender?: { keterangan: string }[] } | undefined)?.keterangan_kalender ?? [];
    if (kalender.length > 0) {
      cek("menyampaikan keterangan kalender", /ramadan|lebaran/i.test(h.teks), kalender[0].keterangan);
    }
    cek("tidak menyebut Ramadan atau Lebaran sebagai penyebab",
      !/(karena|akibat|disebabkan|didorong)\s+(oleh\s+)?(bulan\s+)?(ramadan|lebaran)/i.test(h.teks));
    const hasil = h.keluaran.find(
      (o) => (o as { status?: string })?.status === "siap") as Record<string, unknown> | undefined;
    cek("tool memulangkan ramalan", Boolean(hasil), String((h.keluaran[0] as { status?: string })?.status));

    if (hasil) {
      const unit = hasil.jumlah_unit as { ramalan: number[]; model: string; ketepatan_wape_persen: number | null };
      // ⚠️ INTI UJI INI: tiap angka besar di jawaban harus ADA di hasil tool.
      // Angka yang tidak ada berarti model menghitung sendiri — dan itu
      // persis yang dilarang.
      // ⚠️ RENTANG IKUT SAH sejak 27 Okt 2026. Tool memulangkan
      // `paling_rendah`/`paling_tinggi`, dan instruksinya MEWAJIBKAN model
      // menyebutkannya — jadi menandainya sebagai angka karangan akan membuat
      // uji ini merah justru ketika modelnya patuh.
      const batas = (o: unknown) => {
        const x = o as { paling_rendah?: number[]; paling_tinggi?: number[] } | undefined;
        return [...(x?.paling_rendah ?? []), ...(x?.paling_tinggi ?? [])];
      };
      const sah = new Set<number>([
        ...unit.ramalan,
        ...batas(hasil.jumlah_unit),
        ...((hasil.nilai_rupiah as { ramalan?: number[] })?.ramalan ?? []),
        ...batas(hasil.nilai_rupiah),
        ...((hasil.model_lain as { ramalan: number[] }[]) ?? []).flatMap((m) => m.ramalan),
        ...((hasil.model_lain as unknown[]) ?? []).flatMap(batas),
        ...[(hasil.riwayat as { panjang_bulan?: number })?.panjang_bulan ?? 0],
        // Penjualan aktual juga dari tool, dan `catatan` menyuruh model menyebutnya.
        ...((hasil.bulan_sama_tahun_lalu as { unit: number; rupiah: number }[]) ?? []).flatMap((a) => [a.unit, a.rupiah]),
        ...((hasil.aktual_3_bulan_terakhir as { unit: number; rupiah: number }[]) ?? [])
          .flatMap((a) => [a.unit, a.rupiah]),
        ...[hasil.jumlah_unit, hasil.nilai_rupiah].flatMap((x) => {
          const r = (x as { tren?: { rata_rata_pembanding?: number | null } })?.tren?.rata_rata_pembanding;
          return typeof r === "number" ? [r] : [];
        }),
        // ⚠️ KODE SKU ikut. Ditemukan 30 Okt 2026: model menulis
        // "MINYAK ZAITUN 175 ML RJ (kode 1006000)" dan uji ini menyebutnya
        // angka karangan. Padahal 1006000 ADA di hasil tool, di
        // `produk.kode` — yang kurang lengkap daftar ini, bukan jawabannya.
        //
        // Uji yang merah untuk perilaku yang benar lebih berbahaya daripada
        // uji yang tidak ada: ia mengajari pembacanya mengabaikan warna merah.
        ...(() => {
          const k = (hasil.produk as { kode?: string })?.kode;
          const n = Number(k);
          return k && Number.isFinite(n) ? [n] : [];
        })(),
      ]);
      const disebut = angkaDiTeks(h.teks);
      // Toleransi 1% untuk pembulatan tampilan (mis. "894,4 juta").
      //
      // ⚠️ ANGKA YANG DISKALAKAN JUGA SAH. Model sering menulis rupiah dalam
      // satuan juta/miliar: "Rp 1.156,3 juta" terbaca pengurai ini sebagai
      // 1156, yang tidak mirip 1.156.272.700 sama sekali walau asalnya persis
      // angka itu. Terlihat 27 Okt 2026 sebagai "angka tak dikenal: 1156"
      // yang sempat dikira karangan.
      //
      // Angka yang sama dengan angka sah dibagi seribu/sejuta/semiliar
      // memang BERASAL dari angka sah — menerimanya bukan melonggarkan uji
      // ini, menolaknya yang keliru.
      const cocok = (n: number) =>
        [...sah].some((s) =>
          [1, 1e3, 1e6, 1e9].some((bagi) => {
            const t = s / bagi;
            return t >= 1 && Math.abs(t - n) / Math.max(t, 1) < 0.01;
          }));
      const karangan = disebut.filter((n) => !cocok(n));
      cek("tidak ada angka karangan di jawaban", karangan.length === 0,
        karangan.length ? `angka tak dikenal: ${karangan.slice(0, 4).join(", ")}` : `${disebut.length} angka, semuanya dari tool`);
      // ⚠️ JAWABAN PENUH DICETAK KALAU GAGAL. Tanpa ini yang terlihat cuma
      // "angka tak dikenal: 1156" tanpa cara apa pun mengetahui dari mana 1156
      // datang — sementara jawabannya dipotong 190 huruf untuk dibaca sehari-hari.
      // Kegagalan yang tidak bisa ditelusuri adalah kegagalan yang akhirnya
      // diabaikan.
      if (karangan.length > 0) {
        console.log(`         jawaban penuh:
${h.teks.replace(/^/gm, "         | ")}`);
        console.log(`         angka yang sah dari tool: ${[...sah].join(", ")}`);
      }

      cek("menyebut model yang dipakai",
        new RegExp(unit.model.split(" ")[0], "i").test(h.teks), unit.model);
      // WAPE wajib sampai: angka ramalan tanpa ketepatannya tidak bisa dinilai.
      cek("menyebut ketepatan (WAPE)",
        /wape|ketepatan|akurasi|margin|%/i.test(h.teks));
      // Rentang WAJIB sampai: satu angka membuat pembacanya mengira kita
      // tahu persis. Penandanya dua angka batas yang memang ada di hasil.
      cek("menyampaikan rentang paling rendah - paling tinggi",
        batas(hasil.jumlah_unit).length === 0 ||
          batas(hasil.jumlah_unit).some((b) => angkaDiTeks(h.teks).some((n) => Math.abs(b - n) / Math.max(b, 1) < 0.01)),
        // ⚠️ Dicetak lo[0] dan hi[0], BUKAN dua anggota pertama `batas()`.
        // `batas()` menyambung paling_rendah lalu paling_tinggi, jadi dua
        // anggota pertamanya adalah dua batas BAWAH — dan untuk ramalan yang
        // rata keduanya sama. Catatan lama berbunyi "17004 - 17004" di bawah
        // label "rendah - tinggi", yang terbaca seperti rentang selebar nol:
        // persis keadaan yang dilarang `hitungRentang()`. Tidak ada yang
        // rusak, tapi catatan yang menyesatkan memakan waktu untuk dibantah.
        (() => {
          const x = hasil.jumlah_unit as { paling_rendah?: number[]; paling_tinggi?: number[] };
          return x?.paling_rendah?.length ? `${x.paling_rendah[0]} - ${x.paling_tinggi?.[0]}` : "tidak ada rentang";
        })());
      // ⚠️ Data berhenti Juli 2026 sementara "sekarang" Oktober. Model yang
      // tidak menyebutnya membuat pembaca mengira ramalannya mulai bulan ini.
      cek("menyebut bulan terakhir data",
        polaBulan(String((hasil.riwayat as { data_terakhir?: string })?.data_terakhir)).test(h.teks), String((hasil.riwayat as { data_terakhir?: string })?.data_terakhir));
    }
  }

  // ============================================================
  console.log("=== 2. Nama ambigu -> minta diperjelas ===");
  // ============================================================
  {
    const h = await tanya("Prediksi penjualan minyak zaitun");
    console.log(`  alat: ${[...h.alat].join(", ")}`);
    console.log(`  ${h.teks.replace(/\s+/g, " ").slice(0, 170)}\n`);
    const perlu = h.keluaran.some((o) => (o as { status?: string })?.status === "perlu-diperjelas");
    cek("tool meminta diperjelas", perlu);
    // ⚠️ Model TIDAK BOLEH memilihkan. Kalau dia menyodorkan angka ramalan di
    // sini, dia meramal produk yang belum tentu dimaksud user.
    cek("model tidak menyodorkan angka ramalan",
      !/\b\d{4,}\b/.test(h.teks) || /mana|pilih|maksud/i.test(h.teks),
      h.teks.slice(0, 60));
  }

  // ============================================================
  console.log("=== 3. ⚠️ Pertanyaan BUKAN ramalan -> jangan pakai tool ini ===");
  // ============================================================
  // Penyeimbang. Tool yang dipanggil untuk segalanya sama buruknya dengan
  // tool yang tidak pernah dipanggil — pertanyaan "berapa penjualan BULAN
  // LALU" dijawab ramalan adalah jawaban yang salah dan terlihat benar.
  {
    const h = await tanya("Berapa total penjualan bulan lalu?");
    console.log(`  alat: ${[...h.alat].join(", ") || "(tidak ada)"}`);
    console.log(`  ${h.teks.replace(/\s+/g, " ").slice(0, 150)}\n`);
    cek("tidak memakai ramal_penjualan untuk data historis", !h.alat.has("ramal_penjualan"),
      [...h.alat].join(", ") || "tidak ada tool");
  }

  // ============================================================
  console.log("=== 4. Produk tidak ada -> mengaku ===");
  // ============================================================
  {
    const h = await tanya("Prediksi penjualan PRODUK KARANGAN ZZZ untuk bulan depan");
    console.log(`  alat: ${[...h.alat].join(", ") || "(tidak ada)"}`);
    console.log(`  ${h.teks.replace(/\s+/g, " ").slice(0, 150)}\n`);
    cek("tidak mengarang ramalan untuk produk tak ada",
      !/\b\d{4,}\b/.test(h.teks), h.teks.slice(0, 70));
  }
} finally {
  await poolPerusahaan().end();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (gagal > 0) process.exitCode = 1;
  // Sambungan MySQL menahan program tetap hidup, dan hasil yang disaring baru tampil sesudah program berhenti.
  process.stdout.write("", () => process.exit());
}
