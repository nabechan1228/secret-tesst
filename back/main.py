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

def bv_to_color(bv: float) -> str:
    """
    B-V色指数から星の色 (RGB hex) を返す
    恒星スペクトル型に対応: O,B → 青白, A → 白, F,G → 黄白, K → オレンジ, M → 赤
    """
    if bv < -0.30:
        return "#9bb0ff"   # O型: 青白
    elif bv < 0.00:
        return "#aabfff"   # B型: 淡青白
    elif bv < 0.30:
        return "#cad7ff"   # A型: 白青
    elif bv < 0.58:
        return "#f8f7ff"   # F型: 純白
    elif bv < 0.81:
        return "#fff4ea"   # G型: 黄白 (太陽型)
    elif bv < 1.40:
        return "#ffd2a1"   # K型: オレンジ
    else:
        return "#ffcc6f"   # M型: 赤オレンジ


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
    Python による星間計算 (ユリウス日・恒星時・赤道→地平変換) を実施。
    """
    # --- 時刻解析 ---
    if time:
        try:
            dt = datetime.fromisoformat(time.replace('Z', '+00:00'))
        except ValueError:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    
    dt_utc = dt.astimezone(timezone.utc)
    
    # --- 星間計算 ---
    jd = get_julian_date(dt_utc)
    lst = get_local_sidereal_time(jd, lng)
    
    # --- 全星の地平座標計算 ---
    stars_raw = get_stars()
    visible_stars = []
    
    for star in stars_raw:
        mag = star['m']
        if mag > mag_limit:
            continue
        
        ra = star['r']   # 赤経 (時間)
        dec = star['d']  # 赤緯 (度)
        bv = star.get('b', 0.6)
        
        pos = equatorial_to_horizontal(ra, dec, lst, lat)
        
        visible_stars.append({
            "id": star['h'],        # HIP番号
            "ra": ra,
            "dec": dec,
            "mag": mag,
            "bv": bv,
            "color": bv_to_color(bv),
            "az": round(pos["az"], 4),
            "alt": round(pos["alt"], 4),
        })
    
    # --- 星座線データ (RA/Dec ベース・座標変換済み) ---
    lines_raw = get_constellation_lines()
    constellation_lines_out = []
    for cid, segments in lines_raw.items():
        converted_segments = []
        for seg in segments:
            ra1, dec1, ra2, dec2 = seg
            p1 = equatorial_to_horizontal(ra1, dec1, lst, lat)
            p2 = equatorial_to_horizontal(ra2, dec2, lst, lat)
            
            # 両端の点がともに地平線の下に深く沈んでいる（-15度以下）場合は除外
            if p1["alt"] < -15.0 and p2["alt"] < -15.0:
                continue
                
            converted_segments.append({
                "az1": round(p1["az"], 3), "alt1": round(p1["alt"], 3),
                "az2": round(p2["az"], 3), "alt2": round(p2["alt"], 3),
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

    # --- 深宇宙天体 (DSO) の地平座標計算 ---
    dso_out = []
    for obj in MESSIER_OBJECTS:
        pos = equatorial_to_horizontal(obj["ra"], obj["dec"], lst, lat)
        # 地平線より大きく下にある天体は除外 (-15度以下)
        if pos["alt"] < -15.0:
            continue
        dso_out.append({
            "id":      obj["id"],
            "name_ja": obj["name_ja"],
            "name_en": obj["name_en"],
            "type":    obj["type"],
            "size":    obj["size"],
            "mag":     obj["mag"],
            "az":      round(pos["az"],  3),
            "alt":     round(pos["alt"], 3),
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
    """
    if time:
        try:
            dt = datetime.fromisoformat(time.replace('Z', '+00:00'))
        except ValueError:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    
    dt_utc = dt.astimezone(timezone.utc)
    jd = get_julian_date(dt_utc)
    lst = get_local_sidereal_time(jd, lng)
    
    stars_raw = get_stars()
    result = []
    for star in stars_raw:
        if star['m'] > mag_limit:
            continue
        pos = equatorial_to_horizontal(star['r'], star['d'], lst, lat)
        result.append({
            "id": star['h'],
            "mag": star['m'],
            "bv": star.get('b', 0.6),
            "color": bv_to_color(star.get('b', 0.6)),
            "az": round(pos["az"], 3),
            "alt": round(pos["alt"], 3),
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