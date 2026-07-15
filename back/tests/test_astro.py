import sys
import os
from datetime import datetime, timezone
import pytest

# パス設定（親ディレクトリをインポートパスに追加）
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import get_julian_date, get_local_sidereal_time, equatorial_to_horizontal

def test_get_julian_date():
    # 2000年1月1日 12:00 UTC (JD=2451545.0)
    dt = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    jd = get_julian_date(dt)
    assert abs(jd - 2451545.0) < 1e-5

def test_get_local_sidereal_time():
    # J2000.0基準時刻、経度 0.0 における地方恒星時 (GMSTに等しい)
    jd = 2451545.0
    lst = get_local_sidereal_time(jd, 0.0)
    # 理論値: 280.46061837 度
    assert abs(lst - 280.4606) < 0.1

def test_equatorial_to_horizontal():
    # 赤経=0h, 赤緯=0d, LST=0d, 観測地緯度=0d (天頂に星がある状態)
    # 時角 HA = 0
    # sin(Alt) = sin(0)sin(0) + cos(0)cos(0)cos(0) = 1 -> Alt = 90
    hor = equatorial_to_horizontal(0.0, 0.0, 0.0, 0.0)
    assert abs(hor["alt"] - 90.0) < 1e-5

def test_production_headers():
    # 環境変数を production に設定して本番モードをテスト
    os.environ["IS_PRODUCTION"] = "true"
    
    import importlib
    import config
    import middleware
    import main
    
    # 設定を強制的にリロードして本番モードを反映
    importlib.reload(config)
    importlib.reload(middleware)
    importlib.reload(main)
    
    from fastapi.testclient import TestClient
    client = TestClient(main.app)
    
    response = client.get("/health")
    assert response.status_code == 200
    # HSTSヘッダーが付与されていることを検証
    assert "strict-transport-security" in response.headers
    assert response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
    
    # 検証終了後に環境変数を戻してリロード
    os.environ["IS_PRODUCTION"] = "false"
    importlib.reload(config)
    importlib.reload(middleware)
    importlib.reload(main)

