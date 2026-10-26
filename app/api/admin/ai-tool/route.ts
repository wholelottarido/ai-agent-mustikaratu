import { sesiAtau401 } from "@/lib/sesi-server";
import { bolehAturAi } from "@/lib/admin";
import { muatKonfig } from "@/lib/ai-konfig";
import { ubahTool, ringkasTool, buatTool, sumberPilihan, type UbahanTool, type ToolBaru } from "@/lib/ubah-tool";
import { sambungTool, putusTool, lepasTool, pasangLagiTool } from "@/lib/sambung-tool";
import { setujuiTulis, cabutTulis } from "@/lib/tulis-disetujui";
import { tulisPerluPersetujuan } from "@/voltagent/registry-tulis";
import { buatToolTulisBaru } from "@/lib/tool-tulis-baru";
import type { Cakupan } from "@/lib/ai-konfig";

/**
 * Setelan tool AI milik portal ini.
 *
 * ⚠️ DEPARTEMEN IT SAJA, diperiksa KE DATABASE tiap permintaan.
 *
 * Menyembunyikan menu tidak menjaga apa pun — halaman `/kelola-ai` cuma
 * tampilan, dan siapa pun bisa memanggil route ini langsung lewat curl. Yang
 * menjaga: `bolehAturAi()` di sini, ditambah hak per-kolom role `ai_konfig`
 * di database.
 *
 * Membalas 404, bukan 403 — mengikuti jalur admin yang sudah ada: jangan
 * mengonfirmasi bahwa halaman ini memang ada kepada orang yang tidak berhak.
 */
async function timItAtauTolak(): Promise<
  { id: number; balas?: never } | { id?: never; balas: Response }
> {
  const hasil = await sesiAtau401();
  if (hasil.balas) return { balas: hasil.balas };
  if (!(await bolehAturAi(hasil.sesi.id))) {
    return { balas: Response.json({ error: "Tidak ditemukan." }, { status: 404 }) };
  }
  return { id: hasil.sesi.id };
}

export async function GET() {
  const jaga = await timItAtauTolak();
  if (jaga.balas) return jaga.balas;

  // SELURUH tool, bukan cuma milik kita — halaman ini mengatur agent yang
  // dipakai semua orang, jadi gambarnya harus utuh. Yang bukan milik kita
  // ditandai `milikKita: false` dan tetap ditolak `ubahTool()`.
  // Bentuknya disusun `ringkasTool()` — sama persis dengan yang dipakai
  // halaman server, supaya tidak ada dua salinan yang pelan-pelan berbeda.
  const [tool, k] = await Promise.all([ringkasTool(), muatKonfig()]);
  // Penggantian ikut dikirim supaya layarnya bisa menjelaskan kenapa tool tim
  // lain hilang dari daftar agent — bukan membiarkannya jadi teka-teki.
  // `sumber` ikut dikirim: borang tool baru memilih dari daftar ini, bukan
  // mengetik nama view — tidak ada nama tabel yang diisi tangan.
  return Response.json({ tool, gantian: k.gantian, sumber: await sumberPilihan() });
}

export async function PATCH(req: Request) {
  const jaga = await timItAtauTolak();
  if (jaga.balas) return jaga.balas;

  let badan: { kode?: unknown; ubahan?: unknown };
  try {
    badan = (await req.json()) as typeof badan;
  } catch {
    return Response.json({ error: "Badan permintaan bukan JSON." }, { status: 400 });
  }

  if (typeof badan.kode !== "string") {
    return Response.json({ error: "`kode` wajib diisi." }, { status: 400 });
  }

  // ⚠️ Field disalin SATU PER SATU, bukan diteruskan apa adanya. Meneruskan
  // objek dari peramban berarti field yang belum pernah kita rencanakan ikut
  // sampai ke penyusun UPDATE suatu hari nanti.
  const masuk = (badan.ubahan ?? {}) as Record<string, unknown>;
  const ubahan: UbahanTool = {};
  if (Array.isArray(masuk.kolom) && masuk.kolom.every((x) => typeof x === "string")) {
    ubahan.kolom = masuk.kolom as string[];
  }
  if (typeof masuk.batas === "number") ubahan.batas = masuk.batas;
  if (typeof masuk.cakupan === "string") ubahan.cakupan = masuk.cakupan as Cakupan;
  if (typeof masuk.contoh === "string" || masuk.contoh === null) {
    ubahan.contoh = masuk.contoh as string | null;
  }
  if (typeof masuk.aktif === "boolean") ubahan.aktif = masuk.aktif;
  // `null` BERARTI MENCABUT syarat izin, dan itu harus bisa dibedakan dari
  // "tidak disebut". Memakai `?? undefined` di sini akan membuat pencabutan
  // diam-diam tidak pernah terjadi.
  if (Array.isArray(masuk.filter)) {
    ubahan.filter = (masuk.filter as unknown[]).filter(
      (x): x is { kolom: string; label: string; operator: string } =>
        typeof x === "object" && x !== null &&
        typeof (x as { kolom?: unknown }).kolom === "string" &&
        typeof (x as { operator?: unknown }).operator === "string",
    ).map((x) => ({ kolom: x.kolom, label: typeof x.label === "string" ? x.label : x.kolom, operator: x.operator }));
  }
  if (typeof masuk.izin === "string" || masuk.izin === null) {
    ubahan.izin = masuk.izin as string | null;
  }

  const hasil = await ubahTool(badan.kode, ubahan);
  if (!hasil.ok) return Response.json({ error: hasil.sebab }, { status: 400 });

  console.info(`[/api/admin/ai-tool] ${badan.kode} diubah oleh pengguna ${jaga.id}: ${JSON.stringify(ubahan)}`);
  return Response.json({ ok: true, kode: hasil.kode });
}

/**
 * Menyambungkan tool milik portal ini ke sebuah agent.
 *
 * ⚠️ Disimpan di `ai_tool_agent` DI DATABASE KITA, bukan di `ai_agent_tool`
 * mereka — lihat `lib/sambung-tool.ts`. Jadi agent tim lain tidak ikut
 * berubah waktu kita menyambungkan sesuatu.
 */
export async function POST(req: Request) {
  const jaga = await timItAtauTolak();
  if (jaga.balas) return jaga.balas;

  const b = (await req.json().catch(() => ({}))) as { agent?: unknown; tool?: unknown; mode?: unknown };
  if (typeof b.tool !== "string") {
    return Response.json({ error: "`tool` wajib diisi." }, { status: 400 });
  }

  // ⚠️ PERSETUJUAN TOOL TULIS TIM LAIN — PER TOOL, BUKAN PER AGENT.
  //
  // Yang disetujui adalah KEMAMPUAN MENGUBAH BARIS di sebuah tabel. Tabelnya
  // sama dari agent mana pun, jadi menyetujuinya di satu agent lalu
  // menganggapnya belum disetujui di agent lain adalah pembedaan yang tidak
  // menjaga apa pun. Itu sebabnya `agent` tidak dibaca di cabang ini.
  if (b.mode === "setujui-tulis") {
    // ⚠️ `operasi` dan `tabel` DIAMBIL DARI KONFIGURASI, bukan dari badan
    // permintaan. Yang tercatat harus tool yang benar-benar ditinjau; kalau
    // peramban yang menyebutkan isinya, persetujuan bisa dicatat untuk
    // operasi/tabel yang berbeda dari yang sedang terpasang.
    const k = await muatKonfig();
    const t = [...k.agent.flatMap((a) => a.tool), ...k.lepas].find((x) => x.kode === b.tool);
    if (!t) return Response.json({ error: `tool "${b.tool}" tidak terpasang di portal ini` }, { status: 400 });
    if (!tulisPerluPersetujuan(t)) {
      return Response.json(
        { error: `"${b.tool}" tidak butuh persetujuan — tool baca, tool milik portal ini, atau punya penjalan sendiri` },
        { status: 400 },
      );
    }
    if (!t.tabelTarget) {
      return Response.json({ error: `"${b.tool}" tidak menyebut tabel sasaran` }, { status: 400 });
    }
    const h = await setujuiTulis(b.tool, t.operasi, t.tabelTarget, jaga.id);
    if (!h.ok) return Response.json({ error: h.sebab }, { status: 400 });
    // ⚠️ DICATAT LENGKAP DENGAN OPERASI DAN TABELNYA. Ini satu-satunya jejak
    // di luar database kalau suatu hari perlu ditelusuri siapa mengizinkan apa.
    console.warn(
      `[/api/admin/ai-tool] tool tulis tim lain DISETUJUI: ${b.tool} ` +
        `(${t.operasi} -> ${t.tabelTarget}, milik ${t.pemilik ?? "?"}) oleh pengguna ${jaga.id}`,
    );
    return Response.json({ ok: true });
  }

  if (typeof b.agent !== "string") {
    return Response.json({ error: "`agent` wajib diisi." }, { status: 400 });
  }

  // ⚠️ DUA ARAH DI SATU HANDLER, dibedakan `mode`.
  //
  //   (bawaan)  -> menyambungkan tool KITA ke agent itu
  //   "pasang-lagi" -> membatalkan pelepasan tool MEREKA
  //
  // Keduanya "menambahkan tool ke agent" dari sudut pandang layar, jadi
  // memisahkannya jadi dua alamat cuma memindahkan kebingungannya ke sana.
  const hasil =
    b.mode === "pasang-lagi"
      ? await pasangLagiTool(b.agent, b.tool)
      : await sambungTool(b.agent, b.tool, jaga.id);
  if (!hasil.ok) return Response.json({ error: hasil.sebab }, { status: 400 });

  console.info(`[/api/admin/ai-tool] ${b.tool} ${b.mode === "pasang-lagi" ? "dipasang lagi di" : "disambungkan ke"} ${b.agent} oleh pengguna ${jaga.id}`);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const jaga = await timItAtauTolak();
  if (jaga.balas) return jaga.balas;

  const b = (await req.json().catch(() => ({}))) as { agent?: unknown; tool?: unknown; mode?: unknown };
  if (typeof b.tool !== "string") {
    return Response.json({ error: "`tool` wajib diisi." }, { status: 400 });
  }

  // Mencabut persetujuan tool tulis tim lain. Per tool, jadi `agent` tidak
  // dibaca — lihat cabang `setujui-tulis` di POST untuk sebabnya.
  if (b.mode === "cabut-tulis") {
    const h = await cabutTulis(b.tool);
    if (!h.ok) return Response.json({ error: h.sebab }, { status: 400 });
    console.warn(`[/api/admin/ai-tool] persetujuan tulis DICABUT: ${b.tool} oleh pengguna ${jaga.id}`);
    return Response.json({ ok: true });
  }

  if (typeof b.agent !== "string") {
    return Response.json({ error: "`agent` wajib diisi." }, { status: 400 });
  }

  // `mode: "lepas"` -> tool MILIK TIM LAIN tidak dipasang portal ini.
  // Tanpa mode -> memutus sambungan tool KITA sendiri.
  //
  // ⚠️ Yang "lepas" TIDAK menghapus apa pun di database mereka.
  const hasil =
    b.mode === "lepas"
      ? await lepasTool(b.agent, b.tool, jaga.id)
      : await putusTool(b.agent, b.tool);
  if (!hasil.ok) return Response.json({ error: hasil.sebab }, { status: 400 });

  console.info(`[/api/admin/ai-tool] ${b.tool} ${b.mode === "lepas" ? "dilepas dari" : "diputus dari"} ${b.agent} oleh pengguna ${jaga.id}`);
  return Response.json({ ok: true });
}

/**
 * Membuat tool baca baru dari sumber data terdaftar.
 *
 * ⚠️ `jenis`, `operasi`, `tabel_target`, dan `penangan` TIDAK diterima dari
 * badan permintaan sama sekali — bukan diabaikan, tapi memang tidak dibaca.
 * Role database juga tidak punya hak mengisinya, jadi tool yang lahir dari
 * sini selalu `konfigurasi` + `baca`, apa pun yang dikirim.
 */
export async function PUT(req: Request) {
  const jaga = await timItAtauTolak();
  if (jaga.balas) return jaga.balas;

  const m = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ⚠️ DITOLAK TERANG-TERANGAN, BUKAN DIABAIKAN.
  //
  // Role database memang tidak punya hak mengisi keempat kolom ini, jadi
  // permintaan yang memuatnya tetap menghasilkan tool baca biasa. Tapi
  // membalas "berhasil" untuk permintaan yang meminta tool TULIS berarti
  // pengirimnya mengira dia punya tool tulis — dan baru tahu tidak, waktu
  // dipakai. Lebih baik ditolak di sini.
  // ⚠️ `izin` SENGAJA TIDAK ADA DI DAFTAR INI LAGI.
  //
  // Sejak role `ai_konfig` diberi hak mengisi kolom `izin` (8 Okt 2026), layar
  // memang boleh menyetelnya — dan borang SELALU mengirimnya, walau kosong.
  // Selama `izin` masih terdaftar terlarang, SETIAP pembuatan tool ditolak,
  // termasuk yang tidak menyebut izin sama sekali.
  //
  // Yang tersisa di sini kolom yang menentukan APA yang dikerjakan tool, bukan
  // siapa yang boleh memakainya. Izin cuma mempersempit; ia tidak pernah bisa
  // mengubah tool baca jadi tool tulis.
  const terlarang = (m.tulis === true ? ["jenis", "penangan"] : ["operasi", "jenis", "tabel_target", "penangan", "kolom_isian"])
    .filter((f) => m[f] !== undefined);
  if (terlarang.length > 0) {
    return Response.json(
      {
        error:
          `Tidak bisa diatur dari sini: ${terlarang.join(", ")}. ` +
          "Tool yang dibuat lewat layar ini selalu berjenis konfigurasi dan beroperasi baca; " +
          "operasi tulis perlu kartu konfirmasi dan belum ada.",
      },
      { status: 400 },
    );
  }

  // ⚠️ TOOL TULIS PUNYA JALUR SENDIRI, bukan cabang di dalam jalur baca.
  //
  // Keduanya dinilai dengan pertanyaan yang berbeda: tool baca soal "kolom
  // mana yang boleh dibaca dan disaring untuk siapa", tool tulis soal "baris
  // mana yang boleh disentuh dan dengan syarat apa". Menyatukannya membuat
  // separuh pemeriksaan tidak berlaku di separuh kasus.
  if (m.tulis === true) {
    const hasilTulis = await buatToolTulisBaru({
      kode: String(m.kode ?? ""),
      nama: String(m.nama ?? ""),
      deskripsi: String(m.deskripsi ?? ""),
      sumber: String(m.sumber ?? ""),
      // ⚠️ DAFTAR-BOLEH, bukan diteruskan apa adanya. Nilai di luar ketiganya
      // jatuh ke "ubah", bukan jadi operasi karangan yang lolos ke penyusun SQL.
      operasi: (m.operasi === "hapus" || m.operasi === "tambah" ? m.operasi : "ubah") as
        "tambah" | "ubah" | "hapus",
      kunci: Array.isArray(m.kunci) ? (m.kunci as { kolom: string; label: string }[]) : [],
      isian: Array.isArray(m.isian) ? (m.isian as { kolom: string; label: string; maks?: number }[]) : [],
      // `pembangkit` ikut disalin; `buatToolTulisBaru()` yang memeriksa namanya
      // dikenal dan memang untuk tabel ini.
      otomatis: Array.isArray(m.otomatis)
        ? (m.otomatis as { kolom: string; label: string; nilai?: string; pembangkit?: string }[])
        : [],
      syarat: Array.isArray(m.syarat) ? (m.syarat as { kolom: string; boleh: string[] }[]) : [],
      izin: typeof m.izin === "string" && m.izin.trim() ? m.izin.trim() : null,
      contoh: typeof m.contoh === "string" ? m.contoh : null,
      idApps: null,
    });
    if (!hasilTulis.ok) return Response.json({ error: hasilTulis.sebab }, { status: 400 });

    // Disambungkan ke agent yang diminta, sama seperti tool baca.
    if (typeof m.agent === "string" && m.agent.trim()) {
      await sambungTool(m.agent, hasilTulis.kode, jaga.id);
    }
    console.info(`[/api/admin/ai-tool] tool TULIS ${hasilTulis.kode} dibuat oleh pengguna ${jaga.id}`);
    return Response.json({ ok: true, kode: hasilTulis.kode });
  }

  // Field disalin satu per satu, sama seperti PATCH: meneruskan objek dari
  // peramban berarti field yang belum pernah kita rencanakan ikut sampai ke
  // penyusun INSERT suatu hari nanti.
  const perlu = ["kode", "nama", "deskripsi", "sumber"] as const;
  for (const f of perlu) {
    if (typeof m[f] !== "string" || !(m[f] as string).trim()) {
      return Response.json({ error: `\`${f}\` wajib diisi.` }, { status: 400 });
    }
  }
  if (!Array.isArray(m.kolom) || !m.kolom.every((x) => typeof x === "string")) {
    return Response.json({ error: "`kolom` harus daftar nama kolom." }, { status: 400 });
  }

  // Dibuat dari halaman sebuah agent? Aplikasinya ikut agent ITU, bukan ikut
  // sumbernya — supaya tool yang diminta "untuk Ratu AI MAPS" tidak ikut muncul
  // di agent pemegang aplikasi sumber datanya.
  let idApps: string | null = null;
  if (typeof m.agent === "string" && m.agent) {
    const k = await muatKonfig();
    const a = k.agent.find((x) => x.kode === m.agent);
    if (!a) return Response.json({ error: `agent "${m.agent}" tidak ada.` }, { status: 400 });
    if (a.umum) {
      return Response.json(
        { error: "Agent umum tidak boleh punya tool — dia perute, bukan penjawab." },
        { status: 400 },
      );
    }
    idApps = a.idApps;
  }

  const baru: ToolBaru = {
    kode: (m.kode as string).trim(),
    nama: (m.nama as string).trim(),
    deskripsi: (m.deskripsi as string).trim(),
    sumber: (m.sumber as string).trim(),
    kolom: m.kolom as string[],
    cakupan: (typeof m.cakupan === "string" ? m.cakupan : "semua") as Cakupan,
    batas: typeof m.batas === "number" ? m.batas : 20,
    urut: typeof m.urut === "string" && m.urut ? m.urut : null,
    contoh: typeof m.contoh === "string" ? m.contoh : null,
    izin: typeof m.izin === "string" && m.izin.trim() ? m.izin.trim() : null,
    idApps,
  };

  const hasil = await buatTool(baru);
  if (!hasil.ok) return Response.json({ error: hasil.sebab }, { status: 400 });

  // ⚠️ Jaring pengaman, bukan jalur utama: agent yang `id_apps`-nya kosong
  // tidak bisa dijangkau lewat aturan aplikasi, jadi disambungkan manual.
  // "Sudah dipakai" di sini BUKAN kegagalan — tool-nya memang sudah menempel.
  if (typeof m.agent === "string" && m.agent && !idApps) {
    await sambungTool(m.agent, baru.kode, jaga.id);
  }

  console.info(
    `[/api/admin/ai-tool] tool "${baru.kode}" dibuat oleh pengguna ${jaga.id}` +
      (typeof m.agent === "string" && m.agent ? ` untuk ${m.agent}` : ""),
  );
  return Response.json({ ok: true, kode: hasil.kode });
}
