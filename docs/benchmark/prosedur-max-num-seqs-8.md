# Prosedur: max-num-seqs 4 → 8 di 4 replika Qwen3-14B (g5.12xlarge)

**Status:** rancangan, BELUM dijalankan. Jalankan hanya setelah disetujui pemilik server.
**Disusun:** 23 Nov 2026, dari `docker inspect` keempat container (hanya membaca).

## 1. Setelan aktual (diverifikasi 23 Nov 2026)

| Container | GPU | Port host | Jaringan | Lainnya |
|---|---:|---|---|---|
| `qwen14-vllm` | 0 | 127.0.0.1:8000 | `bridge` **+** `qwen14-internal` | |
| `qwen14-gpu1` | 1 | 127.0.0.1:8001 | `qwen14-internal` | |
| `qwen14-gpu2` | 2 | 127.0.0.1:8002 | `qwen14-internal` | |
| `qwen14-gpu3` | 3 | 127.0.0.1:8003 | `qwen14-internal` | |

Sama di keempatnya:
- image `vllm/vllm-openai:nightly`, image ID `390a656b54e1` (vLLM `0.33.0rc1.dev1030`, sama dengan uji 20 Nov)
- `--ipc host`, `--shm-size 64m`, restart `unless-stopped`
- volume `/opt/dlami/nvme/qwen-models/hf-cache:/root/.cache/huggingface` (disk ephemeral)
- tidak ada env tambahan (tanpa `HF_TOKEN`)
- argumen: `serve Qwen/Qwen3-14B-AWQ --served-model-name qwen3-14b --tensor-parallel-size 1 --quantization awq --max-model-len 16384 --gpu-memory-utilization 0.85 --max-num-seqs 4 --enable-auto-tool-choice --tool-call-parser hermes --reasoning-parser qwen3`

LiteLLM (`/home/ubuntu/qwen14-gateway/config.yaml`) memanggil replika lewat **nama container** (`http://qwen14-gpu1:8000/v1`, dst.), jadi nama container baru **harus sama persis**.

## 2. Apakah 8 slot muat di memori?

| | Nilai |
|---|---:|
| KV cache per replika (log vLLM) | 57.856 token |
| Konkurensi penuh 16.384 token (log vLLM) | 3,53× |
| Token masuk per panggilan agent (uji 20 Nov) | median 3.836 · P90 6.655 · maks 8.003 |
| Token keluar per panggilan | median 277 · P90 920 · maks 1.586 |

Rata-rata 8 permintaan × ±4.100 token ≈ 33.000 token, jadi **biasanya muat**. Tapi kalau beberapa permintaan panjang (±7.000–9.500 token) kebetulan berbarengan di satu replika, KV cache penuh dan vLLM akan **preemption** (permintaan dijeda lalu dihitung ulang). Ini bukan galat, tapi menambah latensi. Penghitung `vllm:num_preemptions_total` sudah ikut dicatat skrip uji, jadi efeknya akan terlihat di hasil.

Setelan lain (`max-model-len`, `gpu-memory-utilization`) **tidak diubah**, supaya perbandingan A vs B hanya beda di `max-num-seqs`.

## 3. Prosedur (per replika, satu per satu)

Container lama **tidak dihapus**, hanya diganti namanya jadi `*-backup-seqs4` (pola yang sama dengan `qwen38-vllm-backup-seqs2` yang sudah ada di server). Image dipanggil lewat ID supaya tidak menarik `nightly` yang lebih baru.

```bash
ssh mr-g5-12x

# 0. Simpan setelan lengkap semua replika (untuk rollback & audit)
mkdir -p ~/backup-seqs4 && for c in qwen14-vllm qwen14-gpu1 qwen14-gpu2 qwen14-gpu3; do docker inspect $c > ~/backup-seqs4/$c.json; done

# 1. Contoh untuk qwen14-gpu1 (GPU 1, port 8001). Ulangi untuk gpu2 (GPU 2, 8002) dan gpu3 (GPU 3, 8003).
docker stop qwen14-gpu1
docker rename qwen14-gpu1 qwen14-gpu1-backup-seqs4
docker update --restart=no qwen14-gpu1-backup-seqs4
docker run -d --name qwen14-gpu1 --gpus '"device=1"' --ipc host --shm-size 64m --restart unless-stopped \
  --network qwen14-internal -p 127.0.0.1:8001:8000 \
  -v /opt/dlami/nvme/qwen-models/hf-cache:/root/.cache/huggingface \
  390a656b54e1 \
  serve Qwen/Qwen3-14B-AWQ --served-model-name qwen3-14b --tensor-parallel-size 1 --quantization awq \
  --max-model-len 16384 --gpu-memory-utilization 0.85 --max-num-seqs 8 \
  --enable-auto-tool-choice --tool-call-parser hermes --reasoning-parser qwen3

# 2. qwen14-vllm (GPU 0, port 8000) berbeda: jaringan utama `bridge`, lalu disambung ke `qwen14-internal`
docker stop qwen14-vllm && docker rename qwen14-vllm qwen14-vllm-backup-seqs4 && docker update --restart=no qwen14-vllm-backup-seqs4
docker run -d --name qwen14-vllm --gpus '"device=0"' --ipc host --shm-size 64m --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v /opt/dlami/nvme/qwen-models/hf-cache:/root/.cache/huggingface \
  390a656b54e1 \
  serve Qwen/Qwen3-14B-AWQ --served-model-name qwen3-14b --tensor-parallel-size 1 --quantization awq \
  --max-model-len 16384 --gpu-memory-utilization 0.85 --max-num-seqs 8 \
  --enable-auto-tool-choice --tool-call-parser hermes --reasoning-parser qwen3
docker network connect qwen14-internal qwen14-vllm
```

## 4. Pemeriksaan setelah ganti (wajib sebelum uji)

```bash
# sehat (tunggu ±2–3 menit per replika sampai model termuat)
for p in 8000 8001 8002 8003; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:$p/health)"; done
# setelan baru benar-benar terpasang
for c in qwen14-vllm qwen14-gpu1 qwen14-gpu2 qwen14-gpu3; do echo "$c $(docker inspect $c --format '{{join .Args " "}}' | grep -o 'max-num-seqs [0-9]*')"; done
# KV cache & konkurensi (bandingkan dengan 57.856 token / 3,53x)
for c in qwen14-vllm qwen14-gpu1 qwen14-gpu2 qwen14-gpu3; do docker logs $c 2>&1 | grep -E "GPU KV cache size" | tail -1; done
# jaringan: qwen14-vllm harus di bridge + qwen14-internal
docker inspect qwen14-vllm --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
nvidia-smi --query-gpu=index,memory.used --format=csv
```

Dari laptop, uji kering skrip juga akan menampilkan `max-num-seqs` tiap port:

```powershell
npx tsx --env-file=.env.local scripts/profil-alur-agent.mts --model mr-ai-gateway-4gpu --ssh-host mr-g5-12x `
  --port 8000,8001,8002,8003 --db-container qwen14-postgres --model-litellm qwen3-14b --fase pemanasan,beban `
  --concurrency 10,12,16,20 --label cek --dry-run
```

## 5. Rollback (kembali ke max-num-seqs 4)

```bash
for c in qwen14-gpu1 qwen14-gpu2 qwen14-gpu3 qwen14-vllm; do
  docker stop $c && docker rm $c
  docker rename $c-backup-seqs4 $c
  docker update --restart=unless-stopped $c
  docker start $c
done
# qwen14-vllm lama sudah tersambung ke kedua jaringan; tidak perlu network connect lagi
```

Lalu ulangi pemeriksaan di bagian 4 (harus kembali `max-num-seqs 4` dan 57.856 token).

## 6. Yang tidak disentuh

- Konfigurasi LiteLLM (`config.yaml`) dan container `qwen14-litellm`, `qwen14-postgres`.
- Container `qwen38-*` dan `qwen35-vllm`.
- Model di cache `/opt/dlami/nvme/qwen-models` (tidak diunduh ulang selama image & cache sama).
