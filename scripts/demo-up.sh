#!/usr/bin/env bash
# One-command fresh demo setup. Idempotent — run it any time, including after
# a laptop restart or a dead tunnel. Ends with preflight and the three human
# steps. Skip the phone leg with: pnpm demo:live --no-phone
set -u
cd "$(dirname "$0")/.."
NO_PHONE=${1:-}

say() { printf "\033[1m%s\033[0m\n" "$*"; }

say "1/6 Medplum (Docker)"
if ! curl -s -m 2 http://localhost:8103/healthcheck > /dev/null 2>&1; then
  (cd selfhost && docker compose up -d > /dev/null 2>&1)
  until curl -s -m 2 http://localhost:8103/healthcheck > /dev/null 2>&1; do sleep 2; printf "."; done; echo
fi
echo "   ok — api :8103, admin app :3000"

HAS_PHONE=false
if [ "$NO_PHONE" != "--no-phone" ] && grep -q '^VAPI_PRIVATE_KEY=.\+' .env.local 2>/dev/null; then
  HAS_PHONE=true
  say "2/6 Public tunnel (phone leg)"
  pkill -f "cloudflared tunnel" 2>/dev/null; sleep 1
  nohup cloudflared tunnel --url http://localhost:3200 > /tmp/before-tunnel.log 2>&1 &
  TUNNEL=""
  for _ in $(seq 1 20); do
    TUNNEL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/before-tunnel.log | head -1)
    [ -n "$TUNNEL" ] && break
    sleep 2
  done
  if [ -n "$TUNNEL" ]; then
    python3 - "$TUNNEL" <<'PY'
import re, sys
url = sys.argv[1]
p = ".env.local"
s = open(p).read()
s = re.sub(r"^PUBLIC_BASE_URL=.*$", f"PUBLIC_BASE_URL={url}", s, flags=re.M)
open(p, "w").write(s)
PY
    echo "   ok — $TUNNEL"
  else
    echo "   !! tunnel did not come up — phone leg disabled this run (see /tmp/before-tunnel.log)"
    HAS_PHONE=false
  fi
else
  say "2/6 Public tunnel — skipped (no VAPI key or --no-phone)"
fi

say "3/6 App server (restarting so it reads the fresh env)"
pkill -f "next dev" 2>/dev/null; sleep 1
nohup corepack pnpm dev > /tmp/before-dev.log 2>&1 &
until curl -s -m 2 -o /dev/null http://localhost:3200/api/preflight 2>/dev/null; do sleep 1; printf "."; done; echo
echo "   ok — :3200"

say "4/6 Seed + reset to the before-state"
corepack pnpm -s seed > /dev/null 2>&1
curl -s -X POST http://localhost:3200/api/reset > /dev/null
echo "   ok — 06:00 relayed baseline · 09:10 reported onset"

if [ "$HAS_PHONE" = true ]; then
  say "5/6 Vapi assistants + inbound line"
  corepack pnpm -s vapi:assistant > /dev/null 2>&1 && corepack pnpm -s vapi:inbound > /dev/null 2>&1 \
    && echo "   ok — configured Vapi inbound line answers as Luis's assistant" \
    || echo "   !! vapi setup failed — browser witness still works (see errors: corepack pnpm vapi:assistant)"
else
  say "5/6 Vapi — skipped; use the browser witness at /witness"
fi

say "6/6 Preflight"
curl -s http://localhost:3200/api/preflight | python3 -c "
import json, sys
for c in json.load(sys.stdin)['checks']:
    print(('   ✓ ' if c['ok'] else '   ✗ ') + c['label'])"

say ""
say "Machine ready. The human part:"
echo "   1. Projector: open http://localhost:3200/clinician"
echo "   2. Rail: Prepare interview → three gates (speak Maya's lines) → Begin AI interview"
echo "   3. Witness: use your configured Vapi inbound number, or open http://localhost:3200/witness with a headset"
echo "   Optional sanity check first: http://localhost:3200/test → Run all checks"
