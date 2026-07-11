#!/usr/bin/env bash
# Launch TestHistory locally under Podman and expose it via a Cloudflare quick
# tunnel (a public https://…trycloudflare.com URL, no account needed).
#
# Why this exists: rootless Podman on a Windows WSL machine doesn't forward
# published ports to the Windows host reliably, so we run the container with
# `--network host` (it binds directly on the podman VM) and point the tunnel at
# the VM's IP, which the Windows host *can* reach.
#
# Usage:
#   scripts/serve-remote.sh            # reuse existing image, open a tunnel
#   scripts/serve-remote.sh --build    # rebuild the image first
#   scripts/serve-remote.sh --no-tunnel # run locally only, print the VM URL
#
# Config via env: IMAGE, NAME, VOLUME, MACHINE, CLOUDFLARED, PORT.
set -euo pipefail

IMAGE="${IMAGE:-testhistory:latest}"
NAME="${NAME:-testhistory}"
VOLUME="${VOLUME:-testhistory-data}"
MACHINE="${MACHINE:-podman-machine-default}"
PORT="${PORT:-3000}"
PIDFILE="${TMPDIR:-/tmp}/testhistory-cf.pid"

# Find cloudflared: $CLOUDFLARED, then PATH, then a common install location.
CF="${CLOUDFLARED:-}"
[ -z "$CF" ] && CF="$(command -v cloudflared 2>/dev/null || true)"
[ -z "$CF" ] && [ -x /c/path-tools/cloudflared ] && CF=/c/path-tools/cloudflared

BUILD=0
TUNNEL=1
for a in "$@"; do
  case "$a" in
    --build) BUILD=1 ;;
    --no-tunnel) TUNNEL=0 ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

# 1. Ensure the podman machine is up.
if ! podman info >/dev/null 2>&1; then
  echo "→ Starting podman machine '$MACHINE'…"
  podman machine start "$MACHINE"
fi

# 2. Build the image if asked, or if it doesn't exist yet.
if [ "$BUILD" = 1 ] || ! podman image exists "$IMAGE"; then
  echo "→ Building $IMAGE…"
  podman build -t "$IMAGE" .
fi

# 3. (Re)create the container. --network host sidesteps the rootless port-mapper.
echo "→ Starting container '$NAME'…"
podman rm -f "$NAME" >/dev/null 2>&1 || true
podman run -d --name "$NAME" --network host -v "$VOLUME":/data "$IMAGE" >/dev/null

# 4. Discover the VM IP the Windows host can reach, and wait for health.
IP="$(podman machine ssh "$MACHINE" -- "ip -4 addr show eth0 | grep -o 'inet [0-9.]*' | cut -d' ' -f2" 2>/dev/null | tr -d '\r' | head -1)"
[ -z "$IP" ] && IP="127.0.0.1"
echo "→ Waiting for health at http://$IP:$PORT …"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://$IP:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || { echo "✗ server did not become healthy; check: podman logs $NAME" >&2; exit 1; }
echo "  healthy — local URL: http://$IP:$PORT"

# 5. Open the public tunnel (unless --no-tunnel).
if [ "$TUNNEL" = 0 ]; then
  echo
  echo "✅ Running locally. Open http://$IP:$PORT from this machine."
  echo "   Stop with: scripts/stop-remote.sh"
  exit 0
fi

[ -n "$CF" ] || { echo "✗ cloudflared not found. Set CLOUDFLARED=/path/to/cloudflared or use --no-tunnel." >&2; exit 1; }

LOG="$(mktemp)"
echo "→ Opening Cloudflare tunnel…"
nohup "$CF" tunnel --url "http://$IP:$PORT" --no-autoupdate >"$LOG" 2>&1 &
echo $! >"$PIDFILE"

URL=""
for _ in $(seq 1 30); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)"
  [ -n "$URL" ] && break
  sleep 1
done

echo
if [ -n "$URL" ]; then
  echo "✅ Public URL:  $URL"
  echo "   Local URL:   http://$IP:$PORT"
  echo "   Tunnel pid $(cat "$PIDFILE") · log $LOG"
  echo "   Stop everything with: scripts/stop-remote.sh"
else
  echo "⚠ Tunnel started but no URL appeared yet. Tail the log:"
  echo "   tail -f $LOG"
fi
