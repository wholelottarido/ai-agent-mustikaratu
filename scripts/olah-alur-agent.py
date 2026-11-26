"""Olah hasil scripts/profil-alur-agent.mts menjadi tabel, ringkasan, dan dashboard offline.

    python scripts/olah-alur-agent.py data/agent-workflow-latency/<waktu> [--vllm-log berkas.log]

Keluaran (di folder data yang sama):
  pertanyaan.csv   satu baris per pertanyaan: status, total, pecahan waktu EKSKLUSIF, token, jumlah panggilan
  span.csv         satu baris per span (trace, span, parent, jenis, nama, mulai relatif, durasi, atribut waktu)
  panggilan.csv    satu baris per panggilan model + token & waktu dari LiteLLM
  ringkasan.json   semua angka untuk laporan & dashboard
  cek.json         hasil sanity check
Dashboard: docs/benchmark/grafik/grafik-agent-workflow-latency.html (gaya & komponen diambil dari scripts/dashboard-template.html)

PECAHAN WAKTU EKSKLUSIF (critical path, tanpa double counting)
  Satu pertanyaan dipotong di setiap batas span. Tiap potongan waktu diberikan ke SATU kategori:
  yang paling spesifik dari span yang sedang aktif, dengan prioritas:
    embedding > db (di dalam alat) > alat > model: tunggu / berpikir / rencana / menulis / ekor
    > persiapan > orkestrasi (di dalam delegate_task, di luar model & alat) > lain (kerangka agent)
  Jumlah semua kategori = total waktu pertanyaan.
"""
import bisect, csv, json, os, re, statistics as st, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

DIR = sys.argv[1].rstrip("/\\")
AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
baca = lambda f: [json.loads(l) for l in open(os.path.join(DIR, f), encoding="utf-8") if l.strip()]
SPAN = baca("span.jsonl")
KJ = baca("kejadian.jsonl")
INFO = next(x for x in KJ if x["t"] == "info")
Q = [x for x in KJ if x["t"] == "q"]
VL = [x for x in KJ if x["t"] == "vllm"]
GPU = [x for x in KJ if x["t"] == "gpu"]
FASE_EV = [x for x in KJ if x["t"] == "fase"]
STOP = [x for x in KJ if x["t"] == "stop"]
SELESAI = next((x for x in KJ if x["t"] == "selesai"), {})

def kuantil(a, q):
    a = sorted(x for x in a if x is not None)
    if not a: return None
    return a[min(len(a) - 1, max(0, -(-int(q * len(a) * 1000) // 1000) - 1))]
p50 = lambda a: kuantil(a, .5); p95 = lambda a: kuantil(a, .95)
rata = lambda a: (st.mean(a) if a else None)
r = lambda x, n=1: None if x is None else round(x, n)

# ---------- span per trace ----------
per_trace = defaultdict(list)
for s in SPAN:
    if s.get("trace"): per_trace[s["trace"]].append(s)

# ---------- LiteLLM: cocokkan per panggilan (jam mulai) ----------
LT = []
p_lt = os.path.join(DIR, "litellm.csv")
if os.path.exists(p_lt):
    for row in csv.DictReader(open(p_lt, encoding="utf-8")):
        if not row.get("mulai") or not row.get("ttft"): continue
        t = datetime.fromisoformat(row["mulai"].replace(" ", "T")).replace(tzinfo=timezone.utc).timestamp() * 1000
        LT.append(dict(t=t, ttft=float(row["ttft"]) * 1000, total=float(row["total"]) * 1000, masuk=int(row["prompt_tokens"]),
                       keluar=int(row["completion_tokens"]), ok=row["status"] == "success", pakai=False,
                       # kolom baru (server 4 GPU): replika & token reasoning persis; kosong di data lama
                       api_base=(row.get("api_base") or "").replace("http://", "").replace("https://", "").split(":")[0] or None,
                       pikir=int(row["reasoning_tokens"]) if (row.get("reasoning_tokens") or "").isdigit() else None))
LT.sort(key=lambda x: x["t"])
LLM = sorted([s for s in SPAN if s["jenis"] == "llm" and s.get("trace")], key=lambda s: s["mulai"])
ok_llm = [s for s in LLM if s["status"] == "ok"]
def cocok_replika(s, l):
    """Kalau replika tercatat di span (header) DAN di LiteLLM, keduanya harus sama."""
    return not (s.get("replika") and l["api_base"]) or s["replika"] == l["api_base"]
def cari_geser():
    """Selisih jam LiteLLM (server) - laptop. Semua kandidat selisih (+-60 dtk) dicoba; dipilih yang
    paling banyak panggilan cocok dalam +-1,5 dtk, lalu yang sisa selisihnya paling kecil.
    Ditemukan 20 Nov 2026: jam laptop tertinggal 11 dtk dari server 4 GPU, dan cara lama (median
    pasangan berurutan) gagal kalau jumlah baris LiteLLM tidak sama dengan jumlah panggilan."""
    if not ok_llm or not LT: return 0
    if len(ok_llm) == len(LT): calon = [st.median(l["t"] - s["mulai"] for s, l in zip(ok_llm, LT))]
    else: calon = []
    contoh = ok_llm[:: max(1, len(ok_llm) // 40)]
    calon += [l["t"] - s["mulai"] for s in contoh for l in LT if abs(l["t"] - s["mulai"]) < 60_000]
    # 23 Nov 2026: versi lama membandingkan tiap panggilan dengan SEMUA baris LiteLLM untuk tiap kandidat.
    # Di 20 pengguna (ribuan kandidat x ratusan panggilan x ratusan baris) prosesnya tidak selesai
    # dalam 10 menit. Hasilnya sama persis: hanya selisih < 1,5 dtk yang dihitung, jadi cukup periksa
    # baris LiteLLM di sekitar waktu itu (LT sudah terurut -> bisect). Kandidat kembar dibuang.
    T = [l["t"] for l in LT]
    def sisa_terdekat(s, g):
        sasaran = s["mulai"] + g
        i, best = bisect.bisect_left(T, sasaran - 1500), 1e9
        while i < len(T) and T[i] < sasaran + 1500:
            if cocok_replika(s, LT[i]): best = min(best, abs(T[i] - sasaran))
            i += 1
        return best
    terbaik = (-1, float("inf"), 0)
    for g in dict.fromkeys(calon):
        sisa = [sisa_terdekat(s, g) for s in ok_llm]
        n = sum(x < 1500 for x in sisa)
        skor = (n, -sum(x for x in sisa if x < 1500))
        if skor > terbaik[:2]: terbaik = (n, skor[1], g)
    return terbaik[2]
geser = cari_geser()
cocok = 0
for s in ok_llm:
    calon = [l for l in LT if not l["pakai"] and abs(l["t"] - s["mulai"] - geser) < 1500 and cocok_replika(s, l)]
    if calon:
        l = min(calon, key=lambda l: abs(l["t"] - s["mulai"] - geser)); l["pakai"] = True; cocok += 1
        s.update(lt_ttft=l["ttft"], lt_total=l["total"], token_masuk=l["masuk"], token_keluar=l["keluar"],
                 transport_ms=s["durasi_ms"] - l["total"], replika_lt=l["api_base"], token_pikir_lt=l["pikir"])
    n = sum(s.get(k, 0) or 0 for k in ("pikir_n", "teks_n", "rencana_n"))
    s["porsi_pikir"] = (s.get("pikir_n") or 0) / n if n else 0

# ---------- pecahan eksklusif per pertanyaan ----------
PRIOR = ["embedding", "db", "alat", "tunggu", "berpikir", "rencana", "menulis", "ekor", "persiapan", "orkestrasi", "lain"]
NAMA = dict(embedding="Cari SOP (embedding)", db="Query database (di dalam alat)", alat="Alat, selain database", tunggu="Model: menunggu kata pertama",
            berpikir="Model: berpikir", rencana="Model: menyusun panggilan alat", menulis="Model: menulis jawaban", ekor="Model: penutup jawaban",
            persiapan="Agent bersiap (termasuk baca setelan)", orkestrasi="Delegasi ke agent aplikasi", lain="Kerangka agent & jeda")

def peran(s, semua):
    sub = sorted([x for x in semua if x["nama"] == s["nama"]], key=lambda x: x["mulai_mono"])
    pertama = s is sub[0]
    rencana = bool(s.get("rencana_n"))
    if s["nama"] == "Ratu AI Umum":
        if pertama and not s.get("lanjutan"): return "Perute: memilih agent" if rencana else "Perute: menjawab langsung"
        return "Perute: menyerahkan lagi" if rencana else "Perute: jawaban akhir"
    nm = s["nama"].replace("Ratu AI ", "")
    if not s.get("lanjutan"): return f"{nm}: memilih alat" if rencana else f"{nm}: menjawab langsung"
    return f"{nm}: memilih alat lagi" if rencana else f"{nm}: menyusun hasil"

def pecah(q, spans):
    req = next((s for s in spans if s["jenis"] == "permintaan"), None)
    if not req: return None, None
    t0 = req["mulai_mono"]; total = q["total_ms"]
    byid = {s["span"]: s for s in spans}
    def di_alat(s):
        p = byid.get(s.get("parent"))
        while p:
            if p["jenis"] == "alat": return True
            if p["jenis"] == "persiapan": return False
            p = byid.get(p.get("parent"))
        return False
    iv = []
    for s in spans:
        a = s["mulai_mono"] - t0; b = a + s["durasi_ms"]
        j = s["jenis"]
        if j == "embedding": iv.append(("embedding", a, b))
        elif j == "db": iv.append(("db" if di_alat(s) else "persiapan" if not di_alat(s) and byid.get(s.get("parent"), {}).get("jenis") == "persiapan" else "db", a, b))
        elif j == "alat": iv.append(("alat", a, b))
        elif j == "persiapan": iv.append(("persiapan", a, b))
        elif j == "delegasi": iv.append(("orkestrasi", a, b))
        elif j == "permintaan": iv.append(("lain", a, max(b, total)))
        elif j == "llm":
            f = s.get("ttft_ms") if s.get("ttft_ms") is not None else s["durasi_ms"]
            iv.append(("ekor", a, b)); iv.append(("tunggu", a, a + f))
            for k, kk in (("berpikir", "pikir"), ("rencana", "rencana"), ("menulis", "teks")):
                if s.get(f"{kk}_awal_ms") is not None: iv.append((k, a + s[f"{kk}_awal_ms"], a + s[f"{kk}_akhir_ms"]))
    batas = sorted({0, total} | {x for _, a, b in iv for x in (a, b) if 0 <= x <= total})
    hasil = Counter()
    for x, y in zip(batas, batas[1:]):
        if y <= x: continue
        m = (x + y) / 2
        aktif = [k for k, a, b in iv if a <= m < b]
        k = min(aktif, key=PRIOR.index) if aktif else "lain"
        hasil[k] += y - x
    return {k: hasil.get(k, 0.0) for k in PRIOR}, t0

BARIS = []
for q in Q:
    spans = per_trace.get(q["trace"], [])
    bag, t0 = pecah(q, spans)
    llm = sorted([s for s in spans if s["jenis"] == "llm"], key=lambda s: s["mulai_mono"])
    for s in llm: s["peran"] = peran(s, llm); s["kode"] = q["kode"]; s["fase"] = q["fase"]; s["tahap"] = q.get("tahap")
    alat = [s for s in spans if s["jenis"] == "alat"]
    BARIS.append(dict(trace=q["trace"], fase=q["fase"], tahap=q.get("tahap"), pemakai=q.get("pemakai"), urut=q.get("urut"), ulang=q.get("ulang"),
                      kode=q["kode"], jenis=q["jenis"], mulai=q["mulai"], total_ms=q["total_ms"], ttft_jawaban_ms=q.get("ttft_jawaban_ms"),
                      status=q["status"], benar=q["benar"], alat="|".join(q["alat"]), rancangan=q["rancangan"],
                      n_llm=len(llm), n_llm_galat=sum(s["status"] != "ok" for s in llm), n_alat=len(alat),
                      n_delegasi=sum(s["jenis"] == "delegasi" for s in spans), n_db=sum(s["jenis"] == "db" for s in spans),
                      n_embedding=sum(s["jenis"] == "embedding" for s in spans),
                      token_masuk=sum(s.get("token_masuk") or 0 for s in llm), token_keluar=sum(s.get("token_keluar") or 0 for s in llm),
                      # token reasoning PERSIS dari LiteLLM kalau tersedia untuk semua panggilan; kalau tidak, perkiraan dari porsi potongan stream
                      token_pikir=(sum(s["token_pikir_lt"] for s in llm) if llm and all(s.get("token_pikir_lt") is not None for s in llm)
                                   else round(sum((s.get("token_keluar") or 0) * s.get("porsi_pikir", 0) for s in llm))),
                      token_pikir_pasti=bool(llm) and all(s.get("token_pikir_lt") is not None for s in llm),
                      alat_ms=sum(s["durasi_ms"] for s in alat), transport_ms=sum(s.get("transport_ms") or 0 for s in llm),
                      **{f"x_{k}": (bag or {}).get(k) for k in PRIOR}, _t0=t0, _spans=spans))

# ---------- vLLM: berurutan per pertanyaan, beban per tahap ----------
def dlt(a, b, k): return (b.get(k, 0) - a.get(k, 0))
def vllm_delta(a, b):
    n = dlt(a, b, "request_queue_time_seconds_count")
    if not n: return None
    return dict(n=n, antre_ms=dlt(a, b, "request_queue_time_seconds_sum") / n * 1000, prefill_ms=dlt(a, b, "request_prefill_time_seconds_sum") / n * 1000,
                decode_ms=dlt(a, b, "request_decode_time_seconds_sum") / n * 1000, ttft_ms=dlt(a, b, "time_to_first_token_seconds_sum") / n * 1000,
                e2e_ms=dlt(a, b, "e2e_request_latency_seconds_sum") / n * 1000,
                cache=(dlt(a, b, "prefix_cache_hits_total") / dlt(a, b, "prefix_cache_queries_total")) if dlt(a, b, "prefix_cache_queries_total") else None,
                preemption=dlt(a, b, "num_preemptions_total"))
for b in BARIS:
    if b["fase"] != "berurutan": continue
    a_ = next((v for v in VL if v["saat"] == "awal" and v.get("fase") == "berurutan" and v.get("ulang") == b["ulang"] and v.get("kode") == b["kode"]), None)
    z_ = next((v for v in VL if v["saat"] == "akhir" and v.get("fase") == "berurutan" and v.get("ulang") == b["ulang"] and v.get("kode") == b["kode"]), None)
    d = vllm_delta(a_, z_) if a_ and z_ else None
    if d: b.update({f"vllm_{k}": v for k, v in d.items()})
VTAHAP = {}
for v in VL:
    if v.get("fase") == "beban" and v["saat"] == "awal":
        z = next((w for w in VL if w.get("fase") == "beban" and w["saat"] == "akhir" and w.get("tahap") == v["tahap"]), None)
        if z: VTAHAP[v["tahap"]] = vllm_delta(v, z)
v_ber = [v for v in VL if v.get("fase") == "berurutan"]
if v_ber: VTAHAP["berurutan"] = vllm_delta(v_ber[0], v_ber[-1])

# per replika (server multi-GPU): selisih counter tiap port untuk tiap tahap
def replika_delta(a, b):
    pa, pb = a.get("per_replika") or {}, b.get("per_replika") or {}
    out = {}
    for port in sorted(pb):
        x, y = pa.get(port, {}), pb[port]
        d = vllm_delta(x, y) or {}
        out[port] = dict(permintaan=dlt(x, y, "request_success_total"), token_keluar=dlt(x, y, "generation_tokens_total"),
                         token_masuk=dlt(x, y, "prompt_tokens_total"), antre_ms=d.get("antre_ms"), decode_ms=d.get("decode_ms"),
                         prefill_ms=d.get("prefill_ms"), cache=d.get("cache"), preemption=dlt(x, y, "num_preemptions_total"))
    return out
VREP = {}
for v in VL:
    if v.get("fase") == "beban" and v["saat"] == "awal" and v.get("per_replika"):
        z = next((w for w in VL if w.get("fase") == "beban" and w["saat"] == "akhir" and w.get("tahap") == v["tahap"]), None)
        if z: VREP[str(v["tahap"])] = replika_delta(v, z)
if v_ber and v_ber[0].get("per_replika"): VREP["berurutan"] = replika_delta(v_ber[0], v_ber[-1])

# log statistik vLLM (opsional): KV cache, berjalan, menunggu per tahap
VLOG, VLOG_REP = {}, {}
if "--vllm-log" in sys.argv:
    # Satu berkas per replika, dipisah koma. Angka gabungan: KV & berjalan = maksimum per replika,
    # menunggu = jumlah semua replika, "penuh" = rata-rata porsi waktu tiap replika penuh (>= 4 berjalan).
    pola = re.compile(r"INFO (\d\d)-(\d\d) (\d\d:\d\d:\d\d).*?generation throughput: ([\d.]+).*?Running: (\d+).*?Waiting: (\d+).*?KV cache usage: ([\d.]+)%")
    berkas = sys.argv[sys.argv.index("--vllm-log") + 1].split(",")
    rows_per = {}
    for f in berkas:
        lbl = os.path.splitext(os.path.basename(f))[0].replace("vllm-stat-", "").replace("vllm-stat", "replika")
        rows_per[lbl] = []
        for l in open(f, encoding="utf-8"):
            m = pola.search(l)
            if m: rows_per[lbl].append(dict(t=datetime.fromisoformat(f"2026-{m[1]}-{m[2]}T{m[3]}+00:00").timestamp() * 1000, tok=float(m[4]), jalan=int(m[5]), antre=int(m[6]), kv=float(m[7])))
    rentang_fase = {}
    for e in FASE_EV:
        k = e.get("tahap") or e["fase"]
        rentang_fase.setdefault(k, {})[e["saat"]] = e["ts"]
    def statistik(x, dur):
        return dict(sampel=len(x), kv_maks=max(r_["kv"] for r_ in x), jalan_maks=max(r_["jalan"] for r_ in x), antre_maks=max(r_["antre"] for r_ in x),
                    antre_rata=sum(r_["antre"] for r_ in x) / max(1, dur / 10), penuh=min(100, 100 * sum(r_["jalan"] >= 4 for r_ in x) / max(1, dur / 10)),
                    tok_aktif=rata([r_["tok"] for r_ in x if r_["jalan"] > 0]))
    for k, v in rentang_fase.items():
        if "mulai" in v and "selesai" in v:
            dur = (v["selesai"] - v["mulai"]) / 1000
            per = {lbl: [r_ for r_ in rows if v["mulai"] <= r_["t"] <= v["selesai"] + 10000] for lbl, rows in rows_per.items()}
            per = {lbl: statistik(x, dur) for lbl, x in per.items() if x}
            if not per: continue
            VLOG_REP[str(k)] = per
            if len(per) == 1: VLOG[str(k)] = next(iter(per.values()))
            else:
                ps = list(per.values())
                VLOG[str(k)] = dict(sampel=sum(p["sampel"] for p in ps), kv_maks=max(p["kv_maks"] for p in ps), jalan_maks=max(p["jalan_maks"] for p in ps),
                                    antre_maks=max(p["antre_maks"] for p in ps), antre_rata=sum(p["antre_rata"] for p in ps),
                                    penuh=sum(p["penuh"] for p in ps) / len(rows_per), tok_aktif=sum(p["tok_aktif"] or 0 for p in ps), replika_aktif=len(ps))

# ---------- GPU per fase ----------
GFASE, GIDX = {}, {}
# Jam GPU = jam server; jam fase = jam laptop. Dikoreksi dengan selisih jam dari pencocokan LiteLLM
# kalau selisihnya > 3 dtk (20 Nov: 11 dtk). Di bawah itu lebih kecil dari pengaruh yang berarti, dan
# angka 17 Nov (selisih 1,6 dtk) tetap sama seperti yang sudah dilaporkan.
KOREKSI_JAM_GPU = geser if abs(geser) > 3000 else 0
rf = {}
for e in FASE_EV:
    rf.setdefault(str(e.get("tahap") or e["fase"]), {})[e["saat"]] = e["ts"]
for k, v in rf.items():
    if "mulai" in v and "selesai" in v:
        g = [x for x in GPU if v["mulai"] <= x["tGpu"] - KOREKSI_JAM_GPU <= v["selesai"]]
        # Multi-GPU: watt/util = rata-rata PER GPU; watt_total = jumlah rata-rata tiap GPU.
        if g: GFASE[k] = dict(watt=rata([x["dayaW"] for x in g]), watt_maks=max(x["dayaW"] for x in g), util=rata([x["gpu"] for x in g]),
                             suhu_maks=max(x["suhuC"] for x in g), vram=max(x["memoriMiB"] for x in g))
        idx = sorted({x.get("indeks") for x in g if x.get("indeks") is not None})
        if g and idx:
            GIDX.setdefault(k, {})
            for i in idx:
                gi = [x for x in g if x.get("indeks") == i]
                GIDX[k][str(i)] = dict(watt=rata([x["dayaW"] for x in gi]), watt_maks=max(x["dayaW"] for x in gi), util=rata([x["gpu"] for x in gi]),
                                       suhu_maks=max(x["suhuC"] for x in gi), vram=max(x["memoriMiB"] for x in gi))
            GFASE[k]["watt_total"] = sum(v_["watt"] for v_ in GIDX[k].values())
            GFASE[k]["n_gpu"] = len(idx)

# ---------- ringkasan ----------
KODE = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"]
JENIS = {b["kode"]: b["jenis"] for b in BARIS}
def ringkas(rs):
    if not rs: return None
    t = [b["total_ms"] / 1000 for b in rs]
    o = dict(n=len(rs), ok=sum(b["status"] == "ok" for b in rs), benar=sum(b["benar"] for b in rs), habis=sum(b["status"] == "waktu-habis" for b in rs),
             galat=sum(b["status"] == "galat" for b in rs), p50=p50(t), p95=p95(t), p99=kuantil(t, .99), rata=rata(t), min=min(t), max=max(t),
             llm=rata([b["n_llm"] for b in rs]), llm_min=min(b["n_llm"] for b in rs), llm_max=max(b["n_llm"] for b in rs),
             llm_galat=sum(b["n_llm_galat"] for b in rs), delegasi=rata([b["n_delegasi"] for b in rs]),
             masuk=rata([b["token_masuk"] for b in rs]), keluar=rata([b["token_keluar"] for b in rs]), pikir=rata([b["token_pikir"] for b in rs]),
             masuk_total=sum(b["token_masuk"] for b in rs), keluar_total=sum(b["token_keluar"] for b in rs),
             alat_s=rata([b["alat_ms"] / 1000 for b in rs]), transport_s=rata([b["transport_ms"] / 1000 for b in rs]),
             ttft_jawaban=p50([b["ttft_jawaban_ms"] / 1000 if b["ttft_jawaban_ms"] else None for b in rs]))
    for k in PRIOR: o[f"x_{k}"] = rata([(b[f"x_{k}"] or 0) / 1000 for b in rs])
    # alat: berhasil / dipanggil; kecepatan menulis per panggilan = token keluar / (lama di LiteLLM - TTFT LiteLLM)
    al = [x for b in rs for x in b["_spans"] if x["jenis"] == "alat"]
    o["alat_n"], o["alat_ok"] = len(al), sum(x["status"] == "ok" for x in al)
    ll = [x for b in rs for x in b["_spans"] if x["jenis"] == "llm" and x.get("lt_total") and x.get("token_keluar")]
    o["tps_panggilan"] = p50([x["token_keluar"] / max(1e-3, (x["lt_total"] - (x.get("lt_ttft") or 0)) / 1000) for x in ll])
    o["lt_ttft"] = p50([x.get("lt_ttft") for x in ll]); o["lt_ttft95"] = p95([x.get("lt_ttft") for x in ll])
    o["pikir_pasti"] = all(b.get("token_pikir_pasti") for b in rs)
    for k in ("antre_ms", "prefill_ms", "decode_ms"):
        v = [b.get(f"vllm_{k}") for b in rs if b.get(f"vllm_{k}") is not None]
        if v: o[f"vllm_{k}"] = rata(v)
    return o
GRUP = [("berurutan", None)] + [("beban", n) for n in INFO["tahap"]]
nama_grup = lambda f, n: "berurutan" if f == "berurutan" else f"beban-{n}"
p_teks = os.path.join(DIR, "intinya.json")   # teks "Intinya" ditulis setelah hasil dibaca (opsional)
R = dict(teks=json.load(open(p_teks, encoding="utf-8")) if os.path.exists(p_teks) else {}, info=INFO, stop=STOP, tiket_baru=SELESAI.get("tiket_baru"), grup={}, per_kode={}, peran={}, alat={}, vllm=VTAHAP, vllm_log=VLOG, gpu=GFASE,
         vllm_replika=VREP, vllm_log_replika=VLOG_REP, gpu_indeks=GIDX, replika={},
         kategori=PRIOR, nama_kategori=NAMA, jenis=JENIS)
for f, n in GRUP + [("pemanasan", None)]:
    rs = [b for b in BARIS if b["fase"] == f and (n is None or b["tahap"] == n)]
    g = nama_grup(f, n) if f != "pemanasan" else "pemanasan"
    R["grup"][g] = ringkas(rs)
    # pembagian panggilan model per replika (dari header LiteLLM di span, dan dari catatan LiteLLM)
    rp = defaultdict(lambda: dict(panggilan=0, token_keluar=0, token_masuk=0, lt=0))
    for b in rs:
        for s in b["_spans"]:
            if s["jenis"] != "llm": continue
            k = s.get("replika") or "(tidak tercatat)"
            rp[k]["panggilan"] += 1; rp[k]["token_keluar"] += s.get("token_keluar") or 0; rp[k]["token_masuk"] += s.get("token_masuk") or 0
            if s.get("replika_lt") and s.get("replika_lt") == s.get("replika"): rp[k]["lt"] += 1
    if any(k != "(tidak tercatat)" for k in rp): R["replika"][g] = dict(sorted(rp.items()))
    R["per_kode"][g] = {k: ringkas([b for b in rs if b["kode"] == k]) for k in KODE}
    pr = defaultdict(list)
    for b in rs:
        for s in b["_spans"]:
            if s["jenis"] == "llm": pr[s.get("peran", "?")].append(s)
    R["peran"][g] = {k: dict(n=len(v), dur=p50([s["durasi_ms"] for s in v]), ttft=p50([s.get("ttft_ms") for s in v]),
                             pikir=p50([(s["pikir_akhir_ms"] - s["pikir_awal_ms"]) if s.get("pikir_awal_ms") is not None else 0 for s in v]),
                             masuk=p50([s.get("token_masuk") for s in v]), keluar=p50([s.get("token_keluar") for s in v]),
                             porsi_pikir=rata([s.get("porsi_pikir", 0) for s in v]), lt_ttft=p50([s.get("lt_ttft") for s in v]),
                             transport=p50([s.get("transport_ms") for s in v])) for k, v in sorted(pr.items())}
    al = defaultdict(list)
    for b in rs:
        for s in b["_spans"]:
            if s["jenis"] in ("alat", "embedding", "db") and (s["jenis"] != "db" or any(p["jenis"] == "alat" and p["span"] == s.get("parent") for p in b["_spans"])):
                al[(s["jenis"], s["nama"] if s["jenis"] == "alat" else s["jenis"])].append(s["durasi_ms"])
    R["alat"][g] = {f"{j}|{nm}": dict(n=len(v), p50=p50(v), p95=p95(v), max=max(v)) for (j, nm), v in sorted(al.items())}
# Q4/Q5 per grup
R["q45"] = {}
for g in R["grup"]:
    rs = [b for b in BARIS if (nama_grup(b["fase"], b["tahap"]) if b["fase"] != "pemanasan" else "pemanasan") == g and b["kode"] in ("Q4", "Q5")]
    R["q45"][g] = [dict(kode=b["kode"], total=b["total_ms"] / 1000, status=b["status"], benar=b["benar"], alat=b["alat"], n_llm=b["n_llm"],
                        n_llm_galat=b["n_llm_galat"], delegasi=b["n_delegasi"], embedding_ms=sum(s["durasi_ms"] for s in b["_spans"] if s["jenis"] == "embedding"),
                        db_ms=b["x_db"], pemakai=b["pemakai"], urut=b["urut"], ulang=b["ulang"], trace=b["trace"][:8]) for b in rs]

# ---------- waterfall: Q1/Q4/Q5/Q8 berurutan (dekat median) + contoh 8 pengguna ----------
def wf(b):
    t0 = b["_t0"]; out = []
    byid = {s["span"]: s for s in b["_spans"]}
    def dalam(s):
        d, p = 0, byid.get(s.get("parent"))
        while p: d += 1; p = byid.get(p.get("parent"))
        return d
    for s in sorted(b["_spans"], key=lambda s: (s["mulai_mono"], -s["durasi_ms"])):
        if s["jenis"] == "permintaan": continue
        o = dict(jenis=s["jenis"], nama=s.get("peran") or s["nama"], a=(s["mulai_mono"] - t0) / 1000, d=s["durasi_ms"] / 1000, dalam=dalam(s), status=s["status"])
        if s["jenis"] == "llm":
            o.update(ttft=(s.get("ttft_ms") or 0) / 1000, masuk=s.get("token_masuk"), keluar=s.get("token_keluar"), lt_ttft=s.get("lt_ttft"),
                     seg=[[k, s[f"{kk}_awal_ms"] / 1000, s[f"{kk}_akhir_ms"] / 1000] for k, kk in (("berpikir", "pikir"), ("rencana", "rencana"), ("menulis", "teks")) if s.get(f"{kk}_awal_ms") is not None])
        out.append(o)
    return dict(trace=b["trace"][:8], kode=b["kode"], jenis=b["jenis"], fase=b["fase"], tahap=b["tahap"], pemakai=b["pemakai"], ulang=b["ulang"],
                total=b["total_ms"] / 1000, status=b["status"], benar=b["benar"], alat=b["alat"], n_llm=b["n_llm"], span=out,
                bag={k: (b[f"x_{k}"] or 0) / 1000 for k in PRIOR})
R["waterfall"] = [wf(b) for b in BARIS if b["fase"] in ("berurutan", "beban")]

# ---------- sanity check ----------
cek = []
def periksa(nama, ok, detail=""): cek.append(dict(cek=nama, lolos=bool(ok), detail=detail))
periksa("durasi span tidak negatif", all(s["durasi_ms"] >= 0 for s in SPAN), f"{sum(s['durasi_ms'] < 0 for s in SPAN)} negatif")
anak_lewat, anak_habis = 0, 0
for b in BARIS:
    byid = {s["span"]: s for s in b["_spans"]}
    for s in b["_spans"]:
        p = byid.get(s.get("parent"))
        if p and s["jenis"] != "llm" and s["mulai_mono"] + s["durasi_ms"] > p["mulai_mono"] + p["durasi_ms"] + 50:
            if b["status"] == "waktu-habis": anak_habis += 1
            else: anak_lewat += 1
periksa("span anak selesai sebelum induk (toleransi 50 ms; llm dikecualikan karena stream-nya bisa melewati induk)", anak_lewat == 0, f"{anak_lewat} span")
periksa("pertanyaan waktu habis: agent tetap bekerja setelah 300 dtk (dicatat, bukan galat ukur)", True,
        f"{anak_habis} span alat/delegasi selesai setelah pertanyaan dinyatakan habis")
periksa("setiap pertanyaan punya span permintaan", all(any(s["jenis"] == "permintaan" for s in b["_spans"]) for b in BARIS))
periksa("pecahan eksklusif = total (selisih < 1 ms)", all(abs(sum((b[f"x_{k}"] or 0) for k in PRIOR) - b["total_ms"]) < 1 for b in BARIS if b["x_lain"] is not None))
llm_tanpa = sum(1 for s in SPAN if s["jenis"] == "llm" and not s.get("trace"))
periksa("semua panggilan model punya trace", llm_tanpa == 0, f"{llm_tanpa} tanpa trace")
periksa("panggilan model cocok dengan LiteLLM", cocok == len(ok_llm), f"{cocok} dari {len(ok_llm)} panggilan sukses; LiteLLM {len(LT)} baris")
harap = {"berurutan": 8 * INFO["ulang"], **{f"beban-{n}": 3 * n for n in INFO["tahap"]}}
for g, h in harap.items():
    n = (R["grup"].get(g) or {}).get("n", 0)
    periksa(f"jumlah pertanyaan {g}", n == h, f"{n} dari {h}")
periksa("status pertanyaan konsisten dengan galat", all((b["status"] == "ok") == (not next(q for q in Q if q["trace"] == b["trace"])["galat"]) for b in BARIS))
periksa("tiket tidak bertambah", SELESAI.get("tiket_baru") == 0, f"tiket baru: {SELESAI.get('tiket_baru')}")
periksa("preemption tidak bertambah", all((v or {}).get("preemption", 0) == 0 for v in VTAHAP.values()))
R["cek"] = cek
# durasi tiap tahap (dinding) untuk throughput gabungan
R["fase_waktu"] = {}
for e in FASE_EV:
    if e["saat"] == "mulai":
        z = next((x for x in FASE_EV if x["saat"] == "selesai" and x["fase"] == e["fase"] and x.get("tahap") == e.get("tahap")), None)
        if z: R["fase_waktu"]["berurutan" if e["fase"] == "berurutan" else ("pemanasan" if e["fase"] == "pemanasan" else f"beban-{e['tahap']}")] = (z["ts"] - e["ts"]) / 1000
R["koreksi_jam_gpu_ms"] = KOREKSI_JAM_GPU
R["jumlah"] = dict(pertanyaan=len(Q), span=len(SPAN), llm=len(LLM), llm_ok=len(ok_llm), litellm=len(LT), cocok=cocok, geser_jam_ms=geser)
json.dump(cek, open(os.path.join(DIR, "cek.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---------- CSV ----------
kol = list(dict.fromkeys(k for b in BARIS for k in b if not k.startswith("_")))  # gabungan kolom semua baris
with open(os.path.join(DIR, "pertanyaan.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=kol); w.writeheader(); [w.writerow({k: v for k, v in b.items() if not k.startswith("_")}) for b in BARIS]
skol = ["trace", "span", "parent", "jenis", "nama", "status", "mulai", "durasi_ms", "header_ms", "potongan1_ms", "ttft_ms", "pikir_awal_ms", "pikir_akhir_ms", "pikir_n",
        "rencana_awal_ms", "rencana_akhir_ms", "rencana_n", "teks_awal_ms", "teks_akhir_ms", "teks_n", "finish", "alat_dipilih", "pesan", "lanjutan", "alat_tersedia", "n_teks", "galat", "tahap", "http"]
with open(os.path.join(DIR, "span.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=skol, extrasaction="ignore"); w.writeheader()
    for s in SPAN: w.writerow({**s, "alat_dipilih": "|".join(s.get("alat_dipilih") or [])})
pkol = ["trace", "fase", "tahap", "kode", "span", "nama", "peran", "status", "mulai", "durasi_ms", "ttft_ms", "lt_ttft", "lt_total", "transport_ms", "token_masuk", "token_keluar", "porsi_pikir", "finish"]
with open(os.path.join(DIR, "panggilan.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=pkol, extrasaction="ignore"); w.writeheader()
    for s in LLM: w.writerow(s)
json.dump(R, open(os.path.join(DIR, "ringkasan.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)

# ---------- dashboard ----------
tpl_lama = open(os.path.join(AKAR, "scripts", "dashboard-template.html"), encoding="utf-8").read()
css = tpl_lama[tpl_lama.index("<style>") + 7:tpl_lama.index("</style>")]
helper = tpl_lama[tpl_lama.index("/* ---------- format ---------- */"):tpl_lama.index("/* =================================================================== OVERVIEW */")]
tpl = open(os.path.join(AKAR, "scripts", "dashboard-alur-template.html"), encoding="utf-8").read()
DATA = dict(dibuat=datetime.now().strftime("%Y-%m-%d %H:%M"), folder=os.path.relpath(DIR, AKAR).replace("\\", "/"), r=R,
            baris=[{k: v for k, v in b.items() if not k.startswith("_")} for b in BARIS])
out = (tpl.replace("/*__CSS__*/", css).replace("/*__HELPER__*/", helper)
       .replace("/*__DATA__*/null", json.dumps(DATA, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")))
# --tanpa-dashboard: hanya data (dipakai untuk uji 4 GPU, supaya dashboard 17 Nov tidak tertimpa)
if "--tanpa-dashboard" not in sys.argv:
    p_out = os.path.join(AKAR, "docs", "benchmark", "grafik", "grafik-agent-workflow-latency.html")
    open(p_out, "w", encoding="utf-8").write(out)
print(json.dumps(dict(jumlah=R["jumlah"], cek_gagal=[c for c in cek if not c["lolos"]], dashboard=f"{len(out) // 1024} KB"), ensure_ascii=False, default=str))
