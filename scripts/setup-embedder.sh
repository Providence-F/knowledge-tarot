#!/usr/bin/env bash
# scripts/setup-embedder.sh — install Python embedder deps on the production server
#
# Usage on Tencent Cloud Lighthouse Ubuntu 22.04:
#   cd /opt/knowledge-tarot
#   bash scripts/setup-embedder.sh
#
# Idempotent. Safe to re-run.

set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "[setup-embedder] installing python3..."
  sudo apt-get update -y
  sudo apt-get install -y python3 python3-pip python3-venv
fi

# Use a venv inside the repo so we don't pollute system Python.
VENV_DIR=".venv-embedder"
if [ ! -d "$VENV_DIR" ]; then
  echo "[setup-embedder] creating venv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

pip install --upgrade pip
pip install fastembed

# Pre-warm model into HF cache (bge-small-zh-v1.5)
python - <<'PY'
from fastembed import TextEmbedding
m = TextEmbedding("BAAI/bge-small-zh-v1.5")
v = list(m.embed(["test"]))[0]
print(f"[setup-embedder] model OK, dim={len(list(v))}")
PY

echo "[setup-embedder] done. embedder.js will auto-detect $VENV_DIR/bin/python3."
echo "[setup-embedder] next steps: pm2 restart knowledge-tarot && pm2 logs --lines 20"
echo "[setup-embedder] override with KT_PYTHON=/path/to/python if needed."
