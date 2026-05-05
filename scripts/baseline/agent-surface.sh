#!/usr/bin/env bash
# Agent-surface byte snapshot re-runner -- for fast regression diff after every fix.
# Usage: scripts/baseline/agent-surface.sh <output-dir>
# Writes one .body file per URL plus shas.txt with sha256 + size per URL.
set -euo pipefail

OUT="${1:-$HOME/iCode/.arise-baselines/$(date +%Y-%m-%d)/agent-surface}"
mkdir -p "$OUT"

URLS=(
  "https://rrmacademy.org/llms.txt"
  "https://rrmacademy.org/openapi"
  "https://rrmacademy.org/library/rss.xml"
  "https://rrmacademy.org/commentary/rss.xml"
  "https://rrmacademy.org/robots.txt"
  "https://rrmacademy.org/sitemap-index.xml"
)

: > "$OUT/shas.txt"
for u in "${URLS[@]}"; do
  name=$(echo "$u" | sed 's|https://rrmacademy.org/||;s|/|_|g;s|\.|_|g')
  curl -sSL "$u" -o "$OUT/$name.body"
  sha=$(shasum -a 256 "$OUT/$name.body" | awk '{print $1}')
  size=$(wc -c < "$OUT/$name.body" | tr -d ' ')
  echo "$u  sha256=$sha  size=$size" | tee -a "$OUT/shas.txt"
done
