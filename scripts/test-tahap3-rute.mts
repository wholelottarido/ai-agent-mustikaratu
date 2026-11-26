/**
 * Uji Tahap 3 (F.4) — rute berdasarkan kemampuan: unit + integrasi OFFLINE.
 *   npm run test:tahap3
 *
 * Tanpa model sungguhan, tanpa database, tanpa biaya. Integrasi memakai agent VoltAgent sungguhan dengan hook
 * yang SAMA dengan produksi (`voltagent/kendali-alur.ts`) dan server tiruan dua format (OpenAI-compatible untuk
 * Qwen, Anthropic). Perute tiruan SENGAJA memilih agent yang salah untuk membuktikan penjaga.
 * Kontrol negatif: `UJI_TANPA_PENJAGA=1` (perilaku sebelum Tahap 2–6) dan `UJI_TANPA_RUTE=1` (Tahap 2–6 tanpa Tahap 3).
 */
import { readFileSync } from "node:fs";
import { Agent, createTool } from "@voltagent/core";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { mulaiServerTiruan, type Format, type Jawaban, type Permintaan } from "./lib/server-tiruan.mts";
import { akar, buatRegistri, cocokkan, kebutuhanTugas, statusHandoff, statusHasilAlat, type AgentKemampuan, type RegistriKemampuan } from "../lib/alur/kemampuan.ts";
import { buatPemegangPenjaga, buatPenjagaAlur } from "../lib/alur/penjaga-alur.ts";
import { jagaPotongan } from "../lib/alur/jaga-stream.ts";
import { hookBawahan, kendaliPerute, teksKemampuan } from "../voltagent/kendali-alur.ts";
import { nilai, pesanInternalAtauKarangan } from "./lib/evaluator-agent.mts";

const KONTROL = process.env.UJI_TANPA_PENJAGA === "1";
const TANPA_RUTE = process.env.UJI_TANPA_RUTE === "1";
if (KONTROL) console.log("⚠️  KONTROL NEGATIF: tanpa penjaga sama sekali (sebelum Tahap 2–6)");
if (TANPA_RUTE) console.log("⚠️  KONTROL NEGATIF: penjaga Tahap 2–6 menyala, Tahap 3 (registri kemampuan) MATI");
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, rinci = "") => { ok ? lolos++ : gagal++; console.log(`${ok ? "LOLOS" : "GAGAL"}  ${nama}${rinci ? ` — ${rinci}` : ""}`); };
const ui = (peran: "user" | "assistant", teks: string) => ({ id: Math.random().toString(36), role: peran, parts: [{ type: "text", text: teks }] });

// ------------------------------------------------------------------ registri tiruan (bentuk = konfigurasi 24 Nov)
const A = {
  portal: (nama = "Ratu AI Portal"): AgentKemampuan => ({ nama, deskripsi: "Tiket helpdesk, aset, profil & job scope, induction karyawan.", alat: [
    { nama: "cari_sop", label: "Cari SOP / panduan", deskripsi: "Mencari isi dokumen SOP berdasarkan makna pertanyaan.", jenis: "dokumen" },
    { nama: "daftar_sop", label: "Daftar SOP", deskripsi: "Daftar dokumen SOP yang tersedia.", jenis: "dokumen" },
    { nama: "asisten_tiket", label: "Tiket saya", deskripsi: "Tiket helpdesk milik penanya beserta statusnya.", jenis: "data" },
    { nama: "siapkan_tiket", label: "Buat tiket helpdesk", deskripsi: "Menyusun rancangan tiket helpdesk untuk keluhan perangkat atau jaringan.", jenis: "tindakan" },
  ] }),
  super: (): AgentKemampuan => ({ nama: "Ratu AI Super Tools", deskripsi: "Kunjungan, callplan, order, tim lapangan, absensi, jam kerja, serta pengajuan cuti, izin, sakit, dan dinas.", alat: [
    { nama: "saldo_cuti", label: "Baca saldo cuti", deskripsi: "Saldo cuti tahunan karyawan.", jenis: "data" },
    { nama: "pengajuan_izin_cuti", label: "Baca pengajuan cuti/izin", deskripsi: "Pengajuan cuti/izin/sakit/dinas beserta status persetujuannya.", jenis: "data" },
    { nama: "stok_outlet", label: "Baca stok outlet", deskripsi: "Stok produk di outlet hasil pemeriksaan kunjungan.", jenis: "data" },
    { nama: "siapkan_izin_cuti", label: "Ajukan cuti/izin/sakit", deskripsi: "Mengajukan cuti, izin, sakit, dinas luar.", jenis: "tindakan" },
  ] }),
  marketing: (): AgentKemampuan => ({ nama: "Ratu AI Marketing", deskripsi: "Konten, analisis, dan live streaming marketing.", alat: [
    { nama: "total_penjualan", label: "Total penjualan", deskripsi: "Total penjualan seluruh perusahaan per bulan.", jenis: "data" },
    { nama: "stok_kosong", label: "Stok kosong", deskripsi: "Produk dan outlet yang paling sering kehabisan barang (stok kosong).", jenis: "data" },
  ] }),
  report: (): AgentKemampuan => ({ nama: "Ratu AI Report", deskripsi: "Laporan penjualan dan stok.", alat: [
    { nama: "jadwal_laporan", label: "Jadwal laporan", deskripsi: "Jadwal pengiriman laporan berkala ke email.", jenis: "data" },
  ] }),
  dashboard: (): AgentKemampuan => ({ nama: "Ratu AI Dashboard", deskripsi: "Ringkasan penjualan tim.", alat: [
    { nama: "kpi_tim", label: "KPI tim", deskripsi: "Capaian KPI tim lapangan.", jenis: "data" },
  ] }),
  admin: (): AgentKemampuan => ({ nama: "Ratu AI Admin", deskripsi: "Data master: karyawan, organisasi, aplikasi, dan akses.", alat: [
    { nama: "cari_sop", label: "Cari SOP / panduan", deskripsi: "Mencari isi dokumen SOP berdasarkan makna pertanyaan.", jenis: "dokumen" },
    { nama: "data_karyawan", label: "Data karyawan", deskripsi: "Master karyawan.", jenis: "data" },
  ] }),
};
const REG = buatRegistri([A.portal(), A.super(), A.marketing(), A.report(), A.dashboard()]);
const PORTAL = "Ratu AI Portal", SUPER = "Ratu AI Super Tools", MKT = "Ratu AI Marketing", REPORT = "Ratu AI Report";

if (!KONTROL && !TANPA_RUTE) {
  // ================================================================== unit: tujuan kalimat
  console.log("— tujuan tugas (kebutuhan)");
  const keb = (t: string) => kebutuhanTugas(t).kebutuhan;
  const harap: [string, string][] = [
    // A. prosedur
    ["Bagaimana prosedur pengajuan cuti?", "dokumen"], ["Apa saja syarat mengajukan cuti?", "dokumen"],
    ["Bagaimana cara mengajukan izin sakit?", "dokumen"], ["Bagaimana prosedur permintaan laptop kantor?", "dokumen"],
    ["Apa panduan membuat tiket helpdesk?", "dokumen"], ["Bagaimana aturan perjalanan dinas?", "dokumen"],
    ["Berapa lama proses persetujuan cuti?", "dokumen"], ["Siapa yang menyetujui pengajuan lembur?", "dokumen"],
    // B. status & data
    ["Apakah cuti saya sudah disetujui?", "data"], ["Berapa sisa cuti saya?", "data"], ["Bagaimana status pengajuan izin saya?", "data"],
    ["Apakah tiket saya sudah selesai?", "data"], ["Berapa total penjualan September?", "data"],
    ["Bandingkan penjualan Agustus dan September", "data"], ["halo, berapa sisa cuti saya?", "data"],
    // C. tindakan
    ["Buatkan tiket komputer rusak.", "tindakan"], ["Siapkan tiket untuk masalah jaringan.", "tindakan"],
    ["Saya ingin mengajukan permintaan perangkat.", "tindakan"], ["tolong ajukan cuti tanggal 5 Desember", "tindakan"],
    // D. ambigu
    ["Cuti saya bagaimana?", "tidak-jelas"], ["Bisa bantu masalah laptop?", "tidak-jelas"], ["Saya mau mengurus izin.", "tidak-jelas"],
    ["Produk apa saja yang stoknya kosong?", "tidak-jelas"],
    // E. lintas
    ["Berapa penjualan bulan lalu dan bagaimana SOP pengajuan cuti?", "campuran"],
    ["Tampilkan stok kosong dan jelaskan prosedur pelaporan masalah stok.", "campuran"],
    ["Bagaimana status tiket saya dan bagaimana prosedur meminta perangkat baru?", "campuran"],
    ["Buatkan tiket printer rusak dan jelaskan prosedurnya", "campuran"],
  ];
  for (const [t, k] of harap) cek(`"${t}" → ${k}`, keb(t) === k, keb(t));
  cek("akar kata: pengajuan~ajukan~mengajukan, tiketnya~tiket, penjualan~jual",
    akar("pengajuan") === akar("ajukan") && akar("mengajukan") === akar("ajukan") && akar("tiketnya") === "tiket" && akar("penjualan") === "jual");

  // ================================================================== unit: kecocokan kemampuan
  console.log("— kecocokan target (registri: Portal, Super Tools, Marketing, Report, Dashboard)");
  const ck = (target: string, t: string) => cocokkan(REG, target, t);
  const q4 = ck(SUPER, "Bagaimana prosedur pengajuan cuti?");
  cek("Q4: prosedur cuti → Super Tools TIDAK COCOK (tanpa alat dokumen), saran = Portal saja", q4.tingkat === "tidak-cocok" && q4.saran.join() === PORTAL, JSON.stringify(q4));
  cek("Q4: prosedur cuti → Portal COCOK", ck(PORTAL, "Bagaimana prosedur pengajuan cuti?").tingkat === "cocok");
  for (const t of ["Apa saja syarat mengajukan cuti?", "Bagaimana cara mengajukan izin sakit?", "Bagaimana aturan perjalanan dinas?"]) {
    cek(`"${t}" → Super Tools tidak-cocok, Portal cocok`, ck(SUPER, t).tingkat === "tidak-cocok" && ck(PORTAL, t).tingkat === "cocok");
  }
  cek("status cuti → Super Tools COCOK (bukan dialihkan ke pemegang SOP)", ck(SUPER, "Apakah cuti saya sudah disetujui?").tingkat === "cocok");
  cek("sisa cuti → Super Tools COCOK", ck(SUPER, "Berapa sisa cuti saya?").tingkat === "cocok");
  const stPortal = ck(PORTAL, "Apakah cuti saya sudah disetujui?");
  cek("status cuti → Portal tidak-cocok, saran Super Tools", stPortal.tingkat === "tidak-cocok" && stPortal.saran.join() === SUPER, JSON.stringify(stPortal.saran));
  cek("status tiket → Portal cocok; → Super Tools tidak-cocok saran Portal",
    ck(PORTAL, "Apakah tiket saya sudah selesai?").tingkat === "cocok" && ck(SUPER, "Apakah tiket saya sudah selesai?").saran.join() === PORTAL);
  cek("penjualan → Marketing cocok; Super Tools tidak-cocok saran Marketing", ck(MKT, "Berapa total penjualan September?").tingkat === "cocok"
    && ck(SUPER, "Berapa total penjualan September?").saran.join() === MKT);
  cek("penjualan → Report (deskripsi menyinggung, alat tidak) = TIDAK DIKETAHUI, bukan ditolak", ck(REPORT, "Berapa total penjualan September?").tingkat === "tidak-diketahui");
  cek("tiket → Portal cocok; Super Tools tidak-cocok saran Portal", ck(PORTAL, "Buatkan tiket komputer rusak.").tingkat === "cocok"
    && ck(SUPER, "Buatkan tiket komputer rusak.").saran.join() === PORTAL);
  cek("ajukan cuti (tindakan) → Super Tools cocok; Portal tidak-cocok", ck(SUPER, "tolong ajukan cuti tanggal 5 Desember").tingkat === "cocok"
    && ck(PORTAL, "tolong ajukan cuti tanggal 5 Desember").tingkat === "tidak-cocok");
  // false positive: TIDAK boleh ditolak
  for (const [target, t] of [[SUPER, "Cuti saya bagaimana?"], [PORTAL, "Bisa bantu masalah laptop?"], [SUPER, "Saya mau mengurus izin."],
    [PORTAL, "Saya ingin mengajukan permintaan perangkat."], [SUPER, "Produk apa saja yang stoknya kosong?"], [MKT, "Produk apa saja yang stoknya kosong?"],
    [PORTAL, "Bagaimana status tiket saya dan bagaimana prosedur meminta perangkat baru?"], [SUPER, "Berapa stok outlet Indomaret Cikini?"]] as const) {
    cek(`tidak ditolak (bukti tidak cukup): ${target.slice(8)} ← "${t}"`, ck(target, t).tingkat !== "tidak-cocok", ck(target, t).tingkat);
  }
  const camp = ck(MKT, "Berapa penjualan bulan lalu dan bagaimana SOP pengajuan cuti?");
  cek("tugas majemuk ke Marketing saja → tidak-cocok (bagian SOP), saran Portal", camp.tingkat === "tidak-cocok" && camp.saran.join() === PORTAL, camp.alasan);
  cek("Portal tidak memegang dokumen di registri terbatas → TIDAK ADA saran (tidak menebak)",
    cocokkan(buatRegistri([A.super(), A.marketing()]), SUPER, "Bagaimana prosedur pengajuan cuti?").tingkat === "tidak-diketahui");
  cek("target di luar registri → tidak-diketahui (penjaga yang memutuskan ketersediaan)", ck("Ratu AI HR", "Bagaimana prosedur cuti?").tingkat === "tidak-diketahui");

  // ================================================================== unit: status hasil alat & handoff
  console.log("— status hasil alat (bukti eksekusi, bukan kalimat)");
  cek("hasil biasa → berhasil", statusHasilAlat({ status: "siap", total: 3, baris: [1, 2, 3] }) === "berhasil");
  cek("total 0 → tidak-ditemukan", statusHasilAlat({ status: "siap", total: 0, baris: [] }) === "tidak-ditemukan");
  cek("status tidak-ketemu / data-belum-ada → tidak-ditemukan", statusHasilAlat({ status: "tidak-ketemu" }) === "tidak-ditemukan" && statusHasilAlat({ status: "data-belum-ada" }) === "tidak-ditemukan");
  cek("galat 'belum terhubung … minta admin' → akses-ditolak", statusHasilAlat({ galat: "Tidak bisa dijawab: akun kamu belum terhubung ke departemen, padahal data ini disaring per departemen." }) === "akses-ditolak");
  cek("galat lain → galat-alat", statusHasilAlat({ galat: "koneksi terputus" }) === "galat-alat");
  cek("penolakan penjaga (perlu-periode / catatan_sistem) BUKAN hasil alat", statusHasilAlat({ status: "perlu-periode" }) === undefined && statusHasilAlat({ catatan_sistem: "x" }) === undefined);
  cek("tidak ada alat → tanpa-alat; ada pertanyaan ke pengguna → perlu-pengguna",
    statusHandoff([], false) === "tanpa-alat" && statusHandoff([], true) === "perlu-pengguna");
  cek("berhasil menang atas tidak-ditemukan dalam satu handoff", statusHandoff([{ status: "tidak-ditemukan" }, { status: "berhasil" }], false) === "berhasil");

  // ================================================================== unit: penjaga
  console.log("— penjaga: validasi sebelum delegasi");
  const pj = (reg?: RegistriKemampuan) => buatPenjagaAlur(reg ? { registri: reg } : {});
  {
    const q = pj(REG);
    const r = q.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, [ui("user", "Bagaimana prosedur pengajuan cuti?")]);
    cek("Q4: Super Tools → DIALIHKAN ke Portal (satu-satunya pemegang dokumen), tanpa panggilan perute tambahan",
      r.boleh && r.targetBaru?.join() === PORTAL, JSON.stringify(r));
    const k = q.keadaan().rute;
    cek("…metadata rute: kebutuhan dokumen, target pertama Super Tools, dialihkan Super Tools→Portal",
      k?.kebutuhan[0] === "dokumen" && k?.target_pertama === SUPER && k?.dialihkan[0]?.ke === PORTAL, JSON.stringify(k));
  }
  {
    const q = pj(buatRegistri([A.admin(), A.portal(), A.super()]));
    const r = q.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, [ui("user", "Bagaimana prosedur pengajuan cuti?")]);
    cek("dua pemegang dokumen (Admin & Portal) → dialihkan ke yang paling khusus (alat dokumen terbanyak), urutan registri tidak berpengaruh",
      r.boleh && r.targetBaru?.join() === PORTAL, JSON.stringify(r));
    const q2 = pj(REG); const m = [ui("user", "Apakah tiket saya sudah selesai?")];
    const t1 = q2.periksaDelegasi({ task: "Apakah tiket saya sudah selesai?", targetAgents: [SUPER] }, m);
    const h = !t1.boleh ? t1.galat.hasil as Record<string, unknown> : {};
    cek("…penolakan terstruktur memuat kode, kemampuan yang dibutuhkan, saran_agent; alur TIDAK dihentikan",
      !t1.boleh && String(h.pesan).includes("saran_agent") && String(h.kemampuan_dibutuhkan).includes("data") && !q2.harusBerhenti(), JSON.stringify(h).slice(0, 160));
    q2.periksaDelegasi({ task: "Apakah tiket saya sudah selesai?", targetAgents: [MKT] }, m);
    const t3 = q2.periksaDelegasi({ task: "Apakah tiket saya sudah selesai?", targetAgents: [REPORT] }, m);
    cek("penolakan kemampuan ketiga → alur dihentikan (tidak berputar)", !t3.boleh && q2.harusBerhenti(), !t3.boleh ? t3.galat.kode : "boleh");
  }
  {
    const q = pj(REG); const masuk = [ui("user", "Apakah tiket saya sudah selesai?")];
    const r1 = q.periksaDelegasi({ task: "Apakah tiket saya sudah selesai?", targetAgents: [SUPER] }, masuk);
    cek("DATA tidak cocok (bukti kata) → ditolak dengan saran, TIDAK dialihkan otomatis", !r1.boleh && r1.galat.kode === "kemampuan-tidak-cocok"
      && JSON.stringify((r1.galat.hasil as { saran_agent?: string[] }).saran_agent) === JSON.stringify([PORTAL]) && !q.harusBerhenti());
    const r2 = q.periksaDelegasi({ task: "Apakah tiket saya sudah selesai?", targetAgents: [SUPER] }, masuk);
    cek("…perute TETAP memilih target yang sama → dihormati (sinonim bisa menipu bukti kata), tercatat 'dipertahankan'",
      r2.boleh && !r2.targetBaru && q.keadaan().rute?.dipertahankan.join() === SUPER);
    const d = pj(buatRegistri([A.portal(), A.super(), A.admin()])); const m = [ui("user", "Bagaimana prosedur pengajuan cuti?")];
    d.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, m);
    const d2 = d.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, m);
    cek("DOKUMEN tidak cocok (bukti struktural) → bersikeras pun tetap ditolak; Super Tools tidak pernah jalan", !d2.boleh && d.keadaan().rute?.dipertahankan.length === 0);
  }
  {
    const q = pj(REG);
    const r = q.periksaDelegasi({ task: "Bagaimana prosedur cuti?", targetAgents: ["Ratu AI HR"] }, [ui("user", "Bagaimana prosedur cuti?")]);
    const h = !r.boleh ? r.galat.hasil as { agent_tersedia?: string[] } : {};
    cek("agent yang TIDAK tersedia untuk pemakai → ditolak sebelum jalan, daftar hanya agent milik pemakai",
      !r.boleh && r.galat.kode === "agent-tidak-tersedia" && h.agent_tersedia?.length === REG.agent.length && !h.agent_tersedia.includes("Ratu AI HR"));
    const r2 = pj(REG).periksaDelegasi({ task: "Berapa total penjualan September?", targetAgents: [MKT, "Ratu AI HR"] }, []);
    cek("target campuran tersedia/tidak → yang tidak tersedia dibuang", r2.boleh && r2.targetBaru?.join() === MKT);
  }
  {
    const q = pj(REG);
    const r = q.periksaDelegasi({ task: "ya, lanjutkan", targetAgents: [SUPER] },
      [ui("user", "prosedur cuti"), ui("assistant", "Panduan belum ditemukan. Apakah Anda ingin saya menyiapkan tiket helpdesk?"), ui("user", "ya")]);
    cek("jawaban singkat atas tawaran → kemampuan TIDAK dinilai (tujuannya di giliran sebelumnya)", r.boleh && !r.targetBaru);
  }
  {
    const terbatas = buatRegistri([A.super(), A.marketing()]);
    const q = pj(terbatas);
    const r = q.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, [ui("user", "Bagaimana prosedur pengajuan cuti?")]);
    cek("HAK AKSES: pemakai tanpa agent pemegang dokumen → tidak dialihkan ke agent di luar aksesnya", r.boleh && !r.targetBaru);
    const r2 = q.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [PORTAL] }, []);
    cek("HAK AKSES: delegasi langsung ke agent di luar akses → agent-tidak-tersedia", !r2.boleh && r2.galat.kode === "agent-tidak-tersedia");
  }
  console.log("— penjaga: status hasil & fallback terkendali");
  {
    const q = pj(REG); const masuk = [ui("user", "Berapa total penjualan September?")];
    cek("Report (tidak-diketahui) → diloloskan", q.periksaDelegasi({ task: "Berapa total penjualan September?", targetAgents: [REPORT] }, masuk).boleh);
    q.catatHandoff(REPORT, "Maaf, saya belum bisa mengambil data penjualan.");
    const c = q.catatanDelegasi([{ agentName: REPORT, response: "Maaf, saya belum bisa mengambil data penjualan." }]) as Record<string, unknown>[] | undefined;
    cek("handoff tanpa alat → status_rute 'tanpa-alat' + saran_agent pemegang kemampuan (Marketing)",
      c?.[0].status_rute === "tanpa-alat" && JSON.stringify(c?.[0].saran_agent) === JSON.stringify([MKT]) && String(c?.[0].catatan_rute).includes("BUKAN bukti"), JSON.stringify(c?.[0]).slice(0, 200));
    cek("fallback pertama ke Marketing → boleh", q.periksaDelegasi({ task: "Berapa total penjualan September?", targetAgents: [MKT] }, masuk).boleh);
    q.catatHandoff(MKT, "Belum bisa.");
    const r3 = q.periksaDelegasi({ task: "Berapa total penjualan September 2026?", targetAgents: ["Ratu AI Dashboard"] }, masuk);
    cek("percobaan ketiga untuk kebutuhan yang sama → batas-fallback + berhenti", !r3.boleh && r3.galat.kode === "batas-fallback" && q.harusBerhenti(), !r3.boleh ? r3.galat.kode : "boleh");
  }
  {
    const q = pj(REG); const masuk = [ui("user", "Berapa sisa cuti saya?")];
    q.periksaDelegasi({ task: "Berapa sisa cuti saya?", targetAgents: [SUPER] }, masuk);
    q.catatHasilAlat(SUPER, "saldo_cuti", { galat: "Tidak bisa dijawab: akun kamu belum terhubung ke employee, padahal data ini disaring per employee. Minta admin melengkapinya." }, "s1");
    q.catatHandoff(SUPER, "Data cuti Anda tidak bisa diambil.");
    const c = q.catatanDelegasi([{ agentName: SUPER, response: "x" }]) as Record<string, unknown>[];
    cek("galat akses dari alat → status_rute akses-ditolak, TANPA saran agent lain", c[0].status_rute === "akses-ditolak" && !("saran_agent" in c[0]));
    const r = q.periksaDelegasi({ task: "berapa sisa cuti saya", targetAgents: [PORTAL] }, masuk);
    cek("…mencari data yang sama lewat agent lain → ditolak (akses-ditolak-sebelumnya) + berhenti", !r.boleh && r.galat.kode === "akses-ditolak-sebelumnya" && q.harusBerhenti());
  }
  {
    const q = pj(REG); const masuk = [ui("user", "Apakah tiket saya sudah selesai?")];
    q.periksaDelegasi({ task: "Apakah tiket saya sudah selesai?", targetAgents: [PORTAL] }, masuk);
    q.catatHasilAlat(PORTAL, "asisten_tiket", { status: "siap", total: 0, baris: [] }, "t1");
    q.catatHandoff(PORTAL, "Tidak ada tiket.");
    const c = q.catatanDelegasi([{ agentName: PORTAL, response: "Tidak ada tiket." }]) as Record<string, unknown>[];
    cek("data kosong → status_rute tidak-ditemukan, tanpa saran (bukan alasan mencari ke agent lain)", c[0].status_rute === "tidak-ditemukan" && !("saran_agent" in c[0]));
  }
  console.log("— penjaga: konfigurasi dinamis & dua pemakai");
  {
    const reg1 = buatRegistri([A.portal("Ratu AI Layanan Karyawan"), A.super()]);
    const r1 = pj(reg1).periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, []);
    cek("agent pemegang SOP diganti nama → pengalihan ikut nama baru", r1.boleh && r1.targetBaru?.join() === "Ratu AI Layanan Karyawan");
    const hr: AgentKemampuan = { nama: "Ratu AI HR", deskripsi: "Kepegawaian.", alat: [{ nama: "cari_sop", label: "Cari SOP", deskripsi: "Cari dokumen.", jenis: "dokumen" }] };
    const tanpaSop = { ...A.portal(), alat: A.portal().alat.filter((t) => t.jenis !== "dokumen") };
    const r2 = pj(buatRegistri([tanpaSop, A.super(), hr])).periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, []);
    cek("cari_sop dipindah ke agent BARU lewat setelan → pengalihan ke agent baru, tanpa ubah kode", r2.boleh && r2.targetBaru?.join() === "Ratu AI HR");
    const r3 = pj(buatRegistri([tanpaSop, A.super()])).periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, []);
    cek("alat dokumen dicabut dari semua agent → tidak ada pengalihan (tidak mengarang kemampuan)", r3.boleh && !r3.targetBaru);
    const r4 = pj(buatRegistri([{ ...A.marketing(), alat: [...A.marketing().alat, A.portal().alat[0]] }, A.super()]))
      .periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, []);
    cek("cari_sop ditambahkan ke agent lain → agent itu jadi tujuan", r4.boleh && r4.targetBaru?.join() === MKT);
    // dua pemakai bersamaan, registri berbeda
    const ppA = buatPemegangPenjaga(); ppA.pakaiRegistri(REG);
    const ppB = buatPemegangPenjaga(); ppB.pakaiRegistri(buatRegistri([A.super(), A.marketing()]));
    const ra = ppA.ambil().periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, []);
    const rb = ppB.ambil().periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, []);
    cek("dua pemakai bersamaan: A dialihkan ke Portal, B (tanpa Portal) tidak — registri tidak bocor",
      ra.boleh && ra.targetBaru?.join() === PORTAL && rb.boleh && !rb.targetBaru && ppB.registri()?.agent.every((a) => a.nama !== PORTAL) === true);
  }
  console.log("— penjaga: integrasi dengan Tahap 2 / 5 & tanpa registri");
  {
    const r = pj().periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, []);
    cek("tanpa registri (RUTE_KEMAMPUAN=mati) → perilaku Tahap 2–6 (diloloskan apa adanya)", r.boleh && !r.targetBaru);
    const pp = buatPemegangPenjaga(); pp.pakaiRegistri(REG); pp.pakaiKemampuan("Halo! daftar kemampuan");
    const s = pp.ambil().periksaDelegasi({ task: "Halo, kamu bisa bantu apa saja?", targetAgents: [PORTAL] }, [ui("user", "Halo, kamu bisa bantu apa saja?")]);
    cek("Tahap 5 tetap: sapaan → sapaan-langsung (bukan dinilai kemampuan)", !s.boleh && s.galat.kode === "sapaan-langsung");
    const k = pj(REG).periksaDelegasi({ task: "User menyetujui tawaran sebelumnya: siapkan tiket", targetAgents: [SUPER] }, [ui("user", "internet mati")]);
    cek("Tahap 2 tetap didahulukan: persetujuan karangan → persetujuan-karangan", !k.boleh && k.galat.kode === "persetujuan-karangan");
    const q = pj(REG); const masuk = [ui("user", "Berapa penjualan September dan bagaimana prosedur pengajuan cuti?")];
    const a1 = q.periksaDelegasi({ task: "Berapa total penjualan September?", targetAgents: [MKT] }, masuk);
    const a2 = q.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [PORTAL] }, masuk);
    cek("lintas agent dengan tujuan berbeda → keduanya boleh (bukan dianggap pengulangan)", a1.boleh && a2.boleh && !a1.targetBaru && !a2.targetBaru);
    const t = pj(REG); const m2 = [ui("user", "Bagaimana prosedur pengajuan cuti?")];
    t.periksaDelegasi({ task: "Bagaimana prosedur pengajuan cuti?", targetAgents: [SUPER] }, m2);   // dialihkan → Portal
    t.catatHandoff(PORTAL, "Panduan cuti belum ditemukan. Apakah Anda ingin saya menyiapkan tiket?");
    const r3 = t.periksaDelegasi({ task: "prosedur pengajuan cuti", targetAgents: [SUPER] }, m2);
    cek("Portal sudah bertanya ke pengguna → delegasi ulang ke Super Tools DITOLAK + berhenti (tidak berputar)", !r3.boleh && t.harusBerhenti(), !r3.boleh ? r3.galat.kode : "boleh");
  }
  console.log("— audit antar-tahap (T1 evaluator & benchmark, privasi metadata)");
  {
    const bukti = (teks: string, alat: string[], delegasi: number) => ({ status: "ok" as const, teks, alat, rancangan: 0, delegasi });
    const v = nilai({ jenis: "sop", alat: /cari_sop/ }, bukti("Menurut SOP Cuti Karyawan: ajukan lewat Supertools paling lambat H-3.", ["cari_sop"], 1));
    cek("T1: jawaban Q4 sesudah pengalihan dinilai evaluator v2 LULUS (evaluator tidak diubah)", v.hasil === "lulus", `${v.hasil}/${v.kategori}`);
    const q = pj(buatRegistri([A.portal(), A.super(), A.admin()])); const pesan = "Apakah tiket saya sudah selesai? rahasia-123";
    const r1 = q.periksaDelegasi({ task: pesan, targetAgents: [SUPER] }, [ui("user", pesan)]);
    const r2 = pj(REG).periksaDelegasi({ task: "x", targetAgents: ["Ratu AI HR"] }, []);
    cek("T1: semua penolakan Tahap 3 berstatus 'ditolak-penjaga' (benchmark mengurangkannya dari jumlah delegasi)",
      !r1.boleh && !r2.boleh && r1.galat.hasil.status === "ditolak-penjaga" && r2.galat.hasil.status === "ditolak-penjaga");
    cek("T1: metadata rute tidak memuat isi pertanyaan pengguna", !JSON.stringify(q.keadaan()).includes("rahasia-123"), JSON.stringify(q.keadaan().rute).slice(0, 120));
    cek("T1: catatan & pesan penolakan bukan 'pesan internal' menurut evaluator kalau terbawa ke jawaban",
      !pesanInternalAtauKarangan(String(!r1.boleh && r1.galat.hasil.pesan)) && !pesanInternalAtauKarangan("Ratu AI Report tidak menjalankan alat apa pun, jadi jawabannya BUKAN bukti informasinya tidak ada."));
  }
  {
    const src = readFileSync(new URL("../voltagent/agent-konfig.ts", import.meta.url), "utf8");
    const blok = src.slice(src.indexOf("const ATURAN_PILIH_AGENT"), src.indexOf("const TANPA_TOOL"));
    cek("aturan perute Tahap 3 tidak menyebut nama agent (Portal/Super Tools/Marketing/Admin)", blok.length > 200 && !/Portal|Super ?Tools|Marketing|Admin/.test(blok));
    cek("aturan perute Tahap 3 tidak memuat contoh panggilan alat / JSON yang bisa tersalin", !/delegate_task\s*\(|targetAgents|\{"task"/.test(blok));
  }
}

// ==================================================================== integrasi offline (model tiruan)
const srv = await mulaiServerTiruan();
const model = (f: Format) => f === "anthropic"
  ? createAnthropic({ baseURL: srv.url(f), apiKey: "tiruan" })("claude-tiruan")
  : createOpenAICompatible({ name: "tiruan", baseURL: srv.url(f), apiKey: "tiruan" })("tiruan");
type Penjawab = { kunci: string; jawab: (p: Permintaan) => Jawaban };
const daftar: Penjawab[] = [];
srv.setel((p) => (daftar.find((d) => p.teksPesan.includes(d.kunci))?.jawab ?? (() => ({ teks: "?" })))(p));
const ke = (p: Permintaan) => p.hasilAlat.length;
const dlg = (task: string, ...targetAgents: string[]) => ({ nama: "delegate_task", argumen: { task, targetAgents } });
const delegasi = (task: string, ...t: string[]): Jawaban => ({ alat: [dlg(task, ...t)] });
const alat = (nama: string, argumen: Record<string, unknown>): Jawaban => ({ alat: [{ nama, argumen }] });
const panggilan = (kunci: string, peran: "perute" | "bawahan", agen?: string) =>
  srv.catatan.filter((p) => p.teksPesan.includes(kunci) && p.peran === peran && (!agen || p.agen === agen));

function rakit(f: Format, susunan: AgentKemampuan[]) {
  const pp = buatPemegangPenjaga({ idSesi: "uji", hariIni: () => "2026-11" });
  const jalan: Record<string, number> = {};
  const alatTiruan = (k: { nama: string }) => createTool({
    name: k.nama, description: `${k.nama} (tiruan)`,
    // Argumen mengikuti alat aslinya: alat dokumen hanya `pertanyaan` (alat berargumen periode ikut aturan Tahap 4).
    parameters: k.nama === "cari_sop" || k.nama === "daftar_sop"
      ? z.object({ pertanyaan: z.string().optional() })
      : z.object({ pertanyaan: z.string().optional(), dari: z.string().optional(), sampai: z.string().optional() }),
    execute: async () => {
      jalan[k.nama] = (jalan[k.nama] ?? 0) + 1;
      if (k.nama === "cari_sop") return { status: "siap", hasil: [{ judul: "SOP Cuti Karyawan", isi: "Ajukan lewat Supertools paling lambat H-3, disetujui atasan langsung." }] };
      if (k.nama === "total_penjualan") return { status: "siap", periode: { dari: "2026-09", sampai: "2026-09" }, total_rupiah: 156770 };
      return { status: "siap", total: 1, baris: [{ x: 1 }] };
    },
  });
  const anak = susunan.map((a) => new Agent({ name: a.nama, purpose: a.nama, instructions: `[AGENT:${a.nama}] Jawab.`, model: model(f),
    tools: a.alat.map(alatTiruan) as never, maxSteps: 6, ...(KONTROL ? {} : { hooks: hookBawahan(pp) }) }));
  if (!KONTROL && !TANPA_RUTE) pp.pakaiRegistri(buatRegistri(susunan));
  pp.pakaiKemampuan(teksKemampuan("Ratu AI", susunan.map((a) => ({ nama: a.nama, bisa: a.alat.map((t) => t.label) }))));
  const perute = new Agent({ name: "Perute", purpose: "perute", instructions: "[PERUTE] Teruskan.", model: model(f), subAgents: anak,
    maxSteps: 12, supervisorConfig: { systemMessage: "[PERUTE] Teruskan.", customGuidelines: [] }, ...(KONTROL ? {} : kendaliPerute(pp, 12)) } as never);
  return { perute, pp, jalan };
}
async function jalankan(r: ReturnType<typeof rakit>, riwayat: { peran: "user" | "assistant"; teks: string }[]) {
  const h = await r.perute.streamText(riwayat.map((m, i) => ({ id: `m${i}`, role: m.peran, parts: [{ type: "text", text: m.teks }] })) as never);
  const potongan: { type: string; delta?: string }[] = [];
  const s = h.toUIMessageStream() as AsyncIterable<{ type: string; delta?: string }>;
  for await (const x of KONTROL ? s : jagaPotongan(s, r.pp.ambil(), "ui")) potongan.push(x);
  return { teks: potongan.filter((x) => x.type === "text-delta").map((x) => x.delta ?? "").join(""), k: r.pp.ambil().keadaan() };
}
/** Jawaban tiruan agent bawahan: panggil alat pertama yang relevan sekali, lalu rangkum hasilnya. */
const bawahanStandar = (p: Permintaan, alatPertama: Record<string, [string, Record<string, unknown>] | null>): Jawaban => {
  const pilih = alatPertama[p.agen ?? ""];
  if (ke(p) === 0 && pilih) return alat(pilih[0], pilih[1]);
  if (ke(p) === 0) return { teks: "Maaf, saya belum bisa mengambil data itu." };
  return { teks: `Hasil: ${p.hasilAlat.join(" ").slice(0, 200)}` };
};

const SUSUNAN = [A.portal(), A.super(), A.marketing(), A.report()];
const ALAT_PERTAMA: Record<string, [string, Record<string, unknown>] | null> = {
  [PORTAL]: ["cari_sop", { pertanyaan: "prosedur pengajuan cuti" }], [SUPER]: null, [MKT]: ["total_penjualan", { dari: "2026-09", sampai: "2026-09" }], [REPORT]: null,
};
const PERLU_RUTE = !KONTROL && !TANPA_RUTE;

for (const f of ["openai", "anthropic"] as const) {
  console.log(`\n=== integrasi, format ${f} ===`);
  // F1 — Q4 persis: perute memilih Super Tools untuk pertanyaan prosedur
  {
    const k = `uji3-q4-${f}`;
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`Bagaimana prosedur pengajuan cuti? (${k})`, SUPER) : { teks: `Menurut SOP: ${p.hasilAlat[0]?.includes("H-3") ? "ajukan paling lambat H-3." : "tidak dapat membantu."}` })
      : bawahanStandar(p, ALAT_PERTAMA) });
    const r = rakit(f, SUSUNAN);
    const o = await jalankan(r, [{ peran: "user", teks: `Bagaimana prosedur pengajuan cuti? (${k})` }]);
    const nSuper = panggilan(k, "bawahan", SUPER).length;
    cek(`[${f}] F1a salah rute ke Super Tools: Super Tools TIDAK dieksekusi (0 panggilan LLM)`, nSuper === 0, `Super Tools ${nSuper}×`);
    cek(`[${f}] F1b dialihkan ke pemegang dokumen: cari_sop jalan 1×`, r.jalan.cari_sop === 1, JSON.stringify(r.jalan));
    cek(`[${f}] F1c jawaban dari SOP; perute hanya 2 panggilan (tanpa putaran tambahan)`, o.teks.includes("H-3") && panggilan(k, "perute").length === 2, `${JSON.stringify(o.teks).slice(0, 60)} · perute ${panggilan(k, "perute").length}×`);
    if (PERLU_RUTE) cek(`[${f}] F1d metadata rute: target pertama Super Tools, agent dipakai Portal, status handoff berhasil`,
      o.k.rute?.target_pertama === SUPER && o.k.rute?.agent_dipakai.join() === PORTAL && o.k.rute?.handoff[0]?.status === "berhasil", JSON.stringify(o.k.rute));
  }
  // F2 — salah rute DATA: penolakan terstruktur, perute memilih dari saran
  {
    const k = `uji3-saran-${f}`;
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`Apakah tiket saya sudah selesai? (${k})`, SUPER)
        : ke(p) === 1 && p.hasilAlat[0].includes("saran_agent") ? delegasi(`Apakah tiket saya sudah selesai? (${k})`, PORTAL)
        : { teks: p.hasilAlat.some((h) => h.includes("status_rute") && h.includes("berhasil")) ? "Tiket Anda: 1 tiket, sudah ditangani." : "Tidak dapat membantu." })
      : (ke(p) === 0 && p.agen === PORTAL ? alat("asisten_tiket", {}) : bawahanStandar(p, ALAT_PERTAMA)) });
    const r = rakit(f, [...SUSUNAN, A.admin()]);
    const o = await jalankan(r, [{ peran: "user", teks: `Apakah tiket saya sudah selesai? (${k})` }]);
    const kedua = panggilan(k, "perute").find((p) => ke(p) === 1);
    cek(`[${f}] F2a perute menerima penolakan terstruktur (kode + saran_agent = Portal)`, !!kedua?.hasilAlat[0].includes("kemampuan-tidak-cocok") && kedua.hasilAlat[0].includes(PORTAL), kedua?.hasilAlat[0].slice(0, 120));
    cek(`[${f}] F2b Super Tools tidak pernah dieksekusi; Portal menjawab dengan alat tiket`, panggilan(k, "bawahan", SUPER).length === 0 && r.jalan.asisten_tiket === 1 && o.teks.includes("1 tiket"), JSON.stringify(o.teks).slice(0, 60));
    // dua pemegang dokumen: langsung dialihkan, tanpa panggilan perute tambahan, Admin tidak jalan
    const k2 = `uji3-duadok-${f}`;
    daftar.push({ kunci: k2, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`Apa saja syarat mengajukan cuti? (${k2})`, SUPER) : { teks: p.hasilAlat[0]?.includes("H-3") ? "Syarat: ajukan paling lambat H-3." : "Tidak dapat membantu." })
      : bawahanStandar(p, ALAT_PERTAMA) });
    const r2 = rakit(f, [A.admin(), ...SUSUNAN]);
    const o2 = await jalankan(r2, [{ peran: "user", teks: `Apa saja syarat mengajukan cuti? (${k2})` }]);
    cek(`[${f}] F2c dua pemegang dokumen → dialihkan ke Portal; Admin & Super Tools tidak jalan; perute 2×`,
      panggilan(k2, "bawahan", "Ratu AI Admin").length === 0 && panggilan(k2, "bawahan", SUPER).length === 0 && o2.teks.includes("H-3") && panggilan(k2, "perute").length === 2);
  }
  // F3 — target tidak-diketahui menjawab TANPA alat → status terstruktur → satu fallback ke pemegang kemampuan
  {
    const k = `uji3-fallback-${f}`;
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`Berapa total penjualan September 2026? (${k})`, REPORT)
        : ke(p) === 1 && p.hasilAlat[0].includes("saran_agent") ? delegasi(`Berapa total penjualan September 2026? (${k})`, MKT)
        : { teks: p.hasilAlat.some((h) => h.includes("156770")) ? "Total September 2026: Rp 156.770." : "Data tidak tersedia." })
      : bawahanStandar(p, ALAT_PERTAMA) });
    const r = rakit(f, SUSUNAN);
    const o = await jalankan(r, [{ peran: "user", teks: `Berapa total penjualan September 2026? (${k})` }]);
    const kedua = panggilan(k, "perute").find((p) => ke(p) === 1);
    cek(`[${f}] F3a hasil delegate_task membawa status_rute 'tanpa-alat' + saran Marketing (onToolEnd perute)`,
      !!kedua?.hasilAlat[0].includes("tanpa-alat") && kedua.hasilAlat[0].includes(MKT), kedua?.hasilAlat[0].slice(0, 160));
    cek(`[${f}] F3b satu fallback → angka benar; total_penjualan 1×; Report 1 handoff saja`,
      o.teks.includes("156.770") && r.jalan.total_penjualan === 1 && o.k.handoff === 2, `${JSON.stringify(o.teks).slice(0, 50)} · handoff ${o.k.handoff}`);
  }
  // F4 — lintas agent: dua kebutuhan dalam satu pesan, perute mengirim SELURUH kalimat ke Marketing saja
  {
    const k = `uji3-lintas-${f}`;
    const kalimat = `Berapa total penjualan September 2026 dan bagaimana prosedur pengajuan cuti? (${k})`;
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(kalimat, MKT)
        : ke(p) === 1 && p.hasilAlat[0].includes("Pisahkan") ? { alat: [dlg(`Berapa total penjualan September 2026? (${k})`, MKT), dlg(`Bagaimana prosedur pengajuan cuti? (${k})`, PORTAL)] }
        : ke(p) === 1 ? { teks: `Hasil: ${p.hasilAlat[0].slice(0, 80)}` }
        : { teks: `${p.hasilAlat.some((h) => h.includes("156770")) ? "Penjualan September: Rp 156.770. " : ""}${p.hasilAlat.some((h) => h.includes("H-3")) ? "Cuti: ajukan paling lambat H-3." : ""}` })
      : bawahanStandar(p, ALAT_PERTAMA) });
    const r = rakit(f, SUSUNAN);
    const o = await jalankan(r, [{ peran: "user", teks: kalimat }]);
    cek(`[${f}] F4 tugas majemuk ke satu agent → diminta dipisah → dua agent relevan, jawaban memuat keduanya`,
      o.teks.includes("156.770") && o.teks.includes("H-3") && r.jalan.total_penjualan === 1 && r.jalan.cari_sop === 1,
      `${JSON.stringify(o.teks).slice(0, 90)} · ${JSON.stringify(r.jalan)} · ditolak ${JSON.stringify(o.k.ditolak)} · perute ${panggilan(k, "perute").map(ke).join(",")}`);
  }
  // F5 — hak akses: pemakai tanpa Portal; perute tetap mencoba Portal
  {
    const k = `uji3-akses-${f}`;
    daftar.push({ kunci: k, jawab: (p) => p.peran === "perute"
      ? (ke(p) === 0 ? delegasi(`Bagaimana prosedur pengajuan cuti? (${k})`, PORTAL) : { teks: "Panduan prosedur belum tersedia untuk akun Anda." })
      : bawahanStandar(p, ALAT_PERTAMA) });
    const r = rakit(f, [A.super(), A.marketing()]);
    const o = await jalankan(r, [{ peran: "user", teks: `Bagaimana prosedur pengajuan cuti? (${k})` }]);
    cek(`[${f}] F5 agent di luar akses tidak dijalankan & tidak ada agent bawahan yang jalan (tanpa bypass)`,
      panggilan(k, "bawahan").length === 0 && Object.keys(r.jalan).length === 0 && o.teks.length > 0, JSON.stringify(r.jalan));
  }
  // F6 — sapaan tetap langsung (Tahap 5) dengan registri menyala
  {
    const k = `uji3-sapa-${f}`;
    daftar.unshift({ kunci: k, jawab: (p) => p.peran === "perute" ? (ke(p) === 0 ? delegasi(`Halo, kamu bisa bantu apa saja? (${k})`, PORTAL) : { teks: "x" }) : { teks: "daftar SOP" } });
    const r = rakit(f, SUSUNAN);
    const o = await jalankan(r, [{ peran: "assistant", teks: `(${k})` }, { peran: "user", teks: "Halo, kamu bisa bantu apa saja?" }]);
    cek(`[${f}] F6 sapaan: tanpa agent bawahan, dijawab dari daftar kemampuan`, panggilan(k, "bawahan").length === 0 && o.teks.includes("Saya bisa membantu"));
  }
}

await srv.tutup();
console.log(`\n${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
