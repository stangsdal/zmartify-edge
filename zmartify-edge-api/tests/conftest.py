from __future__ import annotations

import pytest

from app.rate_limit import reset_rate_limit_state


@pytest.fixture(autouse=True)
def reset_auth_rate_limit() -> None:
    reset_rate_limit_state()