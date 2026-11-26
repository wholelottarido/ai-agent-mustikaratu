"""Layanan ramalan FastAPI. Hanya untuk perbandingan, portal belum memanggilnya.

    npm run forecast

Berjalan di 127.0.0.1, jadi tidak terjangkau dari komputer lain. Database dibaca lewat
akun baca saja yang sama dengan portal (`DEMO_PG_*`), bukan `DEMO_PG_ADMIN_*`.
"""
from pathlib import Path

import psycopg
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from model import ramal

ENV = dotenv_values(Path(__file__).resolve().parent.parent / ".env.local")
SUMBER = "ba_sales"

app = FastAPI(title="Layanan ramalan Ratu AI")


def sambung() -> psycopg.Connection:
    koneksi = psycopg.connect(
        host=ENV["DEMO_PG_HOST"],
        port=int(ENV.get("DEMO_PG_PORT") or 5432),
        dbname=ENV["DEMO_PG_DATABASE"],
        user=ENV["DEMO_PG_USER"],
        password=ENV["DEMO_PG_PASSWORD"],
        connect_timeout=10,
    )
    # Pagar kedua selain hak akun: sesi ini memang tidak bisa menulis.
    koneksi.read_only = True
    return koneksi


def deret_sku(sku: str, sampai: str | None) -> tuple[list[float], str]:
    """Deret unit bulanan. Bulan tanpa baris diisi 0, sama dengan portal (`deretSku`)."""
    sql = """SELECT to_char(period, 'YYYY-MM'), qty::float8 FROM ai_forecast_sales_monthly
              WHERE source = %s AND sku_code = %s AND (%s::text IS NULL OR to_char(period, 'YYYY-MM') <= %s)
              ORDER BY period"""
    with sambung() as k, k.cursor() as c:
        c.execute(sql, (SUMBER, sku, sampai, sampai))
        baris = c.fetchall()
    if not baris:
        raise HTTPException(404, f"produk {sku} tidak ada di data penjualan bulanan")

    ada = dict(baris)
    y, m = map(int, baris[0][0].split("-"))
    akhir_y, akhir_m = map(int, baris[-1][0].split("-"))
    deret: list[float] = []
    while (y, m) <= (akhir_y, akhir_m):
        deret.append(ada.get(f"{y}-{m:02d}", 0.0))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return deret, baris[-1][0]


class Permintaan(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    horizon: int = Field(default=12, ge=1, le=24)
    # Bulan terakhir yang boleh dilihat, untuk uji pada data lama.
    sampai: str | None = Field(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


@app.get("/sehat")
def sehat() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ramal")
def ramal_sku(p: Permintaan) -> dict[str, object]:
    deret, akhir = deret_sku(p.sku, p.sampai)
    try:
        hasil = ramal(deret, akhir, p.horizon)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return {"sku": p.sku, "data_terakhir": akhir, "panjang_bulan": len(deret), "ramalan": hasil}
