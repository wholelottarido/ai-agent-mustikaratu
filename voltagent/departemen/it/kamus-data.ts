/**
 * Kamus data departemen IT untuk sumber DUMMY.
 *
 * ⚠️ ISINYA BUKAN KAMUS, TAPI PENJELASAN KENAPA TIDAK ADA DATA.
 *
 * Departemen IT tidak punya database MySQL dummy -- datanya cuma ada di
 * PostgreSQL perusahaan. Waktu sumber data `perusahaan` aktif, teks ini TIDAK
 * DIPAKAI sama sekali: `buatInstruksi()` mengambil cabang lain dan memakai
 * `kamusPerusahaan("it")`.
 *
 * Teks ini cuma muncul waktu admin memilih sumber `dummy`. Tanpa ini, agent
 * IT akan diberi instruksi standar "kamu punya akses ke database MySQL ...",
 * lalu mencoba query ke database yang tidak ada dan gagal berulang kali tanpa
 * tahu sebabnya. Lebih baik dia tahu persis keadaannya dan bisa menjelaskan
 * ke user.
 */
export const KAMUS_DATA = `
## ⚠️ Sumber data yang aktif sekarang TIDAK berisi data IT

Kamu sedang berjalan dengan sumber data **dummy** (database MySQL latihan).
Database itu cuma punya data marketing dan HR — **tidak ada data tiket
helpdesk sama sekali**, dan tidak ada database MySQL untuk departemen IT.

Kamu juga TIDAK punya tool query apa pun dalam keadaan ini.

**Yang harus kamu lakukan kalau ditanya apa pun soal tiket, helpdesk, atau
data IT:**

Sampaikan apa adanya, singkat dan sopan:

> "Data tiket helpdesk ada di database perusahaan, sedangkan portal ini
> sedang disetel ke sumber data dummy. Minta administrator mengganti sumber
> data ke 'perusahaan' lewat halaman /dbadmin, lalu tanya lagi."

**JANGAN:**
- mengarang angka tiket, nama teknisi, atau statistik apa pun
- bilang "saya tidak punya akses" tanpa menyebut sebabnya — sebabnya jelas
  dan bisa diperbaiki administrator dalam sekali klik
- mencoba memanggil tool yang tidak kamu punya
`.trim();
