#!/usr/bin/env bash
# Debounced deploy trigger for the autonomous loop: call it after each round; it returns at once.
# Starts scripts/deploy-pages.sh in the background at most once per DEPLOY_MIN_INTERVAL seconds (default 600)
# and only when the build inputs changed since the last committed deploy (servedAt ignored).
#
# usage: scripts/deploy-if-changed.sh [--push]   (a push still needs ALLOW_PUBLIC_PUSH=1, checked by deploy-pages.sh)
# state: .deploy-last (epoch of last start), .deploy-digest (inputs of last successful run), .deploy.log
set -uo pipefail

SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL="${DEPLOY_MIN_INTERVAL:-600}"
cd "$SITE"

now="$(date +%s)"
last="$(cat .deploy-last 2>/dev/null || echo 0)"
if (( now - last < INTERVAL )); then
  echo "{\"deploy\":\"skipped\",\"reason\":\"debounce\",\"retryInSeconds\":$(( INTERVAL - (now - last) ))}"; exit 0
fi
if [[ -d .deploy.lock ]]; then echo '{"deploy":"skipped","reason":"running"}'; exit 0; fi

node --experimental-strip-types --no-warnings scripts/capture-snapshots.mjs >/dev/null 2>&1 || true
digest="$(node scripts/pages-util.mjs digest)"
if [[ "$digest" == "$(cat .deploy-digest 2>/dev/null)" ]]; then
  echo '{"deploy":"skipped","reason":"unchanged"}'; exit 0
fi

echo "$now" > .deploy-last
nohup bash -c '
  if bash scripts/deploy-pages.sh --no-capture "$@"; then echo "$0" > .deploy-digest; fi
' "$digest" "$@" >> .deploy.log 2>&1 &
echo "{\"deploy\":\"started\",\"pid\":$!,\"log\":\".deploy.log\"}"
