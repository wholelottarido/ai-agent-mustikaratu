"""Hitungan ramalan layanan Python. Belum dipakai portal, masih tahap perbandingan.

Tidak menyentuh database, supaya bisa diuji dengan deret buatan.
"""
import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import AutoETS, AutoTheta, Naive

MUSIM = 12
# Di bawah dua siklus penuh, pola musiman hanyalah satu kejadian yang terulang kebetulan.
MIN_MUSIMAN = 2 * MUSIM
MIN_BULAN = 6


def ramal(deret: list[float], akhir: str, horizon: int) -> dict[str, list[float]]:
    """Ramalan tiap model. Model yang gagal dilewati, bukan menggagalkan yang lain."""
    if len(deret) < MIN_BULAN:
        raise ValueError(f"riwayat minimal {MIN_BULAN} bulan, ada {len(deret)}")

    musim = MUSIM if len(deret) >= MIN_MUSIMAN else 1
    kandidat = [
        ("AutoETS", AutoETS(season_length=musim)),
        ("AutoTheta", AutoTheta(season_length=musim)),
        ("Naive", Naive()),
    ]
    tanggal = pd.date_range(end=pd.Timestamp(f"{akhir}-01"), periods=len(deret), freq="MS")
    data = pd.DataFrame({"unique_id": "produk", "ds": tanggal, "y": np.asarray(deret, dtype=float)})

    hasil: dict[str, list[float]] = {}
    for nama, model in kandidat:
        try:
            sf = StatsForecast(models=[model], freq="MS", n_jobs=1)
            f = sf.forecast(df=data, h=horizon)
            kolom = [c for c in f.columns if c not in ("unique_id", "ds")][0]
            nilai = f[kolom].to_numpy(dtype=float)
            if np.isfinite(nilai).all():
                # Penjualan tidak bisa negatif. Aturan penolakan yang lebih ketat tetap di sisi portal.
                hasil[nama] = [round(max(0.0, float(v)), 2) for v in nilai]
        except Exception as e:  # satu model gagal tidak boleh menjatuhkan yang lain
            print(f"[ramal] {nama} gagal: {type(e).__name__}: {e}")
    return hasil
