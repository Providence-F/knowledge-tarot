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

echo "[setup-embedder] done. To use: PATH=\"$(pwd)/$VENV_DIR/bin:\$PATH\" pm2 restart kt"
echo "[setup-embedder] (or set PYTHON_BIN in src/embedder.js if needed)"
