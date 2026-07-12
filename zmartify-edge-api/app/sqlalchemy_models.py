from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class CoreDomainV2(Base):
    __tablename__ = "core_domains_v2"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    sites: Mapped[list[CoreSiteV2]] = relationship(back_populates="domain", cascade="all, delete-orphan")


class CoreSiteV2(Base):
    __tablename__ = "core_sites_v2"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    domain_id: Mapped[int] = mapped_column(ForeignKey("core_domains_v2.id", ondelete="CASCADE"), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    domain: Mapped[CoreDomainV2] = relationship(back_populates="sites")
    devices: Mapped[list[CoreDeviceV2]] = relationship(back_populates="site", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_core_sites_v2_domain_slug", "domain_id", "slug", unique=True),
    )


class CoreDeviceV2(Base):
    __tablename__ = "core_devices_v2"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    device_ref: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("core_sites_v2.id", ondelete="SET NULL"), nullable=True)
    product_type: Mapped[str] = mapped_column(String(80), nullable=False, default="hvac")
    product_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(120), nullable=True)
    integration_mode: Mapped[str] = mapped_column(String(80), nullable=False, default="mqtt")
    identity_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    site: Mapped[CoreSiteV2 | None] = relationship(back_populates="devices")
