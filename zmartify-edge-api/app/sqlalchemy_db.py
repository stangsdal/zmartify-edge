from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import get_database_url


def get_sqlalchemy_database_url() -> str:
    raw = get_database_url().strip()
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql+psycopg://", 1)
    if raw.startswith("postgresql://") and "+" not in raw.split("://", 1)[0]:
        return raw.replace("postgresql://", "postgresql+psycopg://", 1)
    if raw.startswith("sqlite://"):
        return raw
    return raw


def build_engine():
    return create_engine(get_sqlalchemy_database_url(), future=True)


def build_session_factory() -> sessionmaker:
    return sessionmaker(bind=build_engine(), autoflush=False, autocommit=False, future=True)
