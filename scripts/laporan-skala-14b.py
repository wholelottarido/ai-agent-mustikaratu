"""Uji kapasitas Qwen3-14B di mesin B (g5.12xlarge, 4 replika): 1 sampai 20 pengguna bersamaan.

    python scripts/laporan-skala-14b.py <folder uji> [<folder uji> ...]

Tiap folder sudah diolah scripts/olah-alur-agent.py (ringkasan.json ada). Hanya tahap BEBAN yang dipakai.
Konfigurasi tiap folder (max-num-seqs) dibaca dari info.server.replika yang dicatat skrip uji; folder lama
yang belum mencatatnya (uji 20 Nov) dianggap max-num-seqs 4 — setelan itu sudah diverifikasi 20 Nov.
Kalau dua folder punya tahap yang sama untuk konfigurasi yang sama, folder yang lebih baru dipakai.

Keluaran (data lama tidak diubah):
  data/agent-workflow-latency/skala-14b/skala.json   semua angka
  docs/benchmark/grafik/grafik-skala-14b.html                         dashboard (ditanam ke docs/benchmark/grafik/hasil-pengujian.html)
Isi jawaban model TIDAK ikut ke dashboard.
"""
import json, os, statistics as st, sys
from datetime import datetime

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDER = [f.rstrip("/\\") for f in sys.argv[1:]]
if not FOLDER: sys.exit(__doc__)
HARGA = 7.93854   # USD/jam g5.12xlarge on-demand Linux Jakarta (AWS public price list, terbit 2026-11-21)
KATEGORI = {"Q1": "Data penjualan", "Q2": "Peringatan dini", "Q3": "Stok kosong", "Q4": "SOP", "Q5": "Rancangan tiket",
            "Q6": "Data karyawan", "Q7": "Harus ditolak", "Q8": "Sapaan umum"}
PORT_NAMA = {"8000": "GPU 0", "8001": "GPU 1", "8002": "GPU 2", "8003": "GPU 3"}

def baca_jsonl(p): return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]
BARIS, GAGAL, SUMBER = {}, [], []
for d in sorted(FOLDER, key=lambda x: os.path.basename(x)):
    R = json.load(open(os.path.join(d, "ringkasan.json"), encoding="utf-8"))
    KJ = baca_jsonl(os.path.join(d, "kejadian.jsonl"))
    info = next((x for x in KJ if x["t"] == "info"), {})
    rep = (info.get("server") or {}).get("replika") or []
    seqs = sorted({r.get("max_num_seqs") for r in rep if r.get("max_num_seqs")}) or [4]
    konfig = f"seqs{seqs[0]}" if len(seqs) == 1 else "campuran"
    tgl = datetime.fromtimestamp(KJ[0]["ts"] / 1000).strftime("%d %b %Y")
    SUMBER.append(dict(folder=os.path.relpath(d, AKAR).replace("\\", "/"), tanggal=tgl, konfig=konfig, max_num_seqs=seqs,
                       tahap=info.get("tahap"), dicatat_otomatis=bool(rep), jumlah=R.get("jumlah")))
    Q = [x for x in KJ if x["t"] == "q" and x["fase"] == "beban"]
    for g, v in R["grup"].items():
        if not g.startswith("beban-"): continue
        k = g.split("-")[1]; n_peng = int(k); dur = R["fase_waktu"].get(g)
        vl, gp = R["vllm"].get(k) or {}, R["gpu"].get(k) or {}
        lr, vr = (R.get("vllm_log_replika") or {}).get(k) or {}, (R.get("vllm_replika") or {}).get(k) or {}
        qs = [q for q in Q if q.get("tahap") == n_peng]
        pk = R["per_kode"].get(g) or {}
        per_menit = v["n"] / dur * 60 if dur else None
        # Throughput tanpa ekor: tahap baru selesai saat pengguna paling lambat selesai, jadi satu pertanyaan yang macet
        # beberapa menit memanjangkan seluruh tahap. Ukuran pembanding: pertanyaan selesai dalam waktu sampai 90% selesai.
        akhir = sorted((q["mulai"] + q["total_ms"]) for q in qs); mulai0 = min((q["mulai"] for q in qs), default=None)
        p90 = akhir[int(len(akhir) * .9) - 1] if akhir else None
        per_menit_90 = (int(len(akhir) * .9) / ((p90 - mulai0) / 60000)) if akhir and p90 and p90 > mulai0 else None
        BARIS[(konfig, n_peng)] = dict(
            konfig=konfig, pengguna=n_peng, tanggal=tgl, folder=os.path.relpath(d, AKAR).replace("\\", "/"),
            n=v["n"], ok=v["ok"], benar=v["benar"], habis=v["habis"], galat=v["galat"], kosong=sum(q["status"] == "kosong" for q in qs),
            p50=v["p50"], p95=v["p95"], p99=v.get("p99"), rata=v["rata"], maks=v["max"], durasi_s=dur,
            per_menit=per_menit, per_menit_90=per_menit_90,
            token_keluar_dtk=v["keluar_total"] / dur if dur and v.get("keluar_total") else None,
            token_masuk_per_q=v.get("masuk"), token_keluar_per_q=v.get("keluar"),
            llm_per_q=v["llm"], tps_panggilan=v.get("tps_panggilan"), ttft_litellm_ms=v.get("lt_ttft"),
            antre_ms=vl.get("antre_ms"), decode_ms=vl.get("decode_ms"), preemption=vl.get("preemption"), cache=vl.get("cache"),
            tunggu_s=v["x_tunggu"], berpikir_s=v["x_berpikir"], menulis_s=(v.get("x_menulis") or 0) + (v.get("x_rencana") or 0) + (v.get("x_ekor") or 0),
            alat_db_sop_s=(v.get("x_alat") or 0) + (v.get("x_db") or 0) + (v.get("x_embedding") or 0),
            penuh_persen=st.mean([x.get("penuh") or 0 for x in lr.values()]) if lr else None,
            kv_maks=max([x.get("kv_maks") or 0 for x in lr.values()]) if lr else None,
            gpu_util=gp.get("util"), watt=gp.get("watt_total", gp.get("watt")),
            usd_per_q_penuh=HARGA / (per_menit * 60) if per_menit else None,
            replika={PORT_NAMA.get(p, p): dict(permintaan=x.get("permintaan"), antre_ms=x.get("antre_ms")) for p, x in sorted(vr.items())},
            per_q={q: dict(n=x["n"], benar=x["benar"]) for q, x in sorted(pk.items()) if x})
    for q in Q:
        if not q["benar"]:
            GAGAL.append(dict(konfig=konfig, pengguna=q["tahap"], kode=q["kode"], kategori=KATEGORI.get(q["kode"]), status=q["status"],
                              detik=round(q["total_ms"] / 1000, 1), alat=[a for a in q.get("alat") or [] if a != "delegate_task"]))

ROWS = [BARIS[k] for k in sorted(BARIS, key=lambda k: (k[0], k[1]))]
KONFIG = sorted({r["konfig"] for r in ROWS})
A = {r["pengguna"]: r for r in ROWS if r["konfig"] == "seqs4"}
def nf(x, d=1): return "—" if x is None else f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")
# Titik belok: tahap pertama di mana menunggu kata pertama per pertanyaan > 3x nilai di 8 pengguna.
dasar = (A.get(8) or {}).get("tunggu_s") or 2
belok = next((n for n in sorted(A) if n > 8 and (A[n]["tunggu_s"] or 0) > 3 * dasar), None)
terbaik = max(A.values(), key=lambda r: r["per_menit"] or 0) if A else None
p50_rentang = [A[n]["p50"] for n in sorted(A) if 2 <= n <= 10]
TEKS = dict(
    ringkas=(f"Qwen3-14B di mesin B (4 salinan model, max-num-seqs 4) diuji dari 1 sampai {max(A) if A else '—'} pengguna yang bertanya bersamaan. "
             + (f"Dari 2 sampai 10 pengguna, waktu jawab tengah tetap di kisaran {nf(min(p50_rentang), 0)}–{nf(max(p50_rentang), 0)} detik "
                f"(1 pengguna: {nf(A[1]['p50'], 0)} detik), jadi belum ada antrean yang berarti. " if p50_rentang and A.get(1) else "")
             + (f"Mulai {belok} pengguna antrean di server mulai terasa: tiap pertanyaan menunggu giliran ±{nf(A[belok]['tunggu_s'], 0)} detik "
                f"(di 8 pengguna ±{nf(dasar, 0)} detik). " if belok else "")
             + (f"Di {max(A)} pengguna, waktu tengah naik ke {nf(A[max(A)]['p50'], 0)} detik, tetapi jumlah pertanyaan yang tuntas per menit masih naik "
                f"(tertinggi {nf(terbaik['per_menit'], 1)} di {terbaik['pengguna']} pengguna). Server belum jenuh: slot replika penuh "
                f"{nf(A[max(A)]['penuh_persen'], 0)}% waktu dan GPU sibuk {nf(A[max(A)]['gpu_util'], 0)}%." if A else "")),
    antrean=("Antrean dihitung dari dua sisi: waktu tunggu tiap panggilan di antrean vLLM (dari penghitung server), dan waktu tiap pertanyaan menunggu kata pertama "
             "(dari laptop). Keduanya baru naik tajam setelah melewati ±12 pengguna. LiteLLM membagi permintaan ke 4 salinan secara acak "
             "(simple-shuffle), tanpa melihat salinan mana yang sedang sibuk, jadi saat ramai satu salinan bisa antre jauh lebih lama daripada yang lain."),
    akurasi=("Ketepatan tidak turun karena beban. Yang gagal adalah pola yang sama seperti uji-uji sebelumnya: Q4 dijawab tanpa mencari SOP, Q5 (buat tiket) "
             "berputar antar agent sampai habis waktu atau berakhir kosong, Q8 sapaan memakai alat, dan sesekali Q1 tidak menuliskan angkanya."))
OUT = os.path.join(AKAR, "data", "agent-workflow-latency", "skala-14b"); os.makedirs(OUT, exist_ok=True)
DATA = dict(dibuat=datetime.now().strftime("%Y-%m-%d %H:%M"), harga_usd_per_jam=HARGA, konfig=KONFIG, sumber=SUMBER, baris=ROWS, gagal=GAGAL,
            kategori=KATEGORI, teks=TEKS, titik_belok=belok, terbaik=dict(pengguna=terbaik["pengguna"], per_menit=terbaik["per_menit"]) if terbaik else None)
json.dump(DATA, open(os.path.join(OUT, "skala.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)

tpl_lama = open(os.path.join(AKAR, "scripts", "dashboard-template.html"), encoding="utf-8").read()
css = tpl_lama[tpl_lama.index("<style>") + 7:tpl_lama.index("</style>")]
helper = tpl_lama[tpl_lama.index("/* ---------- format ---------- */"):tpl_lama.index("/* =================================================================== OVERVIEW */")]
tpl = open(os.path.join(AKAR, "scripts", "dashboard-skala-template.html"), encoding="utf-8").read()
out = (tpl.replace("/*__CSS__*/", css).replace("/*__HELPER__*/", helper)
       .replace("/*__DATA__*/null", json.dumps(DATA, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/").replace("<!--", "<\\!--")))
open(os.path.join(AKAR, "docs", "benchmark", "grafik", "grafik-skala-14b.html"), "w", encoding="utf-8").write(out)
print(json.dumps(dict(tahap=[(r["konfig"], r["pengguna"]) for r in ROWS], gagal=len(GAGAL), titik_belok=belok, dashboard=f"{len(out) // 1024} KB")))
