#!/usr/bin/env python3
"""Create CF Stream clips for a course based on its manifest."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

if len(sys.argv) != 2:
    print("Usage: clip-source.py <course-id>")
    sys.exit(1)

course_id = sys.argv[1]
base = Path(__file__).parent
manifest_path = base / "manifests" / f"{course_id}.json"
clip_dir = base / "clip-uids"
clip_dir.mkdir(exist_ok=True)
clip_path = clip_dir / f"{course_id}.json"

# Load manifest
manifest = json.loads(manifest_path.read_text())
source_uid = manifest["sourceUid"]

# Get credentials
def op_read(path):
    return subprocess.check_output(["op", "read", path]).decode().strip()

cf_token = op_read("op://Automation/Cloudflare Stream Token/credential")
cf_account = "ecf2c5bc8b5ebd634bcb587b3890910a"

# Load existing clip map if any (resume support)
existing = {}
if clip_path.exists():
    existing = json.loads(clip_path.read_text())

print(f"=== Creating clips for {course_id} ===")
print(f"Source: {source_uid}")
print(f"Lessons: {len(manifest['lessons'])}")
print()

clip_map = dict(existing)
for lesson in manifest["lessons"]:
    step_id = lesson["stepId"]
    if step_id in clip_map:
        print(f"  [skip] {step_id} -> {clip_map[step_id]['clipUid']} (already exists)")
        continue

    name = f"{course_id}-{step_id}.mp4"
    payload = {
        "clippedFromVideoUID": source_uid,
        "startTimeSeconds": lesson["startTimeSeconds"],
        "endTimeSeconds": lesson["endTimeSeconds"],
        "meta": {"name": name},
    }

    r = subprocess.run(
        [
            "curl", "-sS", "-X", "POST",
            f"https://api.cloudflare.com/client/v4/accounts/{cf_account}/stream/clip",
            "-H", f"Authorization: Bearer {cf_token}",
            "-H", "Content-Type: application/json",
            "-d", json.dumps(payload),
        ],
        capture_output=True, text=True,
    )
    resp = json.loads(r.stdout)
    if not resp.get("success"):
        print(f"  FAIL {step_id}: {resp.get('errors')}")
        sys.exit(1)

    clip_uid = resp["result"]["uid"]
    clip_map[step_id] = {
        "clipUid": clip_uid,
        "sourceUid": source_uid,
        "startTimeSeconds": lesson["startTimeSeconds"],
        "endTimeSeconds": lesson["endTimeSeconds"],
        "durationSeconds": lesson["endTimeSeconds"] - lesson["startTimeSeconds"],
        "title": lesson["title"],
        "sectionId": lesson["sectionId"],
        "order": lesson["order"],
        "name": name,
    }
    print(f"  {step_id}: {clip_uid}")

    # Save after each clip (resume safety)
    clip_path.write_text(json.dumps(clip_map, indent=2))

    # Small delay between rapid-fire requests
    time.sleep(0.5)

print(f"\nSaved {len(clip_map)} clip UIDs to {clip_path}")
