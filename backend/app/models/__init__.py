from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.db import Base


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email_idx: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # HMAC do e-mail
    email_enc: Mapped[str] = mapped_column(Text)                                  # AES-GCM
    name_enc: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="composer")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    lang: Mapped[str] = mapped_column(String(8), default="pt")
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_version: Mapped[str | None] = mapped_column(String(20))
    workspace: Mapped[dict] = mapped_column(JSON, default=dict)  # agenda, grafo, layout de janelas
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Composition(Base):
    __tablename__ = "compositions"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    score: Mapped[dict] = mapped_column(JSON)            # Score JSON (camadas, acordes, anotações)
    visibility: Mapped[str] = mapped_column(String(10), default="private")  # private | link | public
    share_token: Mapped[str] = mapped_column(String(32), default=lambda: secrets.token_urlsafe(16), unique=True)
    featured: Mapped[bool] = mapped_column(Boolean, default=False)  # publicada no link principal
    version: Mapped[int] = mapped_column(Integer, default=1)
    cover_color: Mapped[str] = mapped_column(String(9), default="#7c5cff")
    preview_audio: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))   # audio | image | recording
    path: Mapped[str] = mapped_column(String(300))  # relativo a MEDIA_ROOT
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Playlist(Base):
    __tablename__ = "playlists"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="playlist")  # playlist | album
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    cover_color: Mapped[str] = mapped_column(String(9), default="#ff7ab6")
    visibility: Mapped[str] = mapped_column(String(10), default="private")
    share_token: Mapped[str] = mapped_column(String(32), default=lambda: secrets.token_urlsafe(16), unique=True)
    items: Mapped[list["PlaylistItem"]] = relationship(cascade="all, delete-orphan", order_by="PlaylistItem.position")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PlaylistItem(Base):
    __tablename__ = "playlist_items"
    __table_args__ = (UniqueConstraint("playlist_id", "composition_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"))
    composition_id: Mapped[int] = mapped_column(ForeignKey("compositions.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer, default=0)


class AuditLog(Base):
    """Trilha de auditoria LGPD (acessos/alterações a dados pessoais)."""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AICredential(Base):
    """Credenciais de IA cadastradas pelo painel de Administração (chave cifrada com AES-256-GCM).
    Sobrepõem as do .env para o mesmo provedor; provedores 'custom' são endpoints compatíveis com OpenAI."""
    __tablename__ = "ai_credentials"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True, index=True)   # groq, gemini… ou slug próprio
    label: Mapped[str] = mapped_column(String(80), default="")
    kind: Mapped[str] = mapped_column(String(12), default="openai")          # anthropic | openai | gemini
    url: Mapped[str] = mapped_column(String(300), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    key_enc: Mapped[str] = mapped_column(Text)
    key_hint: Mapped[str] = mapped_column(String(12), default="")           # últimos 4 caracteres
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    free: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_by: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
