"""Analisis uji live pasca-optimasi (24 Nov 2026). HARNESS LAPORAN: hanya membaca folder hasil, tidak memanggil model.

    python scripts/analisis-uji-live.py <folder-fase> [--json keluaran.json]

Membaca kejadian.jsonl (event q + penjaga), span.jsonl (llm/alat/delegasi per trace), argumen-alat.jsonl (opsional)
dan panggilan.csv (opsional, hasil olah-alur-agent.py --tanpa-dashboard, berisi token per panggilan model).
Mengeluarkan metrik per kode skenario: akurasi v1/v2, latensi, panggilan LLM per agent, token, delegasi, penjaga,
rute (pilihan pertama model vs agent efektif), periode argumen (Q1), kebocoran teks alat (Q8), rancangan (Q5).
Isi pertanyaan/jawaban TIDAK dicetak.
"""
import csv, json, os, statistics as st, sys
from collections import Counter, defaultdict

DIR = sys.argv[1].rstrip("/\\")
baca = lambda f: [json.loads(l) for l in open(os.path.join(DIR, f), encoding="utf-8") if l.strip()] if os.path.exists(os.path.join(DIR, f)) else []
KJ = baca("kejadian.jsonl"); SPAN = baca("span.jsonl"); ARG = baca("argumen-alat.jsonl"); JWB = {j["trace"]: j for j in baca("jawaban.jsonl")}
INFO = next((x for x in KJ if x["t"] == "info"), {})
Q = [x for x in KJ if x["t"] == "q"]
SELESAI = next((x for x in KJ if x["t"] == "selesai"), {})
PERUTE = "Ratu AI Umum"
DOK = {"cari_sop", "daftar_sop"}
PEMEGANG_DOK = {a["nama"] for a in (json.load(open(os.path.join(DIR, "registri-kemampuan.json"), encoding="utf-8")).get("agent") or [])
                if any(t["jenis"] == "dokumen" for t in a["alat"])} if os.path.exists(os.path.join(DIR, "registri-kemampuan.json")) else set()

span_per = defaultdict(list)
for s in SPAN: span_per[s.get("trace")].append(s)
arg_per = defaultdict(list)
for a in ARG: arg_per[a.get("trace")].append(a)
tok_per = defaultdict(lambda: [0, 0, 0])
if os.path.exists(os.path.join(DIR, "panggilan.csv")):
    for r in csv.DictReader(open(os.path.join(DIR, "panggilan.csv"), encoding="utf-8")):
        t = tok_per[r["trace"]]; t[2] += 1
        try: t[0] += int(float(r["token_masuk"] or 0)); t[1] += int(float(r["token_keluar"] or 0))
        except ValueError: pass

def kuantil(a, q):
    a = sorted(x for x in a if x is not None)
    if not a: return None
    k = (len(a) - 1) * q; f = int(k); c = min(f + 1, len(a) - 1)
    return a[f] + (a[c] - a[f]) * (k - f)

def args_alat(tr, nama):
    out = []
    for a in arg_per.get(tr, []):
        if a.get("alat") != nama: continue
        try: out.append(json.loads(a.get("argumen") or "{}"))
        except json.JSONDecodeError: out.append({"_mentah": True})
    return out

def per_trace(q):
    tr = q["trace"]; sp = span_per.get(tr, [])
    llm = [s for s in sp if s.get("jenis") == "llm"]
    deleg = [s for s in sp if s.get("jenis") == "delegasi"]
    pj = q.get("penjaga") or {}
    rute = pj.get("rute") or {}
    agent_llm = Counter(s.get("nama") for s in llm)
    efektif = sorted(a for a in agent_llm if a != PERUTE)
    pilihan_pertama = (deleg[0].get("target") or [None])[0] if deleg else None
    return {
        "trace": tr, "kode": q["kode"], "status": q["status"], "v1": bool(q.get("benar")),
        "v2": (q.get("nilai_v2") or {}).get("hasil"), "v2_kategori": (q.get("nilai_v2") or {}).get("kategori"),
        "efisiensi": (q.get("nilai_v2") or {}).get("efisiensi"),
        "total_dtk": q["total_ms"] / 1000, "ttft_dtk": (q.get("ttft_jawaban_ms") or 0) / 1000 if q.get("ttft_jawaban_ms") else None,
        "alat": [a for a in q.get("alat", []) if a != "delegate_task"], "rancangan": q.get("rancangan", 0),
        "delegasi": q.get("delegasi"), "delegasi_ditolak": q.get("delegasi_ditolak", []),
        "llm_total": len(llm), "llm_perute": agent_llm.get(PERUTE, 0), "llm_bawahan": sum(v for k, v in agent_llm.items() if k != PERUTE),
        "agent_llm": dict(agent_llm), "agent_efektif": efektif, "pilihan_pertama": pilihan_pertama,
        "target_pertama_penjaga": rute.get("target_pertama"), "dialihkan": rute.get("dialihkan", []), "dipertahankan": rute.get("dipertahankan", []),
        "status_handoff": [h.get("status") for h in rute.get("handoff", [])], "kebutuhan": rute.get("kebutuhan", []),
        "ditolak_kode": [d.get("kode") for d in pj.get("ditolak", [])], "pelanggaran": pj.get("pelanggaran", []),
        "berhenti": (pj.get("berhenti") or {}).get("kode"), "penutup": pj.get("penutup"),
        "periode_otomatis": pj.get("periode_otomatis", []), "pilihan_dikosongkan": pj.get("pilihan_dikosongkan", []),
        "token_masuk": tok_per[tr][0] if tr in tok_per else None, "token_keluar": tok_per[tr][1] if tr in tok_per else None,
        "args_total_penjualan": args_alat(tr, "total_penjualan"),
        "teks_alat_bocor": "teks-alat" in (pj.get("pelanggaran") or []),
        "fase": q.get("fase"), "tahap": q.get("tahap"),
    }

def ringkas(rows):
    if not rows: return {}
    n = len(rows); lat = [r["total_dtk"] for r in rows]
    v2 = Counter(r["v2"] for r in rows)
    d = {
        "n": n, "v1_benar": sum(r["v1"] for r in rows), "v2": dict(v2), "v2_lulus_pct": round(100 * v2.get("lulus", 0) / n, 1),
        "status": dict(Counter(r["status"] for r in rows)), "kategori_v2": dict(Counter(r["v2_kategori"] for r in rows)),
        "lat_mean": round(st.mean(lat), 1), "lat_p50": round(kuantil(lat, .5), 1), "lat_p90": round(kuantil(lat, .9), 1),
        "lat_p95": round(kuantil(lat, .95), 1), "lat_p99": round(kuantil(lat, .99), 1), "lat_min": round(min(lat), 1), "lat_max": round(max(lat), 1),
        "ttft_p50": round(kuantil([r["ttft_dtk"] for r in rows], .5) or 0, 1),
        "llm_per_wf_mean": round(st.mean(r["llm_total"] for r in rows), 2), "llm_perute_mean": round(st.mean(r["llm_perute"] for r in rows), 2),
        "llm_bawahan_mean": round(st.mean(r["llm_bawahan"] for r in rows), 2),
        "delegasi_mean": round(st.mean((r["delegasi"] or 0) for r in rows), 2),
        "delegasi_ditolak": dict(Counter(k for r in rows for k in r["delegasi_ditolak"])),
        "penjaga_ditolak": dict(Counter(k for r in rows for k in r["ditolak_kode"])),
        "pelanggaran": dict(Counter(k for r in rows for k in r["pelanggaran"])),
        "berhenti": dict(Counter(r["berhenti"] for r in rows if r["berhenti"])), "penutup": dict(Counter(r["penutup"] for r in rows)),
        "rancangan_total": sum(r["rancangan"] for r in rows), "rancangan_ganda": sum(1 for r in rows if r["rancangan"] > 1),
    }
    tm = [r["token_masuk"] for r in rows if r["token_masuk"] is not None]
    if tm: d["token_masuk_mean"] = round(st.mean(tm)); d["token_keluar_mean"] = round(st.mean(r["token_keluar"] for r in rows if r["token_keluar"] is not None))
    return d

def khusus(kode, rows):
    if kode == "Q1":
        per = []
        for r in rows:
            a = r["args_total_penjualan"]
            sesuai = any(x.get("dari") == "2026-09" or x.get("bulan") == "2026-09" for x in a)
            kosong = any(not any(v for k, v in x.items() if isinstance(v, str) and v.strip()) for x in a)
            per.append((sesuai, kosong))
        return {"periode_sesuai": sum(1 for s, _ in per if s), "ada_panggilan_tanpa_periode": sum(1 for _, k in per if k),
                "perlu_periode_ditolak": sum(r["ditolak_kode"].count("perlu-periode") for r in rows),
                "periode_otomatis_ditandai": sum(1 for r in rows if r["periode_otomatis"]),
                "angka_benar": sum(1 for r in rows if r["v2_kategori"] == "angka-benar"),
                "argumen_tercatat": sum(1 for r in rows if r["args_total_penjualan"])}
    if kode == "Q4":
        n = len(rows)
        pertama_benar = sum(1 for r in rows if r["pilihan_pertama"] in PEMEGANG_DOK)
        efektif_benar = sum(1 for r in rows if r["agent_efektif"] and all(a in PEMEGANG_DOK for a in r["agent_efektif"]))
        salah_jalan = sum(1 for r in rows if any(a not in PEMEGANG_DOK for a in r["agent_efektif"]))
        return {"pemegang_dokumen": sorted(PEMEGANG_DOK), "pilihan_pertama": dict(Counter(r["pilihan_pertama"] for r in rows)),
                "first_choice_acc_pct": round(100 * pertama_benar / n, 1), "effective_acc_pct": round(100 * efektif_benar / n, 1),
                "dialihkan": sum(1 for r in rows if r["dialihkan"]), "koreksi_rate_pct": round(100 * sum(1 for r in rows if r["dialihkan"]) / max(1, n - pertama_benar), 1),
                "agent_tidak_relevan_dieksekusi": salah_jalan, "cari_sop_pct": round(100 * sum(1 for r in rows if set(r["alat"]) & DOK) / n, 1),
                "final_lulus_pct": round(100 * sum(1 for r in rows if r["v2"] == "lulus") / n, 1),
                "fallback_batas": sum(r["ditolak_kode"].count("batas-fallback") for r in rows),
                "status_handoff": dict(Counter(s for r in rows for s in r["status_handoff"]))}
    if kode == "Q5":
        return {"persetujuan_karangan_ditolak": sum(r["ditolak_kode"].count("persetujuan-karangan") for r in rows),
                "delegasi_berulang_ditolak": sum(r["ditolak_kode"].count("delegasi-berulang") for r in rows),
                "alat_berulang": sum(r["ditolak_kode"].count("alat-berulang") for r in rows),
                "rancangan_ganda": sum(1 for r in rows if r["rancangan"] > 1), "rancangan_ada": sum(1 for r in rows if r["rancangan"] > 0),
                "kosong": sum(1 for r in rows if r["status"] == "kosong"), "timeout": sum(1 for r in rows if r["status"] == "waktu-habis"),
                "klaim_tersimpan_palsu": sum(1 for r in rows if r["v2_kategori"] == "klaim-tersimpan-palsu"),
                "pesan_internal": sum(1 for r in rows if r["v2_kategori"] == "pesan-internal"),
                "berhenti_hitl": dict(Counter(r["berhenti"] for r in rows if r["berhenti"])),
                "sub_dikosongkan": sum(1 for r in rows if r["pilihan_dikosongkan"]), "delegasi_maks": max((r["delegasi"] or 0) for r in rows)}
    if kode == "Q8":
        lat = [r["total_dtk"] for r in rows]
        return {"langsung_tanpa_delegasi": sum(1 for r in rows if (r["delegasi"] or 0) == 0),
                "efisien": sum(1 for r in rows if r["efisiensi"] == "efisien"), "efisien_pct": round(100 * sum(1 for r in rows if r["efisiensi"] == "efisien") / len(rows), 1),
                "alat_dipanggil": sum(1 for r in rows if r["alat"]), "teks_alat_bocor": sum(1 for r in rows if r["teks_alat_bocor"] or r["v2_kategori"] == "pesan-internal"),
                "sapaan_ditolak_penjaga": sum(r["ditolak_kode"].count("sapaan-langsung") for r in rows), "median_dtk": round(kuantil(lat, .5), 1)}
    return {}

ROWS = [per_trace(q) for q in Q]
fase_utama = [r for r in ROWS if r["fase"] != "pemanasan"]
hasil = {"folder": DIR, "info": {k: INFO.get(k) for k in ["penjaga_alur", "rute_kemampuan", "anthropic_diblokir", "batal_saat_habis", "set", "model", "batas_ms", "kode"]},
         "tiket_tersimpan": SELESAI.get("tiket_baru"), "pemanasan": ringkas([r for r in ROWS if r["fase"] == "pemanasan"]),
         "semua": ringkas(fase_utama), "per_kode": {}}
for k in sorted({r["kode"] for r in fase_utama}):
    rs = [r for r in fase_utama if r["kode"] == k]
    hasil["per_kode"][k] = {**ringkas(rs), "khusus": khusus(k, rs)}
hasil["gagal"] = [{k: r[k] for k in ["kode", "trace", "status", "v2", "v2_kategori", "total_dtk", "alat", "pilihan_pertama", "agent_efektif", "dialihkan", "ditolak_kode", "berhenti", "penutup", "rancangan"]}
                  for r in fase_utama if r["v2"] != "lulus"]
out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else os.path.join(DIR, "analisis.json")
json.dump({**hasil, "baris": ROWS}, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)
print(json.dumps(hasil, indent=1, ensure_ascii=False, default=str)[:6000])
