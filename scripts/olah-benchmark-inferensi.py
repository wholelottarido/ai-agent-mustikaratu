"""Olah hasil benchmark-inferensi-vllm.py: CSV, ringkasan JSON, dan halaman grafik.

    python scripts/olah-benchmark-inferensi.py data/benchmark-inferensi-qwen3-14b-<ts>.jsonl

Keluaran:
  data/<nama>.csv                              satu baris per permintaan
  data/<nama>-ringkasan.json                   angka ringkas (dipakai laporan)
  docs/benchmark/grafik/hasil-pengujian.html      tab "Kecepatan model" disisipkan / diganti
"""
import csv, html, json, os, statistics as st, sys

SUMBER = sys.argv[1]
AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASAR = os.path.splitext(SUMBER)[0]
baris = [json.loads(l) for l in open(SUMBER, encoding="utf-8") if l.strip()]
INFO = next(b for b in baris if b["t"] == "info")
REQ = [b for b in baris if b["t"] == "req"]
RONDE = [b for b in baris if b["t"] == "ronde"]
GPU = [b for b in baris if b["t"] == "gpu"]
MET = [b for b in baris if b["t"] == "m" and "num_requests_running" in b]
STOP = [b for b in baris if b["t"] == "stop"]
SELESAI = [b for b in baris if b["t"] == "selesai"]

def kuantil(a, q):
    a = sorted(x for x in a if x is not None)
    if not a: return None
    return a[min(len(a) - 1, max(0, -(-int(q * len(a) * 1000) // 1000) - 1))]
p50 = lambda a: kuantil(a, .5)
p95 = lambda a: kuantil(a, .95)
rata = lambda a: (st.mean(a) if a else None)

# ---------- tiap permintaan: turunan & tanda gangguan ----------
for r in REQ:
    if r.get("total") and r.get("completion_tokens"):
        r["tps_e2e"] = r["completion_tokens"] / r["total"]
        if r.get("ttft") is not None and r["total"] > r["ttft"]:
            r["tps_keluar"] = (r["completion_tokens"] - 1) / (r["total"] - r["ttft"]) if r["completion_tokens"] > 1 else None
    r["terpotong"] = r.get("finish") == "length"
    a, b = r.get("mulai"), r.get("selesai", r.get("ts"))
    batas = r.get("paralel", 1)
    if a and b:
        x = [m["num_requests_running"] + m["num_requests_waiting"] for m in MET if a + 0.5 <= m["ts"] <= b - 0.5]
        r["beban_lain"] = bool(x) and max(x) > batas  # ada permintaan selain milik benchmark
    else:
        r["beban_lain"] = False

UKUR = [r for r in REQ if r["fase"] == "satu" and r["jenis"] in ("cold", "warm")]
BERSIH = [r for r in UKUR if not r["beban_lain"] and not r.get("galat")]
PAR = [r for r in REQ if r["fase"] == "paralel"]
INP, OUT, NPAR = INFO["input"], INFO["output"], INFO["paralel"]

# ---------- CSV ----------
kolom = ["fase", "jenis", "input", "output", "stream", "paralel", "ronde", "ke", "ulang", "prompt_tokens", "completion_tokens",
         "finish", "terpotong", "ttft", "tpot", "jeda_p50", "jeda_p95", "total", "tps_keluar", "tps_e2e", "cache_query", "cache_hit",
         "beban_lain", "http", "galat", "mulai", "selesai"]
with open(DASAR + ".csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=kolom, extrasaction="ignore"); w.writeheader()
    for r in REQ: w.writerow(r)

# ---------- ringkasan ----------
def ringkas(rs):
    return dict(n=len(rs), prompt=p50([r.get("prompt_tokens") for r in rs]), keluar=p50([r.get("completion_tokens") for r in rs]),
                terpotong=sum(r["terpotong"] for r in rs),
                ttft50=p50([r.get("ttft") for r in rs]), ttft95=p95([r.get("ttft") for r in rs]),
                tpot50=p50([r.get("tpot") for r in rs]), tpot95=p95([r.get("tpot") for r in rs]),
                tot50=p50([r.get("total") for r in rs]), tot95=p95([r.get("total") for r in rs]),
                tps50=p50([r.get("tps_keluar") for r in rs]), tps95_rendah=kuantil([r.get("tps_keluar") for r in rs], .05),
                e2e50=p50([r.get("tps_e2e") for r in rs]),
                hit=sum(r.get("cache_hit", 0) for r in rs) / max(1, sum(r.get("cache_query", 0) for r in rs)))
SATU = {}
for i in INP:
    for o in OUT:
        for s in (True, False):
            for j in ("cold", "warm"):
                rs = [r for r in BERSIH if r["input"] == i and r["output"] == o and r["stream"] == s and r["jenis"] == j]
                if rs: SATU[f"{i}|{o}|{'stream' if s else 'non'}|{j}"] = ringkas(rs)
PER_INPUT = {}  # streaming, digabung semua panjang jawaban (TTFT tidak bergantung panjang jawaban)
for i in INP:
    for j in ("cold", "warm"):
        rs = [r for r in BERSIH if r["input"] == i and r["stream"] and r["jenis"] == j]
        if rs: PER_INPUT[f"{i}|{j}"] = ringkas(rs)

def jendela(a, b, data): return [x for x in data if a <= x["ts"] <= b]
PARALEL = {}
for n in NPAR:
    rd = [x for x in RONDE if x["paralel"] == n]
    rs = [r for r in PAR if r["paralel"] == n]
    if not rd: continue
    g = [x for d in rd for x in jendela(d["mulai"], d["selesai"], GPU)]
    m = [x for d in rd for x in jendela(d["mulai"], d["selesai"], MET)]
    PARALEL[n] = dict(ronde=len(rd), gab50=p50([d["tps_gabungan"] for d in rd]), gab_min=min(d["tps_gabungan"] for d in rd),
                      gab_maks=max(d["tps_gabungan"] for d in rd), dinding50=p50([d["dinding"] for d in rd]),
                      **{k: v for k, v in ringkas(rs).items() if k not in ("hit",)},
                      watt=rata([x["watt"] for x in g]), util=rata([x["util"] for x in g]),
                      kv_maks=max([x["kv_cache_usage_perc"] for x in m], default=None),
                      antre_maks=max([x["num_requests_waiting"] for x in m], default=None),
                      beban_lain=sum(r["beban_lain"] for r in rs))
if 1 in PARALEL:
    for n, v in PARALEL.items(): v["skala"] = v["gab50"] / (n * PARALEL[1]["gab50"])

# GPU: diam (sebelum permintaan pertama) vs saat ada permintaan
t_awal = min(r.get("mulai") or r["ts"] - r.get("total", 0) for r in REQ)
diam = [x for x in GPU if x["ts"] < t_awal]
aktif_satu = [x for r in UKUR if r.get("mulai") for x in jendela(r["mulai"], r["selesai"], GPU)]
def gpu_ringkas(g):
    if not g: return None
    return dict(n=len(g), util=rata([x["util"] for x in g]), watt=rata([x["watt"] for x in g]), watt_maks=max(x["watt"] for x in g),
                vram_maks=max(x["vram"] for x in g), vram_total=g[0]["vram_total"], suhu_maks=max(x["suhu"] for x in g),
                clock=rata([x["clock"] for x in g]))
GPUR = dict(diam=gpu_ringkas(diam), satu=gpu_ringkas(aktif_satu),
            semua=gpu_ringkas(GPU))
GPU_PER_INPUT = {}
for i in INP:
    g = [x for r in UKUR if r["input"] == i and r.get("mulai") for x in jendela(r["mulai"], r["selesai"], GPU)]
    GPU_PER_INPUT[i] = gpu_ringkas(g)

m_awal = MET[0] if MET else {}
m_akhir = SELESAI[0]["metrik_akhir"] if SELESAI else (MET[-1] if MET else {})
RING = dict(sumber=os.path.basename(SUMBER), info=INFO, satu=SATU, per_input=PER_INPUT, paralel=PARALEL, gpu=GPUR, gpu_per_input=GPU_PER_INPUT,
            jumlah=dict(permintaan=len(REQ), diukur=len(UKUR), bersih=len(BERSIH), beban_lain=sum(r["beban_lain"] for r in REQ),
                        galat=sum(1 for r in REQ if r.get("galat")), terpotong=sum(r["terpotong"] for r in REQ),
                        preemption=(m_akhir.get("num_preemptions_total", 0) - m_awal.get("num_preemptions_total", 0)),
                        kv_maks=max([m["kv_cache_usage_perc"] for m in MET], default=None)),
            stop=STOP, selesai=bool(SELESAI),
            durasi_menit=(max(b["ts"] for b in baris) - min(b["ts"] for b in baris)) / 60)
json.dump(RING, open(DASAR + "-ringkasan.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---------- halaman grafik ----------
f1 = lambda x: "—" if x is None else f"{x:.1f}".replace(".", ",")
f2 = lambda x: "—" if x is None else f"{x:.2f}".replace(".", ",")
f0 = lambda x: "—" if x is None else f"{x:,.0f}".replace(",", ".")
ms = lambda x: None if x is None else x * 1000
W, H, L, R, T, B = 640, 300, 64, 110, 24, 52

def skala(v):
    for s in (1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000):
        if v / s <= 5: return s, s * max(1, -(-v // s))
    return v / 5, v

def grafik(xs, seri, judul_x, judul_y, label_x=str):
    """seri: list of (nama, warna, nilai[list], putus:bool)"""
    semua = [v for _, _, vs, _ in seri for v in vs if v is not None]
    langkah, top = skala(max(semua) * 1.1 if semua else 1)
    xp = lambda k: L + (W - L - R) * (k + .5) / len(xs)
    yp = lambda v: T + (H - T - B) * (1 - v / top)
    o = []
    v = 0
    while v <= top + 1e-9:
        o.append(f'<line x1="{L}" x2="{W - R}" y1="{yp(v):.1f}" y2="{yp(v):.1f}" class="grid"/><text x="{L - 8}" y="{yp(v) + 4:.1f}" class="ax" text-anchor="end">{f0(v) if langkah >= 1 else f2(v)}</text>')
        v += langkah
    for k, x in enumerate(xs):
        o.append(f'<text x="{xp(k):.1f}" y="{H - B + 18}" class="ax" text-anchor="middle">{label_x(x)}</text>')
    o.append(f'<text x="{(L + W - R) / 2:.1f}" y="{H - 10}" class="ax" text-anchor="middle">{html.escape(judul_x)}</text>')
    o.append(f'<text x="16" y="{(T + H - B) / 2:.1f}" class="ax" text-anchor="middle" transform="rotate(-90 16 {(T + H - B) / 2:.1f})">{html.escape(judul_y)}</text>')
    ujung = []
    for nama, warna, vs, putus in seri:
        pt = [(xp(k), yp(val), val) for k, val in enumerate(vs) if val is not None]
        if len(pt) > 1:
            o.append(f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a, b, _ in pt)}" fill="none" stroke="var({warna})" stroke-width="2"{" stroke-dasharray=\"5 4\"" if putus else ""}/>')
        for a, b, val in pt:
            o.append(f'<circle cx="{a:.1f}" cy="{b:.1f}" r="4" fill="var({warna})" stroke="var(--surface)" stroke-width="2"><title>{html.escape(nama)}: {f1(val)}</title></circle>')
        if pt and not putus: ujung.append([pt[-1][1], nama])
    ujung.sort()
    for k in range(1, len(ujung)):
        if ujung[k][0] - ujung[k - 1][0] < 14: ujung[k][0] = ujung[k - 1][0] + 14
    for y, nama in ujung:
        o.append(f'<text x="{W - R + 8}" y="{y + 4:.1f}" class="lbl">{html.escape(nama)}</text>')
    return f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(judul_y)}">{"".join(o)}</svg>'

def batang(kat, nilai, warna, judul_y, ideal=None):
    langkah, top = skala(max(nilai + (ideal or [])) * 1.15)
    lebar = (W - L - R) / len(kat)
    yp = lambda v: T + (H - T - B) * (1 - v / top)
    o = []
    v = 0
    while v <= top + 1e-9:
        o.append(f'<line x1="{L}" x2="{W - R}" y1="{yp(v):.1f}" y2="{yp(v):.1f}" class="grid"/><text x="{L - 8}" y="{yp(v) + 4:.1f}" class="ax" text-anchor="end">{f0(v)}</text>')
        v += langkah
    for k, (c, val) in enumerate(zip(kat, nilai)):
        x = L + lebar * k + lebar * .25
        o.append(f'<rect x="{x:.1f}" y="{yp(val):.1f}" width="{lebar * .5:.1f}" height="{yp(0) - yp(val):.1f}" rx="4" fill="var({warna})"><title>{c}: {f1(val)}</title></rect>')
        o.append(f'<text x="{x + lebar * .25:.1f}" y="{yp(val) - 6:.1f}" class="lbl" text-anchor="middle">{f0(val)}</text>')
        o.append(f'<text x="{x + lebar * .25:.1f}" y="{H - B + 18}" class="ax" text-anchor="middle">{c}</text>')
        if ideal:
            o.append(f'<line x1="{x - 6:.1f}" x2="{x + lebar * .5 + 6:.1f}" y1="{yp(ideal[k]):.1f}" y2="{yp(ideal[k]):.1f}" stroke="var(--target)" stroke-width="2" stroke-dasharray="4 3"/>')
    o.append(f'<text x="{(L + W - R) / 2:.1f}" y="{H - 10}" class="ax" text-anchor="middle">permintaan yang dikirim bersamaan</text>')
    o.append(f'<text x="16" y="{(T + H - B) / 2:.1f}" class="ax" text-anchor="middle" transform="rotate(-90 16 {(T + H - B) / 2:.1f})">{html.escape(judul_y)}</text>')
    return f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(judul_y)}">{"".join(o)}</svg>'

def tabel(kepala, isi):
    return ('<div class="tabel-lebar"><table><thead><tr>' + "".join(f"<th>{html.escape(str(k))}</th>" for k in kepala) + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in b) + "</tr>" for b in isi) + "</tbody></table></div>")

def legenda(item):
    return '<div class="leg">' + "".join(f'<span><i style="background:var({w})"></i>{html.escape(n)}</span>' for n, w in item) + "</div>"

def kartu(judul, ket, svg, tbl, intinya=""):
    return (f'<section class="kartu"><h3>{judul}</h3><p class="ket">{ket}</p>{svg}'
            + (f'<p class="intinya"><b>Intinya:</b> {intinya}</p>' if intinya else "")
            + f"<details><summary>Lihat angkanya</summary>{tbl}</details></section>")

X = lambda v: f"{v:,}".replace(",", ".")
pi = lambda i, j, k: (PER_INPUT.get(f"{i}|{j}") or {}).get(k)
si = lambda i, o, s, j, k: (SATU.get(f"{i}|{o}|{s}|{j}") or {}).get(k)
WARNA_OUT = {128: "--s1", 256: "--s2", 512: "--s3"}
TEKS = json.load(open(os.path.join(AKAR, "data", "benchmark-inferensi-intinya.json"), encoding="utf-8")) if os.path.exists(os.path.join(AKAR, "data", "benchmark-inferensi-intinya.json")) else {}

k_ttft = kartu("Jeda sampai kata pertama (TTFT) menurut panjang prompt",
               "Satu pengguna, streaming. Garis tegas = waktu tengah (P50), garis putus = P95 (di sini hampir sama dengan P50, jadi garisnya bertumpuk). Cold = prompt baru, belum ada di cache. Warm = prompt yang persis sama sudah pernah dikirim.",
               legenda([("Cold", "--s2"), ("Warm", "--s1")]) + grafik(INP, [("Cold", "--s2", [ms(pi(i, "cold", "ttft50")) for i in INP], False),
                                                                          ("Cold P95", "--s2", [ms(pi(i, "cold", "ttft95")) for i in INP], True),
                                                                          ("Warm", "--s1", [ms(pi(i, "warm", "ttft50")) for i in INP], False),
                                                                          ("Warm P95", "--s1", [ms(pi(i, "warm", "ttft95")) for i in INP], True)],
                                                                         "token prompt (target)", "milidetik", X),
               tabel(["Prompt (target)", "Token aktual", "Cold P50", "Cold P95", "Warm P50", "Warm P95", "Cache terpakai (cold / warm)"],
                     [(X(i), pi(i, "cold", "prompt"), f"{f0(ms(pi(i, 'cold', 'ttft50')))} ms", f"{f0(ms(pi(i, 'cold', 'ttft95')))} ms",
                       f"{f0(ms(pi(i, 'warm', 'ttft50')))} ms", f"{f0(ms(pi(i, 'warm', 'ttft95')))} ms",
                       f"{f0(100 * (pi(i, 'cold', 'hit') or 0))}% / {f0(100 * (pi(i, 'warm', 'hit') or 0))}%") for i in INP]),
               TEKS.get("ttft", ""))
k_tpot = kartu("Waktu per token berikutnya (TPOT) dan kecepatan menulis",
               "Satu pengguna, streaming, semua panjang jawaban dan cold/warm digabung (panjang jawaban tidak mengubah angka ini). "
               "Makin kecil makin cepat. Kecepatan menulis = 1.000 ÷ TPOT, misalnya 19 ms per token ≈ 52 token per detik.",
               legenda([("P50 (waktu tengah)", "--s1"), ("P95", "--s2")])
               + grafik(INP, [("P50", "--s1", [ms(p50([r.get("tpot") for r in BERSIH if r["stream"] and r["input"] == i])) for i in INP], False),
                              ("P95", "--s2", [ms(p95([r.get("tpot") for r in BERSIH if r["stream"] and r["input"] == i])) for i in INP], False)],
                        "token prompt (target)", "milidetik per token", X),
               tabel(["Prompt", "Jawaban", "TPOT P50", "TPOT P95", "Token/detik P50", "Token/detik terendah (P5)"],
                     [(X(i), o, f"{f2(ms(p50([r.get('tpot') for r in BERSIH if r['stream'] and r['input'] == i and r['output'] == o])))} ms",
                       f"{f2(ms(p95([r.get('tpot') for r in BERSIH if r['stream'] and r['input'] == i and r['output'] == o])))} ms",
                       f1(p50([r.get('tps_keluar') for r in BERSIH if r['stream'] and r['input'] == i and r['output'] == o])),
                       f1(kuantil([r.get('tps_keluar') for r in BERSIH if r['stream'] and r['input'] == i and r['output'] == o], .05))) for i in INP for o in OUT]),
               TEKS.get("tpot", "") + " " + TEKS.get("tps", ""))
k_tot = kartu("Total waktu satu permintaan",
              "Satu pengguna, cold. Garis tegas = streaming P50, garis putus = non-streaming P50 (tertutup garis tegas karena angkanya sama). Dari permintaan dikirim sampai token terakhir diterima.",
              legenda([(f"Jawaban {o} token", WARNA_OUT[o]) for o in OUT])
              + grafik(INP, [(f"{o} tok", WARNA_OUT[o], [si(i, o, "stream", "cold", "tot50") for i in INP], False) for o in OUT]
                       + [(f"{o} non", WARNA_OUT[o], [si(i, o, "non", "cold", "tot50") for i in INP], True) for o in OUT],
                       "token prompt (target)", "detik", X),
              tabel(["Prompt", "Jawaban", "Cara", "Cache", "n", "Token keluar", "Terpotong", "Total P50", "Total P95", "TTFT P50"],
                    [(X(i), o, "streaming" if s == "stream" else "non-streaming", j, v["n"], v["keluar"], f'{v["terpotong"]} dari {v["n"]}',
                      f'{f2(v["tot50"])} dtk', f'{f2(v["tot95"])} dtk', "—" if v["ttft50"] is None else f'{f0(ms(v["ttft50"]))} ms')
                     for i in INP for o in OUT for s in ("stream", "non") for j in ("cold", "warm") for v in [SATU.get(f"{i}|{o}|{s}|{j}")] if v]),
              TEKS.get("total", ""))
par_n = [n for n in NPAR if n in PARALEL]
k_par = kartu("Throughput gabungan: 1, 2, dan 4 permintaan bersamaan",
              f"Prompt {X(INFO['paralel_in'])} token, jawaban {INFO['paralel_out']} token, cold, 5 putaran. Batang = total token keluar per detik untuk semua permintaan (waktu tengah). Garis putus abu-abu = kalau kecepatannya naik sebanding dengan jumlah permintaan.",
              batang([str(n) for n in par_n], [PARALEL[n]["gab50"] for n in par_n], "--s1", "token keluar per detik (gabungan)",
                     ideal=[n * PARALEL[par_n[0]]["gab50"] for n in par_n]),
              tabel(["Bersamaan", "Gabungan P50", "Rentang", "Efisiensi skala", "TTFT P50 / P95", "TPOT P50 / P95", "Total P50 / P95", "Listrik rata", "Memori kerja maks", "Menunggu maks"],
                    [(n, f'{f1(v["gab50"])} tok/dtk', f'{f1(v["gab_min"])}–{f1(v["gab_maks"])}', ("—" if v.get("skala") is None else f'{f0(100 * v["skala"])}%'),
                      f'{f0(ms(v["ttft50"]))} / {f0(ms(v["ttft95"]))} ms', f'{f1(ms(v["tpot50"]))} / {f1(ms(v["tpot95"]))} ms',
                      f'{f2(v["tot50"])} / {f2(v["tot95"])} dtk', f'{f0(v["watt"])} W', f'{f0(100 * (v["kv_maks"] or 0))}%', f0(v["antre_maks"]))
                     for n, v in PARALEL.items()]),
              TEKS.get("paralel", ""))
k_par2 = kartu("Satu permintaan saat berbagi GPU",
               "Waktu tengah (P50, garis tegas) dan P95 (garis putus) per permintaan, ketika 1, 2, atau 4 permintaan berjalan bersamaan. Atas: waktu per token. Bawah: jeda sebelum kata pertama.",
               legenda([("P50", "--s1"), ("P95", "--s2")])
               + grafik(par_n, [("P50", "--s1", [ms(PARALEL[n]["tpot50"]) for n in par_n], False),
                                ("P95", "--s2", [ms(PARALEL[n]["tpot95"]) for n in par_n], True)],
                        "permintaan yang dikirim bersamaan", "TPOT, milidetik per token")
               + grafik(par_n, [("P50", "--s1", [PARALEL[n]["ttft50"] for n in par_n], False),
                                ("P95", "--s2", [PARALEL[n]["ttft95"] for n in par_n], True)],
                        "permintaan yang dikirim bersamaan", "TTFT, detik"),
               "", TEKS.get("paralel2", ""))

# timeline GPU
t0 = GPU[0]["ts"] if GPU else 0
def timeline(f, judul, warna, top_tetap=None):
    if not GPU: return ""
    tmax = (GPU[-1]["ts"] - t0) / 60
    kel = {}
    for x in GPU: kel.setdefault(int((x["ts"] - t0) // 5), []).append(x[f])
    pts = [((k * 5 + 2.5) / 60, st.mean(v)) for k, v in sorted(kel.items())]
    top = top_tetap or max(v for _, v in pts) * 1.1
    xp = lambda m: L + (W - L - R) * m / tmax
    yp = lambda v: T + (H - T - B) * (1 - v / top)
    o = []
    fase = [("1 pengguna", min(r["mulai"] for r in UKUR if r.get("mulai")), max(r["selesai"] for r in UKUR if r.get("selesai")))] if UKUR else []
    for n in par_n:
        rd = [x for x in RONDE if x["paralel"] == n]; fase.append((f"{n} sekaligus", rd[0]["mulai"], rd[-1]["selesai"]))
    for k, (nm, a, b) in enumerate(fase):
        o.append(f'<rect x="{xp((a - t0) / 60):.1f}" y="{T}" width="{max(1, xp((b - t0) / 60) - xp((a - t0) / 60)):.1f}" height="{H - T - B}" fill="var(--pita)"/>')
        o.append(f'<text x="{xp((a - t0) / 60) + 3:.1f}" y="{T - 6 + (k % 2) * -0}" class="ax">{nm}</text>' if k == 0 else
                 f'<text x="{(xp((a - t0) / 60) + xp((b - t0) / 60)) / 2:.1f}" y="{T - 6 - (k % 2) * 0}" class="ax" text-anchor="middle">{n if False else nm.split(" ")[0]}</text>')
    langkah, top2 = skala(top)
    v = 0
    while v <= top2 + 1e-9 and v <= top:
        o.append(f'<line x1="{L}" x2="{W - R}" y1="{yp(v):.1f}" y2="{yp(v):.1f}" class="grid"/><text x="{L - 8}" y="{yp(v) + 4:.1f}" class="ax" text-anchor="end">{f0(v)}</text>')
        v += langkah
    m = 0
    while m <= tmax:
        o.append(f'<text x="{xp(m):.1f}" y="{H - B + 18}" class="ax" text-anchor="middle">{m}</text>'); m += 5
    o.append(f'<polyline points="{" ".join(f"{xp(a):.1f},{yp(b):.1f}" for a, b in pts)}" fill="none" stroke="var({warna})" stroke-width="1.5"/>')
    o.append(f'<text x="{(L + W - R) / 2:.1f}" y="{H - 10}" class="ax" text-anchor="middle">menit sejak benchmark dimulai</text>')
    o.append(f'<text x="16" y="{(T + H - B) / 2:.1f}" class="ax" text-anchor="middle" transform="rotate(-90 16 {(T + H - B) / 2:.1f})">{html.escape(judul)}</text>')
    return f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(judul)}">{"".join(o)}</svg>'

G = GPUR
gpu_tbl = tabel(["Saat", "GPU sibuk", "Listrik rata", "Listrik puncak", "VRAM terpakai", "Suhu puncak", "Clock SM"],
                [(nm, f'{f0(g["util"])}%', f'{f0(g["watt"])} W', f'{f0(g["watt_maks"])} W', f'{f0(g["vram_maks"])} / {f0(g["vram_total"])} MiB',
                  f'{f0(g["suhu_maks"])} °C', f'{f0(g["clock"])} MHz') for nm, g in
                 [("Diam (sebelum mulai)", G["diam"]), ("1 pengguna, saat ada permintaan", G["satu"])]
                 + [(f"1 pengguna, prompt {X(i)}", GPU_PER_INPUT[i]) for i in INP] if g]
                + [(f"{n} sekaligus", f'{f0(v["util"])}%', f'{f0(v["watt"])} W', "", "", "", "") for n, v in PARALEL.items()])
k_gpu = kartu("GPU sepanjang benchmark", "Rata-rata per 5 detik. Bagian abu-abu = fase pengujian. Batas listrik kartu 300 W.",
              timeline("watt", "watt", "--s2", 300) + timeline("util", "% GPU sibuk", "--s1", 100), gpu_tbl, TEKS.get("gpu", ""))

J = RING["jumlah"]
kpi = lambda l, v, k: f'<div class="kpi"><div class="kpi-l">{l}</div><div class="kpi-v">{v}</div><div class="kpi-k">{k}</div></div>'
v1 = PARALEL.get(1, {}); v4 = PARALEL.get(max(par_n)) if par_n else {}
KPI = ('<div class="kpis">'
       + kpi("Kecepatan menulis, 1 pengguna", f'{f0(p50([r.get("tps_keluar") for r in BERSIH if r["stream"]]))} tok/dtk', f'TPOT {f1(ms(p50([r.get("tpot") for r in BERSIH if r["stream"]])))} ms, semua kombinasi')
       + kpi(f"TTFT cold, prompt {X(INP[0])} → {X(INP[-1])}", f'{f0(ms(pi(INP[0], "cold", "ttft50")))} → {f0(ms(pi(INP[-1], "cold", "ttft50")))} ms', "waktu tengah")
       + kpi(f"TTFT warm, prompt {X(INP[-1])}", f'{f0(ms(pi(INP[-1], "warm", "ttft50")))} ms', "prompt sudah ada di cache")
       + (kpi(f"Gabungan {max(par_n)} sekaligus", f'{f0(v4["gab50"])} tok/dtk', f'{f1(v4["gab50"] / v1["gab50"])}× dari 1 permintaan') if v1 and v4 else "")
       + kpi("Listrik GPU", f'{f0(G["satu"]["watt"])} W', "rata-rata, 1 pengguna; batas 300 W")
       + kpi("Masalah", f'{J["galat"]} galat · {f0(J["preemption"])} preemption', f'{J["beban_lain"]} permintaan terganggu beban lain')
       + "</div>")

# Gaya khusus tab ini, dibatasi ke #model supaya tidak mengganggu tab lain. Warna & tema memakai variabel halaman.
CSS = """#model .kartu{background:var(--surface);border:1px solid var(--garis);border-radius:12px;padding:18px;margin:14px 0}
#model h2{font-size:19px;margin:32px 0 8px}#model h3{font-size:16px;margin:0 0 4px}
#model .ket{color:var(--ink2);font-size:14px;margin:0 0 10px}
#model svg{width:100%;height:auto;display:block}#model .grid{stroke:var(--grid)}#model .ax{fill:var(--ink3);font-size:11px}#model .lbl{fill:var(--ink);font-size:11px;font-weight:600}
#model .leg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--ink2);margin:4px 0 6px}#model .leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
#model .intinya{background:var(--aksen);border-radius:8px;padding:10px 12px;font-size:14px;margin:12px 0 4px}#model .intinya b{color:var(--aksen-ink)}
#model details summary{cursor:pointer;color:var(--ink2);font-size:13px;margin-top:8px}#model .tabel-lebar{overflow-x:auto}
#model table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px;font-variant-numeric:tabular-nums}#model th,#model td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);white-space:nowrap}#model th{color:var(--ink2);font-weight:600}
#model .catatan{border-left:3px solid var(--target);padding:4px 12px;color:var(--ink2);font-size:14px;margin:12px 0}
#model .kaki-model{color:var(--ink3);font-size:13px;margin-top:24px}"""

PANEL = (f'<div class="panel" role="tabpanel" id="model" aria-labelledby="tab-model" hidden><style>{CSS}</style>'
         '<p class="pengantar">Kecepatan model itu sendiri, diukur langsung ke vLLM di server (tanpa Ratu AI, LiteLLM, tunnel, atau portal). '
         'GPU NVIDIA A10G 24 GB, max-num-seqs 4, max-model-len 16.384, Qwen3 14B AWQ.</p>'
         '<p class="catatan">Ini berbeda dari tab Batas 2–4. Di sini satu permintaan = satu panggilan model dengan prompt dan panjang jawaban tetap, '
         'tanpa alat dan tanpa mode berpikir. Di uji beban Ratu AI, satu pertanyaan memicu 3–5 panggilan model plus pengambilan data, '
         'dan sebagian besar prompt-nya sudah ada di cache server.</p>'
         + KPI
         + f'<h2>Satu pengguna</h2>{k_ttft}{k_tpot}{k_tot}'
         + f'<h2>Beberapa permintaan bersamaan</h2>{k_par}{k_par2}'
         + f'<h2>Kondisi GPU</h2>{k_gpu}'
         + f'<p class="kaki-model">Data: data/{html.escape(os.path.basename(SUMBER))} ({J["permintaan"]} permintaan, {f0(RING["durasi_menit"])} menit). '
           f'Semua jawaban dipaksa sepanjang target (ignore_eos), sehingga semuanya berakhir di batas max_tokens dan tercatat terpotong secara sengaja: '
           f'{J["terpotong"]} dari {J["permintaan"]}. Laporan: docs/benchmark/benchmark-inferensi-qwen3-14b.md.</p></div>')

# ---------- sisipkan ke halaman uji beban yang sudah ada ----------
HAL = os.path.join(AKAR, "docs", "benchmark", "grafik", "hasil-pengujian.html")
A, Z = "<!--tab-model-->", "<!--/tab-model-->"
TOMBOL = '<button type="button" role="tab" id="tab-model" aria-controls="model" aria-selected="false" tabindex="-1">Kecepatan model</button>'
h = open(HAL, encoding="utf-8").read()
if A in h:  # dijalankan ulang: ganti panel lama
    h = h[:h.index(A)] + A + PANEL + Z + h[h.index(Z) + len(Z):]
else:
    akhir_tab = h.index('</div><button type="button" class="tema"')
    h = h[:akhir_tab] + TOMBOL + h[akhir_tab:]
    kaki = h.index('\n<p class="kaki">')
    h = h[:kaki] + A + PANEL + Z + h[kaki:]
open(HAL, "w", encoding="utf-8").write(h)
print(json.dumps(dict(jumlah=J, durasi=RING["durasi_menit"], stop=STOP), ensure_ascii=False))
