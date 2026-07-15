# -*- coding: utf-8 -*-
"""環境変数ベースのアプリケーション設定"""

import os

DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# 本番環境判定フラグ
IS_PRODUCTION = (
    os.environ.get("ENV", "").lower() == "production"
    or os.environ.get("IS_PRODUCTION", "false").lower() in ("1", "true", "yes")
)

# APIドキュメント (/docs, /redoc) の公開。本番環境ではデフォルトで非公開 (false)
ENABLE_API_DOCS = os.environ.get("ENABLE_API_DOCS", str(not IS_PRODUCTION)).lower() in ("1", "true", "yes")

# レート制限: 非アクセス IP の保持時間（秒）
RATE_LIMIT_IP_TTL = int(os.environ.get("RATE_LIMIT_IP_TTL", "3600"))


def get_allowed_origins() -> list[str]:
    """
    CORS 許可オリジン。
    本番環境 (IS_PRODUCTION=True) の場合は localhost デフォルトは許可せず、
    環境変数 CORS_ORIGINS で明示されたオリジンのみを許可します。
    """
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    
    if IS_PRODUCTION:
        # 本番環境で CORS_ORIGINS が空の場合はセキュリティ確保のため何も許可しない
        import logging
        logging.getLogger(__name__).warning("本番環境ですが CORS_ORIGINS が設定されていません。CORSアクセスは拒否されます。")
        return []
        
    return DEFAULT_ORIGINS.copy()

