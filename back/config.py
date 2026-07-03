# -*- coding: utf-8 -*-
"""環境変数ベースのアプリケーション設定"""

import os

DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def get_allowed_origins() -> list[str]:
    """CORS 許可オリジン。CORS_ORIGINS 環境変数でカンマ区切り指定可能。"""
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return DEFAULT_ORIGINS.copy()


ENABLE_API_DOCS = os.environ.get("ENABLE_API_DOCS", "true").lower() in ("1", "true", "yes")

# レート制限: 非アクセス IP の保持時間（秒）
RATE_LIMIT_IP_TTL = int(os.environ.get("RATE_LIMIT_IP_TTL", "3600"))
