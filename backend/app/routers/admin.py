"""Administração (somente papel admin): usuários, papéis, bloqueio, estatísticas e auditoria LGPD."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import Role, current_user, decrypt
from ..models import Asset, AuditLog, Composition, Playlist, User

router = APIRouter(prefix="/api/admin", tags=["admin"])


def admin_only(user: User = Depends(current_user)) -> User:
    if user.role != Role.admin.value:
        raise HTTPException(403, "Acesso restrito ao administrador")
    return user


@router.get("/users")
def list_users(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Composition.owner_id, func.count()).group_by(Composition.owner_id)).all())
    db.add(AuditLog(user_id=admin.id, action="admin_list_users")); db.commit()
    return [{"id": u.id, "name": decrypt(u.name_enc), "email": decrypt(u.email_enc), "role": u.role, "active": u.active,
             "compositions": counts.get(u.id, 0), "createdAt": u.created_at.isoformat(),
             "consentVersion": u.consent_version}
            for u in db.scalars(select(User).order_by(User.created_at.desc()))]


class UserPatch(BaseModel):
    role: Role | None = None
    active: bool | None = None


@router.patch("/users/{uid}")
def patch_user(uid: int, body: UserPatch, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Usuário não encontrado")
    if u.id == admin.id and (body.active is False or (body.role and body.role != Role.admin)):
        raise HTTPException(400, "Você não pode remover o seu próprio acesso de administrador")
    if body.role:
        u.role = body.role.value
    if body.active is not None:
        u.active = body.active
    db.add(AuditLog(user_id=admin.id, action="admin_patch_user",
                    detail={"target": uid, "role": body.role and body.role.value, "active": body.active}))
    db.commit()
    return {"ok": True}


@router.get("/stats")
def stats(_: User = Depends(admin_only), db: Session = Depends(get_db)):
    c = lambda stmt: db.scalar(stmt) or 0  # noqa: E731
    return {
        "users": c(select(func.count()).select_from(User)),
        "activeUsers": c(select(func.count()).select_from(User).where(User.active.is_(True))),
        "compositions": c(select(func.count()).select_from(Composition)),
        "public": c(select(func.count()).select_from(Composition).where(Composition.visibility == "public")),
        "featured": c(select(func.count()).select_from(Composition).where(Composition.featured.is_(True))),
        "playlists": c(select(func.count()).select_from(Playlist)),
        "storageMB": round(c(select(func.sum(Asset.size))) / 1048576, 1),
    }


@router.get("/audit")
def audit(limit: int = 100, _: User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.at.desc()).limit(min(limit, 500)))
    return [{"id": a.id, "userId": a.user_id, "action": a.action, "detail": a.detail, "at": a.at.isoformat()} for a in rows]


@router.post("/compositions/{cid}/unpublish")
def unpublish(cid: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Moderação da biblioteca pública."""
    comp = db.get(Composition, cid)
    if not comp:
        raise HTTPException(404, "Composição não encontrada")
    comp.visibility, comp.featured = "private", False
    db.add(AuditLog(user_id=admin.id, action="admin_unpublish", detail={"composition": cid})); db.commit()
    return {"ok": True}


@router.get("/system")
def system(_: User = Depends(admin_only)):
    """Estado da atualização automática (gravado pelo autoupdate.sh na VPS)."""
    import json
    import os
    base = os.getenv("STATUS_DIR", "/data/status")
    out: dict = {"autoupdate": None, "log": []}
    try:
        with open(os.path.join(base, "autoupdate.json")) as f:
            out["autoupdate"] = json.load(f)
    except (OSError, ValueError):
        pass
    try:
        with open(os.path.join(base, "autoupdate.log")) as f:
            out["log"] = [ln.rstrip() for ln in f.readlines()[-40:]]
    except OSError:
        pass
    return out


@router.get("/ai")
def ai_status(_: User = Depends(admin_only)):
    """Provedores de IA (sem expor chaves): ordem de failover, modelo, saúde."""
    from ..core import llm
    return {"providers": llm.status()}


@router.post("/ai/test")
async def ai_test(_: User = Depends(admin_only)):
    from ..core import llm
    t0 = __import__("time").time()
    text, provider = await llm.complete_ex("Responda apenas: ok", "teste de conectividade", 10, timeout=20)
    return {"provider": provider, "reply": text.strip()[:40], "ms": int((__import__("time").time() - t0) * 1000),
            "providers": llm.status()}


# ----------------------------------------------- credenciais de IA (painel)
class CredIn(BaseModel):
    name: str                      # groq, gemini, openai… ou um nome próprio para "outra IA"
    key: str | None = None         # vazio = mantém a chave atual (para só trocar o modelo)
    model: str | None = None
    label: str | None = None
    url: str | None = None         # obrigatório para "outra IA" (endpoint compatível com OpenAI)
    kind: str | None = None        # openai | anthropic | gemini (padrão openai para outras IAs)
    free: bool | None = None
    enabled: bool = True
    test: bool = True


@router.post("/ai/credentials")
async def save_credential(body: CredIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    import re

    from ..core import llm
    from ..core.security import encrypt
    from ..models import AICredential
    name = body.name.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,38}", name):
        raise HTTPException(422, "Nome inválido: use letras minúsculas, números, - ou _")
    builtin = name in llm.BUILTIN
    if not builtin:
        if not body.url or not re.match(r"^https://[\w.-]+(:\d+)?/\S*$", body.url):
            raise HTTPException(422, "Informe a URL https do endpoint (ex.: https://api.exemplo.com/v1/chat/completions)")
        if (body.kind or "openai") not in ("openai", "anthropic", "gemini"):
            raise HTTPException(422, "Tipo inválido")
    row = db.scalar(select(AICredential).where(AICredential.name == name))
    key = (body.key or "").strip()
    if not row and not key:
        raise HTTPException(422, "Informe a chave de API")
    if not row:
        row = AICredential(name=name, key_enc="")
        db.add(row)
    if key:
        row.key_enc, row.key_hint = encrypt(key), key[-4:]
    row.model = (body.model or "").strip()
    row.enabled = body.enabled
    row.updated_by = admin.id
    if builtin:
        row.kind, row.url, row.label, row.free = llm.PROVIDERS[name].kind, "", llm.PROVIDERS[name].label, llm.PROVIDERS[name].free
    else:
        row.kind, row.url = body.kind or "openai", body.url or ""
        row.label = (body.label or name).strip()[:80]
        row.free = bool(body.free)
    db.add(AuditLog(user_id=admin.id, action="ai_credential_saved", detail={"provider": name, "model": row.model, "keyChanged": bool(key)}))
    db.commit()
    llm.refresh_from_db(force=True)
    result = (await llm.diagnose([name]))[0] if body.test else None
    return {"ok": True, "test": result, "providers": llm.status()}


@router.delete("/ai/credentials/{name}")
def delete_credential(name: str, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    from ..core import llm
    from ..models import AICredential
    row = db.scalar(select(AICredential).where(AICredential.name == name))
    if not row:
        raise HTTPException(404, "Credencial não cadastrada no painel (chaves do .env/GitHub são geridas lá)")
    db.delete(row)
    db.add(AuditLog(user_id=admin.id, action="ai_credential_deleted", detail={"provider": name}))
    db.commit()
    llm.refresh_from_db(force=True)
    return {"ok": True, "providers": llm.status()}


class DiagIn(BaseModel):
    names: list[str] | None = None  # vazio = todas; uma lista = testa só essas (botão "Testar" da linha)


@router.post("/ai/diagnose")
async def ai_diagnose(body: DiagIn | None = None, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Rodada diagnóstica: testa cada IA isoladamente e diz qual funciona e por que a outra falhou."""
    from ..core import llm
    t0 = __import__("time").time()
    names = [n.strip().lower() for n in (body.names if body and body.names else [])][:20] or None
    results = await llm.diagnose(names, refresh=names is None)  # rodada completa: recoleta o acervo antes
    ok = [r["name"] for r in results if r["ok"] and r["name"] not in ("mymemory", "offline")]
    db.add(AuditLog(user_id=admin.id, action="ai_diagnose", detail={"ok": ok, "failed": [r["name"] for r in results if r["state"] == "erro"]}))
    db.commit()
    refreshed = bool(results and results[0].pop("poolRefreshed", False))
    return {"results": results, "working": len(ok), "ms": int((__import__("time").time() - t0) * 1000), "providers": llm.status(),
            "poolRefreshed": refreshed}
