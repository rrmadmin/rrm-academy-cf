#!/usr/bin/env python3
"""Wire course D1 structure: delete old steps/sections, create new from manifest+clips."""
import json
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 3:
    print("Usage: wire-d1.py <course-id> <session-cookie>")
    sys.exit(1)

course_id = sys.argv[1]
session = sys.argv[2]
base = Path(__file__).parent
manifest = json.loads((base / "manifests" / f"{course_id}.json").read_text())
clips = json.loads((base / "clip-uids" / f"{course_id}.json").read_text())

API = "https://rrmacademy.org/api/admin/courses"

def call(method, url, body=None):
    cmd = ["curl", "-sS", "-X", method, "-b", f"session={session}", url]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout else {}

# 1. Get current course state
print(f"=== Wiring D1 for {course_id} ===")
current = call("GET", f"{API}/{course_id}")
sections = current.get("data", {}).get("sections", [])
print(f"Current state: {len(sections)} sections")

# 2. Delete all existing steps then sections
for section in sections:
    for step in section.get("steps", []):
        step_id = step["id"]
        r = call("DELETE", f"{API}/{course_id}/steps/{step_id}")
        if r.get("ok"):
            print(f"  deleted step: {step_id}")
        else:
            print(f"  FAIL delete step {step_id}: {r}")
            sys.exit(1)
    section_id = section["id"]
    r = call("DELETE", f"{API}/{course_id}/sections/{section_id}")
    if r.get("ok"):
        print(f"  deleted section: {section_id}")
    else:
        print(f"  FAIL delete section {section_id}: {r}")
        sys.exit(1)

# 3. Create new sections + steps from manifest
print(f"\nCreating {len(manifest['lessons'])} new lessons...")
for lesson in manifest["lessons"]:
    section_id = lesson["sectionId"]
    step_id = lesson["stepId"]
    title = lesson["title"]
    duration = lesson["durationSeconds"]

    if step_id not in clips:
        print(f"  FAIL: no clip for {step_id}")
        sys.exit(1)
    clip_uid = clips[step_id]["clipUid"]

    # Create section
    r = call("POST", f"{API}/{course_id}/sections", {
        "id": section_id,
        "title": title,
    })
    if not r.get("ok"):
        print(f"  FAIL create section {section_id}: {r}")
        sys.exit(1)
    print(f"  section: {section_id}")

    # Create video step
    r = call("POST", f"{API}/{course_id}/steps", {
        "id": step_id,
        "sectionId": section_id,
        "title": title,
        "type": "video",
        "streamUid": clip_uid,
        "duration": duration,
    })
    if not r.get("ok"):
        print(f"  FAIL create step {step_id}: {r}")
        sys.exit(1)
    print(f"  step: {step_id} -> {clip_uid[:12]}... ({duration}s)")

print(f"\n{course_id} D1 wired successfully")
