#!/usr/bin/env bash
# Download a STUC recording + supporting files from Google Drive.
#
# Usage: ./download.sh <course-id>
#   e.g. ./download.sh aip-diet-inflammation
#
# Prerequisites:
#   - gcloud auth application-default login (for Google Drive API)
#   - jq installed
#
# Downloads to: ./downloads/<course-id>/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$SCRIPT_DIR/manifest.json"
DOWNLOAD_BASE="$SCRIPT_DIR/downloads"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <course-id>"
  echo ""
  echo "Available courses:"
  jq -r '.courses[] | "  \(.courseId) [\(.status)]"' "$MANIFEST"
  exit 1
fi

COURSE_ID="$1"

# Extract course data from manifest
COURSE=$(jq -r --arg id "$COURSE_ID" '.courses[] | select(.courseId == $id)' "$MANIFEST")
if [ -z "$COURSE" ] || [ "$COURSE" = "null" ]; then
  echo "Error: Course '$COURSE_ID' not found in manifest"
  exit 1
fi

STATUS=$(echo "$COURSE" | jq -r '.status')
if [ "$STATUS" = "blocked" ]; then
  REASON=$(echo "$COURSE" | jq -r '.blockedReason // "unknown"')
  echo "Error: Course '$COURSE_ID' is blocked: $REASON"
  exit 1
fi

TITLE=$(echo "$COURSE" | jq -r '.title')
RECORDING_ID=$(echo "$COURSE" | jq -r '.drive.recording // empty')
CHAT_ID=$(echo "$COURSE" | jq -r '.drive.chatTranscript // empty')
GEMINI_ID=$(echo "$COURSE" | jq -r '.drive.geminiNotes // empty')

DEST="$DOWNLOAD_BASE/$COURSE_ID"
mkdir -p "$DEST"

echo "=== Downloading: $TITLE ==="
echo "Destination: $DEST"
echo ""

# Get access token
TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "Error: No Google credentials. Run: gcloud auth application-default login"
  exit 1
fi

download_file() {
  local file_id="$1"
  local output_name="$2"
  local desc="$3"

  if [ -z "$file_id" ]; then
    echo "  Skipping $desc (no file ID)"
    return
  fi

  local output_path="$DEST/$output_name"
  if [ -f "$output_path" ]; then
    echo "  $desc: already exists, skipping"
    return
  fi

  echo "  Downloading $desc..."

  # First, get file metadata to determine type and name
  local meta
  meta=$(curl -sS -H "Authorization: Bearer $TOKEN" \
    "https://www.googleapis.com/drive/v3/files/$file_id?fields=name,mimeType,size")

  local mime=$(echo "$meta" | jq -r '.mimeType // "unknown"')
  local name=$(echo "$meta" | jq -r '.name // "unknown"')
  local size=$(echo "$meta" | jq -r '.size // "unknown"')

  echo "    Name: $name"
  echo "    Type: $mime"
  [ "$size" != "null" ] && [ "$size" != "unknown" ] && echo "    Size: $(numfmt --to=iec "$size" 2>/dev/null || echo "$size bytes")"

  if [[ "$mime" == application/vnd.google-apps.document ]]; then
    # Google Doc -- export as plain text
    curl -sS -H "Authorization: Bearer $TOKEN" \
      "https://www.googleapis.com/drive/v3/files/$file_id/export?mimeType=text/plain" \
      -o "$output_path"
  else
    # Regular file -- direct download
    curl -sS -L -H "Authorization: Bearer $TOKEN" \
      "https://www.googleapis.com/drive/v3/files/$file_id?alt=media" \
      -o "$output_path"
  fi

  if [ -f "$output_path" ] && [ -s "$output_path" ]; then
    echo "    Saved: $output_path"
  else
    echo "    Warning: download may have failed (empty file)"
  fi
}

# Download recording (MP4)
download_file "$RECORDING_ID" "recording.mp4" "Recording (MP4)"

# Download Gemini notes (Google Doc -> TXT)
download_file "$GEMINI_ID" "gemini-notes.txt" "Gemini AI Notes"

# Download chat transcript
download_file "$CHAT_ID" "chat-transcript.txt" "Chat Transcript"

echo ""
echo "=== Download complete ==="
echo ""
echo "Next steps:"
echo "  1. Import $DEST/recording.mp4 into Descript"
echo "  2. Run Underlord: 'Remove fillers, shorten silences, enhance audio, detect chapters'"
echo "  3. Trim meeting start/end chatter"
echo "  4. Review and export as MP4 + SRT transcript"
echo "  5. Save exports to $DEST/edited/"
echo "  6. Run: node scripts/stuc-pipeline/publish.mjs $COURSE_ID"
