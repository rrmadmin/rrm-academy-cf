#!/usr/bin/env bash
# rrmadmin/rrm-tools/lint-cf-headers/lint.sh
# Detect CF Pages _headers footguns. Exit 0 clean, 1 violation, 2 usage error.
#
# Usage:
#   lint.sh <path-to-_headers>     -- lint a single file
#   lint.sh self-test              -- run all bundled fixtures
#
# Catches:
#   - Duplicate path BLOCKS for the same pattern (CF Pages drops headers from
#     earlier blocks; observed empirically on neofertility-ie 2026-05-05)
#   - Duplicate header NAMES within a single block (YAML 1.2 / industry-standard
#     "no-dupe-keys" enforcement; last-wins behavior is non-portable)
#
# Warns (does not fail):
#   - Missing _headers file (matches Vercel/ESLint/Super-Linter convention of
#     "config absent = platform defaults, surface as warning")
#
# Out of scope (see ~/iCode/docs/standards/cf-pages-headers-pattern.md §3.1)

set -uo pipefail   # NOT -e: handle no-match gracefully

usage() {
  echo "usage: $0 <path-to-_headers> | self-test" >&2
  exit 2
}

[ $# -eq 1 ] || usage

if [ "$1" = "self-test" ]; then
  DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
  [ -d "$DIR" ] || { echo "self-test FAIL: fixtures dir missing at $DIR"; exit 1; }
  fail=0
  for f in "$DIR"/valid-*.txt; do
    [ -f "$f" ] || continue
    if ! "$0" "$f" >/dev/null 2>&1; then
      echo "FAIL valid: $f (lint flagged a clean fixture)"
      fail=1
    fi
  done
  for f in "$DIR"/invalid-*.txt; do
    [ -f "$f" ] || continue
    if "$0" "$f" >/dev/null 2>&1; then
      echo "FAIL invalid: $f (lint did NOT flag a known-bad fixture)"
      fail=1
    fi
  done
  if [ $fail -eq 0 ]; then
    echo "self-test OK"
    exit 0
  else
    exit 1
  fi
fi

HEADERS="$1"

# Q1 (per Perplexity industry consensus): warn on absence, do not fail.
# Matches Vercel/ESLint/GitHub-Super-Linter behavior of "config absent =
# platform defaults, surface as warning". Devs who intentionally don't need
# _headers can suppress by creating an empty file with a comment.
[ -f "$HEADERS" ] || {
  echo "::warning::no $HEADERS -- site will ship with no security/indexing headers (CF Pages defaults only)"
  exit 0
}

# Normalize: strip CR (Windows line endings), trim trailing whitespace.
# This closes the v1 bypass paths (CRLF + trailing-space evasion of sort/uniq).
DUPES=$(grep -E "^/" "$HEADERS" | tr -d '\r' | sed 's/[[:space:]]*$//' | sort | uniq -d || true)

if [ -n "$DUPES" ]; then
  echo "::error file=$HEADERS::Duplicate path patterns. CF Pages drops headers from earlier blocks for same-pattern duplicates. Consolidate into ONE block per path."
  # Find every occurrence of each duplicated pattern. Use awk for fixed-string
  # comparison so regex metacharacters in the pattern (`/*`, `/api/*`, etc.)
  # don't cause false matches against other lines.
  echo "$DUPES" | while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    awk -v p="$pat" -v f="$HEADERS" '
      /^\// {
        line = $0
        gsub(/\r$/, "", line)
        gsub(/[[:space:]]+$/, "", line)
        if (line == p) printf("  %s:%d: %s\n", f, NR, p)
      }
    ' "$HEADERS"
  done
  echo "See ~/iCode/docs/standards/cf-pages-headers-pattern.md"
  exit 1
fi

# Q2 (per Perplexity industry consensus): error on within-block duplicate
# header NAMES. yamllint, hadolint, ESLint no-dupe-keys, nginx-lint, stylelint,
# dotenv-linter all error on this -- last-wins parser behavior is non-portable.
#
# Exception: HTTP headers that are EXPLICITLY designed to repeat per their RFC
# are whitelisted. "Link" (RFC 8288), "Set-Cookie" (RFC 6265), "Vary" (RFC 7231),
# "Content-Security-Policy-Report-Only" / "Content-Security-Policy" (CSP allows
# multiple report directives), and "Cache-Control" (RFC 7234, directives may
# be split across headers) are all legitimately repeatable. Without this list,
# the lint produces false positives on RFC-conformant agent-discovery configs
# (e.g., rrm-academy-cf's homepage Link headers).
INTRA=$(awk '
  function reset_block() {
    block = ""
    for (k in seen) delete seen[k]
  }
  BEGIN {
    reset_block()
    # Headers explicitly designed to repeat per RFC. Lowercased for case-insensitive match.
    repeatable["link"]                                = 1   # RFC 8288
    repeatable["set-cookie"]                          = 1   # RFC 6265
    repeatable["vary"]                                = 1   # RFC 7231 (technically combinable but commonly split)
    repeatable["cache-control"]                       = 1   # RFC 7234 (directives can split)
    repeatable["content-security-policy"]             = 1   # CSP3 allows multiple
    repeatable["content-security-policy-report-only"] = 1
    repeatable["www-authenticate"]                    = 1   # RFC 7235
    repeatable["proxy-authenticate"]                  = 1
    repeatable["accept-ch"]                           = 1   # Client Hints
    repeatable["forwarded"]                           = 1   # RFC 7239
  }
  /^\// { block = $0; for (k in seen) delete seen[k]; next }
  /^[[:space:]]*$/ { reset_block(); next }
  block && /^[[:space:]]+[A-Za-z]/ {
    name = $1
    sub(/:.*$/, "", name)
    sub(/^[[:space:]]+/, "", name)
    name_lc = tolower(name)
    if (name_lc in repeatable) next
    if (name_lc in seen) {
      printf("%s:%d: block %s has duplicate header name %s (also at line %d)\n",
        FILENAME, NR, block, name_lc, seen[name_lc])
    } else {
      seen[name_lc] = NR
    }
  }
' "$HEADERS")

if [ -n "$INTRA" ]; then
  echo "::error file=$HEADERS::Duplicate header NAME within a block. CF Pages parser behavior is undocumented for this case (likely last-wins or concatenation that downstream consumers parse inconsistently). Each header name must appear at most once per block."
  echo "$INTRA" | sed 's/^/  /'
  echo "See ~/iCode/docs/standards/cf-pages-headers-pattern.md"
  exit 1
fi

echo "OK: no duplicate path blocks or duplicate header names in $HEADERS"
exit 0
