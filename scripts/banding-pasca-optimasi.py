"""Bandingkan benchmark konkurensi PASCA-optimasi (Tahap 1–6) dengan baseline historis. HARNESS LAPORAN, hanya membaca.

    python scripts/banding-pasca-optimasi.py <folder-baru> [--tarif 7.94]

Baseline (tidak diubah):
  data/agent-workflow-latency/2026-11-20-07-30-4gpu               tahap 1,2,3,5,8   (max-num-seqs 4, image sama)
  data/agent-workflow-latency/2026-11-23-08-35-14b-seqs4-c10-20   tahap 10,12,16,20
  data/agent-workflow-latency/evaluasi-v2/per-skenario.csv        evaluator v2 untuk data lama
Folder baru harus sudah diolah: python scripts/olah-alur-agent.py <folder> --tanpa-dashboard
Keluaran: <folder-baru>/banding.json + tabel ke layar.
"""
import csv, json, os, statistics as st, sys
from collections import Counter, defaultdict

BARU = sys.argv[1].rstrip("/\\")
TARIF = float(sys.argv[sys.argv.index("--tarif") + 1]) if "--tarif" in sys.argv else 7.94
D = "data/agent-workflow-latency"
BASE = {"20nov": f"{D}/2026-11-20-07-30-4gpu", "23nov": f"{D}/2026-11-23-08-35-14b-seqs4-c10-20"}

def kuantil(a, q):
    a = sorted(x for x in a if x is not None)
    if not a: return None
    k = (len(a) - 1) * q; f = int(k); c = min(f + 1, len(a) - 1)
    return a[f] + (a[c] - a[f]) * (k - f)

v2_lama = {}
for r in csv.DictReader(open(f"{D}/evaluasi-v2/per-skenario.csv", encoding="utf-8")):
    v2_lama[r["trace"]] = r

def muat(folder, lama):
    kj = [json.loads(l) for l in open(f"{folder}/kejadian.jsonl", encoding="utf-8") if l.strip()]
    rk = json.load(open(f"{folder}/ringkasan.json", encoding="utf-8"))
    tok = defaultdict(lambda: [0, 0, 0, 0])   # masuk, keluar, n llm, n cocok
    perute = defaultdict(int)
    for r in csv.DictReader(open(f"{folder}/panggilan.csv", encoding="utf-8")):
        t = tok[r["trace"]]; t[2] += 1
        if r.get("nama") == "Ratu AI Umum": perute[r["trace"]] += 1
        if r.get("token_masuk"):
            t[3] += 1; t[0] += int(float(r["token_masuk"])); t[1] += int(float(r["token_keluar"] or 0))
    per = defaultdict(list)
    for q in kj:
        if q.get("t") != "q" or q.get("fase") != "beban": continue
        v2 = (v2_lama.get(q["trace"]) or {}).get("v2_hasil") if lama else (q.get("nilai_v2") or {}).get("hasil")
        kat = (v2_lama.get(q["trace"]) or {}).get("v2_kategori") if lama else (q.get("nilai_v2") or {}).get("kategori")
        per[q["tahap"]].append({**q, "_v2": v2, "_kat": kat, "_tok": tok.get(q["trace"]), "_perute": perute.get(q["trace"], 0)})
    hasil = {}
    for tahap, qs in per.items():
        lat = [q["total_ms"] / 1000 for q in qs]; n = len(qs)
        v2 = Counter(q["_v2"] for q in qs)
        lengkap = [q["_tok"] for q in qs if q["_tok"] and q["_tok"][3] == q["_tok"][2] and q["_tok"][2] > 0]
        vl = rk.get("vllm", {}).get(str(tahap), {}); gp = rk.get("gpu", {}).get(str(tahap), {})
        dur = rk.get("fase_waktu", {}).get(f"beban-{tahap}")
        lulus = v2.get("lulus", 0)
        hasil[tahap] = {
            "n": n, "ok": sum(q["status"] == "ok" for q in qs), "habis": sum(q["status"] == "waktu-habis" for q in qs),
            "kosong": sum(q["status"] == "kosong" for q in qs), "galat": sum(q["status"] == "galat" for q in qs),
            "v1": sum(bool(q.get("benar")) for q in qs), "v1_pct": round(100 * sum(bool(q.get("benar")) for q in qs) / n, 1),
            "v2": dict(v2), "v2_lulus_pct": round(100 * lulus / n, 1), "v2_gagal": v2.get("gagal", 0), "v2_sebagian": v2.get("sebagian", 0),
            "gagal_detail": [{"kode": q["kode"], "v2": q["_v2"], "kategori": q["_kat"], "dtk": round(q["total_ms"] / 1000, 1), "trace": q["trace"]} for q in qs if q["_v2"] != "lulus"],
            "mean": round(st.mean(lat), 1), "p50": round(kuantil(lat, .5), 1), "p90": round(kuantil(lat, .9), 1), "p95": round(kuantil(lat, .95), 1),
            "p99": round(kuantil(lat, .99), 1), "min": round(min(lat), 1), "max": round(max(lat), 1),
            "ttft_p50": round(kuantil([q.get("ttft_jawaban_ms") for q in qs], .5) / 1000, 1) if any(q.get("ttft_jawaban_ms") for q in qs) else None,
            "llm_per_wf": round(st.mean(q["_tok"][2] if q["_tok"] else 0 for q in qs), 2),
            "perute_per_wf": round(st.mean(q["_perute"] for q in qs), 2),
            "token_masuk_per_wf": round(st.mean(t[0] for t in lengkap)) if lengkap else None,
            "token_keluar_per_wf": round(st.mean(t[1] for t in lengkap)) if lengkap else None,
            "token_sampel": len(lengkap),
            "delegasi_per_wf": round(st.mean((q.get("delegasi") or 0) for q in qs), 2),
            "delegasi_ditolak": dict(Counter(k for q in qs for k in (q.get("delegasi_ditolak") or []))),
            "antre_ms": vl.get("antre_ms"), "ttft_vllm_ms": vl.get("ttft_ms"), "e2e_vllm_ms": vl.get("e2e_ms"), "preemption": vl.get("preemption"), "kv_cache": vl.get("cache"),
            "gpu_util": gp.get("util"), "vram": gp.get("vram"), "watt_total": gp.get("watt_total"),
            "durasi_dtk": dur, "wf_per_menit": round(n / (dur / 60), 2) if dur else None, "wf_sukses_per_menit": round(lulus / (dur / 60), 2) if dur else None,
            "biaya_usd": round(dur / 3600 * TARIF, 3) if dur else None,
            "usd_per_wf": round(dur / 3600 * TARIF / n, 4) if dur else None, "usd_per_sukses": round(dur / 3600 * TARIF / lulus, 4) if dur and lulus else None,
            "replika": rk.get("replika", {}).get(f"beban-{tahap}"),
        }
    return hasil, rk

baru, rk_baru = muat(BARU, False)
lama = {}
for k, f in BASE.items():
    h, _ = muat(f, True); lama.update(h)
keluar = {"tarif_usd_per_jam": TARIF, "baru": baru, "baseline": lama,
          "pemanasan_baru": rk_baru.get("grup", {}).get("pemanasan"), "durasi_total_dtk": sum(v for v in rk_baru.get("fase_waktu", {}).values())}
json.dump(keluar, open(f"{BARU}/banding.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)

kol = ["n", "habis", "v1_pct", "v2_lulus_pct", "v2_gagal", "v2_sebagian", "p50", "p95", "p99", "ttft_p50", "llm_per_wf", "perute_per_wf", "token_masuk_per_wf", "token_keluar_per_wf", "delegasi_per_wf", "antre_ms", "preemption", "wf_per_menit", "usd_per_sukses"]
print("tahap | " + " | ".join(kol))
for t in sorted(set(baru) | set(lama)):
    for nama, src in (("baru", baru), ("lama", lama)):
        if t in src:
            r = src[t]; print(f"{t:>3} {nama:4} | " + " | ".join(str(r.get(k)) for k in kol))
print(f"durasi total baru {keluar['durasi_total_dtk']:.0f} dtk ~ ${keluar['durasi_total_dtk'] / 3600 * TARIF:.2f}")
