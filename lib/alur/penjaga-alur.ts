/**
 * Penjaga alur agent — SATU OBJEK PER PERMINTAAN (Tahap 2, 24 Nov 2026).
 *
 * Dibuat di `siapkanAgent()` setiap kali perute dirakit, lalu dipasang ke hook perute & agent bawahan.
 * Tidak ada state global: dua pengguna yang bertanya bersamaan memegang dua penjaga yang berbeda
 * (dibuktikan `test-api-voltagent.mts` G dan `test-penjaga-alur.mts`).
 *
 * Yang dijaga (lihat docs/workflow-agent/implementasi-tahap2-agent-orchestration.md):
 *   1. Delegasi yang menyatakan persetujuan/pilihan pengguna yang tidak pernah ia tulis   → ditolak SEBELUM jalan
 *   2. Perute menjawab pertanyaan agent bawahan atas nama pengguna                       → ditolak + berhenti
 *   3. Delegasi berulang (sama persis atau beda kata tapi tujuan sama) / melewati batas  → ditolak + berhenti
 *   4. Agent bawahan meminta keputusan pengguna (status alat)                            → perute berhenti
 *   5. Pemanggilan alat identik berulang / rancangan identik                             → hasil sebelumnya dipakai ulang
 *   6. Teks akhir: panggilan alat mentah, kalimat atas nama pengguna, klaim tersimpan     → disaring sebelum dikirim
 *   7. Tidak ada teks akhir                                                              → hasil valid terakhir / pesan jujur
 *
 * Modul ini murni (tanpa VoltAgent, database, jaringan) supaya setiap aturannya bisa diuji unit.
 * Penyambungannya ke VoltAgent ada di `voltagent/agent-konfig.ts`.
 */
import {
  adaIrisan, argumenStabil, butuhKeputusanPengguna, jawabanPendek, kalimatAtasNamaPengguna, kemiripan,
  klaimPersetujuan, klaimTersimpan, mintaTindakan, normal, penolakan, persetujuan, pertanyaanTertunda,
  pilihanDalamTugas, rancanganTerbentuk, tawaranTindakan, teksAlatMentah, type Tertunda,
  sapaanAtauKemampuan, periodeDalamTeks, POLA_ARG_PERIODE, pilihanBerdasar,
} from "./pola-teks";
import {
  cariAgent, cocokkan, jawabanGagalModel, LABEL_JENIS, pemilikKemampuan, statusHandoff, statusHasilAlat,
  type JenisKemampuan, type Kebutuhan, type RegistriKemampuan, type StatusHandoff,
} from "./kemampuan";

export type KodePenjaga =
  | "persetujuan-karangan" | "menjawab-atas-nama-pengguna" | "delegasi-berulang" | "batas-delegasi-agent"
  | "batas-delegasi" | "sudah-berhenti" | "klarifikasi" | "tawaran" | "alat-berulang" | "menunggu-pengguna"
  // Tahap 4–6
  | "sapaan-langsung" | "perlu-periode"
  // Tahap 3 (rute berdasarkan kemampuan)
  | "kemampuan-tidak-cocok" | "agent-tidak-tersedia" | "batas-fallback" | "akses-ditolak-sebelumnya";

/** Status hasil handoff yang berarti kebutuhannya BELUM terpenuhi dan boleh dicoba di agent lain (sekali). */
const GAGAL_PULIH: StatusHandoff[] = ["tanpa-alat", "tidak-bisa", "galat-alat"];

/** Keterangan alat yang dibaca hook dari definisinya (nama argumen & tag), bukan dari nama alat. */
export type MetaAlat = { argumen?: string[]; tag?: string[] };

const hariIniJakarta = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);
const kosong = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

/** Dilempar dari `onToolStart` supaya alat TIDAK dijalankan; `onToolError` mengubahnya jadi hasil alat. */
export class GalatPenjaga extends Error {
  constructor(public readonly kode: KodePenjaga, public readonly hasil: Record<string, unknown>) {
    super(`penjaga-alur: ${kode}`);
    this.name = "GalatPenjaga";
  }
}

export type Keputusan =
  | { boleh: true; tugasBaru?: string; dikosongkan?: string[]; /** Tahap 3: target delegasi pengganti. */ targetBaru?: string[] }
  | { boleh: false; galat: GalatPenjaga };

type Pesan = { peran: "user" | "assistant" | "system"; teks: string };
type Handoff = { agent: string; teks: string; langkah: number; keputusan: { pesan: string } | null; tawaran: boolean; status: StatusHandoff; tugas: string };

export type OpsiPenjaga = {
  /** Identitas pemakai (mis. id_employee). Ikut di sidik idempotensi. */
  idSesi?: string | null;
  maksDelegasiPerAgent?: number;
  maksDelegasiTotal?: number;
  /** Penolakan "persetujuan karangan" tanpa jawaban agent sebelumnya, sebelum perute dihentikan. */
  maksTeguran?: number;
  /**
   * Tahap 5: jawaban sapaan / "bisa bantu apa", disusun `buatRouter()` dari DAFTAR AGENT & ALAT yang
   * benar-benar terpasang untuk pemakai ini (bukan teks tetap). Kosong = pakai kalimat umum.
   */
  kemampuan?: string;
  /** Bulan berjalan "YYYY-MM" (Asia/Jakarta). Hanya diisi uji. */
  hariIni?: () => string;
  /**
   * Tahap 3: kemampuan agent & alat yang TERPASANG untuk pemakai ini (dirakit `buatRouter()` sesudah
   * penyaringan akses). Kosong = validasi kemampuan & fallback terkendali tidak aktif (perilaku Tahap 2–6).
   */
  registri?: RegistriKemampuan;
  /** Penolakan kemampuan per permintaan sebelum perute dihentikan. */
  maksTolakKemampuan?: number;
  /** Agent alternatif yang boleh dicoba untuk SATU kebutuhan sesudah percobaan pertama gagal. */
  maksFallback?: number;
};

export const TEKS_TERIMA_KASIH = "Sama-sama! Kalau ada yang ingin ditanyakan lagi, silakan.";
const TEKS_SAPAAN_UMUM = "Halo! Saya Ratu AI, asisten portal. Silakan sampaikan pertanyaan atau kebutuhan Anda.";

export const TEKS_RANCANGAN_BELUM_TERSIMPAN =
  "Rancangannya sudah disiapkan dan **belum tersimpan**. Periksa kartu rancangan, lalu tekan **Simpan** kalau isinya sudah sesuai.";
export const TEKS_BELUM_SELESAI =
  "Maaf, permintaan ini belum selesai diproses — asisten berhenti sebelum menemukan jawabannya. " +
  "Tidak ada data yang disimpan. Coba ulangi dengan kalimat yang lebih spesifik.";

function teksDariBagian(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x)) {
    return x.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
      .filter(Boolean).join("\n");
  }
  return "";
}

/** Riwayat dari `OperationContext.input`: string, UIMessage[] (parts), atau pesan model (content). */
export function riwayatDariMasukan(input: unknown): Pesan[] {
  if (typeof input === "string") return [{ peran: "user", teks: input }];
  if (!Array.isArray(input)) return [];
  return input.map((m) => {
    const o = (m ?? {}) as { role?: string; parts?: unknown; content?: unknown };
    const peran = o.role === "assistant" ? "assistant" : o.role === "system" ? "system" : "user";
    return { peran, teks: teksDariBagian(o.parts ?? o.content) } as Pesan;
  });
}

let urut = 0;

export function buatPenjagaAlur(opsi: OpsiPenjaga = {}) {
  const maksPerAgent = opsi.maksDelegasiPerAgent ?? 3;
  const maksTotal = opsi.maksDelegasiTotal ?? 6;
  const maksTeguran = opsi.maksTeguran ?? 1;
  const idPermintaan = `${Date.now().toString(36)}-${(++urut).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // ---------------------------------------------------------------- state permintaan ini saja
  let dimulai = false;
  let pesanUser = "";
  let tertunda: Tertunda | null = null;
  let langkah = 0;
  let teguran = 0;
  const delegasi: { target: string; tugas: string; langkah: number }[] = [];
  const handoff: Handoff[] = [];
  const agentBertanya = new Set<string>();
  let berhenti: { kode: KodePenjaga; langkah: number; alasan: string; teks?: string } | null = null;
  /** Seluruh pesan pengguna di riwayat (sumber kebenaran untuk "nilai ini ditulis pengguna"). */
  let teksPengguna = "";
  /** Alat yang sudah diingatkan soal periode (sekali per agent+alat, supaya tidak berputar). */
  const diingatkanPeriode = new Set<string>();
  const pilihanDikosongkan: string[] = [];
  const periodeOtomatis: string[] = [];
  /** Status alat per agent bawahan selama handoff yang sedang berjalan. */
  const sedang = new Map<string, { keputusan: { pesan: string } | null; rancanganBaru: boolean; alat: { status: ReturnType<typeof statusHasilAlat> }[] }>();
  /** Tahap 3: jejak keputusan rute permintaan ini (tanpa isi pesan pengguna). */
  const rute = {
    kebutuhan: [] as Kebutuhan[],
    targetPertama: null as string | null,
    dialihkan: [] as { dari: string; ke: string; kebutuhan: Kebutuhan }[],
    dibuang: [] as { target: string; kebutuhan: Kebutuhan }[],
    tolakKemampuan: 0,
    tidakCocok: [] as { target: string; tugas: string }[],
    /** Target data/tindakan yang tetap dipilih perute sesudah ditolak sekali (bukti kata tidak dianggap pasti). */
    dipertahankan: [] as string[],
  };
  /** Sidik alat → hasilnya (idempotensi). */
  const sidikAlat = new Map<string, unknown>();
  /** Alat tulis yang menunggu keputusan pengguna, per agent+alat → argumen terakhir. */
  const menunggu = new Map<string, Record<string, unknown>>();
  const argumenPanggilan = new Map<string, { alat: string; args: Record<string, unknown> }>();
  let rancangan = 0;
  let operasiTulis = false;
  const pelanggaran: { kode: string; contoh: string }[] = [];
  const ditolak: { kode: KodePenjaga; target?: string }[] = [];
  let penutup: "tidak-perlu" | "berhenti" | "hasil-terakhir" | "rancangan" | "sapaan" | "jujur" = "tidak-perlu";

  function mulai(input: unknown) {
    if (dimulai) return;
    dimulai = true;
    const r = riwayatDariMasukan(input).filter((p) => p.peran !== "system");
    const iUser = r.map((p) => p.peran).lastIndexOf("user");
    pesanUser = iUser >= 0 ? r[iUser].teks : "";
    teksPengguna = r.filter((p) => p.peran === "user").map((p) => p.teks).join("\n");
    const sebelum = iUser > 0 ? r.slice(0, iUser).reverse().find((p) => p.peran === "assistant") : undefined;
    tertunda = sebelum ? pertanyaanTertunda(sebelum.teks) : null;
  }

  function teksSapaan(jenis: "sapaan" | "kemampuan" | "terima-kasih"): string {
    if (jenis === "terima-kasih") return TEKS_TERIMA_KASIH;
    return opsi.kemampuan?.trim() || TEKS_SAPAAN_UMUM;
  }

  const hasilTolak = (kode: KodePenjaga, alasan: string, henti: boolean, teks?: string,
    /** Tahap 3: arahan & keterangan terstruktur pengganti kalimat bawaan. */ rute?: { arahan: string; [k: string]: unknown }): GalatPenjaga => {
    if (henti && !berhenti) berhenti = { kode, langkah, alasan, ...(teks ? { teks } : {}) };
    const { arahan, ...lain } = rute ?? { arahan: "" };
    return new GalatPenjaga(kode, {
      status: "ditolak-penjaga",
      kode,
      pesan: `Delegasi ditolak sistem (${kode}): ${alasan}. ` + (henti
        ? (arahan ? `${arahan} ` : "") + "Jangan memanggil alat lagi pada giliran ini."
        : arahan || "Teruskan kalimat pengguna APA ADANYA; jangan menyatakan persetujuan atau pilihan yang tidak ia tulis."),
      ...lain,
    });
  };

  /**
   * Tahap 3: validasi KEMAMPUAN target sebelum delegate_task jalan. Mengembalikan target akhir (mungkin dialihkan
   * atau dikurangi), atau penolakan. Tanpa registri, atau untuk jawaban singkat atas pertanyaan sebelumnya,
   * target dikembalikan apa adanya — keputusan tetap di perute.
   */
  function periksaKemampuan(tugas: string, target: string[], tolak: (kode: KodePenjaga, alasan: string, henti: boolean, teks?: string,
    r?: { arahan: string; [k: string]: unknown }) => Keputusan): { target: string[] } | Keputusan {
    const reg = opsi.registri;
    if (!reg || reg.agent.length === 0 || target.length === 0) return { target };
    const tersedia = reg.agent.map((a) => a.nama);

    // 1. Target yang tidak tersedia untuk pemakai ini (tidak dipasang / tanpa alat): TIDAK PERNAH dijalankan.
    const dikenal = target.map((t) => cariAgent(reg, t)?.nama).filter((x): x is string => !!x);
    if (dikenal.length === 0) {
      return tolak("agent-tidak-tersedia", `agent tujuan (${target.join(", ")}) tidak tersedia untuk pemakai ini`, false, undefined,
        { arahan: "Pilih agent dari daftar agent_tersedia saja, atau sampaikan bahwa kemampuan itu belum tersedia untuk akun ini.", agent_tersedia: tersedia });
    }
    let akhir = [...new Set(dikenal)];

    // Jawaban singkat ("ya", "LAN", "2") atas pertanyaan/tawaran sebelumnya diteruskan ke agent yang bertanya:
    // tujuannya ada di giliran sebelumnya, jadi kalimatnya sendiri bukan dasar menilai kemampuan.
    if (tertunda && jawabanPendek(pesanUser)) return { target: akhir };

    const mirip = (a: string, b: string) => normal(inti(a)) === normal(inti(b)) || kemiripan(inti(a), inti(b)) >= 0.6;
    // 2. Kebutuhan yang tadi gagal karena AKSES: tidak boleh dicari lewat agent lain.
    const akses = handoff.find((h) => h.status === "akses-ditolak" && mirip(h.tugas, tugas));
    if (akses) {
      return tolak("akses-ditolak-sebelumnya", `${akses.agent} sudah menolak tugas ini karena hak akses pemakai`, true, undefined,
        { arahan: "Sampaikan keterbatasan akses itu apa adanya; jangan mencari data yang sama lewat agent lain." });
    }

    // 3. Kecocokan kemampuan per target.
    const nilai = akhir.map((t) => ({ t, h: cocokkan(reg, t, tugas) }));
    const keb = nilai[0].h.kebutuhan;
    rute.kebutuhan.push(keb);
    rute.targetPertama ??= akhir[0];
    // ⚠️ Dua derajat bukti. "Dokumen" = target TIDAK PUNYA alat pencari dokumen sama sekali — pasti, jadi tetap
    // ditolak. "Data/tindakan/campuran" = dinilai dari kata isi, jadi sinonim bisa menipu (pemakai menulis kata yang
    // kebetulan ada di alat agent lain). Itu ditolak SEKALI dengan saran; kalau perute TETAP memilih target yang
    // sama untuk tugas yang sama, keputusannya dihormati (tercatat sebagai `dipertahankan`).
    const dipertahankan = (x: { t: string; h: { kebutuhan: Kebutuhan } }) => x.h.kebutuhan !== "dokumen"
      && rute.tidakCocok.some((y) => y.target === x.t && mirip(y.tugas, tugas));
    for (const x of nilai) if (x.h.tingkat === "tidak-cocok" && dipertahankan(x)) { x.h = { ...x.h, tingkat: "tidak-diketahui" }; rute.dipertahankan.push(x.t); }
    const tidak = nilai.filter((x) => x.h.tingkat === "tidak-cocok");
    for (const x of tidak) rute.tidakCocok.push({ target: x.t, tugas });
    if (tidak.length && tidak.length < nilai.length) {
      // Sebagian target cocok: yang terbukti tidak mampu dibuang, sisanya jalan.
      akhir = nilai.filter((x) => x.h.tingkat !== "tidak-cocok").map((x) => x.t);
      for (const x of tidak) rute.dibuang.push({ target: x.t, kebutuhan: x.h.kebutuhan });
    } else if (tidak.length) {
      const sudahDicoba = new Set([...delegasi.filter((d) => mirip(d.tugas, tugas)).map((d) => d.target),
        ...rute.tidakCocok.filter((x) => mirip(x.tugas, tugas)).map((x) => x.target)]);
      const jenis = keb === "campuran" ? null : (keb as JenisKemampuan);
      // Alat dokumen di semua agent adalah penangan yang sama: kalau SATU pemegangnya sudah mengerjakan tugas ini,
      // mencari lagi lewat pemegang lain hanya mengulang pencarian yang sama.
      const dokSudah = jenis === "dokumen" && [...sudahDicoba].some((n) => cariAgent(reg, n)?.alat.some((t) => t.jenis === "dokumen"));
      const saran = dokSudah ? [] : [...new Set(tidak.flatMap((x) => x.h.saran))].filter((n) => !sudahDicoba.has(n));
      if (saran.length === 0) {
        return tolak("kemampuan-tidak-cocok", `${akhir.join(", ")} tidak memegang alat ${jenis ? LABEL_JENIS[jenis] : "yang dibutuhkan"}, dan agent yang memegangnya sudah dicoba`, true, undefined,
          { arahan: "Sampaikan hasil yang sudah ada apa adanya; kalau belum ada, katakan informasinya belum ditemukan.", kebutuhan: keb });
      }
      // Kebutuhan DOKUMEN (buktinya struktural, bukan kata): dialihkan langsung, tanpa satu panggilan perute
      // tambahan. Alat pencari dokumen di agent mana pun adalah penangan yang sama dengan penyaring sesi yang sama,
      // jadi pilihannya tidak mengubah hasil — dipilih yang paling khusus: alat dokumen terbanyak, lalu alat total
      // tersedikit (prompt agent bawahan lebih kecil). Kandidat hanya dari registri pemakai ini: akses tidak dilewati.
      if (jenis === "dokumen" && akhir.length === 1) {
        const skor = (n: string) => { const a = cariAgent(reg, n)!; return { dok: a.alat.filter((t) => t.jenis === "dokumen").length, total: a.alat.length }; };
        const ke = [...saran].sort((x, y) => skor(y).dok - skor(x).dok || skor(x).total - skor(y).total || x.localeCompare(y))[0];
        rute.dialihkan.push({ dari: akhir[0], ke, kebutuhan: keb });
        akhir = [ke];
      } else {
        rute.tolakKemampuan++;
        const henti = rute.tolakKemampuan > (opsi.maksTolakKemampuan ?? 2);
        return tolak("kemampuan-tidak-cocok", `${akhir.join(", ")}: ${tidak[0].h.alasan}`, henti, undefined, {
          arahan: keb === "campuran"
            ? "Pisahkan tugasnya: kirim tiap bagian ke agent yang memegang kemampuannya (lihat saran_agent), lalu gabungkan jawabannya."
            : "Teruskan tugas yang SAMA ke salah satu agent di saran_agent. Jangan menyimpulkan datanya tidak ada." +
              (jenis === "dokumen" ? "" : " Kalau alat agent tujuan semula memang menangani bidang ini dengan istilah lain, kirim ulang tugas yang sama ke agent itu."),
          kebutuhan: keb, kemampuan_dibutuhkan: jenis ? LABEL_JENIS[jenis] : "beberapa", saran_agent: saran,
        });
      }
    }

    // 4. Fallback terkendali: untuk SATU kebutuhan, paling banyak `maksFallback` agent lain sesudah yang pertama gagal.
    const gagal = new Set(handoff.filter((h) => GAGAL_PULIH.includes(h.status) && mirip(h.tugas, tugas)).map((h) => h.agent));
    const baru = akhir.filter((t) => !gagal.has(t));
    if (gagal.size > 0 && baru.length > 0 && gagal.size + baru.length > 1 + (opsi.maksFallback ?? 1)) {
      return tolak("batas-fallback", `tugas ini sudah dicoba di ${[...gagal].join(", ")} tanpa hasil`, true, undefined,
        { arahan: "Sampaikan bahwa informasinya belum bisa diambil, beserta keterangan dari agent yang sudah mencoba." });
    }
    return { target: akhir };
  }

  function persetujuanSah(tugas: string): { ok: true } | { ok: false; alasan: string } {
    if (!pesanUser.trim()) return { ok: false, alasan: "tidak ada pesan pengguna" };
    if (handoff.length > 0) return { ok: false, alasan: "persetujuan dinyatakan sesudah agent bawahan menjawab pada giliran ini — itu menjawab atas nama pengguna" };
    if (penolakan(pesanUser)) return { ok: false, alasan: "pesan terakhir pengguna adalah penolakan" };
    // Pengguna menulis permintaannya sendiri ("tolong buatkan tiket …"): tidak ada yang dikarang.
    if (!jawabanPendek(pesanUser) && mintaTindakan(pesanUser)) return { ok: true };
    if (!tertunda) return { ok: false, alasan: "tidak ada tawaran atau pertanyaan yang menunggu jawaban pengguna" };
    if (tertunda.jenis === "tawaran") {
      if (!persetujuan(pesanUser) && !mintaTindakan(pesanUser)) return { ok: false, alasan: `jawaban pengguna ("${pesanUser.slice(0, 40)}") bukan persetujuan` };
      if (!adaIrisan(tugas, tertunda.kalimat)) return { ok: false, alasan: "isi tugas tidak sesuai dengan tawaran yang disetujui" };
      return { ok: true };
    }
    // Klarifikasi: pilihan yang disebut di tugas harus memang ditulis pengguna.
    const pilih = pilihanDalamTugas(tugas);
    if (pilih) {
      const angka = /^\s*(nomor\s*)?(\d{1,2})\s*$/i.exec(pesanUser);
      const dariNomor = angka ? tertunda.pilihan[Number(angka[2]) - 1] : undefined;
      const cocok = adaIrisan(pilih, pesanUser) || normal(pilih).includes(normal(pesanUser))
        || (dariNomor !== undefined && adaIrisan(pilih, dariNomor));
      if (!cocok) return { ok: false, alasan: `pilihan "${pilih.slice(0, 40)}" tidak ditulis pengguna` };
    }
    return { ok: true };
  }

  const inti = (t: string) => t.replace(/\[Konteks dari giliran sebelumnya[\s\S]*$/i, "");

  const penjaga = {
    idPermintaan,
    mulai,
    /** Dipanggil dari `prepareStep` perute. */
    mulaiLangkah(n: number) { langkah = n; },

    /** Validasi SEBELUM delegate_task dijalankan. */
    periksaDelegasi(args: { task?: unknown; targetAgents?: unknown }, masukan: unknown): Keputusan {
      mulai(masukan);
      const tugas = String(args.task ?? "");
      const asli = Array.isArray(args.targetAgents) ? args.targetAgents.map(String) : [];
      let target = asli;
      const tolak = (kode: KodePenjaga, alasan: string, henti: boolean, teks?: string, r?: { arahan: string; [k: string]: unknown }): Keputusan => {
        ditolak.push({ kode, target: target.join(",") });
        return { boleh: false, galat: hasilTolak(kode, alasan, henti, teks, r) };
      };

      if (berhenti) return tolak("sudah-berhenti", "alur sudah dihentikan untuk menunggu pengguna", true);

      // Tahap 5 (F.7): sapaan, terima kasih, dan "bisa bantu apa" tidak butuh data — dijawab dari daftar
      // agent yang terpasang, tanpa delegasi. HANYA kalau tidak ada tawaran/pertanyaan yang menunggu
      // (supaya "oke"/"ya" atas tawaran tidak ikut tertahan) dan belum ada delegasi di giliran ini.
      const sapa = !tertunda && delegasi.length === 0 && handoff.length === 0 ? sapaanAtauKemampuan(pesanUser) : null;
      if (sapa) return tolak("sapaan-langsung", "sapaan / pertanyaan umum tentang asisten dijawab langsung tanpa delegasi", true, teksSapaan(sapa));

      if (klaimPersetujuan(tugas)) {
        const s = persetujuanSah(tugas);
        if (!s.ok) {
          // Tanpa jawaban agent sebelumnya, perute masih bisa memperbaiki tugasnya sekali — lalu berhenti.
          const henti = handoff.length > 0 || ++teguran > maksTeguran;
          return tolak("persetujuan-karangan", s.alasan, henti);
        }
      }
      // Tahap 3: kemampuan target (sesudah aturan Tahap 2/5 di atas, sebelum batas delegasi di bawah — jadi target
      // pengganti tetap tunduk pada batas per agent, delegasi berulang, dan larangan menjawab atas nama pengguna).
      const k = periksaKemampuan(tugas, target, tolak);
      if ("boleh" in k) return k;
      target = k.target;
      for (const t of target) {
        if (agentBertanya.has(t)) {
          return tolak("menjawab-atas-nama-pengguna", `${t} sudah bertanya kepada pengguna pada giliran ini; jawabannya harus datang dari pengguna`, true);
        }
        const lalu = delegasi.filter((d) => d.target === t);
        if (lalu.length >= maksPerAgent) return tolak("batas-delegasi-agent", `${t} sudah diminta ${lalu.length}× pada giliran ini`, true);
        if (lalu.some((d) => normal(inti(d.tugas)) === normal(inti(tugas)) || kemiripan(inti(d.tugas), inti(tugas)) >= 0.75)) {
          return tolak("delegasi-berulang", `tugas yang sama sudah dikirim ke ${t}`, true);
        }
      }
      if (delegasi.length + target.length > maksTotal) return tolak("batas-delegasi", `sudah ${delegasi.length} delegasi pada giliran ini`, true);

      // Konteks klarifikasi dibawa OTOMATIS untuk jawaban pendek pengguna: agent bawahan tidak menerima
      // riwayat percakapan (RCA: pesan=2), jadi tanpa ini "LAN" sampai ke sana tanpa pertanyaannya.
      let tugasBaru: string | undefined;
      if (delegasi.length === 0 && tertunda && jawabanPendek(pesanUser)) {
        tugasBaru = `${tugas}\n\n[Konteks dari giliran sebelumnya — ditambahkan sistem]\n` +
          `Pertanyaan/tawaran asisten: «${tertunda.kalimat}»\n` +
          (tertunda.pilihan.length ? `Pilihan yang ditampilkan: ${tertunda.pilihan.slice(0, 12).join("; ")}\n` : "") +
          `Jawaban pengguna apa adanya: «${pesanUser.trim()}»`;
      }
      for (const t of target) delegasi.push({ target: t, tugas, langkah });
      const berubah = target.length !== asli.length || target.some((t, i) => t !== asli[i]);
      return { boleh: true, tugasBaru, ...(berubah ? { targetBaru: target } : {}) };
    },

    /** Dipanggil dari `onHandoffComplete` perute. */
    catatHandoff(agent: string, teks: string) {
      const s = sedang.get(agent);
      sedang.delete(agent);
      const keputusan = s?.keputusan ?? null;
      const tawaran = !s?.rancanganBaru && tawaranTindakan(teks);
      // Tahap 3: status dari BUKTI eksekusi alat (bukan dari kalimat "tidak bisa").
      // Model agent bawahan gagal menyusun jawaban → bukan bukti apa pun soal datanya, apa pun hasil alatnya.
      // Rancangan yang terbentuk atau keputusan yang ditunggu bukan kegagalan walau teksnya kosong.
      const status = jawabanGagalModel(teks) && !keputusan && !s?.rancanganBaru
        ? "galat-model"
        : statusHandoff(s?.alat ?? [], !!keputusan || tawaran || !!pertanyaanTertunda(teks));
      const tugas = [...delegasi].reverse().find((d) => d.target === agent)?.tugas ?? "";
      handoff.push({ agent, teks, langkah, keputusan, tawaran, status, tugas });
      if (keputusan || tawaran || pertanyaanTertunda(teks)) agentBertanya.add(agent);
      if ((keputusan || tawaran) && !berhenti) {
        berhenti = { kode: keputusan ? "klarifikasi" : "tawaran", langkah, alasan: `${agent} menunggu jawaban pengguna` };
      }
    },

    /** Validasi SEBELUM alat agent bawahan dijalankan (idempotensi & larangan memilihkan). */
    periksaAlat(agent: string, alat: string, args: Record<string, unknown>, masukanBawahan: unknown, idPanggilan?: string, meta: MetaAlat = {}): Keputusan {
      if (idPanggilan) argumenPanggilan.set(idPanggilan, { alat, args });
      const teksMasukBawahan = riwayatDariMasukan(masukanBawahan).map((p) => p.teks).join("\n");
      // Sumber kebenaran "yang ditulis pengguna" = pesan pengguna yang SEBENARNYA (riwayat perute), bukan isi
      // tugas delegasi — perute bisa saja menyisipkan pilihan ke tugas. Tanpa perute (agent dipanggil
      // langsung), masukan agent itulah pesan penggunanya.
      const dasarPengguna = dimulai ? teksPengguna : teksMasukBawahan;

      // Tahap 6 (F.8): argumen bertanda `pilihan-pengguna:<nama>` harus berasal dari kata pengguna. Nilai yang
      // tidak berdasar DIKOSONGKAN sebelum alat jalan, sehingga alat sendiri memulangkan daftar pilihan yang
      // sah dari database untuk ditanyakan — bukan model yang memilihkan (terbukti ubah-args, API-B).
      const dikosongkan: string[] = [];
      for (const tg of meta.tag ?? []) {
        const m = /^pilihan-pengguna:(.+)$/.exec(tg);
        if (!m) continue;
        const nama = m[1], v = args[nama];
        if (typeof v === "string" && v.trim() && !pilihanBerdasar(v, dasarPengguna, tertunda?.pilihan ?? [], dimulai ? pesanUser : "")) {
          args[nama] = "";
          dikosongkan.push(nama);
          pilihanDikosongkan.push(`${alat}.${nama}`);
        }
      }

      // Tahap 4 (F.6): alat yang punya argumen periode, dipanggil TANPA periode, padahal pengguna menyebut
      // periode → jangan biarkan alat diam-diam memakai bawaannya (bulan data terakhir). Ditolak sekali dengan
      // periode yang dibaca KODE dari kalimat pengguna; panggilan berikutnya diloloskan supaya tidak berputar.
      // Hanya alat BACA: alat `siapkan_*` memvalidasi isian wajibnya sendiri (perlu-perbaikan "kurang").
      const argPeriode = alat.startsWith("siapkan_") ? [] : (meta.argumen ?? []).filter((k) => POLA_ARG_PERIODE.test(k));
      if (argPeriode.length && argPeriode.every((k) => kosong(args[k])) && !diingatkanPeriode.has(`${agent}|${alat}`)) {
        const p = periodeDalamTeks(dimulai ? pesanUser : teksMasukBawahan, (opsi.hariIni ?? hariIniJakarta)());
        if (p) {
          diingatkanPeriode.add(`${agent}|${alat}`);
          const saran: string[] = [];
          if (p.relatif && argPeriode.includes("relatif")) saran.push(`relatif="${p.relatif}"`);
          else if (p.dari && argPeriode.includes("dari")) saran.push(`dari="${p.dari}"`, `sampai="${p.sampai}"`);
          else if (p.dari && argPeriode.includes("bulan") && p.dari === p.sampai) saran.push(`bulan="${p.dari}"`);
          else if (p.relatif && argPeriode.includes("bulan")) saran.push(`bulan sesuai "${p.label}" (format YYYY-MM)`);
          ditolak.push({ kode: "perlu-periode", target: `${agent}:${alat}` });
          return { boleh: false, galat: new GalatPenjaga("perlu-periode", {
            status: "perlu-periode",
            periode_di_pertanyaan: p.label,
            pesan: `Pertanyaan pengguna menyebut periode «${p.label}», tetapi ${alat} dipanggil tanpa periode — alat akan memakai periode bawaannya, bukan yang ditanyakan. ` +
              (saran.length ? `Panggil ulang ${alat} dengan ${saran.join(", ")}.` : `Panggil ulang ${alat} dengan periode itu.`) +
              " JANGAN menyimpulkan data periode itu tidak ada.",
          }) };
        }
      }

      const kunci = `${opsi.idSesi ?? "-"}|${idPermintaan}|${agent}|${alat}|${argumenStabil(args)}`;
      if (sidikAlat.has(kunci)) {
        ditolak.push({ kode: "alat-berulang", target: `${agent}:${alat}` });
        const sebelumnya = sidikAlat.get(kunci);
        return { boleh: false, galat: new GalatPenjaga("alat-berulang", {
          ...(sebelumnya && typeof sebelumnya === "object" ? sebelumnya as object : { hasil: sebelumnya }),
          catatan_sistem: "Alat ini sudah dipanggil dengan argumen yang sama pada giliran ini; ini hasil yang sama. JANGAN memanggilnya lagi.",
        }) };
      }
      const tunggu = menunggu.get(`${agent}|${alat}`);
      if (tunggu) {
        // Nilai baru yang tidak ditulis pengguna = agent memilihkan. Ditolak.
        const teksMasuk = normal(riwayatDariMasukan(masukanBawahan).map((p) => p.teks).join(" "));
        const karangan = Object.entries(args).filter(([k, v]) => typeof v === "string" && v.trim() && v !== tunggu[k])
          .filter(([, v]) => !normal(String(v)).split(" ").every((w) => w.length < 3 || teksMasuk.includes(w)));
        if (karangan.length) {
          ditolak.push({ kode: "menunggu-pengguna", target: `${agent}:${alat}` });
          return { boleh: false, galat: new GalatPenjaga("menunggu-pengguna", {
            status: "menunggu-pengguna",
            pesan: `Nilai ${karangan.map(([k]) => k).join(", ")} harus dipilih PENGGUNA. Sampaikan pertanyaan dan pilihannya apa adanya, lalu berhenti. Jangan memilihkan.`,
          }) };
        }
      }
      sidikAlat.set(kunci, undefined);
      return dikosongkan.length ? { boleh: true, dikosongkan } : { boleh: true };
    },

    /**
     * Dipanggil dari `onToolEnd` agent bawahan dengan HASIL AKTUAL alat. Mengembalikan hasil pengganti
     * (atau undefined): Tahap 4 menandai hasil yang memakai periode BAWAAN alat (`periode_otomatis`).
     */
    catatHasilAlat(agent: string, alat: string, output: unknown, idPanggilan?: string, argsCadangan?: Record<string, unknown>, meta: MetaAlat = {}): unknown {
      const a = (idPanggilan && argumenPanggilan.get(idPanggilan)?.args) || argsCadangan || {};
      let pengganti: unknown;
      // Hanya alat BACA: alat `siapkan_*` memvalidasi isian wajibnya sendiri (perlu-perbaikan "kurang").
      const argPeriode = alat.startsWith("siapkan_") ? [] : (meta.argumen ?? []).filter((k) => POLA_ARG_PERIODE.test(k));
      if (argPeriode.length && argPeriode.every((k) => kosong(a[k])) && output && typeof output === "object" && !Array.isArray(output)
        && !("periode_otomatis" in (output as object)) && !/^(tidak-bisa|galat|ditolak-penjaga|perlu-periode)$/.test(String((output as { status?: unknown }).status ?? ""))) {
        periodeOtomatis.push(alat);
        pengganti = { ...(output as object), periode_otomatis: true,
          catatan_periode: "Periode TIDAK dikirim di argumen, jadi alat memakai periode bawaannya (lihat field periode/bulan di hasil). " +
            "Sebut periode itu secara eksplisit ke pengguna. Kalau pertanyaan menyebut periode lain, panggil ulang dengan periode itu; " +
            "JANGAN menyimpulkan data periode yang ditanyakan tidak ada." };
      }
      const kunci = `${opsi.idSesi ?? "-"}|${idPermintaan}|${agent}|${alat}|${argumenStabil(a)}`;
      // Hasil yang disimpan untuk dipakai ulang = hasil yang DILIHAT model (dengan tanda periode bila ada).
      const dilihat = () => pengganti ?? output;
      const s = sedang.get(agent) ?? { keputusan: null, rancanganBaru: false, alat: [] };
      s.alat.push({ status: statusHasilAlat(output) });
      if (alat.startsWith("siapkan_")) operasiTulis = true;
      if (rancanganTerbentuk(output)) {
        rancangan++; s.rancanganBaru = true; s.keputusan = null; menunggu.delete(`${agent}|${alat}`);
      } else {
        const k = butuhKeputusanPengguna(output);
        if (k) { s.keputusan = k; if (alat.startsWith("siapkan_")) menunggu.set(`${agent}|${alat}`, a); }
      }
      sedang.set(agent, s);
      if (sidikAlat.has(kunci) && sidikAlat.get(kunci) === undefined) sidikAlat.set(kunci, dilihat());
      return pengganti;
    },

    /** Tahap 3: alat agent bawahan melempar galat sungguhan (bukan penolakan penjaga). */
    catatGalatAlat(agent: string) {
      const s = sedang.get(agent) ?? { keputusan: null, rancanganBaru: false, alat: [] };
      s.alat.push({ status: "galat-alat" });
      sedang.set(agent, s);
    },

    /**
     * Tahap 3: dipanggil dari `onToolEnd` perute untuk hasil `delegate_task` (daftar {agentName, response}).
     * Menempelkan status TERSTRUKTUR tiap handoff, dan — kalau agent bawahan tidak menjalankan alat yang
     * dibutuhkan — agent tersedia lain yang memegang kemampuannya (sekali). `undefined` = hasil tidak diubah.
     */
    catatanDelegasi(output: unknown): unknown {
      if (!Array.isArray(output) || !opsi.registri) return undefined;
      const reg = opsi.registri;
      let ubah = false;
      const keluar = output.map((o) => {
        const nama = String((o as { agentName?: unknown })?.agentName ?? "");
        const h = [...handoff].reverse().find((x) => x.agent === nama);
        if (!h || !o || typeof o !== "object") return o;
        ubah = true;
        const tambahan: Record<string, unknown> = { status_rute: h.status };
        if (h.status === "galat-model") {
          // Tidak dialihkan ke agent lain: yang gagal modelnya, bukan kemampuan agent itu.
          tambahan.catatan_rute =
            `${nama} gagal menyusun jawaban karena galat model (mis. data terlalu besar untuk kapasitas model ini). ` +
            "Datanya BELUM tersampaikan — JANGAN mengatakan datanya tidak ada atau kosong. Sampaikan ke pengguna bahwa " +
            "permintaannya gagal diproses, lalu sarankan mempersempit pertanyaan (mis. sebut jumlah baris atau filter) " +
            "atau memakai model lain.";
        } else if (GAGAL_PULIH.includes(h.status)) {
          const c = cocokkan(reg, nama, h.tugas);
          // Agent yang MEMANG memegang kemampuannya lalu menjawab tanpa alat (mis. penjelasan metodologi yang
          // boleh dijawab langsung) tidak dialihkan: tidak ada bukti agent lain lebih mampu.
          const jenis = c.tingkat !== "cocok" && (c.kebutuhan === "dokumen" || c.kebutuhan === "data" || c.kebutuhan === "tindakan") ? c.kebutuhan : null;
          const sudah = new Set(delegasi.filter((d) => kemiripan(inti(d.tugas), inti(h.tugas)) >= 0.6).map((d) => d.target));
          const saran = jenis ? pemilikKemampuan(reg, jenis, h.tugas).filter((n) => !sudah.has(n)) : [];
          tambahan.catatan_rute = (h.status === "tanpa-alat"
            ? `${nama} tidak menjalankan alat apa pun, jadi jawabannya BUKAN bukti informasinya tidak ada. `
            : `${nama} gagal mengambil data (${h.status}). `) +
            (saran.length
              ? `Teruskan tugas yang sama SEKALI ke ${saran.length === 1 ? saran[0] : `salah satu dari: ${saran.join(", ")}`}.`
              : "Kalau tidak ada agent lain di daftar yang alatnya cocok, sampaikan keterbatasannya apa adanya.");
          if (saran.length) tambahan.saran_agent = saran;
        } else if (h.status === "akses-ditolak") {
          tambahan.catatan_rute = "Ditolak karena hak akses pemakai. Sampaikan apa adanya; jangan mencari data yang sama lewat agent lain.";
        } else if (h.status === "tidak-ditemukan") {
          tambahan.catatan_rute = "Alat sudah dijalankan dan datanya tidak ditemukan. Sampaikan itu apa adanya; jangan mencarinya ke agent lain.";
        }
        return { ...(o as object), ...tambahan };
      });
      return ubah ? keluar : undefined;
    },

    /** Untuk `stopWhen` perute. */
    harusBerhenti: () => berhenti !== null,

    /**
     * Menyaring SATU potongan teks yang akan dikirim ke pengguna. Dipanggil per kalimat oleh `jagaStream`,
     * jadi keputusan diambil SEBELUM teksnya terkirim. `buangSisa` = sisa bagian teks ini ikut dibuang
     * (panggilan alat mentah biasanya bersambung beberapa baris).
     */
    saring,

    /**
     * Teks yang harus ditambahkan di akhir jawaban (sebelum `finish`), atau null.
     * `terkirim` = teks yang sudah sampai ke pengguna.
     */
    teksPenutup,

    /** Ringkasan untuk log & uji. Tanpa isi pesan pengguna. */
    keadaan() {
      return {
        idPermintaan, langkah, delegasi: delegasi.length, handoff: handoff.length, rancangan, operasiTulis,
        berhenti: berhenti ? { kode: berhenti.kode, alasan: berhenti.alasan } : null,
        ditolak: [...ditolak], pelanggaran: pelanggaran.map((p) => p.kode), penutup,
        tertunda: tertunda?.jenis ?? null,
        // Tahap 4–6: nama argumen saja, tanpa nilainya.
        pilihan_dikosongkan: [...pilihanDikosongkan], periode_otomatis: [...periodeOtomatis],
        // Tahap 3: metadata rute (nama agent & jenis kebutuhan saja, tanpa isi pertanyaan).
        rute: opsi.registri ? {
          kebutuhan: [...rute.kebutuhan], target_pertama: rute.targetPertama, dialihkan: [...rute.dialihkan],
          dibuang: [...rute.dibuang], tolak_kemampuan: rute.tolakKemampuan, dipertahankan: [...rute.dipertahankan],
          handoff: handoff.map((h) => ({ agent: h.agent, status: h.status })),
          agent_dipakai: [...new Set(handoff.map((h) => h.agent))],
        } : null,
      };
    },
  };

  function saring(potongan: string): { teks: string; buangSisa: boolean } {
    if (teksAlatMentah(potongan)) { pelanggaran.push({ kode: "teks-alat", contoh: potongan.slice(0, 80) }); return { teks: "", buangSisa: true }; }
    const kalimat = potongan.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [potongan];
    let keluar = "";
    for (const k of kalimat) {
      if (kalimatAtasNamaPengguna(k)) { pelanggaran.push({ kode: "atas-nama-pengguna", contoh: k.slice(0, 80) }); continue; }
      if (operasiTulis && klaimTersimpan(k)) {
        const pertama = !pelanggaran.some((p) => p.kode === "klaim-tersimpan");
        pelanggaran.push({ kode: "klaim-tersimpan", contoh: k.slice(0, 80) });
        // Status aktual yang menentukan kalimat pengganti: ada rancangan → "belum tersimpan, tekan Simpan".
        if (pertama) keluar += (rancangan > 0 ? TEKS_RANCANGAN_BELUM_TERSIMPAN : "Belum ada data yang tersimpan.") + " ";
        continue;
      }
      keluar += k;
    }
    return { teks: keluar, buangSisa: false };
  }

  function teksPenutup(terkirim: string): string | null {
    const bersih = (t: string) => saring(t).teks.trim();
    const sudah = normal(terkirim);
    if (berhenti?.teks) {
      if (sudah && sudah.includes(normal(berhenti.teks).slice(0, 60))) return null;
      penutup = "berhenti";
      return (terkirim.trim() ? "\n\n" : "") + berhenti.teks;
    }
    if (berhenti) {
      const b = berhenti;
      const dariLangkah = handoff.filter((h) => h.langkah === b.langkah);
      const sumber = dariLangkah.length ? dariLangkah : handoff.slice(-1);
      const bagian = sumber.map((h) => {
        const t = bersih(h.teks) || (h.keputusan?.pesan ? `Sebelum melanjutkan, saya perlu jawaban Anda:\n\n${h.keputusan.pesan}` : "");
        return t ? { agent: h.agent, t } : null;
      }).filter((x): x is { agent: string; t: string } => !!x);
      if (bagian.length) {
        if (sudah && sudah.includes(normal(bagian[0].t).slice(0, 60))) return null;
        const isi = bagian.length === 1 ? `${bagian[0].t}\n\n_— ${bagian[0].agent}_` : bagian.map((x) => `**${x.agent}:**\n${x.t}`).join("\n\n");
        penutup = "berhenti";
        return (terkirim.trim() ? "\n\n" : "") + isi;
      }
    }
    if (terkirim.trim()) return null;
    const terakhir = [...handoff].reverse().map((h) => ({ h, t: bersih(h.teks) })).find((x) => x.t);
    if (terakhir) { penutup = "hasil-terakhir"; return `${terakhir.t}\n\n_— ${terakhir.h.agent}_`; }
    if (rancangan > 0) { penutup = "rancangan"; return TEKS_RANCANGAN_BELUM_TERSIMPAN; }
    // Tahap 5: sapaan yang jawabannya tersaring habis (mis. perute menulis panggilan alat sebagai teks, pola
    // Q8) dijawab dari daftar agent, bukan dengan "belum selesai diproses".
    const sapa = !tertunda ? sapaanAtauKemampuan(pesanUser) : null;
    if (sapa) { penutup = "sapaan"; return teksSapaan(sapa); }
    penutup = "jujur";
    return TEKS_BELUM_SELESAI;
  }

  return penjaga;
}

export type PenjagaAlur = ReturnType<typeof buatPenjagaAlur>;

/**
 * Pemegang penjaga untuk SATU jalur agent. Kontraknya tetap "satu `siapkanAgent()` per permintaan", tetapi
 * kalau perute yang sama dipakai lagi secara BERURUTAN (mis. uji multi-giliran), operasi berikutnya otomatis
 * mendapat penjaga baru — state giliran sebelumnya tidak terbawa. Dipicu `onStart` perute (operationId baru).
 * Pemakaian BERSAMAAN atas satu jalur tidak didukung, sama seperti `sumber`/`rancangan` yang sudah ada.
 */
export type PemegangPenjaga = {
  ambil(): PenjagaAlur; operasi(id: string): void; pakaiKemampuan(teks: string): void;
  /** Tahap 3: registri kemampuan pemakai ini (dari `buatRouter()`). */
  pakaiRegistri(r: RegistriKemampuan): void;
  /** Tahap 3: registri yang sedang dipakai (untuk log & uji). */
  registri(): RegistriKemampuan | undefined;
};

export function buatPemegangPenjaga(opsiAwal: OpsiPenjaga = {}): PemegangPenjaga {
  const opsi: OpsiPenjaga = { ...opsiAwal };
  let p = buatPenjagaAlur(opsi);
  let op: string | null = null;
  return {
    ambil: () => p,
    operasi(id: string) { if (op !== null && id !== op) p = buatPenjagaAlur(opsi); op = id; },
    // `opsi` dibaca penjaga saat dibutuhkan, jadi teks ini berlaku untuk penjaga sekarang dan berikutnya.
    pakaiKemampuan(teks: string) { opsi.kemampuan = teks; },
    pakaiRegistri(r: RegistriKemampuan) { opsi.registri = r; },
    registri: () => opsi.registri,
  };
}
