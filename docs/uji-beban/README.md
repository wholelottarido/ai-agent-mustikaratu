# Uji Beban Model Server

Seberapa banyak pengguna yang bisa bertanya **bersamaan** ke model di server
kantor (Gemma 12B lewat Bifrost), dan berapa lama jawabannya keluar.

| Berkas | Isi |
|---|---|
| `grafik.html` | Grafik + tabel. Buka langsung di browser |
| `hasil.json` | Data mentah pengukuran terakhir |

Mengukur ulang:

```bash
npm run uji:beban              # 10, 20, 30 pengguna
npm run uji:beban -- 1,2,3,5,8 # tingkat sendiri
```

⚠️ Mengirim beban **nyata** ke server kantor. `10+20+30` = 60 permintaan.

---

## Hasilnya: batasnya 1 pengguna serentak

| Pengguna serentak | Berhasil | Waktu jawab | Total |
|---:|---:|---:|---:|
| 1 | 1/1 | 12,4 dtk | 12,4 dtk |
| 2 | 0/2 | — | 3,1 dtk |
| 3 | 0/3 | — | 5,5 dtk |
| 5 | 0/5 | — | 11,1 dtk |
| 8 | 0/8 | — | 16,8 dtk |
| 10 | 1/10 | 23,4 dtk | 23,4 dtk |
| 20 | 0/20 | — | 36,4 dtk |
| 30 | 0/30 | — | 55,8 dtk |

Seluruh kegagalan memberi pesan yang sama:

```
Context size has been exceeded.
```

## Kenapa, dan apa yang bisa dilakukan

Server llama.cpp membagi jatah konteks ke beberapa slot paralel. Satu
percakapan di portal ini memakan sekitar **9–10 ribu token** (instruksi penuh
+ kamus data + definisi tool + hasil query), jadi dua permintaan serentak
sudah melewati jatah yang tersedia.

**Ini setelan server, bukan batas modelnya.** Kualitas jawabannya sendiri
bagus — 6/6 benar waktu diuji satu per satu.

Dua arah perbaikan:

1. **Di server** — naikkan `--ctx-size` dan `--parallel` pada llama.cpp. Ini
   yang paling berpengaruh, tapi perlu memori GPU/RAM lebih di server itu.
2. **Di aplikasi** — perpendek instruksi yang dikirim tiap pertanyaan. Kamus
   data marketing saja sudah ~3.600 token dan dikirim setiap kali.

## Cara membaca angkanya

- **Waktu jawab** = yang dirasakan satu pengguna, dari bertanya sampai jawaban
  selesai. Kosong berarti tidak ada permintaan yang berhasil di tingkat itu.
- **Total** = dari permintaan pertama dilepas sampai yang terakhir selesai,
  termasuk yang berakhir gagal. Angka ini tetap naik walau jawabannya tidak
  keluar — server tetap bekerja sebelum menyerah.
- Permintaan **pemanasan** dijalankan lebih dulu dan tidak ikut dihitung,
  supaya waktu muat model tidak mengotori tingkat pertama.

## Catatan pengukuran

Diukur lewat **agent asli** — instruksi penuh, panggilan tool, query database,
sampai jawaban jadi. Bukan langsung ke model. Mengukur langsung ke model
memberi angka yang lebih bagus, tapi itu bukan yang dirasakan pengguna.

Batas koneksi database sempat dicurigai jadi penyebab, tapi bukan: query ke
MySQL memakan hitungan milidetik, sementara satu jawaban butuh belasan detik.
