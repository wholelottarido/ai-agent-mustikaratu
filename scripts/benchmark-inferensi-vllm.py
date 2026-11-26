"""Benchmark kecepatan inferensi Qwen3-14B langsung ke vLLM (tanpa agent, LiteLLM, tunnel, portal).

Dijalankan DI SERVER lewat SSH, tanpa menulis berkas apa pun di sana:

    ssh mr-ec2 python3 -u - < scripts/benchmark-inferensi-vllm.py > data/benchmark-inferensi-qwen3-14b-<ts>.jsonl

Hanya pustaka bawaan Python. Tidak mengubah setelan server. Setiap hasil dicetak sebagai satu baris
JSON ke stdout, jadi kalau SSH putus, hasil yang sudah masuk tetap tersimpan di laptop.

Jenis baris (field "t"):
  info    setelan server & prompt
  gpu     sampel nvidia-smi tiap 0,5 detik
  m       sampel /metrics vLLM tiap 2 detik
  req     satu permintaan (fase "satu" = satu pengguna, "paralel" = beberapa sekaligus)
  ronde   satu putaran paralel (throughput gabungan)
  stop    benchmark dihentikan karena masalah
  selesai benchmark selesai normal

Aturan berhenti: HTTP >= 500, galat koneksi, atau preemption bertambah.
"""
import http.client, json, os, random, subprocess, sys, threading, time

HOST, PORT, MODEL = "127.0.0.1", 8000, "qwen3-14b"
INPUT = [512, 2048, 4096]          # target token prompt (setelah chat template)
OUTPUT = [128, 256, 512]           # token jawaban, dipaksa tepat lewat ignore_eos
ULANG = 5
PARALEL = [1, 2, 4]
PARALEL_IN, PARALEL_OUT = 2048, 256
SEED = 1234
TIMEOUT = 300

kunci = threading.Lock()
def emit(o):
    o.setdefault("ts", time.time())
    with kunci:
        sys.stdout.write(json.dumps(o, ensure_ascii=False) + "\n"); sys.stdout.flush()

# ---------- HTTP ----------
def panggil(path, body=None, method="POST"):
    c = http.client.HTTPConnection(HOST, PORT, timeout=TIMEOUT)
    c.request(method, path, body=json.dumps(body) if body is not None else None,
              headers={"Content-Type": "application/json"} if body is not None else {})
    r = c.getresponse(); data = r.read(); c.close()
    return r.status, data

def metrik():
    st, data = panggil("/metrics", method="GET")
    nilai = {}
    for baris in data.decode().splitlines():
        if baris.startswith("#") or not baris.startswith("vllm:"): continue
        nama = baris.split("{")[0].split(" ")[0]
        if nama in ("vllm:num_requests_running", "vllm:num_requests_waiting", "vllm:kv_cache_usage_perc",
                    "vllm:num_preemptions_total", "vllm:prefix_cache_queries_total", "vllm:prefix_cache_hits_total",
                    "vllm:prompt_tokens_total", "vllm:generation_tokens_total"):
            nilai[nama.split(":")[1]] = nilai.get(nama.split(":")[1], 0) + float(baris.rsplit(" ", 1)[1])
    return nilai

def jumlah_token(isi):
    st, data = panggil("/tokenize", dict(model=MODEL, messages=[{"role": "user", "content": isi}],
                                         add_generation_prompt=True, chat_template_kwargs={"enable_thinking": False}))
    if st != 200: raise RuntimeError(f"/tokenize {st}: {data[:200]}")
    return json.loads(data)["count"]

# ---------- prompt ----------
# Teks umum tetap (bukan data perusahaan). Kode di awal menentukan cold/warm untuk cache prompt.
KALIMAT = [
    "Sebuah kota kecil di tepi sungai tumbuh perlahan dari pasar ikan menjadi pusat perdagangan rempah.",
    "Para pedagang datang membawa kain, garam, dan logam, lalu pulang membawa lada serta cengkih.",
    "Musim hujan mengubah jalan tanah menjadi lumpur, sehingga perahu menjadi alat angkut yang utama.",
    "Penduduk membangun gudang panggung agar barang dagangan tetap kering ketika air sungai meluap.",
    "Anak-anak belajar menghitung dari timbangan di pasar sebelum mereka mengenal sekolah resmi.",
    "Setiap tahun diadakan perayaan panen yang mempertemukan petani dari desa-desa di hulu sungai.",
    "Catatan pelabuhan menyebut jumlah kapal yang singgah, jenis muatan, dan lama mereka berlabuh.",
    "Perubahan harga lada di pelabuhan besar terasa sampai ke kota ini hanya dalam beberapa minggu.",
]
PERINTAH = "\n\nTugas: tulis ringkasan yang sangat panjang dan rinci dari teks di atas, paragraf demi paragraf."

def teks(n_paragraf):
    return "\n".join(f"Paragraf {i + 1}. " + " ".join(KALIMAT[(i + k) % len(KALIMAT)] for k in range(4)) for i in range(n_paragraf))

def susun(kode, n):
    return f"[Kode dokumen {kode}]\n" + teks(n) + PERINTAH

def cari_paragraf(target):
    lo, hi = 1, 400
    while lo < hi:  # paragraf terkecil yang membuat prompt >= target
        mid = (lo + hi) // 2
        if jumlah_token(susun("0000000000", mid)) >= target: hi = mid
        else: lo = mid + 1
    return lo

# ---------- satu permintaan ----------
def kirim(isi, maks, stream):
    body = dict(model=MODEL, messages=[{"role": "user", "content": isi}], max_tokens=maks, temperature=0, seed=SEED,
                ignore_eos=True, chat_template_kwargs={"enable_thinking": False})
    if stream: body.update(stream=True, stream_options={"include_usage": True})
    hasil = dict(stream=stream, max_tokens=maks)
    t0 = time.perf_counter()
    c = http.client.HTTPConnection(HOST, PORT, timeout=TIMEOUT)
    try:
        c.request("POST", "/v1/chat/completions", body=json.dumps(body), headers={"Content-Type": "application/json"})
        r = c.getresponse(); hasil["http"] = r.status
        if r.status != 200:
            hasil["galat"] = r.read()[:300].decode(errors="replace"); return hasil
        if not stream:
            d = json.loads(r.read()); t1 = time.perf_counter()
            hasil.update(total=t1 - t0, prompt_tokens=d["usage"]["prompt_tokens"], completion_tokens=d["usage"]["completion_tokens"],
                         finish=d["choices"][0]["finish_reason"])
            return hasil
        pertama = terakhir = None; potongan = 0; usage = None; finish = None; jeda = []
        while True:
            baris = r.readline()
            if not baris: break
            baris = baris.strip()
            if not baris.startswith(b"data:"): continue
            isi_ = baris[5:].strip()
            if isi_ == b"[DONE]": break
            d = json.loads(isi_)
            if d.get("usage"): usage = d["usage"]
            for ch in d.get("choices", []):
                delta = ch.get("delta", {})
                if delta.get("content") or delta.get("reasoning_content") or delta.get("reasoning"):
                    t = time.perf_counter()
                    if pertama is None: pertama = t
                    elif terakhir is not None: jeda.append(t - terakhir)
                    terakhir = t; potongan += 1
                if ch.get("finish_reason"): finish = ch["finish_reason"]
        t1 = time.perf_counter()
        hasil.update(total=t1 - t0, finish=finish, potongan=potongan)
        if usage: hasil.update(prompt_tokens=usage["prompt_tokens"], completion_tokens=usage["completion_tokens"])
        if pertama is not None:
            hasil["ttft"] = pertama - t0
            n = hasil.get("completion_tokens") or potongan
            if n > 1 and terakhir > pertama: hasil["tpot"] = (terakhir - pertama) / (n - 1)
            if jeda:
                jeda.sort(); hasil["jeda_p50"] = jeda[len(jeda) // 2]; hasil["jeda_p95"] = jeda[min(len(jeda) - 1, int(len(jeda) * .95))]
        return hasil
    except Exception as e:
        hasil["galat"] = f"{type(e).__name__}: {e}"; return hasil
    finally:
        c.close()

# ---------- perekam ----------
berhenti = threading.Event()
def rekam_gpu():
    p = subprocess.Popen(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,power.draw,temperature.gpu,clocks.sm",
                          "--format=csv,noheader,nounits", "-lms", "500"], stdout=subprocess.PIPE, text=True)
    for baris in p.stdout:
        if berhenti.is_set(): break
        try:
            u, mu, mt, pw, tp, clk = [x.strip() for x in baris.split(",")]
            emit(dict(t="gpu", util=float(u), vram=float(mu), vram_total=float(mt), watt=float(pw), suhu=float(tp), clock=float(clk)))
        except ValueError:
            pass
    p.terminate()

def rekam_metrik():
    while not berhenti.is_set():
        try: emit(dict(t="m", **metrik()))
        except Exception as e: emit(dict(t="m", galat=str(e)))
        berhenti.wait(2)

def stop(alasan):
    emit(dict(t="stop", alasan=alasan)); berhenti.set(); time.sleep(1); sys.exit(1)

def periksa(h, m0):
    if h.get("galat") or h.get("http", 200) >= 500: stop(f"permintaan gagal: {h.get('http')} {h.get('galat')}")
    m1 = metrik()
    if m1["num_preemptions_total"] > m0["num_preemptions_total"]:
        stop(f"preemption bertambah {m1['num_preemptions_total'] - m0['num_preemptions_total']:.0f}")
    return m1

def tunggu_sepi():
    for _ in range(30):
        m = metrik()
        if m["num_requests_running"] == 0 and m["num_requests_waiting"] == 0: return
        time.sleep(2)
    stop("server model sedang dipakai pihak lain; benchmark tidak dimulai")

# ---------- jalan ----------
def utama():
    tunggu_sepi()
    info = dict(t="info", model=MODEL, seed=SEED, ulang=ULANG, input=INPUT, output=OUTPUT, paralel=PARALEL,
                paralel_in=PARALEL_IN, paralel_out=PARALEL_OUT)
    try:
        info["args"] = json.loads(subprocess.run(["docker", "inspect", "qwen3-vllm", "--format", "{{json .Args}}"],
                                                 capture_output=True, text=True).stdout)
        info["gpu"] = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,power.limit", "--format=csv,noheader"],
                                     capture_output=True, text=True).stdout.strip()
    except Exception as e:
        info["galat_info"] = str(e)
    n_par = {}
    for target in INPUT:
        n_par[target] = cari_paragraf(target)
    info["paragraf"] = n_par
    info["token_prompt_template"] = {t: jumlah_token(susun("0000000000", n)) for t, n in n_par.items()}
    emit(info)
    threading.Thread(target=rekam_gpu, daemon=True).start()
    threading.Thread(target=rekam_metrik, daemon=True).start()
    time.sleep(3)  # rekam kondisi diam sebentar
    kode = lambda: "".join(random.choice("0123456789abcdef") for _ in range(10))

    # --- satu pengguna ---
    for target in INPUT:
        for maks in OUTPUT:
            kw = kode(); warm = susun(kw, n_par[target])
            m = metrik()
            h = kirim(warm, maks, True); m2 = periksa(h, m)
            emit(dict(t="req", fase="satu", jenis="pemanasan", input=target, output=maks, ulang=0, **h))
            m = m2
            for stream in (True, False):
                for cache in ("warm", "cold"):
                    for i in range(1, ULANG + 1):
                        isi = warm if cache == "warm" else susun(kode(), n_par[target])
                        t_mulai = time.time()
                        h = kirim(isi, maks, stream); m2 = periksa(h, m)
                        q = m2["prefix_cache_queries_total"] - m["prefix_cache_queries_total"]
                        hit = m2["prefix_cache_hits_total"] - m["prefix_cache_hits_total"]
                        emit(dict(t="req", fase="satu", jenis=cache, input=target, output=maks, ulang=i, mulai=t_mulai, selesai=time.time(),
                                  cache_query=q, cache_hit=hit, **h))
                        m = m2

    # --- paralel ---
    for n in PARALEL:
        for r in range(1, ULANG + 1):
            tunggu_sepi()
            m = metrik(); hasil = [None] * n; gerbang = threading.Barrier(n)
            def kerja(j):
                isi = susun(kode(), n_par[PARALEL_IN]); gerbang.wait()
                hasil[j] = dict(mulai=time.time(), **kirim(isi, PARALEL_OUT, True)); hasil[j]["selesai"] = time.time()
            th = [threading.Thread(target=kerja, args=(j,)) for j in range(n)]
            t0 = time.time()
            for x in th: x.start()
            for x in th: x.join()
            t1 = time.time()
            for j, h in enumerate(hasil):
                emit(dict(t="req", fase="paralel", jenis="cold", input=PARALEL_IN, output=PARALEL_OUT, paralel=n, ronde=r, ke=j + 1, **h))
            for h in hasil: periksa(h, m)
            keluar = sum(h.get("completion_tokens", 0) for h in hasil)
            emit(dict(t="ronde", paralel=n, ronde=r, mulai=t0, selesai=t1, dinding=t1 - t0, token_keluar=keluar, tps_gabungan=keluar / (t1 - t0)))
            time.sleep(3)

    time.sleep(3)
    emit(dict(t="selesai", metrik_akhir=metrik())); berhenti.set()

utama()
