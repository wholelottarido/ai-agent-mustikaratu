"""Dashboard benchmark konkurensi PASCA-optimasi (Tahap 1–6) vs baseline. Hanya membaca data yang sudah ada.

    python scripts/buat-dashboard-pasca-optimasi.py [<folder T7>]

Bawaan folder: data/agent-workflow-latency/2026-11-24-07-50-14b-post-optimization-seqs4/T7-konkurensi
Syarat: folder sudah diolah (olah-alur-agent.py --tanpa-dashboard, analisis-uji-live.py, banding-pasca-optimasi.py).
Keluaran: docs/benchmark/grafik/hasil-pengujian-final-qwen14b.html (satu berkas mandiri, tanpa CDN).
Gaya (CSS) diambil dari scripts/dashboard-template.html supaya sama dengan dashboard sebelumnya.
Isi jawaban model TIDAK ikut ke dashboard.
"""
import csv, json, os, statistics as st, sys
from collections import Counter, defaultdict
from datetime import datetime

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DT = "data/agent-workflow-latency"
T7 = (sys.argv[1] if len(sys.argv) > 1 else f"{DT}/2026-11-24-07-50-14b-post-optimization-seqs4/T7-konkurensi").rstrip("/\\")
BASE = {"20": f"{DT}/2026-11-20-07-30-4gpu", "23": f"{DT}/2026-11-23-08-35-14b-seqs4-c10-20"}
os.chdir(AKAR)
baca = lambda p: json.load(open(p, encoding="utf-8"))
jsonl = lambda p: [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]

B = baca(f"{T7}/banding.json"); A = baca(f"{T7}/analisis.json"); KJ = jsonl(f"{T7}/kejadian.jsonl")
INFO = next(x for x in KJ if x["t"] == "info")
JENIS = {"Q1": "Data penjualan", "Q2": "Peringatan dini", "Q3": "Stok kosong", "Q4": "SOP", "Q5": "Rancangan tiket",
         "Q6": "Data karyawan", "Q7": "Harus ditolak", "Q8": "Sapaan"}

# ---------------- per tahap
tahap = [{"pengguna": int(t), "baru": B["baru"][t], "lama": B["baseline"].get(t)} for t in sorted(B["baru"], key=int)]

# ---------------- per kode: baru (kejadian v2) & lama (evaluasi-v2 csv)
v2_lama = {r["trace"]: r for r in csv.DictReader(open(f"{DT}/evaluasi-v2/per-skenario.csv", encoding="utf-8"))}
def per_kode(kj, lama):
    c, lat = defaultdict(Counter), defaultdict(list)
    for q in kj:
        if q.get("t") != "q" or q.get("fase") != "beban": continue
        h = (v2_lama.get(q["trace"]) or {}).get("v2_hasil") if lama else q["nilai_v2"]["hasil"]
        c[q["kode"]][h] += 1; lat[q["kode"]].append(q["total_ms"] / 1000)
    return c, lat
c_baru, l_baru = per_kode(KJ, False)
c20, l20 = per_kode(jsonl(f"{BASE['20']}/kejadian.jsonl"), True)
c23, l23 = per_kode(jsonl(f"{BASE['23']}/kejadian.jsonl"), True)
isi = lambda c: {"lulus": c.get("lulus", 0), "sebagian": c.get("sebagian", 0), "gagal": c.get("gagal", 0)}
kode = {}
for k in sorted(JENIS):
    lama = c20[k] + c23[k]
    kode[k] = {"jenis": JENIS[k], "baru": isi(c_baru[k]), "lama": isi(lama),
               "median_baru": round(st.median(l_baru[k]), 1) if l_baru[k] else None,
               "median_20": round(st.median(l20[k]), 1) if l20[k] else None, "median_23": round(st.median(l23[k]), 1) if l23[k] else None}

# ---------------- per kode per tahap (sesudah)
rows = [r for r in A["baris"] if r["fase"] == "beban"]
kt = []
for (k, t), rs in sorted(defaultdict(list, {}).items()): pass
grup = defaultdict(list)
for r in rows: grup[(r["kode"], r["tahap"])].append(r)
for (k, t), rs in sorted(grup.items(), key=lambda x: (x[0][1], x[0][0])):
    cc = Counter(r["v2"] for r in rs)
    kt.append({"tahap": t, "kode": k, "jenis": JENIS[k], "n": len(rs), **isi(cc), "p50": round(st.median(r["total_dtk"] for r in rs), 1),
               "maks": round(max(r["total_dtk"] for r in rs), 1), "llm": round(st.mean(r["llm_total"] for r in rs), 2)})

# ---------------- rute & orkestrasi
pk = A["per_kode"]
q4 = dict(pk["Q4"]["khusus"]); q4["n"] = pk["Q4"]["n"]; q4["first_n"] = sum(v for a, v in q4["pilihan_pertama"].items() if a in q4["pemegang_dokumen"])
q4["base_first"] = "18/22 (82%) ke pemegang SOP; 4× ke Super Tools"
q1 = dict(pk["Q1"]["khusus"]); q1["n"] = pk["Q1"]["n"]
q5 = dict(pk["Q5"]["khusus"]); q8 = dict(pk["Q8"]["khusus"]); q8["n"] = pk["Q8"]["n"]
ef = Counter(r["v2_efisiensi"] for r in v2_lama.values() if r["kode"] == "Q8" and r["fase"] == "beban" and r["uji"].startswith(("2026-11-20-07", "2026-11-23-08")))
q8["base_efisien"] = f"{ef.get('efisien', 0)}/{sum(ef.values())}"
semua = A["semua"]
ditolak = Counter(); [ditolak.update(r["ditolak_kode"]) for r in rows]
orkes = {"n": semua["n"], "llm": semua["llm_per_wf_mean"], "perute": semua["llm_perute_mean"], "bawahan": semua["llm_bawahan_mean"],
         "delegasi": semua["delegasi_mean"], "ditolak": dict(ditolak), "ditolak_total": sum(ditolak.values())}

# ---------------- total
def total(src):
    rs = list(src.values()); n = sum(r["n"] for r in rs); l = sum(r["v2"].get("lulus", 0) for r in rs)
    d = sum(r["durasi_dtk"] for r in rs); c = sum(r["biaya_usd"] for r in rs)
    llm = sum(r["llm_per_wf"] * r["n"] for r in rs) / n
    return {"n": n, "lulus": l, "lulus_pct": round(100 * l / n, 1), "gagal": sum(r["v2"].get("gagal", 0) for r in rs), "sebagian": sum(r["v2"].get("sebagian", 0) for r in rs),
            "habis": sum(r["habis"] for r in rs), "durasi": round(d), "biaya": round(c, 2), "usd_sukses": round(c / l, 4), "llm": round(llm, 2),
            "p99_20": src.get("20", {}).get("p99"), "p99_tinggi": max(src[t]["p99"] for t in ("12", "16", "20") if t in src)}
tot = {"baru": total(B["baru"]), "lama": total(B["baseline"])}

# ---------------- kegagalan
gagal = [{"tahap": r["tahap"], "kode": r["kode"], "v2": r["v2"], "kategori": r["v2_kategori"], "dtk": round(r["total_dtk"], 1), "alat": r["alat"],
          "pertama": r["pilihan_pertama"], "efektif": r["agent_efektif"], "ditolak": r["ditolak_kode"], "berhenti": r["berhenti"], "trace": r["trace"]}
         for r in rows if r["v2"] != "lulus"]
gagal.sort(key=lambda g: (g["v2"] != "gagal", g["tahap"], g["kode"]))
rca = [
    {"kelas": "", "judul": "F1 — Q4, 16 pengguna (gagal, output menyesatkan) · capability routing + model",
     "isi": ["Perute mendelegasikan prosedur cuti ke Ratu AI Approval, agent yang tercantum di daftar tetapi tidak punya alat terpasang untuk akun uji.",
             "Penjaga Tahap 3 menolak (agent-tidak-tersedia) tanpa menyarankan pemegang SOP; perute lalu menjawab sendiri bahwa kemampuan SOP 'belum tersedia', padahal Portal dan Admin memegang cari_sop.",
             "Usulan (perlu persetujuan): saat target tidak tersedia dan kebutuhan 'dokumen' jelas, alihkan ke pemegang dokumen seperti pada kasus tidak-cocok."]},
    {"kelas": "ev", "judul": "F2 — Q5, 20 pengguna (gagal 'lain') · salah nilai evaluator",
     "isi": ["Alat menolak kategori karangan ('Jaringan'); agent lalu bertanya apakah memakai kategori NETWORK sambil menampilkan daftar kategori sah dari database.",
             "Perilakunya benar (klarifikasi), tetapi pola evaluator v2 tidak mengenali kalimat 'Pilihan kategori…'. Evaluator tidak diubah; kalau dihitung manual Q5 = 19 lulus / 11 sebagian / 0 gagal."]},
    {"kelas": "ev", "judul": "F3 — Q5 'sebagian' 11/30 · model + instruksi agent",
     "isi": ["Portal mencari SOP, tidak menemukan panduan, lalu menawarkan tiket alih-alih langsung menyusun rancangan — padahal pengguna sudah meminta 'Buatkan tiket'.",
             "Penjaga menghentikan alur dengan benar untuk menunggu jawaban (HITL); tidak ada persetujuan karangan, klaim tersimpan, atau tiket tersimpan. Satu giliran terbuang."]},
]

meta = {
    "tanggal": "Uji 24 November 2026, 07:54–08:45 UTC", "tarif": 7.94, "dibuat": datetime.now().strftime("%d %b %Y %H:%M"),
    "konfig": [f"Qwen3-14B-AWQ (served qwen3-14b), 4 replika vLLM independen, image {INFO['server']['replika'][0]['gambar']} — sama dengan uji 23 Nov",
               "max-num-seqs 4 · max-model-len 16384 · gpu-memory-utilization 0.85 di keempat replika",
               "LiteLLM simple-shuffle, num_retries 0 · Cloudflare Quick Tunnel · model portal mr-ai-gateway-4gpu",
               f"PENJAGA_ALUR {'menyala' if INFO.get('penjaga_alur') else 'mati'} · RUTE_KEMAMPUAN {'menyala' if INFO.get('rute_kemampuan') else 'mati'} · Anthropic diblokir di proses uji: {INFO.get('anthropic_diblokir')}",
               "Workload sama dengan baseline: pemanasan 8, beban 1/2/3/5/8/10/12/16/20 pengguna × 3 pertanyaan, jeda 5 dtk, jeda tahap 120 dtk, batas 300 dtk",
               "Evaluator v1 (kriteria lama) + v2 (scripts/lib/evaluator-agent.mts), tidak diubah"],
    "sumber": [T7, f"{BASE['20']} (baseline 1–8 pengguna)", f"{BASE['23']} (baseline 10–20 pengguna)", f"{DT}/evaluasi-v2/per-skenario.csv (v2 baseline)",
               "docs/workflow-agent/hasil-pengujian-final-tahap1-6-qwen14b.md (laporan)"],
    "banding": ["Sama: model, image vLLM, max-num-seqs, jumlah replika, LiteLLM, akun uji, workload & urutan (seed tetap), batas waktu.",
                "v2 lahir sesudah baseline; data lama dinilai ulang dari bukti yang tercatat saat itu.",
                "v1 turun 220 → 217 karena kriteria lama Q5 tidak mengenali klarifikasi kategori (Tahap 6); v2 menilainya benar.",
                "Pembatalan saat habis waktu menyala di uji baru; tidak ada yang habis waktu, jadi tidak memengaruhi angka.",
                "Durasi tahap = jam dinding sampai pertanyaan terakhir selesai; ekor panjang baseline memperpanjang tahapnya.",
                "Pencatatan delegasi baru ada sejak 24 Nov (delegasi baseline = 0 bukan berarti tanpa delegasi).",
                "Satu kali jalan per kondisi; sampel per tahap kecil. Setelan Kelola AI bisa berubah antar-hari (akun uji: Portal 10, Super Tools 5, Marketing 7 alat — sama dengan 23 Nov)."],
    "cakupan": "Dashboard ini hanya memuat T7 (benchmark konkurensi). T1 dihentikan sesudah 7 skenario; T2–T6 belum dijalankan.",
    "batasan": ["Satu kali jalan per tingkat konkurensi; sampel 1–8 pengguna kecil (3–24 pertanyaan).",
                "Pemakaian KV cache dan log statistik vLLM tidak tercatat: instance sudah dimatikan sebelum log diambil.",
                "Token per workflow dihitung dari workflow yang seluruh panggilannya cocok dengan catatan LiteLLM (88% panggilan).",
                "Pengalihan otomatis Tahap 3 belum teruji live: untuk Q4 model hampir selalu langsung memilih pemegang SOP; satu-satunya salah pilih (F1) jatuh ke agent tanpa alat, cabang yang belum mengalihkan.",
                "Tarif biaya memakai angka laporan sebelumnya ($7,94/jam), bukan tagihan aktual.",
                "Jalur web belum meneruskan pembatalan dari browser (req.signal) — belum diuji di sini."],
}
DATA = {"meta": meta, "tahap": tahap, "kode": kode, "kode_tahap": kt, "rute": {"q1": q1, "q4": q4, "q5": q5, "q8": q8}, "orkes": orkes,
        "total": tot, "gagal": gagal, "rca": rca}

tpl_lama = open("scripts/dashboard-template.html", encoding="utf-8").read()
gaya = tpl_lama[tpl_lama.index("<style>") + len("<style>"):tpl_lama.index("</style>")]
tpl = open("scripts/dashboard-pasca-optimasi.template.html", encoding="utf-8").read()
data_json = json.dumps(DATA, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
out = tpl.replace("/*__STYLE__*/", gaya).replace("/*__DATA__*/null", data_json)
p = "docs/benchmark/grafik/hasil-pengujian-final-qwen14b.html"
open(p, "w", encoding="utf-8", newline="\n").write(out)
print(f"{p}: {len(out) / 1024:.0f} KB · {len(tahap)} tahap · {len(gagal)} baris kegagalan/sebagian")
