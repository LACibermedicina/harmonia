import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ai-worker"))
import fakeredis
from fastapi.testclient import TestClient
from app import migrate
from app.routers import media
media._r = fakeredis.FakeRedis(decode_responses=True)
from app.main import app

migrate.main()
c = TestClient(app)


def auth():
    r = c.post("/api/auth/register", json={"email": "a@b.com", "name": "Ana Lima", "password": "segredo123", "consent": True})
    if r.status_code == 409:
        r = c.post("/api/auth/login", json={"email": "a@b.com", "password": "segredo123"})
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_flow():
    assert c.get("/api/health").json()["status"] == "ok"
    assert c.post("/api/auth/register", json={"email": "x@b.com", "name": "X", "password": "segredo123", "consent": False}).status_code == 400
    h = auth()
    me = c.get("/api/auth/me", headers=h).json()
    assert me["email"] == "a@b.com" and me["role"] == "composer"
    comp = c.post("/api/compositions", json={"title": "Valsa"}, headers=h).json()
    cid = comp["id"]
    # cifra síncrona
    r = c.post("/api/jobs", json={"type": "parse_cifra", "payload": {"text": "| C | Am | F | G7 |"}}, headers=h).json()
    res = r["result"]
    assert res["measures"] == 4 and res["layers"][0]["notes"]
    score = comp["score"] | {"layers": res["layers"] + [{"id": "m", "name": "Mel", "kind": "melody", "staff": "treble",
             "notes": [{"pitch": 72, "start": 0, "dur": 4}, {"pitch": 77, "start": 4, "dur": 4}]}], "chords": res["chords"], "measures": 4}
    p = c.patch(f"/api/compositions/{cid}", json={"score": score, "version": 1}, headers=h)
    assert p.status_code == 200
    assert c.patch(f"/api/compositions/{cid}", json={"score": score, "version": 1}, headers=h).status_code == 409
    hz = c.post("/api/jobs", json={"type": "harmonize", "payload": {"score": score, "measures": [1, 2]}}, headers=h).json()
    assert hz["result"]["chords"][1]
    # async export enfileirado
    j = c.post("/api/jobs", json={"type": "export", "payload": {"score": score, "formats": ["mid"]}}, headers=h).json()
    assert j["status"] == "queued"
    st = c.get(f"/api/jobs/{j['id']}", headers=h).json()
    assert st["status"] == "queued" and st["queuePos"] >= 1 and st["workerAlive"] is False
    media._r.hset(f"harmonia:job:{j['id']}", mapping={"status": "running", "started": "1", "progress": '{"pct": 40, "stage": "melody", "label": "Ouvindo a melodia"}'})
    st = c.get(f"/api/jobs/{j['id']}", headers=h).json()
    assert st["progress"]["pct"] == 40 and st["elapsed"] > 0
    # publicar + biblioteca + link
    pub = c.post(f"/api/compositions/{cid}/publish", json={"visibility": "public", "featured": True}, headers=h).json()
    lib = c.get("/api/library/public").json()
    assert lib[0]["author"] == "Ana" and lib[0]["featured"]
    assert c.get("/api/share/" + pub["shareUrl"].split("/")[-1]).json()["title"] == "Valsa"
    pl = c.post("/api/playlists", json={"title": "Meu álbum", "kind": "album"}, headers=h).json()
    pl = c.put(f"/api/playlists/{pl['id']}/items", json={"compositionIds": [cid, 999]}, headers=h).json()
    assert len(pl["items"]) == 1
    # upload com validação de conteúdo
    bad = c.post("/api/assets", data={"kind": "audio"}, files={"file": ("x.wav", b"notaudio", "audio/wav")}, headers=h)
    assert bad.status_code == 415
    ok = c.post("/api/assets", data={"kind": "audio"}, files={"file": ("x.wav", b"RIFF0000WAVE", "audio/wav")}, headers=h)
    assert ok.status_code == 200
    assert c.get(ok.json()["url"]).status_code == 200
    assert c.get("/api/media/../../etc/passwd").status_code == 404
    # LGPD
    exp = c.get("/api/account/export", headers=h).json()
    assert exp["user"]["email"] == "a@b.com" and exp["compositions"]


def test_admin_only():
    h = auth()
    assert c.get("/api/admin/users", headers=h).status_code == 403
    assert c.get("/api/admin/stats", headers=h).status_code == 403
    r = c.post("/api/auth/login", json={"email": "admin@m3d.pro", "password": "admin-segredo-1"}).json()
    ha = {"Authorization": "Bearer " + r["token"]}
    assert r["user"]["role"] == "admin"
    users = c.get("/api/admin/users", headers=ha).json()
    me = next(u for u in users if u["email"] == "admin@m3d.pro")
    other = next(u for u in users if u["email"] == "a@b.com")
    assert c.patch(f"/api/admin/users/{me['id']}", json={"role": "viewer"}, headers=ha).status_code == 400
    assert c.patch(f"/api/admin/users/{other['id']}", json={"role": "student"}, headers=ha).status_code == 200
    assert c.get("/api/admin/stats", headers=ha).json()["users"] >= 2
    assert any(a["action"] == "admin_patch_user" for a in c.get("/api/admin/audit", headers=ha).json())
    sysr = c.get("/api/admin/system", headers=ha)
    assert sysr.status_code == 200 and "autoupdate" in sysr.json()
    assert c.get("/api/admin/system", headers=h).status_code == 403


def test_admin_ai_credentials_and_diagnose(monkeypatch):
    from app.core import llm
    r = c.post("/api/auth/login", json={"email": "admin@m3d.pro", "password": "admin-segredo-1"}).json()
    ha = {"Authorization": "Bearer " + r["token"]}
    h = auth()
    assert c.post("/api/admin/ai/credentials", json={"name": "groq", "key": "gsk_x"}, headers=h).status_code == 403
    # provedor conhecido + outra IA compatível com OpenAI
    s1 = c.post("/api/admin/ai/credentials", json={"name": "groq", "key": "gsk_secret_1234", "test": False}, headers=ha).json()
    g = next(p for p in s1["providers"] if p["name"] == "groq")
    assert g["configured"] and g["keySource"] == "painel" and g["keyHint"] == "••••1234"
    assert "gsk_secret" not in str(s1)  # chave nunca volta na resposta
    bad = c.post("/api/admin/ai/credentials", json={"name": "minha-ia", "key": "k", "url": "http://inseguro"}, headers=ha)
    assert bad.status_code == 422
    s2 = c.post("/api/admin/ai/credentials", json={"name": "minha-ia", "key": "k-abcdefgh9999", "label": "Minha IA",
                                                   "url": "https://api.exemplo.com/v1/chat/completions", "model": "m1", "free": True, "test": False}, headers=ha).json()
    assert any(p["name"] == "minha-ia" and p["custom"] and p["model"] == "m1" for p in s2["providers"])

    async def fake(p, client, system, user, mt, key=None):
        if p.name == "groq":
            return "ok"
        import httpx
        raise httpx.HTTPStatusError("x", request=httpx.Request("POST", "https://x"), response=httpx.Response(401))

    async def fake_tr(texts, target, source="pt"):
        return {t: t for t in texts}

    monkeypatch.setattr(llm, "_call", fake)
    monkeypatch.setattr(llm, "free_translate", fake_tr)
    d = c.post("/api/admin/ai/diagnose", headers=ha).json()
    res = {x["name"]: x for x in d["results"]}
    assert res["groq"]["ok"] and res["minha-ia"]["state"] == "erro" and "chave inválida" in res["minha-ia"]["detail"]
    assert res["offline"]["ok"] and res["mymemory"]["ok"] and d["working"] >= 1
    one = c.post("/api/admin/ai/diagnose", json={"names": ["groq"]}, headers=ha).json()
    assert [x["name"] for x in one["results"]] == ["groq"] and one["results"][0]["ok"]
    assert c.delete("/api/admin/ai/credentials/minha-ia", headers=ha).status_code == 200
    assert not any(p["name"] == "minha-ia" for p in c.get("/api/admin/ai", headers=ha).json()["providers"])


def test_guest_login():
    r = c.post("/api/auth/guest").json()
    hg = {"Authorization": "Bearer " + r["token"]}
    assert r["user"]["role"] == "guest" and r["user"]["guest"]
    comp = c.post("/api/compositions", json={"title": "Rascunho"}, headers=hg)
    assert comp.status_code == 200
    assert c.post(f"/api/compositions/{comp.json()['id']}/publish", json={"visibility": "public"}, headers=hg).status_code == 403


def test_upload_and_storage_health(tmp_path, monkeypatch):
    h = auth()
    hc = c.get("/api/health").json()
    assert "storage" in hc
    wav = b"RIFF" + b"\0" * 40
    ok = c.post("/api/assets", data={"kind": "audio"}, files={"file": ("Raiz_da_Equação.wav", wav, "audio/wav")}, headers=h)
    assert ok.status_code == 200 and ok.json()["path"].endswith(".wav")
    # sem permissão para gravar: erro claro (507) em vez de "Internal Server Error"
    from pathlib import Path
    def boom(*a, **k):
        raise PermissionError("negado")
    monkeypatch.setattr(Path, "write_bytes", boom)
    bad = c.post("/api/assets", data={"kind": "audio"}, files={"file": ("a.wav", wav, "audio/wav")}, headers=h)
    assert bad.status_code == 507 and "salvar o arquivo" in bad.json()["detail"]


def test_cancel_job():
    h = auth()
    j = c.post("/api/jobs", json={"type": "export", "payload": {"score": {"title": "x", "layers": []}, "formats": ["mid"]}}, headers=h).json()
    r = c.delete(f"/api/jobs/{j['id']}", headers=h).json()
    assert r["status"] == "cancelled"
    assert c.get(f"/api/jobs/{j['id']}", headers=h).json()["status"] == "cancelled"
    assert not any(j["id"] in x for x in media._r.lrange("harmonia:jobs", 0, -1))
