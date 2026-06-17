#!/usr/bin/env python3
"""
scripts/embedder_worker.py — resident embedding worker for knowledge-tarot.

Protocol (line-based JSON over stdin/stdout):
  IN  (stdin, one line):  {"id": "<corr-id>", "text": "<utf-8 text>"}
  OUT (stdout, one line): {"id": "<corr-id>", "vec": [f, f, ...]}            # 512 dims
                       or {"id": "<corr-id>", "error": "<message>"}

Special:
  IN  {"op": "ping"}                  → OUT {"ok": true, "dim": 512}
  IN  {"op": "exit"}                  → process exits 0

stderr is for human logs only (never used by Node parser).

Model: BAAI/bge-small-zh-v1.5 (512-dim).
Cache locations:
  - Windows dev:  E:/python_libs (fastembed), E:/hf_cache (HF model files)
  - Linux server: defaults (pip-installed fastembed, ~/.cache/huggingface)
"""

import sys
import os
import json
import io
from pathlib import Path

# Force UTF-8 on Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", write_through=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", write_through=True)
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")

# Allow Windows dev to point at preinstalled fastembed
WIN_LIB_DIR = "E:/python_libs"
if os.name == "nt" and Path(WIN_LIB_DIR).exists() and WIN_LIB_DIR not in sys.path:
    sys.path.insert(0, WIN_LIB_DIR)

# Match Obsidian vault_search.py cache dir on Windows (so we share downloaded model files)
WIN_HF_CACHE = "E:/hf_cache"
if os.name == "nt" and Path(WIN_HF_CACHE).exists():
    os.environ.setdefault("HF_HOME", WIN_HF_CACHE)
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
EXPECTED_DIM = 512


def log(msg):
    print(f"[embedder] {msg}", file=sys.stderr, flush=True)


def write_out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_model():
    log("loading fastembed model: " + MODEL_NAME)
    from fastembed import TextEmbedding
    cache_dir = WIN_HF_CACHE if (os.name == "nt" and Path(WIN_HF_CACHE).exists()) else None
    if cache_dir:
        model = TextEmbedding(MODEL_NAME, cache_dir=cache_dir)
    else:
        model = TextEmbedding(MODEL_NAME)
    log("model loaded")
    return model


def embed_one(model, text):
    text = text or ""
    if not text.strip():
        # zero vector for empty input — caller can still cosine-distance it (returns 0)
        return [0.0] * EXPECTED_DIM
    vecs = list(model.embed([text]))
    if not vecs:
        raise RuntimeError("fastembed returned no vector")
    v = vecs[0]
    out = [round(float(x), 6) for x in v]
    if len(out) != EXPECTED_DIM:
        raise RuntimeError(f"unexpected dim {len(out)}, want {EXPECTED_DIM}")
    return out


def main():
    try:
        model = load_model()
    except Exception as e:
        log(f"FATAL: model load failed: {e}")
        write_out({"id": "_boot", "error": f"model_load_failed: {e}"})
        sys.exit(2)

    write_out({"id": "_ready", "ok": True, "dim": EXPECTED_DIM})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            write_out({"id": None, "error": f"bad_json: {e}"})
            continue

        if req.get("op") == "exit":
            log("exit requested")
            return
        if req.get("op") == "ping":
            write_out({"id": req.get("id", "_ping"), "ok": True, "dim": EXPECTED_DIM})
            continue

        rid = req.get("id")
        text = req.get("text", "")
        try:
            vec = embed_one(model, text)
            write_out({"id": rid, "vec": vec})
        except Exception as e:
            log(f"embed failed for id={rid}: {e}")
            write_out({"id": rid, "error": str(e)})


if __name__ == "__main__":
    main()
