#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# One-shot Railway deploy script for the EJJS app server.
#
# What this does FOR you (zero clicking):
#   1. Installs the Railway CLI if missing
#   2. Logs into Railway (browser opens once — you click "Authorize")
#   3. Creates a new Railway project named "ejjs-server"
#   4. Uploads & deploys the code in this directory
#   5. Generates a public HTTPS domain
#   6. Prints the deployed URL so you can paste it into mobile/eas.json
#
# What you still have to do (Railway requires a human for these):
#   • Click "Authorize" when the browser opens for `railway login`
#   • Paste the URL it prints into mobile/eas.json (the script offers to do
#     this automatically too)
#
# Re-run anytime — it's idempotent. After the first deploy, simply running
# `railway up` from this directory pushes a new version.
# ----------------------------------------------------------------------------

set -e

cd "$(dirname "$0")"

echo "==> EJJS Railway deploy"
echo

# 1. Pick how to run Railway CLI ---------------------------------------------
# Prefer a real install if present; otherwise fall back to `npx` so we never
# need sudo. RAILWAY is the command we call throughout the rest of the script.
if command -v railway >/dev/null 2>&1; then
  RAILWAY="railway"
  echo "[1/6] Railway CLI already installed ✓"
elif command -v brew >/dev/null 2>&1; then
  echo "[1/6] Installing Railway CLI via Homebrew…"
  brew install railway
  RAILWAY="railway"
else
  echo "[1/6] Using npx to run Railway CLI (no global install needed) ✓"
  RAILWAY="npx -y @railway/cli@latest"
fi

# 2. Login --------------------------------------------------------------------
if ! $RAILWAY whoami >/dev/null 2>&1; then
  echo "[2/6] Logging into Railway — your browser will open. Click Authorize."
  $RAILWAY login
else
  echo "[2/6] Already logged in as $($RAILWAY whoami) ✓"
fi

# 3. Init project if no link --------------------------------------------------
if [ ! -f ".railway/config.json" ] && ! $RAILWAY status >/dev/null 2>&1; then
  echo "[3/6] Creating new Railway project 'ejjs-server'…"
  $RAILWAY init --name ejjs-server
else
  echo "[3/6] Railway project already linked ✓"
fi

# 4. Set env vars (only the ones the server needs at boot) --------------------
echo "[4/6] Setting environment variables…"
# Yahoo callback must match the URL Railway assigns. We set a placeholder
# now and update it after the domain is generated.
$RAILWAY variables --set "NODE_ENV=production" >/dev/null || true

# 5. Deploy -------------------------------------------------------------------
echo "[5/6] Uploading code & building (this takes ~60s)…"
$RAILWAY up --detach

# 6. Generate domain ----------------------------------------------------------
echo "[6/6] Generating public domain…"
$RAILWAY domain >/dev/null 2>&1 || true

DOMAIN=$($RAILWAY domain 2>/dev/null | grep -oE 'https://[^ ]+' | head -1)
if [ -z "$DOMAIN" ]; then
  # Fallback: parse from `railway status`
  DOMAIN=$($RAILWAY status --json 2>/dev/null | grep -oE 'https://[^"]+\.up\.railway\.app' | head -1)
fi

# Update the Yahoo callback so OAuth actually works in production
if [ -n "$DOMAIN" ]; then
  $RAILWAY variables --set "YAHOO_REDIRECT_URI=${DOMAIN}/yahoo/callback" >/dev/null || true
fi

echo
echo "============================================================"
echo "  Deployed!"
echo "  URL:  ${DOMAIN:-<run 'railway domain' to see it>}"
echo "============================================================"
echo

# Offer to patch mobile/eas.json automatically
EAS_FILE="../mobile/eas.json"
if [ -n "$DOMAIN" ] && [ -f "$EAS_FILE" ]; then
  echo "Patch mobile/eas.json to point at this URL? [y/N]"
  read -r REPLY
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    # Replace both the placeholder and any existing railway URL
    sed -i.bak \
      -e "s|https://REPLACE-WITH-YOUR-RAILWAY-URL\.up\.railway\.app|${DOMAIN}|g" \
      -e "s|https://[a-z0-9-]*\.up\.railway\.app|${DOMAIN}|g" \
      "$EAS_FILE"
    rm -f "${EAS_FILE}.bak"
    echo "✓ Patched ${EAS_FILE}"
  fi
fi

echo
echo "Next steps:"
echo "  1. (Once) Add YAHOO_CLIENT_ID + YAHOO_CLIENT_SECRET in Railway dashboard"
echo "     → https://railway.app → ejjs-server → Variables"
echo "  2. Update your Yahoo app's redirect URI to: ${DOMAIN}/yahoo/callback"
echo "  3. Build the mobile app:  cd ../mobile && eas build -p ios --profile preview"
echo
