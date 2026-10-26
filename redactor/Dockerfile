FROM python:3.11-slim

# PyTorch for CPU only (the GPU build is several GB larger and of no use here).
RUN pip install --no-cache-dir torch==2.3.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir gliner==0.2.13 "transformers<4.46" fastapi==0.111.0 uvicorn==0.30.1

# The model is part of the image, so a machine that wakes up does not download it again.
ENV HF_HOME=/hf
RUN python -c "from gliner import GLiNER; GLiNER.from_pretrained('urchade/gliner_multi-v2.1')"
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=2

WORKDIR /app
COPY app.py .
EXPOSE 8080
# No access log: the request bodies are disclosures.
CMD ["uvicorn", "app:app", "--host", "::", "--port", "8080", "--no-access-log"]
