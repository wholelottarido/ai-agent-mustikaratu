import { after } from "next/server";
import type { Agent } from "@voltagent/core";
import { cookies } from "next/headers";
import { sumberAktif } from "@/lib/sumber-db";
import { setWaitUntil } from "@voltagent/core";
import { bacaToken, NAMA_COOKIE } from "@/lib/sesi";
import { simpanPesan } from "@/lib/percakapan";
import { catatPemakaian, catatToken, cekKuota } from "@/lib/pemakaian";
import {
  ambilAgent,
  ambilDepartemen,
  KUNCI_MODEL,
  KUNCI_PENGGUNA,
  KUNCI_SALURAN,
  KUNCI_SUMBER,
  validasiModel,
} from "@/voltagent";
import { ambilModel, alamatOllama, ollamaHidup, pesanGalatOllama } from "@/voltagent/models";
import { siapkanAgent, jalurDiminta } from "@/voltagent/jalur-agent";
import type { Rancangan } from "@/voltagent/registry-tulis";

/**
 * Membungkus hasil stream jadi respons, sama untuk kedua jalur agent.
 *
 * Dipisah waktu jalur konfigurasi ditambahkan: dua salinan pencatatan token
 * berarti suatu hari salah satunya diperbaiki dan yang lain tidak, lalu
 * pemakaian di satu jalur berhenti tercatat tanpa ada yang sadar.
 */
type HasilStream = Awaited<ReturnType<Agent["streamText"]>>;

function balas(result: HasilStream, idPakai: number, sumber?: string[], rancangan?: Rancangan[], alat?: string[]) {
  // Jumlah token baru diketahui setelah stream selesai, sementara respons
  // harus dikembalikan SEKARANG. Jadi dicatat di latar -- dan kegagalannya
  // tidak boleh merusak jawaban yang sudah jadi.
  // `result.usage` bertipe PromiseLike, bukan Promise penuh -- tidak punya
  // `.catch`, jadi dibungkus dulu.
  if (result.usage) {
    void Promise.resolve(result.usage)
      .then((u) => catatToken(idPakai, u))
      .catch((e: unknown) => console.error("[/api/chat] gagal catat token:", e));
  }

  // Token dikirim ke klien lewat metadata pesan. Part `finish` bawaan cuma
  // memuat `finishReason` -- tanpa ini jumlah token tidak pernah sampai ke
  // tampilan, walaupun sudah tercatat di tabel `pemakaian`.
  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") return undefined;

      // Nama field dibaca defensif. Tipe `LanguageModelUsage` menjanjikan
      // satu bentuk, objek aslinya pernah beda -- lihat catatan di
      // `lib/pemakaian.ts` soal UsageInfo yang berbohong.
      // Lewat `unknown` dulu: `LanguageModelUsage` punya field bersarang
      // (`inputTokenDetails`) yang tidak cocok dengan bentuk datar di bawah,
      // jadi TypeScript menolak cast langsung.
      const u = (part.totalUsage ?? {}) as unknown as {
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
      };
      const masuk = u.inputTokens ?? u.promptTokens;
      const keluar = u.outputTokens ?? u.completionTokens;
      // `sumber` dibaca DI SINI, bukan waktu `balas` dipanggil: arraynya masih
      // kosong saat itu dan baru terisi selama stream berjalan.
      const dariKonfig = sumber && sumber.length > 0 ? { sumber: [...sumber] } : undefined;
      // ⚠️ ALAT DIKIRIM TERPISAH DARI SUMBER, dan keduanya perlu.
      //
      // Nama view menjawab "datanya dari mana"; nama alat menjawab "yang
      // mengambilnya apa". Satu view bisa dibaca beberapa alat dengan cakupan
      // berbeda — `asisten_tiket` (tiket saya) dan `asisten_antrean_tiket`
      // (seluruh perusahaan) membaca view yang sama. Menyebut view-nya saja
      // membuat keduanya tak terbedakan.
      const dipakai = alat && alat.length > 0 ? { alat: [...alat] } : undefined;

      // ⚠️ Rancangan ikut DI SINI, bukan lewat part tool.
      //
      // Waktu router mendelegasikan ke agent aplikasi, pemanggilan tool agent
      // bawahan tidak sampai ke klien -- yang lewat cuma `delegate_task`. Jadi
      // klien tidak pernah melihat `tool-siapkan_tiket`, dan kartu
      // konfirmasinya tidak pernah muncul: persis yang terjadi 8 Okt 2026,
      // rancangan tersusun benar tapi tombol Simpan tidak ada.
      //
      // Yang dikirim cuma rancangan TERAKHIR. Satu jawaban yang menyiapkan dua
      // tiket sekaligus akan memunculkan dua kartu yang sulit dibedakan, dan
      // user tidak punya cara tahu tombol mana menyimpan yang mana.
      const draf = rancangan && rancangan.length > 0
        ? { rancangan: rancangan[rancangan.length - 1] }
        : undefined;

      if (masuk === undefined && keluar === undefined) {
        return dariKonfig || draf || dipakai ? { ...dariKonfig, ...dipakai, ...draf } : undefined;
      }

      return { token: { masuk: masuk ?? null, keluar: keluar ?? null }, ...dariKonfig, ...dipakai, ...draf };
    },
  });
}

export async function POST(req: Request) {
  try {
    // Departemen diambil dari COOKIE SESI, tidak pernah dari body request.
    // Kalau dari body, orang marketing tinggal kirim {"departemen":"hr"}
    // lewat curl dan tembus ke data HR. Sama prinsipnya dengan `model`
    // yang divalidasi ke whitelist.
    const sesi = await bacaToken((await cookies()).get(NAMA_COOKIE)?.value);
    if (!sesi) {
      return Response.json(
        { error: "Belum login atau sesi sudah habis. Silakan masuk lagi." },
        { status: 401 },
      );
    }

    const { messages, model, percakapanId } = await req.json();

    // `model` datang dari browser -- JANGAN dipercaya mentah.
    const modelDipakai = validasiModel(model);
    const pilihan = ambilModel(modelDipakai);

    // Model lokal butuh Ollama hidup. Tanpa pemeriksaan ini, user cuma
    // melihat "fetch failed" -- tidak ada petunjuk apa yang harus dilakukan.
    if (pilihan.penyedia === "lokal" && !(await ollamaHidup())) {
      return Response.json(
        {
          error:
            `Model lokal "${pilihan.label}" butuh Ollama berjalan, tapi ` +
            `${alamatOllama()} tidak bisa dihubungi. Nyalakan Ollama dulu, ` +
            `atau pilih model Claude di dropdown.`,
        },
        { status: 503 },
      );
    }

    // Kuota diperiksa SEBELUM apa pun ditulis atau dipanggil. Model lokal
    // selalu lolos -- dia tidak memakai kredit API.
    const kuota = await cekKuota(sesi.id, modelDipakai);
    if (!kuota.boleh) {
      return Response.json(
        { error: kuota.pesan },
        { status: 429, headers: { "Retry-After": String(kuota.pulihDetik) } },
      );
    }

    // Simpan pertanyaan user di SERVER, bukan di klien: ini harus tersimpan
    // walaupun browser ditutup sebelum jawabannya selesai mengalir.
    if (Number.isInteger(percakapanId) && percakapanId > 0) {
      const terakhir = Array.isArray(messages) ? messages.at(-1) : undefined;
      if (terakhir?.role === "user") {
        const teks = (terakhir.parts ?? [])
          .filter((p: { type: string }) => p.type === "text")
          .map((p: { text: string }) => p.text)
          .join("");
        if (teks.trim()) {
          await simpanPesan(percakapanId, sesi.id, { peran: "user", teks });
        }
      }
    }

    // Supaya trace observability sempat terkirim sebelum function mati
    // (penting waktu deploy serverless; tidak merugikan di lokal).
    setWaitUntil(after);

    // Kirim SELURUH riwayat, bukan cuma pesan terakhir -- biar agent
    // ingat konteks percakapan.
    const idPakai = await catatPemakaian(sesi.id, "web", modelDipakai);

    // ⚠️ DUA JALUR AGENT. Lihat `voltagent/jalur-agent.ts`.
    //
    // Jalur `konfigurasi` memakai agent per aplikasi yang dibaca dari database
    // perusahaan; jalur `lama` memakai agent per departemen yang ditulis di
    // kode. Yang menentukan `JALUR_AGENT` di environment, bawaannya `lama`.
    const jalur = await siapkanAgent(sesi.idEmployee);

    if (jalur.jalur === "konfigurasi") {
      // Identitas penyaring sudah tertanam di dalam tool-nya waktu agent ini
      // dirakit -- tidak ikut lewat context, dan tidak pernah dari body.
      console.info(
        `[/api/chat] jalur konfigurasi — ${jalur.bawahan.length} agent aplikasi` +
          (jalur.dilewati.length ? `, ${jalur.dilewati.length} tool dilewati` : "") +
          (jalur.gantian.length ? `, ${jalur.gantian.length} agent memakai tool portal` : ""),
      );
      // Penggantian tool dicetak satu per satu: aturan yang tidak kelihatan
      // adalah aturan yang suatu hari lepas tanpa ada yang tahu.
      for (const g of jalur.gantian) {
        console.info(`[/api/chat]   ${g.agent}: ${g.dipakai} menggantikan ${g.menggantikan.join(", ") || "(tidak ada)"}`);
      }

      const hasil = await jalur.agent.streamText(messages, {
        context: { [KUNCI_MODEL]: modelDipakai, [KUNCI_SALURAN]: "web" },
      });
      return balas(hasil, idPakai, jalur.sumber, jalur.rancangan, jalur.alat);
    }

    // Jatuh ke jalur lama. Sebabnya DICATAT, tidak pernah diam-diam -- saklar
    // yang menyala tapi tidak berefek lebih buruk daripada saklar yang mati.
    if (jalurDiminta() === "konfigurasi") {
      console.warn(`[/api/chat] JALUR_AGENT=konfigurasi tapi jatuh ke jalur lama: ${jalur.sebab}`);
    }

    const dep = ambilDepartemen(sesi.departemen);
    if (!dep) {
      // Bisa terjadi kalau departemen dihapus dari kode sementara user masih
      // punya sesi lama. Lebih baik ditolak daripada jatuh ke departemen lain.
      console.error(`[/api/chat] departemen "${sesi.departemen}" tidak dikenal`);
      return Response.json(
        { error: "Departemen akun ini belum terdaftar di sistem. Hubungi admin." },
        { status: 403 },
      );
    }

    const result = await ambilAgent(dep, sesi.peran).streamText(messages, {
      context: {
        [KUNCI_MODEL]: modelDipakai,
        // Identitas dari SESI, bukan dari body request. Kalau diambil dari
        // body, siapa pun bisa mengaku sebagai orang lain lewat curl dan
        // membatalkan order yang bukan miliknya.
        [KUNCI_PENGGUNA]: {
          id: sesi.id,
          username: sesi.username,
          // ⚠️ Ikut supaya agent tidak menanyakan identitas ke orang yang
          // SUDAH login. Lihat `bagianIdentitas()` di `voltagent/agents.ts`.
          nama: sesi.nama,
          // Dipakai menyaring baris waktu sumbernya perusahaan.
          idEmployee: sesi.idEmployee,
        },
        // Saklar di /dbadmin. `sumberAktif()` tidak pernah melempar
        // error -- kalau tabelnya belum ada, jatuh ke "dummy".
        [KUNCI_SUMBER]: await sumberAktif(),
      },
    });

    return balas(result, idPakai);
  } catch (error) {
    console.error("[/api/chat]", error);

    // Kegagalan Ollama yang dikenali (mis. model tidak muat di memori) dibalas
    // dengan saran yang bisa ditindaklanjuti, bukan stack trace.
    const ramah = pesanGalatOllama(error);
    if (ramah) return Response.json({ error: ramah }, { status: 503 });

    const pesan = error instanceof Error ? error.message : "Kesalahan tidak dikenal";
    return Response.json({ error: pesan }, { status: 500 });
  }
}
