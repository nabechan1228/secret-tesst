# -*- coding: utf-8 -*-

import math
from datetime import datetime, timezone
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any

from star_catalog import STARS, CONSTELLATION_LINES, ASTERISMS

app = FastAPI(title="Professional Planetarium API")

# フロントエンドからのAPIアクセスを許可するCORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_julian_date(dt: datetime) -> float:
    """
    指定された datetime (UTC) からユリウス日 (Julian Date) を計算する
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
    """
    # J2000.0 からの経過ユリウス世紀数 T
    t = (jd - 2451545.0) / 36525.0
    
    # 平均グリニッジ恒星時 (GMST) を度数で計算
    gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t**2 - t**3 / 38710000.0
    gmst = gmst % 360.0
    
    # 地方恒星時 (LST) = GMST + 経度
    lst = gmst + lng
    return lst % 360.0

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
    # HA = LST - RA
    ha_deg = lst_deg - (ra * 15.0)
    
    # 計算用にラジアンに変換
    ha = math.radians(ha_deg)
    dec_rad = math.radians(dec)
    lat = math.radians(lat_deg)
    
    # 1. 高度 (Altitude) の計算
    sin_alt = math.sin(lat) * math.sin(dec_rad) + math.cos(lat) * math.cos(dec_rad) * math.cos(ha)
    sin_alt = max(-1.0, min(1.0, sin_alt)) # 誤差補正
    alt = math.asin(sin_alt)
    alt_deg = math.degrees(alt)
    
    # 2. 方位角 (Azimuth) の計算 (北=0, 東=90, 南=180, 西=270)
    y = -math.sin(ha) * math.cos(dec_rad)
    x = math.cos(lat) * math.sin(dec_rad) - math.sin(lat) * math.cos(dec_rad) * math.cos(ha)
    az = math.atan2(y, x)
    az_deg = math.degrees(az) % 360.0
    
    return {"az": az_deg, "alt": alt_deg}

@app.get("/api/sky")
def get_sky(
    lat: float = Query(35.68, description="Latitude in degrees (-90 to 90)"),
    lng: float = Query(139.76, description="Longitude in degrees (-180 to 180)"),
    time: str = Query(None, description="ISO 8601 datetime string. Defaults to current server time.")
):
    """
    指定された緯度・経度・時間において見える星と星座のデータを取得するAPI
    """
    if time:
        try:
            # ISO 8601 形式の文字列をパース
            dt = datetime.fromisoformat(time.replace('Z', '+00:00'))
        except ValueError:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
        
    # UTC 時間に合わせる
    dt_utc = dt.astimezone(timezone.utc)
    jd = get_julian_date(dt_utc)
    lst = get_local_sidereal_time(jd, lng)
    
    visible_stars = []
    star_map = {}
    
    # 全ての星の地平座標を計算
    for star in STARS:
        pos = equatorial_to_horizontal(star["ra"], star["dec"], lst, lat)
        
        # 地平線の下少し（-15度）まで描画対象に含める（ドラッグ/ズームによる表示領域の余裕のため）
        if pos["alt"] >= -15.0:
            star_data = {
                "id": star["id"],
                "name_en": star["name_en"],
                "name_ja": star["name_ja"],
                "mag": star["mag"],
                "az": pos["az"],
                "alt": pos["alt"]
            }
            visible_stars.append(star_data)
            star_map[star["id"]] = star_data
            
    # 地平線上の星同士を結ぶ星座線をフィルタリング
    visible_lines = []
    for line in CONSTELLATION_LINES:
        if line["from"] in star_map and line["to"] in star_map:
            visible_lines.append(line)
            
    # アステリズム（夏の大三角など）のフィルタリング
    visible_asterisms = []
    for ast in ASTERISMS:
        if ast["from"] in star_map and ast["to"] in star_map:
            visible_asterisms.append(ast)
            
    return {
        "datetime": dt_utc.isoformat(),
        "julian_date": jd,
        "lst_deg": lst,
        "stars": visible_stars,
        "constellations": visible_lines,
        "asterisms": visible_asterisms
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)