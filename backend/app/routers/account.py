"""LGPD (art. 18): acesso/portabilidade, correção, eliminação; workspace (agenda, grafo, janelas)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import current_user, decrypt, encrypt
from ..models import Asset, AuditLog, Composition, Playlist, User

router = APIRouter(prefix="/api/account", tags=["account"])


@router.get("/export")
def export_my_data(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.add(AuditLog(user_id=user.id, action="lgpd_export")); db.commit()
    return {
        "user": {"name": decrypt(user.name_enc), "email": decrypt(user.email_enc), "role": user.role,
                 "lang": user.lang, "consent_at": user.consent_at and user.consent_at.isoformat(),
                 "consent_version": user.consent_version, "created_at": user.created_at.isoformat()},
        "workspace": user.workspace,
        "compositions": [{"id": c.id, "title": c.title, "score": c.score, "visibility": c.visibility}
                         for c in db.scalars(select(Composition).where(Composition.owner_id == user.id))],
        "assets": [{"path": a.path, "kind": a.kind, "size": a.size}
                   for a in db.scalars(select(Asset).where(Asset.owner_id == user.id))],
    }


class ProfileIn(BaseModel):
    name: str | None = None
    lang: str | None = None


@router.patch("/profile")
def update_profile(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.name:
        user.name_enc = encrypt(body.name)
    if body.lang:
        user.lang = body.lang
    db.commit()
    return {"ok": True}


@router.delete("")
def delete_account(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Eliminação definitiva. Arquivos de mídia são removidos por job de limpeza (ver CHANGELOG/roadmap)."""
    uid = user.id
    db.execute(delete(Playlist).where(Playlist.owner_id == uid))
    db.execute(delete(Composition).where(Composition.owner_id == uid))
    db.execute(delete(Asset).where(Asset.owner_id == uid))
    db.delete(user)
    db.add(AuditLog(user_id=None, action="lgpd_delete", detail={"former_user": uid}))
    db.commit()
    return {"ok": True}


@router.get("/workspace")
def get_ws(user: User = Depends(current_user)):
    return user.workspace or {}


@router.put("/workspace")
def put_ws(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.workspace = {k: body[k] for k in ("agenda", "graph", "windows", "prefs") if k in body}
    db.commit()
    return {"ok": True}
