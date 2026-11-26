/**
 * Pola untuk memeriksa jawaban menyebut bulan terakhir data. Diambil dari data, bukan
 * ditulis di uji, karena bulan terakhirnya maju sendiri tiap kali data bertambah.
 */
const NAMA = ["jan(uari)?", "feb(ruari)?", "mar(et)?", "apr(il)?", "mei", "jun(i)?", "jul(i)?",
  "agu(stus)?", "sep(tember)?", "okt(ober)?", "nov(ember)?", "des(ember)?"];

export function polaBulan(bulan: string): RegExp {
  return new RegExp(`${bulan}|(^|[^a-z])${NAMA[Number(bulan.slice(5)) - 1]}([^a-z]|$)`, "i");
}
