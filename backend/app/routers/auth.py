from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import (ROLE_PERMS, Role, create_token, current_user, decrypt, email_index, encrypt,
                             hash_password, verify_password)
from ..models import AuditLog, User

router = APIRouter(prefix="/api/auth", tags=["auth"])
CONSENT_VERSION = "2026-11"


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)
    consent: bool  # LGPD: consentimento explícito obrigatório
    lang: str = "pt"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def user_out(u: User) -> dict:
    return {"id": u.id, "name": decrypt(u.name_enc), "email": decrypt(u.email_enc), "role": u.role,
            "lang": u.lang, "permissions": sorted(ROLE_PERMS[Role(u.role)])}


@router.post("/register")
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if not body.consent:
        raise HTTPException(400, "É necessário aceitar a Política de Privacidade (LGPD)")
    idx = email_index(body.email)
    if db.scalar(select(User).where(User.email_idx == idx)):
        raise HTTPException(409, "E-mail já cadastrado")
    u = User(email_idx=idx, email_enc=encrypt(body.email.lower()), name_enc=encrypt(body.name),
             password_hash=hash_password(body.password), role=Role.composer.value, lang=body.lang,
             consent_at=datetime.now(timezone.utc), consent_version=CONSENT_VERSION, workspace={})
    db.add(u); db.flush()
    db.add(AuditLog(user_id=u.id, action="register", detail={"consent_version": CONSENT_VERSION}))
    db.commit()
    return {"token": create_token(u.id, u.role), "user": user_out(u)}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.email_idx == email_index(body.email)))
    if not u or not verify_password(body.password, u.password_hash) or not u.active:
        raise HTTPException(401, "Credenciais inválidas")
    db.add(AuditLog(user_id=u.id, action="login")); db.commit()
    return {"token": create_token(u.id, u.role), "user": user_out(u)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


class RoleIn(BaseModel):
    role: Role


@router.patch("/users/{uid}/role")
def set_role(uid: int, body: RoleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != Role.admin.value:
        raise HTTPException(403, "Apenas administradores")
    target = db.get(User, uid)
    if not target:
        raise HTTPException(404, "Usuário não encontrado")
    target.role = body.role.value
    db.add(AuditLog(user_id=user.id, action="set_role", detail={"target": uid, "role": body.role.value}))
    db.commit()
    return {"ok": True}


@router.post("/guest")
def guest(db: Session = Depends(get_db)):
    """Entrar como visitante, sem senha e sem dados pessoais (LGPD: nada a consentir).
    A conta de visitante pode ser convertida depois criando uma conta normal."""
    import secrets
    tag = secrets.token_hex(4)
    pseudo = f"visitante-{tag}@guest.local"
    u = User(email_idx=email_index(pseudo), email_enc=encrypt(pseudo), name_enc=encrypt(f"Visitante {tag[:4].upper()}"),
             password_hash="!", role=Role.guest.value, consent_at=datetime.now(timezone.utc), consent_version="guest", workspace={})
    db.add(u); db.flush()
    db.add(AuditLog(user_id=u.id, action="guest_session"))
    db.commit()
    return {"token": create_token(u.id, u.role), "user": user_out(u) | {"guest": True}}
