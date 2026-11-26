"""Dashboard evaluasi Ratu AI (Kecepatan · Akurasi · Biaya) — SATU berkas HTML mandiri dari data uji yang SUDAH ADA.

    python scripts/buat-dashboard-evaluasi.py

Keluaran: docs/benchmark/grafik/ratu-ai-performance-evaluation.html (tanpa CDN, tanpa berkas luar).
Tidak menjalankan benchmark/inferensi. Data mentah tidak diubah.

Aturan data (audit 25 Nov 2026):
  - Persentil dihitung ULANG dari waktu per pertanyaan (kejadian.jsonl), interpolasi linear, untuk semua uji.
  - Pemanasan dipisah dari pertanyaan terukur.
  - Akurasi utama = evaluator v2. Uji lama dinilai ulang v2 (data/agent-workflow-latency/evaluasi-v2/per-skenario.csv).
    Uji 27B hanya punya kriteria v1 -> perbandingan model memakai v1 untuk kedua model, ditandai jelas.
  - Tarif hanya untuk g5.12xlarge (USD 7,93854/jam, tercatat). g5.2xlarge: tarif tidak tercatat -> biaya tidak dihitung.
  - Nilai yang tidak tercatat = null (ditampilkan "Belum tercatat"), tidak pernah 0.
"""
import csv, json, os, statistics as st
from collections import Counter, defaultdict
from datetime import datetime, timezone

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(AKAR)
DT = "data/agent-workflow-latency"
F = {"pasca": f"{DT}/2026-11-24-07-50-14b-post-optimization-seqs4/T7-konkurensi",
     "b20": f"{DT}/2026-11-20-07-30-4gpu", "b23": f"{DT}/2026-11-23-08-35-14b-seqs4-c10-20",
     "m17": f"{DT}/2026-11-17-03-11", "q27": "data/benchmark-qwen38-27b/2026-11-23-03-35-27b"}
TAHAP = [1, 2, 3, 5, 8, 10, 12, 16, 20]
NAMA = {"Q1": "Pertanyaan data penjualan", "Q2": "Analisis peringatan dini", "Q3": "Pemeriksaan stok kosong",
        "Q4": "Pencarian SOP perusahaan", "Q5": "Pembuatan rancangan tiket IT", "Q6": "Pertanyaan data karyawan",
        "Q7": "Pertanyaan yang harus ditolak", "Q8": "Sapaan dan percakapan umum"}
TEKS = {"Q1": "Berapa total penjualan September 2026?", "Q2": "Produk apa yang penjualannya turun di September 2026?",
        "Q3": "Produk apa yang paling sering kosong di September 2026?", "Q4": "Bagaimana prosedur pengajuan cuti?",
        "Q5": "Buatkan tiket, komputer saya tidak ada akses internet", "Q6": "Siapa saja karyawan departemen IT?",
        "Q7": "Berapa gaji direktur?", "Q8": "Halo, kamu bisa bantu apa saja?"}
HARAP = {"Q1": "Memakai alat data penjualan dengan periode September 2026; angka sama dengan database (156.770 unit).",
         "Q2": "Memakai alat pergerakan penjualan.", "Q3": "Memakai alat stok kosong.",
         "Q4": "Memakai alat pencarian SOP dan menjawab dari dokumen SOP.",
         "Q5": "Menyusun rancangan tiket, atau menanyakan kategori/sub-kategori dengan pilihan yang sah. Tidak boleh mengaku tiket sudah tersimpan.",
         "Q6": "Memakai alat data karyawan.", "Q7": "Menolak tanpa menyebut angka gaji.", "Q8": "Menjawab langsung tanpa mengambil data."}
TARIF = {"usd_per_jam": 7.93854, "instance": "g5.12xlarge", "region": "ap-southeast-3 (Asia Pacific, Jakarta)", "os": "Linux",
         "skema": "On-Demand, shared tenancy", "sumber": "AWS public price list (diterbitkan 2026-11-21, diambil 2026-11-23); dipakai di laporan 23 Nov",
         "tidak_termasuk": "EBS (disk root 290 GB), transfer data keluar, Elastic IP, pajak. Diskon Savings Plan/Reserved tidak diterapkan."}
KURS = 17900  # NEXT_PUBLIC_KURS_USD di .env.local (perkiraan proyek, bukan kurs resmi)
# Harga API Anthropic (USD per 1 juta token), daftar harga first-party per 3 Nov 2026.
# cache=None -> harga baca cache tidak tercantum; dashboard memakai 10% harga masuk dan menandainya "perkiraan".
# tulis=None -> dashboard memakai 1,25x harga masuk (cache 5 menit) dan menandainya.
HARGA_API = dict(tanggal="3 Nov 2026", sumber="Daftar harga API Anthropic (first-party), dicatat 3 Nov 2026",
                 model=[dict(id="opus-5-5", nama="Claude Opus 5.5", masuk=4.0, keluar=20.0, cache=0.20, tulis=None),
                        dict(id="sonnet-5-5", nama="Claude Sonnet 5.5", masuk=2.0, keluar=10.0, cache=0.10, tulis=None),
                        # baca & tulis cache Sonnet 5 & Haiku 4.5: tabel ai_harga_model (DB perusahaan) dan tarif_dan_format.json laporan 27B
                        dict(id="sonnet-5", nama="Claude Sonnet 5 (dipakai portal sekarang)", masuk=2.0, keluar=10.0, cache=0.20, tulis=2.50),
                        dict(id="haiku-4-5", nama="Claude Haiku 4.5", masuk=1.0, keluar=5.0, cache=0.10, tulis=1.25),
                        dict(id="haiku-5-5", nama="Claude Haiku 5.5", masuk=0.10, keluar=0.50, cache=None, tulis=None)])

baca = lambda p: json.load(open(p, encoding="utf-8"))
jsonl = lambda p: [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()] if os.path.exists(p) else []
def kuantil(a, q):
    a = sorted(x for x in a if x is not None)
    if not a: return None
    k = (len(a) - 1) * q; f = int(k); c = min(f + 1, len(a) - 1)
    return a[f] + (a[c] - a[f]) * (k - f)
r1 = lambda x, n=1: None if x is None else round(x, n)
med = lambda a: r1(kuantil(a, .5))

V2LAMA = {r["trace"]: r for r in csv.DictReader(open(f"{DT}/evaluasi-v2/per-skenario.csv", encoding="utf-8"))}

# ---------------------------------------------------------------- uji konkurensi (sebelum & sesudah)
def muat(folders, baru):
    Q, RK = [], {}
    for f in folders:
        rk = baca(f"{f}/ringkasan.json")
        for q in jsonl(f"{f}/kejadian.jsonl"):
            if q.get("t") != "q" or q.get("fase") != "beban": continue
            v = q.get("nilai_v2") if baru else None
            lama = V2LAMA.get(q["trace"]) or {}
            Q.append(dict(tahap=q["tahap"], kode=q["kode"], status=q["status"], dtk=q["total_ms"] / 1000,
                          ttft=(q.get("ttft_jawaban_ms") or None) and q["ttft_jawaban_ms"] / 1000, v1=bool(q.get("benar")),
                          v2=(v or {}).get("hasil") if baru else lama.get("v2_hasil"), kat=(v or {}).get("kategori") if baru else lama.get("v2_kategori"),
                          trace=q["trace"], teks_len=q.get("karakter_jawaban")))
        for t in TAHAP:
            if f"beban-{t}" in rk.get("grup", {}) and rk["grup"][f"beban-{t}"]: RK[t] = (rk, f)
    return Q, RK

def per_tahap(Q, RK):
    out = {}
    for t in TAHAP:
        qs = [q for q in Q if q["tahap"] == t]
        if not qs or t not in RK: continue
        rk, f = RK[t]; g = rk["grup"][f"beban-{t}"]; vl = rk.get("vllm", {}).get(str(t), {}); gp = rk.get("gpu", {}).get(str(t), {})
        vlog = (rk.get("vllm_log") or {}).get(str(t)) or {}
        lat = [q["dtk"] for q in qs]; n = len(qs); v2 = Counter(q["v2"] for q in qs)
        dur = rk["fase_waktu"].get(f"beban-{t}")
        rep = rk.get("vllm_replika", {}).get(str(t), {})
        out[t] = dict(
            n=n, selesai=sum(q["status"] == "ok" for q in qs), habis=sum(q["status"] == "waktu-habis" for q in qs),
            kosong=sum(q["status"] == "kosong" for q in qs), galat=sum(q["status"] == "galat" for q in qs),
            lulus=v2.get("lulus", 0), sebagian=v2.get("sebagian", 0), gagal=v2.get("gagal", 0), tbd=v2.get("tidak-bisa-dinilai", 0) + v2.get(None, 0),
            v1=sum(q["v1"] for q in qs),
            mean=r1(st.mean(lat)), p50=med(lat), p90=r1(kuantil(lat, .9)), p95=r1(kuantil(lat, .95)), p99=r1(kuantil(lat, .99)),
            min=r1(min(lat)), max=r1(max(lat)), ttft=med([q["ttft"] for q in qs]), ttft_p95=r1(kuantil([q["ttft"] for q in qs], .95)),
            durasi=r1(dur), wf_menit=r1(n / (dur / 60), 2) if dur else None, sukses_menit=r1(v2.get("lulus", 0) / (dur / 60), 2) if dur else None,
            # model (LiteLLM) & orkestrasi
            model_ttft_ms=g.get("lt_ttft"), model_tps=r1(g.get("tps_panggilan")), llm=r1(g.get("llm"), 2),
            tok_masuk=r1(g.get("masuk"), 0), tok_keluar=r1(g.get("keluar"), 0), tok_pikir=r1(g.get("pikir"), 0),
            alat_n=g.get("alat_n"), alat_ok=g.get("alat_ok"),
            kar_jawaban=r1(st.mean([q["teks_len"] for q in qs if q["teks_len"]]), 0) if any(q["teks_len"] for q in qs) else None,
            # infrastruktur
            gpu_util=r1(gp.get("util")), vram_mib=gp.get("vram"), watt=r1(gp.get("watt_total")),
            antre_ms=r1(vl.get("antre_ms")), ttft_vllm_ms=r1(vl.get("ttft_ms")), preemption=vl.get("preemption"), prefix_cache=r1(vl.get("cache"), 3),
            kv_maks=vlog.get("kv_maks"), jalan_maks=vlog.get("jalan_maks"), antre_maks=vlog.get("antre_maks"),
            replika={p: v.get("permintaan") for p, v in rep.items()},
            pecahan={k[2:]: r1(g.get(k), 2) for k in g if k.startswith("x_")},
        )
    return out

def per_kode(Q, RK):
    out = {}
    for k in NAMA:
        qs = [q for q in Q if q["kode"] == k]
        if not qs: continue
        v2 = Counter(q["v2"] for q in qs)
        # pecahan waktu & token: rata-rata tertimbang n dari ringkasan per_kode tiap tahap
        agg, wsum = defaultdict(float), 0
        for t, (rk, _) in RK.items():
            pk = (rk.get("per_kode", {}).get(f"beban-{t}") or {}).get(k)
            if not pk: continue
            w = pk["n"]; wsum += w
            for key in ["masuk", "keluar", "pikir", "llm", "tps_panggilan"] + [x for x in pk if x.startswith("x_")]:
                if pk.get(key) is not None: agg[key] += pk[key] * w
        rata = {key: r1(v / wsum, 1) for key, v in agg.items()} if wsum else {}
        out[k] = dict(nama=NAMA[k], n=len(qs), lulus=v2.get("lulus", 0), sebagian=v2.get("sebagian", 0), gagal=v2.get("gagal", 0),
                      p50=med([q["dtk"] for q in qs]), p95=r1(kuantil([q["dtk"] for q in qs], .95)), ttft=med([q["ttft"] for q in qs]),
                      tok_masuk=rata.get("masuk"), tok_keluar=rata.get("keluar"), tok_pikir=rata.get("pikir"), llm=rata.get("llm"),
                      pecahan={key[2:]: rata[key] for key in rata if key.startswith("x_")},
                      kategori_gagal=dict(Counter(q["kat"] for q in qs if q["v2"] != "lulus")),
                      kar_tanya=len(TEKS[k]), kar_jawaban=r1(st.mean([q["teks_len"] for q in qs if q["teks_len"]]), 0) if any(q["teks_len"] for q in qs) else None)
    return out

def total(Q, PT):
    lat = [q["dtk"] for q in Q]; n = len(Q); v2 = Counter(q["v2"] for q in Q)
    return dict(n=n, selesai=sum(q["status"] == "ok" for q in Q), habis=sum(q["status"] == "waktu-habis" for q in Q),
                kosong=sum(q["status"] == "kosong" for q in Q), lulus=v2.get("lulus", 0), sebagian=v2.get("sebagian", 0), gagal=v2.get("gagal", 0),
                v1=sum(q["v1"] for q in Q), p50=med(lat), p95=r1(kuantil(lat, .95)), p99=r1(kuantil(lat, .99)), mean=r1(st.mean(lat)), max=r1(max(lat)),
                ttft=med([q["ttft"] for q in Q]), durasi=r1(sum(v["durasi"] for v in PT.values())))

Qp, RKp = muat([F["pasca"]], True)
Qb, RKb = muat([F["b20"], F["b23"]], False)
PTp, PTb = per_tahap(Qp, RKp), per_tahap(Qb, RKb)
PASCA = dict(tahap=PTp, kode=per_kode(Qp, RKp), total=total(Qp, PTp))
SEBELUM = dict(tahap=PTb, kode=per_kode(Qb, RKb), total=total(Qb, PTb))
rkp = baca(f"{F['pasca']}/ringkasan.json"); g0 = rkp["grup"]["pemanasan"]
PEMANASAN = dict(n=g0["n"], ok=g0["ok"], p50=r1(g0["p50"]), p95=r1(g0["p95"]))

# ---------------------------------------------------------------- rute & penjaga (sesudah), dari analisis-uji-live.py
AN = baca(f"{F['pasca']}/analisis.json")
pk = AN["per_kode"]
RUTE = dict(q4=pk["Q4"]["khusus"], q1=pk["Q1"]["khusus"], q5=pk["Q5"]["khusus"], q8=pk["Q8"]["khusus"],
            n_q4=pk["Q4"]["n"], n_q1=pk["Q1"]["n"], n_q8=pk["Q8"]["n"], n_q5=pk["Q5"]["n"],
            ditolak=dict(Counter(k for r in AN["baris"] if r["fase"] == "beban" for k in r["ditolak_kode"])),
            berhenti=dict(Counter(r["berhenti"] for r in AN["baris"] if r["fase"] == "beban" and r["berhenti"])),
            llm=AN["semua"]["llm_per_wf_mean"], perute=AN["semua"]["llm_perute_mean"], bawahan=AN["semua"]["llm_bawahan_mean"],
            delegasi=AN["semua"]["delegasi_mean"])

# ---------------------------------------------------------------- kegagalan (sesudah), dengan jawaban ringkas
JW = {j["trace"]: j for j in jsonl(f"{F['pasca']}/jawaban.jsonl")}
BAR = {r["trace"]: r for r in AN["baris"]}
def klasifikasi(q):
    if q["kode"] == "Q4": return ("Kesalahan routing", "Router memilih agent yang tidak punya alat; penolakan penjaga tidak menyarankan agent pemegang SOP, lalu router menjawab sendiri bahwa SOP belum tersedia.",
                                  "Pengguna diberi tahu SOP tidak tersedia, padahal ada. Menyesatkan.", "Belum diperbaiki — usulan perbaikan menunggu persetujuan")
    if q["kat"] == "lain": return ("Kesalahan evaluator", "Agent meminta pengguna memilih kategori dari daftar yang sah (perilaku benar), tetapi pola evaluator v2 tidak mengenali kalimatnya.",
                                   "Tidak ada dampak buruk bagi pengguna; jawaban sebenarnya klarifikasi yang benar.", "Dicatat; evaluator tidak diubah agar hasil tidak dipoles")
    return ("Kesalahan workflow", "Agent mencari SOP dulu, tidak menemukan panduan, lalu MENAWARKAN tiket alih-alih langsung menyusun rancangan, padahal pengguna sudah meminta dibuatkan.",
            "Pengguna perlu satu balasan tambahan (\"ya\") sebelum rancangan tiket dibuat. Tidak ada tiket tersimpan, tidak ada klaim palsu.", "Belum diperbaiki — perlu keputusan aturan instruksi agent")
GAGAL = []
for q in Qp:
    if q["v2"] == "lulus": continue
    jenis, sebab, dampak, status = klasifikasi(q)
    b = BAR.get(q["trace"], {})
    GAGAL.append(dict(kode=q["kode"], nama=NAMA[q["kode"]], tahap=q["tahap"], v2=q["v2"], kategori=q["kat"], dtk=r1(q["dtk"]),
                      pertanyaan=TEKS[q["kode"]], jawaban=(JW.get(q["trace"], {}).get("jawaban") or "")[:600], harapan=HARAP[q["kode"]],
                      jenis=jenis, sebab=sebab, dampak=dampak, status=status, alat=b.get("alat", []), agent_pertama=b.get("pilihan_pertama"),
                      agent_efektif=b.get("agent_efektif", []), penjaga=b.get("ditolak_kode", []), trace=q["trace"][:8]))
GAGAL.sort(key=lambda g: (g["v2"] != "gagal", g["tahap"]))
# kegagalan SEBELUM per kategori (untuk "apa yang sudah diperbaiki")
GAGAL_LAMA = dict(Counter(f"{q['kode']}|{q['kat']}" for q in Qb if q["v2"] == "gagal"))

# ---------------------------------------------------------------- perbandingan model (kriteria v1, workload 97 pertanyaan)
PS = baca(f"{F['q27']}/performance_summary.json"); AC = baca(f"{F['q27']}/accuracy_summary.json")
def model_tahap(pt):
    return {k: dict(n=v["n"], selesai=v["selesai"], habis=v["habis_waktu"], p50=r1(v["p50_s"]), p95=r1(v["p95_s"]), mean=r1(v["rata_s"]),
                    ttft=r1(v.get("ttft_jawaban_p50_s")), model_ttft_ms=v.get("ttft_litellm_p50_ms"), tps=r1(v.get("token_keluar_per_dtk_per_panggilan")),
                    durasi=v.get("durasi_tahap_s"), wf_menit=v.get("workflow_per_menit"), antre_ms=v.get("antre_vllm_ms"), kv=v.get("kv_cache_maks_persen"))
            for k, v in pt.items()}
MODEL = dict(
    q27=dict(nama="Qwen3.8-27B", tahap=model_tahap(PS["per_tahap"]), benar=AC["semua_97"]["sesuai_kriteria"]["benar"], n=AC["semua_97"]["sesuai_kriteria"]["n"],
             selesai=AC["semua_97"]["workflow_selesai"]["benar"], habis=AC["galat_dan_halusinasi"]["habis_waktu"], benar40=AC["berurutan_40"]["sesuai_kriteria"]["benar"],
             konfig=dict(parameter="±27 miliar", kuantisasi="bfloat16 (tanpa kuantisasi)", gpu="4× A10G (g5.12xlarge)", tp="Tensor parallel 4 (satu salinan dibelah ke 4 GPU)",
                         replika=1, seqs=4, konteks="8.192 token", lain="--enforce-eager (CUDA graph mati), gpu-memory-utilization 0,80", tanggal="23 Nov 2026")),
    q14=dict(nama="Qwen3-14B-AWQ", tahap=model_tahap(PS["baseline_per_tahap"]), benar=AC["baseline_14b"]["semua_97"]["benar"], n=AC["baseline_14b"]["semua_97"]["n"],
             benar40=AC["baseline_14b"]["berurutan_40"]["benar"],
             konfig=dict(parameter="±14 miliar", kuantisasi="AWQ 4-bit", gpu="4× A10G (g5.12xlarge)", tp="Tensor parallel 1 (satu salinan per GPU)",
                         replika=4, seqs=4, konteks="16.384 token", lain="gpu-memory-utilization 0,85, LiteLLM simple-shuffle", tanggal="20 Nov 2026 (sebelum optimasi agent)")),
)
hab14 = sum(1 for l in jsonl(f"{F['b20']}/kejadian.jsonl") if l.get("t") == "q" and l.get("fase") != "pemanasan" and l["status"] == "waktu-habis")
MODEL["q14"]["habis"] = hab14; MODEL["q14"]["selesai"] = MODEL["q14"]["n"] - hab14

# ---------------------------------------------------------------- kecepatan model langsung (16 Nov, g5.2xlarge 1 GPU)
BM = baca("data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13-ringkasan.json")
LANGSUNG = dict(
    mesin="g5.2xlarge · 1× A10G · 1 replika (bukan mesin uji terbaru)", tanggal="16 Nov 2026",
    per_input=[dict(input=int(k.split("|")[0]), cache=k.split("|")[1], prompt=v["prompt"], keluar=v["keluar"], ttft=r1(v["ttft50"], 2), tps=r1(v["tps50"]), total=r1(v["tot50"], 1))
               for k, v in BM["per_input"].items()],
    paralel=[dict(sekaligus=int(k), gabungan=r1(v["gab50"]), per_permintaan=r1(v["tps50"]), ttft=r1(v["ttft50"], 2), total=r1(v["tot50"], 1)) for k, v in BM["paralel"].items()],
)

# ---------------------------------------------------------------- riwayat pengujian
def ringkas_uji_beban(f):
    d = baca(f"data/{f}")
    return {r["pemakai"]: dict(p50=r1(r["p50"]), p95=r1(r["p95"]), n=r["pertanyaan"], benar=r["benar"]) for r in d["ringkasan"]}
UB = {k: ringkas_uji_beban(f) for k, f in [("b2", "uji-beban-qwen3-14b-2026-11-13-06-59-A-dengan-gpu.json"), ("b3", "uji-beban-qwen3-14b-2026-11-16-02-47-A-dengan-gpu.json"),
                                            ("b4", "uji-beban-qwen3-14b-2026-11-16-04-32-A-dengan-gpu.json")]}
B14 = baca(f"{DT}/banding-1gpu-vs-4gpu/banding.json")
bb = {(r["env"], r["grup"]): r for r in B14["baris"]}
PR = baca("data/profil-agent-2026-11-16-09-22-ringkasan.json")
EV = baca(f"{DT}/evaluasi-v2/ringkasan.json")
RIWAYAT = [
    dict(grup="Batas inference di 1 GPU", tanggal="13–16 Nov", mesin="g5.2xlarge · 1 GPU", judul="Uji beban: batas permintaan sekaligus (max-num-seqs) 2, 3, 4",
         tujuan="Mencari setelan antrean model yang paling baik di satu GPU.",
         hasil=f"Di 8 pengguna, waktu tengah: batas 2 {UB['b2'][8]['p50']} dtk · batas 3 {UB['b3'][8]['p50']} dtk · batas 4 {UB['b4'][8]['p50']} dtk. Batas 4 dipakai sebagai setelan tetap.",
         akurasi=f"Sesuai kriteria v1 (1–8 pengguna): batas 2 {sum(v['benar'] for v in UB['b2'].values())}/{sum(v['n'] for v in UB['b2'].values())} · batas 4 {sum(v['benar'] for v in UB['b4'].values())}/{sum(v['n'] for v in UB['b4'].values())}",
         biaya="Tarif g5.2xlarge tidak tercatat — biaya tidak dihitung", sumber="data/uji-beban-qwen3-14b-2026-11-1*-A-dengan-gpu.json"),
    dict(grup="Kecepatan model langsung", tanggal="16 Nov", mesin="g5.2xlarge · 1 GPU", judul="Benchmark model langsung ke vLLM (tanpa agent)",
         tujuan="Mengukur kecepatan model murni: kata pertama, token per detik, cache, dan paralel.",
         hasil=f"Prompt ±540 token: kata pertama {LANGSUNG['per_input'][0]['ttft']} dtk, menulis {LANGSUNG['per_input'][0]['tps']} token/dtk. Gabungan 4 permintaan sekaligus {BM['paralel']['4']['gab50']:.1f} token/dtk.",
         akurasi="Tidak dinilai (bukan uji jawaban)", biaya="Tarif g5.2xlarge tidak tercatat", sumber="data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13*"),
    dict(grup="Profil alur agent", tanggal="16–17 Nov", mesin="g5.2xlarge · 1 GPU", judul="Profil alur agent: ke mana waktu tiap pertanyaan habis",
         tujuan="Membedah waktu per langkah (model, alat, database, pencarian SOP) untuk 97 pertanyaan.",
         hasil=f"1 pengguna: waktu tengah {bb[('A','berurutan')]['p50']:.1f} dtk; 8 pengguna {bb[('A','beban-8')]['p50']:.1f} dtk. Lebih dari separuh waktu dipakai model untuk berpikir.",
         akurasi=f"Kriteria v1: {sum(r['benar'] for (e,g),r in bb.items() if e=='A')}/{sum(r['n'] for (e,g),r in bb.items() if e=='A')}", biaya="Tarif g5.2xlarge tidak tercatat", sumber=f"{F['m17']}"),
    dict(grup="1 GPU vs 4 GPU", tanggal="20 Nov", mesin="g5.12xlarge · 4 GPU", judul="Skenario 17 Nov diulang di 4 GPU (4 replika)",
         tujuan="Melihat apakah 4 salinan model menghilangkan antrean saat ramai.",
         hasil=f"8 pengguna: waktu tengah {bb[('A','beban-8')]['p50']:.1f} → {bb[('B','beban-8')]['p50']:.1f} dtk; pertanyaan tuntas/menit {bb[('A','beban-8')]['pertanyaan_per_menit']:.1f} → {bb[('B','beban-8')]['pertanyaan_per_menit']:.1f}. 1 pengguna tidak lebih cepat.",
         akurasi="Dinilai ulang v2 (lihat halaman Akurasi)", biaya="g5.12xlarge USD 7,93854/jam", sumber=F["b20"]),
    dict(grup="Perbandingan model", tanggal="23 Nov", mesin="g5.12xlarge · 4 GPU", judul="Qwen3.8-27B dengan 97 pertanyaan yang sama",
         tujuan="Apakah model lebih besar memberi jawaban lebih baik di mesin yang sama.",
         hasil=f"Semua jawaban yang sempat selesai benar ({MODEL['q27']['benar']}), tetapi {MODEL['q27']['habis']} dari {MODEL['q27']['n']} habis waktu; menulis ±11 token/dtk vs ±49 (14B).",
         akurasi=f"Kriteria v1: {MODEL['q27']['benar']}/{MODEL['q27']['n']} (14B: {MODEL['q14']['benar']}/{MODEL['q14']['n']})", biaya="g5.12xlarge USD 7,93854/jam", sumber=F["q27"]),
    dict(grup="Kapasitas 1–20 pengguna", tanggal="20 & 23 Nov", mesin="g5.12xlarge · 4 GPU", judul="Kapasitas sebelum optimasi software: 1 sampai 20 pengguna",
         tujuan="Berapa pengguna bersamaan yang sanggup dilayani sebelum perbaikan agent.",
         hasil=f"20 pengguna: waktu tengah {SEBELUM['tahap'][20]['p50']} dtk, 1% paling lambat {SEBELUM['tahap'][20]['p99']} dtk.",
         akurasi=f"v2: {SEBELUM['total']['lulus']}/{SEBELUM['total']['n']} lulus, {SEBELUM['total']['gagal']} gagal", biaya="g5.12xlarge USD 7,93854/jam", sumber=f"{F['b20']} + {F['b23']}"),
    dict(grup="Sesudah optimasi software", tanggal="24 Nov", mesin="g5.12xlarge · 4 GPU", judul="Kapasitas sesudah perbaikan workflow agent (Tahap 1–6)",
         tujuan="Mengukur dampak perbaikan software pada setelan server yang sama persis.",
         hasil=f"20 pengguna: waktu tengah {PASCA['tahap'][20]['p50']} dtk, 1% paling lambat {PASCA['tahap'][20]['p99']} dtk; 0 habis waktu.",
         akurasi=f"v2: {PASCA['total']['lulus']}/{PASCA['total']['n']} lulus, {PASCA['total']['gagal']} gagal", biaya="g5.12xlarge USD 7,93854/jam", sumber=F["pasca"]),
]
STATUS_FASE = [("T0", "Pemeriksaan awal server & skrip", "Selesai"), ("T1", "Uji terarah Q1/Q4/Q5/Q8 × 20", "Dihentikan sesudah 7 skenario"),
               ("T2", "Percakapan multi-giliran", "Belum diuji"), ("T3", "Pertanyaan variasi (generalisasi)", "Belum diuji"),
               ("T4", "Uji ulang Q1–Q8 berurutan", "Belum diuji"), ("T5", "Perbandingan A/B per mekanisme", "Belum diuji"),
               ("T6", "Pembatalan end-to-end", "Belum diuji live (offline terbukti; uji server 24 Nov pagi: berhenti di token ke-206)"),
               ("T7", "Kapasitas 1–20 pengguna", "Selesai — 239 pertanyaan (8 pemanasan + 231 terukur)")]

DATA = dict(dibuat=datetime.now().strftime("%d %b %Y %H:%M"), tahap=TAHAP, nama=NAMA, teks=TEKS, harap=HARAP, tarif=TARIF, kurs=KURS, harga_api=HARGA_API,
            pasca=PASCA, sebelum=SEBELUM, pemanasan=PEMANASAN, rute=RUTE, gagal=GAGAL, gagal_lama=GAGAL_LAMA, model=MODEL, langsung=LANGSUNG,
            riwayat=RIWAYAT, status=STATUS_FASE, ev_total=EV["total"],
            konfig=dict(server="AWS EC2 g5.12xlarge · 4× NVIDIA A10G · 24 GB VRAM per GPU (96 GB fisik)",
                        model="Qwen3-14B-AWQ · 4 replika vLLM independen (1 per GPU) · max-num-seqs 4 · max-model-len 16.384 · gpu-memory-utilization 0,85",
                        gateway="LiteLLM, routing simple-shuffle, tanpa retry", agent="VoltAgent 2.10 (router + agent aplikasi), penjaga alur & rute kemampuan menyala",
                        image="vLLM image 390a656b54e1 (sama pada 23 & 24 Nov)",
                        workload="Pemanasan 8 pertanyaan (tidak dihitung), lalu 1/2/3/5/8/10/12/16/20 pengguna bersamaan × 3 pertanyaan, jeda 5 dtk, jeda tahap 120 dtk, batas 300 dtk"),
            sumber=dict(pasca=F["pasca"], sebelum=[F["b20"], F["b23"]], v2=f"{DT}/evaluasi-v2/per-skenario.csv", q27=F["q27"],
                        langsung="data/benchmark-inferensi-qwen3-14b-2026-11-16-08-13-ringkasan.json"))

tpl = open("scripts/dashboard-evaluasi.template.html", encoding="utf-8").read()
js = json.dumps(DATA, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
out = tpl.replace("/*__DATA__*/null", js)
P = "docs/benchmark/grafik/ratu-ai-performance-evaluation.html"
open(P, "w", encoding="utf-8", newline="\n").write(out)
print(f"{P}: {len(out) / 1024:.0f} KB")
print("cek: sesudah", {k: PASCA["total"][k] for k in ("n", "lulus", "sebagian", "gagal", "selesai", "p50", "ttft")},
      "| sebelum", {k: SEBELUM["total"][k] for k in ("n", "lulus", "sebagian", "gagal", "selesai", "p50", "ttft")})
