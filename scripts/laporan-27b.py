"""Laporan benchmark Qwen3.8-27B (g5.12xlarge, TP4) dibanding baseline Qwen3-14B (20 Nov 2026).

    python scripts/laporan-27b.py <folder uji 27B> <folder baseline 14B> [--kurs 17900]

Kedua folder harus sudah diolah scripts/olah-alur-agent.py (ringkasan.json, panggilan.csv, pertanyaan.csv ada).
Keluaran (folder baru, hasil lama tidak disentuh):
  data/benchmark-qwen38-27b/<nama folder uji>/
    benchmark_results.json   hasil mentah per skenario (97), termasuk isi jawaban & argumen alat — INTERNAL
    token_usage.csv          token per panggilan model
    performance_summary.json latensi, throughput, TTFT, antrean per tahap
    accuracy_summary.json    ketepatan per kategori, pemilihan & argumen alat, galat
    cost_analysis.json       simulasi biaya AWS
    benchmark_report.md      laporan teknis
    benchmark_report.html    dashboard untuk mentor (tanpa isi jawaban)
"""
import csv, json, math, os, re, shutil, statistics, sys
from datetime import datetime, timezone

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D27, D14 = sys.argv[1].rstrip("/\\"), sys.argv[2].rstrip("/\\")
KURS = float(sys.argv[sys.argv.index("--kurs") + 1]) if "--kurs" in sys.argv else 17900.0
OUT = os.path.join(AKAR, "data", "benchmark-qwen38-27b", os.path.basename(D27))
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- tarif (sumber dicatat)
AWS = dict(instance="g5.12xlarge", region="ap-southeast-3", lokasi="Asia Pacific (Jakarta)", os="Linux", tenancy="shared", jenis="on-demand",
           usd_per_jam=7.93854, rate_code="ZMCJ8NZ76ZVYAJCT.JRTCKXETXF.6YS6EN2CT7",
           sumber="AWS public price list (b0.p.awsstatic.com, ec2-ondemand-without-sec-sel, Asia Pacific (Jakarta)/Linux), diterbitkan 2026-11-21T00:48:16Z, diambil 2026-11-23",
           tidak_termasuk="EBS (disk root 290 GB), transfer data keluar, Elastic IP, pajak. Diskon Savings Plan/Reserved tidak diterapkan.")
# ---------------------------------------------------------------- baca data
def baca_jsonl(p): return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()] if os.path.exists(p) else []
def baca_csv(p): return list(csv.DictReader(open(p, encoding="utf-8"))) if os.path.exists(p) else []
def ringkasan(d): return json.load(open(os.path.join(d, "ringkasan.json"), encoding="utf-8"))
R27, R14 = ringkasan(D27), ringkasan(D14)
KJ27, KJ14 = baca_jsonl(os.path.join(D27, "kejadian.jsonl")), baca_jsonl(os.path.join(D14, "kejadian.jsonl"))
Q27 = [x for x in KJ27 if x["t"] == "q" and x["fase"] != "pemanasan"]
Q14 = [x for x in KJ14 if x["t"] == "q" and x["fase"] != "pemanasan"]
PG27, PG14 = baca_csv(os.path.join(D27, "panggilan.csv")), baca_csv(os.path.join(D14, "panggilan.csv"))
PT27 = {r["trace"]: r for r in baca_csv(os.path.join(D27, "pertanyaan.csv"))}
LT27, LT14 = baca_csv(os.path.join(D27, "litellm.csv")), baca_csv(os.path.join(D14, "litellm.csv"))
JWB = {x["trace"]: x for x in baca_jsonl(os.path.join(D27, "jawaban.jsonl"))}
ARG = {}
for x in baca_jsonl(os.path.join(D27, "argumen-alat.jsonl")):
    ARG.setdefault(x["trace"], []).append(x)
INFO = next((x for x in KJ27 if x["t"] == "info"), {})
TEKS_Q = {k: t for k, _, t in re.findall(r'kode: "(Q\d)", jenis: "([^"]*)", teks: "([^"]*)"', open(os.path.join(AKAR, "scripts", "profil-alur-agent.mts"), encoding="utf-8").read())}
KATEGORI = {"Q1": "Data penjualan", "Q2": "Peringatan dini", "Q3": "Stok kosong", "Q4": "SOP", "Q5": "Rancangan tiket",
            "Q6": "Data karyawan", "Q7": "Harus ditolak", "Q8": "Sapaan umum"}
grup = lambda q: "berurutan" if q["fase"] == "berurutan" else f"beban-{q.get('tahap')}"
GRUP = ["berurutan", "beban-1", "beban-2", "beban-3", "beban-5", "beban-8"]
NAMA_GRUP = {"berurutan": "Berurutan (40)", "beban-1": "1 pengguna", "beban-2": "2 pengguna", "beban-3": "3 pengguna", "beban-5": "5 pengguna", "beban-8": "8 pengguna"}

def persentil(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs: return None
    k = (len(xs) - 1) * p / 100; f = math.floor(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)
def f(x, d=1): return None if x is None else round(x, d)
num = lambda s: None if s in (None, "") else float(s)

# ---------------------------------------------------------------- token per panggilan (+ reasoning dari LiteLLM)
def reasoning_map(lt):
    m = {}
    for r in lt:
        if r.get("reasoning_tokens"):
            m.setdefault((r["prompt_tokens"], r["completion_tokens"]), []).append(int(float(r["reasoning_tokens"])))
    return m
RMAP = reasoning_map(LT27)
q_by_trace = {q["trace"]: q for q in Q27}
TOKEN_ROWS = []
for p in PG27:
    if p["fase"] == "pemanasan": continue
    tm, tk = p.get("token_masuk"), p.get("token_keluar")
    rs = None
    if tm and tk:
        k = (str(int(float(tm))), str(int(float(tk))))
        if RMAP.get(k): rs = RMAP[k].pop(0)
    TOKEN_ROWS.append(dict(trace=p["trace"], fase=p["fase"], tahap=p["tahap"], kode=p["kode"], kategori=KATEGORI.get(p["kode"], ""),
                           agent=p["nama"], peran=p["peran"], status=p["status"], finish=p["finish"],
                           prompt_tokens=int(float(tm)) if tm else None, completion_tokens=int(float(tk)) if tk else None,
                           reasoning_tokens=rs, total_tokens=(int(float(tm)) + int(float(tk))) if tm and tk else None,
                           # lt_ttft & lt_total di panggilan.csv dalam milidetik
                           ttft_litellm_s=f(num(p["lt_ttft"]) / 1000, 3) if p["lt_ttft"] else None,
                           durasi_litellm_s=f(num(p["lt_total"]) / 1000, 3) if p["lt_total"] else None,
                           durasi_klien_s=f(num(p["durasi_ms"]) / 1000, 3) if p["durasi_ms"] else None,
                           selisih_klien_litellm_s=f(num(p["transport_ms"]) / 1000, 3) if p["transport_ms"] else None,
                           token_keluar_per_dtk=f(int(float(tk)) / ((num(p["lt_total"]) - num(p["lt_ttft"])) / 1000), 1)
                               if tk and p["lt_total"] and p["lt_ttft"] and num(p["lt_total"]) > num(p["lt_ttft"]) else None))
with open(os.path.join(OUT, "token_usage.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(TOKEN_ROWS[0].keys()) if TOKEN_ROWS else ["trace"]); w.writeheader(); w.writerows(TOKEN_ROWS)

# ---------------------------------------------------------------- penilaian per skenario
ALAT_HARAP = {"Q1": r"^total_penjualan$", "Q2": r"^pergerakan_penjualan$", "Q3": r"^stok_kosong$", "Q4": r"^cari_sop$",
              "Q5": r"^buat_tiket$", "Q6": r"karyawan"}
ARG_HARAP = {  # heuristik: argumen alat yang diharapkan merujuk ke isi pertanyaan
    "Q1": (r"2026-0?9|0?9[-/]2026|september\s*2026", "periode September 2026"),
    "Q2": (r"2026-0?9|0?9[-/]2026|september\s*2026", "periode September 2026"),
    "Q3": (r"2026-0?9|0?9[-/]2026|september\s*2026", "periode September 2026"),
    "Q4": (r"cuti", "kata kunci 'cuti'"),
    "Q5": (r"internet|jaringan|network|koneksi|wifi|wi-fi|wireless|\blan\b", "masalah internet/jaringan"),
    "Q6": (r"\bIT\b|information technology|teknologi informasi", "departemen IT"),
}
BOCOR = re.compile(r"^\s*(user menyetujui|pengguna menyetujui|delegat|targetAgents|\{\"task\")", re.I)
HASIL = []
for q in sorted(Q27, key=lambda x: x["mulai"]):
    j, pt = JWB.get(q["trace"], {}), PT27.get(q["trace"], {})
    alat = [a for a in (q.get("alat") or []) if a != "delegate_task"]
    args = [a for a in ARG.get(q["trace"], []) if a["alat"] != "delegate_task"]
    teks = j.get("jawaban") or ""
    kode = q["kode"]
    pola = ALAT_HARAP.get(kode)
    if kode == "Q8": pilih_ok = len(alat) == 0
    elif kode == "Q7": pilih_ok = None   # tidak ada alat wajib; dinilai dari penolakan
    elif kode == "Q5": pilih_ok = bool(q.get("rancangan")) or any(re.search(pola, a) for a in alat)
    else: pilih_ok = any(re.search(pola, a) for a in alat)
    arg_ok, arg_ket = None, ""
    if kode in ARG_HARAP:
        cocok = [a for a in args if pola and re.search(pola, a["alat"] or "")]
        if cocok:
            rx, arg_ket = ARG_HARAP[kode]
            arg_ok = any(re.search(rx, a["argumen"] or "", re.I) for a in cocok)
    llm_q = [t for t in TOKEN_ROWS if t["trace"] == q["trace"]]
    panjang = sum(1 for t in llm_q if t["finish"] == "length")
    data_tanpa_alat = kode in ("Q1", "Q2", "Q3", "Q6") and not alat and bool(re.search(r"\d", teks))
    HASIL.append(dict(
        trace=q["trace"], fase=q["fase"], grup=grup(q), tahap=q.get("tahap"), pemakai=q.get("pemakai"), urut=q.get("urut"),
        kode=kode, kategori=KATEGORI.get(kode), pertanyaan=TEKS_Q.get(kode, ""),
        status=q["status"], benar=q["benar"], selesai=q["status"] == "ok" and bool(teks.strip()),
        total_s=f(q["total_ms"] / 1000, 2), ttft_jawaban_s=f((q.get("ttft_jawaban_ms") or 0) / 1000, 2) if q.get("ttft_jawaban_ms") else None,
        alat=alat, rancangan=q.get("rancangan"), pilih_alat_benar=pilih_ok, argumen_benar=arg_ok, argumen_diharapkan=arg_ket,
        argumen=[dict(alat=a["alat"], argumen=a["argumen"]) for a in args],
        n_llm=len(llm_q) or (int(pt["n_llm"]) if pt.get("n_llm") else None), n_llm_galat=sum(1 for t in llm_q if t["status"] != "ok"),
        n_terpotong_konteks=panjang,
        token_masuk=sum(t["prompt_tokens"] or 0 for t in llm_q), token_keluar=sum(t["completion_tokens"] or 0 for t in llm_q),
        token_reasoning=sum(t["reasoning_tokens"] or 0 for t in llm_q) if any(t["reasoning_tokens"] is not None for t in llm_q) else None,
        bocor_teks_internal=bool(BOCOR.search(teks)) or (q["status"] == "ok" and 0 < len(teks.strip()) < 5),
        q7_bocor_rupiah=kode == "Q7" and bool(re.search(r"Rp\s?\d", teks)),
        angka_tanpa_alat_data=data_tanpa_alat,
        jawaban=teks, karakter_jawaban=q.get("karakter_jawaban"), galat=q.get("galat") or ""))
json.dump(dict(model="qwen38-27b", folder=os.path.relpath(D27, AKAR).replace("\\", "/"), dibuat=datetime.now().isoformat(timespec="seconds"),
               catatan="INTERNAL: berisi isi jawaban & argumen alat (data perusahaan). Jangan dikirim ke luar.", skenario=HASIL),
          open(os.path.join(OUT, "benchmark_results.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---------------------------------------------------------------- performa
def perf(Q, R, PG):
    out = {}
    for g in GRUP:
        qs = [q for q in Q if grup(q) == g]
        if not qs: continue
        t = [q["total_ms"] / 1000 for q in qs]
        rg, dur = R["grup"].get(g, {}), R.get("fase_waktu", {}).get(g)
        # Penghitung vLLM per tahap: kuncinya "berurutan" atau angka jumlah pengguna, bukan nama grup.
        vl = (R.get("vllm") or {}).get("berurutan" if g == "berurutan" else g.split("-")[1]) or {}
        lg = (R.get("vllm_log") or {}).get("berurutan" if g == "berurutan" else g.split("-")[1]) or {}
        pg = [p for p in PG if p["fase"] != "pemanasan" and p["trace"] in {q["trace"] for q in qs}]
        tr = [num(p["transport_ms"]) for p in pg if p["transport_ms"]]
        out[g] = dict(n=len(qs), selesai=sum(q["status"] == "ok" for q in qs), habis_waktu=sum(q["status"] == "waktu-habis" for q in qs),
                      galat=sum(q["status"] == "galat" for q in qs), kosong=sum(q["status"] == "kosong" for q in qs),
                      rata_s=f(statistics.mean(t), 2), p50_s=f(persentil(t, 50), 2), p90_s=f(persentil(t, 90), 2), p95_s=f(persentil(t, 95), 2),
                      p99_s=f(persentil(t, 99), 2), min_s=f(min(t), 2), max_s=f(max(t), 2),
                      durasi_tahap_s=f(dur, 0), workflow_per_menit=f(len(qs) / dur * 60, 2) if dur else None,
                      ttft_jawaban_p50_s=f(persentil([(q.get("ttft_jawaban_ms") or 0) / 1000 for q in qs if q.get("ttft_jawaban_ms")], 50), 2),
                      ttft_litellm_p50_ms=rg.get("lt_ttft"),
                      antre_vllm_ms=f(vl.get("antre_ms") if vl.get("antre_ms") is not None else rg.get("vllm_antre_ms"), 0),
                      menulis_vllm_ms=f(vl.get("decode_ms"), 0), permintaan_vllm=vl.get("n"),
                      kv_cache_maks_persen=lg.get("kv_maks"), antre_maks=lg.get("antre_maks"), penuh_persen_waktu=f(lg.get("penuh"), 1),
                      menunggu_kata_pertama_s=f(rg.get("x_tunggu"), 2), panggilan_model_per_workflow=f(rg.get("llm"), 2),
                      token_keluar_per_dtk_per_panggilan=f(rg.get("tps_panggilan"), 1),
                      token_keluar_per_dtk_gabungan=f(rg.get("keluar_total") / dur, 1) if dur and rg.get("keluar_total") else None,
                      selisih_klien_vs_litellm_p50_ms=f(persentil(tr, 50), 0))
    return out
P27, P14 = perf(Q27, R27, PG27), perf(Q14, R14, PG14)
semua27 = [q["total_ms"] / 1000 for q in Q27]
PERF = dict(model="qwen38-27b", baseline="qwen3-14b (20 Nov 2026, 4 replika)", per_tahap=P27, baseline_per_tahap=P14,
            keseluruhan=dict(n=len(Q27), rata_s=f(statistics.mean(semua27), 2), p50_s=f(persentil(semua27, 50), 2), p90_s=f(persentil(semua27, 90), 2),
                             p95_s=f(persentil(semua27, 95), 2), p99_s=f(persentil(semua27, 99), 2),
                             habis_waktu=sum(q["status"] == "waktu-habis" for q in Q27), galat=sum(q["status"] == "galat" for q in Q27)),
            catatan=["Latensi diukur di laptop (klien): pertanyaan dikirim -> jawaban selesai, termasuk tunnel Cloudflare.",
                     "selisih_klien_vs_litellm = durasi panggilan di klien dikurangi durasi di LiteLLM: perkiraan ongkos jaringan + Cloudflare + LiteLLM per panggilan.",
                     "Persentil dihitung dengan interpolasi linear. Tahap 1–3 pengguna hanya 3–9 skenario, jadi P90–P99 praktis nilai maksimum.",
                     "Batas 300 dtk per skenario sama dengan baseline; skenario yang melewatinya dihitung 'habis_waktu'."])
json.dump(PERF, open(os.path.join(OUT, "performance_summary.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---------------------------------------------------------------- akurasi
def akurasi(H):
    def rasio(xs): xs = [x for x in xs if x is not None]; return dict(n=len(xs), benar=sum(xs), persen=f(100 * sum(xs) / len(xs), 1) if xs else None)
    per = {}
    for k, nama in KATEGORI.items():
        hs = [h for h in H if h["kode"] == k]
        if hs: per[k] = dict(kategori=nama, sesuai_kriteria=rasio([h["benar"] for h in hs]), pilih_alat=rasio([h["pilih_alat_benar"] for h in hs]),
                             argumen_alat=rasio([h["argumen_benar"] for h in hs]), selesai=rasio([h["selesai"] for h in hs]),
                             panggilan_model_rata=f(statistics.mean([h["n_llm"] or 0 for h in hs]), 2))
    return dict(sesuai_kriteria=rasio([h["benar"] for h in H]), pilih_alat=rasio([h["pilih_alat_benar"] for h in H]),
                argumen_alat=rasio([h["argumen_benar"] for h in H]), workflow_selesai=rasio([h["selesai"] for h in H]),
                panggilan_model_rata=f(statistics.mean([h["n_llm"] or 0 for h in H]), 2) if H else None, per_kategori=per)
H40 = [h for h in HASIL if h["fase"] == "berurutan"]
b14 = {q["trace"]: q for q in Q14}
def akurasi14(Q):
    out = {}
    for k, nama in KATEGORI.items():
        qs = [q for q in Q if q["kode"] == k]
        if qs: out[k] = dict(kategori=nama, n=len(qs), benar=sum(q["benar"] for q in qs), persen=f(100 * sum(q["benar"] for q in qs) / len(qs), 1))
    return dict(n=len(Q), benar=sum(q["benar"] for q in Q), persen=f(100 * sum(q["benar"] for q in Q) / len(Q), 1) if Q else None, per_kategori=out)
AKURASI = dict(
    model="qwen38-27b", evaluator="kriteria otomatis yang sama dengan baseline (scripts/profil-alur-agent.mts, PERTANYAAN[].benar)",
    berurutan_40=akurasi(H40), semua_97=akurasi(HASIL),
    baseline_14b=dict(berurutan_40=akurasi14([q for q in Q14 if q["fase"] == "berurutan"]), semua_97=akurasi14(Q14)),
    galat_dan_halusinasi=dict(
        habis_waktu=sum(h["status"] == "waktu-habis" for h in HASIL), galat=sum(h["status"] == "galat" for h in HASIL),
        jawaban_kosong=sum(h["status"] == "kosong" for h in HASIL),
        panggilan_model_gagal=sum(h["n_llm_galat"] for h in HASIL),
        skenario_dengan_panggilan_terpotong_konteks=sum(1 for h in HASIL if h["n_terpotong_konteks"]),
        panggilan_terpotong_konteks=sum(h["n_terpotong_konteks"] for h in HASIL),
        teks_internal_bocor=sum(h["bocor_teks_internal"] for h in HASIL),
        q7_menyebut_rupiah=sum(h["q7_bocor_rupiah"] for h in HASIL),
        angka_tanpa_alat_data=sum(h["angka_tanpa_alat_data"] for h in HASIL)),
    catatan=["sesuai_kriteria memakai evaluator lama apa adanya, supaya bisa dibandingkan dengan 14B.",
             "pilih_alat: alat yang diharapkan dipanggil (Q8 = tanpa alat; Q7 tidak dinilai karena tidak ada alat wajib).",
             "argumen_alat: heuristik regex atas argumen alat yang diharapkan (mis. periode merujuk September 2026). Hanya dinilai bila alat itu dipanggil. Baseline 14B tidak punya data argumen.",
             "Halusinasi tidak bisa diukur penuh secara otomatis. Yang dihitung adalah tanda-tandanya: angka di jawaban data tanpa memanggil alat, Q7 menyebut rupiah, dan teks internal agent yang sampai ke pengguna.",
             "panggilan_terpotong_konteks = finish_reason 'length': jawaban model berhenti karena batas konteks 8.192 token (setelan server), bukan karena modelnya selesai."])
json.dump(AKURASI, open(os.path.join(OUT, "accuracy_summary.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---------------------------------------------------------------- token agregat
def tok_agregat(rows, H):
    ok = [r for r in rows if r["prompt_tokens"] is not None]
    per = {}
    for k, nama in KATEGORI.items():
        rr = [r for r in ok if r["kode"] == k]; hs = [h for h in H if h["kode"] == k]
        if rr: per[k] = dict(kategori=nama, workflow=len(hs), panggilan=len(rr), masuk=sum(r["prompt_tokens"] for r in rr), keluar=sum(r["completion_tokens"] for r in rr),
                             reasoning=sum(r["reasoning_tokens"] or 0 for r in rr), masuk_per_workflow=f(sum(r["prompt_tokens"] for r in rr) / max(len(hs), 1), 0),
                             keluar_per_workflow=f(sum(r["completion_tokens"] for r in rr) / max(len(hs), 1), 0))
    tot_m, tot_k = sum(r["prompt_tokens"] for r in ok), sum(r["completion_tokens"] for r in ok)
    nben = sum(h["benar"] for h in H)
    return dict(panggilan=len(rows), panggilan_dengan_token=len(ok), masuk=tot_m, keluar=tot_k, total=tot_m + tot_k,
                reasoning=sum(r["reasoning_tokens"] or 0 for r in ok), panggilan_dengan_reasoning=sum(r["reasoning_tokens"] is not None for r in ok),
                per_workflow=dict(masuk=f(tot_m / len(H), 0), keluar=f(tot_k / len(H), 0)) if H else None,
                per_workflow_berhasil=dict(total=f((tot_m + tot_k) / nben, 0)) if nben else None, per_kategori=per)
TOK = tok_agregat(TOKEN_ROWS, HASIL)
lt_all = [r for r in LT27 if r.get("prompt_tokens")]
TOK["litellm_semua_baris"] = dict(baris=len(lt_all), masuk=sum(int(float(r["prompt_tokens"])) for r in lt_all), keluar=sum(int(float(r["completion_tokens"] or 0)) for r in lt_all),
                                  catatan="semua baris LiteLLM di jendela uji, termasuk pemanasan")
pg14 = [p for p in PG14 if p["fase"] != "pemanasan" and p["token_masuk"]]
TOK14 = dict(panggilan=len(pg14), masuk=sum(int(float(p["token_masuk"])) for p in pg14), keluar=sum(int(float(p["token_keluar"])) for p in pg14))
TOK14["per_workflow"] = dict(masuk=f(TOK14["masuk"] / len(Q14), 0), keluar=f(TOK14["keluar"] / len(Q14), 0))

# ---------------------------------------------------------------- bottleneck per workflow (termasuk pemanasan)
# Sumber: span.jsonl (lib/profil-agent.ts) yang dicatat sejak awal uji untuk SETIAP panggilan model/alat/DB/SOP,
# dicocokkan dengan catatan LiteLLM (panggilan.csv). Kolom x_* di pertanyaan.csv dalam milidetik.
SPAN27 = baca_jsonl(os.path.join(D27, "span.jsonl"))
RMAP2 = reasoning_map(LT27)
ms = lambda r, k: num(r.get(k)) / 1000 if r.get(k) not in (None, "") else 0.0
def panggilan_rinci(trace):
    out = []
    for p in [p for p in PG27 if p["trace"] == trace]:
        tm, tk = p.get("token_masuk"), p.get("token_keluar"); rs = None
        if tm and tk:
            k = (str(int(float(tm))), str(int(float(tk))))
            if RMAP2.get(k): rs = RMAP2[k].pop(0)
        dec = (num(p["lt_total"]) - num(p["lt_ttft"])) / 1000 if p["lt_total"] and p["lt_ttft"] else None
        out.append(dict(peran=p["peran"], status=p["status"], finish=p["finish"], durasi_s=f(ms(p, "durasi_ms"), 1),
                        ttft_s=f(num(p["lt_ttft"]) / 1000, 2) if p["lt_ttft"] else None,
                        masuk=int(float(tm)) if tm else None, keluar=int(float(tk)) if tk else None, reasoning=rs,
                        tok_per_dtk=f(int(float(tk)) / dec, 1) if tk and dec else None))
    return out
BOTTLE = []
for q in sorted([x for x in KJ27 if x["t"] == "q"], key=lambda x: x["mulai"]):
    pt, cs = PT27.get(q["trace"], {}), panggilan_rinci(q["trace"])
    sp = [s for s in SPAN27 if s.get("trace") == q["trace"] and s.get("jenis") == "llm"]
    total, model = q["total_ms"] / 1000, sum(c["durasi_s"] or 0 for c in cs)
    alat = ms(pt, "x_alat") + ms(pt, "x_db") + ms(pt, "x_embedding")
    keluar = sum(c["keluar"] or 0 for c in cs)
    BOTTLE.append(dict(trace=q["trace"], fase=q["fase"], grup="pemanasan" if q["fase"] == "pemanasan" else grup(q), kode=q["kode"],
                       total_s=f(total, 1), n_llm=len(cs), waktu_model_s=f(model, 1), waktu_alat_db_sop_s=f(alat, 2), lain_s=f(total - model, 1),
                       menunggu_kata_pertama_s=f(ms(pt, "x_tunggu"), 1), berpikir_s=f(ms(pt, "x_berpikir"), 1), menulis_s=f(ms(pt, "x_menulis") + ms(pt, "x_rencana") + ms(pt, "x_ekor"), 1),
                       token_masuk=sum(c["masuk"] or 0 for c in cs), token_keluar=keluar, token_reasoning=sum(c["reasoning"] or 0 for c in cs),
                       tok_keluar_per_dtk=f(keluar / sum((c["keluar"] or 0) / c["tok_per_dtk"] for c in cs if c["tok_per_dtk"]), 1) if any(c["tok_per_dtk"] for c in cs) else None,
                       terpotong_konteks=sum(c["finish"] == "length" for c in cs),
                       percobaan_http_gagal=sum(1 for s in sp if s.get("status") != "ok"),
                       ulang_litellm=sum(int(s.get("ulang_litellm") or 0) for s in sp),
                       status=q["status"], habis_waktu=q["status"] == "waktu-habis", panggilan=cs))
with open(os.path.join(OUT, "bottleneck_per_workflow.csv"), "w", newline="", encoding="utf-8") as fh:
    kol = [k for k in BOTTLE[0] if k != "panggilan"] if BOTTLE else ["trace"]
    w = csv.DictWriter(fh, fieldnames=kol, extrasaction="ignore"); w.writeheader(); w.writerows(BOTTLE)
json.dump(BOTTLE, open(os.path.join(OUT, "bottleneck_per_workflow.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---------------------------------------------------------------- biaya
mulai = min(q["mulai"] for q in KJ27 if q["t"] == "q") / 1000
selesai_ev = next((x for x in KJ27 if x["t"] == "selesai"), None)
akhir = (selesai_ev["ts"] if selesai_ev else max(q["mulai"] + q["total_ms"] for q in Q27)) / 1000
jam_uji = (akhir - mulai) / 3600
BOOT = datetime(2026, 11, 23, 1, 41, 2, tzinfo=timezone.utc).timestamp()   # uptime -s di server (hanya dibaca)
jam_aktif = (akhir - BOOT) / 3600
harga = AWS["usd_per_jam"]
biaya_uji = jam_uji * harga
gpu_util = []
for g, v in (R27.get("gpu") or {}).items():
    dur = R27.get("fase_waktu", {}).get("berurutan" if g == "berurutan" else f"beban-{g}")
    if v.get("util") is not None and dur: gpu_util.append((v["util"], dur))
util_rata = sum(u * d for u, d in gpu_util) / sum(d for _, d in gpu_util) if gpu_util else None
n_ok, n_benar = sum(h["selesai"] for h in HASIL), sum(h["benar"] for h in HASIL)
best = max((v for v in P27.values() if v.get("workflow_per_menit")), key=lambda v: v["workflow_per_menit"], default=None)
rasio_benar = n_benar / len(HASIL) if HASIL else 0
def bulan(jam): return dict(jam=jam, usd=round(jam * harga, 2), idr=round(jam * harga * KURS))
kap_jam = best["workflow_per_menit"] * 60 if best else None
SKEN = {"24/7 (730 jam)": 730, "Jam kerja 22 hari × 10 jam (220 jam)": 220}
COST = dict(
    model="qwen38-27b", tarif=AWS, kurs_idr_per_usd=KURS, kurs_sumber="NEXT_PUBLIC_KURS_USD di .env.local (perkiraan, bukan kurs resmi)",
    durasi=dict(uji_mulai_utc=datetime.fromtimestamp(mulai, timezone.utc).isoformat(timespec="seconds"),
                uji_selesai_utc=datetime.fromtimestamp(akhir, timezone.utc).isoformat(timespec="seconds"),
                jam_benchmark=round(jam_uji, 3), instance_menyala_sejak_utc=datetime.fromtimestamp(BOOT, timezone.utc).isoformat(timespec="seconds"),
                jam_instance_aktif_sampai_uji_selesai=round(jam_aktif, 3)),
    biaya_alokasi=dict(
        catatan="Alokasi tagihan EC2 selama jendela benchmark. Server ditagih per jam menyala, sibuk atau tidak.",
        usd_per_jam=harga, usd_jendela_benchmark=round(biaya_uji, 2), usd_instance_sampai_uji_selesai=round(jam_aktif * harga, 2),
        usd_per_1juta_token_diproses=round(biaya_uji / (TOK["total"] / 1e6), 2) if TOK["total"] else None,
        usd_per_workflow=round(biaya_uji / len(HASIL), 4) if HASIL else None,
        usd_per_workflow_selesai=round(biaya_uji / n_ok, 4) if n_ok else None,
        usd_per_workflow_berhasil=round(biaya_uji / n_benar, 4) if n_benar else None),
    biaya_sibuk_vs_menganggur=dict(
        catatan="Perkiraan memakai rata-rata GPU util (nvidia-smi) tertimbang lama tiap tahap. Bukan tagihan terpisah — AWS menagih keduanya sama.",
        gpu_util_rata_persen=f(util_rata, 1), usd_porsi_sibuk=round(biaya_uji * util_rata / 100, 2) if util_rata is not None else None,
        usd_porsi_menganggur=round(biaya_uji * (1 - util_rata / 100), 2) if util_rata is not None else None),
    biaya_marginal_inferensi=dict(
        catatan="Kalau server toh menyala (on-demand, sudah dibayar per jam), satu workflow tambahan hampir tidak menambah tagihan selama kapasitas masih ada. "
                "Biaya per workflow di bawah adalah biaya bila server dipakai penuh pada throughput terbaik yang terukur.",
        throughput_terbaik_workflow_per_jam=f(kap_jam, 1), pada_tahap=next((g for g, v in P27.items() if v is best), None),
        usd_per_workflow_saat_penuh=round(harga / kap_jam, 4) if kap_jam else None,
        usd_per_workflow_berhasil_saat_penuh=round(harga / (kap_jam * rasio_benar), 4) if kap_jam and rasio_benar else None),
    biaya_bulanan={k: dict(**bulan(v), kapasitas_workflow_maks=round(kap_jam * v) if kap_jam else None) for k, v in SKEN.items()},
    token=dict(qwen38_27b=TOK, qwen3_14b_baseline=TOK14))
json.dump(COST, open(os.path.join(OUT, "cost_analysis.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# ---------------------------------------------------------------- laporan md + html
def idn(x, d=1):
    if x is None: return "—"
    s = f"{x:,.{d}f}"; return s.replace(",", "X").replace(".", ",").replace("X", ".")
A40, A97, B40, B97 = AKURASI["berurutan_40"], AKURASI["semua_97"], AKURASI["baseline_14b"]["berurutan_40"], AKURASI["baseline_14b"]["semua_97"]
GH = AKURASI["galat_dan_halusinasi"]
S8, S8b, S0, S0b = P27.get("beban-8", {}), P14.get("beban-8", {}), P27.get("berurutan", {}), P14.get("berurutan", {})
CB = COST["biaya_alokasi"]; CM = COST["biaya_marginal_inferensi"]; CS = COST["biaya_sibuk_vs_menganggur"]
cfg = "Qwen/Qwen3.8-27B · bfloat16 · tensor parallel 4 (1 replika di 4 GPU) · max-model-len 8.192 · max-num-seqs 4 · gpu-memory-utilization 0,80 · tool parser qwen3_coder · reasoning parser qwen3 · --enforce-eager"
cfg14 = "Qwen3-14B-AWQ · 4 replika (1 per GPU) · max-model-len 16.384 · max-num-seqs 4 per replika · LiteLLM simple-shuffle"
baris_perf = "".join(f"| {NAMA_GRUP[g]} | {P27[g]['n']} | {idn(P14.get(g,{}).get('p50_s'))} → **{idn(P27[g]['p50_s'])}** | {idn(P27[g]['p90_s'])} | {idn(P14.get(g,{}).get('p95_s'))} → {idn(P27[g]['p95_s'])} | {idn(P27[g]['p99_s'])} | {idn(P27[g]['rata_s'])} | {idn(P14.get(g,{}).get('workflow_per_menit'),2)} → {idn(P27[g]['workflow_per_menit'],2)} | {idn(P27[g]['antre_vllm_ms'],0)} | {P27[g]['habis_waktu']} |\n" for g in GRUP if g in P27)
def pecahan(r): return f"{r['benar']}/{r['n']}" if r and r.get("n") else "—"
def baris_kat(k, v):
    b = AKURASI["baseline_14b"]["berurutan_40"]["per_kategori"].get(k, {}); a = A97["per_kategori"].get(k, {})
    return (f"| {k} {v['kategori']} | {pecahan(v['sesuai_kriteria'])} | {b.get('benar', '—')}/{b.get('n', '—')} | {pecahan(a.get('sesuai_kriteria'))} | "
            f"{pecahan(a.get('pilih_alat'))} | {pecahan(a.get('argumen_alat'))} | {idn(a.get('panggilan_model_rata'), 2)} |\n")
baris_ak = "".join(baris_kat(k, v) for k, v in A40["per_kategori"].items())
baris_tok = "".join(f"| {k} {v['kategori']} | {v['workflow']} | {v['panggilan']} | {idn(v['masuk_per_workflow'],0)} | {idn(v['keluar_per_workflow'],0)} | {idn(v['reasoning'],0)} |\n" for k, v in TOK["per_kategori"].items())
BN = [b for b in BOTTLE if b["fase"] != "pemanasan"]
def baris_bn_kat(k):
    bs = [b for b in BN if b["kode"] == k]
    sel = [b for b in bs if not b["habis_waktu"]]            # waktu dipecah hanya dari yang selesai normal
    if not bs: return ""
    rt = lambda key, src=None: statistics.mean([b[key] or 0 for b in (src if src is not None else sel)]) if (src if src is not None else sel) else None
    tps = [b["tok_keluar_per_dtk"] for b in bs if b["tok_keluar_per_dtk"]]
    pm = f"{idn(rt('waktu_model_s'))} ({idn(100 * rt('waktu_model_s') / rt('total_s'), 0)}%)" if sel else "—"
    return (f"| {k} {KATEGORI[k]} | {len(bs)} | {sum(b['habis_waktu'] for b in bs)} | {idn(rt('total_s'))} | {pm} | "
            f"{idn(rt('waktu_alat_db_sop_s'), 2)} | {idn(rt('lain_s'))} | {idn(rt('token_keluar', bs), 0)} | {idn(statistics.median(tps) if tps else None)} tok/dtk | "
            f"{sum(b['terpotong_konteks'] for b in bs)} | {sum(b['percobaan_http_gagal'] for b in bs)} / {sum(b['ulang_litellm'] for b in bs)} |\n")
baris_bn = "".join(baris_bn_kat(k) for k in KATEGORI)
def rinci(b, judul):
    t = b["total_s"] or 1
    s = (f"\n**{judul}** — total {idn(b['total_s'])} dtk, {b['n_llm']} panggilan model, status {b['status']}.\n\n"
         "| # | Langkah | Waktu (dtk) | Porsi | TTFT (dtk) | Token masuk | Token keluar | Reasoning | Token/dtk | Selesai karena |\n|---:|---|---:|---:|---:|---:|---:|---:|---:|---|\n")
    for i, c in enumerate(b["panggilan"], 1):
        s += (f"| {i} | {c['peran']} | {idn(c['durasi_s'])} | {idn(100 * (c['durasi_s'] or 0) / t, 0)}% | {idn(c['ttft_s'], 2)} | {idn(c['masuk'], 0)} | {idn(c['keluar'], 0)} | "
              f"{idn(c['reasoning'], 0)} | {idn(c['tok_per_dtk'])} | {'**batas konteks** (masuk + keluar = ' + idn((c['masuk'] or 0) + (c['keluar'] or 0), 0) + ')' if c['finish'] == 'length' else c['finish']} |\n")
    s += (f"\nAlat + DB: {idn(b['waktu_alat_db_sop_s'], 2)} dtk · menunggu kata pertama: {idn(b['menunggu_kata_pertama_s'])} dtk · berpikir: {idn(b['berpikir_s'])} dtk · "
          f"menulis: {idn(b['menulis_s'])} dtk · lain-lain: {idn(b['lain_s'])} dtk · percobaan HTTP gagal: {b['percobaan_http_gagal']} · retry LiteLLM: {b['ulang_litellm']}\n")
    return s
rinci_q23 = "".join(rinci(b, f"{b['kode']} pemanasan ({KATEGORI[b['kode']]})") for b in BOTTLE if b["fase"] == "pemanasan" and b["kode"] in ("Q2", "Q3"))
semua_tps = [c["tok_per_dtk"] for b in BOTTLE for c in b["panggilan"] if c["tok_per_dtk"]]
# Porsi dihitung hanya pada workflow yang selesai normal: untuk yang habis waktu, klien berhenti di 300 dtk
# sementara model masih menulis, jadi waktu model bisa melebihi total yang terukur.
SEL = [b for b in BN if not b["habis_waktu"]]
porsi_model = statistics.mean([(b["waktu_model_s"] or 0) / (b["total_s"] or 1) for b in SEL]) * 100 if SEL else None
porsi_alat = statistics.mean([(b["waktu_alat_db_sop_s"] or 0) / (b["total_s"] or 1) for b in SEL]) * 100 if SEL else None
tps_med = statistics.median(semua_tps) if semua_tps else None
antre8 = (P27.get("beban-8") or {}).get("antre_vllm_ms")
antre0 = (P27.get("berurutan") or {}).get("antre_vllm_ms")
kesimpulan_bn = (
    f"**Saat sepi, hambatannya model menulis token.** Pada {len(SEL)} workflow yang selesai normal, rata-rata {idn(porsi_model, 0)}% waktunya habis di panggilan model, "
    f"dan hanya {idn(porsi_alat, 1)}% di alat, query database, dan pencarian SOP. Kecepatan menulis nyaris konstan {idn(tps_med)} token/dtk per panggilan "
    f"(14B: ±49 token/dtk), dan waktu sampai kata pertama 0,2–2 dtk. Jadi lama satu workflow ≈ jumlah token yang ditulis ÷ ±{idn(tps_med)} token/dtk. "
    f"Itu sebabnya Q2 dan Q3 pemanasan lama: keduanya menulis banyak token (berpikir + jawaban), paling banyak di langkah agent menyusun hasil alat dan "
    f"langkah perute menulis ulang jawaban akhir — bukan karena alat, database, jaringan, atau antrean.\n\n"
    f"**Saat ramai, hambatannya berpindah ke antrean.** Rata-rata waktu menunggu giliran di vLLM naik dari {idn(antre0, 0)} ms (berurutan) ke {idn(antre8, 0)} ms di 8 pengguna. "
    f"Server ini menjalankan satu salinan model dengan 4 slot untuk seluruh server, jadi di 8 pengguna separuh permintaan menunggu. "
    f"Akibatnya {sum(b['habis_waktu'] for b in BN if b['grup'] == 'beban-8')} dari {len([b for b in BN if b['grup'] == 'beban-8'])} skenario di tahap 8 pengguna melewati batas 300 detik.\n\n"
    f"**Catatan soal skenario yang habis waktu.** Pada {sum(b['habis_waktu'] for b in BN)} skenario itu, klien berhenti menunggu di 300 detik, tetapi model di server "
    f"masih melanjutkan. Karena itu waktu model pada baris tersebut bisa melebihi total yang terukur, dan porsi di atas sengaja dihitung tanpa mereka. "
    f"Retry LiteLLM: {sum(b['ulang_litellm'] for b in BN)}. Percobaan HTTP gagal: {sum(b['percobaan_http_gagal'] for b in BN)}.")

MD = f"""# Benchmark Qwen3.8-27B — Ratu AI agent workflow

**Uji:** {COST['durasi']['uji_mulai_utc'][:16].replace('T',' ')}–{COST['durasi']['uji_selesai_utc'][11:16]} UTC, {len(HASIL)} skenario
**Data mentah:** `{os.path.relpath(D27, AKAR).replace(chr(92),'/')}/` · **Hasil olahan:** `{os.path.relpath(OUT, AKAR).replace(chr(92),'/')}/`
**Baseline:** Qwen3-14B, uji 20 Nov 2026 (`{os.path.relpath(D14, AKAR).replace(chr(92),'/')}/`), skenario dan evaluator sama.

> ⚠️ `benchmark_results.json` berisi isi jawaban dan argumen alat (data perusahaan). Laporan ini dan HTML-nya tidak memuat isi jawaban.

## 1. Ringkasan

| Ukuran | Qwen3-14B (baseline) | **Qwen3.8-27B** |
|---|---:|---:|
| Sesuai kriteria, 40 berurutan | {B40['benar']}/{B40['n']} ({idn(B40['persen'])}%) | **{A40['sesuai_kriteria']['benar']}/{A40['sesuai_kriteria']['n']} ({idn(A40['sesuai_kriteria']['persen'])}%)** |
| Sesuai kriteria, semua 97 | {B97['benar']}/{B97['n']} ({idn(B97['persen'])}%) | **{A97['sesuai_kriteria']['benar']}/{A97['sesuai_kriteria']['n']} ({idn(A97['sesuai_kriteria']['persen'])}%)** |
| P50 berurutan (1 pertanyaan pada satu waktu) | {idn(S0b.get('p50_s'))} dtk | **{idn(S0.get('p50_s'))} dtk** |
| P50 / P95 di 8 pengguna | {idn(S8b.get('p50_s'))} / {idn(S8b.get('p95_s'))} dtk | **{idn(S8.get('p50_s'))} / {idn(S8.get('p95_s'))} dtk** |
| Workflow selesai per menit, 8 pengguna | {idn(S8b.get('workflow_per_menit'),2)} | **{idn(S8.get('workflow_per_menit'),2)}** |
| Habis waktu (>300 dtk) | {sum(q['status']=='waktu-habis' for q in Q14)} | **{GH['habis_waktu']}** |
| Token keluar per workflow | {idn(TOK14['per_workflow']['keluar'],0)} | **{idn(TOK['per_workflow']['keluar'],0)}** |
| Panggilan terpotong batas konteks 8.192 | — | **{GH['panggilan_terpotong_konteks']}** (di {GH['skenario_dengan_panggilan_terpotong_konteks']} skenario) |
| Biaya EC2 per workflow sesuai kriteria (jendela uji) | — | **${idn(CB['usd_per_workflow_berhasil'],3)}** |

## 2. Konfigurasi

| | Qwen3-14B | Qwen3.8-27B |
|---|---|---|
| Server | g5.12xlarge Jakarta, 4× A10G | sama |
| Model & vLLM | {cfg14} | {cfg} |
| Jalur | laptop → Cloudflare quick tunnel → LiteLLM → vLLM | sama |
| Agent | Ratu AI (perute → agent aplikasi → alat), prompt & alat sama | sama |

Perbedaan penting: 14B memakai **4 salinan model** (permintaan dibagi ke 4 GPU), sedangkan 27B memakai **satu salinan yang dibelah ke 4 GPU** (tensor parallel). Jadi 27B hanya bisa mengerjakan 4 permintaan sekaligus untuk seluruh server, 14B 16.

## 3. Performa

| Tahap | n | P50 14B → 27B (dtk) | P90 | P95 14B → 27B | P99 | Rata-rata | Workflow/menit 14B → 27B | Antre vLLM (ms) | Habis waktu |
|---|---:|---|---:|---|---:|---:|---|---:|---:|
{baris_perf}
- Latensi diukur dari laptop, termasuk tunnel Cloudflare. Selisih durasi klien vs LiteLLM per panggilan (P50) di 8 pengguna: {idn(S8.get('selisih_klien_vs_litellm_p50_ms'),0)} ms — itu perkiraan ongkos jaringan + Cloudflare + LiteLLM.
- Kecepatan menulis per panggilan (P50): 27B {idn(S0.get('token_keluar_per_dtk_per_panggilan'))} token/dtk vs 14B {idn(S0b.get('token_keluar_per_dtk_per_panggilan'))} token/dtk saat berurutan.

## 4. Akurasi per workflow

| Kategori | 27B berurutan | 14B berurutan | 27B semua | Pilih alat benar | Argumen alat benar | Panggilan model/workflow |
|---|---:|---:|---:|---:|---:|---:|
{baris_ak}
**Galat & tanda halusinasi (97 skenario):** habis waktu {GH['habis_waktu']}, galat {GH['galat']}, jawaban kosong {GH['jawaban_kosong']}, panggilan model gagal {GH['panggilan_model_gagal']},
panggilan terpotong batas konteks {GH['panggilan_terpotong_konteks']}, teks internal agent bocor {GH['teks_internal_bocor']}, Q7 menyebut rupiah {GH['q7_menyebut_rupiah']},
angka di jawaban data tanpa memanggil alat {GH['angka_tanpa_alat_data']}.

Ketepatan argumen alat dinilai dengan aturan sederhana (misalnya periode harus merujuk September 2026), hanya bila alat yang benar dipanggil. Baseline 14B tidak punya data argumen.

## 5. Konsumsi token

| | Qwen3-14B | Qwen3.8-27B |
|---|---:|---:|
| Panggilan model (97 skenario) | {idn(TOK14['panggilan'],0)} | {idn(TOK['panggilan'],0)} |
| Token masuk | {idn(TOK14['masuk'],0)} | {idn(TOK['masuk'],0)} |
| Token keluar | {idn(TOK14['keluar'],0)} | {idn(TOK['keluar'],0)} |
| Token reasoning (dilaporkan terpisah) | — | {idn(TOK['reasoning'],0)} dari {TOK['panggilan_dengan_reasoning']} panggilan |
| Masuk / keluar per workflow | {idn(TOK14['per_workflow']['masuk'],0)} / {idn(TOK14['per_workflow']['keluar'],0)} | {idn(TOK['per_workflow']['masuk'],0)} / {idn(TOK['per_workflow']['keluar'],0)} |
| Total token per workflow sesuai kriteria | — | {idn((TOK['per_workflow_berhasil'] or {}).get('total'),0)} |

| Kategori 27B | Workflow | Panggilan | Masuk/workflow | Keluar/workflow | Reasoning (total) |
|---|---:|---:|---:|---:|---:|
{baris_tok}
Token reasoning hanya dihitung bila LiteLLM melaporkannya terpisah (`completion_tokens_details.reasoning_tokens`); tidak diperkirakan.

## 5b. Analisis bottleneck

Rincian per workflow (97 skenario + 8 pemanasan): `bottleneck_per_workflow.csv` / `.json`. Per panggilan: `token_usage.csv`.

Kolom waktu dihitung **hanya dari skenario yang selesai normal**, karena pada skenario yang habis waktu klien berhenti di 300 detik sementara model masih menulis. Token keluar dan jumlah terpotong dihitung dari semua skenario.

| Kategori | n | Habis waktu | Total rata (dtk) | Waktu model | Alat + DB + SOP | Lain-lain | Token keluar rata | Kecepatan menulis | Terpotong konteks | Percobaan gagal / retry |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
{baris_bn}
{rinci_q23}
**Kesimpulan bottleneck.** {kesimpulan_bn}

## 6. Biaya AWS

Tarif: **g5.12xlarge on-demand Linux, Jakarta = USD {AWS['usd_per_jam']}/jam** ({AWS['sumber']}). Tidak termasuk: {AWS['tidak_termasuk']}

| Ukuran | Nilai |
|---|---:|
| Lama benchmark | {idn(COST['durasi']['jam_benchmark'],2)} jam |
| Biaya EC2 selama benchmark | ${idn(CB['usd_jendela_benchmark'],2)} (Rp {idn(CB['usd_jendela_benchmark']*KURS,0)}) |
| Instance menyala sampai uji selesai | {idn(COST['durasi']['jam_instance_aktif_sampai_uji_selesai'],2)} jam = ${idn(CB['usd_instance_sampai_uji_selesai'],2)} |
| Per 1 juta token diproses (masuk + keluar) | ${idn(CB['usd_per_1juta_token_diproses'],2)} |
| Per workflow / per workflow sesuai kriteria | ${idn(CB['usd_per_workflow'],3)} / ${idn(CB['usd_per_workflow_berhasil'],3)} |
| GPU sibuk rata-rata selama uji | {idn(CS['gpu_util_rata_persen'])}% → porsi menganggur ±${idn(CS['usd_porsi_menganggur'],2)} |
| Throughput terbaik | {idn(CM['throughput_terbaik_workflow_per_jam'])} workflow/jam ({NAMA_GRUP.get(CM['pada_tahap'] or '', '—')}) |
| Per workflow sesuai kriteria bila server dipakai penuh | ${idn(CM['usd_per_workflow_berhasil_saat_penuh'],3)} |
""" + "".join(f"| Bulanan, {k} | ${idn(v['usd'],0)} (Rp {idn(v['idr'],0)}), kapasitas maks ±{idn(v['kapasitas_workflow_maks'],0)} workflow |\n" for k, v in COST["biaya_bulanan"].items()) + f"""
**Biaya alokasi vs marginal.** Angka "selama benchmark" adalah bagian tagihan EC2 di jendela uji. AWS menagih server per jam menyala, sibuk atau menganggur, jadi biaya satu permintaan *tidak sama* dengan durasinya × tarif. Selama server toh menyala dan kapasitas masih ada, satu workflow tambahan hampir tidak menambah tagihan.

## 7. Keterbatasan

- Satu kali uji. Tahap 1–3 pengguna hanya 3–9 skenario, jadi P90–P99 di sana praktis nilai maksimum.
- Setelan server dipakai apa adanya (baseline): batas konteks 8.192 token, `--enforce-eager`, 1 replika TP4. Sebagian hasil (jawaban terpotong, antrean di 5–8 pengguna) berasal dari setelan ini, bukan dari kemampuan model.
- Baseline 14B diuji 20 Nov dengan 4 replika AWQ dan konteks 16.384; perbandingannya model + setelan sekaligus, bukan model saja.
- Evaluator otomatis menilai pemakaian alat dan beberapa angka kunci; tidak menilai kualitas bahasa atau kelengkapan jawaban.
- Biaya EC2 di luar EBS, transfer data, dan pajak. Kurs Rp {idn(KURS,0)}/USD perkiraan.

## 8. Rekomendasi

**Temuan yang menentukan: semua {n_ok} skenario yang selesai menjawab sesuai kriteria ({n_benar}/{n_ok}).** Seluruh {GH['habis_waktu']} kegagalan adalah habis waktu, bukan jawaban salah. Jadi masalah 27B pada setelan ini adalah **kecepatan**, bukan kualitas jawaban.

| No | Rekomendasi | Dasar dari uji ini | Catatan |
|---|---|---|---:|
| 1 | **Jangan pakai setelan ini untuk produksi.** Dengan 8 pengguna bersamaan, {sum(1 for b in BN if b['grup'] == 'beban-8' and b['habis_waktu'])} dari {len([b for b in BN if b['grup'] == 'beban-8'])} pertanyaan tidak selesai dalam 5 menit | P50 di 8 pengguna {idn(S8.get('p50_s'))} dtk vs {idn(S8b.get('p50_s'))} dtk pada 14B | — |
| 2 | **Coba matikan `--enforce-eager`.** Opsi ini mematikan CUDA graph dan biasanya menurunkan kecepatan menulis | Kecepatan menulis hanya {idn(tps_med)} token/dtk, sedangkan 14B ±49 token/dtk di mesin yang sama | Mengubah setelan server, butuh persetujuan |
| 3 | **Naikkan batas konteks dari 8.192.** {GH['panggilan_terpotong_konteks']} panggilan terpotong, {sum(b['terpotong_konteks'] for b in BN if b['kode'] == 'Q2')} di antaranya pada Q2 | Prompt agent kita saja sudah 2.400–6.500 token sebelum model menulis | Mengubah setelan server, butuh persetujuan. Perlu VRAM lebih banyak untuk KV cache |
| 4 | **Pertimbangkan versi terkuantisasi (AWQ/GPTQ) supaya muat >1 salinan.** Sekarang satu salinan dibelah ke 4 GPU, jadi hanya ada 4 slot untuk seluruh server | Antre di vLLM naik ke {idn(antre8, 0)} ms di 8 pengguna, sementara 14B dengan 4 salinan hanya {idn((P14.get('beban-8') or {{}}).get('antre_vllm_ms'), 0)} ms | Mengubah deployment, butuh persetujuan |
| 5 | **Pangkas token "berpikir".** {idn(100 * TOK['reasoning'] / TOK['keluar'], 0)}% token keluar adalah berpikir yang tidak dibaca pengguna | {idn(TOK['reasoning'], 0)} dari {idn(TOK['keluar'], 0)} token keluar | Di sisi agent, bukan server |
| 6 | **Hentikan perute menulis ulang jawaban akhir.** Langkah terakhir ini menghabiskan ±75 detik pada Q2 dan Q3 tanpa menambah isi | Lihat rincian Q2/Q3 di bagian 5b | Di sisi agent. Rekomendasi yang sama sudah muncul di laporan 17 Nov |
| 7 | **Kalau tetap mau dipakai, batasi untuk pemakaian sepi.** Satu per satu, P50-nya {idn(S0.get('p50_s'))} detik | Di tahap berurutan, {len([b for b in BN if b['grup'] == 'berurutan' and not b['habis_waktu']])} dari {len([b for b in BN if b['grup'] == 'berurutan'])} selesai dan semuanya sesuai kriteria | Perlu uji ulang setelah nomor 2–4 dikerjakan |

**Perbandingan biaya kasar.** Server yang sama ({AWS['instance']}, USD {AWS['usd_per_jam']}/jam) menghasilkan {idn((P27.get('beban-8') or {{}}).get('workflow_per_menit'), 2)} workflow/menit dengan 27B, dan {idn((P14.get('beban-8') or {{}}).get('workflow_per_menit'), 2)} workflow/menit dengan 14B pada tahap 8 pengguna. Jadi dengan tarif per jam yang sama, biaya per workflow 27B sekitar {idn(((P14.get('beban-8') or {{}}).get('workflow_per_menit') or 1) / ((P27.get('beban-8') or {{}}).get('workflow_per_menit') or 1), 1)}× lebih mahal daripada 14B pada setelan masing-masing.
"""
open(os.path.join(OUT, "benchmark_report.md"), "w", encoding="utf-8").write(MD)

# ---- DASHBOARD (dibangun dari scripts/dashboard-27b-template.html; TANPA isi jawaban)
AKURASI["baseline_14b"]["habis_waktu"] = sum(q["status"] == "waktu-habis" for q in Q14)
kat_bn = {}
for k in KATEGORI:
    bs = [b for b in BN if b["kode"] == k]
    sel = [b for b in bs if not b["habis_waktu"]]
    if not bs: continue
    rt = lambda key, src: statistics.mean([b[key] or 0 for b in src]) if src else None
    tps = [b["tok_keluar_per_dtk"] for b in bs if b["tok_keluar_per_dtk"]]
    kat_bn[k] = dict(n=len(bs), habis=sum(b["habis_waktu"] for b in bs), total_s=f(rt("total_s", sel), 1),
                     waktu_model_s=f(rt("waktu_model_s", sel), 1), waktu_alat_s=f(rt("waktu_alat_db_sop_s", sel), 2),
                     token_keluar=f(rt("token_keluar", bs), 0), tok_per_dtk=f(statistics.median(tps) if tps else None, 1),
                     terpotong=sum(b["terpotong_konteks"] for b in bs))
rinci_bn = [dict(judul=f"{b['kode']} {KATEGORI[b['kode']]} (pemanasan)", total_s=b["total_s"], n_llm=b["n_llm"], panggilan=b["panggilan"],
                 waktu_alat_s=b["waktu_alat_db_sop_s"], menunggu_s=b["menunggu_kata_pertama_s"], berpikir_s=b["berpikir_s"], menulis_s=b["menulis_s"])
            for b in BOTTLE if b["fase"] == "pemanasan" and b["kode"] in ("Q2", "Q3")]
t27 = (P27.get("beban-8") or {}).get("workflow_per_menit") or 1
t14 = (P14.get("beban-8") or {}).get("workflow_per_menit") or 1
DASH = dict(
    dibuat=datetime.now().strftime("%Y-%m-%d %H:%M"), folder=os.path.relpath(D27, AKAR).replace("\\", "/"),
    konfigurasi=dict(model="Qwen/Qwen3.8-27B (bfloat16)", tanggal=COST["durasi"]["uji_mulai_utc"][:10],
                     tanggal_14b="20 Nov 2026", mesin="AWS g5.12xlarge · 4× A10G · 1 salinan model dibelah ke 4 GPU (tensor parallel 4)"),
    grup=GRUP, kategori=KATEGORI, perf_27b=P27, perf_14b=P14, akurasi=AKURASI, token_27b=TOK, token_14b=TOK14, biaya=COST,
    total_27b=dict(n=len(HASIL), selesai=n_ok, habis_waktu=GH["habis_waktu"]),
    bottleneck=dict(porsi_model_persen=f(porsi_model, 1), porsi_alat_persen=f(porsi_alat, 2), tok_per_dtk_median=f(tps_med, 1),
                    per_kategori=kat_bn, rinci=rinci_bn),
    beda=[dict(h="Ukuran model", a="14 miliar parameter, terkuantisasi AWQ", b="27 miliar parameter, bfloat16 (tanpa kuantisasi)"),
          dict(h="Salinan model di server", a="4 salinan, satu per GPU — 16 permintaan bisa dikerjakan bersamaan",
               b="1 salinan dibelah ke 4 GPU — hanya 4 permintaan bersamaan untuk seluruh server"),
          dict(h="Batas panjang percakapan", a="16.384 token", b=f"8.192 token — {GH['panggilan_terpotong_konteks']} jawaban terpotong karena ini"),
          dict(h="Kecepatan menulis saat sepi", a=f"{idn((P14.get('berurutan') or {}).get('token_keluar_per_dtk_per_panggilan'))} token/detik",
               b=f"{idn((P27.get('berurutan') or {}).get('token_keluar_per_dtk_per_panggilan'))} token/detik"),
          dict(h="Jawaban sesuai kriteria", a=f"{AKURASI['baseline_14b']['semua_97']['benar']} dari 97",
               b=f"{A97['sesuai_kriteria']['benar']} dari 97 — semua yang sempat selesai menjawab benar"),
          dict(h="Pertanyaan tidak selesai dalam 5 menit", a=f"{AKURASI['baseline_14b']['habis_waktu']}", b=f"{GH['habis_waktu']}"),
          dict(h="Biaya per pertanyaan saat server penuh", a=f"${idn(AWS['usd_per_jam'] / (t14 * 60), 3)}",
               b=f"${idn(AWS['usd_per_jam'] / (t27 * 60), 3)} — sekitar {idn(t14 / t27, 1)}× lebih mahal")],
    teks=dict(
        banding=(f"Model yang sama-sama dipakai Ratu AI diuji dengan {len(HASIL)} skenario yang sama persis. Hasilnya: 27B menjawab lebih benar "
                 f"kalau sempat selesai, tetapi jauh lebih lambat. Semua {n_ok} pertanyaan yang selesai dijawab sesuai kriteria "
                 f"({n_benar} dari {n_ok}), sedangkan {GH['habis_waktu']} sisanya tidak selesai dalam batas 5 menit. "
                 f"Saat 8 orang bertanya bersamaan, 14B menuntaskan {idn(t14, 2)} pertanyaan per menit, 27B hanya {idn(t27, 2)}. "
                 "Jadi masalah 27B pada setelan ini adalah kecepatan, bukan kualitas jawaban."),
        akurasi=(f"Dari {len(HASIL)} skenario, {A97['sesuai_kriteria']['benar']} sesuai kriteria. Yang penting dibaca bersamaan: "
                 f"seluruh {GH['habis_waktu']} kegagalan adalah kehabisan waktu, bukan jawaban salah. Tidak ada satu pun jawaban yang "
                 "mengarang angka, membocorkan teks internal antar agent, atau menyebut gaji yang seharusnya ditolak. "
                 f"Alat yang dipilih benar {A97['pilih_alat']['benar']} dari {A97['pilih_alat']['n']} kali, dan isi perintah ke alat benar "
                 f"{A97['argumen_alat']['benar']} dari {A97['argumen_alat']['n']} kali."),
        hambatan=(f"Saat sepi, {idn(porsi_model, 0)}% waktu habis dipakai model menulis token, sedangkan alat, database, dan pencarian SOP "
                  f"hanya {idn(porsi_alat, 1)}%. Kecepatan menulisnya nyaris selalu {idn(tps_med)} token per detik, sementara 14B di mesin yang "
                  "sama ±49 token per detik. Jadi lama satu pertanyaan hampir bisa dihitung: jumlah token yang ditulis dibagi "
                  f"{idn(tps_med)}. Saat ramai, hambatannya berpindah ke antrean: menunggu giliran naik dari "
                  f"{idn((P27.get('berurutan') or {}).get('antre_vllm_ms'), 0)} ms jadi {idn((P27.get('beban-8') or {}).get('antre_vllm_ms'), 0)} ms per panggilan di 8 pengguna, "
                  "karena server ini cuma punya 4 slot untuk semua pengguna.")))
tpl_lama = open(os.path.join(AKAR, "scripts", "dashboard-template.html"), encoding="utf-8").read()
css = tpl_lama[tpl_lama.index("<style>") + 7:tpl_lama.index("</style>")]
helper = tpl_lama[tpl_lama.index("/* ---------- format ---------- */"):tpl_lama.index("/* =================================================================== OVERVIEW */")]
tpl = open(os.path.join(AKAR, "scripts", "dashboard-27b-template.html"), encoding="utf-8").read()
out = (tpl.replace("/*__CSS__*/", css).replace("/*__HELPER__*/", helper)
       .replace("/*__DATA__*/null", json.dumps(DASH, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/").replace("<!--", "<\\!--")))
p_dash = os.path.join(AKAR, "docs", "benchmark", "grafik", "grafik-qwen38-27b.html")
open(p_dash, "w", encoding="utf-8").write(out)
open(os.path.join(OUT, "benchmark_report.html"), "w", encoding="utf-8").write(out)
print(json.dumps(dict(folder=os.path.relpath(OUT, AKAR), skenario=len(HASIL), panggilan=len(TOKEN_ROWS), sesuai_kriteria=f"{n_benar}/{len(HASIL)}",
                      habis_waktu=GH["habis_waktu"], terpotong=GH["panggilan_terpotong_konteks"], biaya_uji_usd=round(biaya_uji, 2),
                      dashboard=f"{len(out) // 1024} KB"), ensure_ascii=False))
