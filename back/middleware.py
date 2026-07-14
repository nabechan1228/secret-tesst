# -*- coding: utf-8 -*-
"""セキュリティヘッダー・レート制限ミドルウェア"""

import logging
import time
from collections import defaultdict
from typing import Dict

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from config import RATE_LIMIT_IP_TTL, get_allowed_origins

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """全レスポンスにセキュリティ関連 HTTP ヘッダーを付与する"""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store"
        # X-XSS-Protection は Chrome 78+ で廃止済み。CSP が有効なため明示的に無効化する。
        response.headers["X-XSS-Protection"] = "0"
        # ブラウザ API へのアクセスを制限（geolocation は観測地設定に必要なため許可）
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
        # 本番 HTTPS デプロイ時は以下を有効化してください:
        # response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """IP アドレスベースの簡易レート制限（スライディングウィンドウ方式）"""

    RATE_LIMITS: Dict[str, tuple] = {
        "/api/sky": (120, 60),
        "/api/sky/stars-only": (120, 60),
        "/api/constellations": (120, 60),
        "/api/satellites": (120, 60),
        "/api/meteor-showers": (120, 60),
        "/api/weather": (120, 60),
        "/health": (120, 60),
    }
    DEFAULT_LIMIT = (60, 60)

    def __init__(self, app):
        super().__init__(app)
        self._requests: Dict[str, Dict[str, list]] = defaultdict(lambda: defaultdict(list))
        self._last_access: Dict[str, float] = {}

    def _purge_stale_ips(self, now: float) -> None:
        """一定時間アクセスのない IP エントリを削除してメモリリークを防ぐ"""
        stale = [ip for ip, ts in self._last_access.items() if now - ts > RATE_LIMIT_IP_TTL]
        for ip in stale:
            self._requests.pop(ip, None)
            self._last_access.pop(ip, None)

    async def dispatch(self, request: Request, call_next) -> Response:
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        now = time.time()

        self._last_access[client_ip] = now
        if len(self._last_access) > 500:
            self._purge_stale_ips(now)

        max_requests, window = self.RATE_LIMITS.get(path, self.DEFAULT_LIMIT)
        cutoff = now - window

        timestamps = self._requests[client_ip][path]
        self._requests[client_ip][path] = [t for t in timestamps if t > cutoff]

        if len(self._requests[client_ip][path]) >= max_requests:
            logger.warning("レート制限超過: IP=%s path=%s", client_ip, path)
            headers = {"Retry-After": str(window)}
            origin = request.headers.get("origin")
            allowed = get_allowed_origins()
            if origin in allowed:
                headers["Access-Control-Allow-Origin"] = origin
                headers["Access-Control-Allow-Headers"] = "Content-Type"
                headers["Access-Control-Allow-Methods"] = "GET"
            return JSONResponse(
                status_code=429,
                content={"detail": "リクエストが多すぎます。しばらく待ってから再試行してください。"},
                headers=headers,
            )

        self._requests[client_ip][path].append(now)
        return await call_next(request)
