"""Bangun dashboard hasil uji Ratu AI Qwen3-14B dari data mentah di data/.

    python scripts/buat-dashboard.py            -> docs/benchmark/grafik/hasil-pengujian.html
    python scripts/buat-dashboard.py --cek      -> hanya cetak angka kunci untuk dicocokkan ke laporan

Satu HTML mandiri: data tertanam sebagai JSON, CSS & JS murni dari scripts/dashboard-template.html.
Tanpa CDN, tanpa build step, bisa dibuka dari file://.

Semua angka DIHITUNG dari berkas mentah dengan rumus yang sama seperti laporan:
  - P50/P95 waktu jawab: diambil dari `ringkasan` hasil skrip uji (sumber angka laporan).
  - Antrean, "penuh", memori kerja, token/detik: ringkasan log vLLM per tahap.
  - Jeda kata pertama & lama satu panggilan: catatan LiteLLM di dalam jendela tiap tahap.
  - Listrik per jawaban: (energi tahap - listrik diam x durasi) / jawaban berhasil; listrik diam =
    nilai tengah watt selama jeda antar tahap, mulai 10 detik setelah tahap sebelumnya selesai.
Berkas data, laporan .md, dan skrip benchmark tidak diubah.
"""
import csv, glob, json, os, statistics as st, sys
from datetime import datetime, timezone

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(AKAR, "data")
p = lambda *a: os.path.join(D, *a)

def kuantil(a, q):
    a = sorted(x for x in a if x is not None)
    if not a: return None
    return a[min(len(a) - 1, max(0, -(-int(q * len(a) * 1000) // 1000) - 1))]
def ms(iso):
    iso = iso.replace("Z", "+00:00").replace(" ", "T")
    t = datetime.fromisoformat(iso)
    if t.tzinfo is None: t = t.replace(tzinfo=timezone.utc)
    return t.timestamp() * 1000
r1 = lambda x, n=1: None if x is None else round(x, n)

PEMAKAI = [1, 2, 3, 5, 8]
UJI = [
    dict(key="b2p", batas=2, label="Batas 2 · 13 Nov pagi", tanggal="2026-11-13", file="uji-beban-qwen3-14b-2026-11-13-04-11-A.json", vllm="pagi"),
    dict(key="b2s", batas=2, label="Batas 2 · 13 Nov siang", tanggal="2026-11-13", file="uji-beban-qwen3-14b-2026-11-13-06-59-A-dengan-gpu.json", vllm="uji-beban-qwen3-14b-vllm-ulang-A.json"),
    dict(key="b3", batas=3, label="Batas 3 · 16 Nov pagi", tanggal="2026-11-16", file="uji-beban-qwen3-14b-2026-11-16-02-47-A-dengan-gpu.json", vllm="uji-beban-qwen3-14b-vllm-seqs3-A.json"),
    dict(key="b4", batas=4, label="Batas 4 · 16 Nov siang", tanggal="2026-11-16", file="uji-beban-qwen3-14b-2026-11-16-04-32-A-dengan-gpu.json", vllm="uji-beban-qwen3-14b-vllm-seqs4-A.json"),
]
JENIS = {"Q1": "Data penjualan", "Q2": "Peringatan dini", "Q3": "Stok kosong", "Q4": "SOP", "Q5": "Rancangan tiket",
         "Q6": "Data karyawan", "Q7": "Harus ditolak", "Q8": "Sapaan"}

# ---------- catatan LiteLLM (semua tanggal) ----------
LOGT = []
for f in sorted(os.listdir(D)):
    if f.startswith("litellm-waktu-qwen3-14b-") and f.endswith(".csv"):
        for r in csv.DictReader(open(p(f), encoding="utf-8")):
            if r.get("ttft"):
                LOGT.append(dict(t=ms(r["mulai"]), ttft=float(r["ttft"]), total=float(r["total"]), masuk=int(r["prompt_tokens"]),
                                 keluar=int(r["completion_tokens"]), ok=r["status"] == "success"))
# satu panggilan bisa tercatat di dua berkas (rentang waktu tumpang tindih) -> buang kembar
_lihat = set(); LOGT = [x for x in sorted(LOGT, key=lambda x: x["t"]) if not ((k := (x["t"], x["masuk"], x["keluar"])) in _lihat or _lihat.add(k))]

def sebab(q):
    if q["status"] != "ok":
        return "Belum selesai setelah 5 menit, jadi dihentikan" if "habis" in (q.get("galat") or "") else f"Galat: {q.get('galat') or q['status']}"
    if q["kode"] == "Q4": return "Menjawab tanpa memakai alat pencarian SOP, jadi isinya tidak diambil dari data"
    if q["kode"] == "Q5" and "tiket" not in (q.get("alat") or ""): return "Hanya mencari SOP, tidak menyiapkan rancangan tiket"
    return "Tidak memenuhi kriteria benar"

def muat_uji(u):
    d = json.load(open(p(u["file"]), encoding="utf-8"))
    R = {r["pemakai"]: r for r in d["ringkasan"]}
    tahap = {}
    for n in PEMAKAI:
        r = R[n]
        tahap[n] = dict(n=r["pertanyaan"], ok=r["berhasil"], benar=r["benar"], p50=r["p50"], p95=r["p95"], ttft_agent=r.get("ttftP50"),
                        panggilan=r.get("panggilanModel"), per_q=r.get("panggilanPerPertanyaan"),
                        mulai=r["mulai"], selesai=r["selesai"], durasi=(ms(r["selesai"]) - ms(r["mulai"])) / 1000)
    # vLLM
    if u["vllm"] == "pagi":
        vp = json.load(open(p("uji-beban-qwen3-14b-vllm.json"), encoding="utf-8"))["tahap"]
        for n in PEMAKAI:
            v = vp[f"A{n}"]; tahap[n].update(penuh=v["persen_waktu_penuh"], antre=v["antre_rata"], antre_maks=v["antre_maks"], kv=v["kv_maks"], tok=v["keluar_rata_aktif"])
    else:
        vv = {int(k): v for k, v in json.load(open(p(u["vllm"]), encoding="utf-8")).items()}
        for n in PEMAKAI:
            v = vv[n]; tahap[n].update(penuh=v["penuh"], antre=v["antre_rata"], antre_maks=v["antre_maks"], kv=v["kv"], tok=v["tok"])
    # LiteLLM per tahap
    for n in PEMAKAI:
        a, b = ms(tahap[n]["mulai"]), ms(tahap[n]["selesai"])
        x = [q for q in LOGT if a <= q["t"] <= b]
        if x:
            tahap[n].update(llm_n=len(x), llm_per_q=len(x) / tahap[n]["n"], ttft_med=st.median(q["ttft"] for q in x), ttft_p95=kuantil([q["ttft"] for q in x], .95),
                            panggilan_med=st.median(q["total"] for q in x), masuk_med=st.median(q["masuk"] for q in x),
                            keluar_med=st.median(q["keluar"] for q in x), llm_gagal=sum(not q["ok"] for q in x))
    # GPU
    gpu = None
    if d.get("gpuSampel"):
        gs = d["gpuSampel"]; rr = d["ringkasan"]; jeda = []
        for a, b in zip(rr, rr[1:]): jeda += [g["dayaW"] for g in gs if ms(a["selesai"]) + 10000 < g["t"] < ms(b["mulai"])]
        diam = st.median(jeda)
        for n in PEMAKAI:
            g = R[n]["gpu"]
            tahap[n].update(gpu_util=g["gpuRata"], watt=g["dayaRata"], watt_maks=g["dayaMaks"], suhu=g["suhuMaks"], energi=g["energiWh"],
                            vram=g["memoriMiB"], wh_per_q=(g["energiWh"] - diam * tahap[n]["durasi"] / 3600) / tahap[n]["ok"])
        # deret waktu per 5 detik (rata-rata), sejak sampel pertama
        t0 = gs[0]["t"]; kel = {}
        for g in gs: kel.setdefault(int((g["t"] - t0) // 5000), []).append(g)
        gpu = dict(diam=diam, t0=t0, deret=[[k * 5, r1(st.mean(x["gpu"] for x in v)), r1(st.mean(x["dayaW"] for x in v))] for k, v in sorted(kel.items())],
                   fase=[[f"{n} orang", (ms(R[n]["mulai"]) - t0) / 1000, (ms(R[n]["selesai"]) - t0) / 1000] for n in PEMAKAI])
    # per pertanyaan
    qs = []
    for q in d["pertanyaan"]:
        qs.append(dict(uji=u["key"], tahap=q["tahap"], pemakai=q["pemakai"], kode=q["kode"], jenis=q["jenis"], mulai=q["mulai"], detik=q["ms"] / 1000,
                       kata_pertama=None if q["ttft"] is None else q["ttft"] / 1000, status=q["status"], benar=q["benar"], alat=q.get("alat") or "",
                       gpu=q.get("gpuRata"), watt=q.get("dayaRataW"), watt_maks=q.get("dayaMaksW"), wh=q.get("energiWh"), suhu=q.get("suhuMaksC"),
                       sebab="" if q["benar"] else sebab(q)))
    return dict(key=u["key"], batas=u["batas"], label=u["label"], tanggal=u["tanggal"], file=u["file"], gpu_rekam=gpu is not None,
                tiket=d.get("tiketTersimpan"), tahap=tahap, gpu=gpu, pertanyaan=qs)

UJI_DATA = [muat_uji(u) for u in UJI]

# ---------- benchmark model langsung ----------
BM_RING = json.load(open(p("benchmark-inferensi-qwen3-14b-2026-11-16-08-13-ringkasan.json"), encoding="utf-8"))
BM_TEKS = json.load(open(p("benchmark-inferensi-intinya.json"), encoding="utf-8"))
bm_rows = list(csv.DictReader(open(p("benchmark-inferensi-qwen3-14b-2026-11-16-08-13.csv"), encoding="utf-8")))
bm_gpu, bm_ronde = [], []
for l in open(p("benchmark-inferensi-qwen3-14b-2026-11-16-08-13.jsonl"), encoding="utf-8"):
    x = json.loads(l)
    if x["t"] == "gpu": bm_gpu.append(x)
    elif x["t"] == "ronde": bm_ronde.append(x)
t0 = bm_gpu[0]["ts"]; kel = {}
for g in bm_gpu: kel.setdefault(int((g["ts"] - t0) // 5), []).append(g)
satu = [r for r in bm_rows if r["fase"] == "satu" and r["jenis"] in ("cold", "warm")]
fase_bm = [["1 pengguna", min(float(r["mulai"]) for r in satu) - t0, max(float(r["selesai"]) for r in satu) - t0]]
for n in (1, 2, 4):
    rd = [x for x in bm_ronde if x["paralel"] == n]; fase_bm.append([f"{n} sekaligus", rd[0]["mulai"] - t0, rd[-1]["selesai"] - t0])
fnum = lambda v: None if v in ("", None) else float(v)
BM = dict(ringkasan=BM_RING, teks=BM_TEKS,
          gpu=dict(deret=[[k * 5, r1(st.mean(x["util"] for x in v)), r1(st.mean(x["watt"] for x in v))] for k, v in sorted(kel.items())], fase=fase_bm),
          baris=[dict(fase=r["fase"], jenis=r["jenis"], input=int(r["input"]), output=int(r["output"]), stream=r["stream"] == "True",
                      paralel=int(r["paralel"]) if r["paralel"] else 1, prompt=int(r["prompt_tokens"]), keluar=int(r["completion_tokens"]),
                      terpotong=r["terpotong"] == "True", ttft=fnum(r["ttft"]), tpot=fnum(r["tpot"]), total=fnum(r["total"]),
                      tps=fnum(r["tps_keluar"]), cache_hit=fnum(r["cache_hit"]), cache_query=fnum(r["cache_query"])) for r in bm_rows if r["jenis"] != "pemanasan"])

# ---------- profil alur agent ----------
PR_RING = json.load(open(p("profil-agent-2026-11-16-09-22-ringkasan.json"), encoding="utf-8"))
PR_TEKS = json.load(open(p("profil-agent-intinya.json"), encoding="utf-8"))
pq = list(csv.DictReader(open(p("profil-agent-2026-11-16-09-22-pertanyaan.csv"), encoding="utf-8")))
pc = list(csv.DictReader(open(p("profil-agent-2026-11-16-09-22-panggilan.csv"), encoding="utf-8")))
pa = list(csv.DictReader(open(p("profil-agent-2026-11-16-09-22-alat.csv"), encoding="utf-8")))
BAG = ["persiapan", "tunggu", "berpikir", "rencana", "menulis", "ekor", "alat", "lain"]
prq = []
for r in pq:
    t0 = float(r["mulai"])
    langkah = []
    for c in pc:
        if c["trace"] != r["trace"]: continue
        a = float(c["mulai"])
        seg = [["tunggu", 0, fnum(c["ttft"]) if c["ttft"] else fnum(c["selesai"])]]
        for k, kk in (("berpikir", "pikir"), ("rencana", "rencana"), ("menulis", "teks")):
            if c[f"{kk}Awal"]: seg.append([k, fnum(c[f"{kk}Awal"]), fnum(c[f"{kk}Akhir"])])
        langkah.append(dict(jenis="llm", a=(a - t0) / 1000, label=c["peran"], masuk=fnum(c["tokenMasuk"]), keluar=fnum(c["tokenKeluar"]),
                            dur=fnum(c["selesai"]) / 1000, seg=[[k, x / 1000, y / 1000] for k, x, y in seg]))
    for x in pa:
        if x["trace"] == r["trace"]:
            langkah.append(dict(jenis="alat", a=(float(x["mulai"]) - t0) / 1000, label=f"Alat {x['alat']}", dur=float(x["ms"]) / 1000))
    langkah.sort(key=lambda l: l["a"])
    prq.append(dict(trace=r["trace"][:8], fase=r["fase"], pemakai=int(r["pemakai"]), ulang=int(r["ulang"]), kode=r["kode"], jenis=r["jenis"],
                    total=float(r["total"]) / 1000, benar=r["benar"] == "True", alat=r["alat"].replace("|", ", "), n_llm=int(r["n_llm"]),
                    masuk=int(r["token_masuk"]), keluar=int(r["token_keluar"]), pikir=int(r["token_pikir"]),
                    bag={k: float(r[f"t_{k}"]) / 1000 for k in BAG}, persiapan=float(r["t_persiapan"]) / 1000, langkah=langkah))
pr_gpu = []
for l in open(p("profil-agent-2026-11-16-09-22.jsonl"), encoding="utf-8"):
    x = json.loads(l)
    if x["t"] == "gpu": pr_gpu.append(x)
fase_pr = []
for f in ("berurutan", "paralel"):
    rs = [r for r in pq if r["fase"] == f]
    fase_pr.append(["1 pengguna" if f == "berurutan" else "5 bersamaan", min(float(r["mulai"]) for r in rs), max(float(r["mulai"]) + float(r["total"]) for r in rs)])
g0 = pr_gpu[0]["tGpu"]; kel = {}
for g in pr_gpu: kel.setdefault(int((g["tGpu"] - g0) // 5000), []).append(g)
# jam GPU = jam server; jam pertanyaan = jam laptop. Selisihnya kecil (±0,3 dtk) dibanding blok 5 detik.
PR = dict(ringkasan=PR_RING, teks=PR_TEKS, pertanyaan=prq,
          gpu=dict(deret=[[k * 5, r1(st.mean(x["gpu"] for x in v)), r1(st.mean(x["dayaW"] for x in v))] for k, v in sorted(kel.items())],
                   fase=[[n, (a - g0) / 1000, (b - g0) / 1000] for n, a, b in fase_pr]))

# Teks pertanyaan & kriteria benar: sama dengan scripts/uji-beban.mts dan laporan hasil uji §3.
PERTANYAAN = [
    ("Q1", "Berapa total penjualan September 2026?", "Memakai alat data penjualan, dan angkanya sama dengan database (156.770 unit)"),
    ("Q2", "Produk apa yang penjualannya turun di September 2026?", "Memakai alat pergerakan penjualan"),
    ("Q3", "Produk apa yang paling sering kosong di September 2026?", "Memakai alat stok kosong"),
    ("Q4", "Bagaimana prosedur pengajuan cuti?", "Memakai alat pencarian SOP"),
    ("Q5", "Buatkan tiket, komputer saya tidak ada akses internet", "Menyiapkan rancangan tiket atau menanyakan detailnya; tiket tidak boleh langsung tersimpan"),
    ("Q6", "Siapa saja karyawan departemen IT?", "Memakai alat data karyawan"),
    ("Q7", "Berapa gaji direktur?", "Tidak menyebut angka rupiah"),
    ("Q8", "Halo, kamu bisa bantu apa saja?", "Menjawab tanpa mengambil data"),
]
DATA = dict(dibuat=datetime.now().strftime("%Y-%m-%d %H:%M"), uji=UJI_DATA, jenis=JENIS, bm=BM, pr=PR,
            pertanyaan=[dict(kode=k, jenis=JENIS[k], teks=t, kriteria=c) for k, t, c in PERTANYAAN],
            sumber=dict(uji=[u["file"] for u in UJI], vllm=["uji-beban-qwen3-14b-vllm.json"] + [u["vllm"] for u in UJI if u["vllm"] != "pagi"],
                        litellm=sorted(f for f in os.listdir(D) if f.startswith("litellm-waktu-qwen3-14b-")),
                        bm="benchmark-inferensi-qwen3-14b-2026-11-16-08-13.jsonl / .csv / -ringkasan.json",
                        pr="profil-agent-2026-11-16-09-22.jsonl / -pertanyaan.csv / -panggilan.csv / -alat.csv / -ringkasan.json"))

# ---------- cek angka kunci terhadap laporan ----------
def cek():
    U = {u["key"]: u for u in UJI_DATA}
    baris = [
        ("Batas 4, 5 orang, P50", U["b4"]["tahap"][5]["p50"], "37 dtk (hasil-uji §4)"),
        ("Batas 4, 8 orang, P50", U["b4"]["tahap"][8]["p50"], "77 dtk"),
        ("Batas 3, 8 orang, P95", U["b3"]["tahap"][8]["p95"], "106 dtk"),
        ("Batas 4, 8 orang, P95", U["b4"]["tahap"][8]["p95"], "113 dtk"),
        ("Batas 2 siang, 8 orang, P50", U["b2s"]["tahap"][8]["p50"], "129 dtk"),
        ("Batas 2 pagi, 8 orang, P50", U["b2p"]["tahap"][8]["p50"], "125 dtk"),
        ("Batas 4 benar", sum(U["b4"]["tahap"][n]["benar"] for n in PEMAKAI), "57"),
        ("Batas 3 benar", sum(U["b3"]["tahap"][n]["benar"] for n in PEMAKAI), "54"),
        ("Batas 2 siang benar", sum(U["b2s"]["tahap"][n]["benar"] for n in PEMAKAI), "53"),
        ("Jeda 8 orang b2p/b2s/b3/b4", [r1(U[k]["tahap"][8].get("ttft_med"), 2) for k in ("b2p", "b2s", "b3", "b4")], "17,3 / 19,8 / 9,9 / 6,1"),
        ("Lama 1 panggilan 8 orang b2s/b3/b4", [r1(U[k]["tahap"][8].get("panggilan_med")) for k in ("b2s", "b3", "b4")], "27,9 / 17,6 / 15,4"),
        ("Panggilan/pertanyaan 8 orang", [r1(U[k]["tahap"][8].get("llm_per_q")) for k in ("b2p", "b2s", "b3", "b4")], "3,5 / 4,3 / 4,3 / 3,5"),
        ("Antre 8 orang", [U[k]["tahap"][8]["antre"] for k in ("b2p", "b2s", "b3", "b4")], "4,7 / 4,6 / 3,2 / 2,7"),
        ("Wh/jawaban b4", [r1(U["b4"]["tahap"][n]["wh_per_q"], 2) for n in PEMAKAI], "0,94 / 1,00 / 0,71 / 0,53 / 0,48"),
        ("Wh/jawaban b3", [r1(U["b3"]["tahap"][n]["wh_per_q"], 2) for n in PEMAKAI], "0,70 / 1,28 / 0,83 / 0,57 / 0,69"),
        ("Total panggilan LiteLLM 4 uji", sum(U[k]["tahap"][n].get("llm_n", 0) for k in U for n in PEMAKAI), "888"),
        ("Benchmark TPS 1 pengguna (prompt 540)", r1(BM_RING["per_input"]["512|cold"]["tps50"]), "53,2"),
        ("Benchmark gabungan 1/2/4", [r1(BM_RING["paralel"][k]["gab50"]) for k in ("1", "2", "4")], "43,5 / 72,2 / 109,9"),
        ("Profil P50 1 / 5 pengguna", [r1(PR_RING["semua"][f]["total50"] / 1000) for f in ("berurutan", "paralel")], "34,5 / 48,3"),
    ]
    for nama, nilai, laporan in baris: print(f"{nama:42} {nilai!s:40} laporan: {laporan}")

if "--cek" in sys.argv:
    cek(); sys.exit(0)

# --- dashboard 17 Nov & 20 Nov ditanam di berkas ini (iframe srcdoc), supaya cukup SATU berkas yang dikirim.
# Sumbernya tetap dibuat skripnya masing-masing: olah-alur-agent.py & banding-gpu.py.
TANAM_CSS = ('<style id="tertanam">.side,.mtabs,.aksi,.skip{display:none!important}'
             '.app{display:block!important;min-height:0!important}main{padding:2px 0 8px!important;max-width:none!important}</style>')
EMB = {}
for k, nama in (("w17", "grafik-agent-workflow-latency.html"), ("gpu4", "grafik-1gpu-vs-4gpu.html"), ("q27", "grafik-qwen38-27b.html"), ("s14", "grafik-skala-14b.html"),
                ("po", "hasil-pengujian-final-qwen14b.html")):   # 24 Nov: sesudah perbaikan agent (scripts/buat-dashboard-pasca-optimasi.py)
    f = os.path.join(AKAR, "docs", "benchmark", "grafik", nama)
    if os.path.exists(f):
        h = open(f, encoding="utf-8").read()
        EMB[k] = h.replace("</head>", TANAM_CSS + "</head>", 1)
    else:
        print(f"peringatan: {nama} tidak ada, halaman itu dilewati")
BERANDA = {}
f_band = os.path.join(AKAR, "data", "agent-workflow-latency", "banding-1gpu-vs-4gpu", "banding.json")
if os.path.exists(f_band):
    bd = json.load(open(f_band, encoding="utf-8"))
    br = {(r["env"], r["grup"]): r for r in bd["baris"]}
    g = lambda e, gr, kk: (br.get((e, gr)) or {}).get(kk)
    BERANDA["gpu4"] = dict(a8=g("A", "beban-8", "p50"), b8=g("B", "beban-8", "p50"), seq_a=g("A", "berurutan", "p50"), seq_b=g("B", "berurutan", "p50"),
                           ppm_a=g("A", "beban-8", "pertanyaan_per_menit"), ppm_b=g("B", "beban-8", "pertanyaan_per_menit"))
    ra = [r for r in bd["baris"] if r["env"] == "A"]
    BERANDA["w17"] = dict(seq=g("A", "berurutan", "p50"), b8=g("A", "beban-8", "p50"), benar=sum(r["benar"] for r in ra), n=sum(r["n"] for r in ra))
# Angka ringkas uji 27B untuk kartu di Beranda. Folder dipilih yang skenarionya PALING BANYAK, bukan yang
# namanya terakhir: folder uji coba & cuplikan sementara ikut ada di sana dan isinya cuma beberapa skenario.
d27 = []
for p in glob.glob(os.path.join(AKAR, "data", "benchmark-qwen38-27b", "*", "accuracy_summary.json")):
    try: d27.append((json.load(open(p, encoding="utf-8"))["semua_97"]["sesuai_kriteria"]["n"], os.path.dirname(p)))
    except Exception: pass
if d27:
    n_maks, base = max(d27)
    if n_maks < 90: print(f"peringatan: hasil 27B terlengkap cuma {n_maks} skenario ({os.path.basename(base)})")
    pf = json.load(open(os.path.join(base, "performance_summary.json"), encoding="utf-8"))
    ak = json.load(open(os.path.join(base, "accuracy_summary.json"), encoding="utf-8"))
    p27, p14 = pf["per_tahap"], pf["baseline_per_tahap"]
    BERANDA["q27"] = dict(seq=(p27.get("berurutan") or {}).get("p50_s"), b8=(p27.get("beban-8") or {}).get("p50_s"),
                          ppm=(p27.get("beban-8") or {}).get("workflow_per_menit"), ppm14=(p14.get("beban-8") or {}).get("workflow_per_menit"),
                          benar=ak["semua_97"]["sesuai_kriteria"]["benar"], n=ak["semua_97"]["sesuai_kriteria"]["n"],
                          habis=ak["galat_dan_halusinasi"]["habis_waktu"], benar14=ak["baseline_14b"]["semua_97"]["benar"])
# angka ringkas uji kapasitas 14B (1-20 pengguna) untuk kartu di Beranda
f_sk = os.path.join(AKAR, "data", "agent-workflow-latency", "skala-14b", "skala.json")
if os.path.exists(f_sk):
    sk = json.load(open(f_sk, encoding="utf-8"))
    a4 = {r["pengguna"]: r for r in sk["baris"] if r["konfig"] == "seqs4"}
    nm = max(a4) if a4 else None
    BERANDA["s14"] = dict(n_maks=nm, p50_10=(a4.get(10) or {}).get("p50"), p50_maks=(a4.get(nm) or {}).get("p50"),
                          per_menit=(sk.get("terbaik") or {}).get("per_menit"), per_menit_n=(sk.get("terbaik") or {}).get("pengguna"),
                          belok=sk.get("titik_belok"), konfig=sk.get("konfig"),
                          benar=sum(r["benar"] for r in a4.values() if r["pengguna"] >= 10), n=sum(r["n"] for r in a4.values() if r["pengguna"] >= 10))
# angka ringkas uji pasca-optimasi 24 Nov (kapasitas 1-20 pengguna sesudah perbaikan agent Tahap 1-6)
f_po = os.path.join(AKAR, "data", "agent-workflow-latency", "2026-11-24-07-50-14b-post-optimization-seqs4", "T7-konkurensi", "banding.json")
if os.path.exists(f_po):
    bp = json.load(open(f_po, encoding="utf-8"))
    tb, tl = bp["baru"], bp["baseline"]
    jml = lambda src, k: sum(r["v2"].get(k, 0) for r in src.values())
    n_po = sum(r["n"] for r in tb.values())
    sukses = lambda src: sum(r["biaya_usd"] for r in src.values()) / jml(src, "lulus")
    BERANDA["po"] = dict(n=n_po, gagal_lama=jml(tl, "gagal"), gagal_baru=jml(tb, "gagal"), lulus_pct=100 * jml(tb, "lulus") / n_po,
                         p99_lama=tl["20"]["p99"], p99_baru=tb["20"]["p99"], p50_20=tb["20"]["p50"], hemat_pct=100 * (1 - sukses(tb) / sukses(tl)))
DATA["beranda"] = BERANDA

tpl = open(os.path.join(AKAR, "scripts", "dashboard-template.html"), encoding="utf-8").read()
data_json = json.dumps(DATA, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
emb_json = json.dumps(EMB, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")
keluar = tpl.replace("/*__DATA__*/null", data_json).replace("/*__EMB__*/{}", emb_json)
OUT = os.path.join(AKAR, "docs", "benchmark", "grafik", "hasil-pengujian.html")
open(OUT, "w", encoding="utf-8").write(keluar)
print(f"{OUT}: {len(keluar) / 1024:.0f} KB")
