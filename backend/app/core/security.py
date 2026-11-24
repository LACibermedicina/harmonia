"""Autenticação (JWT), hash de senha (scrypt), criptografia de dados pessoais (AES-GCM) e RBAC."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from enum import Enum

import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db


class Role(str, Enum):
    admin = "admin"          # tudo + moderação da biblioteca pública
    composer = "composer"    # cria/edita composições próprias, publica
    student = "student"      # cria/edita, não publica na biblioteca principal
    viewer = "viewer"        # só leitura/escuta
    guest = "guest"          # visitante sem senha: compõe e usa IA; não publica nem conversa


ROLE_PERMS: dict[Role, set[str]] = {
    Role.admin: {"*"},
    Role.composer: {"compose", "publish", "ai", "export", "chat", "library"},
    Role.student: {"compose", "ai", "export", "chat", "library"},
    Role.viewer: {"library", "chat"},
    Role.guest: {"compose", "ai", "export", "library"},
}


# ---------------------------------------------------------------- senhas
def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, s, h = stored.split("$")
        dk = hashlib.scrypt(pw.encode(), salt=base64.b64decode(s), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(dk, base64.b64decode(h))
    except Exception:  # noqa: BLE001
        return False


# ----------------------------------------------------- LGPD: dados pessoais
def _aes() -> AESGCM:
    return AESGCM(bytes.fromhex(settings().data_key)[:32])


def encrypt(text: str) -> str:
    nonce = os.urandom(12)
    return base64.b64encode(nonce + _aes().encrypt(nonce, text.encode(), None)).decode()


def decrypt(blob: str) -> str:
    raw = base64.b64decode(blob)
    return _aes().decrypt(raw[:12], raw[12:], None).decode()


def email_index(email: str) -> str:
    """Hash determinístico (HMAC) para buscar por e-mail sem armazená-lo em claro."""
    return hmac.new(bytes.fromhex(settings().data_key), email.strip().lower().encode(), "sha256").hexdigest()


# ------------------------------------------------------------------- JWT
def create_token(user_id: int, role: str) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "role": role, "iat": now, "exp": now + settings().token_ttl_min * 60},
                      settings().jwt_secret, algorithm="HS256")


bearer = HTTPBearer(auto_error=False)


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    from ..models import User
    if not cred:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado")
    try:
        data = jwt.decode(cred.credentials, settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido ou expirado")
    user = db.get(User, int(data["sub"]))
    if not user or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inativo")
    return user


def optional_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    if not cred:
        return None
    try:
        return current_user(cred, db)
    except HTTPException:
        return None


def require(perm: str):
    def dep(user=Depends(current_user)):
        perms = ROLE_PERMS.get(Role(user.role), set())
        if "*" not in perms and perm not in perms:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Permissão '{perm}' necessária")
        return user
    return dep
