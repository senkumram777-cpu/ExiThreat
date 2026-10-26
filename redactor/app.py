"""
AI redaction: finds names, places and organisations in a disclosure with GLiNER
(urchade/gliner_multi-v2.1, multilingual), for the API's redactionService to hide.

It only answers where entities are; the API does the replacing and adds them to what its own
patterns find, so the model can add redactions but never remove one. Reachable only on Fly's
private network (no public address), and it keeps nothing: no text is stored or logged.

POST /entities  {"text": "...", "labels": ["person", ...], "threshold": 0.45}
             -> {"entities": [{"start": 3, "end": 7, "label": "person", "score": 0.93}]}
GET  /health    -> {"ok": true}
"""

import re

from fastapi import FastAPI
from gliner import GLiNER
from pydantic import BaseModel, Field

MODEL = 'urchade/gliner_multi-v2.1'
# The model reads about 384 words at a time; longer posts go in pieces cut at sentence ends.
CHUNK_CHARS = 1200

model = GLiNER.from_pretrained(MODEL)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class Request(BaseModel):
    text: str = Field(max_length=6000)
    labels: list[str] = Field(min_length=1, max_length=20)
    threshold: float = Field(default=0.45, ge=0.1, le=0.95)


def chunks(text: str):
    """(offset, piece) pairs covering the text, each at most CHUNK_CHARS, cut after a sentence."""
    start = 0
    while start < len(text):
        end = min(len(text), start + CHUNK_CHARS)
        if end < len(text):
            cut = max((m.end() for m in re.finditer(r'[.!?\n]\s', text[start:end])), default=0)
            if cut > CHUNK_CHARS // 3:
                end = start + cut
        yield start, text[start:end]
        start = end


@app.get('/health')
def health():
    return {'ok': True}


@app.post('/entities')
def entities(req: Request):
    found = []
    for offset, piece in chunks(req.text):
        if not piece.strip():
            continue
        for e in model.predict_entities(piece, req.labels, threshold=req.threshold):
            found.append({
                'start': e['start'] + offset,
                'end': e['end'] + offset,
                'label': e['label'],
                'score': round(float(e['score']), 3),
            })
    return {'entities': found}
