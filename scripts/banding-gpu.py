"""Bandingkan dua hasil profil alur agent: 1 GPU (g5.2xlarge) vs 4 GPU (g5.12xlarge).

    python scripts/banding-gpu.py <folder A, 1 GPU> <folder B, 4 GPU>

Kedua folder harus sudah diolah dengan scripts/olah-alur-agent.py (ringkasan.json ada).
Keluaran:
  data/agent-workflow-latency/banding-1gpu-vs-4gpu/banding.json   semua angka perbandingan
  data/agent-workflow-latency/banding-1gpu-vs-4gpu/banding.csv    satu baris per tahap x lingkungan
  docs/benchmark/grafik/grafik-1gpu-vs-4gpu.html                                   dashboard offline
Data sumber tidak diubah.
"""
import csv, json, os, sys
from datetime import datetime

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A_DIR, B_DIR = sys.argv[1].rstrip("/\\"), sys.argv[2].rstrip("/\\")
LIVE = "--live" in sys.argv   # uji B masih berjalan: tandai sementara + muat ulang otomatis
baca = lambda d: json.load(open(os.path.join(d, "ringkasan.json"), encoding="utf-8"))
RA, RB = baca(A_DIR), baca(B_DIR)
# --tambah-b <folder,...>: tahap beban dari uji lain di mesin B yang SETELANNYA SAMA (mis. 10–20 pengguna, 23 Nov)
# disisipkan ke data mesin B. Hanya tahap yang belum ada; tahap milik B_DIR tidak pernah ditimpa.
# Halaman Perbandingan A vs B tetap hanya memakai tahap yang ada di kedua mesin (diatur di template).
TAMBAH_B = []
if "--tambah-b" in sys.argv:
    for d in sys.argv[sys.argv.index("--tambah-b") + 1].split(","):
        d = d.rstrip("/\\"); Rx = baca(d); baru = []
        for g in Rx["grup"]:
            if not g.startswith("beban-") or g in RB["grup"]: continue
            baru.append(g); k = g.split("-")[1]
            for kunci in ("grup", "fase_waktu", "per_kode", "replika", "q45"):
                if g in (Rx.get(kunci) or {}): RB.setdefault(kunci, {})[g] = Rx[kunci][g]
            for kunci in ("vllm", "vllm_log", "gpu", "vllm_replika", "vllm_log_replika", "gpu_indeks"):
                if k in (Rx.get(kunci) or {}): RB.setdefault(kunci, {})[k] = Rx[kunci][k]
        RB["info"]["tahap"] = sorted({*RB["info"]["tahap"], *(int(g.split("-")[1]) for g in baru)})
        kj0 = json.loads(open(os.path.join(d, "kejadian.jsonl"), encoding="utf-8").readline())
        TAMBAH_B.append(dict(folder=os.path.relpath(d, AKAR).replace("\\", "/"), tahap=[int(g.split("-")[1]) for g in baru],
                             tanggal=datetime.fromtimestamp(kj0["ts"] / 1000).strftime("%d %b %Y")))
ENV = {
    "A": dict(label="1 GPU · g5.2xlarge", pendek="1 GPU", folder=os.path.relpath(A_DIR, AKAR).replace("\\", "/"), r=RA,
              mesin="AWS g5.2xlarge · 1× A10G · 1 replika vLLM 0.33.0", tanggal="17 Nov 2026"),
    "B": dict(label="4 GPU · g5.12xlarge", pendek="4 GPU", folder=os.path.relpath(B_DIR, AKAR).replace("\\", "/"), r=RB,
              mesin="AWS g5.12xlarge · 4× A10G · 4 replika vLLM 0.33.0rc1 (nightly) · LiteLLM simple-shuffle", tanggal="20 Nov 2026"),
}
GRUP = ["berurutan"] + [f"beban-{n}" for n in sorted({*RA["info"]["tahap"], *RB["info"]["tahap"]})]

def kunci_tahap(g): return "berurutan" if g == "berurutan" else g.split("-")[1]
def baris(env, g):
    R = ENV[env]["r"]; v = R["grup"].get(g)
    if not v: return None
    ada_token = R["jumlah"].get("litellm", 0) > 0   # catatan LiteLLM baru diambil di akhir uji
    lengkap = g in R.get("fase_waktu", {})
    dur = R.get("fase_waktu", {}).get(g)
    vl = R["vllm"].get(kunci_tahap(g)) or {}
    lg = R["vllm_log"].get(kunci_tahap(g)) or {}
    gp = R["gpu"].get(kunci_tahap(g)) or {}
    return dict(env=env, grup=g, lengkap=lengkap, ada_token=ada_token, n=v["n"], ok=v["ok"], benar=v["benar"], habis=v["habis"], galat=v["galat"],
                p50=v["p50"], p95=v["p95"], p99=v.get("p99"), rata=v["rata"], min=v["min"], max=v["max"],
                llm=v["llm"], llm_galat=v["llm_galat"], alat_n=v.get("alat_n"), alat_ok=v.get("alat_ok"),
                masuk=v["masuk"] if ada_token else None, keluar=v["keluar"] if ada_token else None, pikir=v["pikir"] if ada_token else None,
                pikir_pasti=v.get("pikir_pasti"), keluar_total=v["keluar_total"] if ada_token else None, masuk_total=v["masuk_total"] if ada_token else None,
                durasi_s=dur, tps_gabungan=(v["keluar_total"] / dur) if dur and ada_token else None, pertanyaan_per_menit=(v["n"] / dur * 60) if dur else None,
                tps_panggilan=v.get("tps_panggilan") if ada_token else None, lt_ttft=v.get("lt_ttft") if ada_token else None, lt_ttft95=v.get("lt_ttft95") if ada_token else None,
                vllm_antre_ms=vl.get("antre_ms"), vllm_decode_ms=vl.get("decode_ms"), vllm_prefill_ms=vl.get("prefill_ms"), vllm_cache=vl.get("cache"),
                vllm_preemption=vl.get("preemption"), kv_maks=lg.get("kv_maks"), antre_maks=lg.get("antre_maks"), penuh=lg.get("penuh"),
                watt=gp.get("watt"), watt_total=gp.get("watt_total", gp.get("watt")), util=gp.get("util"), suhu_maks=gp.get("suhu_maks"), vram=gp.get("vram"),
                **{k: v[k] for k in v if k.startswith("x_")})
ROWS = [x for g in GRUP for env in ("A", "B") for x in [baris(env, g)] if x]

OUT = os.path.join(AKAR, "data", "agent-workflow-latency", "banding-1gpu-vs-4gpu")
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "banding.csv"), "w", newline="", encoding="utf-8") as f:
    kol = list(dict.fromkeys(k for r in ROWS for k in r))
    w = csv.DictWriter(f, fieldnames=kol); w.writeheader(); [w.writerow(r) for r in ROWS]
kj = [json.loads(l) for l in open(os.path.join(B_DIR, "kejadian.jsonl"), encoding="utf-8") if l.strip()]
q_b = [x for x in kj if x["t"] == "q" and x["fase"] != "pemanasan"]
fase_b = [x for x in kj if x["t"] == "fase"]
target_b = 8 * RB["info"]["ulang"] + sum(3 * n for n in RB["info"]["tahap"])
sedang = next((("berurutan" if x["fase"] == "berurutan" else f"{x.get('tahap')} pengguna" if x["fase"] == "beban" else x["fase"])
               for x in reversed(fase_b) if x["saat"] == "mulai" and not any(y["saat"] == "selesai" and y["fase"] == x["fase"] and y.get("tahap") == x.get("tahap") for y in fase_b)), None)
PROGRES = dict(live=LIVE, selesai=len(q_b), target=target_b, sedang=sedang, jam=datetime.now().strftime("%H.%M"),
               ada_token=RB["jumlah"].get("litellm", 0) > 0, ada_gpu=bool(RB.get("gpu")))
# Isi jawaban 4 GPU (hanya ada kalau uji dijalankan dengan --simpan-jawaban). Ditanam utuh ke HTML atas
# permintaan pemilik proyek 20 Nov 2026 — isinya memuat data perusahaan, jadi HTML ini hanya untuk internal.
import re
TEKS_Q = dict(re.findall(r'kode: "(Q\d)", jenis: "[^"]*", teks: "([^"]*)"', open(os.path.join(AKAR, "scripts", "profil-alur-agent.mts"), encoding="utf-8").read()))
p_jwb = os.path.join(B_DIR, "jawaban.jsonl")
JAWABAN = []
if os.path.exists(p_jwb):
    q_trace = {x["trace"]: x for x in kj if x["t"] == "q"}
    for l in open(p_jwb, encoding="utf-8"):
        if not l.strip(): continue
        j = json.loads(l); q = q_trace.get(j["trace"], {})
        if j["fase"] == "pemanasan": continue
        JAWABAN.append(dict(grup="berurutan" if j["fase"] == "berurutan" else f"beban-{q.get('tahap')}", urut=q.get("urut") or q.get("pemakai"),
                            pemakai=q.get("pemakai"), kode=j["kode"], pertanyaan=TEKS_Q.get(j["kode"], ""), benar=j["benar"], status=j["status"],
                            alat=[a for a in j.get("alat") or [] if a != "delegate_task"], rancangan=j.get("rancangan"),
                            detik=round(q["total_ms"] / 1000, 1) if q.get("total_ms") else None, jawaban=j.get("jawaban") or "", mulai=q.get("mulai", 0)))
    JAWABAN.sort(key=lambda x: x["mulai"])
DATA = dict(progres=PROGRES, jawaban=JAWABAN, dibuat=datetime.now().strftime("%Y-%m-%d %H:%M"), env={k: {kk: vv for kk, vv in v.items() if kk != "r"} for k, v in ENV.items()},
            grup=GRUP, baris=ROWS, kategori=RA["kategori"], nama_kategori=RA["nama_kategori"], jenis=RA["jenis"],
            per_kode={"A": RA["per_kode"], "B": RB["per_kode"]}, q45={"A": RA["q45"], "B": RB["q45"]},
            replika=RB.get("replika", {}), vllm_replika=RB.get("vllm_replika", {}), vllm_log_replika=RB.get("vllm_log_replika", {}),
            gpu_indeks=RB.get("gpu_indeks", {}), cek={"A": RA["cek"], "B": RB["cek"]}, jumlah={"A": RA["jumlah"], "B": RB["jumlah"]},
            info={"A": RA["info"], "B": RB["info"]}, tiket={"A": RA.get("tiket_baru"), "B": RB.get("tiket_baru")},
            koreksi_jam={"A": RA.get("koreksi_jam_gpu_ms"), "B": RB.get("koreksi_jam_gpu_ms")},
            stop={"A": RA["stop"], "B": RB["stop"]},
            tambahan_b=TAMBAH_B,
            teks=json.load(open(os.path.join(OUT, "intinya.json"), encoding="utf-8")) if os.path.exists(os.path.join(OUT, "intinya.json")) else {})
json.dump(DATA, open(os.path.join(OUT, "banding.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)

tpl_lama = open(os.path.join(AKAR, "scripts", "dashboard-template.html"), encoding="utf-8").read()
css = tpl_lama[tpl_lama.index("<style>") + 7:tpl_lama.index("</style>")]
helper = tpl_lama[tpl_lama.index("/* ---------- format ---------- */"):tpl_lama.index("/* =================================================================== OVERVIEW */")]
tpl = open(os.path.join(AKAR, "scripts", "dashboard-banding-template.html"), encoding="utf-8").read()
if LIVE: tpl = tpl.replace("<!--__LIVE__-->", '<meta http-equiv="cache-control" content="no-store">')
out = (tpl.replace("/*__CSS__*/", css).replace("/*__HELPER__*/", helper)
       .replace("/*__DATA__*/null", json.dumps(DATA, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")))
p_out = os.path.join(AKAR, "docs", "benchmark", "grafik", "grafik-1gpu-vs-4gpu.html")
open(p_out, "w", encoding="utf-8").write(out)
print(json.dumps(dict(baris=len(ROWS), grup=GRUP, dashboard=f"{len(out) // 1024} KB")))
# dashboard utama menanam halaman ini, jadi ikut dibangun ulang supaya isinya tidak basi
import subprocess
subprocess.run([sys.executable, os.path.join(AKAR, "scripts", "buat-dashboard.py")], check=True)
