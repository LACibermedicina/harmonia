"""Upload de áudio/foto/gravação, fila de jobs de IA e entrega de mídia."""
import json
import os
import uuid
from pathlib import Path

import redis
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.db import get_db
from ..core.security import current_user, require
from ..models import Asset, User

router = APIRouter(prefix="/api", tags=["media"])
_r = None

ALLOWED = {
    "audio": {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave", "audio/flac", "audio/ogg", "audio/webm",
              "audio/mp4", "audio/x-m4a", "audio/aac", "video/webm", "video/mp4", "video/quicktime", "audio/opus"},
    "image": {"image/png", "image/jpeg", "image/webp", "image/heic"},
}
MAGIC = {b"RIFF": "wav", b"ID3": "mp3", b"\xff\xfb": "mp3", b"\xff\xf3": "mp3", b"fLaC": "flac", b"OggS": "ogg",
         b"\x1aE\xdf\xa3": "webm", b"\x89PNG": "png", b"\xff\xd8\xff": "jpg"}


def rds() -> redis.Redis:
    global _r
    if _r is None:
        _r = redis.Redis.from_url(settings().redis_url, decode_responses=True)
    return _r


@router.post("/assets")
async def upload(kind: str = Form(...), file: UploadFile = File(...),
                 user: User = Depends(require("compose")), db: Session = Depends(get_db)):
    k = "audio" if kind in ("audio", "recording") else kind
    if k not in ALLOWED or (file.content_type or "").split(";")[0] not in ALLOWED[k]:
        raise HTTPException(415, f"Tipo de arquivo não suportado: {file.content_type}")
    data = await file.read()
    if len(data) > settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "Arquivo muito grande")
    head = data[:4]
    if not any(head.startswith(m) for m in MAGIC) and b"ftyp" not in data[:12]:
        raise HTTPException(415, "Conteúdo do arquivo não reconhecido")
    ext = Path(file.filename or "").suffix.lower()[:6] or ".bin"
    rel = f"u{user.id}/{kind}/{uuid.uuid4().hex}{ext}"
    dst = Path(settings().media_root) / rel
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
    except OSError as e:
        import logging
        logging.getLogger("harmonia.media").error("falha ao gravar %s: %s", dst, e)
        raise HTTPException(507, "O servidor não conseguiu salvar o arquivo (sem permissão ou sem espaço na pasta de mídia). "
                                 "O administrador pode corrigir rodando a atualização na VPS.")
    a = Asset(owner_id=user.id, kind=kind, path=rel, mime=file.content_type or "", size=len(data))
    db.add(a); db.commit()
    return {"id": a.id, "path": rel, "url": f"/api/media/{rel}", "size": a.size}


@router.get("/media/{path:path}")
def media(path: str):
    # Arquivos têm nomes UUID não adivinháveis; exports e stems são servidos por URL de capacidade.
    base = Path(settings().media_root).resolve()
    f = (base / path).resolve()
    if base not in f.parents or not f.is_file():
        raise HTTPException(404, "Não encontrado")
    return FileResponse(f)


class JobIn(BaseModel):
    type: str
    payload: dict


SYNC = {"parse_cifra", "harmonize", "extract_melody", "transcribe_chords", "lyrics"}
ASYNC = {"transcribe_audio", "transcribe_image", "export"}


@router.post("/jobs")
def create_job(body: JobIn, user: User = Depends(require("ai"))):
    if body.type not in SYNC | ASYNC:
        raise HTTPException(400, "Tipo de job desconhecido")
    p = body.payload
    if "asset" in p and not p["asset"].startswith(f"u{user.id}/"):
        raise HTTPException(403, "Arquivo não pertence ao usuário")
    if body.type in SYNC:
        # algoritmos leves rodam em processo (resposta imediata para o editor)
        from harmonia_ai.jobs import HANDLERS
        try:
            return {"id": None, "status": "done", "result": HANDLERS[body.type](p)}
        except (ValueError, KeyError) as e:
            raise HTTPException(422, str(e))
    jid = uuid.uuid4().hex
    try:
        rds().hset(f"harmonia:job:{jid}", mapping={"status": "queued", "owner": str(user.id), "type": body.type})
        rds().expire(f"harmonia:job:{jid}", 86400)
        rds().rpush("harmonia:jobs", json.dumps({"id": jid, "type": body.type, "payload": p}))
    except redis.RedisError:
        raise HTTPException(503, "A fila de processamento de IA está fora do ar (Redis). O arquivo foi enviado; tente de novo em instantes.")
    return {"id": jid, "status": "queued"}


@router.delete("/jobs/{jid}")
def cancel_job(jid: str, user: User = Depends(current_user)):
    """Cancela uma transcrição: sai da fila se ainda não começou; se já está rodando, o worker para na próxima etapa."""
    key = f"harmonia:job:{jid}"
    h = rds().hgetall(key)
    if not h or h.get("owner") != str(user.id):
        raise HTTPException(404, "Job não encontrado")
    if h.get("status") in ("done", "error", "cancelled"):
        return {"id": jid, "status": h.get("status")}
    rds().hset(key, mapping={"cancel": "1"})
    removed = 0
    for item in rds().lrange("harmonia:jobs", 0, 500):
        if f'"{jid}"' in item:
            removed += rds().lrem("harmonia:jobs", 1, item)
    if removed or h.get("status") == "queued":
        rds().hset(key, mapping={"status": "cancelled"})
    return {"id": jid, "status": "cancelled" if removed or h.get("status") == "queued" else "cancelling"}


@router.get("/jobs/{jid}")
def job_status(jid: str, user: User = Depends(current_user)):
    h = rds().hgetall(f"harmonia:job:{jid}")
    if not h or h.get("owner") != str(user.id):
        raise HTTPException(404, "Job não encontrado")
    out = {"id": jid, "status": h.get("status"), "type": h.get("type")}
    for k in ("result", "error", "seconds", "progress"):
        if k in h:
            out[k] = json.loads(h[k]) if k != "error" else h[k]
    if h.get("started"):
        out["elapsed"] = round(__import__("time").time() - float(h["started"]), 1)
    if out["status"] == "queued":
        # posição na fila e se o processador de IA está ativo (feedback em vez de espera muda)
        try:
            queue = rds().lrange("harmonia:jobs", 0, 200)
            out["queuePos"] = next((i + 1 for i, item in enumerate(queue) if f'"{jid}"' in item), 0)
        except Exception:  # noqa: BLE001
            out["queuePos"] = 0
        out["workerAlive"] = bool(rds().exists("harmonia:worker:alive"))
    return out
