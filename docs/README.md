# Isi folder docs

Dirapikan per topik 24 Nov 2026. Daftar pemindahan lengkap ada di `.peta-pindah.json`.

| Folder | Isi |
|---|---|
| `logbook/` | Logbook harian untuk pembimbing magang, isian form logbook, laporan periode 23–25 Sep |
| `benchmark/` | Rencana, hasil, dan catatan uji beban & benchmark model (Qwen3 14B, 1 vs 4 GPU, latensi workflow agent), prosedur max-num-seqs |
| `benchmark/grafik/` | Dashboard HTML hasil pengujian & grafik (dibuat ulang oleh skrip `scripts/*.py`) |
| `benchmark/uji-beban-sep-2026/` | Uji beban pertama (28 Sep 2026) |
| `workflow-agent/` | RCA kegagalan workflow agent Qwen 14B + implementasi perbaikan Tahap 1–6 |
| `fitur/` | Rencana & spesifikasi fitur: forecasting penjualan, web search tren pasar, unggah dokumen, bot WhatsApp, routing RAG vs database, integrasi Qwen |
| `gateway/` | MR AI Gateway (LiteLLM): catatan MVP, spesifikasi dashboard, pertanyaan koneksi |
| `database/` | Pemetaan database perusahaan + skema & kamus data per departemen (`marketing/`, `hr/`) |
| `panduan/` | Panduan pemakaian untuk tim IT (menambah tool dari Kelola AI) |
| `arsip-percakapan/` | Ekspor percakapan dengan asisten koding lain |
| `riwayat/` | Isi lama `CLAUDE.md` (catatan pengembangan Sep – Nov 2026, ±6.400 baris), dipindah utuh 26 Nov 2026. Indeksnya di bagian bawah `CLAUDE.md` |

⚠️ `mustika-ratu-qwen35-key.pem` sengaja tidak dipindah — itu kunci SSH, bukan dokumen.
Sebaiknya dipindah ke luar folder proyek (mis. `~/.ssh/`).
