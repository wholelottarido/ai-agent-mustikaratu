"""Membuat ramalan AutoETS dan AutoTheta pada data lama, untuk dinilai `ukur-gabungan.mts`.

    .venv\\Scripts\\python banding.py <berkas-keluaran.json>

HANYA MEMBACA. Produk dan titik potongnya mengikuti `ukur-gabungan.mts`, dan ramalan hanya
melihat data sampai titik potong. Yang dinilai skrip itu, supaya caranya sama dengan
cara yang lain pada produk yang sama.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg
from dotenv import dotenv_values
from statsforecast import StatsForecast
from statsforecast.models import AutoETS, AutoTheta, Naive

POTONG = [12, 18, 24]
MIN_LATIH = 12
BULAN_BERHENTI = 3
JARAK = 12
MUSIM = 12
POTONGAN = 50

ENV = dotenv_values(Path(__file__).resolve().parent.parent / ".env.local")


def ke_angka(bulan: str) -> int:
    y, m = map(int, bulan.split("-"))
    return y * 12 + m - 1


def ke_bulan(n: int) -> str:
    return f"{n // 12}-{n % 12 + 1:02d}"


def baca() -> tuple[dict[str, dict[int, float]], int]:
    k = psycopg.connect(
        host=ENV["DEMO_PG_HOST"], port=int(ENV.get("DEMO_PG_PORT") or 5432), dbname=ENV["DEMO_PG_DATABASE"],
        user=ENV["DEMO_PG_USER"], password=ENV["DEMO_PG_PASSWORD"], connect_timeout=15,
    )
    k.read_only = True
    with k, k.cursor() as c:
        c.execute(
            """SELECT sku_code, to_char(period, 'YYYY-MM'), qty::float8 FROM ai_forecast_sales_monthly
                WHERE source = 'ba_sales' AND sku_code IN (
                  SELECT sku_code FROM ai_forecast_sales_monthly WHERE source = 'ba_sales'
                   GROUP BY sku_code HAVING count(*) >= %s)""",
            (MIN_LATIH + POTONG[0],),
        )
        data: dict[str, dict[int, float]] = {}
        for sku, bulan, qty in c.fetchall():
            data.setdefault(sku, {})[ke_angka(bulan)] = qty
        c.execute("SELECT to_char(max(period), 'YYYY-MM') FROM ai_forecast_sales_monthly WHERE source = 'ba_sales'")
        akhir = ke_angka(c.fetchone()[0])
    return data, akhir


def siapkan(data: dict[str, dict[int, float]], akhir: int) -> pd.DataFrame:
    baris = []
    for sku, isi in data.items():
        awal = min(isi)
        for potong in POTONG:
            titik = akhir - potong
            if titik > max(isi) or titik - awal + 1 < MIN_LATIH:
                continue
            bulan = list(range(awal, titik + 1))
            y = [isi.get(b, 0.0) for b in bulan]
            jual = [b for b, v in zip(bulan, y) if v > 0]
            if not jual or titik - jual[-1] >= BULAN_BERHENTI:
                continue
            kunci = f"{sku}|{ke_bulan(titik)}"
            baris.extend((kunci, pd.Timestamp(f"{ke_bulan(b)}-01"), v) for b, v in zip(bulan, y))
    return pd.DataFrame(baris, columns=["unique_id", "ds", "y"])


def ramal_kelompok(df: pd.DataFrame, musim: int) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    # Satu proses per potongan: empat proses paralel menghabiskan memori laptop dan mati.
    # Cadangan Naive supaya satu deret yang gagal tidak menjatuhkan seluruh potongan.
    kunci = df["unique_id"].unique()
    hasil = []
    for i in range(0, len(kunci), POTONGAN):
        bagian = df[df["unique_id"].isin(kunci[i : i + POTONGAN])]
        sf = StatsForecast(
            models=[AutoETS(season_length=musim), AutoTheta(season_length=musim)],
            freq="MS", n_jobs=1, fallback_model=Naive(),
        )
        hasil.append(sf.forecast(df=bagian, h=JARAK))
        print(f"  musim {musim}: {min(i + POTONGAN, len(kunci))}/{len(kunci)}", flush=True)
    return pd.concat(hasil)


def main() -> None:
    mulai = time.time()
    data, akhir = baca()
    df = siapkan(data, akhir)
    panjang = df.groupby("unique_id")["y"].transform("size")
    print(f"{df['unique_id'].nunique()} deret dari {len(data)} produk")
    # Di bawah dua siklus penuh, pola musiman tidak bisa dibedakan dari kejadian sekali lewat.
    hasil = pd.concat([ramal_kelompok(df[panjang >= 2 * MUSIM], MUSIM), ramal_kelompok(df[panjang < 2 * MUSIM], 1)])

    keluaran: dict[str, dict[str, list[float]]] = {}
    for kunci, f in hasil.groupby("unique_id"):
        f = f.sort_values("ds")
        keluaran[str(kunci)] = {
            "autoets": np.maximum(f["AutoETS"].to_numpy(dtype=float), 0).round(2).tolist(),
            "autotheta": np.maximum(f["AutoTheta"].to_numpy(dtype=float), 0).round(2).tolist(),
        }
    Path(sys.argv[1]).write_text(json.dumps(keluaran), encoding="utf-8")
    print(f"selesai {round(time.time() - mulai)} dtk, {len(keluaran)} deret")


if __name__ == "__main__":
    main()
