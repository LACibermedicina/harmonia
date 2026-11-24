"""Worker de IA: consome a fila Redis `harmonia:jobs`, publica progresso em `harmonia:job:<id>`
e notifica o canal pub/sub `harmonia:events` (repassado ao frontend pelo serviço realtime)."""
from __future__ import annotations

import json
import logging
import os
import signal
import time
import traceback

import redis

from . import jobs
from .jobs import HANDLERS

log = logging.getLogger("harmonia.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
r = redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
RUNNING = True


def _stop(*_):
    global RUNNING
    RUNNING = False


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)


def _set(job_id: str, **fields):
    key = f"harmonia:job:{job_id}"
    r.hset(key, mapping={k: json.dumps(v) if not isinstance(v, str) else v for k, v in fields.items()})
    r.expire(key, 60 * 60 * 24)
    owner = r.hget(key, "owner")
    r.publish("harmonia:events", json.dumps({"type": "job", "id": job_id, "owner": owner,
                                             "status": fields.get("status")}))


def _friendly(e: Exception) -> str:
    """Mensagem de erro compreensível (sem rastros técnicos) para a interface."""
    m = str(e) or type(e).__name__
    low = m.lower()
    if m.startswith("OMR_LITE"):
        return "OMR_LITE: a leitura completa de partituras não está instalada neste servidor (modo leve)."
    if "no such file" in low or "filenotfound" in low:
        return "Arquivo não encontrado no servidor — envie o áudio/imagem de novo."
    if "ffmpeg" in low or "decode" in low or "format" in low:
        return "Não consegui ler este arquivo de áudio. Tente MP3 ou WAV, ou grave de novo."
    if "memory" in low:
        return "O servidor ficou sem memória para este trecho — recorte um pedaço menor (até ~60 s)."
    return f"Falha ao processar: {m[:200]}"


def main():
    log.info("worker pronto — handlers: %s", ", ".join(HANDLERS))
    while RUNNING:
        r.set("harmonia:worker:alive", str(time.time()), ex=30)  # a API avisa se o processador parar
        item = r.blpop("harmonia:jobs", timeout=5)
        if not item:
            continue
        job = json.loads(item[1])
        jid, kind = job["id"], job["type"]
        t0 = time.time()
        _set(jid, status="running", started=str(t0))
        # progresso por etapa (%, rótulo, detalhe) — lido pela API e mostrado no ícone de tarefas
        jobs.set_reporter(lambda info, _j=jid: _set(_j, status="running", progress=info))
        jobs.set_cancel_check(lambda _j=jid: r.hget(f"harmonia:job:{_j}", "cancel") == "1")
        if r.hget(f"harmonia:job:{jid}", "cancel") == "1":
            _set(jid, status="cancelled"); continue
        try:
            result = HANDLERS[kind](job["payload"])
            _set(jid, status="done", result=result, seconds=round(time.time() - t0, 2), progress={"pct": 100, "stage": "done", "label": "Concluído"})
            log.info("job %s (%s) ok em %.1fs", jid, kind, time.time() - t0)
        except jobs.Cancelled:
            log.info("job %s cancelado pelo usuário", jid)
            _set(jid, status="cancelled")
        except ModuleNotFoundError as e:
            log.warning("job %s (%s) requer IA completa: %s", jid, kind, e)
            _set(jid, status="error", error="Transcrição por IA indisponível neste servidor (modo leve). "
                 "Ela exige a IA completa (AI_ML=1, ≥ 8 GB de RAM). Cifra, harmonização, edição e exportação seguem disponíveis.")
        except Exception as e:  # noqa: BLE001
            log.error("job %s falhou: %s", jid, traceback.format_exc())
            _set(jid, status="error", error=_friendly(e))
        finally:
            jobs.set_reporter(None)
            jobs.set_cancel_check(None)


if __name__ == "__main__":
    main()
