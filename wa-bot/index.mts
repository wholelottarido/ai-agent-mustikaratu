/**
 * Bot WhatsApp.
 *
 * Jalankan: npm run wa
 *
 * Perintah: /baru, /model, /bantuan.
 *
 * Agent yang dipakai ditentukan DEPARTEMEN & PERAN pengirim, persis seperti
 * di web. Jadi lapisan keamanan yang sudah diuji -- user MySQL berbeda per
 * peran, GRANT per kolom -- ikut berlaku di WhatsApp tanpa ditulis ulang.
 *
 * ⚠️ PROSES TERPISAH dari Next.js, bukan di dalam route.
 * Baileys butuh koneksi WebSocket yang nyala terus, sementara Next.js dev
 * me-restart modul tiap kali berkas berubah -- koneksinya bakal putus atau,
 * lebih buruk, dobel.
 *
 * ⚠️ MEDIA TIDAK DISENTUH SAMA SEKALI.
 * `baileys@6.17.16` menarik `music-metadata` & `file-type` yang punya celah
 * infinite loop di parser ASF (audio). Satu-satunya perbaikan dari npm adalah
 * naik ke 7.0.0-rc14 yang masih release candidate. Selama kita tidak pernah
 * mengunduh atau mengirim media, parser itu tidak pernah dijalankan -- jadi
 * penolakan pesan non-teks di bawah bukan sekadar penyederhanaan, itu
 * pengaman.
 */
/**
 * ⚠️ Impor BERNAMA, bukan default.
 *
 * Semua contoh di dokumentasi Baileys menulis
 * `import makeWASocket from "baileys"`. Lewat ESM itu TIDAK jalan: Baileys
 * dipaketkan sebagai CommonJS, jadi impor default-nya menghasilkan object
 * namespace, bukan fungsi. Gejalanya `makeWASocket is not a function` --
 * dan itu baru muncul saat dijalankan, lolos typecheck.
 *
 * Diverifikasi langsung: `typeof default` -> "object",
 * `typeof makeWASocket` -> "function".
 */
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  type WASocket,
  type proto,
} from "baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cariIdentitas } from "./identitas.mts";
import { tukarKode } from "../lib/wa-kode.ts";
import { ambilTeks, alasanDilewati } from "./pesan.mts";
import { keWhatsApp, pecah } from "./format.mts";
import {
  ambilAgent,
  ambilDepartemen,
  bolehEntri,
  type EntitasEntri,
  KUNCI_MODEL,
  KUNCI_PENGGUNA,
  KUNCI_SALURAN,
  KUNCI_SUMBER,
} from "../voltagent/index.ts";
import {
  MODEL_TERSEDIA,
  URUTAN_PENYEDIA,
  NAMA_PENYEDIA,
  alamatOllama,
  ollamaHidup,
  pesanGalatOllama,
  hitungBiaya,
  formatRupiah,
} from "../voltagent/models.ts";
import { cariModel, modelPilihan, simpanModelPilihan } from "../lib/preferensi-wa.ts";
import { tabelDariSql } from "../lib/sumber-data.ts";
import { jawabanPalsu, pesanGagal } from "../lib/jawaban-palsu.ts";
import { simpanPenjualan } from "../lib/entri/simpan.ts";
import { drafJadiTeks, type Draf, type Permintaan } from "../lib/entri/penjualan.ts";
import { batalkanPenjualan, batalJadiTeks, type OrderBatal } from "../lib/entri/batal.ts";
import {
  bacaJawabanBatal, bacaJawabanEntri, bacaJawabanKeputusan,
} from "../lib/entri/jawaban-wa.ts";
import { sumberAktif } from "../lib/sumber-db.ts";
import {
  putuskanLembur, lemburJadiTeks,
  type LemburMenunggu,
} from "../lib/entri/persetujuan.ts";
import {
  simpanLembur, drafLemburJadiTeks,
  type DrafLembur, type PermintaanLembur,
} from "../lib/entri/lembur.ts";
import {
  simpanPelamar, drafPelamarJadiTeks,
  type DrafPelamar, type PermintaanPelamar,
} from "../lib/entri/pelamar.ts";
import {
  buatJudul,
  buatPercakapan,
  percakapanBerjalan,
  riwayatTerakhir,
  simpanPesan,
} from "../lib/percakapan.ts";
import { catatPemakaian, catatToken, cekKuota } from "../lib/pemakaian.ts";

const DIR = dirname(fileURLToPath(import.meta.url));

/** Sesi login disimpan di sini supaya tidak perlu scan QR tiap restart. */
const FOLDER_AUTH = join(DIR, "auth");

/**
 * Baileys sangat berisik di level default. Yang kita butuhkan cuma error --
 * sisanya menenggelamkan log kita sendiri.
 */
const logger = pino({ level: "error" });

/**
 * Diam selama ini = pertanyaan berikutnya dianggap percakapan baru.
 *
 * Di WhatsApp tidak ada tombol "percakapan baru", jadi batas ini yang
 * menggantikannya. 2 jam: cukup longgar untuk rangkaian tanya-jawab yang
 * terputus rapat atau makan siang, cukup ketat supaya pertanyaan pagi ini
 * tidak terbawa konteks kemarin.
 */
const MENIT_DIAM = 120;

/**
 * Berapa pesan terakhir yang dikirim ulang ke agent.
 *
 * 10 = sekitar 5 tanya-jawab. Cukup untuk "kalau bulan juli berapa?" yang
 * merujuk pertanyaan sebelumnya, tanpa biaya token yang terus menumpuk
 * seiring panjangnya percakapan.
 */
const BATAS_RIWAYAT = 10;

/**
 * Pengirim yang pertanyaannya sedang diproses.
 *
 * Tanpa ini, orang yang mengirim tiga pesan beruntun memicu tiga agent
 * sekaligus -- balasannya bisa datang tidak berurutan, dan riwayat yang
 * tersimpan jadi kacau karena keduanya menulis di waktu yang bersamaan.
 */
const sedangDiproses = new Set<string>();

/**
 * Pengirim yang minta percakapan direset lewat `/baru`.
 *
 * Disimpan di memori, hilang saat bot restart. Itu tidak apa-apa: efek
 * terburuknya cuma pertanyaan berikutnya nyambung ke percakapan lama, dan
 * user bisa mengetik `/baru` lagi.
 */
const mintaBaru = new Set<string>();

/**
 * Percobaan kode yang salah, per pengirim.
 *
 * Kode cuma 6 digit. Tanpa batas ini, skrip bisa mencoba ribuan kombinasi ke
 * bot sampai kena kode orang lain yang sedang aktif.
 */
const salahKode = new Map<string, number>();
const MAKS_SALAH_KODE = 5;

/**
 * Draf entri yang menunggu konfirmasi, per pengirim.
 *
 * ⚠️ Di memori, hilang saat bot restart. Itu DISENGAJA aman: draf yang hilang
 * berarti user diminta mengulang, bukan data yang salah tersimpan. Menyimpannya
 * di database justru menambah jalur yang harus dijaga tanpa manfaat nyata --
 * umurnya cuma 10 menit.
 *
 * Batas waktu itu penting: tanpa itu, balasan "YA" berjam-jam kemudian bisa
 * menyimpan draf yang sudah dilupakan user.
 */
/** Versi `bolehEntri` yang menerima id departemen -- untuk tempat yang
 *  belum memegang objek konfigurasinya. */
function bolehEntriDi(departemen: string, peran: string, entitas: EntitasEntri): boolean {
  const d = ambilDepartemen(departemen);
  return d ? bolehEntri(d, peran, entitas) : false;
}

const MENIT_DRAF = 10;

/**
 * Dua jenis draf yang bisa menunggu konfirmasi, dibedakan lewat `jenis`.
 *
 * Dipakai bersama SATU map: user cuma bisa punya satu hal yang menunggu pada
 * satu waktu. Kalau entri dan pembatalan punya antrean sendiri-sendiri,
 * balasan "YA" jadi ambigu -- dan yang ambigu di sini berarti salah tulis ke
 * database.
 */
type Menunggu =
  | {
      jenis: "entri";
      permintaan: Permintaan;
      sidik: string;
      draf: Draf;
      kalimat: string;
      kedaluwarsa: number;
    }
  | {
      jenis: "batal";
      noOrder: string;
      kalimat: string;
      kedaluwarsa: number;
    }
  | {
      jenis: "lembur";
      permintaan: PermintaanLembur;
      sidik: string;
      draf: DrafLembur;
      kalimat: string;
      kedaluwarsa: number;
    }
  | {
      jenis: "pelamar";
      permintaan: PermintaanPelamar;
      sidik: string;
      draf: DrafPelamar;
      kalimat: string;
      kedaluwarsa: number;
    }
  | {
      jenis: "keputusan";
      lembur: LemburMenunggu;
      kalimat: string;
      kedaluwarsa: number;
    };

const drafMenunggu = new Map<string, Menunggu>();

/**
 * Pesan 6 digit dari pengirim yang belum dikenal = kode verifikasi.
 *
 * Kodenya dibuat di portal web setelah user login, jadi menukarnya di sini
 * membuktikan dua hal sekaligus: dia memegang akun itu, DAN dia memegang
 * WhatsApp ini.
 */
async function tanganiKode(sock: WASocket, dari: string, kode: string): Promise<void> {
  const salah = salahKode.get(dari) ?? 0;
  if (salah >= MAKS_SALAH_KODE) {
    console.log(`  [kode] ${dari} diblokir setelah ${salah} percobaan salah`);
    return; // didiamkan, tidak memberi petunjuk apa pun
  }

  const hasil = await tukarKode(kode, dari).catch((e) => {
    console.error(`  [galat] tukar kode: ${e.message}`);
    return null;
  });

  if (!hasil || !hasil.ok) {
    if (hasil?.sebab === "wa-dipakai") {
      await sock.sendMessage(dari, {
        text: "WhatsApp ini sudah tertaut ke akun lain. Hubungi admin kalau ini keliru.",
      });
      return;
    }
    if (hasil?.sebab === "sudah-tertaut") {
      await sock.sendMessage(dari, {
        text: "Akun itu sudah punya WhatsApp lain. Hubungi admin untuk menggantinya.",
      });
      return;
    }

    // Kode salah / kedaluwarsa. Dihitung, dan pesannya sengaja tidak
    // membedakan keduanya -- membedakannya membocorkan kode mana yang pernah
    // ada.
    salahKode.set(dari, salah + 1);
    console.log(`  [kode] ${dari} salah (${salah + 1}/${MAKS_SALAH_KODE})`);
    await sock.sendMessage(dari, {
      text: "Kode tidak cocok atau sudah kedaluwarsa. Ambil kode baru di portal web ya.",
    });
    return;
  }

  salahKode.delete(dari);

  const siapa = await cariIdentitas(dari);
  console.log(`  [kode] ${dari} -> tertaut ke ${siapa?.username ?? hasil.penggunaId}`);

  await sock.sendMessage(dari, {
    text: [
      `✅ Tertaut dengan akun *${siapa?.nama ?? "kamu"}*`,
      siapa ? `${siapa.peran} di departemen ${siapa.departemen}` : "",
      "",
      "Sekarang kamu bisa langsung tanya soal data departemenmu di sini.",
      "Ketik */bantuan* untuk lihat perintah yang ada.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

/**
 * Perintah `/model` — lihat daftar, atau ganti.
 *
 * Di web pilihan model ada di dropdown dan ikut dikirim tiap request. Di
 * WhatsApp tidak ada dropdown, jadi pilihannya diingat per pengguna.
 */
async function tanganiModel(
  sock: WASocket,
  dari: string,
  penggunaId: number,
  argumen: string,
): Promise<void> {
  const sekarang = await modelPilihan(penggunaId);

  // Tanpa argumen: tampilkan daftar, DIKELOMPOKKAN per penyedia.
  //
  // Pengelompokannya bukan hiasan -- bedanya nyata bagi user. Yang di server
  // kantor tidak butuh apa pun di komputer ini; yang "komputer ini" butuh
  // Ollama menyala. Urutan & namanya diambil dari `voltagent/models.ts`,
  // sumber yang sama dengan dropdown di web, supaya keduanya tidak melenceng.
  if (!argumen) {
    const baris: string[] = [];
    for (const grup of URUTAN_PENYEDIA) {
      const isi = MODEL_TERSEDIA.filter((m) => m.penyedia === grup);
      if (isi.length === 0) continue;

      baris.push(`*${NAMA_PENYEDIA[grup]}*`);
      for (const m of isi) {
        const tanda = m.id === sekarang.id ? "▸" : "•";
        const kata = m.label.split(" ")[0].toLowerCase();
        baris.push(`${tanda} ${m.label} — ketik \`/model ${kata}\``);
        baris.push(`   _${m.keterangan}_`);
      }
      baris.push("");
    }

    await sock.sendMessage(dari, {
      text: [
        `Model sekarang: *${sekarang.label}*`,
        "",
        ...baris,
        // Kalimat ini dulu juga berbunyi "tapi angkanya sering salah". Itu
        // benar untuk qwen2.5, TIDAK untuk Gemma yang 6/6 benar waktu diukur.
        // Peringatan ketelitian sekarang ada di keterangan tiap model, bukan
        // digeneralisasi ke semua model gratis.
        "_Model lokal tidak memakai kuota sama sekali._",
      ].join("\n"),
    });
    return;
  }

  // `cariModel` mengembalikan null kalau tidak ketemu ATAU ambigu -- lebih
  // baik user memperjelas daripada bot memilihkan yang salah.
  const pilih = cariModel(argumen);
  if (!pilih) {
    await sock.sendMessage(dari, {
      text: [
        `Model "${argumen}" tidak dikenali.`,
        "",
        "Pilihannya:",
        ...MODEL_TERSEDIA.map((m) => `• ${m.label.split(" ")[0].toLowerCase()} — ${m.label}`),
      ].join("\n"),
    });
    return;
  }

  // Model lokal butuh Ollama hidup. Diperiksa SAAT MEMILIH, bukan nanti saat
  // bertanya -- kalau tidak, user mengira pilihannya berhasil lalu bingung
  // kenapa semua pertanyaannya gagal.
  if (pilih.penyedia === "lokal" && !(await ollamaHidup())) {
    await sock.sendMessage(dari, {
      text: [
        `⚠️ *${pilih.label}* butuh Ollama berjalan di komputer server,`,
        `tapi ${alamatOllama()} tidak bisa dihubungi.`,
        "",
        `Model tetap *${sekarang.label}*. Coba lagi setelah Ollama dinyalakan.`,
      ].join("\n"),
    });
    return;
  }

  await simpanModelPilihan(penggunaId, pilih.id);
  console.log(`  [model] ${dari} -> ${pilih.id}`);

  await sock.sendMessage(dari, {
    text: [
      `✅ Model diganti ke *${pilih.label}*`,
      `_${pilih.keterangan}_`,
      "",
      pilih.penyedia === "lokal"
        ? "Model lokal *tidak memakai kuota*, tapi lebih lambat dan angkanya sering salah — selalu cek ulang."
        : "Pertanyaan berikutnya memakai kuota Claude kamu.",
    ].join("\n"),
  });
}

/**
 * Proses satu pesan masuk.
 *
 * Dipisah jadi fungsi sendiri karena butuh `await` (query database), sementara
 * handler `messages.upsert` tidak boleh dibikin async -- kalau iya, kegagalan
 * di dalamnya jadi unhandled rejection yang tidak kelihatan.
 */
async function tangani(sock: WASocket, pesan: proto.IWebMessageInfo): Promise<void> {
  const dari = pesan.key.remoteJid ?? "?";

  const lewat = alasanDilewati(pesan);
  if (lewat) {
    console.log(`  [lewat] ${dari} — ${lewat}`);
    return;
  }

  const teks = ambilTeks(pesan)!;
  const siapa = await cariIdentitas(dari).catch((e) => {
    console.error(`  [galat] gagal baca database: ${e.message}`);
    return null;
  });

  if (!siapa) {
    // ⚠️ KODE VERIFIKASI DIPERIKSA DI SINI, sebelum pengirim tak dikenal
    // didiamkan. Kode justru datang dari orang yang BELUM dikenal -- itu
    // memang gunanya. Kalau urutannya dibalik, kodenya tidak akan pernah
    // terbaca dan gejalanya bot diam saja tanpa error apa pun.
    if (/^\d{6}$/.test(teks)) {
      await tanganiKode(sock, dari, teks);
      return;
    }

    // SENGAJA TIDAK DIBALAS. Kalau dibalas "nomor Anda belum terdaftar",
    // orang asing yang iseng jadi tahu nomor ini bot perusahaan. Percobaannya
    // tetap tercatat di sini supaya Anda bisa melihatnya.
    const nama = pesan.pushName ?? "?";
    console.log(`  [tidak terdaftar] ${dari} (nama WA: ${nama}): ${teks}`);
    console.log(`     daftarkan: npm run wa:daftar -- ${dari} <username>`);
    return;
  }

  console.log(`  [masuk] ${siapa.nama} (${siapa.departemen}/${siapa.peran}): ${teks}`);

  // Konfirmasi entri dicek PALING AWAL: "YA" itu jawaban atas draf, bukan
  // pertanyaan baru untuk agent. Kalau diteruskan ke model, dia akan
  // menjawabnya sebagai obrolan biasa dan drafnya menggantung.
  const menunggu = drafMenunggu.get(dari);
  if (menunggu) {
    if (Date.now() > menunggu.kedaluwarsa) {
      drafMenunggu.delete(dari);
      await sock.sendMessage(dari, {
        text: `Draf sebelumnya sudah kedaluwarsa (lewat ${MENIT_DRAF} menit). Ulangi permintaannya ya.`,
      });
      return;
    }

    // --- Pembatalan: "YA <alasan>", alasannya WAJIB ikut di pesan ---
    //
    // Di web alasan diketik di kolom kartu. Di WhatsApp tidak ada kolom, jadi
    // satu-satunya tempat yang tersisa adalah pesan balasannya sendiri.
    // Alasannya TIDAK boleh disusun model -- lihat komentar di tools-entri.ts.
    if (menunggu.jenis === "batal") {
      const jawab = bacaJawabanBatal(teks);

      if (jawab.aksi === "batalkan") {
        drafMenunggu.delete(dari);
        const alasan = jawab.alasan;
        try {
          const hasil = await batalkanPenjualan(menunggu.noOrder, alasan, {
            penggunaId: siapa.id,
            username: siapa.username,
            departemen: siapa.departemen,
            peran: siapa.peran,
            asal: "wa",
            permintaan: menunggu.kalimat,
          });
          await sock.sendMessage(dari, {
            text: hasil.ok
              ? `✅ *${hasil.noOrder}* dibatalkan.\nTidak lagi dihitung sebagai omzet.`
              : `⚠️ Gagal membatalkan: ${hasil.pesan}`,
          });
        } catch (e) {
          console.error(`  [galat] batal: ${e instanceof Error ? e.message : String(e)}`);
          await sock.sendMessage(dari, { text: "⚠️ Gagal membatalkan. Coba ulangi permintaannya." });
        }
        return;
      }

      // "YA" polos tanpa alasan: drafnya DIPERTAHANKAN supaya user tinggal
      // mengetik ulang dengan alasannya, tidak perlu menyebut nomor order lagi.
      if (jawab.aksi === "minta-alasan") {
        await sock.sendMessage(dari, {
          text: [
            "Alasannya belum ditulis. Alasan wajib diisi dan ikut tercatat di jejak audit.",
            "",
            `Contoh: *YA salah pelanggan*`,
          ].join("\n"),
        });
        return;
      }

      if (jawab.aksi === "urung") {
        drafMenunggu.delete(dari);
        await sock.sendMessage(dari, {
          text: `Oke, ${menunggu.noOrder} tidak jadi dibatalkan.`,
        });
        return;
      }

      // "BATAL" di sini ambigu: bisa berarti "lanjutkan pembatalannya" atau
      // "jangan jadi". Dua-duanya masuk akal, jadi JANGAN ditebak -- yang
      // salah tebak di sini berarti mengubah data yang tidak dimaksud.
      if (jawab.aksi === "ambigu") {
        await sock.sendMessage(dari, {
          text: [
            `"BATAL" bisa berarti dua hal di sini, jadi tolong perjelas:`,
            "",
            `• *YA <alasan>* — jadi batalkan ${menunggu.noOrder}`,
            "• *URUNG* — tidak jadi, biarkan seperti semula",
          ].join("\n"),
        });
        return;
      }

      drafMenunggu.delete(dari);
    } else if (menunggu.jenis === "lembur") {
      // Sama seperti entri penjualan: YA menyimpan, BATAL membuang. Di sini
      // "BATAL" TIDAK ambigu -- yang menunggu draf entri, bukan pembatalan.
      const jawab = bacaJawabanEntri(teks);
      if (jawab === "simpan") {
        drafMenunggu.delete(dari);
        try {
          const hasil = await simpanLembur(menunggu.permintaan, menunggu.sidik, {
            penggunaId: siapa.id,
            username: siapa.username,
            departemen: siapa.departemen,
            peran: siapa.peran,
            asal: "wa",
            permintaan: menunggu.kalimat,
          });
          await sock.sendMessage(dari, {
            text: hasil.ok
              ? `✅ Lembur tercatat untuk *${hasil.draf.karyawan.nama}*.\nMenunggu persetujuan.`
              : `⚠️ Gagal menyimpan: ${hasil.pesan}`,
          });
        } catch (e) {
          console.error(`  [galat] simpan lembur: ${e instanceof Error ? e.message : String(e)}`);
          await sock.sendMessage(dari, { text: "⚠️ Gagal menyimpan. Coba ulangi permintaannya." });
        }
        return;
      }
      if (jawab === "buang") {
        drafMenunggu.delete(dari);
        await sock.sendMessage(dari, { text: "Oke, dibatalkan. Tidak ada yang tersimpan." });
        return;
      }
      drafMenunggu.delete(dari);
    } else if (menunggu.jenis === "pelamar") {
      // Bentuknya sama dengan lembur; dipisah karena penyimpannya berbeda dan
      // `menunggu.permintaan` bertipe lain.
      const jawab = bacaJawabanEntri(teks);
      if (jawab === "simpan") {
        drafMenunggu.delete(dari);
        try {
          const hasil = await simpanPelamar(menunggu.permintaan, menunggu.sidik, {
            penggunaId: siapa.id,
            username: siapa.username,
            departemen: siapa.departemen,
            peran: siapa.peran,
            asal: "wa",
            permintaan: menunggu.kalimat,
          });
          await sock.sendMessage(dari, {
            text: hasil.ok
              ? `✅ Pelamar *${hasil.draf.nama}* tercatat untuk ${hasil.draf.lowongan.kode}.\nMasuk tahap ${hasil.draf.status}.`
              : `⚠️ Gagal menyimpan: ${hasil.pesan}`,
          });
        } catch (e) {
          console.error(`  [galat] simpan pelamar: ${e instanceof Error ? e.message : String(e)}`);
          await sock.sendMessage(dari, { text: "⚠️ Gagal menyimpan. Coba ulangi permintaannya." });
        }
        return;
      }
      if (jawab === "buang") {
        drafMenunggu.delete(dari);
        await sock.sendMessage(dari, { text: "Oke, dibatalkan. Tidak ada yang tersimpan." });
        return;
      }
      drafMenunggu.delete(dari);
    } else if (menunggu.jenis === "keputusan") {
      // ⚠️ Di sini "YA" TIDAK dipakai: yang menunggu DUA pilihan, jadi "ya"
      // tidak punya arti tunggal. Kata kerjanya harus disebut.
      const jawab = bacaJawabanKeputusan(teks);

      if (jawab.aksi === "setujui" || jawab.aksi === "tolak") {
        drafMenunggu.delete(dari);
        try {
          const hasil = await putuskanLembur(
            menunggu.lembur.id,
            jawab.aksi === "setujui" ? "APPROVED" : "REJECTED",
            jawab.aksi === "tolak" ? jawab.alasan : undefined,
            {
              penggunaId: siapa.id,
              username: siapa.username,
              departemen: siapa.departemen,
              peran: siapa.peran,
              asal: "wa",
              permintaan: menunggu.kalimat,
            },
          );
          await sock.sendMessage(dari, {
            text: hasil.ok
              ? jawab.aksi === "setujui"
                ? `✅ Lembur #${hasil.id} untuk *${hasil.lembur.karyawan.nama}* disetujui.`
                : `Lembur #${hasil.id} untuk *${hasil.lembur.karyawan.nama}* ditolak.`
              : `⚠️ Gagal: ${hasil.pesan}`,
          });
        } catch (e) {
          console.error(`  [galat] putuskan lembur: ${e instanceof Error ? e.message : String(e)}`);
          await sock.sendMessage(dari, { text: "⚠️ Gagal menyimpan keputusan. Coba lagi." });
        }
        return;
      }

      if (jawab.aksi === "minta-alasan") {
        // Draf DIPERTAHANKAN supaya user tinggal mengulang dengan alasannya.
        await sock.sendMessage(dari, {
          text: ["Alasan penolakan belum ditulis.", "", "Contoh: *TOLAK jam tidak sesuai absensi*"].join("\n"),
        });
        return;
      }

      if (jawab.aksi === "urung") {
        drafMenunggu.delete(dari);
        await sock.sendMessage(dari, {
          text: `Oke, lembur #${menunggu.lembur.id} dibiarkan menunggu.`,
        });
        return;
      }

      if (jawab.aksi === "ambigu") {
        await sock.sendMessage(dari, {
          text: [
            "Balasan itu belum jelas menunjuk pilihan yang mana. Balas salah satu:",
            "",
            "• *SETUJU*",
            "• *TOLAK <alasan>*",
            "• *NANTI* — biarkan menunggu",
          ].join("\n"),
        });
        return;
      }

      drafMenunggu.delete(dari);
    } else if (bacaJawabanEntri(teks) === "simpan") {
      drafMenunggu.delete(dari);
      try {
        const hasil = await simpanPenjualan(menunggu.permintaan, menunggu.sidik, {
          penggunaId: siapa.id,
          username: siapa.username,
          departemen: siapa.departemen,
          peran: siapa.peran,
          asal: "wa",
          permintaan: menunggu.kalimat,
        });
        await sock.sendMessage(dari, {
          text: hasil.ok
            ? `✅ Tersimpan.
Nomor order: *${hasil.noOrder}*`
            : `⚠️ Gagal menyimpan: ${hasil.pesan}`,
        });
      } catch (e) {
        console.error(`  [galat] simpan entri: ${e instanceof Error ? e.message : String(e)}`);
        await sock.sendMessage(dari, { text: "⚠️ Gagal menyimpan. Coba ulangi permintaannya." });
      }
      return;
    }

    if (bacaJawabanEntri(teks) === "buang") {
      drafMenunggu.delete(dari);
      await sock.sendMessage(dari, { text: "Oke, dibatalkan. Tidak ada yang tersimpan." });
      return;
    }

    // Bukan YA/BATAL -- drafnya dibuang dan pesan ini diperlakukan sebagai
    // permintaan baru. Membiarkannya menggantung lebih berbahaya: "YA" jauh
    // kemudian bisa menyimpan sesuatu yang sudah tidak dimaksud lagi.
    drafMenunggu.delete(dari);
  }

  // Perintah dicek SEBELUM agent dipanggil -- tidak perlu model untuk
  // menjawab "/bantuan", dan itu menghemat waktu sekaligus biaya.
  const perintah = teks.toLowerCase();
  if (perintah === "/baru" || perintah === "/reset") {
    mintaBaru.add(dari);
    await sock.sendMessage(dari, {
      text: "Oke, percakapan direset 🔄\nPertanyaan berikutnya dimulai dari awal.",
    });
    return;
  }
  if (perintah === "/bantuan" || perintah === "/help") {
    const sekarang = await modelPilihan(siapa.id);
    await sock.sendMessage(dari, {
      text: [
        `Halo ${siapa.nama} 👋`,
        "",
        `Kamu terdaftar sebagai *${siapa.peran}* di departemen *${siapa.departemen}*.`,
        "Tanya saja langsung soal data departemenmu.",
        ...(bolehEntriDi(siapa.departemen, siapa.peran, "penjualan")
          ? [
              "",
              "*Mencatat penjualan:*",
              '_"catat 10 masker beras ke UD Sentosa Bekasi"_',
              "Aku tampilkan drafnya dulu — tersimpan hanya setelah kamu balas *YA*.",
            ]
          : []),
        "",
        "*Perintah:*",
        "• /baru — mulai percakapan dari awal",
        "• /model — lihat & ganti model",
        "• /bantuan — tampilkan pesan ini",
        "",
        `Model sekarang: *${sekarang.label}*`,
        `_Percakapan otomatis dimulai ulang kalau diam lebih dari ${MENIT_DIAM / 60} jam._`,
      ].join("\n"),
    });
    return;
  }

  if (perintah === "/model" || perintah.startsWith("/model ")) {
    await tanganiModel(sock, dari, siapa.id, teks.slice("/model".length).trim());
    return;
  }

  const dep = ambilDepartemen(siapa.departemen);
  if (!dep) {
    // Departemen ada di database tapi belum terdaftar di kode. Lebih baik
    // ditolak daripada user dapat agent departemen lain -- penjaga yang sama
    // ada di /api/chat.
    console.error(`  [galat] departemen "${siapa.departemen}" tidak dikenal sistem`);
    await sock.sendMessage(dari, {
      text: "Departemen akun kamu belum terdaftar di sistem. Hubungi admin ya.",
    });
    return;
  }

  // Kuota diperiksa sebelum kunci diambil: kalau habis, tidak ada gunanya
  // menahan giliran orang ini.
  const model = await modelPilihan(siapa.id);
  const kuota = await cekKuota(siapa.id, model.id);
  if (!kuota.boleh) {
    console.log(`  [kuota] ${siapa.nama} kena batas`);
    await sock.sendMessage(dari, {
      text: [
        "⏳ Kuota pertanyaan kamu sudah habis.",
        "",
        // Pesan dari lib/pemakaian.ts menyebut "dropdown", yang cuma ada di
        // web. Di WhatsApp tidak ada dropdown model.
        kuota.pesan.replace(" di dropdown — yang itu tanpa batas.", " lewat portal web."),
        "",
        "_Model lokal tanpa batas, tapi angkanya sering salah — selalu cek ulang._",
      ].join("\n"),
    });
    return;
  }

  if (sedangDiproses.has(dari)) {
    await sock.sendMessage(dari, {
      text: "Sabar ya, pertanyaan kamu sebelumnya masih aku kerjakan 🙏",
    });
    return;
  }
  sedangDiproses.add(dari);

  // "Sedang mengetik" selama agent bekerja: pertanyaan data bisa makan 5-30
  // detik, dan tanpa tanda apa pun user mengira botnya mati.
  await sock.sendPresenceUpdate("composing", dari);
  const mulaiDetik = Date.now();

  try {
    // `/baru` memaksa percakapan bersih tanpa menunggu 2 jam.
    const paksaBaru = mintaBaru.delete(dari);

    let percakapanId = paksaBaru
      ? null
      : await percakapanBerjalan(siapa.id, siapa.departemen, MENIT_DIAM);
    if (!percakapanId) {
      percakapanId = await buatPercakapan(siapa.id, siapa.departemen, buatJudul(teks), "wa");
      console.log(`  [percakapan] baru #${percakapanId}`);
    }

    // Pertanyaan disimpan SEBELUM agent dipanggil -- kalau bot mati di tengah
    // jalan, pertanyaannya tetap tercatat. Pola yang sama dipakai di
    // /api/chat.
    await simpanPesan(percakapanId, siapa.id, { peran: "user", teks });

    // Riwayat diambil SETELAH pertanyaan disimpan, jadi pertanyaan barusan
    // sudah ikut di dalamnya -- tidak perlu ditambahkan manual.
    const riwayat = await riwayatTerakhir(percakapanId, siapa.id, BATAS_RIWAYAT);

    const idPakai = await catatPemakaian(siapa.id, "wa", model.id);

    const hasil = await ambilAgent(dep, siapa.peran).streamText(
      riwayat.map((m, i) => ({
        id: `wa-${percakapanId}-${i}`,
        role: m.peran,
        parts: [{ type: "text" as const, text: m.teks }],
      })),
      {
        context: {
          [KUNCI_MODEL]: model.id,
          // Inilah yang membuat agent memakai aturan format WhatsApp
          // (tanpa tabel) alih-alih aturan web.
          [KUNCI_SALURAN]: "wa",
          // Tanpa ini tool `siapkan_pembatalan` TIDAK terpasang sama sekali:
          // `buatTools` melewatinya kalau tidak tahu siapa penggunanya.
          [KUNCI_PENGGUNA]: {
            id: siapa.id,
            username: siapa.username,
            // ⚠️ Ikut supaya agent tidak menanyakan identitas ke orang yang
            // nomornya SUDAH terdaftar. Lihat `bagianIdentitas()` di
            // `voltagent/agents.ts`.
            nama: siapa.nama,
            idEmployee: siapa.idEmployee ?? null,
          },
          [KUNCI_SUMBER]: await sumberAktif(),
        },
      },
    );

    let jawaban = "";
    for await (const potongan of hasil.textStream) jawaban += potongan;

    // Sumber data diurai dari SQL yang BENAR-BENAR dijalankan, bukan dari
    // klaim agent di teks jawaban -- prinsip yang sama seperti di web.
    const langkah = await hasil.steps;
    const sql = langkah
      .flatMap((l) => l.toolCalls ?? [])
      // Dua nama tool: `query_db` (MySQL) dan `query_perusahaan` (PostgreSQL).
      .filter((t) => t.toolName === "query_db" || t.toolName === "query_perusahaan")
      .map((t) => (t.input as { sql?: string })?.sql ?? "");
    const sumber = tabelDariSql(sql);

    // Draf entri diambil dari HASIL TOOL, bukan dari teks jawaban model.
    // Teks bisa salah tulis; `sidik` di hasil tool inilah yang dipakai server
    // untuk memastikan yang disimpan sama dengan yang dilihat user.
    const drafBaru = langkah
      .flatMap((l) => (l as { toolResults?: { toolName: string; output?: unknown }[] }).toolResults ?? [])
      .filter((t) => t.toolName === "siapkan_penjualan")
      .map((t) => t.output as { status?: string; draf?: Draf; sidik?: string; permintaan?: Permintaan })
      .find((o) => o?.status === "siap" && o.draf && o.sidik);

    if (drafBaru?.draf && drafBaru.sidik && drafBaru.permintaan) {
      drafMenunggu.set(dari, {
        jenis: "entri",
        permintaan: drafBaru.permintaan,
        sidik: drafBaru.sidik,
        draf: drafBaru.draf,
        kalimat: teks,
        kedaluwarsa: Date.now() + MENIT_DRAF * 60_000,
      });
      console.log(`  [entri] draf menunggu konfirmasi (${MENIT_DRAF} menit)`);

      // Dikirim sendiri, tidak lewat jawaban model: bentuknya harus PERSIS
      // draf yang disimpan, dan teks model bisa berbeda dari hasil tool.
      await sock.sendMessage(dari, {
        text: [
          "*Belum tersimpan — periksa dulu:*",
          "",
          drafJadiTeks(drafBaru.draf),
          "",
          `Balas *YA* untuk simpan, atau *BATAL*. Berlaku ${MENIT_DRAF} menit.`,
        ].join("\n"),
      });
      return;
    }

    // Draf KEPUTUSAN lembur (HR, kepala). Cuma yang berstatus "siap" yang
    // memunculkan konfirmasi -- tool yang sama juga mengembalikan DAFTAR, dan
    // daftar bukan sesuatu yang bisa dikonfirmasi.
    const keputusanBaru = langkah
      .flatMap((l) => (l as { toolResults?: { toolName: string; output?: unknown }[] }).toolResults ?? [])
      .filter((t) => t.toolName === "siapkan_keputusan_lembur")
      .map((t) => t.output as { status?: string; lembur?: LemburMenunggu })
      .find((o) => o?.status === "siap" && o.lembur);

    if (keputusanBaru?.lembur) {
      drafMenunggu.set(dari, {
        jenis: "keputusan",
        lembur: keputusanBaru.lembur,
        kalimat: teks,
        kedaluwarsa: Date.now() + MENIT_DRAF * 60_000,
      });
      console.log(`  [keputusan] lembur #${keputusanBaru.lembur.id} menunggu (${MENIT_DRAF} menit)`);

      await sock.sendMessage(dari, {
        text: [
          "*Menunggu keputusan — belum diputuskan:*",
          "",
          lemburJadiTeks(keputusanBaru.lembur),
          "",
          "Balas *SETUJU*, atau *TOLAK <alasan>* — alasannya wajib kalau menolak.",
          `Belum mau memutuskan? Balas *NANTI*. Berlaku ${MENIT_DRAF} menit.`,
        ].join("\n"),
      });
      return;
    }

    // Draf PELAMAR (HR, staf).
    const pelamarBaru = langkah
      .flatMap((l) => (l as { toolResults?: { toolName: string; output?: unknown }[] }).toolResults ?? [])
      .filter((t) => t.toolName === "siapkan_pelamar")
      .map((t) => t.output as { status?: string; draf?: DrafPelamar; sidik?: string; permintaan?: PermintaanPelamar })
      .find((o) => o?.status === "siap" && o.draf && o.sidik);

    if (pelamarBaru?.draf && pelamarBaru.sidik && pelamarBaru.permintaan) {
      drafMenunggu.set(dari, {
        jenis: "pelamar",
        permintaan: pelamarBaru.permintaan,
        sidik: pelamarBaru.sidik,
        draf: pelamarBaru.draf,
        kalimat: teks,
        kedaluwarsa: Date.now() + MENIT_DRAF * 60_000,
      });
      console.log(`  [pelamar] draf menunggu konfirmasi (${MENIT_DRAF} menit)`);

      await sock.sendMessage(dari, {
        text: [
          "*Belum tersimpan — periksa dulu:*",
          "",
          drafPelamarJadiTeks(pelamarBaru.draf),
          "",
          `Balas *YA* untuk simpan, atau *BATAL*. Berlaku ${MENIT_DRAF} menit.`,
        ].join("\n"),
      });
      return;
    }

    // Draf LEMBUR (HR), sumbernya sama: hasil tool, bukan teks model.
    const lemburBaru = langkah
      .flatMap((l) => (l as { toolResults?: { toolName: string; output?: unknown }[] }).toolResults ?? [])
      .filter((t) => t.toolName === "siapkan_lembur")
      .map((t) => t.output as { status?: string; draf?: DrafLembur; sidik?: string; permintaan?: PermintaanLembur })
      .find((o) => o?.status === "siap" && o.draf && o.sidik);

    if (lemburBaru?.draf && lemburBaru.sidik && lemburBaru.permintaan) {
      drafMenunggu.set(dari, {
        jenis: "lembur",
        permintaan: lemburBaru.permintaan,
        sidik: lemburBaru.sidik,
        draf: lemburBaru.draf,
        kalimat: teks,
        kedaluwarsa: Date.now() + MENIT_DRAF * 60_000,
      });
      console.log(`  [lembur] draf menunggu konfirmasi (${MENIT_DRAF} menit)`);

      await sock.sendMessage(dari, {
        text: [
          "*Belum tersimpan — periksa dulu:*",
          "",
          drafLemburJadiTeks(lemburBaru.draf),
          "",
          `Balas *YA* untuk simpan, atau *BATAL*. Berlaku ${MENIT_DRAF} menit.`,
        ].join("\n"),
      });
      return;
    }

    // Draf PEMBATALAN, sumbernya sama: hasil tool, bukan teks model.
    const batalBaru = langkah
      .flatMap((l) => (l as { toolResults?: { toolName: string; output?: unknown }[] }).toolResults ?? [])
      .filter((t) => t.toolName === "siapkan_pembatalan")
      .map((t) => t.output as { status?: string; order?: OrderBatal })
      .find((o) => o?.status === "siap-batal" && o.order);

    if (batalBaru?.order) {
      drafMenunggu.set(dari, {
        jenis: "batal",
        noOrder: batalBaru.order.noOrder,
        kalimat: teks,
        kedaluwarsa: Date.now() + MENIT_DRAF * 60_000,
      });
      console.log(`  [batal] draf menunggu konfirmasi (${MENIT_DRAF} menit)`);

      await sock.sendMessage(dari, {
        text: [
          "*Akan dibatalkan — belum terjadi:*",
          "",
          batalJadiTeks(batalBaru.order),
          "",
          "Balas *YA <alasan>* untuk membatalkan — alasannya wajib dan ikut tercatat.",
          "Contoh: *YA salah pelanggan*",
          "",
          `Tidak jadi? Balas *URUNG*. Berlaku ${MENIT_DRAF} menit.`,
        ].join("\n"),
      });
      return;
    }

    // Berbeda dengan web, di sini stream sudah selesai jadi token-nya bisa
    // ditunggu langsung. Gagal mencatat tidak boleh menggagalkan jawaban.
    let token: { masuk: number | null; keluar: number | null } | null = null;
    if (hasil.usage) {
      const u = (await Promise.resolve(hasil.usage).catch(() => null)) as
        | Record<string, number | undefined>
        | null;
      if (u) {
        // Nama field dibaca defensif -- lihat catatan soal `UsageInfo` yang
        // berbohong di `lib/pemakaian.ts`.
        token = {
          masuk: u.inputTokens ?? u.promptTokens ?? null,
          keluar: u.outputTokens ?? u.completionTokens ?? null,
        };
        await catatToken(idPakai, u).catch((e: unknown) =>
          console.error("  [galat] gagal catat token:", e),
        );
      }
    }

    const detik = ((Date.now() - mulaiDetik) / 1000).toFixed(0);
    console.log(
      `  [jawab] ${detik} dtk, sumber: ${sumber.join(", ") || "(tidak query)"}` +
        (token ? `, token ${token.masuk}/${token.keluar}` : ""),
    );

    if (!jawaban.trim()) {
      await sock.sendMessage(dari, {
        text: "Maaf, aku belum berhasil menyusun jawabannya. Coba tanya ulang dengan kalimat lain ya.",
      });
      return;
    }

    // ⚠️ Jawaban karangan TIDAK DITAMPILKAN, bukan cuma diberi label.
    // Label memberi tahu, tapi yang sampai ke user tetap jawaban yang
    // bentuknya meyakinkan -- lihat `lib/jawaban-palsu.ts`.
    // Cuma untuk model lokal: Claude tidak punya masalah ini.
    // Semua model non-Claude, bukan cuma yang di komputer ini. Penyaringnya
    // konservatif (butuh 3+ placeholder atau SQL utuh sebagai teks), jadi
    // risiko salah tuduh kecil -- terbukti lewat 6 kasus "jangan salah tuduh"
    // di `npm run test:palsu`.
    if (model.penyedia !== "anthropic") {
      const vonis = jawabanPalsu(jawaban, sumber.length > 0);
      if (vonis.palsu) {
        console.log(`  [palsu] ditahan — ${vonis.sebab}`);
        await sock.sendMessage(dari, {
          text: [
            `⚠️ ${pesanGagal(vonis.sebab)}`,
            "",
            "Coba tanya ulang, atau pakai */model sonnet* yang lebih andal.",
          ].join("\n"),
        });
        return;
      }
    }

    // Disimpan SEBELUM dikirim: kalau pengiriman gagal di tengah, jawabannya
    // tetap ada di riwayat dan pertanyaan lanjutan masih nyambung.
    //
    // Yang disimpan teks ASLI agent, bukan hasil keWhatsApp(). Riwayat ini
    // juga dibaca di web, dan di sana markdown-nya memang dirender -- kalau
    // yang disimpan versi WhatsApp, tabelnya sudah terlanjur dibongkar.
    await simpanPesan(percakapanId, siapa.id, {
      peran: "assistant",
      teks: jawaban,
      model: model.id,
      detik: Number(detik),
      jumlahQuery: sql.length,
      tokenMasuk: token?.masuk ?? null,
      tokenKeluar: token?.keluar ?? null,
      sumber: sumber.join(", ") || null,
      sqlDipakai: sql.join("\n\n") || null,
    });

    // Token ditempel di baris catatan, sebaris dengan sumber data. Dipisah
    // koma, bukan baris sendiri -- di layar HP tiap baris tambahan terasa.
    const biaya = hitungBiaya(model.id, token?.masuk, token?.keluar);
    const bagianToken = token && (token.masuk !== null || token.keluar !== null)
      ? `${(token.masuk ?? 0).toLocaleString("id-ID")}↓ ${(token.keluar ?? 0).toLocaleString("id-ID")}↑ token` +
        (biaya !== null ? `, ${formatRupiah(biaya)}` : "")
      : "";

    const catatan =
      "_" +
      [
        sumber.length ? `sumber: ${sumber.join(", ")}` : "⚠️ tidak mengambil data dari database",
        bagianToken,
      ]
        .filter(Boolean)
        .join(" · ") +
      "_";

    // Dikirim berurutan, bukan sekaligus: WhatsApp bisa mengacak urutan pesan
    // yang dikirim bersamaan, dan potongan jawaban yang terbalik lebih
    // membingungkan daripada jawaban yang lambat.
    for (const bagian of pecah(`${keWhatsApp(jawaban)}\n\n${catatan}`)) {
      await sock.sendMessage(dari, { text: bagian });
    }
  } catch (e) {
    console.error(`  [galat] agent gagal: ${e instanceof Error ? e.message : String(e)}`);
    const ramah = pesanGalatOllama(e);
    await sock.sendMessage(dari, {
      text: ramah
        ? [`⚠️ ${ramah}`, "", "Ganti model dengan */model sonnet*."].join("\n")
        : "Maaf, ada gangguan waktu mengambil data. Coba lagi sebentar lagi ya.",
    });
  } finally {
    // Kunci WAJIB dilepas di sini. Kalau dilepas di jalur sukses saja, satu
    // kegagalan bikin orang itu terkunci selamanya sampai bot direstart.
    sedangDiproses.delete(dari);
    await sock.sendPresenceUpdate("paused", dari);
  }
}

async function mulai(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(FOLDER_AUTH);

  // Versi protokol diambil dari WhatsApp, tidak dipatok di kode. Kalau
  // dipatok, suatu hari WhatsApp menolak versinya dan bot mati tanpa sebab
  // yang jelas.
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`versi protokol WA: ${version.join(".")}${isLatest ? " (terbaru)" : " (BUKAN terbaru)"}`);

  const sock: WASocket = makeWASocket({
    version,
    auth: state,
    logger,
    // Nama yang muncul di menu "Perangkat Tertaut" di HP.
    browser: Browsers.ubuntu("Portal AI"),
    // Jangan tandai pesan sebagai sudah dibaca otomatis -- biar terlihat
    // wajar, dan supaya kita yang memutuskan kapan menandainya.
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan QR ini dari HP: WhatsApp > Perangkat Tertaut > Tautkan perangkat\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      const nomor = sock.user?.id?.split(":")[0] ?? "?";
      console.log(`\n✓ Tersambung sebagai ${nomor}`);
      console.log("  Menunggu pesan masuk. Tekan Ctrl+C untuk berhenti.\n");
      return;
    }

    if (connection === "close") {
      // Bentuknya dibaca langsung, bukan lewat `@hapi/boom`. Paket itu memang
      // ada di node_modules, tapi cuma sebagai dependensi turunan Baileys --
      // kalau Baileys menggantinya, impor kita ikut hilang tanpa peringatan.
      const kode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;

      // loggedOut = perangkat dihapus dari HP. Menyambung ulang percuma dan
      // malah jadi loop tanpa henti -- sesinya sudah tidak sah.
      if (kode === DisconnectReason.loggedOut) {
        console.log("\n✗ Sesi sudah tidak berlaku (logout dari HP).");
        console.log(`  Hapus folder ${FOLDER_AUTH} lalu jalankan lagi untuk scan ulang.\n`);
        process.exit(1);
      }

      // 515 restartRequired WAJIB disambung ulang: WhatsApp selalu memutus
      // koneksi tepat setelah scan QR pertama berhasil. Tanpa penanganan ini,
      // scan yang SUKSES terlihat seperti gagal.
      const nama = Object.entries(DisconnectReason).find(([, v]) => v === kode)?.[0] ?? kode;
      console.log(`koneksi putus (${nama}) — menyambung ulang...`);
      setTimeout(() => void mulai(), 3000);
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // "notify" = pesan baru masuk. "append" = riwayat lama yang disinkronkan
    // saat baru tersambung -- kalau ikut diproses, bot bakal membalas
    // pesan-pesan lama begitu dinyalakan.
    if (type !== "notify") return;

    for (const pesan of messages) {
      void tangani(sock, pesan);
    }
  });
}

mulai().catch((e) => {
  console.error("gagal menjalankan bot:", e);
  process.exit(1);
});
