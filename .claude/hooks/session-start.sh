#!/bin/bash
# Installs the `gog` (gogcli) Google Workspace CLI and configures auth
# non-interactively from session secrets. Web sessions only; idempotent.
set -euo pipefail

# Only run inside Claude Code on the web (skip local sessions).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

GOG_VERSION="v0.19.0"
# go.mod still declares the legacy module path even though the repo moved to
# github.com/openclaw/gogcli, so `go install` must use the steipete path.
GOG_MODULE="github.com/steipete/gogcli/cmd/gog@${GOG_VERSION}"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "${BIN_DIR}"

# Ensure gog is on PATH for the agent's shells this session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${BIN_DIR}:\$PATH\"" >> "${CLAUDE_ENV_FILE}"
fi
export PATH="${BIN_DIR}:${PATH}"

# Install gog (skip if the correct version is already cached in the container).
if ! gog --version 2>/dev/null | grep -q "${GOG_VERSION}"; then
  if command -v go >/dev/null 2>&1; then
    echo "Installing gog ${GOG_VERSION}..."
    GOBIN="${BIN_DIR}" go install "${GOG_MODULE}"
  else
    echo "WARN: go toolchain not found; cannot build gog" >&2
    exit 0
  fi
fi

# --- Auth (non-interactive, only if secrets are present) ---
# Storing tokens in the file keyring requires GOG_KEYRING_PASSWORD in the env.
if [ -z "${GOG_KEYRING_PASSWORD:-}" ]; then
  echo "INFO: GOG_KEYRING_PASSWORD not set; skipping gog auth setup (binary installed, unauthenticated)." >&2
  exit 0
fi

# OAuth client credentials JSON (contents of a Google Cloud OAuth client file).
if [ -n "${GOG_OAUTH_CREDENTIALS:-}" ]; then
  cred_file="$(mktemp)"
  printf '%s' "${GOG_OAUTH_CREDENTIALS}" > "${cred_file}"
  gog auth credentials set "${cred_file}" >/dev/null 2>&1 \
    || echo "WARN: gog auth credentials set failed" >&2
  rm -f "${cred_file}"
fi

# Import a stored refresh token for the account.
if [ -n "${GOG_REFRESH_TOKEN:-}" ] && [ -n "${GOG_ACCOUNT_EMAIL:-}" ]; then
  gog auth import --email="${GOG_ACCOUNT_EMAIL}" --refresh-token-env=GOG_REFRESH_TOKEN >/dev/null 2>&1 \
    && echo "gog authenticated as ${GOG_ACCOUNT_EMAIL}" \
    || echo "WARN: gog auth import failed for ${GOG_ACCOUNT_EMAIL}" >&2
fi
