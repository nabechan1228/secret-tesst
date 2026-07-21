# -*- coding: utf-8 -*-
"""
Stellaris Professional Planetarium - Backend API
Python による精密な星間計算を行い、フロントエンドへ天体データを提供する。
星データはインターネットから取得済みの astro_data.json を使用 (5044星・88星座)
"""

import os
import math
import logging
import json
import urllib.request
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import numpy as np

from config import ENABLE_API_DOCS, get_allowed_origins
from middleware import RateLimitMiddleware, SecurityHeadersMiddleware
from astro_loader import get_stars, get_constellation_lines, get_constellation_meta
from planet_calc import get_planet_positions
from dso_data import MESSIER_OBJECTS
from satellites import get_satellites_position

# ==========================================
# ロギング設定
# ==========================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ==========================================
# Sentry エラー監視設定（本番環境での能動監視用フック）
# ==========================================
SENTRY_DSN = os.environ.get("SENTRY_DSN")
if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastAPIIntegration
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[FastAPIIntegration()],
            traces_sample_rate=1.0,
        )
        logger.info("Sentry SDK を初期化しました。")
    except ImportError:
        logger.warning("Sentry DSN が指定されていますが、sentry-sdk パッケージがインストールされていません。")


ALLOWED_ORIGINS = get_allowed_origins()

app = FastAPI(
    title="Stellaris Planetarium API",
    description="インターネット取得済みの実天体データを使用した精密プラネタリウムAPI",
    version="2.1.0",
    docs_url="/docs" if ENABLE_API_DOCS else None,
    redoc_url="/redoc" if ENABLE_API_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_API_DOCS else None,
)

# ==========================================
# CORS設定（S-1修正）
# allow_credentials=True と allow_origins=["*"] の組み合わせは CORS 仕様違反。
# CORS_ORIGINS 環境変数で本番オリジンを追加可能。
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)


# ==========================================
# V-6: カスタムエラーハンドラー（内部情報漏洩防止）
# ==========================================

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """バリデーションエラー時に内部フィールド名やリクエスト詳細を隠蔽する"""
    logger.warning("バリデーションエラー: %s %s - %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=422,
        content={"detail": "リクエストパラメータが不正です。"}
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """未処理の例外でスタックトレースを隠蔽する"""
    logger.error("未処理の例外: %s %s", request.method, request.url.path, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "内部サーバーエラーが発生しました。"}
    )

# ==========================================
# Pydantic レスポンスモデル（R-2）
# ==========================================

class StarOut(BaseModel):
    id: int
    name_ja: Optional[str]
    ra: float
    dec: float
    mag: float
    bv: float
    color: str
    az: float
    alt: float

class ConstellationSegmentOut(BaseModel):
    ra1: float
    dec1: float
    ra2: float
    dec2: float

class ConstellationLineOut(BaseModel):
    cid: str
    segments: List[ConstellationSegmentOut]

class PlanetOut(BaseModel):
    name: str
    name_ja: str
    ra: float
    dec: float
    az: float
    alt: float
    color: str
    mag: float
    dist_au: float

class DSOOut(BaseModel):
    id: str
    name_ja: str
    name_en: str
    type: str
    size: float
    mag: float
    ra: float
    dec: float
    az: float
    alt: float

class RecommendationOut(BaseModel):
    name: str
    name_ja: str
    score: float
    mag: float
    max_alt: float
    visible_hours: int
    time_range: str
    comment: str

class SkyResponse(BaseModel):
    datetime: str
    julian_date: float
    lst_deg: float
    stars: List[StarOut]
    constellation_lines: List[ConstellationLineOut]
    planets: List[PlanetOut]
    deep_sky_objects: List[DSOOut]
    recommendation: RecommendationOut

class SatelliteOut(BaseModel):
    id: str
    name: str
    name_ja: str
    ra: float
    dec: float
    az: float
    alt: float
    mag: float
    color: str
    type: str

class SatellitesResponse(BaseModel):
    satellites: List[SatelliteOut]

class ConstellationsResponse(BaseModel):
    constellations: Dict[str, Any]

class MeteorShowerOut(BaseModel):
    id: str
    name: str
    name_ja: str
    ra: float
    dec: float
    activity: float
    zhr: int
    color: str

class MeteorShowersResponse(BaseModel):
    datetime: str
    showers: List[MeteorShowerOut]

class HealthResponse(BaseModel):
    status: str
    stars_count: int
    constellations_count: int
    data_source: str

class WeatherResponse(BaseModel):
    temperature: float
    humidity: float
    wind_speed: float
    cloud_cover: float

class SkyTonightItem(BaseModel):
    name: str
    name_ja: str
    category: str          # 'planet' | 'dso' | 'star'
    type_label: str        # 例: '惑星', '球状星団', '1等星'
    difficulty: str        # '初心者' | '中級' | '上級'
    score: float
    mag: float
    alt: float
    az: float
    ra: float
    dec: float
    visible_hours: int
    time_range: str
    description: str
    color: str

class SkyTonightResponse(BaseModel):
    datetime: str
    items: List[SkyTonightItem]
    moon_phase: float          # 月齢 (0-29.5)
    moon_illumination: float   # 輝面比 (0.0-1.0)
    moon_impact: str           # '低' | '中' | '高'
    seeing_tip: str            # 総括コメント


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

def safe_parse_datetime(time_str: str) -> datetime:
    """タイムゾーンを考慮した安全なISO日時文字列のパース"""
    dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

def parse_time_and_calc_lst(time_str: Optional[str], lng: float) -> tuple[datetime, float, float]:
    """
    ISO日時文字列をパースし、UTCのdatetime、ユリウス日(JD)、および地方恒星時(LST)を返す。
    不正な time 文字列は 422 を返す（サイレントフォールバックなし）。
    """
    if time_str:
        if len(time_str) > 64:
            raise HTTPException(status_code=422, detail="リクエストパラメータが不正です。")
        try:
            dt = safe_parse_datetime(time_str)
        except ValueError:
            logger.warning("不正な time 文字列を受信: %r", time_str)
            raise HTTPException(status_code=422, detail="リクエストパラメータが不正です。")
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
    25336: 'ミルファク', 65378: 'ミザール', 62956: 'アリオト', 68702: 'ハダル',
    54061: 'ドゥーベ', 67301: 'アルカイド', 28380: 'ベラトリックス',
    27366: 'サイフ', 26727: 'アルニタク', 26311: 'アルニラム',
    25930: 'ミンタカ', 9884: 'アケルナル',
    # カシオペヤ座 (W字)
    6686: 'ルクバー', 746: 'カフ', 3179: 'シェダル', 4427: 'ツィー', 8886: 'セギン',
    # 春の大三角
    57632: 'デネボラ',
    # 北斗七星
    53910: 'メラク', 58001: 'フェクダ', 59774: 'メグレス',
}


def get_planet_recommendation(
    current_dt_utc: datetime,
    lat: float,
    lng: float,
) -> Dict[str, Any]:
    """
    指定された日時における「今夜」（日没後から日の出前）の惑星の見頃度を計算し、
    最も見頃な惑星とその推薦コメントを返す。
    """
    # ローカル時刻での「今日」の日付を計算
    local_offset = lng / 15.0
    local_dt = current_dt_utc + timedelta(hours=local_offset)
    local_date = local_dt.date()

    # 現地時間の17:00から翌朝06:00までの14点を1時間刻みでサンプリング
    sampling_times = []
    base_dt = datetime(local_date.year, local_date.month, local_date.day, 17, 0, 0, tzinfo=timezone.utc)

    for i in range(14):
        lp = base_dt + timedelta(hours=i)
        utc_p = lp - timedelta(hours=local_offset)
        sampling_times.append((lp.strftime("%H:%M"), utc_p))

    planets = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"]
    planet_stats = {p: {
        "visible_hours": 0,
        "max_alt": -90.0,
        "mag_sum": 0.0,
        "count": 0,
        "color": "",
        "name_ja": "",
        "visible_start": None,
        "visible_end": None
    } for p in planets}

    for label, utc_p in sampling_times:
        jd_p = get_julian_date(utc_p)
        lst_p = get_local_sidereal_time(jd_p, lng)

        # 惑星と太陽の位置を計算
        positions = get_planet_positions(jd_p, lat, lng, equatorial_to_horizontal, lst_p)
        sun_pos = next((p for p in positions if p["name"] == "Sun"), None)
        if not sun_pos:
            continue

        # 太陽が沈んでいる時間（市民薄明終了: 太陽高度 < -6.0度）を対象とする
        is_dark = sun_pos["alt"] < -6.0
        if not is_dark:
            continue

        for pos in positions:
            pname = pos["name"]
            if pname == "Sun":
                continue

            alt = pos["alt"]
            mag = pos["mag"]

            if pname in planet_stats:
                planet_stats[pname]["color"] = pos["color"]
                planet_stats[pname]["name_ja"] = pos["name_ja"]

                # 惑星が地平線から10度以上昇っている場合を「観察可能」と見なす
                if alt >= 10.0:
                    planet_stats[pname]["visible_hours"] += 1
                    planet_stats[pname]["max_alt"] = max(planet_stats[pname]["max_alt"], alt)
                    planet_stats[pname]["mag_sum"] += mag
                    planet_stats[pname]["count"] += 1

                    if planet_stats[pname]["visible_start"] is None:
                        planet_stats[pname]["visible_start"] = label
                    planet_stats[pname]["visible_end"] = label

    scores = []
    for pname, stats in planet_stats.items():
        if stats["visible_hours"] == 0:
            score = 0.0
        else:
            avg_mag = stats["mag_sum"] / stats["count"]
            # 見頃スコア: 観察可能な時間(1時間=10点) + 最大高度(1度=0.5点) - 平均等級(明るいほど高得点: -mag*5)
            score = stats["visible_hours"] * 10 + stats["max_alt"] * 0.5 - avg_mag * 5

        scores.append({
            "name": pname,
            "name_ja": stats["name_ja"],
            "score": score,
            "visible_hours": stats["visible_hours"],
            "max_alt": stats["max_alt"],
            "mag": round(stats["mag_sum"] / stats["count"], 1) if stats["count"] > 0 else 0.0,
            "time_range": f"{stats['visible_start']}～{stats['visible_end']}" if stats["visible_hours"] > 0 else "観察不可",
            "color": stats["color"]
        })

    # スコアで降順ソート
    scores.sort(key=lambda x: x["score"], reverse=True)

    best = scores[0]
    if best["score"] <= 0:
        return {
            "name": "",
            "name_ja": "",
            "score": 0.0,
            "mag": 0.0,
            "max_alt": 0.0,
            "visible_hours": 0,
            "time_range": "観察不可",
            "comment": "今夜は肉眼で見頃な惑星はありません。"
        }

    name_ja = best["name_ja"]
    mag = best["mag"]
    max_alt = best["max_alt"]
    time_range = best["time_range"]
    pname = best["name"]

    # 惑星ごとの解説テンプレート
    comments = {
        "Mercury": f"今夜の水星は{mag}等です。太陽に非常に近いため観察が難しいですが、{time_range}の間、最大高度{max_alt:.1f}度まで昇り、一時的に西または東の低空に見えるチャンスがあります。",
        "Venus": f"今夜の金星は{mag}等の圧倒的な輝きを放っており、{time_range}の間、最大高度{max_alt:.1f}度まで昇り、夜空でひと際美しく輝きます。",
        "Mars": f"今夜の火星は赤く輝く{mag}等で、{time_range}の間、最大高度{max_alt:.1f}度まで達し、夜空で独特の存在感を示しており見頃です。",
        "Jupiter": f"今夜の木星は{mag}等と非常に明るく、{time_range}の間、最大高度{max_alt:.1f}度まで昇り、圧倒的な輝きを放って最も見頃となっています。",
        "Saturn": f"今夜の土星は{mag}等で、{time_range}の間、最大高度{max_alt:.1f}度まで昇り、穏やかな黄色い輝きが非常に見やすくなっています。"
    }
    comment = comments.get(pname, f"今夜は{name_ja}が見頃です。")

    return {
        "name": pname,
        "name_ja": name_ja,
        "score": round(best["score"], 1),
        "mag": mag,
        "max_alt": round(max_alt, 1),
        "visible_hours": best["visible_hours"],
        "time_range": time_range,
        "comment": comment
    }


# ==========================================
# 今夜の星空プランナー ロジック
# ==========================================

def calc_moon_phase(jd: float) -> tuple[float, float]:
    """
    ユリウス日から月齢と輝面比を計算する（簡易計算）。
    Returns: (moon_age_days: float, illumination: float)
    """
    # 既知の朔の日 (2000-01-06 18:14 UTC, JD=2451551.26)
    known_new_moon_jd = 2451551.26
    synodic_period = 29.53058867  # 朔望月 (日)
    moon_age = (jd - known_new_moon_jd) % synodic_period
    if moon_age < 0:
        moon_age += synodic_period
    # 輝面比の概算 (cos近似)
    illumination = (1.0 - math.cos(2.0 * math.pi * moon_age / synodic_period)) / 2.0
    return round(moon_age, 1), round(illumination, 3)


def get_sky_tonight(
    dt_utc: datetime,
    lat: float,
    lng: float,
    jd: float,
    lst: float,
) -> dict:
    """
    今夜の観察おすすめ天体トップ5を計算して返す。
    対象: 惑星・メシエDSO・明るい恒星
    """
    moon_age, moon_illumination = calc_moon_phase(jd)

    # 月の輝面比に基づく影響レベル
    if moon_illumination < 0.25:
        moon_impact = '低'
    elif moon_illumination < 0.6:
        moon_impact = '中'
    else:
        moon_impact = '高'

    local_offset = lng / 15.0
    local_dt = dt_utc + timedelta(hours=local_offset)
    local_date = local_dt.date()

    # 今夜17時〜翌6時の14時間を1時間刻みでサンプリング
    sampling_times = []
    base_dt = datetime(local_date.year, local_date.month, local_date.day, 17, 0, 0, tzinfo=timezone.utc)
    for i in range(14):
        lp = base_dt + timedelta(hours=i)
        utc_p = lp - timedelta(hours=local_offset)
        sampling_times.append((lp.strftime("%H:%M"), utc_p))

    candidates = []

    # --- 1. 惑星 ---
    planet_names = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]
    planet_stats: dict = {p: {
        "visible_hours": 0, "max_alt": -90.0,
        "mag_sum": 0.0, "count": 0,
        "color": "", "name_ja": "",
        "ra": 0.0, "dec": 0.0, "az": 0.0, "alt": -90.0,
        "visible_start": None, "visible_end": None
    } for p in planet_names}

    for label, utc_p in sampling_times:
        jd_p = get_julian_date(utc_p)
        lst_p = get_local_sidereal_time(jd_p, lng)
        positions = get_planet_positions(jd_p, lat, lng, equatorial_to_horizontal, lst_p)
        sun_pos = next((p for p in positions if p["name"] == "Sun"), None)
        if not sun_pos or sun_pos["alt"] >= -6.0:
            continue  # 薄明終了前はスキップ

        for pos in positions:
            pname = pos["name"]
            if pname == "Sun" or pname == "Moon" or pname not in planet_stats:
                continue
            alt = pos["alt"]
            if alt >= 10.0:
                st = planet_stats[pname]
                st["visible_hours"] += 1
                st["mag_sum"] += pos["mag"]
                st["count"] += 1
                if alt > st["max_alt"]:
                    st["max_alt"] = alt
                    st["ra"] = pos["ra"]
                    st["dec"] = pos["dec"]
                    st["az"] = pos["az"]
                    st["alt"] = alt
                st["color"] = pos["color"]
                st["name_ja"] = pos["name_ja"]
                if st["visible_start"] is None:
                    st["visible_start"] = label
                st["visible_end"] = label

    planet_type_map = {
        "Mercury": "内惑星", "Venus": "内惑星",
        "Mars": "外惑星", "Jupiter": "外惑星",
        "Saturn": "外惑星", "Uranus": "外惑星", "Neptune": "外惑星"
    }
    planet_desc_map = {
        "Mercury": "西または東の低空に輝く銀白色の惑星。太陽に近く観測困難だが、見られたときは貴重。",
        "Venus": "夜明けまたは宵の明星。圧倒的な輝きを放つ最明惑星。満ち欠けが双眼鏡で確認できる。",
        "Mars": "赤く輝く戦いの惑星。望遠鏡では極冠や模様が見える。2年ごとに接近する。",
        "Jupiter": "太陽系最大の惑星。望遠鏡で縞模様と4つのガリレオ衛星が見える。",
        "Saturn": "美しいリングで有名。望遠鏡でカッシーニの間隙も見える惑星。",
        "Uranus": "青緑色に輝く氷惑星。肉眼ギリギリの明るさだが双眼鏡で確認可能。",
        "Neptune": "太陽系最遠の惑星。双眼鏡・望遠鏡が必要な挑戦的な観察対象。"
    }

    for pname, st in planet_stats.items():
        if st["visible_hours"] == 0:
            continue
        avg_mag = st["mag_sum"] / st["count"]
        # スコア計算（高度重視・明るさ重視）
        score = st["max_alt"] * 0.8 + (-avg_mag) * 10
        difficulty = "初心者" if avg_mag < 2.0 else ("中級" if avg_mag < 5.0 else "上級")
        time_range = f"{st['visible_start']}～{st['visible_end']}" if st["visible_hours"] > 0 else "観察不可"
        candidates.append({
            "name": pname,
            "name_ja": st["name_ja"],
            "category": "planet",
            "type_label": planet_type_map.get(pname, "惑星"),
            "difficulty": difficulty,
            "score": round(score, 1),
            "mag": round(avg_mag, 1),
            "alt": round(st["max_alt"], 1),
            "az": round(st["az"], 1),
            "ra": round(st["ra"], 4),
            "dec": round(st["dec"], 4),
            "visible_hours": st["visible_hours"],
            "time_range": time_range,
            "description": planet_desc_map.get(pname, f"{st['name_ja']}が見頃です。"),
            "color": st["color"],
        })

    # --- 2. メシエ天体 DSO ---
    dso_type_ja = {
        "galaxy": "銀河", "open cluster": "散開星団",
        "globular cluster": "球状星団", "nebula": "星雲",
        "planetary nebula": "惑星状星雲", "supernova remnant": "超新星残骸",
        "asterism": "星官"
    }

    if MESSIER_OBJECTS:
        ra_arr = np.array([o["ra"] for o in MESSIER_OBJECTS], dtype=np.float64)
        dec_arr = np.array([o["dec"] for o in MESSIER_OBJECTS], dtype=np.float64)
        az_arr, alt_arr = equatorial_to_horizontal_numpy(ra_arr, dec_arr, lst, lat)

        for i, obj in enumerate(MESSIER_OBJECTS):
            alt_val = alt_arr[i]
            if alt_val < 15.0:
                continue  # 低空すぎる天体は除外
            mag = obj["mag"]
            # DSO は月明かりの影響を受けやすい
            moon_penalty = moon_illumination * 15.0  # 満月付近で最大15点減点
            score = alt_val * 0.8 + (-mag) * 10 - moon_penalty
            if mag < 5.0:
                difficulty = "初心者"
            elif mag < 7.0:
                difficulty = "中級"
            else:
                difficulty = "上級"

            type_en = obj.get("type", "")
            type_ja = dso_type_ja.get(type_en, type_en)
            name_ja = obj["name_ja"]
            name_en = obj["name_en"]
            desc = f"{name_ja}（{type_ja}）。高度{alt_val:.0f}°、{mag}等級。{obj.get('id', '')}とも呼ばれます。"

            candidates.append({
                "name": obj["id"],
                "name_ja": name_ja,
                "category": "dso",
                "type_label": type_ja,
                "difficulty": difficulty,
                "score": round(score, 1),
                "mag": mag,
                "alt": round(alt_val, 1),
                "az": round(az_arr[i], 1),
                "ra": obj["ra"],
                "dec": obj["dec"],
                "visible_hours": 0,
                "time_range": "-",
                "description": desc,
                "color": "#b0e0ff",
            })

    # --- 3. 明るい恒星 ---
    stars_raw = get_stars()
    bright_stars = [s for s in stars_raw if s["m"] <= 1.5 and s["h"] in BRIGHT_STAR_NAMES]
    if bright_stars:
        ra_arr_s = np.array([s["r"] for s in bright_stars], dtype=np.float64)
        dec_arr_s = np.array([s["d"] for s in bright_stars], dtype=np.float64)
        az_arr_s, alt_arr_s = equatorial_to_horizontal_numpy(ra_arr_s, dec_arr_s, lst, lat)

        for i, star in enumerate(bright_stars):
            alt_val = alt_arr_s[i]
            if alt_val < 20.0:
                continue  # 高度20度未満の恒星は除外
            mag = star["m"]
            score = alt_val * 0.5 + (-mag) * 12
            name_ja = BRIGHT_STAR_NAMES.get(star["h"], f"HIP{star['h']}")

            # bv_to_colorはmain.pyに既にある
            color = bv_to_color(star.get("b", 0.6))
            desc = f"{name_ja}（1等星・恒星）。高度{alt_val:.0f}°、{mag:.1f}等。肉眼で容易に確認できる明るい星。"

            candidates.append({
                "name": f"HIP{star['h']}",
                "name_ja": name_ja,
                "category": "star",
                "type_label": "1等星",
                "difficulty": "初心者",
                "score": round(score, 1),
                "mag": round(mag, 1),
                "alt": round(alt_val, 1),
                "az": round(az_arr_s[i], 1),
                "ra": round(star["r"], 4),
                "dec": round(star["d"], 4),
                "visible_hours": 0,
                "time_range": "-",
                "description": desc,
                "color": color,
            })

    # スコア降順でソートしてトップ5
    candidates.sort(key=lambda x: x["score"], reverse=True)
    top5 = candidates[:5]

    # 総括コメント生成
    if moon_illumination < 0.15:
        seeing_tip = "今夜は新月に近く、月明かりの影響が少ない絶好の観測チャンスです！暗い星雲・銀河の観察に最適です。"
    elif moon_illumination < 0.4:
        seeing_tip = "月明かりはやや控えめです。明るい惑星や星団は問題なく楽しめます。"
    elif moon_illumination < 0.7:
        seeing_tip = "月が半分以上輝いています。明るい惑星・1等星の観察に集中しましょう。"
    else:
        seeing_tip = "今夜は月が明るいため、暗い天体の観察には不向きです。惑星や明るい星の観察にとどめましょう。"

    return {
        "datetime": dt_utc.isoformat(),
        "items": top5,
        "moon_phase": moon_age,
        "moon_illumination": moon_illumination,
        "moon_impact": moon_impact,
        "seeing_tip": seeing_tip,
    }


# ==========================================
# API エンドポイント
# ==========================================

@app.get("/api/sky", response_model=SkyResponse)
def get_sky(
    lat: float = Query(35.68, ge=-90.0, le=90.0, description="観測緯度 (度, -90 ~ 90)"),
    lng: float = Query(139.76, ge=-180.0, le=180.0, description="観測経度 (度, -180 ~ 180)"),
    time: Optional[str] = Query(None, max_length=64, description="ISO 8601 日時文字列。省略時は現在のUTC時刻"),
    mag_limit: float = Query(6.0, ge=0.0, le=10.0, description="最大等級フィルタ (デフォルト: 6等星以下, 上限: 10)"),
):
    """
    指定された緯度・経度・時間で見える星の地平座標を返す。
    インターネットから取得した HIPパルコスカタログ (5044星) の精密データを使用。
    NumPy ベクトル演算により、座標計算の高速化を実現。
    """
    logger.info("GET /api/sky lat=%.2f lng=%.2f mag_limit=%.1f time=%s", lat, lng, mag_limit, time)
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
                "name_ja": BRIGHT_STAR_NAMES.get(star['h']),
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

    # --- 今夜の見頃惑星計算 ---
    recommendation = get_planet_recommendation(dt_utc, lat, lng)

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
                "ra":      obj["ra"],
                "dec":     obj["dec"],
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
        "recommendation": recommendation,
    }


@app.get("/api/constellations", response_model=ConstellationsResponse)
def get_constellations():
    """
    88星座のメタデータ (名前・説明・季節・中心座標) を返す。
    インターネットから取得した d3-celestial データを使用。
    """
    meta = get_constellation_meta()
    return {"constellations": meta}

@app.get("/api/satellites", response_model=SatellitesResponse)
def get_satellites(
    lat: float = Query(35.68, ge=-90.0, le=90.0),
    lng: float = Query(139.76, ge=-180.0, le=180.0),
    time: Optional[str] = Query(None, max_length=64),
):
    """
    指定された日時のISS等の人工衛星の位置を返す。
    """
    dt_utc, _, _ = parse_time_and_calc_lst(time, lng)
    satellites = get_satellites_position(dt_utc, lat, lng)
    return {"satellites": satellites}


@app.get("/api/sky/stars-only")
def get_stars_only(
    lat: float = Query(35.68, ge=-90.0, le=90.0),
    lng: float = Query(139.76, ge=-180.0, le=180.0),
    time: Optional[str] = Query(None, max_length=64),
    mag_limit: float = Query(4.0, ge=0.0, le=10.0, description="明るい星のみ (高速レスポンス用)"),
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

@app.get("/api/meteor-showers", response_model=MeteorShowersResponse)
def get_meteor_showers(
    time: Optional[str] = Query(None, max_length=64, description="ISO 8601 日時文字列。省略時は現在のUTC時刻"),
):
    """
    指定日付における主要な流星群の活動度と放射点データを返す。
    """
    if time:
        try:
            dt = safe_parse_datetime(time)
        except ValueError:
            logger.warning("不正な time 文字列を受信 (meteor-showers): %r", time)
            raise HTTPException(status_code=422, detail="リクエストパラメータが不正です。")
    else:
        dt = datetime.now(timezone.utc)

    dt_utc = dt.astimezone(timezone.utc)
    year = dt_utc.year

    showers_def = [
        {
            "id": "quadrantids",
            "name": "Quadrantids",
            "name_ja": "しぶんぎ座流星群",
            "peak_month": 1,
            "peak_day": 4,
            "ra": 15.3,
            "dec": 49.0,
            "zhr": 120,
            "sigma": 3.0,
            "color": "#e1bee7"
        },
        {
            "id": "lyrids",
            "name": "Lyrids",
            "name_ja": "こと座流星群",
            "peak_month": 4,
            "peak_day": 22,
            "ra": 18.2,
            "dec": 34.0,
            "zhr": 18,
            "sigma": 4.0,
            "color": "#f1f8e9"
        },
        {
            "id": "perseids",
            "name": "Perseids",
            "name_ja": "ペルセウス座流星群",
            "peak_month": 8,
            "peak_day": 13,
            "ra": 3.1,
            "dec": 58.0,
            "zhr": 100,
            "sigma": 10.0,
            "color": "#e0f7fa"
        },
        {
            "id": "geminids",
            "name": "Geminids",
            "name_ja": "ふたご座流星群",
            "peak_month": 12,
            "peak_day": 14,
            "ra": 7.5,
            "dec": 33.0,
            "zhr": 120,
            "sigma": 5.0,
            "color": "#fff9c4"
        }
    ]

    active_showers = []
    for s in showers_def:
        try:
            peak_dt = datetime(year, s["peak_month"], s["peak_day"], tzinfo=timezone.utc)
        except ValueError:
            peak_dt = datetime(year, s["peak_month"], s["peak_day"] - 1, tzinfo=timezone.utc)

        diff_days = (dt_utc - peak_dt).total_seconds() / 86400.0

        if diff_days > 180:
            peak_dt_prev = datetime(year - 1, s["peak_month"], s["peak_day"], tzinfo=timezone.utc)
            diff_days = (dt_utc - peak_dt_prev).total_seconds() / 86400.0
        elif diff_days < -180:
            peak_dt_next = datetime(year + 1, s["peak_month"], s["peak_day"], tzinfo=timezone.utc)
            diff_days = (dt_utc - peak_dt_next).total_seconds() / 86400.0

        activity = math.exp(- (diff_days / s["sigma"]) ** 2)

        if activity >= 0.01:
            active_showers.append({
                "id": s["id"],
                "name": s["name"],
                "name_ja": s["name_ja"],
                "ra": s["ra"],
                "dec": s["dec"],
                "activity": round(activity, 4),
                "zhr": s["zhr"],
                "color": s["color"]
            })

    return {
        "datetime": dt_utc.isoformat(),
        "showers": active_showers
    }

_WEATHER_CACHE: Dict[tuple, tuple[float, dict]] = {}
_WEATHER_CACHE_TTL = 600.0  # 10分間有効

@app.get("/api/weather", response_model=WeatherResponse)
async def get_weather(
    lat: float = Query(35.68, ge=-90.0, le=90.0, description="観測緯度 (度, -90 ~ 90)"),
    lng: float = Query(139.76, ge=-180.0, le=180.0, description="観測経度 (度, -180 ~ 180)")
):
    """
    指定された座標の現在天気を wttr.in API から非同期にプロキシして取得する。
    10分間のインメモリキャッシュを適用。
    """
    import time
    cache_key = (round(lat, 2), round(lng, 2))
    now = time.time()

    if cache_key in _WEATHER_CACHE:
        cached_time, cached_data = _WEATHER_CACHE[cache_key]
        if now - cached_time < _WEATHER_CACHE_TTL:
            return cached_data

    url = f"https://wttr.in/{lat},{lng}?format=j1"
    headers = {"User-Agent": "Stellaris-Planetarium"}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            current = data.get("current_condition", [{}])[0]
            result = {
                "temperature": float(current.get("temp_C", 15.0)),
                "humidity": float(current.get("humidity", 50.0)),
                "wind_speed": float(current.get("windspeedKmph", 0.0)),
                "cloud_cover": float(current.get("cloudcover", 0.0)),
            }
            _WEATHER_CACHE[cache_key] = (now, result)
            return result
    except Exception as e:
        logger.warning("天気APIの取得に失敗したため、デフォルト値を返します: %s", e)
        return {
            "temperature": 15.0,
            "humidity": 50.0,
            "wind_speed": 3.0,
            "cloud_cover": 10.0,
        }

@app.get("/api/sky-tonight", response_model=SkyTonightResponse)
def get_sky_tonight_endpoint(
    lat: float = Query(35.68, ge=-90.0, le=90.0, description="観測緯度 (度)"),
    lng: float = Query(139.76, ge=-180.0, le=180.0, description="観測経度 (度)"),
    time: Optional[str] = Query(None, max_length=64, description="ISO 8601 日時文字列。省略時は現在のUTC時刻"),
):
    """
    今夜の観察おすすめ天体トップ5を返す。
    惑星・メシエ天体・明るい恒星を高度・明るさ・月明かり影響でスコアリング。
    """
    logger.info("GET /api/sky-tonight lat=%.2f lng=%.2f time=%s", lat, lng, time)
    dt_utc, jd, lst = parse_time_and_calc_lst(time, lng)
    result = get_sky_tonight(dt_utc, lat, lng, jd, lst)
    return result


@app.get("/health", response_model=HealthResponse)
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
    import os
    watch_dir = os.path.dirname(os.path.abspath(__file__))
    uvicorn.run(
        "main:app", 
        host="127.0.0.1", 
        port=8000, 
        reload=True, 
        reload_dirs=[watch_dir],
        reload_excludes=["data", "*.txt"]
    )