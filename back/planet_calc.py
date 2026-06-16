# -*- coding: utf-8 -*-
"""
planet_calc.py
ケプラーの軌道要素に基づく惑星位置計算モジュール
Meeus "Astronomical Algorithms" 2nd Ed. の簡易近似式を使用

精度：±0.5〜2度程度（肉眼観察には十分）
対象：水星・金星・火星・木星・土星（肉眼5惑星）
"""

import math
from typing import List, Dict, Any


# =====================================================
# 軌道要素定数（J2000.0 基準、Meeus 表 31.a / 32.a 準拠）
# 各係数: [L0, L1] の形で L = L0 + L1 * T を表す（Tはユリウス世紀）
# =====================================================

PLANET_ELEMENTS = {
    "Mercury": {
        "name_ja": "水星",
        "color": "#b5b5b5",
        # 軌道要素 [基準値, T 係数]
        "L":    [252.250906, 149472.6746358],  # 平均経度 (度)
        "a":    [0.387098310, 0.0],              # 半長軸 (AU)
        "e":    [0.20563175, 0.000020406],       # 離心率
        "i":    [7.004986, -0.0059516],          # 軌道傾斜角 (度)
        "omega":[77.456119, 0.1588643],          # 近日点黄経 (度)
        "node": [48.330893, -0.1254229],         # 昇交点黄経 (度)
        "mag_base": -0.42,
    },
    "Venus": {
        "name_ja": "金星",
        "color": "#ffe4a0",
        "L":    [181.979801, 58517.8156760],
        "a":    [0.723329820, 0.0],
        "e":    [0.00677188, -0.000047766],
        "i":    [3.394662, -0.0008568],
        "omega":[131.563707, 0.0048646],
        "node": [76.679920, -0.2780080],
        "mag_base": -4.40,
    },
    "Mars": {
        "name_ja": "火星",
        "color": "#ff7043",
        "L":    [355.433275, 19140.2993313],
        "a":    [1.523679342, 0.0],
        "e":    [0.09340062, 0.000090483],
        "i":    [1.849726, -0.0006011],
        "omega":[336.060234, 0.4438016],
        "node": [49.558093, -0.2949846],
        "mag_base": -1.52,
    },
    "Jupiter": {
        "name_ja": "木星",
        "color": "#f5cba7",
        "L":    [34.351484, 3034.9056746],
        "a":    [5.202603191, 0.0000001913],
        "e":    [0.04849485, 0.000163244],
        "i":    [1.303270, -0.0054966],
        "omega":[14.331309, 0.2155525],
        "node": [100.464441, 0.1766828],
        "mag_base": -9.40,
    },
    "Saturn": {
        "name_ja": "土星",
        "color": "#f8f0d0",
        "L":    [50.077444, 1222.1138488],
        "a":    [9.554909596, -0.0000021389],
        "e":    [0.05550825, -0.000346641],
        "i":    [2.488878, 0.0025514],
        "omega":[93.057237, 0.5665415],
        "node": [113.665524, -0.2566649],
        "mag_base": -8.88,
    },
}

# 黄道傾斜角 (J2000.0)
ECLIPTIC_OBLIQUITY_J2000 = 23.439291111  # 度


# =====================================================
# 内部ユーティリティ
# =====================================================

def _normalize_degrees(deg: float) -> float:
    """角度を 0〜360 に正規化"""
    return deg % 360.0


def _solve_kepler(M_deg: float, e: float, tolerance: float = 1e-8) -> float:
    """
    ケプラー方程式 E - e*sin(E) = M を Newton 法で解く
    M: 平均近点角 (度)
    E: 離心近点角 (度) を返す
    """
    M = math.radians(M_deg)
    E = M  # 初期値
    for _ in range(100):
        dE = (M - (E - e * math.sin(E))) / (1.0 - e * math.cos(E))
        E += dE
        if abs(dE) < tolerance:
            break
    return math.degrees(E)


def _planet_heliocentric_ecliptic(planet_key: str, T: float) -> Dict[str, float]:
    """
    指定惑星の日心黄道直交座標 (x, y, z) [AU] を計算する
    T: J2000.0 からのユリウス世紀数
    """
    el = PLANET_ELEMENTS[planet_key]

    # 軌道要素を T で評価
    L     = _normalize_degrees(el["L"][0]     + el["L"][1]     * T)
    a     = el["a"][0]     + el["a"][1]     * T
    e     = el["e"][0]     + el["e"][1]     * T
    i_deg = el["i"][0]     + el["i"][1]     * T
    omega = _normalize_degrees(el["omega"][0] + el["omega"][1] * T)  # 近日点黄経
    node  = _normalize_degrees(el["node"][0]  + el["node"][1]  * T)  # 昇交点黄経

    # 近点引数 w = 近日点黄経 - 昇交点黄経
    w = _normalize_degrees(omega - node)

    # 平均近点角 M = 平均経度 - 近日点黄経
    M = _normalize_degrees(L - omega)

    # ケプラー方程式を解いて離心近点角 E を求める
    E_deg = _solve_kepler(M, e)
    E = math.radians(E_deg)

    # 軌道面内の直交座標
    x_orb = a * (math.cos(E) - e)
    y_orb = a * math.sqrt(1.0 - e * e) * math.sin(E)

    # 軌道面 → 黄道面への回転
    i   = math.radians(i_deg)
    w_r = math.radians(w)
    n_r = math.radians(node)

    cos_n, sin_n = math.cos(n_r), math.sin(n_r)
    cos_w, sin_w = math.cos(w_r), math.sin(w_r)
    cos_i, sin_i = math.cos(i),   math.sin(i)

    # 回転行列適用
    x = (cos_n * cos_w - sin_n * sin_w * cos_i) * x_orb + \
        (-cos_n * sin_w - sin_n * cos_w * cos_i) * y_orb
    y = (sin_n * cos_w + cos_n * sin_w * cos_i) * x_orb + \
        (-sin_n * sin_w + cos_n * cos_w * cos_i) * y_orb
    z = (sin_w * sin_i) * x_orb + (cos_w * sin_i) * y_orb

    return {"x": x, "y": y, "z": z}


def _earth_heliocentric_ecliptic(T: float) -> Dict[str, float]:
    """
    地球の日心黄道直交座標 (x, y, z) [AU] を計算する
    簡易式（地球軌道は円に近いため near-circular 近似で十分）
    """
    L_sun = 280.46646 + 36000.76983 * T  # 太陽の平均経度 (度)
    M_sun = 357.52911 + 35999.05029 * T  # 太陽の平均近点角 (度)
    M_sun_r = math.radians(M_sun)

    # 中心差 (equation of center)
    C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * math.sin(M_sun_r) + \
        (0.019993 - 0.000101 * T) * math.sin(2 * M_sun_r) + \
        0.000289 * math.sin(3 * M_sun_r)

    # 太陽の真経度（地球から見た太陽の方向）
    sun_lon = _normalize_degrees(L_sun + C)

    # 地球の日心黄経は太陽経度 + 180 度
    earth_lon = math.radians(_normalize_degrees(sun_lon + 180.0))

    # 地球-太陽距離（近似）
    r = 1.000001018 * (1.0 - 0.016708634 * 0.016708634) / \
        (1.0 + 0.016708634 * math.cos(math.radians(M_sun + C)))

    return {
        "x": r * math.cos(earth_lon),
        "y": r * math.sin(earth_lon),
        "z": 0.0,
    }


def _moon_geocentric_ecliptic(T: float) -> Dict[str, float]:
    """
    地球から見た月の地心黄道座標 (lon, lat, dist) を計算する簡易式
    T: J2000.0 からのユリウス世紀数
    """
    # 月の平均経度 (度)
    L_prime = (218.3164477 + 481267.88123421 * T) % 360.0
    # 太陽の平均近点角 (度)
    M = (357.5291092 + 35999.0502909 * T) % 360.0
    # 月の平均近点角 (度)
    M_prime = (134.9633964 + 477198.8675055 * T) % 360.0
    # 月の平均緯度引数 (度)
    F = (93.2720950 + 483202.0175233 * T) % 360.0
    # 太陽と月の平均離角 (度)
    D = (297.8501921 + 445267.1114034 * T) % 360.0

    # 主要摂動項を加算
    lon = L_prime + \
          6.289 * math.sin(math.radians(M_prime)) + \
          1.274 * math.sin(math.radians(2*D - M_prime)) + \
          0.658 * math.sin(math.radians(2*D)) + \
          0.214 * math.sin(math.radians(2*M_prime)) - \
          0.186 * math.sin(math.radians(M)) - \
          0.114 * math.sin(math.radians(2*F)) + \
          0.053 * math.sin(math.radians(M_prime + M))
          
    lat = 5.128 * math.sin(math.radians(F)) + \
          0.280 * math.sin(math.radians(M_prime + F)) + \
          0.280 * math.sin(math.radians(F - M_prime)) + \
          0.185 * math.sin(math.radians(2*D - F))

    # 距離 (km)
    dist_km = 385001.0 - 20905.0 * math.cos(math.radians(M_prime)) - 3699.0 * math.cos(math.radians(2*D - M_prime))
    dist_au = dist_km / 149597870.7  # km -> AU

    return {"lon": lon % 360.0, "lat": lat, "dist": dist_au}


def _ecliptic_to_equatorial(lon_deg: float, lat_deg: float, T: float) -> Dict[str, float]:
    """
    黄道座標 (lon, lat) → 赤道座標 (RA, Dec) に変換
    T: ユリウス世紀
    """
    # 黄道傾斜角（T で補正）
    eps = ECLIPTIC_OBLIQUITY_J2000 - 0.013004167 * T
    eps_r = math.radians(eps)

    lon_r = math.radians(lon_deg)
    lat_r = math.radians(lat_deg)

    sin_dec = math.sin(lat_r) * math.cos(eps_r) + \
              math.cos(lat_r) * math.sin(eps_r) * math.sin(lon_r)
    sin_dec = max(-1.0, min(1.0, sin_dec))
    dec = math.degrees(math.asin(sin_dec))

    ra_y = math.sin(lon_r) * math.cos(eps_r) - math.tan(lat_r) * math.sin(eps_r)
    ra_x = math.cos(lon_r)
    ra_deg = _normalize_degrees(math.degrees(math.atan2(ra_y, ra_x)))
    ra_hr = ra_deg / 15.0  # 時間に変換

    return {"ra": ra_hr, "dec": dec}


# =====================================================
# 公開 API
# =====================================================

def get_planet_positions(
    jd: float,
    lat: float,
    lng: float,
    equatorial_to_horizontal_fn,
    lst_deg: float
) -> List[Dict[str, Any]]:
    """
    指定ユリウス日における太陽系5惑星の地平座標を計算して返す

    Parameters
    ----------
    jd : float
        ユリウス日
    lat : float
        観測緯度 (度)
    lng : float
        観測経度 (度)
    equatorial_to_horizontal_fn : callable
        赤道→地平変換関数 (main.py の equatorial_to_horizontal を渡す)
    lst_deg : float
        地方恒星時 (度)

    Returns
    -------
    List[Dict]
        各惑星の情報リスト
    """
    # J2000.0 からのユリウス世紀数
    T = (jd - 2451545.0) / 36525.0

    # 地球の日心黄道座標
    earth = _earth_heliocentric_ecliptic(T)

    results = []

    # 太陽の地心位置を計算（地球の座標の逆）
    try:
        sun_dx = -earth["x"]
        sun_dy = -earth["y"]
        sun_dz = -earth["z"]
        sun_dist = math.sqrt(sun_dx**2 + sun_dy**2 + sun_dz**2)
        sun_lon = _normalize_degrees(math.degrees(math.atan2(sun_dy, sun_dx)))
        sun_lat = math.degrees(math.atan2(sun_dz, math.sqrt(sun_dx**2 + sun_dy**2)))
        sun_eq = _ecliptic_to_equatorial(sun_lon, sun_lat, T)
        sun_hor = equatorial_to_horizontal_fn(sun_eq["ra"], sun_eq["dec"], lst_deg, lat)
        
        results.append({
            "name":    "Sun",
            "name_ja": "太陽",
            "ra":      round(sun_eq["ra"],    4),
            "dec":     round(sun_eq["dec"],   4),
            "az":      round(sun_hor["az"],   4),
            "alt":     round(sun_hor["alt"],  4),
            "color":   "#fff176",
            "mag":     -26.74,
            "dist_au": round(sun_dist, 4),
        })
    except Exception as e:
        pass

    # 月の地心位置を計算
    try:
        moon_ecl = _moon_geocentric_ecliptic(T)
        moon_eq = _ecliptic_to_equatorial(moon_ecl["lon"], moon_ecl["lat"], T)
        moon_hor = equatorial_to_horizontal_fn(moon_eq["ra"], moon_eq["dec"], lst_deg, lat)
        
        # 太陽と月の位置関係から満ち欠け（輝面比）を求め、月齢に応じて月自身の明るさ（等級: mag）を求める
        s_lon = sun_lon if 'sun_lon' in locals() else _normalize_degrees(280.46646 + 36000.76983 * T)
        D_rad = math.radians(moon_ecl["lon"] - s_lon)
        # 輝面比 k
        k = (1.0 + math.cos(math.pi - D_rad)) / 2.0
        # 満月時で -12.7等
        mag = -12.7 + 10.0 * (1.0 - k)
        
        results.append({
            "name":    "Moon",
            "name_ja": "月",
            "ra":      round(moon_eq["ra"],    4),
            "dec":     round(moon_eq["dec"],   4),
            "az":      round(moon_hor["az"],   4),
            "alt":     round(moon_hor["alt"],  4),
            "color":   "#e0e0e0",
            "mag":     round(mag, 1),
            "dist_au": round(moon_ecl["dist"], 5),
        })
    except Exception as e:
        pass

    for key, meta in PLANET_ELEMENTS.items():
        try:
            # 惑星の日心黄道座標
            planet = _planet_heliocentric_ecliptic(key, T)

            # 地心黄道直交座標（地球を原点に移動）
            dx = planet["x"] - earth["x"]
            dy = planet["y"] - earth["y"]
            dz = planet["z"] - earth["z"]

            # 地球-惑星距離 (d)
            dist = math.sqrt(dx*dx + dy*dy + dz*dz)

            # 地心黄道座標 (lon, lat) へ変換
            geo_lon = _normalize_degrees(math.degrees(math.atan2(dy, dx)))
            geo_lat = math.degrees(math.atan2(dz, math.sqrt(dx*dx + dy*dy)))

            # 黄道 → 赤道座標 (RA, Dec) へ変換
            eq = _ecliptic_to_equatorial(geo_lon, geo_lat, T)

            # 赤道 → 地平座標 (Az, Alt) へ変換
            hor = equatorial_to_horizontal_fn(eq["ra"], eq["dec"], lst_deg, lat)

            # --- 精密な等級 (mag) 計算 ---
            # 太陽-惑星距離 (r)
            r_sun = math.sqrt(planet["x"]**2 + planet["y"]**2 + planet["z"]**2)
            # 地球の太陽距離
            r_earth = math.sqrt(earth["x"]**2 + earth["y"]**2 + earth["z"]**2)

            # 位相角 i (度) の計算: cos(i) = (r^2 + d^2 - R^2) / (2 * r * d)
            cos_i = (r_sun**2 + dist**2 - r_earth**2) / (2.0 * r_sun * dist)
            cos_i = max(-1.0, min(1.0, cos_i))
            phase_angle = math.degrees(math.acos(cos_i))

            # 各惑星の等級計算式 (Meeus "Astronomical Algorithms" 簡易版)
            mag_base = meta["mag_base"]
            if key == "Mercury":
                mag_raw = mag_base + 5 * math.log10(r_sun * dist) + 0.0380 * phase_angle - 0.000273 * (phase_angle**2) + 0.000002 * (phase_angle**3)
            elif key == "Venus":
                mag_raw = mag_base + 5 * math.log10(r_sun * dist) + 0.0009 * phase_angle + 0.000239 * (phase_angle**2) - 0.00000065 * (phase_angle**3)
            elif key == "Mars":
                mag_raw = mag_base + 5 * math.log10(r_sun * dist) + 0.016 * phase_angle
            elif key == "Jupiter":
                mag_raw = mag_base + 5 * math.log10(r_sun * dist) + 0.005 * phase_angle
            elif key == "Saturn":
                # 簡易的に環の傾斜は無視
                mag_raw = mag_base + 5 * math.log10(r_sun * dist) + 0.044 * phase_angle
            else:
                mag_raw = mag_base + 5 * math.log10(r_sun * dist)

            mag = round(mag_raw, 1)

            results.append({
                "name":    key,
                "name_ja": meta["name_ja"],
                "ra":      round(eq["ra"],    4),
                "dec":     round(eq["dec"],   4),
                "az":      round(hor["az"],   4),
                "alt":     round(hor["alt"],  4),
                "color":   meta["color"],
                "mag":     mag,
                "dist_au": round(dist, 4),
            })
        except Exception as e:
            # 計算エラーは無視して次の惑星へ
            continue

    return results
