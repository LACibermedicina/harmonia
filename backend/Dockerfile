# build context: raiz do repositório (usa o núcleo leve do ai-worker para harmonização síncrona)
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN useradd -m -u 10001 api
WORKDIR /srv
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY ai-worker /tmp/ai-worker
RUN pip install --no-deps /tmp/ai-worker && rm -rf /tmp/ai-worker
COPY VERSION ./VERSION
COPY backend/app ./app
USER api
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --workers ${API_WORKERS:-2}"]
