"""Composições (Score JSON), biblioteca pública, compartilhamento por link, playlists e álbuns."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import current_user, decrypt, optional_user, require
from ..models import Composition, Playlist, PlaylistItem, User

router = APIRouter(prefix="/api", tags=["compositions"])


def empty_score(title: str) -> dict:
    return {"title": title, "tempo": 96, "timeSig": [4, 4], "keySig": 0, "measures": 8,
            "layers": [], "chords": [], "annotations": []}


def comp_out(c: Composition, full: bool = False, owner: User | None = None) -> dict:
    d = {"id": c.id, "title": c.title, "visibility": c.visibility, "featured": c.featured,
         "shareUrl": f"/s/{c.share_token}" if c.visibility != "private" else None,
         "version": c.version, "coverColor": c.cover_color, "updatedAt": c.updated_at.isoformat(),
         "measures": c.score.get("measures"), "tempo": c.score.get("tempo")}
    if owner:
        d["author"] = decrypt(owner.name_enc).split(" ")[0]  # minimização LGPD: só o primeiro nome
    if full:
        d["score"] = c.score
    return d


class CompIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    score: dict | None = None
    coverColor: str | None = None


class CompPatch(BaseModel):
    title: str | None = None
    score: dict | None = None
    version: int | None = None  # controle otimista de concorrência
    coverColor: str | None = None


def _own(db: Session, cid: int, user: User) -> Composition:
    c = db.get(Composition, cid)
    if not c or (c.owner_id != user.id and user.role != "admin"):
        raise HTTPException(404, "Composição não encontrada")
    return c


@router.get("/compositions")
def list_mine(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Composition).where(Composition.owner_id == user.id).order_by(Composition.updated_at.desc()))
    return [comp_out(c) for c in rows]


@router.post("/compositions")
def create(body: CompIn, user: User = Depends(require("compose")), db: Session = Depends(get_db)):
    c = Composition(owner_id=user.id, title=body.title, score=body.score or empty_score(body.title),
                    cover_color=body.coverColor or "#7c5cff")
    db.add(c); db.commit()
    return comp_out(c, full=True)


@router.get("/compositions/{cid}")
def get_one(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return comp_out(_own(db, cid, user), full=True)


@router.patch("/compositions/{cid}")
def update(cid: int, body: CompPatch, user: User = Depends(require("compose")), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    if body.version is not None and body.version != c.version:
        raise HTTPException(409, "Versão desatualizada — recarregue a composição")
    if body.title:
        c.title = body.title
    if body.score is not None:
        c.score = body.score
    if body.coverColor:
        c.cover_color = body.coverColor
    c.version += 1
    db.commit()
    return comp_out(c)


@router.delete("/compositions/{cid}")
def delete(cid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, cid, user)); db.commit()
    return {"ok": True}


class PublishIn(BaseModel):
    visibility: str = Field(pattern="^(private|link|public)$")
    featured: bool = False
    rotateToken: bool = False


@router.post("/compositions/{cid}/publish")
def publish(cid: int, body: PublishIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = _own(db, cid, user)
    if body.visibility == "public" and user.role not in ("admin", "composer"):
        raise HTTPException(403, "Seu perfil não pode publicar na biblioteca pública")
    c.visibility = body.visibility
    c.featured = body.featured and body.visibility == "public"
    if body.rotateToken:
        c.share_token = secrets.token_urlsafe(16)
    db.commit()
    return comp_out(c)


# ------------------------------------------------------- biblioteca pública
@router.get("/library/public")
def public_library(q: str = "", featured: bool = False, db: Session = Depends(get_db)):
    stmt = select(Composition, User).join(User, User.id == Composition.owner_id).where(Composition.visibility == "public")
    if featured:
        stmt = stmt.where(Composition.featured.is_(True))
    if q:
        stmt = stmt.where(Composition.title.ilike(f"%{q}%"))
    rows = db.execute(stmt.order_by(Composition.featured.desc(), Composition.updated_at.desc()).limit(200))
    return [comp_out(c, owner=u) for c, u in rows]


@router.get("/share/{token}")
def shared(token: str, db: Session = Depends(get_db)):
    c = db.scalar(select(Composition).where(Composition.share_token == token, Composition.visibility != "private"))
    if c:
        return {"type": "composition", **comp_out(c, full=True, owner=db.get(User, c.owner_id))}
    p = db.scalar(select(Playlist).where(Playlist.share_token == token, Playlist.visibility != "private"))
    if p:
        return {"type": p.kind, **_pl_out(db, p, public_only=True)}
    raise HTTPException(404, "Link inválido ou privado")


# ------------------------------------------------------ playlists / álbuns
class PlIn(BaseModel):
    title: str
    kind: str = Field("playlist", pattern="^(playlist|album)$")
    description: str = ""
    coverColor: str = "#ff7ab6"


def _pl_out(db: Session, p: Playlist, public_only: bool = False) -> dict:
    items = []
    for it in p.items:
        c = db.get(Composition, it.composition_id)
        if c and (not public_only or c.visibility != "private"):
            items.append(comp_out(c))
    return {"id": p.id, "kind": p.kind, "title": p.title, "description": p.description, "coverColor": p.cover_color,
            "visibility": p.visibility, "shareUrl": f"/s/{p.share_token}" if p.visibility != "private" else None,
            "items": items}


@router.get("/playlists")
def list_pl(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [_pl_out(db, p) for p in db.scalars(select(Playlist).where(Playlist.owner_id == user.id))]


@router.post("/playlists")
def create_pl(body: PlIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = Playlist(owner_id=user.id, title=body.title, kind=body.kind, description=body.description,
                 cover_color=body.coverColor)
    db.add(p); db.commit()
    return _pl_out(db, p)


class ItemsIn(BaseModel):
    compositionIds: list[int]  # ordem final (drag & drop reordena)


@router.put("/playlists/{pid}/items")
def set_items(pid: int, body: ItemsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Playlist, pid)
    if not p or p.owner_id != user.id:
        raise HTTPException(404, "Playlist não encontrada")
    allowed = {c.id for c in db.scalars(select(Composition).where(
        Composition.id.in_(body.compositionIds),
        or_(Composition.owner_id == user.id, Composition.visibility == "public")))}
    p.items.clear(); db.flush()
    for pos, cid in enumerate(i for i in body.compositionIds if i in allowed):
        p.items.append(PlaylistItem(composition_id=cid, position=pos))
    db.commit()
    return _pl_out(db, p)


@router.post("/playlists/{pid}/publish")
def publish_pl(pid: int, body: PublishIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Playlist, pid)
    if not p or p.owner_id != user.id:
        raise HTTPException(404, "Playlist não encontrada")
    p.visibility = body.visibility
    if body.rotateToken:
        p.share_token = secrets.token_urlsafe(16)
    db.commit()
    return _pl_out(db, p)


@router.get("/library/public/albums")
def public_albums(db: Session = Depends(get_db), _=Depends(optional_user)):
    return [_pl_out(db, p, public_only=True) for p in db.scalars(
        select(Playlist).where(Playlist.visibility == "public").order_by(Playlist.created_at.desc()).limit(100))]
