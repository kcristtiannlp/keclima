#!/usr/bin/env bash
# Smoke test local: sobe serve.py, checa health e assets críticos.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8766}"
HOST="127.0.0.1"
BASE="http://${HOST}:${PORT}"

cd "$ROOT"
python3 -m py_compile serve.py

python3 serve.py "$PORT" &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "$BASE/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo "== health =="
HEALTH=$(curl -sf "$BASE/api/health")
echo "$HEALTH"
echo "$HEALTH" | grep -q '"ok": true'
echo "$HEALTH" | grep -q '"version"'

for path in / /index.html /service-worker.js /manifest.json /src/main.js /src/config.js /tests/runner.html; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path")
  echo "GET $path -> $code"
  test "$code" = "200"
done

echo "OK smoke test (porta $PORT)"
