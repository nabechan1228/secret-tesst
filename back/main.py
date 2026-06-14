# -*- coding: utf-8 -*-
"""
Stellaris Professional Planetarium - Backend API
Python による精密な星間計算を行い、フロントエンドへ天体データを提供する。
星データはインターネットから取得済みの astro_data.json を使用 (5044星・88星座)
"""

import math
from datetime import datetime, timezone
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Dict, Any, List, Optional
import numpy as np

from astro_loader import get_stars, get_constellation_lines, get_constellation_meta, get_constellation_bounds
from planet_calc import get_planet_positions
from dso_data import MESSIER_OBJECTS

app = FastAPI(
    title="Stellaris Planetarium API",
    description="インターネット取得済みの実天体データを使用した精密プラネタリウムAPI",
    version="2.0.0"
)

# フロントエンドからのAPIアクセスを許可するCORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 天体計算アルゴリズム (Python実装)
# ==========================================

def get_julian_date(dt: datetime) -> float:
    """
    指定された datetime (UTC) からユリウス日 (Julian Date) を計算する
    精密版: グレゴリオ暦補正 (b) を含む
    """
    y = dt.year
    m = dt.month
    d = dt.day + dt.hour / 24.0 + dt.minute / 1440.0 + dt.second / 86400.0
    
    if m <= 2:
        y -= 1
        m += 12
        
    a = math.floor(y / 100)
    b = 2 - a + math.floor(a / 4)
    
    jd = math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5
    return jd

def get_local_sidereal_time(jd: float, lng: float) -> float:
    """
    ユリウス日と経度(東経)から、地方恒星時 (Local Sidereal Time: LST) を度数 (0 ~ 360) で計算する
    IAU 1982モデルに基づく
    """
    # J2000.0 からの経過ユリウス世紀数 T
    t = (jd - 2451545.0) / 36525.0
    
    # 平均グリニッジ恒星時 (GMST) を度数で計算
    gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t**2 - t**3 / 38710000.0
    gmst = gmst % 360.0
    if gmst < 0:
        gmst += 360.0
    
    # 地方恒星時 (LST) = GMST + 経度
    lst = (gmst + lng) % 360.0
    if lst < 0:
        lst += 360.0
    return lst

def parse_time_and_calc_lst(time_str: Optional[str], lng: float) -> tuple[datetime, float, float]:
    """
    ISO日時文字列をパースし、UTCのdatetime、ユリウス日(JD)、および地方恒星時(LST)を返す。
    """
    if time_str:
        try:
            dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
        except ValueError:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    
    dt_utc = dt.astimezone(timezone.utc)
    jd = get_julian_date(dt_utc)
    lst = get_local_sidereal_time(jd, lng)
    return dt_utc, jd, lst

def equatorial_to_horizontal(ra: float, dec: float, lst_deg: float, lat_deg: float) -> Dict[str, float]:
    """
    赤道座標 (RA, Dec) から地平座標 (方位角 Az, 高度 Alt) へ変換する
    - ra: 赤経 (時間: 0 ~ 24)
    - dec: 赤緯 (度: -90 ~ 90)
    - lst_deg: 地方恒星時 (度: 0 ~ 360)
    - lat_deg: 観測緯度 (度: -90 ~ 90)
    - 返却値: {"az": 方位角(度, 北=0, 東=90), "alt": 高度(度, 天頂=90, 地平線=0)}
    """
    # 時角 (Hour Angle) の計算 (度数)
    ha_deg = lst_deg - (ra * 15.0)
    
    # 計算用にラジアンに変換
    ha = math.radians(ha_deg)
    dec_rad = math.radians(dec)
    lat = math.radians(lat_deg)
    
    # 1. 高度 (Altitude) の計算
    sin_alt = math.sin(lat) * math.sin(dec_rad) + math.cos(lat) * math.cos(dec_rad) * math.cos(ha)
    sin_alt = max(-1.0, min(1.0, sin_alt))  # 誤差補正
    alt = math.asin(sin_alt)
    alt_deg = math.degrees(alt)
    
    # 2. 方位角 (Azimuth) の計算 (北=0, 東=90, 南=180, 西=270)
    y = -math.sin(ha) * math.cos(dec_rad)
    x = math.cos(lat) * math.sin(dec_rad) - math.sin(lat) * math.cos(dec_rad) * math.cos(ha)
    az = math.atan2(y, x)
    az_deg = math.degrees(az) % 360.0
    
    return {"az": az_deg, "alt": alt_deg}

def equatorial_to_horizontal_numpy(ra_arr: np.ndarray, dec_arr: np.ndarray, lst_deg: float, lat_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """
    複数の赤道座標 (RA, Dec) を一括して地平座標 (方位角 Az, 高度 Alt) へ変換する (NumPy ベクトル演算)
    - ra_arr: 赤経 (時間: 0 ~ 24) の1次元配列
    - dec_arr: 赤緯 (度: -90 ~ 90) の1次元配列
    """
    ha_deg = lst_deg - (ra_arr * 15.0)
    ha = np.radians(ha_deg)
    dec_rad = np.radians(dec_arr)
    lat = np.radians(lat_deg)
    
    # 高度の計算
    sin_alt = np.sin(lat) * np.sin(dec_rad) + np.cos(lat) * np.cos(dec_rad) * np.cos(ha)
    sin_alt = np.clip(sin_alt, -1.0, 1.0)
    alt = np.arcsin(sin_alt)
    alt_deg = np.degrees(alt)
    
    # 方位角の計算
    y = -np.sin(ha) * np.cos(dec_rad)
    x = np.cos(lat) * np.sin(dec_rad) - np.sin(lat) * np.cos(dec_rad) * np.cos(ha)
    az = np.arctan2(y, x)
    az_deg = np.degrees(az) % 360.0
    
    return az_deg, alt_deg

def bv_to_color(bv: Any) -> str:
    """
    B-V色指数から星の色 (RGB hex) を返す
    NaN や極端な値、型エラーがあった場合はデフォルト値 (太陽型 0.60: 黄白) を適用する。
    また、値は [-0.4, 2.0] の実用的な範囲に clamp (制限) する。
    """
    try:
        val = float(bv)
        if math.isnan(val):
            val = 0.60
    except (ValueError, TypeError):
        val = 0.60

    # 明示的な clamp 処理
    val = max(-0.4, min(2.0, val))

    if val < -0.30:
        return "#9bb0ff"   # O型: 青白
    elif val < 0.00:
        return "#aabfff"   # B型: 淡青白
    elif val < 0.30:
        return "#cad7ff"   # A型: 白青
    elif val < 0.58:
        return "#f8f7ff"   # F型: 純白
    elif val < 0.81:
        return "#fff4ea"   # G型: 黄白 (太陽型)
    elif val < 1.40:
        return "#ffd2a1"   # K型: オレンジ
    else:
        return "#ffcc6f"   # M型: 赤オレンジ


# HIP番号 → 星の日本語名
BRIGHT_STAR_NAMES = {
    32349: 'シリウス', 30438: 'カノープス', 69673: 'アークトゥルス',
    91262: 'ベガ', 24608: 'カペラ', 24436: 'リゲル',
    37279: 'プロキオン', 27989: 'ベテルギウス', 97649: 'アルタイル',
    21421: 'アルデバラン', 80763: 'アンタレス', 65474: 'スピカ',
    37826: 'ポルックス', 102098: 'デネブ', 113368: 'フォーマルハウト',
    49669: 'レグルス', 36850: 'カストル', 11767: 'ポラリス',
    25336: 'ミルファク', 68702: 'ミザール', 62956: 'アリオト',
    54061: 'ドゥーベ', 67301: 'アルカイド', 28380: 'ベラトリックス',
    27366: 'サイフ', 26727: 'アルニタク', 26311: 'アルニラム',
    25930: 'ミンタカ', 9884: 'アケルナル',
}


# ==========================================
# API エンドポイント
# ==========================================

@app.get("/api/sky")
def get_sky(
    lat: float = Query(35.68, description="観測緯度 (度, -90 ~ 90)"),
    lng: float = Query(139.76, description="観測経度 (度, -180 ~ 180)"),
    time: Optional[str] = Query(None, description="ISO 8601 日時文字列。省略時は現在のUTC時刻"),
    mag_limit: float = Query(6.0, description="最大等級フィルタ (デフォルト: 6等星以下)"),
):
    """
    指定された緯度・経度・時間で見える星の地平座標を返す。
    インターネットから取得した HIPパルコスカタログ (5044星) の精密データを使用。
    NumPy ベクトル演算により、座標計算の高速化を実現。
    """
    dt_utc, jd, lst = parse_time_and_calc_lst(time, lng)
    
    # --- 全星の地平座標計算 (NumPyで高速化) ---
    stars_raw = get_stars()
    
    # mag_limit 以下でフィルタリング
    filtered_stars = [star for star in stars_raw if star['m'] <= mag_limit]
    
    visible_stars = []
    if filtered_stars:
        ra_arr = np.array([star['r'] for star in filtered_stars], dtype=np.float64)
        dec_arr = np.array([star['d'] for star in filtered_stars], dtype=np.float64)
        
        az_arr, alt_arr = equatorial_to_horizontal_numpy(ra_arr, dec_arr, lst, lat)
        
        for i, star in enumerate(filtered_stars):
            bv = star.get('b', 0.6)
            visible_stars.append({
                "id": star['h'],        # HIP番号
                "name_ja": BRIGHT_STAR_NAMES.get(star['h']), # 星の日本語名
                "ra": star['r'],
                "dec": star['d'],
                "mag": star['m'],
                "bv": bv,
                "color": bv_to_color(bv),
                "az": round(az_arr[i], 4),
                "alt": round(alt_arr[i], 4),
            })
    
    # --- 星座線データ (RA/Dec ベース) ---
    lines_raw = get_constellation_lines()
    constellation_lines_out = []
    for cid, segments in lines_raw.items():
        converted_segments = []
        for seg in segments:
            ra1, dec1, ra2, dec2 = seg
            converted_segments.append({
                "ra1": ra1, "dec1": dec1,
                "ra2": ra2, "dec2": dec2
            })
        constellation_lines_out.append({"cid": cid, "segments": converted_segments})
    
    # --- 惑星位置計算 ---
    planets_out = get_planet_positions(
        jd=jd,
        lat=lat,
        lng=lng,
        equatorial_to_horizontal_fn=equatorial_to_horizontal,
        lst_deg=lst,
    )

    # --- 深宇宙天体 (DSO) の地平座標計算 (NumPyで高速化) ---
    dso_out = []
    if MESSIER_OBJECTS:
        ra_arr = np.array([obj["ra"] for obj in MESSIER_OBJECTS], dtype=np.float64)
        dec_arr = np.array([obj["dec"] for obj in MESSIER_OBJECTS], dtype=np.float64)
        
        az_arr, alt_arr = equatorial_to_horizontal_numpy(ra_arr, dec_arr, lst, lat)
        
        for i, obj in enumerate(MESSIER_OBJECTS):
            alt_val = alt_arr[i]
            # 地平線より大きく下にある天体は除外 (-15度以下)
            if alt_val < -15.0:
                continue
            dso_out.append({
                "id":      obj["id"],
                "name_ja": obj["name_ja"],
                "name_en": obj["name_en"],
                "type":    obj["type"],
                "size":    obj["size"],
                "mag":     obj["mag"],
                "az":      round(az_arr[i],  3),
                "alt":     round(alt_val, 3),
            })

    return {
        "datetime": dt_utc.isoformat(),
        "julian_date": round(jd, 6),
        "lst_deg": round(lst, 4),
        "stars": visible_stars,
        "constellation_lines": constellation_lines_out,
        "planets": planets_out,
        "deep_sky_objects": dso_out,
    }


@app.get("/api/constellations")
def get_constellations():
    """
    88星座のメタデータ (名前・説明・季節・中心座標) を返す。
    インターネットから取得した d3-celestial データを使用。
    """
    meta = get_constellation_meta()
    return {"constellations": meta}


@app.get("/api/sky/stars-only")
def get_stars_only(
    lat: float = Query(35.68),
    lng: float = Query(139.76),
    time: Optional[str] = Query(None),
    mag_limit: float = Query(4.0, description="明るい星のみ (高速レスポンス用)"),
):
    """
    明るい星のみの地平座標を返す軽量エンドポイント (初回描画高速化用)
    NumPy ベクトル演算を使用。
    """
    _, jd, lst = parse_time_and_calc_lst(time, lng)
    
    stars_raw = get_stars()
    filtered_stars = [star for star in stars_raw if star['m'] <= mag_limit]
    
    result = []
    if filtered_stars:
        ra_arr = np.array([star['r'] for star in filtered_stars], dtype=np.float64)
        dec_arr = np.array([star['d'] for star in filtered_stars], dtype=np.float64)
        
        az_arr, alt_arr = equatorial_to_horizontal_numpy(ra_arr, dec_arr, lst, lat)
        
        for i, star in enumerate(filtered_stars):
            bv = star.get('b', 0.6)
            result.append({
                "id": star['h'],
                "mag": star['m'],
                "bv": bv,
                "color": bv_to_color(bv),
                "az": round(az_arr[i], 3),
                "alt": round(alt_arr[i], 3),
            })
    
    return {"stars": result, "julian_date": round(jd, 6), "lst_deg": round(lst, 4)}


@app.get("/health")
def health():
    """ヘルスチェック"""
    stars = get_stars()
    meta = get_constellation_meta()
    return {
        "status": "ok",
        "stars_count": len(stars),
        "constellations_count": len(meta),
        "data_source": "d3-celestial HIPparcos catalog (internet)"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)