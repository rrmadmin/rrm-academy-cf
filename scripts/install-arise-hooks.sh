#!/bin/bash
# Installs the /arise hotspot guard as a pre-commit hook.
# Run from repo root: bash scripts/install-arise-hooks.sh
# Opt-in. Safe to run repeatedly.

set -e

HOOK=".git/hooks/pre-commit"
GUARD="scripts/arise-hotspot-guard.mjs"

if [ ! -f "$GUARD" ]; then
  echo "Missing $GUARD — run from repo root."
  exit 1
fi

mkdir -p .git/hooks

# Preserve existing hook by chaining if it exists and isn't ours already
if [ -f "$HOOK" ] && ! grep -q "arise-hotspot-guard" "$HOOK"; then
  mv "$HOOK" "${HOOK}.prearise"
  cat > "$HOOK" <<'EOF'
#!/bin/bash
set -e
# Chained: call the previous hook first, then the arise guard.
if [ -x .git/hooks/pre-commit.prearise ]; then
  .git/hooks/pre-commit.prearise || exit $?
fi
node scripts/arise-hotspot-guard.mjs
EOF
else
  cat > "$HOOK" <<'EOF'
#!/bin/bash
set -e
node scripts/arise-hotspot-guard.mjs
EOF
fi

chmod +x "$HOOK"
echo "Installed pre-commit hook: $HOOK"
echo "Run 'bash scripts/install-arise-hooks.sh' to reinstall after clone."
