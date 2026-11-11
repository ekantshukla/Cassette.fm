#!/usr/bin/env bash
# Cassette AI on Cloudflare: deploys worker/song-bot.js (with its secrets) and prints the worker's address.
#   bash scripts/song-bot.sh            deploy + print the address   (used by "Deploy to GitHub Pages")
#   bash scripts/song-bot.sh --url-only only print the address       (used by "Build Android app")
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Optional: ANTHROPIC_API_KEY, YOUTUBE_API_KEY, ALLOWED_ORIGINS.
set -euo pipefail
NAME=cassette-song-bot
WRANGLER="npx --yes wrangler@4.20.0"

if [ "${1:-}" != "--url-only" ]; then
  $WRANGLER deploy worker/song-bot.js --name "$NAME" --compatibility-date 2025-06-01 \
    --var "ALLOWED_ORIGINS:${ALLOWED_ORIGINS:-}" >&2
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then printf '%s' "$ANTHROPIC_API_KEY" | $WRANGLER secret put ANTHROPIC_API_KEY --name "$NAME" >&2; fi
  if [ -n "${YOUTUBE_API_KEY:-}" ]; then printf '%s' "$YOUTUBE_API_KEY" | $WRANGLER secret put YOUTUBE_API_KEY --name "$NAME" >&2; fi
fi

# The account's workers.dev name (chosen once, the first time you open Workers in the Cloudflare dashboard).
SUB=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;process.stdout.write(r&&r.subdomain||"")})')
if [ -z "$SUB" ]; then
  echo "No workers.dev name yet: open Cloudflare dashboard -> Workers & Pages once to choose it." >&2
  exit 1
fi
echo "https://$NAME.$SUB.workers.dev"
