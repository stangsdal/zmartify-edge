from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque

from fastapi import Request


_SENSITIVE_PATHS = {"/auth/login", "/auth/register", "/auth/invite/validate"}
_attempts: dict[tuple[str, str], Deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def reset_rate_limit_state() -> None:
    with _lock:
        _attempts.clear()


def _enabled() -> bool:
    return os.getenv("ZMART_EDGE_RATE_LIMIT_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


def _limit() -> int:
    raw = os.getenv("ZMART_EDGE_AUTH_RATE_LIMIT", "20").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 20


def _window_seconds() -> int:
    raw = os.getenv("ZMART_EDGE_AUTH_RATE_LIMIT_WINDOW_SECONDS", "60").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 60


def _client_key(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if forwarded_for:
        return forwarded_for
    if request.client is not None and request.client.host:
        return request.client.host
    return "unknown"


def check_rate_limit(request: Request) -> tuple[bool, int]:
    if not _enabled() or request.url.path not in _SENSITIVE_PATHS:
        return True, 0

    limit = _limit()
    window_seconds = _window_seconds()
    now = time.monotonic()
    cutoff = now - window_seconds
    key = (_client_key(request), request.url.path)

    with _lock:
        attempts = _attempts[key]
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if len(attempts) >= limit:
            retry_after = max(1, int(window_seconds - (now - attempts[0])))
            return False, retry_after
        attempts.append(now)

    return True, 0