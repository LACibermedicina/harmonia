from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .routers import account, admin, ai, auth, compositions, media

s = settings()
app = FastAPI(title="harmonIA API", version=s.version, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=[s.public_base], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth, compositions, media, ai, account, admin):
    app.include_router(r.router)


@app.exception_handler(Exception)
async def _unhandled(request, exc):  # erros inesperados voltam em JSON legível (nunca "Internal Server Error" cru)
    import logging
    from fastapi.responses import JSONResponse
    logging.getLogger("harmonia").exception("erro não tratado em %s", request.url.path)
    return JSONResponse({"detail": f"Erro no servidor ({type(exc).__name__}). Tente de novo; se persistir, avise o administrador."}, status_code=500)


@app.get("/api/health")
def health():
    import os
    import tempfile
    try:  # a pasta de mídia precisa aceitar gravação (envio de áudio/imagem)
        os.makedirs(s.media_root, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=s.media_root, prefix=".hc-"):
            pass
        storage = True
    except OSError:
        storage = False
    return {"status": "ok", "project": s.project, "version": s.version, "commit": s.git_sha,
            "ai_full": os.getenv("AI_ML", "0") == "1", "storage": storage}
