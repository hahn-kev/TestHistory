#!/usr/bin/env bash
# Stop the Cloudflare tunnel and the TestHistory container started by
# serve-remote.sh. The image and the data volume are kept, so a later
# serve-remote.sh brings your data back.
set -uo pipefail

NAME="${NAME:-testhistory}"
PIDFILE="${TMPDIR:-/tmp}/testhistory-cf.pid"

if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
fi
# Fallback for the detached Windows cloudflared process.
taskkill //F //IM cloudflared.exe >/dev/null 2>&1 || true

podman rm -f "$NAME" >/dev/null 2>&1 || true

echo "✅ Stopped tunnel + container '$NAME' (image and data volume kept)."
