import os
import logging
from datetime import datetime, timezone
from skyfield.api import Topos, load

logger = logging.getLogger(__name__)

# データディレクトリの準備 (TLEやleap secondsなどのキャッシュ用)
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(DATA_DIR, exist_ok=True)

# builtin=True でローカルの timescales データを使用し、外部依存を減らす
ts = load.timescale(builtin=True)

STATIONS_URL = 'http://celestrak.org/NORAD/elements/stations.txt'

def get_satellites_position(dt_utc: datetime, lat: float, lng: float) -> list:
    """
    指定日時のISS(国際宇宙ステーション)等の位置を計算して返す
    """
    try:
        # TLEファイルの取得 (キャッシュ有効化)
        satellites = load.tle_file(STATIONS_URL, filename=os.path.join(DATA_DIR, 'stations.txt'))
        by_name = {sat.name: sat for sat in satellites}
        
        results = []
        
        # 今回は ISS (ZARYA) を対象とする
        iss = by_name.get('ISS (ZARYA)')
        
        if iss:
            # 観測者の位置 (WGS84)
            from skyfield.api import wgs84
            topos = wgs84.latlon(latitude_degrees=lat, longitude_degrees=lng)
            
            # 指定時刻
            t = ts.from_datetime(dt_utc)
            
            # 地平座標 (Azimuth, Altitude)
            difference = iss - topos
            topocentric = difference.at(t)
            alt, az, distance = topocentric.altaz()
            ra, dec, distance_eq = topocentric.radec()
            
            results.append({
                "id": "iss",
                "name": "ISS",
                "name_ja": "国際宇宙ステーション",
                "ra": ra.hours,
                "dec": dec.degrees,
                "az": az.degrees,
                "alt": alt.degrees,
                "mag": -2.0,       # 非常に明るいとする
                "color": "#ffffff", # 白色
                "type": "satellite"
            })
            
        return results
        
    except Exception as e:
        logger.error(f"衛星データの取得・計算に失敗しました: {e}")
        return []
