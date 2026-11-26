"""Olah hasil profil-agent.mts: CSV, ringkasan JSON, dan tab "Alur agent" di halaman grafik uji beban.

    python scripts/olah-profil-agent.py data/profil-agent-<ts>.jsonl data/litellm-waktu-qwen3-14b-<...>.csv

Keluaran:
  data/<nama>-pertanyaan.csv     satu baris per pertanyaan (pecahan waktu)
  data/<nama>-panggilan.csv      satu baris per panggilan model (+ token dari LiteLLM)
  data/<nama>-alat.csv           satu baris per pemanggilan alat
  data/<nama>-ringkasan.json
  docs/benchmark/grafik/hasil-pengujian.html   tab "Alur agent" disisipkan / diganti

Pecahan waktu satu pertanyaan (berurutan di jalur kritis, karena langkah agent berjalan satu per satu):
  persiapan   siapkanAgent: baca hak akses + setelan agent, rakit agent
  tunggu      panggilan model dikirim -> potongan pertama (jaringan + gateway + antre + olah prompt)
  berpikir    model menulis bagian reasoning
  rencana     model menulis rencana pemanggilan alat (nama + argumen)
  menulis     model menulis teks
  alat        alat berjalan (query database, pencarian SOP, penyusun rancangan)
  lain        sisa: kerangka agent, perpindahan antar agent, jeda antar langkah
"""
import csv, html, json, os, statistics as st, sys
from datetime import datetime, timezone

SUMBER, LITELLM = sys.argv[1], sys.argv[2]
AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASAR = os.path.splitext(SUMBER)[0]
B = [json.loads(l) for l in open(SUMBER, encoding="utf-8") if l.strip()]
Q = [x for x in B if x["t"] == "q"]
LLM = [x for x in B if x["t"] == "llm"]
ALAT = [x for x in B if x["t"] == "alat"]
VL = [x for x in B if x["t"] == "vllm"]
GPU = [x for x in B if x["t"] == "gpu"]
SELESAI = next((x for x in B if x["t"] == "selesai"), {})

def kuantil(a, q):
    a = sorted(x for x in a if x is not None)
    if not a: return None
    return a[min(len(a) - 1, max(0, -(-int(q * len(a) * 1000) // 1000) - 1))]
p50 = lambda a: kuantil(a, .5)
p95 = lambda a: kuantil(a, .95)
rata = lambda a: (st.mean(a) if a else None)

# ---------- cocokkan panggilan dengan catatan LiteLLM ----------
LT = []
for r in csv.DictReader(open(LITELLM, encoding="utf-8")):
    if not r.get("mulai"): continue
    t = datetime.fromisoformat(r["mulai"].replace(" ", "T")).replace(tzinfo=timezone.utc).timestamp() * 1000
    LT.append(dict(t=t, ttft=float(r["ttft"]) * 1000, total=float(r["total"]) * 1000, masuk=int(r["prompt_tokens"]),
                   keluar=int(r["completion_tokens"]), status=r["status"], pakai=False))
LT.sort(key=lambda x: x["t"])
LLM.sort(key=lambda x: x["mulai"])
# selisih jam laptop -> LiteLLM, diperkirakan dari pasangan urutan yang sama (median)
geser = st.median(l["t"] - c["mulai"] for c, l in zip(LLM, LT)) if len(LLM) == len(LT) else 0
cocok = 0
for c in LLM:
    calon = [l for l in LT if not l["pakai"] and abs(l["t"] - c["mulai"] - geser) < 1500]
    if calon:
        l = min(calon, key=lambda l: abs(l["t"] - c["mulai"] - geser)); l["pakai"] = True; cocok += 1
        c.update(srvTtft=l["ttft"], srvTotal=l["total"], tokenMasuk=l["masuk"], tokenKeluar=l["keluar"])
for c in LLM:
    c["jaringan"] = (c["selesai"] - c["srvTotal"]) if c.get("srvTotal") is not None else None
    n = sum(c.get(k, 0) or 0 for k in ("pikirN", "teksN", "rencanaN"))
    c["porsiPikir"] = (c.get("pikirN", 0) or 0) / n if n else 0

# ---------- susun per pertanyaan ----------
per_trace = {}
for c in LLM: per_trace.setdefault(c["trace"], {"llm": [], "alat": []})["llm"].append(c)
for a in ALAT: per_trace.setdefault(a["trace"], {"llm": [], "alat": []})["alat"].append(a)

def interval_alat(ev):
    """mulai -> 'selesai' terakhir sebelum 'mulai' berikutnya dengan nama sama (catatan selesai bisa dobel)."""
    ev = sorted(ev, key=lambda e: e["ts"]); hasil = []
    for i, e in enumerate(ev):
        if e["tahap"] != "mulai": continue
        nxt = next((x["ts"] for x in ev[i + 1:] if x["alat"] == e["alat"] and x["tahap"] == "mulai"), float("inf"))
        akhir = [x["ts"] for x in ev if x["alat"] == e["alat"] and x["tahap"] == "selesai" and e["ts"] <= x["ts"] < nxt]
        if akhir: hasil.append(dict(alat=e["alat"], a=e["ts"], b=max(akhir)))
    return hasil

def gabung(iv):
    iv = sorted(iv); out = []
    for a, b in iv:
        if out and a <= out[-1][1]: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return out
panjang = lambda iv: sum(b - a for a, b in iv)
def kurangi(iv, lawan):
    """Bagian dari iv yang tidak tertutup lawan."""
    hasil = []
    for a, b in iv:
        potong = [(a, b)]
        for c, d in lawan:
            baru = []
            for x, y in potong:
                if d <= x or c >= y: baru.append((x, y))
                else:
                    if x < c: baru.append((x, c))
                    if d < y: baru.append((d, y))
            potong = baru
        hasil += potong
    return hasil

def peran(c, semua):
    """Label dari apa yang BENAR-BENAR dihasilkan panggilan itu: rencana alat atau teks."""
    sub = [x for x in semua if x["agent"] == c["agent"]]
    pertama = c is sorted(sub, key=lambda x: x["mulai"])[0]
    rencana = bool(c.get("rencanaN"))
    if c["agent"] == "Ratu AI Umum":
        if pertama and not c["lanjutan"]: return "Perute: memilih agent" if rencana else "Perute: menjawab langsung"
        return "Perute: menyerahkan lagi" if rencana else "Perute: jawaban akhir"
    nama = c["agent"].replace("Ratu AI ", "")
    if not c["lanjutan"]: return f"{nama}: memilih alat" if rencana else f"{nama}: menjawab langsung"
    return f"{nama}: memilih alat lagi" if rencana else f"{nama}: menyusun hasil"

BARIS_Q = []
for q in Q:
    d = per_trace.get(q["trace"], {"llm": [], "alat": []})
    llm = sorted(d["llm"], key=lambda c: c["mulai"]); al = interval_alat(d["alat"])
    t0 = q["mulai"]
    for c in llm: c["peran"] = peran(c, llm); c["kode"] = q["kode"]; c["fase"] = q["fase"]
    seg = {"tunggu": [], "berpikir": [], "rencana": [], "menulis": []}
    for c in llm:
        a = c["mulai"]; f = c["ttft"] if c.get("ttft") is not None else c["selesai"]
        seg["tunggu"].append((a, a + f))
        if c.get("pikirAwal") is not None: seg["berpikir"].append((a + c["pikirAwal"], a + c["pikirAkhir"]))
        if c.get("rencanaAwal") is not None: seg["rencana"].append((a + c["rencanaAwal"], a + c["rencanaAkhir"]))
        if c.get("teksAwal") is not None: seg["menulis"].append((a + c["teksAwal"], a + c["teksAkhir"]))
    llm_iv = gabung([(c["mulai"], c["mulai"] + c["selesai"]) for c in llm])
    alat_iv = gabung([(x["a"], x["b"]) for x in al])
    alat_saja = kurangi(alat_iv, llm_iv)
    siap = (t0, t0 + q["siap"])
    bagian = {k: panjang(gabung(v)) for k, v in seg.items()}
    model = panjang(llm_iv)
    # sisa waktu di dalam panggilan model yang bukan tunggu/berpikir/rencana/menulis (jeda antar potongan, ekor stream)
    bagian["ekor"] = max(0, model - sum(bagian.values()))
    bagian["alat"] = panjang(alat_saja)
    bagian["persiapan"] = q["siap"]
    bagian["lain"] = max(0, q["total"] - model - bagian["alat"] - q["siap"])
    vl = None
    if q["fase"] == "berurutan":
        a = next((v for v in VL if v["saat"] == "awal" and v.get("ulang") == q["ulang"] and v.get("kode") == q["kode"]), None)
        b = next((v for v in VL if v["saat"] == "akhir" and v.get("ulang") == q["ulang"] and v.get("kode") == q["kode"]), None)
        if a and b:
            dlt = lambda k: (b.get(k, 0) - a.get(k, 0))
            vl = dict(n=dlt("request_queue_time_seconds_count"), antre=dlt("request_queue_time_seconds_sum") * 1000,
                      prefill=dlt("request_prefill_time_seconds_sum") * 1000, decode=dlt("request_decode_time_seconds_sum") * 1000,
                      cache=(dlt("prefix_cache_hits_total") / dlt("prefix_cache_queries_total")) if dlt("prefix_cache_queries_total") else None)
    tm = [c.get("tokenMasuk") for c in llm]; tk = [c.get("tokenKeluar") for c in llm]
    BARIS_Q.append(dict(trace=q["trace"], fase=q["fase"], pemakai=q["pemakai"], ulang=q["ulang"], kode=q["kode"], jenis=q["jenis"],
                        mulai=t0, total=q["total"], ttft_jawaban=q["ttft"], status=q["status"], benar=q["benar"], alat="|".join(q["alat"]),
                        rancangan=q["rancangan"], n_llm=len(llm), n_alat=len(al), token_masuk=sum(x or 0 for x in tm),
                        token_keluar=sum(x or 0 for x in tk), token_pikir=round(sum((c.get("tokenKeluar") or 0) * c["porsiPikir"] for c in llm)),
                        model=model, jaringan=sum(c.get("jaringan") or 0 for c in llm),
                        srv_ttft=sum(c.get("srvTtft") or 0 for c in llm), **{f"t_{k}": v for k, v in bagian.items()},
                        **({f"vllm_{k}": v for k, v in vl.items()} if vl else {}),
                        _llm=llm, _alat=al))

# ---------- CSV ----------
kol_q = [k for k in BARIS_Q[0] if not k.startswith("_")]
with open(DASAR + "-pertanyaan.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=sorted({k for r in BARIS_Q for k in r if not k.startswith("_")}, key=lambda k: (k not in kol_q, kol_q.index(k) if k in kol_q else 0, k)))
    w.writeheader(); [w.writerow({k: v for k, v in r.items() if not k.startswith("_")}) for r in BARIS_Q]
kol_c = ["trace", "fase", "kode", "id", "agent", "peran", "lanjutan", "pesan", "nAlatTersedia", "karakterPrompt", "mulai", "header", "byte1", "ttft",
         "pikirAwal", "pikirAkhir", "pikirN", "rencanaAwal", "rencanaAkhir", "rencanaN", "teksAwal", "teksAkhir", "teksN", "selesai", "finish",
         "alatDipilih", "srvTtft", "srvTotal", "jaringan", "tokenMasuk", "tokenKeluar", "porsiPikir"]
with open(DASAR + "-panggilan.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=kol_c, extrasaction="ignore"); w.writeheader()
    for c in LLM: w.writerow({**c, "alatDipilih": "|".join(c.get("alatDipilih") or [])})
with open(DASAR + "-alat.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["trace", "fase", "kode", "alat", "mulai", "ms"])
    for r in BARIS_Q:
        for a in r["_alat"]: w.writerow([r["trace"], r["fase"], r["kode"], a["alat"], a["a"], a["b"] - a["a"]])

# ---------- ringkasan ----------
KODE = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"]
JENIS = {r["kode"]: r["jenis"] for r in BARIS_Q}
BAG = ["persiapan", "tunggu", "berpikir", "rencana", "menulis", "ekor", "alat", "lain"]
def ringkas(rs):
    if not rs: return None
    o = dict(n=len(rs), benar=sum(r["benar"] for r in rs), total50=p50([r["total"] for r in rs]), total95=p95([r["total"] for r in rs]),
             total_min=min(r["total"] for r in rs), total_maks=max(r["total"] for r in rs),
             llm=rata([r["n_llm"] for r in rs]), llm_min=min(r["n_llm"] for r in rs), llm_maks=max(r["n_llm"] for r in rs),
             alat=rata([r["n_alat"] for r in rs]), masuk=rata([r["token_masuk"] for r in rs]), keluar=rata([r["token_keluar"] for r in rs]),
             pikir=rata([r["token_pikir"] for r in rs]), model=rata([r["model"] for r in rs]), jaringan=rata([r["jaringan"] for r in rs]),
             ttft_jawaban=p50([r["ttft_jawaban"] for r in rs]))
    for k in BAG: o[k] = rata([r[f"t_{k}"] for r in rs])
    if all("vllm_antre" in r for r in rs):
        for k in ("antre", "prefill", "decode"): o[f"vllm_{k}"] = rata([r[f"vllm_{k}"] for r in rs])
        o["vllm_cache"] = rata([r["vllm_cache"] for r in rs if r.get("vllm_cache") is not None])
    return o
RING = {"per_kode": {}, "semua": {}}
for fase in ("berurutan", "paralel"):
    rs = [r for r in BARIS_Q if r["fase"] == fase]
    RING["semua"][fase] = ringkas(rs)
    RING["per_kode"][fase] = {k: ringkas([r for r in rs if r["kode"] == k]) for k in KODE}
PERAN = {}
for c in LLM:
    p = c.get("peran");
    if not p: continue
    PERAN.setdefault((c["fase"], p), []).append(c)
RING["per_peran"] = {f"{f}|{p}": dict(n=len(v), total50=p50([c["selesai"] for c in v]), ttft50=p50([c.get("ttft") for c in v]),
                                       pikir50=p50([(c.get("pikirAkhir") or 0) - (c.get("pikirAwal") or 0) if c.get("pikirAwal") is not None else 0 for c in v]),
                                       masuk50=p50([c.get("tokenMasuk") for c in v]), keluar50=p50([c.get("tokenKeluar") for c in v]),
                                       porsiPikir=rata([c["porsiPikir"] for c in v]), srvTtft50=p50([c.get("srvTtft") for c in v]))
                     for (f, p), v in sorted(PERAN.items())}
ALAT_R = {}
for r in BARIS_Q:
    for a in r["_alat"]: ALAT_R.setdefault((r["fase"], a["alat"]), []).append(a["b"] - a["a"])
RING["per_alat"] = {f"{f}|{a}": dict(n=len(v), ms50=p50(v), ms95=p95(v), maks=max(v)) for (f, a), v in sorted(ALAT_R.items())}
JALUR = {}
for r in BARIS_Q:
    if r["kode"] in ("Q4", "Q5"): JALUR.setdefault((r["kode"], r["alat"] or "(tanpa alat)"), []).append(r)
RING["jalur_q4q5"] = {f"{k}|{a}": dict(n=len(v), benar=sum(x["benar"] for x in v), total50=p50([x["total"] for x in v]),
                                        llm=rata([x["n_llm"] for x in v]), fase=sorted({x["fase"] for x in v})) for (k, a), v in sorted(JALUR.items())}
vp = [v for v in VL if v["fase"] == "paralel"]
if len(vp) == 2:
    a, b = vp; dlt = lambda k: b.get(k, 0) - a.get(k, 0); n = dlt("request_queue_time_seconds_count")
    RING["vllm_paralel"] = dict(n=n, antre=dlt("request_queue_time_seconds_sum") / n * 1000, prefill=dlt("request_prefill_time_seconds_sum") / n * 1000,
                                decode=dlt("request_decode_time_seconds_sum") / n * 1000)
RING["vllm_berurutan"] = dict(antre=rata([r["vllm_antre"] / r["vllm_n"] for r in BARIS_Q if r.get("vllm_n")]),
                              prefill=rata([r["vllm_prefill"] / r["vllm_n"] for r in BARIS_Q if r.get("vllm_n")]),
                              decode=rata([r["vllm_decode"] / r["vllm_n"] for r in BARIS_Q if r.get("vllm_n")]),
                              n_sesuai=sum(1 for r in BARIS_Q if r.get("vllm_n") == r["n_llm"]), n=sum(1 for r in BARIS_Q if r["fase"] == "berurutan"))
RING["jumlah"] = dict(pertanyaan=len(Q), panggilan=len(LLM), cocok_litellm=cocok, litellm=len(LT), alat=sum(r["n_alat"] for r in BARIS_Q),
                      tanpa_trace=sum(1 for c in LLM if not c.get("trace")), tiket_baru=SELESAI.get("tiketBaru"),
                      preemption=(SELESAI.get("vllmAkhir", {}).get("num_preemptions_total", 0) - (VL[0].get("num_preemptions_total", 0) if VL else 0)),
                      geser_jam_ms=geser)
RING["gpu"] = dict(watt=rata([g["dayaW"] for g in GPU if g["gpu"] > 0]), suhu_maks=max([g["suhuC"] for g in GPU], default=None))
json.dump(RING, open(DASAR + "-ringkasan.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)

# ---------- halaman ----------
f1 = lambda x: "—" if x is None else f"{x:.1f}".replace(".", ",")
f0 = lambda x: "—" if x is None else f"{x:,.0f}".replace(",", ".")
d1 = lambda ms: "—" if ms is None else f1(ms / 1000)
WARNA = dict(persiapan="--a5", tunggu="--target", berpikir="--s2", rencana="--s3", menulis="--s1", ekor="--grid", alat="--s4", lain="--ink3")
NAMA = dict(persiapan="Persiapan agent", tunggu="Menunggu kata pertama", berpikir="Model berpikir", rencana="Model merencanakan alat",
            menulis="Model menulis teks", ekor="Model, lain-lain", alat="Alat berjalan", lain="Kerangka agent & jeda")
TEKS = {}
p_teks = os.path.join(AKAR, "data", "profil-agent-intinya.json")
if os.path.exists(p_teks): TEKS = json.load(open(p_teks, encoding="utf-8"))

def legenda(keys):
    return '<div class="leg">' + "".join(f'<span><i style="background:var({WARNA[k]})"></i>{NAMA[k]}</span>' for k in keys) + "</div>"

def tumpuk(baris, judul_x):
    """baris: list (label, {bagian: ms}). Batang mendatar bertumpuk."""
    W, L, R, T, tinggi = 640, 150, 50, 10, 26
    H = T + tinggi * len(baris) + 40
    top = max(sum(v.values()) for _, v in baris) * 1.05
    lng = next(s for s in (5, 10, 15, 20, 30, 60, 120) if top / 1000 / s <= 6) * 1000
    top = lng * -(-top // lng)
    xp = lambda ms: L + (W - L - R) * ms / top
    o = []
    v = 0
    while v <= top:
        o.append(f'<line x1="{xp(v):.1f}" x2="{xp(v):.1f}" y1="{T}" y2="{H - 34}" class="grid"/><text x="{xp(v):.1f}" y="{H - 20}" class="ax" text-anchor="middle">{f0(v / 1000)}</text>')
        v += lng
    for i, (lab, bag) in enumerate(baris):
        y = T + i * tinggi + 4; x = 0
        o.append(f'<text x="{L - 8}" y="{y + 13}" class="ax" text-anchor="end">{html.escape(lab)}</text>')
        for k in BAG:
            ms = bag.get(k) or 0
            if ms <= 0: continue
            o.append(f'<rect x="{xp(x):.1f}" y="{y}" width="{max(.5, xp(x + ms) - xp(x) - 1):.1f}" height="{tinggi - 8}" rx="2" fill="var({WARNA[k]})"><title>{lab} · {NAMA[k]}: {d1(ms)} dtk</title></rect>')
            x += ms
        o.append(f'<text x="{xp(x) + 6:.1f}" y="{y + 13}" class="lbl">{d1(x)}</text>')
    o.append(f'<text x="{(L + W - R) / 2:.1f}" y="{H - 4}" class="ax" text-anchor="middle">{html.escape(judul_x)}</text>')
    return f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(judul_x)}">{"".join(o)}</svg>'

def waterfall(r):
    """Satu pertanyaan: satu baris per langkah, sumbu = detik sejak pertanyaan dikirim."""
    t0 = r["mulai"]; langkah = [("Persiapan agent", [("persiapan", t0, t0 + r["t_persiapan"])])]
    ev = [("llm", c["mulai"], c) for c in r["_llm"]] + [("alat", a["a"], a) for a in r["_alat"]]
    for jenis, _, x in sorted(ev, key=lambda e: e[1]):
        if jenis == "alat":
            langkah.append((f"Alat {x['alat']}", [("alat", x["a"], x["b"])])); continue
        c = x; a = c["mulai"]; s = []
        f = c["ttft"] if c.get("ttft") is not None else c["selesai"]
        s.append(("tunggu", a, a + f))
        for k, kk in (("berpikir", "pikir"), ("rencana", "rencana"), ("menulis", "teks")):
            if c.get(f"{kk}Awal") is not None: s.append((k, a + c[f"{kk}Awal"], a + c[f"{kk}Akhir"]))
        tok = f" · {f0(c.get('tokenMasuk'))}→{f0(c.get('tokenKeluar'))} tok" if c.get("tokenMasuk") else ""
        langkah.append((f"{c['peran']}{tok}", s))
    W, L, R, T, tinggi = 640, 250, 40, 8, 22
    H = T + tinggi * len(langkah) + 38
    top = max(r["total"], max(b for _, s in langkah for _, _, b in s) - t0) * 1.02
    lng = next(s for s in (5, 10, 15, 20, 30, 60) if top / 1000 / s <= 7) * 1000
    xp = lambda t: L + (W - L - R) * (t - t0) / top
    o = []
    v = 0
    while v <= top:
        o.append(f'<line x1="{xp(t0 + v):.1f}" x2="{xp(t0 + v):.1f}" y1="{T}" y2="{H - 32}" class="grid"/><text x="{xp(t0 + v):.1f}" y="{H - 18}" class="ax" text-anchor="middle">{f0(v / 1000)}</text>')
        v += lng
    o.append(f'<line x1="{xp(t0 + r["total"]):.1f}" x2="{xp(t0 + r["total"]):.1f}" y1="{T}" y2="{H - 32}" stroke="var(--ink2)" stroke-dasharray="3 3"/>')
    for i, (lab, s) in enumerate(langkah):
        y = T + i * tinggi + 3
        o.append(f'<text x="{L - 8}" y="{y + 11}" class="ax" text-anchor="end">{html.escape(lab)}</text>')
        for k, a, b in s:
            o.append(f'<rect x="{xp(a):.1f}" y="{y}" width="{max(1.5, xp(b) - xp(a)):.1f}" height="{tinggi - 8}" rx="2" fill="var({WARNA[k]})"><title>{html.escape(lab)} · {NAMA[k]}: {d1(b - a)} dtk</title></rect>')
    o.append(f'<text x="{(L + W - R) / 2:.1f}" y="{H - 3}" class="ax" text-anchor="middle">detik sejak pertanyaan dikirim (garis putus = jawaban selesai, {d1(r["total"])} dtk)</text>')
    return f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="waterfall {r["kode"]}">{"".join(o)}</svg>'

def tabel(kepala, isi):
    return ('<div class="tabel-lebar"><table><thead><tr>' + "".join(f"<th>{html.escape(str(k))}</th>" for k in kepala) + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in b) + "</tr>" for b in isi) + "</tbody></table></div>")
def kartu(id_, judul, ket, isi, tbl="", intinya=""):
    return (f'<section class="kartu" id="{id_}"><h3>{judul}</h3><p class="ket">{ket}</p>{isi}'
            + (f'<p class="intinya"><b>Intinya:</b> {intinya}</p>' if intinya else "")
            + (f"<details><summary>Lihat angkanya</summary>{tbl}</details>" if tbl else "") + "</section>")
kpi = lambda l, v, k: f'<div class="kpi"><div class="kpi-l">{l}</div><div class="kpi-v">{v}</div><div class="kpi-k">{k}</div></div>'

S, P = RING["semua"]["berurutan"], RING["semua"]["paralel"]
mod_s = sum(S[k] for k in ("tunggu", "berpikir", "rencana", "menulis", "ekor"))
KPI = ('<div class="kpis">'
       + kpi("Waktu tengah per pertanyaan", f"{d1(S['total50'])} → {d1(P['total50'])} dtk", "1 pengguna → 5 pengguna bersamaan")
       + kpi("Panggilan model per pertanyaan", f"{f1(S['llm'])}", f"rata-rata, rentang {S['llm_min']}–{S['llm_maks']}")
       + kpi("Porsi waktu di model", f"{f0(100 * mod_s / (S['total50'] and rata([r['total'] for r in BARIS_Q if r['fase'] == 'berurutan'])))}%", "1 pengguna, termasuk tunggu & berpikir")
       + kpi("Porsi waktu model berpikir", f"{f0(100 * S['berpikir'] / rata([r['total'] for r in BARIS_Q if r['fase'] == 'berurutan']))}%", "dari total waktu, 1 pengguna")
       + kpi("Porsi waktu alat", f"{f0(100 * S['alat'] / rata([r['total'] for r in BARIS_Q if r['fase'] == 'berurutan']))}%", "query, SOP, rancangan tiket")
       + kpi("Hasil", f"{S['benar'] + P['benar']} dari {S['n'] + P['n']} benar", f"{RING['jumlah']['panggilan']} panggilan model, 0 tiket tersimpan")
       + "</div>")

# komposisi per pertanyaan
k_komp = kartu("alur-komposisi", "Ke mana waktu satu pertanyaan habis (1 pengguna)",
               "Rata-rata 5 kali per pertanyaan, dijalankan satu per satu. Setiap warna = satu jenis pekerjaan; panjang batang = total waktu.",
               legenda(BAG) + tumpuk([(f"{k} {JENIS[k]}", {b: RING['per_kode']['berurutan'][k][b] for b in BAG}) for k in KODE], "detik"),
               tabel(["Pertanyaan", "Total P50", "Rentang", "Panggilan model", "Persiapan", "Tunggu", "Berpikir", "Rencana", "Menulis", "Alat", "Lain", "Token masuk", "Token keluar", "≈ token berpikir"],
                     [(f"{k} {JENIS[k]}", d1(v["total50"]), f"{d1(v['total_min'])}–{d1(v['total_maks'])}", f"{f1(v['llm'])} ({v['llm_min']}–{v['llm_maks']})",
                       d1(v["persiapan"]), d1(v["tunggu"]), d1(v["berpikir"]), d1(v["rencana"]), d1(v["menulis"] + v["ekor"]), d1(v["alat"]), d1(v["lain"]),
                       f0(v["masuk"]), f0(v["keluar"]), f0(v["pikir"])) for k in KODE for v in [RING["per_kode"]["berurutan"][k]]]),
               TEKS.get("komposisi", ""))
k_par = kartu("alur-paralel", "1 pengguna vs 5 pengguna bersamaan",
              "Rata-rata (bukan waktu tengah), jadi satu pertanyaan yang sangat lama ikut menarik angkanya. Baris Q4 dan Q5 dipisah 1 pengguna dan 5 bersamaan.",
              legenda(BAG) + tumpuk([("1 pengguna", {b: S[b] for b in BAG}), ("5 bersamaan", {b: P[b] for b in BAG})]
                                    + [(f"{k} · {'1 pengguna' if f == 'berurutan' else '5 bersamaan'}", {b: RING['per_kode'][f][k][b] for b in BAG}) for k in ("Q4", "Q5") for f in ("berurutan", "paralel")], "detik"),
              tabel(["Fase", "Total P50", "Total P95", "Tunggu", "Berpikir", "Menulis", "Alat", "Antre vLLM per panggilan", "Prefill per panggilan", "Decode per panggilan"],
                    [("1 pengguna", d1(S["total50"]), d1(S["total95"]), d1(S["tunggu"]), d1(S["berpikir"]), d1(S["menulis"]), d1(S["alat"]),
                      f'{f0(RING["vllm_berurutan"]["antre"])} ms', f'{f0(RING["vllm_berurutan"]["prefill"])} ms', f'{d1(RING["vllm_berurutan"]["decode"])} dtk'),
                     ("5 bersamaan", d1(P["total50"]), d1(P["total95"]), d1(P["tunggu"]), d1(P["berpikir"]), d1(P["menulis"]), d1(P["alat"]),
                      f'{f0(RING.get("vllm_paralel", {}).get("antre"))} ms', f'{f0(RING.get("vllm_paralel", {}).get("prefill"))} ms', f'{d1(RING.get("vllm_paralel", {}).get("decode"))} dtk')]),
              TEKS.get("paralel", ""))
# waterfall: pertanyaan dengan total paling dekat median, fase berurutan
def wakil(kode, fase="berurutan"):
    rs = [r for r in BARIS_Q if r["kode"] == kode and r["fase"] == fase]
    m = p50([r["total"] for r in rs]); return min(rs, key=lambda r: abs(r["total"] - m))
wf = "".join(f'<h4>{k} {JENIS[k]} — {d1(wakil(k)["total"])} dtk (putaran {wakil(k)["ulang"]}, mendekati waktu tengah)</h4>{waterfall(wakil(k))}' for k in KODE)
k_wf = kartu("alur-waterfall", "Waterfall: langkah demi langkah satu pertanyaan (1 pengguna)",
             "Satu baris = satu langkah, urut waktu. Yang ditampilkan adalah ulangan dengan total paling dekat waktu tengah. Arahkan kursor ke batang untuk melihat detiknya.",
             legenda(["persiapan", "tunggu", "berpikir", "rencana", "menulis", "alat"]) + wf, "", TEKS.get("waterfall", ""))
pp = RING["per_peran"]
k_peran = kartu("alur-peran", "Setiap jenis panggilan model",
                "Waktu tengah per jenis panggilan, 1 pengguna. Token dari catatan gerbang model (LiteLLM).", "",
                tabel(["Jenis panggilan", "Jumlah", "Lama P50", "Kata pertama P50", "Berpikir P50", "Token masuk P50", "Token keluar P50", "≈ porsi berpikir"],
                      [(k.split("|", 1)[1], v["n"], f'{d1(v["total50"])} dtk', f'{f1(v["ttft50"] / 1000 if v["ttft50"] else None)} dtk', f'{d1(v["pikir50"])} dtk',
                        f0(v["masuk50"]), f0(v["keluar50"]), f'{f0(100 * v["porsiPikir"])}%') for k, v in pp.items() if k.startswith("berurutan|")]),
                TEKS.get("peran", ""))
pa = RING["per_alat"]
k_alat = kartu("alur-alat", "Lama setiap alat", "Dari alat dipanggil sampai hasilnya kembali ke agent.", "",
               tabel(["Alat", "Fase", "Dipanggil", "P50", "P95", "Paling lama"],
                     [(k.split("|")[1], k.split("|")[0], v["n"], f'{d1(v["ms50"])} dtk', f'{d1(v["ms95"])} dtk', f'{d1(v["maks"])} dtk') for k, v in pa.items()]),
               TEKS.get("alat", ""))
jq = RING["jalur_q4q5"]
k_q45 = kartu("alur-q4q5", "Q4 SOP dan Q5 rancangan tiket: jalur yang ditempuh",
              "Alat yang dipakai berbeda-beda untuk pertanyaan yang sama. Semua fase digabung.",
              f'<h4>Q5 — {d1(wakil("Q5")["total"])} dtk</h4>' + waterfall(wakil("Q5"))
              + (lambda r: f'<h4>Q5, 5 pengguna bersamaan, paling lama — {d1(r["total"])} dtk</h4>' + waterfall(r))(max([r for r in BARIS_Q if r["kode"] == "Q5" and r["fase"] == "paralel"], key=lambda r: r["total"])),
              tabel(["Pertanyaan", "Alat yang dipakai", "Kali", "Benar", "Total P50", "Panggilan model rata-rata", "Fase"],
                    [(k.split("|", 1)[0], k.split("|", 1)[1].replace("|", ", "), v["n"], v["benar"], f'{d1(v["total50"])} dtk', f1(v["llm"]), ", ".join(v["fase"])) for k, v in jq.items()]),
              TEKS.get("q4q5", ""))

CSS = """#alur .kartu{background:var(--surface);border:1px solid var(--garis);border-radius:12px;padding:18px;margin:14px 0}
#alur{--a5:#9b6bd6}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) #alur{--a5:#a983e6}}:root[data-theme="dark"] #alur{--a5:#a983e6}
#alur h2{font-size:19px;margin:32px 0 8px}#alur h3{font-size:16px;margin:0 0 4px}#alur h4{font-size:14px;margin:18px 0 2px;color:var(--ink2)}
#alur .ket{color:var(--ink2);font-size:14px;margin:0 0 10px}
#alur svg{width:100%;height:auto;display:block}#alur .grid{stroke:var(--grid)}#alur .ax{fill:var(--ink3);font-size:11px}#alur .lbl{fill:var(--ink);font-size:11px;font-weight:600}
#alur .leg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--ink2);margin:4px 0 6px}#alur .leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
#alur .intinya{background:var(--aksen);border-radius:8px;padding:10px 12px;font-size:14px;margin:12px 0 4px}#alur .intinya b{color:var(--aksen-ink)}
#alur details summary{cursor:pointer;color:var(--ink2);font-size:13px;margin-top:8px}#alur .tabel-lebar{overflow-x:auto}
#alur table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px;font-variant-numeric:tabular-nums}#alur th,#alur td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);white-space:nowrap}#alur th{color:var(--ink2);font-weight:600}
#alur .catatan{border-left:3px solid var(--target);padding:4px 12px;color:var(--ink2);font-size:14px;margin:12px 0}
#alur .kaki-alur{color:var(--ink3);font-size:13px;margin-top:24px}"""
J = RING["jumlah"]
PANEL = (f'<div class="panel" role="tabpanel" id="alur" aria-labelledby="tab-alur" hidden><style>{CSS}</style>'
         '<p class="pengantar">Waktu setiap langkah Ratu AI untuk satu pertanyaan: persiapan agent, setiap panggilan model (menunggu, berpikir, menulis), '
         'dan setiap alat. Jalur agent langsung (tanpa portal), model Qwen3 14B, max-num-seqs 4. 8 pertanyaan × 5 kali satu per satu, lalu 5 pengguna bersamaan.</p>'
         '<p class="catatan">Kode Ratu AI, prompt, dan setelan tidak diubah. Pencatat dipasang di skrip uji saja. Isi pertanyaan, jawaban, dokumen, dan data karyawan tidak disimpan.</p>'
         + KPI + "<h2>Ke mana waktunya habis</h2>" + k_komp + k_wf + "<h2>Model, alat, dan antrean</h2>" + k_peran + k_alat + k_par
         + "<h2>SOP dan rancangan tiket</h2>" + k_q45
         + f'<p class="kaki-alur">Data: data/{html.escape(os.path.basename(SUMBER))} ({J["pertanyaan"]} pertanyaan, {J["panggilan"]} panggilan model, '
           f'{J["cocok_litellm"]} dicocokkan dengan catatan LiteLLM). Laporan: docs/benchmark/benchmark-agent-workflow-latency.md.</p></div>')

HAL = os.path.join(AKAR, "docs", "benchmark", "grafik", "hasil-pengujian.html")
A, Z = "<!--tab-alur-->", "<!--/tab-alur-->"
TOMBOL = '<button type="button" role="tab" id="tab-alur" aria-controls="alur" aria-selected="false" tabindex="-1">Alur agent</button>'
h = open(HAL, encoding="utf-8").read()
if 'id="tab-model"' not in h: raise SystemExit("halaman grafik tidak memuat tab Kecepatan model; pulihkan dulu dari cadangan")
if A in h:
    h = h[:h.index(A)] + A + PANEL + Z + h[h.index(Z) + len(Z):]
else:
    akhir_tab = h.index('</div><button type="button" class="tema"')
    h = h[:akhir_tab] + TOMBOL + h[akhir_tab:]
    kaki = h.index('\n<p class="kaki">')
    h = h[:kaki] + A + PANEL + Z + h[kaki:]
open(HAL, "w", encoding="utf-8").write(h)
print(json.dumps(RING["jumlah"], default=str))
