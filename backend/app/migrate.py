"""Cria/atualiza o schema e o administrador inicial. (Alembic entra na v0.2.0 com migrações versionadas.)"""
from datetime import datetime, timezone

from sqlalchemy import select

from .core.config import settings
from .core.db import Base, SessionLocal, engine
from .core.security import email_index, encrypt, hash_password
from .models import User


def main():
    Base.metadata.create_all(engine)
    s = settings()
    if s.admin_email and s.admin_password:
        with SessionLocal() as db:
            if not db.scalar(select(User).where(User.email_idx == email_index(s.admin_email))):
                db.add(User(email_idx=email_index(s.admin_email), email_enc=encrypt(s.admin_email.lower()),
                            name_enc=encrypt("Administrador"), password_hash=hash_password(s.admin_password),
                            role="admin", consent_at=datetime.now(timezone.utc), consent_version="admin", workspace={}))
                db.commit()
                print("[migrate] admin criado")
    print("[migrate] schema ok")


if __name__ == "__main__":
    main()
