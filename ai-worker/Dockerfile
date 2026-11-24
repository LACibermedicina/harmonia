FROM python:3.11-slim
# ML=0 → modo leve (~700 MB): exportação MIDI/MusicXML/PDF/WAV/MP3, sem transcrição por IA
# ML=1 → IA completa (~6 GB): + Demucs, Basic Pitch, pYIN, Whisper, OMR (requer ≥ 8 GB RAM)
ARG ML=0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HARMONIA_ML=${ML}
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fluidsynth fluid-soundfont-gm libcairo2 \
      $( [ "$ML" = "1" ] && echo "libsndfile1 libgl1 libglib2.0-0" ) \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 10001 worker
WORKDIR /app
COPY requirements-core.txt requirements-lite.txt requirements-ml.txt ./
RUN pip install -r requirements-core.txt -r requirements-lite.txt \
 && if [ "$ML" = "1" ]; then \
      pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
      pip install -r requirements-ml.txt ; \
    fi
COPY . .
RUN pip install --no-deps .
USER worker
CMD ["python", "-m", "harmonia_ai.worker"]
