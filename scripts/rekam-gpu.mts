/**
 * Merekam beban GPU server model (EC2) lewat SSH, tanpa memasang atau mengubah apa pun di server.
 *
 *   npx tsx scripts/rekam-gpu.mts [--detik 60] [--host mr-ec2]     (berdiri sendiri, cetak ringkasan)
 *   import { mulaiRekamGpu } from "./rekam-gpu.mts"                (dipakai uji-beban.mts --gpu)
 *
 * Menjalankan `nvidia-smi --query-gpu=... -lms 500` di server lewat alias SSH (`~/.ssh/config`).
 * Waktu sampel memakai jam server (UTC) yang dicetak nvidia-smi, bukan jam terima di laptop.
 * Hanya membaca. Kunci SSH tidak pernah dibaca oleh skrip ini; ssh yang memakainya.
 */
import { spawn } from "node:child_process";

export type SampelGpu = { t: number; gpu: number; dayaW: number; memoriMiB: number; suhuC: number; indeks?: number };

/**
 * Mulai merekam. `berhenti()` mematikan proses ssh dan mengembalikan semua sampel.
 *
 * `opsi.sshArgs` menggantikan `host` kalau server butuh argumen ssh lain (mis. `-i kunci user@ip`).
 * `opsi.indeks` menambahkan nomor GPU ke setiap sampel, untuk server dengan beberapa GPU
 * (nvidia-smi menulis satu baris per GPU per selang). Tanpa opsi, perilakunya sama seperti dulu.
 */
export function mulaiRekamGpu(host = "mr-ec2", selangMs = 500, opsi: { sshArgs?: string[]; indeks?: boolean } = {}) {
  const sampel: SampelGpu[] = [];
  const kolom = `${opsi.indeks ? "index," : ""}timestamp,utilization.gpu,power.draw,memory.used,temperature.gpu`;
  const p = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ServerAliveInterval=15", ...(opsi.sshArgs ?? [host]),
    `nvidia-smi --query-gpu=${kolom} --format=csv,noheader,nounits -lms ${selangMs}`]);
  let sisa = "", galat = "";
  p.stdout.on("data", (d: Buffer) => {
    sisa += d.toString();
    const baris = sisa.split("\n"); sisa = baris.pop() ?? "";
    for (const b of baris) {
      const kolomB = b.split(",").map((x) => x.trim());
      const idx = opsi.indeks ? Number(kolomB.shift()) : undefined;
      const [ts, gpu, daya, mem, suhu] = kolomB;
      const t = Date.parse((ts ?? "").replace(/\//g, "-").replace(" ", "T") + "Z");
      if (Number.isFinite(t)) sampel.push({ t, gpu: Number(gpu), dayaW: Number(daya), memoriMiB: Number(mem), suhuC: Number(suhu), ...(idx != null ? { indeks: idx } : {}) });
    }
  });
  p.stderr.on("data", (d: Buffer) => { galat += d.toString(); });
  // Kalau skrip uji dihentikan di tengah, proses ssh jangan tertinggal merekam terus.
  const matikan = () => { if (!p.killed) p.kill(); };
  process.once("exit", matikan);
  for (const sinyal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sinyal, () => { matikan(); process.exit(130); });
  return {
    sampel,
    galat: () => galat.trim(),
    berhenti: async () => {
      p.kill();
      await new Promise((r) => setTimeout(r, 300));
      return sampel;
    },
  };
}

/** Ringkasan beban GPU dalam rentang waktu [dari, sampai] (milidetik epoch). */
export function ringkasGpu(sampel: SampelGpu[], dari: number, sampai: number) {
  const s = sampel.filter((x) => x.t >= dari && x.t <= sampai);
  if (!s.length) return null;
  const rata = (f: (x: SampelGpu) => number) => Math.round((s.reduce((a, x) => a + f(x), 0) / s.length) * 10) / 10;
  // Energi = jumlah daya x selang antar sampel (Wh). Selang dibatasi 2 dtk supaya celah rekaman tidak menggelembungkan angka.
  let wh = 0;
  for (let i = 1; i < s.length; i++) wh += s[i].dayaW * Math.min(2000, s[i].t - s[i - 1].t) / 3_600_000;
  return {
    sampel: s.length,
    gpuRata: rata((x) => x.gpu), gpuMaks: Math.max(...s.map((x) => x.gpu)),
    dayaRata: rata((x) => x.dayaW), dayaMaks: Math.max(...s.map((x) => x.dayaW)),
    energiWh: Math.round(wh * 100) / 100,
    detikGpuSibuk: Math.round(s.filter((x) => x.gpu > 0).length * ((sampai - dari) / 1000) / s.length),
    suhuMaks: Math.max(...s.map((x) => x.suhuC)),
    memoriMiB: Math.max(...s.map((x) => x.memoriMiB)),
  };
}

// Dijalankan langsung: rekam sekian detik lalu cetak ringkasan.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/rekam-gpu.mts")) {
  const arg = (n: string, b: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : b; };
  const detik = Number(arg("detik", "10"));
  const r = mulaiRekamGpu(arg("host", "mr-ec2"));
  const dari = Date.now();
  await new Promise((x) => setTimeout(x, detik * 1000));
  const s = await r.berhenti();
  if (!s.length) { console.error(`tidak ada sampel. ssh: ${r.galat() || "(tanpa pesan)"}`); process.exit(1); }
  console.log(`${s.length} sampel dalam ${detik} dtk`, ringkasGpu(s, dari - 2000, Date.now()));
}
