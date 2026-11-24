# Ambiente de teste definido ANTES de qualquer import do app (settings() é cacheado).
import os
import sys
import tempfile

os.environ.setdefault("DATABASE_URL", "sqlite:///" + tempfile.mktemp(suffix=".db"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp())
os.environ.setdefault("ADMIN_EMAIL", "admin@m3d.pro")
os.environ.setdefault("ADMIN_PASSWORD", "admin-segredo-1")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ai-worker"))
