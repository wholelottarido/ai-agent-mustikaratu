/**
 * Keterangan Ramadan dan Lebaran per bulan (§22 spesifikasi tim sebelah).
 *
 * Hanya fakta kalender, bukan fitur model: angka ramalan tidak berubah karenanya.
 * Spesifikasi melarang menyatakannya sebagai penyebab naik-turunnya penjualan.
 *
 * Dihitung dari kalender Umm al-Qura bawaan Node, jadi tidak ada daftar tanggal yang
 * perlu dirawat. ⚠️ Tanggal resmi Indonesia ditetapkan sidang isbat dan bisa beda
 * sehari, karena itu selalu ditulis "sekitar".
 */
const HIJRIAH = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  timeZone: "UTC", month: "numeric", day: "numeric",
});
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Tanggal dalam bulan yang jatuh pada Ramadan, dan tanggal Lebaran kalau ada. */
function isiBulan(tahun: number, bulan: number) {
  const hari = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const ramadan: number[] = [];
  let lebaran: number | null = null;
  for (let t = 1; t <= hari; t++) {
    const bagian = HIJRIAH.formatToParts(new Date(Date.UTC(tahun, bulan - 1, t)));
    const m = Number(bagian.find((b) => b.type === "month")?.value);
    const d = Number(bagian.find((b) => b.type === "day")?.value);
    if (m === 9) ramadan.push(t);
    if (m === 10 && d === 1) lebaran = t;
  }
  return { ramadan, lebaran };
}

const singgahLebaran = new Map<number, number>();

/** Bulan (1-12) tempat Lebaran jatuh pada tahun itu. Kalau dua kali, yang pertama. */
export function bulanLebaran(tahun: number): number {
  const ada = singgahLebaran.get(tahun);
  if (ada) return ada;
  for (let b = 1; b <= 12; b++) {
    if (isiBulan(tahun, b).lebaran !== null) {
      singgahLebaran.set(tahun, b);
      return b;
    }
  }
  throw new Error(`Lebaran ${tahun} tidak ketemu`);
}

/** Keterangan untuk `YYYY-MM`, atau `null` kalau bulan itu tidak berkaitan. */
export function keteranganKalender(bulanTeks: string): string | null {
  const [tahun, bulan] = bulanTeks.split("-").map(Number);
  if (!tahun || !bulan) return null;
  const { ramadan, lebaran } = isiBulan(tahun, bulan);
  const tgl = (t: number) => `sekitar ${t} ${NAMA_BULAN[bulan - 1]}`;

  if (lebaran !== null) return `Lebaran ${tgl(lebaran)}`;
  if (ramadan.length > 0) {
    return ramadan[0] === 1 ? "bulan Ramadan" : `Ramadan mulai ${tgl(ramadan[0])}`;
  }
  const [tahunDepan, bulanDepan] = bulan === 12 ? [tahun + 1, 1] : [tahun, bulan + 1];
  return isiBulan(tahunDepan, bulanDepan).ramadan.length > 0 ? "menjelang Ramadan" : null;
}
