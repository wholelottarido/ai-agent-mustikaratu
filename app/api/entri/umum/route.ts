/**
 * Menjalankan rancangan tulis dari baris konfigurasi mana pun.
 *
 * ⚠️ SATU ROUTE UNTUK SEMUA TOOL TULIS BUATAN LAYAR. `buat_tiket` dan
 * `ubah_tiket` punya route sendiri karena penjalannya ditulis khusus; yang
 * dibuat dari layar Kelola AI lewat sini.
 *
 * ⚠️ `kode` DICARI DI KONFIGURASI, bukan dipercaya. Yang dikirim klien cuma
 * kode tool, nilai-nilai masukannya, dan sidik rancangan. Tabel sasaran,
 * kolom yang boleh ditulis, kunci, dan syaratnya semuanya datang dari baris
 * `ai_tool` — bukan dari badan permintaan.
 *
 * ⚠️ `id_employee` dari SESI. Penyaring pemilik ditambahkan penjalan umum dan
 * tidak bisa dimatikan konfigurasi.
 */
import { sesiAtau401 } from "@/lib/sesi-server";
import { muatKonfig } from "@/lib/ai-konfig";
import { bacaKonfigTulis, jalankanUmum, masalahUmumJadiTeks } from "@/lib/entri/tulis-umum";
import { aksesUntukEmployee } from "@/lib/akses-aplikasi";

export async function POST(req: Request) {
  const { sesi, balas } = await sesiAtau401();
  if (!sesi) return balas;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Badan permintaan bukan JSON." }, { status: 400 });
  }

  const kode = typeof body.kode === "string" ? body.kode : null;
  const sidik = typeof body.sidik === "string" ? body.sidik : null;
  if (!kode) return Response.json({ error: "`kode` tool wajib disertakan." }, { status: 400 });
  if (!sidik) return Response.json({ error: "Sidik rancangan tidak disertakan." }, { status: 400 });

  const konf = await muatKonfig();
  // ⚠️ YANG DIPERIKSA: TOOL INI TERPASANG DI SEBUAH AGENT — bukan `is_active`.
  //
  // Versi pertama menolak tool yang `is_active = false`, dan itu memakai arti
  // yang salah. Pada baris MILIK KITA, `is_active = false` berarti "sistem AI
  // tim lain tidak mengambilnya" — bukan "dimatikan". Seluruh 13 tool kita
  // bernilai false, termasuk yang jelas-jelas dipakai sehari-hari, dan
  // pembaca konfigurasi memang sengaja mengabaikannya untuk tool kita.
  //
  // Akibat salah arti itu: rancangan tersusun dan kartunya muncul, lalu
  // tombol Simpan ditolak dengan "sedang tidak aktif" — pengguna melihat
  // tool yang setengah hidup (9 Okt 2026).
  //
  // Yang benar-benar menentukan tool itu boleh dipakai adalah: ia terpasang
  // di salah satu agent. Tool yang menganggur ada di `lepas`, dan memang
  // tidak boleh dijalankan lewat route ini.
  const terpasang = konf.agent.flatMap((a) => a.tool).find((x) => x.kode === kode);
  const t = terpasang ?? konf.lepas.find((x) => x.kode === kode);
  if (!t) return Response.json({ error: `Tool "${kode}" tidak ada.` }, { status: 404 });
  if (!terpasang) {
    return Response.json(
      { error: `Tool "${kode}" belum tersambung ke agent mana pun, jadi belum bisa dipakai.` },
      { status: 409 },
    );
  }

  const baca = bacaKonfigTulis({
    kode: t.kode, operasi: t.operasi, tabelTarget: t.tabelTarget,
    isian: t.isian, otomatis: t.otomatis, kunci: t.kunci, syarat: t.syarat,
  });
  if (!baca.ok) return Response.json({ error: `Tool "${kode}" tidak bisa dijalankan: ${baca.sebab}` }, { status: 400 });

  // ⚠️ Izin tool ikut diperiksa DI SINI, bukan cuma waktu tool dipasang ke
  // agent. Route ini bisa dipanggil langsung, dan pemasangan tool bukan
  // penjagaan untuk permintaan HTTP.
  if (t.izin) {
    // Izin ditelusuri ULANG dari peran, bukan dibaca dari token sesi. Token
    // dibuat saat login dan bisa berumur jam-jaman; peran yang dicabut lima
    // menit lalu tidak boleh masih berlaku di sini.
    const akses = sesi.idEmployee ? await aksesUntukEmployee(sesi.idEmployee) : undefined;
    if (!(akses?.sesi.izin ?? []).includes(t.izin)) {
      return Response.json({ error: `Butuh izin "${t.izin}".` }, { status: 403 });
    }
  }

  const masukan: Record<string, string | undefined> = {};
  const isi = (body.masukan ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(isi)) if (typeof v === "string") masukan[k] = v;

  try {
    const hasil = await jalankanUmum(baca.konfig, sesi.idEmployee ?? null, masukan, sidik);
    if (!hasil.ok) {
      const status = hasil.sebab === "draf-berubah" ? 409 : hasil.sebab === "tidak-sah" ? 400 : 500;
      return Response.json(
        { error: hasil.masalah ? masalahUmumJadiTeks(hasil.masalah) : hasil.pesan, sebab: hasil.sebab },
        { status },
      );
    }
    return Response.json({ ok: true, kode, perubahan: hasil.draf.perubahan, kunci: hasil.draf.kunci });
  } catch (e) {
    const pesan = (e as Error).message;
    console.error(`jalankan ${kode} gagal:`, pesan);
    return Response.json({ error: pesan }, { status: 500 });
  }
}
