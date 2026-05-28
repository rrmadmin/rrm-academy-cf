#!/usr/bin/env python3
"""Wire course D1 structure: create/update sections+steps from manifest+clips, then prune stale ones. Idempotent and safe to re-run."""
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
    if r.returncode != 0:
        print(f"FATAL: curl {method} {url} exited {r.returncode}: {r.stderr.strip()}")
        sys.exit(1)
    try:
        data = json.loads(r.stdout) if r.stdout.strip() else {}
    except (json.JSONDecodeError, ValueError):
        print(f"FATAL: non-JSON response from {method} {url} "
              f"(auth/HTML error?): {r.stdout[:200]!r}")
        sys.exit(1)
    return data

def already_exists(resp):
    err = resp.get("error", "")
    return isinstance(err, str) and err.endswith("_already_exists")

# 1. Get + validate current course state (M5: trust only ok:true responses)
print(f"=== Wiring D1 for {course_id} ===")
current = call("GET", f"{API}/{course_id}")
if not current.get("ok"):
    print(f"FATAL: GET {course_id} did not return ok:true: {current}")
    sys.exit(1)
sections = current.get("data", {}).get("sections", [])
print(f"Current state: {len(sections)} sections")

# 2. Pre-flight: every lesson must have a ready clip BEFORE any mutation (H1b)
for lesson in manifest["lessons"]:
    if lesson["stepId"] not in clips:
        print(f"FATAL: no clip for {lesson['stepId']} — aborting before any mutation.")
        sys.exit(1)

new_section_ids = {l["sectionId"] for l in manifest["lessons"]}
new_step_ids = {l["stepId"] for l in manifest["lessons"]}

# Map existing steps from the GET snapshot so we can detect content drift
# (same stepId, changed clip/duration after a retrim) and PUT-update in place.
existing_steps = {}
for section in sections:
    for step in section.get("steps", []):
        existing_steps[step["id"]] = step

# 3. Create new sections + steps FIRST (idempotent; 409 already_exists is tolerated).
#    Creating before deleting guarantees a failure never leaves the course with
#    fewer lessons than it started with.
print(f"\nCreating {len(manifest['lessons'])} new lessons...")
created_sections = set()
for lesson in manifest["lessons"]:
    section_id = lesson["sectionId"]
    step_id = lesson["stepId"]
    title = lesson["title"]
    duration = lesson["durationSeconds"]
    clip_uid = clips[step_id]["clipUid"]

    if section_id not in created_sections:
        r = call("POST", f"{API}/{course_id}/sections", {
            "id": section_id,
            "title": title,
        })
        if r.get("ok"):
            print(f"  section: {section_id}")
        elif already_exists(r):
            print(f"  section: {section_id} (already exists, reusing)")
        else:
            print(f"  FAIL create section {section_id}: {r}")
            sys.exit(1)
        created_sections.add(section_id)

    r = call("POST", f"{API}/{course_id}/steps", {
        "id": step_id,
        "sectionId": section_id,
        "title": title,
        "type": "video",
        "streamUid": clip_uid,
        "duration": duration,
    })
    if r.get("ok"):
        print(f"  step: {step_id} -> {clip_uid[:12]}... ({duration}s)")
    elif already_exists(r):
        prev = existing_steps.get(step_id, {})
        if prev.get("streamUid") != clip_uid or prev.get("duration") != duration or prev.get("title") != title:
            u = call("PUT", f"{API}/{course_id}/steps/{step_id}", {
                "title": title,
                "type": "video",
                "streamUid": clip_uid,
                "duration": duration,
            })
            if not u.get("ok"):
                print(f"  FAIL update step {step_id}: {u}")
                sys.exit(1)
            print(f"  step: {step_id} -> {clip_uid[:12]}... ({duration}s) (updated in place)")
        else:
            print(f"  step: {step_id} (already exists, unchanged)")
    else:
        print(f"  FAIL create step {step_id}: {r}")
        sys.exit(1)

# 4. ONLY NOW delete old steps/sections not present in the new manifest.
print("\nPruning stale steps/sections...")
for section in sections:
    for step in section.get("steps", []):
        step_id = step["id"]
        if step_id in new_step_ids:
            continue
        r = call("DELETE", f"{API}/{course_id}/steps/{step_id}")
        if r.get("ok"):
            print(f"  deleted step: {step_id}")
        else:
            print(f"  FAIL delete step {step_id}: {r}")
            sys.exit(1)
    section_id = section["id"]
    if section_id in new_section_ids:
        continue
    r = call("DELETE", f"{API}/{course_id}/sections/{section_id}")
    if r.get("ok"):
        print(f"  deleted section: {section_id}")
    else:
        print(f"  FAIL delete section {section_id}: {r}")
        sys.exit(1)

print(f"\n{course_id} D1 wired successfully")
